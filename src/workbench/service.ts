/**
 * Headless workbench operations for IDE agents and MCP — Blockly JSON / Mapping Model,
 * not DOM. Wraps WorkbenchController with a filesystem-capable host, attributed history, and revision.
 */

import type { MappingSlotReview } from "../types/mod.ts";
import type { AiArtifactDelivery } from "../core/ai/mod.ts";
import { parseSuggestionsPayload } from "../core/ai/mod.ts";
import type { HostAdapter } from "../host/mod.ts";
import { createFsHostAdapter } from "../host/fs_adapter.ts";
import type {
  ConversionScriptLanguage,
  ImportSuggestionsReport,
  InstanceEncoding,
  OutputMode,
  ProjectBundle,
  SourceFormatId,
  TestResult,
} from "../types/mod.ts";
import {
  isConversionScriptLanguage,
  isInstanceEncoding,
} from "../types/mod.ts";
import { actorFromHeaders, actorOrigin, type HistoryActor, USER_ACTOR } from "../agent/actor.ts";
import { changedTargetIds } from "../agent/lease_guard.ts";
import { AgentRegistry } from "../agent/registry.ts";
import { bundleRevision } from "../agent/revision.ts";
import type { AgentSnapshot, HumanWinsNotice } from "../agent/types.ts";
import {
  compactSourceTree,
  constraintWarningsInspect,
  listRepeatableInspect,
  listSlotsInspect,
  productStackInspect,
  sheetSummaries,
} from "../agent/inspect.ts";
import { leaseCovers, SlotLeaseRegistry, type SlotLease } from "../agent/leases.ts";
import { filterSlotRows } from "../agent/inspect.ts";
import { slotDetail } from "../agent/slot_detail.ts";
import { buildSlotTree, resolveSlotPrefix, resolveSlotRef } from "../core/ai/slot_tree.ts";
import { importBundle, exportBundle as zipBundle, validateBundle } from "../core/persistence/mod.ts";
import type { ExampleSet } from "../core/example_sets/mod.ts";
import type {
  FunctionBundle,
  FunctionClashPolicy,
  MergeFunctionResult,
} from "../core/function_library/mod.ts";
import { collectAllSlotIds } from "../core/skeleton/generate_skeleton.ts";
import { generate, getExportTargetAdapter } from "../core/codegen/mod.ts";
import {
  instanceShapeForEncoding,
  preferredInstanceEncoding,
} from "../core/output/instance_encoding.ts";
import { initBlocklyGenerators, workspaceToModelJson } from "../blockly/mod.ts";
import { Blockly } from "../blockly/blockly_core.ts";
import { INSTANCE_ENCODING_FIELD } from "../core/output/instance_encoding.ts";
import { productStackBlocks } from "../blockly/instance_root.ts";
import type { SheetDocument } from "../core/sheets/mod.ts";
import { WorkbenchController } from "./controller.ts";
import { planRevert, type RevertSkip } from "./revert.ts";
import {
  adoptBlocklyState,
  ensureSchemaBlocksForSkeleton,
  scaffoldBlocklyFromSkeleton,
  syncModelToBlocklyState,
} from "./blockly_sync.ts";
import {
  HistoryLog,
  type HistoryEntry,
  type HistoryKind,
  type RestoreAtResult,
} from "./history.ts";

export interface MutationContext {
  actor?: HistoryActor;
  summary?: string;
  kind?: HistoryKind;
  affectedSlotIds?: string[];
  recordHistory?: boolean;
  /** Undo / revert: the entries acted on. */
  targetSeqs?: number[];
}

export interface UndoResult {
  /** The appended `undo` entry. */
  seq: number;
  undoneSeqs: number[];
  /** Who made the undone change(s), for the status line. */
  author: string;
  summary: string;
}

export interface RevertResult {
  /** False when nothing could be reverted (all skipped or nothing to do). */
  ok: boolean;
  /** The appended `revert` entry. */
  seq?: number;
  revertedSeq: number;
  author: string;
  reverted: string[];
  sheetsReverted: boolean;
  skipped: RevertSkip[];
  notReverted: string[];
  revision: string;
}

export class WorkbenchService {
  private readonly controller: WorkbenchController;
  readonly registry = new AgentRegistry();
  readonly history: HistoryLog;
  readonly leases = new SlotLeaseRegistry();
  /** Per agent: slots the person edited during that agent's lease (refused once on its next write). */
  private readonly humanTook = new Map<string, Set<string>>();
  private readonly humanWins: HumanWinsNotice[] = [];
  private humanWinsSeq = 0;
  private revision = "r0";
  private currentActor: HistoryActor = USER_ACTOR;

  /** True when `controller` drives a live Blockly canvas (the browser UI). */
  private readonly liveCanvas: boolean;
  /** Live canvas: the project as last recorded, to record a person's edits made meanwhile. */
  private liveBaseline: ProjectBundle | null = null;
  /** Inside `mutate()`: canvas re-renders then are this service's own change, recorded by it. */
  private mutating = false;

