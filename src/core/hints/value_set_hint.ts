/**
 * Value-set hints (Design C+).
 *
 * A template slot with more than one allowed code, ordinal, string, or unit
 * stays empty on the canvas. The hint is derived from the Template Skeleton.
 * It is not a block, not a mapping, and not emitted. Dismissals live in
 * project settings and are kept only while the allowed codes are the same
 * list.
 */
import type {
  MappingModel,
  MappingSlot,
  ProjectSettings,
  SkeletonNode,
} from "../../types/mod.ts";
import {
  collectValueSlots,
  findSkeletonTrail,
  pathLabelFromTrail,
} from "../skeleton/generate_skeleton.ts";
import { emptySheet } from "../sheets/model.ts";
import type {
  DecisionColumnMeta,
  DecisionValueType,
  SheetCell,
  SheetDocument,
} from "../sheets/types.ts";

export type ValueSetHintKind = "coded" | "ordinal" | "string_list" | "units";

export type ValueSetHintAction =
  | "constant"
  | "decision_table"
  | "sheet_lookup"
  | "dismiss"
  | "restore";

export interface ValueSetHintCode {
  /** Identity used by dismiss and constant (at-code, ordinal code, string, or unit). */
  code: string;
  text: string;
  terminologyId?: string;
  assumed?: boolean;
  /** Ordinal / scale magnitude. */
  value?: number;
}

export interface ValueSetHint {
  slotId: string;
  kind: ValueSetHintKind;
  label: string;
  pathLabel?: string;
  rmType: string;
  mandatory: boolean;
  /** Allowed codes from the template. */
  codes: ValueSetHintCode[];
  /** Assumed code when it is among `codes`. */
  assumed?: string;
  dismissed: boolean;
}

/** `list_slots` / `get_slot` shape. Omitted when the slot is not an active hint. */
export interface ValueSetHintPayload {
  kind: ValueSetHintKind;
  codes: Array<
    { code: string; text?: string; assumed?: boolean; value?: number }
  >;
  assumed?: string;
}

export interface HintGridPlan {
  name: string;
  kind: "decision-table" | "sheet";
  sheet: SheetDocument;
  /** Column the block returns. */
  outputColumn: string;
  sourceColumn: string;
}

const CODED = new Set(["DV_CODED_TEXT", "CODE_PHRASE"]);
const ORDINAL = new Set(["DV_ORDINAL", "DV_SCALE"]);

function codesKey(codes: readonly string[]): string {
  return [...codes].sort().join("\n");
}

function rawKind(node: SkeletonNode): ValueSetHintKind | null {
  const rm = node.rmType;
  if ((node.allowedOrdinals?.length ?? 0) > 1 && ORDINAL.has(rm)) {
    return "ordinal";
  }
  if ((node.allowedValues?.length ?? 0) > 1 && CODED.has(rm)) return "coded";
  if ((node.allowedValues?.length ?? 0) > 1) return "string_list";
  if ((node.allowedUnits?.length ?? 0) > 1) return "units";
  return null;
}

function allCodes(
  node: SkeletonNode,
  kind: ValueSetHintKind,
): ValueSetHintCode[] {
  if (kind === "ordinal") {
    return (node.allowedOrdinals ?? []).map((item) => ({
      code: item.code || String(item.value),
      text: item.label || item.code || String(item.value),
      ...(item.terminologyId ? { terminologyId: item.terminologyId } : {}),
      ...(item.assumed ? { assumed: true as const } : {}),
      value: item.value,
    }));
  }
  if (kind === "units") {
    return (node.allowedUnits ?? []).map((unit) => ({
      code: unit,
      text: unit,
    }));
  }
  return (node.allowedValues ?? []).map((item) => ({
    code: item.code,
    text: item.label || item.code,
    ...(item.terminologyId ? { terminologyId: item.terminologyId } : {}),
    ...(item.assumed ? { assumed: true as const } : {}),
  }));
}

function mappedAway(
  kind: ValueSetHintKind,
  slot: MappingSlot | undefined,
): boolean {
  if (kind === "units") return Boolean(slot?.unitsExpression?.trim());
  return Boolean(slot?.expression?.trim());
}

interface RawHint {
  slotId: string;
  kind: ValueSetHintKind;
  label: string;
  pathLabel?: string;
  rmType: string;
  mandatory: boolean;
  codes: ValueSetHintCode[];
}

