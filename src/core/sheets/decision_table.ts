/**
 * Decision-table evaluate + lint (#69 / #84).
 * Condition columns use equality, don't-care, and numeric range predicates;
 * output columns are values or VMS-Mustache snippets.
 * Local bindings: the inputs record keys are both match keys and snippet Mustache names —
 * callers flatten nested/complex sources into those locals before eval.
 */
import Handlebars from "handlebars";
import { checkVmsMustache, type TemplateDiagnostic } from "../output/vms_hbs.ts";
import { indexToLetters } from "./a1.ts";
import { cloneSheet, emptySheet } from "./model.ts";
import {
  DONT_CARE_GLYPHS,
  type DecisionColumnMeta,
  type DecisionColumnRole,
  type DecisionHitPolicy,
  type DecisionOutputKind,
  type DecisionValueType,
  type SheetCell,
  type SheetDocument,
} from "./types.ts";

/** OUTPUT field / expression sentinel: return a Map of every output column. */
export const DECISION_ALL_OUTPUTS = "*";

export const DECISION_PREVIEW_COLS = 3;
export const DECISION_PREVIEW_ROWS = 3;

export function isDontCare(cell: SheetCell | undefined): boolean {
  if (cell == null) return true;
  if (typeof cell === "string") return DONT_CARE_GLYPHS.has(cell.trim());
  return false;
}

export function emptyDecisionTable(name = "Decision1", conditionCols = 2, outputCols = 1): SheetDocument {
  const base = emptySheet(name, conditionCols + outputCols, 3);
  const decisionColumns: DecisionColumnMeta[] = [
    ...Array.from({ length: conditionCols }, () => ({ role: "condition" as const })),
    ...Array.from({ length: outputCols }, () => ({
      role: "output" as const,
      outputKind: "value" as DecisionOutputKind,
      valueType: "string" as DecisionValueType,
    })),
  ];
  const headers = [
    ...Array.from({ length: conditionCols }, (_, i) => `in${i + 1}`),
    ...Array.from({ length: outputCols }, (_, i) => (outputCols === 1 ? "out" : `out${i + 1}`)),
  ];
  return {
    ...base,
    headers,
    kind: "decision-table",
    hitPolicy: "FIRST",
    collectJoin: "; ",
    decisionColumns,
  };
}

export function isDecisionTable(sheet: SheetDocument): boolean {
  return sheet.kind === "decision-table";
}

export function isAllOutputs(output: string | undefined | null): boolean {
  return output === DECISION_ALL_OUTPUTS;
}

export function decisionColumnMeta(sheet: SheetDocument): DecisionColumnMeta[] {
  const width = sheet.headers.length;
  const raw = sheet.decisionColumns ?? [];
  const out: DecisionColumnMeta[] = [];
  for (let i = 0; i < width; i++) {
    const m = raw[i];
    if (m?.role === "output") {
      const outputKind: DecisionOutputKind = m.outputKind ?? "value";
      const valueType: DecisionValueType = outputKind === "snippet"
        ? "string"
        : (m.valueType === "number" || m.valueType === "boolean" ? m.valueType : "string");
      out.push({ role: "output", outputKind, valueType });
    } else if (m?.role === "condition") {
      out.push({ role: "condition" });
    } else {
      out.push({ role: "condition" });
    }
  }
  if (!raw.length && width > 0) {
    for (let i = 0; i < width - 1; i++) out[i] = { role: "condition" };
    out[width - 1] = { role: "output", outputKind: "value", valueType: "string" };
  }
  return out;
}

export function conditionHeaders(sheet: SheetDocument): string[] {
  const meta = decisionColumnMeta(sheet);
  return sheet.headers.filter((_, i) => meta[i]?.role === "condition");
}

export function outputHeaders(sheet: SheetDocument): string[] {
  const meta = decisionColumnMeta(sheet);
  return sheet.headers.filter((_, i) => meta[i]?.role === "output");
}

export function outputValueType(sheet: SheetDocument, header: string): DecisionValueType {
  const meta = decisionColumnMeta(sheet);
  const i = sheet.headers.findIndex((h) => h === header);
  if (i < 0) return "string";
  const col = meta[i];
  if (col?.role !== "output") return "string";
  if (col.outputKind === "snippet") return "string";
  return col.valueType === "number" || col.valueType === "boolean" ? col.valueType : "string";
}

