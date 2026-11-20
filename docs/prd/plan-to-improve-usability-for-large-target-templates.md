# Implementation Plan: Sibling D3 Cascaded Treemap Editor Mode + Scoped Blockly

## 1. Objective & Problem Statement

Loading large openEHR operational templates (such as the MHV1 examples in this repository) onto a single Blockly `WorkspaceSvg` currently takes 30+ seconds due to SVG DOM construction, layout geometry, and connection-database overhead.

This plan introduces a **Sibling D3.js Cascaded Treemap Editor Mode** paired with **Scoped Blockly** editing, keeping **existing Blockly JSON as the single canonical IR** (shared across the D3 treemap, the existing bottom tile editor tree, and Scoped Blockly).

**Execution Model:** Autonomous / no-human-in-the-loop (`7A-fast` rollout: 3 PRs). Every PR must be self-verifying, fail closed on invariant violations, and leave the repository deployable as a static client-side app (GitHub Pages).

---

## 2. Locked Architectural Decisions

| # | Decision | Specification |
|---|---|---|
| **1** | **Canonical IR** | Existing **Blockly JSON** remains the single source of truth. No second parallel mapping IR. Preserve backward compatibility with existing saved project files and example sets. |
| **2** | **D3 Editing Scope (`2C`)** | Rich inline editing directly in D3 Treemap Mode: navigation, search/filter, AI bulk triage, 1:1 source bindings, literals/constants, terminology bindings, and simple expressions via an inline popover. Complex logic (conditionals, loops, multi-step transforms) escalates to Scoped Blockly. |
| **3** | **Scoped Blockly Unit (`3B`)** | Adaptive structural slice: default to one `ENTRY` (or `COMPOSITION.context`), automatically scoping down to a `CLUSTER` when an `ENTRY` subtree exceeds `SLICE_NODE_THRESHOLD` (default: `70` blocks, configurable). |
| **4** | **Slice Density & Pre-Scaffold (`4B` + choice)** | Inside Scoped Blockly, materialize the **full slice** by default with unmapped optional clusters collapsed (`collapsed: true`). In the **existing pre-scaffolding dialogue** (when opening a target template), add a user choice: **Full (default)** vs. **Sparse (mandatory only)**. In Sparse mode, only mandatory (`min >= 1`) paths are scaffolded; pulling in non-mandatory paths later remains the user's task from the target schema onto the canvas. |
| **5** | **Variables, Data Flow & Codegen** | Keep existing Blockly variable and codegen semantics intact. Decouple full-composition codegen and formal validation from `WorkspaceSvg`. |
| **6** | **Treemap Design (`6A`)** | Self-contained TypeScript D3 module inside `intehrgrator`, inspired by `erik-sundvalls-bots/TermViz` (`prototyping/v8-multilingual-stack-demo.html`). Use **order-preserving tiling** (`d3.treemapBinary` / `d3.treemapSliceDice` at upper levels), cap initial depth at `SECTION -> ENTRY -> CLUSTER` (leaf `ELEMENT`s via zoom/hover), color-encode mapping status, and **defer cross-link overlay lines to V2**. |
| **7** | **Rollout (`7A-fast`)** | **PR 1:** Pre-flight audit, MHV1 perf benchmark, Blockly batch-load fixes, JSON slice extract/graft core, headless codegen, pre-scaffolding Full/Sparse option. **PR 2:** D3 Cascaded Treemap overview + mode switch + Scoped Blockly + bottom-tree sync. **PR 3:** Rich inline D3 popovers (`2C`), shared JSON patch helpers, source binding, and AI triage. |

---

## 3. Mandatory Pre-Flight Discovery & Test Suite Audit (Run Before Writing Code)

Before modifying any source file, the agent MUST inspect the repository and write a brief `docs/treemap-discovery-notes.md` (or PR 1 description section) documenting exact findings for every item below:

1. **Stack & Build/Deploy Constraints**
   - Inspect `package.json` / `deno.json` / bundler config and `.github/workflows/*`.
   - Record exact install, typecheck, lint, build, and static GitHub Pages constraints (no backend server; preserve existing single-threaded WASM / no-COOP-COEP compatibility if Z3 or similar WASM modules are used).
   - Check whether `d3` or `d3-hierarchy` is already installed. If not, prefer minimal modular packages (`d3-hierarchy` + `d3-selection` / `d3-zoom` as needed) over unnecessary heavy dependencies.
