/**
 * Token use of AI chat calls (#276): what the provider reports per request,
 * running totals per turn and per chat, an optional token budget, and the
 * model's context window for the ring next to Stop.
 *
 * Chat Completions is stateless: every step resends the whole conversation,
 * so `input` grows with the chat. Providers with prompt caching bill the
 * repeated prefix cheaper (`cachedInput`), but it still counts against the
 * context window.
 */

/** Usage of one request, as the provider reported it (or estimated). */
export interface TokenUsage {
  /** Prompt / input tokens (whole conversation sent this step). */
  input: number;
  /** Completion / output tokens (including reasoning tokens when the provider counts them there). */
  output: number;
  /** Part of `input` the provider served from its prompt cache. */
  cachedInput?: number;
  /** Cost in USD when the provider reports one (OpenRouter `usage.cost`). */
  cost?: number;
  /** True when the provider gave no usage and the numbers are a characters / 3 estimate. */
  estimated?: boolean;
}

/** Running totals over several requests (one turn, or the whole chat). */
export interface UsageTotals {
  input: number;
  output: number;
  cachedInput: number;
  /** Sum of reported costs; undefined when no request reported a cost. */
  cost?: number;
  /** Requests (tool-loop steps) counted. */
  requests: number;
  /** At least one request was estimated. */
  estimated: boolean;
  /**
   * Context used by the newest request: its input plus output tokens. That is
   * what the model held in its context window at the end of the last step.
   */
  lastContext: number;
}

export function emptyUsageTotals(): UsageTotals {
  return { input: 0, output: 0, cachedInput: 0, requests: 0, estimated: false, lastContext: 0 };
}

export function addUsage(totals: UsageTotals, usage: TokenUsage): UsageTotals {
  const cost = usage.cost !== undefined ? (totals.cost ?? 0) + usage.cost : totals.cost;
  return {
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cachedInput: totals.cachedInput + (usage.cachedInput ?? 0),
    ...(cost !== undefined ? { cost } : {}),
    requests: totals.requests + 1,
    estimated: totals.estimated || Boolean(usage.estimated),
    lastContext: usage.input + usage.output,
  };
}

/** Add two totals (a finished turn into the chat). `lastContext` comes from `b` when it made requests. */
export function mergeUsageTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  const cost = a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cachedInput: a.cachedInput + b.cachedInput,
    ...(cost !== undefined ? { cost } : {}),
    requests: a.requests + b.requests,
    estimated: a.estimated || b.estimated,
    lastContext: b.requests ? b.lastContext : a.lastContext,
  };
}

/** Tokens that count against the budget: everything sent and received (cached input included). */
export function totalTokens(totals: Pick<UsageTotals, "input" | "output">): number {
  return totals.input + totals.output;
}

export function parseUsageTotals(raw: unknown): UsageTotals | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    input: n(r.input),
    output: n(r.output),
    cachedInput: n(r.cachedInput),
    ...(typeof r.cost === "number" && Number.isFinite(r.cost) ? { cost: r.cost } : {}),
    requests: n(r.requests),
    estimated: r.estimated === true,
    lastContext: n(r.lastContext),
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Read a provider `usage` object: OpenAI-compatible
 * (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`),
 * Anthropic (`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
 * `cache_creation_input_tokens`) and OpenRouter's `cost`. Undefined when
 * neither input nor output is present.
 */
