# Blockly Integration Design for openEHR

This document describes how [Google Blockly](https://developers.google.com/blockly) blocks map to openEHR structures, and the code generation strategy for TypeScript and Java targets.

## Blockly Overview

Blockly is a library for building visual block-based programming editors. Key concepts:
- **Blocks** — visual puzzle pieces representing code constructs
- **Inputs** — connection points on a block (value inputs, statement inputs)
- **Fields** — inline editable elements (text, dropdowns, checkboxes)
- **Generators** — convert visual blocks to target-language code
- **Toolbox** — categorized palette of available blocks

See: [Blockly Developer Guides](https://developers.google.com/blockly/guides/overview)

## Block Categories for openEHR

### 1. RM Structure Blocks (Container blocks)
These represent the RM containment hierarchy:

| Block | Inputs | Description |
|-------|--------|-------------|
| `composition` | `content` (statement), `context` (statement) | Root container |
| `section` | `items` (statement) | Organizer, recursive |
| `observation` | `data`, `state`, `protocol` (statements) | Measured data entry |
| `evaluation` | `data`, `protocol` (statements) | Assessment entry |
| `instruction` | `activities` (statement) | Order entry |
| `action` | `description` (statement) | Action performed |
| `item_tree` | `items` (statement) | Tree-structured data |
| `cluster` | `items` (statement) | Group of items, recursive |
| `element` | `value` (value input) | Leaf data node |

### 2. DATA_VALUE Blocks (Value shells)

Typed shells for every concrete `DATA_VALUE` leaf from ehrtslib
`subtypesOf("DATA_VALUE")` (`enhanced/meta`). Field layouts come from
`attributesFor(rmType)`: mandatory attributes shown inline; optional attributes
via the cogwheel mutator on the shell.

| Role | Behavior |
|------|----------|
| Template Skeleton | Mandatory value slots auto-attach the matching shell |
| Optional / unmapped | Empty until Click-to-Map, then lazy-insert shell around the expression |
| Toolbox | **Data values** category for type replacement |
| ELEMENT.value check | Accepts the concrete `DV_*` shell (not raw String/Number) |

Authoritative RM facts: ehrtslib `docs/RM_ATTRIBUTES.md`. Attachment picker policy
(`getValidAttachments`) stays in intEHRgrator over `attributesFor`.

### 3. Cross-Reference / Optional RM Blocks
| Block | Inputs | Description |
|-------|--------|-------------|
| `feeder_audit` | via cogwheel mutator / statement expansion | Provenance trail |
| `participation` | via cogwheel mutator | Additional participant |
| `party_identified` | via cogwheel mutator | Actor identity |
| `link` | via cogwheel mutator | Cross-reference |

Optional RM Insertion uses ehrtslib attribute meta filtered by OPT/present context
(`src/core/rm_meta.ts` → `getValidAttachments`). The UI is Blockly’s native
cogwheel mutator (`optional_rm_mutator` / `dv_fields_mutator`), not a custom `+` popup.

### 4. Control Flow & Utility Blocks

Toolbox layout and stock categories follow the Blockly DevSite landing demo
(Logic, Loops, Math, Text, Lists & maps, Variables, Functions) plus intEHRgrator
categories **Source**, **Data values**, and **Sheets**, with `@blockly/toolbox-search`
(`kind: "search"`) at the top so Search covers every `kind: "block"` drawer
including custom Source, openEHR types, Maps (`maps_*` in **Lists & maps**), and Sheets. See [Attribution](#attribution).

- **Stock Blockly (VMS landed, PR #58):** `math_arithmetic`, `text_join`,
  `text_append`, `text_trim`, `logic_ternary`, variables (`variables_set` /
  `variables_get` as `let` in the current grain). Statement `controls_if`, `while` /
  numeric `for` / stock `controls_forEach`, random, `text_print`, list-index
  mutators, and sheet mutators are **not** in the default toolbox
  (`VMS_REMOVED_BLOCK_TYPES` in `src/blockly/vms.ts`; closed
  [issue #35](https://github.com/regionstockholm/intehrgrator/issues/35)). **Sheets**
  drawer ships read-only accessors (`sheet_get_*`, `sheet_lookup`) only.
- **Logic (list restrictions):** `logic_list_restriction` reads
  “⟨all⟩ of ⟨list⟩ match ⟨condition⟩”. One dropdown covers the Manchester quantifiers
  (`all`/`any`/`none` = ∀/∃/∀¬, emitting `all_of`/`any_of`/`none_of`) and the
  cardinalities (`at least`/`at most`/`exactly` n, emitting `at_least`/`at_most`/`exactly`);
  the threshold is a numeric field shown only for the counting operators, so a computed
  threshold has to be written as a Mapping Expression instead. The list is the fillers of
  a role; the condition is class *C*, evaluated with relative source paths against each
  item. Empty-list `all`/`none`/`at most` are vacuously true (closed-world data, same
  truth table as OWL), so those three show a **require at least one item** checkbox that
  wraps the call as `and(any_of(list, v, true), …)`. `logic_current_item` (“this item”)
  references the item under test; the binder name is a text field that stays hidden until
  a restriction is nested inside another restriction’s condition, or the user picks
  **Name the current item** from the context menu. No workspace Variable is created for it.
- **Lists & maps (set class operators):** `lists_set_operation` combines two lists —
  “items in both ⟨A⟩ and ⟨B⟩” (`intersection`), “items in either ⟨A⟩ or ⟨B⟩” (`union`),
  “items in ⟨A⟩ but not in ⟨B⟩” (`difference`, arguments in reading order). It is a list
  block, not a Logic block: sharing the Logic drawer and the words `and`/`or` with the
  Boolean `logic_operation` made the two indistinguishable on the canvas.
- **Source:** `source_query` — XPath/XQuery via [fontoxpath](https://github.com/FontoXML/fontoxpath);
  typed `evaluateXPathTo*` from target slot `DV_*` type (see [SOURCE_QUERY.md](SOURCE_QUERY.md))
- **Loops & Logic (drawer):** The former Loops category is gone. `for_each_list`
  leads the **Loops & Logic** drawer, then stock Logic value blocks and list
  restrictions. `for_each_list` iterates a list / map-keys / sheet-rows **value**,
  or iterable source nodes when `source_query*` is plugged into **in** (Click-to-Map
  wraps a repeating container and stores **relative** `source_query` paths). Mapping
  Model `loops[]` records `kind: "list"` or `kind: "source"` from that LIST child.
  The **in** slot shows a union glyph (lists ☰ and source nodes 📂) and only those
  checks connect. Do not duplicate EVENT (or other repeating) blocks on the canvas;
  Test Run expands `HISTORY.events` from the loop. A kintegrate-style Source Pane
  “context root” is not required — see
  [future/source-context-root.md](future/source-context-root.md). Stock
  while/for/forEach stay registered for leftover JSON but are not in the toolbox.

### JSON Schema / XML Schema targets

When the loaded target is `json-schema` or `xml-schema`:

- **Always-visible drawers:** **JSON** (`json_object`, `json_array`, `json_value`,
  `json_boolean`, `json_null`) and **XML** (`xml_document`, `xml_element`,
  `xml_text`, `xml_cdata`, `xml_attribute`)
  for ad-hoc structure editing outside the loaded schema. `xml_element` has a
  single text slot, a stacked attributes mouth, and nested children; `xml_document`
  is the instance root that emits `<?xml …?>` plus namespaces.
- **Target schema drawer:** one flyout level of unique complex types from the
  loaded schema (no nested tree of parent/child categories). Multiple skeleton
  roots, if present, each get a single named category. Prefilled `schema_*` /
  `target_structure` blocks carry `SLOT_ID`, label, and schema type.
- **Canvas scaffold:** mandatory schema fields only at load; optional fields via the
  `schema_fields_mutator` cogwheel on `target_structure` (same UX family as openEHR
  optional RM mutators). Mapping Model `optionalRm[]` records added optional fields.
- **Default context map:** an empty unique block is placed for JSON/XSD targets — no
  openEHR default-point scaffolding.

Relevant files: `src/blockly/toolbox_demo.ts`, `src/blockly/blocks/schema_mutator.ts`,
`src/blockly/schema_catalog.ts`, `src/blockly/skeleton_loader.ts`.

## Attribution

Toolbox category set, modest theme colours, thrasos renderer styling, and
category left-border CSS are adapted from the Blockly samples
[devsite-landing-demo](https://github.com/RaspberryPiFoundation/blockly-samples/tree/main/examples/devsite-landing-demo)
(Apache License 2.0; Copyright Google LLC / Raspberry Pi Foundation). Live
reference: [blockly.com](https://www.blockly.com/) and the
[hosted demo](https://raspberrypifoundation.github.io/blockly-samples/examples/devsite-landing-demo/index.html).

Relevant intEHRgrator files:
- `src/blockly/toolbox_demo.ts`
- `src/blockly/theme.ts` (`createModestTheme`)
- `web/styles.css` (category border rules)
- `src/blockly/i18n/` (locales: en, sv, de, es, ca, fr — stock strings from
  `blockly/msg/*`, custom Source / Data values / `for_each_list` strings in
  `custom_msg.ts`)

## Code generation pipeline

```
Blockly workspace
       │
       ├──────────────────► Mapping Model (JSON)
       │                            │
       │                            ▼
       │                   Mapping Specification (text, center CodeMirror)
       │
       ▼
 Code generators (per block type)
       │
       ├──► TypeScript export (ehrtslib)  → right pane / Export TS
       └──► Java export (Archie)            → Export Java
```

**Generators walk blocks** (or Mapping Model isomorphic to blocks) — they do **not** parse the Mapping Specification text. The spec is for human edit/review; Blockly remains the structural editor.

See [MAPPING_SPECIFICATION.md](MAPPING_SPECIFICATION.md) for DSL and expression language.

Each block type has two **export** generators — TypeScript (`ehrtslib`) and Java (`Archie`) — producing semantically equivalent Generated Export code.

### Example: `dv_quantity` block (Generated Export)

**TypeScript output:**
```typescript
new DvQuantity({ magnitude: 120, units: "mm[Hg]" })
```

**Java output:**
```java
new DvQuantity("mm[Hg]", 120.0, null)
```

### Generator Architecture
```
Block Definition (JSON)
    ├── TypeScript Generator → ehrtslib code
    └── Java Generator → Archie code
```

TypeScript **and** Java conversion scripts are generated from the **Mapping Model + Template Skeleton** (`src/core/codegen/typescript.ts`, `src/core/codegen/java.ts`). Blockly canvas walking is an extra TypeScript path when a workspace snapshot is available; Java does not need a second Blockly pass. Blockly workspace JSON is identical regardless of Conversion script language.

**v1 delivery:** TypeScript export is executable in Output mode. Java export emits a compilable Archie class (see [JAVA_EXPORT.md](JAVA_EXPORT.md)) but is **not** executed in the web app. Pick **Java** in Output mode to view or download the generated class.

## Template-Driven Skeleton Generation

When a user loads an openEHR template (OPT), the system:
1. Parses the OPT structure (XML or JSON)
2. Walks the **OPT constraint tree** (schema, not instance)
3. Cross-references ehrtslib **`MANDATORY_RM_ATTRIBUTES`** (`enhanced/generation/rm_instance_generator.ts`) for silent-mandatory fields absent from the OPT — no direct BMM parsing
4. For each resulting node, generates the corresponding Blockly block pre-configured with:
   - Fixed values (e.g., `archetype_node_id`)
   - Constrained value sets (e.g., dropdown options from terminology bindings)
   - Mandatory sub-blocks already attached

**Not used for skeleton shape:** `RMInstanceGenerator` (`minimal` / `example` / `maximal`) — that produces instance data, not mapping structure. It may be used elsewhere (e.g. validation cross-check, example fixtures).

5. **Silent-mandatory RM fields** — required by RM but not in OPT — included visibly in the skeleton
6. **Optional RM attributes** — not in OPT, not RM-mandatory — **not** pre-rendered; added via cogwheel mutator + block expansion

## Silent-Mandatory vs Optional RM

| Kind | In OPT? | RM required? | Skeleton behavior |
|------|---------|--------------|-------------------|
| Template field | Yes | per OPT | Always visible |
| Silent-mandatory | No | Yes | Always visible |
| Optional RM | No | No (but valid) | cogwheel mutator + block expansion |

## Optional RM Block Expansion

RM container blocks (e.g. `observation`, `composition`) are defined with a dynamic input model:
- Initial skeleton includes OPT-required inputs **and** silent-mandatory RM inputs (always visible)
- When the user inserts an optional structure via the cogwheel mutator, `Blockly.Block` mutators add the corresponding named statement input to the parent, then attach the new child block if the mouth is empty. Removing the extra from the mutator disconnects the child onto the canvas.
- The mutator flyout lists optional attributes from RM type metadata (valid child types, cardinality) at the selected attachment point

## References
- [Blockly Guides](https://developers.google.com/blockly/guides/overview)
- [Blockly GitHub](https://github.com/google/blockly)
- [BlockMirror](https://blockpy-edu.github.io/BlockMirror/docs/) — Blockly + CodeMirror integration inspiration
- [Blockly Custom Blocks](https://developers.google.com/blockly/guides/create-custom-blocks/overview)
- [Blockly Code Generators](https://developers.google.com/blockly/guides/create-custom-blocks/generating-code)
