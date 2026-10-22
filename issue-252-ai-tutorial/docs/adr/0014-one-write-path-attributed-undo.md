# AI chat and MCP share one write path with attributed undo

Everything the AI changes, also through the in-app chat, must end up in undo history, and a person must be able to tell human changes from AI changes. Until #260 the in-app chat ran its own tool executor (`executeMappingAgentTool` in `src/core/ai/controller_tools.ts`) directly on the browser's `WorkbenchController`, while MCP / the HTTP Agent API write through `WorkbenchService` with attributed history. Two write paths drift, and the chat's changes were neither grouped nor attributed: one undo step per tool call, recorded (when at all) as the user, with **Revert last AI turn** as a separate snapshot restore next to undo. A desktop check (2026-10-21) showed worse: a mapping made through the controller (AI chat tool, drag-and-drop, Import Suggestions) never reached the service history, the next MCP change synced over it and lost it, and canvas Undo then restored a stale canvas that also dropped the MCP change.

**Status:** accepted; #260 is an interim step, the unification follows in stacked PRs
**Date:** 2026-10-21

Decisions:

- **One tool surface, one write path.** The in-app chat calls the same `callAgentTool` on a `WorkbenchService` as MCP, through an `AgentClient`: in the web app a service running in the browser around the live controller; on the desktop the backend service over HTTP (the chat registers as an agent, like an IDE). `controller_tools.ts` as a separate executor goes away; a parity test keeps the chat's OpenAI tool list a subset of `AGENT_TOOLS`.
- **Origin on every history entry.** `HistoryActor` carries `origin`: `human`, `ai-chat` (with provider and model) or `mcp` (with the MCP client name). Older entries read as `human` (user) or `mcp` (agent).
- **One undo step per AI turn or MCP change.** A chat turn is one grouped entry (shared `turnId`) and one canvas undo step; a change synced from MCP is one undo step too, so canvas undo never silently rolls it back. **Revert last AI turn** becomes "undo that turn's entries", keeping later human edits where they do not touch the same slots.
- **Ctrl+Z** undoes the latest semantic change regardless of author (open question for Erik); per-author undo lives in the history panel.
- **Visible attribution:** a history panel with author badges and a persistent AI author marker on blocks, separate from the review / confidence marker (ADR 0013, #250).

**Considered:** keeping the browser executor and copying history recording into it; labelling only the canvas undo events. Rejected: a second write path that drifts from MCP, and labels without a shared record cannot drive per-author undo or show MCP and chat changes in one timeline.

**Consequences:** stacked PRs after #260: (A) origin field, browser-safe `WorkbenchService`, chat via `AgentClient`, `controller_tools.ts` removed, one undo step per turn / MCP change, UI commit fix; (B) history panel, per-author undo and AI author marker. Until A lands, the chat still runs `executeMappingAgentTool` on the controller and **Revert last AI turn** restores the pre-turn snapshot. See [MCP_ARCHITECTURE.md](../MCP_ARCHITECTURE.md).
