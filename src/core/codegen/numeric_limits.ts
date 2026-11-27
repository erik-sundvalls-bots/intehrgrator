/**
 * Numeric limits that Conversion Script languages do not share exactly.
 *
 * All current runtimes use IEEE-754 binary64 (`Number` / `float64` / `double`),
 * so the same magnitude is representable everywhere. What still differs is
 * how a value is printed when it is turned into text or JSON, and whether
 * an integer above 2^53 − 1 is still exact.
 *
 * Citations:
 * - ECMA-262 ToString / Number.prototype.toString: scientific notation when
 *   |n| ≥ 10^21 or |n| < 10^−6. TypeScript, Mapping preview and Handlebars
 *   (`JSON.stringify` / `toJson`) follow this.
 *   https://tc39.es/ecma262/#sec-numeric-types-number-tostring
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toString
 * - Number.MAX_SAFE_INTEGER is 2^53 − 1 (9 007 199 254 740 991). Integers
 *   outside ±that are no longer exact in binary64 (all of our languages).
 *   https://tc39.es/ecma262/#sec-number.max_safe_integer
 * - Go `encoding/json` also uses float64. Since Go 1.15 it follows the ES6 /
 *   RFC 8785 rounding, but `text/template` default printing can still differ
 *   (`1e-07` vs `1e-7`, `1.0e+21` vs `1e+21`).
 *   https://pkg.go.dev/encoding/json#Marshal
 *   https://go.dev/doc/go1.15#encoding_json
 * - Java `double` is binary64. `String.valueOf` / many JSON libraries print
 *   `1.0E-7` (capital E, a trailing `.0` on whole numbers). This project's
 *   Java runtime already documents that whole numbers may appear as `3.0`.
 *   https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.3
 * - XQuery `xs:double` (`fn:string` / serialization) typically uses a
 *   capital `E` exponent (`1.0E-7`). fontoxpath follows the XPath 3.1
 *   string value of a double.
 *   https://www.w3.org/TR/xpath-functions-31/#casting-to-string
 */

/** Exclusive upper bound of fixed-point ToString in ECMA-262 (`1e21`). */
export const JS_FIXED_MAX = 1e21;
/** Inclusive lower bound of fixed-point ToString in ECMA-262 (`1e-6`). */
export const JS_FIXED_MIN = 1e-6;
/** Largest integer that every current language can represent exactly. */
export const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
/** IEEE-754 binary64 overflow threshold (becomes Infinity). */
export const FLOAT64_MAX = Number.MAX_VALUE;

export const NUMERIC_LIMIT_NOTE =
  "Numbers are IEEE-754 binary64 in every language (safe integers up to ±2⁵³−1 = 9,007,199,254,740,991). " +
  "JSON / text formatting of very large or very small values can still differ: " +
  "TypeScript, Mapping preview and Handlebars follow ECMA-262 (scientific notation when |n| ≥ 1e21 or |n| < 1e-6, e.g. 1e+21, 1e-7); " +
  "Go templates may print 1e-07 or 1.0e+21; Java often prints 1.0E-7 and whole numbers as 3.0; " +
  "XQuery typically uses a capital E (1.0E-7). Ordinary numbers match across languages.";

export function numericLimitWarning(n: number): string | null {
  if (!Number.isFinite(n)) {
    return `Numeric limit: ${n} is not a finite number (IEEE-754 overflow or an empty math result).`;
  }
  const abs = Math.abs(n);
  // Formatting differences show up first (1e21 is also an unsafe integer).
  if (abs >= JS_FIXED_MAX || (abs !== 0 && abs < JS_FIXED_MIN)) {
    return `Numeric limit: ${n} is in the range where languages print exponents differently (ECMA-262 uses scientific notation for |n| ≥ 1e21 or |n| < 1e-6; Go, Java and XQuery may use a different spelling).`;
  }
  if (Number.isInteger(n) && abs > SAFE_INTEGER_MAX) {
    return `Numeric limit: ${n} is outside the safe integer range ±${SAFE_INTEGER_MAX} (2^53−1). Integers this large are not exact in binary64, so languages may print them differently.`;
  }
  return null;
}

/** Walk a conversion result and return one warning line per distinct numeric limit hit. */
export function collectNumericLimitLogs(output: unknown): string[] {
  const seen = new Set<string>();
  const logs: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "number") {
      const abs = Math.abs(value);
      const formatting = !Number.isFinite(value) ||
        abs >= JS_FIXED_MAX ||
        (value !== 0 && abs < JS_FIXED_MIN);
      // Safe-integer loss is described in the Math toolbox note; do not log
      // every large identifier in a document (e.g. 18-digit IDs).
      if (!formatting) return;
      const msg = numericLimitWarning(value);
      if (msg && !seen.has(msg)) {
        seen.add(msg);
        logs.push(msg);
      }
      return;
    }
    if (typeof value === "string") {
      // Only flag exponent-style or very small/large printed numbers in text.
      // Do not treat large integer IDs in a document as a conversion-limit hit.
      const re = /[-+]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)/g;
      const reFixedTiny = /[-+]?(?:0\.\d*[1-9]\d*)/g;
      const consider = new Set<number>();
      for (const match of value.match(re) ?? []) consider.add(Number(match));
      for (const match of value.match(reFixedTiny) ?? []) {
        const n = Number(match);
        if (n !== 0 && Math.abs(n) < JS_FIXED_MIN) consider.add(n);
      }
      for (const n of consider) {
        if (!Number.isFinite(n)) continue;
        const msg = numericLimitWarning(n);
        if (msg && !seen.has(msg)) {
          seen.add(msg);
          logs.push(msg);
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
