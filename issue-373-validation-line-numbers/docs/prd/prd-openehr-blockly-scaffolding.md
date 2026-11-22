# PRD: openEHR Blockly scaffolding from any template format

**Status:** Draft — do not implement until open questions are resolved  
**Triage label:** `ready-for-agent` (apply after a revision that closes the questions below)  
**Glossary:** [CONTEXT.md](../CONTEXT.md)  
**Related:** [docs/BLOCKLY_INTEGRATION.md](../docs/BLOCKLY_INTEGRATION.md), [docs/UI_ARCHITECTURE.md](../docs/UI_ARCHITECTURE.md)

---

## Introduction / Overview

Today the Target value slot rail is built from a **Template Skeleton** after an openEHR template is loaded (OPT, Web Template JSON, or a GitHub `.t.json` resolved to OPT). The Mapping Editor’s Blockly canvas still uses generic `rm_structure` / `element` / `target_*` stacks more often than the typed **openEHR types** toolbox (`composition`, `observation`, `dv_quantity`, …).

Informaticians expect the canvas to look like the clinical model: a COMPOSITION root, ENTRY children, ELEMENT leaves, and `DV_*` shells that match the ZipEHR / ehrtslib RM types already shown in the toolbox. That scaffolding should be identical no matter whether the template arrived as OPT XML, Better `.t.json` + archetypes, Web Template JSON, or another ehrtslib-supported form.

## Problem Statement

The user can already *see* the openEHR type blocks in the toolbox, but loading a target template does not reliably *assemble* those blocks into a Template Skeleton on the canvas. Format-specific loaders (Web Template tree vs OPT AOM walk) also diverge, so the same clinical model can produce different Blockly shapes depending on the file that was opened.

## Solution

Always convert the loaded openEHR template into **one canonical in-memory form** using ehrtslib, then generate Blockly from that form using the existing openEHR type blocks (not a second, format-specific block vocabulary).

**Canonical form (proposed default):** ehrtslib `OPERATIONAL_TEMPLATE` (the same object `ClinicalModelWorkspace.resolveOperational()` already produces for GitHub `.t.json` and OPT files). Optionally also keep a Web Template JSON projection for Source Schema / FLAT paths.

The generator walks the operational template (plus silent-mandatory RM attributes) and calls `workspace.newBlock(blockTypeForRm(rmType))` for containers and `DV_*` shells — reusing `src/blockly/skeleton_loader.ts` and `src/blockly/blocks/rm_blocks.ts`.

## Goals

1. One skeleton pipeline for OPT, `.t.json` (after GitHub/file-set flatten), Web Template, and OET/ADL2 templates ehrtslib can resolve.
2. Canvas scaffolding uses toolbox block types (`composition`, `observation`, `element`, `dv_date_time`, …), not only generic `rm_structure`.
3. Target value slot rail and Blockly tree stay aligned (`slotId`, RM type, ZipEHR emoji / label).
4. Existing Click-to-Map, Optional RM Insertion, Mapping Spec projection, and codegen keep working.

## User Stories

1. As an informatician, I want opening an OPT to drop a COMPOSITION block with nested ENTRY / CLUSTER / ELEMENT / `DV_*` shells, so that the canvas matches the clinical model.
2. As an informatician, I want opening a GitHub `.t.json` (with fetched archetypes) to produce the same Blockly tree as the equivalent OPT, so that source format does not change mapping work.
3. As an informatician, I want opening a Web Template JSON to produce that same tree, so that Better/EHRbase exports are first-class.
4. As an informatician, I want mandatory `DV_*` slots to auto-attach the matching typed shell from the toolbox, so that I do not drag types by hand.
5. As an informatician, I want optional template nodes to appear as empty ELEMENT / value slots until Click-to-Map, so that the canvas stays readable.
6. As an informatician, I want silent-mandatory RM fields (language, composer, start_time, …) to appear as typed slots, so that Test Run validation is honest.
7. As an informatician, I want block labels to use archetype/template term text (and ZipEHR emoji on the rail), so that I can recognise nodes quickly.
8. As an informatician, I want Optional RM Insertion (`+`) to still attach only RM-valid children on these typed containers, so that I cannot build illegal structure.
9. As an informatician, I want collapsing/expanding nested ENTRY blocks to work on the generated skeleton, so that large templates are navigable.
10. As an informatician, I want the Mapping Specification text view to project the same typed blocks, so that Blockly and spec stay in sync.
11. As an informatician, I want reloading a saved project to restore the typed skeleton (or regenerate it from stored OPT/Web Template content), so that I do not re-map after save/load.
12. As an informatician, I want codegen (TypeScript / Java / Handlebars / XQuery) to keep reading the Mapping Model `slotId`s, so that visual block types can change without breaking exports.
13. As a developer, I want a single `generateSkeletonFromOperational` (already started) to be the only OPT walker, so that GitHub `.t.json`, OPT XML, and Web Template→OPT conversion share tests.
14. As a developer, I want fixture tests that load the same clinical model via OPT, Web Template, and mocked GitHub `.t.json` and assert equal Blockly block-type trees, so that format drift is caught.

## Functional Requirements

1. The system must resolve any supported openEHR template input to an ehrtslib `OPERATIONAL_TEMPLATE` before Blockly scaffolding (reuse `parseTemplateInput`, `ClinicalModelWorkspace.resolveOperational`, and `webTemplateToOpt` / `buildWebTemplate` as needed).
2. The system must persist a self-contained form in the Project Bundle (OPT XML and/or Web Template JSON) so restore does not require GitHub.
3. The Blockly skeleton loader must instantiate toolbox block types via `blockTypeForRm(rmType)` for RM containers and DATA_VALUE leaves.
4. ELEMENT.value must accept only the concrete `DV_*` shell for that slot.
5. Mandatory vs optional template occurrences must map to auto-attached shells vs empty slots (current product rule unless an open question below changes it).
6. `slotId` vocabulary must remain stable enough for AI Import Suggestions and Mapping Model round-trip.
7. Target value slot rail rendering stays driven by the same `SkeletonNode[]` used to build Blockly.

