/**
 * "Connect & fetch models" for the AI credentials dialog: list the models an
 * OpenAI-compatible provider offers, derived from its chat completions URL.
 */
import { findAiProviderPreset } from "./providers.ts";
import { providerAuthHeaders } from "./credentials.ts";
import { redactSecret } from "./redact.ts";
import type { ModelRate } from "./token_usage.ts";

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

/** Result of Connect & fetch models (#354): ids plus any listed USD-per-token rates. */
export interface ModelListResult {
  ids: string[];
  /** OpenRouter-style rates when the list included `pricing.prompt` / `pricing.completion`. */
  rates: Record<string, ModelRate>;
}

function modelRows(raw: unknown): unknown[] {
  const rec = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(rec.data)) return rec.data;
  if (Array.isArray(rec.models)) return rec.models;
  return [];
}

function parseRateNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

/** Read OpenRouter `pricing` (USD per token) from one models-list row. */
export function parseModelPricing(row: unknown): ModelRate | undefined {
  if (!row || typeof row !== "object") return undefined;
  const pricing = (row as Record<string, unknown>).pricing;
  if (!pricing || typeof pricing !== "object") return undefined;
  const p = pricing as Record<string, unknown>;
  const prompt = parseRateNumber(p.prompt);
  const completion = parseRateNumber(p.completion);
  if (prompt === undefined || completion === undefined) return undefined;
  return { prompt, completion };
}

/**
 * Model ids and rates from a models-list response: OpenAI `{data:[{id}]}`,
 * Ollama `{models:[{name|model}]}`, OpenRouter rows with `pricing`, or a bare
 * array of ids/objects. Gemini's `models/` prefix is dropped.
 */
export function parseModelsDetailed(raw: unknown): ModelListResult {
  const ids = new Set<string>();
  const rates: Record<string, ModelRate> = {};
  for (const row of modelRows(raw)) {
    let id = "";
    if (typeof row === "string") id = row;
    else if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      id = String(r.id ?? r.name ?? r.model ?? "");
    }
    id = id.trim().replace(/^models\//, "");
    if (!id) continue;
    ids.add(id);
    const rate = parseModelPricing(row);
    if (rate) rates[id] = rate;
  }
  return { ids: [...ids].sort((a, b) => a.localeCompare(b)), rates };
}

/** Model ids only (see {@link parseModelsDetailed}). */
export function parseModelsResponse(raw: unknown): string[] {
  return parseModelsDetailed(raw).ids;
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
): Promise<ModelListResult> {
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
  const detailed = parseModelsDetailed(body);
  if (!detailed.ids.length) {
    throw new ModelListError("empty", `${modelsUrl} listed no models`);
  }
  return detailed;
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
