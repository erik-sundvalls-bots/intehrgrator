# AI in the web app

The **AI** menu has two sections for the web app, and a third that appears only in the downloaded desktop app. This page is the first two. The desktop section is [Desktop and a local IDE](desktop-and-local-ai.md).

Back to the [tutorial index](../TUTORIAL.md).

<img src="../assets/tutorial/ai-menu.png" alt="AI menu open: copy/paste for an external AI chat above Your own AI, with Configure AI credentials" />

*Copy-and-paste actions sit above **Configure AI credentials…**. The chat itself is the **AI chat** panel under Target & Previews.*

## Copy for an external chat

Use this when you paste a prompt into ChatGPT, Claude, Cursor, or another chat you already pay for.

Under **copy/paste for external AI chat**, pick how context is packed. Each choice copies a prompt and remembers that mode for next time:

- **Embed files in prompt** — schema, template, and examples are inside the markdown.
- **Attach files in chat** — the prompt tells you which files to attach yourself.
- **Browse URIs (when available)** — the prompt points at URLs instead of embedding bytes.

Without credentials the **AI chat** panel offers the same flow: type your request, **Copy prompt**, paste it into your chat, then **Import AI answer…**.

<img src="../assets/tutorial/ai-chat-copy-paste.png" alt="AI chat panel without credentials: notice with Configure AI credentials, message box, Copy prompt and Import AI answer buttons" />

**Import AI suggestions** (menu) and **Import AI answer…** (chat) open the same dialog. It accepts raw JSON or an `intehrgrator-suggestions` fence and shows what will be applied. Validation errors stay in the dialog so you can copy them back to the chat. The format is [AI_SUGGESTION_FORMAT.md](../AI_SUGGESTION_FORMAT.md). This dialog is only for pasted answers.

## Your own AI

Use this when intEHRgrator should call the model itself.

1. **Configure AI credentials…** — pick a provider, endpoint, API key, and model. Credentials stay in this browser. They are never stored in the Project Bundle. There is nothing else to choose: the chat always uses the mapping tools.

   <img src="../assets/tutorial/ai-credentials.png" alt="AI credentials dialog with the Ollama (local) preset: provider, endpoint, masked API key and model" />

2. Type in the **AI chat** panel and press **Send**. The answer streams in, with the model's reasoning when the provider sends it. The model maps with the same tools as MCP (`list_slots`, `map_slot`, `import_suggestions`, `get_example`, `run_test`, …) right on the canvas, and each applied mapping shows as a short **✓ Mapped …** line. While it runs, **Send** becomes **Stop** (or press Esc); what was mapped before Stop stays.

   <img src="../assets/tutorial/ai-chat-streaming.png" alt="AI chat while streaming: reasoning, a ✓ Mapped Systolic line, and the Stop button" />

3. When the turn ends, the whole turn is one **Undo** step (↶ or Ctrl+Z); the status line says it was a change by the AI chat. The **History** button (clock, next to Undo / Redo) lists every change with who made it; **Revert** on the AI turn takes back only that turn and keeps what you changed later. Blocks the AI wrote carry a small purple **AI** badge until you change them. You can keep chatting; later messages send only your new text.

   <img src="../assets/tutorial/ai-chat-done.png" alt="Finished AI chat turn with the ✓ line, one tool call and the answer" />

If a provider does not support function tools, the chat asks once for suggestions JSON and applies it directly, also as one Undo step.

### Token use, context window and budget

Next to **Stop** / **Send** a meter shows the tokens this chat has used, updated after every step while the model works. It counts what the provider reports (input, cached input, output, and the cost when the provider gives one, such as OpenRouter); a `~` means the provider reported nothing and the number is an estimate. The ring shows how full the model's context window is: the last request's input plus output against the window. The window is known for common models (GPT-4o, GPT-4.1, GPT-5, o-series, Claude, Gemini, DeepSeek, …); for any other model set it in the meter's popover, otherwise the ring is hidden.

The chat API keeps no session on the provider's side: every step sends the whole chat again, so the input grows with each step and turn. Providers with prompt caching bill the repeated start of the chat cheaper ("cached" in the popover). When the history gets too long for the model's context window (half of it; 64k tokens for an unknown model), the oldest turns are dropped and the next message re-attaches the project context.

Click the meter to set an optional **token budget per chat** (input + output until **Clear history**, for example `2M`). At 80 % the chat warns; at 100 % it pauses after the step that reached it. **Raise budget … and continue** raises it and lets the model go on where it stopped. The budget is a spending warning, not a hard limit, and it is kept in this browser only. A model that keeps calling tools without finishing is stopped after 100 steps; send "continue" to let it go on.

<img src="../assets/tutorial/ai-chat-tokens.png" alt="Token meter popover: context 41k of 128k tokens, input, cached and output tokens of this chat, token budget and context-window fields" />

<img src="../assets/tutorial/ai-chat-budget-paused.png" alt="AI chat paused at the token budget, with a Raise budget to 200k and continue button and the red meter 126k / 100k" />

On GitHub Pages the browser often cannot reach a cloud API (CORS). The desktop app forwards AI chat requests through its own server, so Gemini, OpenAI, Anthropic, Hugging Face, and OpenCode Zen work there. Key pages: [AI chat credentials](../AI_CREDENTIALS.md).

| Provider | Create credentials |
|----------|-------------------|
| Google Gemini | [AI Studio API keys](https://aistudio.google.com/app/apikey) · [OpenAI-compat docs](https://ai.google.dev/gemini-api/docs/openai) |
| OpenAI | [API keys](https://platform.openai.com/api-keys) · [Chat completions](https://platform.openai.com/docs/api-reference/chat) |
| Anthropic Claude | [Console keys](https://console.anthropic.com/settings/keys) · [OpenAI SDK compat](https://platform.claude.com/docs/en/api/openai-sdk) |
| Ollama local | [OpenAI compatibility](https://docs.ollama.com/openai) (dummy key `ollama`) |
| Ollama Cloud | [API keys](https://ollama.com/settings/keys) · [Cloud](https://docs.ollama.com/cloud) |
| LM Studio local | [OpenAI compat](https://lmstudio.ai/docs/developer/openai-compat) · [Auth tokens](https://lmstudio.ai/docs/developer/core/authentication) |
| LM Studio cloud / remote | [LM Link](https://lmstudio.ai/docs/lmlink/basics) · [Bionic models](https://lmstudio.ai/docs/bionic/models) |
| Hugging Face | [Access tokens](https://huggingface.co/settings/tokens) · [Inference Providers](https://huggingface.co/docs/inference-providers/en/index) |
| OpenCode Zen | [Auth / API key](https://opencode.ai/auth) · [Zen](https://opencode.ai/docs/zen/) |

Refreshing a target or source opens a report with **Copy merge prompt** and **Open in AI chat**. Blocks you detached stay on the canvas.

**Run Test** after any AI pass. See [Tests and export](tests-and-export.md).