## Implementation Decisions (proposed — confirm before coding)

- **Canonical IR:** `OPERATIONAL_TEMPLATE` in memory; Web Template JSON is a derived projection for Source Schema / simplified formats.
- **Conversion:** GitHub `.t.json` → `ClinicalModelWorkspace` → `resolveOperational()` (already implemented for load). Web Template JSON → ehrtslib `webTemplateToOpt` (or equivalent) → same walker. OPT XML → `parseTemplateInput` → same walker.
- **Modules to change:** skeleton generation, `skeleton_loader` (prefer typed blocks over `rm_structure` fallback), target format handler, tests with a shared “block type tree” snapshot.
- **Do not** invent a second Blockly vocabulary for Web Template nodes (`target_structure`) when the target format is openEHR.

## Testing Decisions

- Test external behaviour: given template bytes (or a mocked GitHub closure), the workspace top block is `composition` (or the template root RM type) and named children match term text / RM types.
- Compare OPT vs Web Template vs GitHub `.t.json` fixtures for one small composition (blood pressure or accident-report) and assert equal `blockType` + `rmType` + `slotId` suffix trees.
- Do not assert x/y pixel positions.
- Prior art: `test/skeleton_test.ts`, `test/blockly_rm_blocks_test.ts`, `test/github_template_load_test.ts`.

## Non-Goals (Out of Scope)

- Free-form composition building from the toolbox as a substitute for a template (toolbox remains for type replacement / teaching).
- Authoring archetypes/templates (ADL) inside intEHRgrator.
- Changing Conversion script languages or Test Run execution.
- Visual redesign of the Blockly theme beyond what typed blocks already provide.

## Design Considerations

- Target rail already shows ZipEHR datatype emojis; Blockly field labels should stay consistent with `block_labels.ts`.
- Large templates: keep collapse-all / expand-all; consider generating collapsed nested ENTRYs by default (open question).

## Technical Considerations

- ehrtslib already exposes `buildWebTemplate`, `webTemplateToOpt`, `OptXmlSerializer`, `ClinicalModelWorkspace`.
- OptXmlSerializer is lossy for terminology; prefer walking the live `OPERATIONAL_TEMPLATE` object (`generateSkeletonFromOperational`) rather than serialize-then-reparse when scaffolding.
- Web Template handler today maps JSON tree → generic `target_structure` / `target_value`. That path must be replaced for `openehr-template` targets after conversion to OPT.

## Success Metrics

- One clinical model loaded three ways yields the same Blockly block-type tree in tests.
- Informaticians can map systolic BP from the canvas without noticing which file format was opened.
- No regression in Click-to-Map, autosave, or GitHub `.t.json` load tests.

## Open Questions

Please answer these before a revision of this PRD and implementation:

1. **Canonical IR for scaffolding**
   - A. Always flatten to `OPERATIONAL_TEMPLATE` (recommended)
   - B. Always convert to Web Template JSON and walk that tree
   - C. Keep both walkers and only unify Blockly block types

Answer: A

2. **How complete should the first canvas be?**
   - A. Mandatory template + silent-mandatory RM only (current skeleton policy)
   - B. Entire template tree including optional 0..1 / 0..* branches, collapsed
   - C. Mandatory now, optional via a “show optional nodes” toggle

Answer: A - the optional things are already possible to do by using the encircled plus signs on the openEHR blockly blocks

3. **Web Template as target vs source**
   - A. Web Template file used as *target* is converted to OPT then scaffolded as openEHR blocks
   - B. Web Template as target stays a generic JSON-like `target_structure` tree; only OPT/`.t.json` get openEHR blocks
   - C. User chooses at load time

Answer: A - ehrtslib should be the core library for  - if anything is missing there then we can update ehrtslib, i am its maintainer

4. **`rm_structure` fallback**
   - A. Delete generic `rm_structure` for openEHR targets once typed blocks cover the RM set
   - B. Keep it only for RM types that have no dedicated toolbox block
   - C. Keep it indefinitely as the implementation for all containers

Answer: A - AND add missing blocks use /opennehr-assistant if needed to understand

5. **Regeneration after Optional RM Insertion**
   - A. Rebuild the whole canvas from skeleton + `optionalRm[]` (simpler, may lose x/y)
   - B. Mutate the live Blockly tree in place (keeps layout, harder)
   - C. Rebuild but persist x/y per `slotId`

Answer: Try B

6. **GitHub `.t.json` stored in the Project Bundle**
   - A. Store resolved OPT XML only (current load path)
   - B. Store OPT XML + Web Template JSON
   - C. Store the full fetched file-set (`.t.json` + ADL) for round-trip fidelity

Answer: C

7. **Should scaffolding run for JSON Schema / XSD targets?**
   - A. No — only openEHR templates (recommended)
   - B. Yes — map those to `target_structure` / `target_value` only
   - C. Later, generate a best-effort openEHR-like tree (out of scope for this PRD)

Answer: B - feel free to add suitable blockly toolbox/drawers and blocks for...
 1. generating generic JSON / XML output
 2. dynamically generated blocks based on specific selected schema

---

## Further Notes

GitHub `.t.json` closure loading (demo-app AD@git) is **already in this repo** for schema and target menus. This PRD is only about using openEHR Blockly blocks when *rendering* the scaffolding after that (or any other) load.

Do not implement this PRD until the open questions are answered and the document is revised.
