import { EditorSelection, EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { foldGutter, foldKeymap, foldService } from "@codemirror/language";
import {
  blocklyJsonDocument,
  blocklyJsonDocumentForRoot,
  type BlocklyJsonDocument,
  type SpecLine,
} from "./project.ts";
import { MappingSpecWidget, SPEC_LINE_HEIGHT, type SpecFieldEditHandler, type SpecBlockSelectHandler, type SpecBlockCheckHandler, type SpecSearchPaint } from "./widgets.ts";
import { specOverviewTickTopPx, specWarningMarkers } from "./overview.ts";
import {
  editorFindExtensions,
  type EditorCopyAllHandler,
} from "../codemirror_setup.ts";
import { getSearchQuery, setSearchQuery } from "@codemirror/search";

const setJsonDocEffect = StateEffect.define<BlocklyJsonDocument>();

const jsonDocField = StateField.define<BlocklyJsonDocument>({
  create() {
    return blocklyJsonDocument(null);
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setJsonDocEffect)) return effect.value;
    }
    return value;
  },
});

const editFacet = Facet.define<
  SpecFieldEditHandler | undefined,
  SpecFieldEditHandler | undefined
>({
  combine(values) {
    return values.find((value) => value !== undefined);
  },
});

const selectFacet = Facet.define<
  SpecBlockSelectHandler | undefined,
  SpecBlockSelectHandler | undefined
>({
  combine(values) {
    return values.find((value) => value !== undefined);
  },
});

const checkFacet = Facet.define<
  SpecBlockCheckHandler | undefined,
  SpecBlockCheckHandler | undefined
>({
  combine(values) {
    return values.find((value) => value !== undefined);
  },
});

export interface SpecChrome {
  warnings: Record<string, string>;
  selectedBlockId: string | null;
  checkedBlockIds: ReadonlySet<string>;
}

const emptyChrome: SpecChrome = {
  warnings: {},
  selectedBlockId: null,
  checkedBlockIds: new Set(),
};

const setSpecChromeEffect = StateEffect.define<SpecChrome>();

const specChromeField = StateField.define<SpecChrome>({
  create() {
    return emptyChrome;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpecChromeEffect)) return effect.value;
    }
    return value;
  },
});

function warningForLine(line: SpecLine, warnings: Record<string, string>): string | null {
  if (line.blockId && warnings[line.blockId]) return warnings[line.blockId] ?? null;
  for (const id of line.aliasIds ?? []) {
    if (warnings[id]) return warnings[id] ?? null;
  }
  return null;
}

function lineIsSelected(line: SpecLine, selectedBlockId: string | null): boolean {
  if (!selectedBlockId) return false;
  return line.blockId === selectedBlockId || (line.aliasIds ?? []).includes(selectedBlockId);
}

/**
 * Replace decorations that span line breaks must come from a StateField,
 * not a ViewPlugin (CodeMirror: "may not be specified via plugins").
 */
function lineIsChecked(line: SpecLine, checkedBlockIds: ReadonlySet<string>): boolean {
  if (!line.blockId) return false;
  if (checkedBlockIds.has(line.blockId)) return true;
  return (line.aliasIds ?? []).some((id) => checkedBlockIds.has(id));
}

/** Whether `[from, to)` contains a match for the active CodeMirror search query. */
export function specRangeMatchesSearch(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  if (from >= to) return false;
  const query = getSearchQuery(state);
  if (!query.valid) return false;
  const cursor = query.getCursor(state, from, to);
  return !cursor.next().done;
}

/**
 * Match range last jumped to via find next/prev (`select.search`).
 * Replace widgets hide CM's own selected-match marks and often remap the
 * caret off the match, so we keep an explicit focus range for orange styling.
 */
