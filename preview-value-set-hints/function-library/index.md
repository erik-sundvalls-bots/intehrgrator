# Function library

Reusable **Blockly Functions** — Mapping Specification fragments, not Conversion script helpers.

| Blockly block | What it is | Saved? |
|---------------|------------|--------|
| `procedures_defreturn` | **Value** Function (returns a value; call from a Target slot) | Yes |
| `procedures_defnoreturn` | **Statement** Function (does something; no return) | Yes |
| `procedures_ifreturn` | If-return *inside* a Function body | With the enclosing Function — not a Function of its own |

Load with MCP / Agent API `list_function_library` then `load_function` (`clash`: `rename` default, or `replace`). Web app: **Functions**. Call a value Function from a Target slot; do not `put_blockly` the whole canvas.

| id | name | locale | params | returns | Decision tables | what |
|----|------|--------|--------|---------|-----------------|------|
| `join_swedish` | `join_swedish_words` | sv | `list_of_words` | String (`joined_words`) | SweJoinWords | `A, B och C` (FIRST snippets `{{word}}`; not `join_list`) |
| `join_oxford` | `join_oxford` | en | `names` | String | JoinOxford | `A, B, and C` Oxford comma (FIRST snippets; not `join_list`) |

Catalog: `function-library/catalog.json`. Files: `*.intehr-function.json` (`hasReturn` true for value Functions). When a contribution issue is accepted, follow [`AGENTS.md`](AGENTS.md).
