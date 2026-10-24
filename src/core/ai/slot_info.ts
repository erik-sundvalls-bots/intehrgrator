/**
 * Slot enrichment for the AI (#277 §1, §4–5 PR "enrichment"): meaning,
 * comments, bindings, ordinals, ranges, patterns, formats, examples and
 * value descriptions, read from the target definition and keyed by skeleton
 * slot id.
 *
 * - openEHR: the Web Template built from the OPT (`localizedDescriptions`,
 *   `annotations`, `termBindings`, `inputs[].validation`, list items).
 * - JSON Schema: the subschema at the slot's `$.path` (`description`,
 *   `$comment`, `enum` + `x-enumDescriptions`, `minimum` …, `pattern`,
 *   `minLength` / `maxLength`, `format`, `examples`, `default`, `x-i18n`).
 * - XSD: the element / attribute (`xs:documentation` per `xml:lang`, facets,
 *   `default` / `fixed`).
 *
 * Rows get short text (first sentence); `get_slot` gets everything. A parent's
 * documentation is given once on its group, never repeated on its slots.
 */
import type { SkeletonNode } from "../../types/mod.ts";
import { parseXsd, type XsdDoc, type XsdNode } from "../xsd/xsd_model.ts";

export interface SlotInfo {
  description?: string;
  /** Description per language code, when the target has several. */
  descriptions?: Record<string, string>;
  /** Label per language code, when the target has several. */
  labels?: Record<string, string>;
  comment?: string;
  annotations?: Record<string, string>;
  /** Term bindings, `TERMINOLOGY::code`. */
  bindings?: string[];
  ordinals?: Array<{ value: number; code: string; text: string }>;
  range?: { min?: number | string; max?: number | string; minExclusive?: number | string; maxExclusive?: number | string };
  /** Decimal places (openEHR precision, XSD fractionDigits). */
  precision?: number;
  pattern?: string;
  length?: { min?: number; max?: number; exact?: number };
  format?: string;
  examples?: unknown[];
  default?: unknown;
  /** Allowed values the skeleton does not list itself (JSON `enum`, XSD enumeration). */
  enum?: Array<{ code: string; text?: string }>;
  /** Description per allowed code. */
  valueDescriptions?: Record<string, string>;
}

export interface SlotInfoIndex {
  /** Value-slot information, by the skeleton id of the slot or its ELEMENT / element. */
  slots: Map<string, SlotInfo>;
  /** Group information (archetype roots, events, objects, complex elements), by skeleton id. */
  groups: Map<string, SlotInfo>;
}

export const EMPTY_SLOT_INFO: SlotInfoIndex = { slots: new Map(), groups: new Map() };

/** First sentence, at most `max` characters. */
export function shortText(text: string | undefined, max = 160): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const sentence = t.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? t;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

const VALUE_STEP = /^(value|[A-Z][A-Z0-9_]+|magnitude|units|defining_code|code_string|symbol|numerator|denominator|ordinal)$/;

/** Info for one value slot: its own entry or that of the nearest keyed ancestor (an openEHR ELEMENT / DV node). */
export function slotInfoFor(index: SlotInfoIndex, slotId: string): SlotInfo | undefined {
  let id = slotId;
  for (let i = 0; i < 8 && id; i++) {
    const hit = index.slots.get(id);
    if (hit) return hit;
    const cut = id.lastIndexOf("/");
    if (cut <= 0) break;
    // Climb only out of the value's own parts (`/value`, `/DV_CODED_TEXT`, `/magnitude` …), never
    // out of `name` or other siblings, so a node's text stays on its value.
    if (!VALUE_STEP.test(id.slice(cut + 1))) break;
    id = id.slice(0, cut);
  }
  return undefined;
}

// ── openEHR (Web Template) ──────────────────────────────────────────────────

