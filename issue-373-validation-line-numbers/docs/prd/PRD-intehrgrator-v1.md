# PRD: intEHRgrator v1 — Integration Workbench

**Status:** Ready for implementation  
**Triage label:** `ready-for-agent` (apply when published to issue tracker)  
**Glossary:** [CONTEXT.md](../CONTEXT.md)  
**Design references:** [docs/UI_ARCHITECTURE.md](../UI_ARCHITECTURE.md), [docs/MAPPING_SPECIFICATION.md](../MAPPING_SPECIFICATION.md)

---

## Problem Statement

Healthcare informaticians must map heterogeneous source data (JSON/XML from hospital systems, exports, APIs) into valid openEHR **Compositions** constrained by an **Operational Template (OPT)**. Today this work is slow, error-prone, and requires deep knowledge of both the source schema and the openEHR Reference Model (RM). Informaticians lack a dedicated tool that:

- Visualizes the OPT-driven target structure alongside the source
- Enforces RM validity when extending templates with optional structures
- Lets them iterate mappings against multiple example instances before exporting a **Conversion Script**
- Produces maintainable TypeScript (and eventually Java) conversion scripts without hand-writing 

## Solution

**intEHRgrator** is a browser-based **Integration Workbench** (v1: is published as a GitHub Pages web app static website) with a three-pane layout:

1. **Source Pane** — Source Schema tree (upper part of pane) plus tabbed **Example Instances** (lower part of pane) for click-to-map and Test Run
2. **Mapping Editor** — nested Blockly (structure) (upper part of pane) + **Mapping Specification** DSL (editable expressions only); not export code (lower part of pane) 
3. **Output Previews** — **Generated conversion script(s)** (TypeScript in v1) (upper part of pane) and **Conversion Test Run(s)** results per active example tab (lower part of pane) 

Mappings are authored visually, reviewed in a declarative spec, validated by in-browser Test Run via `ehrtslib`, and exported as executable Conversion Scripts. Copy-paste AI assist helps bulk suggestions without in-app API calls.

Implementation follows a **two-step** process: Step 1 — Blockly blocks + dual code generators; Step 2 — Workbench UI and application logic.

Later versions may evolve this to also become a VS code plugin.

## User Stories

### Template and skeleton

1. As an informatician, I want to open an OPT file (representing my mapping target structure), so that the Mapping Editor shows a **Template Skeleton** matching my clinical model.
2. As an informatician, I want silent-mandatory RM fields (required by RM but absent from the OPT) to appear visibly in the skeleton, so that I know what must be mapped to before validation passes.
3. As an informatician, I want the skeleton generated from OPT constraints plus ehrtslib's mandatory-RM attribute rules (not from sample instance data), so that structure reflects the schema rather than one patient's data.
4. As an informatician, I want fixed template values (e.g. archetype node ids, terminology bindings) pre-filled in blocks, so that I cannot accidentally violate template constraints.
5. As an informatician, I want a minimap when the Blockly canvas is larger than the viewport, so that I can navigate deep templates.

### Optional RM structures

6. As an informatician, I want to be able to add optional RM structures (e.g. `feeder_audit`) via a `+` button on container blocks, so that I can extend the composition without breaking RM rules.
7. As an informatician, I want the picker to show only RM-valid types for the selected attachment point, so that I cannot insert illegal structures.
8. As an informatician, I want the parent block to expand automatically when I pick an optional structure, so that there is a slot for the new fields. 
9. As an informatician, I want optional RM structures not in the OPT to remain hidden until I add them, so that the canvas is not overloaded with unused branches.

