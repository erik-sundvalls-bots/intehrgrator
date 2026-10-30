/**
 * #277 §6: explicit prompt caching where a provider needs it. Claude models
 * through OpenRouter get Anthropic's automatic caching (top-level
 * `cache_control`), which caches the stable system prefix and the growing
 * conversation in a tool loop. Other providers cache stable prefixes by
 * themselves (OpenAI, Gemini, DeepSeek …) or not at all through the
 * OpenAI-compatible API (Anthropic's own endpoint), so their requests are unchanged.
 */
import { assertEquals } from "@std/assert";
import { postChatCompletions } from "@intehrgrator/core/ai/credentials.ts";
import { promptCacheFields } from "@intehrgrator/core/ai/prompt_cache.ts";

async function sentBody(endpoint: string, model: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  await postChatCompletions({ endpoint, model, apiKey: "test-key" }, [
    { role: "system", content: "stable" },
    { role: "user", content: "hi" },
  ], {
    fetch: ((_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }) as typeof fetch,
  });
  return body;
}

Deno.test("promptCacheFields: Claude on OpenRouter gets automatic cache_control, others nothing", () => {
  const or = "https://openrouter.ai/api/v1/chat/completions";
  assertEquals(promptCacheFields(or, "anthropic/claude-sonnet-4.5"), { cache_control: { type: "ephemeral" } });
  assertEquals(promptCacheFields(or, "~anthropic/claude-sonnet-latest"), { cache_control: { type: "ephemeral" } });
  assertEquals(promptCacheFields(or, "openai/gpt-4o"), {});
  assertEquals(promptCacheFields(or, "google/gemini-2.5-pro"), {});
  assertEquals(promptCacheFields("https://api.anthropic.com/v1/chat/completions", "claude-sonnet-4-5"), {});
  assertEquals(promptCacheFields("https://api.openai.com/v1/chat/completions", "gpt-4o"), {});
  assertEquals(promptCacheFields("not a url", "anthropic/claude"), {});
});

Deno.test("postChatCompletions sends cache_control only for Claude via OpenRouter", async () => {
  const claude = await sentBody("https://openrouter.ai/api/v1/chat/completions", "anthropic/claude-sonnet-4.5");
  assertEquals(claude.cache_control, { type: "ephemeral" });
  assertEquals((claude.messages as unknown[]).length, 2, "messages unchanged");
  const gpt = await sentBody("https://api.openai.com/v1/chat/completions", "gpt-4o");
  assertEquals("cache_control" in gpt, false);
});
