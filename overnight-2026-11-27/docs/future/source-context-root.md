# Source context root vs Blockly `for_each_source`

## Decision

**Do not port kintegrate’s “Frame this node as context root” as a Source Pane tree feature.**

intEHRgrator already scopes iteration explicitly with Blockly (`for_each_source`, and stock `controls_forEach` / variables). That covers the need that makes context roots essential in Handlebars-based kintegrate.

## What kintegrate’s feature does

In [kintegrate](https://github.com/ErikSundvall/kintegrate) Integration Builder (DeepWiki: JSON Tree Viewer / path generation):

| Concern | Behavior |
|---------|----------|
| UI | Right-click tree node → “Set as context boundary” / remove |
| State | `ExtendedTree.setContextBoundary(nodeId, boolean)` |
| Path gen | `buildHandlebarsPath` / `buildHandlebarsTree` call `findNearestContextBoundary` and emit paths **relative** to that ancestor |
| Why | Handlebars `{{#with}}` / `{{#each}}` make inner paths relative to the current context; click-to-insert must match that implicit scope |

Context roots are a **tree-side framing** so relative Handlebars paths stay correct inside those blocks.

## Why Blockly makes tree framing mostly unnecessary

| kintegrate | intEHRgrator |
|------------|--------------|
| Implicit Handlebars context | Explicit loop / variable blocks |
| Relative path strings by default inside `{{#each}}` | `source_query` uses document-rooted fontoxpath (`$…` / `/…`) against `sourceCtx` |
| Tree menu marks the `{{#with}}` boundary | `for_each_source` binds `VAR` from `PATH` via `evaluateXPathToNodes` and stores the node in `__vars[name]` |

Click-to-Map today always inserts an absolute source path through the [Source Format Handler](../SOURCE_FORMATS.md#source-format-handler). Nested mapping under a loop is authored by:

1. Placing `for_each_source` with an absolute multi-node `PATH`
2. Using the loop variable (and/or absolute `source_query` paths) inside the body

No separate “frame this node” tree state is required for that workflow.

## Residual gap (optional, Blockly-scoped — not a tree context root)

Click-to-Map inside a repeating target container now stores a **relative** path and records a Mapping Model loop. The canvas wraps that container with `for_each_source` (`VAR` / `PATH`). Test Run evaluates each `source_query` against the current loop node (`ctx.json` = that node, `vars[VAR]` bound).

Do **not** clone EVENT (or other repeating) **blocks** on the canvas for each instance. The RM output list (`HISTORY.events`) is produced at Test Run by expanding the single mapped EVENT once per source node.

Manual Blockly authoring is the same shape: one `for_each_source` around the repeating container; inner `source_query` paths relative to `PATH`.

A kintegrate-style “frame this node” mark on the Source Schema tree is still not required.

## Related

- [BLOCKLY_INTEGRATION.md](../BLOCKLY_INTEGRATION.md) — `for_each_source`
- [SOURCE_FORMATS.md](../SOURCE_FORMATS.md) — Source Format Handler
- [SOURCE_QUERY.md](../SOURCE_QUERY.md) — fontoxpath evaluators
- Architecture review candidate 1 — `docs/reviews/architecture-review-openehr-source-dual-builds.html`
