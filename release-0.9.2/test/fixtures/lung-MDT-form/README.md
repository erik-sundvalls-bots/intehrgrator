# Lung MDT form → TakeCare XML

Maps a lung multidisciplinary-team (MDT) openEHR form into a TakeCare
`ProfdocHISMessage` casenote-write message.

The production conversion script is Handlebars
(`mapping/mappningsscript-xml-3-2-0-prod.txt`). The Blockly mapping in
`mapping/mapping.blockly.json` rebuilds that script on **schema-generated
TakeCare blocks** (`schema_ProfdocHISMessage`, `schema_TextKeyWord`, …) from
`test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd`, not generic `xml_element`
blocks.

| File | Description |
|------|-------------|
| `mapping/mapping.blockly.json` | Blockly workspace (TakeCare schema blocks) |
| `mapping/mappningsscript-xml-3-2-0-prod.txt` | Original Handlebars production script |
| `mapping/mappningsscript-xml-3-2-1-qa.txt` | QA variant of the same script |
| `defaults.map.json` | Envelope parameters (`PatId`, `UserId`, `Time`, `TemplateId`, …) |
| `../TakeCare/TakeCare-CasenoteWrite-edit01.xsd` | Canonical target schema |

Header fields come from the Defaults Map. Each `TextKeyWord` / `DatetimeKeyword`
keeps its TakeCare `TermId` as a number and the original Handlebars `Note` body
in a `text_code` block. Outer `{{#if}}` wrappers become `controls_if` so empty
keywords are omitted.

`TemplateId` / `TemplateType` in the Defaults Map are placeholders — set them to
the casenote template used in the target TakeCare environment.

Regenerate the Blockly JSON after schema-block changes:

`deno run -A scripts/build-lung-mdt-blockly.ts`
