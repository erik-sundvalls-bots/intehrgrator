/**
 * "Connect & fetch models" for the AI credentials dialog: list the models an
 * OpenAI-compatible provider offers, derived from its chat completions URL.
 */
import { findAiProviderPreset } from "./providers.ts";
import { providerAuthHeaders } from "./credentials.ts";
import { redactSecret } from "./redact.ts";

export type ModelListErrorKind =
  | "endpoint"
  | "auth"
  | "http"
  | "network"
  | "parse"
  | "empty";

export class ModelListError extends Error {
  constructor(
    readonly kind: ModelListErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModelListError";
  }
}

/**
 * `<base>/models` for a chat completions URL. Works for OpenAI-style
 * `/v1/chat/completions`, Gemini's `/v1beta/openai/chat/completions`,
 * OpenRouter's `/api/v1/…`, Hugging Face's router, Ollama / LM Studio `:port/v1`.
 * A base URL (no `/chat/completions`) gets `/models` appended.
 */
export function modelsUrlFromEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new ModelListError("endpoint", "Endpoint must be a full http(s) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ModelListError("endpoint", "Endpoint must be http(s)");
  }
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/chat\/completions$/i, "").replace(
    /\/completions$/i,
    "",
  ).replace(/\/models$/i, "");
  url.pathname = `${path}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Headers for GET <base>/models (Bearer; Anthropic also wants x-api-key + version). */
export function modelsRequestHeaders(
  modelsUrl: string,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (!apiKey.trim()) return headers; // local servers (Ollama, LM Studio) without auth
  Object.assign(headers, providerAuthHeaders(modelsUrl, apiKey.trim()));
  if ("x-api-key" in headers) headers["anthropic-version"] = "2023-06-01";
  return headers;
}

/**
 * Model ids from a models-list response: OpenAI `{data:[{id}]}`, Ollama
 * `{models:[{name|model}]}`, or a bare array of ids/objects. Gemini's
 * `models/` prefix is dropped (chat completions takes the bare id).
 */
export function parseModelsResponse(raw: unknown): string[] {
  const rec = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(rec.data)
    ? rec.data
    : Array.isArray(rec.models)
    ? rec.models
    : [];
  const ids = new Set<string>();
  for (const row of rows) {
    let id = "";
    if (typeof row === "string") id = row;
    else if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      id = String(r.id ?? r.name ?? r.model ?? "");
    }
    id = id.trim().replace(/^models\//, "");
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export interface FetchModelListOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Desktop forwarder (`/api/v1/ai-models`), POSTed `{ endpoint, apiKey }`
   * with the models URL, so browser CORS does not block the call.
   */
  proxyUrl?: string;
}

export async function fetchModelList(
  endpoint: string,
  apiKey: string,
  options: FetchModelListOptions = {},
): Promise<string[]> {
  const modelsUrl = modelsUrlFromEndpoint(endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = options.proxyUrl
      ? await fetchImpl(options.proxyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: modelsUrl, apiKey }),
        signal: options.signal,
      })
      : await fetchImpl(modelsUrl, {
        method: "GET",
        headers: modelsRequestHeaders(modelsUrl, apiKey),
        signal: options.signal,
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ModelListError(
      "network",
      redactSecret(`Could not reach ${modelsUrl} (${message})`, apiKey),
    );
  }
  if (!response.ok) {
    const detail = redactSecret(
      (await response.text().catch(() => "")).slice(0, 300),
      apiKey,
    );
    const status = `HTTP ${response.status}${
      response.statusText ? ` ${response.statusText}` : ""
    }`;
    if (response.status === 401 || response.status === 403) {
      throw new ModelListError(
        "auth",
        `${status}: the provider rejected the API key${
          detail ? ` — ${detail}` : ""
        }`,
        response.status,
      );
    }
    throw new ModelListError(
      "http",
      `${status} from ${modelsUrl}${detail ? ` — ${detail}` : ""}`,
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ModelListError("parse", `${modelsUrl} did not return JSON`);
  }
  const ids = parseModelsResponse(body);
  if (!ids.length) {
    throw new ModelListError("empty", `${modelsUrl} listed no models`);
  }
  return ids;
}

/** Desktop forwarder for GET <base>/models (see `forwardChatCompletionsProxy`). */
export async function forwardModelsProxy(
  payload: unknown,
  options?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<Response> {
  const jsonError = (error: string, status = 400) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  if (!payload || typeof payload !== "object") {
    return jsonError("Body must be JSON");
  }
  const rec = payload as Record<string, unknown>;
  const endpoint = String(rec.endpoint ?? "").trim();
  const apiKey = String(rec.apiKey ?? "");
  let modelsUrl: string;
  try {
    modelsUrl = modelsUrlFromEndpoint(endpoint);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(modelsUrl, {
      method: "GET",
      headers: modelsRequestHeaders(modelsUrl, apiKey),
      signal: options?.signal,
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ??
          "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(
      `Could not reach ${modelsUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  }
}

/**
 * Model to show after switching provider: keep the current one only when it is
 * known valid for the new provider (its default, or in a list fetched for it);
 * otherwise that provider's default, or empty.
 */
export function modelAfterProviderChange(
  currentModel: string,
  newProviderId: string,
  fetchedForNewProvider: readonly string[] | undefined,
): string {
  const model = currentModel.trim();
  const preset = findAiProviderPreset(newProviderId);
  const fallback = preset?.model ?? "";
  if (!model) return fallback;
  if (model === fallback) return model;
  if (fetchedForNewProvider?.includes(model)) return model;
  return fallback;
}
