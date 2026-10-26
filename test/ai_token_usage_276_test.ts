/**
 * #276: token use per request and turn, the runaway step guard, the optional
 * token budget, and the context window for the ring.
 */
import { assert, assertEquals } from "@std/assert";
import { type ChatMessage, postChatCompletions } from "@intehrgrator/core/ai/credentials.ts";
import {
  DEFAULT_MAX_STEPS,
  type MappingAgentEvent,
  runMappingAgent,
  runSuggestionsChatTurn,
} from "@intehrgrator/core/ai/mapping_agent.ts";
import {
  addUsage,
  AI_CHAT_LIMITS_KEY,
  budgetState,
  contextWindowFor,
  emptyUsageTotals,
  formatTokens,
  loadAiChatLimits,
  mergeUsageTotals,
  parseProviderUsage,
  parseTokenCount,
  saveAiChatLimits,
} from "@intehrgrator/core/ai/token_usage.ts";
import {
  CHAT_HISTORY_MAX_TOKENS,
  emptyChatSession,
  historyTokenLimit,
  loadChatSession,
  saveChatSession,
} from "@intehrgrator/core/ai/chat_history.ts";

const creds = { endpoint: "https://api.example/v1/chat/completions", apiKey: "sk-test", model: "m" };

function sse(chunks: unknown[]): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** A provider that answers each request with the next scripted JSON body. */
function scripted(bodies: Array<Record<string, unknown>>, sent: Array<Record<string, unknown>> = []): typeof fetch {
  let i = 0;
  return ((_u: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
}

const toolCall = (id: string, usage?: Record<string, unknown>) => ({
  choices: [{
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ id, type: "function", function: { name: "list_slots", arguments: "{}" } }],
    },
    finish_reason: "tool_calls",
  }],
  ...(usage ? { usage } : {}),
});
const answer = (text: string, usage?: Record<string, unknown>) => ({
  choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
  ...(usage ? { usage } : {}),
});

Deno.test("parseProviderUsage reads OpenAI, Anthropic and OpenRouter usage (#276)", () => {
  assertEquals(
    parseProviderUsage({ prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1024 } }),
    { input: 1200, output: 80, cachedInput: 1024 },
  );
  // Anthropic counts cache reads / writes next to input_tokens.
  assertEquals(
    parseProviderUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 90 }),
    { input: 1000, output: 5, cachedInput: 900 },
  );
  assertEquals(parseProviderUsage({ prompt_tokens: 10, completion_tokens: 2, cost: 0.0004 }), {
    input: 10,
    output: 2,
    cost: 0.0004,
  });
  assertEquals(parseProviderUsage({ total_tokens: 5 }), undefined);
  assertEquals(parseProviderUsage(null), undefined);
});

Deno.test("streaming asks for include_usage and reads the final usage chunk without choices (#276)", async () => {
  let body: Record<string, unknown> = {};
  const result = await postChatCompletions(creds, [{ role: "user", content: "hi" }], {
    onDelta: () => {},
    fetch: ((_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Promise.resolve(sse([
        { choices: [{ index: 0, delta: { content: "Hello" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 321, completion_tokens: 7 } },
      ]));
    }) as typeof fetch,
  });
  assertEquals(body.stream_options, { include_usage: true });
  assertEquals(result.text, "Hello");
  assertEquals(result.usage, { input: 321, output: 7 });
});

Deno.test("a 400 about stream_options retries streaming without it (#276)", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const result = await postChatCompletions(creds, [{ role: "user", content: "hi" }], {
    onDelta: () => {},
    fetch: ((_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.stream_options) {
        return Promise.resolve(new Response('{"error":"Unrecognized request argument: stream_options"}', { status: 400 }));
      }
      return Promise.resolve(sse([{ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }]));
    }) as typeof fetch,
  });
  assertEquals(bodies.length, 2);
  assertEquals(bodies[1]!.stream, true);
  assertEquals(bodies[1]!.stream_options, undefined);
  assertEquals(result.text, "ok");
  assertEquals(result.usage, undefined);
});

Deno.test("runMappingAgent reports usage after each step and totals for the turn (#276)", async () => {
  const events: MappingAgentEvent[] = [];
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map",
    fetch: scripted([
      toolCall("c1", { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } }),
      answer("Done.", { prompt_tokens: 1500, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } }),
    ]),
    executeTool: () => Promise.resolve({ slots: [] }),
    onEvent: (e) => events.push(e),
  });
  const usage = events.filter((e) => e.type === "usage");
  assertEquals(usage.length, 2);
  assertEquals(usage[0]!.type === "usage" && usage[0]!.turn.input, 1000);
  assertEquals(result.usage.input, 2500);
  assertEquals(result.usage.output, 50);
  assertEquals(result.usage.cachedInput, 1000);
  assertEquals(result.usage.requests, 2);
  assertEquals(result.usage.lastContext, 1530);
  assertEquals(result.usage.estimated, false);
});

Deno.test("without provider usage the turn is estimated and marked as such (#276)", async () => {
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map " + "x".repeat(3000),
    fetch: scripted([answer("Done.")]),
    executeTool: () => Promise.resolve({}),
  });
  assert(result.usage.estimated);
  assert(result.usage.input >= 1000, `estimate ${result.usage.input}`);
  assertEquals(result.usage.requests, 1);
});

Deno.test("the step limit is only a runaway guard (#276)", async () => {
  assertEquals(DEFAULT_MAX_STEPS, 100);
  // Twenty tool steps (more than the old limit of 16) finish normally.
  const bodies = Array.from({ length: 20 }, (_, i) => toolCall(`c${i}`));
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map",
    fetch: scripted([...bodies, answer("All mapped.")]),
    executeTool: () => Promise.resolve({ ok: true }),
  });
  assertEquals(result.stepLimitReached, undefined);
  assertEquals(result.steps, 21);
  assertEquals(result.text, "All mapped.");
});

