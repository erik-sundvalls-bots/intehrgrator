/**
 * Compact slot tree for AI context (#277 §1–2): one short id per slot, rows
 * grouped under their repeating container (loop) or content ancestor, with
 * the group's path, label and RM type given once. Used by the copy & paste
 * prompt, the in-app chat context and `list_slots`.
 *
 * Ids in the tree are compact: the target id prefix is dropped
 * (`simple-diagnose-and-vitals//content[…]/…` → `/content[…]/…`,
 * `https://…/target.schema.json:$.systolic` → `$.systolic`, XSD
 * `/A/B:/A/B` → `/A/B`). Row ids are the tail after their group path, so the
 * slot id is `group` + `id`. `resolveSlotRef` maps every form back (full id,
 * compact id, a unique tail), so tools keep accepting today's slot ids.
 */
import { applyCodedTextSlots } from "../openehr/coded_text.ts";
import { termSetForRmAttribute } from "../openehr_term_catalog.ts";
import type { MappingModel, SkeletonNode } from "../../types/mod.ts";
import {
  collectValueSlots,
  findSkeletonTrail,
  nearestContentAncestor,
  nearestRepeatingContainer,
  pathLabelFromTrail,
} from "../skeleton/generate_skeleton.ts";
import { shortText, type SlotInfo, slotInfoFor, type SlotInfoIndex } from "./slot_info.ts";

/** One value slot in the tree. Empty fields are omitted. */
export interface SlotTreeRow {
  /** Tail after the group path (`group + id` is the compact slot id). */
  id: string;
  type: string;
  label?: string;
  /** The label in other AI context languages, by language code (#279). */
  labels?: Record<string, string>;
  mult?: string;
  mandatory?: boolean;
  /** Values pinned by the template: `units`, `code`, `terminology`. */
  fixed?: Record<string, string>;
  /** Allowed units of a quantity. */
  units?: string[];
  /** Allowed coded values; `terminology` is hoisted to the row when shared. */
  values?: Array<{ code: string; text?: string; description?: string; terminology?: string; assumed?: boolean }>;
  terminology?: string;
  /** Meaning, first sentence (`get_slot` has the full text). */
  description?: string;
  comment?: string;
  annotations?: Record<string, string>;
  bindings?: string[];
  ordinals?: Array<{ value: number; code: string; text: string }>;
  range?: SlotInfo["range"];
  precision?: number;
  pattern?: string;
  length?: SlotInfo["length"];
  format?: string;
  examples?: unknown[];
  /** More `examples` in the schema than listed. */
  examplesOmitted?: number;
  default?: unknown;
  /** Current mapping expression (`list_slots` only). */
  expr?: string;
}

export interface SlotTreeGroup {
  /** Compact path of the group node; the `attachSlotId` of a loop when `loop` is set. */
  group: string;
  label?: string;
  /** The group node's meaning, first sentence (never repeated on its slots). */
  description?: string;
  type?: string;
  mult?: string;
  /** Repeating container: map its children inside a `for_each_list` attached here. */
  loop?: true;
  /** Compact path of the enclosing loop group, for nested loops. */
  within?: string;
  slots: SlotTreeRow[];
}

/**
 * Target-id prefix removed from a slot id. Unknown shapes come back unchanged.
 */
export function compactSlotId(slotId: string): string {
  // XSD `path:path`.
  if (slotId.length % 2 === 1) {
    const half = (slotId.length - 1) / 2;
    if (slotId[half] === ":" && slotId.slice(0, half) === slotId.slice(half + 1)) return slotId.slice(0, half);
  }
  // JSON Schema `targetId:$.path`, XSD root `name:/Name`.
  const colon = slotId.lastIndexOf(":");
  if (colon > 0) {
    const rest = slotId.slice(colon + 1);
    if (rest.startsWith("$") || rest.startsWith("/")) return rest;
  }
  // openEHR `templateId//path` or `templateId/path`; the template root itself is `/`.
  if (slotId.startsWith("/") || slotId.startsWith("$")) return slotId;
  const slash = slotId.indexOf("/");
  if (slash > 0) return `/${slotId.slice(slash).replace(/^\/+/, "")}`;
  return "/";
}

const collapse = (id: string) => id.replace(/\/{2,}/g, "/");

/**
 * Compact id per slot id. When two slots of different targets (a target
 * file set) would share a compact id, both keep their full ids.
 */
