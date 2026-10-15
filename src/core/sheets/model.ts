import { coordsToA1, indexToLetters, parseA1 } from "./a1.ts";
import {
  ROW_NAME_COLUMN,
  type DecisionColumnMeta,
  type DecisionHitPolicy,
  type GridKind,
  type SheetBag,
  type SheetCell,
  type SheetColumnType,
  type SheetDocument,
} from "./types.ts";

export function emptySheet(name = "Sheet1", cols = 3, rows = 4): SheetDocument {
  const headers = Array.from({ length: cols }, (_, i) => indexToLetters(i));
  const values = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "" as SheetCell));
  return {
    name,
    kind: "sheet",
    headers,
    values,
    columnTypes: Array.from({ length: cols }, () => "text" as SheetColumnType),
  };
}

export function cloneSheet(sheet: SheetDocument): SheetDocument {
  return {
    name: sheet.name,
    kind: sheet.kind,
    headers: [...sheet.headers],
    rowNames: sheet.rowNames ? [...sheet.rowNames] : undefined,
    values: sheet.values.map((row) => [...row]),
    columnTypes: sheet.columnTypes ? [...sheet.columnTypes] : undefined,
    hitPolicy: sheet.hitPolicy,
    collectJoin: sheet.collectJoin,
    collectDedupe: sheet.collectDedupe,
    decisionColumns: sheet.decisionColumns?.map((c) => ({ ...c })),
    rowCatchAll: sheet.rowCatchAll ? [...sheet.rowCatchAll] : undefined,
  };
}

export function cloneSheets(sheets: SheetDocument[]): SheetDocument[] {
  return sheets.map(cloneSheet);
}

export function sheetsEqual(a: SheetDocument[], b: SheetDocument[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sheetsToBag(sheets: SheetDocument[]): SheetBag {
  const bag: SheetBag = {};
  for (const sheet of sheets) bag[sheet.name] = sheet;
  return bag;
}

export function findSheet(sheets: SheetDocument[], name: string): SheetDocument | undefined {
  return sheets.find((sheet) => sheet.name === name);
}

export function normalizeSheet(raw: unknown): SheetDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Sheet must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const name = String(rec.name ?? "").trim();
  if (!name) throw new Error("Sheet name is required");
  const headers = Array.isArray(rec.headers)
    ? rec.headers.map((h) => String(h ?? ""))
    : [];
  const colCount = Math.max(
    headers.length,
    maxRowLength(rec.values),
    Array.isArray(rec.columnTypes) ? rec.columnTypes.length : 0,
  );
  const paddedHeaders = padHeaders(headers, colCount);
  const values = normalizeValues(rec.values, colCount);
  const columnTypes = normalizeColumnTypes(rec.columnTypes, colCount);
  const rowNames = normalizeRowNames(rec.rowNames, values.length);
  const kind = normalizeKind(rec.kind);
  const hitPolicy = normalizeHitPolicy(rec.hitPolicy);
  const collectJoin = typeof rec.collectJoin === "string" ? rec.collectJoin : undefined;
  const collectDedupe = rec.collectDedupe === true ? true : rec.collectDedupe === false ? false : undefined;
  const decisionColumns = normalizeDecisionColumns(rec.decisionColumns, colCount, kind);
  const rowCatchAll = normalizeRowCatchAll(rec.rowCatchAll, values.length);
  return {
    name,
    ...(kind ? { kind } : {}),
    headers: paddedHeaders,
    values,
    columnTypes,
    ...(rowNames ? { rowNames } : {}),
    ...(hitPolicy ? { hitPolicy } : {}),
    ...(collectJoin != null ? { collectJoin } : {}),
    ...(collectDedupe != null ? { collectDedupe } : {}),
    ...(decisionColumns ? { decisionColumns } : {}),
    ...(rowCatchAll ? { rowCatchAll } : {}),
  };
}

function normalizeKind(raw: unknown): GridKind | undefined {
  if (raw === "decision-table" || raw === "sheet") return raw;
  return undefined;
}

function normalizeHitPolicy(raw: unknown): DecisionHitPolicy | undefined {
  if (raw === "FIRST" || raw === "UNIQUE" || raw === "COLLECT") return raw;
  return undefined;
}

function normalizeDecisionColumns(
  raw: unknown,
  colCount: number,
  kind: GridKind | undefined,
): DecisionColumnMeta[] | undefined {
  if (!Array.isArray(raw)) {
    return kind === "decision-table" ? undefined : undefined;
  }
  const out: DecisionColumnMeta[] = [];
  for (let i = 0; i < colCount; i++) {
    const item = raw[i] as Record<string, unknown> | undefined;
    const role = item?.role === "output" ? "output" : "condition";
    if (role === "output") {
      const outputKind = item?.outputKind === "snippet" ? "snippet" : "value";
      const valueType = item?.valueType === "number" || item?.valueType === "boolean"
        ? item.valueType
        : "string";
      out.push({ role, outputKind, valueType: outputKind === "snippet" ? "string" : valueType });
    } else {
      out.push({ role: "condition" });
    }
  }
  return out;
}

/** Catalog `sheets` URI: a `SheetDocument` array, or a single document. */
export function sheetsFromCatalogJson(raw: unknown): SheetDocument[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return normalizeSheets(raw);
  if (typeof raw === "object") return normalizeSheets([raw]);
  throw new Error("Catalog sheets JSON must be a Sheet document or an array of them");
}

export function normalizeSheets(raw: unknown): SheetDocument[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Sheets must be an array");
  return raw.map((item, i) => {
    try {
      return normalizeSheet(item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`sheets[${i}]: ${msg}`);
    }
  });
}

function maxRowLength(values: unknown): number {
  if (!Array.isArray(values)) return 0;
  let max = 0;
  for (const row of values) {
    if (Array.isArray(row)) max = Math.max(max, row.length);
  }
  return max;
}

function padHeaders(headers: string[], colCount: number): string[] {
  const out = [...headers];
  while (out.length < colCount) out.push(indexToLetters(out.length));
  return out;
}

function normalizeValues(raw: unknown, colCount: number): SheetCell[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const cells = Array.isArray(row) ? row.map(toCell) : [];
    while (cells.length < colCount) cells.push("");
    return cells.slice(0, colCount);
  });
}

