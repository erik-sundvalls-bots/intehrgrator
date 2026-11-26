# Pre-Flight Discovery Notes: Large Template Usability (Issue #371)

Grounded audit of `intehrgrator` conducted prior to implementing the 3-PR rollout (`7A-fast`) from `docs/prd/plan-to-improve-usability-for-large-target-templates.md`.

## 1. Stack, Build & Deploy Constraints

- **Toolchain:** Deno 2.9.x (`deno.json`), TypeScript strict mode (`strict: true`), static browser bundle built via `scripts/build.ts` (`esbuild` + `@luca/esbuild-deno-loader`) outputting `dist/bundle.js`, `dist/better_form_viewer.js`, and `dist/extension.mjs`.
- **Static hosting:** GitHub Pages + desktop WebView (`stage-desktop-www.ts`). No backend endpoints, no `SharedArrayBuffer`, no COOP/COEP headers required.
- **UI library:** Blockly `^11.2.2`, CodeMirror 6, Shoelace `@shoelace-style/shoelace@2.20.1` (Karolinska `--sl-color-primary-*` tokens), `fontoxpath`, `ehrtslib@v0.15`.
- **D3 availability:** `d3` / `d3-hierarchy` is not yet in `deno.json`; PR 2 will add only `npm:d3-hierarchy@^3.1.2` (pure layout engine, zero DOM or server dependencies).
- **CI gates (`.github/workflows/ci.yml`):** `deno task vendor`, `deno task test`, `deno task project:run examples/file-project/intehrgrator.json --check`, `deno task build`, `deno run -A scripts/package-extension.ts --no-build`, `deno task test:ui` (Playwright Chromium).

## 2. Key Codebase Touchpoints

| Area | Grounded Path | Findings |
|---|---|---|
| **MHV1 example fixtures** | `test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json` (3.4 MB, 2,340 skeleton nodes) & `mapping/mapping.blockly.json` (2.5 MB, 1,296 Blockly blocks: 19 `section`, 9 `observation`, 22 `evaluation`, 57 `cluster`, 308 `element`, 6 unreviewed AI-draft mapped leaves) | Ideal benchmark fixture for both skeleton scaffolding and canonical Blockly JSON slicing. |
| **Pre-scaffolding dialogue** | `web/index.html` (`#dialog-joint-load`, lines 755–823), `web/main.ts` (`confirmJointLoad`, lines 3640–3703), `src/workbench/controller.ts` (`loadTargetContent`) | Joint "Load target & default context map" dialog. Added **Full template (default)** vs **Sparse (mandatory only)** radio option; `controller.skeleton` keeps the full template so the **Target schema** tab always allows pulling optional paths later. |
| **Sparse mandatory-only semantics** | `src/core/skeleton/generate_skeleton.ts` (`filterSkeletonMandatoryOnly`) | On MHV1, 1,727 nodes have `mandatory: true` locally (silent-mandatory RM fields inside optional `SECTION`/`ENTRY` subtrees), whereas only **7** nodes are mandatory along an unbroken mandatory ancestor chain from root (`depth === 0 \|\| node.mandatory`). Stopping descent at optional branches yields a genuine sparse spine. |
| **Blockly batch-load bottlenecks** | `src/blockly/skeleton_loader.ts` (`loadSkeletonIntoWorkspace`, `finalizeBlock`, `refreshWorkspaceLayout`) & `src/blockly/collapsed_preview.ts` (`collapsedHtmlForBlock`) | `finalizeBlock` previously called `block.initSvg()` + `block.render()` on every block during construction, and `refreshWorkspaceLayout` called `block.render()` on every block again (O(N·depth) reflows). Fixed by suppressing per-block render during bulk build and rendering top-down once. `collapsedHtmlForBlock` previously walked entire hidden subtrees without bound; capped to `MAX_COLLAPSED_NODES = 32` (O(1) bounded). |
| **Headless codegen & validation** | `src/workbench/blockly_sync.ts`, `src/core/codegen/mod.ts`, `src/core/mapping_model/mod.ts` | Codegen and model validation already operate on `MappingModel` (decoupled from `WorkspaceSvg`). Added `extractModelFromBlocklyJson` in `src/workbench/blockly_sync.ts` using a headless `new Blockly.Workspace()` with `Blockly.Events.disable()` (Invariant B). |
| **Bottom tile editor tree** | `src/workbench/mapping_spec/project.ts` (`projectBlocklyState`), `src/workbench/mapping_spec/editor.ts`, `web/main.ts` (`specEditor` lines 381–407) | `projectBlocklyState` already reads canonical Blockly JSON directly! However, `web/main.ts`'s `onFieldEdit` previously mutated live `workspace.getBlockById(blockId)`. PR 2/PR 3 route edits through canonical `docJson` via shared pure JSON patch helpers (`src/core/json_patch_helpers.ts`, Invariant D). |
| **AI review / draft markers** | `src/blockly/ai_review.ts` (`AI_REVIEW_DATA_KEY = "aiReview"` in `block.data`) | Active AI drafts carry `aiReview` in `block.data` without an `outcome` (`"reviewed"` \| `"edited"`). `indexDocument` reads this directly from JSON without instantiating Blockly. |
| **i18n enforcement** | `test/chrome_i18n_test.ts`, `src/ui/chrome_{en,sv,de,es,ca,fr}.ts` | All `data-i18n` keys in `web/index.html` must exist in all 6 locale tables with non-empty translations. |

## 3. Baseline Test Audit & New Test Plan

- **Pre-existing suites:** `deno task test` (unit + headless agent/MCP), `deno task test:ui` (Playwright Chromium in `test/ui/`), `deno task check` (TypeScript typecheck), `deno task build` (static bundle).
- **Coverage gaps addressed:**
  - **PR 1 (`test/slice_engine_test.ts`):** `indexDocument` on real MHV1 (1,296 blocks, `< 150 ms`), lossless `extractSlice`/`graftSlice` round-trip (`.next` chains & cross-slice `variables`), `4B` optional-cluster auto-collapse, `3B` adaptive `ENTRY` vs `CLUSTER` threshold, Invariant B byte-identical headless TS codegen, Full vs Sparse scaffolding counts, and `< 150 ms` headless slice load benchmark.
  - **PR 2 (`test/treemap_hierarchy_test.ts`, `test/ui/treemap_scoped_blockly_test.ts`):** D3 hierarchy layout & Sparse ghost overlay, `< 300 ms` MHV1 Treemap overview load in Chromium (zero full-template `WorkspaceSvg` mount), filtering by `Mandatory Missing`, opening an `ENTRY`/`CLUSTER` in Scoped Blockly, editing & grafting back, and bottom Mapping Spec sync.
  - **PR 3 (`test/json_patch_helpers_test.ts`, `test/ui/treemap_inline_editor_test.ts`):** Pure Blockly-JSON patch helpers (source binding, literal, terminology, verifiable simple expressions, AI accept/reject, complex-logic guardrail), headless Blockly load & codegen verification, and Playwright E2E inline popover workflow on MHV1.
