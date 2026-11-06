// The helpers mirror the loose values a generated script passes through.
// deno-lint-ignore-file no-explicit-any
/**
 * Static TypeScript helpers for generated conversion scripts.
 *
 * Generated scripts import only the names they call. The bodies here do not
 * change from mapping to mapping. XPath evaluators, the sheet bag, Handlebars,
 * and RM constructors are passed in so this module stays free of package
 * imports and can be loaded from the raw GitHub URL. Handlebars helper
 * bodies live in `./handlebars.ts` (no package imports either).
 */

import { registerKintegrateHandlebarsHelpers } from "./handlebars.ts";

export { sheetCodedText as igSheetCodedText } from "../../sheets/coded_text.ts";

export type XPathEval = (...args: any[]) => any;

export interface HelperSheet {
  headers: string[];
  values: unknown[][];
  decisionColumns?: Array<{ role?: string; outputKind?: string; valueType?: string }>;
  rowCatchAll?: boolean[];
  hitPolicy?: string;
  collectJoin?: string;
  collectDedupe?: boolean;
}

export type SheetBag = Record<string, HelperSheet | undefined>;

export function jsonQuery(path: unknown): string {
  const trimmed = String(path ?? "").trim();
  if (!trimmed || trimmed.startsWith("/")) return trimmed;
  const asJson = trimmed.startsWith("$") ? trimmed : `$.${trimmed.replace(/^\./, "")}`;
  let body = asJson.slice(1);
  if (body.startsWith(".")) body = body.slice(1);
  if (!body || body === ".") return "$source";
  const segments: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === ".") {
      i++;
      continue;
    }
    if (body[i] === "[") {
      const close = body.indexOf("]", i + 1);
      if (close < 0) break;
      let seg = body.slice(i + 1, close).trim();
      const quote = seg[0];
      if ((quote === '"' || quote === "'") && seg.endsWith(quote) && seg.length >= 2) {
        seg = seg.slice(1, -1);
      }
      segments.push(seg);
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < body.length && !".[".includes(body[end] ?? "")) end++;
    segments.push(body.slice(i, end));
    i = end;
  }
  return segments.reduce((q, seg) => {
    if (seg === "*") return `${q}?*`;
    // Authoring [0] and [1] are both the first element. fontoxpath JSON indexes are 1-based, and ?0 throws.
    if (/^\d+$/.test(seg)) return `${q}?${seg === "0" ? "1" : seg}`;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) return `${q}?${seg}`;
    return `${q}?(${JSON.stringify(seg)})`;
  }, "$source");
}

export function igXpathString(evaluateXPathToString: XPathEval, path: unknown, node: unknown): string {
  const trimmed = (typeof path === "string" ? path : String(path ?? "")).trim();
  if (trimmed.startsWith("/")) return evaluateXPathToString(trimmed, node);
  const found = jsonWalk(trimmed, node);
  if (typeof found === "string") return found;
  if (typeof found === "number" || typeof found === "boolean") return String(found);
  return "";
}

export function igXpathNumber(evaluateXPathToNumber: XPathEval, path: unknown, node: unknown): number {
  const trimmed = (typeof path === "string" ? path : String(path ?? "")).trim();
  if (trimmed.startsWith("/")) return evaluateXPathToNumber(trimmed, node);
  const found = jsonWalk(trimmed, node);
  if (typeof found === "number") return found;
  if (typeof found === "boolean") return found ? 1 : 0;
  if (typeof found === "string" && found.trim() !== "") return Number(found);
  return NaN;
}

export function igXpathBoolean(evaluateXPathToBoolean: XPathEval, path: unknown, node: unknown): boolean {
  const trimmed = (typeof path === "string" ? path : String(path ?? "")).trim();
  if (trimmed.startsWith("/")) return evaluateXPathToBoolean(trimmed, node);
  const found = jsonWalk(trimmed, node);
  if (found == null || found === "") return false;
  if (typeof found === "boolean") return found;
  if (typeof found === "number") return found !== 0 && !Number.isNaN(found);
  if (typeof found === "string") return true;
  if (Array.isArray(found)) return found.length > 0;
  return true;
}