interface WtInput {
  type?: string;
  suffix?: string;
  validation?: { range?: WtRange; precision?: WtRange };
  list?: Array<{ value?: string; label?: string; ordinal?: number; localizedLabels?: Record<string, string>; localizedDescriptions?: Record<string, string>; validation?: { range?: WtRange; precision?: WtRange } }>;
  defaultValue?: unknown;
}
interface WtRange { min?: number; minOp?: string; max?: number; maxOp?: string }
interface WtNode {
  aqlPath?: string;
  rmType?: string;
  name?: string;
  localizedNames?: Record<string, string>;
  localizedDescriptions?: Record<string, string>;
  localizedComments?: Record<string, string>;
  comment?: string;
  annotations?: Record<string, unknown>;
  termBindings?: Record<string, { value?: string; terminologyId?: string } | string>;
  inputs?: WtInput[];
  children?: WtNode[];
}

/** Web Template aqlPath → skeleton path: `/data[at0001]` → `/data/at0001`, name predicates dropped. */
export function aqlToSkeletonPath(aql: string): string {
  return aql.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const id = inner.split(",")[0]!.trim();
    return /^openEHR-/.test(id) ? `[${id}]` : `/${id}`;
  });
}

function rangeOf(r: WtRange | undefined): SlotInfo["range"] | undefined {
  if (!r) return undefined;
  const out: NonNullable<SlotInfo["range"]> = {};
  if (r.min !== undefined) {
    if (r.minOp === ">") out.minExclusive = r.min;
    else out.min = r.min;
  }
  if (r.max !== undefined) {
    if (r.maxOp === "<") out.maxExclusive = r.max;
    else out.max = r.max;
  }
  return Object.keys(out).length ? out : undefined;
}

function pick(map: Record<string, string> | undefined, lang: string): string | undefined {
  if (!map) return undefined;
  return map[lang] ?? map[lang.split("-")[0]!] ?? Object.values(map)[0];
}

function openEhrInfo(node: WtNode, lang: string): SlotInfo {
  const info: SlotInfo = {};
  const description = pick(node.localizedDescriptions, lang);
  if (description && description !== "*" && description !== pick(node.localizedNames, lang)) info.description = description;
  const comment = pick(node.localizedComments, lang) ?? node.comment;
  if (comment) info.comment = comment;
  if (node.annotations && Object.keys(node.annotations).length) {
    info.annotations = Object.fromEntries(Object.entries(node.annotations).map(([k, v]) => [k, String(v)]));
  }
  if (node.termBindings && Object.keys(node.termBindings).length) {
    info.bindings = Object.entries(node.termBindings).map(([term, b]) =>
      typeof b === "string" ? `${term}::${b}` : `${b.terminologyId ?? term}::${b.value ?? ""}`
    );
  }
  if (node.localizedNames && Object.keys(node.localizedNames).length > 1) info.labels = { ...node.localizedNames };
  if (node.localizedDescriptions && Object.keys(node.localizedDescriptions).length > 1) info.descriptions = { ...node.localizedDescriptions };
  for (const input of node.inputs ?? []) {
    const suffix = (input.suffix ?? "").toLowerCase();
    const numeric = input.type === "DECIMAL" || input.type === "INTEGER";
    if (numeric && (suffix === "magnitude" || suffix === "" || suffix === "value")) {
      const range = rangeOf(input.validation?.range);
      if (range) info.range = range;
      const p = input.validation?.precision;
      if (p?.max !== undefined && p.min === p.max) info.precision = p.max;
    }
    if (suffix === "unit" || suffix === "units") {
      // One unit: its magnitude range is the slot's range.
      if ((input.list?.length ?? 0) === 1) {
        const item = input.list![0]!;
        const range = rangeOf(item.validation?.range);
        if (range && !info.range) info.range = range;
        const p = item.validation?.precision;
        if (p?.max !== undefined && p.min === p.max && info.precision === undefined) info.precision = p.max;
      }
    }
    const list = input.list ?? [];
    if (list.some((i) => typeof i.ordinal === "number")) {
      info.ordinals = list.filter((i) => i.value).map((i) => ({
        value: Number(i.ordinal),
        code: String(i.value),
        text: pick(i.localizedLabels, lang) ?? i.label ?? "",
      }));
    }
    for (const item of list) {
      const d = pick(item.localizedDescriptions, lang);
      const text = pick(item.localizedLabels, lang) ?? item.label;
      if (item.value && d && d !== text && d !== "*") (info.valueDescriptions ??= {})[item.value] = d;
    }
    if (suffix !== "unit" && suffix !== "units" && input.defaultValue !== undefined && input.defaultValue !== "") {
      info.default = input.defaultValue;
    }
  }
  return info;
}