function rawHints(skeleton: SkeletonNode[], model: MappingModel): RawHint[] {
  const mapped = new Map(model.slots.map((slot) => [slot.slotId, slot]));
  const seen = new Set<string>();
  const out: RawHint[] = [];
  for (const node of collectValueSlots(skeleton)) {
    if (seen.has(node.slotId)) continue;
    seen.add(node.slotId);
    const kind = rawKind(node);
    if (!kind) continue;
    if (mappedAway(kind, mapped.get(node.slotId))) continue;
    const codes = allCodes(node, kind);
    if (codes.length < 2) continue;
    const trail = findSkeletonTrail(skeleton, node.slotId);
    const pathLabel = pathLabelFromTrail(trail);
    out.push({
      slotId: node.slotId,
      kind,
      label: node.label?.trim() || kindLabel(kind),
      ...(pathLabel ? { pathLabel } : {}),
      rmType: node.rmType,
      mandatory: Boolean(node.mandatory),
      codes,
    });
  }
  return out;
}

function kindLabel(kind: ValueSetHintKind): string {
  if (kind === "ordinal") return "Ordinal";
  if (kind === "string_list") return "String list";
  if (kind === "units") return "Units";
  return "Coded";
}

function codesIdentities(codes: readonly ValueSetHintCode[]): string[] {
  return codes.map((item) => item.code).sort();
}

function applyRecords(raw: RawHint, settings: ProjectSettings): ValueSetHint {
  const fullKey = codesKey(codesIdentities(raw.codes));
  const dismissed = (settings.dismissedHints ?? []).some(
    (row) => row.slotId === raw.slotId && codesKey(row.codes) === fullKey,
  );
  const assumed = raw.codes.find((item) => item.assumed)?.code;
  return {
    slotId: raw.slotId,
    kind: raw.kind,
    label: raw.label,
    ...(raw.pathLabel ? { pathLabel: raw.pathLabel } : {}),
    rmType: raw.rmType,
    mandatory: raw.mandatory,
    codes: raw.codes,
    ...(assumed ? { assumed } : {}),
    dismissed,
  };
}

/** Active and dismissed hints. A mapped slot is absent. Stale dismissals do not hide a changed code list. */
export function collectValueSetHints(
  skeleton: SkeletonNode[],
  model: MappingModel,
  settings: ProjectSettings,
): ValueSetHint[] {
  return rawHints(skeleton, model).map((raw) => applyRecords(raw, settings));
}

export function hintPayload(hint: ValueSetHint): ValueSetHintPayload {
  return {
    kind: hint.kind,
    codes: hint.codes.map((item) => ({
      code: item.code,
      ...(item.text && item.text !== item.code ? { text: item.text } : {}),
      ...(item.assumed ? { assumed: true } : {}),
      ...(item.value !== undefined ? { value: item.value } : {}),
    })),
    ...(hint.assumed ? { assumed: hint.assumed } : {}),
  };
}

/** Drop dismissals whose slot or allowed codes are gone. */
export function pruneHintSettings(
  skeleton: SkeletonNode[],
  model: MappingModel,
  settings: ProjectSettings,
): ProjectSettings {
  const live = new Map(
    rawHints(skeleton, model).map((
      hint,
    ) => [hint.slotId, codesKey(codesIdentities(hint.codes))]),
  );
  const dismissed = (settings.dismissedHints ?? []).filter(
    (row) => live.get(row.slotId) === codesKey(row.codes),
  );
  return writeDismissed(settings, dismissed);
}

function writeDismissed(
  settings: ProjectSettings,
  dismissed: NonNullable<ProjectSettings["dismissedHints"]>,
): ProjectSettings {
  const next: ProjectSettings = { ...settings };
  if (dismissed.length) next.dismissedHints = dismissed;
  else delete next.dismissedHints;
  return next;
}

function forgetSlot(
  settings: ProjectSettings,
  slotId: string,
): ProjectSettings {
  return writeDismissed(
    settings,
    (settings.dismissedHints ?? []).filter((row) => row.slotId !== slotId),
  );
}

export function dismissHint(
  settings: ProjectSettings,
  hint: ValueSetHint,
): ProjectSettings {
  const dismissed = (settings.dismissedHints ?? []).filter((row) =>
    row.slotId !== hint.slotId
  );
  dismissed.push({ slotId: hint.slotId, codes: codesIdentities(hint.codes) });
  return writeDismissed(settings, dismissed);
}

export function restoreHints(
  settings: ProjectSettings,
  slotId?: string,
): ProjectSettings {
  if (!slotId) return writeDismissed(settings, []);
  return writeDismissed(
    settings,
    (settings.dismissedHints ?? []).filter((row) => row.slotId !== slotId),
  );
}

export function clearHintMemory(
  settings: ProjectSettings,
  slotId: string,
): ProjectSettings {
  return forgetSlot(settings, slotId);
}

