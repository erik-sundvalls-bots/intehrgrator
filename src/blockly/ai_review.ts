/**
 * AI review marker (#249 review, Option B): an AI-suggested mapping keeps its
 * `note` and raw `confidence` (integer percent) in the expression root
 * block's `data`, so it survives save / load / export and can later feed
 * calibration against what the user did (`outcome`: reviewed / edited).
 *
 * While unreviewed, a note or a confidence below the medium band shows a
 * dashed coloured outline, a small `NN%` badge and a block comment. Editing a
 * field inside the block, or *Mark as reviewed*, records the outcome and hides
 * the marker (the data stays).
 */
import type { Block, BlockSvg, WorkspaceSvg } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import type { AiReviewOutcome, MappingSlotReview } from "../types/mod.ts";
import {
  confidenceBand,
  parseAiConfidence,
} from "../core/ai/response_notes.ts";

export const AI_REVIEW_DATA_KEY = "aiReview";
export const AI_MARK_REVIEWED_MENU_ID = "intehrgrator_ai_mark_reviewed";
const BADGE_CLASS = "ai-review-badge";
const MARKER_CLASSES = [
  "ai-review-marker",
  "ai-review--low",
  "ai-review--medium",
  "ai-review--high",
];

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

export function readAiReview(block: Block): MappingSlotReview | undefined {
  const raw = blockData(block)[AI_REVIEW_DATA_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const confidence = parseAiConfidence(r.confidence);
  const note = typeof r.note === "string" && r.note.trim()
    ? r.note.trim()
    : undefined;
  if (confidence === undefined && !note) return undefined;
  const outcome = r.outcome === "reviewed" || r.outcome === "edited"
    ? r.outcome as AiReviewOutcome
    : undefined;
  return {
    ...(confidence !== undefined ? { confidence } : {}),
    ...(note ? { note } : {}),
    ...(outcome ? { outcome } : {}),
    ...(outcome && typeof r.outcomeAt === "string"
      ? { outcomeAt: r.outcomeAt }
      : {}),
  };
}

/** The canvas marker is shown for an unreviewed note or a confidence below the medium band. */
export function isAiReviewActive(
  review: MappingSlotReview | undefined,
): boolean {
  if (!review || review.outcome) return false;
  if (review.note) return true;
  return review.confidence !== undefined &&
    confidenceBand(review.confidence) !== "high";
}

export interface AiReviewLabels {
  markReviewed: () => string;
  /** `{conf}` / `{note}` placeholders. */
  comment: () => string;
  /** `{pct}` placeholder. */
  confidence: () => string;
}

let labels: AiReviewLabels = {
  markReviewed: () => "Mark as reviewed",
  comment: () =>
    "AI suggestion — {conf}{note}\nEdit the block or right-click → Mark as reviewed to clear.",
  confidence: () => "{pct}% confidence",
};

function commentText(review: MappingSlotReview): string {
  const conf = review.confidence !== undefined
    ? labels.confidence().replace("{pct}", String(review.confidence))
    : "";
  const note = review.note ? `${conf ? ": " : ""}${review.note}` : "";
  return labels.comment().replace("{conf}", conf).replace("{note}", note);
}

/** Store (or clear) the review on a block and refresh its marker. */
export function writeAiReview(
  block: Block,
  review: MappingSlotReview | undefined,
): void {
  const previous = readAiReview(block);
  const data = blockData(block);
  if (review) data[AI_REVIEW_DATA_KEY] = review;
  else delete data[AI_REVIEW_DATA_KEY];
  block.data = Object.keys(data).length ? JSON.stringify(data) : null;
  renderAiReviewMarker(block, previous);
}

function setOutcome(block: Block, outcome: AiReviewOutcome): void {
  const review = readAiReview(block);
  if (!review) return;
  writeAiReview(block, {
    ...review,
    outcome,
    outcomeAt: new Date().toISOString(),
  });
}

/** Comment + outline + badge for an active review; removes them otherwise. */
export function renderAiReviewMarker(
  block: Block,
  previous?: MappingSlotReview,
): void {
  const review = readAiReview(block);
  const active = isAiReviewActive(review);
  const ownComment = (r: MappingSlotReview | undefined) =>
    r ? commentText(r) : null;
  const current = block.getCommentText?.() ?? null;
  const ours = current !== null &&
    (current === ownComment(previous) || current === ownComment(review) ||
      current ===
        ownComment(previous ? { ...previous, outcome: undefined } : undefined));
  Blockly.Events.disable();
  try {
    if (active) {
      if (current === null || ours) block.setCommentText(commentText(review!));
    } else if (ours) {
      block.setCommentText(null);
    }
  } finally {
    Blockly.Events.enable();
  }
  const svg = (block as BlockSvg).getSvgRoot?.();
  if (!svg) return;
  svg.classList.remove(...MARKER_CLASSES);
  svg.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
  if (!active) return;
  const band = review!.confidence !== undefined
    ? confidenceBand(review!.confidence)
    : "high";
  svg.classList.add("ai-review-marker", `ai-review--${band}`);
  if (review!.confidence === undefined) return;
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", `${BADGE_CLASS} ${BADGE_CLASS}--${band}`);
  g.setAttribute("transform", "translate(-6,-11)");
  const text = `${review!.confidence}%`;
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("width", String(8 + text.length * 6));
  rect.setAttribute("height", "14");
  rect.setAttribute("rx", "7");
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", String(4 + text.length * 3));
  label.setAttribute("y", "10.5");
  label.setAttribute("text-anchor", "middle");
  label.textContent = text;
  const title = document.createElementNS(ns, "title");
  title.textContent = commentText(review!);
  g.append(rect, label, title);
  svg.append(g);
}

/** Re-apply markers for every block that carries a review (after load / re-render). */
export function refreshAiReviewMarkers(workspace: WorkspaceSvg): void {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.data && readAiReview(block)) renderAiReviewMarker(block);
  }
}