export const specSearchFocusField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    if (tr.isUserEvent("select.search")) {
      const sel = tr.newSelection.main;
      return sel.empty ? null : { from: sel.from, to: sel.to };
    }
    if (tr.effects.some((effect) => effect.is(setSearchQuery))) {
      const query = getSearchQuery(tr.state);
      if (!query.valid) return null;
      // Keep focus if it still matches; otherwise land on the first hit so the
      // current (orange) paint is visible without requiring Next.
      if (value) {
        const cursor = query.getCursor(tr.state, value.from, value.to);
        const hit = cursor.next();
        if (!hit.done && hit.value.from === value.from && hit.value.to === value.to) {
          return value;
        }
      }
      const first = query.getCursor(tr.state, 0, tr.state.doc.length).next();
      return first.done ? null : { from: first.value.from, to: first.value.to };
    }
    if (tr.docChanged) return null;
    return value;
  },
});

/**
 * Keep the CM selection on the painted current match after setSearchQuery.
 * findNext starts from selection.to — without this, the first Next after a
 * fresh search re-selects the already-highlighted first hit.
 */
export const syncSelectionToSpecSearchFocus = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (!update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) {
      return;
    }
    const focus = update.state.field(specSearchFocusField, false);
    if (!focus) return;
    const sel = update.state.selection.main;
    if (sel.from === focus.from && sel.to === focus.to) return;
    const view = update.view;
    const target = { from: focus.from, to: focus.to };
    queueMicrotask(() => {
      if (view.isDestroyed) return;
      const current = view.state.field(specSearchFocusField, false);
      if (!current || current.from !== target.from || current.to !== target.to) return;
      const main = view.state.selection.main;
      if (main.from === current.from && main.to === current.to) return;
      view.dispatch({
        selection: EditorSelection.single(current.from, current.to),
        userEvent: "select.search",
      });
    });
  }
});

/** Whether this Spec widget range contains the focused (current) search match. */
export function specRangeIsCurrentSearchHit(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const focus = state.field(specSearchFocusField, false);
  if (focus) {
    return focus.from < to && focus.to > from;
  }
  // Fallback: CM-style exact selection === match (works when selection sticks).
  const query = getSearchQuery(state);
  if (!query.valid) return false;
  const cursor = query.getCursor(state, from, to);
  for (let iter = cursor.next(); !iter.done; iter = cursor.next()) {
    const match = iter.value;
    if (state.selection.ranges.some((r) => r.from === match.from && r.to === match.to)) {
      return true;
    }
  }
  return false;
}

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.field(jsonDocField);
  const onEdit = state.facet(editFacet);
  const onSelect = state.facet(selectFacet);
  const onCheck = state.facet(checkFacet);
  const chrome = state.field(specChromeField);
  if (!doc.widgets.length) return Decoration.none;

  const query = getSearchQuery(state);
  const focus = state.field(specSearchFocusField, false);
  const basePaint: Omit<
    SpecSearchPaint,
    "current" | "currentFrom" | "currentTo" | "lineFrom" | "lineText"
  > | null = query.valid
    ? {
      search: query.search,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
    }
    : null;

  const ranges = [];
  for (const widget of doc.widgets) {
    const searchHit = specRangeMatchesSearch(state, widget.from, widget.to);
    const searchHitCurrent = specRangeIsCurrentSearchHit(state, widget.from, widget.to);
    const lineText = state.doc.sliceString(widget.from, widget.to);
    const focusedInWidget = focus && focus.from < widget.to && focus.to > widget.from
      ? focus
      : null;
    const searchPaint: SpecSearchPaint | null = searchHit && basePaint
      ? {
        ...basePaint,
        current: searchHitCurrent,
        currentFrom: focusedInWidget?.from ?? null,
        currentTo: focusedInWidget?.to ?? null,
        lineFrom: widget.from,
        lineText,
      }
      : null;
    ranges.push(
      Decoration.replace({
        widget: new MappingSpecWidget(
          widget.line,
          onEdit,
          onSelect,
          warningForLine(widget.line, chrome.warnings),
          lineIsSelected(widget.line, chrome.selectedBlockId),
          lineIsChecked(widget.line, chrome.checkedBlockIds),
          onCheck,
          searchHit,
          searchHitCurrent,
          searchPaint,
        ),
        block: widget.line.editKind === "code",
        inclusive: widget.line.editKind !== "code",
      }).range(widget.from, widget.to),
    );
  }
  return Decoration.set(ranges, true);
}

