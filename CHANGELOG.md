# Changelog

Notable changes per release, newest first. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are the desktop / web app versions (tags `vX.Y.Z`, with `X.Y.0` tagged `vX.Y`). Each release's frozen web app is at `https://regionstockholm.github.io/intehrgrator/<tag>/`.

Add an entry under **Unreleased** in every feature or fix PR that changes user-visible behaviour; the release PR renames it to the new version.

## [Unreleased]

- **Coded text on DV_TEXT slots** ([#274](https://github.com/regionstockholm/intehrgrator/issues/274)): every `DV_TEXT` slot can now be mapped as its subclass `DV_CODED_TEXT` (value + code + terminology), as openEHR allows. A template cannot forbid this. Right-click a text block on the canvas and choose **Use coded text (DV_CODED_TEXT)** to get code and terminology sockets, or **Use plain text (DV_TEXT)** to go back. Each switch is one undo step. When the source has a code and its code system for a text (e.g. a diagnosis with an ICD-10 code), the AI now maps it as coded text instead of dropping the code. It still offers text only or a TERM_MAPPING as alternatives. The slot tree shows `DV_CODED_TEXT` for such a slot. Canonical JSON/XML, Simplified FLAT (`|code`, `|terminology`), TypeScript, XQuery and Java output carry the code. Fix: a coded text whose code comes from a Decision table (e.g. *Position* in Simple vitals) now keeps its code in XQuery and Java output (it was empty).
- **AI chat: no mapping context dropped without asking** ([#292](https://github.com/regionstockholm/intehrgrator/issues/292)): when the history is above the limit for the model, Send now stops with a card (**Continue with trimmed history**, **Start new chat with summary**, **Cancel**) instead of dropping old turns on its own. The 400k-character localStorage cap now only cuts the stored copy (the open chat keeps everything) and says so once. The agent no longer stubs out an older `get_example` / `list_slots` / … result when the newer call had other arguments; `get_source_tree` goes 64 levels deep (was 8) and marks cut nodes with `childrenOmitted`; the copy prompt counts the constraint warnings, sheet rows and JSON Schema `examples` it leaves out.
- **Fix: output names no longer follow the UI language**: since multilingual OPT files (#279), a node's RM `name/value` was its label in the language shown. So with an English UI, the Karda sets wrote English names, and the Swedish name constraints rejected them (Karda unmapped sets: 76 validation messages in English, 24 in Swedish). A node you have not renamed now gets the template's name constraint when there is one. Otherwise it gets the term in the template's primary language (lang.1, which for OPT 1.4 is the top-level `<language>` chosen at export). A name you typed yourself is kept. The Karda unmapped sets now give the same 12 messages in any UI language (only the pre-existing missing `description`).
- **ehrtslib v0.6** ([release](https://github.com/ErikSundvall/ehrtslib/releases/tag/v0.6)): validation messages give RM paths as `/content[0]/data/…` (was `/content/[0]/data/…`). A target ADL with a fatal cADL error now fails to load with the parser's message (line, column, token) instead of loading a partial archetype. Templates loaded from GitHub (`.t.json` + archetypes) take their per-template terms from ehrtslib instead of a local rebuild from the Web Template, and GitHub OPTs also take Simplified FLAT ids from the original language. Mapped Karda outputs now report an empty `ism_transition/careflow_step` value. The local TemplateValidator override keeps only the absent-optional-attribute fix; sibling matching by node id is upstream, and the earlier name-based sibling patch is dropped (it caused false `name/value` errors on Karda).
- **ehrtslib v0.7** ([release](https://github.com/ErikSundvall/ehrtslib/releases/tag/v0.7)): the openEHR output validator is now ehrtslib's own, unpatched. It no longer checks inside an optional attribute the output leaves out, such as `protocol` or `state` ([ErikSundvall/ehrtslib#198](https://github.com/ErikSundvall/ehrtslib/issues/198)), and no longer asks for `EVENT.offset`, which is derived ([#200](https://github.com/ErikSundvall/ehrtslib/issues/200)). The local validator patch (`scripts/patch-ehrtslib-validator.ts` and the `vendor/ehrtslib-overrides/` file it wrote) is gone, so `deno task vendor` only clones the example archetypes. UCUM unit checks are back on ([#199](https://github.com/ErikSundvall/ehrtslib/issues/199)). Units such as `/min`, `1/min` and `{beats}/min` pass, and an output with a unit that is not UCUM now gets a validation message. Validation messages for the bundled Example Sets are unchanged.
- **AI chat: prompt caching for Claude via OpenRouter** ([#277](https://github.com/regionstockholm/intehrgrator/issues/277) §6): requests to an `anthropic/…` model on OpenRouter now ask for Anthropic's automatic prompt caching (`cache_control`), so each tool step and each new turn reads the earlier part of the chat from the cache (about a tenth of the input price; the first write costs 1.25×). OpenAI, Gemini, DeepSeek and Grok cache by themselves; Anthropic's own OpenAI-compatible endpoint does not support caching, so its requests are unchanged.
- **Id language per target file** ([#289](https://github.com/regionstockholm/intehrgrator/issues/289)): an **Ids** dropdown on the target's COMPOSITION root block picks the language of that target's Web Template ids, and so of its Simplified FLAT paths. It lists the file's languages as ISO codes with their names, the template's primary language (lang.1) first and default. For an OPT 1.4 file the primary language is its top-level `<language>`, chosen at export (e.g. `sv` for `…MedKurdag….sv.en.opt`, whose archetypes are English originals); ehrtslib calls it `original_language`. Only ids change: labels, mappings (slot ids are archetype paths) and output names stay. Once source mappings exist, the app asks before it changes the FLAT paths; Undo reverts the choice. A Web Template JSON file keeps its own ids. The project now stores each file's language settings with that file: `target.languageSettings` = `{languages, idLanguage, labelLanguage}` (languages in order, lang.1 first; `idLanguage` is `"primary"` or an ISO code; `labelLanguage` is the 💬 choice) and `sourceSchema.languageSettings` = `{languages, labelLanguage}`, restored on reload.
- **Source descriptions say their language** ([#277](https://github.com/regionstockholm/intehrgrator/issues/277) §5): `get_source_tree` now gives `descriptionLanguage` (the source's first language when the schema has texts in it), `sourceLanguages` and `schemaLanguages`, and marks a node with `lang` only when its description had to fall back to another language (e.g. an element documented only in English in a Swedish-first XSD). `get_source_tree {language: "en"}` (HTTP `?language=en`) returns the descriptions in another of the schema's languages without changing the source pane. The AI chat's source outline says which language its descriptions are in and marks the others, e.g. `/Visit/Weight decimal [1] — (en) Body weight in kg.`
- **Multilingual OPT files** ([#279](https://github.com/regionstockholm/intehrgrator/issues/279), [#277](https://github.com/regionstockholm/intehrgrator/issues/277)): an OPT 1.4 XML file with translations (per-archetype term definitions, e.g. `simple-diagnose-and-vitals.opt` in English, Swedish and German) now lists all its languages, so the 💬 button, `target.lang.N` and the AI `labels` work for it as for Web Templates. Before, such a file offered only its original language. The AI slot tree's descriptions, value descriptions and `get_slot`'s labels per language come from the translations too. Simplified FLAT ids always come from the original language, whatever 💬 shows (until [#289](https://github.com/regionstockholm/intehrgrator/issues/289)). ehrtslib reads every OPT 1.4 language and builds one Web Template with all of them ([ErikSundvall/ehrtslib#160](https://github.com/ErikSundvall/ehrtslib/pull/160)). In the 💬 list, a code that is not ISO 639-1 is shown as written with ⚠ and a tooltip.
- **Labels in the source's language; 💬 language widgets** ([#279](https://github.com/regionstockholm/intehrgrator/issues/279), [#277](https://github.com/regionstockholm/intehrgrator/issues/277) part 4): the source's languages (`xml:lang`, JSON `x-lang` / `x-i18n`, or set under **AI ▾ → Languages…**) put the target's languages in order: matches first, then (only if none matched) the UI language, then the language the template was written in. The target pane shows its labels in the first of these by default, so a Swedish source gets the Swedish labels of a multilingual template. The **Model** language menu is replaced by a 💬 button in the target pane (keyboard: arrows, Enter, Esc) to pick another language, kept with the project until you choose **Follow the source**; hovering a target row shows its label in the other languages. A bilingual XSD or JSON Schema source gets its own 💬 for the language of its descriptions. The AI always gets the labels and descriptions in that first language, whatever the panes show, so switching the shown language does not change the prompt; other languages the source uses are added per slot as `labels` (Languages… → all, or the first only). Older projects keep the target language they were shown in. The AI chat's source outline now ends each node with its description (first sentence, in the source's first language).
- **AI sees what each slot means** ([#277](https://github.com/regionstockholm/intehrgrator/issues/277), part 3): slot-tree rows now carry the target's own description (first sentence), comment, annotations, term bindings, ordinals, numeric range and precision, pattern, length, format, examples, default, and a description per allowed value — from the OPT (via its Web Template), JSON Schema (`description`, `$comment`, `enum` + `x-enumDescriptions`, `x-i18n`, `minimum` …) or XSD (`xs:documentation`, facets, enumeration docs). An archetype's or object's description is given once on its group. `get_slot` returns the full texts and all languages. **XSD targets** are now read with the same XSD reader as XSD sources (#278): elements of named complex types, `ref`, groups, attribute groups and extensions now become slots (before, e.g. `Diagnosis` of type `DiagnosisType` was one value slot without its `Code` and `@primary`).
- **AI prompts: stable guide first, models named once, raw target only on request** ([#277](https://github.com/regionstockholm/intehrgrator/issues/277), part 2): copy & paste prompts now start with a fixed guide (response format, references, slot tree format, block examples, rules) that is the same for every project, so chat providers can cache it; the project part follows under `# Project`. AI chat sends that guide in the system message. A new **Models** section names the template with each archetype id and version (or the XSD namespace and root element, or the JSON Schema `$id`), for target and source, copied from the files. The raw target file is no longer attached to copy & paste prompts: tick **Attach original target** in the AI menu (or the chat's copy menu) to include it; the choice is saved with the project. SDV copy prompt (embed files): about 81,000 → 7,400 tokens. Format and workflow links now point at the release's own docs (`…/intehrgrator/v0.10/docs/…`). MCP `initialize` returns `instructions` with the workflow in short.
- **Compact slot tree for the AI; new `get_slot` tool** ([#277](https://github.com/regionstockholm/intehrgrator/issues/277), part 1): the AI chat, the copy & paste prompt and MCP / Agent API `list_slots` now describe the target as a slot tree, one group per repeating container or archetype node, with short slot ids (`group` + row `id`), fixed units/codes and allowed values once per slot. The old slot manifest and the separate repeatable-container list are gone; the SDV `api` prompt drops from about 6,200 to 3,700 tokens and MHV1 from 13,700 to 9,700. Every id form still works in `map_slot`, `import_suggestions`, `lease_slot` and `release_slot` (full skeleton id, compact id, unique tail). **MCP output change:** `list_slots` returns `{revision, groups}`; pass `view: "rows"` (HTTP `?view=rows`) for the earlier flat rows. `get_slot {id}` (HTTP `GET /slot?id=`) returns one slot in full, with documentation, every value set entry and the constraint from the target file. Measure with `deno task measure:context`.
- **XSD as Source Schema; XML sources over MCP** ([#278](https://github.com/regionstockholm/intehrgrator/issues/278)): an `.xsd` loaded as Source Schema is now read as a schema — element and `@attribute` paths, types, multiplicity and `xs:documentation` — instead of as an XML document whose tree showed `/xs:schema/xs:element/…`. In the headless app (MCP stdio, scripts) XML and XSD sources failed with `DOMParser is not defined` while the tool reported success; they now load, and a file that cannot be read is a tool error. `get_source_tree` also returns each node's `description`.
- **Warning before you edit inside an agent's lease** (S-15, ADR 0014): a change to something an MCP agent leases is held, and a dialog names the agent with a live countdown to the end of the lease. **Edit anyway** saves it and stops asking about that lease; **Cancel** takes it back; when the lease ends the dialog closes and the change is saved. You still win: the agent's next write to a slot you changed in its lease is refused once (409 `humanWins`, MCP `isError`), and the status line says so. Asked once per change you make (end of a drag, field edit or click), never per keystroke.
- **Tutorial: parallel IDE agents** ([docs/tutorial/parallel-agents.md](docs/tutorial/parallel-agents.md)): two or three IDE agents on one canvas, leases on slots and subtrees, what a refused write looks like, and the lease markers. `scripts/parallel_agents_demo.ts` plays three agents against a running app.
- **AI chat: live token use, context ring and an optional token budget** ([#276](https://github.com/regionstockholm/intehrgrator/issues/276)): a meter next to **Stop** shows the tokens the chat has used, updated after every step from the provider's reported usage (input, cached input, output, cost when given; `~` marks an estimate when the provider reports none). A ring shows how full the model's context window is (known for common models; set it for others in the meter's popover). An optional token budget per chat warns at 80 % and pauses at 100 %; **Raise budget … and continue** lets the model go on. The step limit went from 16 to 100 and is now only a guard against a model that loops, so ordinary mapping no longer stops for "continue". Old turns are dropped relative to the model's context window (half of it, at least 64k tokens) instead of always at 64k. Streaming requests ask for `stream_options.include_usage`; a provider that rejects it is asked again without.
- **Who leases what, on the canvas**: a block an MCP agent leases gets a dashed frame in the agent's colour and a 🔒 tag with its name (a thicker frame and **subtree** for a subtree lease). The Mapping Editors header shows a chip per agent with its number of leases; click it to jump to the next leased block. History shows the agent's name next to its IDE (**MCP Bo · cursor**), so two chats from one IDE can be told apart. Calling `register_agent` after an agent's first change renames that agent instead of creating a second one.
- **Leases for parallel MCP agents** (S-15): `lease_slot` takes `subtree: true` to lease a node path and every slot below it, such as `…//context/EVENT_CONTEXT`. A lease now holds for *every* change by another MCP agent, not only `map_slot` and `import_suggestions`: `undo`, `revert`, `load_bundle`, `put_blockly` and Optional RM that would touch a leased slot fail with the holder, and the project is left unchanged. Earlier, one agent's Undo could take back another agent's change in a leased slot. `release_slot {all: true}` releases all your leases. Agents get distinct colours in registration order. Two stdio MCP processes from the same IDE are now separate agents (`cursor`, `cursor 2`) even without `register_agent`; before, they shared one identity, so their leases did not keep them apart. The person in the UI is still never blocked.
- **Fix: IDE MCP clients can connect**: the stdio MCP server (`deno task mcp`, `intEHRgrator --mcp`) only read LSP-style `Content-Length` frames, but MCP clients (Cursor, Claude Desktop, VS Code, the MCP SDK) send one JSON message per line, so they never got an `initialize` reply. Both framings are read now, and each reply uses the caller's. A failing tool (for example a slot leased by another agent) is now a tool result with `isError` and the reason, so the agent can react. `intEHRgrator --mcp` no longer opens an empty window for each MCP server an IDE starts, and it exits when the IDE closes the connection.

## [0.10.0] - 2026-10-23

Minor release: one shared, append-only change history for you, the AI chat and MCP agents, with authors, Undo / Revert and a history panel (ADR 0014). MCP `undo` no longer takes `scope`, and the new `revert` tool takes back one entry.

- **Fix: the desktop app starts again**: since 0.9 (ehrtslib from jsDelivr, [#230](https://github.com/regionstockholm/intehrgrator/pull/230)) the compiled desktop read `deno.json` from disk at start, but the binary has no `deno.json`, so it stopped with `NotFound … deno.json` before opening a window (seen with the v0.9.2 Linux AppImage). The ehrtslib prefix is now imported into the binary ([#269](https://github.com/regionstockholm/intehrgrator/pull/269)).
- **Fix: a change to one slot no longer rewrites the default context map's category** ([#266](https://github.com/regionstockholm/intehrgrator/issues/266)): after an AI chat turn, and in the Blockly JSON after any MCP / Agent API mapping, `category` was rebuilt from its own expression and became just `"event"`, dropping code 433. On the desktop the canvas then showed the simplified value. Only slots whose expression actually changed are now rebuilt on the canvas and in the Blockly JSON.
- **History panel and AI author marker** (ADR 0014): the clock button next to Undo / Redo opens the history, newest first, with who made each change (You, AI chat with model, MCP with client) and per row **Undo to here** (take back every later change) and **Revert** (take back only that change as a new change; slots changed later are kept and listed in the status line). Blocks the AI chat or an MCP agent wrote show a small **AI** badge until you change that slot. In the web app your own edits are now in the same history as the AI chat's.
- **Undo names the author; Revert takes back one change** (ADR 0014): Undo (Ctrl+Z) takes back the newest change whoever made it, and the status line says whose (you, AI chat with model, or the MCP agent). The history is only appended to: Undo, Redo and the new MCP / Agent API `revert` tool are recorded as new entries. `revert {seq}` takes back one entry and skips (and lists) slots changed after it. The **Revert last AI turn** button is gone: one Undo takes back a whole AI turn. MCP `undo` no longer takes `scope: user|agent`.
- **AI chat and MCP use the same tools** (ADR 0014): the chat's mapping tools now run the MCP tool code on the open project, so their answers, checks and history are the same as for an IDE agent. `map_slot` over MCP now rejects an unknown `slotId` and reports the slot label, and `import_suggestions` also accepts the envelope inline, as the chat already did.
- **Desktop: no more lost edits when an IDE agent works at the same time; history says who changed what** (ADR 0014): every UI change (also Click-to-Map, drag-and-drop, AI chat and Import Suggestions) is saved to the shared history before an MCP change is pulled in. Previously such a change could be overwritten by the next MCP change, and Undo could then remove the MCP change as well. A pulled MCP change is one Undo step. History entries record the origin: you, AI chat (with model; one entry and one Undo step per turn, pasted AI answers included) or MCP (with the client name).
- **AI in the web app tutorial updated** for the streaming AI chat: Send with credentials, ✓ mapping lines, Stop / Esc, and copy & paste via Import AI answer…; new screenshots, retaken with `deno run -A scripts/tutorial_ai_screenshots.ts` (mocked provider, no key). Provider help texts say AI chat instead of Call AI.
- **AI chat streams and can be stopped** (issues [#252](https://github.com/regionstockholm/intehrgrator/issues/252), [#251](https://github.com/regionstockholm/intehrgrator/issues/251)): with AI credentials, Send streams the answer and model reasoning, always uses the mapping tools, shows a short ✓ line for each mapping applied, and turns into **Stop** while it runs (also Esc). The "Apply directly / Approve first" select and the "How AI chat maps" credential option are removed (old settings are dropped on load); the Import Suggestions modal is only for pasted answers. A provider that rejects tools gets one suggestions-JSON turn applied directly (revertible). Architecture decision for the next step: chat and MCP will share one write path with one attributed undo step per AI turn ([ADR 0014](docs/adr/0014-one-write-path-attributed-undo.md)).
- **Much smaller AI chat requests** ([#252](https://github.com/regionstockholm/intehrgrator/issues/252)): Send attaches a compact context (slot manifest, source path outline, example list; no raw OPT, schema or example bodies) and the new `list_examples` / `get_example` tools fetch examples on demand. The first obx request drops from about 166k to 24k tokens (bp 36k → 8k). Older large tool results are stubbed in the history, the history is trimmed by a token estimate with a note, and the refresh-merge prompt omits raw files over 12,000 characters instead of cutting them silently. Measure with `deno run -A scripts/measure_ai_tokens.ts`.

- **Release Pages: versions sort by number**: `versions.json` listed tags as text, so `v0.10` sorted below `v0.9.2` and would not have counted as the newest release. Tags now sort numerically.

## [0.9.2] - 2026-10-20

- **AI chat replaces "Call AI"** ([#248](https://github.com/regionstockholm/intehrgrator/pull/248), issue [#234](https://github.com/regionstockholm/intehrgrator/issues/234)): chat panel, context chips, stored prompts, tools-mode turns with approve-first and copy-prompt fallbacks.
- **AI chat polish** ([#250](https://github.com/regionstockholm/intehrgrator/pull/250), issue [#249](https://github.com/regionstockholm/intehrgrator/issues/249)): one-row header with Prompts menu and per-mode help, per-provider credential memory with model fetch and "forget key", Notes / Questions in answers with per-suggestion confidence and review markers, question options as choice buttons.
- **Optional RM scaffold** ([#247](https://github.com/regionstockholm/intehrgrator/pull/247)): optional RM mouths are scaffolded without guessing a child.
- **Better Form Renderer**: you are asked to upload it into the browser; no console errors at startup ([#244](https://github.com/regionstockholm/intehrgrator/pull/244)).
- **UI fixes** ([#254](https://github.com/regionstockholm/intehrgrator/pull/254), issue [#246](https://github.com/regionstockholm/intehrgrator/issues/246)): "Validate as" picker removed; an ELEMENT and its single value share one Mapping Spec row, badged ELEMENT (not SLOT); selection highlight fix; tabbed Spec follows canvas clicks; neutral blue test-file tabs (red only on error); Auto-run on by default for all test files with a Pause; Search / Copy / Download as faded overlays inside every CodeMirror editor.
- **Find in pane** ([#255](https://github.com/regionstockholm/intehrgrator/pull/255), issue [#218](https://github.com/regionstockholm/intehrgrator/issues/218)): Search in the Source Schema, Example Instances and Target Schema trees and on the Mapping canvas (overlay button or Ctrl/Cmd+F) with match case / regexp / by word and next / previous.
- **Validation default canonical-strict** ([#256](https://github.com/regionstockholm/intehrgrator/pull/256)): ehrtslib bumped to v0.5.1 ([ErikSundvall/ehrtslib#132](https://github.com/ErikSundvall/ehrtslib/pull/132)), superseding the lenient pinning from [#254](https://github.com/regionstockholm/intehrgrator/pull/254). Non-canonical openEHR JSON output now reports deserialize errors.
- Lung-MDT sibling example reworked with decision tables and any-of gates; one divider design; test isolation for Blockly messages ([#236](https://github.com/regionstockholm/intehrgrator/pull/236)).

## [0.9.1] - 2026-10-16

- Decision-table column controls in the sheet header and improved decision table / sheet UIs ([#238](https://github.com/regionstockholm/intehrgrator/pull/238), [#241](https://github.com/regionstockholm/intehrgrator/pull/241)).
- README "Try it" points at the recommended web build via `/recommended/` ([#237](https://github.com/regionstockholm/intehrgrator/pull/237)).

## [0.9.0] - 2026-10-09

- Search, Copy and Download toolbar on the Mapping Spec, script and Test Run editors ([#215](https://github.com/regionstockholm/intehrgrator/pull/215)).
- ehrtslib imported from jsDelivr (v0.4) instead of a vendored clone ([#230](https://github.com/regionstockholm/intehrgrator/pull/230)).
- Embedded Better templates scaffold with their own terminology ([#231](https://github.com/regionstockholm/intehrgrator/pull/231)); example-set targets use repo-local OPT files ([#229](https://github.com/regionstockholm/intehrgrator/pull/229)).
- AI menu and user tutorial split ([#233](https://github.com/regionstockholm/intehrgrator/pull/233)); release workflow documented ([#226](https://github.com/regionstockholm/intehrgrator/pull/226)).

## [0.8.8] - 2026-09-29

- Side panel toggles and non-destructive UI language change ([#184](https://github.com/regionstockholm/intehrgrator/pull/184)).
- Mapped example output is validated without scaffold false alarms ([#185](https://github.com/regionstockholm/intehrgrator/pull/185)).
- "Web Shell" renamed "web app"; tighter chrome and ELEMENT block labels ([#192](https://github.com/regionstockholm/intehrgrator/pull/192), [#196](https://github.com/regionstockholm/intehrgrator/pull/196)); double tooltip fix ([#204](https://github.com/regionstockholm/intehrgrator/pull/204)).
- Tutorial and persistence docs ([#200](https://github.com/regionstockholm/intehrgrator/pull/200), [#213](https://github.com/regionstockholm/intehrgrator/pull/213)).

## [0.8.7] - 2026-09-23

- Web app chrome follows the toolbar UI language; frozen Pages catalogs and assets are kept ([#181](https://github.com/regionstockholm/intehrgrator/pull/181)).

## [0.8.6] - 2026-09-23

- Default context map with joint target load and refresh; **Call AI** with mapping tools ([#163](https://github.com/regionstockholm/intehrgrator/pull/163), [#164](https://github.com/regionstockholm/intehrgrator/pull/164)).
- Conversion tests and rewrites, overlay / collapsed labels, decision tables ([#165](https://github.com/regionstockholm/intehrgrator/pull/165)); mutator cog placement and Function conversion ([#173](https://github.com/regionstockholm/intehrgrator/pull/173)).
- Example and conversion leftovers: Karda FLAT, lung notes, Agent API ([#175](https://github.com/regionstockholm/intehrgrator/pull/175), [#178](https://github.com/regionstockholm/intehrgrator/pull/178), [#179](https://github.com/regionstockholm/intehrgrator/pull/179)).

## [0.8.5] - 2026-09-20

- Tabbed, slide-away Target & Previews pane with a Target schema tree ([#161](https://github.com/regionstockholm/intehrgrator/pull/161)); default context map design ([#160](https://github.com/regionstockholm/intehrgrator/pull/160)).
- Scaffold Default points use RM path keys ([#157](https://github.com/regionstockholm/intehrgrator/pull/157)).

## [0.8.4] - 2026-09-19

- `join_list` authoring ([#152](https://github.com/regionstockholm/intehrgrator/pull/152)) and ZipEHR-style collapsed block labels ([#153](https://github.com/regionstockholm/intehrgrator/pull/153)).
- Optional scaffold marking and Blockly UI fixes ([#154](https://github.com/regionstockholm/intehrgrator/pull/154), [#155](https://github.com/regionstockholm/intehrgrator/pull/155), [#156](https://github.com/regionstockholm/intehrgrator/pull/156)).

## [0.8.3] - 2026-09-18

- Handlebars canvas codegen and click-to-map ([#119](https://github.com/regionstockholm/intehrgrator/pull/119)); headless Agent API / MCP and desktop `--headless` ([#120](https://github.com/regionstockholm/intehrgrator/pull/120)).
- Loops unified onto `for_each_list` ([#132](https://github.com/regionstockholm/intehrgrator/pull/132)); grammatical list join ([#139](https://github.com/regionstockholm/intehrgrator/pull/139)); JSON Schema `$ref` / `$defs` inlined in the Source Schema tree ([#141](https://github.com/regionstockholm/intehrgrator/pull/141)).
- Save / load Blockly Functions and a GitHub Function library ([#144](https://github.com/regionstockholm/intehrgrator/pull/144)); bulk actions for optional scaffold cleanup ([#148](https://github.com/regionstockholm/intehrgrator/pull/148)).
- Catalog example sets with TypeScript-validated mappings ([#145](https://github.com/regionstockholm/intehrgrator/pull/145), [#146](https://github.com/regionstockholm/intehrgrator/pull/146)); openEHR scaffolding and locator fixes ([#125](https://github.com/regionstockholm/intehrgrator/pull/125), [#129](https://github.com/regionstockholm/intehrgrator/pull/129)); UI tests gate PRs ([#143](https://github.com/regionstockholm/intehrgrator/pull/143)).

## [0.8.2] - 2026-09-16

- Product stack, Instance encoding dropdown and Conversion start chain ([#107](https://github.com/regionstockholm/intehrgrator/pull/107), [#109](https://github.com/regionstockholm/intehrgrator/pull/109)).
- XQuery COMPOSITION emit with in-app Test Run ([#103](https://github.com/regionstockholm/intehrgrator/pull/103)); Handlebars Template tab retired ([#114](https://github.com/regionstockholm/intehrgrator/pull/114)).
- Statement / XML mouth snapping fixes ([#108](https://github.com/regionstockholm/intehrgrator/pull/108), [#111](https://github.com/regionstockholm/intehrgrator/pull/111)); visible drawers ([#116](https://github.com/regionstockholm/intehrgrator/pull/116)).

## [0.8.0] - 2026-09-15

- **Java export**: Archie-based conversion script generation ([#96](https://github.com/regionstockholm/intehrgrator/pull/96)).
- Decision tables: range predicates, catch-all rows, UNIQUE lint, COLLECT ([#95](https://github.com/regionstockholm/intehrgrator/pull/95)).
- Blockly chrome and INTERVAL_EVENT scaffolding fixes ([#94](https://github.com/regionstockholm/intehrgrator/pull/94)).

## [0.7.6] - 2026-09-14

- Recommended version popup ([#89](https://github.com/regionstockholm/intehrgrator/pull/89)); decision table and Sheets polish ([#81](https://github.com/regionstockholm/intehrgrator/pull/81)).
- XML mouth, drag-and-drop and narrow-pane layout fixes ([#88](https://github.com/regionstockholm/intehrgrator/pull/88), [#93](https://github.com/regionstockholm/intehrgrator/pull/93)); examples moved to `test/fixtures` ([#87](https://github.com/regionstockholm/intehrgrator/pull/87)).

## [0.7.5] - 2026-09-11

- Full Blockly codegen for Go template scripts ([#79](https://github.com/regionstockholm/intehrgrator/pull/79)); XQuery `for_each_source` iteration ([#74](https://github.com/regionstockholm/intehrgrator/pull/74)).

## [0.7.2] - 2026-09-10

- Decision tables with locals and VMS snippet lint ([#72](https://github.com/regionstockholm/intehrgrator/pull/72)).

## [0.7.1] - 2026-09-10

- VMS workspace hatch linter ([#71](https://github.com/regionstockholm/intehrgrator/pull/71)); verifiable Handlebars / Go dialects only (ADR 0009, [#68](https://github.com/regionstockholm/intehrgrator/pull/68)).

## [0.7.0] - 2026-09-10

- Mapping Model IR beyond flat slots ([#58](https://github.com/regionstockholm/intehrgrator/pull/58)); Mapping preview, TypeScript and XQuery unified on VMS ([#60](https://github.com/regionstockholm/intehrgrator/pull/60)).
- Mapping Spec chrome, glyphs, rename and Conversion start ([#63](https://github.com/regionstockholm/intehrgrator/pull/63)); object-valued defaults and searchable TERM_PICK ([#50](https://github.com/regionstockholm/intehrgrator/pull/50)).
- Project Bundle back-compat shims removed ([#61](https://github.com/regionstockholm/intehrgrator/pull/61)).

## [validation-prep-alpha.1] - 2026-09-09

- Pre-release: verification-hostile blocks hidden from the default toolbox.

## [0.6.5] - 2026-09-09

- Constraint Overlay on RM blocks, phase 1 ([#47](https://github.com/regionstockholm/intehrgrator/pull/47), [#48](https://github.com/regionstockholm/intehrgrator/pull/48)).
- Subject defaults, PWA install, hardcode button ([#44](https://github.com/regionstockholm/intehrgrator/pull/44)).

## [0.6.1] - 2026-09-08

- Main Pages deploys no longer wipe frozen version trees.

## [0.6.0] - 2026-09-08

- **Versioned GitHub Pages** per release ([#32](https://github.com/regionstockholm/intehrgrator/pull/32)).
- Compact editable Mapping Spec projection ([#28](https://github.com/regionstockholm/intehrgrator/pull/28)); Extract to function ([#31](https://github.com/regionstockholm/intehrgrator/pull/31)); Description Logic list blocks ([#36](https://github.com/regionstockholm/intehrgrator/pull/36), [#43](https://github.com/regionstockholm/intehrgrator/pull/43)).

## [0.5.0] - 2026-09-04

- **Sheets** widget with `sheet_*` accessors and convert-time `ctx.sheets` ([#24](https://github.com/regionstockholm/intehrgrator/pull/24)); Lists & maps toolbox ([#25](https://github.com/regionstockholm/intehrgrator/pull/25)).
- Go text nested in XML blocks with text/template WASM ([#22](https://github.com/regionstockholm/intehrgrator/pull/22)); openEHR scaffolding for units and coded text ([#20](https://github.com/regionstockholm/intehrgrator/pull/20)).

## [0.4.0] - 2026-08-31

- Multi-agent presence, attributed history and observer timeline ([#18](https://github.com/regionstockholm/intehrgrator/pull/18)).
- Schema-driven toolboxes for JSON / XSD targets ([#19](https://github.com/regionstockholm/intehrgrator/pull/19)).

## [0.3.0] - 2026-08-31

- **Agent API and MCP server** for AI-enabled IDEs ([#17](https://github.com/regionstockholm/intehrgrator/pull/17)).
- Cogwheel mutators replace the optional RM picker ([#10](https://github.com/regionstockholm/intehrgrator/pull/10), [#13](https://github.com/regionstockholm/intehrgrator/pull/13)); undo, search and Spec ticks ([#11](https://github.com/regionstockholm/intehrgrator/pull/11)); RM completeness ([#14](https://github.com/regionstockholm/intehrgrator/pull/14)).

## [0.2.1] - 2026-08-25

- Windows desktop window stays visible; smaller release binaries.

## [0.2.0] - 2026-08-25

- Ships as a Deno desktop workbench instead of an ehrtslib CLI.

## [0.1.0] - 2026-08-25

- First web app and core modules ([#2](https://github.com/regionstockholm/intehrgrator/pull/2)): Click-to-Map ([#4](https://github.com/regionstockholm/intehrgrator/pull/4)), source format handlers ([#5](https://github.com/regionstockholm/intehrgrator/pull/5)), Mapping Spec download / upload ([#7](https://github.com/regionstockholm/intehrgrator/pull/7)), readable TypeScript codegen ([#9](https://github.com/regionstockholm/intehrgrator/pull/9)).

[Unreleased]: https://github.com/regionstockholm/intehrgrator/compare/v0.9.2...main
[0.9.2]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.9.2
[0.9.1]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.9.1
[0.9.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.9
[0.8.8]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.8
[0.8.7]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.7
[0.8.6]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.6
[0.8.5]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.5
[0.8.4]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.4
[0.8.3]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.3
[0.8.2]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8.2
[0.8.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.8
[0.7.6]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.7.6
[0.7.5]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.7.5
[0.7.2]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.7.2
[0.7.1]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.7.1
[0.7.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.7
[validation-prep-alpha.1]: https://github.com/regionstockholm/intehrgrator/releases/tag/validation-prep-alpha.1
[0.6.5]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.6.5
[0.6.1]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.6.1
[0.6.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.6
[0.5.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.5
[0.4.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.4
[0.3.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.3
[0.2.1]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.2.1
[0.2.0]: https://github.com/regionstockholm/intehrgrator/tree/v0.2.0
[0.1.0]: https://github.com/regionstockholm/intehrgrator/tree/v0.1.0
