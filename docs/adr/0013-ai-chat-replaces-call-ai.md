# AI chat replaces one-shot Call AI

**Call AI** sent one prompt, ran the tool loop once, and kept nothing. Users could not follow up, and the model often guessed which node was meant. **AI chat** (#234) replaces it with a multi-turn panel in the lower split of **Target & Previews**, **Context chips** for source / target nodes and Blockly blocks, and **Stored prompts**.

**Status:** accepted (#234)
**Date:** 2026-10-16

Decisions:

- **Multi-turn, per-project history in localStorage** (`intehrgrator.ai.chat.<projectId>`), never in the Project Bundle. **Clear history** cuts the context; the oldest whole turns are dropped when the history gets large.
- **Context once:** the first message carries the full project prompt (`buildAiPromptText`, the Copy prompt text). Later messages carry the user text plus details of chips not yet described. Picking **Map the whole project** re-attaches the full context.
- **User-chosen apply mode:** **Apply directly** runs MCP-named tools on the live canvas, lists each call, and offers **Revert last AI turn** (restores the document snapshot from before the turn, as one undo step). **Approve first** asks for `intehrgrator-suggestions` JSON without tools and opens it in the existing Import Suggestions dialog. **Suggestions JSON only** in AI credentials, or a provider that rejects tools, falls back to Approve first.
- **Always present (#249 review):** the panel is never closed, only **collapsed** to a slim **AI CHAT** bar with a square toggle (same style as the Source / Target & Previews slide buttons, bottom-half glyph); collapsed/expanded state and split height live in localStorage. There is no AI menu item for it; **Add to AI chat**, the refresh report's AI button and the toggle expand it. Without credentials the panel offers copy & paste prompting from the same input, and **Import AI answer…**. The AI menu's copy & paste items stay for now.
- **Context chips are inline** in a contenteditable input and expand into a fixed `### Context attachments` block on send.
- **Stored prompts:** read-only built-ins plus user prompts in localStorage (`intehrgrator.ai.storedPrompts`), with `{source_node}` / `{target_node}` placeholders.
- Desktop CORS forwarding (`/api/v1/ai-chat-completions`) and the CORS hint are reused unchanged.

**Considered:** keeping one-shot Call AI next to the chat; session-only history; storing history in the Project Bundle; a chip row above a plain textarea; disabling the menu until credentials exist; a closable panel opened from the AI menu. Rejected: two AI entry points that drift; history lost on reload; chats leaking into shared bundles; chips separated from the sentence they belong to; a disabled item with a tooltip does not help users find the copy & paste path; a hidden panel is hard to discover again.

**Consequences:** `runMappingAgent` takes an optional `history` and returns the conversation; `runSuggestionsChatTurn` serves the no-tools fallback; `installImportAiDialog` returns `open(text?)`. Code: `src/ui/ai_chat_panel.ts`, `src/core/ai/chat_context.ts`, `chat_history.ts`, `stored_prompts.ts`. Architecture of the shared tool names: [MCP_ARCHITECTURE.md](../MCP_ARCHITECTURE.md).

**Update (#252 / #251):** the user-chosen apply mode is retired. With credentials, **Send** always streams the tool loop and applies directly (revertible), shows a ✓ line per applied mapping and offers **Stop**; the **Approve first** select and the **Suggestions JSON only** credential option are removed (stored values are dropped on load). A provider that rejects tools gets one suggestions-JSON turn applied directly. The Import Suggestions approval modal stays for copy & paste answers only. How chat changes reach undo and history is decided in [ADR 0014](0014-one-write-path-attributed-undo.md) (one write path with MCP, one attributed undo step per AI turn); Revert last AI turn is interim until then. Send attaches the compact API chat context (`buildAiPromptText("api")`) instead of the inline copy & paste prompt.
