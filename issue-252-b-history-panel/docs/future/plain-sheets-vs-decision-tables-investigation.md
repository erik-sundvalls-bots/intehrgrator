# Plain Sheets vs decision tables (integration context)

**Status:** Investigation — 2026-09-11.

**Question:** Are plain **Sheets** (`kind: sheet`) still needed or useful for integration work now that **Decision tables** (`kind: decision-table`) exist? Could plain Sheets be removed?

**Verdict:** **Keep plain Sheets.** Decision tables complement them; they do not replace them. Removal would break the primary integration use case (terminology / reference-data lookup) and collapse a deliberate glossary split. The shared jspreadsheet widget and convert-time `sheets` bag (ADR 0005) should stay; only the **kind** and **Blockly surface** differ.

---

## What each construct is for

| | **Sheet** (`kind: sheet`) | **Decision table** (`kind: decision-table`) |
|---|---------------------------|---------------------------------------------|
| **Role** | Convert-time **data** matrix | Convert-time **combinational rules** |
| **Cell meaning** | Stored values (codes, rubrics, labels) | Condition predicates (`=`, don't-care `—`) or outputs (value / VMS-Mustache snippet) |
| **Blockly** | `sheet_get_*`, `sheet_lookup` | `decision_table` (locals Map → output column) |
| **Typical integration use** | ICD→SNOMED tables, vendor code lists, CSV/Excel paste from hospital spreadsheets | Multi-input branching (laterality × finding → TermId + clause), COLLECT narrative fragments |
| **Hit policy** | First row where one column equals (lookup semantics) | FIRST / UNIQUE / COLLECT |

Both persist as `SheetDocument` JSON in the Project Bundle, share the Sheets tab widget, and pass through the same convert-time `sheets` argument (ADR 0005). They are **not** interchangeable kinds.

Sources: `CONTEXT.md` (Sheet, Decision table), `docs/future/decision-tables-for-mapping.md`, `docs/adr/0005-convert-time-sheets.md`, `src/core/sheets/`.

---

## Integration contexts where plain Sheets still earn their keep

### 1. Terminology and code translation (primary)

The adopted pattern for integration mappings is **`sheet_lookup` against a named Sheet** — e.g. headers `code` / `snomed` / `rubric`, key from source, return one column or the whole row (`test/sheets_test.ts`, AI suggestion examples in `src/core/ai/mod.ts`).

This is **reference data**, not a rule matrix. Every row is a fact (“I10 → 38341003”), not a predicate. Modelling it as a decision table would force artificial condition columns, hit-policy metadata, and `decision_table` + locals wiring for what is a one-key lookup.

`docs/future/decision-tables-for-mapping.md` states explicitly: *“A **Map** remains right for 1D defaults. A **Sheet** remains right for 1-key terminology lists.”*

### 2. Rich grid access beyond lookup

Sheets expose **seven accessor shapes** (`sheet_get_cell`, `sheet_get_xy`, `sheet_get_row`, `sheet_get_column`, `sheet_get_header`, `sheet_get_data`, `sheet_lookup`). Decision tables expose **one** eval block that returns a chosen output column (or COLLECT-joined snippets).

Integration scripts sometimes need row/column slices, A1 coordinates, or full grid export — not rule evaluation. None of that maps cleanly onto `decision_table`.

### 3. External data ingest workflow

Chunk 8 adopted **Excel/Sheets paste and CSV import/export** into plain Sheet documents (`docs/future/spreadsheet-matrix-libraries.md`, `src/core/sheets/csv.ts`, `src/ui/sheets_panel.ts`). Hospitals and terminologists maintain code tables outside the mapping; the informatician pastes or imports them.

Planned **FHIR ConceptMap / ValueSet → Sheet import** (ROADMAP S-05) targets **Sheets**, not decision tables — ConceptMaps are equivalence data, not hit-policy rules.

### 4. Convert-time bag without recompilation

ADR 0005: site-specific terminology grids stay in the Project Bundle and resolve at convert time so a code/rubric edit does not require regenerating the Conversion Script. That rationale applies equally to plain Sheets; decision tables share the bag but address different logic.

### 5. Formal verification and AI surfaces

`docs/future/formal-verification-export.md` treats sheet **accessors** as quantifiable tabular preconditions (static bundle content). AI suggestions and `AI_SUGGESTION_FORMAT.schema.json` list `sheet_lookup` / `sheet_get_*` but not decision-table-as-replacement for terminology.

---

## What decision tables cover instead (and why that is not a superset)

Decision tables address **combinational logic** that nested `if` / `sheet_lookup` handles poorly:

- Several independent inputs with don't-care cells
- Mixed **value** and **snippet** output columns (lung-MDT imaging / treatment narrative — `test/decision_table_test.ts`)
- Hit policies (FIRST, UNIQUE, COLLECT) for overlapping or aggregating rules

A single-key terminology table *could* be encoded as a one-condition-column decision table with FIRST policy, but that would be:

- Worse authoring UX (condition vs data semantics on every cell)
- Heavier Blockly (`decision_table` + locals Map vs one `sheet_lookup`)
- A loss of `sheet_get_row` / full-row record returns
- A violation of the adopted glossary (data Sheet ≠ rule Decision table)

**Planned middle ground:** multi-column equality `sheet_lookup` (AND of several header=`value` pairs, first match — ROADMAP S-02) remains a **Sheet** feature, not a decision table. Promote to `kind: decision-table` only when don't-care, snippet outputs, or non–first-match hit policies are needed (`decision-tables-for-mapping.md` incremental slice 1 vs 2).

---

## Could Sheets be removed?

| Option | Assessment |
|--------|------------|
| **Remove plain Sheets; only decision tables** | **Reject.** Breaks terminology lookup, CSV/ConceptMap ingest, accessor API, AI examples, and CONTEXT.md. Forces rule semantics onto pure data. |
| **Merge kinds into one “grid” with modes** | **Already done** at persistence/widget level (`SheetDocument` + `kind`). Keep distinct kinds and Blockly blocks. |
| **Deprecate `sheet_get_*` except `sheet_lookup`** | Possible long-term simplification for *blocks*, but not removal of the Sheet document kind. Row/column getters may matter for advanced integration. |
| **Add `sheet_to_map` for 1D compatibility** | Deferred (`DESIGN-sheets-vs-maps.md` option C) — optional bridge, not a replacement for 2D Sheets. |

A third grid kind is already planned: **function-test** tables (oracles, not convert-time rules or data) in `docs/future/function-test-harnesses.md`. That reinforces “one widget, multiple kinds” rather than collapsing to decision tables only.

---

## Recommendation

1. **Do not remove plain Sheets** from product or integration guidance.
2. **Keep the glossary split:** Sheet = data matrix; Decision table = rules; (future) Function test table = oracles.
3. **Route authors by task:**
   - Code list / terminology / pasted hospital spreadsheet → **Sheet** + `sheet_lookup`
   - Multi-condition value or narrative selection → **Decision table** + `decision_table`
   - 1D defaults / nested Blockly values → **Map** + `maps_get` (unchanged)
4. **Ship multi-column `sheet_lookup`** (S-02) before pushing authors toward decision tables for simple multi-key lookups.
5. **Revisit only** whether the full `sheet_get_*` accessor set stays in the default toolbox once real integration projects show which accessors are unused — not whether the Sheet kind itself should exist.

---

## Related

- [decision-tables-for-mapping.md](decision-tables-for-mapping.md) — rule-table design; explicit Sheet coexistence
- [DESIGN-sheets-vs-maps.md](../design/DESIGN-sheets-vs-maps.md) — Maps vs Sheets (Defaults stay 1D)
- [ADR 0005](../adr/0005-convert-time-sheets.md) — convert-time bag
- [function-test-harnesses.md](function-test-harnesses.md) — third grid kind