(Question to investigate regarding #8 and #9: Is dynamic modification like this possible in Blockly or do we e.g. need to have an extra predefined alternative "maximal" version of each block that can take any valid extensions? Or something else?)

### Source data

10. As an informatician, I want to load a **Source Schema** file (JSON, XML, or other structural definition) into the upper Source Pane, so that I can author mappings from structural knowledge alone.
11. As an informatician, I want to be able to open multiple **Example Instances** in separate tabs, so that I can test mappings against varied real-world payloads.
12. As an informatician, I want to add a new example instance via **+ Add Example**, so that I can grow my test set during a session.
13. As an informatician, I want to switch active example tabs and see each tab's **Test Run** result immediately, so that I can compare outcomes without waiting.
14. As an informatician, I want click-to-map to work from either the schema tree or the active example instance tree, so that I can choose structural or concrete paths.
15. As an informatician, I want drag-and-drop (a node ghost image) from a source tree node onto a value slot as an alternative to click-to-map, so that I can map quickly with the mouse.
16. As an informatician, I want source paths expressed as fontoxpath XPath/XQuery against JSON and XML, so that one query language covers both formats.
17. As an informatician, I want the tool to pick the correct typed fontoxpath evaluator from the target slot's `DV_*` type, so that I do not have to remember evaluator function names.

### Mapping editor

18. As an informatician, I want to edit mappings primarily with nested Blockly blocks, so that RM structure remains visual and constrained.
19. As an informatician, I want a **Mapping Specification** text view below Blockly, so that I can read and edit mapping expressions in one place.
20. As an informatician, I want structural lines in the Mapping Specification to be read-only, so that I cannot accidentally break the composition tree in text view.
21. As an informatician, I want to edit expression lines (`xpathNumber(...)`, `trim(...)`, `if(...)`) in the Mapping Specification, so that power users can type transforms without placing blocks.
22. As an informatician, I want block selection to highlight the corresponding spec region and vice versa, so that I can orient myself between views. An autoscroll checkbox determines if teh corresponding regions in the other pane half is also scrolled to.
23. As an informatician, I want control-flow and string/math blocks in Blockly, so that I can express non-trivial transforms between source and target.nI may also need loop constructs for looping over a source array/list etc
24. As an informatician, I want the lower part of the center CodeMirror panel to show the Mapping Specification (in textual form in Codemirror enhanced with useful COdemirror decorations/widgets)

### Test Run and export

25. As an informatician, I want **Generated Export** (initially TypeScript, later optionally Java) in the right pane upper section, so that I can see the executable script that pipelines will run.
26. As an informatician, I want **Test Run** to execute Generated Export against the **Active Example** in-browser, so that I get immediate feedback without deploying code.
27. As an informatician, I want Test Run output as Composition JSON or a tree widget, so that I can inspect clinical content in a familiar openEHR shape.
28. As an informatician, I want an **Autoplay / Pause** toggle (like in the ehrtslib demo webapp), so that conversion results refresh (debounced) automatically while I edit mappings.
29. As an informatician, I want Autoplay button and output window disabled/grayed out when no example tabs are open, so that I am not misled into thinking tests ran when no instance exists.
31. As an informatician, I want Autoplay to re-run on mapping edits (debounced), and on example tab switches, so that switching tabs stays instant with cached results.
32. As an informatician, I want to **Export TS** and download the Conversion Script, so that I can use it in my integration pipeline.
33. As an informatician, I want Java generators built in Step 1 but Java export UI deferred, so that the Blockly model stays language-agnostic while v1 focuses on TypeScript.

### Persistence

34. As an informatician, I want to **Save Project** to IndexedDB with OPT, schema, all example instances, and mappings, so that I can resume work later in the browser.
35. As an informatician, I want to **Export Project** as a self-contained `.intehrgrator` (internally zipped) bundle, so that I can share or back up my work.
36. As an informatician, I want to **Import Project** from a bundle, so that I can restore work on another machine without re-loading individual files.

### AI assist

37. As an informatician, I want **Copy AI Prompt** to generate a clipboard prompt with template/source context and link to definition of a response format, so that I can use my preferred external AI chat.
38. As an informatician, I want the prompt to link the deterministic `intehrgrator-suggestions` response format, so that AI output is machine-importable.
39. As an informatician, I want **Import Suggestions** to apply parsed AI responses to mapping slots, so that I can bulk-fill mappings after external review.
40. As an informatician, I want import to validate `templateId` and `slotId`, so that suggestions do not land on the wrong template or field.

### Settings and status
41. As an informatician, I want unmapped mandatory slots marked in red in the blockly view.
42. As an informatician, I want validation warnings (number of unmapped mandatory slots, Test Run errors) surfaced in the status bar or Output Previews, so that I can fix issues before export.

### Platform (v1 constraints)

43. As an informatician, I want the app to run entirely in the browser without a backend, so that I can use it from GitHub Pages in restricted environments.
44. As a developer, I want a **Host Abstraction** interface, so that a future VS Code extension can reuse the same core without rewriting file/storage logic. A VS code version will use files rather than indexdb/local browser storage.

## Implementation Decisions

### Phasing

- **Step 1 (foundation):** Deterministic Blockly block library from ehrtslib RM types; OPT → Template Skeleton generator; expression blocks; TypeScript and Java **export generators** (Java UI deferred). 
- **Step 2 (workbench):** web app UI, Source Pane, Mapping Editor sync, Test Run, persistence, copy-paste AI assist.

### Major modules (deep modules preferred)

| Module | Responsibility | Interface sketch |
|--------|----------------|------------------|
| **OPT skeleton generator** | Parse OPT; walk constraints; merge **silent-mandatory RM fields** using ehrtslib's `MANDATORY_RM_ATTRIBUTES` (`enhanced/generation/rm_instance_generator.ts`) — no separate BMM parsing in intEHRgrator; emit skeleton block tree / Mapping Model structure | `generateSkeleton(opt) → SkeletonNode[]` |
| **RM attachment catalog** | Given parent RM type + template context, list valid optional child types and cardinalities using **ehrtslib RM class signatures** (types have already been generated from openEHR BMM JSON upstream — intEHRgrator consumes ehrtslib, does not parse BMM files) | `getValidAttachments(parentType, context) → AttachmentOption[]` |
| **Blockly block registry** | Block definitions, mutators for **Block Expansion**, category layout | Blockly APIs + internal `blockType` registry |
| **Mapping Model** | Canonical JSON IR: `templateId`, `slots[]`, `optionalRm[]`| `MappingModel` type; `fromBlockly` / `toBlockly` / `validate` |
| **Mapping Specification engine** | Project Blockly + Model → DSL text; parse expression edits → Model + blocks | `toSpec(model)`, `applyExpressionEdit(slotId, expr)` |
| **Expression language** | Parse/validate JS-shaped subset; builtin registry (`xpathNumber`, `trim`, `if`, …) | `parseExpression(source) → ExprAst`, `serialize(ast)` | DO check what expressions the chosen xpath 3.1 library already supplies before inventing something extra. If suitable create corresponding blockly UI-support for these. 
| **Source schema loader** | Schema file (JSON, XML, or inferred structure) → navigable tree | `loadSchema(file) → SchemaTree` |
| **Example instance manager** | Tabbed instances; active tab; per-tab Test Run cache | `addExample`, `setActive`, `getActive`, `getCachedResult` |
| **Source query runtime** | fontoxpath wrappers; JSON context vs XML DOM; typed evaluators per `DV_*` | `evaluate(exprAst, sourceCtx, returnType) → value` |
| **Click-to-map controller** | Listening mode; insert `source_query` / spec expression from tree click or drag | `armSlot(slotId)`, `bindFromNode(nodePath)` |
| **Export codegen** | Walk blocks or Mapping Model → TypeScript (`ehrtslib`) or Java (`Archie`); **target chosen at export/preview time** | `generate(model, target: 'typescript' \| 'java') → string` |
| **Test runner** | Bundle generated TS; execute against Active Example; return Composition JSON or errors | `runTest(model, example, generatedTs) → TestResult` |
| **Project persistence** | IndexedDB + `.intehrgrator` import/export; dual Blockly + Mapping Model serialization | `save` (also use autosave), `save as`, `load`, `exportBundle`, `importBundle` (in UI call them export /import project) |
| **AI assist** | Build copy-paste prompt; parse `intehrgrator-suggestions`; apply to Model | `buildPrompt(scope)`, `importSuggestions(json)` |
| **Host abstraction (web v1)** | File picker, IndexedDB, clipboard | `HostAdapter` interface; `WebHostAdapter` implementation |
| **Workbench shell** | Three-pane layout, toolbar, Autoplay, status bar, Karolinska Unversity Hospital  theme but compact | Composes modules above |

### ehrtslib as RM metadata source (no direct BMM parsing)

intEHRgrator does **not** parse openEHR BMM JSON files. It relies on [ehrtslib](https://github.com/ErikSundvall/ehrtslib), whose RM class signatures are **generated from BMM** in that project's toolchain (`tasks/generate_ts_libs.ts` → `generated/` → `enhanced/`).

For **silent-mandatory RM fields** in the Template Skeleton, reuse ehrtslib's `MANDATORY_RM_ATTRIBUTES` constant in `enhanced/generation/rm_instance_generator.ts` (e.g. `COMPOSITION` → `language`, `territory`, `category`, `composer` etc.). The same list drives `RMInstanceGenerator.addMandatoryRMAttributes()` when `includeMandatoryRMAttributes` is true. intEHRgrator skeleton generation mirrors this logic for Blockly slots — not `RMInstanceGenerator` output for shape.

For **optional RM attachment** validation (`+` picker), introspect ehrtslib RM types / relationships (BMM-derived) rather than loading BMM separately.

### Architectural decisions (from design sessions)

- **Three panes:** Source Pane | Mapping Editor | Output Previews.
- **Mapping Editor split:** Blockly (top, structure authority) + Mapping Specification (bottom, expressions only).
- **Mapping Specification** is a block-aligned DSL with JS-shaped expression subset — not Generated Export and not full JavaScript.
- **Codegen** walks Blockly / Mapping Model, not Mapping Specification text. **Conversion script language** (`exportTarget`) is passed into codegen at preview/export time — not stored in the Mapping Model.
- **Dual persistence:** native Blockly serialization + Mapping Model JSON; on conflict Model wins.
- **Source querying:** fontoxpath for JSON and XML; `fast-xml-parser` only for ehrtslib-aligned openEHR RM XML I/O.
- **Example tabs:** multiple instances; Test Run uses Active Example; tab switch shows cached result; Autoplay on mapping edits only.
- **Optional RM:** `+` filtered picker + **Block Expansion** on parent mutator.
- **AI:** copy-paste only in v1; no in-app LLM API.
- **Export:** TypeScript Test Run + Export TS in v1; Java generators built, UI disabled.
- **web app first;** VS Code extension later via Host Abstraction.

### Mapping Model shape (prototype decision)

The Mapping Model is **language-neutral** — it describes *what* is mapped, not *how* it is translated to mapping code. **Conversion script language** is a workspace/editor setting (Project Bundle `settings.exportTarget`), chosen when previewing or exporting.

```typescript
// Illustrative — canonical IR shared by persistence, AI import, and codegen input
type MappingModel = {
  modelVersion: number;
  templateId: string;
  slots: Array<{
    slotId: string;       // archetypeId/path — shared with AI_SUGGESTION_FORMAT
    rmType: string;       // e.g. DV_QUANTITY
    expression: string;   // serialized JS-shaped expr, e.g. xpathNumber("/...")
    returnType: string;   // fontoxpath evaluator hint
  }>;
  optionalRm: Array<{
    attachmentSlotId: string;
    rmType: string;
  }>;
};

### Expression AST (prototype decision)

```typescript
type ExprAst =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "call"; name: "xpath" | "xpathString" | "xpathNumber" | "xpathBoolean" | "trim" | "concat" | "if"; args: ExprAst[] }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: ExprAst; right: ExprAst };
```

Possibly modify this to make maxinal use if XPATH 3.1 built in functions supported by the library

### openEHR modeling rules (normative behavior)

- **Narrowing principle** applies when constraining archetypes within templates (mandatory stays mandatory; optionals may be narrowed or excluded).
- **Template Skeleton** includes OPT-constrained nodes plus **silent-mandatory RM fields** always visible.
- **Optional RM fields** not in OPT and not RM-mandatory: only via `+` picker, not pre-rendered.

## Testing Decisions

### What makes a good test

- Test **observable behavior** at module boundaries: given inputs → expected outputs.
- Prefer **golden files** for codegen and Mapping Specification round-trips.
- Do not test Blockly internals or CodeMirror DOM; test the Mapping Model and generators.
- No prior test suite exists (greenfield); use Deno test per AGENTS.md.

### Modules to test (recommended)

| Module | Test focus |
|--------|------------|
| OPT skeleton generator | Known OPT fixtures → expected `slotId` set including silent-mandatory fields |
| RM attachment catalog | Parent types → allowed/not allowed optional types |
| Mapping Model | `fromBlockly` / `toBlockly` round-trip; conflict resolution |
| Expression language | Parse + serialize; reject full JS (`import`, `fetch`) |
| Mapping Specification engine | Model → spec → expression edit → Model |
| Export codegen (TypeScript) | Golden snapshots for representative templates |
| Export codegen (Java) | Parity with TS for same Mapping Model (structure only in v1) |
| Source query runtime | fontoxpath evaluators on JSON + XML fixtures |
| AI suggestion import | Valid/invalid `intehrgrator-suggestions` payloads |
| Project persistence | Bundle export/import round-trip |
| Test runner | Generated script + example → instance in target format (integration, may be browser env) |

### Lower priority for unit tests (UI shell)

- Workbench shell layout, toolbar, Autoplay toggle UI — manual / E2E later.
- Blockly minimap — visual; smoke test only.

## Out of Scope (v1) - possible future enhancements

- VS Code extension (Host Abstraction stub only)
- In-app AI / LLM API integration
- Java Test Run and **Export Java** UI (generators in scope)
- Wildcard source mapping blocks
- Text-first Mapping Editor
- Deployment, runtime hosting, CDR upload, openEHR REST integration
- FHIR source formats
- Full bidirectional CodeMirror editing of RM structure
- Exporting XQuery programs that perform the full conversion to valid openEHR — see [docs/future/xquery-export-investigation.md](../docs/future/xquery-export-investigation.md)
- Sectra forms as an input format in addition to generic json/XML - output code that runs in sectra formas and or pipelines 
- `mapping-interface.pen` wireframe maintenance (superseded by consolidated mockup + docs)

## Further Notes

- **Issue tracker:** Publish this PRD to `regionstockholm/intehrgrator` with label `ready-for-agent` when `gh` or Jira is available.
- **Related docs:** All design decisions in `docs/` and `CONTEXT.md` supersede `INITIAL_PROMPT.md` body details and `old-clippings.md`.
- **Mockup:** `docs/assets/prototype-ui-v1-consolidated.png`
- **Deferred features:** `docs/future/` (wildcard mapping, integrated AI, text-first editor, XQuery export investigation)