2. **Current Test Suite Audit**
   - List all existing unit, integration, and E2E test suites and run them **unmodified** to confirm a green baseline.
   - Identify test coverage gaps specifically around:
     - Blockly JSON serialization/deserialization round-trips
     - Bottom tile editor tree synchronization
     - Codegen & formal validation execution
     - Pre-scaffolding dialogue behavior
     - UI / browser rendering performance on MHV1 examples
   - Explicitly list which new tests will be added in PR 1, PR 2, and PR 3 using the repo's existing test runner(s). Do not introduce a redundant test framework if one already exists.
3. **Key Codebase Touchpoints**
   - Exact file path(s) of the **MHV1 example template(s)** used for benchmarking.
   - Exact file path(s) of the **pre-scaffolding dialogue** when loading a target template.
   - Exact file path(s) of the **bottom tile editor tree** and how it reads/mutates Blockly JSON.
   - Exact mechanism of **code generation** and **formal validation**: do they walk Blockly JSON directly, or do they call `workspaceToCode()` on a `Blockly.Workspace` / `WorkspaceSvg`?
   - Exact block types/fields used to represent openEHR nodes (`COMPOSITION`, `SECTION`, `ENTRY`, `CLUSTER`, `ELEMENT`), cardinality (`min`/`max`), RM datatypes, AI suggestions, literals, terminology bindings, and simple expressions.

---

## 4. Core Technical Invariants (Must Never Be Violated)

### Invariant A — Lossless Slice Extract & Graft on Canonical Blockly JSON
In Blockly serialization JSON, sibling statement blocks are linked via `block.next.block`.
- **Extract (`extractSlice(docJson, targetBlockId)`):**
  1. Deep-clone the target subtree rooted at `targetBlockId`.
  2. **Sever the outer `next` chain** on the slice root (store the severed outer `next` reference separately in the slice handle—never load subsequent template siblings into `WorkspaceSvg`).
  3. Include the canonical document's top-level `variables` array in the extracted slice workspace JSON so variable references resolve identically to full-canvas mode.
- **Graft (`graftSlice(docJson, sliceHandle, editedSliceJson)`):**
  1. Re-attach the preserved outer `next` chain onto the edited slice root (handling the case where the user appended/modified internal statements vs. the root block).
  2. Replace the original node at `sliceHandle.path` inside a new immutable copy of `docJson`.
  3. **Union/reconcile top-level `variables`:** Never delete variables referenced by *other* slices outside the active `WorkspaceSvg`. Only add new variables or apply explicit renames safely across the full document.
- **Identity Round-Trip Guarantee:** `graftSlice(doc, handle, extractSlice(doc, id))` MUST be deeply equal to `doc` (modulo harmless layout coordinates `x`/`y` on the root block).

### Invariant B — Zero Full-Template `WorkspaceSvg` Mounting
- Whole-composition **codegen** and **formal validation** MUST NEVER require mounting the full template into a visual `WorkspaceSvg`.
- If existing codegen/validation walks Blockly JSON directly, keep it running on canonical `docJson`.
- If it requires a Blockly workspace API, instantiate a **headless `new Blockly.Workspace()`** (no DOM/SVG) loaded via `Blockly.serialization.workspaces.load(docJson, headlessWorkspace)` with events disabled, and dispose of it cleanly after execution.

### Invariant C — Fast Scoped Blockly Hydration
Every bulk load into `WorkspaceSvg` MUST:
1. Wrap loading in `Blockly.Events.disable()` / `try { ... } finally { Blockly.Events.enable(); }`.
2. Use `Blockly.serialization.workspaces.load(...)` (single batched render cycle), never incremental imperative block insertion inside loops.
3. Ensure collapsed custom blocks implement a fast, O(1) collapsed summary (`toString()` or custom collapsed label override) that does **not** recursively walk deep hidden subtrees.

