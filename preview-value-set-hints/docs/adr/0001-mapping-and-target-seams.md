# ADR 0001: Blockly authority and separate target/script-language seams

- Status: Accepted
- Date: 2026-08-02

## Context

The original Sync Scope maintained Blockly, a derived Mapping Model, and a
private text DSL. The old “Export Target” setting also mixed programming
language with the structure being produced. Kintegrate adds a Handlebars
conversion script language whose output is often not openEHR.

## Decision

1. Native Blockly workspace JSON is the canonical structural Mapping
   Specification. Mapping Model is a derived semantic index.
2. **Target instance format** is a deep module with adapters for openEHR
   Template, JSON Schema, XML Schema, and free-form output.
3. **Conversion script language** is a separate deep module with TypeScript,
   Java, Kintegrate-compatible Handlebars, and XQuery adapters.
4. Test Run evaluates Mapping Model expressions once and passes slot values to
   the selected Target instance format adapter. Handlebars may additionally
   traverse the source directly for compatibility with existing Kintegrate
   scripts.
5. Host Abstraction uses text/bytes and host-owned storage. Browser `File`,
   IndexedDB, and VS Code types stay behind their adapters.

## Consequences

- The private Mapping Specification DSL and `core/spec` module are removed.
- JSON Schema and XSD targets use the same Target value slot interaction as
  openEHR.
- Handlebars is not assumed to produce openEHR.
- Project Bundles persist a format-neutral `target`.
- Better Form Renderer binaries stay out of the repo and out of the build.
  The user uploads them into the browser (ADR 0012).