  /**
   * Headless by default (Agent API, stdio MCP). The browser passes its live
   * `controller` so the in-app AI chat writes through the same tools and
   * history as MCP (ADR 0014); the UI then keeps the Blockly JSON in sync from
   * the canvas, so the headless Blockly sync is skipped.
   */
  constructor(options?: { historyPath?: string; host?: HostAdapter; controller?: WorkbenchController }) {
    this.controller = options?.controller ?? new WorkbenchController(options?.host ?? createFsHostAdapter());
    this.liveCanvas = Boolean(options?.controller);
    this.history = new HistoryLog({ persistPath: options?.historyPath });
    if (this.liveCanvas) this.bumpRevision();
  }

  getRevision(): string {
    // A live canvas also changes without this service (a person's edits).
    if (this.liveCanvas) this.revision = bundleRevision(this.exportBundle());
    return this.revision;
  }

  /**
   * Live canvas (web app): record what changed on the canvas since the last
   * recorded state as one entry by `actor`. The web app calls this for every
   * UI change, so the browser keeps one chronological history (ADR 0014).
   */
  recordLiveChange(summary: string, kind: HistoryKind = "expression", actor: HistoryActor = USER_ACTOR): HistoryEntry | null {
    if (!this.liveCanvas || this.mutating) return null;
    const after = this.exportBundle();
    // Only what the revision covers (mapping, canvas, sheets) is a change.
    const changed = this.liveBaseline && bundleRevision(this.liveBaseline) !== bundleRevision(after);
    const entry = changed ? this.history.record(this.liveBaseline!, after, actor, kind, summary) : null;
    this.liveBaseline = after;
    this.revision = bundleRevision(after);
    return entry;
  }

  /** Live canvas: take the canvas as it is now as recorded (a marker update, not a change). */
  acceptLiveState(): void {
    if (!this.liveCanvas || this.mutating) return;
    this.liveBaseline = this.exportBundle();
    this.revision = bundleRevision(this.liveBaseline);
  }

  exportBundle(): ProjectBundle {
    return this.controller.exportDocumentSnapshot();
  }

  getSnapshot(): AgentSnapshot {
    const s = this.controller.getState();
    const slots = listSlotsInspect(s.skeleton, s.model);
    const unmapped = slots.filter((row) => !row.mapped && row.mandatory).map((row) => row.slotId);
    const constraintWarnings = this.listConstraintWarnings();
    return {
      revision: this.revision,
      templateId: s.templateId,
      projectId: s.projectId,
      appliedSlots: slots.filter((row) => row.mapped).length,
      loops: s.model.loops?.length ?? 0,
      unmappedMandatory: s.unmappedMandatory,
      statusMessage: s.statusMessage,
      testOk: s.testResult?.ok ?? null,
      activeAgents: this.registry.list().length,
      unmappedMandatorySlotIds: unmapped.slice(0, 40),
      sheetNames: s.sheets.map((sheet) => sheet.name),
      productStack: productStackInspect(s.blocklyState),
      leases: this.leases.list(),
      humanWins: this.humanWins.slice(-5),
      exampleCount: s.examples.length,
      activeExample: s.activeExample?.filename ?? null,
      constraintWarningCount: constraintWarnings.length,
    };
  }

  registerAgent(options?: { agentId?: string; displayName?: string; color?: string }) {
    const reg = this.registry.register(options);
    this.leases.renameAgent(reg.agentId, reg.displayName, reg.color);
    return reg;
  }

  setActorFromHeaders(headers: Headers): HistoryActor {
    const raw = actorFromHeaders(headers);
    if (raw.kind === "agent") {
      const reg = this.registry.get(raw.id);
      if (reg) {
        this.currentActor = {
          kind: "agent",
          id: reg.agentId,
          displayName: reg.displayName,
          color: reg.color,
          origin: "mcp",
          ...(raw.client ? { client: raw.client } : {}),
        };
        return this.currentActor;
      }
    }
    this.currentActor = raw;
    return raw;
  }

  setActor(actor: HistoryActor): HistoryActor {
    this.currentActor = actor;
    return actor;
  }

  /**
   * UI pushes a semantic canvas commit into the shared session: a person's
   * edit, or an in-app AI chat turn (`actor` from `aiChatActor`).
   *
   * `baseRevision` is the revision the UI last synced. When an agent wrote
   * after it, the UI document still wins (the person sees it on screen), and
   * the overwritten entries are returned so the UI can say so; they stay in
   * history and can be restored.
   */
  commitFromUi(
    bundle: ProjectBundle,
    summary: string,
    kind: HistoryKind = "expression",
    options: { actor?: HistoryActor; baseRevision?: string } = {},
  ): { revision: string; overwritten: Array<{ seq: number; actor: string; summary: string }> } {
    const overwritten = options.baseRevision && options.baseRevision !== this.revision
      ? this.history.entriesAfterRevision(options.baseRevision)
        .filter((e) => e.actor.kind === "agent" && e.actor.id !== options.actor?.id)
        .map((e) => ({ seq: e.seq, actor: e.actor.displayName, summary: e.summary }))
      : [];
    const turnId = options.actor?.turnId;
    if (turnId && bundleRevision(bundle) === this.revision) {
      // Same document, later summary of the same AI turn (its ✓ notices).
      this.history.updateTailSummary(turnId, summary);
      return { revision: this.revision, overwritten };
    }
    const before = this.exportBundle();
    this.controller.restoreDocumentSnapshot(structuredClone(bundle));
    if (!options.actor || options.actor.kind === "user") this.noteHumanEditsInLeases(before, bundle);
    this.recordMutation(before, {
      actor: options.actor ?? USER_ACTOR,
      summary,
      kind,
      recordHistory: true,
    });
    return { revision: this.revision, overwritten };
  }

