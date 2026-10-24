# Textual languages for mapping authoring

**Status:** Investigation — captured 2026-09-07. No language or editor change yet.

Companion to [text-first-mapping-editor.md](text-first-mapping-editor.md) (CodeMirror widgets / Blockly-optional UI). This note asks: **if** the Mapping Editor grows a real text surface, which language is compact and readable for informaticians who prefer typing over Blockly?

## Product constraints (do not ignore)

From [ADR 0001](../adr/0001-mapping-and-target-seams.md), [MAPPING_SPECIFICATION.md](../MAPPING_SPECIFICATION.md), and `CONTEXT.md`:

| Constraint | Implication for a text language |
|------------|----------------------------------|
| Native **Blockly workspace JSON** is the canonical Mapping Specification | A text language is a **projection** (or a later replacement of Blockly), not a third source of truth. The old private `@template` DSL was removed because it duplicated Blockly. |
| Blockly is used **declaratively**: slot tree + constructors + lookups, not statement-order programs | Prefer declarative / expression / path-pair languages over Python/JS “BlockMirror” scripts. |
| **Mapping Model** (`slots[]`, `loops[]`, expressions) is the derived semantic index | The cheapest text surface is a readable rendering of that index, not a new IR. |
| Source Paths are already **XPath/XQuery** via fontoxpath | Reusing that dialect beats introducing FHIRPath / JSONata / jq as a *second* query language unless JSON-only mappings dominate. |
| Mapping Expression AST is a small sandboxed subset: `xpath*`, `trim`, `concat`, `if`, `switch`, `maps_get`, sheet accessors, `for_each_source` | Leaf values already have a compact textual form. The missing piece is **structure + iteration + lookups**, not a new calculator. |
| Conversion script languages already exist: TypeScript, Java, Handlebars, XQuery, Go template | Those are **exports / runtimes**, not the authoring language — except Handlebars, which already has an Authored Template tab ([ADR 0004](../adr/0004-go-template-codegen-only.md) keeps Go template codegen-only). |
| AI already speaks a **slot-keyed Blockly subset** (`intehrgrator-suggestions` v2) | Any text language should round-trip through the same `slotId` / `attachSlotId` / `loopVar` vocabulary. |

_Contradicts ADR 0001 if a new language becomes canonical persistence._ Worth reopening only after a projection has been used in anger.

## What the example sets actually need

The catalog in `examples/example-sets.json` (assets under `test/fixtures/`) is two different jobs:

| Example set | Shape of the mapping | Compact text analog |
|-------------|----------------------|---------------------|
| `dummy-json-vitals-mapped`, `Simple-vitals` | Fill named target slots from source paths + Defaults Map | YAML/JSON **slot table** |
| `chemo-symptoms-flat-to-tc-xml`, `lung-mdt-form-to-tc-xml` | Build a TakeCare `ProfdocHISMessage` tree: schema blocks, `controls_if`, Defaults Map header, `text_code` notes | **Template** (Handlebars / Go template) or **XQuery element constructors** |

No single off-the-shelf language is both (a) a 10-line slot table for dummy vitals and (b) a readable rewrite of the production chemo/MDT scripts. Pick by **mapping style**, or accept two projections sharing the Mapping Model.

Illustrative slot-fill for dummy vitals (source `systolic`/`diastolic`/`unit` → JSON Schema target):

```yaml
target: DummyVitalsTarget
defaults: defaults
slots:
  systolic:  xpathNumber("$.systolic")
  diastolic: xpathNumber("$.diastolic")
  unit:      xpathString("$.unit")
```

The Blockly JSON for the same stub is an empty workspace today; a filled one is still dozens of `type`/`fields`/`inputs` objects. That compactness gap is the whole point of a text surface.

## Recommendation (ranked)

### 1. Best fit: YAML **slot projection** of the Mapping Model (FHIRconnect-shaped)

**Use as the Mapping Spec tab language** for `openehr-template` / `json-schema` / `xml-schema` targets.

- Compact: one line per mapped slot; loops as a short header; Defaults Map / Sheet names as bindings, not inlined tables.
- Readable: path-to-path YAML is how informaticians already document mappings (FHIRconnect, OMOCL).
- Round-trip: generate from Mapping Model + skeleton labels; parse edits back with `applyExpressionEdit` / `upsertLoop`. Structure (Template Skeleton, Optional RM Insertion) stays Blockly-owned — same Sync Scope as v1.
- Does **not** revive the deleted `@template` DSL: the YAML does not restate RM containers.

Inspiration (not a drop-in grammar):

