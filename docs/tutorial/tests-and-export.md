# Tests and export

Run the mapping against an example, then download the conversion script your integration pipeline will execute.

Back to the [tutorial index](../TUTORIAL.md). Assumes an example tab and some mapped slots from [Basic mapping](basic-mapping.md).

## Run a test

1. Open at least one example tab.
2. In **Target & Previews**, open **Conversion Test Run(s)**. Leave the script dropdown in the pane header on **Mapping preview**.
3. **Auto-run** is on by default: every example file is re-run shortly after each change. On a slow computer click **⏸ Pause**, then use **Run Test** when you want a result; **▶ Auto-run** turns it back on.

**Conversion Test Run(s)** shows the produced instance. For openEHR targets, ✅ or ⚠ is template validation. A ⚠ on a named-invalid example (filename contains `invalid` or `broken`) is expected. A mapped Dummy vitals example should show the clinical magnitudes you mapped (`120`, `80`, `mm[Hg]` on `instance-1`).

Switching example tabs shows that tab’s last result. **Run Test** refreshes the active tab.

## Export a conversion script

Change the script dropdown in the **Target & Previews** header from **Mapping preview** to a conversion-script language:

- TypeScript (also executed by Test Run)
- Java (generated; not executed in the app)
- Handlebars, XQuery, and Go Template (generated and executed in Conversion Test Run)

**Generated conversion script(s)** shows the code. The editor toolbar can search, copy, and download it.

Generated scripts accept a **defaults** map and a **sheets** bag at convert time — the same structures you authored on the canvas. See [Default context](default-context.md) and [Sheets and decision tables](sheets-and-decision-tables.md).

## Keep the mapping in a repository (VS Code)

In the VS Code extension a mapping is a **file project**. Saving (Ctrl+S / Cmd+S) also writes the generated conversion script, a result for every example file, and a status file next to the mapping, so a reviewer sees in Git what a change does to the output. In CI, `deno task project:run path/to/intehrgrator.json --check` fails when the committed output no longer matches the mapping. Setup and the project layout are in [VS Code file projects](../VS_CODE.md).

## Project bundles

**Export Project** (File menu) is a different file: a `.intehrgrator` bundle of the whole project, not the conversion script. That is covered in [Basic mapping](basic-mapping.md).
