import { WidgetType } from "@codemirror/view";
import {
  SOURCE_TYPE_EMOJI,
  type SourceReturnType,
} from "../../blockly/source_query.ts";
import { EDITOR_LANGUAGE_OPTIONS } from "../codemirror_setup.ts";
import { attachInfoTip, detachInfoTip } from "../../ui/info_tip.ts";
import type { SpecEditFieldName, SpecEditableField, SpecLine } from "./project.ts";
import { createSearchablePick } from "../../ui/searchable_pick.ts";

/** Matching CodeMirror line box — keep Spec rows as dense as a code listing. */
export const SPEC_LINE_HEIGHT = 18;
const CODE_ROW_HEIGHT = 15;
const CODE_MAX_ROWS = 8;

export type SpecFieldEditHandler = (
  blockId: string,
  field: SpecEditFieldName,
  value: string,
) => void;

export type SpecBlockSelectHandler = (blockId: string) => void;

export type SpecBlockCheckHandler = (blockId: string, checked: boolean) => void;

/** Active find query to paint inside Spec replace widgets (text + form controls). */
export type SpecSearchPaint = {
  search: string;
  caseSensitive: boolean;
  regexp: boolean;
  /** This widget's row holds the focused (current) match — used for row chrome. */
  current: boolean;
  /** Absolute doc range of the focused match (only that substring gets orange). */
  currentFrom: number | null;
  currentTo: number | null;
  /** Absolute start of this widget's projected line in the doc. */
  lineFrom: number;
  /** Projected line text — used to map UI strings back to doc offsets. */
  lineText: string;
};

/** Block-level widget that replaces one projected Spec line. */
export class MappingSpecWidget extends WidgetType {
  constructor(
    readonly line: SpecLine,
    readonly onFieldEdit?: SpecFieldEditHandler,
    readonly onSelect?: SpecBlockSelectHandler,
    readonly warning: string | null = null,
    readonly selected = false,
    readonly checked = false,
    readonly onCheckToggle?: SpecBlockCheckHandler,
    readonly searchHit = false,
    readonly searchHitCurrent = false,
    readonly searchPaint: SpecSearchPaint | null = null,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    if (this.line.kind === "header") return 22;
    if (this.line.editKind === "code") {
      const text = this.line.editable?.find((f) => f.field === "TEXT")?.value ?? "";
      const rows = Math.min(CODE_MAX_ROWS, Math.max(3, text.split("\n").length));
      return 20 + rows * CODE_ROW_HEIGHT;
    }
    return SPEC_LINE_HEIGHT;
  }

  override eq(other: MappingSpecWidget): boolean {
    if (this.line.kind === "header" || other.line.kind === "header") {
      return this.line.kind === other.line.kind &&
        this.line.label === other.line.label &&
        this.line.blockId === other.line.blockId &&
        this.searchHit === other.searchHit &&
        this.searchHitCurrent === other.searchHitCurrent &&
        searchPaintEq(this.searchPaint, other.searchPaint);
    }
    return (
      this.line.blockId === other.line.blockId &&
      this.line.kind === other.line.kind &&
      this.line.type === other.line.type &&
      this.line.attribute === other.line.attribute &&
      this.line.shell === other.line.shell &&
      this.line.editKind === other.line.editKind &&
      this.line.summary === other.line.summary &&
      JSON.stringify(this.line.editable) === JSON.stringify(other.line.editable) &&
      JSON.stringify(this.line.attributeEdit) === JSON.stringify(other.line.attributeEdit) &&
      JSON.stringify(this.line.aliasIds) === JSON.stringify(other.line.aliasIds) &&
      JSON.stringify(this.line.info) === JSON.stringify(other.line.info) &&
      JSON.stringify(this.line.inline) === JSON.stringify(other.line.inline) &&
      this.warning === other.warning &&
      this.selected === other.selected &&
      this.checked === other.checked &&
      this.searchHit === other.searchHit &&
      this.searchHitCurrent === other.searchHitCurrent &&
      searchPaintEq(this.searchPaint, other.searchPaint)
    );
  }

