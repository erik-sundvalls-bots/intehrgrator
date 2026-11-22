# Deferred: Text-First Mapping Editor

**Status:** Not in initial implementation. Captured from design discussion 2026-07-01.

## Idea

Evolve the Mapping Editor so experienced informaticians can work primarily in CodeMirror, with Blockly becoming optional rather than required. The RM structure appears as read-only scaffolding in text; only **mapping expressions** are editable — the same sync scope as v1, but with richer visual affordances.

## Motivation

- Power users may prefer typing transforms directly over manipulating blocks
- Deep templates are hard to navigate in Blockly even with a minimap

## CodeMirror affordances (later stage)

Use [CodeMirror 6 decorations](https://codemirror.net/docs/ref/#view.Decoration) and [inline widgets](https://codemirror.net/docs/ref/#view.WidgetType) to mark:

| Region | Treatment |
|--------|-----------|
| RM structure (composition tree, entries, clusters) | Read-only decoration — muted background, no cursor |
| Mapping expression slots | Editable — highlighted border, inline widget for "click source to map" when empty |
| `xpathNumber("...")` | Editable path string; optional inline picker linking to Source Pane |
| Control-flow around mappings | Editable expression blocks within decorated regions |

Example widget behaviors:
- Empty slot: dashed inline widget "← click source or type expression"
- Filled slot: editable text with orange accent matching Karolinska theme
- Structural line: grayed `// OBSERVATION blood_pressure.v2` — click jumps to block (while blocks still exist) or expands inline navigator

## Path toward Blockly-optional mode

1. **v1:** Blockly top + CodeMirror bottom; expressions editable in text; structure via blocks
2. **v2:** Decorations/widgets make edit boundaries obvious; collapsible Blockly panel

Blockly may never be fully removed — it remains valuable for control-flow blocks and onboarding — but experienced users could hide it.

## Dependencies

- v1 sync scope (mapping expressions only) must be solid first
- Decoration layer needs stable mapping from code ranges → RM nodes → editable slots
- Optional RM insertion and block expansion logic must have a text/widget equivalent before Blockly can be hidden

## Related

- [textual-mapping-languages.md](textual-mapping-languages.md) — which language (YAML slot projection, XQuery, JSONata, …) if the text surface becomes more than decorated Blockly JSON
- [UI_ARCHITECTURE.md](../UI_ARCHITECTURE.md) — CodeMirror Sync Scope
- [CONTEXT.md](../../CONTEXT.md) — Mapping Expression, Sync Scope
