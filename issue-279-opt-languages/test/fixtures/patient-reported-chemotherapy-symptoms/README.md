# Patient-Reported Chemotherapy Symptoms — Mapping Example

This example rebuilds the production Go template mapping script
(`mapping/mappningsscript-1-9-1-prod.txt`) that converts openEHR FLAT JSON
(from *Patientrapporterade symptom inför medicinsk onkologisk behandling*)
into TakeCare `ProfdocHISMessage` XML.

The Blockly mapping uses **schema-generated TakeCare blocks**
(`schema_ProfdocHISMessage`, `schema_TextKeyWord`, `schema_NumericKeyword`, …)
from `test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd`, not generic
`xml_element` blocks. Complex `<Note>` bodies stay as `text_code`
(LANG=`go-template`) copied from the production script, including
`{{ template "cleanAndQuoteFreeTextInput" … }}`.

## Contents

| File | Description |
|------|-------------|
| `mapping/mapping.blockly.json` | Blockly workspace (TakeCare schema blocks) |
| `mapping/mappningsscript-1-9-1-prod.txt` | Original Go template production script |
| `mapping/mappningsscript-1-9-1-xc.txt` | XC variant of the same script |
| `defaults.map.json` | Envelope parameters (`PatId`, `UserId`, `Time`, `TemplateId`, …) |
| `source-instance/*.txt` | openEHR FLAT composition examples |
| `../TakeCare/TakeCare-CasenoteWrite-edit01.xsd` | Canonical target schema |

## What the mapping does

1. Emits the `cleanAndQuoteFreeTextInput` Go `define` (used by several notes).
2. Emits a `<ProfdocHISMessage>` envelope with header fields from the Defaults
   Map. `TemplateType` is the literal `1`; optional `Signed` is `0`.
3. If the patient answered **Nej** (or aptit/matintag code `3`) on **every**
   screening question, emits a single `<TextKeyWord>` TermId **16183**
   (“Patienten rapporterar inga symptom.”).
4. Otherwise emits per-symptom `<TextKeyWord>` elements with the production
   TermIds, outer `if`, and Note templates:

   | TermId | Section |
   |--------|---------|
   | 2811 | Fatigue (`ne` “Nej”, follow-up only when “Ja”) |
   | 1830 | Andning |
   | 6298 | Hjärta-kärl |
   | 7643 | Svullnad |
   | 207 | Hud |
   | 7570 | Naglar |
   | 1921 | Klåda |
   | 2018 | Mun/svalg |
   | 5464 | Aptit/matintag (omitted only when both codes are `3`) |
   | 1908 | Illamående |
   | 1875 | Elimination (diarré / förstoppning) |
   | 2008 | Smärta |
   | 2310 | Sinnesintryck |

5. If any of the three general follow-up questions is not “Nej”, emits TermId
   **14768** (patient comments).
6. Always emits TermId **13700** with the composition `_uid`.
7. If fever or weight-change is “Ja”, emits `<NumericKeywords>`:
   TermId **2025** (temperature) and/or **3484** (weight).

Regenerate after schema-block or PROD-script changes:

`deno run -A scripts/build-chemo-symptoms-blockly.ts`
