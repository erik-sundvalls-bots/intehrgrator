import { evaluateDecisionTable } from "./decision_table.ts";
import {
  deleteColumn,
  deleteRow,
  getCellA1,
  getColumn,
  getData,
  getHeader,
  getRow,
  getXy,
  insertColumn,
  insertRow,
  setCellA1,
  setColumn,
  setData,
  setHeader,
  setRow,
  setXy,
  sheetLookup,
} from "./model.ts";
import type { SheetBag, SheetCell, SheetDocument } from "./types.ts";

export const SHEET_ACCESSOR_NAMES = [
  "sheet_get_cell",
  "sheet_get_xy",
  "sheet_get_row",
  "sheet_get_column",
  "sheet_get_header",
  "sheet_get_data",
  "sheet_lookup",
  "decision_table",
] as const;

export type SheetAccessorName = typeof SHEET_ACCESSOR_NAMES[number];

export function isSheetAccessor(name: string): name is SheetAccessorName {
  return (SHEET_ACCESSOR_NAMES as readonly string[]).includes(name);
}

export function evalSheetCall(
  name: SheetAccessorName,
  args: unknown[],
  bag: SheetBag,
): unknown {
  const sheet = bag[String(args[0] ?? "")];
  if (!sheet) return null;
  try {
    switch (name) {
      case "sheet_get_cell":
        return getCellA1(sheet, String(args[1] ?? "A1"));
      case "sheet_get_xy":
        return getXy(sheet, Number(args[1] ?? 0), Number(args[2] ?? 0));
      case "sheet_get_row":
        return getRow(sheet, Number(args[1] ?? 0));
      case "sheet_get_column":
        return getColumn(sheet, Number(args[1] ?? 0));
      case "sheet_get_header":
        return getHeader(sheet, Number(args[1] ?? 0));
      case "sheet_get_data":
        return getData(sheet);
      case "sheet_lookup":
        return sheetLookup(
          sheet,
          args[1] as string | number,
          args[2],
          args.length >= 4 ? args[3] as string | number : undefined,
        );
      case "decision_table": {
        const inputs = asInputRecord(args[1]);
        const outputCol = args.length >= 3 ? String(args[2] ?? "") : undefined;
        return evaluateDecisionTable(sheet, inputs, outputCol || undefined);
      }
    }
  } catch (err) {
    // UNIQUE overlap and unknown columns should surface to Test Run.
    if (name === "decision_table") throw err;
    return null;
  }
}

function asInputRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Mutators used by Blockly statements / generated scripts; not slot expressions. */
export function applySheetMutator(
  name: string,
  args: unknown[],
  bag: SheetBag,
): SheetDocument {
  const sheetName = String(args[0] ?? "");
  const sheet = requireSheet(bag, sheetName);
  let next: SheetDocument;
  switch (name) {
    case "sheet_set_cell":
      next = setCellA1(sheet, String(args[1] ?? "A1"), args[2] as SheetCell);
      break;
    case "sheet_set_xy":
      next = setXy(sheet, Number(args[1] ?? 0), Number(args[2] ?? 0), args[3] as SheetCell);
      break;
    case "sheet_set_row":
      next = setRow(sheet, Number(args[1] ?? 0), asCellArray(args[2]));
      break;
    case "sheet_set_column":
      next = setColumn(sheet, Number(args[1] ?? 0), asCellArray(args[2]));
      break;
    case "sheet_set_header":
      next = setHeader(sheet, Number(args[1] ?? 0), String(args[2] ?? ""));
      break;
    case "sheet_set_data":
      next = setData(sheet, asGrid(args[1]));
      break;
    case "sheet_insert_row":
      next = insertRow(sheet, Number(args[1] ?? 0), Number(args[2] ?? 1));
      break;
    case "sheet_delete_row":
      next = deleteRow(sheet, Number(args[1] ?? 0), Number(args[2] ?? 1));
      break;
    case "sheet_insert_column":
      next = insertColumn(sheet, Number(args[1] ?? 0), Number(args[2] ?? 1));
      break;
    case "sheet_delete_column":
      next = deleteColumn(sheet, Number(args[1] ?? 0), Number(args[2] ?? 1));
      break;
    default:
      throw new Error(`Unknown sheet mutator: ${name}`);
  }
  bag[sheetName] = next;
  return next;
}

function requireSheet(bag: SheetBag, name: string): SheetDocument {
  const sheet = bag[name];
  if (!sheet) throw new Error(`Unknown sheet: ${name}`);
  return sheet;
}

function asCellArray(value: unknown): SheetCell[] {
  if (!Array.isArray(value)) return [];
  return value as SheetCell[];
}

function asGrid(value: unknown): SheetCell[][] {
  if (!Array.isArray(value)) return [];
  return value.map(asCellArray);
}
