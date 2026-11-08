# UI Testing (Playwright harness)

Browser tests for the web app Mapping Editor. Suite strategy, seams, and CI gates: [TESTING.md](TESTING.md).

Inspired by kintegrate’s `formTestApi` + browser harness pattern ([CyEmulator / formTestApi](https://deepwiki.com/ErikSundvall/kintegrate)), adapted to Deno + Playwright.

## Goals

| Goal | v1 approach |
|------|-------------|
| Avoid fragile file-picker automation | **Workbench Test API** loads OPT / Source Schema / Example Instance from fixture strings |
| Still exercise real UI | Arm by clicking the Blockly Target value slot + click Example Instance (Click-to-Map); HTML5 drag from Example Instance onto the Blockly slot; **Run Test** |
| Assert sensible output | Mapping Model expression, Blockly `source_query` block, Test Run payload, `#test-output` text |
| Stay Deno-native | `deno task test:ui` builds, serves `dist/`, runs Playwright under Deno |

## Workbench Test API

Enabled only when the shell is opened with `?testMode=1`.

| Method | Role |
|--------|------|
| `ready()` | Resolves after Blockly inject + first render |
| `loadTemplate` / `loadSchema` / `addExample` | Fixture setup (no Host file picker) |
| `refreshTarget` / `refreshSchema` | Non-destructive refresh; `getSnapshot().lastRefreshReport` |
| `armSlot` / `bindFromNode` | Programmatic equivalents of Click-to-Map (available; UI test prefers DOM clicks) |
| `mapNodeToSlot` | Programmatic equivalent of drag-and-drop (skips Listening Mode) |
| `runTest` / `setAutoplay` | Drive Conversion Test Run(s) |
| `getSnapshot()` | Mapping Model, Test Run result, Blockly block summary, listening/selection ids |
| `findSlotIdBySuffix` | Stable slot lookup for long OPT slotIds |
| `getBlockClientRect` | Blockly block SVG client rect for real UI click / drop |
| `clickBlock` | Select a Blockly block (same path as a canvas click; arms Listening Mode when unmapped) |
| `scrollBlockIntoView` | Pan the Blockly canvas so a block is in view |
| `setOptionalRmExtras` | Cogwheel compose path for Optional RM Insertion |
| `setBlockField` | Set a canvas field (e.g. Instance encoding) |

Global: `window.intehrgratorTestApi` (types in `src/ui_test/test_api.ts`).

## Running

```bash
deno task vendor   # once
deno task test:ui  # build + serve + Playwright
```

Skip rebuild when iterating:

```bash
UI_TEST_SKIP_BUILD=1 deno task test:ui
```

Unit tests remain `deno task test` (no browser).

## Fixtures

| File | Use |
|------|-----|
| `test/fixtures/blood_pressure.opt` | Target Template Skeleton |
| `test/fixtures/dummy-json-vitals/source.schema.json` | Source Schema |
| `test/fixtures/dummy-json-vitals/instance-1.json` | Active Example (`systolic: 120`) |

Primary scenarios map systolic (`…/items/at0004/value/value/value`) → `$.systolic` and expect Test Run value `120`.

| Test | Interaction |
|------|-------------|
| `test/ui/green_path_test.ts` | Load → Click-to-Map (systolic + diastolic) → Optional RM Insertion → toolbox Loops → Test Run → Generated Export |
| `test/ui/target_schema_tabs_test.ts` | Target & Previews tabs + slide-away; drag Target schema subtree onto canvas |
| `test/ui/click_to_map_test.ts` | Listening Mode → click Example Instance node |
| `test/ui/drag_drop_map_test.ts` | Drag Example Instance node onto Blockly Target value slot (no Listening Mode) |

Shared helpers live in `test/ui/helpers.ts` (including `html5DragDrop` for reliable DataTransfer MIME payloads under Playwright).

## What this does *not* cover yet

- Executing the downloaded Generated Export as a standalone program (the green-path asserts the in-app Generated conversion script(s) preview)
- Autoplay debounce behaviour
- VS Code webview host (same Test API should mount there later behind Host Abstraction)
- openEHR-as-source (future Source Format Handler)

## CI

`deno task test:ui` is a required gate on pull requests (`ci.yml` job `ui-test`) and on release (`release.yml` after the web app build). Unit `deno task test` stays the fast default locally.
