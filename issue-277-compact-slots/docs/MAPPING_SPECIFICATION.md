# Mapping Specification

The canonical Mapping Specification is Blockly workspace JSON from
`Blockly.serialization.workspaces.save`. It is persisted in
`ProjectBundle.mapping.blocklyState`.

The Mapping Editor **Mapping Spec** tab shows a **compact projection** of
the Blockly workspace: one row per semantic mapping (containers, source
paths, map lookups, literals, text-generation, flattened conditions).
Layout chrome such as `x`/`y` is omitted; an ⓘ control on the row still
reveals those details. When a block fills a named attribute slot
(`language`, `magnitude`, ELEMENT `value`, …), the widget shows that
attribute name at the start of the row. Nested same-operator `AND`/`OR`
trees fold into one “all of” / “any of” row. Indent folding in the fold
gutter collapses containers without dropping mapping rows from the
document.

Passthrough wrappers (`xml_text`, `DV_*` shells, `code_phrase`, unnamed
`maps_create_with`) and nested same-operator `AND`/`OR` trees are elided
so the mapping meaning stays visible without Blockly JSON scaffolding.
**Safe fields** are editable in the widgets (source paths, map keys,
literals, `text_code` snippets, compare operands, loop variable/path,
TERM_PICK set/code). Long pick lists type-to-filter in both the Spec
widgets and the Blockly dropdowns; only catalog-valid combinations can
be chosen.
Structure changes stay in Blockly.

Download/Upload still round-trip the **full Blockly workspace JSON** so a
mapping can be reproduced exactly. The Spec document itself is not that
JSON.

The former private `@template ...` DSL has been removed. It duplicated Blockly
structure and was not an interchange format used by other tools.

## Two representations, one structural truth

```text
Blockly workspace JSON (canonical structure)
                 │
                 ▼
Mapping Model slots[] (derived semantic index)
                 │
        ┌────────┴────────┐
        ▼                 ▼
 Test Run interpreter   Conversion script language adapter
```

- Blockly JSON owns block structure, fields, inputs, mutation state, ids, and
  workspace coordinates.
- Mapping Model is rebuilt from value-slot blocks after workspace changes. It
  is the small semantic index used by validation, AI
  suggestions, code generation, and Test Run.
- Project Bundles persist both. On load, Blockly JSON restores the workspace;
  subsequent changes regenerate the Mapping Model.
- Click-to-Map updates the Mapping Model and the corresponding Blockly
  expression block as one undoable canvas action. The next workspace change
  reasserts Blockly JSON as the authority.
- Constraint warnings (yellow triangles) appear on Blockly blocks and matching
  Mapping Spec widgets. The Spec pane also draws orange ticks on the right-hand
  overview ruler so every warning can be found without scrolling; clicking a
  tick selects that block (same as clicking the spec row).

## Target instance format versus conversion script language

These are separate settings:

- **Target instance format** describes the shape of produced instances
  (adhering to `openehr-template`, `json-schema`, `xml-schema`, or
  `free-form`).
- **Conversion script language** describes the executable representation
  authored or generated (`typescript`, `java`, `handlebars`, or `xquery`).

This separation allows a Handlebars conversion script to produce clinical
prose, CSV, HTML, JSON, XML, or another non-openEHR format.

## Handlebars on the canvas

VMS-Hbs lives on a **Handlebars text block** (`text_handlebars`) whose SCRIPT is
typically a **Code text block** (LANG = Handlebars). Loading a free-form `.hbs`
target seeds that product. Convert accepts the ADR 0009 whitelist (`if`,
`unless`, `each`, `eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `and`, `or`,
`toLowerCase`, `toUpperCase`, `slot`) and rejects `#with` / `lookup` / `#log`
/ partials. `{{slot "target-slot-id"}}` reads Mapping Model slot values.

Source Pane clicks insert a VMS-Hbs path when a Code text block (LANG =
Handlebars) or a Handlebars text block is selected. Shift+click inserts nested
`#with`/`#each` (same modes as the retired Template-tab toolbar; `#with` is
flagged by VMS lint). Otherwise Listening Mode fills the waiting Source query
block.

## Versioning

`MappingModel.modelVersion` is currently `3` (loops with `kind`, nested
`targetSignature`, explicit `unsupported` / escape-hatch records, `sheetNames`).
The index is rebuilt from Blockly on workspace change.
Blockly JSON is persisted in its full native form; UI-only coordinates may
be filtered in future review projections, but are retained in Project Bundles
for exact restoration.

Blockly is pinned through `deno.json`. A major Blockly upgrade must include a
Project Bundle round-trip test of the current format.