function indentFoldRange(
  state: EditorState,
  lineStart: number,
  _lineEnd: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  if (!line.text.trim()) return null;
  const indent = /^ */.exec(line.text)?.[0].length ?? 0;
  let end = line.to;
  let sawChild = false;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    if (!next.text.trim()) {
      end = next.to;
      continue;
    }
    const nextIndent = /^ */.exec(next.text)?.[0].length ?? 0;
    if (nextIndent <= indent) break;
    sawChild = true;
    end = next.to;
  }
  return sawChild ? { from: line.to, to: end } : null;
}

const jsonDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.isUserEvent("select.search") ||
      tr.effects.some((effect) =>
        effect.is(setJsonDocEffect) ||
        effect.is(setSpecChromeEffect) ||
        effect.is(setSearchQuery)
      )
    ) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const specTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
  ".cm-content": {
    caretColor: "transparent",
    padding: "2px 0",
    lineHeight: `${SPEC_LINE_HEIGHT}px`,
  },
  ".cm-line": {
    padding: "0 2px",
    lineHeight: `${SPEC_LINE_HEIGHT}px`,
    minHeight: `${SPEC_LINE_HEIGHT}px`,
  },
  ".cm-line:has(.spec-widget--multiline)": {
    height: "auto",
    lineHeight: "normal",
    overflow: "visible",
  },
  ".cm-gutters": {
    lineHeight: `${SPEC_LINE_HEIGHT}px`,
    minHeight: "0",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minHeight: `${SPEC_LINE_HEIGHT}px`,
    lineHeight: `${SPEC_LINE_HEIGHT}px`,
    fontSize: "10px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    minHeight: `${SPEC_LINE_HEIGHT}px`,
    lineHeight: `${SPEC_LINE_HEIGHT}px`,
  },
  ".cm-widgetBuffer": {
    height: "0",
    lineHeight: "0",
  },
  ".spec-widget--selected": {
    background: "#fff8e1",
    outline: "2px solid #F9A825",
    outlineOffset: "-1px",
    borderRadius: "2px",
  },
  ".spec-widget--search-hit": {
    background: "rgba(255, 226, 0, 0.35)",
    borderRadius: "2px",
  },
  ".spec-widget-warning": {
    flex: "0 0 auto",
    color: "#E65100",
    fontSize: "12px",
    lineHeight: "14px",
    cursor: "help",
  },
  ".spec-widget-checkbox": {
    flex: "0 0 auto",
    width: "14px",
    height: "14px",
    margin: "0 2px 0 0",
    cursor: "pointer",
  },
  ".spec-widget--checked": {
    background: "#eef7ff",
  },
  /* After checked/selected so the current find target stays visibly orange. */
  ".spec-widget--search-hit-current": {
    background: "rgba(255, 122, 0, 0.45)",
    boxShadow: "inset 0 0 0 2px #ff6a00",
    borderRadius: "2px",
  },
  ".spec-root-divider--search-hit": {
    background: "rgba(255, 226, 0, 0.35)",
  },
  ".spec-root-divider--search-hit-current": {
    background: "rgba(255, 122, 0, 0.45)",
    boxShadow: "inset 0 0 0 2px #ff6a00",
  },
  /* Substring marks must contrast with both yellow and orange row washes. */
  ".spec-search-text-hit": {
    background: "#ffe200",
    color: "#111",
    borderRadius: "2px",
    padding: "0 1px",
  },
  ".spec-search-text-hit--current": {
    background: "#e65100",
    color: "#fff",
  },
  ".spec-search-control-wrap": {
    position: "relative",
    display: "inline-flex",
    flex: "1 1 auto",
    minWidth: "0",
    maxWidth: "100%",
    alignItems: "stretch",
  },
  ".spec-search-control-wrap > input, .spec-search-control-wrap > textarea, .spec-search-control-wrap > select":
    {
      flex: "1 1 auto",
      minWidth: "0",
      color: "transparent !important",
      // Deno/Chromium: color alone is not always enough for form controls.
      WebkitTextFillColor: "transparent",
      caretColor: "#111",
    },
  ".spec-search-control-wrap:focus-within > input, .spec-search-control-wrap:focus-within > textarea, .spec-search-control-wrap:focus-within > select":
    {
      color: "#111 !important",
      WebkitTextFillColor: "#111",
    },
  ".spec-search-control-wrap:focus-within > .spec-search-control-mirror": {
    visibility: "hidden",
  },
  ".spec-search-control-mirror": {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    boxSizing: "border-box",
    font: "11px ui-monospace, monospace",
    padding: "0 4px",
    lineHeight: "14px",
    color: "#111",
    background: "#fff",
    borderRadius: "2px",
  },
  /* Leave the native select arrow visible. */
  ".spec-search-control-wrap > select + .spec-search-control-mirror": {
    right: "1.1rem",
    borderTopRightRadius: "0",
    borderBottomRightRadius: "0",
  },
  ".spec-search-control-hit": {
    boxShadow: "inset 0 0 0 1px #e6c200",
  },
  ".spec-search-control-hit-current": {
    boxShadow: "inset 0 0 0 2px #e65100",
  },
  ".spec-widget--term_pick": {
    overflow: "visible",
    zIndex: "5",
  },
  ".spec-widget-attr": {
    flex: "0 1 auto",
    font: "10px ui-monospace, monospace",
    color: "#5c5c5c",
    lineHeight: "14px",
    maxWidth: "9rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".spec-widget-attr--edit": {
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    maxWidth: "10rem",
    overflow: "visible",
  },
  ".spec-widget-input--attr": {
    minWidth: "3.5rem",
    maxWidth: "8rem",
    flex: "1 1 5rem",
  },
  ".spec-widget-badge": {
    flex: "0 0 auto",
    fontSize: "9px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "#005c53",
    background: "#e8f5f2",
    borderRadius: "2px",
    padding: "0 4px",
    lineHeight: "14px",
  },
  ".spec-widget--source_query .spec-widget-badge": {
    color: "#9a4b00",
    background: "#fff4ea",
  },
  ".spec-widget--dv .spec-widget-badge, .spec-widget--map_lookup .spec-widget-badge, .spec-widget--sheet_lookup .spec-widget-badge, .spec-widget--term_pick .spec-widget-badge": {
    color: "#1e3a5f",
    background: "#e8eef7",
  },
  ".spec-widget--text_gen .spec-widget-badge": {
    color: "#6d4c00",
    background: "#fff6d6",
  },
  ".spec-widget--logic .spec-widget-badge": {
    color: "#4a148c",
    background: "#f3e5f5",
  },
  ".spec-widget-editors": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flex: "1 1 auto",
    minWidth: "0",
  },
  /* #246: ELEMENT + leaf value on one row — the ELEMENT summary yields room. */
  ".spec-widget--has-inline > .spec-widget-editors": {
    flex: "0 1 auto",
    maxWidth: "45%",
  },
  ".spec-widget-inline": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flex: "1 1 50%",
    minWidth: "0",
    paddingLeft: "4px",
    borderLeft: "1px solid #d0d7d6",
  },
  ".spec-widget-inline--source_query .spec-widget-badge": {
    color: "#9a4b00",
    background: "#fff4ea",
  },
  ".spec-widget-editors--stack": {
    flexDirection: "column",
    alignItems: "stretch",
  },
  ".spec-widget--multiline": {
    display: "flex",
    alignItems: "flex-start",
    height: "auto",
    minHeight: `${SPEC_LINE_HEIGHT}px`,
    whiteSpace: "normal",
    paddingTop: "2px",
    paddingBottom: "2px",
  },
  ".spec-widget-code": {
    width: "100%",
    minHeight: "3.2rem",
    maxHeight: "8.5rem",
    boxSizing: "border-box",
    font: "11px ui-monospace, monospace",
    padding: "2px 4px",
    border: "1px solid #d9d9d9",
    borderRadius: "2px",
    resize: "vertical",
    lineHeight: "15px",
  },
  ".spec-widget-punct": {
    flex: "0 0 auto",
    color: "#666",
    fontSize: "11px",
  },
  ".spec-widget-input--name": { maxWidth: "7rem", flex: "0 1 7rem" },
  ".spec-widget-input--short": { maxWidth: "6rem", flex: "0 1 6rem" },
  ".spec-widget-select--op": { minWidth: "2.5rem" },
  ".spec-widget-select--set": { maxWidth: "11rem" },
  ".spec-widget-input--code": { minWidth: "8rem" },
  ".searchable-pick": {
    position: "relative",
    display: "inline-flex",
    flex: "1 1 auto",
    minWidth: "0",
  },
  ".searchable-pick-input": {
    width: "100%",
  },
  ".searchable-pick-list": {
    position: "absolute",
    left: "0",
    right: "0",
    top: "16px",
    zIndex: "20",
    maxHeight: "12rem",
    overflow: "auto",
    background: "#fff",
    border: "1px solid #d9d9d9",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  },
  ".searchable-pick-option": {
    display: "block",
    width: "100%",
    textAlign: "left",
    font: "11px ui-monospace, monospace",
    padding: "2px 6px",
    border: "0",
    background: "#fff",
    cursor: "pointer",
  },
  ".searchable-pick-option:hover, .searchable-pick-option[aria-selected='true']": {
    background: "#e8eef7",
  },
  ".searchable-pick-empty": {
    padding: "4px 6px",
    color: "#666",
    fontSize: "11px",
  },
  ".spec-widget-summary": {
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".spec-widget-input": {
    flex: "1 1 auto",
    minWidth: "6rem",
    height: "16px",
    boxSizing: "border-box",
    font: "11px ui-monospace, monospace",
    padding: "0 4px",
    border: "1px solid #d9d9d9",
    borderRadius: "2px",
    lineHeight: "14px",
  },
  ".spec-widget-select": {
    flex: "0 0 auto",
    height: "16px",
    fontSize: "11px",
    padding: "0 2px",
    border: "1px solid #d9d9d9",
    borderRadius: "2px",
    background: "#fff",
    lineHeight: "14px",
  },
  ".spec-widget-type": {
    flex: "0 0 auto",
    fontSize: "12px",
    lineHeight: "14px",
  },
  ".cm-spec-overview": {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "12px",
    zIndex: "6",
    pointerEvents: "none",
  },
  ".cm-spec-overview-tick": {
    position: "absolute",
    left: "1px",
    right: "1px",
    height: "6px",
    padding: "0",
    border: "0",
    borderRadius: "1px",
    background: "#E65100",
    cursor: "pointer",
    pointerEvents: "auto",
  },
  ".spec-widget .info-tip": {
    flex: "0 0 auto",
  },
  ".spec-widget-info": {
    flex: "0 0 auto",
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    border: "1px solid #005c53",
    background: "#fff",
    color: "#005c53",
    font: "italic bold 9px/12px Georgia, serif",
    cursor: "pointer",
    padding: "0",
    opacity: "0",
  },
  ".spec-widget:hover .spec-widget-info, .spec-widget:focus-within .spec-widget-info": {
    opacity: "1",
  },
});