// JSON authoring paths walk the document. fontoxpath throws FOAY0001 when an
// index is missing and refuses a sequence from evaluateXPathToFirstNode.
// Preview already walks, so a missing [0] is empty and a list path is the list.
function jsonWalk(path: string, node: unknown): unknown {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "$" || trimmed === "." || trimmed === "$source") return node;
  let body = trimmed;
  if (body.startsWith("$source")) body = body.slice(7);
  else if (body.startsWith("$")) body = body.slice(1);
  if (body.startsWith(".") || body.startsWith("?")) body = body.slice(1);
  const segs: string[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "." || ch === "?") {
      i++;
      continue;
    }
    if (ch === "*") {
      segs.push("*");
      i++;
      continue;
    }
    if (ch === "[") {
      const close = body.indexOf("]", i + 1);
      if (close < 0) break;
      const tok = body.slice(i + 1, close).trim();
      segs.push(tok === "*" ? "*" : tok.replace(/^["']|["']$/g, ""));
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < body.length && !".?[*".includes(body[end] ?? "")) end++;
    if (end > i) segs.push(body.slice(i, end));
    i = end > i ? end : i + 1;
  }
  function walk(cur: any, rest: string[]): unknown {
    if (rest.length === 0) return cur;
    const head = rest[0];
    const tail = rest.slice(1);
    if (head === "*") {
      if (!Array.isArray(cur)) return [];
      if (tail.length === 0) return cur;
      const out: unknown[] = [];
      for (const item of cur) {
        const v = walk(item, tail);
        if (Array.isArray(v)) out.push(...v);
        else if (v != null) out.push(v);
      }
      return out;
    }
    if (head && /^\d+$/.test(head)) {
      if (!Array.isArray(cur)) return undefined;
      const n = Number(head);
      return walk(cur[n >= 1 ? n - 1 : n], tail);
    }
    if (cur == null || typeof cur !== "object") return undefined;
    return walk(cur[head as string], tail);
  }
  return walk(node, segs);
}

export function igXpathNodes(evaluateXPathToNodes: XPathEval, path: string, node: unknown): unknown[] {
  if (path.trim().startsWith("/")) return evaluateXPathToNodes(path, node);
  const found = jsonWalk(path, node);
  if (Array.isArray(found)) return found;
  if (found == null) return [];
  return [found];
}

export function igXpathNode(evaluateXPathToFirstNode: XPathEval, path: unknown, node: unknown): unknown {
  const trimmed = (typeof path === "string" ? path : String(path ?? "")).trim();
  if (trimmed.startsWith("/")) return evaluateXPathToFirstNode(trimmed, node);
  if (!trimmed || trimmed === "$" || trimmed === ".") return node;
  const found = jsonWalk(trimmed, node);
  return found === undefined ? null : found;
}

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function listGetIndex(items: unknown, where: string, at: unknown = 1): unknown {
  const list = asList(items);
  if (where === "FIRST") return list[0] ?? null;
  if (where === "LAST") return list[list.length - 1] ?? null;
  const n = Number(at);
  if (where === "FROM_END") return list[list.length - n] ?? null;
  return list[n - 1] ?? null;
}

export function sameItem(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function setIntersection(a: unknown[], b: unknown[]): unknown[] {
  return a.filter((item) => b.some((other) => sameItem(item, other)));
}

export function setUnion(a: unknown[], b: unknown[]): unknown[] {
  const out = [...a];
  for (const item of b) {
    if (!out.some((other) => sameItem(item, other))) out.push(item);
  }
  return out;
}

export function setDifference(universe: unknown[], excluded: unknown[]): unknown[] {
  return universe.filter((item) => !excluded.some((other) => sameItem(item, other)));
}

function sheetOf(sheets: SheetBag, name: string): HelperSheet | undefined {
  return sheets[name];
}

export function igSheetGetCell(sheets: SheetBag, name: string, a1: string): unknown {
  const s = sheetOf(sheets, name);
  if (!s) return null;
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(a1).trim());
  if (!m) return null;
  let x = 0;
  for (const ch of m[1]!.toUpperCase()) x = x * 26 + (ch.charCodeAt(0) - 64);
  const row = s.values[Number(m[2]) - 1];
  return row ? row[x - 1] ?? null : null;
}

export function igSheetGetXy(sheets: SheetBag, name: string, x: number, y: number): unknown {
  const row = sheetOf(sheets, name)?.values[y];
  return row ? row[x] ?? null : null;
}

export function igSheetGetRow(sheets: SheetBag, name: string, y: number): unknown[] {
  return [...(sheetOf(sheets, name)?.values[y] ?? [])];
}

export function igSheetGetColumn(sheets: SheetBag, name: string, x: number): unknown[] {
  return (sheetOf(sheets, name)?.values ?? []).map((row) => row?.[x] ?? null);
}

export function igSheetGetHeader(sheets: SheetBag, name: string, x: number): string {
  return sheetOf(sheets, name)?.headers[x] ?? "";
}

export function igSheetGetData(sheets: SheetBag, name: string): unknown[][] {
  return (sheetOf(sheets, name)?.values ?? []).map((row) => [...row]);
}

export function igSheetLookup(
  sheets: SheetBag,
  name: string,
  matchCol: string | number,
  matchValue: unknown,
  returnCol?: string | number,
): unknown {
  const s = sheetOf(sheets, name);
  if (!s) return null;
  const idx = (ref: string | number) => {
    if (typeof ref === "number") return ref;
    const t = String(ref);
    const hi = s.headers.indexOf(t);
    if (hi >= 0) return hi;
    if (/^[A-Za-z]+$/.test(t)) {
      let n = 0;
      for (const ch of t.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n - 1;
    }
    if (/^\d+$/.test(t)) return Number(t);
    return -1;
  };
  const mi = idx(matchCol);
  const y = s.values.findIndex((row) => String(row?.[mi] ?? "") === String(matchValue ?? ""));
  if (y < 0) return null;
  if (returnCol === undefined || returnCol === null || returnCol === "") {
    const rec: Record<string, unknown> = {};
    s.headers.forEach((h: string, x: number) => {
      rec[h || String(x)] = s.values[y]![x];
    });
    return rec;
  }
  return s.values[y]![idx(returnCol)] ?? null;
}

export function igDecisionTable(
  sheets: SheetBag,
  name: string,
  inputs: Record<string, unknown> = {},
  outputCol?: string,
): unknown {
  const s = sheetOf(sheets, name);
  if (!s) return null;
  const dontCare = (c: unknown) =>
    c == null || (typeof c === "string" && ["", "—", "–", "-", "*"].includes(c.trim()));
  const width = s.headers.length;
  const meta = (s.decisionColumns ?? []).slice(0, width);
  while (meta.length < width) {
    meta.push({ role: meta.length === width - 1 && !(s.decisionColumns?.length) ? "output" : "condition" });
  }
  if (!(s.decisionColumns?.length) && width > 0) {
    for (let i = 0; i < width - 1; i++) meta[i] = { role: "condition" };
    meta[width - 1] = { role: "output", outputKind: "value", valueType: "string" };
  }
  const coerce = (v: unknown, t: string) => {
    if (v == null || v === "") return v;
    if (t === "number") {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : v;
    }
    if (t === "boolean") {
      if (typeof v === "boolean") return v;
      const x = String(v).trim().toLowerCase();
      if (x === "true") return true;
      if (x === "false") return false;
      return v;
    }
    return typeof v === "string" ? v : String(v);
  };
  const toNum = (v: unknown) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const pred = (cell: unknown) => {
    if (cell == null || typeof cell === "boolean" || dontCare(cell)) return null;
    const str = typeof cell === "number" ? String(cell) : String(cell).trim();
    const range = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/.exec(str);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      return { op: "range", a: Math.min(a, b), b: Math.max(a, b) };
    }
    const cmp = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(str);
    if (cmp) return { op: cmp[1] as string, a: Number(cmp[2]) };
    return null;
  };
  const holds = (p: { op: string; a: number; b?: number }, n: number) => {
    if (p.op === "range") return n >= p.a && n <= (p.b as number);
    if (p.op === ">=") return n >= p.a;
    if (p.op === ">") return n > p.a;
    if (p.op === "<=") return n <= p.a;
    if (p.op === "<") return n < p.a;
    return n === p.a;
  };
  const cellMatch = (cell: unknown, input: unknown) => {
    if (dontCare(cell)) return true;
    const p = pred(cell);
    if (p) {
      const n = toNum(input);
      return n != null && holds(p, n);
    }
    return String(cell ?? "") === String(input ?? "");
  };
  const cellOut = (y: number, oi: number) => {
    const cell = s.values[y]?.[oi];
    const kind = meta[oi]?.outputKind ?? "value";
    if (kind === "snippet") {
      const tpl = String(cell ?? "");
      return tpl.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_: string, key: string) => {
        const parts = key.split(".");
        let cur: unknown = inputs;
        for (const p of parts) {
          if (cur == null || typeof cur !== "object") return "";
          cur = (cur as Record<string, unknown>)[p];
        }
        return cur == null ? "" : String(cur);
      });
    }
    const t = meta[oi]?.valueType === "number" || meta[oi]?.valueType === "boolean"
      ? meta[oi]!.valueType!
      : "string";
    return coerce(cell ?? null, t);
  };
  const outIdx = outputCol && outputCol !== "*"
    ? s.headers.indexOf(outputCol)
    : meta.findIndex((m) => m.role === "output");
  const oi = outIdx >= 0 ? outIdx : Math.max(0, width - 1);
  const matches: number[] = [];
  for (let y = 0; y < s.values.length; y++) {
    if (s.rowCatchAll?.[y]) {
      if (matches.length === 0) matches.push(y);
      continue;
    }
    let ok = true;
    for (let x = 0; x < width; x++) {
      if (meta[x]?.role !== "condition") continue;
      if (!cellMatch(s.values[y]?.[x], inputs[s.headers[x]!])) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(y);
  }
  if (!matches.length) return null;
  const policy = s.hitPolicy ?? "FIRST";
  const all = outputCol === "*";
  const rowMap = (y: number) => {
    const rec: Record<string, unknown> = {};
    for (let x = 0; x < width; x++) {
      if (meta[x]?.role === "output") rec[s.headers[x] || String(x)] = cellOut(y, x);
    }
    return rec;
  };
  if (policy === "UNIQUE") {
    if (matches.length > 1) {
      throw new Error(`UNIQUE decision table "${name}" matched ${matches.length} rows`);
    }
    return all ? rowMap(matches[0]!) : cellOut(matches[0]!, oi);
  }
  if (policy === "COLLECT") {
    const join = s.collectJoin ?? "; ";
    const joinParts = (vals: unknown[]) => {
      const out = [];
      const seen = new Set();
      for (const p of vals) {
        if (p == null || (typeof p === "string" && p.trim() === "")) continue;
        const t = String(p);
        if (s.collectDedupe) {
          if (seen.has(t)) continue;
          seen.add(t);
        }
        out.push(t);
      }
      return out.join(join);
    };
    if (!all) return joinParts(matches.map((y) => cellOut(y, oi)));
    const rec: Record<string, unknown> = {};
    for (let x = 0; x < width; x++) {
      if (meta[x]?.role !== "output") continue;
      rec[s.headers[x] || String(x)] = joinParts(matches.map((y) => cellOut(y, x)));
    }
    return rec;
  }
  return all ? rowMap(matches[0]!) : cellOut(matches[0]!, oi);
}