  loadBundle(bundle: ProjectBundle, ctx?: MutationContext & { expectedRevision?: string }): void {
    this.assertRevision(ctx?.expectedRevision);
    this.mutate(() => {
      this.controller.restoreDocumentSnapshot(structuredClone(bundle));
      this.syncBlocklyFromModel();
    }, { ...ctx, kind: ctx?.kind ?? "load_bundle", summary: ctx?.summary ?? "Load project bundle" });
  }

  loadBundleFile(bytes: Uint8Array, ctx?: MutationContext & { expectedRevision?: string }): void {
    this.loadBundle(parseBundleBytes(bytes), ctx);
  }

  loadTemplateContent(filename: string, content: string, ctx?: MutationContext): void {
    this.mutate(() => {
      this.controller.loadTemplateContent(filename, content);
      this.hydrateSkeletonCanvas();
    }, { ...ctx, kind: "load_bundle", summary: ctx?.summary ?? `Load template ${filename}` });
  }

  loadSchemaContent(filename: string, content: string, ctx?: MutationContext): void {
    this.mutate(() => {
      this.controller.loadSchemaContent(filename, content);
    }, { ...ctx, kind: "load_bundle", summary: ctx?.summary ?? `Load schema ${filename}` });
    // A file that could not be read is a tool error, not a silent empty Source pane (#278).
    const error = this.controller.getState().schemaError;
    if (error) throw new Error(error);
  }

  addExampleContent(filename: string, content: string, ctx?: MutationContext): void {
    this.mutate(() => {
      this.controller.addExampleContent(filename, content);
    }, { ...ctx, summary: ctx?.summary ?? `Load example ${filename}` });
  }

  buildAgentPrompt(
    delivery: AiArtifactDelivery = "inline",
    scope: "full" | "slot" = "full",
    slotId?: string,
  ): string {
    return this.controller.buildAiPromptText(delivery, scope, slotId);
  }

  importSuggestions(text: string, expectedRevision?: string, ctx?: MutationContext): ImportSuggestionsReport {
    this.assertRevision(expectedRevision);
    const actorId = ctx?.actor?.kind === "agent" ? ctx.actor.id : this.agentIdForLeases();
    let toImport = text;
    const leaseErrors: string[] = [];
    const state = this.controller.getState();
    try {
      const payload = parseSuggestionsPayload(text, {
        fallbackTarget: {
          targetId: state.templateId,
          format: state.target?.format ?? state.model.targetFormat ?? "openehr-template",
        },
      });
      const foreign = this.leases.foreignHolders(payload.suggestions.map((s) => s.slotId), actorId);
      const actor = ctx?.actor ?? this.currentActor;
      const edited = new Set(
        actorId && actor.kind === "agent" && actorOrigin(actor) === "mcp"
          ? this.takeHumanEdited(actor, payload.suggestions.map((s) => s.slotId).filter((id) => !foreign.has(id)))
          : [],
      );
      if (foreign.size || edited.size) {
        const filtered = {
          ...payload,
          suggestions: payload.suggestions.filter((s) => !foreign.has(s.slotId) && !edited.has(s.slotId)),
        };
        toImport = JSON.stringify(filtered);
        for (const [slotId, row] of foreign) {
          leaseErrors.push(`${slotId}: leased by ${row.displayName} (${row.agentId})`);
        }
        for (const slotId of edited) {
          leaseErrors.push(`${slotId}: edited by the person during your lease (the person wins); read it again`);
        }
      }
    } catch {
      // Invalid envelope — controller import reports the error.
    }
    let report!: ImportSuggestionsReport;
    this.mutate(() => {
      report = this.controller.importAiSuggestions(toImport);
      this.syncBlocklyFromModel();
    }, {
      ...ctx,
      kind: "import",
      summary: ctx?.summary ?? "Import AI suggestions",
      affectedSlotIds: ctx?.affectedSlotIds,
    });
    if (leaseErrors.length) {
      report.errors.push(...leaseErrors);
      report.skipped += leaseErrors.length;
    }
    return report;
  }

  mapNodeToSlot(
    slotId: string,
    path: string,
    format: SourceFormatId = "json",
    expectedRevision?: string,
    ctx?: MutationContext,
    review?: MappingSlotReview,
  ): void {
    this.assertRevision(expectedRevision);
    const actorId = ctx?.actor?.kind === "agent" ? ctx.actor.id : this.agentIdForLeases();
    const held = this.leases.foreignHeld([slotId], actorId);
    if (held[0]) throw new AgentSlotLeasedError(held[0]);
    this.mutate(() => {
      this.controller.mapNodeToSlot(slotId, path, format, review);
      this.syncBlocklyFromModel();
    }, {
      ...ctx,
      kind: "map_slot",
      summary: ctx?.summary ?? `Map ${path} → ${slotId}`,
      affectedSlotIds: [slotId],
    });
  }

  loadBlocklyState(blocklyState: unknown, expectedRevision?: string, ctx?: MutationContext): void {
    this.assertRevision(expectedRevision);
    this.mutate(() => {
      this.controller.loadBlocklyDefinition("agent.blockly.json", JSON.stringify(blocklyState));
    }, { ...ctx, kind: "block_graph", summary: ctx?.summary ?? "Replace Blockly workspace" });
  }

