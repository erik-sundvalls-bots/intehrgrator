# Obstetric legacy via generic entry

Integration archetypes (`generic-obstetrix-*-v1`) as source schemas. MHV1 and the partogram also have a CKM target. `anteckning` has a source template only.

Each operational template is stored in the same directory in three forms:

| Ending | Form |
|--------|------|
| `.opt` | OPT 1.4 XML |
| `.opt2` | OPT2 (ADL2) |
| `.wt.json` | Web Template |

Each example composition is two files with the same basename:

| Ending | Form |
|--------|------|
| `.flat.json` | Simplified FLAT |
| `.canonical.json` | Canonical JSON |

Example sets load one form at a time. The saved MHV1 mapping uses Simplified FLAT keys and the prenatal-visit Web Template. OPT2 targets are separate unmapped sets, because a few value-leaf slot ids differ from that Web Template.