### Invariant D — Single Mutation Path for D3 & Bottom Tile Editor
All non-Blockly edits (both D3 inline popovers and bottom tile editor tree mutations) MUST go through shared, pure TypeScript Blockly-JSON patch functions that emit valid Blockly block JSON matching the exact block definitions registered in Blockly.

---

## 5. Phased Implementation Plan (`7A-fast`)

### PR 1: Performance Foundation, JSON Slice Core, Headless Codegen & Pre-Scaffold Choice

**Goal:** Eliminate architectural blockers, prove lossless slicing on MHV1 with automated tests, and ship the Full vs. Sparse pre-scaffolding option—without changing the default UI yet (or behind a clean slice switcher for testing).

**Tasks:**
1. **Complete Section 3 Pre-Flight Discovery** and record baseline test output + MHV1 load-time benchmark.
2. **Blockly Batch-Load Audit & Fix:**
   - Audit current template load path for unbatched `Events`, imperative creation, and slow collapsed `toString()` traversals.
   - Apply Invariant C fixes so any slice of ≤80 blocks mounts in `< 150 ms`.
3. **Canonical Blockly JSON Store & Slice Engine (`src/state/sliceEngine.ts` or repo-idiomatic path):**
   - Implement `indexDocument(docJson)` returning a fast tree index (node IDs, openEHR paths, RM types, node counts, mandatory flags, mapping status, AI suggestion flags).
   - Implement `computeAdaptiveSliceTarget(index, nodeId, threshold = 70)` (`3B`): returns the owning `ENTRY` (or `COMPOSITION.context`), or drills down to the containing `CLUSTER` if the `ENTRY` subtree exceeds `threshold`.
   - Implement `extractSlice` and `graftSlice` obeying Invariant A.
   - Auto-collapse unmapped optional `CLUSTER` blocks (`collapsed: true`) when preparing a `4B` scoped slice view (preserving explicit user expand/collapse choices where applicable).
4. **Decouple Codegen & Validation (Invariant B):**
   - Verify or refactor codegen and formal validation to operate on canonical `docJson` (directly or via headless `Blockly.Workspace`).
5. **Pre-Scaffolding Dialogue Enhancement (`Full` vs. `Sparse`):**
   - Locate the existing pre-scaffolding dialogue triggered when opening a target template.
   - Add a clear radio/toggle option:
     - **Full template (default)** — scaffolds all paths as today.
     - **Sparse (mandatory only)** — scaffolds only mandatory (`min >= 1`) paths and their required ancestor spine.
   - Do **not** auto-inject optional paths later in Sparse mode; ensure the existing mechanism for pulling target schema nodes onto the canvas works cleanly for user-added optional paths.

**PR 1 Acceptance Gates (Automated):**
- [ ] All pre-existing tests pass unchanged.
- [ ] New unit tests for `extractSlice` / `graftSlice` prove lossless round-trip on the real MHV1 example JSON (including `.next` sibling preservation and cross-slice `variables` preservation).
- [ ] New unit tests for `computeAdaptiveSliceTarget` verify `ENTRY` selection below threshold and `CLUSTER` fallback above threshold.
- [ ] New test proves codegen output from full canonical JSON matches previous baseline output byte-for-byte without touching `WorkspaceSvg`.
- [ ] New tests verify Pre-Scaffolding in both **Full (default)** and **Sparse (mandatory only)** modes produce valid Blockly JSON with expected node counts.
- [ ] Automated benchmark records MHV1 JSON indexing + scoped slice mount time (`< 150 ms` for a ≤80-block slice).

---

### PR 2: Sibling D3 Cascaded Treemap Mode + Scoped Blockly Integration

**Goal:** Loading MHV1 opens instantaneously into the TermViz-inspired D3 Cascaded Treemap overview; clicking any tile opens Scoped Blockly with breadcrumb navigation and stays 100% synced with the bottom tile editor tree.

