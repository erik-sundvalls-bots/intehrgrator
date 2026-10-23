# Example sets audit

Audit of catalogued Example Instances under `test/fixtures/` (see `examples/example-sets.json`).

The instance-validation table below is from an earlier catalog pass (for example it still lists lung-MDT as having zero instances). Regenerate it when catalog instances change. Catalog titles put unmapped / mapped / mapped-decision-tables last ([#166](https://github.com/regionstockholm/intehrgrator/issues/166)). Karda clinical FLAT and XQuery, Agent API sheet revision and `list_slots`, and lung-MDT preview/Handlebars Note parity are covered by `test/example_set_conversion_agent_test.ts` and `test/agent_headless_loop_test.ts`.

**Regenerate the instance-validation table:**

```bash
deno run -A --no-check scripts/audit-example-instances.ts
```

That updates the section between `<!-- BEGIN:instance-validation -->` and `<!-- END:instance-validation -->` in this file, and writes JSON to `/opt/cursor/artifacts/example-instance-audit.json`.

**Re-run TypeScript Conversion Script Test Run** (per set, after mapping changes):

```bash
deno run -A --no-check scripts/apply-example-mapping.ts \
  --set <set-id> \
  --suggestions <path-to-intehrgrator-suggestions.json> \
  [--sheets <path-to-sheets.json>] \
  [--encoding flat-json] \
  --out-dir <fixture-mapping-dir>
```

Named-broken instances (`invalid`, `broken`, `fail`, `bad` in the filename) are kept in the catalog for negative tests but skipped for mapping validation.

## Instance validation vs Source Schema

<!-- BEGIN:instance-validation -->
| Set | Instance | Catalog | Named-broken | Schema-valid | Notes |
| --- | --- | --- | --- | --- | --- |
| dummy-json-vitals | `instance-1.json` | yes | no | valid | — |
| dummy-json-vitals | `instance-2.json` | yes | no | valid | — |
| dummy-json-vitals-mapped | `instance-1.json` | yes | no | valid | — |
| Simple-vitals | `bp-inst.json` | yes | no | valid | — |
| Simple-vitals | `bp-inst-2.json` | yes | no | valid | — |
| Simple-vitals | `bp-inst-3-invalid.json` | yes | yes | invalid (expected) | $.diastolic: 2 is less than 30.; $.bodyPosition: Instance does not match any of ["sitting","lying","standing"].; $: Property "diastolic" does not match additional properties schema. |
| Simple-vitals-series | `bp-series-inst.json` | yes | no | valid | — |
| Simple-vitals-series | `bp-series-inst-2.json` | yes | no | valid | — |
| Simple-vitals-series | `bp-series-inst-3-invalid.json` | yes | yes | invalid (expected) | $.measurements: Items did not match schema.; $.measurements[2].diastolic: 2 is less than 30.; $.measurements[2].bodyPosition: Instance does not match any of ["sitting","lying","standing"]. |
| obx-mhv1-unmapped-json-to-openehr | `1-primigravida-basprogram.json` | yes | no | valid | — |
| obx-mhv1-unmapped-json-to-openehr | `2-ivf-multipara.json` | yes | no | valid | — |
| obx-mhv1-unmapped-json-to-openehr | `3-komplex-mhv3.json` | yes | no | valid | — |
| chemo-symptoms-flat-to-tc-xml | `1-ex-composition.txt` | yes | no | valid | no source schema; parsed as JSON |
| chemo-symptoms-flat-to-tc-xml | `2-ex-composition-empty.txt` | yes | no | valid | no source schema; parsed as JSON |
| chemo-symptoms-flat-to-tc-xml | `3-ex-composition-full.txt` | yes | no | valid | no source schema; parsed as JSON |
| chemo-symptoms-flat-to-tc-xml | `4-ex-composition.txt` | yes | no | valid | no source schema; parsed as JSON |
| chemo-symptoms-flat-to-tc-xml | `5-ex-composition.txt` | yes | no | valid | no source schema; parsed as JSON |
| lung-mdt-form-to-tc-xml | `(none)` | yes | no | INVALID | catalog lists zero Example Instances |
| karda-ordinationsdata-to-openehr-flat | `ordination-example_source_used_for_mapping.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-A-source-example.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-B-source-example.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-C-source-example.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-D-source-example.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-E-source-example.json` | yes | no | valid | — |
| karda-ordinationsdata-to-openehr-flat | `ordination-TESTFALL-PRÖV-läkemedel-source-example.json` | yes | no | valid | — |
| karda-administreringsdata-to-openehr-flat | `administration-example_source_used_for_mapping.json` | yes | no | valid | — |
| karda-administreringsdata-to-openehr-flat | `administration-TESTFALL-A-source-example.json` | yes | no | valid | — |
| karda-administreringsdata-to-openehr-flat | `administration-TESTFALL-B-source-example.json` | yes | no | valid | — |
| karda-administreringsdata-to-openehr-flat | `administration-TESTFALL-C-source-example.json` | yes | no | valid | — |
| karda-administreringsdata-to-openehr-flat | `administration-TESTFALL-PRÖV-läkemedel-source-example.json` | yes | no | valid | — |
| sheets/icd10-snomed (uncatalogued) | `ai-created-icd10-snomed.source.json` | no | no | valid | no source schema; parsed as JSON |

### Schema flags

(none)
<!-- END:instance-validation -->

## TypeScript Conversion Script Test Run

`ok: true` means generated TypeScript parsed and `convertSourceToComposition` executed without throw. `validationValid: false` is OPT/RM output validation (not required for this audit). Named-broken instances were skipped.

| Set | Instance | TS ok |
| --- | --- | --- |
| dummy-json-vitals-mapped | instance-1.json | catalog mapping already present |
| Simple-vitals | bp-inst.json | true |
| Simple-vitals | bp-inst-2.json | true |
| Simple-vitals | bp-inst-3-invalid.json | skipped (named-broken) |
| Simple-vitals-series | bp-series-inst.json | true |
| Simple-vitals-series | bp-series-inst-2.json | true |
| Simple-vitals-series | bp-series-inst-3-invalid.json | skipped (named-broken) |
| obx-mhv1-unmapped-json-to-openehr | 1-primigravida-basprogram.json | true |
| obx-mhv1-unmapped-json-to-openehr | 2-ivf-multipara.json | true |
| obx-mhv1-unmapped-json-to-openehr | 3-komplex-mhv3.json | true |
| karda-ordinationsdata-to-openehr-flat | all 7 catalogued instances | true |
| karda-administreringsdata-to-openehr-flat | administration-example_source_used_for_mapping.json | true |
| chemo-symptoms-flat-to-tc-xml | (manual Blockly kept) | not re-run here |
| lung-mdt-form-to-tc-xml | (manual Blockly kept; no instances) | n/a |

Import reports: Simple-vitals applied 7; series applied 7 + 1 loop; OBX applied 18; karda admin applied 19 + 1 loop; karda ordination applied 47 + 3 loops.

AI-generated envelopes (`pass-*-ai.*`, `ai-created-*`) stay on disk and are not catalogued.

### Catalog mappings (Blockly + sheets)

| Set ID | Mapping | Sheets |
| --- | --- | --- |
| Simple-vitals | `simple-vitals.blockly.json` | `simple-vitals.sheets.json` |
| Simple-vitals-series | `bp-series.blockly.json` | `bp-series.sheets.json` |
| obx-mhv1-unmapped-json-to-openehr | `Obstetrix-MHV1/mapping/mapping.blockly.json` | `mapping.sheets.json` |
| karda-ordinationsdata-to-openehr-flat | `mapping.blockly.json` | `mapping.sheets.json` |
| karda-administreringsdata-to-openehr-flat | `mapping.blockly.json` | `mapping.sheets.json` |

Unchanged manual mappings: chemo, lung-MDT, dummy-json-vitals-mapped.
