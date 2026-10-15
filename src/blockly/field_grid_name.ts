/**
 * Name dropdown for a Sheet or Decision table.
 * Options are project grid names of one kind. The field does not rename or delete.
 */
import { isDecisionTable } from "../core/sheets/decision_table.ts";
import { FieldDropdownHug } from "./field_dropdown_hug.ts";
import { workspaceSheets } from "./sheets_bridge.ts";

export type GridNameKind = "sheet" | "decision-table";

/** Menu rows for `kind`. A blank row only when the project has no grids of that kind. */
export function gridNameOptions(kind: GridNameKind): [string, string][] {
  const names = workspaceSheets()
    .filter((sheet) => kind === "decision-table" ? isDecisionTable(sheet) : !isDecisionTable(sheet))
    .map((sheet) => sheet.name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return [["", ""]];
  return names.map((name) => [name, name]);
}

// deno-lint-ignore no-explicit-any
const FieldDropdownHugBase = FieldDropdownHug as any;

/**
 * Closed label is the stored name, or blank when nothing is selected.
 * A missing name stays valid so delete can clear the field without snapping
 * to another grid.
 */
export class FieldGridName extends FieldDropdownHugBase {
  constructor(kind: GridNameKind) {
    super(() => gridNameOptions(kind));
    this.setValue("");
  }

  doClassValidation_(newValue: unknown): string {
    if (newValue == null) return "";
    return String(newValue);
  }

  getText_(): string {
    return String(this.getValue?.() ?? "");
  }
}
