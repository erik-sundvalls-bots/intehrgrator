import { actorOrigin, type HistoryActor } from "../agent/actor.ts";
import { bundleRevision } from "../agent/revision.ts";
import type { ProjectBundle } from "../types/mod.ts";

export type HistoryKind =
  | "import"
  | "map_slot"
  | "load_bundle"
  | "optional_rm"
  | "block_graph"
  | "expression"
  | "restore"
  | "patch"
  /** Undo (sv: Ångra) / redo, appended like any change (ADR 0014). */
  | "undo"
  | "redo"
  /** Revert (sv: Häv): compensating change for one earlier entry. */
  | "revert";

export interface HistoryEntry {
  seq: number;
  revisionAfter: string;
  actor: HistoryActor;
  kind: HistoryKind;
  summary: string;
  beforeBundle: ProjectBundle;
  afterBundle: ProjectBundle;
  affectedSlotIds: string[];
  timestamp: string;
  /** For undo / redo / revert entries: the entries they act on. */
  targetSeqs?: number[];
  /** Rewound by a later Undo (and not redone). */
  undone?: boolean;
}

export interface AgentActivity {
  agentId: string;
  displayName: string;
  color: string;
  revision: string;
  summary: string;
  affectedSlotIds: string[];
  at: string;
}

export interface RestoreAtResult {
  ok: boolean;
  revision: string;
  discarded: HistoryEntry[];
  mode: "view" | "destructive";
}

/**
 * One chronological history per project (ADR 0014). Entries are only ever
 * appended: Undo, Redo and Revert are new entries too, so the log is never
 * rewritten. `applied` is the stack Undo rewinds from the top, regardless of
 * author.
 */
export class HistoryLog {
  private entries: HistoryEntry[] = [];
  /** Seqs of changes in effect, oldest first (Undo pops from the end). */
  private applied: number[] = [];
  /** Seqs rewound by Undo, newest last (Redo pops from the end). */
  private redoStack: number[] = [];
  private headSeq = 0;
  private lastActivity: AgentActivity | null = null;
  private readonly persistPath?: string;

  constructor(options?: { persistPath?: string }) {
    this.persistPath = options?.persistPath;
  }

  get length(): number {
    return this.entries.length;
  }

  list(): HistoryEntry[] {
    return this.entries.map((e) => ({
      ...e,
      beforeBundle: structuredClone(e.beforeBundle),
    }));
  }

  get(seq: number): HistoryEntry | undefined {
    return this.entries.find((e) => e.seq === seq);
  }

  tail(): HistoryEntry | undefined {
    const e = this.entries.at(-1);
    return e ? { ...e, beforeBundle: structuredClone(e.beforeBundle) } : undefined;
  }

  getActivity(): AgentActivity | null {
    return this.lastActivity ? { ...this.lastActivity } : null;
  }

  record(
    beforeBundle: ProjectBundle,
    afterBundle: ProjectBundle,
    actor: HistoryActor,
    kind: HistoryKind,
    summary: string,
    affectedSlotIds: string[] = [],
    targetSeqs?: number[],
  ): HistoryEntry | null {
    if (JSON.stringify(beforeBundle) === JSON.stringify(afterBundle)) return null;
    const revisionAfter = bundleRevision(afterBundle);
    const tail = this.entries.at(-1);
    if (
      tail && actor.turnId && tail.actor.turnId === actor.turnId && tail.actor.id === actor.id &&
      this.applied.at(-1) === tail.seq
    ) {
      // One AI chat turn is one entry (ADR 0014): later commits of the same
      // turn extend it, unless another actor wrote in between.
      tail.afterBundle = structuredClone(afterBundle);
      tail.revisionAfter = revisionAfter;
      tail.summary = summary;
      tail.kind = kind;
      tail.affectedSlotIds = [...new Set([...tail.affectedSlotIds, ...affectedSlotIds])];
      tail.timestamp = new Date().toISOString();
      this.clearRedo();
      this.noteActivity(tail);
      void this.appendPersist(tail);
      return tail;
    }
    const entry: HistoryEntry = {
      seq: ++this.headSeq,
      revisionAfter,
      actor: { ...actor },
      kind,
      summary,
      beforeBundle: structuredClone(beforeBundle),
      afterBundle: structuredClone(afterBundle),
      affectedSlotIds: [...affectedSlotIds],
      timestamp: new Date().toISOString(),
      ...(targetSeqs ? { targetSeqs: [...targetSeqs] } : {}),
    };
    this.entries.push(entry);
    this.applied.push(entry.seq);
    this.clearRedo();
    this.noteActivity(entry);
    void this.appendPersist(entry);
    return entry;
  }

