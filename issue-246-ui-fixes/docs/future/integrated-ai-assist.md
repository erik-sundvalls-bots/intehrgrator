# In-app and copy-paste AI assist

**Status:** Web app has optional **Call AI** (OpenAI-compatible chat completions, credentials in localStorage). Copy-paste and IDE/MCP remain first-class. Call AI can drive the same mapping tools as MCP / the HTTP Agent API. Richer native assist (VS Code Language Model API) is still deferred.

## Three mapping-assist paths

| Path | Where it runs | How the model writes mappings |
|------|----------------|-------------------------------|
| **IDE + MCP** | Cursor / Claude Desktop / similar, stdio MCP (`deno task mcp`) usually proxying the desktop Agent API | The IDE agent calls `map_slot` / `import_suggestions` / `run_test` itself |
| **Call AI (in-app)** | web app or desktop toolbar, after **AI credentials…** | intEHRgrator POSTs the mapping prompt to your provider and **executes the same tool names on the live workbench** (or one-shot suggestions JSON) |
| **Remote Agent API** | OpenCode `serve` / cloud runner, Hugging Face jobs, or any HTTP agent that can reach the desktop | Same HTTP Agent API as MCP (`/api/v1/*`). Bind + token when not loopback |

All three apply through the same Mapping Model / Blockly path. Copy prompt + **Import Suggestions** remains the fallback when no key or MCP is available.

## Web app

The toolbar **AI** menu is three sections. The third is desktop-only.

**copy/paste for external AI chat**

- **Embed files**, **Attach files**, and **Browse URIs** — each copies a markdown prompt (target/source origins, delivery mode, slot manifest, link to `AI_SUGGESTION_FORMAT.md`) and remembers the packing mode.
- **Import AI suggestions** — parses `intehrgrator-suggestions` JSON version 2 (same path as Call AI suggestions mode)

**Your own AI**

- **Call AI** — POST that prompt. Default mapping mode uses OpenAI function tools named like MCP (`list_slots`, `map_slot`, `import_suggestions`, `run_test`, …) against the open project. **Suggestions JSON only** is the one-shot import used before tools existed.
- **Configure AI credentials…** — provider preset (Gemini, OpenAI, Anthropic, Ollama local/cloud, LM Studio local/cloud, Hugging Face, OpenCode Zen / cloud runner), endpoint, API key, model, mapping mode. Never stored in the Project Bundle. GitHub Pages browsers often hit CORS on cloud APIs; the **desktop app** forwards Call AI through `POST /api/v1/ai-chat-completions`. Key walkthrough: [AI_CREDENTIALS.md](../AI_CREDENTIALS.md).

**Desktop**

- **Local MCP server…** — start/stop agent tool routes and show connection parameters (`INTEHR_AGENT_URL`, token, `mcp.json`). The IDE command is `intEHRgrator --mcp`. See [AGENT_WORKFLOW.md](../AGENT_WORKFLOW.md).
- Target/source **refresh** reports offer Copy merge prompt / Call AI; detached Blockly stays

## When to integrate more natively

| Host | Mechanism |
|------|-----------|
| VS Code extension | `vscode.lm` Language Model API; suggest for selected slot or full unmapped manifest |
| Web / desktop | User-configured endpoint + key; tools or suggestion format internally |

## Migration path

Integrated AI should emit the same `intehrgrator-suggestions` JSON internally when it is not using `map_slot` — one import/application code path for copy-paste and native modes.

## Related

- [AI_CREDENTIALS.md](../AI_CREDENTIALS.md)
- [AI_SUGGESTION_FORMAT.md](../AI_SUGGESTION_FORMAT.md)
- [AGENT_WORKFLOW.md](../AGENT_WORKFLOW.md)
- [UI_ARCHITECTURE.md](../UI_ARCHITECTURE.md)
