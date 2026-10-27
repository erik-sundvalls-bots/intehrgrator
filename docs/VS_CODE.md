# VS Code file projects

Keep source examples, the mapping and generated output together in a Git repository.
Install the intEHRgrator VSIX using **Extensions: Install from VSIX…**, then run
**intEHRgrator: Create File Project** to create a synthetic starter project, or
**intEHRgrator: Open File Project** to open an existing `intehrgrator.json`.
You can also right-click that file in Explorer.

**intEHRgrator: Open Integration Workbench** resumes the most recently opened
file project in the workspace. It reloads schema, examples and mapping from disk
when the view is reopened. If there is no previous project, it finds project
files in the workspace or offers Create / Open. Only project URIs are remembered
in VS Code storage; project contents remain in the repository.

```text
intehrgrator.json
mapping/main.mapping.json
schemas/person.schema.json
targets/person.schema.json
source/person-01.json
output/conversion.ts
output/examples/person-01.json
output/status.json
```

The mapping opens in the visual Mapping Editor. **Ctrl+S** (Cmd+S on macOS) saves
its JSON document and regenerates the conversion code and a result for every
JSON/XML Example Instance in the source folder, including subfolders. Saved
changes to examples, the Source Schema or the target also refresh the project.
VS Code's document model handles unsaved changes, undo/redo and external mapping
edits. Use **File → Edit file project configuration** to change file paths.

## Project configuration

Paths use `/`, are relative to the directory containing `intehrgrator.json`, and
stay within that directory. Keep generated output separate from source files.
For a ready-to-run example, see [examples/file-project](../examples/file-project/).

```json
{
  "version": 1,
  "mapping": "mapping/main.mapping.json",
  "target": "targets/person.schema.json",
  "source": {
    "schema": "schemas/person.schema.json",
    "examples": "source"
  },
  "output": {
    "directory": "output",
    "script": { "language": "typescript", "path": "output/conversion.ts" }
  }
}
```

`source.schema` is optional. The target can be an OPT, JSON Schema, XML Schema or
free-form target supported by the workbench. The mapping document contains
`version: 1`, native `blocklyState` and `sheets`; a native Blockly JSON export is
also accepted when opening an existing mapping. Keep defaults and lookup tables
with the mapping. An optional `previewDefaults` object supplies fixed runtime
defaults for result generation.

## Reviewing results in Git

Commit the project configuration, inputs, mapping, generated code and example
results. Result files show the **current mapping**, including incomplete work:
removing an identifier mapping removes that identifier from the example result.
Missing mandatory mappings and conversion diagnostics are recorded in
`output/status.json`. Conversion failures replace the corresponding result with
an error; unreadable project inputs mark the run as failed and remove previously
indexed results. Removed examples remove their previously generated results.

JSON uses stable formatting and key order; array order and clinical values are
preserved. Use fixed example data and runtime defaults to keep diffs useful.
If you maintain separate expected results for regression tests, update those
only after review; the generated `output` directory is the current result.

## Running without VS Code

With the repo's development prerequisites installed (`deno task vendor`):

```sh
deno task project:run examples/file-project/intehrgrator.json
deno task project:run examples/file-project/intehrgrator.json --check
```

`--check` does not write files and exits unsuccessfully when the committed code,
results or status differ from a fresh run. Use it in CI for your mapping repo.
The VSIX runs the bundled mapping engine; users do not need Deno installed.

## Building and testing the extension

`deno task extension:package` builds `intehrgrator.vsix` locally using Microsoft's
VSIX packager. The normal UI suite covers opening a file project, a visual edit,
File-menu Save and text-field undo. To test the real extension host, set
`VSCODE_EXECUTABLE` to a VS Code executable (`Code.exe` on Windows) and run
`deno task test:vscode`. The test uses synthetic files and an isolated profile.

Pending canvas edits survive source/target refreshes. If an external mapping edit
conflicts with them, the local version opens in a separate unsaved JSON editor
so you can resolve the conflict without losing either version.
