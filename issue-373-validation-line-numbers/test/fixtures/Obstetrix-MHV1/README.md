# OBX MHV1, unmapped, JSON → openEHR

Catalog id `obx-mhv1-unmapped-json-to-openehr` in `examples/example-sets.json`.
Loads the Obstetrix MHV1 JSON Schema and three instance files, plus the
MHV1 Prenatal visit openEHR template. No Blockly mapping.

| File | Description |
|------|-------------|
| `source-schema/obx-mhv1.review-1.schema.json` | JSON Schema for an MHV1 export (array of rows) |
| `source-instance/1-primigravida-basprogram.json` | First pregnancy, Basprogram |
| `source-instance/2-ivf-multipara.json` | IVF, previous pregnancies, MHV3 |
| `source-instance/3-komplex-mhv3.json` | Complex social/medical history, MHV3 |

Source schema, instances, and the flattened target OPT live under
`test/fixtures/Obstetrix-MHV1/`. See `target/README.md` for the upstream
template this OPT was flattened from.