Deno.test("tokenBudget pauses the turn after the request that reached it, with every tool call answered (#276)", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const ran: string[] = [];
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map",
    tokenBudget: 2500,
    fetch: scripted([
      toolCall("c1", { prompt_tokens: 1000, completion_tokens: 10 }),
      toolCall("c2", { prompt_tokens: 1600, completion_tokens: 10 }),
      toolCall("c3", { prompt_tokens: 2200, completion_tokens: 10 }),
    ], sent),
    executeTool: (name) => {
      ran.push(name);
      return Promise.resolve({ ok: true });
    },
  });
  assertEquals(result.budgetReached, true);
  assertEquals(result.stepLimitReached, undefined);
  assertEquals(sent.length, 2);
  assertEquals(ran.length, 2);
  assertEquals(result.usage.input + result.usage.output, 2620);
  // The stored conversation stays valid: the last assistant tool call has its result.
  const last = result.messages[result.messages.length - 1] as ChatMessage;
  assertEquals(last.role, "tool");
  assertEquals(last.tool_call_id, "c2");
});

Deno.test("the suggestions fallback turn reports usage too (#276)", async () => {
  const result = await runSuggestionsChatTurn({
    credentials: creds,
    prompt: "map",
    fetch: scripted([answer("```intehrgrator-suggestions\n{}\n```", { prompt_tokens: 40, completion_tokens: 9 })]),
  });
  assertEquals(result.usage.input, 40);
  assertEquals(result.usage.output, 9);
});

Deno.test("usage totals add up and merge into the chat (#276)", () => {
  const turn = addUsage(addUsage(emptyUsageTotals(), { input: 100, output: 10, cost: 0.01 }), {
    input: 200,
    output: 20,
    cachedInput: 100,
    estimated: true,
  });
  assertEquals(turn, { input: 300, output: 30, cachedInput: 100, cost: 0.01, requests: 2, estimated: true, lastContext: 220 });
  const chat = mergeUsageTotals(turn, addUsage(emptyUsageTotals(), { input: 500, output: 5 }));
  assertEquals(chat.input, 800);
  assertEquals(chat.requests, 3);
  assertEquals(chat.lastContext, 505);
  assertEquals(chat.cost, 0.01);
  // An empty turn keeps the context of the last real request.
  assertEquals(mergeUsageTotals(chat, emptyUsageTotals()).lastContext, 505);
});

Deno.test("budgetState warns at 80 % and is over at 100 % (#276)", () => {
  assertEquals(budgetState(500, undefined), "none");
  assertEquals(budgetState(799, 1000), "ok");
  assertEquals(budgetState(800, 1000), "warn");
  assertEquals(budgetState(1000, 1000), "over");
});

Deno.test("contextWindowFor knows common models, prefers the user's value, else undefined (#276)", () => {
  assertEquals(contextWindowFor("gpt-4o-mini"), 128_000);
  assertEquals(contextWindowFor("gpt-4.1"), 1_047_576);
  assertEquals(contextWindowFor("anthropic/claude-sonnet-4.5"), 200_000);
  assertEquals(contextWindowFor("gemini-3-pro-preview"), 1_048_576);
  assertEquals(contextWindowFor("o3-mini"), 200_000);
  assertEquals(contextWindowFor("my-local-model"), undefined);
  assertEquals(contextWindowFor("my-local-model", 32_000), 32_000);
  assertEquals(contextWindowFor("gpt-4o", 64_000), 64_000);
});

Deno.test("history is trimmed relative to a known context window (#276)", () => {
  assertEquals(historyTokenLimit(undefined), CHAT_HISTORY_MAX_TOKENS);
  assertEquals(historyTokenLimit(32_000), CHAT_HISTORY_MAX_TOKENS);
  assertEquals(historyTokenLimit(1_000_000), 500_000);
});

Deno.test("chat usage is stored with the chat session; limits are stored per browser (#276)", () => {
  const storage = memoryStorage();
  const session = { ...emptyChatSession(), usage: addUsage(emptyUsageTotals(), { input: 10, output: 2 }), budgetWarned: true };
  saveChatSession(storage, "p1", session);
  const loaded = loadChatSession(storage, "p1");
  assertEquals(loaded.usage?.input, 10);
  assertEquals(loaded.budgetWarned, true);
  assertEquals(loadChatSession(storage, "p2").usage, undefined);

  saveAiChatLimits(storage, { budget: 2_000_000, contextWindows: { "local-llm": 32_000 } });
  assert(storage.getItem(AI_CHAT_LIMITS_KEY));
  assertEquals(loadAiChatLimits(storage), { budget: 2_000_000, contextWindows: { "local-llm": 32_000 } });
  storage.setItem(AI_CHAT_LIMITS_KEY, "{broken");
  assertEquals(loadAiChatLimits(storage), { contextWindows: {} });
});

Deno.test("formatTokens / parseTokenCount (#276)", () => {
  assertEquals(formatTokens(950), "950");
  assertEquals(formatTokens(1234), "1.2k");
  assertEquals(formatTokens(45_600), "46k");
  assertEquals(formatTokens(1_050_000), "1.05M");
  assertEquals(formatTokens(2_000_000), "2M");
  assertEquals(parseTokenCount("200k"), 200_000);
  assertEquals(parseTokenCount("1.5M"), 1_500_000);
  assertEquals(parseTokenCount("64 000"), 64_000);
  assertEquals(parseTokenCount(""), undefined);
  assertEquals(parseTokenCount("lots"), undefined);
});
