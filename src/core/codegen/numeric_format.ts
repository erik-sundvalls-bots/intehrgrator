/**
 * Shared lexical forms for numbers written into a Conversion Script target.
 *
 * Every language (Mapping preview, TypeScript, Handlebars, XQuery, Go, Java)
 * should emit the same spelling for the same value and target type, using the
 * rules below rather than the language's default `String(n)` / `fn:string`.
 *
 * Citations (lexical / canonical forms):
 * - XML Schema 1.1 Part 2 (W3C Rec, 5 April 2012):
 *   https://www.w3.org/TR/xmlschema11-2/
 *   - xs:decimal §3.3.3: lexical `(\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+)`;
 *     canonical forbids exponent, a leading `+`, and (for integers) a decimal
 *     point; non-integers need a decimal point, no leading/trailing zeros,
 *     at least one digit on each side of the point.
 *   - xs:integer §3.4.13: canonical is optional `-` and digits, no `+`, no
 *     leading zeros, no decimal point, no exponent.
 *   - xs:double / xs:float §3.3.5 / §3.3.4: lexical space also includes
 *     `INF`, `-INF` and `NaN`; a decimal or scientific form is allowed.
 * - JSON RFC 8259 §6 / ECMA-404: `number = [ minus ] int [ frac ] [ exp ]`;
 *   no leading zeros; Infinity and NaN are not permitted.
 *   https://www.rfc-editor.org/rfc/rfc8259#section-6
 *   https://www.ecma-international.org/publications-and-standards/standards/ecma-404/
 *   Interoperable integers are those in ±(2^53−1) (RFC 8259 §6). We use the
 *   shortest round-trip spelling (ECMA-262 NumberToString / RFC 8785 JCS).
 * - openEHR RM 1.1.0 Data Types:
 *   https://specifications.openehr.org/releases/RM/latest/data_types.html
 *   - DV_QUANTITY.magnitude is Real; optional precision is decimal places
 *     (`0` = integral, `-1` = unlimited). Precision is a sibling attribute,
 *     not trailing zeros in JSON (JSON numbers do not preserve them).
 *   - DV_COUNT.magnitude is Integer (Integer64 in later BASE).
 *   - DV_PROPORTION numerator / denominator are Real; precision as above.
 * - openEHR ITS-XML: DV_QUANTITY.magnitude is `xs:double` (period as the
 *   decimal separator; `INF`/`NaN` legal). SPECITS-53 fixed a wrong integer
 *   type. Canonical JSON / FLAT / STRUCTURED use a JSON number.
 * - TakeCare Casenote XSD (`test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd`):
 *   `TemplateId` / `TemplateType` are `xs:integer`, `TermId` is `xs:int`,
 *   `Value` is `xs:decimal` — so exponents and NaN/Inf must not appear there.
 */

/** Largest integer that IEEE-754 binary64 (and typical JSON receivers) can hold exactly. */
export const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
/** IEEE-754 binary64 overflow threshold. */
export const FLOAT64_MAX = Number.MAX_VALUE;

/** How a number should be spelled in the target document. */
export type NumberForm = "json" | "xml-integer" | "xml-decimal" | "xml-double";

export interface FormatNumberOptions {
  /**
   * openEHR DV_QUANTITY / DV_PROPORTION precision: `0` = integral, `-1` or
   * omitted = shortest, `N >= 0` = that many decimal places (XML only;
   * JSON cannot keep trailing zeros, so it still uses the shortest form).
   */
  precision?: number;
  /** Built-in or named simple type (`xs:int`, `integer`, `int`, …). */
  schemaType?: string;
}

export interface FormatNumberResult {
  text: string;
  /** Set only when the target cannot express the value exactly. */
  warning?: string;
}

export class NumberFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberFormatError";
  }
}

const INTEGER_TYPES = new Set([
  "integer",
  "int",
  "long",
  "short",
  "byte",
  "nonnegativeinteger",
  "negativeinteger",
  "nonpositiveinteger",
  "positiveinteger",
  "unsignedint",
  "unsignedlong",
  "unsignedshort",
  "unsignedbyte",
  "integer32",
  "integer64",
]);

const DOUBLE_TYPES = new Set([
  "double",
  "float",
  "real",
]);

const DECIMAL_TYPES = new Set([
  "decimal",
]);

/** Inclusive integer ranges for derived XML Schema types. */
const INTEGER_RANGES: Record<string, { min: number; max: number }> = {
  byte: { min: -128, max: 127 },
  short: { min: -32768, max: 32767 },
  int: { min: -2147483648, max: 2147483647 },
  unsignedbyte: { min: 0, max: 255 },
  unsignedshort: { min: 0, max: 65535 },
  unsignedint: { min: 0, max: 4294967295 },
  nonnegativeinteger: { min: 0, max: Infinity },
  positiveinteger: { min: 1, max: Infinity },
  nonpositiveinteger: { min: -Infinity, max: 0 },
  negativeinteger: { min: -Infinity, max: -1 },
};