export function blocklyCheckForValueType(type: DecisionValueType): string {
  if (type === "number") return "Number";
  if (type === "boolean") return "Boolean";
  return "String";
}

export function blocklyCheckForDecisionOutput(
  sheet: SheetDocument | undefined,
  output: string | undefined,
): string {
  if (isAllOutputs(output)) return "Map";
  if (!sheet || !output) return "String";
  return blocklyCheckForValueType(outputValueType(sheet, output));
}

export function coerceOutputValue(value: unknown, type: DecisionValueType): unknown {
  if (value == null || value === "") return value;
  if (type === "number") {
    if (typeof value === "number") return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    return value;
  }
  return typeof value === "string" ? value : String(value);
}

/**
 * Map each new condition-key index to an old index (or null for a fresh column).
 * Same length → rename-in-place (keep index). Different length → match by name.
 */
export function alignMapKeys(oldKeys: string[], newKeys: string[]): Array<number | null> {
  if (oldKeys.length === newKeys.length) {
    return newKeys.map((_, i) => i);
  }
  const used = new Set<number>();
  return newKeys.map((key) => {
    const idx = oldKeys.findIndex((old, i) => old === key && !used.has(i));
    if (idx >= 0) {
      used.add(idx);
      return idx;
    }
    return null;
  });
}