- FHIRconnect YAML: [spec](https://github.com/SevKohler/FHIRconnect-spec), [Better mapping spec](https://github.com/better-care/fhir-connect-mapping-spec), [paper](https://arxiv.org/abs/2511.14618)
- Shared header dialect with OMOCL (openEHR → OMOP)

FHIRconnect itself is **FHIR ↔ openEHR** and assumes template-time inference of `DV_*` shells. intEHRgrator also maps generic JSON/XML and TakeCare XSD, so borrow the *look* (YAML path pairs, named types, conditions) rather than the engine.

### 2. Best “real language” for mixed JSON/XML: **XQuery 3.1**

**Use when the user is constructing a target tree** (TakeCare XML, free-form), or wants one language for query *and* transform.

- Source Paths are already XPath/XQuery; [fontoxpath](https://github.com/FontoXML/fontoxpath) evaluates XQuery 3.1 in the browser (element constructors + JSON maps/arrays; not every F&O function).
- Direct element constructors are the compact text of `xml_element` / `xml_attribute` / `xml_text` + `controls_if`:

```xquery
element ProfdocHISMessage {
  attribute MsgType { "Request" },
  element PatId { maps_get("defaults", "PatientId") },
  if ($fatigue ne "Nej") then
    element TextKeyWord {
      element TermId { 2811 },
      element Note { $fatigue-note }
    }
  else ()
}
```

- Already a Conversion script language ([xquery-export-investigation.md](xquery-export-investigation.md)); promoting it to an *authoring* tab is a product decision, not a green-field parser.
- Spec: [XQuery 3.1](https://www.w3.org/TR/xquery-31/), [XPath 3.1](https://www.w3.org/TR/xpath-31/)
- Cost: bidirectional Blockly sync of full XQuery is hard; treat XQuery as a **projection of the tree**, same as Go template codegen, not as a BlockMirror pair.

### 3. Best compact JSON→JSON transform: **JSONata**

If JSON Schema targets become the common case and informaticians want to *write the output object*:

```jsonata
{
  "systolic":  systolic,
  "diastolic": diastolic,
  "unit":      unit ? unit : "mm[Hg]"
}
```

- XPath-inspired, declarative, tiny, JS-native, playground at [try.jsonata.org](https://try.jsonata.org/).
- Docs: [docs.jsonata.org](https://docs.jsonata.org/), [github.com/jsonata-js/jsonata](https://github.com/jsonata-js/jsonata)
- Cost: **second query dialect** beside fontoxpath; weak on XML and openEHR `DV_*` shells.

### 4. Already in the product — keep as text for tree-construction, not as the Spec language

| Surface | Role today | Text-first role |
|---------|------------|-----------------|
| **Handlebars** | Authored Template tab; Kintegrate; lung-MDT production scripts | Best *existing* text for TakeCare-style XML if users already own those scripts |
| **Go `text/template`** | Codegen-only ([ADR 0004](../adr/0004-go-template-codegen-only.md)); chemo reference scripts | Do not add an authoring tab; the Blockly XML/schema tree is the edit surface |
| **Mapping Expression** | `xpathNumber("$.systolic")` in slots | Keep as the **leaf language** inside YAML / widgets |
| **`intehrgrator-suggestions` JSON** | AI import | Machine-oriented sibling of the YAML slot projection — do not ask humans to type it |

## Other languages (why not first)

### Healthcare mapping languages

| Language | Compact / readable? | Why not first |
|----------|---------------------|---------------|
| **FHIR Mapping Language** (StructureMap) | Medium. `src.systolic -> tgt.systolic` is nice; groups/ConceptMaps add weight. | FHIRPath-based, Trial Use / Maturity 0, FHIR-centric engine. Spec: [hl7.org/fhir/mapping-language.html](https://hl7.org/fhir/mapping-language.html), [StructureMap](https://hl7.org/fhir/structuremap.html), [FML IG](https://build.fhir.org/ig/HL7/mapping-language-ig/fml.html). Steal the *rule* look, not the runtime. |
| **FHIRPath** | Compact for navigation | Extraction + invariants, not instance construction. [hl7.org/fhirpath](https://hl7.org/fhirpath/). Overlaps Source Paths without replacing `DV_*` / XML trees. |
| **CQL** | Readable for clinicians | Clinical quality / CDS, not ETL mapping. [cql.hl7.org](https://cql.hl7.org/01-introduction.html). |
| **openEHR AQL** | Familiar to CDR users | Query of stored EHRs, not source→target conversion. |

### Config / constraint languages

| Language | Compact / readable? | Why not first |
|----------|---------------------|---------------|
| **CUE** | Very, for data+schema unification | Excellent *instance* language; poor *mapping-rule* language. Go-centric toolchain. [cuelang.org](https://cuelang.org/docs/introduction/). Better as a verification/export cousin ([formal-verification-export.md](formal-verification-export.md)) than as Blockly’s twin. |
| **Nickel / Jsonnet / Dhall** | Jsonnet is JSON-plus-functions (readable); Nickel/Dhall heavier | Generate target documents, not slot mappings. [nickel-lang.org](https://nickel-lang.org/user-manual/introduction/), [jsonnet.org](https://jsonnet.org/), [dhall-lang.org](https://dhall-lang.org/). |
| **CEL** | Compact C-like expressions | Predicates, not tree transforms. [cel.dev](https://cel.dev/overview/cel-overview), [cel-spec](https://github.com/cel-expr/cel-spec). Could replace the Mapping Expression AST later; not the Spec document. |

### JSON/XML processors

| Language | Compact / readable? | Why not first |
|----------|---------------------|---------------|
| **jq** | Compact, often cryptic | JSON-only; WASM possible but a new dialect. [jqlang.org](https://jqlang.org/). |
| **XSLT 3.0** | Verbose | Loses to XQuery for authoring; same XPath foundation. |
| **RML / R2RML** | RDF-shaped | Wrong data model unless a knowledge-graph target appears. |

### Blockly ↔ text “same language” (BlockMirror pattern)

[BlockMirror](https://github.com/blockpy-edu/BlockMirror) / [BlockPy](https://github.com/blockpy-edu/blockpy) sync Blockly with **Python**. Blockly’s official generators (JS, Python, Lua, PHP, Dart) are **one-way**. Official Blockly does not parse text back into blocks ([DeepWiki google/blockly](https://deepwiki.com/google/blockly)).

Python/JS as the mapping authoring language would:

- fight the declarative canvas (loops as statements, RM trees as object literals),
- explode the sandbox (the expression parser already forbids `import` / `eval` / `fetch`),
- duplicate Conversion script TypeScript.

Use BlockMirror as a **UI sync pattern** only — already noted in [UI_ARCHITECTURE.md](../UI_ARCHITECTURE.md).

## How this should sit in the editor

Align with the existing text-first plan; do not add a third persistence format.

```text
Blockly workspace JSON          ← canonical (ADR 0001)
        │
        ▼
Mapping Model (slots, loops, expressions)
        │
        ├── Mapping Spec YAML / widgets   ← human text for slot-fill
        ├── Handlebars / XQuery tab       ← human text for tree-construction
        └── Conversion scripts            ← generated (TS, Java, Go template, …)
```

Practical sequence:

1. **Improve Mapping Spec widgets** so the current Blockly JSON view *looks* like the YAML slot table (collapse skeleton, show `slot ← expression`, edit safe fields). This is the [text-first-mapping-editor.md](text-first-mapping-editor.md) path and does not pick a new language.
2. **Optional YAML download/upload** of Mapping Model slots+loops (human-editable sibling of `intehrgrator-suggestions`). Same Sync Scope.
3. **Only if tree-construction users still want text:** an XQuery (or Handlebars) projection of the schema/XML block tree — codegen first, parse-back later.

## Anti-patterns

- A new private `@template` DSL that reprints the Template Skeleton.
- Making TypeScript / Python / Go template the *authoring* Mapping Specification.
- Bidirectional Blockly ↔ full XQuery/JSONata on day one (BlockMirror-scale engineering).
- Replacing fontoxpath Source Paths with FHIRPath or JSONata paths in the same workspace.

## Related (in-repo)

- [text-first-mapping-editor.md](text-first-mapping-editor.md) — CodeMirror decorations
- [xquery-export-investigation.md](xquery-export-investigation.md) — XQuery as conversion script
- [formal-verification-export.md](formal-verification-export.md) — contracts, not authoring
- [AI_SUGGESTION_FORMAT.md](../AI_SUGGESTION_FORMAT.md) — slot-keyed interchange
- [SOURCE_QUERY.md](../SOURCE_QUERY.md) — fontoxpath
- Example sets: `examples/example-sets.json`

## External links (primary)

- FHIR Mapping Language: https://hl7.org/fhir/mapping-language.html
- FHIRconnect: https://github.com/SevKohler/FHIRconnect-spec · https://arxiv.org/abs/2511.14618
- Better FHIRconnect mapping spec: https://github.com/better-care/fhir-connect-mapping-spec
- JSONata: https://docs.jsonata.org/ · https://github.com/jsonata-js/jsonata
- XQuery 3.1: https://www.w3.org/TR/xquery-31/
- fontoxpath: https://github.com/FontoXML/fontoxpath
- CUE: https://cuelang.org/docs/introduction/
- CEL: https://cel.dev/overview/cel-overview
- BlockMirror: https://github.com/blockpy-edu/BlockMirror
- jq: https://jqlang.org/
- CQL: https://cql.hl7.org/01-introduction.html
- FHIRPath: https://hl7.org/fhirpath/
