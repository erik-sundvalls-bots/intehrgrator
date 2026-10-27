/**
 * Compact inspect payloads for Agent API / MCP (no DOM).
 */

import type { AllowedValue, MappingModel, SchemaTreeNode, SkeletonNode } from "../types/mod.ts";
import {
  collectRepeatableContainers,
  collectValueSlots,
  findSkeletonTrail,
  nearestContentAncestor,
  nearestRepeatingContainer,
  pathLabelFromTrail,
} from "../core/skeleton/generate_skeleton.ts";
import { INSTANCE_ENCODING_FIELD } from "../core/output/instance_encoding.ts";
import { parseInstanceEncoding } from "../core/output/instance_encoding.ts";
import { validateModel } from "../core/mapping_model/mod.ts";
import { lintDecisionTable, type SheetDocument } from "../core/sheets/mod.ts";

export interface SlotInspectRow {
  slotId: string;
  valueType: string;
  label?: string;
  /** Ancestor labels that are not raw RM type names (e.g. `Vårdenhet › Namn`). */
  pathLabel?: string;
  multiplicity?: string;
  /** Repeating ancestor `attachSlotId` for `loops[]` (`for_each_list`). */
  attachSlotId?: string;
  /** Nearest COMPOSITION / SECTION / ENTRY ancestor (`ACTION` vs `EVALUATION`). */
  parentRmType?: string;
  mapped: boolean;
  expression?: string;
  mandatory?: boolean;
  /** Constrained unique UCUM unit copied onto the DV_QUANTITY shell. */
  unitsFixed?: string;
  allowedUnits?: string[];
  /** Unique constrained code when the template pins a single coded value. */
  codeFixed?: string;
  terminologyFixed?: string;
  /** Template-constrained coded/string choices (ISM, setting, local at-codes). */
  allowedValues?: AllowedValue[];
}

export interface RepeatableInspectRow {
  slotId: string;
  rmType: string;
  label?: string;
  multiplicity?: string;
}

export interface SourceTreeNode {
  path: string;
  name: string;
  type: string;
  multiplicity?: string;
  /** JSON Schema `description` / XSD `xs:documentation`. */
  description?: string;
  /** Language of `description`, only when it is not the tree's `descriptionLanguage` (#277 §5). */
  lang?: string;
  value?: unknown;
  children?: SourceTreeNode[];
  /** Children left out at `SOURCE_TREE_MAX_DEPTH` (never a silent cut, #292). */
  childrenOmitted?: number;
}

export interface ProductStackRow {
  type: string;
  encoding?: string;
  varName?: string;
  path?: string;
}

export interface ConstraintWarningRow {
  slotId?: string;
  blockId?: string;
  sheetName?: string;
  message: string;
  severity: "error" | "warning";
}

interface BlocklyJsonNode {
  type?: string;
  id?: string;
  fields?: Record<string, unknown>;
  next?: { block?: BlocklyJsonNode };
  inputs?: Record<string, { block?: BlocklyJsonNode; shadow?: BlocklyJsonNode }>;
  extraState?: unknown;
}

/** Same copy as `block_constraints.ts` (kept here so inspect stays Blockly-free). */
const ABSTRACT_EVENT_WARNING =
  "EVENT is abstract. Choose POINT_EVENT or INTERVAL_EVENT — runtime instances cannot be the abstract EVENT class.";
const ABSTRACT_ITEM_STRUCTURE_WARNING =
  "ITEM_STRUCTURE is abstract. Choose ITEM_TREE, ITEM_LIST, ITEM_TABLE, or ITEM_SINGLE — runtime instances cannot be the abstract ITEM_STRUCTURE class.";