function normalizeColumnTypes(raw: unknown, colCount: number): SheetColumnType[] {
  const allowed = new Set<SheetColumnType>(["text", "numeric", "dropdown"]);
  const out: SheetColumnType[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const t = String(item);
      out.push(allowed.has(t as SheetColumnType) ? t as SheetColumnType : "text");
    }
  }
  while (out.length < colCount) out.push("text");
  return out.slice(0, colCount);
}

function normalizeRowNames(raw: unknown, rowCount: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names = raw.map((n) => String(n ?? ""));
  while (names.length < rowCount) names.push("");
  return names.slice(0, rowCount);
}

function normalizeRowCatchAll(raw: unknown, rowCount: number): boolean[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const flags = raw.map((v) => v === true);
  while (flags.length < rowCount) flags.push(false);
  return flags.slice(0, rowCount);
}

function toCell(value: unknown): SheetCell {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

export function getCellA1(sheet: SheetDocument, a1: string): SheetCell {
  const { x, y } = parseA1(a1);
  return getXy(sheet, x, y);
}

export function getXy(sheet: SheetDocument, x: number, y: number): SheetCell {
  if (y < 0 || x < 0) return null;
  const row = sheet.values[y];
  if (!row || x >= row.length) return null;
  return row[x] ?? null;
}

export function setCellA1(sheet: SheetDocument, a1: string, value: SheetCell): SheetDocument {
  const { x, y } = parseA1(a1);
  return setXy(sheet, x, y, value);
}

export function setXy(sheet: SheetDocument, x: number, y: number, value: SheetCell): SheetDocument {
  const next = cloneSheet(sheet);
  ensureSize(next, x + 1, y + 1);
  next.values[y]![x] = value;
  return next;
}

export function getRow(sheet: SheetDocument, y: number): SheetCell[] {
  if (y < 0 || y >= sheet.values.length) return [];
  return [...(sheet.values[y] ?? [])];
}

export function setRow(sheet: SheetDocument, y: number, row: SheetCell[]): SheetDocument {
  const next = cloneSheet(sheet);
  const width = Math.max(next.headers.length, row.length);
  ensureSize(next, width, y + 1);
  next.values[y] = padCells(row, next.headers.length);
  return next;
}

export function getColumn(sheet: SheetDocument, x: number): SheetCell[] {
  return sheet.values.map((row) => (x >= 0 && x < row.length ? row[x] ?? null : null));
}

export function setColumn(sheet: SheetDocument, x: number, column: SheetCell[]): SheetDocument {
  const next = cloneSheet(sheet);
  const height = Math.max(next.values.length, column.length);
  ensureSize(next, x + 1, height);
  for (let y = 0; y < next.values.length; y++) {
    next.values[y]![x] = y < column.length ? column[y]! : "";
  }
  return next;
}

export function getHeader(sheet: SheetDocument, x: number): string {
  if (x < 0 || x >= sheet.headers.length) return "";
  return sheet.headers[x] ?? "";
}

export function setHeader(sheet: SheetDocument, x: number, title: string): SheetDocument {
  const next = cloneSheet(sheet);
  ensureSize(next, x + 1, next.values.length);
  next.headers[x] = title;
  return next;
}

export function getData(sheet: SheetDocument): SheetCell[][] {
  return sheet.values.map((row) => [...row]);
}

export function setData(sheet: SheetDocument, values: SheetCell[][]): SheetDocument {
  const next = cloneSheet(sheet);
  const width = Math.max(next.headers.length, maxRowLength(values));
  next.values = normalizeValues(values, width);
  next.headers = padHeaders(next.headers, width);
  next.columnTypes = normalizeColumnTypes(next.columnTypes, width);
  if (next.rowNames) next.rowNames = normalizeRowNames(next.rowNames, next.values.length);
  if (next.rowCatchAll) {
    const flags = [...next.rowCatchAll];
    while (flags.length < next.values.length) flags.push(false);
    next.rowCatchAll = flags.slice(0, next.values.length);
  }
  return next;
}

export function insertRow(sheet: SheetDocument, y = 0, count = 1): SheetDocument {
  const next = cloneSheet(sheet);
  const at = clampIndex(y, next.values.length);
  const width = next.headers.length;
  const blank = (): SheetCell[] => Array.from({ length: width }, () => "" as SheetCell);
  const rows = Array.from({ length: Math.max(1, count) }, blank);
  next.values.splice(at, 0, ...rows);
  if (next.rowNames) next.rowNames.splice(at, 0, ...rows.map(() => ""));
  if (next.rowCatchAll) next.rowCatchAll.splice(at, 0, ...rows.map(() => false));
  return next;
}

export function deleteRow(sheet: SheetDocument, y = 0, count = 1): SheetDocument {
  const next = cloneSheet(sheet);
  if (y < 0 || y >= next.values.length) return next;
  next.values.splice(y, Math.max(1, count));
  next.rowNames?.splice(y, Math.max(1, count));
  next.rowCatchAll?.splice(y, Math.max(1, count));
  return next;
}

export function insertColumn(sheet: SheetDocument, x = 0, count = 1): SheetDocument {
  const next = cloneSheet(sheet);
  const at = clampIndex(x, next.headers.length);
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) {
    next.headers.splice(at + i, 0, indexToLetters(next.headers.length));
    next.columnTypes?.splice(at + i, 0, "text");
    next.decisionColumns?.splice(at + i, 0, { role: "condition" });
    for (const row of next.values) row.splice(at + i, 0, "");
  }
  return next;
}

