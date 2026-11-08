/**
 * Collapse control for blocks Blockly already lets the user collapse.
 * It sits in the header, immediately left of the cogwheel when that field is
 * visible, and in the same top-right place when it is not. The box is the
 * block's own outline (`width` / `height`). `getHeightWidth()` also spans the
 * following block, which pushed the control off the visible shape.
 *
 * The same glyph is prefixed on the block's Collapse/Expand context-menu item.
 * `setCollapsed` stays the only state change, so undo, redo, and serialization
 * keep Blockly's meaning.
 */
import type { BlockSvg, WorkspaceSvg } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { chromeHostInput, orderHeaderTrailingChrome } from "./mouth_layout.ts";

/** Shown while the block is expanded; activating it collapses. */
export const COLLAPSE_GLYPH_EXPANDED = "\u25BE";
/** Shown while the block is collapsed; activating it expands. */
export const COLLAPSE_GLYPH_COLLAPSED = "\u25B8";

const SVG_NS = "http://www.w3.org/2000/svg";
const GLYPH_CLASS = "block-collapse-glyph";
const PATCHED = "__intehrCollapseGlyph";
const MENU_PATCHED = "__intehrCollapseGlyphMenu";
const PAD_FIELD = "COLLAPSE_PAD";
/** Compact button, small enough to sit beside a 16px cogwheel. */
export const COLLAPSE_BUTTON_PX = 14;

export interface GlyphBox {
  x: number;
  y: number;
  size: number;
}

export interface CogAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rendered outline of this block. `getHeightWidth().width` is
 * `max(this.width, nextBlock.width)`, so a wider neighbour must not be used.
 */
export function visibleBlockSize(block: {
  width?: number;
  height?: number;
  getHeightWidth?: () => { width: number; height: number };
}): { width: number; height: number } {
  const ownWidth = Number(block.width);
  const ownHeight = Number(block.height);
  if (ownWidth > 0 && ownHeight > 0) return { width: ownWidth, height: ownHeight };
  const fallback = block.getHeightWidth?.();
  return {
    width: ownWidth > 0 ? ownWidth : Math.max(0, fallback?.width ?? 40),
    height: ownHeight > 0 ? ownHeight : Math.max(0, fallback?.height ?? 24),
  };
}

/**
 * Button inside the visible outline. With a cog, it is immediately to the
 * cog's left and vertically aligned with it. Without one, it is inset at the
 * top-right of the outline (the header edge, not a following block).
 */
export function collapseButtonBox(args: {
  blockWidth: number;
  blockHeight: number;
  cog?: CogAnchor | null;
}): GlyphBox {
  const size = COLLAPSE_BUTTON_PX;
  const pad = 2;
  const width = Math.max(size + pad * 2, args.blockWidth);
  const height = Math.max(size + pad * 2, args.blockHeight);
  const cog = args.cog;
  const hasCog = Boolean(cog && cog.width > 0 && cog.height > 0);
  let x = width - size - pad;
  let y = pad;
  if (cog && hasCog) {
    x = cog.x - size - 3;
    y = cog.y + (cog.height - size) / 2;
  }
  x = clamp(x, pad, width - size - pad);
  y = clamp(y, pad, height - size - pad);
  return { x, y, size };
}

export function glyphOverlapsCog(glyph: GlyphBox, cog: CogAnchor): boolean {
  return glyph.x < cog.x + cog.width &&
    glyph.x + glyph.size > cog.x &&
    glyph.y < cog.y + cog.height &&
    glyph.y + glyph.size > cog.y;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

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
  ensureCollapsePad(block);
  const size = visibleBlockSize(block);
  const box = collapseButtonBox({
    blockWidth: size.width,
    blockHeight: size.height,
    cog: collapsed ? null : (padAnchor(block) ?? rightHeaderIcon(block)),
  });
  const plate = glyph.querySelector("rect");
  plate?.setAttribute("width", String(box.size));
  plate?.setAttribute("height", String(box.size));
  if (mark) {
    mark.setAttribute("x", String(box.size / 2));
    mark.setAttribute("y", String(box.size - 3));
  }
  glyph.setAttribute("transform", `translate(${box.x}, ${box.y})`);
}

/** Invisible header slot immediately left of the cogwheel, so the button has room. */
function ensureCollapsePad(block: CollapseBlock): void {
  try {
    if (typeof block.getField !== "function" || block.getField(PAD_FIELD)) return;
    if (typeof block.getInput !== "function") return;
    const host = chromeHostInput(block);
    if (!host || typeof host.appendField !== "function") return;
    host.appendField(new FieldCollapsePad(), PAD_FIELD);
    orderHeaderTrailingChrome(block);
  } catch {
    // A render that cannot grow the header keeps the outline fallback.
  }
}

class FieldCollapsePad extends Blockly.Field {
  constructor() {
    super("");
    this.SERIALIZABLE = false;
    this.EDITABLE = false;
    if (this.size_) {
      this.size_.width = COLLAPSE_BUTTON_PX + 4;
      this.size_.height = COLLAPSE_BUTTON_PX;
    }
  }

  override getText(): string {
    return "";
  }
}

function padAnchor(block: CollapseBlock): CogAnchor | null {
  const pad = typeof block.getField === "function" ? block.getField(PAD_FIELD) : null;
  return iconBox(block, pad?.getSvgRoot?.() ?? null);
}

/** Rightmost header image on this block (the cogwheel, when it has one). */
function rightHeaderIcon(block: CollapseBlock): CogAnchor | null {
  const blockSvg = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
  if (!blockSvg) return null;
  let best: CogAnchor | null = null;
  for (const image of blockSvg.querySelectorAll("image")) {
    if (image.closest(".block-collapse-glyph")) continue;
    if (image.closest("foreignObject")) continue;
    if (image.closest("g.blocklyDraggable") !== blockSvg) continue;
    const box = iconBox(block, image);
    if (!box || box.y > 32) continue;
    if (!best || box.x > best.x) best = box;
  }
  return best;
}

function iconBox(block: CollapseBlock, node: Element | null): CogAnchor | null {
  const blockSvg = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
  if (!node || !blockSvg || typeof node.getBoundingClientRect !== "function") return null;
  const path = blockSvg.querySelector(":scope > path.blocklyPath") ?? blockSvg;
  if (typeof path.getBoundingClientRect !== "function") return null;
  const origin = path.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  if (origin.width <= 0 || box.width < 4 || box.height < 4) return null;
  const scale = Number((block.workspace as { scale?: number } | undefined)?.scale ?? 1) || 1;
  return {
    x: (box.left - origin.left) / scale,
    y: (box.top - origin.top) / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
}

function createGlyph(block: CollapseBlock): SVGGElement {
  const glyph = document.createElementNS(SVG_NS, "g");
  glyph.setAttribute("class", GLYPH_CLASS);
  glyph.setAttribute("role", "button");
  glyph.setAttribute("tabindex", "0");
  const plate = document.createElementNS(SVG_NS, "rect");
  plate.setAttribute("class", "block-collapse-glyph-plate");
  plate.setAttribute("rx", "3");
  plate.setAttribute("ry", "3");
  plate.setAttribute("width", String(COLLAPSE_BUTTON_PX));
  plate.setAttribute("height", String(COLLAPSE_BUTTON_PX));
  glyph.appendChild(plate);
  const mark = document.createElementNS(SVG_NS, "text");
  mark.setAttribute("class", "block-collapse-glyph-mark");
  mark.setAttribute("aria-hidden", "true");
  mark.setAttribute("text-anchor", "middle");
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
