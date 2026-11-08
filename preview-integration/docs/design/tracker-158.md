Paste as the body of [#158](https://github.com/regionstockholm/intehrgrator/issues/158) (this agent cannot edit existing issues). Suggested title: **Default context map: jointly load target, runtime keys, scaffold-target chips**.

---

Grilling 2026-09-20 locked this issue. **Do not implement until [#159](https://github.com/regionstockholm/intehrgrator/issues/159) is merged.** #157 is already on `main`.

## Docs (source of truth)

- [docs/design/default-context-map.md](../design/default-context-map.md)
- [ADR 0011](../adr/0011-default-context-map-runtime-keys.md)
- Proposed glossary (apply to root `CONTEXT.md` in this issue, not before): [CONTEXT-default-context-map-proposed.md](CONTEXT-default-context-map-proposed.md)

## Product

Replace **Open** (`Target:` + short Open) with **Load target & default context map**. Joint confirm: pick target **and** a **default context map** from the catalog (per-family factory / named snapshot / file), then generate **Template Skeleton** + **Default point**s.

Blank canvas: **no** factory dumped. **New** map is a subflow that requires the target schema browser first (pull pieces onto value sockets, chip **scaffold targets**, Save as).

The unique canvas block **is** the **default context map** (stop plugging a `maps_create_with`). Each **entry**: **runtime key** + **scaffold targets** (chips + drag; no text-field-only interim) + nested Blockly **value**.

Convert-time `defaults` argument and `maps_get("defaults", runtimeKey)` use **runtime keys** only. #157 path matching moves onto **scaffold targets**.

Values live; structure is discrete (joint confirm / **Apply default context map** / later #140 refresh). No dual-read of old map JSON — convert in-repo examples in this change.

Agent/MCP: hydrate the new JSON; `load_target` stays split. Joint dialog is web app / desktop only.

## Blocked by

#159. Do not start this issue first.

## Out of scope

- #140 remainder (non-destructive refresh, in-app AI)
- JSON Schema / XML Schema scaffold-target grammars until those family catalogs need them