  async loadFunctionLibraryCatalog(url?: string) {
    return await this.controller.loadFunctionLibraryCatalog(url);
  }

  async loadFunctionLibraryEntry(catalogUrl: string, id: string) {
    const catalog = await this.controller.loadFunctionLibraryCatalog(catalogUrl);
    return await this.controller.loadFunctionLibraryEntry(catalog, id);
  }

  applyFunctionBundle(
    bundle: FunctionBundle,
    clash: FunctionClashPolicy = "rename",
    expectedRevision?: string,
    ctx?: MutationContext,
  ): MergeFunctionResult {
    this.assertRevision(expectedRevision);
    let result!: MergeFunctionResult;
    this.mutate(() => {
      result = this.controller.applyFunctionBundle(bundle, clash);
    }, {
      ...ctx,
      kind: "block_graph",
      summary: ctx?.summary ?? `Load Function ${bundle.name}`,
    });
    return result;
  }

  addOptionalRm(
    parentSlotId: string,
    rmType: string,
    attributeName: string,
    expectedRevision?: string,
    ctx?: MutationContext,
  ): void {
    this.assertRevision(expectedRevision);
    this.mutate(() => {
      this.controller.addOptionalRm(parentSlotId, rmType, attributeName);
      this.syncBlocklyFromModel();
    }, { ...ctx, kind: "optional_rm", summary: ctx?.summary ?? `Add optional RM ${attributeName}` });
  }

  removeOptionalRm(
    parentSlotId: string,
    attributeName: string,
    expectedRevision?: string,
    ctx?: MutationContext,
  ): void {
    this.assertRevision(expectedRevision);
    this.mutate(() => {
      this.controller.removeOptionalRm(parentSlotId, attributeName);
      this.syncBlocklyFromModel();
    }, { ...ctx, kind: "optional_rm", summary: ctx?.summary ?? `Remove optional RM ${attributeName}` });
  }

  runTest(): TestResult {
    this.controller.runTestNow();
    return this.controller.getState().testResult ?? { ok: false, error: "No test result", warnings: [] };
  }

  /** Session Output mode for Conversion Test Run (Mapping preview vs TypeScript, …). */
  setOutputMode(mode: OutputMode): void {
    this.controller.setExportTarget(mode);
  }

  getOutputMode(): OutputMode {
    return this.controller.getState().settings.exportTarget;
  }

  listHistory(): HistoryEntry[] {
    return this.history.list();
  }

  getActivity() {
    return this.history.getActivity();
  }

  /**
   * Undo (sv: Ångra): rewind the newest change in effect, whoever made it
   * (ADR 0014). Appends an `undo` entry; the history is never rewritten.
   */
  undo(ctx?: MutationContext): UndoResult | null {
    const target = this.history.undoTarget();
    if (target) this.assertLeasesAllow(this.exportBundle(), target.beforeBundle, ctx?.actor ?? this.currentActor);
    const result = this.history.undo(this.exportBundle(), ctx?.actor ?? this.currentActor);
    if (!result) return null;
    this.controller.restoreDocumentSnapshot(result.bundle);
    this.bumpRevision();
    return { seq: result.entry.seq, undoneSeqs: [result.undone.seq], author: result.undone.actor.displayName, summary: result.undone.summary };
  }

  /** Go back to just after history entry `seq` ("Undo to here"), as one appended entry. */
  undoTo(seq: number, ctx?: MutationContext): UndoResult | null {
    const to = this.history.get(seq);
    if (to) this.assertLeasesAllow(this.exportBundle(), to.afterBundle, ctx?.actor ?? this.currentActor);
    const result = this.history.undoTo(seq, this.exportBundle(), ctx?.actor ?? this.currentActor);
    if (!result) return null;
    this.controller.restoreDocumentSnapshot(result.bundle);
    this.bumpRevision();
    return {
      seq: result.entry.seq,
      undoneSeqs: result.undone.map((e) => e.seq),
      author: [...new Set(result.undone.map((e) => e.actor.displayName))].join(", "),
      summary: result.entry.summary,
    };
  }