export function compactSlotIdMap(slotIds: Iterable<string>): Map<string, string> {
  const byCompact = new Map<string, string[]>();
  for (const id of slotIds) {
    const c = compactSlotId(id);
    byCompact.set(c, [...(byCompact.get(c) ?? []), id]);
  }
  const out = new Map<string, string>();
  for (const [c, ids] of byCompact) {
    const unique = new Set(ids);
    for (const id of unique) out.set(id, unique.size === 1 ? c : id);
  }
  return out;
}

const refIndexCache = new WeakMap<ReadonlySet<string>, { compact: Map<string, string>; full: Map<string, string> }>();

function refIndex(known: ReadonlySet<string>) {
  let index = refIndexCache.get(known);
  if (!index) {
    const compact = new Map<string, string>();
    const full = new Map<string, string>();
    for (const [id, c] of compactSlotIdMap(known)) {
      compact.set(collapse(c), id);
      full.set(collapse(id), id);
    }
    index = { compact, full };
    refIndexCache.set(known, index);
  }
  return index;
}

/**
 * A slot reference from an AI or agent as a known slot id: the full id, a
 * `templateId//path` variant, the compact id from the slot tree, or a tail
 * (`/time/value`, `.systolic`) that ends exactly one known id. Null when none
 * or more than one slot matches.
 */
export function resolveSlotRef(ref: string, known: ReadonlySet<string>): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (known.has(trimmed)) return trimmed;
  const key = collapse(trimmed);
  const index = refIndex(known);
  const hit = index.full.get(key) ?? index.compact.get(key) ??
    // A root-group row id ("context/…", without the group's "/").
    (/^[A-Za-z_]/.test(key) ? index.compact.get(`/${key}`) : undefined);
  if (hit) return hit;
  // A tail of one compact id, starting at a path step.
  if (!/^[/.[@]/.test(key) || key === "/" || key === ".") return null;
  let found: string | null = null;
  for (const [c, id] of index.compact) {
    if (c.length > key.length && c.endsWith(key)) {
      if (found && found !== id) return null;
      found = id;
    }
  }
  return found;
}

/**
 * A node-path prefix (lease `subtree`) as the full-id prefix: a compact
 * prefix of some slot is turned back into that slot's full form.
 */
export function resolveSlotPrefix(ref: string, known: ReadonlySet<string>): string {
  const trimmed = ref.trim();
  if (!trimmed) return trimmed;
  for (const id of known) if (id === trimmed || id.startsWith(`${trimmed}/`)) return trimmed;
  for (const [id, c] of compactSlotIdMap(known)) {
    // The compact id is the end of the full id, so cut the full id at the same place.
    if (c !== id && c.startsWith(`${trimmed}/`) && id.endsWith(c)) {
      return id.slice(0, id.length - (c.length - trimmed.length));
    }
  }
  return trimmed;
}

function tailAfter(compact: string, group: string): string {
  // Root group "/": rows are "context/…", so group + id is "/context/…", not "//context/…" (#312).
  if (group === "/" && compact.startsWith("/")) return compact.slice(1);
  if (group && compact.startsWith(group) && compact.length > group.length) {
    const rest = compact.slice(group.length);
    if (/^[/.[@]/.test(rest)) return rest;
  }
  return compact;
}

/**
 * Codes of an openEHR RM terminology attribute (`…/EVENT_CONTEXT/setting/value`
 * → setting 225 home, 227 emergency care, …) when the template node itself
 * has no value set (#320).
 */
export function terminologyValuesForSlot(
  slotId: string,
): { terminologyId: string; values: Array<{ code: string; text: string }> } | undefined {
  const match = /\/([A-Z][A-Z0-9_]+)\/([a-z_]+)\/value$/.exec(slotId);
  if (!match) return undefined;
  const set = termSetForRmAttribute(match[1]!, match[2]!);
  if (!set?.codes.length) return undefined;
  return {
    terminologyId: set.terminologyId,
    values: set.codes.map((code) => ({ code: code.code, text: code.rubric })),
  };
}

function valueSetRows(node: SkeletonNode): Pick<SlotTreeRow, "values" | "terminology"> {
  const values = node.allowedValues ?? [];
  if (!values.length) return {};
  const terms = new Set(values.map((v) => v.terminologyId ?? ""));
  const shared = terms.size === 1 ? [...terms][0] : undefined;
  return {
    ...(shared ? { terminology: shared } : {}),
    values: values.map((v) => ({
      code: v.code,
      text: v.label,
      ...(!shared && v.terminologyId ? { terminology: v.terminologyId } : {}),
      ...(v.assumed ? { assumed: true } : {}),
    })),
  };
}

/** Last named step of a path (`/a/@b` → `b`, `$.x.y` → `y`), ignoring `value` and RM type steps. */
function lastStepName(id: string): string {
  const steps = id.split(/[/.]/).map((p) => p.replace(/^@/, "").replace(/\[.*$/, "")).filter(Boolean);
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step !== "value" && !/^[A-Z][A-Z0-9_]+$/.test(step)) return step;
  }
  return "";
}

