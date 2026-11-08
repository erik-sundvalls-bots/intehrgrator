# Deferred: Wildcard Source Mapping Blocks

**Status:** Not in initial implementation. Captured from design discussion 2026-07-01.

## Idea

Allow the informatician to insert a **placeholder block** ("Map from source") into a value slot before choosing which source node to bind. The block enters listening mode automatically; clicking a source tree node replaces the wildcard with a concrete `get_source("path")` block.

## Motivation

- Mark mapping intent top-down before source data is loaded
- Useful when building skeleton mappings from the OPT alone
- Alternative workflow for users who prefer inserting blocks from the toolbox first, then binding

## Why deferred

Initial implementation uses **click-to-map** (click empty slot → click source node) and **drag-and-drop** as the only binding interactions. Wildcards add block type, generator, and listening-state complexity without being needed for the core workflow.

## Implementation notes (when revisited)

- New Blockly block type: `source_wildcard` (value block, output compatible with `get_source`)
- Visual: dashed orange border, label "click source to map…"
- On source tree click while wildcard is active: replace block in-place with `get_source("path")`
- CodeMirror sync: wildcard generates a comment or stub expression until resolved
- Toolbox category: "Source" alongside `get_source`

## Related

- [UI_ARCHITECTURE.md](../UI_ARCHITECTURE.md) — Click-to-Map section
- [CONTEXT.md](../../CONTEXT.md) — Click-to-Map, Listening Mode