export interface MappingSpecEditorOptions {
  onFieldEdit?: SpecFieldEditHandler;
  onSelect?: SpecBlockSelectHandler;
  onCheckToggle?: SpecBlockCheckHandler;
  copyAll?: EditorCopyAllHandler;
}

function specOverview(onSelect?: SpecBlockSelectHandler) {
  return ViewPlugin.fromClass(class {
    readonly dom: HTMLElement;

    constructor(readonly view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-spec-overview";
      this.dom.setAttribute("aria-label", "Constraint warning locations");
      view.dom.appendChild(this.dom);
      this.rebuild();
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setJsonDocEffect) || effect.is(setSpecChromeEffect))
        )
      ) {
        this.rebuild();
      }
    }

    destroy(): void {
      this.dom.remove();
    }

    private rebuild(): void {
      const doc = this.view.state.field(jsonDocField);
      const chrome = this.view.state.field(specChromeField);
      const markers = specWarningMarkers(doc, chrome.warnings);
      const scrollHeight = this.view.scrollDOM.scrollHeight;
      const trackHeight = this.dom.clientHeight;
      this.dom.replaceChildren();
      if (!scrollHeight || !trackHeight || !markers.length) return;

      for (const marker of markers) {
        const lineBlock = this.view.lineBlockAt(marker.from);
        const tick = document.createElement("button");
        tick.type = "button";
        tick.className = "cm-spec-overview-tick";
        tick.style.top = `${
          specOverviewTickTopPx(
            lineBlock.top,
            lineBlock.height,
            scrollHeight,
            trackHeight,
          )
        }px`;
        tick.title = marker.message;
        tick.setAttribute("aria-label", marker.message);
        tick.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        tick.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.view.dispatch({
            effects: EditorView.scrollIntoView(marker.from, { y: "center" }),
          });
          onSelect?.(marker.blockId);
        });
        this.dom.appendChild(tick);
      }
    }
  });
}

