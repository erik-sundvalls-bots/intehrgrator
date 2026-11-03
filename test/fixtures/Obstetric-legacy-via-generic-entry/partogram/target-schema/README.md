# Partogram.v1 openEHR target

The upstream file is a differential Better template (`.t.json`). It is not operational on its own: it references other templates and archetypes. ehrtslib resolved that GitHub URL and its dependencies (26 files, no warnings) into the files here.

Template id: `Partogram.v1`.

| File | Use |
|------|-----|
| `partogram.v1.wt.json` | Load this as the Web Template target. Web template of the resolved operational template. The template's primary language is English; Swedish labels are in the document. |
| `partogram.v1.opt2` | The same operational template as OPT2 (ADL2). Template id stays `Partogram.v1`. At-code lists are separate terms (`[at0010], [at0011]`). |
| `partogram.v1.fileset.json` | The closure (`sourceUrl`, `rootPath`, `files`). Re-resolve with `scaffoldClinicalModelFileset`. |
| `partogram.v1.opt` | OPT XML from the same resolver. Archetype term definitions are not in this export, so node labels collapse to at-codes. Load the Web Template or the OPT2 when labels matter. |

The generic-entry source schema is `../source-schema/generic_obstetrix_partogram_v1_TEMPLATE.opt`, with `.opt2` and `.wt.json` beside it. Examples for that template are in `../source-instance/` (`*.flat.json` and `*.canonical.json`).

**Upstream** (branch `Obstetrix-openEHR`):

- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/Partogram.v1.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/Medication%20order.partogram.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/local/pdl/Care%20unit%20v2.t.json

The other 23 files in the closure are ADL archetypes from the same repository.
