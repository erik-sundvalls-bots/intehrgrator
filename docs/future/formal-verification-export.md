# Formal verification export

**Status:** Proposal. No verification codegen or UI yet; tracked in
[#41](https://github.com/regionstockholm/intehrgrator/issues/41). Already in place:
the **Verifiable Mapping Subset (VMS)** profile (PR #58, closed
[#35](https://github.com/regionstockholm/intehrgrator/issues/35) /
[#37](https://github.com/regionstockholm/intehrgrator/issues/37)), preview vs
TypeScript golden oracles ([#38](https://github.com/regionstockholm/intehrgrator/issues/38)),
and the **VMS-Hbs**, **VMS-Go** and **VMS-Mustache** dialects
([ADR 0009](../adr/0009-verifiable-template-dialects.md), closed
[#40](https://github.com/regionstockholm/intehrgrator/issues/40)). #41 covers interactive
Z3 (including those in-dialect snippets), evidence-pack export, chunk-level test suites
and convert-time throws.

Verify mapping serves two purposes: **interactive feedback while the informatician
authors** and **packaged evidence afterwards**. In the first release it is
**lazy-loaded and explicitly triggered** (button / menu, deliberate save, export);
a debounced live mode, paired with the existing Test Run Auto-run, is a
[design suggestion for a future decision](#design-suggestions-future-decision-live-test--validation).
The solver is a **single-threaded Z3 WASM build**,
[z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0),
which runs in a plain Worker and needs no COOP/COEP headers, so it works on GitHub Pages
(see [Provenance and the build we use](#provenance-and-the-build-we-use)). A throwaway
[spike](#spike-z3-wasm-on-real-fixtures) on real fixture Decision tables backs the
design, and an [AI conversation (Gemini) shared on #41](#input-from-an-ai-conversation-gemini-shared-on-41)
was checked claim by claim.

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
   hatches. *Out-of-dialect* Handlebars/Go is **not accepted** in intEHRgrator
   mappings (see [Out-of-dialect templates: not accepted](#out-of-dialect-templates-not-accepted)), so no
   template text is left outside verification.

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

**Coded elements are often deliberately translated, not preserved.** Mappings
regularly swap terminology codes on purpose, e.g. a local code in the source becomes a
SNOMED CT code in the target. So for coded elements, correctness **cannot** mean value
preservation (and "semantic preservation" in (4) must not be read as "same code out as
in"). It means the code translation **follows the declared mapping**, with source and
target code systems treated as different. In intEHRgrator today that declared mapping is
a Decision table, a static Sheet (`sheet_lookup`), a `maps_get` map or `term_pick`;
convert-time lookups are the Defaults Map and static Sheets, not a live terminology
service, and FHIR ConceptMap import is deferred. For verification this implies:

- State properties **against the translation table**: for every source code, the output
  code is the one the table/map assigns (Decision table rows and finite map literals are
  already SMT-friendly; see [Sheets](#3-sheets-accessors-vs-mutators)).
- **Coverage of source codes:** report source codes (from the Source Schema's enum / value
  set, where one is declared) that no row or map entry handles, and whether they fall
  through to a catch-all, an error row (Rejected) or `null` (a silent hole).
- **Target validity:** every output code is valid in the **target** value set (e.g. the
  OPT's code list), checked against the target, not the source; the
  [spike](#what-it-checked-and-found) already proved this for one table (P2).
- **Sensitivity** checks treat many-to-one code translations as declared equivalence
  classes (open question 7), not as dead mappings.

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
| **Z3 (WASM)** | **High — in-app.** Upstream Z3 compiled to WASM: our single-threaded build ([z3-wasm-singlethread](https://github.com/regionstockholm/z3-wasm-singlethread)) in the web app; the official `z3-solver` package where the page is cross-origin isolated. Generate SMT from the Mapping Model; run in a Web Worker while authoring (on request, or debounced if the [live mode](#design-suggestions-future-decision-live-test--validation) is adopted). | Bounded SMT: sat → counterexample; unsat → proof of the encoded property on the VMS slice |
| **Mapping Contract DSL** (custom) | High — generated from Mapping Model + source/target schemas; the human-readable twin of the SMT | Documentation + CI; Z3 consumes the same invariants |
| **Property-based testing export** (fast-check, Hypothesis, QuickCheck) | High — covers what SMT cannot bound (XPath over unbounded trees, `regexReplaceAll` sanitizers) | Falsification with generated sources; shrink into Example Instances |
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
| **A. Verify mapping** | In-app Z3 check used **interactively while authoring**. First release: started by the informatician (Verify mapping button / menu item) and on deliberate save and export; a debounced live mode with a pause toggle is a [future decision](#design-suggestions-future-decision-live-test--validation). Z3 is lazy-loaded and runs off the UI thread. Not a Conversion script language. |
| **B. Coverage + counterexamples** | Unread Source Schema nodes highlighted; a sat model shown as a loadable Example Instance. |
| **C. Verification evidence pack** | Downloadable bundle of SMT, Z3 version, sat/unsat, counterexamples, coverage, VMS lint — for MDR/IVDR technical files. |
| **D. Chunk-level test suite** | Generated tests in the **same Conversion script language** as Output mode, one suite per mapping chunk (including in-dialect template snippets). |
| **E. Convert-time throws** | VMS `error(message)` / Throw block, plus Decision table **error rows** and catch-all throws. |
| **F. In-dialect templates** | Lower **VMS-Hbs** / **VMS-Go** / **VMS-Mustache** into the same SMT and coverage overlay as Mapping Expressions. Out-of-dialect templates are [not accepted](#out-of-dialect-templates-not-accepted). |

Phased delivery:

| Phase | Deliverable |
|-------|-------------|
| **R0** | Convert-time throws: Mapping Expression `error(message)`, Blockly Throw block, Decision table error output / catch-all throw. Needed so Rejected vs Erroneous is distinguishable before Z3. |
| **R1** | Start with **Decision tables**: the [spike](#spike-z3-wasm-on-real-fixtures) showed that dead-row, no-match and output-value-set checks already run in milliseconds on real fixtures. Then generate SMT + mapping-contract from VMS Mapping Model **including lowered VMS-Hbs / VMS-Go / VMS-Mustache**; Z3 WASM Worker; Verify mapping action; counterexample → Example Instance; Source Schema coverage overlay (template paths count as reads). |
| **R2** | Verification evidence pack export (queries + results + coverage + solver identity + dialect ASTs). |
| **R3** | Chunk-level test suite export in the chosen Conversion script language (Decision table rules, snippet interpolations, Blockly Functions, loop grain). **Differential test vectors:** each Z3 model (one per reachable path / Decision table row) becomes a fixture replayed on Mapping preview **and** every generated Conversion script language, so codegen divergences (empty sequence vs `null` vs `undefined`, 0- vs 1-based indexing, numeric coercion) surface without symbolic execution of TS/Java/XQuery. PBT overlay for unspecified inputs and `regexReplaceAll`. |
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
then runs Z3 compiled to WASM
([z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0))
in a **Web Worker**. In-dialect **VMS-Hbs** / **VMS-Go** /
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

#### When it runs and how Z3 is loaded

- **Lazy-loaded, never in the main bundle.** The Z3 module, its WASM and its worker
  script are fetched by a **dynamic `import()` on the first Verify mapping** of a
  session, from the **same origin** as the app (part of the Pages / desktop build, not
  a CDN). The browser HTTP cache keeps them; the PWA service worker
  (`web/sw.js`) may also cache them cache-first, the same way it treats other
  static assets. The download is a 21.9 MB WASM (6.1 MB gzipped) plus 85 KB of JS
  (v0.1.0; see [Hosting](#hosting-without-coopcoep-github-pages)).
  Users who never press Verify mapping never download it.
- **Triggers in the first release:**
  1. **Verify mapping** button / menu item, the primary way to get interactive
     feedback while authoring.
  2. **Deliberate save** (Save / Save as of the Project Bundle, not autosave or
     the desktop sync's background writes).
  3. **Export** (Generated Export, evidence pack).
  The first release does not re-run on every edit. A **debounced live mode**
  (re-check shortly after edits, with a pause toggle shared with Test Run
  Auto-run) is proposed in
  [Design suggestions (future decision)](#design-suggestions-future-decision-live-test--validation).
- **Non-blocking and cancellable.** Solving runs in a Worker. A progress indicator
  with **Cancel** is shown. Cancel terminates the Worker (the pending check rejects at
  once as cancelled) and starts a fresh one, which was ready again in 18–23 ms in
  Chromium with v0.1.0. A per-query `:timeout` resolves `unknown` instead.
  Save and export **do not wait** for Verify mapping. They start it in the background
  and complete normally.
- **Results are findings.** They appear in the same findings / Constraint warning
  surface as other validation, marked with the Mapping Model hash they were computed
  for. Editing the mapping marks them **stale**; in the first release it does not
  re-run them (the proposed live mode would).
- **Export proceeds with a warning, not a block** (failing or stale verification is
  listed in the export summary and the evidence pack). Whether some projects should
  be able to **require** a passing verification before export is open question 18.

WASM hosting constraints (implementation, not product language; measured with
[z3-wasm-singlethread v0.1.0](#provenance-and-the-build-we-use) unless noted):

- `z3-built.wasm` is **21.9 MB** (21,895,178 bytes; 6.1 MB with `gzip -9`) plus
  85 KB of ES-module JS (`z3-built.mjs`, `index.mjs`, `browser.mjs`, `worker.mjs`).
  Lazy-load it on the first Verify mapping and keep it off the Mapping Editor critical path.
- It needs **no `SharedArrayBuffer`** and therefore no COOP/COEP headers:
  `createZ3Worker()` from `browser.mjs` runs Z3 in a plain dedicated Worker on a page
  with `crossOriginIsolated: false`. This works on GitHub Pages, which cannot set custom
  response headers.
- The package is pure ESM; the WASM and the worker script are resolved with
  `new URL(…, import.meta.url)`. The web app's esbuild build must copy them as assets
  (not yet tried).
- API: `evalSmtlib2(text)` in a fresh context per call, `version()` (Z3 version plus
  upstream commit hash, e.g. `5.3.2.0 b411c902…`), `cancel()`, `terminate()`. Under Deno,
  `init()` from `index.mjs` works directly, with no worker threads to kill.
- Pin the release, the WASM SHA-256 and the attestation (open question 19), and record the
  solver identity in the evidence pack.
- Time-box checks; show partial results.

Where **`z3-solver`** (the official, threaded bindings; 35.4 MB WASM) is used instead, e.g.
as a drop-in on the desktop app, `deno task dev` or a CI replay, these apply (measured in
the [spike](#spike-z3-wasm-on-real-fixtures) with 5.3.2):

- It needs `SharedArrayBuffer` (Emscripten pthreads), which browsers only provide on a
  **cross-origin isolated** page (**COOP** `same-origin` + **COEP** `require-corp` /
  `credentialless`). This is **not a CORS problem**, and serving the library from the same
  origin does not remove it. Without the headers `init()` still *resolves* and the first
  `check()` throws `thread constructor failed`, so gate it on `self.crossOriginIsolated`,
  never on a successful `init()`, and never silently no-op.
- Its browser entry is CommonJS and reads `global.initZ3`, and `z3-built.js` must be its
  own `<script>` (it spawns workers from itself); do not inline it.
- In Deno, `import { init } from "npm:z3-solver"` works as is; call `killThreads(api.em)`
  when done, or the worker threads keep the process alive.

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
- Dialect ASTs + lint result (a pack is only produced for in-dialect templates;
  out-of-dialect text is [not accepted](#out-of-dialect-templates-not-accepted))
- Solver identity (release tag, Z3 version string with upstream commit, WASM SHA-256,
  provenance attestation)
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

Canvas `text_handlebars` is the VMS-Hbs specification
(`ProjectBundle.mapping.blocklyState`). Verify mapping must walk it with
the same VMS-Hbs lowering, not only Blockly slots.

## Spike: Z3 WASM on real fixtures

A throwaway experiment in
[`experiments/z3-spike/`](../../experiments/z3-spike/README.md) (own `deno.json`, not
imported by the app or tests). It **hand-encodes** Decision tables from
`test/fixtures/**` into SMT, mirroring `src/core/sheets/decision_table.ts`: FIRST hit
policy, a catch-all row matches only when no earlier row matched, don't-care glyphs,
numeric predicates `a..b` / `>= n` / `< n`, and otherwise string equality. It solves
them with `npm:z3-solver` 5.3.2 (the official, threaded build) under Deno 2.9.7, and replays every counterexample on the
app's own `evaluateDecisionTable`, the Test Run oracle. The encoder is **not** generated
from the Mapping Model; generating it is the actual work of #41. The same 225 SMT-LIB
queries (`queries.json`) are replayed with the v0.1.0 build in
[Hosting](#hosting-without-coopcoep-github-pages) and
[Provenance](#provenance-and-the-build-we-use); every verdict agrees.

### Measurements with `z3-solver` 5.3.2 (Linux x86-64 box, 8 vCPU; orders of magnitude, not benchmarks)

| What | Result |
|------|--------|
| Bundle | `z3-built.wasm` 35.4 MB (8.1 MB `gzip -9`), `z3-built.js` 0.36 MB |
| Deno: `init()` (WASM compile + threads) | 112–178 ms over seven runs (from the local npm cache) |
| Deno: whole spike, 30 tables, 216 queries | ≈1.8 s wall; scan of all tables 1.24–1.48 s (≈6 ms per query on average, including encoding); slowest single query ≈25 ms |
| Real-arithmetic gap query (P1 below) | 86–103 ms; same query restricted to integers ≈31 ms |
| SMT-LIB text round trip (`solver.toString()` → new solver `fromString`) | works; parse + solve ≈12 ms |
| Headless Chromium, **with** COOP/COEP | `crossOriginIsolated: true`; `init()` 184–262 ms; P1 solve 67–78 ms |
| Headless Chromium, **without** COOP/COEP | `init()` resolves (185–449 ms), then `check()` throws `thread constructor failed: Resource temporarily unavailable` |

Browser numbers are from `localhost`; they do not include downloading 35 MB over a real
network. The same measurements for v0.1.0 are in the Hosting table (column C).

### What it checked and found


| # | Property (fixture) | Encoding | Verdict | Real issue? |
|---|--------------------|----------|---------|-------------|
| P1 | **Completeness vs Source Schema + required target slot**: `sbp_band` (`dummy-json-vitals`). Rows `< 90`, `90..139`, `>= 140`; source `systolic` is JSON Schema `number`; target `band` is `required`. | `sbp` as Real; assert *no row matches* | **sat**: `sbp = 279/2` (139.5). Replay on `evaluateDecisionTable` → `null`, so required `band` is missing. Over **integers** the same table is **unsat** (complete). | **Yes, a small one.** `90..139` is inclusive on both ends, so 139 < x < 140 falls through. The three demo instances are integers, so Test Run never sees it. Fix: `90..<140`-style half-open ranges, `< 140` in row 2, or an integer Source Schema type. |
| P2 | **Value-set consistency vs target OPT + sensitivity**: `medication_ism` (`administrerad-medicinsk-onkologisk-behandling`, Karda). | Output columns as `ite` chains over rows; allowed codes read from the OPT's ISM_TRANSITION (`current_state` openehr::532 "completed", `careflow_step` local::at0007 "Fullföljd läkemedelsbehandling") | Outputs outside the OPT: **unsat** (proved for every input string). Outputs depend on inputs: **unsat**. No dead rows. | **No bug, but the sensitivity check correctly reports "constant output".** This is intentional (the table's notes say the OPT allows only one value). It is exactly the "declare the equivalence class" case of open question 7. The rows 1–4 vs catch-all distinction only affects the `note` column. |
| P3 | **Dead (shadowed) rows** under FIRST and **reachable no-match** for every Decision table in the fixtures (30 tables), with Source Schema preconditions where the fixture schema has them (`bodyPosition` `enum`, ICD-10 `oneOf` consts) | One query per row plus one no-match query; present (non-empty) inputs | No row is dead in isolation. **Given the Source Schema**, `reclining` (simple-vitals, bp-series, mapping-series `body_position`) and the bp-series / mapping-series catch-all row (`''` → Sitting) are unreachable for *present* values. No-match is **unsat** for `icd10_display` and `body_position` under their schemas. No-match is **sat** for `lifestyle_code` (Obstetrix-MHV1, used by `obx-mhv1.intehrgrator-suggestions.json`): its inputs `TobakForegrav` / `SnusForeGrav` / `AlkoholForeGrav` / … are schema `integer` with no enum, so e.g. `0` → `null`. | **Candidates for a human, not bugs per se.** `reclining` is harmless dead weight vs the simulated schema. Obstetrix: whether codes outside 1–3 occur in real MHV1 data is unknown; Z3 can only say the schema allows them. Separately (evaluator replay, not Z3): in bp-series / mapping-series an **absent** `bodyPosition` falls to the catch-all row and yields `at1001` / "Sitting" on a mandatory Position element, which may be **invented clinical meaning** (layer 4) or a deliberate default. Worth a look. |

A fourth, smaller check reproduces a pitfall from the AI conversation. It encodes
`unit = src.unit; if (unit == "mmHg") unit = "mm[Hg]"` as two assertions on **one**
constant. Z3 returns **sat** for the whole query (not "UNSAT" as the conversation
said) and **unsat** once `src_unit = "mmHg"` is added. In other words, the encoding
**silently prunes** the branch it was meant to check. That is worse than an error,
and it is why `variables_set` needs `let`/SSA lowering (below).

### Lessons for #41

1. **The domain decides the verdict.** P1 is "proved complete" over integers and
   "broken" over JSON `number`. The evidence pack must record the encoded
   source domain next to every `unsat`, and Verify mapping should say "for every
   systolic that is a JSON number", not "for every input".
2. **Replay every counterexample on the real oracle** (`evaluateDecisionTable` /
   Mapping preview, and later generated code). The spike did this for every `sat`
   and the results agreed. Do it in the product too: it also catches encoder
   bugs.
3. **Decision tables are the cheapest first target.** They are finite, they are
   already in the Mapping Model, and they map onto three useful checks (dead row,
   no-match hole, output ∉ target value set) that informaticians understand.
4. **String inputs need an explicit "present" precondition**, or Z3's first
   counterexample is `""` (absent optional source), which is usually by design.
   Absent vs present-but-unknown should be two separate properties.
5. **SMT-LIB text is a workable artefact.** `solver.toString()` emits it,
   `fromString` replays it, and a native `z3` (or `cvc5`, if we stay inside
   standard theories) can re-check the `.smt2` in CI. This supports slice C.
6. **`z3-solver`'s hosting caveats** (COOP/COEP gating, CommonJS browser entry, a
   separate `z3-built.js`, `killThreads` in Deno) did not block the spike, and the
   single-threaded v0.1.0 build has none of them.

### Hosting without COOP/COEP (GitHub Pages)

The question: can Verify mapping run on the GitHub Pages web app, which cannot send
COOP/COEP? (It is cross-origin isolation, not CORS; see A.)
[`experiments/z3-spike/hosting_check.ts`](../../experiments/z3-spike/hosting_check.ts)
serves pages from a static `localhost` server that sends **no isolation headers**,
and loads them in headless Chromium (Playwright 1.51). Each variant replays the same
**225 SMT-LIB queries** that `spike.ts` dumped (`queries.json`, from the 30 fixture
Decision tables) and compares the verdicts with the Deno `z3-solver` run. Side-effect
probes on every page:
- the Google Fonts stylesheet that `web/index.html` uses;
- an `<img>` from another origin without a CORP header;
- a CORS `fetch` to that origin.

Ranges cover five runs on the same box, first and second visit
([`hosting_results.json`](../../experiments/z3-spike/hosting_results.json) holds the last).

| | **A. `z3-solver` 5.3.2 + `coi-serviceworker` 0.1.7** | **B. `z3-josh` 0.1.2** | **C. z3-wasm-singlethread v0.1.0 (the build we use)** |
|---|---|---|---|
| How | A service worker re-serves same-origin responses with COOP/COEP, then reloads the page once | Third-party single-threaded Z3 in a plain Worker | Our single-threaded build of upstream Z3 5.3.2; `createZ3Worker()` in a plain Worker |
| Works without headers? | **After a forced reload**: `crossOriginIsolated: true`, 225/225 agree. In 1 of 5 runs the first visit was not isolated within 20 s and `check()` threw `thread constructor failed` | **Yes, directly**: `crossOriginIsolated: false`, 225/225 agree | **Yes, directly**: `crossOriginIsolated: false`, 225/225 agree |
| WASM size | 35.4 MB (8.1 MB `gzip -9`) + 0.36 MB JS | 16.9 MB (5.2 MB `gzip -9`) + 0.73 MB JS | **21.9 MB (6.1 MB `gzip -9`) + 85 KB JS** |
| Start (`init()` / `createZ3Worker()`) in Chromium | 231–265 ms (one cold outlier 416 ms) | 126–186 ms | 98–130 ms |
| Replaying the 225 queries | 0.98–1.29 s (slowest query 63–72 ms) | 0.75–0.84 s (slowest 43–58 ms) | 0.71–0.76 s (slowest 50–57 ms) |
| Cancel at 300 ms (x³+y³+z³ = 42, x > 1000) | `interrupt()` → `unknown` after ≈305 ms | `unknown` after ≈301 ms (terminates and respawns its worker) | `cancel()` → pending call rejects after ≈301 ms; fresh worker ready in 18–23 ms and answers the next query correctly |
| First visit | **2 navigations** (forced reload); ≈2.2–2.5 s to results | 1 navigation; ≈1.8–1.9 s | 1 navigation; ≈1.8 s |
| Deno | works (see the spike) | works ([`josh_deno_check.ts`](../../experiments/z3-spike/josh_deno_check.ts)) | works: `init` 71–77 ms warm, the 225 queries in 0.64–0.67 s, 225/225 agree ([`release_results.json`](../../experiments/z3-spike/release_results.json)) |
| Side effects on the page | COEP applies to the **whole app**. coi-serviceworker uses `require-corp` when the page has `window.chrome`/`window.netscape` (real Chrome and Firefox), and here also on the first, reloaded document; `credentialless` on later visits in headless Chromium. Under `require-corp` the cross-origin `<img>` without CORP was blocked in some first-visit runs. Google Fonts CSS and the CORS fetch always worked. | None measured | **None measured**: no headers, no service worker, all probes loaded |
| App fit | `web/sw.js` already owns the scope (one service worker per scope), so the header rewriting would have to be merged into it. The `better-form-viewer.html` popup / `postMessage` bridge and any future cross-origin embeds would run under COOP/COEP. **Not tested:** hard reload, private windows, Safari. | Pure ESM | Pure ESM; WASM and worker resolved with `new URL(…, import.meta.url)`, so a bundler can copy them as assets (not yet tried with the app's esbuild build); a dynamic `import()` gives the lazy load directly |
| Provenance | Official Z3 bindings (Microsoft), plus a small helper not published since 2023 | **Rejected**: no public source, no attestation (see below) | Public recipe, pinned upstream tag, reproducible, attested release (see below) |

`z3-josh` and the v0.1.0 build expose different APIs from `z3-solver`: the spike's replay
uses SMT-LIB text only (`fromString` + `check()`, or `evalSmtlib2`). The v0.1.0 build has
no object API (no `Context`, models, `Optimize` or tactics); results come back as SMT-LIB
text, which is what the SMT emitter produces anyway.

Not done:
- Download time over a real network (everything was served from `localhost`).
- No other maintained single-threaded build or alternative solver was found on npm.
  `@yowasp/boolector` has no strings or reals; `@cooljapan/oxiz` was not evaluated.

**Recommendation**

1. **Use z3-wasm-singlethread v0.1.0 in a plain Worker** for the web app. It needs no
   headers and no service worker, it is smaller than `z3-solver` (6.1 vs 8.1 MB gzipped),
   it was the fastest variant on these queries, it is cancellable, and it behaves the same
   in Deno.
2. Keep the solver behind a small interface (`init`, `checkSmtLib(text) → verdict + model
   text`, `cancel`), so `z3-solver` remains a drop-in where isolation is available
   (desktop, `deno task dev`, CI replay).
3. **Do not add `coi-serviceworker`** to the web app. It forces a reload, did not always
   isolate the first visit, and puts the whole app (fonts, popups, future embeds) under
   COEP for one optional feature. It would also have to be merged into `web/sw.js`.
4. Lazy `import()` on the first Verify mapping, same-origin assets, a Worker, Cancel, and
   results shown as findings, as described in A.

### Provenance and the build we use

**`z3-josh` is rejected on provenance.** It has no public source repository (npm
metadata has no `repository`/`homepage`; nothing under the maintainer's public
repositories or in GitHub code search), no npm provenance attestation, no LICENSE file
and no build scripts in the tarball. Its WASM reports `Z3 4.16.0.0` without a git hash,
so it cannot be tied to an upstream commit.

**Official upstream:** `z3-solver` is Z3's own build (`src/api/js/scripts/build-wasm.ts`),
published by Z3's public `wasm-release.yml`. It has no npm provenance attestation, but the
5.3.2 tarball shasum in that workflow's public log (commit `b411c902`) equals the
registry's. Upstream already compiles the solver with `-DZ3_SINGLE_THREADED=ON`; the
pthreads (and therefore COOP/COEP) come only from the JS bindings, which run `check()` on
a `std::thread`. Z3's GitHub releases contain **no WASM artefact**.

**Our build:** [regionstockholm/z3-wasm-singlethread](https://github.com/regionstockholm/z3-wasm-singlethread)
follows upstream's `build-wasm.ts` at tag `z3-5.3.2` (commit `b411c902`) with the same
emsdk 3.1.73, removing only the threading flags and adding `-DZ3_POLLING_TIMER=ON` (needed
for timeouts without threads). Every deviation is listed in its `BUILD-DIFF.md`, and the
build stops if upstream's recipe changes. The API is three functions (evaluate SMT-LIB2
text in a fresh context, version, free) plus a Worker wrapper with cancel. The version
string carries the upstream commit hash. CI uses SHA-pinned actions, runs Node and Deno
smoke tests, and attests what it builds (SLSA v1 build provenance). The build is
**reproducible**: the wasm does not depend on the build directory, and two local builds
plus a CI build produced the same bytes. Nothing is published to npm.

**Release to use: [v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0)**
(tag `v0.1.0` at commit `f7913333`, Z3 5.3.2 at `b411c902`, emsdk 3.1.73, upstream's JS
exception model). Built and attested from the tag by
[run 40828961612](https://github.com/regionstockholm/z3-wasm-singlethread/actions/runs/40828961612).
Pin these two files:

| Asset | SHA-256 | Size |
|-------|---------|------|
| [`z3-wasm-singlethread-v0.1.0.tar.gz`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-wasm-singlethread-v0.1.0.tar.gz) (all files below plus `SHA256SUMS`, `BUILDINFO`, licences) | `76afbdd80edcfc37e87e3fe751cf6e98f6db0e7ed1c85e410075c461345fe5fb` | 6.1 MB |
| [`z3-built.wasm`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-built.wasm) | `228258f7523f47b9d50486736a98f3902b7851478056f646a1602b6341453f84` | 21.9 MB (21,895,178 bytes; 6,071,890 with `gzip -9`) |

The other files (`z3-built.mjs`, `index.mjs`/`.d.ts`, `browser.mjs`/`.d.ts`, `worker.mjs`) are
listed with their SHA-256 in the release's
[`SHA256SUMS`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/SHA256SUMS).
Check provenance with:

```sh
gh release download v0.1.0 -R regionstockholm/z3-wasm-singlethread -p z3-built.wasm -p 'z3-wasm-singlethread-v0.1.0.tar.gz'
sha256sum z3-built.wasm z3-wasm-singlethread-v0.1.0.tar.gz
gh attestation verify z3-wasm-singlethread-v0.1.0.tar.gz -R regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0
gh attestation verify z3-built.wasm -R regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0
```

Both verify (SLSA v1 provenance, signer `.github/workflows/build.yml@refs/tags/v0.1.0`, source
commit `f7913333`). Because the build is reproducible, the same wasm also has attestations
from `main` builds; `--source-ref` restricts the check to the tag build. `deno task release` in
[experiments/z3-spike](../../experiments/z3-spike/README.md) downloads the tarball, refuses to run
unless both pinned SHA-256s and the bundled `SHA256SUMS` match (`--attest` also runs the
`gh attestation verify` above), and replays the 225 queries: 225/225 agree with `z3-solver`
([`release_results.json`](../../experiments/z3-spike/release_results.json)).

**Exception model (open question 19).** Local builds of the same recipe (box, not CI; same
225 queries, fresh context per query, both 0 mismatches): upstream's JS exception model,
as in v0.1.0, gives 21.9 MB (6.1 MB gzipped) and 0.53–0.74 s; `-fwasm-exceptions` gives
16.8 MB (5.4 MB) and 0.33–0.52 s.

## Input from an AI conversation (Gemini, shared on #41)

Erik linked a Gemini conversation in #41 (two turns: *can Z3-based approaches such as
SAGE / Pex / Moles verify or test integration mappings and openEHR forms?* and
*should intEHRgrator emit something Z3 consumes or integrate Z3 another way?*).
It is **input, not authority**. Claims were checked against primary sources or by
running them in the spike before anything was adopted.

### Taken (with corrections)

| Idea | Status in this note |
|------|---------------------|
| Verify **upstream of codegen** (Blockly / Mapping Model → SMT) rather than symbolically executing generated TypeScript, Java, XQuery, Go and Handlebars | Already the direction (slice A). The conversation's reason (one encoding vs one symbolic engine per target language) is sound. |
| Emit standard **SMT-LIB v2 text** as the artefact | Adopted for slice C. The spike confirmed the `toString` / `fromString` round trip in `z3-solver`, and the v0.1.0 build takes SMT-LIB text as its only input. |
| **Expression-oriented lowering** (`if`/`switch`/ternary → `ite`) and **let/SSA** for reassignment | Adopted. VMS already removed statement `controls_if`. `variables_set` in a `for_each_*` grain needs `let`/SSA (pitfall reproduced above). |
| **Differential test vectors**: Z3 models → language-agnostic fixtures → run on every generated Conversion script language | Adopted into R3 / slice D. Expected outputs should come from Mapping preview (ADR 0003 oracle) **and** the Z3 model; a disagreement is an encoder or codegen bug. |
| **Negated postcondition query** Φ_source(S) ∧ T = M(S) ∧ ¬Φ_target(T), with a subset of OPT / Web Template constraints compiled to SMT (occurrences, code lists, quantity ranges/units) | Adopted as the query shape (P2 is a small instance). `TemplateValidator` stays the authoritative postcondition; counterexamples must still be replayed through it. The RM invariants cited, DV_PROPORTION `Valid_denominator: denominator /= 0.0` and Interval `Limits_consistent`, are in the openEHR RM / BASE specs. |
| **Equivalence / regression query** M_old(S) ≠ M_new(S) between two mapping versions (refactor, template upgrade) | **New** property for this note. See open question 14. |
| Generate **fast-check arbitraries** from the target template / Source Schema for PBT | Consistent with the existing PBT tier. |
| Model unknown functions as **uninterpreted functions** | Already used for `regexReplaceAll`. The conversation's use case (live terminology / MPI lookups) does not apply: convert-time lookups here are the Defaults Map and static Sheets. |

### Rejected or flagged

| Claim in the conversation | Why |
|---------------------------|-----|
| "If UNSAT you have **mathematically proven** that for *every possible valid source input* the mapping produces a schema-valid composition" | Only relative to the **encoding**: the source domain as encoded (see P1), uninterpreted XPath / regex, bounded collections, which OPT constraints were encoded, and whether the SMT semantics match preview and codegen (ADR 0003). The UI and evidence pack must state those assumptions. |
| Z3 "synthesizes a minimal, path-complete corpus … **guaranteed** 100 % branch and condition coverage (**MC/DC**)" | Path completeness holds only for finite, loop-free encodings that finish within the time box (`unknown` / timeout exist). MC/DC needs independence pairs per condition, not one model per path. "Minimal" is not guaranteed. |
| "Solves in milliseconds" / "500-node forms in milliseconds" | Small Decision tables: yes, measured (3–90 ms). Larger mappings, string-heavy queries and quantifiers: unmeasured. Keep the time box. |
| Naive reassignment makes Z3 "immediately report UNSAT" | Wrong: run in the spike, it is **sat** with the branch silently pruned. The conclusion (use SSA) stands; the failure mode is worse than claimed. |
| Attach `(! … :named block_id)` and use it to put warnings on the block a counterexample flows through | Named assertions give **unsat cores**, which help explain *why* something is proved or contradictory. They do not localise a **sat** counterexample. For that, evaluate per-block / per-row terms in the model, as the spike does per Decision table row. |
| Example constants: systolic "Archetype constraint `[0..300)`"; Python snippet | `openEHR-EHR-OBSERVATION.blood_pressure.v2` constrains systolic to `0.0..<1000.0 mm[Hg]` (CKM mirror ADL). The Python snippet uses `If` and `StringVal` without importing them. Illustrative only. |
| **Better Studio** form JSON (`dependencies` / `expressions` blocks with `show` / `hide` / `require` / `disable` / `clear`) and the "ghost mandatory", unreachable-field and score-gap checks | Better documents that its Form Builder has dependency logic and expressions, but no **public schema** for the exported form JSON was found (search 2026-10-27). The conversation itself noted it lacked documentation. The checks are plausible, and are the same shapes as dead-row / no-match / required-slot above. They are **out of scope for intEHRgrator** and would be a separate investigation (open question 17). |
| Integration sources "HL7v2, FHIR, SQL row"; "no mature symbolic executor for XQuery" | intEHRgrator sources are JSON, XML and openEHR. The XQuery remark is unverified and moot, because we verify upstream of codegen. |
| CrossHair / `hypothesis-crosshair`, Rosette as alternatives | They exist (PyPI `crosshair-tool`, `hypothesis-crosshair`; Rosette is Racket), but intEHRgrator emits no Python and runs in Deno and the browser. They stay in Tier 2 for comparison only. |

Background facts checked: SAGE is Microsoft's whitebox fuzzer for x86 binaries; Pex
ships in Visual Studio as **IntelliTest**; Moles became **Microsoft Fakes**; Symbolic
PathFinder is the Java Pathfinder symbolic-execution extension. All use or used an SMT
solver. None of them is a candidate here, because they analyse generated code, not
the mapping specification.

## Anti-patterns

- Treating Schematron or JSON Schema assertions alone as “proof” — they validate output, not mapping logic for all inputs.
- Expecting informaticians to write Dafny or SMT by hand — specs must be **generated** from Blockly.
- Replacing example-based Test Run — verification **complements** Active Example testing.
- Treating Dafny as a prerequisite for in-app checks — Z3 WASM is enough for the interactive slice.
- Treating **in-dialect** VMS-Hbs / VMS-Go / VMS-Mustache as `trust: author`
  hatches — those dialects exist so SMT and coverage can see their path sets
  and `if`/`eq` trees.
- Accepting *out-of-dialect* templates as a `trust: author` hatch that skips proof.
  intEHRgrator does not accept them; legacy examples are translated to VMS-Hbs /
  VMS-Go first ([policy](#out-of-dialect-templates-not-accepted)).
- Generating a cartesian **whole-convert** test matrix as the default suite — explode on source fields; emit **chunk** tests (collapsed Decision table rules, functions, grain).
- Leaving Decision table no-match as `null` while calling convert crash-free — that is a silent hole, not Rejected.
- Running Verify mapping **on every keystroke, undebounced and uncancellable**, or downloading the 22 MB
  (6 MB gzipped) solver for users who never verify. A debounced live mode that cancels stale runs and only
  starts once the informatician has opted in is a separate, open
  [design suggestion](#design-suggestions-future-decision-live-test--validation), not an anti-pattern.
- Putting Z3 in the main bundle or loading it from a third-party CDN: load it with a dynamic `import()`
  from the app's own origin, on the first Verify mapping only.
- Using the threaded `z3-solver` on GitHub Pages, or letting Verify mapping **silently no-op** where it
  cannot run. (`z3-solver`'s `init()` succeeds without COOP/COEP; only `check()` fails. Use the
  single-threaded build there, and gate any `z3-solver` path on `crossOriginIsolated`.)
- Reporting "proved for all inputs" without the **encoded source domain** (integer vs JSON `number`,
  present vs absent, enum vs free string). The same table can be complete in one and broken in the other.
- Encoding reassignment (`variables_set`) as repeated assertions on one SMT constant. It prunes branches
  silently. Use `let`/SSA.
- Trusting a `sat` model without replaying it on Mapping preview / the generated script.

## Blockly and product features that hinder declarative export / verification

Investigation 2026-09-08 against the current Blockly surface, Mapping Model
extractor (`workspaceToModelJson`), and codegen adapters (`xquery.ts`,
`typescript_codegen.ts`, `go_template.ts`).

### Summary

| Category | Effect on XQuery / declarative export | Effect on formal verification |
|----------|--------------------------------------|------------------------------|
| **Canvas vs Mapping Model gap** | Medium — Mapping Model has `loops[]` / `targetSignature`; XQuery loop emit landed with [#39](https://github.com/regionstockholm/intehrgrator/issues/39) | Low–medium — preview vs TypeScript golden oracles landed ([#38](https://github.com/regionstockholm/intehrgrator/issues/38)); SMT still needs the same IR |
| **Template dialects (ADR 0009)** | Medium — XQuery still stubs some `handlebars()` literals; in-dialect AST is available from lint | **Positive** for VMS-Hbs / VMS-Go / VMS-Mustache (lower to SMT). Out-of-dialect is [not accepted](#out-of-dialect-templates-not-accepted), so there is no residual template risk |
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
| `for_each_source` | Yes (`loops[]`) | TypeScript canvas; XQuery from `loops[]` (`compileLoopSequence`) |
| RM / schema tree shape | Partially (`optionalRm[]`, block types on canvas) | TypeScript canvas; XQuery Model B slot manifest only |
| `lists_getIndex`, `lists_create_with` | **No** | TypeScript and Java canvas walks |
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
| Out-of-dialect text (`lookup`, `#with`, `call`, Sprig, …) | **Not accepted** in intEHRgrator mappings. Convert already fails closed (ADR 0009); lint warns today and should reject (proposal, see [policy](#out-of-dialect-templates-not-accepted)). No proof obligations are skipped for it. |

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
5. Do not mark template slots `trust: author`. Out-of-dialect text is rejected,
   not exempted ([policy](#out-of-dialect-templates-not-accepted)); `trust: author` stays for the remaining non-template
   hatches listed under [Implemented VMS](#implemented-vms-verifiable-mapping-subset).

### 3. Sheets: accessors vs mutators

**Accessors** (`sheet_get_*`, `sheet_lookup`) are in the Mapping Expression AST
and Test Run (`evalSheetCall`). **Mutators** (`sheet_set_*`, `sheet_insert_row`,
`sheet_delete_*`, …) mutate a convert-time `SheetBag` (`applySheetMutator`) and
are **statement blocks**, not slot expressions.

XQuery export reads Sheets and Decision tables from a convert-time `$sheets` map
(`src/core/codegen/xquery_sheets.ts`, #76).

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
   tied to the loaded schema; treat generic `json_object` as an escape hatch.
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
  ad-hoc json_object / xml_element trees,
  dynamic (non-literal) source paths, procedures_defreturn (until function
  harness lands)

VMS-Hbs / VMS-Go / VMS-Mustache:
  in-dialect per ADR 0009 — **include in Verify mapping**; not a hatch.

Not accepted (not a hatch):
  out-of-dialect Handlebars or Go template (see policy below)


VMS remove from toolbox (do not implement):
  controls_whileUntil, controls_repeat_ext, controls_for, stock controls_forEach,
  controls_flow_statements, controls_if (statement; keep logic_ternary),
  math_random_int / math_random_float, text_print,
  lists_setIndex, lists_repeat, sheet mutators
```

A workspace linter ([#40](https://github.com/regionstockholm/intehrgrator/issues/40))
warns on leftover Blockly hatches and (today, at warning severity) on **out-of-dialect**
Handlebars / Go template; see the proposal below to reject it.
In-dialect **VMS-Hbs** / **VMS-Go** / **VMS-Mustache** is VMS
([ADR 0009](../adr/0009-verifiable-template-dialects.md),
[proposal](../proposals/verifiable-template-snippets.md)) and is **in scope**
for SMT lowering on [#41](https://github.com/regionstockholm/intehrgrator/issues/41).

### Out-of-dialect templates: not accepted

**intEHRgrator does not accept out-of-dialect Handlebars or Go template text** in
mappings. VMS-Hbs, VMS-Go and VMS-Mustache are the only template languages; there is
no `trust: author` exemption for templates.

- **Already enforced at convert:** ADR 0009's hard gate (`knownHelpersOnly` against the
  VMS-Hbs whitelist; Go parse + curated FuncMap) means out-of-dialect text does not run.
- **Proposal, mechanism not decided:** today the editor lint (#40, ADR 0009 "soft gate")
  only **warns**. Raise out-of-dialect findings to **error** severity, and have
  Verify mapping, Generated Export and the evidence pack report them as a failing
  finding rather than a skipped hatch. Open: whether save / Project Bundle load should
  also refuse it, or load it flagged so the author can fix it.
- **Legacy examples:** older mapping examples that use out-of-dialect constructs are
  kept only as **comparative material for one-off tests**, after translation to the
  current VMS-Hbs / VMS-Go (or Decision tables with VMS-Mustache cells). They are not a
  supported input and not part of the regression or verification suite in their
  original form.
- [ADR 0009](../adr/0009-verifiable-template-dialects.md) is amended accordingly
  ([Amendment 2026-10-29](../adr/0009-verifiable-template-dialects.md#amendment-2026-10-29)):
  the "hatch warning" for out-of-dialect text is gone; the lint severity change is
  recorded there as a proposal.

## Design suggestions (future decision): live Test & Validation

**Status:** proposals for Erik to decide; nothing here is implemented or
committed to. Raised because the [Idea](#idea) names interactive checking while
the informatician authors as a primary purpose, while the first release only
verifies on explicit triggers.

**What exists today (checked in code, `fv-gemini-z3-spike`):** Conversion Test
Run(s) already re-run automatically. `WorkbenchController.scheduleTestRun()`
re-runs all test files after a fixed **500 ms** debounce (hard-coded) when
**Auto-run** (`settings.autoplay`) is on. Auto-run is **on by default**; the
**Pause / ▶ Auto-run** button in the Conversion Test Run(s) header turns it off,
and a paused state is remembered per machine (`localStorage`
`intehrgrator.autoRunPaused`), not taken from Project Bundles. **Run Test** runs
on demand. VMS-Hbs / VMS-Go template lint is also debounced (600 ms,
`template_lint.ts`). Verify mapping does not exist yet.

Suggestions:

1. **Debounced live Verify mapping.** When live mode is on, re-run Verify
   mapping after the mapping has been quiet for a debounce interval, so findings
   follow the informatician's edits the way Test Run output already does.
2. **No UI lag.**
   - Debounce, and **cancel stale runs**: a new edit terminates the running
     Worker check (Cancel already restarts a Worker in about 20 ms in the
     spike) instead of queueing it.
   - Keep Z3 off the UI thread (already the design); consider whether Test
     Runs over large example sets should also move to a Worker.
   - **Incremental checks:** re-check only the properties whose Mapping Model
     chunk changed (per Decision table, Blockly Function, slot), keyed by a
     chunk hash, and reuse earlier results for the rest. Decision table checks
     already run in milliseconds in the spike, so they are the natural first
     live slice.
   - A visible status per kind: **up to date / validating… / stale / paused /
     timed out**, using the existing Mapping Model hash and stale marking.
   - Do not trigger the 6 MB (gzipped) solver download from live mode until
     the user has started Verify mapping once or switched live validation on.
3. **One play/pause toggle per kind.** Give formal validation the same
   Auto-run / Pause control Test Run has, so slow computers or big mappings can
   pause either one independently and fall back to Run Test / Verify mapping.
4. **A combined "Test & Validation" menu.** Move Run Test, Verify mapping and
   their toggles into one new menu (or panel header), e.g.:
   - ☑ Auto-run example Test Runs · Run now
   - ☐ Live formal validation (Z3) · Verify now
   - Debounce: example tests ___ ms · formal validation ___ ms
5. **Configurable debounce.** Make the debounce a setting instead of the
   hard-coded 500 ms, probably with **separate limits per kind**, since a Z3
   pass can cost far more than a Test Run (e.g. keep ~500 ms for tests, start
   formal validation at a longer delay or after a pause in typing). Store it per
   machine like the Auto-run pause, not in the Project Bundle.

Open questions for this suggestion:

- **Defaults:** live formal validation off by default (download and CPU cost)
  or on after the first manual Verify mapping? Should Test Run Auto-run stay on
  by default?
- **Default debounce values** per kind, and whether to adapt them to measured
  run time (back off when checks are slow).
- **How results are shown** while editing: inline in the findings / Constraint
  warning surface only, or also on Blockly blocks and Decision table rows; how
  to avoid flicker when findings appear and disappear between edits.
- **Packaged evidence:** live results are transient. Should export always run a
  fresh full (non-incremental) check for the evidence pack, or may it reuse a
  non-stale live result with the same Mapping Model hash? (Relates to open
  question 18, the export gate.)
- **Scope of the merged menu:** also include template lint and
  `TemplateValidator` output validation, or only Test Run and Verify mapping?

## Open questions

1. **Contract language surface** — YAML vs JSON vs a dedicated `.mapping-contract` extension; alignment with [AI_SUGGESTION_FORMAT.md](../AI_SUGGESTION_FORMAT.md). SMT-LIB is generated either way.
2. **Source schema as precondition** — how strongly to require a loaded Source Schema vs inferring from examples. Verify mapping without a schema can still check internal expression definedness, but not \(s \in S\).
3. **Loop grain** — whether to adopt grain-correctness style rules for `for_each_source` (see recent data-pipeline formalization literature).
4. **Ignored source** — UI for marking Source Schema nodes as intentionally unread so the coverage overlay does not nag.
5. **Execution oracle** — Verify mapping checks the Mapping Model / generated SMT; ADR 0003 still requires preview ≡ TypeScript on VMS. Counterexamples should be replayed on both oracles.
6. **Robustness generators** — how complete must Source Schema be before PBT/Z3 can claim “no valid source crashes convert”?
7. **Sensitivity vs equivalence classes** — when `switch` or a Decision table maps many codes to one target, how to declare that class so sensitivity checks do not false-fail.
8. **GitHub Pages + SharedArrayBuffer** — *answered*: the single-threaded z3-wasm-singlethread v0.1.0 build runs in a plain Worker without COOP/COEP; `coi-serviceworker` is not used (see [Hosting](#hosting-without-coopcoep-github-pages)). Supply and pinning: open question 19.
9. **Evidence pack layout** — sidecar zip vs optional Project Bundle section; whether replay is `deno task verify` or checked-in SMT + CI.
10. **Decision table no-match** — breaking change to throw vs opt-in table flag vs Verify mapping warning until a catch-all error row exists. Recommend: warn in R0, throw only when an error row / flag is set, so existing tables keep returning `null` until authors opt in.
11. **Template SMT bound** — how deep to encode nested `#if` / `{{if}}` before
    falling back to PBT; whether to require Decision table reauthoring for
    proof of combinational narrative, or encode the tree as-is (recommend:
    encode as-is, warn when nesting exceeds a small depth).
12. **`regexReplaceAll`** — keep uninterpreted in SMT; which gold strings belong
    in the evidence pack vs generated chunk tests.
13. **Numeric Decision table conditions** — the spike found a 139 < x < 140 hole in
    `sbp_band` because `a..b` is inclusive. Options: half-open range syntax
    (`90..<140`), a lint that runs the no-match query on save, or typing source
    numbers as integer where the Source Schema says so. Probably all three.
14. **Version equivalence** — offer "is mapping v2 equivalent to v1 for all
    source?" (M_old ≠ M_new query) when refactoring or upgrading a template?
    Useful for release notes and MDR change control.
15. **Target constraints in SMT vs `TemplateValidator`** — how much of the
    OPT / Web Template (occurrences, code lists, quantity ranges, RM invariants)
    to compile into SMT, versus generating candidates with Z3 and judging them with
    `TemplateValidator`. The spike read code lists straight from the OPT; a real
    emitter should reuse ehrtslib's parsed template.
16. **Absent vs present source** — model optional source as a separate
    "absent" flag per read, so that "what happens when bodyPosition is missing"
    (spike: Sitting via the `''` row) is its own reviewable property, not noise in
    every counterexample.
17. **openEHR forms (e.g. Better Studio)** — the same checks (unreachable field,
    required-but-hidden, score gaps) would apply to form dependency rules, but
    there is no public form-JSON schema to build on. Separate issue, or out of
    scope?
18. **Export gate** — the default is that export proceeds with a warning when
    verification fails, is stale or was cancelled. Should a project (e.g. one
    marked for an MDR/IVDR technical file) be able to **require** a passing,
    non-stale Verify mapping before Generated Export or the evidence pack?
19. **Single-threaded Z3 supply** — decided: we build it ourselves in
    [regionstockholm/z3-wasm-singlethread](https://github.com/regionstockholm/z3-wasm-singlethread)
    (Z3's own recipe at a pinned tag, minus threads; CI with build-provenance
    attestation; `z3-josh` rejected, see
    [Provenance and the build we use](#provenance-and-the-build-we-use)). **Consumption — decided:** pin the
    [v0.1.0 GitHub release](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0)
    asset by SHA-256 (tarball `76afbdd8…e5fb`, wasm `228258f7…3f84`), check
    `SHA256SUMS`, and verify the attestation with `gh attestation verify … -R
    regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0`
    (`experiments/z3-spike/release_check.ts` does this); not npm. A version bump means
    a new release and new pins. Still open: who reviews Z3/emsdk bumps, and on what
    cadence (each Z3 release, or security fixes only)? Upstream's or native wasm
    exceptions? Whether the web app fetches the pinned asset at build time or vendors it
    in the repo (both checked against the same SHA-256)? How is the WASM SHA-256 and
    provenance attestation recorded in the evidence pack?

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
- [z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0) — the single-threaded Z3 WASM build Verify mapping uses (no COOP/COEP)
- [z3-solver (npm)](https://www.npmjs.com/package/z3-solver) — official, threaded JS/TS bindings; needs a cross-origin isolated page
- [experiments/z3-spike](../../experiments/z3-spike/README.md) — throwaway Z3 WASM spike (Deno + Chromium) with recorded results
- [Autonoma: What Is Decision Table Testing?](https://getautonoma.com/blog/decision-table-testing) — collapse don’t-cares, then one parameterised test per remaining rule (comment on [#41](https://github.com/regionstockholm/intehrgrator/issues/41))

## External references

- Model transformation verification (OCL postconditions, preservation properties): [Verification of Model Transformations](https://shura.shu.ac.uk/12047/1/mtverif.pdf)
- Healthcare mapping formal specs: FHIRconnect, OMOCL (archetype path → target field)
- Verifiable declarative mappings (RML → OCaml + Gospel/Cameleer): [Towards Verifiable Declarative Mappings](https://edkamb.github.io/files/kgcw2026.pdf)
- Grain correctness in data pipelines: [Grain Theory (arXiv:2601.00995)](https://arxiv.org/abs/2601.00995)
- Metamorphic testing of transformations (relations between paired runs, no gold output per input): Chen et al., *Metamorphic Testing: A Review of Challenges and Opportunities*
- Z3 JavaScript/WASM: [z3-wasm-singlethread](https://github.com/regionstockholm/z3-wasm-singlethread) (ours, single-threaded); [z3-solver](https://www.npmjs.com/package/z3-solver) (official; `SharedArrayBuffer` / COOP-COEP notes in its README)
- Decision-table test collapsing: [Autonoma](https://getautonoma.com/blog/decision-table-testing)
- SMT-LIB v2 standard (portable `.smt2` for replay with Z3 or cvc5): [smt-lib.org](https://smt-lib.org/)
- Whitebox test generation background (from the AI conversation; analyse *code*, not specs):
  [SAGE: Automated Whitebox Fuzz Testing](https://www.microsoft.com/en-us/research/publication/automated-whitebox-fuzz-testing/),
  [Pex and Moles](https://www.microsoft.com/en-us/research/project/pex-and-moles-isolation-and-white-box-unit-testing-for-net/)
  (Pex → Visual Studio IntelliTest; Moles → Microsoft Fakes)
- openEHR RM data types invariants (DV_PROPORTION `Valid_denominator`): [RM data_types](https://specifications.openehr.org/releases/RM/latest/data_types.html);
  Interval `Limits_consistent`: [BASE foundation_types](https://specifications.openehr.org/releases/BASE/latest/foundation_types.html)

## Question for parallel research

> **Context:** intEHRgrator is a Deno/TypeScript visual integration workbench.
> Users author mappings in Blockly from JSON/XML/openEHR sources into openEHR
> templates, JSON Schema, XML Schema, or free-form targets. Blockly JSON is
> canonical; a derived Mapping Model drives Test Run, validation, and codegen.
> We export TypeScript, Java, Handlebars, XQuery, and Go template, and validate
> openEHR output on example instances — not over all inputs. Microsoft Z3 is
> available in-process as WASM (a single-threaded build that runs in a plain
> Web Worker, loaded on demand).
>
> **Question (updated):** How should a **generated SMT encoding** of a VMS
> Mapping Model — **including lowered VMS-Hbs / VMS-Go / VMS-Mustache dialect
> ASTs** — be scoped so Z3 WASM can run interactively while authoring
> (seconds, not minutes; on request or debounced after edits) while still producing (a) source-coverage overlays that count
> template paths as reads, (b) concrete counterexample instances, (c) an
> MDR/IVDR-style evidence pack, and (d) a **chunk-level** test suite in the
> same Conversion script language? Compare encoding Mapping Expression
> `if`/`switch`/Decision tables vs encoding in-dialect `#if`/`eq`/`#each`
> vs treating XPath as uninterpreted vs bounding collections. Where must we
> fall back to property-based testing (`regexReplaceAll`, unbounded trees)?
> How should authored `error(…)` / Decision table error rows appear in the
> SMT (Rejected vs Erroneous)? Out-of-dialect templates are not accepted, so
> they need no encoding.