function uniqueName(sheets: SheetDocument[], base: string): string {
  const taken = new Set(sheets.map((sheet) => sheet.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function gridBase(
  hint: ValueSetHint,
  kind: "decision-table" | "sheet",
): string {
  const label = hint.label.replace(/\s+/g, " ").trim() || "Value set";
  return kind === "decision-table" ? `${label} codes` : `${label} lookup`;
}

interface GridColumn {
  header: string;
  role: "condition" | "output";
  valueType?: DecisionValueType;
}

function gridColumns(
  hint: ValueSetHint,
): { columns: GridColumn[]; output: string; rows: SheetCell[][] } {
  const source: GridColumn = { header: "source", role: "condition" };
  if (hint.kind === "ordinal") {
    return {
      columns: [
        source,
        { header: "value", role: "output", valueType: "number" },
        { header: "code", role: "output" },
        { header: "rubric", role: "output" },
        { header: "terminology", role: "output" },
      ],
      output: "value",
      rows: hint.codes.map((
        item,
      ) => ["", item.value ?? "", item.code, item.text, item.terminologyId ?? "local"]),
    };
  }
  if (hint.kind === "units") {
    return {
      columns: [source, { header: "unit", role: "output" }],
      output: "unit",
      rows: hint.codes.map((item) => ["", item.code]),
    };
  }
  if (hint.kind === "string_list") {
    return {
      columns: [source, { header: "text", role: "output" }],
      output: "text",
      rows: hint.codes.map((item) => ["", item.text || item.code]),
    };
  }
  return {
    columns: [
      source,
      { header: "code", role: "output" },
      { header: "rubric", role: "output" },
      { header: "terminology", role: "output" },
    ],
    output: "code",
    rows: hint.codes.map((item) => ["", item.code, item.text, item.terminologyId ?? "local"]),
  };
}

/**
 * Decision table or sheet whose target columns are the allowed codes (and
 * rubrics). The source column is blank. Nothing is copied from a source schema
 * or an example.
 */
export function planHintGrid(
  hint: ValueSetHint,
  sheets: SheetDocument[],
  kind: "decision-table" | "sheet",
): HintGridPlan {
  const spec = gridColumns(hint);
  const name = uniqueName(sheets, gridBase(hint, kind));
  const headers = spec.columns.map((column) => column.header);
  const base = emptySheet(name, headers.length, Math.max(spec.rows.length, 1));
  const decisionColumns: DecisionColumnMeta[] = spec.columns.map((column) =>
    column.role === "output"
      ? {
        role: "output",
        outputKind: "value",
        valueType: column.valueType ?? "string",
      }
      : { role: "condition" }
  );
  const sheet: SheetDocument = {
    ...base,
    name,
    kind: kind === "decision-table" ? "decision-table" : "sheet",
    headers,
    values: spec.rows.map((row) => row.slice()),
    ...(kind === "decision-table"
      ? {
        // Blank source cells are don't-care. UNIQUE fails closed until each
        // source cell is a real value, so the first code is not emitted.
        hitPolicy: "UNIQUE" as const,
        decisionColumns,
      }
      : {}),
  };
  return {
    name,
    kind,
    sheet,
    outputColumn: spec.output,
    sourceColumn: "source",
  };
}

/** Ready-made AI chat prompt. Interactive UI only — never sent or run by MCP. */
export function hintFillPrompt(hint: ValueSetHint, plan: HintGridPlan): string {
  const lines = hint.codes.map((item) => {
    const star = item.assumed ? " (assumed)" : "";
    const extra = item.value !== undefined ? ` value ${item.value}` : "";
    const text = item.text && item.text !== item.code ? ` — ${item.text}` : "";
    return `- ${item.code}${text}${extra}${star}`;
  });
  const grid = plan.kind === "decision-table" ? "decision table" : "sheet";
  return [
    `Fill only the blank "${plan.sourceColumn}" column of the ${grid} "${plan.name}" for the value-set hint on ${hint.label} (${hint.slotId}).`,
    "",
    "Allowed targets (do not invent, rename, or drop these):",
    ...lines,
    "",
    "Use the loaded Source Schema and the Active Example. Put each distinct source value that should map to a target in that row's source cell. Leave a source cell blank only when nothing in the source maps to that target. Do not change the code, rubric, terminology, value, or unit cells. Do not match codes by guessing similar words. Apply the edit with replace_sheets, keeping every other sheet, and leave the block that reads this grid on the slot.",
  ].join("\n");
}

export function countActiveHints(hints: ValueSetHint[]): number {
  return hints.filter((hint) => !hint.dismissed).length;
}
