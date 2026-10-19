# Source Formats (v1)

## Supported inputs

| Format | v1 | Load | Query |
|--------|-----|------|-------|
| JSON schema | ✓ | `JSON.parse` | fontoxpath (authoring / click-to-map from schema tree) |
| Avro schema (`.avsc` JSON) | ✓ | Record/`fields` tree | Same JSON evaluator; instances stay JSON |
| JSON instance | ✓ | `JSON.parse` | fontoxpath (example tabs + Test Run) |
| XML instance | ✓ | `DOMParser` | fontoxpath (example tabs + Test Run) |
| XML schema (XSD) | Deferred | — | [future/xml-schema-support.md](future/xml-schema-support.md) |
| openEHR Composition (canonical JSON) as source | ✓ | `openehr-composition` / `openehr-canonical-json` | fontoxpath over JSON tree |
| openEHR FLAT JSON as source | ✓ | `openehr-flat-json` | Bracketed path keys (`ctx/…`, `\|magnitude`) |
| openEHR STRUCTURED JSON as source | ✓ | `openehr-structured-json` | Same JSON evaluator; simplified-format leaf detection |
| openEHR Web Template as Source Schema | ✓ | `openehr-web-template` | Tree from `templateId` + `tree` |

## Source Format Handler

Callers (Click-to-Map, Test Run, instance validation, schema load) go through a small **Source Format Handler** interface instead of branching on `"json" | "xml"` in every module:

| Method | Role |
|--------|------|
| `loadSchema(content, rootName?)` | Schema tree for the Source Pane |
| `loadInstance(content, rootName?)` | Example-instance tree |
| `pathToExpression(schemaPath)` | Tree path → fontoxpath string for Mapping Expressions |
| `createContext(content)` | Runtime context for evaluation |
| `evaluate(expression, ctx, returnType)` | Run a Mapping Expression against that context |

Built-in adapters: **JSON** (JSON Schema, Avro `.avsc` records, or inferred instance shape), **XML**, and openEHR-as-source ids above. Register more with `registerSourceFormatHandler`. An `.avsc` file is **not** treated as a JSON instance of the Avro document (that would expose `fields` / `namespace` as source paths); the JSON handler walks Avro `record.fields`.

| Module | Path |
|--------|------|
| Interface + registry | `src/core/source/format_handler.ts` |
| Public re-exports | `src/core/source/mod.ts` |
| Format id on bundles | `SourceFormatId` in `src/types/mod.ts` |

Low-level helpers (`schema_loader`, `query_runtime`) remain implementation details of the adapters; new formats should not require forking the workbench controller.

## Source Pane layout

The left pane separates **schema** from **example instances**:

| Section | Purpose | Required? |
|---------|---------|-----------|
| **Schema tree** (upper) | Structural view for authoring mappings | Optional but typical — schema file (JSON, XML, or other format) or structure inferred from first example |
| **Example tabs** (lower) | One or more JSON/XML instance files as tabs | Optional for authoring; **required for Test Run** |

See [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) — Source Pane.

## Query layer

All source path expressions use **fontoxpath** (XPath 3.1 / XQuery 3.1) for both JSON and XML. See [SOURCE_QUERY.md](SOURCE_QUERY.md).

Click-to-map works from **either** the schema tree or the **active example tab** tree; both insert fontoxpath expressions into `source_query` blocks via `handler.pathToExpression`.

## Iteration / “context root”

kintegrate’s “Frame this node as context root” is **not** planned as a Source Pane feature. Blockly `for_each_source` (and stock loops) already bind iteration scope. See [future/source-context-root.md](future/source-context-root.md).

## openEHR XML (ehrtslib alignment)

**`fast-xml-parser`** remains the library for openEHR RM XML serialization/deserialization — same as [ehrtslib](https://github.com/ErikSundvall/ehrtslib). It is **not** used for traversing user source files.

## Schema-only authoring

- Informatician can map against the **schema tree** without any example loaded.
- **Test Run** and **Autoplay** require at least one **example instance tab**; toggle stays disabled until then.
- Adding the first example via **+ Add Example** enables Test Run.

## Test Run output

Converted instance results are displayed. The lower **Conversion Test Run(s)** section always reflects the **active example tab** from the source pane's examples section.

## Related

- [SOURCE_QUERY.md](SOURCE_QUERY.md) — fontoxpath, typed evaluators
- [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) — Source Pane, example tabs
- [PROJECT_PERSISTENCE.md](PROJECT_PERSISTENCE.md) — multiple examples in bundle
- [future/source-context-root.md](future/source-context-root.md) — context root vs `for_each_source`
- [CONTEXT.md](../CONTEXT.md) — Source Schema, Example Instance, Active Example