export function listSlotsInspect(skeleton: SkeletonNode[], model: MappingModel): SlotInspectRow[] {
  const byId = new Map(model.slots.map((s) => [s.slotId, s]));
  const seen = new Set<string>();
  const rows: SlotInspectRow[] = [];
  for (const slot of collectValueSlots(skeleton)) {
    if (seen.has(slot.slotId)) continue;
    seen.add(slot.slotId);
    const mapped = byId.get(slot.slotId);
    const expression = mapped?.expression;
    const trail = findSkeletonTrail(skeleton, slot.slotId);
    const repeating = nearestRepeatingContainer(trail);
    const parent = nearestContentAncestor(trail);
    const pathLabel = pathLabelFromTrail(trail);
    rows.push({
      slotId: slot.slotId,
      valueType: slot.rmType,
      ...(slot.label ? { label: slot.label } : {}),
      ...(pathLabel ? { pathLabel } : {}),
      ...(slot.multiplicity ? { multiplicity: slot.multiplicity } : {}),
      ...(repeating ? { attachSlotId: repeating.slotId } : {}),
      ...(parent ? { parentRmType: parent.rmType } : {}),
      mapped: Boolean(expression),
      ...(expression ? { expression } : {}),
      ...(slot.mandatory ? { mandatory: true } : {}),
      ...(slot.fixedFields?.units ? { unitsFixed: String(slot.fixedFields.units) } : {}),
      ...(slot.fixedFields?.code_string || slot.fixedFields?.defining_code
        ? { codeFixed: String(slot.fixedFields.code_string ?? slot.fixedFields.defining_code) }
        : {}),
      ...(slot.fixedFields?.terminology_id
        ? { terminologyFixed: String(slot.fixedFields.terminology_id) }
        : {}),
      ...(slot.allowedUnits?.length ? { allowedUnits: [...slot.allowedUnits] } : {}),
      ...(slot.allowedValues?.length ? { allowedValues: slot.allowedValues.map(cloneAllowedValue) } : {}),
    });
  }
  return rows;
}

export function listRepeatableInspect(skeleton: SkeletonNode[]): RepeatableInspectRow[] {
  return collectRepeatableContainers(skeleton).map((node) => ({
    slotId: node.slotId,
    rmType: node.rmType,
    ...(node.label ? { label: node.label } : {}),
    ...(node.multiplicity ? { multiplicity: node.multiplicity } : {}),
  }));
}

function cloneAllowedValue(value: AllowedValue): AllowedValue {
  return {
    code: value.code,
    label: value.label,
    ...(value.terminologyId ? { terminologyId: value.terminologyId } : {}),
    ...(value.assumed ? { assumed: true } : {}),
  };
}

/**
 * `get_source_tree` form of a source tree. With `descriptionLang`, a node's
 * `lang` is given only where its description is in another language (#277 §5).
 */
/** Depth guard for `get_source_tree`; deeper children are counted in `childrenOmitted`. */
export const SOURCE_TREE_MAX_DEPTH = 64;

export function compactSourceTree(
  node: SchemaTreeNode | null | undefined,
  depth = 0,
  maxDepth = SOURCE_TREE_MAX_DEPTH,
  descriptionLang?: string,
): SourceTreeNode | null {
  if (!node) return null;
  const row: SourceTreeNode = {
    path: node.path,
    name: node.name,
    type: node.type,
  };
  if (node.multiplicity) row.multiplicity = node.multiplicity;
  if (node.description) {
    row.description = node.description;
    if (node.descriptionLang && !sameLang(node.descriptionLang, descriptionLang)) row.lang = node.descriptionLang;
  }
  if (node.value !== undefined && (typeof node.value !== "object" || node.value === null)) {
    row.value = node.value;
  }
  if (depth < maxDepth && node.children.length) {
    row.children = node.children
      .map((child) => compactSourceTree(child, depth + 1, maxDepth, descriptionLang))
      .filter((c): c is SourceTreeNode => Boolean(c));
  } else if (node.children.length) {
    row.childrenOmitted = node.children.length;
  }
  return row;
}

/** Default and maximum characters `get_example` returns (bodies stay out of the first prompt, #252). */
export const GET_EXAMPLE_DEFAULT_CHARS = 8_000;
export const GET_EXAMPLE_MAX_CHARS = 40_000;

const truthy = (v: unknown) => v === true || v === "true" || v === "1";

