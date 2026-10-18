/**
 * Option C (#249 review): an AI answer may carry brief `### Notes` and
 * `### Questions` sections in prose OUTSIDE the `intehrgrator-suggestions`
 * fence. This module states that convention for prompts and pulls the
 * sections, the remaining prose, and per-suggestion `note` fields out of a
 * pasted or returned answer.
 */

/** Prompt text (keep short: it rides on every prompt that asks for JSON). */
export const NOTES_CONVENTION =
  "Notes are for risks only (ambiguous source, unit/coding mismatch, lossy conversion, guessed path), never routine confirmations: per-suggestion `note`, and brief `### Notes` / `### Questions` (numbered, with suggested choices) outside the JSON fence (or top-level `notes[]` / `questions[]`); omit when empty. Per-suggestion `confidence`: integer 0–100 = your estimated % chance the mapping is correct; include it only when below 90, or on every suggestion if the user asks.";

/**
 * Confidence colour bands (percent). Below `low` → low (red), below `medium`
 * → medium (amber), otherwise high (no canvas marker unless a note exists).
 */
export const CONFIDENCE_BANDS = { low: 50, medium: 80 } as const;

export type ConfidenceBand = "low" | "medium" | "high";

export function confidenceBand(pct: number): ConfidenceBand {
  if (pct < CONFIDENCE_BANDS.low) return "low";
  if (pct < CONFIDENCE_BANDS.medium) return "medium";
  return "high";
}

export interface SuggestionNote {
  /** `suggestions[].slotId`, or `loops[].attachSlotId` for loop notes. */
  slotId?: string;
  kind: "suggestion" | "loop";
  /** May be empty when the row only carries a confidence. */
  note: string;
  /** Integer percent 0–100 (valid values only). */
  confidence?: number;
}

/** Strict `confidence`: a number in 0..100, rounded to an integer percent; anything else → undefined. */
export function parseAiConfidence(value: unknown): number | undefined {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
    value > 100
  ) return undefined;
  return Math.round(value);
}

export interface AiResponseNotes {
  /** Prose (and fences) with the Notes / Questions sections removed. */
  body: string;
  notes: string[];
  questions: string[];
  suggestionNotes: SuggestionNote[];
}

const SECTION_LABELS: Record<string, "notes" | "questions"> = {
  note: "notes",
  notes: "notes",
  anteckning: "notes",
  anteckningar: "notes",
  question: "questions",
  questions: "questions",
  "fråga": "questions",
  "frågor": "questions",
  fragor: "questions",
};

/** `### Notes`, `## questions:`, `**Frågor**`, `Notes:` on its own line. */
function sectionOf(line: string): "notes" | "questions" | null {
  const m = line.trim().match(
    /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*([\p{L}]+)\s*:?\s*(?:\*\*|__)?\s*:?$/u,
  );
  if (!m) return null;
  const key = m[1]!.toLowerCase();
  // A bare word without heading/bold/colon is ordinary prose ("Notes" alone is fine too).
  return SECTION_LABELS[key] ?? null;
}

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/;

function sectionItems(lines: string[]): string[] {
  const items: string[] = [];
  let open = false;
  for (const raw of lines) {
    if (!raw.trim()) {
      open = false;
      continue;
    }
    const item = raw.match(LIST_ITEM);
    if (item) {
      items.push(item[1]!.trim());
      open = true;
    } else if (open && items.length) {
      items[items.length - 1] += ` ${raw.trim()}`;
    } else {
      items.push(raw.trim());
      open = true;
    }
  }
  return items.filter(Boolean);
}

/** `note` / `confidence` fields from a suggestions envelope (suggestions[] and loops[]). */
export function collectSuggestionNotes(envelope: unknown): SuggestionNote[] {
  if (!envelope || typeof envelope !== "object") return [];
  const rec = envelope as Record<string, unknown>;
  const out: SuggestionNote[] = [];
  const pick = (rows: unknown, kind: SuggestionNote["kind"], idKey: string) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const note = typeof r.note === "string" ? r.note.trim() : "";
      const confidence = kind === "suggestion"
        ? parseAiConfidence(r.confidence)
        : undefined;
      if (!note && confidence === undefined) continue;
      const id = typeof r[idKey] === "string" ? String(r[idKey]) : undefined;
      out.push({
        kind,
        note,
        ...(id ? { slotId: id } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
      });
    }
  };
  pick(rec.loops, "loop", "attachSlotId");
  pick(rec.suggestions, "suggestion", "slotId");
  return out;
}

/** End index (exclusive) of the balanced JSON object starting at `start`, or -1. */
export function balancedJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Split an AI answer into body prose, Notes, Questions and per-suggestion
 * notes. `envelope` is the parsed suggestions JSON when the caller has it;
 * lines inside ``` fences never count as sections.
 */
export function parseAiResponseNotes(
  text: string,
  envelope?: unknown,
): AiResponseNotes {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const body: string[] = [];
  const sections: Record<"notes" | "questions", string[]> = {
    notes: [],
    questions: [],
  };
  let current: "notes" | "questions" | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      current = null;
      body.push(line);
      continue;
    }
    if (inFence) {
      body.push(line);
      continue;
    }
    const heading = sectionOf(line);
    if (heading) {
      current = heading;
      continue;
    }
    if (current && /^\s*#{1,6}\s/.test(line)) current = null; // another heading ends the section
    if (current) sections[current].push(line);
    else body.push(line);
  }
  const rec = envelope && typeof envelope === "object"
    ? envelope as Record<string, unknown>
    : {};
  return {
    body: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    notes: mergeItems(rec.notes, sectionItems(sections.notes)),
    questions: mergeItems(rec.questions, sectionItems(sections.questions)),
    suggestionNotes: collectSuggestionNotes(envelope),
  };
}

/** Envelope `notes[]` / `questions[]` first, then prose items; duplicates dropped. */
function mergeItems(fromJson: unknown, fromProse: string[]): string[] {
  const json = Array.isArray(fromJson)
    ? fromJson.filter((v): v is string => typeof v === "string").map((v) =>
      v.trim()
    ).filter(Boolean)
    : [];
  return [...new Set([...json, ...fromProse])];
}

export function hasResponseNotes(notes: AiResponseNotes): boolean {
  return notes.notes.length + notes.questions.length +
      notes.suggestionNotes.length > 0;
}
