/**
 * Kintegrate Handlebars helpers (VMS-Hbs).
 *
 * Generated `.hbs` files do not paste these functions. Mapping preview,
 * Handlebars output, the Go Template host callback, the XQuery
 * `intehrgrator:handlebars` function, and generated TypeScript (`igHandlebars`)
 * all register this same set. Java registers the same names in
 * `HandlebarsSupport.java`.
 *
 * `inc` / `dec` match Kintegrate Integration Builder: `(v) => v + 1` and
 * `(v) => v - 1`. `{{inc @index}}` is the 1-based row number inside `#each`.
 * `+` follows JavaScript (a string concatenates); `-` is numeric.
 *
 * This module has no package imports so generated TypeScript can load it from
 * the raw GitHub URL.
 */

import { blocklyOp } from "./blockly_ops.ts";
import { formatNumber, numberFormForRmAttribute, stringifyJson } from "../numeric_format.ts";

export interface KintegrateHandlebarsOptions {
  data?: {
    index?: number;
    first?: boolean;
    last?: boolean;
    len?: number;
    root?: {
      _slots?: Record<string, unknown>;
      _defaults?: Record<string, unknown>;
      _sheets?: Record<string, unknown>;
    };
  };
  hash?: Record<string, unknown>;
  fn?: (context: unknown, opts?: { data?: KintegrateHandlebarsOptions["data"] }) => string;
  inverse?: (context?: unknown) => string;
}

/** `(v) => v + 1` — JavaScript `+`, so a string concatenates. */
export function hbsInc(value: unknown): unknown {
  return (value as number) + 1;
}

/** `(v) => v - 1` — JavaScript numeric `-`. */
export function hbsDec(value: unknown): unknown {
  return (value as number) - 1;
}

function hbsNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

function hbsToNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hbsEscapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hbsWriteRmXmlNode(
  tag: string,
  val: unknown,
  isRoot: boolean,
  depth: number,
  out: string[],
  parentRmType?: string,
  parentPrecision?: number,
): void {
  if (val === null || val === undefined) return;
  if (Array.isArray(val)) {
    for (const item of val) hbsWriteRmXmlNode(tag, item, isRoot, depth, out);
    return;
  }
  const indent = "  ".repeat(depth);
  if (typeof val === "object") {
    const rec = val as Record<string, unknown>;
    let open = `${indent}<${tag}`;
    if (isRoot) {
      open += ' xmlns="http://schemas.openehr.org/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
    }
    if (typeof rec._type === "string" && rec._type) {
      open += ` xsi:type="${hbsEscapeXml(rec._type)}"`;
    }
    if (typeof rec.archetype_node_id === "string" && rec.archetype_node_id) {
      open += ` archetype_node_id="${hbsEscapeXml(rec.archetype_node_id)}"`;
    }
    const keys = Object.keys(rec)
      .filter((k) => k !== "_type" && k !== "archetype_node_id")
      .sort();
    const childLines: string[] = [];
    for (const k of keys) {
      let child = rec[k];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child) && child.length === 0) continue;
      if (k === "terminology_id" && typeof child !== "object") {
        child = { _type: "TERMINOLOGY_ID", value: String(child) };
      }
      const precision = typeof rec.precision === "number" ? rec.precision : parentPrecision;
      hbsWriteRmXmlNode(k, child, false, depth + 1, childLines, typeof rec._type === "string" ? rec._type : parentRmType, precision);
    }
    if (childLines.length) {
      out.push(`${open}>\n`, ...childLines, `${indent}</${tag}>\n`);
    } else {
      out.push(`${open}/>\n`);
    }
    return;
  }
  if (typeof val === "number") {
    const form = numberFormForRmAttribute(parentRmType, tag, "xml");
    const precision = tag === "magnitude" || tag === "numerator" || tag === "denominator"
      ? parentPrecision
      : undefined;
    const text = formatNumber(val, form, { precision }).text;
    out.push(`${indent}<${tag}>${hbsEscapeXml(text)}</${tag}>\n`);
    return;
  }
  out.push(`${indent}<${tag}>${hbsEscapeXml(String(val))}</${tag}>\n`);
}

