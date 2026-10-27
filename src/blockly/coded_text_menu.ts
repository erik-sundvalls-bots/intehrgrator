/**
 * Block context menu on a DV_TEXT value shell: map it as DV_CODED_TEXT (code +
 * terminology) or back to plain DV_TEXT (#274). Only on slots whose template
 * type is DV_TEXT; a template DV_CODED_TEXT stays coded.
 */
import type { Block } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { switchTextShellRmType } from "./blocks/rm_blocks.ts";
import {
  replaceCanvasUndoable,
  runWithoutBlocklyEvents,
} from "./blockly_events.ts";

export const USE_CODED_TEXT_MENU_ID = "intehrgrator_use_coded_text";
export const USE_PLAIN_TEXT_MENU_ID = "intehrgrator_use_plain_text";

export interface CodedTextMenuOptions {
  labels: { useCodedText: () => string; usePlainText: () => string };
  /** True when the slot's template type is DV_TEXT. */
  isTextSlot: (slotId: string) => boolean;
  /** Persist the canvas (one undoable history step). */
  onChange: () => void;
}

function textShell(
  block: Block | undefined,
  isTextSlot: (slotId: string) => boolean,
): Block | null {
  for (let b = block ?? null; b; b = b.getParent()) {
    const rm = b.getFieldValue("RM_TYPE");
    if (rm === "DV_TEXT" || rm === "DV_CODED_TEXT") {
      const slotId = String(b.getFieldValue("SLOT_ID") ?? "");
      return slotId && isTextSlot(slotId) ? b : null;
    }
  }
  return null;
}

export function installCodedTextMenu(options: CodedTextMenuOptions): void {
  const registry = Blockly.ContextMenuRegistry?.registry;
  if (!registry) return;
  const item = (
    id: string,
    to: "DV_TEXT" | "DV_CODED_TEXT",
    label: () => string,
    weight: number,
  ) => {
    if (registry.getItem(id)) registry.unregister(id);
    const from = to === "DV_CODED_TEXT" ? "DV_TEXT" : "DV_CODED_TEXT";
    registry.register(
      {
        id,
        scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
        weight,
        displayText: label,
        preconditionFn: (scope: { block?: Block }) =>
          textShell(scope.block, options.isTextSlot)?.getFieldValue(
              "RM_TYPE",
            ) === from
            ? "enabled"
            : "hidden",
        callback: (scope: { block?: Block }) => {
          const shell = textShell(scope.block, options.isTextSlot);
          if (!shell) return;
          // One undo step: a canvas snapshot, like Click-to-Map.
          replaceCanvasUndoable(
            shell.workspace,
            () =>
              runWithoutBlocklyEvents(() => {
                switchTextShellRmType(shell.workspace, shell, to);
              }),
          );
          options.onChange();
        },
      } as unknown as Parameters<typeof registry.register>[0],
    );
  };
  item(USE_CODED_TEXT_MENU_ID, "DV_CODED_TEXT", options.labels.useCodedText, 7);
  item(USE_PLAIN_TEXT_MENU_ID, "DV_TEXT", options.labels.usePlainText, 7);
}
