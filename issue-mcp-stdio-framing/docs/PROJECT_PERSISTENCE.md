# Project Persistence

Projects are saved as **self-contained workspaces**.

The web app persists projects in IndexedDB and can export/import the same data as a single `.intehrgrator` file. A saved project must be enough to resume authoring and run examples without asking the user to re-load the original template/source files.

## Project Bundle Contents

| Area | Contents |
|------|----------|
| Target | Format-neutral `target` (OPT, JSON Schema, XML Schema, or free-form): content, filename, id, parsed skeleton |
| Source | Source Schema content + metadata |
| Examples | Array of example instances `{ id, filename, format, content }`, plus `activeExampleId` |
| Mapping | Native Blockly workspace JSON (canonical) and a derived Mapping Model snapshot |
| Settings | Theme, validation, model language. **Output mode** is session-only and is not restored |
| Metadata | Project id, app version, created/updated timestamps |

Generated Export and Test Run output are **not** stored — they are rebuilt from the Mapping Specification after load.

## Mapping serialization

The bundle stores Blockly workspace JSON as the structural Mapping Specification. A Mapping Model snapshot travels with it (`modelVersion`, `templateId`, `slots[]`, `optionalRm[]`, `loops[]`, …) for AI **Import Suggestions** and codegen. On load, Blockly JSON restores the canvas; later workspace changes rebuild the Mapping Model.

**Not in Mapping Model:** Conversion script language / Output mode.

## Storage

- **IndexedDB**: primary web app persistence (`saves` store: autosave + manual snapshots).
- **`.intehrgrator` export**: portable JSON bundle for sharing, backup, or moving between browsers.
- **Import**: validates bundle version and mapping model shape before loading.

## Non-goals

- Do not rely on local filesystem paths in v1; GitHub Pages cannot safely reopen arbitrary files later.
- Do not store API keys in the project bundle.
- Do not make `.intehrgrator` a long-term interchange standard yet; it is an app workspace format.

## Related

- [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) — Save Project / web app
- [SOURCE_FORMATS.md](SOURCE_FORMATS.md) — source and example file handling
- [CONTEXT.md](../CONTEXT.md) — Project Bundle