function hbsSameItem(a: unknown, b: unknown): boolean {
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

function hbsAsList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

/**
 * Value helpers for generated Handlebars scripts (issue #394). Same names and
 * meaning as the Go Template FuncMap (`go/texttemplate/main.go`), so both
 * generated scripts read alike and match Mapping preview.
 */
export const intehrgratorValueHelpers = {
  /** Mapping preview equality: strict, numbers by value, lists and maps by JSON. */
  same: (a: unknown, b: unknown) => hbsSameItem(a, b),
  /** `Number(a) <op> Number(b)` with op lt / le / gt / ge. */
  cmpNum: (op: unknown, a: unknown, b: unknown) => {
    const x = Number(a);
    const y = Number(b);
    switch (String(op)) {
      case "lt":
        return x < y;
      case "le":
        return x <= y;
      case "gt":
        return x > y;
      case "ge":
        return x >= y;
    }
    return false;
  },
  /** Value if-then-else with JavaScript truthiness; an empty THEN stays empty. */
  ifElse: (cond: unknown, t: unknown, f: unknown) => (cond ? t : f),
  /** switchVal value key1 val1 … default */
  switchVal: (...args: unknown[]) => {
    const params = args.slice(0, -1);
    if (params.length < 2) return null;
    const [value, ...rest] = params;
    const fallback = rest.pop();
    for (let i = 0; i + 1 < rest.length; i += 2) {
      if (hbsSameItem(value, rest[i])) return rest[i + 1];
    }
    return fallback;
  },
  title: (v: unknown) =>
    v == null ? "" : String(v).replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  round: (v: unknown) => Math.round(Number(v ?? 0)),
  mod: (a: unknown, b: unknown) => {
    const d = Number(b ?? 1);
    return d === 0 ? null : Number(a ?? 0) % d;
  },
  clamp: (v: unknown, lo: unknown, hi: unknown) => Math.min(Number(hi ?? 0), Math.max(Number(lo ?? 0), Number(v ?? 0))),
  /** 1-based list item (FIRST / LAST / FROM_START / FROM_END), null outside the list. */
  listAt: (items: unknown, where: unknown, at: unknown) => {
    const list = hbsAsList(items);
    const n = Number(at ?? 1);
    const w = String(where);
    const i = w === "FIRST" ? 0 : w === "LAST" ? list.length - 1 : w === "FROM_END" ? list.length - n : n - 1;
    return i >= 0 && i < list.length ? list[i] : null;
  },
  count: (v: unknown) => hbsAsList(v).length,
  /** Blockly text / math / list block (`blocklyOp`, issue #393). */
  blk: (name: unknown, ...rest: unknown[]) => blocklyOp(String(name), ...rest.slice(0, -1)),
};

export const kintegrateHandlebarsHelpers = {
  eq: (left: unknown, right: unknown) => left === right,
  ne: (left: unknown, right: unknown) => left !== right,
  lt: (left: unknown, right: unknown) => Number(left) < Number(right),
  gt: (left: unknown, right: unknown) => Number(left) > Number(right),
  lte: (left: unknown, right: unknown) => Number(left) <= Number(right),
  gte: (left: unknown, right: unknown) => Number(left) >= Number(right),
  and: (...args: unknown[]) => args.slice(0, -1).every(Boolean),
  or: (...args: unknown[]) => args.slice(0, -1).some(Boolean),
  not: (val: unknown) => !hbsNonEmpty(val),
  inc: hbsInc,
  dec: hbsDec,
  toLowerCase: (value: unknown) => value == null ? value : String(value).toLowerCase(),
  toUpperCase: (value: unknown) => value == null ? value : String(value).toUpperCase(),
  trim: (value: unknown) => value == null ? "" : String(value).trim(),
  /** Every regex match replaced with literal text (`regex_replace` Mapping Expression). */
  regexReplace: (src: unknown, pattern: unknown, replacement: unknown) =>
    String(src ?? "").replace(new RegExp(String(pattern ?? ""), "gu"), () => String(replacement ?? "")),
  replace: (src: unknown, oldVal: unknown, newVal: unknown) =>
    String(src ?? "").replaceAll(String(oldVal ?? ""), String(newVal ?? "")),
  concat: (...args: unknown[]) =>
    args.slice(0, -1).filter((v) => v !== null && v !== undefined).map(String).join(""),
  coalesce: (...args: unknown[]) => {
    for (const v of args.slice(0, -1)) {
      if (hbsNonEmpty(v)) return v;
    }
    return null;
  },
  nonEmpty: (val: unknown) => hbsNonEmpty(val),
  whenVal: (cond: unknown, val: unknown) => {
    if (typeof cond === "boolean") return cond ? val : null;
    return hbsNonEmpty(cond) ? val : null;
  },
  toNum: (val: unknown) => hbsToNum(val),
  add: (a: unknown, b: unknown) => Number(a ?? 0) + Number(b ?? 0),
  sub: (a: unknown, b: unknown) => Number(a ?? 0) - Number(b ?? 0),
  mul: (a: unknown, b: unknown) => Number(a ?? 0) * Number(b ?? 0),
  div: (a: unknown, b: unknown) => {
    const d = Number(b ?? 0);
    return d === 0 ? 0 : Number(a ?? 0) / d;
  },
  jget: (...args: unknown[]) => {
    const params = args.slice(0, -1);
    let cur: unknown = params[0];
    for (let i = 1; i < params.length; i++) {
      if (cur === null || cur === undefined) return null;
      const seg = params[i];
      if (Array.isArray(cur)) {
        const idx = typeof seg === "number" ? seg : Number(seg);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return null;
        cur = cur[idx];
      } else if (typeof cur === "object") {
        cur = (cur as Record<string, unknown>)[String(seg)];
      } else {
        return null;
      }
    }
    return cur ?? null;
  },
  defaultVal(this: unknown, key: unknown, options: KintegrateHandlebarsOptions) {
    return options.data?.root?._defaults?.[String(key)] ?? null;
  },
  dict(this: unknown, options: KintegrateHandlebarsOptions) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(options.hash ?? {})) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  },
  list: (...args: unknown[]) => {
    const out: unknown[] = [];
    for (const item of args.slice(0, -1)) {
      if (item === null || item === undefined) continue;
      if (Array.isArray(item)) {
        for (const sub of item) {
          if (sub !== null && sub !== undefined) out.push(sub);
        }
      } else {
        out.push(item);
      }
    }
    return out;
  },
  rmObj(this: unknown, options: KintegrateHandlebarsOptions) {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(options.hash ?? {})) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      m[k] = v;
    }
    const t = typeof m._type === "string" ? m._type : "";
    if (t === "ELEMENT" && !("value" in m)) return null;
    if ((t === "ITEM_TREE" || t === "SECTION" || t === "CLUSTER") && !("items" in m)) return null;
    if ((t === "EVENT" || t === "POINT_EVENT" || t === "INTERVAL_EVENT" || t === "OBSERVATION" || t === "EVALUATION") && !("data" in m)) return null;
    if ((t === "ACTIVITY" || t === "ACTION") && !("description" in m)) return null;
    if (t === "HISTORY" && !("events" in m)) return null;
    if (t === "INSTRUCTION" && !("activities" in m)) return null;
    return m;
  },
  partyVal: (val: unknown, fallbackType: unknown) => {
    const fb = typeof fallbackType === "string" && fallbackType ? fallbackType : "PARTY_IDENTIFIED";
    if (val === null || val === undefined) {
      return fb === "PARTY_SELF" ? { _type: "PARTY_SELF" } : null;
    }
    if (typeof val === "object" && !Array.isArray(val)) {
      const src = val as Record<string, unknown>;
      const t = typeof src._type === "string" && src._type ? src._type : fb;
      const rec: Record<string, unknown> = { _type: t };
      for (const [k, v] of Object.entries(src)) {
        if (k === "_type") continue;
        if (t === "PARTY_IDENTIFIED" && k !== "name" && k !== "external_ref" && k !== "identifiers") {
          continue;
        }
        if (t === "PARTY_SELF" && k !== "external_ref") continue;
        rec[k] = v;
      }
      return rec;
    }
    const s = String(val).trim();
    if (!s) return fb === "PARTY_SELF" ? { _type: "PARTY_SELF" } : null;
    return { _type: "PARTY_IDENTIFIED", name: s };
  },
  codePhrase: (val: unknown, terminology: unknown) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "object" && !Array.isArray(val)) return val;
    const s = String(val).trim();
    if (!s) return null;
    return {
      _type: "CODE_PHRASE",
      terminology_id: { _type: "TERMINOLOGY_ID", value: String(terminology ?? "") },
      code_string: s,
    };
  },
  codedText: (...args: unknown[]) => {
    const params = args.slice(0, -1);
    const val = params[0];
    const terminology = String(params[1] ?? "openehr");
    const pairs = params.slice(2).map(String);
    if (val === null || val === undefined) return null;
    if (typeof val === "object" && !Array.isArray(val)) return val;
    const raw = String(val).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const code = pair.slice(0, eq);
      const label = pair.slice(eq + 1);
      if (lower === label.toLowerCase() || lower === code.toLowerCase()) {
        return {
          _type: "DV_CODED_TEXT",
          value: label,
          defining_code: {
            _type: "CODE_PHRASE",
            terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
            code_string: code,
          },
        };
      }
    }
    return {
      _type: "DV_CODED_TEXT",
      value: raw,
      defining_code: {
        _type: "CODE_PHRASE",
        terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
        code_string: "",
      },
    };
  },
  dvVal: (rmType: unknown, val: unknown, prop: unknown, options: KintegrateHandlebarsOptions) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "object" && !Array.isArray(val)) return val;
    const typeStr = String(rmType ?? "DV_TEXT");
    const propStr = String(prop ?? "value");
    let outVal: unknown = val;
    if (
      typeStr === "DV_QUANTITY" || typeStr === "DV_COUNT" ||
      typeStr === "DV_ORDINAL" || typeStr === "DV_PROPORTION"
    ) {
      const num = hbsToNum(val);
      if (num === null) return null;
      outVal = num;
    } else if (typeStr === "DV_BOOLEAN") {
      if (typeof val === "boolean") outVal = val;
      else {
        const l = String(val).trim().toLowerCase();
        if (l === "true" || l === "1") outVal = true;
        else if (l === "false" || l === "0") outVal = false;
        else return null;
      }
    } else {
      const s = String(val);
      if (!s.trim()) return null;
      outVal = s;
    }
    const res: Record<string, unknown> = { _type: typeStr, [propStr]: outVal };
    for (const [k, v] of Object.entries(options?.hash ?? {})) {
      if (v !== null && v !== undefined) res[k] = v;
    }
    return res;
  },
  toJson: (val: unknown) => stringifyJson(val ?? null),
  rmToXml: (tag: unknown, val: unknown) => {
    let target = val;
    if (typeof target === "string" && target.trim().startsWith("{")) {
      try {
        target = JSON.parse(target);
      } catch {
        // leave as string
      }
    }
    const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
    hbsWriteRmXmlNode(String(tag ?? "composition"), target, true, 0, out);
    return out.join("");
  },
  rmToXmlFrag: (tag: unknown, val: unknown) => {
    const out: string[] = [];
    hbsWriteRmXmlNode(String(tag ?? "item"), val, false, 1, out);
    return out.join("");
  },
  slot(this: unknown, slotId: unknown, options: KintegrateHandlebarsOptions) {
    return options.data?.root?._slots?.[String(slotId)];
  },
  /**
   * `#each` plus a precomputed `@len` (the collection length at entry).
   * Used so Loop length works inside a generated Handlebars loop (#394).
   */
  eachLen(this: unknown, list: unknown, options: KintegrateHandlebarsOptions) {
    const items = hbsAsList(list);
    if (typeof options.fn !== "function") return items;
    const data = Object.create(options.data ?? null) as NonNullable<KintegrateHandlebarsOptions["data"]>;
    data.len = items.length;
    const chunks: string[] = [];
    for (let i = 0; i < items.length; i++) {
      data.index = i;
      data.first = i === 0;
      data.last = i === items.length - 1;
      chunks.push(options.fn(items[i], { data }));
    }
    return chunks.join("");
  },
  ...intehrgratorValueHelpers,
};

export function registerKintegrateHandlebarsHelpers(
  engine: { registerHelper: (helpers: typeof kintegrateHandlebarsHelpers) => void },
): void {
  engine.registerHelper(kintegrateHandlebarsHelpers);
}