export function normalizeSchemaType(type: string | undefined): string {
  const raw = String(type ?? "").trim();
  const local = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
  return local.trim().toLowerCase();
}

/**
 * Choose a form from the output document kind and, when known, the field's
 * schema or RM type.
 */
export function numberFormForSchemaType(
  type: string | undefined,
  output: "json" | "xml",
): NumberForm {
  const t = normalizeSchemaType(type);
  if (INTEGER_TYPES.has(t)) return "xml-integer";
  if (output === "json") {
    if (DECIMAL_TYPES.has(t) || DOUBLE_TYPES.has(t)) return "json";
    return "json";
  }
  if (DOUBLE_TYPES.has(t)) return "xml-double";
  // xs:decimal, unknown XML, TakeCare Value, etc. — never use an exponent.
  return "xml-decimal";
}

/** RM attribute form (DV_COUNT.magnitude vs DV_QUANTITY.magnitude, …). */
export function numberFormForRmAttribute(
  rmType: string | undefined,
  attr: string | undefined,
  output: "json" | "xml",
): NumberForm {
  const t = String(rmType ?? "").trim().toUpperCase();
  const a = String(attr ?? "").trim();
  if (a === "precision") return "xml-integer";
  if (t === "DV_COUNT" && (a === "magnitude" || a === "")) return "xml-integer";
  if (t === "DV_ORDINAL" && (a === "value" || a === "")) return "xml-integer";
  if (t === "DV_PROPORTION" && (a === "numerator" || a === "denominator")) {
    return output === "xml" ? "xml-double" : "json";
  }
  if (t === "DV_QUANTITY" && (a === "magnitude" || a === "")) {
    return output === "xml" ? "xml-double" : "json";
  }
  return numberFormForSchemaType(undefined, output);
}

export function formatNumber(
  value: number,
  form: NumberForm,
  options: FormatNumberOptions = {},
): FormatNumberResult {
  if (typeof value !== "number" || Number.isNaN(value as number)) {
    // Number.isNaN is only true for NaN; use it after the typeof check.
  }
  switch (form) {
    case "json":
      return formatJsonNumber(value, options);
    case "xml-integer":
      return formatXmlInteger(value, options);
    case "xml-decimal":
      return formatXmlDecimal(value, options);
    case "xml-double":
      return formatXmlDouble(value, options);
  }
}

export function formatJsonNumber(
  value: number,
  _options: FormatNumberOptions = {},
): FormatNumberResult {
  if (!Number.isFinite(value)) {
    throw new NumberFormatError(
      `JSON (RFC 8259 §6) cannot express ${String(value)}; Infinity and NaN are not permitted.`,
    );
  }
  // ECMA-262 / RFC 8785 shortest form; JSON.stringify(-0) is "0".
  const text = JSON.stringify(value);
  const warning = exactnessWarning(value, "json");
  return warning ? { text, warning } : { text };
}

export function formatXmlInteger(
  value: number,
  options: FormatNumberOptions = {},
): FormatNumberResult {
  if (!Number.isFinite(value)) {
    throw new NumberFormatError(
      `XML Schema xs:integer cannot express ${String(value)}; the lexical space is a signed whole number with no decimal point or exponent.`,
    );
  }
  if (!isIntegerValued(value)) {
    throw new NumberFormatError(
      `XML Schema xs:integer cannot express ${canonicalDecimal(value)}; the value is not a whole number.`,
    );
  }
  const range = INTEGER_RANGES[normalizeSchemaType(options.schemaType)];
  if (range && (value < range.min || value > range.max)) {
    const typ = options.schemaType ?? "integer";
    throw new NumberFormatError(
      `XML Schema ${typ} cannot express ${canonicalDecimal(value)}; it is outside the type's range.`,
    );
  }
  const text = canonicalDecimal(value); // integer-valued → no decimal point
  const warning = exactnessWarning(value, "xml-integer");
  return warning ? { text, warning } : { text };
}

export function formatXmlDecimal(
  value: number,
  options: FormatNumberOptions = {},
): FormatNumberResult {
  if (!Number.isFinite(value)) {
    throw new NumberFormatError(
      `XML Schema xs:decimal cannot express ${String(value)}; Infinity and NaN are not in the lexical space, and exponents are not allowed.`,
    );
  }
  const text = applyPrecision(value, options.precision, false);
  const warning = exactnessWarning(value, "xml-decimal");
  return warning ? { text, warning } : { text };
}