const VALUE_RM = /^(DV_|CODE_PHRASE$|PARTY_|DV$|ELEMENT$)/;

/**
 * One Web Template with the names and descriptions of several, matched by
 * `aqlPath` (#279): an OPT XML file gives one Web Template per language, and
 * `get_slot` wants every language. The first is the base; later ones only add
 * `localizedNames` / `localizedDescriptions` / value `localizedLabels` /
 * `localizedDescriptions` for languages the base does not have.
 */
export function mergeWebTemplateLanguages(jsons: Array<string | undefined>): string | undefined {
  const parsed = jsons.flatMap((j) => {
    if (!j) return [];
    try {
      const wt = JSON.parse(j) as { tree?: WtNode };
      return wt.tree ? [wt] : [];
    } catch {
      return [];
    }
  });
  if (parsed.length < 2) return jsons.find(Boolean);
  const [base, ...rest] = parsed;
  const byPath = new Map<string, WtNode>();
  const index = (node: WtNode) => {
    if (node.aqlPath !== undefined) { if (!byPath.has(node.aqlPath)) byPath.set(node.aqlPath, node); };
    node.children?.forEach(index);
  };
  index(base!.tree!);
  const add = (into: Record<string, string> | undefined, from: Record<string, string> | undefined) => {
    if (!from) return into;
    const out = { ...into };
    for (const [l, v] of Object.entries(from)) if (out[l] === undefined && v) out[l] = v;
    return Object.keys(out).length ? out : undefined;
  };
  const merge = (node: WtNode) => {
    const target = node.aqlPath !== undefined ? byPath.get(node.aqlPath) : undefined;
    if (target) {
      target.localizedNames = add(target.localizedNames, node.localizedNames);
      target.localizedDescriptions = add(target.localizedDescriptions, node.localizedDescriptions);
      (node.inputs ?? []).forEach((input, i) => {
        const into = target.inputs?.[i];
        if (!into || (into.suffix ?? "") !== (input.suffix ?? "")) return;
        for (const item of input.list ?? []) {
          const same = into.list?.find((x) => x.value === item.value);
          if (!same) continue;
          same.localizedLabels = add(same.localizedLabels, item.localizedLabels);
          same.localizedDescriptions = add(same.localizedDescriptions, item.localizedDescriptions);
        }
      });
    }
    node.children?.forEach(merge);
  };
  for (const wt of rest) merge(wt.tree!);
  return JSON.stringify(base);
}

export function openEhrSlotInfo(webTemplateJson: string | undefined, templateId: string, language = "en"): SlotInfoIndex {
  const index: SlotInfoIndex = { slots: new Map(), groups: new Map() };
  if (!webTemplateJson) return index;
  let wt: { tree?: WtNode; defaultLanguage?: string };
  try {
    wt = JSON.parse(webTemplateJson);
  } catch {
    return index;
  }
  const lang = language || wt.defaultLanguage || "en";
  const walk = (node: WtNode) => {
    if (node.aqlPath !== undefined) {
      const path = `${templateId}/${aqlToSkeletonPath(node.aqlPath)}`;
      const info = openEhrInfo(node, lang);
      if (Object.keys(info).length) {
        if (VALUE_RM.test(node.rmType ?? "")) index.slots.set(path, info);
        else index.groups.set(path, info);
      }
    }
    node.children?.forEach(walk);
  };
  if (wt.tree) walk(wt.tree);
  return index;
}

