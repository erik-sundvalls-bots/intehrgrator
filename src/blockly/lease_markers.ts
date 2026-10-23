/**
 * Lease markers (S-15) on the desktop canvas: who leases what right now.
 *
 * Each lease outlines one block in the agent's colour (dashed) with a name
 * tag above it: the block whose SLOT_ID is the leased slot or node path, or
 * else its nearest ancestor on the canvas (an unmapped slot is a mouth on its
 * parent block). A subtree lease outlines the subtree's root block, which
 * contains the whole subtree. Markers are view-only (not saved, not in
 * history), separate from the AI author badge (ADR 0014) and the review
 * marker (ADR 0013), and redrawn on every agent poll. They are drawn on one
 * layer above all blocks, so a neighbouring block never hides a name tag.
 */
import type { Block, BlockSvg, WorkspaceSvg } from "blockly/core";
import type { SlotLease } from "../agent/leases.ts";

const MARK_CLASS = "lease-marker";
const NS = "http://www.w3.org/2000/svg";

export interface LeaseMarkerTexts {
  /** Tooltip, e.g. "Leased by {agent} until {time}". */
  title: (lease: SlotLease) => string;
  /** Tag text, e.g. "Bo" or "Bo · subtree". */
  label: (lease: SlotLease) => string;
}

/** The block a lease is drawn on: exact SLOT_ID match, else the deepest ancestor. */
export function leaseTargetBlock(blocks: Block[], key: string): Block | undefined {
  let best: Block | undefined;
  let bestLen = -1;
  for (const block of blocks) {
    const id = slotIdOf(block);
    if (!id) continue;
    if (id === key) return block;
    if (key.startsWith(`${id}/`) && id.length > bestLen) {
      best = block;
      bestLen = id.length;
    }
  }
  return best;
}

function slotIdOf(block: Block): string {
  try {
    return String(block.getFieldValue("SLOT_ID") ?? "");
  } catch {
    return "";
  }
}

/** Colour fallback when the lease has none: stable hue from the agent id. */
export function leaseColor(lease: Pick<SlotLease, "agentId" | "color">): string {
  if (lease.color) return lease.color;
  let hash = 2166136261;
  for (let i = 0; i < lease.agentId.length; i++) {
    hash ^= lease.agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `hsl(${(hash >>> 0) % 360} 65% 45%)`;
}

const LAYER_CLASS = "lease-markers-layer";

export function clearLeaseMarkers(workspace: WorkspaceSvg): void {
  workspace.getParentSvg().querySelector(`.${LAYER_CLASS}`)?.remove();
}

/** Redraw all lease markers for `leases`. Returns how many leases found a block. */
export function renderLeaseMarkers(workspace: WorkspaceSvg, leases: SlotLease[], texts: LeaseMarkerTexts): number {
  clearLeaseMarkers(workspace);
  if (!leases.length) return 0;
  const blocks = workspace.getAllBlocks(false);
  const perBlock = new Map<Block, SlotLease[]>();
  for (const lease of leases) {
    const block = leaseTargetBlock(blocks, lease.slotId);
    if (block) perBlock.set(block, [...(perBlock.get(block) ?? []), lease]);
  }
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", LAYER_CLASS);
  for (const [block, rows] of perBlock) {
    const svgBlock = block as BlockSvg;
    if (!svgBlock.getSvgRoot?.()) continue;
    const { x, y } = svgBlock.getRelativeToSurfaceXY();
    const { width, height } = svgBlock;
    let tagX = 0;
    rows.forEach((lease, i) => {
      const color = leaseColor(lease);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", MARK_CLASS);
      g.setAttribute("data-agent-id", lease.agentId);
      g.setAttribute("data-slot-id", lease.slotId);
      g.setAttribute("transform", `translate(${x},${y})`);
      const pad = 3 + i * 3;
      const frame = document.createElementNS(NS, "rect");
      frame.setAttribute("class", `${MARK_CLASS}-frame`);
      frame.setAttribute("x", String(-pad));
      frame.setAttribute("y", String(-pad));
      frame.setAttribute("width", String(Math.max(0, width) + 2 * pad));
      frame.setAttribute("height", String(Math.max(0, height) + 2 * pad));
      frame.setAttribute("rx", "6");
      frame.setAttribute("stroke", color);
      if (lease.subtree) frame.setAttribute("stroke-width", "3");
      const tag = document.createElementNS(NS, "g");
      tag.setAttribute("class", `${MARK_CLASS}-tag`);
      const text = document.createElementNS(NS, "text");
      text.textContent = `🔒 ${texts.label(lease)}`;
      text.setAttribute("x", "6");
      text.setAttribute("y", "12");
      const approxWidth = 16 + text.textContent.length * 6.4;
      const bg = document.createElementNS(NS, "rect");
      bg.setAttribute("width", String(approxWidth));
      bg.setAttribute("height", "17");
      bg.setAttribute("rx", "4");
      bg.setAttribute("fill", color);
      tag.setAttribute("transform", `translate(${tagX - pad},${-pad - 19})`);
      tagX += approxWidth + 4;
      const tip = document.createElementNS(NS, "title");
      tip.textContent = texts.title(lease);
      tag.append(bg, text, tip);
      g.append(frame, tag);
      layer.append(g);
    });
  }
  // Last child of the block canvas: above every block, moves and zooms with it.
  workspace.getCanvas().append(layer);
  return perBlock.size;
}