export function uniqueDecisionHeader(headers: string[], base: string): string {
  if (!headers.includes(base)) return base;
  let i = 2;
  while (headers.includes(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function addDecisionColumn(
  sheet: SheetDocument,
  role: DecisionColumnRole,
): SheetDocument {
  const next = cloneSheet(sheet);
  const meta = decisionColumnMeta(next);
  if (role === "condition") {
    const firstOut = meta.findIndex((m) => m.role === "output");
    const at = firstOut < 0 ? next.headers.length : firstOut;
    const name = uniqueDecisionHeader(next.headers, `in${conditionHeaders(next).length + 1}`);
    next.headers.splice(at, 0, name);
    meta.splice(at, 0, { role: "condition" });
    next.columnTypes?.splice(at, 0, "text");
    for (const row of next.values) row.splice(at, 0, "");
  } else {
    const outs = outputHeaders(next);
    const name = uniqueDecisionHeader(
      next.headers,
      outs.length === 0 ? "out" : `out${outs.length + 1}`,
    );
    next.headers.push(name);
    meta.push({ role: "output", outputKind: "value", valueType: "string" });
    next.columnTypes?.push("text");
    for (const row of next.values) row.push("");
  }
  next.decisionColumns = meta;
  return next;
}

export function setDecisionHeader(sheet: SheetDocument, index: number, title: string): SheetDocument {
  const next = cloneSheet(sheet);
  if (index < 0 || index >= next.headers.length) return next;
  const trimmed = title.trim();
  if (!trimmed) return next;
  next.headers[index] = uniqueDecisionHeader(
    next.headers.filter((_, i) => i !== index),
    trimmed,
  );
  return next;
}

export function setDecisionOutputKind(
  sheet: SheetDocument,
  index: number,
  outputKind: DecisionOutputKind,
): SheetDocument {
  const next = cloneSheet(sheet);
  const meta = decisionColumnMeta(next);
  const col = meta[index];
  if (!col || col.role !== "output") return next;
  col.outputKind = outputKind;
  if (outputKind === "snippet") col.valueType = "string";
  next.decisionColumns = meta;
  return next;
}

export function setDecisionValueType(
  sheet: SheetDocument,
  index: number,
  valueType: DecisionValueType,
): SheetDocument {
  const next = cloneSheet(sheet);
  const meta = decisionColumnMeta(next);
  const col = meta[index];
  if (!col || col.role !== "output") return next;
  if (col.outputKind === "snippet") return next;
  col.valueType = valueType;
  next.decisionColumns = meta;
  return next;
}

/** Drop trailing empty letter-named columns (viewport padding leaked into the document). */
export function trimDecisionTableSpareColumns(sheet: SheetDocument): SheetDocument {
  if (!isDecisionTable(sheet)) return sheet;
  let width = sheet.headers.length;
  while (width > 1) {
    const i = width - 1;
    const header = (sheet.headers[i] ?? "").trim();
    const letter = indexToLetters(i);
    const empty = sheet.values.every((row) => {
      const c = row[i];
      return c == null || c === "";
    });
    if ((header === "" || header === letter) && empty) width--;
    else break;
  }
  if (width === sheet.headers.length) return sheet;
  const next = cloneSheet(sheet);
  next.headers = next.headers.slice(0, width);
  next.columnTypes = next.columnTypes?.slice(0, width);
  next.decisionColumns = (next.decisionColumns ?? decisionColumnMeta(sheet)).slice(0, width);
  next.values = next.values.map((row) => row.slice(0, width));
  return next;
}

export function isCatchAllRow(sheet: SheetDocument, y: number): boolean {
  return sheet.rowCatchAll?.[y] === true;
}

/** Append a catch-all (otherwise) row: don't-care conditions + `rowCatchAll` flag. */
export function addCatchAllRow(sheet: SheetDocument): SheetDocument {
  const next = cloneSheet(sheet);
  const meta = decisionColumnMeta(next);
  const row = meta.map((m) => (m.role === "condition" ? "—" : "")) as SheetCell[];
  while (row.length < next.headers.length) row.push("");
  next.values.push(row.slice(0, next.headers.length));
  if (next.rowNames) next.rowNames.push("");
  const flags = next.rowCatchAll ? [...next.rowCatchAll] : Array.from({ length: next.values.length - 1 }, () => false);
  while (flags.length < next.values.length) flags.push(false);
  flags[flags.length - 1] = true;
  next.rowCatchAll = flags;
  return next;
}

/**
 * Row indexes that fire for `inputs`.
 * A catch-all row is included only when no earlier row has already matched
 * (FIRST otherwise / openEHR DL `*` choice). UNIQUE/COLLECT share this set:
 * UNIQUE throws if more than one index; COLLECT joins them in RULE ORDER.
 */
export function matchingDecisionRows(
  sheet: SheetDocument,
  inputs: Record<string, unknown>,
): number[] {
  const meta = decisionColumnMeta(sheet);
  const matches: number[] = [];
  for (let y = 0; y < sheet.values.length; y++) {
    if (isCatchAllRow(sheet, y)) {
      if (matches.length === 0) matches.push(y);
      continue;
    }
    if (rowMatchesAt(sheet, meta, y, inputs)) matches.push(y);
  }
  return matches;
}

export function previewGrid(
  sheet: SheetDocument,
  maxCols = DECISION_PREVIEW_COLS,
  maxRows = DECISION_PREVIEW_ROWS,
): { headers: string[]; rows: SheetCell[][] } {
  const cols = Math.min(Math.max(1, maxCols), Math.max(sheet.headers.length, 1));
  const headers = sheet.headers.slice(0, cols);
  while (headers.length < cols) headers.push("");
  const rows = sheet.values.slice(0, maxRows).map((row) => {
    const cells = row.slice(0, cols);
    while (cells.length < cols) cells.push("");
    return cells;
  });
  return { headers, rows };
}

/** Inclusive range, exclusive/inclusive bounds. Bare numbers are not predicates (string equality). */
export type NumericPredicate =
  | { kind: "range"; min: number; max: number }
  | { kind: "ge"; value: number }
  | { kind: "gt"; value: number }
  | { kind: "le"; value: number }
  | { kind: "lt"; value: number }
  | { kind: "eq"; value: number };

const RANGE_RE = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/;
const COMPARE_RE = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/;

/**
 * Parse a condition cell as a numeric predicate (`90..120`, `>= 140`, `< 90`).
 * Bare `140` returns null so exact equality stays the existing string/number match.
 * `= 140` is explicit numeric equality (input must coerce to a finite number).
 */
export function parseNumericPredicate(cell: SheetCell | undefined): NumericPredicate | null {
  if (cell == null || typeof cell === "boolean") return null;
  if (isDontCare(cell)) return null;
  const s = typeof cell === "number" ? String(cell) : String(cell).trim();
  if (!s) return null;
  const range = RANGE_RE.exec(s);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { kind: "range", min: Math.min(a, b), max: Math.max(a, b) };
  }
  const cmp = COMPARE_RE.exec(s);
  if (cmp) {
    const value = Number(cmp[2]);
    if (!Number.isFinite(value)) return null;
    const op = cmp[1]!;
    if (op === ">=") return { kind: "ge", value };
    if (op === ">") return { kind: "gt", value };
    if (op === "<=") return { kind: "le", value };
    if (op === "<") return { kind: "lt", value };
    return { kind: "eq", value };
  }
  return null;
}

/** Finite number from a bound input. Booleans are not coerced. */
export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function predicateHolds(pred: NumericPredicate, n: number): boolean {
  switch (pred.kind) {
    case "range":
      return n >= pred.min && n <= pred.max;
    case "ge":
      return n >= pred.value;
    case "gt":
      return n > pred.value;
    case "le":
      return n <= pred.value;
    case "lt":
      return n < pred.value;
    case "eq":
      return n === pred.value;
  }
}

function cellsEqual(cell: SheetCell, match: unknown): boolean {
  if (isDontCare(cell)) return true;
  if (cell == null && (match == null || match === "")) return true;
  if (typeof cell === "number" && typeof match === "number") return cell === match;
  if (typeof cell === "boolean" && typeof match === "boolean") return cell === match;
  return String(cell ?? "") === String(match ?? "");
}

/** Condition cell vs bound input: don't-care, numeric predicate, or equality. */
export function conditionCellMatches(cell: SheetCell | undefined, inputVal: unknown): boolean {
  if (isDontCare(cell)) return true;
  const pred = parseNumericPredicate(cell);
  if (pred) {
    const n = coerceFiniteNumber(inputVal);
    if (n == null) return false;
    return predicateHolds(pred, n);
  }
  return cellsEqual(cell ?? null, inputVal);
}

function rowMatchesAt(
  sheet: SheetDocument,
  meta: DecisionColumnMeta[],
  y: number,
  inputs: Record<string, unknown>,
): boolean {
  const row = sheet.values[y] ?? [];
  for (let x = 0; x < meta.length; x++) {
    if (meta[x]?.role !== "condition") continue;
    const header = sheet.headers[x] ?? "";
    const cell = row[x] ?? null;
    if (!conditionCellMatches(cell, inputs[header])) return false;
  }
  return true;
}

/** Public seam: does data row `y` match `inputs` on every condition column (AND)? */
export function rowMatches(
  sheet: SheetDocument,
  y: number,
  inputs: Record<string, unknown>,
): boolean {
  return rowMatchesAt(sheet, decisionColumnMeta(sheet), y, inputs);
}

function resolveOutputIndex(sheet: SheetDocument, meta: DecisionColumnMeta[], outputColumn?: string): number {
  if (outputColumn != null && outputColumn !== "" && !isAllOutputs(outputColumn)) {
    const byHeader = sheet.headers.findIndex((h) => h === outputColumn);
    if (byHeader >= 0) return byHeader;
    throw new Error(`Unknown decision-table output column: ${outputColumn}`);
  }
  const firstOut = meta.findIndex((m) => m.role === "output");
  if (firstOut >= 0) return firstOut;
  return Math.max(0, sheet.headers.length - 1);
}

/** VMS-Mustache snippet render (also bound as XQuery `intehrgrator:mustache`). */
export function renderDecisionSnippet(template: string, locals: Record<string, unknown>): string {
  return renderSnippet(template, locals);
}

function renderSnippet(template: string, locals: Record<string, unknown>): string {
  if (!template.includes("{{")) return template;
  const engine = Handlebars.create();
  const compiled = engine.compile(template, {
    noEscape: true,
    knownHelpersOnly: true,
    knownHelpers: {},
  });
  return compiled(locals);
}

function cellOutput(
  sheet: SheetDocument,
  meta: DecisionColumnMeta[],
  y: number,
  outIndex: number,
  locals: Record<string, unknown>,
): unknown {
  const cell = sheet.values[y]?.[outIndex] ?? null;
  const col = meta[outIndex];
  const kind: DecisionOutputKind = col?.outputKind ?? "value";
  if (kind === "snippet") {
    return renderSnippet(String(cell ?? ""), locals);
  }
  const type: DecisionValueType = col?.valueType === "number" || col?.valueType === "boolean"
    ? col.valueType
    : "string";
  return coerceOutputValue(cell, type);
}

function rowOutputRecord(
  sheet: SheetDocument,
  meta: DecisionColumnMeta[],
  y: number,
  locals: Record<string, unknown>,
): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (let x = 0; x < meta.length; x++) {
    if (meta[x]?.role !== "output") continue;
    rec[sheet.headers[x] ?? String(x)] = cellOutput(sheet, meta, y, x, locals);
  }
  return rec;
}

/**
 * Evaluate a decision table against local bindings.
 * `inputs` keys match condition column headers (and feed snippet Mustache context).
 * Pass `outputColumn` `"*"` (`DECISION_ALL_OUTPUTS`) to return a Map of every output column.
 */
export function evaluateDecisionTable(
  sheet: SheetDocument,
  inputs: Record<string, unknown>,
  outputColumn?: string,
): unknown {
  const meta = decisionColumnMeta(sheet);
  const policy: DecisionHitPolicy = sheet.hitPolicy ?? "FIRST";
  const join = sheet.collectJoin ?? "; ";
  const all = isAllOutputs(outputColumn);

  const matches = matchingDecisionRows(sheet, inputs);

  if (matches.length === 0) return null;

  const first = (): unknown =>
    all
      ? rowOutputRecord(sheet, meta, matches[0]!, inputs)
      : cellOutput(sheet, meta, matches[0]!, resolveOutputIndex(sheet, meta, outputColumn), inputs);

  if (policy === "FIRST") return first();

  if (policy === "UNIQUE") {
    if (matches.length > 1) {
      throw new Error(
        `UNIQUE decision table "${sheet.name}" matched ${matches.length} rows for inputs ${JSON.stringify(inputs)}`,
      );
    }
    return first();
  }

  if (all) {
    const rec: Record<string, unknown> = {};
    for (const header of outputHeaders(sheet)) {
      const idx = sheet.headers.indexOf(header);
      const parts = matches.map((y) => cellOutput(sheet, meta, y, idx, inputs));
      rec[header] = joinCollectParts(parts, join, sheet.collectDedupe === true);
    }
    return rec;
  }

  const outIndex = resolveOutputIndex(sheet, meta, outputColumn);
  const parts = matches.map((y) => cellOutput(sheet, meta, y, outIndex, inputs));
  return joinCollectParts(parts, join, sheet.collectDedupe === true);
}

function isBlankCollectPart(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

function joinCollectParts(parts: unknown[], join: string, dedupe: boolean): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (isBlankCollectPart(p)) continue;
    const s = String(p);
    if (dedupe) {
      if (seen.has(s)) continue;
      seen.add(s);
    }
    out.push(s);
  }
  return out.join(join);
}