export function formatXmlDouble(
  value: number,
  options: FormatNumberOptions = {},
): FormatNumberResult {
  if (Number.isNaN(value)) return { text: "NaN" };
  if (value === Infinity) return { text: "INF" };
  if (value === -Infinity) return { text: "-INF" };
  // Negative zero is distinct in IEEE / xs:double.
  if (Object.is(value, -0)) return { text: "-0" };
  const text = applyPrecision(value, options.precision, false);
  const warning = exactnessWarning(value, "xml-double");
  return warning ? { text, warning } : { text };
}

/**
 * JSON.stringify that rejects NaN / Infinity instead of silently writing `null`.
 * Finite numbers already use the RFC 8259 / ECMA-262 shortest form.
 */
export function stringifyJson(value: unknown, space?: string | number): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) {
      throw new NumberFormatError(
        `JSON (RFC 8259 §6) cannot express ${String(v)}; Infinity and NaN are not permitted.`,
      );
    }
    return v;
  }, space);
}

/** Text of a number in XML (default xs:decimal-safe, or a known schema type). */
export function xmlNumberText(
  value: number,
  type?: string,
  options: FormatNumberOptions = {},
): string {
  const form = numberFormForSchemaType(type, "xml");
  return formatNumber(value, form, { ...options, schemaType: type ?? options.schemaType }).text;
}

export function isIntegerValued(n: number): boolean {
  return Number.isFinite(n) && n === Math.trunc(n);
}

/**
 * Warning when the target cannot hold the value exactly (unsafe integer in
 * binary64, or a non-finite that slipped through). Ordinary large/small
 * finite values are expressible and must not warn just because some languages
 * would have used a different exponent spelling.
 */
export function exactnessWarning(n: number, form: NumberForm): string | undefined {
  if (!Number.isFinite(n)) {
    if (form === "xml-double") return undefined;
    return `The target form ${form} cannot express ${String(n)} exactly (Infinity and NaN are not permitted).`;
  }
  if (isIntegerValued(n) && Math.abs(n) > SAFE_INTEGER_MAX) {
    return `The integer ${canonicalDecimal(n)} is outside ±${SAFE_INTEGER_MAX} (2^53−1) and cannot be expressed exactly in IEEE-754 binary64, so typical JSON / XML receivers may not recover the same value (RFC 8259 §6).`;
  }
  if (Math.abs(n) > FLOAT64_MAX) {
    return `The value overflows IEEE-754 binary64.`;
  }
  return undefined;
}

/** Canonical xs:decimal / integer spelling of a finite number (no exponent). */
export function canonicalDecimal(n: number): string {
  if (!Number.isFinite(n)) {
    throw new NumberFormatError(`Cannot write ${String(n)} as a plain decimal.`);
  }
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const { int, frac } = expandLexeme(JSON.stringify(Math.abs(n)));
  const i = stripLeadingZeros(int);
  const f = stripTrailingZeros(frac);
  return f ? `${sign}${i}.${f}` : `${sign}${i}`;
}

function applyPrecision(n: number, precision: number | undefined, _json: boolean): string {
  if (precision === undefined || precision < 0) return canonicalDecimal(n);
  if (precision === 0) {
    return canonicalDecimal(Math.round(n));
  }
  // `toFixed` is a plain decimal (no exponent) with exactly N fraction digits.
  const fixed = n.toFixed(precision);
  // Keep the sign of a non-zero rounding; "-0.00" → "0.00" for decimal-style.
  if (/^-0\.?0*$/.test(fixed)) return `0.${"0".repeat(precision)}`;
  return fixed;
}

/** Expand a JSON / ECMA-262 numeric lexeme (`1e-7`, `1.25`, `3`) to parts. */
function expandLexeme(lexeme: string): { int: string; frac: string } {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(lexeme);
  if (!m) return { int: "0", frac: "" };
  const digits = m[1]! + (m[2] ?? "");
  const exp = m[3] !== undefined ? Number(m[3]) : 0;
  const point = m[1]!.length + exp;
  if (point <= 0) return { int: "0", frac: "0".repeat(-point) + digits };
  if (point >= digits.length) {
    return { int: digits + "0".repeat(point - digits.length), frac: "" };
  }
  return { int: digits.slice(0, point), frac: digits.slice(point) };
}

function stripLeadingZeros(int: string): string {
  const s = int.replace(/^0+(?=\d)/, "");
  return s.length ? s : "0";
}

function stripTrailingZeros(frac: string): string {
  return frac.replace(/0+$/, "");
}
