/**
 * AI author marker (ADR 0014): a mapping block written by the AI chat or an
 * MCP agent carries `{ by, origin, at }` in its `data` (so it survives save,
 * load and export) and shows a small "AI" badge until a person changes that
 * slot. Separate from the review / confidence marker (`ai_review.ts`).
 */
import type { Block, BlockSvg, WorkspaceSvg } from "blockly/core";
import { Blockly } from "./blockly_core.ts";

export const AI_AUTHOR_DATA_KEY = "aiAuthor";
const BADGE_CLASS = "ai-author-badge";

export interface AiAuthorMark {
  /** Display name, e.g. "AI chat (qwen3)" or "MCP: cursor". */
  by: string;
  origin: "ai-chat" | "mcp";
  at: string;
}

function blockData(block: Block): Record<string, unknown> {
  if (!block.data) return {};
  try {
    const parsed = JSON.parse(block.data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function readAiAuthor(block: Block): AiAuthorMark | undefined {
  const raw = blockData(block)[AI_AUTHOR_DATA_KEY] as
    | Partial<AiAuthorMark>
    | undefined;
  if (!raw || typeof raw.by !== "string") return undefined;
  return {
    by: raw.by,
    origin: raw.origin === "mcp" ? "mcp" : "ai-chat",
    at: String(raw.at ?? ""),
  };
}

/** Set (or with `undefined` clear) the mark and redraw the badge. */
export function writeAiAuthor(
  block: Block,
  mark: AiAuthorMark | undefined,
  title?: (by: string) => string,
): void {
  const data = blockData(block);
  if (mark) data[AI_AUTHOR_DATA_KEY] = mark;
  else delete data[AI_AUTHOR_DATA_KEY];
  block.data = Object.keys(data).length ? JSON.stringify(data) : null;
  renderAiAuthorMarker(block, title);
}

export function renderAiAuthorMarker(
  block: Block,
  title: (by: string) => string = (by) => by,
): void {
  const svg = (block as BlockSvg).getSvgRoot?.();
  if (!svg) return;
  svg.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
  svg.classList.remove("ai-author-marker");
  const mark = readAiAuthor(block);
  if (!mark) return;
  svg.classList.add("ai-author-marker");
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", BADGE_CLASS);
  g.setAttribute("transform", "translate(-8,6)");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("width", "16");
  rect.setAttribute("height", "12");
  rect.setAttribute("rx", "3");
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "8");
  label.setAttribute("y", "9");
  label.setAttribute("text-anchor", "middle");
  label.textContent = "AI";
  const tip = document.createElementNS(ns, "title");
  tip.textContent = title(mark.by);
  g.append(rect, label, tip);
  svg.append(g);
}

export function refreshAiAuthorMarkers(
  workspace: WorkspaceSvg,
  title?: (by: string) => string,
): void {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.data && readAiAuthor(block)) renderAiAuthorMarker(block, title);
  }
}

/** Redraw badges after loads and block creation (undo, pulled bundles). */
export function installAiAuthorMarkers(
  workspace: WorkspaceSvg,
  title?: (by: string) => string,
): void {
  workspace.addChangeListener((event) => {
    if (
      event.type === Blockly.Events.FINISHED_LOADING ||
      event.type === Blockly.Events.BLOCK_CREATE
    ) {
      queueMicrotask(() => refreshAiAuthorMarkers(workspace, title));
    }
  });
}

/** Slot id → fingerprint of what a person or agent can change (expression, hatch). */
export function slotFingerprints(
  slots: Array<{ slotId: string; expression?: string; hatch?: unknown }>,
): Map<string, string> {
  return new Map(
    slots.map((
      s,
    ) => [
      s.slotId,
      `${s.expression ?? ""}|${JSON.stringify(s.hatch ?? null)}`,
    ]),
  );
}

/** Slots whose fingerprint differs between `before` and `after`. */
export function changedSlots(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const ids = new Set([...before.keys(), ...after.keys()]);
  // A slot missing on one side counts as an empty slot.
  const empty = "|null";
  return [...ids].filter((id) => (before.get(id) ?? empty) !== (after.get(id) ?? empty));
}