export interface DecisionTableLintDiagnostic extends TemplateDiagnostic {
  row: number;
  column: string;
}

/** Soft-lint snippet output cells with `checkVmsMustache` (#40 / ADR 0009). */
export function lintDecisionTableSnippets(sheet: SheetDocument): DecisionTableLintDiagnostic[] {
  if (!isDecisionTable(sheet) && !(sheet.decisionColumns?.some((c) => c.outputKind === "snippet"))) {
    return [];
  }
  const meta = decisionColumnMeta(sheet);
  const out: DecisionTableLintDiagnostic[] = [];
  for (let y = 0; y < sheet.values.length; y++) {
    for (let x = 0; x < meta.length; x++) {
      if (meta[x]?.role !== "output" || meta[x]?.outputKind !== "snippet") continue;
      const cell = sheet.values[y]?.[x];
      if (cell == null || cell === "") continue;
      const result = checkVmsMustache(String(cell));
      for (const d of result.diagnostics) {
        out.push({
          ...d,
          row: y,
          column: sheet.headers[x] ?? String(x),
          message: `r${y + 1}/${sheet.headers[x] ?? x}: ${d.message}`,
        });
      }
    }
  }
  return out;
}

/**
 * Soft Constraint warnings for a Decision table: VMS snippet cells, multiple
 * catch-all rows, and UNIQUE overlap (static row pairs, plus an optional probe
 * / Active Example inputs map). Does not replace the UNIQUE runtime throw.
 */
