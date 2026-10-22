# AI chat and MCP share one write path with attributed undo

Everything the AI changes, also through the in-app chat, must end up in undo history, and a person must be able to tell human changes from AI changes. Until #260 the in-app chat ran its own tool executor (`executeMappingAgentTool` in `src/core/ai/controller_tools.ts`) directly on the browser's `WorkbenchController`, while MCP / the HTTP Agent API write through `WorkbenchService` with attributed history. Two write paths drift, and the chat's changes were neither grouped nor attributed: one undo step per tool call, recorded (when at all) as the user, with **Revert last AI turn** as a separate snapshot restore next to undo. A desktop check (2026-10-21) showed worse: a mapping made through the controller (AI chat tool, drag-and-drop, Import Suggestions) never reached the service history, the next MCP change synced over it and lost it, and canvas Undo then restored a stale canvas that also dropped the MCP change.

**Status:** accepted (design confirmed by Erik 2026-10-22); implemented in stacked PRs after #260
**Date:** 2026-10-21

Decisions:

- **One tool surface, one write path.** The in-app chat calls the same `callAgentTool` on a `WorkbenchService` as MCP, through an `AgentClient`: in the web app a service running in the browser around the live controller; on the desktop too the chat writes in the browser, and its entries reach the backend through the attributed `/ui-commit` (one sync path, no race between a chat write and the canvas). On the desktop the backend history is the source of truth. `controller_tools.ts` as a separate executor goes away; a parity test keeps the chat's OpenAI tool list a subset of `AGENT_TOOLS`.
- **Origin on every history entry.** `HistoryActor` carries `origin`: `human`, `ai-chat` (with provider and model) or `mcp` (with the MCP client name). Older entries read as `human` (user) or `mcp` (agent).
- **One undo step per AI turn or MCP change.** A chat turn is one grouped entry (shared `turnId`) and one canvas undo step; a change synced from MCP is one undo step too, so canvas undo never silently rolls it back.
- **One chronological history, never rewritten.** Human, AI chat and MCP changes share one history per project. Entries are only appended: Undo, Redo and Revert are new entries; an undone entry stays, marked undone.
- **Undo (sv: Ångra)** — Ctrl+Z, the toolbar button and *Undo to here* in the history — always rewinds from the top, regardless of author. The status line names whose change was taken back.
- **Revert (sv: Häv)** on a history row takes back that one entry by a new compensating change appended last. Slots changed again after it are skipped and reported, so later work is never lost. This replaces the **Revert last AI turn** button, which is removed.
- **Concurrent edits of the same slot:** the human wins; the agent's change stays in the history and the status line says so.
- **Visible attribution:** a history panel with author badges (you / AI chat + model / MCP + client), and a persistent AI author marker on blocks the AI wrote that stays until a person edits the block. It is separate from the review / confidence marker (ADR 0013, #250).

**Considered:** keeping the browser executor and copying history recording into it; labelling only the canvas undo events. Rejected: a second write path that drifts from MCP, and labels without a shared record cannot drive per-author undo or show MCP and chat changes in one timeline.

**Progress:** A1 (desktop sync, origin field, one entry and one undo step per AI turn and per synced MCP change), A2 (chat through `AgentClient` / `callAgentTool`, `controller_tools.ts` removed) and A3 (append-only history, Undo from the top naming the author, Revert as a compensating change, Revert last AI turn removed) and B (history panel with author badges, Undo to here and Revert per row, AI author marker; in the web app the browser's service keeps the history of your edits too) are in.

**Consequences:** stacked PRs after #260: A1 (origin field, UI commit fix, one undo step per turn / MCP change), A2 (chat via `AgentClient`, `controller_tools.ts` removed), A3 (append-only Undo / Revert, `revert` MCP tool), B (history panel with per-row Undo to here and Revert, AI author marker). MCP `undo` no longer takes `scope: user|agent`; taking back one author's change is `revert`. See [MCP_ARCHITECTURE.md](../MCP_ARCHITECTURE.md).
