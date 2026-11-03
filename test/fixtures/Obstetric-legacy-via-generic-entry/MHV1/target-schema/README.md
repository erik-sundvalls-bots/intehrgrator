# MHV1 Prenatal visit openEHR target

The upstream file is a differential Better template (`.t.json`). It is not operational on its own: it references other templates and archetypes. ehrtslib resolved that GitHub URL and its dependencies (50 files, no warnings) into the two files here.

Template id: `MHV1- Prenatal visit.encounter.v1`.

| File | Use |
|------|-----|
| `mhv1-prenatal-visit.encounter.v1.wt.json` | Load this as the Web Template target. Web template of the resolved operational template, including Swedish labels. |
| `mhv1-prenatal-visit.encounter.v1.opt2` | The same operational template as OPT2 (ADL2). Template id stays `MHV1- Prenatal visit.encounter.v1`. At-code lists are separate terms (`[at0010], [at0011]`). |
| `mhv1-prenatal-visit.encounter.v1.fileset.json` | The closure (`sourceUrl`, `rootPath`, `files`). Re-resolve with `scaffoldClinicalModelFileset`. |

An OPT XML export from the same resolver omits archetype term definitions, so node labels collapse to at-codes. That export is not stored.

**Upstream** (branch `Obstetrix-openEHR`):

- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/MHV1-%20Prenatal%20visit.encounter.v1.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/MedicationScreening.v1.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/Blood%20transfusion.v1.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/Pregnancy%20summary.t.json
- https://github.com/regionstockholm/CKM-mirror-via-modellbibliotek/blob/Obstetrix-openEHR/local/pdl/Care%20unit%20v2.t.json

The other 45 files in the closure are ADL archetypes from the same repository.
