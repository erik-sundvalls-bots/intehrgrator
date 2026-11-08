Paste as the body of [#140](https://github.com/regionstockholm/intehrgrator/issues/140) (this agent cannot edit existing issues).

---

The tabbed right pane + target schema tree + pull-to-canvas work is split to [#159](https://github.com/regionstockholm/intehrgrator/issues/159) (blocks #158).

## Remaining on this issue

- Non-destructive refresh of target schema from file/GitHub that preserves canvas mappings, warns on problematic diffs, and a way to prompt an AI (MCP or copy-paste) to help merge
- Same idea for Source Schema refresh
- Detached (not deleted) Blockly on breaking changes stays the safety net
- Side-effect 2: optional in-app AI credentials; dropdown **Copy prompt** vs **Call AI** (default Call AI when credentials exist). IDE/MCP remains valid.

## Precursor (do not re-implement here)

#159: right pane tabs (Target schema / Generated conversion script(s) / Conversion Test Run(s)), slide-away, pull leaf/subtree onto canvas.

## Docs

[default-context-map.md](default-context-map.md)
