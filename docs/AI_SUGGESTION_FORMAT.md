# AI Mapping Suggestion Exchange Format

Link this doc in prompts; do not paraphrase. Machine-readable contract: [AI_SUGGESTION_FORMAT.schema.json](AI_SUGGESTION_FORMAT.schema.json) (JSON Schema 2020-12). **Import Suggestions** validates pasted JSON against that schema and can copy the errors back to the AI.

## Purpose

Copy-paste AI assist (and the AI chat fallback for providers without function tools): app builds a prompt → model returns one fenced JSON block → **Import Suggestions** applies it.

Live Agent API / MCP agents, and **AI chat** in mapping-tools mode, may instead map **node-by-node** with `map_slot` (one Target value slot per call). That is first-class and better for GUI transparency (canvas pulse, attributed history). Use this envelope for Copy prompt, loops, Decision tables, Sheet lookups, and other blocks `map_slot` cannot express.

Canonical mapping structure is Blockly JSON. AI returns a **slot-keyed subset** (no skeleton RM containers, ids, or `x`/`y`).

## Response

One fence tagged `intehrgrator-suggestions`. Outside the fence the answer may add brief `### Notes` and `### Questions` sections (see [Notes, questions and confidence](#notes-questions-and-confidence)); other prose is shown in AI chat but never imported.

````markdown
```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "vitals_encounter_v1" },
  "loops": [ … ],
  "suggestions": [ … ]
}
```
````

```json
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": {
    "format": "openehr-template | json-schema | xml-schema | free-form",
    "targetId": "string — must match loaded target id"
  },
  "loops": [
    {
      "attachSlotId": "string — a slot-tree group with loop: true (multiplicity 0..* / 1..*)",
      "block": {
        "type": "for_each_list",
        "fields": { "VAR": "vital" },
        "inputs": {
          "LIST": {
            "block": { "type": "source_query_node", "fields": { "EXPRESSION": "$.vitals" } }
          }
        }
      },
      "note": "optional"
    }
  ],
  "suggestions": [
    {
      "slotId": "string — slot-tree group + row id (or any full id)",
      "loopVar": "vital",
      "block": {
        "type": "source_query_number",
        "fields": { "EXPRESSION": "systolic" }
      },
      "note": "optional — risks only",
      "confidence": 75
    }
  ],
  "notes": ["optional — risks the user should know"],
  "questions": [{ "text": "optional — e.g. mmHg or kPa?", "options": ["mmHg (recommended)", "kPa"] }]
}
```

- `target.targetId` ≡ Mapping Model `templateId`. Mismatch → reject.
- Build every `slotId` as slot-tree `group` + row `id`, and `attachSlotId` from a `loop` group. Full skeleton ids from older prompts and `list_slots` `view: "rows"` are accepted too, as is a unique tail of an id.
- `loops` optional. Omit when all mappings are single-valued.
- `loopVar` optional on a suggestion; when set, must equal some `loops[].block.fields.VAR`. `EXPRESSION` is then **relative to that loop’s `PATH`** (no leading `$` / `/`). Absolute `EXPRESSION` ignores `loopVar`.
- `rmType` optional, only on a `DV_TEXT` slot ([#274](https://github.com/regionstockholm/intehrgrator/issues/274)). Every `DV_TEXT` slot also accepts its subclass `DV_CODED_TEXT`. A `maps_create_with` block with keys `value`, `code_string` and `terminology_id` maps the slot as `DV_CODED_TEXT` (inferred, no `rmType` needed). `"rmType": "DV_TEXT"` switches a coded slot back to plain text. `rmType` on any other slot is skipped with an error. Example: `{"slotId": "…/at0002/value/DV_TEXT/value", "block": {"type": "maps_create_with", "extraState": {"itemCount": 3}, "fields": {"KEY0": "value", "KEY1": "code_string", "KEY2": "terminology_id"}, "inputs": {"VAL0": {"block": {"type": "source_query", "fields": {"EXPRESSION": "$.diagnosis.display"}}}, "VAL1": {"block": {"type": "source_query", "fields": {"EXPRESSION": "$.diagnosis.code"}}}, "VAL2": {"block": {"type": "source_query", "fields": {"EXPRESSION": "$.diagnosis.codeSystem"}}}}}}`.

### Notes, questions and confidence

Use these **sparingly**, only for risks: ambiguous source, unit / coding mismatch, lossy conversion, guessed path. Never for routine confirmations ("mapped X to Y").

| Where | Field | Shown |
|---|---|---|
| per suggestion | `note` (string) | Import dialog row, AI chat, block comment on the mapped block |
| per suggestion | `confidence` (integer 0–100) | `NN%` badge in the dialog row and on the mapped block |
| per loop | `note` | Import dialog, AI chat |
| top level | `notes[]` (strings), `questions[]` (string or `{ "text", "options": [...] }`) | Notes / Questions box above the suggestions |
| outside the fence | `### Notes`, `### Questions` | same box (merged with the top-level arrays) |

- **`confidence`** is the model's estimated probability, in percent, that the mapping is correct. Integer `0`–`100`; non-integers are rounded. Any other value (string, `"high"`, out of range) is reported as a validation warning and ignored. Include it only when below about 90, or on every suggestion when the user asks for it.
- Sections outside the fence: heading level and case do not matter (`## notes:`, `**Questions**`, `Notes:` on its own line); Swedish `Anteckningar` / `Frågor` also work. Items are list lines (`-`, `*`, `1.`, `1)`). Omit empty sections.
- **Questions syntax** (the prompt asks for exactly this): each question is a numbered item ending in `?`, with its options as indented `- ` sub-bullets (max 4). At most one option ends with ` (recommended)`:

  ```markdown
  ### Questions
  1. How should missing body position be handled?
     - Default to at1001 Sitting (recommended)
     - Leave it unmapped
  ```

  The parser also accepts lettered options (`a)`, `A.`), `- ` bullets under a numbered question, a trailing `? (a / b)` choice list, `[recommended]` / `(rekommenderas)`, and a flat numbered list in which items that do not contain `?` follow a question (they become its options). In JSON, `questions[]` items are a string or `{ "text": "…?", "options": ["… (recommended)", { "text": "…", "recommended": true }] }`.
- Options render as choice buttons under the question: a click puts `> Q1: <question>` and `Answer: <option>` in the AI chat input for editing before sending. **Answer** quotes only the question.
- In tools mode, `map_slot` and `import_suggestions` take the same optional `note` and `confidence` parameters (for `import_suggestions` they are defaults for suggestions without their own). The agent ends with a 1–3 line summary plus optional Notes / Questions.

**On the canvas.** An imported `note` and `confidence` stay on the mapped value block (Blockly `data.aiReview`, so they survive save, load and export). While unreviewed, a note or a confidence below 80 shows a dashed outline, a `NN%` badge and a block comment. Bands (`CONFIDENCE_BANDS` in `src/core/ai/response_notes.ts`): below 50 red, 50–79 amber, 80+ no marker unless there is a note. Editing a field in the block records `outcome: "edited"`; right-click → **Mark as reviewed** records `outcome: "reviewed"`. Both hide the marker but keep the raw confidence plus outcome and timestamp, for later calibration of AI confidence against what users did.

### `slotId` shapes (read-only; do not invent)

| Target | Pattern |
|--------|---------|
| `openehr-template` | `{targetId}{path}` — leaves often end `/value` |
| `json-schema` | `{targetId}:{jsonPath}` |
| `xml-schema` | `{nameOrPath}:{xmlPath}` |
| `free-form` | as in the slot tree |

Unknown ids → skip on import.

### `block` subset

Blockly JSON (`type`, `fields`, `inputs`, `extraState` only). No `id`/`x`/`y`/`shadow`. App assigns ids and wraps openEHR `DV_*` shells.

**Allowed `type` (v2)**

| Family | Types | Fields / inputs |
|--------|-------|-----------------|
| Source | `source_query`, `source_query_number`, `source_query_boolean`, `source_query_node` | `EXPRESSION` (fontoxpath). Pick by `valueType`: number→`_number`, boolean→`_boolean`, node→`_node`, else plain. |
| Loop | `for_each_list` | Statement block — **only** in `loops[]`. Field `VAR` + input `LIST`. Source-node grain: `LIST` is `source_query_node` with absolute `EXPRESSION`. List grain: `LIST` is a list/sheet value. Leave `DO` empty. Legacy `for_each_source` `{ VAR, PATH }` is still accepted and rewritten. |
| Var | `variables_get` | `VAR` = loop variable name (whole node as value; rare). |
| Sheet lookup | `sheet_lookup`, `sheet_get_cell`, `sheet_get_xy`, `sheet_get_row`, `sheet_get_column`, `sheet_get_header`, `sheet_get_data` | `NAME` = Sheet name. `sheet_lookup` inputs `MATCH_COL`, `MATCH_VAL`, `RETURN_COL`. Use for **1-key terminology** (ICD-10 → SNOMED). |
| Decision table | `decision_table` | Fields `NAME`, `OUTPUT` (output column or `*` for all outputs). Input `INPUTS` = inputs Map whose keys match condition columns. Prefer when combinational rules are easier for humans to read than nested `if`. Grid document via `replace_sheets` (`kind: "decision-table"`), not this envelope. |
| Map lookup | `maps_get` | `NAME` = map name; input `KEY`. Use for **default context map** **runtime keys**, not terminology tables or scaffold-target path strings. |
| Map literal | `maps_create_with`, `maps_create_empty` | Inline key/value table: `KEY0`… fields + `VAL0`… value sockets; `extraState.itemCount`. Emits `map("k1", v1, …)`. |
| Literal | `text`, `text_code`, `math_number`, `logic_boolean` | `TEXT` / `NUM` / `BOOL` (`TRUE`\|`FALSE`). `text_handlebars` wraps a script + context Map. |
| Text | `text_trim`, `text_join` | `MODE`; `text_join` may need `extraState.itemCount` + `ADD0`… |
| Math | `math_arithmetic` | `OP`: `ADD`\|`MINUS`\|`MULTIPLY`\|`DIVIDE`; inputs `A`,`B` |
| Logic | `logic_ternary` | inputs `IF`,`THEN`,`ELSE` |
| Logic compare | `logic_compare`, `logic_operation`, `logic_negate` | `OP` `EQ`/`NEQ`/`LT`/`LTE`/`GT`/`GTE` or `AND`/`OR`; inputs `A`,`B` / `BOOL` |
| List restriction | `logic_list_restriction` | `OP` `ALL`/`ANY`/`NONE` (Manchester ∀/∃/∀¬) or `AT_LEAST`/`AT_MOST`/`EXACTLY`. Inputs `LIST`, `PRED`; fields `N` (integer threshold, counting operators only), `VAR` (item name, default `item`), `NONEMPTY` (boolean; `ALL`/`NONE`/`AT_MOST` only). Emits `all_of`/`any_of`/`none_of`/`at_least`/`at_most`/`exactly`, wrapped as `and(any_of(list, v, true), …)` when `NONEMPTY` is true. Empty list: `ALL`/`NONE`/`AT_MOST` true, `ANY` false. |
| Current item | `logic_current_item` | Field `VAR` = item name to read, or omitted for the nearest enclosing restriction. Emits `var("…")`. |
| Set class ops | `lists_set_operation` | `OP` `BOTH`/`EITHER`/`NOT_IN`; inputs `A`,`B`. Emits `intersection`/`union`/`difference(A, B)`. |

No JS wrappers (`xpathNumber("…")`). No RM containers, `DV_*` shells, Optional RM, or list-construction blocks (`lists_*`) in this envelope — list-valued RM slots stay structural on the canvas. Optional RM Insertion and Instance encoding are Agent API / MCP tools (`optional_rm_add`, `set_instance_encoding`), not suggestion blocks.

**Sheets vs Decision tables vs Maps:**

| Construct | When |
|-----------|------|
| **Sheet** + `sheet_lookup` | 1-key terminology / reference data (ICD-10 → SNOMED). |
| **Decision table** + `decision_table` | Combinational rules: several independent inputs, don't-care cells, FIRST / UNIQUE / COLLECT. Prefer this when the table is **more readable to humans** than nested `logic_ternary`. |
| **Default context map** + `maps_get` | Scaffold language / territory / encoding **runtime keys** — only when the source has no value. |

Create or replace Sheet / Decision table **documents** with `replace_sheets` (or the Sheets tab). The envelope only fills value slots.

### Loops (source ↔ target repetition)

Use when source has repeating nodes (e.g. several vitals in one encounter) and the target slot’s `multiplicity` is `0..*` / `1..*` (or a child of such a container).

1. Add one `loops[]` entry: `attachSlotId` = repeatable container; `VAR` = short name.
   - **Source nodes:** `for_each_list` with `inputs.LIST` = `source_query_node` (`EXPRESSION` = absolute fontoxpath).
   - **Computed list:** `for_each_list` with `inputs.LIST` = a list/sheet value block.
2. Map child value slots with `loopVar` = that `VAR` and **relative** `EXPRESSION` (child step(s) only).
3. One source loop ↔ one repeating target container. Do not unroll `[1]`,`[2]`,… unless the user asked for a single instance.

**Path dialects** (`PATH` / absolute `EXPRESSION`): JSON/`$…` · XML `/…` · FLAT bracket keys as in the source tree. Relative `EXPRESSION` stays relative to the loop node (e.g. `pulse`, not `$.measurements[*].pulse`).

## Prompt / input

**Copy prompt** clipboard markdown:

1. Task (source → loaded **Target instance format**)
2. Target / source schema / examples (format, filename, origin)
3. Scope `full` \| `slot`
4. Link to this doc
5. Slot tree (#277): one group per repeating container or archetype/parent node, `{ group, label, type, mult, loop?, within?, slots: [{ id, type, label?, mult, mandatory?, fixed?, units?, values?, terminology?, expr? }] }`; a slot id is `group` + row `id`. `fixed` holds template-pinned `units` / `code` / `terminology`; `values` the allowed codes (with `description` when the target documents them). Rows and groups also carry what the target says about them, first sentence only: `description`, `comment`, `annotations`, `bindings`, `ordinals`, `range`, `precision`, `pattern`, `length`, `format`, `examples`, `default`. A group's description is never repeated on its slots. `get_slot` returns the full texts (`info`, plus the group's meaning in `groupInfo`). `type` is format-native (openEHR `DV_*`, JSON Schema `string`/`number`, XSD type, or `PARTY_IDENTIFIED`). A `loop: true` group is the repeating ancestor to use as `attachSlotId` in `loops[]`. Unconstrained `DV_QUANTITY` units are not a separate value slot: put `maps_create_with` keys `magnitude` + `units` on the quantity slot. Unconstrained `DV_CODED_TEXT`: `maps_create_with` keys `value` + `code_string` + `terminology_id`. Unique constrained codes appear in `fixed.code`; lists of choices as `values`. Party identity (`composer`, `health_care_facility`) is the PARTY_IDENTIFIED container slot, not `/name/value`.
6. Artifact delivery (below)
7. Instruction: one version-`2` fence; use `loops` + relative paths when `multiplicity` is repeating (`loop` groups give the `attachSlotId`). Prefer a **Decision table** when several inputs / don't-care / hit policies make the mapping easier for humans to read than nested `if`. Prefer **`sheet_lookup`** for 1-key terminology (e.g. ICD-10 → SNOMED CT). Keep **`maps_get`** for **default context map** **runtime keys**. Target scaffold generation often wires Default point lookups (`maps_get` with `"defaults"`) before Copy prompt — **omit those slots only when the source has no value** and the user did not ask otherwise. **When the source has data for a slot that scaffold/defaults would fill, map from the source** (`source_query` / `text`); source wins over defaults. Typical examples: **context start time**, **healthcare facility**, **composer** (name/id). Party identity value slots map via `source_query` / `text` on the slot-tree leaf, not RM container blocks. Do not map source quantities onto ordinal/score fields unless the source is already that score. Copy prompt includes Sheet / Decision table previews, the Product stack, an **Optional RM Insertion** catalog (`optional_rm_add` ids), and **Constraint warnings** (`list_constraint_warnings`) when present.

### Artifact delivery

| Mode | Behavior |
|------|----------|
| `attach` | Checklist; user uploads in chat. URIs are context only. |
| `inline` | Embed bodies as multipart (`--intehrgrator-part`). |
| `uri` | Instruct AI to fetch each `originUrl`; local-only → attach checklist. |

GitHub `.t.json` closures: `uri` → root URL; `inline` → each fileset file.

**Inline part headers:** `Content-Type`, `Content-Disposition: attachment; filename="…"`, `X-Intehrgrator-Role` (`target`\|`source-schema`\|`example`\|`target-fileset`), optional `X-Intehrgrator-Origin`. Raw text body; close with `--intehrgrator-part--`.

## Import

**Import Suggestions** opens a paste dialog (clipboard is pre-filled only when the text looks like a suggestion envelope, not a Copy prompt). The pasted JSON is validated against [AI_SUGGESTION_FORMAT.schema.json](AI_SUGGESTION_FORMAT.schema.json). Schema and apply errors stay in that dialog; **Copy errors for AI** puts a follow-up prompt on the clipboard.

1. Extract fence (or raw JSON). `format` and `target` may be omitted; the loaded target is used.
2. Require `version` `"2"`; match `target` when present
3. Nested `attachSlotId` / `for_each_list` groups inside `suggestions[]` are flattened into `loops[]`. Validate loop blocks; keep `loopVar` + relative `EXPRESSION` as-is; wrap the repeating container on the canvas
4. Apply each valid suggestion `block` → value slot; skip invalid entries; report applied / skipped / errors. Slots leased by another agent are skipped (S-15). `note` / `confidence` become the block's AI review marker.
5. User **Test Run**

## Examples

**Single values**

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "json-schema", "targetId": "PatientSchema" },
  "suggestions": [
    {
      "slotId": "PatientSchema:$.patient.familyName",
      "block": {
        "type": "text_trim",
        "fields": { "MODE": "BOTH" },
        "inputs": {
          "TEXT": {
            "block": {
              "type": "source_query",
              "fields": { "EXPRESSION": "$.name.family", "RETURN_TYPE": "string" }
            }
          }
        }
      }
    }
  ]
}
```

**Terminology translation (ICD-10 → SNOMED CT)**

User prompt: *“Map diagnosis ICD-10 codes to SNOMED CT using a lookup table.”*  
Assume a named **Sheet** `icd10_snomed` (headers `code` / `snomed`) on the canvas. Lookup with dynamic key from source:

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "problem_list_v1" },
  "suggestions": [
    {
      "slotId": "problem_list_v1/content/data/items/at0002/value/value/defining_code/code_string/value",
      "block": {
        "type": "sheet_lookup",
        "fields": { "NAME": "icd10_snomed" },
        "inputs": {
          "MATCH_COL": { "block": { "type": "text", "fields": { "TEXT": "code" } } },
          "MATCH_VAL": {
            "block": {
              "type": "source_query",
              "fields": { "EXPRESSION": "$.diagnosis.icd10" }
            }
          },
          "RETURN_COL": { "block": { "type": "text", "fields": { "TEXT": "snomed" } } }
        }
      },
      "note": "Sheet icd10_snomed: I10→38341003, E11→44054006, …"
    }
  ]
}
```

For a **small inline table** without a named Sheet, nest `maps_create_with` inside `logic_ternary` branches only when a Decision table would be overkill (one or two codes). Prefer `sheet_lookup` or a Decision table for anything a human should maintain.

**Decision table (systolic band)** — grid already on the project as `kind: "decision-table"` named `sbp_band` (condition `sbp`, output `band`):

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "json-schema", "targetId": "DummyVitalsTarget" },
  "suggestions": [
    {
      "slotId": "DummyVitalsTarget:$.band",
      "block": {
        "type": "decision_table",
        "fields": { "NAME": "sbp_band", "OUTPUT": "band" },
        "inputs": {
          "INPUTS": {
            "block": {
              "type": "maps_create_with",
              "extraState": { "itemCount": 1 },
              "fields": { "KEY0": "sbp" },
              "inputs": {
                "VAL0": {
                  "block": {
                    "type": "source_query_number",
                    "fields": { "EXPRESSION": "$.systolic" }
                  }
                }
              }
            }
          }
        }
      },
      "note": "Prefer a Decision table over nested if for readable SBP bands"
    }
  ]
}
```

**DV_QUANTITY with source units** — unconstrained units live on the DV shell, not a sibling value slot. Put `magnitude` and `units` on the quantity slot with `maps_create_with` (Test Run unpacks the map):

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "AdministreradMedicinskOnkologiskBehandlingPerSubstans" },
  "suggestions": [
    {
      "slotId": "AdministreradMedicinskOnkologiskBehandlingPerSubstans//content[openEHR-EHR-ACTION.medication.v1]/description/at0017/items/at0000/items/at0139/value/value/value",
      "loopVar": "substans",
      "block": {
        "type": "maps_create_with",
        "extraState": { "itemCount": 2 },
        "fields": { "KEY0": "magnitude", "KEY1": "units" },
        "inputs": {
          "VAL0": {
            "block": { "type": "source_query_number", "fields": { "EXPRESSION": "Dose" } }
          },
          "VAL1": {
            "block": { "type": "source_query", "fields": { "EXPRESSION": "UnitCode" } }
          }
        }
      }
    }
  ]
}
```

**DV_CODED_TEXT with source code + terminology** — unconstrained coded text is still one value socket. Put `value`, `code_string`, and `terminology_id` on that slot with `maps_create_with` (Test Run nests `defining_code`):

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "AdministreradMedicinskOnkologiskBehandlingPerSubstans" },
  "suggestions": [
    {
      "slotId": "AdministreradMedicinskOnkologiskBehandlingPerSubstans//content[openEHR-EHR-EVALUATION.reason_for_encounter.v1]/data/at0001/items/at0004/value/DV_CODED_TEXT/value",
      "block": {
        "type": "maps_create_with",
        "extraState": { "itemCount": 3 },
        "fields": { "KEY0": "value", "KEY1": "code_string", "KEY2": "terminology_id" },
        "inputs": {
          "VAL0": {
            "block": { "type": "source_query", "fields": { "EXPRESSION": "$.Diagnosnamn_ICD10" } }
          },
          "VAL1": {
            "block": { "type": "source_query", "fields": { "EXPRESSION": "$.Diagnoskod_ICD10" } }
          },
          "VAL2": {
            "block": { "type": "text", "fields": { "TEXT": "1.2.752.116.1.1.1" } }
          }
        }
      }
    }
  ]
}
```

**Source over defaults (composer, time, facility)** — scaffold may already use `maps_get("defaults", …)`; when the source has values, map from source. Composer / facility are **PARTY_IDENTIFIED** slots (slot-tree `type`), not a `/name/value` DV_TEXT leaf. `maps_create_with` keys `name`, `id`, `type` unpack RM `name` (string) and `identifiers[]` (`DV_IDENTIFIER.id`):

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "vitals_encounter_v1" },
  "suggestions": [
    {
      "slotId": "vitals_encounter_v1/context/start_time/value",
      "block": {
        "type": "source_query",
        "fields": { "EXPRESSION": "$.encounter.startTime" }
      }
    },
    {
      "slotId": "vitals_encounter_v1//composer",
      "block": {
        "type": "maps_create_with",
        "extraState": { "itemCount": 3 },
        "fields": { "KEY0": "name", "KEY1": "id", "KEY2": "type" },
        "inputs": {
          "VAL0": {
            "block": { "type": "source_query", "fields": { "EXPRESSION": "$.author.displayName" } }
          },
          "VAL1": {
            "block": { "type": "source_query", "fields": { "EXPRESSION": "$.author.id" } }
          },
          "VAL2": {
            "block": { "type": "text", "fields": { "TEXT": "urn:oid:1.2.752.29.4.19" } }
          }
        }
      }
    }
  ]
}
```

