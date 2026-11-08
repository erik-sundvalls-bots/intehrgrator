# RM nodes in the openEHR Source Schema tree (#86)

**Status:** implemented — variant A (Blockly mirror), chosen by Erik Sundvall on 2026-11-06  
**Issue:** [#86](https://github.com/regionstockholm/intehrgrator/issues/86)

## Decision

Variant A. Rows stay one line high. Where a node still has optional RM attributes, the affordance is a small low-contrast encircled plus with no text. The accessible name is “Show optional reference-model attributes for {name}” (and “Hide …” when it is open). Variants B (fold layers) and C (scope filter), and the throwaway prototype that compared them, were removed when this shipped.

## Behaviour

When the Source Schema is an openEHR Web Template or an operational template (read as that Web Template):

- Silent-mandatory RM attributes the template does not already occupy are always shown, muted and italic, in RM attribute order ahead of the template children.
- A template child occupies the RM attribute named by its AQL segment (`vårdenhet` under `other_context`, observations under `content`, flattened leaves under `data`). Those attributes are not added again.
- Web Template `inputs` cover the value they already show. `unit` is `units`, `code` is `defining_code`, and an input with no suffix covers the primary mapping attribute (`value`, `magnitude`, …). Same reading as template-skeleton input constraints.
- Optional RM is not stored on the tree (a full copy dominated the chemo template). The plus reveals those attributes in place, with the mandatory spine of each one, and the revealed rows are click-to-map paths immediately.
- `name` and `archetype_node_id` are shown on LOCATABLE nodes. They are ordinary source paths.

FLAT, STRUCTURED, and canonical Composition trees inferred from an example do not carry RM class names, so this pass does not apply to them.

Example-vs-schema checks ignore the synthetic mandatory rows, so a composition that omits `name` is not reported as a schema mismatch.

## Maintainer questions

1. **LOCATABLE `name` / `archetype_node_id` as source nodes.** Shown, and click-to-map. Say if they should stay hidden.
2. **Which source formats.** Web Template and operational template only, because those trees have RM types. Instance-inferred FLAT / STRUCTURED / canonical trees are unchanged.
3. **Reveal vs add-then-map.** Revealed optional rows are source paths at once. The target cogwheel is unchanged.
4. **Variant.** A.
