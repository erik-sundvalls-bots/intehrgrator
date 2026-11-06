# VS Code file projects

File projects are an additional project format for the VS Code host and the
`project:run` runner. The web and desktop apps keep the Project Bundle and the
`.intehrgrator` export. In a file project, the repository is the persistent project. `intehrgrator.json` binds a source
example directory, optional Source Schema, target definition, mapping document
and generated output paths. Paths are portable and relative to the manifest.

The mapping is a versioned JSON document containing the canonical Blockly
workspace and Sheets. Derived Mapping Models, session ids, timestamps and undo
history are reconstructed. A CustomTextEditorProvider presents the existing
workbench and updates that TextDocument through WorkspaceEdit. A text document
(rather than a CustomEditorProvider document) gives the same native dirty state,
undo/redo and hot exit with less code, and the mapping stays readable as JSON.
VS Code owns saving and undo in this host: the webview turns off autosave, sends
toolbar Undo/Redo to VS Code and hides the History panel's undo actions. Other
hosts keep their own autosave and undo. Document versions
and a load generation reject stale webview edits. Mapping changes and per-file
language metadata use one WorkspaceEdit across mapping and manifest TextDocuments.
Saving waits for pending edits and saves both documents; VS Code provides dirty
state, persistence and document undo/redo. Open input buffers are used by the editor;
headless checks and generated review artifacts use saved inputs.

A shared loader and generator serve both the extension host and the Deno runner.
Saving regenerates conversion code and one output per Example Instance; opening
does not. Generated files are written only inside the project folder (checked
on the real path, following symlinks) and never in dot-folders such as `.git`. Source,
schema and target changes are watched. External mapping document changes reload
the editor. The manifest accepts legacy string paths and file entries with
per-file languageSettings. A target may declare a complete local fileset;
its skeleton and Web Template are rebuilt through the shared clinical-model loader.
Every member is watched. Explicit manifest and Blockly id-language choices must agree.
A changed manifest mapping path requires reopening the file project.

Results are committed review artifacts, even while a mapping is incomplete. A
removed identifier must disappear from the generated result in the same change.
Stable JSON formatting sorts object keys but preserves array order and values.
Runtime defaults can be fixed in the manifest. Diagnostics are written separately
and contain no run timestamp. A failed conversion replaces its result; invalid
project inputs invalidate indexed results. Only obsolete results previously
indexed inside the configured examples output folder are removed.

The CLI check mode regenerates in memory and compares all generated artifacts,
including diagnostics, with disk. It never updates expected results. The shipped
synthetic person example demonstrates the identifier/name mapping and is checked
in CI. The configured script language is persistent for generation only; results
are labelled mapping-preview. Project identity comes from the local manifest URI
in the VS Code host and is not written into the authored mapping document.