// ── JSON Schema ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function jsonInfo(schema: Json, lang?: string): SlotInfo {
  const info: SlotInfo = {};
  const i18n = (schema["x-i18n"] ?? {}) as Record<string, Json>;
  const localized = lang ? i18n[lang] ?? i18n[lang.split("-")[0]!] : undefined;
  const description = (localized?.description as string | undefined) ?? (schema.description as string | undefined);
  if (description) info.description = description;
  if (typeof schema.$comment === "string") info.comment = schema.$comment;
  const langs = Object.keys(i18n);
  if (langs.length) {
    const defaultLang = "default";
    const labels: Record<string, string> = {};
    const descriptions: Record<string, string> = {};
    if (typeof schema.title === "string") labels[defaultLang] = schema.title;
    if (typeof schema.description === "string") descriptions[defaultLang] = schema.description;
    for (const l of langs) {
      if (typeof i18n[l]?.title === "string") labels[l] = i18n[l]!.title as string;
      if (typeof i18n[l]?.description === "string") descriptions[l] = i18n[l]!.description as string;
    }
    if (Object.keys(labels).length > 1) info.labels = labels;
    if (Object.keys(descriptions).length > 1) info.descriptions = descriptions;
  }
  const range: NonNullable<SlotInfo["range"]> = {};
  if (typeof schema.minimum === "number") range.min = schema.minimum;
  if (typeof schema.maximum === "number") range.max = schema.maximum;
  if (typeof schema.exclusiveMinimum === "number") range.minExclusive = schema.exclusiveMinimum;
  if (typeof schema.exclusiveMaximum === "number") range.maxExclusive = schema.exclusiveMaximum;
  if (Object.keys(range).length) info.range = range;
  if (typeof schema.pattern === "string") info.pattern = schema.pattern;
  const length: NonNullable<SlotInfo["length"]> = {};
  if (typeof schema.minLength === "number") length.min = schema.minLength;
  if (typeof schema.maxLength === "number") length.max = schema.maxLength;
  if (Object.keys(length).length) info.length = length;
  if (typeof schema.format === "string") info.format = schema.format;
  if (Array.isArray(schema.examples) && schema.examples.length) info.examples = schema.examples.slice(0, 3);
  if (schema.default !== undefined) info.default = schema.default;
  if (Array.isArray(schema.enum)) {
    info.enum = schema.enum.filter((v) => v !== null).map((v) => ({ code: String(v) }));
  }
  const enumDesc = {
    ...(schema["x-enumDescriptions"] as Record<string, string> | undefined),
    ...(localized?.enumDescriptions as Record<string, string> | undefined),
  };
  if (Object.keys(enumDesc).length) info.valueDescriptions = enumDesc;
  return info;
}

export function jsonSchemaSlotInfo(schemaText: string, skeleton: SkeletonNode[], language?: string): SlotInfoIndex {
  const index: SlotInfoIndex = { slots: new Map(), groups: new Map() };
  let root: Json;
  try {
    root = JSON.parse(schemaText);
  } catch {
    return index;
  }
  const deref = (node: unknown, depth = 0): Json | undefined => {
    if (!node || typeof node !== "object") return undefined;
    const rec = node as Json;
    if (typeof rec.$ref === "string" && rec.$ref.startsWith("#/") && depth < 16) {
      let target: unknown = root;
      for (const part of rec.$ref.slice(2).split("/")) target = (target as Json | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      const resolved = deref(target, depth + 1);
      // Sibling keywords next to $ref (description, …) win.
      const { $ref: _r, ...siblings } = rec;
      return resolved ? { ...resolved, ...siblings } : undefined;
    }
    return rec;
  };
  const lang = language ?? (typeof root["x-lang"] === "string" ? root["x-lang"] as string : undefined);
  const at = (path: string): Json | undefined => {
    const steps = path.replace(/^\$/, "").match(/\.[^.[\]]+|\[[^\]]*\]/g) ?? [];
    let node = deref(root);
    for (const step of steps) {
      if (!node) return undefined;
      node = step.startsWith("[") ? deref(node.items) : deref((node.properties as Json | undefined)?.[step.slice(1)]);
    }
    return node;
  };
  const walk = (nodes: SkeletonNode[]) => {
    for (const n of nodes) {
      const path = n.targetPath ?? n.slotId.slice(n.slotId.indexOf(":$") + 1);
      if (path.startsWith("$")) {
        const schema = at(path);
        if (schema) {
          const info = jsonInfo(schema, lang);
          if (Object.keys(info).length) (n.children.length ? index.groups : index.slots).set(n.slotId, info);
        }
      }
      walk(n.children);
    }
  };
  walk(skeleton);
  return index;
}

