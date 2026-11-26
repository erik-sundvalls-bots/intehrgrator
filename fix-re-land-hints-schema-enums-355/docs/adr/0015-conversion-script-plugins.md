# Conversion script languages are a plugin seam

Generated TypeScript, Java, and XQuery used to paste the same helper functions into every script. A new conversion script language required an edit to the closed `ConversionScriptLanguage` union and a new generator beside the five built-ins.

**Status:** accepted
**Date:** 2026-11-02

Decisions:

- **Helpers are modules.** TypeScript imports `src/core/codegen/helpers/typescript.ts`. Java imports `IntehrgratorRuntime` (and `HandlebarsSupport` only when the script calls `handlebars`). XQuery imports `ig`, `igrm`, and `igsh` library modules. The import list is the helpers that mapping actually calls. Handlebars and Go Template already keep their helpers in the runtime; the script names the ones it uses and links to that source.
- **In-app Test Run keeps working.** The TypeScript runner strips imports and binds the same module from the bundle. The XQuery runner inlines the library modules into the main query for fontoxpath. Java still does not execute in the web app.
- **Imports are links.** In the generated-script editor, an import specifier or `https://` URL opens the GitHub source (helpers, ehrtslib, fontoxpath, Archie, and other known packages).
- **Another language is a desktop plugin.** `ConversionScriptLanguagePlugin` is the seam. The desktop lazy-loads a manifest URL in a Deno worker with `net` or `read` only (`--language-plugin`, `INTEHR_LANGUAGE_PLUGINS`). GitHub Pages does not load plugins. Plugin scripts are not executed by Conversion Test Run.

**Considered:** pasting helpers only when a flag is set but still inside the script; loading plugins in the browser with a dynamic `import()`. Rejected: the script stays long, and a browser import cannot sandbox file and network access the way a Deno worker can.

**Consequences:** Compiling a generated Java class needs `IntehrgratorRuntime.java` on the source path (Jackson for XPath). XQuery engines that honour `import module … at` load the `.xqm` files from GitHub; the workbench does that inlining itself. See [CONVERSION_SCRIPT_PLUGINS.md](../CONVERSION_SCRIPT_PLUGINS.md).