export function lintDecisionTable(
  sheet: SheetDocument,
  probeInputs?: Record<string, unknown>,
): DecisionTableLintDiagnostic[] {
  const out = lintDecisionTableSnippets(sheet);
  if (!isDecisionTable(sheet)) return out;
  const catchAllRows: number[] = [];
  for (let y = 0; y < sheet.values.length; y++) {
    if (isCatchAllRow(sheet, y)) catchAllRows.push(y);
  }
  if (catchAllRows.length > 1) {
    out.push({
      row: catchAllRows[1]!,
      column: sheet.headers[0] ?? "",
      severity: "warning",
      message: `Decision table "${sheet.name}" has multiple catch-all (otherwise) rows (r${
        catchAllRows.map((y) => y + 1).join(", r")
      })`,
    });
  }
  const policy: DecisionHitPolicy = sheet.hitPolicy ?? "FIRST";
  if (policy === "UNIQUE") {
    if (probeInputs) {
      const hits = matchingDecisionRows(sheet, probeInputs);
      if (hits.length > 1) {
        out.push({
          row: hits[1]!,
          column: sheet.headers[0] ?? "",
          severity: "warning",
          message: `UNIQUE decision table "${sheet.name}" matches ${hits.length} rows for the Active Example (r${
            hits.map((y) => y + 1).join(", r")
          })`,
        });
      }
    }
    const pair = firstOverlappingUniqueRows(sheet);
    if (pair) {
      const already = out.some((d) => d.message.includes("UNIQUE"));
      if (!already) {
        out.push({
          row: pair[1],
          column: sheet.headers[0] ?? "",
          severity: "warning",
          message: `UNIQUE decision table "${sheet.name}" has overlapping rows r${pair[0] + 1} and r${pair[1] + 1}`,
        });
      }
    }
  }
  return out;
}

