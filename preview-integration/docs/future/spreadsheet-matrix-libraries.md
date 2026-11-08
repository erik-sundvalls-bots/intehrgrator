# Spreadsheet / matrix libraries for Chunk 8

Research date: 2026-09-04. Claims below follow official docs, GitHub READMEs, and npm `package.json` files — not secondary round-ups.

**Need:** embed a real 2D spreadsheet (Excel/Sheets paste, named headers, cell/row/column get/set) in the vanilla TypeScript web app, then wrap that API as Blockly accessor and mutator blocks. Prefer MIT/Apache, few runtime dependencies, no React. FHIR ConceptMap import is **out of this chunk**.

**Constraints:** Deno-bundled static app (GitHub Pages). Current UI is vanilla TS + Blockly, not React. `vendor/` is reserved for ehrtslib.

---

## Shortlist

| Library | License | Runtime deps | UI stack | Excel/Sheets paste | Get/set API | Maintenance | Fit |
|---------|---------|--------------|----------|--------------------|-------------|-------------|-----|
| **jspreadsheet-ce** | MIT | 2 (`jsuites`, `@jspreadsheet/formula`) | Vanilla JS | Yes (`onbeforepaste` / `onpaste`) | Cell, A1, coords, row, column, header, insert/delete | Active (npm 5.0.4) | **Best match** |
| **x-data-spreadsheet** | MIT | 0 real (only Open Collective postinstall) | Canvas, vanilla | Limited | Workbook JSON + cell model | Stale; README points at `@wolf-table/table` | Tiny, but unmaintained |
| **@wolf-table/table** | MIT | 1 (`@wolf-table/table-renderer`) | Canvas | Unclear | Early canvas table | Immature (0.0.3) | Not ready |
| **Univer** (`@univerjs/presets`) | Apache-2.0 | Many (plugin suite) | React 18/19 + canvas | Yes | Facade `univerAPI` workbook/range | Very active | Too heavy; brings React |
| **fortune-sheet** | MIT | core: formula-parser, dayjs, immer, lodash, numeral, uuid; UI: React | React | Luckysheet-compatible | `getCellValue` / `setCellValue` / ranges | Active fork of Luckysheet | React + lodash |
| **Luckysheet** | MIT | jquery, dayjs, numeral, pako, … | jQuery | Yes | `setCellValue`, ranges | **Archived**; use Univer | Do not adopt |
| **canvas-datagrid** | BSD-3-Clause | 1 | Canvas web component | Grid paste, not Excel clone | `grid.data` object rows | Quiet (last npm 0.4.7, 2023) | Grid, not sheet |
| **Handsontable** ≥7 | Proprietary (non-commercial or paid) | Large | Vanilla / wrappers | Yes | Full grid API | Active | License unfit for this OSS product |
| **HyperFormula** | GPLv3 or commercial | 2 | Headless (no UI) | N/A | `getCellValue` / `setCellContents` | Active | GPL copyleft vs typical MIT app; no grid |
| **PapaParse** | MIT | 0 | None (CSV only) | Clipboard TSV/CSV parse | Arrays/objects | Active 5.7.0 | Companion parser, not a sheet |

---

## 1. jspreadsheet CE — recommended

- GitHub: https://github.com/jspreadsheet/ce
- Docs (v4 quick reference, CE API still maps here): https://bossanova.uk/jspreadsheet/v4/docs/quick-reference
- Getting started / v5: https://bossanova.uk/jspreadsheet/docs
- npm: https://www.npmjs.com/package/jspreadsheet-ce (`package.json` dependencies: `@jspreadsheet/formula`, `jsuites`)
- License: MIT (README)

**Why it fits:** vanilla (no React/jQuery), two bounded deps, Excel-like clipboard, headers as first-class (`getHeader` / `setHeader` / `getHeaders`), and a CRUD surface that translates 1:1 into Blockly:

| Library method | Candidate Blockly block |
|----------------|-------------------------|
| `getValue("A1")` / `setValue("A1", v)` | `sheet_get_cell` / `sheet_set_cell` |
| `getValueFromCoords(x,y)` / `setValueFromCoords` | `sheet_get_xy` / `sheet_set_xy` |
| `getRowData` / `setRowData` | `sheet_get_row` / `sheet_set_row` |
| `getColumnData` / `setColumnData` | `sheet_get_column` / `sheet_set_column` |
| `getHeader` / `setHeader` / `getHeaders` | `sheet_get_header` / `sheet_set_header` |
| `insertRow` / `deleteRow` / `insertColumn` / `deleteColumn` | `sheet_insert_*` / `sheet_delete_*` |
| `getData` / `setData` | `sheet_get_data` / `sheet_set_data` |
| `download` / `csv` init | export / load CSV |
| `onpaste` | ingest Excel/Sheets clipboard |