export function igHandlebars(
  Handlebars: { create: () => any },
  template: string,
  context: unknown,
): string {
  const engine = Handlebars.create();
  registerKintegrateHandlebarsHelpers(engine);
  return engine.compile(template, { noEscape: true, data: true })(context ?? {});
}

export function partyValue(v: unknown, fallback: string): unknown {
  if (v == null || v === "") return fallback === "PARTY_SELF" ? { _type: "PARTY_SELF" } : undefined;
  if (typeof v === "string") {
    return v === "PARTY_SELF" ? { _type: "PARTY_SELF" } : { _type: "PARTY_IDENTIFIED", name: v };
  }
  if (typeof v !== "object" || Array.isArray(v) || "_type" in v) return v;
  if (Object.getPrototypeOf(v) !== Object.prototype) return v;
  const { rmType, ...rest } = v as Record<string, unknown>;
  const type = typeof rmType === "string" && rmType !== "PARTY_PROXY" ? rmType : fallback;
  return { _type: type, ...rest };
}

export function igCodedText(
  DV_CODED_TEXT: new (init: any) => unknown,
  text: unknown,
  choices: Array<[string, string, string]>,
): unknown {
  if (text && typeof text === "object" && !Array.isArray(text)) {
    const r = text as any;
    const dc = r.defining_code ?? {};
    const code = String(r.code_string ?? dc.code_string ?? "").trim();
    const term = r.terminology_id ?? dc.terminology_id;
    const termId = String(term && typeof term === "object" ? term.value ?? "" : term ?? "").trim();
    if (code) {
      return new DV_CODED_TEXT({
        value: String(r.value ?? code),
        defining_code: { terminology_id: termId || "local", code_string: code },
        ...(Array.isArray(r.mappings) ? { mappings: r.mappings } : {}),
      });
    }
    text = r.value;
  }
  const s = String(text ?? "").trim();
  if (!s) return undefined;
  const k = s.toLowerCase();
  const hits = choices.filter(([code, rubric]) =>
    code.trim().toLowerCase() === k || rubric.trim().toLowerCase() === k
  );
  if (hits.length !== 1) return new DV_CODED_TEXT({ value: s });
  const [code, rubric, terminology] = hits[0]!;
  return new DV_CODED_TEXT({
    value: rubric,
    defining_code: { terminology_id: terminology, code_string: code },
  });
}

