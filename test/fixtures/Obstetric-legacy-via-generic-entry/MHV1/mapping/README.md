# MHV1 generic-entry mapping

Partial mapping from the four `generic-obstetrix-mhv1-v1` FLAT compositions onto `MHV1- Prenatal visit.encounter.v1`. The canvas was produced by the Agent API (`import_suggestions`), not by editing Blockly JSON.

Instance encoding is Simplified FLAT. **Include when** emits an optional entry only when its source value is present:

- enrolment weight (`vikt`)
- last menstrual period (`senastmens`)
- estimated date of delivery from `berakforsm` (senaste mens)
- snus summary (either snus text)
- assessment (`bedomningtext`)

Also mapped, on the composition itself: category (openEHR 433 event), start time, setting 229, composer name and midwife id, and the care unit name and HSA id.

## Certainty

Guesses carry `confidence` (percent) and a block comment. Direct copies (category, setting, start time, care unit, last menstrual period) have a comment and no percent.

- **85** — weight units assumed kg (`vikt` is a bare number)
- **75** — `bedomningtext` on the bedömning text element
- **70** — composer id from `barnmorska`, identifier type `local`
- **70** — both snus texts, placed by the Swedish names
- **65** — weight event time and history origin reuse `context/start_time`
- **60** — EDD is `berakforsm` (senaste mens). `berakforul` is ultraljud. `berakforet` is the third calculation and is set only on the IVF example

`mhv1-generic.intehrgrator-suggestions.json` has a question for each of those choices, with options. The recommended option is the mapping above.

## Not mapped, and why

- The source schema is `../source-schema/generic_obstetrix_mhv1_v1_TEMPLATE.opt` (the integration archetype). The four examples are FLAT compositions of that template. The target is the CKM Web Template, and its composition root can emit Canonical JSON, Canonical XML, Simplified FLAT, or Simplified STRUCTURED. This mapping is saved as Simplified FLAT.
- `BerakForSM`, `BerakForUL`, and `BerakForET` are different calculations of the delivery date. SM is senaste mens and UL is ultraljud. Every example sets `berakforsm`, and that is the mapped EDD. Only the IVF composition sets the other two: `berakforul` is 2025-10-14, two days after the SM date, and `berakforet` is 2025-01-12, a week after senaste mens.
- `anteckning` and `partogram` in the parent fixture have source OPTs and no instances, so there is nothing to map. `Blodtryck` is on the partogram template. `Bp_comp` on this generic entry is a separate date-time (`at0090`). In Swedish obstetrics “bp” can mean beräknad partum. These examples leave `bp_comp` empty.
- There is no personal identity number in the generic source.
- Height (`langd`) has no writable quantity: the magnitude elements under the height observation are max 0.
- Tobacco, alcohol, occupation, workplace, and housing text have no slot whose Swedish or English name identifies them. Canvas path labels on this Web Template repeat unrelated terms ("Notes", "Previous blood transfusion") and are not a safe guide.
- Output validation is not clean. Unmapped sections still scaffold empty coded texts and a history without events (`/content[at0.40]`). `other_context` is a CLUSTER on the canvas and in the operational template; the Web Template has no `other_context` node, and the FLAT round trip reads that structure back as an ITEM_TREE.