export function createMappingSpecEditor(
  parent: HTMLElement,
  options: MappingSpecEditorOptions = {},
): EditorView {
  const empty = blocklyJsonDocument(null);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: empty.text,
      extensions: [
        foldGutter(),
        keymap.of(foldKeymap),
        foldService.of(indentFoldRange),
        jsonDocField.init(() => empty),
        specChromeField.init(() => emptyChrome),
        editFacet.of(options.onFieldEdit),
        selectFacet.of(options.onSelect),
        checkFacet.of(options.onCheckToggle),
        specSearchFocusField,
        syncSelectionToSpecSearchFocus,
        jsonDecorations,
        specOverview(options.onSelect),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        specTheme,
        ...editorFindExtensions(options.copyAll),
      ],
    }),
  });
}

/** Replace the Spec view from canonical Blockly workspace JSON. */
export interface MappingSpecViewOptions {
  /** When set, show only rows for this canvas root (tabbed view). */
  rootId?: string | null;
}

export function setMappingSpecFromBlockly(
  view: EditorView,
  blocklyState: unknown,
  chrome: SpecChrome = emptyChrome,
  viewOptions: MappingSpecViewOptions = {},
): void {
  const next = viewOptions.rootId
    ? blocklyJsonDocumentForRoot(blocklyState, viewOptions.rootId)
    : blocklyJsonDocument(blocklyState);
  const current = view.state.doc.toString();
  if (current === next.text) {
    setMappingSpecChrome(view, chrome);
    return;
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next.text },
    effects: [setJsonDocEffect.of(next), setSpecChromeEffect.of(chrome)],
  });
}

