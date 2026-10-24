/**
 * Optional in-app AI credentials for Call AI (OpenAI-compatible chat completions).
 * Stored in Host localStorage — never in the Project Bundle.
 */
import { redactSecret } from "./redact.ts";
import { parseProviderUsage, type TokenUsage } from "./token_usage.ts";
import { promptCacheFields } from "./prompt_cache.ts";

export const AI_CREDENTIALS_STORAGE_KEY = "intehrgrator.ai.credentials";

export interface AiProviderCredentials {
  /** Chat completions URL, e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string;
  apiKey: string;
  model: string;
  /** Preset id from `AI_PROVIDER_PRESETS`, or `custom`. */
  providerId?: string;
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
    /**
     * Provider extension kept verbatim, e.g. Gemini 3's
     * `{ google: { thought_signature } }`, which must come back on the next
     * step or Gemini answers 400.
     */
    extra_content?: unknown;
  }>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Opaque provider extension (Gemini thought signature) to send back unchanged. */
  extraContent?: unknown;
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
  /** The provider stopped at the output-token limit (finish_reason length / MAX_TOKENS). */
  truncated?: boolean;
  /** Token use the provider reported for this request (#276); absent when it reported none. */
  usage?: TokenUsage;
}

/** Output-token ceiling when the caller does not pass one. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/**
 * Gemini counts thinking tokens against `max_tokens` (Gemini thinking docs),
 * so 8192 can end the answer mid-JSON; Gemini 3.x allows far more per call.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 32768;

export function defaultMaxOutputTokens(endpoint: string): number {
  return /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/i.test(endpoint)
    ? GEMINI_MAX_OUTPUT_TOKENS
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

/** OpenAI `length`, Gemini `MAX_TOKENS`, Anthropic `max_tokens`. */
export function isLengthFinish(reason: unknown): boolean {
  return typeof reason === "string" && /^(length|max_tokens|max_output_tokens)$/i.test(reason);
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
  // Before #252 a `mappingMode` ("tools" | "suggestions") chose how AI chat
  // mapped. Send now always runs the streaming tool loop, so the field is dropped.
  return {
    endpoint,
    apiKey,
    model,
    ...(providerId ? { providerId } : {}),
  };
}