  redo(ctx?: MutationContext): boolean {
    const next = this.history.redoTarget();
    if (next) this.assertLeasesAllow(this.exportBundle(), next.afterBundle, ctx?.actor ?? this.currentActor);
    const result = this.history.redo(this.exportBundle(), ctx?.actor ?? this.currentActor);
    if (!result) return false;
    this.controller.restoreDocumentSnapshot(result.bundle);
    this.bumpRevision();
    return true;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  /** Who made the change Undo would rewind next (for the status line). */
  undoTarget(): { seq: number; author: string; summary: string } | null {
    const e = this.history.undoTarget();
    return e ? { seq: e.seq, author: e.actor.displayName, summary: e.summary } : null;
  }

  /**
   * Revert (sv: Häv) history entry `seq` as a new change at the end (ADR
   * 0014): its slots (and sheets) go back to how they were before it, except
   * those changed again later, which are skipped and reported. Other parts
   * of the entry (optional RM, loops, files) are reported, not reverted.
   */
  revert(seq: number, ctx?: MutationContext & { expectedRevision?: string }): RevertResult {
    this.assertRevision(ctx?.expectedRevision);
    const entry = this.history.get(seq);
    if (!entry) throw new Error(`No history entry #${seq}`);
    const plan = planRevert(entry, this.exportBundle());
    let newSeq: number | undefined;
    if (plan.changed) {
      const next = plan.bundle;
      const s = this.controller.getState();
      const { extract, blocklyState } = adoptBlocklyState(next.mapping.blocklyState, s.skeleton, {
        uiLanguage: s.modelLanguage ?? s.settings.modelLanguage ?? "en",
        targetFormat: s.target?.format,
      });
      next.mapping.blocklyState = blocklyState;
      this.mutate(() => {
        this.controller.restoreDocumentSnapshot(next);
        // The model follows the reverted canvas (as when a canvas is adopted).
        this.controller.syncFromBlockly(blocklyState, extract.slots, extract.loops, extract.optionalRm, {
          notify: this.liveCanvas,
          targetSignature: extract.targetSignature,
          unsupported: extract.unsupported,
          sheetNames: extract.sheetNames,
          instanceEncodings: extract.instanceEncodings,
          functions: extract.functions,
        });
      }, {
        ...ctx,
        kind: "revert",
        summary: ctx?.summary ?? `Revert #${seq}: ${entry.summary}`,
        affectedSlotIds: plan.reverted,
        targetSeqs: [seq],
      });
      newSeq = this.history.tail()?.seq;
    }
    return {
      ok: plan.changed,
      seq: newSeq,
      revertedSeq: seq,
      author: entry.actor.displayName,
      reverted: plan.reverted,
      sheetsReverted: plan.sheetsReverted,
      skipped: plan.skipped,
      notReverted: plan.notReverted,
      revision: this.revision,
    };
  }

  restoreAt(seq: number, mode: "view" | "destructive"): RestoreAtResult & { preview?: ProjectBundle } {
    if (mode === "destructive") {
      // "Rollback here" goes back by appending an Undo entry (the history is never rewritten).
      const target = this.history.get(seq);
      if (!target) return { ok: false, revision: "", discarded: [], mode };
      const undone = this.undoTo(seq);
      const discarded = (undone?.undoneSeqs ?? []).map((s) => this.history.get(s)!).filter(Boolean);
      return { ok: true, revision: this.revision, discarded, mode };
    }
    return this.history.restoreAt(seq);
  }

  buildPatchPrompt(targetSeq: number): string {
    return this.history.buildPatchPrompt(targetSeq, this.exportBundle());
  }

  listSlots() {
    const s = this.controller.getState();
    return listSlotsInspect(s.skeleton, s.model);
  }

  listRepeatable() {
    const s = this.controller.getState();
    return listRepeatableInspect(s.skeleton);
  }

  /** Every skeleton node id (value slots and containers). */
  private nodeIds(): Set<string> {
    return new Set(collectAllSlotIds(this.controller.getState().skeleton));
  }

  /**
   * A slot reference from an agent (full id, compact slot-tree id, or a unique
   * tail) as the skeleton id; unchanged when nothing matches (#277).
   */
  resolveSlotRef(ref: string): string {
    return resolveSlotRef(ref, this.nodeIds()) ?? ref;
  }

  /** A lease `subtree` node path given in compact form, as the full prefix. */
  resolveSlotPrefix(ref: string): string {
    return resolveSlotPrefix(ref, this.nodeIds());
  }

  /** `list_slots` default view: the compact slot tree with mapping expressions (#277). */
  listSlotTree(args: Record<string, unknown> = {}) {
    const s = this.controller.getState();
    const keep = new Set(filterSlotRows(listSlotsInspect(s.skeleton, s.model), args).map((r) => r.slotId));
    // Labels in `target.lang.1` (+ `labels` in the other AI languages), whatever the panes show (#279).
    return buildSlotTree(this.controller.getAiSkeleton(), {
      include: (slot) => keep.has(slot.slotId),
      model: s.model,
      info: this.controller.getSlotInfoIndex(),
      extraLabels: this.controller.getAiExtraLabels(),
    });
  }

  /** `get_slot`: full details of one slot (#277 §3). */
  getSlot(ref: string) {
    const s = this.controller.getState();
    const slotId = this.resolveSlotRef(ref);
    const lease = this.leases.list().find((l) => leaseCovers(l, slotId));
    const detail = slotDetail(
      this.controller.getAiSkeleton(),
      s.model,
      slotId,
      this.controller.getTargetSource(),
      this.controller.getSlotInfoIndex(),
      lease
        ? {
          agentId: lease.agentId,
          displayName: lease.displayName,
          expiresAt: new Date(lease.expiresAt).toISOString(),
          ...(lease.subtree ? { subtree: true } : {}),
        }
        : undefined,
    );
    if (!detail) throw new Error(`Unknown slotId: ${ref}`);
    return detail;
  }

  /** Examples + Active Example tree for `list_examples` / `get_example` (shared with AI chat). */
  getExampleState() {
    const s = this.controller.getState();
    return { examples: s.examples, activeExample: s.activeExample, exampleTree: s.exampleTree };
  }

  /**
   * `get_source_tree`: descriptions in `language` when given (one of the
   * schema's languages), else in the AI's source language (#277 §5).
   */
  getSourceTree(args: { language?: unknown } = {}) {
    const s = this.controller.getState();
    const schemaLanguages = this.controller.getSourceSchemaLanguages();
    const asked = typeof args.language === "string" ? args.language.trim() : "";
    const descriptionLanguage = asked
      ? (schemaLanguages.find((l) => l.toLowerCase() === asked.toLowerCase()) ?? asked)
      : this.controller.getAiSourceDescriptionLanguage();
    const sourceLanguages = this.controller.getSourceLanguages();
    return {
      schema: compactSourceTree(this.controller.getSourceTreeIn(descriptionLanguage), 0, undefined, descriptionLanguage),
      ...(descriptionLanguage && s.schemaTree ? { descriptionLanguage } : {}),
      ...(sourceLanguages.length ? { sourceLanguages } : {}),
      ...(schemaLanguages.length ? { schemaLanguages } : {}),
      schemaFormat: s.schemaFormat,
      schemaFilename: s.schemaFilename,
      example: compactSourceTree(s.exampleTree ?? null),
      activeExample: s.activeExample?.filename ?? null,
      examples: s.examples.map((ex) => ({ id: ex.id, filename: ex.filename, format: ex.format })),
    };
  }

  getSheets() {
    const s = this.controller.getState();
    return { summaries: sheetSummaries(s.sheets), sheets: s.sheets };
  }

  getProductStack() {
    const s = this.controller.getState();
    return productStackInspect(s.blocklyState);
  }

  listConstraintWarnings() {
    const s = this.controller.getState();
    return constraintWarningsInspect({
      skeleton: s.skeleton,
      model: s.model,
      sheets: s.sheets,
      blocklyState: s.blocklyState,
    });
  }

  listOptionalRm(parentSlotId?: string) {
    if (parentSlotId) {
      return { parentSlotId, attachments: this.controller.getOptionalAttachments(parentSlotId) };
    }
    const s = this.controller.getState();
    const catalog = collectAllSlotIds(s.skeleton).map((id) => ({
      parentSlotId: id,
      attachments: this.controller.getOptionalAttachments(id),
    })).filter((row) => row.attachments.length);
    return { catalog };
  }

  async loadExampleSet(set: ExampleSet, ctx?: MutationContext): Promise<void> {
    const before = this.exportBundle();
    await this.controller.loadExampleSet(set);
    this.hydrateSkeletonCanvas();
    this.recordMutation(before, {
      ...ctx,
      kind: "load_bundle",
      summary: ctx?.summary ?? `Load example set ${set.id}`,
    });
  }

  async loadTargetFromUrl(url: string, ctx?: MutationContext): Promise<void> {
    const before = this.exportBundle();
    await this.controller.openTemplateFromUrl(url);
    this.hydrateSkeletonCanvas();
    this.recordMutation(before, {
      ...ctx,
      kind: "load_bundle",
      summary: ctx?.summary ?? `Load target ${url}`,
    });
  }

  async loadSchemaFromUrl(url: string, ctx?: MutationContext): Promise<void> {
    const before = this.exportBundle();
    await this.controller.loadSchemaFromUrl(url);
    this.recordMutation(before, {
      ...ctx,
      kind: "load_bundle",
      summary: ctx?.summary ?? `Load schema ${url}`,
    });
  }

  async addExampleFromUrl(url: string, ctx?: MutationContext): Promise<void> {
    const before = this.exportBundle();
    await this.controller.addExampleFromUrl(url);
    this.recordMutation(before, {
      ...ctx,
      summary: ctx?.summary ?? `Load example ${url}`,
    });
  }

  setActiveExample(id: string, ctx?: MutationContext): void {
    this.mutate(() => {
      this.controller.setActiveExample(id);
    }, { ...ctx, summary: ctx?.summary ?? `Active example ${id}` });
  }

  replaceSheets(sheets: SheetDocument[], ctx?: MutationContext & { expectedRevision?: string }): void {
    this.assertRevision(ctx?.expectedRevision);
    this.mutate(() => {
      this.controller.replaceSheets(sheets);
    }, { ...ctx, kind: "block_graph", summary: ctx?.summary ?? "Replace sheets" });
  }

  generateScript(language: ConversionScriptLanguage): {
    language: ConversionScriptLanguage;
    extension: string;
    mime: string;
    code: string;
    revision: string;
  } {
    if (!isConversionScriptLanguage(language)) {
      throw new Error(`Unsupported conversion script language: ${language}`);
    }
    initBlocklyGenerators();
    const s = this.controller.getState();
    const adapter = getExportTargetAdapter(language);
    const code = generate(s.model, language, {
      handlebarsTemplate: s.handlebarsTemplate,
      blocklyState: s.blocklyState,
      skeleton: s.skeleton,
      instanceShape: s.model.instanceEncodings?.length
        ? instanceShapeForEncoding(preferredInstanceEncoding(s.model))
        : s.settings.openEhrInstanceShape,
      webTemplateJson: s.target?.webTemplateJson,
    });
    return {
      language,
      extension: adapter.extension,
      mime: adapter.mime,
      code,
      revision: this.revision,
    };
  }

  exportBundleZip(): Uint8Array {
    return zipBundle(this.exportBundle());
  }

  setInstanceEncoding(
    encoding: InstanceEncoding,
    rootIndex = 0,
    expectedRevision?: string,
    ctx?: MutationContext,
  ): void {
    this.assertRevision(expectedRevision);
    if (!isInstanceEncoding(encoding)) throw new Error(`Invalid instance encoding: ${encoding}`);
    this.mutate(() => {
      const s = this.controller.getState();
      if (!s.blocklyState) throw new Error("No Blockly workspace to encode");
      initBlocklyGenerators();
      const workspace = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(
          JSON.parse(JSON.stringify(s.blocklyState)) as Record<string, unknown>,
          workspace,
        );
        const stack = productStackBlocks(workspace).filter((block) =>
          Boolean(block.getField(INSTANCE_ENCODING_FIELD))
        );
        const target = stack[rootIndex];
        if (!target) throw new Error(`No Instance root with encoding at index ${rootIndex}`);
        target.setFieldValue(encoding, INSTANCE_ENCODING_FIELD);
        this.commitWorkspace(workspace);
      } finally {
        workspace.dispose();
      }
    }, { ...ctx, kind: "block_graph", summary: ctx?.summary ?? `Instance encoding ${encoding}` });
  }

