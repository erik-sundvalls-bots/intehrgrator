# Mapping preview vs TypeScript (Conversion Test Run)

Investigation for [#202](https://github.com/regionstockholm/intehrgrator/issues/202).

## What each mode does

| | **Mapping preview** (`outputMode: preview`) | **TypeScript** (`outputMode: typescript`) |
|--|--|--|
| Execution | Evaluates Mapping Model slots via `evaluateSlotValues`, then renders through the Target Format handler (openEHR composition tree, XSD XML canvas, Handlebars, etc.). | Runs the **generated** TypeScript conversion script (`runGeneratedTypeScript`) against source data + defaults + sheets. |
| Codegen | Does not execute Blockly-generated TS; optional `previewGeneratedCode` is editor-only. | Uses `generate(model, "typescript", …)` (or the script already in the Generated Export editor). |
| Validation | `validateConvertedOutput` on the rendered instance (ehrtslib template validation for openEHR). | Same validation path after script output is serialized. |

Implementation: `src/core/test_runner/mod.ts`.

## Why results diverge (e.g. `karda-ordinationsdata-to-openehr-flat`)

1. **Different evaluation engines** — Preview walks the Mapping Model slot graph directly. TypeScript runs the emitted script, which must mirror loops, decision tables, `sheet_lookup`, canvas Handlebars snippets, and optional RM insertions. Any codegen gap shows up only in TypeScript mode.
2. **Output volume** — Preview often shows a structured composition or slot map; TypeScript may log intermediate structures or hit code paths that emit more diagnostic text when the script throws or returns rich objects before serialization.
3. **Validation strictness** — Both call `validateConvertedOutput`, but TypeScript may produce a different instance shape (missing optional nodes, wrong list cardinality) so error counts differ even when preview “looks” fine.
4. **Speed** — Preview avoids generating and executing a full script; it is faster for iterative authoring.

## Recommendation

- **Keep Mapping preview** as the default Conversion Test Run mode for authoring: faster feedback and independent of codegen bugs.
- **Treat TypeScript (and XQuery / Handlebars / Go Template where implemented) as the truth path** for export parity before shipping a mapping.
- **Do not remove preview** without replacing it with a equally fast path; defaulting everyone to TypeScript would slow the green-path and amplify codegen noise during Click-to-Map.
- **Follow-ups (optional):** surface a one-line banner when preview vs TypeScript validation counts differ; add regression tests that assert preview/TS agreement on gold fixtures (pattern in `test/vms_golden_test.ts`).