export function parseProviderUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as Record<string, unknown> | undefined;
  const openAiIn = num(u.prompt_tokens);
  const openAiOut = num(u.completion_tokens);
  // Anthropic reports cache reads / writes next to (not inside) input_tokens.
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  const anthropicIn = num(u.input_tokens);
  const input = openAiIn ?? (anthropicIn !== undefined ? anthropicIn + (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const output = openAiOut ?? num(u.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  const cached = num(details?.cached_tokens) ?? cacheRead;
  const cost = num(u.cost);
  return {
    input: input ?? 0,
    output: output ?? 0,
    ...(cached ? { cachedInput: cached } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/** About 3 characters per token for this JSON-heavy chat (o200k_base), as `estimateChatTokens`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Known context windows (tokens) by model id pattern, first match wins. Only
 * families with a published fixed window; anything else needs the user's
 * value, otherwise the ring is hidden. Checked 2026-10.
 */
export const KNOWN_CONTEXT_WINDOWS: ReadonlyArray<{ pattern: RegExp; tokens: number }> = [
  { pattern: /gpt-4\.1/i, tokens: 1_047_576 },
  { pattern: /gpt-5/i, tokens: 400_000 },
  { pattern: /gpt-4o|gpt-4-turbo/i, tokens: 128_000 },
  { pattern: /(^|\/)o[134](-mini|-pro)?\b/i, tokens: 200_000 },
  { pattern: /claude/i, tokens: 200_000 },
  { pattern: /gemini-(1\.5|2\.\d|3)/i, tokens: 1_048_576 },
  { pattern: /deepseek/i, tokens: 128_000 },
  { pattern: /mistral-large|mistral-medium|codestral/i, tokens: 128_000 },
  { pattern: /llama-?3\.[1-3]/i, tokens: 128_000 },
  { pattern: /grok-4/i, tokens: 256_000 },
];

/** Context window for a model: the user's value first, else the known table, else undefined. */
export function contextWindowFor(model: string, override?: number): number | undefined {
  if (override && override > 0) return override;
  const id = model.trim();
  if (!id) return undefined;
  return KNOWN_CONTEXT_WINDOWS.find((row) => row.pattern.test(id))?.tokens;
}

/** Warn from this share of the budget (#276: warn at 80 %, pause at 100 %). */
export const BUDGET_WARN_SHARE = 0.8;

export type BudgetState = "none" | "ok" | "warn" | "over";

export function budgetState(used: number, budget: number | undefined): BudgetState {
  if (!budget || budget <= 0) return "none";
  if (used >= budget) return "over";
  if (used >= budget * BUDGET_WARN_SHARE) return "warn";
  return "ok";
}

/** Short token count: 950, 12.3k, 1.05M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

/** Parse "200k", "1.5M", "64000" (spaces / underscores allowed). Undefined for empty or invalid. */
export function parseTokenCount(text: string): number | undefined {
  const m = text.trim().replace(/[\s_,]/g, "").match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!m) return undefined;
  const scale = m[2]!.toLowerCase() === "k" ? 1000 : m[2]!.toLowerCase() === "m" ? 1_000_000 : 1;
  const value = Math.round(Number(m[1]) * scale);
  return value > 0 ? value : undefined;
}

/** Host localStorage key for the chat's token budget and context-window overrides. */
export const AI_CHAT_LIMITS_KEY = "intehrgrator.ai.chatLimits";

export interface AiChatLimits {
  /** Token budget per chat (input + output, until Clear history). Undefined = no budget. */
  budget?: number;
  /** Context window per model id, set by the user. */
  contextWindows: Record<string, number>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadAiChatLimits(storage: StorageLike): AiChatLimits {
  try {
    const raw = JSON.parse(storage.getItem(AI_CHAT_LIMITS_KEY) ?? "null") as Record<string, unknown> | null;
    const budget = num(raw?.budget);
    const windows: Record<string, number> = {};
    const rawWindows = raw?.contextWindows;
    if (rawWindows && typeof rawWindows === "object") {
      for (const [model, value] of Object.entries(rawWindows as Record<string, unknown>)) {
        const n = num(value);
        if (model && n) windows[model] = n;
      }
    }
    return { ...(budget ? { budget } : {}), contextWindows: windows };
  } catch {
    return { contextWindows: {} };
  }
}

export function saveAiChatLimits(storage: StorageLike, limits: AiChatLimits): void {
  try {
    storage.setItem(AI_CHAT_LIMITS_KEY, JSON.stringify(limits));
  } catch {
    // quota / private mode
  }
}