  /**
   * Lease a slot, or with `subtree` a node path and every slot below it
   * (S-15). Blocked (AgentSlotLeasedError) when it overlaps another agent's
   * lease. `covers` is how many Target value slots the lease covers now.
   */
  leaseSlot(slotId: string, ttlSec = 120, ctx?: MutationContext, subtree = false) {
    const actor = ctx?.actor ?? this.currentActor;
    const agentId = actor.kind === "agent" ? actor.id : actor.id || "user";
    const slotIds = this.listSlots().map((r) => r.slotId);
    const covers = slotIds.filter((id) => id === slotId || (subtree && id.startsWith(`${slotId}/`))).length;
    if (subtree && slotIds.length && !covers) {
      throw new Error(`No Target value slots under ${slotId}; pass a node path that is a prefix of slot ids (list_slots)`);
    }
    const reg = actor.kind === "agent" ? this.registry.get(agentId) : undefined;
    const result = this.leases.acquire(slotId, {
      agentId,
      displayName: actor.displayName,
      color: reg?.color ?? actor.color,
    }, ttlSec, subtree);
    if (!result.ok) throw new AgentSlotLeasedError(result.holder);
    return { ...result.lease, covers };
  }

  /** Release one of this agent's leases, or with `all` every one. Returns how many were released. */
  releaseSlot(slotId: string | undefined, ctx?: MutationContext, opts: { subtree?: boolean; all?: boolean } = {}): number {
    const actor = ctx?.actor ?? this.currentActor;
    const agentId = actor.kind === "agent" ? actor.id : undefined;
    if (opts.all) return agentId ? this.leases.releaseAll(agentId) : 0;
    if (!slotId) return 0;
    return this.leases.release(slotId, agentId, opts.subtree) ? 1 : 0;
  }