Column `type` at init (text, numeric, dropdown, …) can back ROADMAP “restrict row/column datatype”. `parseFormulas` exists but can stay off until a later grill.

**Caveats:** Pro vs CE feature split (paid Pro at https://jspreadsheet.com). v5 changed some method signatures (`getValue` string-only, `parseCSV` removed — use helpers). DOM grid, not canvas — fine for terminology-sized sheets, weaker for 10⁵ cells.

---

## 2. x-data-spreadsheet / wolf-table

- https://github.com/myliang/x-spreadsheet (npm `x-data-spreadsheet`)
- Successor note in LICENSE/README: migrated toward https://github.com/wolf-table/table (`@wolf-table/table` 0.0.3)
- Demo: https://myliang.github.io/x-spreadsheet
- Runtime: essentially **zero** (opencollective postinstall only)

Canvas Excel-like UI, MIT, tiny. **Last published 1.1.8; wolf-table is pre-1.0.** Do not build Chunk 8 on an unmaintained canvas fork unless the user explicitly wants zero-dep and will accept forks.

---

## 3. Univer (Luckysheet successor)

- https://github.com/dream-num/univer — Apache-2.0
- Site: https://univer.ai/
- Embed (official): `@univerjs/presets` + `@univerjs/preset-sheets-core` — see https://docs.univer.ai/
- Luckysheet archived: https://github.com/dream-num/Luckysheet (`Luckysheet is no longer maintained`)

Full office SDK (sheets/docs/slides), formula engine, xlsx, collaboration. **UI layer is React.** Plugin graph is large. Overkill unless we want a Google-Sheets clone inside the workbench.

---

## 4. fortune-sheet (Luckysheet TypeScript fork)

- https://github.com/ruilisi/fortune-sheet — MIT
- Demo: https://ruilisi.github.io/fortune-sheet-demo
- npm: `@fortune-sheet/core` + `@fortune-sheet/react`
- Core deps: `@fortune-sheet/formula-parser`, `dayjs`, `immer`, `lodash`, `numeral`, `uuid`

Excel-like API (`getCellValue`/`setCellValue`/ranges). **React peer dependency.** Reject unless we introduce React solely for this pane.

---

## 5. canvas-datagrid

- https://github.com/TonyGermaneri/canvas-datagrid — BSD-3-Clause
- Docs: https://canvas-datagrid.js.org/
- npm `canvas-datagrid` 0.4.7 (Dec 2023)

Vanilla canvas **data grid** (`grid.data = [{col1, col2}, …]`), not A1/formulas/headers-as-sheet. Useful if we only needed a fast editor for object rows. Weaker match for “spreadsheet/matrix”.

---

## 6. Handsontable / HyperFormula — license mismatch

- Handsontable docs: https://handsontable.com/docs/javascript-data-grid/software-license/  
  Last MIT release **6.2.2 (2018)**. Current: proprietary non-commercial *or* paid commercial.
- HyperFormula: https://hyperformula.handsontable.com/docs/ — GPLv3 or commercial. Headless formula engine only.

Neither is a default for a permissive open-source mapping tool.

---

## 7. PapaParse (ingest companion, not a grid)

- https://www.papaparse.com/ — MIT, **zero** runtime deps, npm `papaparse` 5.7.0
- GitHub: https://github.com/mholt/PapaParse

If the chosen grid’s CSV helper is weak, parse clipboard/files with PapaParse and `setData` into the sheet. Does not replace a matrix UI.

---

## Recommended stack (pending grill)

1. **jspreadsheet-ce** as the visible sheet widget + the method list that seeds Blockly blocks.
2. **Project-owned sheet JSON** (column titles + 2D values + optional row names) as the persisted source of truth so Test Run and codegen do not depend on the DOM widget.
3. **PapaParse** only if CE’s CSV/paste helpers are insufficient in v5.
4. **Do not** take Univer/fortune-sheet (React), Luckysheet (dead), Handsontable/HyperFormula (license).

Blockly blocks should wrap **our sheet store**, with method names aligned to jspreadsheet so the widget stays a view. Lookup-by-content (find row where header `code` equals source) is a thin function over `getData`/`getHeaders`, not a second library.
