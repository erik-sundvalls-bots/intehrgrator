# MHV1 generic-entry mapping

Partial mapping from the four `generic-obstetrix-mhv1-v1` FLAT compositions onto `MHV1- Prenatal visit.encounter.v1`. The canvas was produced by the Agent API (`import_suggestions`), not by editing Blockly JSON.

Instance encoding is Simplified FLAT. **Include when** emits an optional entry only when its source value is present:

- enrolment weight (`vikt`)
- last menstrual period (`senastmens`)
- estimated date of delivery (`berakforsm`)
- snus summary (either snus text)
- assessment (`bedomningtext`)

Also mapped, on the composition itself: category (openEHR 433 event), start time, setting 229, composer name and midwife id, and the care unit name and HSA id.

## Not mapped, and why

- The operational template in `../source-schema/` is a target format. It is not a source schema. The example set loads the FLAT instances only.
- `anteckning` and `partogram` in the parent fixture have source OPTs and no instances, so there is nothing to map. Blood pressure lives in `anteckning`.
- There is no personal identity number in the generic source.
- Height (`langd`) has no writable quantity: the magnitude elements under the height observation are max 0.
- Tobacco, alcohol, occupation, workplace, and housing text have no slot whose Swedish or English name identifies them. Canvas path labels on this Web Template repeat unrelated terms ("Notes", "Previous blood transfusion") and are not a safe guide.
- Output validation is not clean. Unmapped sections still scaffold empty coded texts and a history without events (`/content[at0.40]`). `other_context` is a CLUSTER on the canvas and in the operational template; the Web Template has no `other_context` node, and the FLAT round trip reads that structure back as an ITEM_TREE.