export function setMappingSpecChrome(view: EditorView, chrome: SpecChrome): void {
  const prev = view.state.field(specChromeField);
  const prevChecked = [...prev.checkedBlockIds].sort().join(",");
  const nextChecked = [...chrome.checkedBlockIds].sort().join(",");
  if (
    prev.selectedBlockId === chrome.selectedBlockId &&
    prevChecked === nextChecked &&
    JSON.stringify(prev.warnings) === JSON.stringify(chrome.warnings)
  ) {
    return;
  }
  view.dispatch({ effects: setSpecChromeEffect.of(chrome) });
}

export function scrollMappingSpecToBlock(view: EditorView, blockId: string): void {
  const doc = view.state.field(jsonDocField);
  const widget = doc.widgets.find((item) =>
    item.line.blockId === blockId || (item.line.aliasIds ?? []).includes(blockId)
  );
  if (!widget) return;
  view.dispatch({
    effects: EditorView.scrollIntoView(widget.from, { y: "center" }),
  });
}

/** Compact Spec projection currently shown in the Mapping Spec tab. */
export function mappingSpecDocumentText(view: EditorView): string {
  return view.state.doc.toString();
}

export type { SpecFieldEditHandler, SpecBlockSelectHandler, SpecBlockCheckHandler, SpecLine };