  override toDOM(): HTMLElement {
    if (this.line.kind === "header") {
      const divider = document.createElement("div");
      divider.className = "spec-root-divider";
      if (this.searchHit) divider.classList.add("spec-root-divider--search-hit");
      if (this.searchHitCurrent) {
        divider.classList.add("spec-root-divider--search-hit-current");
      }
      const label = document.createElement("span");
      label.className = "spec-root-divider-label";
      label.textContent = this.line.label || this.line.summary || this.line.type;
      divider.appendChild(label);
      if (this.line.blockId) divider.dataset.blockId = this.line.blockId;
      if (this.onSelect && this.line.blockId) {
        divider.tabIndex = 0;
        divider.classList.add("spec-root-divider--clickable");
        divider.addEventListener("click", () => this.onSelect?.(this.line.blockId!));
      }
      applySpecSearchPaint(divider, this.searchPaint);
      return divider;
    }
    const row = document.createElement("span");
    row.className = `spec-widget spec-widget--${this.line.kind}`;
    if (this.line.editKind === "code") row.classList.add("spec-widget--multiline");
    if (this.line.inline) row.classList.add("spec-widget--has-inline");
    if (this.selected) row.classList.add("spec-widget--selected");
    if (this.checked) row.classList.add("spec-widget--checked");
    if (this.searchHit) row.classList.add("spec-widget--search-hit");
    if (this.searchHitCurrent) row.classList.add("spec-widget--search-hit-current");
    row.style.paddingLeft = `${4 + this.line.indent * 12}px`;
    if (this.line.blockId) row.dataset.blockId = this.line.blockId;
    if (this.warning) {
      row.title = this.warning;
      row.dataset.warning = "1";
    }

    if (this.line.blockId) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "spec-widget-checkbox";
      checkbox.checked = this.checked;
      checkbox.setAttribute("aria-label", "Select row for bulk action");
      checkbox.addEventListener("mousedown", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        this.onCheckToggle?.(this.line.blockId!, checkbox.checked);
      });
      row.appendChild(checkbox);
    }

    if (this.warning) {
      const warn = document.createElement("span");
      warn.className = "spec-widget-warning";
      warn.textContent = "⚠";
      warn.setAttribute("aria-label", this.warning);
      warn.title = this.warning;
      row.appendChild(warn);
    }

    if (this.line.attributeEdit && this.line.blockId) {
      const attr = document.createElement("span");
      attr.className = "spec-widget-attr spec-widget-attr--edit";
      if (this.line.attribute?.startsWith("@")) {
        const at = document.createElement("span");
        at.className = "spec-widget-punct";
        at.textContent = "@";
        attr.appendChild(at);
      }
      attr.appendChild(
        textInput(
          this.line,
          this.line.attributeEdit,
          this.onFieldEdit,
          this.line.attribute?.startsWith("@") ? "Attribute name" : "Map key",
          "spec-widget-input spec-widget-input--attr",
        ),
      );
      row.appendChild(attr);
    } else if (this.line.attribute) {
      const attr = document.createElement("span");
      attr.className = "spec-widget-attr";
      attr.textContent = this.line.attribute;
      attr.title = this.line.attribute;
      row.appendChild(attr);
    }

    const badge = document.createElement("span");
    badge.className = "spec-widget-badge";
    badge.textContent = badgeLabel(this.line);
    if (this.line.shell) badge.title = this.line.shell;
    row.appendChild(badge);

    const editors = document.createElement("span");
    editors.className = this.line.editKind === "code"
      ? "spec-widget-editors spec-widget-editors--stack"
      : "spec-widget-editors";
    renderEditors(editors, this.line, this.onFieldEdit);
    row.appendChild(editors);

    if (this.line.inline) row.appendChild(inlineLeaf(this.line.inline, this.onFieldEdit));

    const tip = document.createElement("span");
    tip.className = "info-tip info-tip--end";
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "info-tip-btn spec-widget-info";
    infoBtn.textContent = "i";
    infoBtn.setAttribute("aria-expanded", "false");
    infoBtn.setAttribute("aria-label", "Block details");
    const balloon = document.createElement("pre");
    balloon.className = "info-tip-balloon info-tip-balloon--code";
    balloon.hidden = true;
    balloon.setAttribute("role", "tooltip");
    balloon.textContent = JSON.stringify(this.line.info, null, 2);
    tip.append(infoBtn, balloon);
    attachInfoTip(tip);
    row.append(tip);

    if (this.line.blockId) {
      row.addEventListener("mousedown", (event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("input, select, textarea, button, .info-tip, .info-tip-balloon, .spec-widget-checkbox")
        ) {
          return;
        }
        event.preventDefault();
        this.onSelect?.(this.line.blockId!);
      });
    }
    applySpecSearchPaint(row, this.searchPaint);
    return row;
  }

  override destroy(dom: HTMLElement): void {
    const tip = dom.querySelector<HTMLElement>(".info-tip");
    if (tip) detachInfoTip(tip);
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** #246: the ELEMENT's single data value, drawn on the ELEMENT's own row. */
function inlineLeaf(leaf: SpecLine, onFieldEdit?: SpecFieldEditHandler): HTMLElement {
  const host = document.createElement("span");
  host.className = `spec-widget-inline spec-widget-inline--${leaf.kind}`;
  if (leaf.blockId) host.dataset.blockId = leaf.blockId;
  if (leaf.attribute) {
    const attr = document.createElement("span");
    attr.className = "spec-widget-attr spec-widget-attr--inline";
    attr.textContent = leaf.attribute;
    attr.title = leaf.attribute;
    host.appendChild(attr);
  }
  const badge = document.createElement("span");
  badge.className = "spec-widget-badge";
  badge.textContent = badgeLabel(leaf);
  if (leaf.shell) badge.title = leaf.shell;
  host.appendChild(badge);
  const editors = document.createElement("span");
  editors.className = "spec-widget-editors";
  renderEditors(editors, leaf, onFieldEdit);
  host.appendChild(editors);
  return host;
}

function renderEditors(
  host: HTMLElement,
  line: SpecLine,
  onFieldEdit?: SpecFieldEditHandler,
): void {
  const fields = line.editable ?? [];
  if (!fields.length || line.editKind === "none" || !line.blockId) {
    const summary = document.createElement("span");
    summary.className = "spec-widget-summary";
    summary.textContent = line.summary || line.label;
    host.appendChild(summary);
    return;
  }

  if (line.editKind === "source_path") {
    const returnField = fields.find((f) => f.field === "RETURN_TYPE");
    const exprField = fields.find((f) => f.field === "EXPRESSION");
    if (returnField) {
      host.appendChild(returnTypeSelect(line, returnField, onFieldEdit));
    } else {
      const typeHint = document.createElement("span");
      typeHint.className = "spec-widget-type";
      const summaryType = sourceReturnTypeFromSummary(line.summary);
      typeHint.textContent = SOURCE_TYPE_EMOJI[summaryType];
      typeHint.title = summaryType;
      typeHint.setAttribute("aria-label", summaryType);
      host.appendChild(typeHint);
    }
    if (exprField) {
      host.appendChild(textInput(line, exprField, onFieldEdit, "Source path expression", "spec-widget-input"));
    }
    return;
  }

  if (line.editKind === "map_get") {
    const name = fields.find((f) => f.field === "NAME");
    const key = fields.find((f) => f.field === "TEXT" || f.field === "EXPRESSION");
    if (name) {
      host.appendChild(textInput(line, name, onFieldEdit, "Map name", "spec-widget-input spec-widget-input--name"));
    }
    const lbrack = document.createElement("span");
    lbrack.className = "spec-widget-punct";
    lbrack.textContent = "[";
    host.appendChild(lbrack);
    if (key) {
      host.appendChild(textInput(line, key, onFieldEdit, "Map key", "spec-widget-input"));
    }
    const rbrack = document.createElement("span");
    rbrack.className = "spec-widget-punct";
    rbrack.textContent = "]";
    host.appendChild(rbrack);
    return;
  }

  if (line.editKind === "compare") {
    for (const field of fields) {
      if (field.field === "OP") {
        host.appendChild(opSelect(line, field, onFieldEdit));
      } else {
        host.appendChild(textInput(line, field, onFieldEdit, field.field, "spec-widget-input spec-widget-input--short"));
      }
    }
    return;
  }

  if (line.editKind === "sheet_lookup") {
    const name = fields.find((f) => f.field === "NAME");
    const rest = fields.filter((f) => f.field !== "NAME");
    if (name) {
      host.appendChild(textInput(line, name, onFieldEdit, "Sheet name", "spec-widget-input spec-widget-input--name"));
    }
    const punct = (text: string) => {
      const el = document.createElement("span");
      el.className = "spec-widget-punct";
      el.textContent = text;
      return el;
    };
    if (rest[0]) {
      host.appendChild(punct("where"));
      host.appendChild(textInput(line, rest[0], onFieldEdit, "Match column", "spec-widget-input spec-widget-input--short"));
    }
    if (rest[1]) {
      host.appendChild(punct("="));
      host.appendChild(textInput(line, rest[1], onFieldEdit, "Match value", "spec-widget-input"));
    }
    if (rest[2]) {
      host.appendChild(punct("→"));
      host.appendChild(textInput(line, rest[2], onFieldEdit, "Return column", "spec-widget-input spec-widget-input--short"));
    }
    return;
  }

  if (line.editKind === "code") {
    const lang = fields.find((f) => f.field === "LANG");
    const text = fields.find((f) => f.field === "TEXT");
    if (lang) host.appendChild(langSelect(line, lang, onFieldEdit));
    if (text) host.appendChild(codeArea(line, text, onFieldEdit));
    return;
  }

  if (line.editKind === "loop") {
    const name = fields.find((f) => f.field === "VAR");
    const path = fields.find((f) => f.field === "PATH");
    const prefix = document.createElement("span");
    prefix.className = "spec-widget-punct";
    prefix.textContent = "for each";
    host.appendChild(prefix);
    if (name) host.appendChild(textInput(line, name, onFieldEdit, "Loop variable", "spec-widget-input spec-widget-input--name"));
    const inn = document.createElement("span");
    inn.className = "spec-widget-punct";
    inn.textContent = "in";
    host.appendChild(inn);
    if (path) host.appendChild(textInput(line, path, onFieldEdit, "Source path", "spec-widget-input"));
    return;
  }

  if (line.editKind === "boolean") {
    const bool = fields.find((f) => f.field === "BOOL");
    if (bool) host.appendChild(boolSelect(line, bool, onFieldEdit));
    return;
  }

  if (line.editKind === "term_pick") {
    const set = fields.find((f) => f.field === "SET");
    const code = fields.find((f) => f.field === "CODE");
    if (set) {
      host.appendChild(
        pickField(line, set, onFieldEdit, "Term set", "spec-widget-select spec-widget-select--set"),
      );
    }
    if (code) {
      host.appendChild(
        pickField(line, code, onFieldEdit, "Term code", "spec-widget-input spec-widget-input--code"),
      );
    }
    return;
  }

  for (const field of fields) {
    if (field.field === "LANG") {
      host.appendChild(langSelect(line, field, onFieldEdit));
      continue;
    }
    if (field.options?.length) {
      host.appendChild(pickField(line, field, onFieldEdit, field.field, "spec-widget-select"));
      continue;
    }
    host.appendChild(textInput(line, field, onFieldEdit, field.field, "spec-widget-input"));
  }
}

function editTarget(line: SpecLine, field: SpecEditableField): string | undefined {
  return field.targetBlockId ?? line.blockId;
}

function commit(
  line: SpecLine,
  field: SpecEditableField,
  value: string,
  onFieldEdit?: SpecFieldEditHandler,
): void {
  const id = editTarget(line, field);
  if (id) onFieldEdit?.(id, field.field, value);
}

function textInput(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit: SpecFieldEditHandler | undefined,
  aria: string,
  className: string,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = field.field === "NUM" ? "number" : "text";
  input.className = className;
  input.value = field.value;
  input.setAttribute("aria-label", aria);
  input.addEventListener("change", () => commit(line, field, input.value, onFieldEdit));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  return input;
}

function codeArea(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit?: SpecFieldEditHandler,
): HTMLTextAreaElement {
  const area = document.createElement("textarea");
  area.className = "spec-widget-code";
  area.value = field.value;
  area.setAttribute("aria-label", "Generated text");
  const rows = Math.min(CODE_MAX_ROWS, Math.max(3, field.value.split("\n").length));
  area.rows = rows;
  area.spellcheck = false;
  area.addEventListener("change", () => commit(line, field, area.value, onFieldEdit));
  return area;
}

function returnTypeSelect(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit?: SpecFieldEditHandler,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "spec-widget-select spec-widget-type-select";
  select.setAttribute("aria-label", "Return type");
  for (const opt of ["string", "number", "boolean"] as SourceReturnType[]) {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = `${SOURCE_TYPE_EMOJI[opt]} ${opt}`;
    if (opt === (field.value ?? "string")) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => commit(line, field, select.value, onFieldEdit));
  return select;
}

function langSelect(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit?: SpecFieldEditHandler,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "spec-widget-select";
  select.setAttribute("aria-label", "Code language");
  for (const [label, value] of EDITOR_LANGUAGE_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === field.value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => commit(line, field, select.value, onFieldEdit));
  return select;
}

function opSelect(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit?: SpecFieldEditHandler,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "spec-widget-select spec-widget-select--op";
  select.setAttribute("aria-label", "Compare operator");
  for (const [value, label] of [
    ["EQ", "="],
    ["NEQ", "≠"],
    ["LT", "<"],
    ["LTE", "≤"],
    ["GT", ">"],
    ["GTE", "≥"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === field.value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => commit(line, field, select.value, onFieldEdit));
  return select;
}

function pickField(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit: SpecFieldEditHandler | undefined,
  aria: string,
  className: string,
): HTMLElement {
  return createSearchablePick({
    options: field.options ?? [],
    value: field.value,
    ariaLabel: aria,
    className,
    onCommit: (value) => commit(line, field, value, onFieldEdit),
  });
}

function boolSelect(
  line: SpecLine,
  field: SpecEditableField,
  onFieldEdit?: SpecFieldEditHandler,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "spec-widget-select";
  select.setAttribute("aria-label", "Boolean");
  for (const [value, label] of [["TRUE", "true"], ["FALSE", "false"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === field.value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => commit(line, field, select.value, onFieldEdit));
  return select;
}

function sourceReturnTypeFromSummary(summary: string): SourceReturnType {
  const raw = summary.split(" · ")[0] ?? "string";
  if (raw === "number" || raw === "boolean" || raw === "node") return raw;
  return "string";
}

/** Short type badge shown on a Spec row. */
export function specBadgeLabel(line: SpecLine): string {
  return badgeLabel(line);
}

function badgeLabel(line: SpecLine): string {
  if (line.shell) {
    return line.shell.replace(/^dv_/i, "DV_").toUpperCase();
  }
  switch (line.kind) {
    case "header":
      return "spec";
    case "source_query":
      return "source";
    case "dv":
      return line.type.replace(/^dv_/i, "DV_").toUpperCase();
    case "value":
      // #246: openEHR ELEMENT blocks are ELEMENTs (the value slot is in the summary).
      return line.type === "element" ? "ELEMENT" : "slot";
    case "map_lookup":
      return "map";
    case "term_pick":
      return "TERM_PICK";
    case "sheet_lookup":
      return "sheet";
    case "text_gen":
      return line.editable?.find((f) => f.field === "LANG")?.value || "code";
    case "literal":
      return line.editKind === "number" ? "num" : line.editKind === "boolean" ? "bool" : "text";
    case "logic":
      return line.type === "logic_operation" ? line.label : "if";
    case "container":
      return line.type.replace(/^schema_/, "");
    default:
      return line.type;
  }
}

function searchPaintEq(a: SpecSearchPaint | null, b: SpecSearchPaint | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.search === b.search &&
    a.caseSensitive === b.caseSensitive &&
    a.regexp === b.regexp &&
    a.current === b.current &&
    a.currentFrom === b.currentFrom &&
    a.currentTo === b.currentTo &&
    a.lineFrom === b.lineFrom &&
    a.lineText === b.lineText;
}

function textMatchesSearch(text: string, paint: SpecSearchPaint): boolean {
  if (!text || !paint.search) return false;
  if (paint.regexp) {
    try {
      return new RegExp(paint.search, paint.caseSensitive ? "" : "i").test(text);
    } catch {
      return false;
    }
  }
  if (paint.caseSensitive) return text.includes(paint.search);
  return text.toLowerCase().includes(paint.search.toLowerCase());
}

/**
 * Locate `displayText` in the projected line without treating it as a prefix of
 * a longer token (so "language" does not bind to "languages").
 */
export function indexOfDisplayInLine(lineText: string, displayText: string, from: number): number {
  let idx = lineText.indexOf(displayText, from);
  while (idx >= 0) {
    const after = lineText[idx + displayText.length];
    const before = idx > 0 ? lineText[idx - 1] : undefined;
    const endsWord = /[A-Za-z0-9_]$/.test(displayText);
    const startsWord = /^[A-Za-z0-9_]/.test(displayText);
    if (endsWord && after && /[A-Za-z0-9_]/.test(after)) {
      idx = lineText.indexOf(displayText, idx + 1);
      continue;
    }
    if (startsWord && before && /[A-Za-z0-9_]/.test(before)) {
      idx = lineText.indexOf(displayText, idx + 1);
      continue;
    }
    return idx;
  }
  return -1;
}

/** Claim the next unused standalone occurrence of `displayText` in the line. */
export function claimDisplayAnchor(
  lineText: string,
  displayText: string,
  usedAnchors: Set<number>,
): number | null {
  let from = 0;
  while (from <= lineText.length) {
    const anchor = indexOfDisplayInLine(lineText, displayText, from);
    if (anchor < 0) return null;
    if (!usedAnchors.has(anchor)) {
      usedAnchors.add(anchor);
      return anchor;
    }
    from = anchor + 1;
  }
  return null;
}

/**
 * Whether a match at [start, end) inside a display string anchored at
 * `lineAnchor` (offset in the projected line) is the focused find hit.
 */
export function displayMatchIsCurrent(
  paint: SpecSearchPaint,
  lineAnchor: number,
  start: number,
  end: number,
): boolean {
  if (paint.currentFrom == null || paint.currentTo == null || lineAnchor < 0) return false;
  const absFrom = paint.lineFrom + lineAnchor + start;
  const absTo = paint.lineFrom + lineAnchor + end;
  return absFrom === paint.currentFrom && absTo === paint.currentTo;
}

/** True when any search hit inside this anchored display is the focused match. */
export function displayOwnsCurrentMatch(
  paint: SpecSearchPaint,
  displayText: string,
  lineAnchor: number,
): boolean {
  if (paint.currentFrom == null || paint.currentTo == null || !paint.search || lineAnchor < 0) {
    return false;
  }
  if (paint.regexp) {
    try {
      const re = new RegExp(paint.search, paint.caseSensitive ? "g" : "gi");
      for (const match of displayText.matchAll(re)) {
        const start = match.index ?? 0;
        const body = match[0] ?? "";
        if (body && displayMatchIsCurrent(paint, lineAnchor, start, start + body.length)) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }
  const hay = paint.caseSensitive ? displayText : displayText.toLowerCase();
  const needle = paint.caseSensitive ? paint.search : paint.search.toLowerCase();
  let idx = hay.indexOf(needle);
  while (idx >= 0) {
    if (displayMatchIsCurrent(paint, lineAnchor, idx, idx + paint.search.length)) return true;
    idx = hay.indexOf(needle, idx + Math.max(1, paint.search.length));
  }
  return false;
}

function markClassName(
  paint: SpecSearchPaint,
  lineAnchor: number,
  start: number,
  end: number,
): string {
  return displayMatchIsCurrent(paint, lineAnchor, start, end)
    ? "spec-search-text-hit spec-search-text-hit--current"
    : "spec-search-text-hit";
}

/** Split plain text into text + <mark> nodes for each match. */
export function highlightSearchInText(
  text: string,
  paint: SpecSearchPaint,
  lineAnchor: number,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!paint.search || !textMatchesSearch(text, paint)) {
    frag.append(text);
    return frag;
  }
  if (paint.regexp) {
    let re: RegExp;
    try {
      re = new RegExp(paint.search, paint.caseSensitive ? "g" : "gi");
    } catch {
      frag.append(text);
      return frag;
    }
    let last = 0;
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      const body = match[0] ?? "";
      if (!body) break;
      if (start > last) frag.append(text.slice(last, start));
      const mark = document.createElement("mark");
      mark.className = markClassName(paint, lineAnchor, start, start + body.length);
      mark.textContent = body;
      frag.append(mark);
      last = start + body.length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }
  const needle = paint.search;
  const hay = paint.caseSensitive ? text : text.toLowerCase();
  const needleCmp = paint.caseSensitive ? needle : needle.toLowerCase();
  let last = 0;
  let idx = hay.indexOf(needleCmp, last);
  while (idx >= 0) {
    if (idx > last) frag.append(text.slice(last, idx));
    const end = idx + needle.length;
    const mark = document.createElement("mark");
    mark.className = markClassName(paint, lineAnchor, idx, end);
    mark.textContent = text.slice(idx, end);
    frag.append(mark);
    last = end;
    idx = hay.indexOf(needleCmp, last);
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/**
 * Native inputs/selects cannot host &lt;mark&gt; nodes. Mirror the displayed
 * value in an overlay so the matching substring can be highlighted like CM.
 */
function paintControlSubstring(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  paint: SpecSearchPaint,
  lineAnchor: number,
): void {
  const display = el instanceof HTMLSelectElement
    ? (el.selectedOptions[0]?.text ?? el.value)
    : el.value;
  if (!textMatchesSearch(display, paint)) return;

  let wrap = el.parentElement;
  if (!wrap?.classList.contains("spec-search-control-wrap")) {
    wrap = document.createElement("span");
    wrap.className = "spec-search-control-wrap";
    el.replaceWith(wrap);
    wrap.appendChild(el);
  }
  let mirror = wrap.querySelector<HTMLElement>(":scope > .spec-search-control-mirror");
  if (!mirror) {
    mirror = document.createElement("span");
    mirror.className = "spec-search-control-mirror";
    mirror.setAttribute("aria-hidden", "true");
    wrap.appendChild(mirror);
  }
  mirror.replaceChildren(highlightSearchInText(display, paint, lineAnchor));
  el.classList.add("spec-search-control-hit");
  if (displayOwnsCurrentMatch(paint, display, lineAnchor)) {
    el.classList.add("spec-search-control-hit-current");
  } else {
    el.classList.remove("spec-search-control-hit-current");
  }
}

function controlDisplayValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string {
  return el instanceof HTMLSelectElement
    ? (el.selectedOptions[0]?.text ?? el.value)
    : el.value;
}

/**
 * Walk the widget in tree order so duplicate labels (e.g. attribute + map key
 * both "language") claim distinct anchors in the projected line text.
 */
export function applySpecSearchPaint(root: HTMLElement, paint: SpecSearchPaint | null): void {
  if (!paint?.search) return;

  const usedAnchors = new Set<number>();
  const claim = (display: string): number | null =>
    claimDisplayAnchor(paint.lineText, display, usedAnchors);

  const visit = (node: Node): void => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement) {
      if (node.classList.contains("spec-widget-checkbox")) return;
      if (node.closest(".spec-search-control-mirror, .info-tip-balloon, mark")) return;
      const display = controlDisplayValue(node);
      if (!textMatchesSearch(display, paint)) return;
      const anchor = claim(display);
      if (anchor == null) return;
      paintControlSubstring(node, paint, anchor);
      return;
    }
    if (node instanceof HTMLElement) {
      if (
        node.classList.contains("spec-search-control-mirror") ||
        node.classList.contains("info-tip-balloon") ||
        node.tagName === "MARK"
      ) {
        return;
      }
      for (const child of Array.from(node.childNodes)) visit(child);
      return;
    }
    if (node instanceof Text) {
      const text = node.nodeValue ?? "";
      if (!text || !textMatchesSearch(text, paint)) return;
      const parent = node.parentElement;
      if (!parent) return;
      if (
        parent.closest(
          "input, textarea, select, button, .info-tip-balloon, mark, .spec-search-control-mirror",
        )
      ) {
        return;
      }
      const anchor = claim(text);
      if (anchor == null) return;
      const frag = highlightSearchInText(text, paint, anchor);
      node.parentNode?.replaceChild(frag, node);
    }
  };

  visit(root);
}