export function loadAiCredentials(storage: Storage): AiProviderCredentials | null {
  try {
    const raw = storage.getItem(AI_CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Record<string, unknown> | null;
    const parsed = parseAiCredentials(stored);
    // Migrate: rewrite once without the retired `mappingMode` field.
    if (parsed && stored && typeof stored === "object" && "mappingMode" in stored) {
      try {
        storage.setItem(AI_CREDENTIALS_STORAGE_KEY, JSON.stringify(parsed));
      } catch {
        // quota / private mode: parse already ignores the field
      }
    }
    return parsed;
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
  "You are an intEHRgrator mapping assistant. Reply with one intehrgrator-suggestions JSON version 2 block (fenced). Outside it, add only brief `### Notes` / `### Questions` sections when needed.";

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
  /**
   * Ask for server-sent events (`stream: true`) and report deltas as they
   * arrive. Providers that ignore the flag and answer JSON still work; a 400
   * that names `stream` retries once without it.
   */
  onDelta?: (delta: ChatStreamDelta) => void;
}

/** One streamed piece of an assistant step. */
export type ChatStreamDelta =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; index: number; name: string };

interface RawToolCallRow {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
  extra_content?: unknown;
}

interface RawChoice {
  finish_reason?: unknown;
  stop_reason?: unknown;
  message?: { role?: string; content?: unknown; tool_calls?: RawToolCallRow[] };
}

function isEventStream(response: Response): boolean {
  return /text\/event-stream/i.test(response.headers.get("content-type") ?? "");
}

/**
 * Read an OpenAI-compatible SSE chat stream (`data: {choices:[{delta}]}` …
 * `data: [DONE]`) into the same shape as a non-streamed `choices[0]`.
 * Tool-call deltas are merged by `index`; any `extra_content` (Gemini's
 * thought signature) is kept on its call. `reasoning_content` / `reasoning`
 * deltas (DeepSeek, OpenRouter, Ollama, LM Studio) are reported, not stored.
 */
export async function readChatCompletionStream(
  response: Response,
  onDelta?: (delta: ChatStreamDelta) => void,
): Promise<{ choice: RawChoice; reasoning: string; usage?: TokenUsage }> {
  const reader = response.body?.getReader();
  let content = "";
  let reasoning = "";
  let finish: unknown;
  let usage: TokenUsage | undefined;
  const calls: Array<{ id?: string; name: string; args: string; extra?: unknown }> = [];
  if (!reader) return { choice: { message: { role: "assistant", content: "" } }, reasoning };
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  const handle = (data: string) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (chunk.error) {
      const err = chunk.error as { message?: unknown };
      throw new Error(`AI stream error: ${String(err?.message ?? JSON.stringify(chunk.error)).slice(0, 400)}`);
    }
    // With stream_options.include_usage the last chunk has `usage` and no choices.
    const reported = parseProviderUsage(chunk.usage);
    if (reported) usage = reported;
    const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (!choice) return;
    if (choice.finish_reason != null) finish = choice.finish_reason;
    const delta = (choice.delta ?? choice.message) as Record<string, unknown> | undefined;
    if (!delta) return;
    const piece = typeof delta.content === "string" ? delta.content : "";
    if (piece) {
      content += piece;
      onDelta?.({ kind: "text", text: piece });
    }
    const thought = typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta.reasoning === "string"
      ? delta.reasoning
      : "";
    if (thought) {
      reasoning += thought;
      onDelta?.({ kind: "reasoning", text: thought });
    }
    const rows = Array.isArray(delta.tool_calls) ? delta.tool_calls as Array<Record<string, unknown>> : [];
    for (const row of rows) {
      const index = typeof row.index === "number" ? row.index : calls.length;
      const fn = (row.function ?? {}) as { name?: unknown; arguments?: unknown };
      let call = calls[index];
      if (!call) {
        call = { name: "", args: "" };
        calls[index] = call;
      }
      if (typeof row.id === "string" && row.id) call.id = row.id;
      if (typeof fn.name === "string" && fn.name && !call.name) {
        call.name = fn.name;
        onDelta?.({ kind: "tool", index, name: fn.name });
      }
      if (typeof fn.arguments === "string") call.args += fn.arguments;
      else if (fn.arguments && typeof fn.arguments === "object") call.args = JSON.stringify(fn.arguments);
      if (row.extra_content !== undefined) call.extra = row.extra_content;
    }
  };
  while (!done) {
    const { value, done: eof } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) handle(data);
      if (done) break;
    }
    if (eof) {
      const tail = buffer.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim()).join("\n");
      if (tail && !done) handle(tail);
      break;
    }
  }
  if (done) await reader.cancel().catch(() => {});
  return {
    choice: {
      finish_reason: finish,
      message: {
        role: "assistant",
        content: content,
        tool_calls: calls.filter(Boolean).map((call, i) => ({
          id: call.id ?? `call_${i}`,
          type: "function",
          function: { name: call.name, arguments: call.args || "{}" },
          ...(call.extra !== undefined ? { extra_content: call.extra } : {}),
        })),
      },
    },
    reasoning,
    ...(usage ? { usage } : {}),
  };
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
  const send = async (stream: boolean, streamUsage = stream): Promise<Response> => {
    const body = {
      model: parsed.model,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? defaultMaxOutputTokens(parsed.endpoint),
      messages,
      ...(options?.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
      ...(stream ? { stream: true } : {}),
      // Ask for a final usage chunk (#276); a provider that rejects it is asked again without.
      ...(stream && streamUsage ? { stream_options: { include_usage: true } } : {}),
      ...promptCacheFields(parsed.endpoint, parsed.model),
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
    return await fetchImpl(requestUrl, {
      method: "POST",
      headers,
      body: requestBody,
      signal: options?.signal,
    });
  };
  const failure = async (response: Response): Promise<Error> => {
    // Some providers echo (part of) the key; never let it reach chat history.
    const detail = redactSecret(await response.text().catch(() => ""), parsed.apiKey);
    return new Error(
      `AI call failed (${response.status} ${response.statusText})${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  };
  let streaming = Boolean(options?.onDelta);
  let response = await send(streaming);
  if (!response.ok && streaming && response.status === 400) {
    let err = await failure(response);
    // A provider that does not know stream_options: stream without the usage chunk.
    if (/stream_options|include_usage/i.test(err.message)) {
      response = await send(true, false);
      if (!response.ok && response.status === 400) err = await failure(response);
    }
    if (!response.ok) {
      // A provider without streaming: ask again for one JSON answer.
      if (!/stream/i.test(err.message)) throw err;
      streaming = false;
      response = await send(false);
    }
  }
  if (!response.ok) throw await failure(response);
  let raw: { choices?: RawChoice[]; usage?: unknown };
  let usage: TokenUsage | undefined;
  if (streaming && isEventStream(response)) {
    const read = await readChatCompletionStream(response, options?.onDelta);
    raw = { choices: [read.choice] };
    usage = read.usage;
  } else {
    raw = await response.json() as { choices?: RawChoice[]; usage?: unknown };
    usage = parseProviderUsage(raw?.usage);
    // Non-streaming fallback: still show the answer in one piece.
    const content = raw?.choices?.[0]?.message?.content;
    if (streaming && typeof content === "string" && content) options?.onDelta?.({ kind: "text", text: content });
  }
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
        ...(row.extra_content !== undefined ? { extraContent: row.extra_content } : {}),
      };
    })
    .filter((row): row is ChatToolCall => row != null);
  const choice = raw?.choices?.[0];
  const truncated = isLengthFinish(choice?.finish_reason ?? choice?.stop_reason);
  if (!text.trim() && toolCalls.length === 0) {
    throw new Error(
      truncated
        ? "AI response hit the output-token limit before any text (the model spent it thinking). Try again, or ask for a smaller part."
        : "AI response had no text",
    );
  }
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length
      ? {
        tool_calls: toolCalls.map((row) => ({
          id: row.id,
          type: "function",
          function: { name: row.name, arguments: row.arguments },
          ...(row.extraContent !== undefined ? { extra_content: row.extraContent } : {}),
        })),
      }
      : {}),
  };
  return {
    text,
    raw,
    ...(usage ? { usage } : {}),
    ...(truncated ? { truncated } : {}),
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
  "You are an intEHRgrator mapping assistant. Use the provided tools — they are the same names as MCP and the HTTP Agent API (`map_slot`, `import_suggestions`, `list_slots`, `run_test`, …). The first message carries the slot manifest and source tree, so call list_slots / get_source_tree only when you need fresh state or a filtered view, and get_example for example values. Prefer map_slot for Click-to-Map source paths and import_suggestions for loops, Decision tables, and bulk envelopes. After mapping, call run_test. If you cannot use tools, reply with intehrgrator-suggestions JSON version 2. map_slot / import_suggestions take optional `note` (risks only: ambiguous source, unit/coding mismatch, lossy conversion, guessed path) and `confidence` (integer 0–100 % chance it is correct; only when below 90). Finish with a 1–3 line summary plus optional `### Notes` (risks, skipped slots + reason) and `### Questions` (`1. …?` each, options as indented `- ` sub-bullets, max 4, at most one ending ` (recommended)`).";

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
  // Pass the body through unread so a streamed (SSE) answer reaches the
  // browser chunk by chunk.
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The provider rejected `tools` (400 mentioning tools): fall back to suggestions JSON. */
export function isToolsUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // Gemini 3's "missing a thought_signature … required for tools" is a 400
  // about OUR request, not a provider without tools: do not fall back on it.
  if (/thought_signature/i.test(message)) return false;
  return /400/.test(message) && /tool/i.test(message);
}