  /**
   * An MCP agent may not change what another agent leases (S-15). The person
   * in the UI and the in-app AI chat are not checked: the person wins (ADR
   * 0014) and sees the lease on the canvas.
   */
  private assertLeasesAllow(before: ProjectBundle, after: ProjectBundle, actor: HistoryActor): void {
    if (actor.kind !== "agent" || actorOrigin(actor) !== "mcp") return;
    const taken = this.humanTook.get(actor.id);
    if (!this.leases.list().length && !taken?.size) return;
    const changed = changedTargetIds(before, after);
    const holders = this.leases.foreignHolders(changed, actor.id);
    const first = holders.values().next().value;
    if (first) throw new AgentSlotLeasedError(first, [...holders.keys()]);
    const edited = this.takeHumanEdited(actor, changed);
    if (edited.length) throw new HumanEditedSlotError(actor.displayName, edited);
  }

  /**
   * The person edited slots inside an agent's lease (after the canvas warning,
   * "Edit anyway"). The person wins (ADR 0014): that agent's next write to
   * those slots is refused once, so it re-reads instead of overwriting.
   */
  private noteHumanEditsInLeases(before: ProjectBundle, after: ProjectBundle): void {
    if (!this.leases.list().length) return;
    for (const [slotId, lease] of this.leases.foreignHolders(changedTargetIds(before, after), undefined)) {
      const set = this.humanTook.get(lease.agentId) ?? new Set<string>();
      set.add(slotId);
      this.humanTook.set(lease.agentId, set);
    }
  }

  /** Slots among `slotIds` the person edited during `actor`'s lease; consumed and reported to the UI. */
  private takeHumanEdited(actor: HistoryActor, slotIds: string[]): string[] {
    const taken = this.humanTook.get(actor.id);
    if (!taken?.size) return [];
    const hit = slotIds.filter((id) => taken.has(id));
    if (!hit.length) return [];
    for (const id of hit) taken.delete(id);
    this.humanWins.push({
      seq: ++this.humanWinsSeq,
      agentId: actor.id,
      agent: actor.displayName.replace(/^MCP:\s*/, ""),
      slotIds: hit,
      at: Date.now(),
    });
    if (this.humanWins.length > 20) this.humanWins.splice(0, this.humanWins.length - 20);
    return hit;
  }

  private agentIdForLeases(): string | undefined {
    return this.currentActor.kind === "agent" ? this.currentActor.id : undefined;
  }