function rowFor(
  node: SkeletonNode,
  id: string,
  model?: Map<string, string>,
  info?: SlotInfo,
  extra?: Array<[string, Map<string, string>]>,
): SlotTreeRow {
  const fixed: Record<string, string> = {};
  const ff = node.fixedFields ?? {};
  if (ff.units) fixed.units = String(ff.units);
  if (ff.code_string || ff.defining_code) fixed.code = String(ff.code_string ?? ff.defining_code);
  if (ff.terminology_id) fixed.terminology = String(ff.terminology_id);
  const label = node.label?.trim();
  const values = valueSetRows(node);
  const expr = model?.get(node.slotId);
  const description = shortText(info?.description);
  const vd = info?.valueDescriptions ?? {};
  let rowValues = values.values;
  if (!rowValues && info?.enum?.length) rowValues = info.enum.map((e) => ({ code: e.code, ...(e.text ? { text: e.text } : {}) }));
  if (!rowValues) {
    const fromRm = terminologyValuesForSlot(node.slotId);
    if (fromRm?.values.length) rowValues = fromRm.values;
  }
  if (rowValues && Object.keys(vd).length) {
    rowValues = rowValues.map((v) => vd[v.code] ? { ...v, description: shortText(vd[v.code], 100) } : v);
  }
  const ordinals = info?.ordinals ?? (node.allowedOrdinals?.length
    ? node.allowedOrdinals.map((o) => ({ value: o.value, code: o.code, text: o.label }))
    : undefined);
  const labels = extraLabelsFor(node.slotId, label, extra, info);
  return {
    id,
    type: node.rmType,
    // A label that only repeats the type, the path's last name or the documentation adds nothing.
    ...(label && label !== node.rmType && label !== lastStepName(id) && label !== info?.description?.trim() ? { label } : {}),
    ...(labels ? { labels } : {}),
    ...(description ? { description } : {}),
    ...(node.multiplicity ? { mult: node.multiplicity } : {}),
    ...(node.mandatory ? { mandatory: true } : {}),
    ...(Object.keys(fixed).length ? { fixed } : {}),
    ...(node.allowedUnits?.length ? { units: [...node.allowedUnits] } : {}),
    ...(values.terminology && !fixed.terminology ? { terminology: values.terminology } : {}),
    ...(rowValues ? { values: rowValues } : {}),
    ...(ordinals?.length ? { ordinals } : {}),
    ...(info?.range ? { range: info.range } : {}),
    ...(info?.precision !== undefined ? { precision: info.precision } : {}),
    ...(info?.pattern ? { pattern: info.pattern } : {}),
    ...(info?.length ? { length: info.length } : {}),
    ...(info?.format ? { format: info.format } : {}),
    ...(info?.examples?.length ? { examples: info.examples } : {}),
    ...(info?.examplesOmitted ? { examplesOmitted: info.examplesOmitted } : {}),
    ...(info?.default !== undefined ? { default: info.default } : {}),
    ...(info?.comment ? { comment: shortText(info.comment) } : {}),
    ...(info?.annotations ? { annotations: info.annotations } : {}),
    ...(info?.bindings?.length ? { bindings: info.bindings } : {}),
    ...(expr ? { expr } : {}),
  };
}

export interface BuildSlotTreeOptions {
  /** Only these slots (default: every value slot). */
  include?: (slot: SkeletonNode) => boolean;
  /** Add the current mapping expression to rows (`list_slots`). */
  model?: MappingModel;
  /** Descriptions, ranges, value texts … from the target definition (#277 enrichment). */
  info?: SlotInfoIndex;
  /**
   * Extra AI context languages (after `target.lang.1`, whose labels the skeleton
   * already has): slot id → label per language, added as `labels` when they differ (#279).
   */
  extraLabels?: Array<[string, Map<string, string>]>;
}

function langPick(map: Record<string, string> | undefined, lang: string): string | undefined {
  if (!map) return undefined;
  return map[lang] ?? map[lang.split("-")[0]!];
}