function moveIndex<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Reorder one column, including cells, column types, and decision-table metadata. */
export function moveColumns(sheet: SheetDocument, from: number, to: number): SheetDocument {
  const next = cloneSheet(sheet);
  if (from === to || from < 0 || to < 0 || from >= next.headers.length || to >= next.headers.length) {
    return next;
  }
  next.headers = moveIndex(next.headers, from, to);
  next.values = next.values.map((row) => moveIndex(row, from, to));
  if (next.columnTypes) next.columnTypes = moveIndex(next.columnTypes, from, to);
  if (next.decisionColumns) next.decisionColumns = moveIndex(next.decisionColumns, from, to);
  return next;
}

/** Reorder one row, including row names and catch-all flags. */
export function moveRows(sheet: SheetDocument, from: number, to: number): SheetDocument {
  const next = cloneSheet(sheet);
  if (from === to || from < 0 || to < 0 || from >= next.values.length || to >= next.values.length) {
    return next;
  }
  next.values = moveIndex(next.values, from, to);
  if (next.rowNames) next.rowNames = moveIndex(next.rowNames, from, to);
  if (next.rowCatchAll) next.rowCatchAll = moveIndex(next.rowCatchAll, from, to);
  return next;
}

export function deleteColumn(sheet: SheetDocument, x = 0, count = 1): SheetDocument {
  const next = cloneSheet(sheet);
  if (x < 0 || x >= next.headers.length) return next;
  const n = Math.max(1, count);
  next.headers.splice(x, n);
  next.columnTypes?.splice(x, n);
  next.decisionColumns?.splice(x, n);
  for (const row of next.values) row.splice(x, n);
  return next;
}

