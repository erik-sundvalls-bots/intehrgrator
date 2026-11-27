/**
 * Shared semantics for Blockly text, math and list blocks (issue #393).
 *
 * One implementation, used by Mapping preview, generated TypeScript (re-exported
 * from `typescript.ts`) and the Handlebars `blk` helper. Go (`blk` in
 * `go/texttemplate/main.go`), Java (`IntehrgratorRuntime.blocklyOp`) and XQuery
 * (`igbk:op` in `helpers/xquery/blocks.xqm`) mirror these rules; the per-block
 * parity test compares them.
 *
 * Rules shared by every language:
 * - Text is counted in code points (Go, Java and XQuery count them too), so an
 *   emoji is one character; Blockly's own JavaScript counts UTF-16 units.
 * - Positions are 1-based like Blockly. `FROM_START n` is the n-th item,
 *   `FROM_END n` the n-th from the end, `FIRST` / `LAST` the ends.
 * - A text position outside the text gives "" (`charAt`); a list position
 *   outside the list gives null.
 * - A number result that is not finite (sqrt(-1), 0^-1) gives null.
 * - `math_on_list` ignores items that are not numbers; an empty list gives
 *   null, except SUM (0) and MODE (an empty list).
 * - `lists_indexOf` / `text_indexOf` give 0 when the item is absent.
 * - RANDOM positions and `math_on_list` RANDOM are not supported: generated
 *   code must give the same output for the same input.
 *
 * This module has no package imports so generated TypeScript can load it from
 * the raw GitHub URL.
 */

/** Expression call names backed by `blocklyOp` (one per Blockly block or mode). */
export const BLOCKLY_OP_NAMES = [
  "text_length",
  "text_isEmpty",
  "text_indexOf",
  "text_charAt",
  "text_getSubstring",
  "math_single",
  "math_number_property",
  "math_on_list",
  "lists_isEmpty",
  "lists_indexOf",
  "lists_getSublist",
  "lists_reverse",
  "lists_sort",
  "lists_split",
  "power",
  "round_up",
  "round_down",
] as const;

export type BlocklyOpName = typeof BLOCKLY_OP_NAMES[number];

const OP_SET: ReadonlySet<string> = new Set(BLOCKLY_OP_NAMES);

export function isBlocklyOpName(name: string): name is BlocklyOpName {
  return OP_SET.has(name);
}

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Text as code points. */
function chars(v: unknown): string[] {
  return Array.from(text(v));
}

function indexOfChars(t: string[], f: string[], last: boolean): number {
  const hits: number[] = [];
  for (let i = 0; i + f.length <= t.length; i++) {
    if (f.every((c, j) => t[i + j] === c)) {
      if (!last) return i;
      hits.push(i);
    }
  }
  return hits.length ? hits[hits.length - 1]! : -1;
}

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  return s === "" ? 0 : Number(s);
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? (Object.is(n, -0) ? 0 : n) : null;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** Start index (0-based, inclusive) for a Blockly WHERE / AT pair. */
function startIndex(where: unknown, at: unknown, len: number): number {
  switch (text(where)) {
    case "FIRST":
      return 0;
    case "FROM_END":
      return len - Math.trunc(num(at));
    case "FROM_START":
      return Math.trunc(num(at)) - 1;
    default:
      throw new Error(`Unsupported position ${text(where)} (RANDOM is not supported in generated code)`);
  }
}

/** End index (0-based, exclusive) for a Blockly WHERE / AT pair. */
function endIndex(where: unknown, at: unknown, len: number): number {
  switch (text(where)) {
    case "LAST":
      return len;
    case "FROM_END":
      return len - Math.trunc(num(at)) + 1;
    case "FROM_START":
      return Math.trunc(num(at));
    default:
      throw new Error(`Unsupported position ${text(where)}`);
  }
}

