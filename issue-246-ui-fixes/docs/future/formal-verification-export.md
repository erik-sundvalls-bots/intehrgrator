# Formal verification export

**Status:** Proposal — investigation captured 2026-09-05; **revised 2026-09-15**
after confirming Microsoft **Z3** ships as a **WASM** package (`z3-solver`) that
the web app can load. No verification codegen or UI yet. **Verifiable Mapping
Subset (VMS)** profile landed in PR #58 (closed
[#35](https://github.com/regionstockholm/intehrgrator/issues/35) /
[#37](https://github.com/regionstockholm/intehrgrator/issues/37)); preview vs
TypeScript golden oracles landed with
[#38](https://github.com/regionstockholm/intehrgrator/issues/38). **VMS-Hbs**,
**VMS-Go**, and **VMS-Mustache** dialects landed in
[ADR 0009](../adr/0009-verifiable-template-dialects.md) (closed
[#40](https://github.com/regionstockholm/intehrgrator/issues/40)). Interactive Z3,
including those in-dialect snippets, evidence-pack export, chunk-level test
suites, and convert-time throws are
[#41](https://github.com/regionstockholm/intehrgrator/issues/41).

## Idea

Add **in-app verification** and a **verification-oriented export** alongside
executable Conversion script languages (TypeScript, Java, Handlebars, XQuery, Go
template). The primary purpose is **checking mapping correctness** beyond
example-based Test Run — interactively while the informatician authors, and as
packaged evidence afterwards.

intEHRgrator already validates openEHR output against the loaded OPT on concrete
instances (`TemplateValidator`) and warns on unmapped mandatory slots. That is
**example-based testing**, not proof over all valid inputs. Verification should:

1. **Generate** pre/post conditions and invariants from the Mapping Model
   (authors do not write SMT-LIB or Dafny by hand).
2. **Check them in the web app** with **Z3 compiled to WASM**, so Verify
   mapping is an authoring action, not a CI-only afterthought.
3. **Show counterexamples** (loadable as an Example Instance) and **highlight
   unread Source Schema** nodes when a mapping misses legal source.
4. **Export** the same Z3 queries plus solver results as a **Verification
   evidence pack** usable in MDR/IVDR technical files.
5. **Emit a test suite** in the chosen Conversion script language that exercises
   **chunks** (decision tables, Blockly Functions, loops), not only whole
   `convert` input/output pairs.
6. Treat **convert-time throws** as a first-class **Rejected** outcome (a Throw
   block, plus Decision table error rows / catch-all throws) so illegal source is
   documented rejection, not a crash.
7. **Include in-dialect template snippets** (**VMS-Hbs**, **VMS-Go**,
   **VMS-Mustache**) in the same SMT and coverage pass — they are VMS
   ([ADR 0009](../adr/0009-verifiable-template-dialects.md)), not `trust: author`
   hatches. Only *out-of-dialect* Handlebars/Go stays unverified.

## Project context

| Piece | Role |
|-------|------|
| Blockly workspace JSON | Canonical Mapping Specification |
| Mapping Model (`slots[]`, `loops[]` grain/`kind`, `targetSignature`, `unsupported`) | Derived semantic index for codegen, Test Run, validation, AI import |
| Mapping expressions | Sandboxed AST: `xpath*`, `trim`, `concat`, `if`, `switch`, `maps_get`, sheet accessors, `for_each_source`; planned `error(message)` |
| Template dialects | **VMS-Hbs** (`text_handlebars`, `text_code` LANG=handlebars), **VMS-Go** (`text_code` LANG=go-template), **VMS-Mustache** (Decision table snippet cells). Closed helper/FuncMap; convert fails closed. See ADR 0009. |
| Source formats | JSON, XML, openEHR (via `fontoxpath` / Source Format Handler) |
| Target instance formats | openEHR template (OPT), JSON Schema, XML Schema, free-form |
| Output validation | `ehrtslib` `TemplateValidator` when target is `openehr-template` |

See [MAPPING_SPECIFICATION.md](../MAPPING_SPECIFICATION.md), [CONTEXT.md](../../CONTEXT.md),
and [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md).

## What “correctness” could mean

Layers worth supporting (not all need day-one proof). In an **integration**
setting, “the mapping is correct” is rarely a single clinical theorem; it is a
stack of **machine-checkable relations** between source schema, convert-time
environment (Defaults Map, Sheets), mapping, and target schema/template.

1. **Syntactic / schema correctness** — output conforms to target schema/template
   (`TemplateValidator`, JSON Schema, XSD).
2. **Structural correspondence** — source path *P* maps to target slot *S* under
   relation *R* (units, codes, cardinality).
3. **Completeness** — required target slots populated whenever the source
   actually has the corresponding data (and the mapping claims that path).
4. **Semantic preservation** — no invented clinical meaning; terminologies and
   units respected.
5. **Pipeline / grain properties** — loops do not duplicate or drop rows;
   repeated-container grain is consistent.
6. **Round-trip** — forward ∘ inverse ≈ identity when an inverse mapping exists
   (interop scenarios).
7. **Robustness / definedness (crash-freedom)** — see below.
8. **Metamorphic / sensitivity** — see below.

Full machine-checked proofs of (4)–(6) are hard in healthcare because source
schemas are often partial and semantics under-specified. A practical goal is
**strong falsification** (counterexamples) plus **contract documentation**, with
optional proof slices for safety-critical mappings. Layers **(7)** and **(8)**
are especially fitting for integration pipelines: they do not require a full
clinical gold standard, yet they catch mappings that “work on the three demo
files” and then explode or silently lie in production.

### Robustness: no valid source should break the mapping

Informally: *if the input is a legal source record, conversion must finish and
must not emit garbage that looks like a target instance.*

More formally, fix a source schema \(S\), convert-time environment \(E\)
(Defaults Map + static Sheets), mapping \(m\), and target schema/template \(T\).
For every source \(s \in S\):

| Outcome | Meaning | Verdict |
|---------|---------|---------|
| **Defined + valid** | \(m(s, E)\) terminates and \(m(s, E) \in T\) | Success |
| **Defined + incomplete** | Terminates; optional slots omitted; still in \(T\) (optionals allowed) | Success if those slots were optional |
| **Rejected** | \(s \notin S\), \(E\) fails its precondition, or the mapping **explicitly** throws (`error(…)` / Decision table error row) | Not a mapping bug — document the precondition |
| **Erroneous** | \(s \in S\) but convert **throws unexpectedly**, **hangs**, or returns a value **not in** \(T\) (half-built RM, wrong types, failed deserialize) | Mapping bug |

“Erroneous” includes: uncaught XPath errors, `undefined` leaking from unhandled
Blockly types, division by zero, template engines throwing on missing helpers,
a Decision table that **returns `null`** on no match (today’s FIRST/UNIQUE
behaviour — silent hole), and producing JSON that the OPT validator then rejects
when the source was schema-valid. An authored **Throw block** or Decision table
**error row** is **Rejected**, not Erroneous: Z3 should prove which source values
hit that path, and the evidence pack should list those preconditions.

This is **totality of convert on \(S\)** plus **soundness of output wrt \(T\)**.
It is *not* “every optional clinical field is filled.” Empty optional slots are
fine; **crash** and **invalid structure** are not.

Testable today (PBT / generators from Source Schema):

- generate many \(s \in S\); assert convert does not throw;
- assert output passes `TemplateValidator` / JSON Schema / XSD;
- treat timeouts and `undefined` slots on **mandatory** paths as failures.

### Metamorphic / sensitivity: variation in input vs variation in output

Informally: *changing the source in a way the mapping cares about should change
the corresponding output; changing things the mapping ignores should not; adding
another repeating item should add another target child.*

This is **metamorphic testing**: relations between *pairs* of runs, without a
full expected COMPOSITION for every input. Useful relations for mappings:

| Relation | Typical check |
|----------|----------------|
| **Independence of unread fields** | Mutate JSON/XML nodes that no `source_query` **and no in-dialect template path** reads → output unchanged (up to allowed metadata). Catches accidental whole-document coupling; VMS-Hbs/VMS-Go path sets make this checkable. |
| **Sensitivity of mapped fields** | Change a source value that a slot’s expression reads → that slot’s value changes, *unless* the mapping’s `if`/`switch` puts both values in the same equivalence class (then document the class). Catches dead mappings and always-constant slots. |
| **Normalization invariance** | Extra whitespace, JSON key order, equivalent XML prefixes, Unicode NFC vs NFD on strings the mapping `trim`s → clinical values unchanged. |
| **Loop grain / monotonicity** | Add one node to a `for_each_source` collection → target repeating container grows by one (no fan-trap / chasm-trap). Delete the last node → count decreases. |
| **Determinism** | Same \((s, E)\) twice → identical output. Forbids `math_random_*` and hidden convert-time mutation (sheet mutators). |

“Reasonable variation” is **not** mathematical continuity (coded values are
discrete). It is: *the mapping’s declared dataflow explains the output delta.*
If systolic goes 120 → 130, `DV_QUANTITY.magnitude` should follow; territory
should not flip; an unread `comment` field should not rewrite `COMPOSITION.uid`.

Function-level decision tables ([function-test-harnesses.md](function-test-harnesses.md))
are the **specified points** on this surface; PBT plus metamorphic relations
fill the gaps between those points.

## Candidate formalisms (ranked)

### Tier 1 — Best practical fit

| Formalism | Fit | Verification style |
|-----------|-----|-------------------|
| **Z3 (WASM)** via `z3-solver` | **High — in-app.** Microsoft Z3 ships as WASM + TypeScript bindings. Generate SMT from the Mapping Model; run in a Web Worker during authoring. | Bounded SMT: sat → counterexample; unsat → proof of the encoded property on the VMS slice |
| **Mapping Contract DSL** (custom) | High — generated from Mapping Model + source/target schemas; the human-readable twin of the SMT | Documentation + CI; Z3 consumes the same invariants |
| **Property-based testing export** (fast-check, Hypothesis, QuickCheck) | High — covers what SMT cannot bound (XPath over unbounded trees, `regexReplaceAll` sanitizers, out-of-dialect templates marked `trust: author`) | Falsification with generated sources; shrink into Example Instances |
| **Chunk-level test suite** in the chosen Conversion script language | High — same language as Generated Export; one suite per Decision table / Blockly Function / loop grain | Regression tests others run later; avoids cartesian explosion (see below) |
| **Schematron** (XML) / **JSON Schema `if/then`** (JSON) | Medium — output-side rules from mapping + constraints | Declarative validation of produced instances |

Illustrative contract shape:

```yaml
precondition: source conforms to SourceSchema
postcondition: output validates against TargetTemplate
invariants:
  - slot: vitals.blood_pressure.systolic
    from: "$.observations[?(@.code='8480-6')].value"
    ensures: "unit == 'mm[Hg]'"
  - slot: "*.language"
    from: defaults.language
```

### Tier 2 — Strong theory, higher cost

| Formalism | Notes |
|-----------|-------|
| **Dafny** | `requires` / `ensures` on generated `convert`; still Z3-backed, but a **second** codegen for critical slices (units, doses, identifiers). Not needed for the interactive web app path now that Z3 WASM is first-class. |
| **OCL / MDE postconditions** | Classic model-transformation contracts; good inspiration for Mapping Contract DSL even if OCL is not adopted literally. |
| **Rosette / CrossHair** | Alternative bounded symbolic engines. Prefer Z3 WASM so the web app, desktop app, and evidence pack share one solver. |

### Tier 3 — Weaker or heavier fit

| Formalism | Verdict |
|-----------|---------|
| XQuery static typing | Local path guarantees only; XQuery export already exists. |
| SHACL / RML | RDF pipeline; not openEHR-first today. |
| Alloy | Structural exploration for analysts; poor as primary user-facing export. |
| TLA+ / Isabelle / Coq / Lean | Hide behind generated specs only. |
| Catala | Regulatory rule fragments, not general field mapping. |
| Bidirectional lens languages | Poor fit for imperative Blockly + loops. |

## Recommendation

Do **not** add another general-purpose execution language for verification, and
do **not** wait on Dafny for the first interactive check.

Generate a **`mapping-contract`** (human-readable YAML/JSON) **and** SMT-LIB
from the Mapping Model. **Verify mapping** in the web app runs **Z3 WASM**
on that SMT. Property-based tests fill gaps Z3 cannot bound. A later Dafny
slice remains optional for nominated critical slots.

The product has six coupled slices (see [#41](https://github.com/regionstockholm/intehrgrator/issues/41)):

| Slice | What the informatician sees |
|-------|-----------------------------|
| **A. Verify mapping** | In-app Z3 check during authoring (debounced, Worker). Not a Conversion script language. |
| **B. Coverage + counterexamples** | Unread Source Schema nodes highlighted; a sat model shown as a loadable Example Instance. |
| **C. Verification evidence pack** | Downloadable bundle of SMT, Z3 version, sat/unsat, counterexamples, coverage, VMS lint — for MDR/IVDR technical files. |
| **D. Chunk-level test suite** | Generated tests in the **same Conversion script language** as Output mode, one suite per mapping chunk (including in-dialect template snippets). |
| **E. Convert-time throws** | VMS `error(message)` / Throw block, plus Decision table **error rows** and catch-all throws. |
| **F. In-dialect templates** | Lower **VMS-Hbs** / **VMS-Go** / **VMS-Mustache** into the same SMT and coverage overlay as Mapping Expressions. Out-of-dialect remains `trust: author`. |

Phased delivery:

| Phase | Deliverable |
|-------|-------------|
| **R0** | Convert-time throws: Mapping Expression `error(message)`, Blockly Throw block, Decision table error output / catch-all throw. Needed so Rejected vs Erroneous is distinguishable before Z3. |
| **R1** | Generate SMT + mapping-contract from VMS Mapping Model **including lowered VMS-Hbs / VMS-Go / VMS-Mustache**; Z3 WASM Worker; Verify mapping action; counterexample → Example Instance; Source Schema coverage overlay (template paths count as reads). |
| **R2** | Verification evidence pack export (queries + results + coverage + solver identity + dialect ASTs). |
| **R3** | Chunk-level test suite export in the chosen Conversion script language (Decision table rules, snippet interpolations, Blockly Functions, loop grain). PBT overlay for unspecified inputs and `regexReplaceAll`. |
| **R4** | Optional Dafny slice for nominated critical slots; CI replay of the evidence pack’s SMT with the same Z3 version. |

## Architecture (target)

```text
Blockly workspace JSON
        │
        ▼
Mapping Model (slots[], loops, expressions, decision tables, unsupported)
        │
        ├── VMS-Hbs / VMS-Go / VMS-Mustache  (parse + dialect AST; ADR 0009)
        │
        ├──► TypeScript / Java / Handlebars / XQuery / Go template  (execution)
        │         └──► chunk-level test suite (same Conversion script language)
        │
        ├──► Mapping Contract DSL  (human-readable invariants)
        │
        └──► SMT-LIB  (generated; authors never write it)
                    │     Mapping Expression  +  lowered dialect AST
                    ├──► Z3 WASM Worker  →  Verify mapping (in-app)
                    │         ├──► counterexample Example Instance
                    │         └──► Source Schema coverage overlay
                    └──► Verification evidence pack  (MDR/IVDR file)
```

### A. Interactive Verify mapping (Z3 WASM)

**Verify mapping** is an authoring action in the web app (and desktop app),
not an Output mode and not a Conversion script language. It compiles the VMS
slice of the Mapping Model plus Source Schema / target signature into SMT-LIB,
then runs [z3-solver](https://www.npmjs.com/package/z3-solver) (Z3 as WASM +
TypeScript bindings) in a **Web Worker**. In-dialect **VMS-Hbs** / **VMS-Go** /
**VMS-Mustache** snippets are part of that VMS slice (see F); they are lowered
from dialect AST, not skipped.

Properties to encode first (same layers as below; VMS mappings only):

1. **Definedness** — every \(s \in S\) either produces \(m(s,E) \in T\) or hits
   an authored `error(…)` (Rejected). Unexpected throw / `null` / invalid
   structure is unsat of the “safe” assertion, i.e. a mapping bug.
2. **Source coverage** — Source Schema nodes that no `source_query` /
   `for_each_source` **and no in-dialect template path** reads are **unmapped
   source**. Overlay them on the Source Schema tree (distinct from **Constraint
   warning**, which is about *target* slots).
3. **Independence / sensitivity / loop grain / determinism** — as in the
   metamorphic table; SMT where the expression algebra **and in-dialect
   template `if`/`eq`/`each`** are bounded; PBT where XPath/collections or
   `regexReplaceAll` are not.

**Do not** expect informaticians to read SMT-LIB. The UI shows: pass/fail per
property, a prose counterexample, and “Load as Example Instance”.

WASM hosting constraints (implementation, not product language):

- `z3-solver` includes `z3-built.wasm` (~30+ MB). Lazy-load on first Verify
  mapping; keep it off the Mapping Editor critical path.
- Z3 needs `SharedArrayBuffer` → **COOP/COEP** headers. `deno task dev` and the
  desktop app can send them. GitHub Pages cannot set those headers; use a
  documented workaround (`coi-serviceworker` or equivalent) or degrade Verify
  mapping on Pages with a clear message. Do not silently no-op.
- Init is environment-specific (`z3-solver/browser` vs Node/Deno `locateFile`).
  Deno can import `npm:z3-solver`; pin the solver **version** in the evidence
  pack.
- Run Z3 off the UI thread. Time-box checks; show partial results.

### B. Source Schema overlay and counterexamples

Two complementary views of “the mapping will go wrong”:

| View | Meaning | UI |
|------|---------|----|
| **Unread source** | A Source Schema node no Mapping Expression **and no in-dialect template path** reads | Highlight on the Source Schema tree (and matching Example Instance nodes when present) |
| **Counterexample** | A concrete \(s \in S\) for which a property fails (Z3 model or PBT shrink) | Panel + **Load as Example Instance**; Test Run against it |

Coverage is **not** “every source field must map”. Optional / ignored source is
allowed if the author **marks it ignored** (or it is outside the mapping’s
claimed paths). Unmarked unread mandatory-looking source is a warning; Z3 can
still use those fields to build counterexamples that sneak past incomplete
`if`/`switch` / Decision tables.

When Z3 returns `sat`, pretty-print the model as JSON or XML matching the Source
Format Handler so the informatician can Run Test on that instance immediately.

### C. Verification evidence pack (MDR / IVDR)

MDR (EU 2017/745) and IVDR (EU 2017/746) technical documentation expects
**recorded verification** of software that contributes to a medical device or
in-vitro diagnostic. intEHRgrator does **not** claim CE marking. It should
**emit an evidence artefact** others can file:

Suggested pack (zip or a folder next to the Project Bundle — not stored *inside*
the `.intehrgrator` by default, same policy as Generated Export):

- Project identity (template id, Source Schema hash, Mapping Model hash, VMS
  lint)
- Generated mapping-contract + SMT-LIB (including lowered VMS-Hbs / VMS-Go / VMS-Mustache)
- Dialect ASTs + lint (in-dialect vs `trust: author` out-of-dialect)
- Solver identity (`z3-solver` / Z3 version, WASM hash)
- Per-property results (`unsat` / `sat` + model / timeout / skipped hatch)
- Counterexample instances
- Source coverage report (mapped / ignored / unread)
- Chunk-level test suite files (slice D) and how they were generated

Replay: `deno test` or a small CLI should re-run the SMT with the pinned Z3 so
a QMS pipeline can reproduce the same verdict.

### D. Chunk-level test suite (same Conversion script language)

Whole-`convert` cartesian products explode and hide which rule broke. Generate
tests that exercise **reasonably large chunks** of the Conversion Script,
individually:

| Chunk | Tests | How to keep the suite small |
|-------|--------|------------------------------|
| **Decision table** | One case per **collapsed** rule (don’t-care merge), plus explicit error rows | Completeness of the *table*, not of the whole source document. See [Autonoma: decision table testing](https://getautonoma.com/blog/decision-table-testing) (12 rules → 8 by collapsing don’t-cares; each remaining rule is one parameterised test). |
| **VMS-Mustache snippet cell** | Bound names → interpolated string (gold or substring assertions) | One case per collapsed Decision table row that emits that snippet. Do not put `#if` inside the cell. |
| **VMS-Hbs / VMS-Go snippet** | Finite `#if`/`if` branch or interpolating pipeline | Treat each remaining branch after don’t-care collapse as one test; `regexReplaceAll` gold strings, not SMT of the regex. |
| **Blockly Function** | Named inputs → expected return | [function-test-harnesses.md](function-test-harnesses.md); a mapping Decision table can *seed* a function-test table, then they diverge. |
| **Source iteration** | Add/remove one node in the `for_each_source` collection | Grain property; not a product of every inner field. |
| **Whole convert** | A handful of Example Instances + Z3/PBT counterexamples as fixtures | Integration only; not the default generated suite. |

Emit the suite in the **Conversion script language currently selected in Output
mode** (TypeScript, Java, …) so downstream teams run it with their usual
toolchain. Java stays compile-only in the web app (ADR 0003); the suite is
still generated for others to run.

Do **not** emit one test per cell of the full input domain.

### E. Convert-time throws (Rejected, not a crash)

Without an authored reject, convert either **returns `null` / `undefined`**
(Decision table no-match today) or **throws from the runtime** (UNIQUE overlap,
XPath, missing helper). Verification cannot tell “illegal source, as designed”
from “mapping bug”.

Add first-class throws that codegen must honour in every Conversion script
language and in Mapping preview:

1. **Throw block** — a VMS-allowed Blockly block that compiles to Mapping
   Expression `error(message)` (name **`error`**, not `throw`/`function`, so
   `validateExpressionSource` stays clean). Prefer an **expression** builtin
   used in `if`/`switch` branches and Target value slots over a statement
   `controls_flow_statements`-style throw (those were removed from the toolbox).
   Statement-shaped throw is acceptable only if it is a dedicated intEHRgrator
   block, not stock Blockly.
2. **Decision table error rows** — an output kind **error** (message string) or
   a row-level **throw** flag. A condition row can throw on a specific illegal
   combination (e.g. unknown code). A **catch-all** row can throw instead of
   emitting a default value (“anything else is illegal source”). UNIQUE overlap
   remains a mapping bug (already throws). FIRST/UNIQUE **no match** should
   become an authored reject (catch-all throw) rather than `null`; until authors
   add that row, Verify mapping flags the hole.

Generated TypeScript already throws on UNIQUE overlap
(`src/core/codegen/typescript.ts`). Extend the same helper for error rows.
XQuery already has `error(` in generated helpers — reuse that for `error(…)`.

### F. In-dialect template snippets (VMS-Hbs / VMS-Go / VMS-Mustache)

[ADR 0009](../adr/0009-verifiable-template-dialects.md) already **restricted**
Handlebars and Go `text/template` to closed dialects. Convert fails closed
(`knownHelpersOnly`; Go FuncMap + parse). That is the reason they belong on the
verification track instead of `trust: author`.

| Dialect | Where it lives | Lower into SMT as |
|---------|----------------|-------------------|
| **VMS-Mustache** | Decision table snippet cells | `concat` of literals + bound names; `{{#list}}` → grain; `{{^empty}}` → `if` |
| **VMS-Hbs** | `text_handlebars`, `text_code` LANG=`handlebars` | `#if`/`#unless`/`else`/`eq`/`and`/`or` → Mapping Expression `if`/`eq`/`and`; `#each` → `for_each_*`; `{{path}}` / `slot` → source reads |
| **VMS-Go** | `text_code` LANG=`go-template` | `if`/`else`/`eq`/`index` → same algebra; bounded `range` → grain; `index .Data "lit"` / `.Parameters.K` → source / Defaults Map reads; acyclic `define`/`template` **inline** (same strategy as Blockly Function inlining) |

Reuse the existing dialect parsers (Handlebars AST walk; Go WASM `text/template.Parse`)
already used by lint ([#40](https://github.com/regionstockholm/intehrgrator/issues/40)).
Do **not** treat the script string as an opaque `string × context → string`.

What Z3 should prove on in-dialect snippets:

1. **Coverage** — every literal path in the dialect AST is a mapped Source Schema
   (or Defaults Map / snippet local) read. Unread source is the same overlay as
   for `source_query`.
2. **Definedness** — every branch either interpolates or is empty by design;
   unknown helpers cannot occur in-dialect (already a convert error). Nested
   `#if` / `{{if}}` trees are **finite** and must be encoded, even though they
   are a poor *authoring* surface (prefer Decision tables).
3. **Independence / sensitivity** — fields not in the path set do not change
   snippet output; interpolated fields do (unless an `eq` class says otherwise).
4. **Grain** — `#each` / `range` follow the same add-one-node rule as
   `for_each_source`.

What stays out of SMT (PBT / gold strings, still in the evidence pack):

- `regexReplaceAll` / character-class sanitizers (`cleanAndQuoteFreeTextInput`)
- Clinical *meaning* of narrative prose
- **Out-of-dialect** Handlebars/Go (`lookup`, `#with`, `call`, Sprig, …) —
  `trust: author` hatch, skipped or marked, never silently treated as VMS

Canvas `text_handlebars` is the VMS-Hbs specification
(`ProjectBundle.mapping.blocklyState`). Verify mapping must walk it with
the same VMS-Hbs lowering, not only Blockly slots.

## Anti-patterns

- Treating Schematron or JSON Schema assertions alone as “proof” — they validate output, not mapping logic for all inputs.
- Expecting informaticians to write Dafny or SMT by hand — specs must be **generated** from Blockly.
- Replacing example-based Test Run — verification **complements** Active Example testing.
- Treating Dafny as a prerequisite for in-app checks — Z3 WASM is enough for the interactive slice.
- Treating **in-dialect** VMS-Hbs / VMS-Go / VMS-Mustache as `trust: author`
  hatches — those dialects exist so SMT and coverage can see their path sets
  and `if`/`eq` trees. Only *out-of-dialect* templates skip proof.
- Generating a cartesian **whole-convert** test matrix as the default suite — explode on source fields; emit **chunk** tests (collapsed Decision table rules, functions, grain).
- Leaving Decision table no-match as `null` while calling convert crash-free — that is a silent hole, not Rejected.
- Shipping Verify mapping that **silently no-ops** on GitHub Pages because COOP/COEP is missing.

## Blockly and product features that hinder declarative export / verification

Investigation 2026-09-08 against the current Blockly surface, Mapping Model
extractor (`workspaceToModelJson`), and codegen adapters (`xquery.ts`,
`typescript_codegen.ts`, `go_template.ts`).

### Summary

| Category | Effect on XQuery / declarative export | Effect on formal verification |
|----------|--------------------------------------|------------------------------|
| **Canvas vs Mapping Model gap** | Medium — Mapping Model has `loops[]` / `targetSignature`; XQuery loop emit landed with [#39](https://github.com/regionstockholm/intehrgrator/issues/39) | Low–medium — preview vs TypeScript golden oracles landed ([#38](https://github.com/regionstockholm/intehrgrator/issues/38)); SMT still needs the same IR |
| **Template dialects (ADR 0009)** | Medium — XQuery still stubs some `handlebars()` literals; in-dialect AST is available from lint | **Positive** for VMS-Hbs / VMS-Go / VMS-Mustache (lower to SMT). High only for *out-of-dialect* leftovers |
| **Sheet mutators** | **Removed** from toolbox (VMS); not in Mapping Model expressions | High if re-enabled — imperative convert-time state |
| **Stock imperative Blockly** | **Removed** from toolbox (VMS) | High if re-enabled — unbounded / non-deterministic / stateful |
| **Dynamic source paths** | Medium — literal paths compile; dynamic paths need runtime helpers | Medium — symbolic XPath over JSON/XML is hard to bound |
| **Optional RM / schema mutators** | Low–medium — structure is partly in `optionalRm[]` | Medium — attachment graph must be part of the contract |
| **Finite enumerations (`term_pick`)** | Low — easy to emit | **Positive** — ideal for DL-style value constraints |

### 1. Canvas semantics wider than the Mapping Model

The Mapping Model is rebuilt from Blockly JSON as `slots[]`, `loops[]` (with
grain/`kind`), nested `targetSignature`, `optionalRm[]`, and `unsupported[]`
(`workspaceToModelJson` in `src/blockly/mapping_ir.ts`). Some canvas features
still exist only in the full Blockly walk:

| Feature | In Mapping Model? | Codegen today |
|---------|-------------------|---------------|
| Value-slot expressions (`source_query`, `maps_get`, …) | Yes (`slots[].expression`) | All adapters |
| `for_each_source` | Yes (`loops[]`) | TypeScript canvas; **not** XQuery slots export |
| RM / schema tree shape | Partially (`optionalRm[]`, block types on canvas) | TypeScript canvas; XQuery Model B slot manifest only |
| `lists_getIndex`, `lists_create_with` | **No** | TypeScript canvas only (`emitListsGetIndex`) |
| Sheet **mutator** statements | **No** (removed from toolbox) | Blockly JS generator stubs only |
| Stock `controls_whileUntil`, `controls_repeat_ext`, `controls_forEach` | **No** | Toolbox only; TS codegen → `undefined` |
| `controls_if` | **No** | Go template JSON walk only |

**Why it hurts:** Declarative exports and verifiers want a **closed, compositional
IR**. Today the “truth” for Test Run is the preview interpreter over slots; for
TypeScript Output mode it is the Blockly canvas walk; for XQuery it is yet
another subset. [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md)
already flags this seam.

**Implemented (PR #58):** VMS profile in `src/blockly/vms.ts` — hostile stock
Blockly and sheet mutators removed from the toolbox; Mapping Model IR extended
with `loops[]`, `targetSignature`, and `unsupported[]`.

**Follow-ups:**

1. Preview vs TypeScript golden oracles on VMS mappings
   ([#38](https://github.com/regionstockholm/intehrgrator/issues/38) — closed).
   Replay Z3 counterexamples on both oracles.
2. Declarative exports (XQuery, mapping-contract, SMT emit) consume the Mapping
   Model IR, not ad-hoc canvas walks ([#39](https://github.com/regionstockholm/intehrgrator/issues/39) — closed for XQuery loops).
3. Lint the workspace and warn on VMS escape hatches before contract / SMT export
   ([#40](https://github.com/regionstockholm/intehrgrator/issues/40) — closed).
4. In-app Z3, Source Schema coverage (including template path sets), evidence pack, chunk-level tests, convert-time throws, and **in-dialect snippet SMT** ([#41](https://github.com/regionstockholm/intehrgrator/issues/41)).

### 2. `text_handlebars` and `text_code`

**Superseded for in-dialect text** by [ADR 0009](../adr/0009-verifiable-template-dialects.md)
(closed [#40](https://github.com/regionstockholm/intehrgrator/issues/40)). Editors
accept only **VMS-Hbs** / **VMS-Go**; Decision table snippet cells are
**VMS-Mustache**. Convert fails on unknown helpers/`call`/`with`. JS/TS are gone
from the Code text LANG dropdown.

| Construct | Status for verification |
|-----------|-------------------------|
| `text_handlebars` | **In-dialect VMS-Hbs** — parse, lower `#if`/`#each`/`eq`/`slot`/paths into SMT and coverage. Not `trust: author`. |
| `text_code` LANG=`handlebars` | Same VMS-Hbs lowering. LANG is product semantics (not UI-only). |
| `text_code` LANG=`go-template` | **VMS-Go** — lower `if`/`index`/`range`/curated FuncMap; inline acyclic `define`. |
| Decision table snippet cells | **VMS-Mustache** — interpolation + sections; branching stays in the table. |
| Out-of-dialect leftovers (`lookup`, `#with`, `call`, Sprig, …) | Hatch — `trust: author`; lint already warns; skip proof obligations. |

**Why the old “opaque string” story is wrong now:** unrestricted Handlebars.js /
Sprig *would* be `string × context → string`. The closed dialects are a **fixed
term algebra** (boolean `if`/`eq`, bounded `each`/`range`, literal paths, a
small pure FuncMap). Nested `#if` remains a clumsy authoring shape — still
encode it; prefer reauthoring to Decision tables for humans, not for the solver.

**Suggestions:**

1. Verify mapping **must** consume dialect ASTs (same parsers as lint), not the
   raw script string.
2. Prefer Decision tables + VMS-Mustache cells for combinational narrative; keep
   VMS-Hbs / VMS-Go as the interpolator and for existing PROD scripts (lung-MDT,
   chemo) that already sit in-dialect.
3. Serialize `LANG` on `text_code` into the Mapping Model so SMT emit knows
   VMS-Hbs vs VMS-Go vs plain data (JSON/XML/HTML).
4. Treat `regexReplaceAll` as an uninterpreted string function in SMT; pin
   behaviour with gold strings / PBT (as the snippet investigation already
   states).
5. Only mark a slot `trust: author` when lint reports **out-of-dialect**.

### 3. Sheets: accessors vs mutators

**Accessors** (`sheet_get_*`, `sheet_lookup`) are in the Mapping Expression AST
and Test Run (`evalSheetCall`). **Mutators** (`sheet_set_*`, `sheet_insert_row`,
`sheet_delete_*`, …) mutate a convert-time `SheetBag` (`applySheetMutator`) and
are **statement blocks**, not slot expressions.

XQuery export currently stubs all sheet calls as `(: … :) ()`.

**Why it hurts:** Mutators introduce **imperative state** and order dependence.
`sheet_lookup` depends on tabular data that may be edited outside the mapping;
proving “for all sources” requires quantifying over sheet contents too.

**Implemented (VMS):** sheet mutators removed from the toolbox; read-only
`sheet_get_*` / `sheet_lookup` remain.

**Suggestions:**

1. Allow **read-only** sheet accessors with **static** sheet documents bundled
   in the Project Bundle; do not re-offer mutator blocks in the default toolbox.
2. For terminology grids: prefer `maps_create_with` / `term_pick` when the lookup
   table is small and static; reserve `sheet_lookup` for large tables with
   explicit sheet content in the contract precondition.
3. Emit sheet tables as **finite map literals** in mapping-contract export so
   provers can inline them.

### 4. Stock imperative Blockly (removed from toolbox)

VMS cut (PR #58) removed `controls_if`, `controls_whileUntil`,
`controls_repeat_ext`, `controls_for`, stock `controls_forEach`,
`controls_flow_statements`, random, `text_print`, list-index mutators, and sheet
mutators from the default toolbox (`VMS_REMOVED_BLOCK_TYPES` in
`src/blockly/vms.ts`). Types stay registered but are not offered in the default
toolbox; they are not in the IR surface. Go template codegen still partially supports some statement
blocks; TypeScript canvas codegen silently emits `undefined` for unhandled types.

**Why it mattered:** Verification tools need **bounded control flow** or pure
fold/map comprehensions. While-loops and arbitrary variable mutation are hostile
to SMT, description logics, and static XQuery typing.

**Residual guidance:**

1. Keep `for_each_source` / `for_each_list` as the sanctioned iteration primitives
   ([BLOCKLY_INTEGRATION.md](../BLOCKLY_INTEGRATION.md)).
2. Workspace lint ([#40](https://github.com/regionstockholm/intehrgrator/issues/40))
   should still flag VMS escape hatches and any re-enabled hostile types.
3. For conditional mapping, prefer `logic_ternary` / expression `if()` or
   `switch` over statement-level `controls_if`.

### 5. Dynamic and scope-dependent source paths

`source_query` stores a free-text `EXPRESSION`. Click-to-map inserts literals;
authors can edit to dynamic forms. Effects:

- **XQuery:** `compileLiteralPath` inlines `$.patient.vitals[1]`; non-literals
  fall back to `local:*-at($source, $path)` or **error** for dynamic XML paths.
- **`for_each_source`:** inner paths are **relative** to the loop node; grain of
  the output array depends on source cardinality (fan-trap / chasm-trap risk).

**Suggestions:**

1. Verification export should require **literal paths** (or a normal form
  compilable at export time) for slots in the proof obligation; dynamic paths
  remain runtime-only with a warning.
2. Record loop **grain** explicitly in `loops[]` (source collection path, target
  repeatable slot, key fields) for contract generation — aligns with grain-
  correctness literature cited above.
3. Prefer XPath over ad-hoc JSON `$.` syntax in contracts when targeting XQuery
  engines; keep fontoxpath as the Test Run reference implementation.

### 6. Optional RM and schema-field mutators

Cogwheel mutators (`optional_rm_mutator`, `schema_fields_mutator`, `dv_fields_mutator`)
add optional RM attributes or schema fields after scaffold load. Presence is
recorded in `optionalRm[]` but inner mappings are still extracted via the same
slot scan.

**Why it hurts:** For description-logic / schema reasoning, the **target shape**
must be fixed or explicitly enumerated. “Optional fields added ad hoc” expands the
output signature in ways a verifier must know.

**Suggestions:**

1. Include `optionalRm[]` (and schema optional fields) in mapping-contract
   **target signature** generation.
2. When an optional attachment is added, auto-emit a **completeness** property
   (“if source has X, optional slot Y must be populated”).

### 7. Ad-hoc `json_object` / `xml_element` vs schema-driven `target_structure`

For JSON/XML targets, generic JSON/XML drawers allow **free-form trees** alongside
schema-scaffolded `target_structure` blocks.

**Why it hurts:** Free-form trees lack a stable slot manifest for correspondence
rules; JSON-LD / SHACL / description-logic approaches want a fixed target schema.

**Suggestions:**

1. For verification track: prefer **`target_structure` / `target_value`** slots
   tied to the loaded schema; treat generic `json_object` as an escape hatch
   (out-of-dialect templates, not in-dialect VMS-Hbs/VMS-Go).
2. When Source Schema and Target Schema are both loaded, auto-generate
   **path correspondence** candidates for the contract.

### 8. Features that help verification (preserve and lean into)

| Feature | Why it helps |
|---------|--------------|
| `term_pick` / constrained `DV_CODED_TEXT` lists | Finite domains — easy to emit as DL disjointness / value-set constraints |
| `switch()` in Mapping Expression AST | Finite case split — compiles to nested `if` in XQuery and to decision tables in contracts |
| Decision table (FIRST / UNIQUE / COLLECT, catch-all) | Finite rule matrix — SMT-friendly; collapsed rules become chunk tests; error rows are Rejected |
| **VMS-Hbs / VMS-Go / VMS-Mustache** (ADR 0009) | Closed helper/FuncMap — parse to dialect AST, lower `if`/`eq`/`each`/paths into SMT; path set feeds Source Schema coverage |
| Planned `error(message)` / Throw block | Makes Rejected an encoded path instead of an unexpected runtime exception |
| `maps_get` with literal keys | Pure environment lookup — model as `defaults` map in preconditions |
| Sandboxed expression parser (`validateExpressionSource`) | Already rejects `import`, `function`, `eval` — keep verification on this AST |
| OPT / `TemplateValidator` | Strong **postcondition** oracle for openEHR targets |
| `for_each_source` (vs kintegrate context roots) | Explicit iteration boundary — can compile to `for $x in … return` in XQuery |

### Implemented VMS: Verifiable Mapping Subset

**Landed in PR #58** (closed [#35](https://github.com/regionstockholm/intehrgrator/issues/35),
[#37](https://github.com/regionstockholm/intehrgrator/issues/37)). Hostile stock
Blockly and sheet mutators were **removed from the toolbox**; Mapping Model IR
was extended beyond flat `slots[]`. Follow-ups:
preview/codegen equivalence [#38](https://github.com/regionstockholm/intehrgrator/issues/38),
XQuery loops [#39](https://github.com/regionstockholm/intehrgrator/issues/39),
VMS linter [#40](https://github.com/regionstockholm/intehrgrator/issues/40),
in-app Z3 / evidence pack / chunk tests / throws / in-dialect snippet SMT [#41](https://github.com/regionstockholm/intehrgrator/issues/41).

After that cut, treat remaining constructs as:

```text
VMS allowed (implement fully, including Mapping Model + all exporters):
  source_query_* (prefer literal paths), maps_get, sheet_get_* / sheet_lookup
  (static sheets), trim, concat, text_append, if, switch, math_arithmetic / round /
  modulo / constrain, logic_compare / operation / negate / boolean / ternary,
  term_pick, for_each_source and for_each_list (documented grain),
  lists_create_with / getIndex (read-only), target_structure / RM scaffold slots,
  variables_set / variables_get (`let` in the enclosing for_each_* grain, or mapping
  root), error(message) / Throw block, Decision table eval (including error rows),
  VMS-Mustache snippet cells, in-dialect VMS-Hbs and VMS-Go (lower to SMT)

VMS escape hatch (keep in toolbox; mark unverified):
  out-of-dialect Handlebars or Go template, ad-hoc json_object / xml_element trees,
  dynamic (non-literal) source paths, procedures_defreturn (until function
  harness lands)

VMS-Hbs / VMS-Go / VMS-Mustache:
  in-dialect per ADR 0009 — **include in Verify mapping**; not a hatch.
  Out-of-dialect leftovers stay `trust: author`.


VMS remove from toolbox (do not implement):
  controls_whileUntil, controls_repeat_ext, controls_for, stock controls_forEach,
  controls_flow_statements, controls_if (statement; keep logic_ternary),
  math_random_int / math_random_float, text_print,
  lists_setIndex, lists_repeat, sheet mutators
```

A workspace linter ([#40](https://github.com/regionstockholm/intehrgrator/issues/40))
warns on leftover Blockly hatches and on **out-of-dialect** Handlebars / Go template.
In-dialect **VMS-Hbs** / **VMS-Go** / **VMS-Mustache** is VMS
([ADR 0009](../adr/0009-verifiable-template-dialects.md),
[proposal](../proposals/verifiable-template-snippets.md)) and is **in scope**
for SMT lowering on [#41](https://github.com/regionstockholm/intehrgrator/issues/41).

## Open questions

1. **Contract language surface** — YAML vs JSON vs a dedicated `.mapping-contract` extension; alignment with [AI_SUGGESTION_FORMAT.md](../AI_SUGGESTION_FORMAT.md). SMT-LIB is generated either way.
2. **Source schema as precondition** — how strongly to require a loaded Source Schema vs inferring from examples. Verify mapping without a schema can still check internal expression definedness, but not \(s \in S\).
3. **Loop grain** — whether to adopt grain-correctness style rules for `for_each_source` (see recent data-pipeline formalization literature).
4. **Ignored source** — UI for marking Source Schema nodes as intentionally unread so the coverage overlay does not nag.
5. **Execution oracle** — Verify mapping checks the Mapping Model / generated SMT; ADR 0003 still requires preview ≡ TypeScript on VMS. Counterexamples should be replayed on both oracles.
6. **Robustness generators** — how complete must Source Schema be before PBT/Z3 can claim “no valid source crashes convert”?
7. **Sensitivity vs equivalence classes** — when `switch` or a Decision table maps many codes to one target, how to declare that class so sensitivity checks do not false-fail.
8. **GitHub Pages + SharedArrayBuffer** — `coi-serviceworker` vs “Verify mapping on desktop / local dev only” for the Pages web app.
9. **Evidence pack layout** — sidecar zip vs optional Project Bundle section; whether replay is `deno task verify` or checked-in SMT + CI.
10. **Decision table no-match** — breaking change to throw vs opt-in table flag vs Verify mapping warning until a catch-all error row exists. Recommend: warn in R0, throw only when an error row / flag is set, so existing tables keep returning `null` until authors opt in.
11. **Template SMT bound** — how deep to encode nested `#if` / `{{if}}` before
    falling back to PBT; whether to require Decision table reauthoring for
    proof of combinational narrative, or encode the tree as-is (recommend:
    encode as-is, warn when nesting exceeds a small depth).
12. **`regexReplaceAll`** — keep uninterpreted in SMT; which gold strings belong
    in the evidence pack vs generated chunk tests.

## Related

- [textual-mapping-languages.md](textual-mapping-languages.md) — authoring languages (distinct from this verification export)
- [decision-tables-for-mapping.md](decision-tables-for-mapping.md) — mapping-local rule grids (UNIQUE/COLLECT); UNIQUE rows are contract-ready invariants; error rows / catch-all throws are slice E
- [function-test-harnesses.md](function-test-harnesses.md) — unit tests of **Blockly Function**s and decision-table-shaped oracles; specified points under PBT; chunk-level suite grain
- [xquery-export-investigation.md](xquery-export-investigation.md) — declarative export precedent; documents slot-manifest limits and open loop emit
- [loop-index-length-codegen-investigation.md](loop-index-length-codegen-investigation.md) — Java / Go / Handlebars Loop index·length lowering; 0- vs 1-based (#137)
- [BLOCKLY_INTEGRATION.md](../BLOCKLY_INTEGRATION.md) — block categories and `for_each_source` policy
- [ADR 0004](../adr/0004-go-template-codegen-only.md) — Blockly canvas as source of truth vs flat Mapping Model
- [MAPPING_SPECIFICATION.md](../MAPPING_SPECIFICATION.md) — Mapping Model pipeline
- [ADR 0001](../adr/0001-mapping-and-target-seams.md) — mapping and target seams
- [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md) — preview vs generated script
- [ADR 0009](../adr/0009-verifiable-template-dialects.md) — VMS-Hbs / VMS-Go / VMS-Mustache; in-dialect snippets are VMS
- [verifiable-template-snippets.md](../proposals/verifiable-template-snippets.md) — dialect investigation; `regexReplaceAll` not SMT-proved
- [z3-solver (npm)](https://www.npmjs.com/package/z3-solver) — official JS/TS bindings; Z3 distributed as WASM
- [Autonoma: What Is Decision Table Testing?](https://getautonoma.com/blog/decision-table-testing) — collapse don’t-cares, then one parameterised test per remaining rule (comment on [#41](https://github.com/regionstockholm/intehrgrator/issues/41))

## External references

- Model transformation verification (OCL postconditions, preservation properties): [Verification of Model Transformations](https://shura.shu.ac.uk/12047/1/mtverif.pdf)
- Healthcare mapping formal specs: FHIRconnect, OMOCL (archetype path → target field)
- Verifiable declarative mappings (RML → OCaml + Gospel/Cameleer): [Towards Verifiable Declarative Mappings](https://edkamb.github.io/files/kgcw2026.pdf)
- Grain correctness in data pipelines: [Grain Theory (arXiv:2601.00995)](https://arxiv.org/abs/2601.00995)
- Metamorphic testing of transformations (relations between paired runs, no gold output per input): Chen et al., *Metamorphic Testing: A Review of Challenges and Opportunities*
- Z3 JavaScript/WASM: [z3-solver](https://www.npmjs.com/package/z3-solver); browser `SharedArrayBuffer` / COOP-COEP notes in that package README
- Decision-table test collapsing: [Autonoma](https://getautonoma.com/blog/decision-table-testing)

## Question for parallel research

> **Context:** intEHRgrator is a Deno/TypeScript visual integration workbench.
> Users author mappings in Blockly from JSON/XML/openEHR sources into openEHR
> templates, JSON Schema, XML Schema, or free-form targets. Blockly JSON is
> canonical; a derived Mapping Model drives Test Run, validation, and codegen.
> We export TypeScript, Java, Handlebars, XQuery, and Go template, and validate
> openEHR output on example instances — not over all inputs. Microsoft Z3 is
> available in-process as WASM (`z3-solver`).
>
> **Question (updated):** How should a **generated SMT encoding** of a VMS
> Mapping Model — **including lowered VMS-Hbs / VMS-Go / VMS-Mustache dialect
> ASTs** — be scoped so Z3 WASM can run interactively (seconds, not
> minutes) while still producing (a) source-coverage overlays that count
> template paths as reads, (b) concrete counterexample instances, (c) an
> MDR/IVDR-style evidence pack, and (d) a **chunk-level** test suite in the
> same Conversion script language? Compare encoding Mapping Expression
> `if`/`switch`/Decision tables vs encoding in-dialect `#if`/`eq`/`#each`
> vs treating XPath as uninterpreted vs bounding collections. Where must we
> fall back to property-based testing (`regexReplaceAll`, unbounded trees)?
> How should authored `error(…)` / Decision table error rows appear in the
> SMT (Rejected vs Erroneous)? Out-of-dialect templates stay `trust: author`.