/**
 * Find the first row where `matchColumn` equals `matchValue`.
 * `matchColumn` / `returnColumn` may be a header title, A1 letters (`A`), or 0-based index.
 * Omit `returnColumn` to get a header→cell record (includes `__row` when row names exist).
 */
export function sheetLookup(
  sheet: SheetDocument,
  matchColumn: string | number,
  matchValue: unknown,
  returnColumn?: string | number,
): unknown {
  const matchIndex = resolveColumn(sheet, matchColumn);
  if (matchIndex === undefined) return null;
  const y = sheet.values.findIndex((row, i) => {
    const cell = matchIndex === ROW_NAME_INDEX
      ? sheet.rowNames?.[i] ?? ""
      : row[matchIndex] ?? null;
    return cellsEqual(cell, matchValue);
  });
  if (y < 0) return null;
  if (returnColumn === undefined || returnColumn === null || returnColumn === "") {
    return rowRecord(sheet, y);
  }
  const retIndex = resolveColumn(sheet, returnColumn);
  if (retIndex === undefined) return null;
  if (retIndex === ROW_NAME_INDEX) return sheet.rowNames?.[y] ?? "";
  return sheet.values[y]?.[retIndex] ?? null;
}

const ROW_NAME_INDEX = -1;

function resolveColumn(sheet: SheetDocument, ref: string | number): number | undefined {
  if (typeof ref === "number") {
    if (ref === ROW_NAME_INDEX) return ROW_NAME_INDEX;
    if (ref >= 0 && ref < sheet.headers.length) return ref;
    return undefined;
  }
  const token = String(ref).trim();
  if (!token) return undefined;
  if (token === ROW_NAME_COLUMN || token.toLowerCase() === "row") {
    return sheet.rowNames ? ROW_NAME_INDEX : undefined;
  }
  const byHeader = sheet.headers.findIndex((h) => h === token);
  if (byHeader >= 0) return byHeader;
  if (/^[A-Za-z]+$/.test(token)) {
    try {
      const { x } = parseA1(`${token}1`);
      if (x >= 0 && x < sheet.headers.length) return x;
    } catch {
      return undefined;
    }
  }
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    if (n >= 0 && n < sheet.headers.length) return n;
  }
  return undefined;
}

function rowRecord(sheet: SheetDocument, y: number): Record<string, SheetCell> {
  const rec: Record<string, SheetCell> = {};
  if (sheet.rowNames) rec[ROW_NAME_COLUMN] = sheet.rowNames[y] ?? "";
  const row = sheet.values[y] ?? [];
  for (let x = 0; x < sheet.headers.length; x++) {
    const key = sheet.headers[x] || indexToLetters(x);
    rec[key] = row[x] ?? null;
  }
  return rec;
}

function cellsEqual(cell: SheetCell, match: unknown): boolean {
  if (cell == null && (match == null || match === "")) return true;
  if (typeof cell === "number" && typeof match === "number") return cell === match;
  return String(cell ?? "") === String(match ?? "");
}

function ensureSize(sheet: SheetDocument, cols: number, rows: number): void {
  while (sheet.headers.length < cols) {
    sheet.headers.push(indexToLetters(sheet.headers.length));
    sheet.columnTypes?.push("text");
    for (const row of sheet.values) row.push("");
  }
  const width = sheet.headers.length;
  while (sheet.values.length < rows) {
    sheet.values.push(Array.from({ length: width }, () => "" as SheetCell));
    sheet.rowNames?.push("");
    sheet.rowCatchAll?.push(false);
  }
  for (const row of sheet.values) {
    while (row.length < width) row.push("");
  }
}

function padCells(row: SheetCell[], width: number): SheetCell[] {
  const out = row.map(toCell);
  while (out.length < width) out.push("");
  return out.slice(0, width);
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index > length) return length;
  return Math.floor(index);
}

export { coordsToA1, parseA1 };