**Tasks:**
1. **D3 Cascaded Treemap Module (`src/treemap/`):**
   - Add `d3-hierarchy` (if not already present) and build a self-contained TypeScript renderer inspired by `TermViz` (`v8-multilingual-stack-demo.html`).
   - **Data Source:** Build hierarchy from `indexDocument(docJson)` (and in Sparse mode, optionally overlay unscaffolded optional nodes from the loaded target schema as visually distinct "unscaffolded/ghost" tiles so the user retains full template orientation).
   - **Order-Preserving Layout:** Use `d3.treemapBinary` or `d3.treemapSliceDice` at top levels (`SECTION` / `ENTRY`) rather than area-sorted squarify, preserving clinical template sequence.
   - **Cascaded Headers & Depth Cap:** Render cascaded header bars for `SECTION -> ENTRY -> CLUSTER`. Cap initial visual depth so leaf labels don't collapse into unreadable slivers; reveal leaf `ELEMENT` tiles on zoom/drill-in and via rich hover tooltips (full openEHR path, cardinality `min..max`, RM datatype, current mapping summary).
   - **Status Heatmap Encoding:** Distinct visual states (color + accessible icon/border, not color alone):
     - `unmapped` (neutral)
     - `mandatory-missing` (amber/red highlight when `min >= 1` and unmapped)
     - `ai-draft` (pending review badge)
     - `verified` / `mapped` (green)
     - `validation-error` (error border/badge)
     - `unscaffolded-optional` (dashed/muted, Sparse mode only)
   - **Defer** cross-link overlay lines to V2.
2. **Overview Controls & Filtering:**
   - Top bar mode switcher (`Treemap Overview` | `Scoped Blockly`), breadcrumb trail (`Template > Section > Entry [> Cluster]`), search box (matches label, archetype ID, openEHR path), and quick filter chips (`All`, `Mandatory Missing`, `Unmapped`, `AI Draft`, `Mapped`).
3. **Load-Time Routing & Scoped Blockly Wiring:**
   - Default to **Treemap Overview** on load for large templates (e.g., total nodes > `TREEMAP_AUTO_THRESHOLD`, default `100`, or user-selectable default), avoiding full-template `WorkspaceSvg` mount completely.
   - Clicking a tile's **"Open in Blockly"** action (or double-clicking a container) computes the adaptive slice (`3B`), extracts it (`Invariant A`), mounts it into `WorkspaceSvg` (`Invariant C`), and displays the breadcrumb back to Treemap.
   - On Blockly change (debounced) and on mode switch back to Treemap, graft edits back into canonical `docJson` and refresh both the Treemap heatmap and the bottom tile editor tree.
4. **Bottom Tile Editor Tree Sync:**
   - Selecting a node in the bottom tile editor highlights/scrolls to it in Treemap mode (or switches/focuses the matching slice in Scoped Blockly).
   - Edits in the bottom tile editor re-index and re-render Treemap tile statuses immediately.

**PR 2 Acceptance Gates (Automated):**
- [ ] All PR 1 and pre-existing tests pass.
- [ ] Automated performance test: loading the MHV1 example into Treemap Overview completes in `< 300 ms` (zero `WorkspaceSvg` full-template render).
- [ ] Automated E2E/integration test: load MHV1 → filter by `Mandatory Missing` → open an `ENTRY` (or oversized `CLUSTER`) in Scoped Blockly → verify mounted block count respects `3B` threshold → make an edit → return to Treemap → verify status color updates, bottom tile editor reflects the edit, and full canonical JSON preserves all untouched siblings & variables.
- [ ] Typecheck and production static build succeed cleanly.

---

### PR 3: Rich Inline D3 Editors (`2C`), Shared Patch Helpers & AI Bulk Triage

**Goal:** Allow fast, Blockly-free mapping directly inside D3 Treemap Mode for common mappings (1:1 source bindings, literals, terminology bindings, simple expressions, and AI triage), writing cleanly to canonical Blockly JSON.

