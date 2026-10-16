# AI chat credentials

How to get an API key (or dummy local token) so **AI chat** can map from the web app. Credentials stay in this browser’s localStorage — never in the Project Bundle.

AI chat speaks **OpenAI-compatible chat completions** (`POST …/v1/chat/completions` with `Authorization: Bearer <key>`). Default mapping mode sends the same **function tool names as MCP / the HTTP Agent API** (`list_slots`, `map_slot`, `import_suggestions`, `run_test`, …) and runs them on the open workbench. **Suggestions JSON only** is the one-shot import.

Three mapping-assist paths (pick one; they are not exclusive):

| Path | Who holds the model | Who writes mappings |
|------|---------------------|---------------------|
| **IDE + MCP** | Cursor, Claude Desktop, OpenCode TUI, … | The IDE agent, via `deno task mcp` |
| **AI chat** (this dialog) | Gemini, OpenAI, Anthropic, Ollama, LM Studio, Hugging Face, OpenCode Zen, … | intEHRgrator, looping those tool names on the live canvas |
| **Remote Agent API** | OpenCode `serve` / Railway cloud runner, HF jobs, … | That runner, against a reachable Agent API (`--bind` + `--token` when not loopback) |

GitHub Pages browsers often hit **CORS** on cloud APIs. The **desktop app** forwards AI chat through `POST /api/v1/ai-chat-completions`. Local Ollama / LM Studio need CORS enabled for the Pages origin. Copy prompt remains the fallback.

The credentials dialog links each vendor’s key page and API docs. This file is the longer walkthrough.

## Google Gemini

1. Open [Google AI Studio API keys](https://aistudio.google.com/app/apikey) ([key docs](https://ai.google.dev/gemini-api/docs/api-key)).
2. Create a key. New keys are **auth keys**. As of September 2026 the Gemini API rejects unrestricted **standard** keys — migrate if an old key fails.
3. Preset fills `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` and a current Flash model (`gemini-3.8-flash`).
4. OpenAI-compat + tools: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

## OpenAI

1. Open [API keys](https://platform.openai.com/api-keys) (project key in the OpenAI dashboard).
2. Preset fills `https://api.openai.com/v1/chat/completions` and `gpt-4.1`.
3. Docs: [Chat Completions](https://platform.openai.com/docs/api-reference/chat). Function tools (`tools`) work on this endpoint.

## Anthropic Claude

1. Open [Anthropic Console keys](https://console.anthropic.com/settings/keys).
2. Preset fills `https://api.anthropic.com/v1/chat/completions` and `claude-sonnet-4-6`.
3. AI chat uses the [OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk) layer (`Bearer` plus `x-api-key`). Native `/v1/messages` is not required. Tools are supported; `strict` schema validation is ignored on this layer.

## Ollama (local)

1. Install Ollama and pull/run a model (`ollama run …`). [OpenAI compatibility](https://docs.ollama.com/openai).
2. Preset fills `http://127.0.0.1:11434/v1/chat/completions`. Local `/v1` **ignores** the API key; AI chat sends the dummy value `ollama`.
3. From a browser, allow the Pages origin (`OLLAMA_ORIGINS`). Mapping tools need a model that supports OpenAI function calling.

## Ollama Cloud

1. Create a key at [ollama.com/settings/keys](https://ollama.com/settings/keys) ([authentication](https://docs.ollama.com/api/authentication), [cloud](https://docs.ollama.com/cloud)).
2. Preset fills `https://ollama.com/v1/chat/completions` with Bearer `OLLAMA_API_KEY`. No local install required.
3. Pick a cloud model id from the Ollama Cloud docs (preset example: `gpt-oss:120b`).

## LM Studio (local)

1. In LM Studio, start the Developer server ([OpenAI-compat](https://lmstudio.ai/docs/developer/openai-compat), [server](https://lmstudio.ai/docs/developer/core/server)).
2. Preset fills `http://127.0.0.1:1234/v1/chat/completions`. Auth is off by default; if you enable tokens, paste a Bearer token from [Server authentication](https://lmstudio.ai/docs/developer/core/authentication). Dummy key when auth is off: `lm-studio`.
3. Turn on CORS for browser AI chat. Use the loaded model identifier from `GET /v1/models`.

## LM Studio (cloud / remote)

[Bionic Cloud](https://lmstudio.ai/docs/bionic/models) is account + credits **inside Bionic**, not a public chat-completions host. For AI chat:

1. Point Endpoint at a reachable LM Studio OpenAI-compat URL: [LM Link](https://lmstudio.ai/docs/lmlink/basics), another machine’s `:1234`, or a LAN URL.
2. Same `/v1/chat/completions` shape as local. If the remote server requires a token, paste it as the API key.

## Hugging Face Inference

1. Create a **fine-grained** token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) with permission **Make calls to Inference Providers** ([token docs](https://huggingface.co/docs/hub/main/security-tokens)).
2. Preset fills `https://router.huggingface.co/v1/chat/completions` with Bearer `HF_TOKEN`.
3. Docs: [Inference Providers](https://huggingface.co/docs/inference-providers/en/index). Append `:fastest`, `:cheapest`, or a provider id to the model (preset example: `openai/gpt-oss-120b:fastest`). Function calling is documented for Inference Providers.

## OpenCode Zen (model key for AI chat)

1. Sign in at [opencode.ai/auth](https://opencode.ai/auth), add billing, copy the Zen API key.
2. Preset fills `https://opencode.ai/zen/v1/chat/completions`. Pick a model whose [Zen table](https://opencode.ai/docs/zen/) lists **chat-completions** (examples: `big-pickle`, `minimax-m3`, `glm-5.3-flash`, `mimo-v2.5-free`).
3. GPT rows use `/responses` and Claude rows use `/messages` — those will not work with AI chat’s chat-completions client.

## OpenCode cloud runner (agent host, not a AI chat key)

OpenCode’s server / Railway agent is the **remote Agent API** path: the runner *calls* intEHRgrator, like an IDE.

1. Desktop Agent API must be reachable (`deno task desktop` / `--headless`, `--bind` + `--token` when not loopback). See [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md).
2. Start OpenCode as a server: [`opencode serve`](https://opencode.ai/docs/server/) (`--port`, `--hostname`, `--cors`, optional `OPENCODE_SERVER_PASSWORD`).
3. Cloud attach (Railway): [`railway ca desktop --opencode`](https://docs.railway.com/cloud-agents/opencode) starts `opencode serve` on a cloud agent and prints Desktop connection settings.
4. Configure that OpenCode process with **intEHRgrator MCP** (`INTEHR_AGENT_URL` + token) or HTTP Agent API — same tools as Cursor.
5. Provider sign-in on the runner is separate. For **in-app AI chat**, still paste a Zen (or other chat-completions) key in **AI credentials…**.

## Custom endpoint

Any OpenAI-compatible `…/chat/completions` URL, Bearer key, and model id. Local HTTP is allowed (`127.0.0.1`). HTTPS for non-loopback.

## Related

- [docs/future/integrated-ai-assist.md](future/integrated-ai-assist.md)
- [docs/AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)
- [docs/AI_SUGGESTION_FORMAT.md](AI_SUGGESTION_FORMAT.md)
- [AI in the web app](tutorial/ai-in-the-web-app.md)
