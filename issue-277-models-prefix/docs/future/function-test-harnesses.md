# Function test harnesses (and other mapping testability)

**Status:** Future investigation — **Extract to function** exists as a Blockly refactor (context menu → stock procedure). Mapping Model, Test Run, and codegen do **not** yet treat a **Blockly Function** as a callable unit. Captured 2026-09-07.

**Verdict:** Treat a **Blockly Function** as a testable mapping fragment, not only a canvas compression trick. The first product slice is **see-through calls** (Test Run still produces the same instance after extract). The useful slice is a **Function Test Harness**: named inputs, expected outputs, run without rendering the whole Target instance. A **decision table** is a strong authoring shape for those cases — same grid family as Sheets / mapping decision tables, different **kind** (tests, not convert-time rules). Whole-mapping **Test Run** against **Example Instances** stays the integration test; function cases are unit tests of parts.

---

## Sources

| Source | What it contributes |
|--------|---------------------|
| [PR #30](https://github.com/regionstockholm/intehrgrator/pull/30) Extract to function | Context-menu refactor onto `procedures_defreturn` / `defnoreturn`; call left at the site. Mapping Specification stays Blockly JSON (ADR 0001). |
| Blockly procedures ([DeepWiki](https://deepwiki.com/RaspberryPiFoundation/blockly); JS generator) | Def + call + argument mutator; generator emits real JavaScript `function`s. No built-in unit-test UI. |
| [Wikipedia: Decision table](https://en.wikipedia.org/wiki/Decision_table) (testing use) | Black-box **cause–effect** cases: columns = inputs / expected results; rows = combinations; don't-care; completeness. Distinct from using a table as *runtime* mapping logic. |
| [decision-tables-for-mapping.md](decision-tables-for-mapping.md) | Mapping-local rule grids (FIRST/COLLECT, values + snippets). Steal the widget and completeness idea; do not conflate rule tables with test tables. |
| [formal-verification-export.md](formal-verification-export.md) | Whole-mapping contracts and PBT. Function cases are a cheaper, informatician-facing layer underneath that. |

Project facts follow `CONTEXT.md`, [ADR 0001](../adr/0001-mapping-and-target-seams.md), [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md), and the current expression / Test Run code.

---

## Problem

**Extract to function** lets the informatician reuse a subtree (source queries, text generation, nested `if`s). After extract:

1. **Test Run can go blank for that slot.** `blockToExpression` has no `procedures_callreturn` case (it returns `null`). `workspaceToModelJson` then **omits** the slot. Mapping preview and TypeScript Generated Export no longer see the mapping. The canvas still looks mapped.
2. **There is no unit of evaluation smaller than the whole mapping.** **Test Run** always walks every Mapping Model slot against the **Active Example** and renders a Target instance (or Handlebars / Go template). To check “does this laterality helper return `left`?”, the informatician must load a full example and hunt through COMPOSITION JSON or a casenote.
3. **Extract does not create parameters.** The body keeps its `source_query` / `maps_get` / `var` children, closed over the live source and **Defaults Map**. That is reuse, not a testable function: you cannot feed synthetic inputs without editing the Active Example.
4. **Example Sets and repo `deno test` fixtures are integration tests.** They pin whole Blockly JSON or whole PROD scripts. They do not pin `greet(name) == "Hello Ada"`.

The informatician’s pain: “I extracted a helper; now I cannot see if it still works, and I cannot table out the edge cases.”

---

## What intEHRgrator already has

These overlap the “test a piece” space. A harness must beat them, not duplicate them.

| Existing piece | What it is good for | Gap vs a function harness |
|----------------|---------------------|---------------------------|
| **Test Run** (Mapping preview) | Whole mapping × **Active Example** → instance + **Output validation**. | One example at a time; no function boundary; extract currently drops the slot. |
| TypeScript Output mode | Executes Generated Export (ADR 0003). | Same whole-`convert` grain. Procedure calls are not in the Mapping Model, so they never reach `generateTypeScript`. Blockly’s own `javascriptGenerator` *would* emit JS functions if we compiled the workspace directly — we do not, for preview. |
| **Example Set** | Catalogued source + target + mapping (+ Defaults Map). | Integration fixture. ROADMAP already wants expected-output files for Handlebars example sets. |
| Agent API `run_test` | Agents re-run the same whole Test Run. | No `run_function_test`. |
| Repo `deno test` | Codegen, extract-menu, example Blockly JSON. | Developer-facing; not an informatician harness. |
| **Sheet** + `sheet_lookup` | Convert-time data. | Not expected-output. |
| Mapping **decision table** (future) | Runtime combinational **rules**. | A rule table *is* the logic. A test table *checks* logic. Same grid, different kind. |
| Mapping Contract / PBT (future) | Properties over many generated sources. | Complements tables; does not replace named expected rows the informatician authored. |

`validateExpressionSource` also **forbids the token `function`**. Any Mapping Expression builtin for calls must be named `call` / `apply` / `fn_call`, not `function(...)`.

---

## Blockly Function vs Conversion script function

Keep the glossary split:

- **Blockly Function** — stock procedure on the canvas (`procedures_def*`, Functions drawer). Fragment of the Mapping Specification.
- Conversion script `function` — whatever TypeScript/Java/XQuery emit. Not the authoring unit.

A harness tests the **Blockly Function**. Adapters should compile it (inline or as a helper) so Generated Export matches Test Run (ADR 0003).

Two Blockly shapes, two harness difficulties:

| Shape | Blocks | Maps to Mapping Expression? | Test grain |
|-------|--------|-----------------------------|------------|
| **Value function** (`procedures_defreturn`) | Expression subtree → return | Yes, if we serialize the body (and args) | Return value (string / number / boolean / node / map) |
| **Statement function** (`procedures_defnoreturn`) | `controls_if`, XML/schema stacks, Go snippets | No — statement Blockly is outside the expression AST | Snippet / XML fragment / “did this stack emit?” |

v1 of the harness should be **value functions**. Statement / narrative functions wait until Go template / Handlebars codegen can evaluate a named stack in isolation (lung-MDT Note helpers are the motivator).

---

## Decision tables as tests (yes, with a distinct kind)

Classic **decision-table testing**: each **row** is one case.

| sex | laterality | expected |
|-----|------------|----------|
| male | left | `"left"` |
| female | left | `"left"` |
| — | right | `"right"` |
| — | — | `""` |

That is the same visual as [decision-tables-for-mapping.md](decision-tables-for-mapping.md), but:

| | Mapping decision table | Function **test** table |
|--|------------------------|-------------------------|
| When it runs | Convert time, as mapping logic | Only when the harness runs |
| Output columns | Values / snippets **produced** by the mapping | **Expected** results (oracle) |
| Hit policy | FIRST / UNIQUE / COLLECT *selects* a result | UNIQUE: one expected per input combo; extra rows = extra cases, not competing rules |
| Don't-care | Skip a condition in the rule | “This input is irrelevant for this case” |
| Completeness | “Every combo has a rule” (balanced table) | “Every combo has a test” — or a sampled subset + PBT for the rest |
| Failure | Wrong instance | Row red: actual ≠ expected (plus diff) |

**Do not** use one grid as both rule and test. A mapping decision table can *generate* a first test table (one case per rule, plus completeness holes as failing placeholders). After that they diverge: the informatician edits tests without changing convert-time behaviour.

Reuse the Sheets tab / jspreadsheet widget ([spreadsheet-matrix-libraries.md](spreadsheet-matrix-libraries.md)). Persist `kind: function-test` (or a Project Bundle `functionTests[]` list) so CONTEXT.md can keep **Sheet** (data), **Decision table** (rules), and **Function test table** (oracles) apart.

COLLECT mapping tables (narrative fragments) need a matching test style: expected **list** or **joined string**, not a single UNIQUE cell. FIRST/UNIQUE value functions are the first slice.

---

## Recommended product shape

### 0. Prerequisite — see-through calls (almost a bugfix)

Until this lands, **Extract to function** is unsafe for any slot that Test Run must fill.

Two emission strategies (same split as mapping decision tables):

| Strategy | Idea | Best when |
|----------|------|-----------|
| **A. Inline at derive-time** | `blockToExpression` on a call substitutes the def body; args become `var("p")` bindings or substituted literals. Mapping Model stays a closed expression AST. No new builtin. | v1 value functions, all current adapters. |
| **B. `call("name", …)` builtin** | Extend `ExprAst` with a user-call name **other than** `function`. Test Run / codegen resolve against a **function index** derived from Blockly defs. | Isolated harness (must run the named body); mutual recursion; wanting the Generated Export to contain real helpers. |

**Recommended:** A so extract stops breaking Test Run, **plus** a derived **function index** (name, params, body AST) so B and the harness can land next without another Blockly walk. Do not teach informaticians a fifth expression dialect; `call` is compiler output, like `maps_get`.

Inlining must substitute **parameters**, not only copy the body. Until extract infers params, inlining is “paste the same `source_query` tree” — Test Run matches pre-extract, but the harness still cannot inject fake inputs.

### 1. Function index (deep module)

Derive from Blockly JSON, parallel to Mapping Model `slots[]`:

```text
functions[]:
  name, kind: return | statement,
  params: [{ name, /* optional type */ }],
  body: Mapping Expression AST  // return functions
  // statement functions: deferred (Blockly stack id / codegen handle)
```

Public interface (stable): **list functions**, **evaluate function (name, args, SourceContext overlay) → value**. Test Run, harness, Agent API, and codegen all sit behind that. Do not have the UI walk `procedures_defreturn` itself.

### 2. Isolated evaluator

Evaluate the body AST with:

- `var(param)` bound to harness args (same `var` as `for_each_source`).
- Optional overlay: stub **Defaults Map** keys, named **Sheets**, or a **synthetic source** document so leftover `xpath*` in the body still resolve.
- **No** Target instance format render, **no** OPT **Output validation** (unless the return type is a whole instance — out of scope).

This is the test harness runtime. Mapping preview keeps using slot expressions (inlined or `call`).

### 3. Function Test Harness UI

- Entry: context menu on a **Blockly Function** def (“Test function…”), and/or a **Tests** tab next to Sheets.
- Selecting a def focuses its test table (same pattern as focusing a Sheet from a `sheet` block).
- Columns: one per param + `expected` (+ optional `notes`, `enabled`).
- **Run tests** executes the isolated evaluator per row; green/red; show actual vs expected.
- Persist in the **Project Bundle** (tests are part of the mapping project, like Sheets). Not session-only.
- Autoplay: optional, debounce like Test Run — cheap if only the selected function runs.

### 4. Parameterize extract (so tests can exist)

Upgrade **Extract to function**:

1. Move subtree (today).
2. Offer to **promote free inputs** to arguments: `source_query` leaves, `maps_get` keys, `variables_get`, maybe a selected inner mouth.
3. Call site wires the original blocks into `ARG0`… (stock Blockly call mutator).

Without (2)–(3), the harness degenerates to “run this closure against the Active Example” — better than nothing, still not unit tests.

Do not auto-promote the entire **Defaults Map** or the whole source document as a single blob param unless the informatician chooses that. Prefer explicit scalar/node args.

### 5. Other testability (not only functions)

Worth doing even if function tables slip:

| Improvement | Why |
|-------------|-----|
| **Slot inspector** | Click a Target value slot → show evaluated Mapping Expression for the Active Example (the `evaluateSlotValues` map already exists; it is not a first-class UI). Faster than scanning COMPOSITION JSON. |
| **All-examples Test Run** | Run every **Example Instance** tab, not only Active Example; table of pass/fail. Integration grain. |
| **Expected instance / expected text** on Example Sets | ROADMAP Handlebars gold files; lung-MDT PROD Notes. Repo and in-app. |
| **Snippet tests** for `text_code` / Handlebars / Go fragments | Same harness grain as statement functions; gold string, whitespace-normalized. |
| **Coverage** | Which slots / functions have ≥1 case; yellow **Constraint warning** family for “extracted but untested”. |
| **Agent API** | `run_function_test` / `run_slot` for mapping agents (today they only `run_test`). |
| **PBT overlay** | Generate extra source documents (formal-verification R1) and assert function cases still hold, or assert mapping-decision-table UNIQUE. Tables = specified points; PBT = the gaps. |

---

## User stories

1. As an informatician, I want Extract to function to leave Test Run unchanged, so refactoring reuse does not unmap slots.
2. As an informatician, I want to right-click a helper and run it on typed inputs, so I do not need a full Example Instance for every edge case.
3. As an informatician, I want a spreadsheet of input combinations and expected outputs, so reviewers can see laterality × sex × missing without reading nested `if`s.
4. As an informatician, I want don't-care cells in that sheet, so I do not duplicate rows when an input is irrelevant.
5. As an informatician, I want a “show missing combinations” action for enum/boolean params, so I know which cases I have not specified.
6. As an informatician, I want extract to offer parameters, so the helper is not secretly tied to one Source Path.
7. As an informatician, I want failing rows to show actual vs expected, so I can fix the body or the oracle.
8. As an informatician, I want function tests saved in the Project Bundle, so they travel with the mapping.
9. As an informatician, I want to generate a first test table from a mapping decision table, so rule completeness becomes test completeness without copying by hand.
10. As an informatician, I want to test a Note snippet helper (COLLECT / join) against expected strings, so lung-MDT-style narrative can be pinned without a full casenote Test Run.
11. As an informatician, I want to run all Example Instances at once, so I learn I broke another tab without switching Active Example.
12. As an informatician, I want a slot’s current value shown on the canvas or Spec row, so I can debug one Target value slot.
13. As a mapping agent, I want to execute one function or one slot via the Agent API, so I can verify a suggestion without a full instance render.
14. As a reviewer, I want repo tests to load `functionTests` from an Example Set, so CI fails when a helper’s oracle drifts.
15. As an informatician, I want UNIQUE warnings when two test rows claim different expected values for the same inputs, so the oracle is not contradictory.

---

## Implementation decisions (when scheduled)

- **Canonical store** remains Blockly JSON. Function tests are project data (like Sheets), not a second Mapping Specification.
- **Function index** is derived, like Mapping Model — persist only if we need stable ids across Blockly def renames; prefer derive-on-change + test tables keyed by function **name** (Blockly `findLegalName` already uniquifies).
- **See-through:** implement inline (A) for Mapping Model slots in v1; keep a function index so isolated eval does not re-parse Blockly differently from Test Run.
- **`call` builtin** later; never `function(` (forbidden in expression validation).
- **Harness UI** lives with Sheets (grid) + Functions drawer (which def is under test). No new flowchart canvas.
- **Value functions first.** Statement functions and Go/Handlebars snippet tests share the table oracle but need a different executor (codegen walk / template partial).
- **Don't-care** in test tables is a missing / `*` cell, same glyph as mapping decision tables, interpreted as “any value” when matching completeness, not as a runtime skip.
- **Equality** for expected cells: JSON-strict for numbers/bools; string compare with optional whitespace-normalize for snippets (same bar as lung-MDT sibling Example Set in the decision-table doc).
- Adapters (TypeScript first, then XQuery flatten, Go template helper-or-flatten) must see the same function index so ADR 0003 preview vs script does not fork.

### Modules to build or deepen

| Module | Interface (stable) | Internals (may churn) |
|--------|--------------------|------------------------|
| Function index | `functionsFromWorkspace` / `functionsFromBlocklyState` | Procedure block walk, param mutator, body `blockToExpression` |
| Call serialization | `blockToExpression` sees `procedures_callreturn` | Inline vs `call` |
| Function evaluator | `evaluateFunction(index, name, args, ctx) → value` | `evalAst` + `var` overlay; stub maps/sheets |
| Function test store | Load/save named tables; run → row results | jspreadsheet view; Project Bundle field |
| Extract | Existing `extractBlockToFunction`; param promotion | ARG mutator, undo group (already grouped) |

Tests: function evaluator through the public `evaluateFunction` (behaviour), not Blockly ids. Prior art: `test/extract_function_test.ts` (structure only), `test/codegen_test.ts` + `runTest` (whole mapping), `src/core/test_runner/mod.ts`.

---

## Incremental slices (do not ship all at once)

1. **See-through value calls** — extract no longer unmaps slots. Tests: Dummy vitals path, extract a `source_query`, Test Run still fills the slot.
2. **Function index + `evaluateFunction`** — headless tests with literals; no UI.
3. **Harness UI** — table for one return function; persist; green/red.
4. **Parameterize extract** — ARG mouths + call-site wiring.
5. **Completeness / don't-care** for enum-like params; UNIQUE oracle warning.
6. **Generate tests from a mapping decision table** (after that construct exists).
7. **All-examples Test Run** + Example Set expected output (integration grain; can proceed in parallel with 3–6).
8. **Slot inspector**.
9. **Statement / snippet harness** for Go template and Handlebars helpers.
10. **Agent API** + CI loader for `functionTests`.
11. Optional **PBT** using table rows as seeds (ties to formal-verification R1).

---

## Out of scope

- Implementing mapping decision tables themselves (see that doc).
- openEHR Decision Language / GDL2 / DMN FEEL as the test language.
- Replacing **Test Run** or **Output validation**.
- Proving helpers with Dafny/SMT (formal-verification later phases).
- Testing Conversion script text as the source of truth (Blockly JSON stays canonical).
- Auto-extracting every repeated subtree; extract stays a user (or later agent) action.
- Blockly’s JS generator as Mapping preview (would bypass Mapping Model and ADR 0003).

---

## Relation to other future docs

| Doc | Overlap |
|-----|---------|
| [decision-tables-for-mapping.md](decision-tables-for-mapping.md) | Same grid widget and completeness idea; **kind** differs (rules vs oracles). Rule tables can seed test tables. |
| [spreadsheet-matrix-libraries.md](spreadsheet-matrix-libraries.md) | jspreadsheet-ce stays the view; test tables are metadata + eval, not a new grid library. |
| [formal-verification-export.md](formal-verification-export.md) | Function cases are specified points; PBT/contracts cover unspecified inputs. Do not wait on a mapping-contract DSL to ship slice 1–3. |
| [text-first-mapping-editor.md](text-first-mapping-editor.md) | A Spec widget could mark a `procedures_call*` row; tests still live in the grid, not in JSON typing. |

---

## Open product questions

Not blocking slice 1:

- Persist tests as Sheet-like documents vs a dedicated `functionTests` array in the Project Bundle? **Recommend** dedicated array keyed by function name so Sheets stay convert-time data (ADR 0005).
- Should expected columns support Mapping Expressions (`concat(...)`) or only literals? **Recommend** literals in v1; expressions blur oracle and logic.
- Type of params: infer from connected ARG blocks vs a dropdown (string/number/boolean/node)? **Recommend** infer from the original extract, editable later.
- Run harness against Mapping preview interpreter only, or also against Generated TypeScript (ADR 0003 dual oracle)? **Recommend** preview first; optional “also TS” later to catch adapter drift.
