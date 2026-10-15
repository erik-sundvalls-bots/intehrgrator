/**
 * jspreadsheet-ce host for project-owned Sheet JSON.
 * The widget is a view; persistence and Test Run read the JSON store.
 */
import jspreadsheet from "jspreadsheet-ce";
import type { Workspace } from "blockly/core";
import {
  addCatchAllRow,
  addDecisionColumn,
  cloneSheets,
  decisionColumnMeta,
  deleteColumn,
  emptyDecisionTable,
  emptySheet,
  findSheet,
  isDecisionTable,
  moveColumns,
  moveRows,
  lintDecisionTable,
  normalizeSheet,
  parseSpreadsheetText,
  setDecisionOutputKind,
  setDecisionValueType,
  setXy,
  sheetsEqual,
  sheetToCsv,
  trimDecisionTableSpareColumns,
  type DecisionColumnMeta,
  type DecisionHitPolicy,
  type DecisionOutputKind,
  type DecisionValueType,
  type SheetDocument,
} from "../core/sheets/mod.ts";
import { fireSheetChange } from "../workbench/sheet_undo.ts";
import { attachInfoTip } from "./info_tip.ts";
import { HIT_POLICY_DOCS_HREF, jspreadsheetDictionary, sheetsChrome, sheetsFormat } from "./sheets_i18n.ts";
import {
  clearGridNames,
  retargetGridNames,
  syncDecisionTableBlocksFromSheets,
} from "../blockly/decision_table_sync.ts";
import { DECISION_TYPE_SWITCH_MESSAGE } from "../blockly/blocks/decision_table_blocks.ts";
import { refreshWorkspaceConstraints } from "../blockly/block_constraints.ts";

type WorksheetInstance = {
  getData: () => unknown[][];
  setData: (data?: unknown[][]) => void;
  getHeaders: (asArray?: boolean) => string | string[];
  setHeader: (column: number, value: string) => void;
  download: (includeHeaders?: boolean) => void;
  ignoreHistory: boolean;
  headers?: HTMLTableCellElement[];
  options?: { rows?: Array<{ title?: string }> | Record<number, { title?: string }> };
  parent: { fullscreen: (activate?: boolean) => void };
};

const COG_SVG =
  '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.13.53-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.49.4 1.03.72 1.62.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.13-.53 1.62-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

export interface SheetsPanelHost {
  getSheets: () => SheetDocument[];
  replaceSheets: (sheets: SheetDocument[], options?: { silent?: boolean }) => void;
  markDirty: () => void;
}

