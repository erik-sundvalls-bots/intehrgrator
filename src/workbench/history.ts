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
  | "patch";

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

export class HistoryLog {
  private entries: HistoryEntry[] = [];
  private redoStack: Array<{ entry: HistoryEntry; afterBundle: ProjectBundle }> = [];
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
  ): HistoryEntry | null {
    if (JSON.stringify(beforeBundle) === JSON.stringify(afterBundle)) return null;
    const revisionAfter = bundleRevision(afterBundle);
    const tail = this.entries.at(-1);
    if (tail && actor.turnId && tail.actor.turnId === actor.turnId && tail.actor.id === actor.id) {
      // One AI chat turn is one entry (ADR 0014): later commits of the same
      // turn extend it, unless another actor wrote in between.
      tail.afterBundle = structuredClone(afterBundle);
      tail.revisionAfter = revisionAfter;
      tail.summary = summary;
      tail.kind = kind;
      tail.affectedSlotIds = [...new Set([...tail.affectedSlotIds, ...affectedSlotIds])];
      tail.timestamp = new Date().toISOString();
      this.redoStack = [];
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
    };
    this.entries.push(entry);
    this.redoStack = [];
    this.noteActivity(entry);
    void this.appendPersist(entry);
    return entry;
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

  undoGlobal(currentAfter: ProjectBundle): ProjectBundle | null {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.redoStack.push({ entry, afterBundle: structuredClone(currentAfter) });
    return structuredClone(entry.beforeBundle);
  }

  undoByFilter(
    currentAfter: ProjectBundle,
    filter: (entry: HistoryEntry) => boolean,
  ): ProjectBundle | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (!filter(entry)) continue;
      const tail = this.entries.splice(i);
      const target = tail[0]!;
      for (const e of [...tail].reverse()) {
        this.redoStack.push({ entry: e, afterBundle: structuredClone(currentAfter) });
      }
      return structuredClone(target.beforeBundle);
    }
    return null;
  }

  redo(): ProjectBundle | null {
    const item = this.redoStack.pop();
    if (!item) return null;
    this.entries.push(item.entry);
    return structuredClone(item.afterBundle);
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  previewAt(seq: number): ProjectBundle | null {
    const entry = this.entries.find((e) => e.seq === seq);
    return entry ? structuredClone(entry.afterBundle) : null;
  }

  restoreAt(seq: number, mode: "view" | "destructive"): RestoreAtResult & { preview?: ProjectBundle } {
    const idx = this.entries.findIndex((e) => e.seq === seq);
    if (idx < 0) {
      return { ok: false, revision: "", discarded: [], mode };
    }
    const target = this.entries[idx]!;
    const preview = structuredClone(target.afterBundle);
    const discarded = mode === "destructive" ? this.entries.slice(idx + 1) : [];
    if (mode === "destructive") {
      this.entries = this.entries.slice(0, idx + 1);
      this.redoStack = [];
    }
    return {
      ok: true,
      revision: target.revisionAfter,
      discarded: discarded.map((e) => ({ ...e, beforeBundle: structuredClone(e.beforeBundle), afterBundle: structuredClone(e.afterBundle) })),
      mode,
      preview,
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
      });
      await Deno.writeTextFile(this.persistPath, line + "\n", { append: true });
    } catch {
      // persistence optional
    }
  }
}