/** `labels` of a row: the label in each extra language that differs from the row's own. */
function extraLabelsFor(
  slotId: string,
  label: string | undefined,
  extra: Array<[string, Map<string, string>]> | undefined,
  info: SlotInfo | undefined,
): Record<string, string> | undefined {
  if (!extra?.length) return undefined;
  const out: Record<string, string> = {};
  for (const [lang, map] of extra) {
    const text = (map.get(slotId) ?? langPick(info?.labels, lang))?.trim();
    if (text && text !== label) out[lang] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Group the value slots under their loop / content ancestor, in skeleton order. */
export function buildSlotTree(input: SkeletonNode[], options: BuildSlotTreeOptions = {}): SlotTreeGroup[] {
  // A DV_TEXT slot mapped as DV_CODED_TEXT shows that type (#274).
  const skeleton = options.model ? applyCodedTextSlots(input, options.model.slots) : input;
  const all = collectValueSlots(skeleton);
  const seen = new Set<string>();
  const slots = all.filter((s) => {
    if (seen.has(s.slotId)) return false;
    seen.add(s.slotId);
    return options.include ? options.include(s) : true;
  });
  const ids = new Set<string>();
  const collect = (nodes: SkeletonNode[]) => {
    for (const n of nodes) {
      ids.add(n.slotId);
      collect(n.children);
    }
  };
  collect(skeleton);
  const compact = compactSlotIdMap(ids);
  const c = (id: string) => compact.get(id) ?? compactSlotId(id);
  const exprs = options.model
    ? new Map(options.model.slots.filter((s) => s.expression).map((s) => [s.slotId, s.expression!]))
    : undefined;

  const groups = new Map<string, SlotTreeGroup>();
  for (const slot of slots) {
    const trail = findSkeletonTrail(skeleton, slot.slotId);
    const ancestors = trail.slice(0, -1);
    const loop = nearestRepeatingContainer(ancestors);
    const owner = loop ?? nearestContentAncestor(trail) ?? ancestors.at(-1) ?? null;
    const key = owner ? c(owner.slotId) : "";
    let group = groups.get(key);
    if (!group) {
      const ownerTrail = owner ? findSkeletonTrail(skeleton, owner.slotId) : [];
      // The root's name (template id / root element) would repeat in every group.
      const label = owner ? pathLabelFromTrail(ownerTrail.length > 1 ? ownerTrail.slice(1) : ownerTrail) : undefined;
      const outer = loop ? nearestRepeatingContainer(ownerTrail.slice(0, -1)) : null;
      const groupDoc = owner ? options.info?.groups.get(owner.slotId)?.description?.trim() : undefined;
      const groupDescription = shortText(groupDoc);
      group = {
        group: key,
        // XSD labels are the documentation: give it once, as the description.
        ...(label && label !== groupDoc ? { label } : {}),
        ...(groupDescription ? { description: groupDescription } : {}),
        ...(owner ? { type: owner.rmType } : {}),
        ...(owner?.multiplicity ? { mult: owner.multiplicity } : {}),
        ...(loop ? { loop: true as const } : {}),
        ...(outer ? { within: c(outer.slotId) } : {}),
        slots: [],
      };
      groups.set(key, group);
    }
    const info = options.info ? slotInfoFor(options.info, slot.slotId) : undefined;
    group.slots.push(rowFor(slot, key ? tailAfter(c(slot.slotId), key) : c(slot.slotId), exprs, info, options.extraLabels));
  }
  return [...groups.values()];
}

/** One group per line, its rows one per line: valid JSON without indentation tokens. */
export function formatSlotTree(groups: SlotTreeGroup[]): string {
  if (!groups.length) return "[]";
  const lines = groups.map((g) => {
    const { slots, ...head } = g;
    const headJson = JSON.stringify(head).slice(0, -1);
    return `${headJson},"slots":[\n${slots.map((r) => JSON.stringify(r)).join(",\n")}]}`;
  });
  return `[\n${lines.join(",\n")}\n]`;
}

/** Slot-tree reading guide, shared by the prompt and the tool description. */
export const SLOT_TREE_GUIDE =
  "Groups hold the slots under one repeating container (`loop`, map its children inside a `for_each_list` with `attachSlotId` = `group`) or one archetype/parent node. A slot id is `group` + row `id` (e.g. `/a/b` + `/c/value` → `/a/b/c/value`; the root group `/` + `context/start_time/value` → `/context/start_time/value`); the full ids from older prompts and list_slots `view: \"rows\"` work too. `fixed` values are set by the template; `values` / `units` are the allowed choices. A `DV_TEXT` slot may also be mapped as `DV_CODED_TEXT`. `label` and `description` are in the first listed target language; `labels` gives the label in other languages the source uses.";
