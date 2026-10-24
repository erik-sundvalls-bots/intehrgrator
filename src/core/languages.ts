/**
 * Source and target languages (#277 §4, #279).
 *
 * - `source.lang.1, …` and `target.lang.1, …` are priority lists of language
 *   codes (ISO 639-1, BCP 47 region subtag allowed: `sv`, `en-GB`).
 * - Valid codes and English names come from the openEHR `ISO_639-1` codeset
 *   in ehrtslib (`openehr_external_terminologies.xml`).
 * - The UI language never adds a language; it only breaks a tie when no
 *   target language matches a source language.
 */
import { termSetById } from "./openehr_term_catalog.ts";

export type AiContextLanguages = "matched" | "lang1" | "all";
export const AI_CONTEXT_LANGUAGE_MODES: readonly AiContextLanguages[] = ["matched", "lang1", "all"];

let codesetCache: Map<string, string> | null = null;
function codeset(): Map<string, string> {
  if (!codesetCache) {
    codesetCache = new Map((termSetById("ISO_639-1")?.codes ?? []).map((c) => [c.code.toLowerCase(), c.rubric]));
  }
  return codesetCache;
}

/** `EN-gb` → `en-GB`; empty for blank input. */
export function normalizeLangCode(code: string): string {
  const [base = "", ...rest] = code.trim().replace(/_/g, "-").split("-");
  if (!base) return "";
  return [base.toLowerCase(), ...rest.map((p) => p.length === 2 ? p.toUpperCase() : p.toLowerCase())].join("-");
}

/** In the ISO_639-1 codeset (case-insensitive); a region subtag is allowed when its base language is known. */
export function isKnownLanguage(code: string): boolean {
  const c = normalizeLangCode(code).toLowerCase();
  if (!c) return false;
  return codeset().has(c) || codeset().has(c.split("-")[0]!);
}

/** English name from the codeset (`sv` → `Swedish`), or undefined. */
export function codesetLanguageName(code: string): string | undefined {
  const c = normalizeLangCode(code).toLowerCase();
  return codeset().get(c) ?? (c.includes("-") ? codeset().get(c.split("-")[0]!) : undefined);
}

/** Display name in the UI language when `Intl.DisplayNames` has it, else the codeset's English name, else the code. */
export function languageDisplayName(code: string, uiLocale = "en"): string {
  try {
    const name = new Intl.DisplayNames([uiLocale, "en"], { type: "language" }).of(normalizeLangCode(code));
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // Invalid tag: fall through to the codeset.
  }
  return codesetLanguageName(code) ?? code;
}

/** Same language: exact (case-insensitive), or the same base when one side has a region (`en-GB` ↔ `en`). */
export function sameLanguage(a: string, b: string): boolean {
  const x = normalizeLangCode(a).toLowerCase();
  const y = normalizeLangCode(b).toLowerCase();
  if (!x || !y) return false;
  return x === y || x.split("-")[0] === y.split("-")[0];
}

/** Codes from a free-text list (`sv, en-GB; de`), normalised, without duplicates. */
export function parseLanguageList(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const code = normalizeLangCode(part);
    if (code && !out.some((c) => c.toLowerCase() === code.toLowerCase())) out.push(code);
  }
  return out;
}

/**
 * Auto-detected source languages: `xml:lang` (most frequent first, root
 * first on ties), JSON root `x-lang`, then `x-i18n` keys. Empty = unknown.
 */
export function detectSourceLanguages(contents: Array<{ format: string; content: string }>): string[] {
  const counts = new Map<string, { n: number; first: number }>();
  let order = 0;
  const add = (code: string, weight = 1) => {
    const c = normalizeLangCode(code);
    if (!c) return;
    const hit = counts.get(c);
    if (hit) hit.n += weight;
    else counts.set(c, { n: weight, first: order++ });
  };
  for (const { content } of contents) {
    const text = content.trimStart();
    if (text.startsWith("<")) {
      for (const m of text.matchAll(/xml:lang\s*=\s*["']([^"']+)["']/g)) add(m[1]!);
      continue;
    }
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (typeof json["x-lang"] === "string") add(json["x-lang"] as string, 1000);
      const keys = new Set<string>();
      const walk = (node: unknown, depth: number) => {
        if (!node || typeof node !== "object" || depth > 64) return;
        if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
        const rec = node as Record<string, unknown>;
        const i18n = rec["x-i18n"];
        if (i18n && typeof i18n === "object") Object.keys(i18n as object).forEach((k) => keys.add(k));
        Object.values(rec).forEach((v) => walk(v, depth + 1));
      };
      walk(json, 0);
      for (const k of keys) add(k);
    } catch {
      // Not JSON: no language metadata.
    }
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([c]) => c);
}

/**
 * `target.lang.N`: target languages ordered by (1) matches to `source.lang.N`
 * in that order, (2) only if nothing matched yet, the UI language, (3) the
 * target's original language, (4) the rest in schema order.
 */
export function orderTargetLanguages(
  targetLanguages: readonly string[],
  original: string | undefined,
  sourceLanguages: readonly string[],
  uiLanguage?: string,
): string[] {
  const rest = [...new Set(targetLanguages.filter(Boolean))];
  const out: string[] = [];
  const take = (pred: (t: string) => boolean) => {
    const i = rest.findIndex(pred);
    if (i >= 0) out.push(...rest.splice(i, 1));
  };
  for (const s of sourceLanguages) {
    take((t) => normalizeLangCode(t).toLowerCase() === normalizeLangCode(s).toLowerCase());
    take((t) => sameLanguage(t, s));
  }
  if (!out.length && uiLanguage) take((t) => sameLanguage(t, uiLanguage));
  if (original) take((t) => sameLanguage(t, original));
  return [...out, ...rest];
}

/** Target languages whose labels go to the AI, `target.lang.1` first. */
export function aiContextLanguages(
  mode: AiContextLanguages | undefined,
  targetOrder: readonly string[],
  sourceLanguages: readonly string[],
): string[] {
  if (!targetOrder.length) return [];
  if (mode === "lang1") return [targetOrder[0]!];
  if (mode === "all") return [...targetOrder];
  return targetOrder.filter((t, i) => i === 0 || sourceLanguages.some((s) => sameLanguage(s, t)));
}

/** Display language of a pane: the saved choice when the pane has it, else `lang.1`. */
export function displayLanguage(choice: string | undefined, order: readonly string[]): string | undefined {
  if (choice && order.some((l) => l === choice)) return choice;
  if (choice) {
    const near = order.find((l) => sameLanguage(l, choice));
    if (near) return near;
  }
  return order[0];
}