  private clearRedo(): void {
    this.redoStack = [];
  }

  private append(entry: Omit<HistoryEntry, "seq" | "revisionAfter" | "timestamp">): HistoryEntry {
    const full: HistoryEntry = {
      ...entry,
      seq: ++this.headSeq,
      revisionAfter: bundleRevision(entry.afterBundle),
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);
    this.noteActivity(full);
    void this.appendPersist(full);
    return full;
  }

  /** The change Undo would rewind next (the newest change in effect). */
  undoTarget(): HistoryEntry | undefined {
    const seq = this.applied.at(-1);
    return seq === undefined ? undefined : this.get(seq);
  }

  private noteActivity(entry: HistoryEntry): void {
    if (entry.actor.kind !== "agent") return;
    this.lastActivity = {
      agentId: entry.actor.id,
      displayName: entry.actor.displayName,
      color: entry.actor.color ?? "",
      revision: entry.revisionAfter,
      summary: entry.summary,
      affectedSlotIds: [...entry.affectedSlotIds],
      at: entry.timestamp,
    };
  }

  /** Update the summary of the newest entry when it belongs to AI chat turn `turnId`. */
  updateTailSummary(turnId: string, summary: string): void {
    const tail = this.entries.at(-1);
    if (!tail || tail.actor.turnId !== turnId) return;
    tail.summary = summary;
    this.noteActivity(tail);
    void this.appendPersist(tail);
  }

  /** Entries recorded after the one whose `revisionAfter` is `revision` (all when unknown). */
  entriesAfterRevision(revision: string): HistoryEntry[] {
    const idx = this.entries.findIndex((e) => e.revisionAfter === revision);
    return idx < 0 ? [] : this.entries.slice(idx + 1);
  }

  /**
   * Undo (sv: Ångra): rewind the newest change in effect, whoever made it.
   * Appends an `undo` entry by `actor`; returns the project to load.
   */
  undo(current: ProjectBundle, actor: HistoryActor): { bundle: ProjectBundle; entry: HistoryEntry; undone: HistoryEntry } | null {
    const target = this.undoTarget();
    if (!target) return null;
    return this.rewind([target], target.beforeBundle, current, actor, `Undo: ${target.summary}`);
  }

  /** Go back to just after `seq`: Undo every later change in effect, as one entry. */
  undoTo(seq: number, current: ProjectBundle, actor: HistoryActor):
    | { bundle: ProjectBundle; entry: HistoryEntry; undone: HistoryEntry[] }
    | null {
    const target = this.get(seq);
    if (!target) return null;
    const later = this.applied.filter((s) => s > seq).map((s) => this.get(s)!).reverse();
    if (!later.length) return null;
    const result = this.rewind(later, target.afterBundle, current, actor, `Back to #${seq}: ${target.summary}`);
    return { bundle: result.bundle, entry: result.entry, undone: later };
  }