export function mountSheetsPanel(
  root: HTMLElement,
  host: SheetsPanelHost,
  options: {
    getWorkspace: () => Workspace;
    getLocale: () => string;
    /** Top-right slot in the mapping editor tab row. General sheet buttons live here. */
    actionsHost?: HTMLElement | null;
  },
): {
  refresh: () => void;
  showSheet: (
    name: string,
    kind?: "sheet" | "decision-table",
    opts?: { highlight?: boolean; create?: boolean },
  ) => void;
  promptNewGrid: (kind: "sheet" | "decision-table") => string | null;
  setLocale: (locale: string) => void;
  setFullscreen: (on: boolean) => void;
  destroy: () => void;
} {
  let locale = options.getLocale();
  applyDictionary(locale);

  root.classList.add("sheets-panel");
  root.innerHTML = "";
  const toolbar = document.createElement("div");
  toolbar.className = "sheets-toolbar";
  const tabsEl = document.createElement("div");
  tabsEl.className = "sheets-tabs";
  tabsEl.setAttribute("role", "tablist");
  tabsEl.setAttribute("aria-label", "Sheets");
  const select = document.createElement("select");
  select.className = "sheets-select";
  select.setAttribute("aria-label", "Sheet");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "pane-btn";
  const addDtBtn = document.createElement("button");
  addDtBtn.type = "button";
  addDtBtn.className = "pane-btn";
  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "pane-btn";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "pane-btn";
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "pane-btn";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "pane-btn";
  const fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = "pane-btn";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.tsv,.txt";
  fileInput.hidden = true;
  const actions = document.createElement("div");
  actions.className = "sheets-actions-buttons";
  actions.append(addBtn, addDtBtn, renameBtn, deleteBtn, importBtn, exportBtn, fullBtn);
  toolbar.append(tabsEl, select, fileInput);

  const metaBar = document.createElement("div");
  metaBar.className = "sheets-meta";
  metaBar.hidden = true;
  const kindLabel = document.createElement("span");
  kindLabel.className = "sheets-kind";
  const hitPolicyLabel = document.createElement("label");
  hitPolicyLabel.className = "sheets-hit-policy";
  const hitPolicySelect = document.createElement("select");
  hitPolicySelect.setAttribute("aria-label", "Hit policy");
  for (const p of ["FIRST", "UNIQUE", "COLLECT"] as DecisionHitPolicy[]) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    hitPolicySelect.append(opt);
  }
  hitPolicyLabel.append(document.createTextNode(""), hitPolicySelect);
  const hitPolicyInfo = document.createElement("span");
  hitPolicyInfo.className = "info-tip";
  const hitPolicyInfoBtn = document.createElement("button");
  hitPolicyInfoBtn.type = "button";
  hitPolicyInfoBtn.className = "info-tip-btn";
  hitPolicyInfoBtn.textContent = "i";
  const hitPolicyBalloon = document.createElement("div");
  hitPolicyBalloon.className = "info-tip-balloon";
  hitPolicyBalloon.hidden = true;
  hitPolicyBalloon.setAttribute("role", "tooltip");
  hitPolicyInfo.append(hitPolicyInfoBtn, hitPolicyBalloon);
  attachInfoTip(hitPolicyInfo);
  const lintEl = document.createElement("p");
  lintEl.className = "sheets-snippet-lint";
  lintEl.hidden = true;
  const addCondBtn = document.createElement("button");
  addCondBtn.type = "button";
  addCondBtn.className = "pane-btn";
  const addOutBtn = document.createElement("button");
  addOutBtn.type = "button";
  addOutBtn.className = "pane-btn";
  const addDefaultBtn = document.createElement("button");
  addDefaultBtn.type = "button";
  addDefaultBtn.className = "pane-btn";
  const collectDedupeLabel = document.createElement("label");
  collectDedupeLabel.className = "sheets-collect-dedupe";
  const collectDedupeBox = document.createElement("input");
  collectDedupeBox.type = "checkbox";
  collectDedupeBox.setAttribute("aria-label", "COLLECT dedupe");
  collectDedupeLabel.append(collectDedupeBox);
  metaBar.append(
    kindLabel,
    hitPolicyLabel,
    hitPolicyInfo,
    addCondBtn,
    addOutBtn,
    addDefaultBtn,
    collectDedupeLabel,
    lintEl,
  );

  const toastEl = document.createElement("div");
  toastEl.className = "sheets-toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  let toastTimer = 0;
  let columnMenu: HTMLElement | null = null;

  const emptyEl = document.createElement("p");
  emptyEl.className = "sheets-empty";
  const gridHost = document.createElement("div");
  gridHost.className = "sheets-grid-host";
  const gridEl = document.createElement("div");
  gridEl.className = "sheets-grid";
  gridHost.append(gridEl);
  root.append(toolbar, metaBar, emptyEl, gridHost, toastEl);

  let activeName = "";
  let worksheet: WorksheetInstance | null = null;
  let applying = false;
  let fullscreen = false;
  let destroyed = false;

  const paintChrome = (): void => {
    const t = sheetsChrome(locale);
    addBtn.textContent = t.add;
    addDtBtn.textContent = t.addDecision;
    renameBtn.textContent = t.rename;
    deleteBtn.textContent = t.remove;
    importBtn.textContent = t.importCsv;
    exportBtn.textContent = t.exportCsv;
    fullBtn.textContent = fullscreen ? t.exitFullscreen : t.fullscreen;
    emptyEl.textContent = t.empty;
    hitPolicySelect.setAttribute("aria-label", t.hitPolicy);
    if (hitPolicyLabel.firstChild) hitPolicyLabel.firstChild.textContent = `${t.hitPolicy} `;
    hitPolicyInfoBtn.setAttribute("aria-label", t.hitPolicyAbout);
    paintHitPolicyInfo();
    addCondBtn.textContent = t.addInput;
    addOutBtn.textContent = t.addOutput;
    addDefaultBtn.textContent = t.addDefaultRow;
    collectDedupeBox.setAttribute("aria-label", t.collectDedupe);
    const dedupeCaption = collectDedupeLabel.querySelector("span") ?? document.createElement("span");
    dedupeCaption.textContent = ` ${t.collectDedupe}`;
    if (!dedupeCaption.parentElement) collectDedupeLabel.append(dedupeCaption);
  };

  const paintHitPolicyInfo = (): void => {
    const t = sheetsChrome(locale);
    hitPolicyBalloon.replaceChildren();
    for (const [key, text] of [
      ["FIRST", t.hitPolicyFirst],
      ["UNIQUE", t.hitPolicyUnique],
      ["COLLECT", t.hitPolicyCollect],
    ] as const) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = key;
      p.append(strong, document.createTextNode(` — ${text}`));
      hitPolicyBalloon.append(p);
    }
    const link = document.createElement("a");
    link.href = HIT_POLICY_DOCS_HREF;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t.hitPolicyDocsLabel;
    hitPolicyBalloon.append(link);
  };

  const placeActions = (): void => {
    const external = options.actionsHost;
    if (!fullscreen && external) external.replaceChildren(actions);
    else toolbar.append(actions);
  };

  const showToast = (message: string): void => {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) globalThis.clearTimeout(toastTimer);
    toastTimer = globalThis.setTimeout(() => {
      toastEl.hidden = true;
      toastTimer = 0;
    }, 4000);
  };

  const closeColumnMenu = (): void => {
    columnMenu?.remove();
    columnMenu = null;
  };

  paintChrome();
  placeActions();

  const destroyGrid = (): void => {
    worksheet = null;
    try {
      jspreadsheet.destroy(gridEl as unknown as Parameters<typeof jspreadsheet.destroy>[0], true);
    } catch {
      // destroyed or never mounted
    }
    gridEl.innerHTML = "";
  };

  const readWorksheet = (name: string): SheetDocument | null => {
    if (!worksheet) return null;
    const headersRaw = worksheet.getHeaders(true);
    const headers = Array.isArray(headersRaw)
      ? headersRaw.map((h) => String(h ?? ""))
      : String(headersRaw).split(",");
    const values = (worksheet.getData() ?? []).map((row) =>
      (Array.isArray(row) ? row : []).map((c) => (c == null ? "" : c as string | number | boolean))
    );
    const trimmed = trimTrailingEmptyRows(values);
    const existing = findSheet(host.getSheets(), name);
    const doc = normalizeSheet({
      name,
      headers,
      values: trimmed,
      columnTypes: existing?.columnTypes,
      rowNames: readRowNames(worksheet, trimmed.length) ?? existing?.rowNames,
      kind: existing?.kind,
      hitPolicy: existing?.hitPolicy,
      collectJoin: existing?.collectJoin,
      collectDedupe: existing?.collectDedupe,
      decisionColumns: existing?.decisionColumns,
      rowCatchAll: existing?.rowCatchAll,
    });
    return isDecisionTable(doc) ? trimDecisionTableSpareColumns(doc) : doc;
  };

  const paintMeta = (sheet: SheetDocument | null): void => {
    const t = sheetsChrome(locale);
    if (!sheet || !isDecisionTable(sheet)) {
      metaBar.hidden = true;
      lintEl.hidden = true;
      return;
    }
    metaBar.hidden = false;
    kindLabel.textContent = t.kindDecision;
    hitPolicySelect.value = sheet.hitPolicy ?? "FIRST";
    collectDedupeLabel.hidden = (sheet.hitPolicy ?? "FIRST") !== "COLLECT";
    collectDedupeBox.checked = sheet.collectDedupe === true;
    const diags = lintDecisionTable(sheet);
    if (diags.length) {
      lintEl.hidden = false;
      lintEl.textContent = `${t.snippetLint}: ${diags.map((d) => d.message).join("; ")}`;
    } else {
      lintEl.hidden = true;
      lintEl.textContent = "";
    }
  };

  const notifyBlockly = (sheets: SheetDocument[]): void => {
    const ws = options.getWorkspace();
    syncDecisionTableBlocksFromSheets(ws, sheets);
    refreshWorkspaceConstraints(ws);
  };

  const commitSheetDoc = (nextDoc: SheetDocument): void => {
    const before = host.getSheets();
    const after = before.map((s) => s.name === nextDoc.name ? nextDoc : s);
    if (findSheet(after, nextDoc.name) == null) after.push(nextDoc);
    if (sheetsEqual(before, after)) return;
    host.replaceSheets(after);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
      notifyBlockly(sheets);
    });
    notifyBlockly(after);
    refresh();
  };

  const commitFromWidget = (): void => {
    if (applying || !worksheet || !activeName) return;
    const before = host.getSheets();
    const nextDoc = readWorksheet(activeName);
    if (!nextDoc) return;
    const after = before.map((s) => s.name === activeName ? nextDoc : s);
    if (findSheet(after, activeName) == null) after.push(nextDoc);
    if (sheetsEqual(before, after)) return;
    host.replaceSheets(after);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
      notifyBlockly(sheets);
    });
    notifyBlockly(after);
  };

  const activeDecisionSheet = (): SheetDocument | null => {
    const sheet = findSheet(host.getSheets(), activeName);
    return sheet && isDecisionTable(sheet) ? sheet : null;
  };

  const applyOutputColumnKind = (index: number, kind: string): void => {
    const sheet = activeDecisionSheet();
    if (!sheet) return;
    const meta = decisionColumnMeta(sheet)[index];
    if (!meta || meta.role !== "output") return;
    const nextKind: DecisionOutputKind = kind === "snippet" ? "snippet" : "value";
    const nextType: DecisionValueType = kind === "number" || kind === "boolean" ? kind : "string";
    const header = sheet.headers[index] ?? "";
    const prevType = header ? outputTypeOf(sheet, index) : "string";
    let next = setDecisionOutputKind(sheet, index, nextKind);
    if (nextKind === "value") next = setDecisionValueType(next, index, nextType);
    const newType = outputTypeOf(next, index);
    if (prevType !== newType && !confirmValueTypeSwitch()) return;
    closeColumnMenu();
    commitSheetDoc(next);
  };

  const openColumnMenu = (index: number, anchor: HTMLElement): void => {
    const sheet = activeDecisionSheet();
    if (!sheet) return;
    closeColumnMenu();
    const t = sheetsChrome(locale);
    const name = sheet.headers[index] ?? "";
    const meta = decisionColumnMeta(sheet)[index];
    const menu = document.createElement("div");
    menu.id = "dt-column-menu";
    menu.className = "dt-column-menu";
    menu.setAttribute("role", "menu");
    if (meta?.role === "output") {
      const label = document.createElement("label");
      label.className = "dt-column-kind";
      const lead = document.createElement("span");
      lead.className = "dt-column-kind-label";
      lead.textContent = t.outputType;
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `${name} ${t.outputType}`);
      for (const [value, text] of [
        ["string", t.kindString],
        ["number", t.kindNumber],
        ["boolean", t.kindBoolean],
        ["snippet", t.kindStringPattern],
      ] as const) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = `${kindGlyph(value)} ${text}`;
        sel.append(opt);
      }
      sel.value = columnKindValue(meta);
      sel.addEventListener("change", () => applyOutputColumnKind(index, sel.value));
      label.append(lead, sel);
      menu.append(label);
    }
    const moveLeftItem = document.createElement("button");
    moveLeftItem.type = "button";
    moveLeftItem.className = "dt-column-menu-item";
    moveLeftItem.textContent = t.moveLeft;
    moveLeftItem.disabled = index <= 0;
    moveLeftItem.addEventListener("click", () => {
      const current = activeDecisionSheet();
      if (!current || index <= 0) return;
      closeColumnMenu();
      commitSheetDoc(moveColumns(current, index, index - 1));
    });
    const moveRightItem = document.createElement("button");
    moveRightItem.type = "button";
    moveRightItem.className = "dt-column-menu-item";
    moveRightItem.textContent = t.moveRight;
    moveRightItem.disabled = index >= sheet.headers.length - 1;
    moveRightItem.addEventListener("click", () => {
      const current = activeDecisionSheet();
      if (!current || index >= current.headers.length - 1) return;
      closeColumnMenu();
      commitSheetDoc(moveColumns(current, index, index + 1));
    });
    const deleteItem = document.createElement("button");
    deleteItem.type = "button";
    deleteItem.className = "dt-column-menu-item dt-column-menu-delete";
    deleteItem.textContent = sheetsFormat(t.deleteColumn, name);
    deleteItem.disabled = sheet.headers.length <= 1;
    deleteItem.addEventListener("click", () => {
      const current = activeDecisionSheet();
      if (!current || current.headers.length <= 1) return;
      const removed = current.headers[index] ?? name;
      closeColumnMenu();
      commitSheetDoc(deleteColumn(current, index, 1));
      showToast(sheetsFormat(t.deletedColumn, removed));
    });
    menu.append(moveLeftItem, moveRightItem, deleteItem);
    document.body.append(menu);
    columnMenu = menu;
    const box = anchor.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const left = Math.min(box.left, globalThis.innerWidth - menuBox.width - 8);
    const top = Math.min(box.bottom + 4, globalThis.innerHeight - menuBox.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };

  const paintDecisionHeaderGlyphs = (sheet: SheetDocument): void => {
    const cells = worksheet?.headers;
    if (!cells) return;
    const meta = decisionColumnMeta(sheet);
    cells.forEach((cell, index) => {
      if (!(sheet.headers[index] ?? "").trim()) return;
      paintHeaderGlyph(cell, meta[index]);
    });
  };

  const decorateDecisionHeaders = (sheet: SheetDocument): void => {
    const cells = worksheet?.headers;
    if (!cells) return;
    const meta = decisionColumnMeta(sheet);
    cells.forEach((cell, index) => {
      const name = sheet.headers[index] ?? "";
      if (!name) return;
      cell.classList.add("dt-col-header");
      paintHeaderGlyph(cell, meta[index]);
      const cog = document.createElement("button");
      cog.type = "button";
      cog.className = "dt-header-cog";
      cog.setAttribute("aria-label", sheetsFormat(sheetsChrome(locale).columnMenu, name));
      cog.innerHTML = COG_SVG;
      cell.replaceChildren(document.createTextNode(name), cog);
      cell.title = name;
      const open = (ev: Event): void => {
        ev.preventDefault();
        ev.stopPropagation();
        openColumnMenu(index, cog);
      };
      cog.addEventListener("click", open);
      cell.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openColumnMenu(index, cell);
      });
    });
  };

  const bindSheet = (sheet: SheetDocument): void => {
    destroyGrid();
    applying = true;
    try {
      const columns = sheet.headers.map((title, i) => ({
        type: (sheet.columnTypes?.[i] ?? "text") as "text" | "numeric" | "dropdown",
        title: title || undefined,
        width: 120,
      }));
      const rowTitles = sheet.rowNames?.length
        ? sheet.rowNames.map((title) => ({ title }))
        : undefined;
      const viewport = gridViewport();
      const dt = isDecisionTable(sheet);
      const created = jspreadsheet(gridEl, {
        worksheets: [{
          data: sheet.values.length ? sheet.values : [[""]],
          columns,
          ...(rowTitles ? { rows: rowTitles } : {}),
          minDimensions: [
            dt ? Math.max(sheet.headers.length, 1) : Math.max(sheet.headers.length, viewport.cols),
            dt ? Math.max(sheet.values.length, 3) : Math.max(sheet.values.length, viewport.rows),
          ],
          minSpareRows: 0,
          minSpareCols: 0,
          allowInsertColumn: !dt,
          allowDeleteColumn: !dt,
          tableOverflow: true,
          tableWidth: viewport.widthPx,
          tableHeight: viewport.heightPx,
          csvFileName: sheet.name,
          columnSorting: false,
          columnDrag: true,
          rowDrag: true,
          parseFormulas: false,
        }],
        onmovecolumn: (_instance, from, to) => {
          if (applying) return;
          const current = findSheet(host.getSheets(), activeName);
          if (!current) return;
          commitSheetDoc(moveColumns(current, Number(from), Number(to)));
        },
        onmoverow: (_instance, from, to) => {
          if (applying) return;
          const current = findSheet(host.getSheets(), activeName);
          if (!current) return;
          commitSheetDoc(moveRows(current, Number(from), Number(to)));
        },
        onafterchanges: () => {
          commitFromWidget();
        },
        onchange: () => {
          commitFromWidget();
        },
        oninsertrow: () => commitFromWidget(),
        oninsertcolumn: () => commitFromWidget(),
        ondeleterow: () => commitFromWidget(),
        ondeletecolumn: () => commitFromWidget(),
        onchangeheader: () => commitFromWidget(),
        contextMenu: (_instance, x, y, _event, items, role) => {
          const current = activeDecisionSheet();
          if (!current || role !== "cell") return items;
          const col = Number(x);
          const row = Number(y);
          if (!Number.isFinite(col) || !Number.isFinite(row)) return items;
          const t = sheetsChrome(locale);
          items.push({
            title: t.dontCare,
            onclick: () => {
              const live = activeDecisionSheet();
              if (!live) return;
              commitSheetDoc(setXy(live, col, row, "—"));
            },
          });
          return items;
        },
      }) as unknown as WorksheetInstance[];
      worksheet = created[0] ?? null;
      if (worksheet) worksheet.ignoreHistory = true;
      if (isDecisionTable(sheet)) decorateDecisionHeaders(sheet);
      sizeGrid();
      paintMeta(sheet);
    } finally {
      applying = false;
    }
  };

  const widgetMatches = (sheet: SheetDocument): boolean => {
    if (!worksheet || sheet.name !== activeName) return false;
    const current = readWorksheet(sheet.name);
    return current != null && sheetsEqual([current], [sheet]);
  };

  const fillSelect = (sheets: SheetDocument[]): void => {
    const current = select.value;
    select.innerHTML = "";
    for (const sheet of sheets) {
      const opt = document.createElement("option");
      opt.value = sheet.name;
      const t = sheetsChrome(locale);
      opt.textContent = isDecisionTable(sheet)
        ? `${sheet.name} (${t.kindDecision})`
        : sheet.name;
      select.append(opt);
    }
    if (sheets.some((s) => s.name === current)) select.value = current;
    else if (sheets[0]) select.value = sheets[0].name;
    const multi = sheets.length > 1;
    tabsEl.hidden = !multi;
    select.hidden = multi;
    tabsEl.replaceChildren();
    if (multi) {
      const selected = select.value || activeName;
      for (const sheet of sheets) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "sheets-tab" + (sheet.name === selected ? " active" : "");
        tab.textContent = isDecisionTable(sheet)
          ? `${sheet.name} · DT`
          : sheet.name;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", sheet.name === selected ? "true" : "false");
        tab.addEventListener("click", () => {
          select.value = sheet.name;
          activeName = sheet.name;
          const doc = findSheet(host.getSheets(), sheet.name);
          if (doc) bindSheet(doc);
          fillSelect(host.getSheets());
        });
        tabsEl.append(tab);
      }
    }
  };

  const refresh = (): void => {
    if (destroyed) return;
    const sheets = host.getSheets();
    const has = sheets.length > 0;
    emptyEl.hidden = has;
    gridHost.hidden = !has;
    renameBtn.disabled = !has;
    deleteBtn.disabled = !has;
    exportBtn.disabled = !has;
    fillSelect(sheets);
    if (!has) {
      destroyGrid();
      activeName = "";
      paintMeta(null);
      return;
    }
    const name = select.value || sheets[0]!.name;
    activeName = name;
    const sheet = findSheet(sheets, name) ?? sheets[0]!;
    if (widgetMatches(sheet)) {
      paintMeta(sheet);
      if (isDecisionTable(sheet)) paintDecisionHeaderGlyphs(sheet);
      return;
    }
    bindSheet(sheet);
  };

  const flashHighlight = (): void => {
    root.classList.remove("sheets-flash");
    void root.offsetWidth;
    root.classList.add("sheets-flash");
    globalThis.setTimeout(() => root.classList.remove("sheets-flash"), 4000);
  };

  const showSheet = (
    name: string,
    kind: "sheet" | "decision-table" = "sheet",
    opts: { highlight?: boolean; create?: boolean } = {},
  ): void => {
    let sheets = host.getSheets();
    if (!findSheet(sheets, name)) {
      if (opts.create === false) return;
      const before = cloneSheets(sheets);
      const created = kind === "decision-table" ? emptyDecisionTable(name) : emptySheet(name);
      const after = [...before, created];
      host.replaceSheets(after);
      fireSheetChange(options.getWorkspace(), before, after, (next) => {
        host.replaceSheets(next, { silent: true });
        refresh();
        notifyBlockly(next);
      });
      sheets = after;
      notifyBlockly(after);
    }
    select.value = name;
    activeName = name;
    fillSelect(host.getSheets());
    const sheet = findSheet(sheets, name);
    if (!sheet) return;
    if (widgetMatches(sheet)) {
      paintMeta(sheet);
      scheduleSizeGrid();
    } else {
      bindSheet(sheet);
    }
    if (opts.highlight) flashHighlight();
  };

  const promptNewGrid = (kind: "sheet" | "decision-table"): string | null => {
    const t = sheetsChrome(locale);
    const name = globalThis.prompt(
      kind === "decision-table" ? t.decisionNamePrompt : t.namePrompt,
      uniqueName(host.getSheets(), kind === "decision-table" ? "Decision" : "Sheet"),
    );
    if (!name?.trim()) return null;
    const trimmed = name.trim();
    showSheet(trimmed, kind);
    return trimmed;
  };
  addBtn.addEventListener("click", () => {
    promptNewGrid("sheet");
  });
  addDtBtn.addEventListener("click", () => {
    promptNewGrid("decision-table");
  });
  addCondBtn.addEventListener("click", () => {
    const sheet = findSheet(host.getSheets(), activeName);
    if (!sheet || !isDecisionTable(sheet)) return;
    commitSheetDoc(addDecisionColumn(sheet, "condition"));
  });
  addOutBtn.addEventListener("click", () => {
    const sheet = findSheet(host.getSheets(), activeName);
    if (!sheet || !isDecisionTable(sheet)) return;
    commitSheetDoc(addDecisionColumn(sheet, "output"));
  });
  addDefaultBtn.addEventListener("click", () => {
    const sheet = findSheet(host.getSheets(), activeName);
    if (!sheet || !isDecisionTable(sheet)) return;
    commitSheetDoc(addCatchAllRow(sheet));
  });
  collectDedupeBox.addEventListener("change", () => {
    const sheet = findSheet(host.getSheets(), activeName);
    if (!sheet || !isDecisionTable(sheet)) return;
    commitSheetDoc({ ...sheet, collectDedupe: collectDedupeBox.checked });
  });
  hitPolicySelect.addEventListener("change", () => {
    if (!activeName) return;
    const before = host.getSheets();
    const after = before.map((s) =>
      s.name === activeName
        ? { ...s, hitPolicy: hitPolicySelect.value as DecisionHitPolicy }
        : s
    );
    host.replaceSheets(after);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
      notifyBlockly(sheets);
    });
    notifyBlockly(after);
    paintMeta(findSheet(after, activeName) ?? null);
  });
  renameBtn.addEventListener("click", () => {
    if (!activeName) return;
    const t = sheetsChrome(locale);
    const nextName = globalThis.prompt(t.namePrompt, activeName)?.trim();
    if (!nextName || nextName === activeName) return;
    const before = host.getSheets();
    const after = before.map((s) => s.name === activeName ? { ...s, name: nextName } : s);
    host.replaceSheets(after);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
      notifyBlockly(sheets);
    });
    retargetGridNames(options.getWorkspace(), activeName, nextName);
    notifyBlockly(after);
    activeName = nextName;
    refresh();
  });
  deleteBtn.addEventListener("click", () => {
    if (!activeName) return;
    const before = host.getSheets();
    const after = before.filter((s) => s.name !== activeName);
    host.replaceSheets(after);
    clearGridNames(options.getWorkspace(), activeName);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
    });
    refresh();
  });
  select.addEventListener("change", () => {
    const sheet = findSheet(host.getSheets(), select.value);
    if (sheet) {
      activeName = sheet.name;
      bindSheet(sheet);
    }
  });
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const text = await file.text();
    const grid = parseSpreadsheetText(text);
    if (!grid.length) return;
    const headers = grid[0]!.map((h) => h);
    const values = grid.slice(1);
    const name = file.name.replace(/\.(csv|tsv|txt)$/i, "") || "Sheet1";
    const doc = normalizeSheet({ name: uniqueName(host.getSheets(), name), headers, values });
    const before = host.getSheets();
    const after = [...before, doc];
    host.replaceSheets(after);
    fireSheetChange(options.getWorkspace(), before, after, (sheets) => {
      host.replaceSheets(sheets, { silent: true });
      refresh();
    });
    showSheet(doc.name);
  });
  exportBtn.addEventListener("click", () => {
    const sheet = findSheet(host.getSheets(), activeName);
    if (!sheet) return;
    if (worksheet) {
      try {
        worksheet.download(true);
        return;
      } catch {
        // fall through to CSV download
      }
    }
    const csv = sheetToCsv(sheet);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const gridViewport = (): { widthPx: number; heightPx: number; cols: number; rows: number } => {
    const widthPx = Math.max(root.clientWidth - 24, gridHost.clientWidth || 200, 200);
    const heightPx = Math.max(
      root.clientHeight - toolbar.offsetHeight - 28,
      gridHost.clientHeight || 120,
      120,
    );
    return {
      widthPx,
      heightPx,
      cols: Math.max(3, Math.floor(widthPx / 120)),
      rows: Math.max(4, Math.floor(heightPx / 26)),
    };
  };

  const sizeGrid = (): void => {
    if (destroyed || fullscreen) return;
    const hostW = gridHost.clientWidth || root.clientWidth;
    const hostH = gridHost.clientHeight || Math.max(root.clientHeight - toolbar.offsetHeight, 0);
    if (hostW < 40 || hostH < 40) return;
    const content = (worksheet && "content" in worksheet
      ? (worksheet as WorksheetInstance & { content?: HTMLElement }).content
      : null) ?? gridEl.querySelector(".jss_content") as HTMLElement | null;
    if (!content) return;
    // Fit exactly to the host so only `.jss_content` scrolls — never the host.
    content.style.width = `${hostW}px`;
    content.style.height = `${hostH}px`;
    content.style.maxHeight = `${hostH}px`;
  };
  let sizeRaf = 0;
  const scheduleSizeGrid = (): void => {
    if (sizeRaf) return;
    sizeRaf = requestAnimationFrame(() => {
      sizeRaf = 0;
      sizeGrid();
    });
  };
  const hostResize = new ResizeObserver(() => scheduleSizeGrid());
  hostResize.observe(root);
  hostResize.observe(gridHost);

  const setFullscreen = (on: boolean): void => {
    fullscreen = on;
    root.classList.toggle("sheets-panel--fullscreen", on);
    document.body.classList.toggle("sheets-fullscreen", on);
    paintChrome();
    placeActions();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const sheet = findSheet(host.getSheets(), activeName);
        if (sheet) bindSheet(sheet);
        else sizeGrid();
      });
    });
  };
  fullBtn.addEventListener("click", () => setFullscreen(!fullscreen));

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && columnMenu) {
      ev.preventDefault();
      closeColumnMenu();
      return;
    }
    if (ev.key === "Escape" && fullscreen) {
      ev.preventDefault();
      setFullscreen(false);
      return;
    }
    const key = ev.key.toLowerCase();
    const undo = (ev.ctrlKey || ev.metaKey) && key === "z" && !ev.shiftKey;
    const redo = (ev.ctrlKey || ev.metaKey) && (key === "y" || (key === "z" && ev.shiftKey));
    if (!undo && !redo) return;
    const target = ev.target as Node | null;
    const inSheet = !!(target && (root.contains(target) ||
      (target instanceof Element && target.closest(".jss, .jss_worksheet, .jss_container"))));
    if (!inSheet && !fullscreen) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    commitFromWidget();
    options.getWorkspace().undo(redo);
  };
  document.addEventListener("keydown", onKey, true);
  const onPointerDown = (ev: Event): void => {
    const target = ev.target;
    if (!(target instanceof Node)) return;
    if (columnMenu?.contains(target)) return;
    if (target instanceof Element && target.closest(".dt-header-cog")) return;
    closeColumnMenu();
  };
  document.addEventListener("pointerdown", onPointerDown, true);

  refresh();

  return {
    refresh,
    showSheet,
    promptNewGrid,
    setLocale: (next) => {
      locale = next;
      applyDictionary(locale);
      paintChrome();
      placeActions();
    },
    setFullscreen,
    destroy: () => {
      destroyed = true;
      if (sizeRaf) {
        cancelAnimationFrame(sizeRaf);
        sizeRaf = 0;
      }
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      closeColumnMenu();
      if (toastTimer) globalThis.clearTimeout(toastTimer);
      hostResize.disconnect();
      setFullscreen(false);
      destroyGrid();
      root.innerHTML = "";
    },
  };
}