/** `list_slots` filters (shared by AI chat and MCP): `unmappedOnly`, `query` (substring of slotId / label / pathLabel). */
export function filterSlotRows(rows: SlotInspectRow[], args: Record<string, unknown>): SlotInspectRow[] {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const unmappedOnly = truthy(args.unmappedOnly);
  if (!query && !unmappedOnly) return rows;
  return rows.filter((row) =>
    (!unmappedOnly || !row.mapped) &&
    (!query || [row.slotId, row.label ?? "", row.pathLabel ?? ""].some((v) => v.toLowerCase().includes(query)))
  );
}

interface ExampleState {
  examples: Array<{ id: string; filename: string; format: string; content: string }>;
  activeExample?: { id: string } | null;
  exampleTree?: SchemaTreeNode | null;
}

/** `list_examples`: example manifest without bodies. */
export function listExamplesInspect(s: ExampleState) {
  return s.examples.map((ex) => ({
    id: ex.id,
    filename: ex.filename,
    format: ex.format,
    chars: ex.content.length,
    ...(ex.id === s.activeExample?.id ? { active: true } : {}),
  }));
}

/**
 * `get_example`: one example body (default Active Example) capped at
 * `maxChars`, or with `path` the subtree (with values) of the Active Example.
 */
export function getExampleInspect(s: ExampleState, args: Record<string, unknown>): Record<string, unknown> {
  const id = typeof args.id === "string" && args.id ? args.id : s.activeExample?.id;
  const example = s.examples.find((ex) => ex.id === id || ex.filename === id);
  if (!example) throw new Error(id ? `Unknown example id: ${id}` : "No example is loaded");
  const requested = Number(args.maxChars ?? args.maxBytes);
  const maxChars = Math.min(
    GET_EXAMPLE_MAX_CHARS,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : GET_EXAMPLE_DEFAULT_CHARS,
  );
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (path) {
    if (example.id !== s.activeExample?.id) {
      throw new Error("path works on the Active Example; call set_active_example first or omit path");
    }
    const node = findCompactNode(compactSourceTree(s.exampleTree ?? null), path);
    if (!node) throw new Error(`No node at ${path} in ${example.filename}`);
    const text = JSON.stringify(node);
    return {
      id: example.id,
      path,
      ...(text.length > maxChars ? { truncated: true, chars: text.length, subtree: text.slice(0, maxChars) } : { subtree: node }),
    };
  }
  const truncated = example.content.length > maxChars;
  return {
    id: example.id,
    filename: example.filename,
    format: example.format,
    chars: example.content.length,
    ...(truncated ? { truncated: true } : {}),
    content: truncated ? example.content.slice(0, maxChars) : example.content,
  };
}

function findCompactNode(node: SourceTreeNode | null, path: string): SourceTreeNode | null {
  if (!node) return null;
  const norm = (p: string) => p.replace(/\[\*\]|\[\d+\]/g, "").replace(/\/+$/, "");
  if (node.path === path || norm(node.path) === norm(path)) return node;
  for (const child of node.children ?? []) {
    const hit = findCompactNode(child, path);
    if (hit) return hit;
  }
  return null;
}

/** First sentence of a source node's description, at most 80 characters (#277). */
function outlineDescription(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const sentence = t.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? t;
  return sentence.length <= 80 ? sentence : `${sentence.slice(0, 79).trimEnd()}…`;
}

