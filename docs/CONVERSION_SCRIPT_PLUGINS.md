# Conversion script language plugins

Built-in conversion scripts are TypeScript, Java, Handlebars, XQuery, and Go Template. The desktop app can add another language without changing the workbench: a small Deno module that turns a Mapping Model into script text.

The web app on GitHub Pages keeps the five built-in languages. Plugins load only in the desktop (or `deno task desktop`) process.

## Run a plugin

```bash
intEHRgrator --language-plugin https://example.com/echo/manifest.json
intEHRgrator --language-plugin examples/language-plugins/echo/manifest.json
```

The value is an `https:`, `http:` or `file:` URL, or a local path resolved against the working directory. Repeat `--language-plugin` for more than one. Or set a comma-separated list:

```bash
INTEHR_LANGUAGE_PLUGINS=https://example.com/echo/manifest.json
```

`deno task desktop` forwards flags after `--` (the native `deno desktop` process does not keep them as arguments):

```bash
deno task desktop -- --language-plugin examples/language-plugins/echo/manifest.json
```

The environment variable still works:

```bash
INTEHR_LANGUAGE_PLUGINS=examples/language-plugins/echo/manifest.json deno task desktop
```

The module is not imported at startup. The first time you pick that language (or an agent calls `generate_script`), the desktop loads it in a worker.

The Output mode menu gains the plugin's label. **Generated conversion script(s)** shows the text `generate` returned. **Conversion Test Run** stays on Mapping preview for plugin languages.

## What you ship

A manifest and a module. The sample is `examples/language-plugins/echo/`.

`manifest.json`:

```json
{
  "id": "echo",
  "label": "Echo",
  "extension": "txt",
  "mime": "text/plain",
  "module": "./plugin.ts",
  "runnable": false,
  "netHosts": []
}
```

| Field | Meaning |
| --- | --- |
| `id` | Output mode value. Lowercase, starts with a letter, up to 40 characters (`a-z`, `0-9`, `-`). Not `preview`. |
| `label` | Name in the Output mode menu. |
| `extension` | Download suffix. |
| `mime` | Download content type. Optional. Defaults to `text/plain`. |
| `module` | URL or path relative to the manifest. Must export `plugin`. |
| `runnable` | Leave `false`. The workbench does not execute plugin scripts. |
| `netHosts` | Extra hostnames the module may contact, such as `jsr.io`. Optional. |

`plugin.ts`:

```ts
export const plugin = {
  id: "echo",
  label: "Echo",
  extension: "txt",
  mime: "text/plain",
  runnable: false,
  generate(model: { templateId?: string; slots?: unknown[] }): string {
    return `// ${model.templateId ?? ""}\n`;
  },
};
```

`generate` may be `async`. It receives the Mapping Model and an options object (`blocklyState`, `skeleton`, `instanceShape`, `webTemplateJson`, `handlebarsTemplate`). Return the script as a string.

Copy that shape. Do not import the workbench, Blockly, or `src/desktop`. A remote plugin that imports this repository needs those hosts listed in `netHosts`, and it still cannot read the user's disk.

## Sandbox

| Manifest | Worker may | Worker may not |
| --- | --- | --- |
| `https://…` | Network to the module host, the manifest host, and `netHosts` | Read or write files, env, subprocesses |
| `file://…` | Read the manifest's directory (so relative imports work) | Read other directories, env, subprocesses. Network only when `netHosts` is set |

A plugin that calls `Deno.readTextFile` outside that directory fails with `NotCapable`. The Mapping Model is sent into the worker on purpose, so treat a remote plugin like code you chose to run.

## Agents

`generate_script` accepts a plugin `id` when the desktop was started with that manifest. `GET /api/v1/language-plugins` lists them. The contract for authors is [docs/agents/conversion-script-plugins.md](agents/conversion-script-plugins.md).

## Built-in helper modules

Generated TypeScript, Java, and XQuery import shared helpers instead of pasting them into every script. The import is only for helpers that mapping uses. In **Generated conversion script(s)**, those import paths are links to the source on GitHub (the same treatment as `ehrtslib` and `fontoxpath`). Inside this repository, `deno.json` maps those raw GitHub URLs onto the local helper files so tests run before the files exist on `main`.

| Language | Helper |
| --- | --- |
| TypeScript | `src/core/codegen/helpers/typescript.ts` |
| Java | `src/core/codegen/helpers/java/IntehrgratorRuntime.java` (and `HandlebarsSupport.java` when the script calls `handlebars`) |
| XQuery | `src/core/codegen/helpers/xquery/*.xqm` |
| Handlebars | Registered by `src/core/codegen/helpers/handlebars.ts`. A canvas template is left as authored. |
| Go Template | FuncMap in `go/texttemplate/main.go`. The script comments the helpers it calls. |
