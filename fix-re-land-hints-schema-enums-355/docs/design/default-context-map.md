# Default context map (accepted design)

**Status:** implemented (#158 unique **default context map**; #159 tabbed **Target & Previews**; #140 remainder: non-destructive refresh + in-app **Call AI**). Root `CONTEXT.md` matches this glossary.

**ADR:** [0011](../adr/0011-default-context-map-runtime-keys.md) (extends [0002](../adr/0002-convert-time-defaults.md)).

**Tracker:** [#159](https://github.com/regionstockholm/intehrgrator/issues/159) (tabbed **Target & Previews** + target schema tree) **blocks** [#158](https://github.com/regionstockholm/intehrgrator/issues/158). [#140](https://github.com/regionstockholm/intehrgrator/issues/140) keeps non-destructive refresh and in-app AI.

This agent can **create** issues but cannot **edit** existing ones. Intended replacement bodies (paste when you can): [tracker-158.md](tracker-158.md), [tracker-140.md](tracker-140.md). #159’s body is already the precursor spec.

**Do not implement Blockly or chrome in the docs PR.** Product work starts at the precursor issue.

## Settled model

The unique canvas block **is** the **default context map** (no plugged `maps_create_with`). Generic **Map** stays in **Lists & maps** for other 1D lookups and nested values.

Each **entry** is three fields:

| Field | Role |
| --- | --- |
| **Runtime key** | Simple identifier (`language`, `territory`, `time`, `facility`, …). Convert-time `defaults` argument and `maps_get("defaults", runtimeKey)` use only this. Duplicate keys → **Constraint warning** (UNIQUE). Empty key is invalid. |
| **Scaffold targets** | One or more chips: `Class.attribute`, ancestor paths, wildcards (`*.language`). Authoring-only. OpenEHR grammar is #157’s. JSON Schema / XML Schema grammars wait until those family catalogs need them. Empty targets → runtime-only key that lights nothing. |
| **Value** | Nested Blockly (same as today’s map `VAL`: `term_pick`, `PARTY_IDENTIFIED`, text, …). |

#157 path matching moves onto **scaffold targets** (most-specific wins; optional RM insert when a target matches at apply time). Lookups on the skeleton still `maps_get("defaults", runtimeKey)`. Hardcode / padlock inlines by **runtime key**.

**Values live; structure is discrete.** Editing a value updates Test Run immediately. New/removed scaffold targets, optional RM mouths, and rewiring happen only at a scaffold act: joint confirm, explicit **Apply default context map**, or a later non-destructive target refresh (#140 remainder). Picking another saved map replaces rows on the block and does **not** rebuild the **Product stack**. A slot already replaced with a **Source query** is not ripped out (source-over-defaults).

**No dual-read of old map JSON.** Convert in-repo Example Sets, fixtures, and Agent hydration in the #158 change. There are no external users.

## First-run sequence

Blank project: no factory dumped on the canvas (no openEHR-shaped rows before a target exists).

**Happy path:** load a target into the schema browser **and** pick a **default context map** from the catalog (per-family factory such as `defaults_openEHR_1`, or a named snapshot / file). Confirm → **Template Skeleton** + **Default point**s. Button copy tells the whole story (no `Target:` + short **Open**); recommended label **Load target & default context map**.

**New map** is a subflow: target must already be in the schema browser (no product skeleton yet). Pull pieces from the tree into value sockets and path chips. Then **Save as** / store, then confirm scaffold. Catalog pick does not need the tree.

Folder / Save as / Browse / URL stay on the block after confirm.

Example Sets `defaults` URI and Agent/MCP hydrate the new block JSON. `load_target` stays split. The joint dialog is web app / desktop chrome only.

## Precursor (must land before the three-field block)

#140 side-effect 1, split to its own issue:

1. **Target & Previews** becomes a tabbed, slide-away right pane (small screens need canvas).
2. Tab **Target schema**: tree of the loaded target. Pull a leaf or subtree onto the empty canvas → corresponding Blockly, scaffolded from the *current* defaults artefact (#157 map until #158).
3. Tab **Generated conversion script(s)** (today’s upper section).
4. Tab **Conversion Test Run(s)** (today’s lower section).

Drag once #158 exists: leaf → append a **scaffold target** chip; subtree onto a **value** socket → nested blocks; subtree onto empty canvas → product subtree (this precursor).

Refresh of target/source and in-app AI credentials stay on #140. They do not block #158.

## Implementation sequence

1. **Docs / tracker** (this change): ADR 0011, this spec, proposed glossary, #159 filed, #158 blocked by #159.
2. **#159:** tabs + tree + pull-to-canvas. Keep current **Defaults Map** / **Open** chrome. Tests: UI green-path still loads a target; add coverage that a pulled subtree becomes RM/schema blocks. See [TESTING.md](../TESTING.md).
3. **#158:** three-field **default context map** with chips + drag (first version; no text-field-only interim). Joint load + catalog + New subflow. Convert every in-repo `defaults` fixture and Example Set. Swap root `CONTEXT.md` from the proposed file. Update tutorial / UI architecture / Agent docs in that same change. Tests: unit for runtime-key bag vs scaffold matching; WorkbenchController for apply-vs-live values; UI green-path for joint load; Agent hydration of the new JSON.

Kick off **step 2 (#159) only** with the prompt below. Do not start step 3 until #159 is merged.

## Kickoff prompt (precursor)

```
Implement https://github.com/regionstockholm/intehrgrator/issues/159
(tabbed Target & Previews + target schema tree + pull leaf/subtree onto the canvas).

Read, in order:
1. docs/design/default-context-map.md — precursor section only
2. docs/adr/0011-default-context-map-runtime-keys.md
3. Root CONTEXT.md (shipped vocabulary: Defaults Map, Defaults block, Open target)
4. docs/UI_ARCHITECTURE.md and docs/TESTING.md
5. GitHub issue #159 (acceptance criteria)
6. Parent #140 — do not implement refresh or in-app AI
7. Do not implement #158

Use the implement skill. Follow TDD at existing seams. Do not build the
three-field default context map block, joint load dialog, or catalog rewrite
(#158, blocked). Do not replace CONTEXT.md with the proposed glossary.

Done when: right pane has three slide-away tabs; Target schema tree shows the
loaded target; dragging a leaf/subtree onto the canvas yields Blockly blocks;
green-path and new UI coverage pass; current Open + Defaults Map still work.
```

## Kickoff prompt (#158, only after #159 is merged)

```
Implement https://github.com/regionstockholm/intehrgrator/issues/158
using the paste body in docs/design/tracker-158.md if the GitHub issue
body is still the old grilling stub.

Read, in order:
1. docs/design/default-context-map.md
2. docs/adr/0011-default-context-map-runtime-keys.md
3. docs/adr/0002-convert-time-defaults.md
4. docs/design/CONTEXT-default-context-map-proposed.md — apply to root CONTEXT.md
5. docs/TESTING.md and docs/UI_ARCHITECTURE.md
6. Issue #159 (already merged) — chips + drag land on that tree

Use the implement skill. Follow TDD. Convert every in-repo defaults fixture
and Example Set in this change (no dual-read). First version of the block is
chips + drag, not a text-field interim.

Done when: unique default context map block has runtime key + scaffold-target
chips + value sockets; joint Load target & default context map works; blank
project has no factory dump; New-map subflow uses the target schema tree;
convert-time defaults argument is runtime keys only; CONTEXT.md matches the
proposed glossary; unit, green-path, and Agent hydration tests pass.
```
