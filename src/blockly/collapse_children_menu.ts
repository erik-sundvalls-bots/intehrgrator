/**
 * Block context menu: expand / collapse children (#194).
 * Touch: a long-press on a block opens the same Blockly context menu.
 */
import type { Block, WorkspaceSvg } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { setChildBlocksCollapsed } from "./skeleton_loader.ts";

export const EXPAND_CHILDREN_MENU_ID = "intehrgrator_expand_children";
export const COLLAPSE_CHILDREN_MENU_ID = "intehrgrator_collapse_children";

const MENU_PATCHED = "__intehrCollapseChildrenMenu";
const LONG_PRESS_MS = 550;

type ContextMenuOption = {
  text?: string;
  enabled?: boolean;
  callback?: () => void;
  weight?: number;
};

type GenerateContextMenuFn = (this: Block) => ContextMenuOption[] | null;

export interface CollapseChildrenLabels {
  expandChildren: () => string;
  collapseChildren: () => string;
}

function hasChildren(block: Block | null | undefined): boolean {
  if (!block) return false;
  return block.getChildren(false).some((child) =>
    !(typeof child.isShadow === "function" && child.isShadow())
  );
}

function contextMenuRegistry(): {
  registry: { getItem: (id: string) => unknown; register: (item: Record<string, unknown>) => void };
  ScopeType: { BLOCK: string };
} | null {
  const candidates = [
    Blockly.ContextMenuRegistry,
    (Blockly as unknown as { default?: { ContextMenuRegistry?: typeof Blockly.ContextMenuRegistry } })
      .default?.ContextMenuRegistry,
  ];
  for (const candidate of candidates) {
    if (candidate?.registry) {
      return candidate as unknown as {
        registry: { getItem: (id: string) => unknown; register: (item: Record<string, unknown>) => void };
        ScopeType: { BLOCK: string };
      };
    }
  }
  return null;
}

export function registerCollapseChildrenMenus(labels: CollapseChildrenLabels): void {
  const ctx = contextMenuRegistry();
  if (!ctx) return;
  if (!ctx.registry.getItem(EXPAND_CHILDREN_MENU_ID)) {
    ctx.registry.register({
      id: EXPAND_CHILDREN_MENU_ID,
      scopeType: ctx.ScopeType?.BLOCK ?? "block",
      weight: 5,
      displayText: () => labels.expandChildren(),
      preconditionFn: (scope: { block?: Block }) =>
        hasChildren(scope.block) ? "enabled" : "hidden",
      callback: (scope: { block?: Block }) => {
        if (scope.block) setChildBlocksCollapsed(scope.block, false);
      },
    });
  }
  if (!ctx.registry.getItem(COLLAPSE_CHILDREN_MENU_ID)) {
    ctx.registry.register({
      id: COLLAPSE_CHILDREN_MENU_ID,
      scopeType: ctx.ScopeType?.BLOCK ?? "block",
      weight: 6,
      displayText: () => labels.collapseChildren(),
      preconditionFn: (scope: { block?: Block }) =>
        hasChildren(scope.block) ? "enabled" : "hidden",
      callback: (scope: { block?: Block }) => {
        if (scope.block) setChildBlocksCollapsed(scope.block, true);
      },
    });
  }
}

export function installCollapseChildrenMenu(
  workspace: WorkspaceSvg,
  labels: CollapseChildrenLabels,
): void {
  registerCollapseChildrenMenus(labels);
  // The probe is created only to reach BlockSvg.prototype. Its create/delete
  // would otherwise sit in Blockly's event queue and later be mirrored onto
  // the minimap, which never received the create ("Can't delete non-existent block").
  const disabled = typeof Blockly.Events.disable === "function";
  if (disabled) Blockly.Events.disable();
  try {
    const probe = workspace.newBlock("text");
    const proto = Object.getPrototypeOf(probe) as
      | (object & { generateContextMenu?: GenerateContextMenuFn; [MENU_PATCHED]?: boolean })
      | null;
    if (proto && typeof proto.generateContextMenu === "function" && !proto[MENU_PATCHED]) {
      const original = proto.generateContextMenu;
      proto.generateContextMenu = function (this: Block) {
        const menu = original.call(this) ?? [];
        if (!hasChildren(this)) return menu;
        const expand = labels.expandChildren();
        const collapse = labels.collapseChildren();
        if (!menu.some((item) => item.text === expand)) {
          menu.push({
            text: expand,
            enabled: true,
            callback: () => setChildBlocksCollapsed(this, false),
            weight: 5,
          });
        }
        if (!menu.some((item) => item.text === collapse)) {
          menu.push({
            text: collapse,
            enabled: true,
            callback: () => setChildBlocksCollapsed(this, true),
            weight: 6,
          });
        }
        return menu;
      };
      proto[MENU_PATCHED] = true;
    }
    probe.dispose(false);
  } finally {
    if (disabled) Blockly.Events.enable();
  }
  installLongPressContextMenu(workspace);
}

/** Long-press (touch / pen) opens the block context menu. */
function installLongPressContextMenu(workspace: WorkspaceSvg): void {
  const canvas = workspace.getCanvas?.();
  if (!canvas || (canvas as Element & { _longPressMenu?: boolean })._longPressMenu) return;
  (canvas as Element & { _longPressMenu?: boolean })._longPressMenu = true;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let blockEl: Element | null = null;
  const clear = () => globalThis.clearTimeout(timer);
  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    blockEl = target.closest(".blocklyDraggable");
    if (!blockEl) return;
    startX = event.clientX;
    startY = event.clientY;
    clear();
    const el = blockEl;
    timer = globalThis.setTimeout(() => {
      el.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: startX,
        clientY: startY,
        button: 2,
      }));
    }, LONG_PRESS_MS);
  });
  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) clear();
  });
  canvas.addEventListener("pointerup", clear);
  canvas.addEventListener("pointercancel", clear);
}