function applyDictionary(locale: string): void {
  const dict = jspreadsheetDictionary(locale);
  if (Object.keys(dict).length) jspreadsheet.setDictionary(dict);
}

function outputTypeOf(sheet: SheetDocument, index: number): DecisionValueType {
  const col = decisionColumnMeta(sheet)[index];
  if (!col || col.role !== "output") return "string";
  if (col.outputKind === "snippet") return "string";
  return col.valueType === "number" || col.valueType === "boolean" ? col.valueType : "string";
}

function columnKindValue(meta: DecisionColumnMeta): string {
  if (meta.outputKind === "snippet") return "snippet";
  if (meta.valueType === "number" || meta.valueType === "boolean") return meta.valueType;
  return "string";
}

function paintHeaderGlyph(cell: HTMLTableCellElement, meta: DecisionColumnMeta | undefined): void {
  const glyph = outputGlyph(meta);
  if (glyph) cell.dataset.dtGlyph = glyph;
  else delete cell.dataset.dtGlyph;
  cell.dataset.dtRole = meta?.role ?? "condition";
}

function kindGlyph(kind: "string" | "number" | "boolean" | "snippet"): string {
  if (kind === "number") return "🔢";
  if (kind === "boolean") return "✓";
  if (kind === "snippet") return "{}";
  return "🔤";
}

