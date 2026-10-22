import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  AI_CREDENTIALS_STORAGE_KEY,
  callChatCompletions,
  clearAiCredentials,
  forwardChatCompletionsProxy,
  hasAiCredentials,
  loadAiCredentials,
  parseAiCredentials,
  providerAuthHeaders,
  saveAiCredentials,
} from "@intehrgrator/core/ai/credentials.ts";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem(key: string) {
      return Object.hasOwn(data, key) ? data[key]! : null;
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

Deno.test("parseAiCredentials requires endpoint, key, and model", () => {
  assertEquals(parseAiCredentials({ endpoint: "https://api.example/v1/chat/completions" }), null);
  assertEquals(
    parseAiCredentials({
      endpoint: "https://api.example/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-4.1",
    }),
    {
      endpoint: "https://api.example/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-4.1",
    },
  );
});

Deno.test("save and load round-trip in Host storage, never a Project Bundle key", () => {
  const storage = memoryStorage();
  saveAiCredentials(storage, {
    endpoint: "http://127.0.0.1:8080/v1/chat/completions",
    apiKey: "local",
    model: "test-model",
  });
  assertEquals(hasAiCredentials(storage), true);
  assertEquals(loadAiCredentials(storage)?.model, "test-model");
  assertEquals(storage.getItem(AI_CREDENTIALS_STORAGE_KEY)?.includes("local"), true);
  clearAiCredentials(storage);
  assertEquals(hasAiCredentials(storage), false);
});

Deno.test("saveAiCredentials rejects incomplete records", () => {
  const storage = memoryStorage();
  assertThrows(() =>
    saveAiCredentials(storage, { endpoint: "not-a-url", apiKey: "x", model: "m" })
  );
});

Deno.test("callChatCompletions posts Bearer auth and reads choice text", async () => {
  const result = await callChatCompletions(
    {
      endpoint: "https://api.example/v1/chat/completions",
      apiKey: "sk-secret",
      model: "gpt-4.1",
    },
    "map systolic",
    {
      fetch: (async (input, init) => {
        assertEquals(String(input), "https://api.example/v1/chat/completions");
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("authorization"), "Bearer sk-secret");
        const body = JSON.parse(String(init?.body));
        assertEquals(body.model, "gpt-4.1");
        assertEquals(body.messages[1].content, "map systolic");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"format":"intehrgrator-suggestions"}\n```' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    },
  );
  assertEquals(result.text.includes("intehrgrator-suggestions"), true);
});

Deno.test("forwardChatCompletionsProxy posts Bearer to the provider URL", async () => {
  const res = await forwardChatCompletionsProxy(
    {
      endpoint: "https://api.example/v1/chat/completions",
      apiKey: "sk-proxy",
      body: { model: "m", messages: [] },
    },
    {
      fetch: (async (input, init) => {
        assertEquals(String(input), "https://api.example/v1/chat/completions");
        assertEquals(new Headers(init?.headers).get("authorization"), "Bearer sk-proxy");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    },
  );
  assertEquals(res.status, 200);
  assertEquals(JSON.parse(await res.text()).ok, true);
});

Deno.test("Anthropic endpoints send Bearer and x-api-key", async () => {
  assertEquals(
    providerAuthHeaders("https://api.anthropic.com/v1/chat/completions", "sk-ant"),
    { authorization: "Bearer sk-ant", "x-api-key": "sk-ant" },
  );
  const res = await forwardChatCompletionsProxy(
    {
      endpoint: "https://api.anthropic.com/v1/chat/completions",
      apiKey: "sk-ant",
      body: { model: "claude-sonnet-4-6", messages: [] },
    },
    {
      fetch: (async (_input, init) => {
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("authorization"), "Bearer sk-ant");
        assertEquals(headers.get("x-api-key"), "sk-ant");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    },
  );
  assertEquals(res.status, 200);
});

Deno.test("callChatCompletions surfaces HTTP errors", async () => {
  await assertRejects(
    () =>
      callChatCompletions(
        {
          endpoint: "https://api.example/v1/chat/completions",
          apiKey: "sk",
          model: "m",
        },
        "hi",
        {
          fetch: (async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as typeof fetch,
        },
      ),
    Error,
    "401",
  );
});
