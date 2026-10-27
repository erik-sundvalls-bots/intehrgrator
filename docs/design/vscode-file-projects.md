# VS Code file projects

The repository is the persistent project. `intehrgrator.json` binds a source
example directory, optional Source Schema, target definition, mapping document
and generated output paths. Paths are portable and relative to the manifest.

The mapping is a versioned JSON document containing the canonical Blockly
workspace and Sheets. Derived Mapping Models, session ids, timestamps and undo
history are reconstructed. A CustomTextEditorProvider presents the existing
workbench and updates that TextDocument through WorkspaceEdit. Document versions
and a load generation reject stale webview edits. Saving waits for pending canvas
edits; VS Code provides dirty state, persistence and document undo/redo.

A shared loader and generator serve both the extension host and the Deno runner.
Saving regenerates conversion code and one output per Example Instance. Source,
schema and target changes are watched. External mapping document changes reload
the editor. A changed manifest mapping path requires reopening the file project.

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
in CI.
