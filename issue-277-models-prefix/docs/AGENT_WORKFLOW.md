# Agent workflow (IDE + desktop)

Golden path: **IDE + intEHRgrator desktop side-by-side**. An AI agent calls the **localhost Agent API** while you watch the Blockly canvas update. **Node-by-node `map_slot` is first-class** — it is OK, and it is the transparent default when a human is watching: each slot write pulses the canvas and lands as its own attributed history entry. Batch `import_suggestions` is for Copy AI Prompt, loops, Decision tables, and other envelope blocks `map_slot` cannot express. Open **Open observer** (formerly Open canvas) for the live agent legend and **attributed history timeline** (scrub, go back to an entry, patch-undo prompts).

**Headless:** the same API/MCP tools complete **load → inspect → map → Test Run → export** with no UI (`--headless`, or `deno task mcp` without `INTEHR_AGENT_URL`).

Fallback when MCP/API is unavailable: read **mapping spec** (Blockly JSON) or **generated conversion script** from export — downstream only, not round-trip authoring. Copy-paste: **Copy prompt** → external chat → **Import Suggestions**. Web app **AI chat** is the in-app variant: saved credentials + the same mapping tool names as this API, executed on the open workbench (desktop forwards the provider HTTP call so browser CORS does not block it).

## AI chat vs IDE MCP vs remote Agent API

| Variant | Who holds the model | Who calls intEHRgrator tools |
|---------|---------------------|------------------------------|
| IDE + stdio MCP | The IDE (Cursor, Claude Desktop, …) | The IDE agent, via `deno task mcp` |
| **AI chat** (collapsible panel under Target & Previews) | Your configured provider (Gemini, OpenAI, Anthropic, Ollama, LM Studio, Hugging Face, OpenCode Zen, …) | intEHRgrator, looping OpenAI-compatible `tools` named like MCP |
| Remote HTTP agent | OpenCode `serve` / cloud runner, HF jobs, etc. | That runner, against a reachable Agent API (`--bind` + `--token` when not loopback) |

AI chat credentials and provider key links live in **AI credentials…** ([AI_CREDENTIALS.md](AI_CREDENTIALS.md)). They are never in the Project Bundle. `POST /api/v1/ai-chat-completions` is a desktop-only CORS forwarder (not an MCP tool).

## Desktop Agent API

Enabled by default on the desktop app (`deno task desktop` / compiled binary). Disable with `INTEHR_AGENT_API=0`.

```text
intEHRgrator --headless [--port <n>] [--bind <addr>] [--load <file.intehrgrator>] [--token <secret>]
```

- Default bind `127.0.0.1` (loopback may stay unauthenticated).
- `--headless`: do not open a browser; on `deno desktop` / the compiled app, hide the native window and keep `Deno.serve` alive.
- `--bind 0.0.0.0` (or any non-loopback) **requires** `--token` or `INTEHR_AGENT_TOKEN`. When a token is set, every Agent API route except `GET /health` needs `Authorization: Bearer …` or `x-intehr-token`.
- `--load` hydrates the shared `WorkbenchService` from a Project Bundle zip (`.intehrgrator`) or JSON file at start.
- Loading a target via Agent API / MCP **scaffolds** the Template Skeleton onto a headless Blockly workspace (Conversion start, Defaults, default-point lookups) so `set_instance_encoding`, loops, and Optional RM match the GUI.
- `DENO_SERVE_ADDRESS` (Deno desktop webview) still owns listen address; `--port` / `--bind` apply to `deno run`.

Base URL: `http://127.0.0.1:<port>/api/v1/`

HTTP paths and MCP tool names are **1:1** for agent operations (shared `callAgentTool`).

