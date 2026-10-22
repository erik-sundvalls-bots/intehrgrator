# Absorbing Kintegrate into intEHRgrator

Goal: cover Kintegrate Integration Builder use cases in intEHRgrator so
Kintegrate can be retired. Architectural seams are documented in
[ADR 0001](adr/0001-mapping-and-target-seams.md).

## Product mapping


| Kintegrate surface                                                    | intEHRgrator destination                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Left column JSON tree (often openEHR Composition / FLAT / STRUCTURED) | **Source Format Handler** (`json`, `openehr-`*) + Source Pane                                                                 |
| Middle Handlebars conversion editor                                   | Canvas **Handlebars text block** (`text_handlebars` + **Code text** LANG=Handlebars); Output mode **Handlebars** |
| Right live output                                                     | **Conversion Test Run(s)** via Target instance format / canvas `handlebars()` |
| free-text / CSV / HTML / XML produced by templates                    | **Target instance format** `free-form` (template is the conversion) or schema targets with slot mapping                       |
| openEHR OPT / Web Template as *target*                                | **Target instance format** `openehr-template` (unchanged primary clinical path)                                               |
| Better Form Renderer push/pull/sync                                   | Optional **Better Form Bridge** (`src/core/output/better_form_bridge.ts`). The user uploads the licensed files in the viewer; they stay in that browser ([ADR 0012](adr/0012-better-renderer-browser-cache.md)) |
| `window.formTestApi`                                                  | **Workbench Test API** (`?testMode=1`) for mapping; Better `formTestApi` remains inside the optional form viewer shell        |




## Important separation

Kintegrate often treats openEHR as *source* and something else as *output*.
intEHRgrator therefore separates:

1. **Source Format** — what you map *from* (JSON, XML, openEHR Composition/FLAT/STRUCTURED/Web Template).
2. **Target instance format** — shape of produced instances (adhering to `openehr-template`, `json-schema`, `xml-schema`, or `free-form`).
3. **Conversion script language** — executable representation (`typescript`, `java`, `handlebars`).

Handlebars is not assumed to emit openEHR. Slot mapping + Target instance format
render is preferred for structured targets; Handlebars remains first-class for
prose, CSV, HTML, and legacy Kintegrate scripts that walk the source tree
directly.

## Handlebars script language compatibility

Implemented helpers (same set as Kintegrate Integration Builder):

`eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `and`, `or`, `toLowerCase`, `toUpperCase`

intEHRgrator additions for Mapping Model interop:

- `{{slot "slotId"}}` — evaluated Mapping Model slot values
- `{{{json value}}}` — JSON serialization without HTML escaping

Click-to-Map into a selected Handlebars **Code text block** (or the SCRIPT mouth of `text_handlebars`) inserts either a flat Kintegrate-compatible
path (`buildHandlebarsPath`, including bracketed FLAT keys such as
`[ctx/language]`) or a nested `{{#with}}` / `{{#each}}` snippet
(`buildHandlebarsTree`). Shift+click toggles nested mode. If no eligible
Handlebars editor is selected, Click-to-Map falls through to Listening Mode.

## Better Form Renderer (licensed, optional)

File → **Open Better form**. The viewer asks for the same three files
Kintegrate asked the user to upload: `form-renderer.js`, `styles.css`, and
`styles-theme.css`, from a Better Platform install the user already has.
Nothing in the intEHRgrator repo or build contains those files. The browser
stores them in a Cache API entry that survives a normal reload and is not
part of the Project Bundle. **Clear renderer** in the viewer removes them.

The Better Form Bridge posts `intehrgrator:better-form-*` messages to that
viewer window. Full form-viewer HTML + Cypress form-test generator port from
Kintegrate remains a follow-up; the seam is in place so Mapping Model and Host
stay free of proprietary types. Decision: [ADR 0012](adr/0012-better-renderer-browser-cache.md).

## Migration checklist for existing Kintegrate workspaces

1. Load source JSON (Composition / FLAT / STRUCTURED) as Source Schema / Example.
2. Set Conversion script language to **Handlebars** (optional — Mapping preview also runs the canvas product).
3. Open the existing `.hbs` as a **free-form** Target instance format (seeds Conversion start → Text document → `text_handlebars` with source-root context).
4. Add an Example Instance and **Run Test** — output should match Kintegrate's
  right column for the same helpers/path style.
5. Optionally open **Open Better form** and upload the licensed renderer when the
  conversion feeds a Better form.



## Regression fixtures (from Kintegrate startup examples)


| Fixture                                                                                      | Role                                                                             |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `test/fixtures/kintegrate/intro.json` + `intro_tips.hbs`                                     | Plain JSON starter tips (default Kintegrate load)                                |
| `test/fixtures/kintegrate/MDK_Rek_demo1.json` + `mdk_rek_demo.hbs`                           | openEHR STRUCTURED composition slice of the startup script                       |
| `handlebars-script1.hbs`                                                                     | Full Kintegrate startup script (intro tips + MDK clinical blocks in one file)    |
| `emergency-ward-example-20260212.json` + `air-oxygenation.hbs`                               | Emergency-ward STRUCTURED example (pulse ox / breathing / O₂ narrative)          |
| `*.blockly.json`                                                                             | One-time Handlebars → Blockly **path inventory** (not full narrative round-trip) |


Tests: `test/kintegrate_migration_test.ts`. Regenerate Blockly inventories with:

```bash
deno task convert:kintegrate-hbs
```

A general Handlebars→Blockly translator that preserves prose/`#if`/`@index` is **not** attempted; `handlebars_to_blockly.ts` only extracts paths into `source_query` / `for_each_source` blocks for Spec review.

## Remaining absorption (not blocking Integration Builder kill-path)


| Item                                                                           | Status                                 |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| Port more fixtures (emergency-ward, full `handlebars-script1.hbs` as one file) | Done                                   |
| Nested `{{#with}}`/`{{#each}}` insert from tree (beyond flat `{{}}` path)      | Done                                   |
| Full Better ScriptApi / `formTestApi` + Cypress form-test generator            | Deferred (P2)                          |
| Offline mock-CDR service worker                                                | Deferred                               |
| Context-boundary tree framing                                                  | **Won't port** — use `for_each_source` |