function sameLang(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Indented one-line-per-node outline of a source tree (`path type [mult] — description`),
 * without example values: the `api` AI chat context sends this instead of
 * the source schema body (#252). A description in another language than
 * `descriptionLang` is marked `(en)` (#277 §5). Stops at `maxLines` with a pointer line.
 */
export function sourceTreeOutline(
  node: SchemaTreeNode | null | undefined,
  maxLines = 1500,
  descriptionLang?: string,
): string {
  if (!node) return "";
  const lines: string[] = [];
  let omitted = 0;
  const walk = (n: SchemaTreeNode, depth: number) => {
    if (lines.length >= maxLines) {
      omitted++;
    } else {
      const mult = n.multiplicity ? ` [${n.multiplicity}]` : "";
      const about = outlineDescription(n.description);
      const mark = about && n.descriptionLang && descriptionLang && !sameLang(n.descriptionLang, descriptionLang)
        ? `(${n.descriptionLang}) `
        : "";
      lines.push(`${"  ".repeat(depth)}${n.path} ${n.type}${mult}${about ? ` — ${mark}${about}` : ""}`);
    }
    for (const child of n.children) walk(child, depth + 1);
  };
  walk(node, 0);
  if (omitted) lines.push(`… ${omitted} more nodes; call get_source_tree for the full tree`);
  return lines.join("\n");
}

export function productStackInspect(blocklyState: unknown): ProductStackRow[] {
  const tops = topBlocks(blocklyState);
  const start = tops.find((block) => block.type === "conversion_start");
  const rows: ProductStackRow[] = [];
  let current = start?.next?.block;
  while (current?.type) {
    const fields = current.fields ?? {};
    const encodingRaw = fields[INSTANCE_ENCODING_FIELD];
    rows.push({
      type: current.type,
      ...(typeof encodingRaw === "string"
        ? { encoding: parseInstanceEncoding(encodingRaw) }
        : {}),
      ...(typeof fields.VAR === "string" ? { varName: fields.VAR } : {}),
      ...(typeof fields.PATH === "string" ? { path: fields.PATH } : {}),
    });
    current = current.next?.block;
  }
  return rows;
}

function topBlocks(state: unknown): BlocklyJsonNode[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as { blocks?: { blocks?: BlocklyJsonNode[] } }).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

export function sheetSummaries(sheets: SheetDocument[]): Array<{
  name: string;
  kind: string;
  headers: string[];
  rows: number;
}> {
  return sheets.map((sheet) => ({
    name: sheet.name,
    kind: sheet.kind === "decision-table" ? "decision-table" : "sheet",
    headers: [...sheet.headers],
    rows: sheet.values.length,
  }));
}

/** DOM-free Constraint warnings: Mapping Model, Decision table lint, abstract RM types. */
export function constraintWarningsInspect(options: {
  skeleton: SkeletonNode[];
  model: MappingModel;
  sheets: SheetDocument[];
  blocklyState: unknown;
}): ConstraintWarningRow[] {
  const out: ConstraintWarningRow[] = [];
  for (const issue of validateModel(options.model, options.skeleton)) {
    out.push({
      ...(issue.slotId ? { slotId: issue.slotId } : {}),
      message: issue.message,
      severity: issue.severity,
    });
  }
  for (const sheet of options.sheets) {
    for (const diagnostic of lintDecisionTable(sheet)) {
      out.push({
        sheetName: sheet.name,
        message: diagnostic.message,
        severity: diagnostic.severity === "error" ? "error" : "warning",
      });
    }
  }
  collectAbstractRmWarnings(options.blocklyState, out);
  return out;
}

function collectAbstractRmWarnings(state: unknown, out: ConstraintWarningRow[]): void {
  for (const block of topBlocks(state)) walkBlockForAbstractRm(block, out);
}

function walkBlockForAbstractRm(block: BlocklyJsonNode | undefined, out: ConstraintWarningRow[]): void {
  if (!block) return;
  const rmType = String(block.fields?.RM_TYPE ?? "").toUpperCase();
  if (rmType === "EVENT") {
    out.push({
      ...(block.id ? { blockId: block.id } : {}),
      message: ABSTRACT_EVENT_WARNING,
      severity: "warning",
    });
  }
  if (rmType === "ITEM_STRUCTURE") {
    out.push({
      ...(block.id ? { blockId: block.id } : {}),
      message: ABSTRACT_ITEM_STRUCTURE_WARNING,
      severity: "warning",
    });
  }
  if (block.next?.block) walkBlockForAbstractRm(block.next.block, out);
  if (block.inputs) {
    for (const input of Object.values(block.inputs)) {
      walkBlockForAbstractRm(input?.block, out);
      walkBlockForAbstractRm(input?.shadow, out);
    }
  }
}
