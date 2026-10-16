/**
 * Optional in-app AI credentials for Call AI (OpenAI-compatible chat completions).
 * Stored in Host localStorage — never in the Project Bundle.
 */
import type { AiMappingMode } from "./providers.ts";

export const AI_CREDENTIALS_STORAGE_KEY = "intehrgrator.ai.credentials";

export interface AiProviderCredentials {
  /** Chat completions URL, e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string;
  apiKey: string;
  model: string;
  /** Preset id from `AI_PROVIDER_PRESETS`, or `custom`. */
  providerId?: string;
  /**
   * `tools` (default): OpenAI function tools named like MCP / Agent API.
   * `suggestions`: one-shot intehrgrator-suggestions JSON.
   */
  mappingMode?: AiMappingMode;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  /** OpenAI wire shape when this is an assistant tool-call turn. */
  tool_calls?: Array<{
    id: string;
    type?: "function";
    function?: { name: string; arguments: string };
  }>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  text: string;
  raw: unknown;
  toolCalls?: ChatToolCall[];
  assistantMessage?: ChatMessage;
}

export function parseAiCredentials(raw: unknown): AiProviderCredentials | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const endpoint = String(rec.endpoint ?? "").trim();
  const apiKey = String(rec.apiKey ?? "").trim();
  const model = String(rec.model ?? "").trim();
  if (!endpoint || !apiKey || !model) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  const providerId = typeof rec.providerId === "string" ? rec.providerId.trim() : "";
  const mappingMode = rec.mappingMode === "suggestions" ? "suggestions" : "tools";
  return {
    endpoint,
    apiKey,
    model,
    ...(providerId ? { providerId } : {}),
    mappingMode,
  };
}

export function loadAiCredentials(storage: Storage): AiProviderCredentials | null {
  try {
    const raw = storage.getItem(AI_CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    return parseAiCredentials(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveAiCredentials(storage: Storage, credentials: AiProviderCredentials): void {
  const parsed = parseAiCredentials(credentials);
  if (!parsed) throw new Error("AI credentials need an HTTP(S) endpoint, API key, and model");
  storage.setItem(AI_CREDENTIALS_STORAGE_KEY, JSON.stringify(parsed));
}

export function clearAiCredentials(storage: Storage): void {
  storage.removeItem(AI_CREDENTIALS_STORAGE_KEY);
}

export function hasAiCredentials(storage: Storage): boolean {
  return loadAiCredentials(storage) != null;
}

export const SUGGESTIONS_SYSTEM =
  "You are an intEHRgrator mapping assistant. Reply with intehrgrator-suggestions JSON version 2 only, in a fenced json block or as raw JSON.";

export interface PostChatCompletionsOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  tools?: OpenAiTool[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Desktop Agent API proxy (`/api/v1/ai-chat-completions`) so browser CORS
   * does not block cloud providers.
   */
  proxyUrl?: string;
}

/**
 * POST an OpenAI-compatible chat completion. The web app may need a
 * CORS-friendly proxy or the desktop Agent API forwarder; IDE/MCP remains
 * valid without credentials.
 */
export async function postChatCompletions(
  credentials: AiProviderCredentials,
  messages: ChatMessage[],
  options?: PostChatCompletionsOptions,
): Promise<ChatCompletionResult> {
  const parsed = parseAiCredentials(credentials);
  if (!parsed) throw new Error("AI credentials are incomplete");
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const body = {
    model: parsed.model,
    temperature: options?.temperature ?? 0,
    max_tokens: options?.maxTokens ?? 8192,
    messages,
    ...(options?.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (!options?.proxyUrl) {
    Object.assign(headers, providerAuthHeaders(parsed.endpoint, parsed.apiKey));
  }
  const requestUrl = options?.proxyUrl?.trim() || parsed.endpoint;
  const requestBody = options?.proxyUrl
    ? JSON.stringify({
      endpoint: parsed.endpoint,
      apiKey: parsed.apiKey,
      body,
    })
    : JSON.stringify(body);
  const response = await fetchImpl(requestUrl, {
    method: "POST",
    headers,
    body: requestBody,
    signal: options?.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AI call failed (${response.status} ${response.statusText})${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  }
  const raw = await response.json() as {
    choices?: Array<{
      message?: {
        role?: string;
        content?: unknown;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: unknown };
        }>;
      };
    }>;
  };
  const message = raw?.choices?.[0]?.message;
  const content = message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
    ? content.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("")
    : "";
  const toolCalls = (message?.tool_calls ?? [])
    .map((row): ChatToolCall | null => {
      const name = String(row.function?.name ?? "").trim();
      if (!name) return null;
      const args = row.function?.arguments;
      return {
        id: String(row.id ?? name),
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      };
    })
    .filter((row): row is ChatToolCall => row != null);
  if (!text.trim() && toolCalls.length === 0) throw new Error("AI response had no text");
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length
      ? {
        tool_calls: toolCalls.map((row) => ({
          id: row.id,
          type: "function",
          function: { name: row.name, arguments: row.arguments },
        })),
      }
      : {}),
  };
  return {
    text,
    raw,
    ...(toolCalls.length ? { toolCalls } : {}),
    assistantMessage,
  };
}

export async function callChatCompletions(
  credentials: AiProviderCredentials,
  prompt: string,
  options?: { fetch?: typeof fetch; signal?: AbortSignal; proxyUrl?: string },
): Promise<ChatCompletionResult> {
  return await postChatCompletions(
    credentials,
    [
      { role: "system", content: SUGGESTIONS_SYSTEM },
      { role: "user", content: prompt },
    ],
    options,
  );
}

/** OpenAI-compat Bearer, plus Anthropic's native `x-api-key` when the host is Anthropic. */
export function providerAuthHeaders(endpoint: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  };
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    if (host === "api.anthropic.com" || host.endsWith(".anthropic.com")) {
      headers["x-api-key"] = apiKey;
    }
  } catch {
    // endpoint already validated by the caller
  }
  return headers;
}

export const MAPPING_TOOLS_SYSTEM =
  "You are an intEHRgrator mapping assistant. Use the provided tools — they are the same names as MCP and the HTTP Agent API (`map_slot`, `import_suggestions`, `list_slots`, `run_test`, …). Prefer map_slot for Click-to-Map source paths and import_suggestions for loops, Decision tables, and bulk envelopes. After mapping, call run_test. If you cannot use tools, reply with intehrgrator-suggestions JSON version 2 only.";

export async function forwardChatCompletionsProxy(
  payload: unknown,
  options?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<Response> {
  if (!payload || typeof payload !== "object") {
    return new Response(JSON.stringify({ error: "Body must be JSON" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const rec = payload as Record<string, unknown>;
  const endpoint = String(rec.endpoint ?? "").trim();
  const apiKey = String(rec.apiKey ?? "").trim();
  if (!endpoint || !apiKey) {
    return new Response(JSON.stringify({ error: "endpoint and apiKey are required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return new Response(JSON.stringify({ error: "endpoint must be an HTTP(S) URL" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return new Response(JSON.stringify({ error: "endpoint must be HTTP(S)" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...providerAuthHeaders(endpoint, apiKey),
    },
    body: JSON.stringify(rec.body ?? {}),
    signal: options?.signal,
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
