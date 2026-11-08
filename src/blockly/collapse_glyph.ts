/**
 * Upper-right collapse control for blocks Blockly already lets the user collapse.
 * The same glyph is prefixed on the block's Collapse/Expand context-menu item.
 * `setCollapsed` stays the only state change, so undo, redo, and serialization
 * keep Blockly's meaning.
 */
import type { BlockSvg, WorkspaceSvg } from "blockly/core";
import { Blockly } from "./blockly_core.ts";

/** Shown while the block is expanded; activating it collapses. */
export const COLLAPSE_GLYPH_EXPANDED = "\u25BE";
/** Shown while the block is collapsed; activating it expands. */
export const COLLAPSE_GLYPH_COLLAPSED = "\u25B8";

const SVG_NS = "http://www.w3.org/2000/svg";
const GLYPH_CLASS = "block-collapse-glyph";
const PATCHED = "__intehrCollapseGlyph";
const MENU_PATCHED = "__intehrCollapseGlyphMenu";

type CollapseBlock = BlockSvg & { collapseLocked?: boolean };

export function collapseGlyph(collapsed: boolean): string {
  return collapsed ? COLLAPSE_GLYPH_COLLAPSED : COLLAPSE_GLYPH_EXPANDED;
}

/** Menu label with the same glyph the block corner shows for this state. */
export function collapseMenuText(collapsed: boolean, label: string): string {
  const glyph = collapseGlyph(collapsed);
  const text = label.trim();
  if (text.startsWith(`${glyph} `)) return text;
  return `${glyph} ${text}`;
}

/**
 * Same gate as Blockly's "Collapse Block" menu item: a movable block on a
 * workspace that allows collapse, and not a root we force to stay expanded.
 */
export function blockOffersCollapse(block: {
  isInFlyout?: boolean;
  collapseLocked?: boolean;
  isMovable?: () => boolean;
  isInsertionMarker?: () => boolean;
  workspace?: { options?: { collapse?: boolean } };
} | null | undefined): boolean {
  if (!block || block.isInFlyout || block.collapseLocked) return false;
  if (!block.workspace?.options?.collapse) return false;
  if (typeof block.isMovable === "function" && !block.isMovable()) return false;
  if (typeof block.isInsertionMarker === "function" && block.isInsertionMarker()) return false;
  return true;
}

function actionLabel(collapsed: boolean): string {
  const msg = (Blockly.Msg ?? {}) as { EXPAND_BLOCK?: string; COLLAPSE_BLOCK?: string };
  if (collapsed) return msg.EXPAND_BLOCK || "Expand Block";
  return msg.COLLAPSE_BLOCK || "Collapse Block";
}

export function syncCollapseGlyph(block: CollapseBlock): void {
  const root = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
  if (!root) return;
  const existing = root.querySelector(`:scope > .${GLYPH_CLASS}`) as SVGGElement | null;
  if (!blockOffersCollapse(block)) {
    existing?.remove();
    return;
  }
  const glyph = existing ?? createGlyph(block);
  if (!existing) root.appendChild(glyph);
  const collapsed = Boolean(block.isCollapsed?.());
  const mark = glyph.querySelector("text");
  if (mark) mark.textContent = collapseGlyph(collapsed);
  const label = actionLabel(collapsed);
  glyph.setAttribute("aria-label", label);
  glyph.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const title = glyph.querySelector("title");
  if (title) title.textContent = label;
  const width = block.getHeightWidth?.().width ?? 40;
  const cog = typeof block.getField === "function" && block.getField("MUTATOR_COG");
  const inset = cog ? 32 : 14;
  glyph.setAttribute("transform", `translate(${Math.max(4, width - inset)}, 12)`);
}

function createGlyph(block: CollapseBlock): SVGGElement {
  const glyph = document.createElementNS(SVG_NS, "g");
  glyph.setAttribute("class", GLYPH_CLASS);
  glyph.setAttribute("role", "button");
  glyph.setAttribute("tabindex", "0");
  const mark = document.createElementNS(SVG_NS, "text");
  mark.setAttribute("class", "block-collapse-glyph-mark");
  mark.setAttribute("aria-hidden", "true");
  glyph.appendChild(mark);
  const title = document.createElementNS(SVG_NS, "title");
  glyph.appendChild(title);
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const toggle = (event: Event) => {
    stop(event);
    if (typeof block.setCollapsed !== "function" || typeof block.isCollapsed !== "function") return;
    block.setCollapsed(!block.isCollapsed());
  };
  glyph.addEventListener("pointerdown", stop);
  glyph.addEventListener("mousedown", stop);
  glyph.addEventListener("click", toggle);
  glyph.addEventListener("keydown", (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "Enter" && key !== " ") return;
    toggle(event);
  });
  return glyph;
}

export function installCollapseGlyph(workspace: WorkspaceSvg): void {
  patchCollapseMenu();
  patchBlockRender(workspace);
  refreshCollapseGlyphs(workspace);
  if (typeof workspace.addChangeListener === "function") {
    workspace.addChangeListener(() => refreshCollapseGlyphs(workspace));
  }
}

export function refreshCollapseGlyphs(workspace: WorkspaceSvg): void {
  const blocks = typeof workspace.getAllBlocks === "function" ? workspace.getAllBlocks(false) : [];
  for (const block of blocks) syncCollapseGlyph(block as CollapseBlock);
}

function patchCollapseMenu(): void {
  const registry = Blockly.ContextMenuRegistry?.registry as {
    getItem?: (id: string) => {
      displayText?: (scope: { block?: { isCollapsed?: () => boolean } }) => string;
      [MENU_PATCHED]?: boolean;
    } | null;
  } | undefined;
  const item = registry?.getItem?.("blockCollapseExpand");
  if (!item || item[MENU_PATCHED] || typeof item.displayText !== "function") return;
  const original = item.displayText;
  item.displayText = (scope) => {
    const text = original(scope);
    return collapseMenuText(Boolean(scope.block?.isCollapsed?.()), text);
  };
  item[MENU_PATCHED] = true;
}

function patchBlockRender(workspace: WorkspaceSvg): void {
  const disabled = typeof Blockly.Events.disable === "function";
  if (disabled) Blockly.Events.disable();
  try {
    const probe = workspace.newBlock("text");
    const proto = Object.getPrototypeOf(probe) as {
      render?: (...args: unknown[]) => unknown;
      [PATCHED]?: boolean;
    } | null;
    if (proto && typeof proto.render === "function" && !proto[PATCHED]) {
      const original = proto.render;
      proto.render = function (this: CollapseBlock, ...args: unknown[]) {
        const rendered = original.apply(this, args);
        syncCollapseGlyph(this);
        return rendered;
      };
      proto[PATCHED] = true;
    }
    probe.dispose(false);
  } finally {
    if (disabled) Blockly.Events.enable();
  }
}
