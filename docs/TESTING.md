# Testing

How intEHRgrator tests are layered, what each facet covers, and when to add a new test. Commands live in `deno.json`; this page is the **why**.

Playwright harness details: [UI_TESTING.md](UI_TESTING.md). Optional BaseX goldens: [agents/xquery-engine.md](agents/xquery-engine.md).

## Seams

Tests observe behavior at a **seam** (a public boundary). Pick the highest seam that can catch the bug, and stop there.

| Seam | Lives in | Run | Use when |
|------|----------|-----|----------|
| **Unit** — module public API (mapping model, Blockly generators, codegen, persistence, WorkbenchController) | `test/*_test.ts` (not `test/ui/`) | `deno task test` | Pure logic, fixtures, regressions a browser would only slow down |
| **UI** — web app chrome the user clicks | `test/ui/` (Playwright + Workbench Test API) | `deno task test:ui` | Click-to-Map, drag/drop, dialogs, toolbox, encoding dropdown, panes that can break independently of the controller |
| **Agent / MCP** — HTTP Agent API and stdio MCP | `test/agent_*`, `test/desktop_*` | `deno task test` | Headless authoring (`--headless`, `deno task mcp`) |
| **Optional golden** — needs an extra binary | `test/xquery_engine_test.ts`, `test/java_archie_compile_test.ts` | `deno task test:xquery-engine` / same suite (skips if missing) | Engine parity (BaseX, `javac` + Archie). Must skip, not fail, when the tool is absent |

A filename twin (`test/foo_test.ts` and `test/ui/foo_test.ts`) is **complementary** when one asserts a function and the other asserts chrome. Clone an assertion onto a second seam only when that seam can miss a real bug the first cannot see.

The **UI green-path** (`test/ui/green_path_test.ts`) is the one Playwright test that must keep covering the major authoring steps: load Source Schema + Example Instance + target, Click-to-Map a `source_query`, RM COMPOSITION (**default context map** + Optional RM Insertion), Test Run, Generated Export. Extend it when you add a major process step; do not replace it with another single-control test.

Tabbed **Target & Previews** plus pull-from-**Target schema** live in `test/ui/target_schema_tabs_test.ts` (chrome that can miss a bug the unit `placeSkeletonSubtreeOnWorkspace` tests cannot see). Joint load / **Call AI** chrome lives in `test/ui/joint_load_ai_test.ts`. The Better form viewer upload lives in `test/ui/better_form_viewer_test.ts`: the licensed renderer is not in the build, and the viewer must not request it until the user stores it in the browser.

## How to run

```bash
deno task vendor          # example archetypes + local ehrtslib validator override (ehrtslib itself is the v0.4.2 jsDelivr pin; see README_DEVELOPERS.md)
deno task test            # unit + agent (parallel; ignores test/ui)
deno task test:ui         # build dist/, serve, Playwright Chromium
deno task test:all        # unit then UI
UI_TEST_SKIP_BUILD=1 deno task test:ui   # reuse an existing dist/
deno task test:xquery-engine             # optional BaseX golden
```

`deno task test` uses `--no-check --parallel`. Type-check separately with `deno task check`.

Individual tests can be run in isolation using `deno test -A --no-check --filter='<test name>' <file>` (Blockly block types and stock message strings initialize automatically via `initBlocklyGenerators()` / `ensureStockBlocklyMessages()`).

### CI

| Gate | Workflow | Suites |
|------|----------|--------|
| Pull request and `main` / `cursor/**` push | `.github/workflows/ci.yml` | `deno task test` **and** `deno task test:ui` |
| Release tag (`deno task release`) | `.github/workflows/release.yml` | unit then UI; UI must pass before Pages / desktop publish. `deno task release:no-test` / `--no-test` skips only the local unit suite before tagging. Maintainer flow: [README_DEVELOPERS.md § Releases](../README_DEVELOPERS.md#releases) |
| GitHub Pages (bleeding-edge `main`) | `.github/workflows/pages.yml` | unit only (UI already gated on the same push via `ci.yml`) |

Optional goldens are not a CI fail when BaseX / `javac` are missing.

## Facets

Coarse index of `test/*_test.ts`. The filename is the lookup; do not copy this table into every test file.

| Facet | Representative files | What a failure means |
|-------|----------------------|----------------------|
| Mapping model / spec / IR | `mapping_model_test.ts`, `mapping_ir_test.ts`, `mapping_spec_project_test.ts`, `expression_test.ts` | Slot expressions, loops, spec projection |
| Blockly / VMS / RM / generators | `blockly_rm_blocks_test.ts`, `source_query_blocks_test.ts`, `loop_blocks_test.ts`, `logic_blocks_test.ts`, `vms_toolbox_test.ts`, `join_list_test.ts` | Canvas blocks, toolbox, codegen from blocks |
| Source formats / XPath / XQuery | `source_format_handler_test.ts`, `source_query_test.ts`, `json_schema_refs_test.ts`, `xquery_runtime_test.ts` | Load/evaluate source; JSON Schema `$ref`/`$defs`; in-app XQuery Test Run |
| Target / encoding / scaffolding | `target_format_handler_test.ts`, `instance_encoding_test.ts`, `skeleton_test.ts`, `conversion_start_test.ts`, `target_schema_tree_test.ts` | Template Skeleton, Product stack, Instance encoding, Target schema pull-to-canvas |
| Codegen | `codegen_test.ts`, `go_template_codegen_test.ts`, `decision_table_test.ts` | TS / Java / Handlebars / XQuery / Go emit |
| Persistence / example sets / sheets | `project_persistence_test.ts`, `example_sets_test.ts`, `sheets_test.ts`, `function_library_test.ts` | Project bundle, catalogs, grids, Function bundles |
| Workbench (headless) | `workbench_load_test.ts`, `workbench_service_test.ts` | Controller load/map/import without a browser |
| Agent / MCP / desktop | `agent_headless_loop_test.ts`, `desktop_cli_test.ts` | Headless loop: load → map → `run_test` → generate → export |
| Golden / fixture mappings | `vms_golden_test.ts`, `ai_created_fixtures_test.ts`, `kintegrate_migration_test.ts` | Known-good clinical values and migrations |
| UI chrome | `test/ui/*.ts` | Mapping Editor clicks, drags, dialogs, toolbox |

Retired Blockly types (`for_each_source`) keep a **migration pin** (`migrate_for_each_source_test.ts`, `loop_blocks_test.ts`) until old bundles are gone. That is not duplication of `for_each_list`.

## Adding tests

1. Name the test as observable behavior, using terms from [CONTEXT.md](../CONTEXT.md).
2. Assert a known literal or fixture (systolic `120`, a COMPOSITION `_type`), not a value recomputed the way the code computes it.
3. Drive UI tests through the DOM and `window.intehrgratorTestApi` (`?testMode=1`). Do not automate the OS file picker; load fixtures via the Test API. Assert Test Run on **Mapping preview**; TypeScript output mode executes the generated script and needs complete default context map `CODE_PHRASE` values.
4. Headless Agent/MCP already covers most authoring. Add Playwright when the bug would be “the button/dialog/toolbox didn’t do it.”
5. After a new Mapping Editor process step ships, extend `test/ui/green_path_test.ts` so the green-path still walks every major step.
6. Optional goldens `return` (with a warning) when the engine is missing; they do not `ignore: true` the whole file in a way that hides a broken install in CI that *does* have the engine.
