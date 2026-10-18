/**
 * Notes / Questions box for an AI answer (#249 review, Option C): shared by
 * the AI chat log and the Import AI suggestions dialog.
 */
import {
  type AiResponseNotes,
  confidenceBand,
} from "../core/ai/response_notes.ts";
import { detectLocale } from "../blockly/i18n/locale.ts";
import { chrome } from "./chrome_i18n.ts";

function ui() {
  return chrome(detectLocale());
}

export interface AiNotesViewOptions {
  /** Short human label for a slot id (e.g. the last steps of its path label). */
  describeSlot?: (slotId: string) => string | undefined;
  /** Adds an **Answer** button per question. */
  onAnswer?: (question: string, index: number) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Last path step of a slot id when no better label is known. */
export function fallbackSlotLabel(slotId: string): string {
  const steps = slotId.split("/").filter((s) =>
    s && s !== "value" && !/^DV_[A-Z_]+$/.test(s)
  );
  return steps.slice(-2).join("/") || slotId;
}

/** `73%` pill coloured by {@link confidenceBand}. */
export function confidenceBadge(pct: number): HTMLSpanElement {
  const badge = el(
    "span",
    `ai-confidence-badge ai-confidence-badge--${confidenceBand(pct)}`,
    `${pct}%`,
  );
  badge.title = ui().aiConfidenceTitle.replace("{pct}", String(pct));
  return badge;
}

export function renderAiNotes(
  notes: AiResponseNotes,
  options: AiNotesViewOptions = {},
): HTMLElement | null {
  if (
    !notes.notes.length && !notes.questions.length &&
    !notes.suggestionNotes.length
  ) return null;
  const box = el("div", "ai-notes");
  if (notes.notes.length || notes.suggestionNotes.length) {
    const section = el("section", "ai-notes-notes");
    section.append(el("h4", "ai-notes-heading", ui().aiNotesHeading));
    if (notes.notes.length) {
      const list = el("ul", "ai-notes-list");
      for (const item of notes.notes) {
        list.append(el("li", "ai-notes-item", item));
      }
      section.append(list);
    }
    if (notes.suggestionNotes.length) {
      const list = el("ul", "ai-notes-list ai-notes-slot-list");
      list.setAttribute("aria-label", ui().aiSuggestionNotes);
      for (const row of notes.suggestionNotes) {
        const li = el("li", "ai-notes-item ai-notes-slot-note");
        if (row.slotId) {
          const label = options.describeSlot?.(row.slotId) ??
            fallbackSlotLabel(row.slotId);
          const code = el("code", "ai-notes-slot", label);
          code.title = row.slotId;
          li.append(code);
          if (row.confidence !== undefined) {
            li.append(" ", confidenceBadge(row.confidence));
          }
          const text = `${row.kind === "loop" ? "(loop) " : ""}${row.note}`;
          if (text) li.append(document.createTextNode(` — ${text}`));
        } else {
          if (row.confidence !== undefined) {
            li.append(confidenceBadge(row.confidence), " ");
          }
          li.append(row.note);
        }
        list.append(li);
      }
      section.append(list);
    }
    box.append(section);
  }
  if (notes.questions.length) {
    const section = el("section", "ai-notes-questions");
    section.append(el("h4", "ai-notes-heading", ui().aiQuestionsHeading));
    const list = el("ol", "ai-notes-list");
    notes.questions.forEach((question, index) => {
      const li = el("li", "ai-notes-item ai-notes-question");
      li.append(el("span", "ai-notes-question-text", question));
      if (options.onAnswer) {
        const btn = el("button", "ai-notes-answer", ui().aiAnswerQuestion);
        btn.type = "button";
        btn.addEventListener("click", () => options.onAnswer!(question, index));
        li.append(btn);
      }
      list.append(li);
    });
    section.append(list);
    box.append(section);
  }
  return box;
}

/** Chat input text for answering a question: the question quoted, then the caret. */
export function answerQuote(question: string, index: number): string {
  return `> Q${index + 1}: ${question}\n`;
}
