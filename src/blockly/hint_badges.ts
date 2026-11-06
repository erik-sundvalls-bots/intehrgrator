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
  workspace.getCanvas()?.querySelector(`.${LAYER_CLASS}`)?.remove();
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

export function renderHintBadges(
  workspace: WorkspaceSvg,
  hints: HintBadge[],
  onClick: (slotId: string) => void,
): void {
  clearHintBadges(workspace);
  const active = hints.filter((hint) => hint.slotId);
  if (!active.length) return;
  const blocks = workspace.getAllBlocks(false) as BlockSvg[];
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", LAYER_CLASS);
  for (const hint of active) {
    const block = badgeBlock(blocks, hint.slotId);
    if (!block?.getSvgRoot?.()) continue;
    const { x, y } = block.getRelativeToSurfaceXY();
    const width = block.width || 0;
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "hint-badge");
    g.setAttribute("data-slot-id", hint.slotId);
    g.setAttribute("transform", `translate(${x + Math.max(width - 4, 12)},${y + 4})`);
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
  }
  workspace.getCanvas().append(layer);
}