/** Write each slot's model review onto its expression block (model → canvas). */
export function applySlotReviews(
  blocks: Map<string, Block>,
  slots: Array<{ slotId: string; review?: MappingSlotReview }>,
): void {
  for (const slot of slots) {
    const block = blocks.get(slot.slotId);
    if (!block) continue;
    const current = readAiReview(block);
    if (!slot.review && !current) continue;
    if (JSON.stringify(current) === JSON.stringify(slot.review)) {
      renderAiReviewMarker(block);
      continue;
    }
    writeAiReview(block, slot.review);
  }
}

function reviewedAncestor(block: Block | null): Block | null {
  for (let b = block; b; b = b.getParent()) {
    if (isAiReviewActive(readAiReview(b))) return b;
  }
  return null;
}

/**
 * Context menu *Mark as reviewed*, edit → `outcome: "edited"`, and marker
 * refresh after loads. `onChange` persists the canvas (data edits fire no event).
 */
export function installAiReviewMarkers(
  workspace: WorkspaceSvg,
  options: { labels?: AiReviewLabels; onChange: () => void },
): void {
  if (options.labels) labels = options.labels;
  const registry = Blockly.ContextMenuRegistry?.registry;
  if (registry && !registry.getItem(AI_MARK_REVIEWED_MENU_ID)) {
    registry.register(
      {
        id: AI_MARK_REVIEWED_MENU_ID,
        scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
        weight: 4,
        displayText: () => labels.markReviewed(),
        preconditionFn: (scope: { block?: Block }) =>
          reviewedAncestor(scope.block ?? null) ? "enabled" : "hidden",
        callback: (scope: { block?: Block }) => {
          const target = reviewedAncestor(scope.block ?? null);
          if (!target) return;
          setOutcome(target, "reviewed");
          options.onChange();
        },
      } as unknown as Parameters<typeof registry.register>[0],
    );
  }
  workspace.addChangeListener((event) => {
    if (
      event.type === Blockly.Events.FINISHED_LOADING ||
      event.type === Blockly.Events.BLOCK_CREATE
    ) {
      queueMicrotask(() => refreshAiReviewMarkers(workspace));
      return;
    }
    if (event.type !== Blockly.Events.BLOCK_CHANGE) return;
    const change = event as unknown as { element?: string; blockId?: string };
    if (change.element !== "field" || !change.blockId) return;
    const target = reviewedAncestor(workspace.getBlockById(change.blockId));
    if (!target) return;
    setOutcome(target, "edited");
    options.onChange();
  });
}

/** Mark the review on `block` (or its nearest reviewed ancestor) as reviewed. */
export function markAiReviewed(block: Block): boolean {
  const target = reviewedAncestor(block);
  if (!target) return false;
  setOutcome(target, "reviewed");
  return true;
}
