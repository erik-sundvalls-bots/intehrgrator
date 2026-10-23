# Tests and export

Run the mapping against an example, then download the conversion script your integration pipeline will execute.

Back to the [tutorial index](../TUTORIAL.md). Assumes an example tab and some mapped slots from [Basic mapping](basic-mapping.md).

## Run a test

1. Open at least one example tab.
2. In **Target & Previews**, open **Conversion Test Run(s)** and leave **Output mode** on **Mapping preview**.
3. Click **Run Test**, or turn on **Autoplay** so edits re-run the test after a short pause.

**Conversion Test Run(s)** shows the produced instance. For openEHR targets, ✅ or ⚠ is template validation. A ⚠ on a named-invalid example (filename contains `invalid` or `broken`) is expected. A mapped Dummy vitals example should show the clinical magnitudes you mapped (`120`, `80`, `mm[Hg]` on `instance-1`).

Switching example tabs shows that tab’s last result. **Run Test** refreshes the active tab.

## Export a conversion script

Change **Output mode** from Mapping preview to a conversion-script language:

- TypeScript (also executed by Test Run)
- Java (generated; not executed in the app)
- Handlebars, XQuery, and Go Template (generated and executed in Conversion Test Run)

**Generated conversion script(s)** shows the code. The editor toolbar can search, copy, and download it.

Generated scripts accept a **defaults** map and a **sheets** bag at convert time — the same structures you authored on the canvas. See [Default context](default-context.md) and [Sheets and decision tables](sheets-and-decision-tables.md).

**Export Project** (File menu) is a different file: a `.intehrgrator` bundle of the whole project, not the conversion script. That is covered in [Basic mapping](basic-mapping.md).