function outputGlyph(meta: DecisionColumnMeta | undefined): string {
  if (!meta || meta.role !== "output") return "";
  if (meta.outputKind === "snippet") return "{}";
  if (meta.valueType === "number") return "🔢";
  if (meta.valueType === "boolean") return "✓";
  return "🔤";
}

function confirmValueTypeSwitch(): boolean {
  if (typeof globalThis.confirm !== "function") return true;
  return globalThis.confirm(DECISION_TYPE_SWITCH_MESSAGE);
}

function uniqueName(sheets: SheetDocument[], base: string): string {
  const names = new Set(sheets.map((s) => s.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

function readRowNames(
  worksheet: WorksheetInstance,
  rowCount: number,
): string[] | undefined {
  const rows = worksheet.options?.rows;
  if (!rows) return undefined;
  const titles: string[] = [];
  let named = false;
  for (let i = 0; i < rowCount; i++) {
    const title = Array.isArray(rows) ? rows[i]?.title : rows[i]?.title;
    if (title) named = true;
    titles.push(title ?? "");
  }
  return named ? titles : undefined;
}

function trimTrailingEmptyRows(
  values: Array<Array<string | number | boolean>>,
): Array<Array<string | number | boolean>> {
  let end = values.length;
  while (
    end > 1 &&
    (values[end - 1] ?? []).every((cell) => cell === "" || cell == null)
  ) {
    end--;
  }
  return values.slice(0, Math.max(end, 1));
}
