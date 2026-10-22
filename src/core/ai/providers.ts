/**
 * OpenAI-compatible presets for Call AI credentials.
 * Endpoints and key URLs are from each vendor's current docs.
 */
export interface AiProviderPreset {
  id: string;
  label: string;
  /** Full chat-completions URL (not a base URL). */
  endpoint: string;
  model: string;
  /** Local servers that require a non-empty dummy key. */
  apiKeyPlaceholder?: string;
  /** Where to create / copy the API key or token. */
  keyUrl: string;
  /** Vendor docs for the OpenAI-compatible (or runner) API. */
  docsUrl: string;
  /** Shown in the AI credentials dialog. */
  help: string;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    help:
      "Create a Gemini API key in Google AI Studio (new keys are auth keys; standard keys are rejected as of September 2026). Call AI POSTs Google's OpenAI-compatible chat completions URL with Authorization: Bearer <key>. Function tools work on that endpoint. GitHub Pages browsers often hit CORS; the desktop app forwards the call.",
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1",
    keyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    help:
      "Create a project API key in the OpenAI dashboard. Endpoint is POST /v1/chat/completions with Bearer auth. Function tools (mapping Agent API names) work on this endpoint. GitHub Pages browsers often hit CORS; use the desktop app or a CORS proxy.",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    endpoint: "https://api.anthropic.com/v1/chat/completions",
    model: "claude-sonnet-4-6",
    keyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://platform.claude.com/docs/en/api/openai-sdk",
    help:
      "Create a Claude API key in the Anthropic Console. Call AI uses Anthropic's OpenAI-compatible POST /v1/chat/completions (Bearer + x-api-key). Function tools are supported. Native /v1/messages is not required here.",
  },
  {
    id: "ollama-local",
    label: "Ollama (local)",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    model: "gpt-oss:20b",
    apiKeyPlaceholder: "ollama",
    keyUrl: "https://docs.ollama.com/openai",
    docsUrl: "https://docs.ollama.com/openai",
    help:
      "Install Ollama and run a model (`ollama run …`). Local /v1/chat/completions ignores the API key; Call AI sends the dummy value ollama. Enable CORS if you call from a browser (OLLAMA_ORIGINS). Mapping tools need a model that supports OpenAI function calling.",
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    endpoint: "https://ollama.com/v1/chat/completions",
    model: "gpt-oss:120b",
    keyUrl: "https://ollama.com/settings/keys",
    docsUrl: "https://docs.ollama.com/cloud",
    help:
      "Create an Ollama API key (no local install required). Set the key as Bearer against https://ollama.com/v1. Cloud models are listed in the Ollama Cloud docs. GitHub Pages may hit CORS; desktop forwards the request.",
  },
  {
    id: "lmstudio-local",
    label: "LM Studio (local)",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: "openai/gpt-oss-20b",
    apiKeyPlaceholder: "lm-studio",
    keyUrl: "https://lmstudio.ai/docs/developer/core/authentication",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat",
    help:
      "Start the LM Studio local server (Developer). Default OpenAI-compatible URL is http://localhost:1234/v1/chat/completions. Auth is off by default; if you enable tokens, paste a Bearer token from Server Settings. Turn on CORS for browser Call AI. Use the loaded model's identifier from GET /v1/models.",
  },
  {
    id: "lmstudio-cloud",
    label: "LM Studio (cloud / remote)",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: "openai/gpt-oss-20b",
    apiKeyPlaceholder: "lm-studio",
    keyUrl: "https://lmstudio.ai/docs/lmlink/basics",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat",
    help:
      "LM Studio Secure Cloud / Bionic Cloud is account + credits inside Bionic (not a public chat-completions host). For Call AI, point Endpoint at a reachable OpenAI-compatible LM Studio server: LM Link, another machine's :1234, or a LAN URL. Same /v1/chat/completions shape as local. If the remote server requires a token, paste it as the API key.",
  },
  {
    id: "huggingface",
    label: "Hugging Face Inference",
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    model: "openai/gpt-oss-120b:fastest",
    keyUrl: "https://huggingface.co/settings/tokens",
    docsUrl: "https://huggingface.co/docs/inference-providers/en/index",
    help:
      "Create a fine-grained Hugging Face token with permission “Make calls to Inference Providers”. Call AI posts to https://router.huggingface.co/v1/chat/completions with Bearer HF_TOKEN. Append :fastest, :cheapest, or a provider id to the model. Function calling is documented for Inference Providers.",
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    endpoint: "https://opencode.ai/zen/v1/chat/completions",
    model: "big-pickle",
    keyUrl: "https://opencode.ai/auth",
    docsUrl: "https://opencode.ai/docs/zen/",
    help:
      "Sign in at opencode.ai/auth, add billing, and copy the Zen API key. Call AI uses the OpenAI-compatible Zen gateway (https://opencode.ai/zen/v1/chat/completions) with Bearer auth. Pick a model whose Zen table lists chat-completions (big-pickle, minimax-m3, glm-5.3-flash, mimo-v2.5-free, …). GPT rows use /responses and Claude rows use /messages — those will not work here.",
  },
  {
    id: "opencode-cloud",
    label: "OpenCode cloud runner",
    endpoint: "",
    model: "",
    keyUrl: "https://docs.railway.com/cloud-agents/opencode",
    docsUrl: "https://opencode.ai/docs/server/",
    help:
      "OpenCode's cloud runner is an agent host, not a model key. Run `opencode serve` (or Railway `railway ca desktop --opencode`) and point that process at intEHRgrator MCP / HTTP Agent API — the same tools as an IDE agent. For in-app Call AI, pick OpenCode Zen (or another chat-completions provider) and paste that key. See docs/AI_CREDENTIALS.md and docs/AGENT_WORKFLOW.md.",
  },
];

export function findAiProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((row) => row.id === id);
}

export function applyAiProviderPreset(id: string): {
  providerId: string;
  endpoint: string;
  model: string;
  apiKey: string;
} {
  const preset = findAiProviderPreset(id);
  if (!preset) {
    return { providerId: "custom", endpoint: "", model: "", apiKey: "" };
  }
  return {
    providerId: preset.id,
    endpoint: preset.endpoint,
    model: preset.model,
    apiKey: preset.apiKeyPlaceholder ?? "",
  };
}
