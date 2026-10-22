/**
 * Revert (sv: Häv) of one history entry as a new, compensating change
 * (ADR 0014). Pure JSON work on project bundles: for every Target value slot
 * the entry changed, put back the slot's canvas blocks from before the entry,
 * unless the slot was changed again later; then it is skipped and reported.
 * The history itself is never rewritten; the caller records the result as a
 * new entry at the end.
 */
import type { MappingSlot, ProjectBundle } from "../types/mod.ts";

export interface RevertSkip {
  slotId: string;
  label?: string;
  reason: "changed-later" | "structure";
}

export interface RevertPlan {
  /** The project after the revert (model still to be re-derived from the canvas). */
  bundle: ProjectBundle;
  /** Slots put back to their state before the entry. */
  reverted: string[];
  skipped: RevertSkip[];
  /** Parts of the entry outside slots and sheets that a revert does not undo. */
  notReverted: string[];
  /** Sheets were put back. */
  sheetsReverted: boolean;
  changed: boolean;
}

interface BlockJson {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson };
  [key: string]: unknown;
}

/** What makes a slot "changed": its expression, review marker and escape hatch. */
function slotFingerprint(slot: MappingSlot | undefined): string {
  if (!slot) return "";
  return JSON.stringify({ e: slot.expression ?? "", r: slot.review ?? null, h: slot.hatch ?? null });
}

function slotsById(bundle: ProjectBundle): Map<string, MappingSlot> {
  return new Map((bundle.mapping.model.slots ?? []).map((s) => [s.slotId, s]));
}

function topBlocks(state: unknown): BlockJson[] {
  const blocks = (state as { blocks?: { blocks?: BlockJson[] } } | null)?.blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

/** Blocks reachable inside `block`'s inputs (not its own `next` chain). */
function* innerBlocks(block: BlockJson): Generator<BlockJson> {
  for (const input of Object.values(block.inputs ?? {})) {
    for (const child of [input.block, input.shadow]) {
      for (let b = child; b; b = b.next?.block) {
        yield b;
        yield* innerBlocks(b);
      }
    }
  }
}

function* allBlocks(state: unknown): Generator<BlockJson> {
  for (const top of topBlocks(state)) {
    for (let b: BlockJson | undefined = top; b; b = b.next?.block) {
      yield b;
      yield* innerBlocks(b);
    }
  }
}

const slotOf = (block: BlockJson): string | undefined =>
  typeof block.fields?.SLOT_ID === "string" ? block.fields.SLOT_ID as string : undefined;

/** The innermost block carrying `slotId` (an ELEMENT and its value share one id). */
function innermostSlotBlock(state: unknown, slotId: string): BlockJson | undefined {
  let found: BlockJson | undefined;
  for (const block of allBlocks(state)) {
    if (slotOf(block) !== slotId) continue;
    if (![...innerBlocks(block)].some((b) => slotOf(b) === slotId)) found = block;
  }
  return found;
}

function holdsOtherSlots(block: BlockJson, slotId: string): boolean {
  for (const b of innerBlocks(block)) {
    const id = slotOf(b);
    if (id && id !== slotId) return true;
  }
  return false;
}

/** Replace `target` in place by `source` (a copy), keeping `target`'s place in its chain. */
function replaceBlock(target: BlockJson, source: BlockJson): void {
  const keep = { next: target.next, x: target.x, y: target.y };
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(source));
  delete target.next;
  if (keep.next) target.next = keep.next;
  if (keep.x !== undefined) target.x = keep.x;
  if (keep.y !== undefined) target.y = keep.y;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planRevert(
  entry: { beforeBundle: ProjectBundle; afterBundle: ProjectBundle },
  current: ProjectBundle,
): RevertPlan {
  const bundle = structuredClone(current);
  const before = slotsById(entry.beforeBundle);
  const after = slotsById(entry.afterBundle);
  const now = slotsById(current);
  const reverted: string[] = [];
  const skipped: RevertSkip[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const slotId of ids) {
    const was = before.get(slotId);
    const became = after.get(slotId);
    if (slotFingerprint(was) === slotFingerprint(became)) continue;
    const label = (became ?? was)?.label;
    if (slotFingerprint(now.get(slotId)) !== slotFingerprint(became)) {
      skipped.push({ slotId, ...(label ? { label } : {}), reason: "changed-later" });
      continue;
    }
    const source = innermostSlotBlock(entry.beforeBundle.mapping.blocklyState, slotId);
    const target = innermostSlotBlock(bundle.mapping.blocklyState, slotId);
    if (!source || !target || holdsOtherSlots(source, slotId) || holdsOtherSlots(target, slotId)) {
      skipped.push({ slotId, ...(label ? { label } : {}), reason: "structure" });
      continue;
    }
    replaceBlock(target, source);
    reverted.push(slotId);
  }

  let sheetsReverted = false;
  if (!same(entry.beforeBundle.mapping.sheets, entry.afterBundle.mapping.sheets)) {
    if (same(current.mapping.sheets, entry.afterBundle.mapping.sheets)) {
      bundle.mapping.sheets = structuredClone(entry.beforeBundle.mapping.sheets);
      sheetsReverted = true;
    } else {
      skipped.push({ slotId: "sheets", reason: "changed-later" });
    }
  }

  const notReverted: string[] = [];
  const b = entry.beforeBundle;
  const a = entry.afterBundle;
  if (!same(b.mapping.model.optionalRm, a.mapping.model.optionalRm)) notReverted.push("optional RM insertions");
  if (!same(b.mapping.model.loops, a.mapping.model.loops)) notReverted.push("repeat loops");
  if (!same(b.target?.filename, a.target?.filename) || !same(b.sourceSchema?.filename, a.sourceSchema?.filename)) {
    notReverted.push("loaded files");
  }
  if (!same(b.examples.map((e) => e.id), a.examples.map((e) => e.id)) || b.activeExampleId !== a.activeExampleId) {
    notReverted.push("example instances");
  }

  return {
    bundle,
    reverted,
    skipped,
    notReverted,
    sheetsReverted,
    changed: reverted.length > 0 || sheetsReverted,
  };
}
