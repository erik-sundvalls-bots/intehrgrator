# Design note: Sheets vs Maps (Chunk 8 follow-up)

**Status:** **Adopted 2026-09-04 — option A**, plus a toolbox join.

**Adopted Chunk 8 (Q9 mostly B):** replace maps in **code and example sets** when they are used as 2-column terminology lookups. Leave Defaults Map and nested Blockly map **values** alone.

**Adopted step 2 (this judgement):** **Keep `maps_*`.** Do not delete map blocks. Join the Blockly **Lists** and **Maps** toolbox drawers into one category named **Lists & maps**. **Sheets** stays a separate drawer. Optional later: `sheet_to_map` (two columns → Map) for `maps_get` compatibility.

## Why maps cannot vanish in one step

1. **Defaults Map** — `defaults_block` takes a `maps_create_with` argument. `maps_get("defaults", key)` is the convert-time `ctx` path (ADR 0002). Scaffolding wires language / territory / encoding / facility from that Map.
2. **Nested Blockly values** — a map value socket can hold `text`, `source_query`, nested `maps_create_with`, `text_handlebars`, RM shells, lists, … Entire block structures are legal values. A spreadsheet cell in Chunk 8 is a **JSON primitive** (Q6 A). Putting those graphs into cells would fight the widget.
3. **Named 1D lookup** — `maps_get(name, key)` is the right shape for a key→one value table that is *not* a grid (Defaults, Handlebars context objects).
4. **Current examples** — chemotherapy Go-template mapping and dummy-json-vitals use `maps_get` / `maps_create_with` only as **Parameters / Defaults**, not as terminology matrices. Those stay.

## What Chunk 8 already changes

- New **Sheet** document + widget + `sheet_*` Blockly accessors (including `sheet_lookup`).
- AI suggestion examples for **terminology translation** prefer `sheet_lookup` over `maps_get`.
- Toolbox: **Lists & maps** is one drawer (`maps_*` kept). **Sheets** is a separate category.

## Alternatives for step 2 (judged)

### A — Keep maps for Defaults + structured values; sheets for 2D grids — **adopted**

**Do:** leave `maps_*` and `defaults_block` as they are. Terminology / code+rubric tables live only on Sheets. Optional later: `sheet_to_map` (two columns → Map) for `maps_get` compatibility.

**Plus (this judgement):** one toolbox category **Lists & maps** (not two drawers). Sheets remain separate.

**Pros:** no migration of Defaults or nested values; clear glossary split (CONTEXT already says Map ≠ Sheet).  
**Cons:** two lookup vocabularies forever; informaticians may still build 2-col maps by habit.

**Recommendation if the goal is “stop using maps as fake spreadsheets” without rewriting Defaults.**

### B — Dual-read period, then drop terminology maps — not adopted

**Do:** for a release or two, `maps_get("icd10_snomed", key)` also looks up a **Sheet** of that name (first two columns as key/value) when no Map of that name exists. Then remove toolbox `maps_create_with` except as the Defaults argument, and eventually remove dual-read.

**Pros:** old mappings keep working; one lookup block in slots.  
**Cons:** silent fallback is hard to explain; name collisions (a Map and a Sheet both called `defaults`).

### C — `sheet_to_map` + migrate 2-col string maps — deferred

**Do:** scan workspaces for `maps_create_with` whose values are all string/number literals (no nested blocks). Offer “Convert to Sheet”. Keep `maps_create_with` for Defaults and for structured values. Add Blockly `sheet_to_map` (header `code` + header `rubric` → Map) so generated scripts can still call `maps_get` if desired.

**Pros:** explicit migration; nested values untouched.  
**Cons:** one-shot UI; leftover maps still in toolbox.

### D — Defaults becomes a Sheet named `defaults` — rejected

**Do:** rebind `defaults_block` to a Sheet (one row of keys, or two columns key/value). `maps_get("defaults", key)` becomes `sheet_lookup("defaults", "key", key, "value")` or `sheet_get_cell`.

**Pros:** one matrix widget for everything tabular.  
**Cons:** **loses nested Blockly values** unless we invent per-cell block refs (rejected in Chunk 8 Q6). Factory Defaults (language CODE_PHRASE, encoding, facility PARTY) are not primitives today — they are typed blocks. This option is **unsafe** until Defaults values are flattened to strings (a product change, not a storage change).

### E — Hybrid Defaults: Sheet for scalars, Map for structured leftovers — not adopted

**Do:** scalar ctx keys (`language`, `territory`, `encoding` as strings) move to a `defaults` Sheet. Structured keys (`health_care_facility` as `PARTY_IDENTIFIED`) stay on a Map (or stay scaffolded RM shells, not a table).

**Pros:** spreadsheet edit for the boring ctx row; nested values survive.  
**Cons:** two Defaults stores; scaffolding must know which keys are sheet vs map.

## Suggested judgement prompt

Pick one:

1. **A only** (live with both; maybe `sheet_to_map` later) — lowest risk. **← adopted**, with Lists + Maps joined in the toolbox.
2. **C** (migrate obvious 2-col maps; keep Defaults Map) — if the canvas already has terminology maps to convert.
3. **B** (dual-read) — if you want `maps_get` in slots to keep working against sheets without touching blocks.
4. **Do not pick D** unless Defaults nested blocks are explicitly given up.

`maps_*` toolbox entries stay. A later chunk can still add `sheet_to_map`; deleting map blocks is out of scope until Defaults/nested values have another home.
