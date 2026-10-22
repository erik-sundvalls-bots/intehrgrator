/**
 * One undo step for Open template / Example Sets / Load Project / New project.
 * Canvas field edits stay on Blockly's native stack; this event restores a
 * full Project Bundle so a load can be undone without deleting later saves.
 */
import type { Workspace } from "blockly/core";
import type { ProjectBundle } from "../types/mod.ts";
import { Blockly } from "../blockly/blockly_core.ts";

export const DOCUMENT_SWAP_EVENT_TYPE = "intehr_document_swap";

export type DocumentSnapshot = ProjectBundle;

type AbstractEvent = InstanceType<typeof Blockly.Events.Abstract>;

export class DocumentSwapEvent extends Blockly.Events.Abstract {
  override isBlank = false;
  override type = DOCUMENT_SWAP_EVENT_TYPE;
  override recordUndo = true;
  override isUiEvent = false;
  before: DocumentSnapshot;
  after: DocumentSnapshot;
  private readonly restore: (snapshot: DocumentSnapshot) => void;

  constructor(
    workspace: Workspace,
    before: DocumentSnapshot,
    after: DocumentSnapshot,
    restore: (snapshot: DocumentSnapshot) => void,
  ) {
    super();
    this.workspaceId = workspace.id;
    this.before = before;
    this.after = after;
    this.restore = restore;
  }

  override isNull(): boolean {
    return JSON.stringify(this.before) === JSON.stringify(this.after);
  }

  override run(forward: boolean): void {
    this.restore(forward ? this.after : this.before);
  }
}

export function fireDocumentSwap(
  workspace: Workspace,
  before: DocumentSnapshot,
  after: DocumentSnapshot,
  restore: (snapshot: DocumentSnapshot) => void,
  group?: string,
): void {
  const event = new DocumentSwapEvent(workspace, before, after, restore);
  if (event.isNull()) return;
  if (group) event.group = group;
  Blockly.Events.fire(event as AbstractEvent);
}

export function workspaceCanUndo(workspace: Workspace): boolean {
  return (workspace.getUndoStack?.()?.length ?? 0) > 0;
}

export function workspaceCanRedo(workspace: Workspace): boolean {
  return (workspace.getRedoStack?.()?.length ?? 0) > 0;
}
