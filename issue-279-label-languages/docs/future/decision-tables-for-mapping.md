# Decision tables (and trees/graphs) as mapping constructs

**Status:** Future investigation — no Blockly type, Mapping Model builtin, or codegen yet. Captured 2026-09-07; scheduling choice **C** recorded the same day (codes/values *and* narrative; values first, COLLECT/snippets as soon as a narrative Example Set needs them).

**Verdict:** A **mapping-local decision table** is a strong candidate for a later Sheets-adjacent construct. A row should be able to emit **plain values** (TermIds, codes) **and/or template snippets** (Handlebars / Go `text/template` fragments) from the same inputs. Full **decision trees / graphs**, openEHR **Decision Language** modules, and **GDL2** guidelines are a poor fit as Mapping Editor blocks. They solve clinical decision support and process logic, not conversion. Steal compact table ideas from those specs; do not implement those languages.

The production lung-MDT Handlebars script is the right first narrative fixture — as a **new sibling Example Set**, not a rewrite of the current one. See [Alternative Example Set](#alternative-example-set-lung-mdt-decision-tables).

---

## Sources

| Source | What it contributes |
|--------|---------------------|
| [openEHR Decision Language](https://specifications.openehr.org/releases/PROC/latest/decision_language.html) (PROC, **RETIRED**) | Decision Logic Modules (DLMs): inputs, named conditions, `choice in` compact case tables, quantitative **ranges**, multi-lingual terminology on symbols. Aimed at Task Planning / guidelines, not mapping. |
| [openEHR GDL2](https://specifications.openehr.org/releases/CDS/latest/GDL2.html) (**STABLE**) | Production-rule CDS (`when`/`then`), calculators, alerts, care-plan updates. Related CDS stack; still not a conversion construct. |
| [Wikipedia: Decision table](https://en.wikipedia.org/wiki/Decision_table) | Four-quadrant conditions × actions; **don't-care**; **balanced/complete** tables; program-embedded lookup. |
| [Wikipedia: Decision tree](https://en.wikipedia.org/wiki/Decision_tree) | Nested tests → leaf outcomes; linearizes to `if cond1 and cond2 then outcome`; trees grow fast; ML CART/ID3 is a different problem. |
| [OMG DMN](https://www.omg.org/spec/DMN/1.5) (formal 1.5) | Industry decision-table standard: input/output clauses, **hit policies** (UNIQUE, ANY, FIRST, PRIORITY, COLLECT, RULE ORDER, OUTPUT ORDER). Camunda’s [hit-policy notes](https://docs.camunda.io/docs/components/best-practices/modeling/choosing-the-dmn-hit-policy/) are a readable secondary explanation of those policies. |

Project facts below follow `CONTEXT.md`, [ADR 0005](../adr/0005-convert-time-sheets.md), [ADR 0004](../adr/0004-go-template-codegen-only.md), and the current expression/codegen code.

---

## What intEHRgrator already has

These overlap the “compact logic” space. A new construct must beat them, not duplicate them.

| Existing piece | What it is good for | Gap vs a decision table |
|----------------|---------------------|-------------------------|
| **Sheet** + `sheet_lookup` | 2D grid; **first row** where one column **equals** a value; convert-time `sheets` bag (ADR 0005). Terminology / code→rubric. | One equality key. No don't-care, ranges, multi-column AND, or hit policy. No completeness check. |
| **Map** / `maps_get` | 1D key→value (Defaults Map). | Not 2D; glossary already forbids treating a Sheet as a Map. |
| Mapping Expression `if(cond, then, else)` | Ternary in a Target value slot. TypeScript and XQuery emit this; Go template emits `{{if}}`. | Nested ternaries become unreadable; no completeness; no shared table across slots. |
| Mapping Expression `switch(...)` | Multi-way on one discriminant. TypeScript and XQuery emit it. | One input; no don't-care matrix. Go template `emitGoExpr` does not emit `switch` or sheet accessors today. |
| Blockly `controls_if` | Statement-level branching. Go template codegen walks it (TakeCare XML / narrative path). | Same as a hand-drawn **decision tree**. Hard to review for missing combinations. |
| **Handlebars text block** / **Code text block** | Authored prose with interpolation; Kintegrate path; Go snippets inside XML. | Conditionals in templates (`#if`) scale worse than a table; Blockly→Handlebars codegen is still deferred ([archived ROADMAP §G](../historical-archive/ROADMAP.md)). |

`sheet_lookup` is documented in code as: first row where `matchColumn` equals `matchValue`; return one column or the whole row (`src/core/sheets/model.ts`). That is a **limited-entry lookup table**, not a decision table.

---

## The three families (for mapping, not CDS)

### 1. Decision table — recommended authoring shape

A compact grid:

- **Condition columns** (inputs): predicates over mapping values (source queries, Defaults, other slot results).
- **Action / output columns**: values, codes, or **text fragments**.
- **Rules** = rows (or columns in the classic four-quadrant layout).
- Optional **don't-care** (`—`) so unused inputs are not tested.
- A **hit policy** so overlapping rows are defined, not accidental.

Wikipedia’s software-engineering claim still holds here: a table is easier to review than nested `if`s, and a **balanced** table (every combination prescribed) is a completeness artefact that Blockly trees do not give you.

This is the same visual the informatician already uses for Sheets. The difference is **cell meaning**: Sheet cells are data; decision-table cells are **tests** (`=`, `in range`, `—`) plus **outputs**.

### 2. Decision tree — already on the canvas

A tree is nested `controls_if` / `if()`. Wikipedia notes trees have only splits, no joins, and “grow very big”. Mapping Editor Blockly is already that tree.

**Do not** add a second tree/graph canvas. Optional later: *derive* a read-only tree from a table for explanation (“why this row fired”), not as the authoring source of truth.

Machine-learning trees (CART, random forests) are irrelevant: informaticians author rules, they do not train classifiers on example instances.

### 3. Decision graph / DMN DRD — later, if ever

A graph of several tables (output of A is input of B) is how DMN Decision Requirements Diagrams work. Useful if mappings grow a *library* of named tables (laterality × sex → pronoun; then pronoun + finding → sentence). v1 can be **one table, possibly calling another table by name** without a graph editor — same convert-time bag pattern as named Sheets.

---

## openEHR Decision Language and GDL2 — what to steal, what to refuse

The Decision Language spec is **RETIRED**. It defines DLMs for process/guideline engines: subject variables with **currency** (staleness), `is_available`, quantitative **range bands** (`in_range([high])`), named Boolean conditions, and a compact `choice in` table:

```text
Result :=
    choice in
        =================================================
        has_pre_eclampsia or has_eclampsia:     [emergency],
        previous_obstetric_hypertension or …:   [high_risk],
        *:                                      [low_risk]
        =================================================
    ;
```

GDL2 (**STABLE**) is production rules for CDS (CHA2DS2-VASc, alerts, order-sets). Its `use_template` can emit CDS-Hooks cards — still **decision support output**, not a Conversion Script.

**Refuse as a Mapping Editor construct:** DLM/GDL execution, EHR-backed subject proxies, Task Planning, guideline lifecycle, GDL ODIN/JSON as the Mapping Specification.

**Steal:**

- Compact **choice / otherwise (`*`)** rows (same role as don't-care + default rule).
- **Range columns** (`> 140`, `90 .. 120`) instead of forcing the informatician to pre-bin in Blockly.
- Optional **term definitions** on rule/output codes if tables are shared across UI languages — analogous to DLM terminology, not a second ontology.

A mapping table’s inputs are **Source Paths and Mapping Expressions**, not ontic “true diabetic status” variables. Using DL vocabulary (`input -- Tracked State`) in the Mapping Editor would collide with CONTEXT.md (**Source Path**, **Defaults Map**, **Sheet**).

---

## Where a decision table earns its keep in mapping

Typical conversion pain that nested `if` handles badly:

1. **Multi-condition code or value selection** — unit × method × sex → reference range or local code. `sheet_lookup` needs a concatenated key or many sheets.
2. **Presence / absence / unknown** — three-valued clinical flags (true / false / missing) explode binary `if`s; a table row per combination is reviewable.
3. **Site-specific policy** that should stay convert-time data (ADR 0005 logic): another hospital edits rows, not the Conversion Script.
4. **Narrative / grammatical fragment selection** — see next section.

A **Map** remains right for 1D defaults. A **Sheet** remains right for 1-key terminology lists. A decision table is for **combinational** rules (several independent inputs → one or more outputs).

---

## Narrative and grammatical text

Generating clinically and grammatically sensible text from structured input is a real mapping task in this repo: ROADMAP §G (Go `text/template` FLAT → legacy narrative), **free-form** Target instance format, canvas **Handlebars text block** (`text_handlebars` / Code text block LANG = Handlebars). Nested `controls_if` around XML/`TextKeyWord` is the current compact-ish approach.

Classic NLG splits into:

1. **Content determination** — which facts to mention.
2. **Microplanning** — order, aggregation, referring expressions.
3. **Surface realisation** — morphology, agreement, punctuation.

**Decision tables are strong at (1) and at a thin slice of (3).** They are weak as a paragraph realiser.

### What works well as a table

**Grammatical agreement / closed-class choice** (pronoun, article, verb form, laterality adjective):

| sex | number | sv_pronoun |
|-----|--------|------------|
| male | sg | han |
| female | sg | hon |
| — | pl | de |

**Finding × modifiers → clause** (don't-care on unused modifiers):

| finding | laterality | severity | clause_en |
|---------|------------|----------|-----------|
| effusion | left | — | effusion of the left |
| effusion | right | — | effusion of the right |
| effusion | — | severe | severe effusion |
| * | — | — | (empty / omit) |

**Collect + join** (DMN COLLECT / RULE ORDER): every matching row contributes a fragment; a join template (`"; "` / `" and "`) builds a list. That is how “mention all positive findings, skip negatives” should be authored — not a 2ⁿ tree.

**Output cells as mini-templates:** `"{{laterality}} {{site}}: {{finding}}"` then interpolate with existing `concat` / Handlebars / Go `text/template`. The table chooses the *pattern*; the template language fills slots. That is better than putting a whole paragraph in every cell.

**Mixed outputs (adopted):** one table may have several output columns of different kinds — a **value** (TermId, code, boolean) and a **snippet** (fragment to interpolate). Imaging in the lung-MDT script is exactly that: modality → TakeCare `TermId` *and* a shared Note body. Treatment-recommendation rows pick a connector snippet (`Följt av` / `Föregått av` / …) while still emitting lowered treatment-type values into the same sentence. Column metadata should mark `kind: value | snippet` (snippet language = the Conversion script language in play, or Handlebars as the Note dialect of this mapping).

### What tables will not solve

- Fluent multi-sentence letters with anaphora (“it”, “the same knee”).
- True multilingual realisation (Swedish vs English grammar) beyond swapping fragment columns or locale-specific tables.
- Clinical safety of *what* is said — still the informatician’s review + Test Run.

**Recommendation:** treat narrative as a **first-class consumer** of decision tables (value columns + snippet columns + COLLECT), not as a reason to invent a separate “NLG block”. Keep Handlebars / Go template as the interpolator. The lung-MDT production script (below) is the concrete analysis target.

---

## Translatability to Conversion script languages

Canonical path today: Blockly JSON → Mapping Model expressions → adapters ([ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md)). A decision table should compile to that same pipeline, not become a fifth dialect.

Two emission strategies:

| Strategy | Idea | Best when |
|----------|------|-----------|
| **A. Convert-time table + evaluator** | Persist the grid like a Sheet; generated script calls `decisionTable(name, inputs)` / `sheetLookupMulti`. Same argument bag as ADR 0005. | TypeScript (and later Java) Test Run; tables edited without regenerating logic. |
| **B. Flatten to `if` / `switch`** | Compile rows to nested conditionals in the expression AST. | Template languages with weak helpers (Handlebars, Go `text/template`); XQuery without a sheet runtime. |

**Recommended default:** A for TypeScript Test Run (language-neutral table JSON in the Project Bundle). B as a fallback when the adapter cannot host a helper.

### Per language (today’s adapters, not a wish list)

| Conversion script language | Feasible? | Notes |
|----------------------------|-----------|--------|
| **TypeScript** | Yes — best | Already emits `if`, `switch`, `sheetLookup`. Add `decisionTable(...)` helper next to sheet accessors. Fully executable in Conversion Test Run. |
| **Java** | Yes — helper | `generateJava` emits `decisionTable(...)` / `sheetLookup(...)` next to Archie RM construction (same helper-or-flatten choice as TypeScript). Not executed in web app Test Run. |
| **XQuery** | Flatten (B) first | `if` / `switch` emit; **`sheet_*` is a comment stub** (`(: sheet_lookup — bind $sheets :) ()`). A table helper needs a `$tables` external (like `$source` / `$defaults`) — worthwhile but extra work. Nested `if`/`switch` from compiled rows works in XQuery 3.1 without that. |
| **Handlebars** | Partial | Authored templates can call a custom helper if Mapping preview’s Handlebars runtime registers one. **Blockly→Handlebars codegen is deferred.** Flattening to nested `{{#if}}` is ugly but portable. Prefer: evaluate the table in the Mapping Model / Test Run, pass the **already-chosen string** into the template context. |
| **Go `text/template`** | Partial | `controls_if` and expression `if` emit; `sheet_lookup` / `switch` are **unsupported** in `emitGoExpr`. Nested `{{if}}` from flattened rows works. Better: put the table in `.Parameters` / a convert-time bag and add a small FuncMap helper (same family as the curated Sprig subset). |

**“Most languages” is true for the *logic*, not for a shared runtime helper.** Unique/FIRST tables are just nested conditionals. COLLECT (join fragments) needs either a helper or generated loops — TypeScript/XQuery/Java can loop; Handlebars `#each` can if the collect result is precomputed as an array; Go `range` can likewise.

Don't-care and FIRST/UNIQUE compile trivially. UNIQUE-with-overlap-error is easy in TypeScript/Java, awkward in pure Handlebars (no throw). COLLECT is the narrative-critical policy; implement it in TypeScript Test Run first.

---

## Recommended product shape (when scheduled)

Live in the **Sheets** category: same tab, same jspreadsheet widget, same convert-time bag. Distinct **kind** so CONTEXT.md can keep **Sheet** (data matrix, `sheet_lookup`) separate from **Decision table** (rules). Toolbox: one eval block, e.g. `decision_table` / `sheet_decide`, not a new drawer unless the Sheets drawer overflows.

### Incremental slices (do not ship all at once)

1. **Multi-column equality lookup** — `sheet_lookup` with several `where` pairs (AND), first match. **First implemented slice (adopted).** Still a Sheet, not a decision table.
2. **Predicate cells + don't-care + default (`*`) row** — true decision table. Hit policy **FIRST** (row order) to start — matches current `sheet_lookup` and is obvious in a spreadsheet.
3. **Range predicates** (`>= 140`, `90..120`) on numeric columns — stolen from DL range tables; important for labs/vitals.
4. **UNIQUE warning** in the Mapping Editor (yellow **Constraint warning** family): two rows match the same Active Example, or the table is not balanced.
5. **COLLECT + join** for narrative fragments, plus **snippet output columns** (mixed with value columns on the same row).
6. **DMN XML import/export** — **not in the first slices.** Logged on [archived ROADMAP §C](../historical-archive/ROADMAP.md) and Chunk 8 later-items in [TASKS-roadmap-chunks.md](../historical-archive/TASKS-roadmap-chunks.md). Simple tables only (equality/range, FIRST/UNIQUE/COLLECT). Do not take on FEEL as the Mapping Expression language.
7. **Sibling lung-MDT Example Set** that uses the tables for the complex Note parts — see below. Do not replace the current Handlebars-in-`text_code` set.

### Blockly

Value block: named table + one input per condition column (wired from `source_query*` / `maps_get` / literals) → output (string/number/boolean, or list if COLLECT). Selecting the block focuses the Sheets tab (same as the `sheet` declaration block).

Keep Mapping Specification canonical as Blockly JSON; table *data* stays project-owned grid JSON (widget is a view), same as Sheets.

### Completeness

Offer a “show missing combinations” action for Boolean/enum columns. Skip it for free-text and open numeric ranges (infinite). Wikipedia’s “balanced table” is the review artefact informaticians need.

---

## What not to do

- Implement openEHR DL / GDL2 / Task Planning inside intEHRgrator.
- Add a flowchart / ML-tree editor beside Blockly.
- Treat a Decision table as an **ITEM_TABLE** or as a **Map**.
- Bake table rows into Generated Export as the only mode (contradicts ADR 0005 for site-editable grids). Flattened `if`s are an *adapter fallback*, not the store.
- Expect tables alone to replace Handlebars/Go template for long-form narrative.
- Require full DMN/FEEL in the first slices — hit-policy *ideas* are enough. **DMN XML import/export** is a later [archived ROADMAP §C](../historical-archive/ROADMAP.md) item, after internal table JSON is stable.
- Rewrite or replace [`test/fixtures/lung-MDT-form/`](../../test/fixtures/lung-MDT-form/) or catalog id `lung-mdt-form-to-tc-xml`. The decision-table mapping is a **sibling Example Set**.

---

## Relation to other future docs

| Doc | Overlap |
|-----|---------|
| [spreadsheet-matrix-libraries.md](spreadsheet-matrix-libraries.md) | Widget stays jspreadsheet-ce; decision tables are extra column metadata + eval, not a new grid library. |
| [text-first-mapping-editor.md](text-first-mapping-editor.md) | A Mapping Spec Widget row for `decision_table` would collapse the eval block; the grid still lives in the Sheets tab. |
| [formal-verification-export.md](formal-verification-export.md) | UNIQUE / balanced tables are ready-made invariants (“exactly one row matches”). Good later input to a mapping contract. |
| [function-test-harnesses.md](function-test-harnesses.md) | Same grid can hold **oracles** (input combos → expected outputs) for a **Blockly Function**. Distinct **kind** from convert-time rule tables; a mapping decision table can seed a test table. |

---

## Alternative Example Set: lung-MDT decision tables

**Do not modify** [`test/fixtures/lung-MDT-form/`](../../test/fixtures/lung-MDT-form/). That set is the production Handlebars reconstruction (`lung-mdt-form-to-tc-xml` in [`examples/example-sets.json`](../../examples/example-sets.json)): TakeCare schema blocks, outer `controls_if`, original Note bodies in `text_code`. Tests (`test/takecare_schema_blocks_test.ts`) pin that Blockly JSON to the PROD script.

Instead, **analyse the PROD script and add a sibling Example Set** that keeps the same target, Defaults Map, and (when they exist) source instances, but authors the *combinational* Note logic as decision tables.

**Layout (adopted 2026-09-08, option A):** new directory `test/fixtures/lung-MDT-form-decision-tables/` holds only the new mapping (+ a short README). Catalog URIs reuse the existing TakeCare XSD, Defaults Map, and PROD script. Do not add a catalog stub that points at a missing mapping file; create the directory when the decision-table construct can actually author it.

| Keep untouched | New (adopted) |
|----------------|----------------|
| Catalog id `lung-mdt-form-to-tc-xml` | `lung-mdt-form-to-tc-xml-decision-tables` |
| `test/fixtures/lung-MDT-form/` (all files) | `test/fixtures/lung-MDT-form-decision-tables/mapping/mapping.blockly.json` + README |
| `mappningsscript-xml-3-2-0-prod.txt` (gold Handlebars) | Same file referenced as **expected** Conversion Test Run text — do not fork the script |
| `defaults.map.json`, TakeCare XSD | Catalog URIs pointing at those existing files |
| QA script `3.2.1` | Out of scope unless a difference is table-relevant |

The current catalog entry has `"instances": []`. The sibling set should not invent a fake composition just to load; when real FLAT/STRUCTURED examples land, **share them by URI** with the original set.

Success criterion: on the same Active Example, keyword `TermId`s and `Note` strings match the PROD Handlebars (whitespace-normalized). The Blockly tree may differ; the casenote must not.

### What the PROD script is doing (analysis)

Source: [`test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt`](../../test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt). Each TakeCare keyword is a `TermId` plus a `Note`. Simple keywords (participants, current situation, comorbidity, ECOG, screening, SVF) are passthrough — leave those as `source_query` / `text_code`. The tables earn their keep on the rest.

#### 1. Imaging modality → TermId **value** + shared Note **snippet** (FIRST)

Three nearly identical Note bodies; only the outer guard and `TermId` differ:

| `typ_av_undersökning` | TermId | Keyword comment |
|----------------------|--------|-----------------|
| `"MR"` | `12683` | Magnetisk resonanstomografi |
| `"Ultraljud"` | `4829` | Ultraljud |
| not MR and not Ultraljud (Röntgen catch-all) | `59` | Röntgenundersökning |

The Note itself is a COLLECT of labelled fragments (undersökningstyp + lokalisation, datum, primärtumör, lymfkörtelmetastaser with `toLowerCase` laterality, fjärrmetastaser, övergripande kommentar, kompletterande hjärna). Today that body is copy-pasted three times (~90 lines × 3).

**Table `imaging_keyword`:** condition column = modality (equality / `ne`); output `term_id` (value); output `note_snippet` (name of one shared snippet, or the snippet text). Outer “emit keyword?” stays a presence `or` of fields — that is a COLLECT/any-filled test, not a second tree.

#### 2. Smoking (TermId `8754`) — FIRST between two snippet shapes

- `övergripande_status == "Har aldrig rökt"` → snippet = the status value only.
- else → snippet = `#each per_typ` (`status (typ)`, optional `Paketår`, `Slutade`, `Kommentar`).

A two-row table plus one COLLECT sub-snippet for the smoker/ex-smoker branch.

#### 3. Behandlingsrekommendation (TermId `14351`) — the grammatical core

The Note is a 2⁴-style dispatch on which of `{intention, huvudbehandling, relation, tillägg}` are present (HTML comments in the script name the branches: `intention + huvud + relation + tillägg`, `bara huvud`, `bara intention`, …). Nested inside every branch, the same two combinators repeat:

**Connector snippets** (relation × whether huvud exists) — mixed *value* (lowercased relation word) and *snippet* (the Swedish glue):

| relation | huvud present? | snippet |
|----------|----------------|---------|
| Adjuvant | yes | `Följt av` |
| Neoadjuvant | yes | `Föregått av` |
| Perioperativ | yes | `Rekommenderas också tilläggsbehandling i form av` |
| * | yes | `Patienten rekommenderas` |
| Adjuvant | no (relation-only branch) | `Följt av adjuvant behandling.` |
| … | … | … |

**Regimen / dose snippets** (presence of `regim`, `antal_kurer`, `annan_regim`, `typ`):

| regim | antal_kurer | annan_regim | snippet |
|-------|-------------|-------------|---------|
| yes | yes | — | ` enligt regim {{regim}}, {{antal_kurer}} kurer.` |
| yes | — | — | ` enligt regim {{regim}}.` |
| — | yes | — | `, {{antal_kurer}} kurer.` |
| — | — | yes | ` enligt regim {{annan_regim}}.` |
| — | — | — | `.` (if typ present) |

Same pattern for `fraktionsdos` × `totaldos` (`Fraktionsdos: …, Totaldos: …` vs one side only).

**Kemoradioterapi:** if `typ == "Kemoradioterapi"` and `form_av_kemoradioterapi` is filled, insert the lowered form *before* the type — a two-column FIRST table, not another `#if (and (eq …))`.

These tables should be **named and reused** (the script currently duplicates the regimen/dose/`eq Kemoradioterapi` blocks a dozen times). The outer “which sentence frame?” table can output a **snippet that calls the inner tables** (`Patienten rekommenderas {{intention}} {{huvud_phrase}} {{connector}} {{tillägg_phrase}}`).

#### 4. Coded `|value|` vs `|other|`

Repeats for undersökningstyp, kroppsställe, ingreppsmetod: prefer `|other|` if present else `|value|`. A two-row FIRST table (`other` filled? → other; else value) or a tiny helper; not worth a tree.

#### 5. What to leave as Handlebars / `text_code`

- Envelope XML and TakeCare schema blocks (unchanged from the current Example Set).
- `#each` over repeating clusters (bilddiagnostik, PAD, behandlingsstrategi) — **Source iteration** / template loops, not a decision table.
- Passthrough Notes (TermIds `6300`, `5074`, `4502`, `209`, `5154`, `5146`, …).
- Presence `or`-guards that only mean “omit empty keyword”.

### Suggested tables to author in the sibling set

| Table name | Hit policy | Outputs | Replaces |
|------------|------------|---------|----------|
| `imaging_term` | FIRST | `term_id` (value) | Three outer `#if (eq … MR/Ultraljud/ne)` |
| `imaging_note_parts` | COLLECT | labelled snippets | Copy-pasted MR/UL/RT Note bodies |
| `smoking_note` | FIRST | snippet | TermId `8754` `#if (eq … aldrig rökt)` |
| `treatment_frame` | FIRST | sentence snippet | The 12+ presence-combination branches of TermId `14351` |
| `treatment_connector` | FIRST | snippet (+ optional lowered relation value) | Adjuvant/Neoadjuvant/Perioperativ `#if (eq …)` |
| `regimen_phrase` | FIRST | snippet | `regim` × `antal_kurer` × `annan_regim` nest |
| `dose_phrase` | FIRST | snippet | `fraktionsdos` × `totaldos` nest |
| `chemoradiation_form` | FIRST | snippet (maybe empty) | `eq "Kemoradioterapi"` |

### How to build it (when the construct exists)

1. Inventory every `#if (eq` / `#if (and` / `#if (or` in the PROD script; classify as passthrough, FIRST table, or COLLECT.
2. Copy the current Blockly envelope (ProfdocHISMessage + Defaults Map lookups) into `test/fixtures/lung-MDT-form-decision-tables/mapping/mapping.blockly.json`; **do not** run `scripts/build-lung-mdt-blockly.ts` over the original (that script *is* the current set).
3. Replace the imaging and treatment `text_code` Notes with `decision_table` eval blocks + Sheets-tab grids; keep `text_handlebars` / `text_code` only as snippet interpolators.
4. Golden-test Note text against Handlebars execution of the untouched PROD script on shared instances.
5. Leave `test/takecare_schema_blocks_test.ts` asserting the **original** mapping still uses schema blocks and still round-trips the PROD keyword list.

---

## Open product questions

Resolved 2026-09-07:

1. **Scope C** — both multi-condition values and narrative; first slice can still be multi-column lookup / FIRST tables; COLLECT + snippet columns land with the lung-MDT sibling Example Set.
2. **Mixed outputs** — a row may emit values *and* template snippets depending on inputs (imaging TermId + Note; connector phrase + lowered type).
3. **Fixture** — new Example Set beside `test/fixtures/lung-MDT-form/`; never overwrite that directory or its catalog id.

Resolved 2026-09-08:

4. **Sibling layout A** — `test/fixtures/lung-MDT-form-decision-tables/` for mapping + README only; catalog id `lung-mdt-form-to-tc-xml-decision-tables`; reuse XSD / Defaults Map / PROD script by URI. No empty catalog entry until the mapping exists.
5. **First slice A** — ship **multi-column equality `sheet_lookup`** (still a Sheet, convert-time bag unchanged) before a separately named Decision table. Promote a grid to `kind: decision-table` when predicate cells, don't-care, mixed value/snippet outputs, or a hit policy other than first-match are needed. Lung-MDT sibling set waits on that promotion (imaging TermId + Note snippets are not equality-only).
6. **DMN A (now)** — do not implement import/export until the internal decision-table JSON is stable. **Parked** on [archived ROADMAP §C](../historical-archive/ROADMAP.md) and Chunk 8 later-items in [TASKS-roadmap-chunks.md](../historical-archive/TASKS-roadmap-chunks.md) so it is not forgotten. Still no FEEL.

No remaining open product questions from this grill.
