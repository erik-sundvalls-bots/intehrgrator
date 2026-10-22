# Built-in MCP and Agent API: how it works

intEHRgrator exposes one set of mapping tools (`list_slots`, `get_source_tree`, `map_slot`, `import_suggestions`, `run_test`, …) through three doors. All three end up in the same code, so a tool behaves the same whichever door an agent uses.

| Door | Who runs the model | Transport | Entry point |
|------|--------------------|-----------|-------------|
| IDE / desktop MCP client (Cursor, Claude Desktop, …) | the IDE | MCP over **stdio** | `src/agent/mcp_stdio.ts` (`deno task mcp`, or the release binary with `--mcp`) |
| Remote or local HTTP agent | that agent | JSON over **HTTP** `/api/v1/*` | `src/agent/http.ts` (served by the desktop app) |
| **AI chat** in the web app | the user's own provider | OpenAI-compatible `tools` in the browser | `src/core/ai/mapping_agent.ts` (tools run by `src/core/ai/controller_tools.ts` for now; ADR 0014 moves them onto `callAgentTool`) |

Usage (commands, flags, `mcp.json`) is in [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md). This page is about where the code is and how the parts fit.

## Code map

| File | Role |
|------|------|
| `src/agent/tools.ts` | **The tool table.** `AGENT_TOOLS` (MCP names, descriptions, JSON Schemas), `callAgentTool(service, name, args)` dispatch, and `AGENT_TOOL_HTTP`: the 1:1 map from tool name to HTTP method + path after `/api/v1`. Add a tool here first. |
| `src/agent/mcp_stdio.ts` | JSON-RPC over stdin/stdout. `createMcpAgentClient()` picks `HttpAgentClient` when `INTEHR_AGENT_URL` is set (proxy to a running desktop, optional `INTEHR_AGENT_TOKEN`), otherwise `LocalAgentClient` with an embedded headless `WorkbenchService` and a filesystem host. |
| `src/agent/http.ts` | `Deno.serve` handler for `/api/v1/*`. Routes tool calls through `AGENT_TOOL_HTTP` / `callAgentTool` on the shared `WorkbenchService`, (e.g. `get_snapshot` → `GET /snapshot`, `get_bundle` → `GET /bundle`), plus non-tool routes: `/health`, `/history…`, `/ui-commit`, `/local-mcp`, and `/ai-chat-completions` (the desktop CORS forwarder for AI chat). |
| `src/agent/local_mcp.ts` | The desktop **Local MCP server** switch. `localMcpStaysUp()` lists the routes that keep answering when the switch is off (`GET /health`, `POST /ui-commit`, `POST /ai-chat-completions`, `/local-mcp`); every other agent route returns 503. Also builds the `mcp.json` snippet (`mcpClientCommand`). |
| `src/agent/auth.ts` | Shared-secret check (`Authorization: Bearer` or `x-intehr-token`) when a token is set or the bind is not loopback. |
| `src/agent/registry.ts`, `actor.ts` | `register_agent`: agent ids, display names, colours for presence. |
| `src/agent/leases.ts` | Advisory slot leases for parallel writers. |
| `src/agent/revision.ts` | Revision / `If-Match` helpers for optimistic concurrency. |
| `src/agent/inspect.ts` | Compact, DOM-free inspect payloads returned by tools. |
| `src/workbench/service.ts` | `WorkbenchService`: the headless workbench the Agent API and stdio MCP drive (history, undo, revisions). |
| `src/web/agent_bridge.ts`, `agent_observer.ts` | Browser side of the desktop: polls `/api/v1/snapshot`, reloads the bundle when the revision changes, pushes UI edits via `/ui-commit`, and shows agent activity / history. |
| `src/desktop/main.ts` | Desktop entry: serves the web app and the Agent API, handles `--headless`, `--bind`, `--token`, `--load`, `--mcp`; `INTEHR_AGENT_API=0` turns the API off. |
| `src/core/ai/controller_tools.ts` | The same tool names for the browser: `mappingAgentOpenAiTools()` (OpenAI `tools` schema), `executeMappingAgentTool(controller, name, args)` on the live `WorkbenchController`, `isMutatingCallAiTool()`. Interim: removed by ADR 0014 in favour of `callAgentTool`. |
| `src/core/ai/mapping_agent.ts` | AI chat tool loop: `runMappingAgent` (multi-turn via `history`; streams with `onEvent`, stops on `signal`, stubs older snapshot tool results with `compactToolHistory`), `runSuggestionsChatTurn` (fallback when a provider rejects tools, no tools). `list_examples` / `get_example` and the `list_slots` filters share their helpers in `src/agent/inspect.ts` with the MCP tools. |

## stdio vs HTTP

```text
IDE ──stdio JSON-RPC──▶ mcp_stdio.ts ──┬─ INTEHR_AGENT_URL set ──HTTP /api/v1/*──▶ http.ts ─▶ WorkbenchService (desktop, shared with the UI)
                                       └─ not set ─────────────▶ embedded WorkbenchService (headless, files on disk)
HTTP agent ────────────────────────────────────HTTP /api/v1/*──▶ http.ts ─▶ WorkbenchService
Desktop UI ◀──agent_bridge.ts polls /snapshot, posts /ui-commit──▶ http.ts
```

- **Proxy mode** is what a GUI user wants: the IDE agent edits the same project the desktop window shows, and the bridge reloads the canvas on each revision.
- **Embedded mode** needs no GUI: load with `load_target` / `add_example` and write results with `export_bundle`.

## Desktop toggle

**AI → Desktop → Local MCP server…** (`installLocalMcpDialog` in `web/main.ts`) reads and posts `/api/v1/local-mcp`. Stopping it flips `LocalMcpControl.enabled`; tool routes then answer `503 Local MCP server is stopped`. The page, UI commits and the AI chat forwarder stay up (`localMcpStaysUp`), and the bridge keeps polling and resumes on Start.

## Shared tool names with AI chat

**Target ([ADR 0014](adr/0014-one-write-path-attributed-undo.md)):** the chat calls `callAgentTool` on a `WorkbenchService` through an `AgentClient` (in-browser service on the web, the desktop backend over HTTP), so chat and MCP share one write path and one attributed history. The steps below describe the interim state until that lands.

Today AI chat does not go through MCP or HTTP. It calls `executeMappingAgentTool` directly on the browser's `WorkbenchController`, but it uses the **same tool names and argument shapes** as `src/agent/tools.ts`, so prompts, skills and docs written for MCP work in the chat. When you add or change a tool:

1. Change `AGENT_TOOLS` / `callAgentTool` / `AGENT_TOOL_HTTP` in `src/agent/tools.ts`.
2. If the browser chat should have it, add it to `CALL_AI_TOOL_NAMES`, `CALL_AI_OPENAI_TOOLS` and `executeMappingAgentTool` in `src/core/ai/controller_tools.ts` (and to `isMutatingCallAiTool` when it changes the mapping, so **Revert last AI turn** is offered).
3. Cover it with an Agent/MCP test in `test/` (see [TESTING.md](TESTING.md)). `test/ai_streaming_252_test.ts` checks that every chat tool exists in `AGENT_TOOLS` with the same parameter names; put shared read logic in `src/agent/inspect.ts` rather than in either caller.

On the desktop the chat posts its completions through `POST /api/v1/ai-chat-completions` (found with `GET /api/v1/health`) to avoid browser CORS. That forwarder is not an MCP tool.
