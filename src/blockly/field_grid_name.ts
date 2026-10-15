/**
 * Name dropdown for a Sheet or Decision table.
 * Options are project grid names of one kind. The field does not rename or delete.
 */
import { isDecisionTable } from "../core/sheets/decision_table.ts";
import { sheetsChrome } from "../ui/sheets_i18n.ts";
import { detectLocale } from "./i18n/locale.ts";
import { FieldDropdownHug } from "./field_dropdown_hug.ts";
import { workspaceSheets } from "./sheets_bridge.ts";

export type GridNameKind = "sheet" | "decision-table";

export function gridNames(kind: GridNameKind): string[] {
  return workspaceSheets()
    .filter((sheet) => kind === "decision-table" ? isDecisionTable(sheet) : !isDecisionTable(sheet))
    .map((sheet) => sheet.name.trim())
    .filter((name) => name.length > 0);
}

/** Closed-label reminder when the block has no grid selected. */
export function gridNamePlaceholder(kind: GridNameKind): string {
  const chrome = sheetsChrome(detectLocale());
  return kind === "decision-table" ? chrome.selectTable : chrome.selectSheet;
}

/**
 * Menu rows for `kind`.
 * Exactly one grid: that name only, so a new block can preselect it.
 * Zero or many: a "-- select … --" row (value "") plus the names.
 */
export function gridNameOptions(kind: GridNameKind): [string, string][] {
  const names = gridNames(kind).map((name) => [name, name] as [string, string]);
  if (names.length === 1) return names;
  return [[gridNamePlaceholder(kind), ""], ...names];
}

/** A new canvas block takes the only matching grid. An existing blank name stays blank. */
export function preselectSoleGridName(
  block: { getField: (name: string) => { getValue?: () => unknown; setValue?: (value: string) => void } | null },
  kind: GridNameKind,
): void {
  const field = block.getField("NAME");
  if (!field) return;
  if (String(field.getValue?.() ?? "").trim()) return;
  const names = gridNames(kind);
  if (names.length === 1) field.setValue?.(names[0]!);
}

// deno-lint-ignore no-explicit-any
const FieldDropdownHugBase = FieldDropdownHug as any;

/**
 * Closed label is the stored name, or "-- select … --" when nothing is selected.
 * A missing name stays valid so delete can clear the field without snapping
 * to another grid.
 */
export class FieldGridName extends FieldDropdownHugBase {
  kind_: GridNameKind;

  constructor(kind: GridNameKind) {
    super(() => gridNameOptions(kind));
    this.kind_ = kind;
    const names = gridNames(kind);
    this.setValue(names.length === 1 ? names[0] : "");
  }

  doClassValidation_(newValue: unknown): string {
    if (newValue == null) return "";
    return String(newValue);
  }

  getText_(): string {
    const value = String(this.getValue?.() ?? "");
    if (value) return value;
    return gridNamePlaceholder(this.kind_);
  }
}