// ── XSD ─────────────────────────────────────────────────────────────────────

function docFor(docs: readonly XsdDoc[], lang?: string): string | undefined {
  if (!docs.length) return undefined;
  const hit = lang ? docs.find((d) => d.lang === lang) ?? docs.find((d) => d.lang.split("-")[0] === lang.split("-")[0]) : undefined;
  return (hit ?? docs.find((d) => !d.lang) ?? docs[0])!.text;
}

function xsdInfo(node: XsdNode, lang?: string): SlotInfo {
  const info: SlotInfo = {};
  const description = docFor(node.docs, lang);
  if (description) info.description = description;
  const langs = node.docs.filter((d) => d.lang);
  if (langs.length > 1) info.descriptions = Object.fromEntries(langs.map((d) => [d.lang, d.text]));
  const f = node.facets;
  if (f) {
    const num = (v: string | undefined) => v === undefined ? undefined : (Number.isFinite(Number(v)) ? Number(v) : v);
    const range: NonNullable<SlotInfo["range"]> = {};
    if (f.minInclusive !== undefined) range.min = num(f.minInclusive);
    if (f.maxInclusive !== undefined) range.max = num(f.maxInclusive);
    if (f.minExclusive !== undefined) range.minExclusive = num(f.minExclusive);
    if (f.maxExclusive !== undefined) range.maxExclusive = num(f.maxExclusive);
    if (Object.keys(range).length) info.range = range;
    if (f.pattern?.length) info.pattern = f.pattern.join("|");
    const length: NonNullable<SlotInfo["length"]> = {};
    if (f.length !== undefined) length.exact = f.length;
    if (f.minLength !== undefined) length.min = f.minLength;
    if (f.maxLength !== undefined) length.max = f.maxLength;
    if (Object.keys(length).length) info.length = length;
    if (f.fractionDigits !== undefined) info.precision = f.fractionDigits;
    if (f.enumeration?.length) {
      info.enum = f.enumeration.map((e) => ({ code: e.value }));
      for (const e of f.enumeration) {
        const d = docFor(e.docs, lang);
        if (d) (info.valueDescriptions ??= {})[e.value] = d;
      }
    }
  }
  if (node.default !== undefined) info.default = node.default;
  return info;
}

export function xsdSlotInfo(xsdText: string, skeleton: SkeletonNode[], language?: string): SlotInfoIndex {
  const index: SlotInfoIndex = { slots: new Map(), groups: new Map() };
  const byPath = new Map<string, XsdNode>();
  try {
    const walk = (n: XsdNode) => {
      byPath.set(n.path, n);
      n.children.forEach(walk);
    };
    walk(parseXsd(xsdText).root);
  } catch {
    return index;
  }
  const visit = (nodes: SkeletonNode[]) => {
    for (const n of nodes) {
      const path = n.targetPath ?? n.slotId.slice(0, Math.floor(n.slotId.length / 2));
      const x = byPath.get(path);
      if (x) {
        const info = xsdInfo(x, language);
        if (Object.keys(info).length) (n.children.length ? index.groups : index.slots).set(n.slotId, info);
      }
      visit(n.children);
    }
  };
  visit(skeleton);
  return index;
}

/** Index for the loaded target, or empty when the format has no extra information. */
export function slotInfoForTarget(
  target: { format: string; content: string; webTemplateJson?: string; targetId: string; language?: string } | null,
  skeleton: SkeletonNode[],
): SlotInfoIndex {
  if (!target) return EMPTY_SLOT_INFO;
  if (target.format === "openehr-template") return openEhrSlotInfo(target.webTemplateJson, target.targetId, target.language);
  if (target.format === "json-schema") return jsonSchemaSlotInfo(target.content, skeleton, target.language);
  if (target.format === "xml-schema") return xsdSlotInfo(target.content, skeleton, target.language);
  return EMPTY_SLOT_INFO;
}