function slice<T extends { slice(a: number, b: number): T; length: number }>(
  value: T,
  w1: unknown,
  at1: unknown,
  w2: unknown,
  at2: unknown,
): T {
  const len = value.length;
  const start = Math.max(0, startIndex(w1, at1, len));
  const end = Math.min(len, endIndex(w2, at2, len));
  return value.slice(start, Math.max(start, end));
}

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function numbers(v: unknown): number[] {
  const out: number[] = [];
  for (const item of list(v)) {
    if (item === null || item === undefined || item === "" || typeof item === "boolean") continue;
    const n = typeof item === "number" ? item : Number(String(item).trim());
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function splitText(input: string, delim: string): string[] {
  if (delim === "") return Array.from(input); // code points
  return input.split(delim);
}

/** Evaluate one Blockly op (see `BLOCKLY_OP_NAMES`). */
export function blocklyOp(name: string, ...args: unknown[]): unknown {
  switch (name) {
    case "text_length":
      return chars(args[0]).length;
    case "text_isEmpty":
      return text(args[0]).length === 0;
    case "text_indexOf":
      return indexOfChars(chars(args[0]), chars(args[1]), text(args[2]) === "LAST") + 1;
    case "text_charAt": {
      const t = chars(args[0]);
      const i = text(args[1]) === "LAST" ? t.length - 1 : startIndex(args[1], args[2], t.length);
      return i >= 0 && i < t.length ? t[i]! : "";
    }
    case "text_getSubstring":
      return slice(chars(args[0]), args[1], args[2], args[3], args[4]).join("");
    case "math_single": {
      const x = num(args[1]);
      switch (text(args[0])) {
        case "ROOT":
          return finite(Math.sqrt(x));
        case "ABS":
          return finite(Math.abs(x));
        case "NEG":
          return finite(-x);
        case "LN":
          return finite(Math.log(x));
        case "LOG10":
          return finite(Math.log10(x));
        case "EXP":
          return finite(Math.exp(x));
        case "POW10":
          return finite(Math.pow(10, x));
      }
      throw new Error(`Unsupported math_single operator ${text(args[0])}`);
    }
    case "math_number_property": {
      const n = num(args[1]);
      if (!Number.isFinite(n)) return false;
      switch (text(args[0])) {
        case "EVEN":
          return n % 2 === 0;
        case "ODD":
          return Math.abs(n % 2) === 1;
        case "PRIME":
          return isPrime(n);
        case "WHOLE":
          return n % 1 === 0;
        case "POSITIVE":
          return n > 0;
        case "NEGATIVE":
          return n < 0;
        case "DIVISIBLE_BY": {
          const d = num(args[2]);
          return Number.isFinite(d) && d !== 0 && n % d === 0;
        }
      }
      throw new Error(`Unsupported math_number_property ${text(args[0])}`);
    }
    case "math_on_list": {
      const xs = numbers(args[1]);
      const op = text(args[0]);
      if (op === "SUM") return finite(xs.reduce((a, b) => a + b, 0));
      if (op === "MODE") {
        const counts = new Map<number, number>();
        for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
        const top = Math.max(0, ...counts.values());
        return [...counts.entries()].filter(([, c]) => c === top).map(([x]) => x);
      }
      if (xs.length === 0) {
        if (["MIN", "MAX", "AVERAGE", "MEDIAN", "STD_DEV"].includes(op)) return null;
        throw new Error(`Unsupported math_on_list operator ${op}`);
      }
      switch (op) {
        case "MIN":
          return Math.min(...xs);
        case "MAX":
          return Math.max(...xs);
        case "AVERAGE":
          return finite(xs.reduce((a, b) => a + b, 0) / xs.length);
        case "MEDIAN": {
          const s = [...xs].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        case "STD_DEV": {
          const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
          const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
          return finite(Math.sqrt(variance));
        }
      }
      throw new Error(`Unsupported math_on_list operator ${op} (RANDOM is not supported in generated code)`);
    }
    case "lists_isEmpty":
      return list(args[0]).length === 0;
    case "lists_indexOf": {
      const items = list(args[0]);
      if (text(args[2]) === "LAST") {
        for (let i = items.length - 1; i >= 0; i--) if (same(items[i], args[1])) return i + 1;
        return 0;
      }
      return items.findIndex((item) => same(item, args[1])) + 1;
    }
    case "lists_getSublist":
      return slice(list(args[0]), args[1], args[2], args[3], args[4]);
    case "lists_reverse":
      return [...list(args[0])].reverse();
    case "lists_sort": {
      const type = text(args[1]) || "NUMERIC";
      const dir = num(args[2]) < 0 ? -1 : 1;
      const cmp = type === "NUMERIC"
        ? (a: unknown, b: unknown) => {
          const x = num(a);
          const y = num(b);
          return x < y ? -1 : x > y ? 1 : 0;
        }
        : type === "IGNORE_CASE"
        ? (a: unknown, b: unknown) => compareText(text(a).toLowerCase(), text(b).toLowerCase())
        : (a: unknown, b: unknown) => compareText(text(a), text(b));
      return [...list(args[0])].sort((a, b) => dir * cmp(a, b));
    }
    case "lists_split": {
      const delim = text(args[2]);
      if (text(args[0]) === "JOIN") return list(args[1]).map(text).join(delim);
      return splitText(text(args[1]), delim);
    }
    case "power":
      return finite(Math.pow(num(args[0]), num(args[1])));
    case "round_up":
      return finite(Math.ceil(num(args[0])));
    case "round_down":
      return finite(Math.floor(num(args[0])));
  }
  throw new Error(`Unknown Blockly op ${name}`);
}
