# Source Query Layer (fontoxpath)

Unified source access for JSON and XML using [fontoxpath](https://github.com/FontoXML/fontoxpath) (XPath 3.1 / XQuery 3.1, pure JavaScript, browser-compatible).

## Why fontoxpath

- **One query language** for JSON and XML sources — no parallel dot-path vs XPath conventions
- **Typed evaluators** — `evaluateXPathToString`, `evaluateXPathToNumber`, `evaluateXPathToBoolean`, etc. map cleanly to openEHR `DV_*` target slots
- **GH Pages compatible** — no server; runs in-browser alongside ehrtslib Test Run

## Library split

| Concern | Library | Role |
|---------|---------|------|
| Source **querying** | `fontoxpath` | Evaluate mapping expressions against loaded source |
| openEHR RM **XML** (composition I/O) | `fast-xml-parser` | Same as ehrtslib — RM serialization/deserialization only |
| JSON **parse** | `JSON.parse` | Load JSON instance/schema into memory |
| XML **parse** (for XPath) | `DOMParser` (browser) | XML instance → DOM nodes for fontoxpath |

Do not use `fast-xml-parser` for source path traversal; use fontoxpath on the appropriate context (JSON value or XML DOM).

## Path syntax

All `get_source` / source-query blocks store an **XPath or XQuery expression** string. Click-to-map inserts an expression valid for the loaded source kind.

| Source kind | Context passed to fontoxpath | Example expression |
|-------------|------------------------------|--------------------|
| JSON instance | Parsed JSON (map/array context) | `$.patient.vitals?1.systolic` or XQuery JSON syntax per fontoxpath |
| JSON schema | Schema structure as navigable tree | Structural paths for authoring; Test Run still needs instance |
| XML instance | `DOMParser` document node | `/patient/vitals[1]/systolic`; openEHR locators `/content[at0003]` compile to `[@archetype_node_id='at0003']` before evaluation |
| Canonical JSON RM | Parsed JSON map | `/content[openEHR-EHR-ACTION.medication.v1]` compiles to `$source?content?*[?archetype_node_id = '…']` |

Exact JSON path authoring rules will follow fontoxpath's JSON/XQuery conventions during implementation; the Source Pane tree generates compatible expressions on click-to-map.

## Typed evaluators ↔ target slot types

When a value slot is bound to a target `DV_*` type, the app selects the fontoxpath convenience function automatically:

| Target RM value type | fontoxpath evaluator | Generated TS sketch |
|---------------------|----------------------|---------------------|
| `DV_TEXT`, `DV_CODED_TEXT`, `DV_URI`, `DV_EHR_URI` | `evaluateXPathToString` | `evaluateXPathToString(expr, sourceCtx, …)` |
| `DV_QUANTITY`, `DV_COUNT`, `DV_INTEGER`, `DV_PROPORTION` (magnitude) | `evaluateXPathToNumber` | `evaluateXPathToNumber(…)` |
| `DV_BOOLEAN` | `evaluateXPathToBoolean` | `evaluateXPathToBoolean(…)` |
| `DV_DATE`, `DV_TIME`, `DV_DATE_TIME`, `DV_DURATION` | `evaluateXPathToString` | String + RM parse/wrap in generator |
| `DV_ORDINAL` | `evaluateXPathToNumber` | Number → ordinal wrapper in generator |
| Repeatable / multi-value slots | `evaluateXPathToArray`, `evaluateXPathToStrings`, or `evaluateXPathToNumbers` | Per cardinality in mapping block |

The Blockly `source_query` block carries:
- `expression` — XPath/XQuery string
- `returnType` — derived from parent element slot (set automatically, not user-edited)

Codegen picks the matching `evaluateXPathTo*` import from `fontoxpath`.

## Blockly block: `source_query`

Replaces the earlier `get_source("dot.path")` sketch.

- **Inputs:** none (expression in field or nested string block)
- **Fields:** `EXPRESSION` (text), `RETURN_TYPE` (hidden/shadow — from parent slot)
- **Output:** typed to match parent `DV_*` value input
- **Click-to-map:** inserts expression into `EXPRESSION`; `RETURN_TYPE` already set from slot

## Performance note

fontoxpath supports `compileXPathToJavaScript` for hot paths. Consider caching compiled expressions for Test Run / Autoplay; fall back to `evaluateXPath` when compilation is unsupported.

## Related

- [SOURCE_FORMATS.md](SOURCE_FORMATS.md) — supported file formats
- [BLOCKLY_INTEGRATION.md](BLOCKLY_INTEGRATION.md) — `source_query` block category
- [CONTEXT.md](../CONTEXT.md) — Source Path
