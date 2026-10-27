# Changelog

Notable changes per release, newest first. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions are the desktop / web app versions (tags `vX.Y.Z`, with `X.Y.0` tagged `vX.Y`). Each release's frozen web app is at `https://regionstockholm.github.io/intehrgrator/<tag>/`.

Add an entry under **Unreleased** in every feature or fix PR that changes user-visible behaviour; the release PR renames it to the new version.

## [Unreleased]

- **VS Code: reopening the workbench resumes the file project** instead of opening an empty standalone view. Project URIs are remembered across sessions; schema, examples and mapping are reloaded from disk.

- **VS Code file projects**: open a visual mapping backed by separate source, target and mapping files; saving updates generated code and per-example results in the repository, including incomplete mappings and removed fields. The shared `project:run --check` command verifies committed results in CI.

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