  private rewind(
    targets: HistoryEntry[],
    bundle: ProjectBundle,
    current: ProjectBundle,
    actor: HistoryActor,
    summary: string,
  ): { bundle: ProjectBundle; entry: HistoryEntry; undone: HistoryEntry } {
    for (const t of targets) {
      this.applied.splice(this.applied.lastIndexOf(t.seq), 1);
      this.redoStack.push(t.seq);
      t.undone = true;
    }
    const entry = this.append({
      actor: { ...actor },
      kind: "undo",
      summary,
      beforeBundle: structuredClone(current),
      afterBundle: structuredClone(bundle),
      affectedSlotIds: [...new Set(targets.flatMap((t) => t.affectedSlotIds))],
      targetSeqs: targets.map((t) => t.seq),
    });
    return { bundle: structuredClone(bundle), entry, undone: targets[0]! };
  }

  /** The change Redo would put back next. */
  redoTarget(): HistoryEntry | undefined {
    const seq = this.redoStack.at(-1);
    return seq === undefined ? undefined : this.get(seq);
  }

  /** Redo the change the last Undo rewound; appends a `redo` entry. */
  redo(current: ProjectBundle, actor: HistoryActor): { bundle: ProjectBundle; entry: HistoryEntry } | null {
    const seq = this.redoStack.pop();
    if (seq === undefined) return null;
    const target = this.get(seq)!;
    target.undone = false;
    this.applied.push(seq);
    const entry = this.append({
      actor: { ...actor },
      kind: "redo",
      summary: `Redo: ${target.summary}`,
      beforeBundle: structuredClone(current),
      afterBundle: structuredClone(target.afterBundle),
      affectedSlotIds: [...target.affectedSlotIds],
      targetSeqs: [seq],
    });
    return { bundle: structuredClone(target.afterBundle), entry };
  }

  canUndo(): boolean {
    return this.applied.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  previewAt(seq: number): ProjectBundle | null {
    const entry = this.entries.find((e) => e.seq === seq);
    return entry ? structuredClone(entry.afterBundle) : null;
  }

  /** The project as it was right after `seq` (view only; see `undoTo` to go back). */
  restoreAt(seq: number): RestoreAtResult & { preview?: ProjectBundle } {
    const target = this.get(seq);
    if (!target) return { ok: false, revision: "", discarded: [], mode: "view" };
    return {
      ok: true,
      revision: target.revisionAfter,
      discarded: [],
      mode: "view",
      preview: structuredClone(target.afterBundle),
    };
  }

  buildPatchPrompt(targetSeq: number, currentBundle: ProjectBundle): string {
    const entry = this.entries.find((e) => e.seq === targetSeq);
    if (!entry) return "";
    return [
      "# intEHRgrator patch-undo request",
      "",
      "Produce **intehrgrator-suggestions** JSON (version 2) that approximates removing the effects",
      "of the history entry below while preserving unrelated mappings in the current project.",
      "",
      "## Target history entry",
      `- seq: ${entry.seq}`,
      `- actor: ${entry.actor.displayName} (${actorOrigin(entry.actor)})`,
      `- summary: ${entry.summary}`,
      `- affectedSlotIds: ${entry.affectedSlotIds.join(", ") || "(none)"}`,
      "",
      "## Response contract",
      "Return ONLY a fenced JSON block with format `intehrgrator-suggestions` version 2.",
      "Apply via MCP `import_suggestions` or POST /api/v1/import-suggestions.",
      "",
      "## Current revision",
      bundleRevision(currentBundle),
    ].join("\n");
  }

  private async appendPersist(entry: HistoryEntry): Promise<void> {
    if (!this.persistPath) return;
    try {
      const line = JSON.stringify({
        seq: entry.seq,
        revisionAfter: entry.revisionAfter,
        actor: entry.actor,
        kind: entry.kind,
        summary: entry.summary,
        affectedSlotIds: entry.affectedSlotIds,
        timestamp: entry.timestamp,
        ...(entry.targetSeqs ? { targetSeqs: entry.targetSeqs } : {}),
      });
      await Deno.writeTextFile(this.persistPath, line + "\n", { append: true });
    } catch {
      // persistence optional
    }
  }
}
