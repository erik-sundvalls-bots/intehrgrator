/**
 * Option C (#249 review): an AI answer may carry brief `### Notes` and
 * `### Questions` sections in prose OUTSIDE the `intehrgrator-suggestions`
 * fence. This module states that convention for prompts and pulls the
 * sections, the remaining prose, and per-suggestion `note` fields out of a
 * pasted or returned answer.
 */

/**
 * Fixed Questions syntax (prose and JSON), shared by every prompt that asks
 * for Notes / Questions so the parser and the choice buttons can rely on it.
 */
export const QUESTIONS_SYNTAX =
  "In `### Questions` write each question as `1. …?` with its options as indented `- ` sub-bullets (max 4; append ` (recommended)` to at most one); in JSON `questions[]` items are a string or `{\"text\",\"options\":[…]}`.";

/** Prompt text (keep short: it rides on every prompt that asks for JSON). */
export const NOTES_CONVENTION =
  "Notes are for risks only (ambiguous source, unit/coding mismatch, lossy conversion, guessed path), never routine confirmations: per-suggestion `note`, and brief `### Notes` / `### Questions` outside the JSON fence (or top-level `notes[]` / `questions[]`); omit when empty. " + QUESTIONS_SYNTAX + " Per-suggestion `confidence`: integer 0–100 = your estimated % chance the mapping is correct; include it only when below 90, or on every suggestion if the user asks.";

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

export interface AiQuestionOption {
  text: string;
  /** The AI marked this choice `(recommended)`. */
  recommended?: boolean;
}

export interface AiQuestion {
  text: string;
  /** Suggested answers (may be empty: free-text answer only). */
  options: AiQuestionOption[];
}

export interface AiResponseNotes {
  /** Prose (and fences) with the Notes / Questions sections removed. */
  body: string;
  notes: string[];
  questions: AiQuestion[];
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

const MAX_OPTIONS = 6;

/** `(recommended)` / `[recommended]` / `(rekommenderas)` / `(rekommenderad)` at the end, or bold `**…**` wrapping. */
const RECOMMENDED = /\s*[([]\s*(?:recommended|rekommender(?:as|ad|at))\s*[)\]]\s*$/i;

export function parseQuestionOption(raw: string): AiQuestionOption | null {
  let text = raw.trim();
  let recommended = false;
  if (RECOMMENDED.test(text)) {
    recommended = true;
    text = text.replace(RECOMMENDED, "").trim();
  }
  text = text.replace(/[.;,]$/, "").trim();
  if (!text) return null;
  return recommended ? { text, recommended } : { text };
}

/** Ends like a question, or like "Options:" (ignoring a trailing `(a / b)` choice list or closing markup). */
function isQuestionText(text: string): boolean {
  return /[?:]\s*(?:\([^()]*\))?\s*[*_`"')\]]*\s*$/.test(text);
}

/** `Which unit? (mmHg / kPa)` → question + options, when no options were listed. */
function splitInlineChoices(question: AiQuestion): AiQuestion {
  if (question.options.length) return question;
  const m = question.text.match(/^(.*\?)\s*\(([^()]*\/[^()]*)\)\s*$/);
  if (!m) return question;
  const options = m[2]!.split("/").map(parseQuestionOption).filter((o): o is AiQuestionOption => !!o);
  return options.length >= 2 ? { text: m[1]!.trim(), options: options.slice(0, MAX_OPTIONS) } : question;
}

/** A string or `{ text, options? }` (options: strings or `{ text, recommended? }`) → question, else null. */
export function normalizeAiQuestion(value: unknown): AiQuestion | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? splitInlineChoices({ text, options: [] }) : null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const text = typeof rec.text === "string" ? rec.text.trim() : "";
  if (!text) return null;
  const options: AiQuestionOption[] = [];
  if (Array.isArray(rec.options)) {
    for (const o of rec.options) {
      if (typeof o === "string") {
        const opt = parseQuestionOption(o);
        if (opt) options.push(opt);
      } else if (o && typeof o === "object" && typeof (o as Record<string, unknown>).text === "string") {
        const opt = parseQuestionOption(String((o as Record<string, unknown>).text));
        if (opt) {
          if ((o as Record<string, unknown>).recommended === true) opt.recommended = true;
          options.push(opt);
        }
      }
    }
  }
  return splitInlineChoices({ text, options: options.slice(0, MAX_OPTIONS) });
}

// `1.` / `1)` numbered, `-` / `*` / `+` / `•` bullets, `a)` / `A.` / `(b)` letters.
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const LETTERED = /^(\s*)\(?[a-zA-Z][.)]\s+(.*)$/;

/**
 * Questions section → questions with options. Options are list lines indented
 * under a question, lettered lines (`a)`, `A.`), or bullets under a numbered
 * question. Flat lists: an item not ending in `?` right after a question (or
 * after one of its options) becomes that question's option.
 */
function questionItems(lines: string[]): AiQuestion[] {
  type Item = { indent: number; kind: "num" | "bullet" | "letter"; text: string };
  const items: Item[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const num = raw.match(NUMBERED);
    const letter = num ? null : raw.match(LETTERED);
    const bullet = num || letter ? null : raw.match(BULLET);
    const m = num ?? letter ?? bullet;
    if (m) {
      items.push({
        indent: m[1]!.replace(/\t/g, "    ").length,
        kind: num ? "num" : letter ? "letter" : "bullet",
        text: m[2]!.trim(),
      });
    } else if (items.length) {
      items[items.length - 1]!.text += ` ${raw.trim()}`;
    } else {
      items.push({ indent: raw.length - raw.trimStart().length, kind: "bullet", text: raw.trim() });
    }
  }
  const hasNumbered = items.some((i) => i.kind === "num");
  const questions: Array<AiQuestion & { indent: number; asked: boolean }> = [];
  for (const item of items) {
    const current = questions[questions.length - 1];
    const nested = current && (
      item.indent > current.indent ||
      item.kind === "letter" ||
      (hasNumbered && item.kind === "bullet")
    );
    // Flat list: "1. Q?  2. Default to X  3. Leave unmapped" → 2 and 3 are options of 1.
    const flatOption = current && !nested && current.asked && !item.text.includes("?");
    if (current && (nested || flatOption)) {
      const opt = parseQuestionOption(item.text);
      if (opt && current.options.length < MAX_OPTIONS) current.options.push(opt);
      continue;
    }
    questions.push({ text: item.text, options: [], indent: item.indent, asked: isQuestionText(item.text) });
  }
  return questions.map(({ text, options }) => splitInlineChoices({ text, options }));
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
    questions: mergeQuestions(rec.questions, questionItems(sections.questions)),
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

/** Envelope `questions[]` first, then prose questions; same question text merges options. */
function mergeQuestions(fromJson: unknown, fromProse: AiQuestion[]): AiQuestion[] {
  const json = Array.isArray(fromJson)
    ? fromJson.map(normalizeAiQuestion).filter((q): q is AiQuestion => !!q)
    : [];
  const out: AiQuestion[] = [];
  for (const q of [...json, ...fromProse]) {
    const same = out.find((o) => o.text === q.text);
    if (!same) out.push(q);
    else if (!same.options.length) same.options = q.options;
  }
  return out;
}

export function hasResponseNotes(notes: AiResponseNotes): boolean {
  return notes.notes.length + notes.questions.length +
      notes.suggestionNotes.length > 0;
}
