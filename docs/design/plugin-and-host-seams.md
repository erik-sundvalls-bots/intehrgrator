# Seams touched by language plugins and multiple hosts

**Status:** architecture review (2026-11-03). Proposes candidates; nothing is decided yet. It covers main at `f420a70`, plus the open PRs [#332](https://github.com/regionstockholm/intehrgrator/pull/332) and [#335](https://github.com/regionstockholm/intehrgrator/pull/335) (language plugins) and [#305](https://github.com/regionstockholm/intehrgrator/pull/305) (VS Code file projects).

**Visual report:** [architecture-review-plugin-and-host-seams.html](../reviews/architecture-review-plugin-and-host-seams.html)

**Design issue:** [#336](https://github.com/regionstockholm/intehrgrator/issues/336) proposes that every Conversion script language, built-ins included, is a lazy-loaded plugin served from a same-origin `plugins/` folder.

Vocabulary: module, interface, depth, seam, adapter, leverage and locality are used as in the `codebase-design` skill. Domain terms come from [CONTEXT.md](../../CONTEXT.md). Two names are new here, **Conversion input** and **Conversion script language registry**. They go into CONTEXT.md once a candidate is accepted.

## Main findings

1. **Three registries decide which languages exist, and callers branch on all of them.**
   - The `adapters` map in `src/core/codegen/mod.ts`.
   - Blockly adapters that replace the built-in TypeScript and Go Template adapters, but only after `initBlocklyGenerators()` has run. The output therefore depends on call order.
   - #332's desktop plugin map plus a global `setExternalLanguageGenerator` singleton.

   As a result, `WorkbenchController` branches on `isConversionScriptLanguage` in 4 places on main, and in 7 on the #335 branch once `isDesktopPluginLanguage` is added. `WorkbenchService`, `runTest` and the agent tools branch again.
2. **The options for a Conversion Script are built in 6 places on main:** 3 in the controller, plus the service, `runTest` and `xquery.ts`. #332 adds a 7th in the controller, and #305's `generateProjectArtifacts` adds an 8th. Each one repeats `instanceShapeForEncoding(preferredInstanceEncoding(model))` and its own selection of fields. The TypeScript and Go Template generators also need a live Blockly `Workspace`, which can't be passed into a worker.
3. **The plugin loader leaks across host seams in #332.**
   - `src/agent/http.ts` imports `src/desktop/language_plugins.ts`, so the agent depends on the desktop.
   - `HostAdapter.generateConversionScript` is documented as desktop-only, yet it's implemented on `WebHostAdapter`, which Pages also uses.
   - `web/main.ts` calls `/api/v1/language-plugins` directly with the agent token.
4. **The desktop has no Host adapter of its own.** The desktop UI runs `WebHostAdapter` and detects the desktop through `window.__INTEHR_DESKTOP__` and `__INTEHR_AGENT_TOKEN__`: 11 reads across 4 files. Six UI and AI modules call `/api/v1/*` themselves. `createHostAdapter` can only choose between VS Code and web.
5. **Project storage has two shapes behind one interface.** `HostAdapter` has four methods for the Project Bundle store: autosave, manual save, list and load. VS Code file projects in #305 bypass them through `postProjectMessage` and `onProjectMessage` on the concrete adapter, turn autosave off and hand undo to VS Code. Headless loads with `WorkbenchService.loadBundleFile`.
6. **The build has no code splitting.** Every dynamic `import()` in the web app is inlined into `bundle.js` (5.3 MiB minified), including the XQuery runtime that ADR 0003 calls lazy-loaded. Only the Go WASM file (4.8 MB) is a separate asset. Language plugins would be the first real lazy split, although generators and runners only account for about 140 KiB of the bundle.

## Seam map

| Seam | Interface today | Adapters | Notes |
| --- | --- | --- | --- |
| Host Abstraction (`src/host/mod.ts`) | `HostAdapter`, 14 methods: pickers, download, clipboard, bundle store, `resolveAppUrl`, `fetchTextUrl` | Web (IndexedDB), VS Code webview (postMessage RPC), FS (Deno tests and runner) | Real seam with 3 adapters. The desktop uses Web plus globals (finding 4). |
| Conversion script language (`src/core/codegen/mod.ts`) | `ExportTargetAdapter { id, extension, mime, generate }`, synchronous | 5 built-ins, 2 replaced at Blockly init, plus #332's plugins behind a second map | Finding 1. ADR 0001 (3) names this deep module. Today the module is shallow, because callers know which adapter is which. |
| Language plugin sandbox (#332) | `ConversionScriptLanguagePlugin`; manifest; Deno worker with permissions | Deno worker only | Only one adapter, so the seam is hypothetical until the browser loader exists (#336). |
| Conversion Test Run runners | `runTest(model, source, …, outputMode)` and `run_typescript` / `run_xquery` / Go WASM | one per language, called by mode | Mapping preview stays in the core as the VMS oracle (ADR 0003). |
| Workbench service and controller | `WorkbenchService` (1.1k lines) wraps `WorkbenchController` (2.6k lines) | browser (live controller), desktop backend | ADR 0014: one write path. Script generation runs here, not through the agent tools. |
| Agent API and MCP (`src/agent`) | `AGENT_TOOLS` plus `callAgentTool`; HTTP routes in `http.ts` | HTTP, MCP stdio, in-app chat (`AgentClient`) | #332 adds plugin routes outside `AGENT_TOOLS`, so MCP clients only learn plugin ids from a description string. |
| Persistence and file projects | `ProjectBundle` (`src/core/persistence`), `HostAdapter` store methods; #305 `intehrgrator.json` loader and generator | IndexedDB, VS Code globalState, desktop backend; file project (#305) | Finding 5. |

## Candidates

| # | Candidate | Strength |
| --- | --- | --- |
| 1 | **One Conversion script language registry.** Every language, built-ins included, sits behind `list()`, `generate(id, input)` and `run(id, script, input)`. The plugin loader is that module's adapter: a browser `blob:` worker, a Deno worker, or in-process for tests. Callers stop branching. | Strong |
| 2 | **One Conversion input.** A single function turns workbench state or a file project into a serializable input: Mapping Model, canonical Blockly JSON, Template Skeleton, Web Template JSON and Instance encoding. The TypeScript and Go Template walkers read Blockly JSON instead of a live `Workspace`. | Strong |
| 3 | **Hosts supply plugin text, not plugin execution.** `HostAdapter` gets `readPluginIndex()` and `readPluginText(id)`, served from the same-origin `plugins/` folder. The desktop-only `generateConversionScript` and the agent → desktop import go away. | Strong |
| 4 | **A desktop Host adapter.** `createHostAdapter` returns a `DesktopHostAdapter` that owns the agent token, the `/api/v1` calls and the AI proxy, instead of globals scattered through the UI. | Worth exploring |
| 5 | **A project store seam.** One `ProjectStore` interface that owns open, save and who owns undo, with IndexedDB, VS Code globalState, file project and desktop backend as adapters. | Worth exploring |
| 6 | **Languages as an agent tool.** Add `list_languages` to `AGENT_TOOLS`, so MCP, HTTP and the in-app chat share it, following ADR 0014's parity test. | Speculative |

**Top recommendation: candidates 1 and 2 together**, as the first slice of #336. They give Erik's goal of one plugin route for our own generators too a single interface to land on. They collapse 3 registries into one and 8 option-building sites into one function, which passes the deletion test. They also make the VMS golden tests run through the same route that users take. Candidate 3 follows naturally, because the registry needs a host to supply plugin text.

## Questions for Erik

1. Should candidate 2 port the TypeScript and Go Template walkers to Blockly JSON, or should those two plugins bundle headless Blockly and every block definition (about 1 MB each, and tied to the block registry)? I recommend the port.
2. Should the desktop UI generate in a browser worker like web and VS Code do, with the Deno worker used only for headless, MCP and `--check`? Or should it keep #332's round trip to the server? I recommend the browser worker, so all three GUI hosts work the same way.
3. Candidate 5 touches ADR 0014 (one history) and #305's decision that VS Code owns undo in file projects. Is a `ProjectStore` worth doing now, or only once a fourth store shows up?
4. Should Echo be listed in the release `plugins/index.json`, or only in dev builds?
