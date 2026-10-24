# Sheets and decision tables

Two grid tools live in the Mapping Editor. A **Sheet** is a lookup table (a code in, a code out). A **decision table** is a rule matrix (several conditions in, one or more results out, including a text snippet).

Back to the [tutorial index](../TUTORIAL.md).

## Toolbox

| Drawer | Use for |
|--------|---------|
| **Lists & maps** | Generic maps, terminology lookups (`get map key …`), list operations. The unique **default context map** is on the canvas, not in this drawer. See [Default context](default-context.md). |
| **Logic** | Conditions, list restrictions, set operations |
| **Decision Tables** | Rule grids. **Add decision table** creates an empty grid and selects it in the Tables & Sheets tab. The eval block picks that grid from a name dropdown. |
| **Sheets** | Lookup grids. **Add sheet** creates an empty grid the same way. `sheet_get_*` and `sheet_lookup` pick the grid from a name dropdown. |
| **Variables** / **Functions** | Same section of the toolbox, under the divider with the two grid drawers. |

## Sheets tab

The **Sheets** tab in the Mapping Editor embeds a spreadsheet for grids owned by the project. Paste a terminology table there, name it, and look up a cell from a Blockly block. A sheet is reference data: every row is a fact, not a rule.

<img src="../assets/tutorial/sheets-tab.png" alt="Tables and Sheets tab with Add sheet, Add decision table, and Import CSV" />

*Tables & Sheets is where the grids live. Blockly blocks only read them.*

## Decision tables

Use a decision table when several independent inputs together pick an output: a TermId and a narrative note, a hit policy of “first matching row”, a don’t-care cell. The Example Set rows marked **mapped, decision tables** (lung-MDT and chemo) are the worked examples. They keep the same instances and target as the mapped sibling, and they author Notes and TermIds as tables instead of nested `if` / `eq` blocks.

**Add sheet**, **Add decision table**, rename, delete, import, export, and fullscreen sit at the top-right of the Mapping Editor pane, in the same place as the Mapping Spec actions.

On a decision table, **Add input/condition** adds a condition column. **Add output** adds an output column. **Add default row** appends a catch-all row: every input cell is don’t-care (`—`). The same `—` can be written into any cell from that cell’s context menu.

Each column header shows a cogwheel. The cogwheel and a right-click on the header open the same menu: **Move left**, **Move right**, and **Delete {name}** (red). Columns and rows can also be dragged. Deleting a column confirms in a short toast; Undo on the canvas restores it. An output column has one kind dropdown in that menu, labeled **Output type** — string, number, boolean, or **string pattern** — and each option shows the same mark as the header (`🔤`, `🔢`, `✓`, `{}`). The header mark updates as soon as the type changes. A string pattern column holds a VMS-Mustache snippet (bound names such as `{{word}}`). Branching stays in the table, not inside the cell.

## Hit policy

The hit policy sits next to the decision table, with an **(i)** that summarises the three choices.

| Policy | What it does |
|--------|----------------|
| **FIRST** | Use the first matching row. Later matches are ignored. |
| **UNIQUE** | Only one row may match. More than one match is an error. |
| **COLLECT** | Join every matching row’s output, in row order. Blank cells are skipped. |

**COLLECT dedupe** appears when the policy is COLLECT. It keeps the first copy of a repeated fragment.

Generated scripts receive a **sheets** bag at convert time, covering both kinds of grid. See [Tests and export](tests-and-export.md).
