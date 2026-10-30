/**
 * Request fields that turn on prompt caching where a provider needs to be
 * asked (#277 §6). The prompt is laid out with a stable, project-free prefix
 * first (system message), so a cache hit covers it across projects and the
 * growing conversation within a chat.
 *
 * - Claude through OpenRouter: Anthropic's automatic caching, a top-level
 *   `cache_control`; the breakpoint moves to the end of each request, so each
 *   tool step reads the previous one from the cache (writes cost 1.25×, reads 0.1×).
 * - OpenAI, Gemini, DeepSeek, Grok …: cache stable prefixes by themselves.
 * - Anthropic's own OpenAI-compatible endpoint: does not support caching.
 */
export function promptCacheFields(endpoint: string, model: string): Record<string, unknown> {
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return {};
  }
  const openRouter = host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  if (openRouter && /^~?anthropic\//i.test(model.trim())) {
    return { cache_control: { type: "ephemeral" } };
  }
  return {};
}
