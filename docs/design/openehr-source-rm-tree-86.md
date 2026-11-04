# Design exploration: RM nodes in openEHR Source Schema tree (#86)

**Status:** throwaway UI prototype — discuss before implementing  
**Issue:** [#86](https://github.com/regionstockholm/intehrgrator/issues/86)  
**Prototype:** `web/prototype-openehr-source-rm-tree.html`  
**Run:** `deno task prototype:source-rm-tree` → http://localhost:5188/prototype-openehr-source-rm-tree.html  
**Also after build:** `deno task build && deno task dev` → `/prototype-openehr-source-rm-tree.html`

## Question

When Source Schema is an openEHR Web Template, how should the Source Schema tree show:

1. **Silent-mandatory RM** attributes/classes the template omits (always map-relevant), and  
2. **Optional RM** that the author may reveal,

…without losing the template-first progressive disclosure the primer and target skeleton already use?

## Three variants (structurally different)

| Key | Name | Affordance | Information hierarchy |
|-----|------|------------|------------------------|
| **A** | Blockly mirror | Per-node `+ optional RM (n)` | Silent-mandatory inline (muted italic); optional expands in place |
| **B** | Fold layers | `▾/▸` fold headers | Template stream primary; “RM required” + “Optional RM” leave the main indent |
| **C** | Scope filter | Pane segmented control | Template / + Mandatory RM / Full RM — density at pane, not per node |

Switch with the floating bar or `?variant=A|B|C` (← → keys).

## Shared assumptions in the mock

- Karolinska tokens; custom tree (no Shoelace rewrite).
- Demo slice inspired by chemo COMPOSITION WT (`name`, `archetype_node_id` as RM-mandatory gaps; `context.end_time`, `feeder_audit`, … as optional).
- Click still selects a path (Click-to-Map stand-in); state panel dumps disclosure state.

## Open product questions (for maintainers)

See discussion on the issue / design review — first frontier:

1. Should LOCATABLE `name` / `archetype_node_id` appear as mappable source nodes?
2. Does this apply only to `openehr-web-template`, or also composition/FLAT/STRUCTURED schema inference?
3. Are revealed optional RM paths immediately click-to-map, or “add then map” like target mutator?
4. Prefer A’s target symmetry, B’s visual separation, C’s global density, or a hybrid?

## Capture

After a variant (or hybrid) wins: fold into `tree_views.ts` + `webTemplateNodeToTree` / RM meta post-pass; keep this prototype on the exploration branch as primary source; record the verdict on #86.
