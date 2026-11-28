/**
 * Runtime warnings for numbers a Conversion Script target cannot express
 * exactly. Lexical forms and the shared formatters live in `numeric_format.ts`
 * (and the Go / Java / XQuery mirrors). See also `docs/numeric-formats.md`.
 *
 * All current runtimes use IEEE-754 binary64 (`Number` / `float64` / `double`).
 * Integers outside ±(2^53 − 1) are no longer exact; NaN / Infinity cannot be
 * written into JSON or into XML Schema xs:decimal / xs:integer.
 *
 * Citations for the limits themselves:
 * - Number.MAX_SAFE_INTEGER is 2^53 − 1.
 *   https://tc39.es/ecma262/#sec-number.max_safe_integer
 * - RFC 8259 §6: JSON numbers have no NaN / Infinity; interoperable integers
 *   are those in ±(2^53 − 1).
 *   https://www.rfc-editor.org/rfc/rfc8259#section-6
 */

import {
  exactnessWarning,
  SAFE_INTEGER_MAX as FORMAT_SAFE_INTEGER_MAX,
  FLOAT64_MAX as FORMAT_FLOAT64_MAX,
  type NumberForm,
} from "./numeric_format.ts";

/** Exclusive upper bound of fixed-point ToString in ECMA-262 (`1e21`). */
export const JS_FIXED_MAX = 1e21;
/** Inclusive lower bound of fixed-point ToString in ECMA-262 (`1e-6`). */
export const JS_FIXED_MIN = 1e-6;
/** Largest integer that every current language can represent exactly. */
export const SAFE_INTEGER_MAX = FORMAT_SAFE_INTEGER_MAX;
/** IEEE-754 binary64 overflow threshold (becomes Infinity). */
export const FLOAT64_MAX = FORMAT_FLOAT64_MAX;

export const NUMERIC_LIMIT_NOTE =
  "Numbers are IEEE-754 binary64 in every language (safe integers up to ±2⁵³−1 = 9,007,199,254,740,991). " +
  "Each Conversion Script language writes a number in the target's standard lexical form: " +
  "JSON (RFC 8259) uses a shortest number, integers without .0, and rejects NaN/Infinity; " +
  "XML Schema xs:integer has no decimal point or exponent; xs:decimal is a plain decimal (never an exponent); " +
  "xs:double also allows INF and NaN. openEHR DV_COUNT.magnitude is an integer; " +
  "DV_QUANTITY.magnitude is a real (xs:double in ITS-XML, a JSON number in canonical JSON) with an optional precision attribute. " +
  "A conversion warning is logged only when the chosen target cannot express the value exactly.";

export function inferNumberForm(output: unknown): NumberForm {
  if (typeof output === "string" && /^\s*</.test(output)) return "xml-decimal";
  return "json";
}

/** Warn only when the target cannot express `n` exactly. */
export function numericLimitWarning(n: number, form: NumberForm = "json"): string | null {
  const msg = exactnessWarning(n, form);
  return msg ?? null;
}

/** Walk a conversion result and return one warning line per distinct numeric limit hit. */
export function collectNumericLimitLogs(output: unknown, form?: NumberForm): string[] {
  const resolved = form ?? inferNumberForm(output);
  const seen = new Set<string>();
  const logs: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "number") {
      // Unsafe integers are covered by the Math toolbox note; do not log every
      // large identifier in a document. Log only values the target cannot
      // express at all (NaN / Infinity in JSON or xs:decimal / xs:integer).
      if (Number.isFinite(value)) return;
      const msg = numericLimitWarning(value, resolved);
      if (msg && !seen.has(msg)) {
        seen.add(msg);
        logs.push(msg);
      }
      return;
    }
    if (typeof value === "string") {
      // Flag only spellings the target cannot hold: NaN / Inf, and (in XML
      // integer/decimal) an exponent that should have been a plain decimal.
      // Do not treat large integer IDs or ordinary scientific JSON as a hit.
      const specials = value.match(/\b(?:NaN|-?INF|-?Infinity)\b/g) ?? [];
      for (const s of specials) {
        const n = s === "NaN" ? NaN : s.includes("-") ? -Infinity : Infinity;
        const msg = numericLimitWarning(n, resolved);
        if (msg && !seen.has(msg)) {
          seen.add(msg);
          logs.push(msg);
        }
      }
      if (resolved === "xml-integer" || resolved === "xml-decimal") {
        const re = /[-+]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)/g;
        for (const match of value.match(re) ?? []) {
          const n = Number(match);
          if (!Number.isFinite(n)) continue;
          const msg =
            `The target form ${resolved} cannot express ${match} exactly; XML Schema ${resolved === "xml-integer" ? "xs:integer" : "xs:decimal"} does not allow an exponent.`;
          if (!seen.has(msg)) {
            seen.add(msg);
            logs.push(msg);
          }
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item);
    }
  };
  visit(output);
  return logs;
}

export function attachNumericLimitLogs<T extends { output?: unknown; logs?: string[] }>(
  result: T,
  log: (message: string) => void = (m) => console.warn(m),
): T {
  const extra = collectNumericLimitLogs(result.output);
  if (!extra.length) return result;
  for (const line of extra) log(line);
  return { ...result, logs: [...(result.logs ?? []), ...extra] };
}
