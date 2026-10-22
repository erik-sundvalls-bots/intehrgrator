import type { Workspace } from "blockly/core";
import { Blockly } from "./blockly_core.ts";

let afterEventsEnabled: (() => void) | null = null;

/** Register a hook (the minimap) to run when bulk event-suppressed edits finish. */
export function setAfterBlocklyEventsEnabled(handler: (() => void) | null): void {
  afterEventsEnabled = handler;
}

/** Copy block state from one workspace onto another (replaces destination). */
export function copyWorkspaceState(from: Workspace, to: Workspace): void {
  const state = Blockly.serialization.workspaces.save(from);
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(state, to);
  } finally {
    Blockly.Events.enable();
  }
}

/**
 * Run a bulk canvas mutation without firing Blockly events, then notify
 * listeners (minimap) once events are fully re-enabled.
 */
export function runWithoutBlocklyEvents(fn: () => void): void {
  Blockly.Events.disable();
  try {
    fn();
  } finally {
    Blockly.Events.enable();
    if (Blockly.Events.isEnabled()) {
      afterEventsEnabled?.();
    }
  }
}

/**
 * Treat `fn` as one undo step. Joins an existing Blockly event group
 * (mutator compose, drop) instead of nesting a second group id.
 */
export function withBlocklyUndoGroup(fn: () => void): void {
  const existing = typeof Blockly.Events.getGroup === "function"
    ? Blockly.Events.getGroup()
    : "";
  const started = !existing;
  if (started && typeof Blockly.Events.setGroup === "function") {
    Blockly.Events.setGroup(true);
  }
  try {
    fn();
  } finally {
    if (started && typeof Blockly.Events.setGroup === "function") {
      Blockly.Events.setGroup(false);
    }
  }
}

export const CANVAS_SWAP_EVENT_TYPE = "intehr_canvas_swap";

type AbstractEvent = InstanceType<typeof Blockly.Events.Abstract>;

let afterCanvasSwapRun: ((workspace: Workspace) => void) | null = null;

/** Called after undo/redo loads a canvas snapshot (not on the initial fire). */
export function setAfterCanvasSwapRun(
  handler: ((workspace: Workspace) => void) | null,
): void {
  afterCanvasSwapRun = handler;
}

/** One undo step that replaces the whole canvas JSON (Click-to-Map, AI import). */
export class CanvasSwapEvent extends Blockly.Events.Abstract {
  override isBlank = false;
  override type = CANVAS_SWAP_EVENT_TYPE;
  override recordUndo = true;
  override isUiEvent = false;
  before: unknown;
  after: unknown;

  constructor(workspace: Workspace, before: unknown, after: unknown) {
    super();
    this.workspaceId = workspace.id;
    this.before = before;
    this.after = after;
  }

  override isNull(): boolean {
    return JSON.stringify(this.before) === JSON.stringify(this.after);
  }

  override run(forward: boolean): void {
    const ws = this.getEventWorkspace_();
    const state = forward ? this.after : this.before;
    runWithoutBlocklyEvents(() => {
      Blockly.serialization.workspaces.load(state as Record<string, unknown>, ws);
    });
    afterCanvasSwapRun?.(ws);
  }
}

/**
 * Apply a bulk canvas mutation as a single undoable workspace snapshot.
 * Snapshots sharing `group` (one AI chat turn) undo and redo together.
 */
export function replaceCanvasUndoable(workspace: Workspace, apply: () => void, group?: string): void {
  const before = structuredClone(Blockly.serialization.workspaces.save(workspace));
  apply();
  const after = structuredClone(Blockly.serialization.workspaces.save(workspace));
  const event = new CanvasSwapEvent(workspace, before, after);
  if (event.isNull()) return;
  if (group) event.group = group;
  Blockly.Events.fire(event as AbstractEvent);
}