| Method | Path | MCP tool | Purpose |
|--------|------|----------|---------|
| GET | `/health` | — | Liveness (unauthenticated) |
| POST | `/ai-chat-completions` | — | Desktop AI chat forwarder (provider URL + key in JSON body; not MCP) |
| GET | `/snapshot` | `get_snapshot` | Revision, mapped counts, unmapped mandatory slot ids, sheets, product stack, leases, Constraint warning count, test status |
| GET | `/slots` | `list_slots` | Target value slots as a compact **slot tree** (#277): `{revision, groups:[{group, label, type, mult, loop?, within?, slots:[{id, type, label?, mult, mandatory?, fixed?, units?, values?, terminology?, expr?}]}]}`. A slot id is `group` + row `id`; every id form (full skeleton id, compact, unique tail) is accepted by the write tools. `?view=rows` returns the legacy flat rows (id, mapped, valueType, pathLabel, multiplicity, attachSlotId, parentRmType, unitsFixed / allowedUnits, codeFixed / allowedValues, expression) plus `repeatable` containers; query `?unmappedOnly=true&query=…` filters both views |
| GET | `/slot?id=…` | `get_slot` | One Target slot in full: documentation, all value set entries, fixed values, the constraint from the target file (JSON Schema subschema, XSD element/attribute, openEHR template node fields), current mapping and lease |
| GET | `/examples` | `list_examples` | Example instances (id, filename, format, chars, active) without bodies |
| GET | `/example` | `get_example` | One example body capped at `maxChars` (default 8,000, max 40,000), or `?path=` for a subtree of the Active Example with values |
| GET | `/source-tree` | `get_source_tree` | Compact Source Schema + Active Example trees |
| GET | `/sheets` | `get_sheets` | Sheet / Decision table summaries + documents |
| GET | `/product-stack` | `get_product_stack` | Conversion start chain (Instance roots, encodings, loops) |
| GET | `/optional-rm` | `list_optional_rm` | Optional RM catalog (`?parentSlotId=`) |
| GET | `/constraint-warnings` | `list_constraint_warnings` | Unmapped mandatory, Decision table lint, abstract EVENT / ITEM_STRUCTURE |
| GET | `/leases` | `list_leases` | Advisory slot leases (S-15) |
| GET | `/bundle` | `get_bundle` | Full `ProjectBundle` + revision |
| GET | `/history` | `get_history` | Attributed semantic timeline |
| GET | `/history/:seq/preview` | — | Read-only bundle at history seq (UI) |
| GET | `/activity` | `get_activity` | Latest agent highlight + registered agents |
| POST | `/register-agent` | `register_agent` | `{ agentId?, displayName?, color? }` |
| PUT | `/bundle` | `load_bundle` | Load bundle JSON, `{ path }`, or `{ bytesBase64 }` zip |
| POST | `/load-target` | `load_target` | Target OPT / schema (`content` / `path` / `url`) |
| POST | `/load-source-schema` | `load_source_schema` | Source Schema |
| POST | `/add-example` | `add_example` | Example Instance |
| POST | `/load-example-set` | `load_example_set` | Catalogued Example Set (`catalogPath` or `catalogUrl` + `setId`; `includeMapping` default true) |
| GET | `/function-library` | `list_function_library` | Curated Blockly Function catalog (`catalogPath` / `catalogUrl`; default in-repo `function-library/`) |
| POST | `/load-function` | `load_function` | Merge a Function (`functionId` / `path` / `bundle`) onto the canvas; `clash` `rename` (default) or `replace` |
| POST | `/set-active-example` | `set_active_example` | `{ id }` |
| PUT | `/sheets` | `replace_sheets` | Replace Sheet / Decision table documents (revision includes sheets) |
| POST | `/ui-commit` | — | UI semantic commit `{ bundle, summary, kind?, baseRevision?, origin? }`; `origin` is `{ origin: "ai-chat", provider?, model?, turnId? }` for an AI chat turn (commits with one `turnId` fold into one entry). Returns `{ revision, overwritten }`: agent entries after `baseRevision` that this commit replaced |
| POST | `/import-suggestions` | `import_suggestions` | Apply `intehrgrator-suggestions` JSON (body = text) |
| POST | `/build-prompt` | `build_prompt` | Copy AI Prompt markdown |
| POST | `/patch-prompt` | `build_patch_prompt` | `{ targetSeq }` → patch-undo prompt |
| POST | `/map-slot` | `map_slot` | `{ slotId, path, format?, note?, confidence? }` (`confidence`: integer 0–100) |
| PUT | `/blockly` | `put_blockly` | Replace workspace JSON (escape hatch) |
| POST | `/optional-rm/add` | `optional_rm_add` | `{ parentSlotId, rmType, attributeName }` |
| POST | `/optional-rm/remove` | `optional_rm_remove` | `{ parentSlotId, attributeName }` |
| POST | `/set-instance-encoding` | `set_instance_encoding` | `{ encoding, rootIndex? }` |
| POST | `/lease-slot` | `lease_slot` | `{ slotId, subtree?, ttlSec? }`: a slot, or with `subtree: true` a node path and every slot below it; 409 with `holder` when it overlaps another agent's lease |
| POST | `/release-slot` | `release_slot` | `{ slotId, subtree? }` or `{ all: true }`; returns `released` |
| POST | `/run-test` | `run_test` | Conversion Test Run (full `TestResult`) |
| POST | `/generate-script` | `generate_script` | `{ language, path? }` Conversion Script |
| POST | `/export-bundle` | `export_bundle` | `{ format: json\|zip, path? }` |
| POST | `/undo` | `undo` | `{ toSeq? }` take back the newest change (or all after `toSeq`), whoever made it; appends an `undo` entry and returns `author` |
| POST | `/revert` | `revert` | `{ seq }` take back one entry as a new change; slots changed later are skipped and listed (`skipped`) |
| POST | `/redo` | `redo` | Redo service history |
| POST | `/restore-at` | `restore_at` | `{ seq, mode?: view \| destructive }` (destructive = Undo to here, appended) |
| POST | `/export-discarded` | — | `{ entries: [{ afterBundle }] }` → `.intehrgrator` zip |

Mutating requests accept **`If-Match: <revision>`** from the last snapshot. On conflict the API returns **409** with current revision. Foreign slot leases also return **409** (`holder`). `replace_sheets` / PUT `/sheets` changes `revision` (the hash includes Sheets). Use the new snapshot revision on the next write.

### Example Set load

`load_example_set` **`includeMapping` defaults to true**: a mapped catalog set **adopts** its Blockly canvas, Sheets, and loops. `get_snapshot.appliedSlots` is the mapped slot count and is greater than 0 after that adopt. **`includeMapping: false`** loads the target, schema, and examples and **scaffolds** an empty Mapping Model from the Template Skeleton (no saved expressions).

`list_slots` groups name their archetype / parent node in `label` and `within`; `loop: true` marks a repeating container whose `group` is the `attachSlotId` for `loops[]`. Call `get_slot` for one slot's full detail instead of loading the target file. In `view: "rows"`, `parentRmType` is the nearest COMPOSITION, SECTION, or ENTRY ancestor (`ACTION` vs `EVALUATION` when sibling content shares `at0000`). Pair it with `pathLabel` and `attachSlotId`; do not parse raw Blockly to tell those slots apart.

Output modes that execute for catalogued families:

| Family | Modes |
|--------|--------|
| openEHR FLAT (Karda mapped sets) | TypeScript emits Simplified FLAT. XQuery executes the same instances (canonical JSON maps). |
| Lung-MDT TakeCare XML | Mapping preview and Handlebars both evaluate the XML canvas (TermId + Note). |
| Chemo symptoms TakeCare XML | TypeScript and Go template. |

Go template Test Run uses the live Blockly walker (the same script as Generated Export). Cloud or laptop agents without a desktop MCP server should call the HTTP Agent API (`intEHRgrator --headless`, or `callAgentTool`). stdio MCP with `INTEHR_AGENT_URL` is for watching a GUI session. `deno task mcp` with no `INTEHR_AGENT_URL` embeds a headless workbench. AI chat runs these tool names in-process and does not need stdio MCP.

The stdio MCP `initialize` result carries `instructions`: this workflow in short and version-pinned links to this file and the suggestion format (`https://regionstockholm.github.io/intehrgrator/v<version>/docs/…`; same version ⇒ same content).

Pass agent identity on mutations: headers **`X-Agent-Id`**, **`X-Agent-Name`**, optional **`X-Agent-Color`** (after `register-agent`), and **`X-Agent-Client`** (the MCP client name; stdio MCP sends `clientInfo.name` from `initialize`). History entries carry `actor.origin` (`human`, `ai-chat`, `mcp`).

The UI polls `/api/v1/snapshot` and reloads the bundle when revision changes (live canvas sync). Pure block **x/y** drags do not append history; structural / expression changes do.

### Multi-agent presence

1. MCP **`register_agent`** at session start — desktop returns **name + colour**.
2. Mutations carry agent headers for **attributed history**.
3. **`lease_slot`** on the slots, or with `subtree: true` the node path (a slot id prefix such as `…//context/EVENT_CONTEXT`), you are about to map; **`release_slot`** (`all: true`) when done. While a lease is held, another MCP agent's change that would touch a covered slot fails with 409 and the `holder` (MCP: a tool result with `isError`), and the project and history are left as they were. This covers every write, also `undo`, `revert`, `load_bundle` and Optional RM. `import_suggestions` skips the covered slots and lists them. The in-app AI chat is never blocked. The person in the desktop UI sees the lease on the canvas and, before a change to a covered slot is saved, gets a warning with a countdown to the lease's end: **Edit anyway** saves it (asked once per lease), **Cancel** takes it back, and when the lease ends the change is saved. After **Edit anyway** the lease holder's next write to that slot fails once with 409 and `humanWins: true` (MCP: `isError`, "the person wins"; `import_suggestions` skips the slot and says why), so the agent reads the slot again before changing it. A stdio MCP process that did not call `register_agent` is registered on its first write as its client name (`cursor`, `cursor 2`, …), so two chats in one IDE do not share leases.
4. **Open observer** popup: agent legend + **history timeline**.
5. Main canvas: subtle **pulse** on touched slots; optional **Follow agent** checkbox pans to agent edits (default off).

### Patch undo (best-effort)

`POST /patch-prompt` or MCP **`build_patch_prompt`** returns a prompt that asks the LLM for strict **`intehrgrator-suggestions` version 2** JSON — not free text. Apply the response via **`import_suggestions`**. The result is a new history entry (undoable).

### History retention

- **Desktop:** set `INTEHR_HISTORY_PATH` to append metadata lines to disk alongside the project.
- **Web:** history is in-memory; purge-old UX deferred — avoid unbounded sessions on long-lived tabs.

## MCP (stdio)

```bash
deno task mcp
```

Set **`INTEHR_AGENT_URL=http://127.0.0.1:<port>`** to proxy tools to a running desktop session (recommended for GUI). Set **`INTEHR_AGENT_TOKEN`** when the desktop requires a token. Without `INTEHR_AGENT_URL`, MCP embeds a headless `WorkbenchService` (filesystem host: load from path/url, write export `path`s).

### Desktop panel

In the downloaded app, **AI → Desktop → Local MCP server…** shows the Agent API URL, the token when one was set, and a copyable `mcp.json`. **Stop** makes agent tool routes return 503 (`Local MCP server is stopped`). **Start** allows them again. `GET /health`, `POST /ui-commit`, and `POST /ai-chat-completions` stay up, so AI chat and local edits are not tied to the switch. The bridge keeps polling through a 503 and resumes when you Start.

The snippet’s command is the release binary with `--mcp` (stdio MCP proxied at `INTEHR_AGENT_URL`). A Deno dev server gets `deno run -A src/agent/mcp_stdio.ts` instead. `--mcp` does not open a second workbench window.

Cursor example (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "intehrgrator": {
      "command": "deno",
      "args": ["run", "-A", "src/agent/mcp_stdio.ts"],
      "env": { "INTEHR_AGENT_URL": "http://127.0.0.1:8765" }
    }
  }
}
```

Headless (no desktop): omit `INTEHR_AGENT_URL` and use `load_target` / `add_example` / `export_bundle`.

## Response format for LLMs

Always use [AI_SUGGESTION_FORMAT.md](./AI_SUGGESTION_FORMAT.md) version 2 (`intehrgrator-suggestions` fence) when applying an envelope. Prefer **`map_slot` or `import_suggestions`** / MCP over hand-editing Blockly JSON. Node-by-node `map_slot` is the transparent GUI default; `import_suggestions` is for bulk / Copy AI Prompt / Decision tables. Prefer **Decision tables** when they make combinational mappings easier for humans to read. Patch undo responses must use the same envelope.

## Related

- [AI_SUGGESTION_FORMAT.md](./AI_SUGGESTION_FORMAT.md)
- [UI_TESTING.md](./UI_TESTING.md) — browser Test API (`?testMode=1`) for Playwright only
- [docs/design/DESIGN-multi-agent-undo-crdt.md](design/DESIGN-multi-agent-undo-crdt.md)
- Mapping skill: `.cursor/skills/intehrgrator-mapping/SKILL.md`
