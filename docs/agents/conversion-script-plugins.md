# Conversion script language plugins

Read this when adding a conversion script language, loading one with `--language-plugin`, or changing helper imports in generated scripts.

Human walkthrough: [docs/CONVERSION_SCRIPT_PLUGINS.md](../CONVERSION_SCRIPT_PLUGINS.md). Sample: `examples/language-plugins/echo/`.

## Seam

`ConversionScriptLanguagePlugin` in `src/core/codegen/language_plugin.ts`:

- `id`, `label`, `extension`, `mime`, `runnable`
- `generate(model, options) => string | Promise<string>`

Built-in languages stay on `ExportTargetAdapter` in `src/core/codegen/mod.ts` (`generate(model, target)`). They are not worker plugins.

Desktop-only languages:

1. `configureLanguagePlugins(urls)` from `--language-plugin` / `INTEHR_LANGUAGE_PLUGINS` (`src/desktop/cli.ts`, `src/desktop/main.ts`).
2. First `generate` calls `src/desktop/language_plugins.ts`, which `import()`s the module inside `src/desktop/language_plugin_worker.ts`.
3. `setExternalLanguageGenerator` lets `WorkbenchService.generateScript` and `generate_script` reach that worker.
4. The browser learns ids from `GET /api/v1/language-plugins` and posts the live Mapping Model to `POST /api/v1/language-plugins/generate`.

`language_plugin_worker.ts` is only reached through `new URL(..., import.meta.url)`, so `deno desktop` does not bundle it on its own. The `desktop` task and `scripts/compile-desktop.ts` pass `--include src/desktop/language_plugin_worker.ts`; keep that when you move or rename the worker. Plain paths from `--language-plugin` / `INTEHR_LANGUAGE_PLUGINS` become `file:` URLs relative to the working directory (`normalizeManifestUrl`).

`deno.json` sets `"unstable": ["worker-options"]` so the worker permission set type-checks and runs. The same file maps the helper raw GitHub URLs onto `src/core/codegen/helpers/` so `deno test` and `deno run` in this repo execute generated scripts without waiting for `main` to publish the files.

## Manifest and module

Manifest fields: `id`, `label`, `extension`, `module`, optional `mime`, `runnable`, `netHosts`. `id` matches `/^[a-z][a-z0-9-]{0,40}$/` and is not `preview`. The module's `plugin.id` must equal the manifest `id`.

Export `plugin` (or `default`) with `generate`. Do not import `src/workbench`, `src/desktop`, or Blockly. Options passed through: `blocklyState`, `skeleton`, `instanceShape`, `webTemplateJson`, `handlebarsTemplate`.

## Sandbox

Remote manifest (`http`/`https`): worker `net` is the module host, the manifest host, and `netHosts`. No `read`. The module URL must be `http` or `https`.

`file:` manifest: module must be `file:` under the manifest directory. Worker `read` is that directory only. `net` only if `netHosts` is non-empty.

No `env`, `run`, `write`, or `ffi` in either case. A plugin that needs a file outside its directory cannot have one; fold the data into the module or the Mapping Model.

`GET /api/v1/language-plugins` reads manifests only. The module import happens on the first `generate` for that id. Generate times out after 15s.

## Tests

`deno test -A --no-check test/language_plugin_test.ts` loads the echo sample and a plugin that reads `/etc/passwd`. The second must reject with `NotCapable`.

## Helper imports (built-in languages)

Generated scripts import static helpers and keep one-line wrappers only where the helper closes over `sourceCtx` or `sheets`.

| Piece | Path |
| --- | --- |
| Specifiers and GitHub blob URLs | `src/core/codegen/helpers/locations.ts` |
| TypeScript bodies | `src/core/codegen/helpers/typescript.ts` |
| Java | `src/core/codegen/helpers/java/IntehrgratorRuntime.java`, `HandlebarsSupport.java` |
| XQuery modules | `src/core/codegen/helpers/xquery/*.xqm` (text also built by `xquery_modules.ts` / `xquery_sheets.ts`; `test/codegen_helpers_test.ts` checks they match) |
| In-app XQuery | `inlineXQueryHelperModules` in `src/core/codegen/run_xquery.ts` copies the module into the main query as `local:{prefix}-*` because fontoxpath has no library-module loader |
| In-app TypeScript | `generatedScriptRuntime()` spreads the helper module after `stripGeneratedTypeScript` removes the `import` |
| Editor links | `importLinkSpans` in `src/core/codegen/import_links.ts`, applied from `src/workbench/codemirror_setup.ts` |

Add a helper by exporting it from the static module, emitting a call only when a block needs it, and covering it from `test/codegen_helpers_test.ts`. Do not paste the body back into `wrapTypeScriptModule` / `wrapJavaModule` / `wrapXQueryModule`.