function firstOverlappingUniqueRows(sheet: SheetDocument): [number, number] | null {
  const meta = decisionColumnMeta(sheet);
  const n = sheet.values.length;
  for (let i = 0; i < n; i++) {
    if (isCatchAllRow(sheet, i)) continue;
    for (let j = i + 1; j < n; j++) {
      if (isCatchAllRow(sheet, j)) continue;
      if (rowsMayBothMatch(sheet, meta, i, j)) return [i, j];
    }
  }
  return null;
}

function rowsMayBothMatch(
  sheet: SheetDocument,
  meta: DecisionColumnMeta[],
  a: number,
  b: number,
): boolean {
  for (let x = 0; x < meta.length; x++) {
    if (meta[x]?.role !== "condition") continue;
    if (!conditionCellsCompatible(sheet.values[a]?.[x] ?? null, sheet.values[b]?.[x] ?? null)) {
      return false;
    }
  }
  return true;
}

function conditionCellsCompatible(a: SheetCell, b: SheetCell): boolean {
  if (isDontCare(a) || isDontCare(b)) return true;
  const pa = parseNumericPredicate(a);
  const pb = parseNumericPredicate(b);
  if (pa && pb) return numericPredicatesOverlap(pa, pb);
  if (pa) {
    const n = coerceFiniteNumber(b);
    return n != null && predicateHolds(pa, n);
  }
  if (pb) {
    const n = coerceFiniteNumber(a);
    return n != null && predicateHolds(pb, n);
  }
  return String(a ?? "") === String(b ?? "");
}

function numericPredicatesOverlap(a: NumericPredicate, b: NumericPredicate): boolean {
  const ia = predicateInterval(a);
  const ib = predicateInterval(b);
  if (ia.hi < ib.lo || ib.hi < ia.lo) return false;
  if (ia.hi === ib.lo) return ia.hiInc && ib.loInc;
  if (ib.hi === ia.lo) return ib.hiInc && ia.loInc;
  return true;
}

function predicateInterval(
  p: NumericPredicate,
): { lo: number; hi: number; loInc: boolean; hiInc: boolean } {
  switch (p.kind) {
    case "range":
      return { lo: p.min, hi: p.max, loInc: true, hiInc: true };
    case "eq":
      return { lo: p.value, hi: p.value, loInc: true, hiInc: true };
    case "ge":
      return { lo: p.value, hi: Number.POSITIVE_INFINITY, loInc: true, hiInc: true };
    case "gt":
      return { lo: p.value, hi: Number.POSITIVE_INFINITY, loInc: false, hiInc: true };
    case "le":
      return { lo: Number.NEGATIVE_INFINITY, hi: p.value, loInc: true, hiInc: true };
    case "lt":
      return { lo: Number.NEGATIVE_INFINITY, hi: p.value, loInc: true, hiInc: false };
  }
}