export function __blankValue(x: unknown): boolean {
  if (x == null) return true;
  if (typeof x === "number") return !Number.isFinite(x);
  return typeof x === "string" && !x.trim();
}

export function __toNum(x: unknown): number {
  if (x == null || (typeof x === "string" && !x.trim())) return NaN;
  return Number(x);
}

export function __num(x: unknown, make: (magnitude: number) => unknown): unknown {
  const m = __toNum(x);
  return Number.isFinite(m) ? make(m) : undefined;
}

export function __filled(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v !== "object") return __blankValue(v) ? undefined : v;
  const o = v as any;
  if ("magnitude" in o && typeof o.magnitude === "number" && Number.isNaN(o.magnitude)) return undefined;
  if ("defining_code" in o) return v;
  if ("issuer" in o && "id" in o) return __blankValue(o.id) ? undefined : v;
  if ("value" in o && !("magnitude" in o) && __blankValue(o.value)) return undefined;
  return v;
}

export function __el(e: unknown): unknown {
  const o = e as any;
  return o.value == null && o.null_flavour == null ? undefined : e;
}

export function __tree(t: unknown): unknown {
  const items = (t as any).items;
  return Array.isArray(items) && !items.length ? undefined : t;
}

export function __toBool(x: unknown): unknown {
  if (typeof x === "boolean" || x == null) return x;
  const t = String(x).trim().toLowerCase();
  if (!t) return undefined;
  if (t === "true" || t === "false") return t === "true";
  return typeof x === "number" ? x !== 0 : Boolean(x);
}

export function __keep(items: unknown[]): unknown[] {
  return items.filter((x) => x !== undefined && x !== null);
}

export function rm(Type: new () => any, init: any): unknown {
  return Object.assign(new Type(), init);
}
