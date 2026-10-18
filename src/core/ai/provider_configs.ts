/**
 * Per-provider AI credentials remembered in Host localStorage (never in the
 * Project Bundle), so switching Provider in the AI credentials dialog restores
 * that provider's endpoint, key, model and last connection test. The active
 * provider stays in `intehrgrator.ai.credentials` (`loadAiCredentials`).
 */
import {
  AI_CREDENTIALS_STORAGE_KEY,
  loadAiCredentials,
} from "./credentials.ts";

export const AI_PROVIDER_CONFIGS_KEY = "intehrgrator.ai.providerConfigs";
/** Fetched model lists kept per provider (enough for big routers). */
export const MAX_STORED_MODELS = 1000;

export interface AiProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  /** Last "Connect & fetch models" result. */
  testedAt?: string;
  testOk?: boolean;
  testMessage?: string;
  /** Model ids from the last successful fetch. */
  models?: string[];
}

export type AiProviderConfigs = Record<string, AiProviderConfig>;

function parseConfig(raw: unknown): AiProviderConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const config: AiProviderConfig = {
    endpoint: String(r.endpoint ?? "").trim(),
    apiKey: String(r.apiKey ?? ""),
    model: String(r.model ?? "").trim(),
  };
  if (typeof r.testedAt === "string") config.testedAt = r.testedAt;
  if (typeof r.testOk === "boolean") config.testOk = r.testOk;
  if (typeof r.testMessage === "string") config.testMessage = r.testMessage;
  if (Array.isArray(r.models)) {
    config.models = r.models.filter((m): m is string => typeof m === "string")
      .slice(0, MAX_STORED_MODELS);
  }
  return config;
}

/**
 * Saved per-provider configs. First call after upgrade seeds the map from the
 * single active credential (migration), without touching that key.
 */
export function loadProviderConfigs(storage: Storage): AiProviderConfigs {
  let raw: string | null = null;
  try {
    raw = storage.getItem(AI_PROVIDER_CONFIGS_KEY);
  } catch {
    return {};
  }
  if (raw === null) {
    const active = loadAiCredentials(storage);
    if (!active) return {};
    const seeded: AiProviderConfigs = {
      [active.providerId || "custom"]: {
        endpoint: active.endpoint,
        apiKey: active.apiKey,
        model: active.model,
      },
    };
    saveProviderConfigs(storage, seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: AiProviderConfigs = {};
    for (
      const [id, value] of Object.entries(parsed as Record<string, unknown>)
    ) {
      const config = parseConfig(value);
      if (id && config) out[id] = config;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveProviderConfigs(
  storage: Storage,
  configs: AiProviderConfigs,
): void {
  try {
    storage.setItem(AI_PROVIDER_CONFIGS_KEY, JSON.stringify(configs));
  } catch {
    // quota / private mode
  }
}

export function upsertProviderConfig(
  storage: Storage,
  providerId: string,
  config: AiProviderConfig,
): AiProviderConfigs {
  const configs = loadProviderConfigs(storage);
  const clean = parseConfig(config);
  if (clean) configs[providerId] = clean;
  saveProviderConfigs(storage, configs);
  return configs;
}

export { REDACTED_KEY, redactSecret } from "./redact.ts";

/**
 * "Forget key for this provider": remove the provider's API key from credential
 * storage only — its saved config, any other saved config holding the same key
 * string (migrated copies), and the active / legacy single credential
 * (`intehrgrator.ai.credentials`). Endpoint and model are kept; chat history and
 * stored prompts are untouched (they never contain the key). Returns the key
 * strings forgotten so callers can drop in-memory copies.
 */
export function forgetProviderKey(
  storage: Storage,
  providerId: string,
  alsoForget: string[] = [],
): string[] {
  const configs = loadProviderConfigs(storage);
  const secrets = new Set<string>();
  const own = configs[providerId]?.apiKey.trim();
  if (own) secrets.add(own);
  for (const extra of alsoForget) if (extra.trim()) secrets.add(extra.trim());
  const active = loadAiCredentials(storage);
  if (
    active &&
    ((active.providerId || "custom") === providerId ||
      secrets.has(active.apiKey.trim()))
  ) {
    secrets.add(active.apiKey.trim());
  }
  // Raw check as well: an unparsable / partial legacy entry may still hold the key.
  try {
    const raw = storage.getItem(AI_CREDENTIALS_STORAGE_KEY) ?? "";
    if (
      (active && (active.providerId || "custom") === providerId) ||
      [...secrets].some((k) => raw.includes(k))
    ) {
      storage.removeItem(AI_CREDENTIALS_STORAGE_KEY);
    }
  } catch {
    // private mode
  }
  for (const [id, config] of Object.entries(configs)) {
    if (id !== providerId && !secrets.has(config.apiKey.trim())) continue;
    configs[id] = {
      endpoint: config.endpoint,
      apiKey: "",
      model: config.model,
      ...(config.models ? { models: config.models } : {}),
    };
  }
  saveProviderConfigs(storage, configs);
  return [...secrets];
}

/** "Clear all": every provider's saved settings and the active credential. */
export function clearAllProviderConfigs(storage: Storage): void {
  storage.removeItem(AI_CREDENTIALS_STORAGE_KEY);
  // An empty map (not a missing one) keeps the migration from re-seeding.
  saveProviderConfigs(storage, {});
}

/** Provider dropdown label: ✓ once a connection test for it succeeded. */
export function providerOptionLabel(
  label: string,
  config: AiProviderConfig | undefined,
): string {
  return config?.testOk ? `✓ ${label}` : label;
}