  private hydrateSkeletonCanvas(): void {
    const s = this.controller.getState();
    ensureSchemaBlocksForSkeleton(s.skeleton);
    if (s.blocklyState) {
      const pending = this.controller.consumePendingDefaultsMap();
      const { extract, blocklyState } = adoptBlocklyState(s.blocklyState, s.skeleton, {
        defaultsMap: pending ?? undefined,
        uiLanguage: s.modelLanguage ?? s.settings.modelLanguage ?? "en",
        targetFormat: s.target?.format,
      });
      this.controller.syncFromBlockly(
        blocklyState,
        extract.slots,
        extract.loops,
        extract.optionalRm,
        {
          notify: false,
          targetSignature: extract.targetSignature,
          unsupported: extract.unsupported,
          sheetNames: extract.sheetNames,
          instanceEncodings: extract.instanceEncodings,
          functions: extract.functions,
        },
      );
      return;
    }
    if (!s.skeleton.length) return;
    const pending = this.controller.consumePendingDefaultsMap();
    const { extract, blocklyState } = scaffoldBlocklyFromSkeleton(
      s.skeleton,
      s.model,
      {
        uiLanguage: s.modelLanguage ?? s.settings.modelLanguage ?? "en",
        targetFormat: s.target?.format,
        defaultsMap: pending ?? undefined,
      },
    );
    this.controller.syncFromBlockly(
      blocklyState,
      extract.slots,
      extract.loops,
      extract.optionalRm,
      {
        notify: false,
        targetSignature: extract.targetSignature,
        unsupported: extract.unsupported,
        sheetNames: extract.sheetNames,
        instanceEncodings: extract.instanceEncodings,
        functions: extract.functions,
      },
    );
  }

  private commitWorkspace(workspace: Blockly.Workspace): void {
    const extract = workspaceToModelJson(workspace);
    this.controller.syncFromBlockly(
      Blockly.serialization.workspaces.save(workspace),
      extract.slots,
      extract.loops,
      extract.optionalRm,
      {
        notify: false,
        targetSignature: extract.targetSignature,
        unsupported: extract.unsupported,
        sheetNames: extract.sheetNames,
        instanceEncodings: extract.instanceEncodings,
        functions: extract.functions,
      },
    );
  }

  private syncBlocklyFromModel(): void {
    if (this.liveCanvas) return;
    const s = this.controller.getState();
    if (!s.blocklyState) return;
    const next = syncModelToBlocklyState(s.blocklyState, s.model, s.skeleton);
    this.controller.syncCanvasSnapshot(next);
  }

  private bumpRevision(): void {
    const bundle = this.exportBundle();
    this.revision = bundleRevision(bundle);
    if (this.liveCanvas) this.liveBaseline = bundle;
  }

  private mutate(fn: () => void, ctx: MutationContext = {}): void {
    // A person's canvas edits not recorded yet are their own entry first.
    if (this.liveCanvas) this.recordLiveChange("Edit mapping");
    const before = this.exportBundle();
    this.mutating = true;
    try {
      fn();
    } finally {
      this.mutating = false;
    }
    try {
      this.assertLeasesAllow(before, this.exportBundle(), ctx.actor ?? this.currentActor);
    } catch (err) {
      // Put the project back as it was; nothing is recorded.
      this.controller.restoreDocumentSnapshot(before);
      throw err;
    }
    this.recordMutation(before, ctx);
  }

  private recordMutation(before: ProjectBundle, ctx: MutationContext): void {
    const after = this.exportBundle();
    if (ctx.recordHistory !== false) {
      this.history.record(
        before,
        after,
        ctx.actor ?? this.currentActor,
        ctx.kind ?? "expression",
        ctx.summary ?? "Edit mapping",
        ctx.affectedSlotIds ?? [],
        ctx.targetSeqs,
      );
    }
    this.bumpRevision();
  }

  private assertRevision(expected: string | undefined): void {
    if (expected && expected !== this.revision) {
      throw new AgentRevisionConflictError(this.revision, expected);
    }
  }
}

function parseBundleBytes(bytes: Uint8Array): ProjectBundle {
  const zipMagic = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zipMagic) return importBundle(bytes);
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trim();
  if (text.startsWith("{")) {
    const bundle = JSON.parse(text) as ProjectBundle;
    validateBundle(bundle);
    return bundle;
  }
  return importBundle(bytes);
}

export class AgentRevisionConflictError extends Error {
  constructor(
    readonly currentRevision: string,
    readonly expectedRevision: string,
  ) {
    super(`Revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name = "AgentRevisionConflictError";
  }
}

export class HumanEditedSlotError extends Error {
  constructor(readonly agent: string, readonly slotIds: string[]) {
    super(
      `The person edited ${slotIds.join(", ")} while ${agent} held the lease; the person wins, so this change was not applied. Read the slot again (get_slot) and decide whether it still needs your change.`,
    );
    this.name = "HumanEditedSlotError";
  }
}

export class AgentSlotLeasedError extends Error {
  constructor(readonly holder: SlotLease, readonly slotIds: string[] = []) {
    super(
      `${holder.subtree ? "Subtree" : "Slot"} ${holder.slotId} leased by ${holder.displayName} (${holder.agentId}) until ${
        new Date(holder.expiresAt).toISOString()
      }${slotIds.length ? `; blocked slots: ${slotIds.join(", ")}` : ""}. Work on other slots, or wait and retry.`,
    );
    this.name = "AgentSlotLeasedError";
  }
}