**Defaults lookup (language)** — scaffold fallback only when source has no value and user did not override:

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "vitals_encounter_v1" },
  "suggestions": [
    {
      "slotId": "vitals_encounter_v1/language/value",
      "block": {
        "type": "maps_get",
        "fields": { "NAME": "defaults" },
        "inputs": {
          "KEY": { "block": { "type": "text", "fields": { "TEXT": "*.language" } } }
        }
      },
      "note": "Only when source has no language and user did not specify otherwise"
    }
  ]
}
```

**Repeating vitals → repeating target**

```intehrgrator-suggestions
{
  "format": "intehrgrator-suggestions",
  "version": "2",
  "target": { "format": "openehr-template", "targetId": "vitals_encounter_v1" },
  "loops": [
    {
      "attachSlotId": "vitals_encounter_v1/content/data/events",
      "block": {
        "type": "for_each_list",
        "fields": { "VAR": "vital" },
        "inputs": {
          "LIST": {
            "block": { "type": "source_query_node", "fields": { "EXPRESSION": "$.vitals" } }
          }
        }
      }
    }
  ],
  "suggestions": [
    {
      "slotId": "vitals_encounter_v1/content/data/events/data/items/at0004/value/value/value",
      "loopVar": "vital",
      "block": {
        "type": "source_query_number",
        "fields": { "EXPRESSION": "systolic" }
      }
    },
    {
      "slotId": "vitals_encounter_v1/content/data/events/data/items/at0005/value/value/value",
      "loopVar": "vital",
      "block": {
        "type": "source_query_number",
        "fields": { "EXPRESSION": "diastolic" }
      }
    }
  ]
}
```

## Related

[MAPPING_SPECIFICATION.md](MAPPING_SPECIFICATION.md) · [BLOCKLY_INTEGRATION.md](BLOCKLY_INTEGRATION.md) · [SOURCE_QUERY.md](SOURCE_QUERY.md) · [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) · [future/integrated-ai-assist.md](future/integrated-ai-assist.md) · [AI_SUGGESTION_FORMAT.schema.json](AI_SUGGESTION_FORMAT.schema.json)