**Tasks:**
1. **Shared Pure Blockly-JSON Patch Helpers (`src/state/jsonPatchHelpers.ts`):**
   - Extract/unify pure mutation helpers shared by the bottom tile editor tree and D3 inline editors:
     - `setSourceBinding(docJson, targetBlockId, sourcePath)`
     - `setLiteralValue(docJson, targetBlockId, rmDatatype, value)`
     - `setTerminologyBinding(docJson, targetBlockId, codeSystem, code, display)`
     - `setSimpleExpression(docJson, targetBlockId, exprSpec)` (must map strictly onto existing verifiable Blockly expression block types—never emit raw unverified JS strings outside the repo's Blockly subset)
     - `clearMapping(docJson, targetBlockId)` / `setIgnored(docJson, targetBlockId, ignored)`
     - `acceptAiSuggestion(docJson, targetBlockId)` / `rejectAiSuggestion(docJson, targetBlockId)` (single node and subtree bulk operations)
   - Refactor bottom tile editor mutations (where overlapping) to reuse these same helpers so there is only one JSON schema writer.
2. **D3 Inline Editor Popover (`2C`):**
   - Clicking a leaf `ELEMENT` (or mappable node) tile in Treemap mode opens an anchored inline popover showing:
     - Path, RM datatype, cardinality, and current status.
     - **Source field picker** (searchable dropdown + drag-and-drop support from existing source schema panel if present).
     - **Literal / constant input** (datatype-aware for text, numbers, dates, booleans).
     - **Terminology binding editor** (code system / code / display, integrating with existing terminology helpers in the repo if present).
     - **Simple expression editor** (constrained to verifiable Blockly primitives—e.g., unit scale/offset, string concat/trim, fallback default—producing real Blockly blocks in JSON).
     - **"Edit in Scoped Blockly →"** escalation button for complex conditionals/loops/multi-step logic (and clear read-only preview badge when a node already contains complex Blockly logic so inline edits cannot accidentally clobber complex block trees without explicit confirmation).
3. **AI Suggestion Triage in Treemap Mode:**
   - Show AI draft indicator on tiles with pending suggestions.
   - Provide one-click Accept / Reject on individual tiles and bulk Accept / Reject on `ENTRY` / `SECTION` headers (with Undo/Redo support via canonical JSON snapshots).
4. **Sparse Mode Ergonomics:**
   - When the user chose **Sparse (mandatory only)** in the pre-scaffolding dialogue, clicking an unscaffolded optional tile in the Treemap offers a clear prompt/hint to pull that node into the canvas or explicitly instantiate just that path if requested, without auto-scaffolding unrelated siblings.

**PR 3 Acceptance Gates (Automated):**
- [ ] All PR 1, PR 2, and pre-existing tests pass.
- [ ] Unit tests for every `jsonPatchHelpers` function verify that:
  1. Output loads into a headless `Blockly.Workspace` without warnings/errors or unknown block types.
  2. Opening the edited slice in Scoped Blockly renders the exact expected blocks.
  3. Codegen and formal validation succeed on the resulting canonical JSON.
- [ ] Guardrail test: clicking a tile that already contains complex Blockly logic (e.g., multi-branch `if`/loop) does **not** silently overwrite it from the inline popover.
- [ ] E2E test: apply a 1:1 binding, a literal, a terminology binding, and a simple expression directly via D3 inline popovers on MHV1 → verify bottom tile editor updates → open the same slice in Scoped Blockly and confirm visual blocks match → run codegen cleanly.
- [ ] Production static build passes with zero TypeScript errors.

---

## 6. Autonomous Agent Guardrails & Stop Conditions

- **Do not weaken or skip existing tests** to make a PR pass. If an existing test conflicts with a new feature (e.g., default pre-scaffold dialog flow), verify why and update only the intentionally changed behavior while preserving full assertion coverage.
- **Do not invent new non-verifiable expression formats.** Simple expressions edited in D3 (`2C`) must serialize to the existing verifiable Blockly block definitions already supported by the code generator and validator.
- **Do not break existing saved mapping files.** Test loading at least two existing repository example mapping files (including an MHV1 example) in automated tests on every PR.
- **Keep dependencies lean and static-hosting safe.** No backend endpoints, no `SharedArrayBuffer` requirements, no server-only Node APIs bundled into browser code.
- **Fail closed and log clearly:** If Pre-Flight Discovery uncovers a hard contradiction with an assumption in this plan (e.g., codegen is tightly coupled to `WorkspaceSvg` internal rendering coordinates, or the bottom tile editor does not actually read Blockly JSON directly), pause, document the exact files/lines causing the conflict in `docs/treemap-discovery-notes.md`, and propose the minimal adjustment before proceeding.