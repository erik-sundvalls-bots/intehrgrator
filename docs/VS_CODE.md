# VS Code file projects

intEHRgrator is available as a web app, a desktop app, a headless runner and a VS Code
extension (see [README.md](../README.md)). All of them use the same Mapping Editor.
The web and desktop apps keep projects as Project Bundles (browser storage, `.intehrgrator`
export); that does not change. In VS Code, a project is instead a **file project**: a set of
files in your repository, so source examples, the mapping and generated output can be
reviewed together in Git. A `project:run` command checks the same files in CI.

The VSIX is built locally for now (see [Building and testing the extension](#building-and-testing-the-extension)).
Install the intEHRgrator VSIX using **Extensions: Install from VSIX…**, then run
**intEHRgrator: Create File Project** to create a synthetic starter project, or
**intEHRgrator: Open File Project** to open an existing `intehrgrator.json`.
You can also right-click that file in Explorer.

In VS Code, the workbench always works on a file project.
**intEHRgrator: Open Integration Workbench** resumes the most recently opened
file project in the workspace. It reloads schema, examples and mapping from workspace files
when the view is reopened. If there is no previous project, it finds project
files in the workspace or offers Create / Open. Project URIs are remembered
locally; authored project content lives in the repository. Unsaved documents are
restored by VS Code, and chat history and credentials remain local to each project.

Earlier development builds of the extension opened a standalone workbench that kept
projects in VS Code's extension storage. That view is replaced by file projects, and
projects saved there are no longer listed. To keep one, export it as `.intehrgrator`
with the earlier build before upgrading, then open it in the web or desktop app, or
create a file project with the same target, Source Schema and examples.

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
the mapping and manifest metadata and regenerates the conversion code and a result for every
JSON/XML Example Instance in the source folder, including subfolders. Saved
changes to examples, the Source Schema or the target also refresh the project.
Opening a project never rewrites the committed output; only saving and `project:run` do.
VS Code's document model handles unsaved changes, undo/redo and external mapping
edits, including file-language choices. In a file project there is one undo
history, VS Code's: the toolbar Undo/Redo run VS Code's undo/redo, the History panel
lists changes without **Undo to here**/**Revert**, and there is no autosave (VS Code
keeps unsaved changes, including after a restart). The web and desktop apps keep
their own undo, History actions and autosave. Open input documents are read from their
buffers; review artifacts are regenerated when the project inputs are saved.
Use **File → Edit file project configuration** to change file paths.

## Project configuration

Paths use `/`, are relative to the directory containing `intehrgrator.json`, and
stay within that directory. Keep generated output separate from source files.
The mapping, `output.directory` and the script path cannot be in a dot-folder such as
`.git` or `.vscode`, and generated files are never written through a symlink that
leads outside the project folder.
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

Target and Source Schema entries also accept `{ "path": "…", "languageSettings": { … } }`.
`languageSettings.languages` stores the language order; `labelLanguage` stores the
pane's chosen language. Without a Source Schema, the source languages and pane
language are stored as `source.languageSettings` (`{ "languages": […], "labelLanguage": "…" }`)
next to `source.examples`. The target also supports `idLanguage` (`"primary"` or a
language code), which determines Web Template ids and Simplified FLAT paths.
Changing the Ids dropdown updates its mapping field and manifest metadata together.
Conflicting explicit choices are reported rather than silently changing output paths.

For an existing multi-file target, list the complete closure, including the root:

```json
{
  "path": "targets/root.t.json",
  "files": ["targets/root.t.json", "targets/details.t.json"],
  "languageSettings": { "languages": ["en", "sv"], "idLanguage": "sv" }
}
```

Use this object as `target`. All listed files are local project paths and are
watched for changes. Derived skeletons and Web Templates are rebuilt on load.

## Reviewing results in Git

Commit the project configuration, inputs, mapping, generated code and example
results. Result files show the **current mapping**, including incomplete work:
removing an identifier mapping removes that identifier from the example result.
Missing mandatory mappings and conversion diagnostics are recorded in
`output/status.json`, labelled `execution: "mapping-preview"`. These results
evaluate the mapping; they do not execute the generated script in an external
engine. `output.script.language` persistently selects the generated script's
language, independently of the workbench's session-only Output mode.
Conversion failures replace the corresponding result with
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

Pending canvas and language edits survive source/target refreshes. If an external edit
conflicts with them, the local mapping and language settings open in a separate unsaved JSON editor
so you can resolve the conflict without losing either version.
