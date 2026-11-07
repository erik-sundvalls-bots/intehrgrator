/**
 * Canvas badges for value-set hints. Not blocks, not saved.
 * Clicking one selects the slot's block and asks the workbench to open Hints.
 */
import type { BlockSvg, WorkspaceSvg } from "blockly/core";

const LAYER_CLASS = "hint-badges-layer";
const NS = "http://www.w3.org/2000/svg";

export interface HintBadge {
  slotId: string;
  label: string;
}

export function clearHintBadges(workspace: WorkspaceSvg): void {
  workspace.getCanvas()?.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) =>
    layer.remove()
  );
}

function slotIdOf(block: BlockSvg): string {
  try {
    return String(block.getFieldValue("SLOT_ID") ?? "");
  } catch {
    return "";
  }
}

/** Prefer the ELEMENT that owns the value slot over a nested shell with the same id. */
function badgeBlock(blocks: BlockSvg[], slotId: string): BlockSvg | undefined {
  const matches = blocks.filter((block) => slotIdOf(block) === slotId);
  return matches.find((block) => block.type === "element") ?? matches[0];
}

/** Own path boxes only: the helped subtree, never its following siblings. */
function subtreeBounds(
  root: BlockSvg,
): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const visit = (block: BlockSvg, includeNext: boolean) => {
    if (block.getSvgRoot()?.style.display === "none") return;
    const { x, y } = block.getRelativeToSurfaceXY();
    const box = (block.pathObject.svgPath as SVGGraphicsElement).getBBox();
    left = Math.min(left, x + box.x);
    top = Math.min(top, y + box.y);
    right = Math.max(right, x + box.x + box.width);
    bottom = Math.max(bottom, y + box.y + box.height);
    if (!block.isCollapsed()) {
      for (const input of block.inputList) {
        const child = input.connection?.targetBlock() as BlockSvg | null;
        if (child) visit(child, true);
      }
    }
    const next = includeNext ? block.getNextBlock() : null;
    if (next) visit(next, true);
  };
  visit(root, false);
  return { left, top, right, bottom };
}

export function renderHintBadges(
  workspace: WorkspaceSvg,
  hints: HintBadge[],
  onClick: (slotId: string) => void,
): void {
  clearHintBadges(workspace);
  const active = hints.filter((hint) => hint.slotId);
  if (!active.length) return;
  const blocks = workspace.getAllBlocks(false) as BlockSvg[];
  for (const hint of active) {
    const block = badgeBlock(blocks, hint.slotId);
    if (!block?.getSvgRoot?.()) continue;
    const bounds = subtreeBounds(block);
    if (!Object.values(bounds).every(Number.isFinite)) continue;
    const origin = block.getRelativeToSurfaceXY();
    // Attach to the helped block so the outline/badge follow a drag immediately.
    const layer = document.createElementNS(NS, "g");
    layer.setAttribute("class", LAYER_CLASS);
    layer.setAttribute("transform", `translate(${-origin.x},${-origin.y})`);
    layer.setAttribute("pointer-events", "none");
    const outline = document.createElementNS(NS, "rect");
    outline.setAttribute("class", "hint-subtree-outline");
    outline.setAttribute("data-slot-id", hint.slotId);
    outline.setAttribute("x", String(bounds.left - 5));
    outline.setAttribute("y", String(bounds.top - 5));
    outline.setAttribute("width", String(bounds.right - bounds.left + 10));
    outline.setAttribute("height", String(bounds.bottom - bounds.top + 10));
    outline.setAttribute("rx", "6");
    layer.append(outline);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "hint-badge");
    g.setAttribute("pointer-events", "all");
    g.setAttribute("data-slot-id", hint.slotId);
    g.setAttribute(
      "transform",
      `translate(${bounds.right - 12},${bounds.top + 12})`,
    );
    const disc = document.createElementNS(NS, "circle");
    disc.setAttribute("r", "9");
    disc.setAttribute("cx", "0");
    disc.setAttribute("cy", "0");
    const text = document.createElementNS(NS, "text");
    text.textContent = "💡";
    text.setAttribute("x", "0");
    text.setAttribute("y", "4");
    text.setAttribute("text-anchor", "middle");
    const tip = document.createElementNS(NS, "title");
    tip.textContent = hint.label;
    g.append(disc, text, tip);
    g.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(hint.slotId);
    });
    layer.append(g);
    block.getSvgRoot().append(layer);
  }
}
