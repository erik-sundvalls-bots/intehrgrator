import { assert, assertEquals } from "@std/assert";
import {
  AI_CREDENTIALS_STORAGE_KEY,
  loadAiCredentials,
  postChatCompletions,
  saveAiCredentials,
} from "@intehrgrator/core/ai/credentials.ts";
import {
  AI_PROVIDER_CONFIGS_KEY,
  clearAllProviderConfigs,
  forgetProviderKey,
  loadProviderConfigs,
  providerOptionLabel,
  upsertProviderConfig,
} from "@intehrgrator/core/ai/provider_configs.ts";
import {
  chatHistoryKey,
  emptyChatSession,
  loadChatSession,
  saveChatSession,
} from "@intehrgrator/core/ai/chat_history.ts";
import {
  addUserPrompts,
  exportUserPrompts,
} from "@intehrgrator/core/ai/stored_prompts.ts";
import { runMappingAgent } from "@intehrgrator/core/ai/mapping_agent.ts";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data: Record<string, string> = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem: (key: string) => (Object.hasOwn(data, key) ? data[key]! : null),
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = String(value);
    },
  };
}

function allValues(storage: Storage): string {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    out.push(`${storage.key(i)}=${storage.getItem(storage.key(i)!)}`);
  }
  return out.join("\n");
}

const KEY = "sk-forget-me-0123456789";

Deno.test("legacy single credential migrates into per-provider configs", () => {
  const storage = memoryStorage();
  saveAiCredentials(storage, {
    endpoint: "https://opencode.ai/zen/v1/chat/completions",
    apiKey: "zen-key",
    model: "big-pickle",
    providerId: "opencode-zen",
  });
  const configs = loadProviderConfigs(storage);
  assertEquals(configs["opencode-zen"], {
    endpoint: "https://opencode.ai/zen/v1/chat/completions",
    apiKey: "zen-key",
    model: "big-pickle",
  });
  // Active credential untouched.
  assertEquals(loadAiCredentials(storage)?.providerId, "opencode-zen");
  // Without providerId the legacy entry lands under "custom".
  const legacy = memoryStorage({
    [AI_CREDENTIALS_STORAGE_KEY]: JSON.stringify({
      endpoint: "https://x.test/v1/chat/completions",
      apiKey: "k1",
      model: "m",
    }),
  });
  assertEquals(Object.keys(loadProviderConfigs(legacy)), ["custom"]);
});

Deno.test("multiple providers are remembered; ✓ marks tested ones", () => {
  const storage = memoryStorage({ [AI_PROVIDER_CONFIGS_KEY]: "{}" });
  upsertProviderConfig(storage, "openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "a",
    model: "gpt-4.1",
    testOk: true,
    testedAt: "2026-10-18T08:00:00Z",
    models: ["gpt-4.1"],
  });
  upsertProviderConfig(storage, "gemini", {
    endpoint: "https://g.test/v1beta/openai/chat/completions",
    apiKey: "b",
    model: "gemini-3.8-flash",
    testOk: false,
  });
  const configs = loadProviderConfigs(storage);
  assertEquals(Object.keys(configs).sort(), ["gemini", "openai"]);
  assertEquals(configs.openai!.models, ["gpt-4.1"]);
  assertEquals(providerOptionLabel("OpenAI", configs.openai), "✓ OpenAI");
  assertEquals(
    providerOptionLabel("Google Gemini", configs.gemini),
    "Google Gemini",
  );
  assertEquals(
    loadProviderConfigs(
      memoryStorage({ [AI_PROVIDER_CONFIGS_KEY]: "not json" }),
    ),
    {},
  );
});

Deno.test("forget key: no credential storage holds it; chat history and prompts stay intact", () => {
  const storage = memoryStorage();
  const session = memoryStorage({ unrelated: "x" });
  saveAiCredentials(storage, {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: KEY,
    model: "gpt-4.1",
    providerId: "openai",
  });
  upsertProviderConfig(storage, "openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: KEY,
    model: "gpt-4.1",
    testOk: true,
  });
  // A copy of the same key under another provider (e.g. migrated to custom).
  upsertProviderConfig(storage, "custom", {
    endpoint: "https://proxy.test/v1/chat/completions",
    apiKey: KEY,
    model: "gpt-4.1",
  });
  upsertProviderConfig(storage, "gemini", {
    endpoint: "https://g.test/v1beta/openai/chat/completions",
    apiKey: "other-gemini-key",
    model: "g",
  });
  const chat = { ...emptyChatSession(), contextSent: true };
  chat.messages.push({ role: "user", content: "Map systolic" }, {
    role: "assistant",
    content: "Done.",
  });
  saveChatSession(storage, "p1", chat);
  addUserPrompts(storage, [{ name: "Mine", text: "Map {source_node}" }]);
  const historyBefore = storage.getItem(chatHistoryKey("p1"));
  const promptsBefore = exportUserPrompts(storage);

  const forgotten = forgetProviderKey(storage, "openai");
  assertEquals(forgotten, [KEY]);
  assertEquals(allValues(storage).includes(KEY), false, allValues(storage));
  assertEquals(allValues(session).includes(KEY), false);
  assertEquals(storage.getItem(AI_CREDENTIALS_STORAGE_KEY), null);
  const configs = loadProviderConfigs(storage);
  assertEquals(configs.openai, {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4.1",
  });
  assertEquals(configs.custom!.apiKey, "");
  assertEquals(configs.gemini!.apiKey, "other-gemini-key");
  // Chat history and stored prompts untouched.
  assertEquals(storage.getItem(chatHistoryKey("p1")), historyBefore);
  assertEquals(loadChatSession(storage, "p1").messages.length, 2);
  assertEquals(exportUserPrompts(storage), promptsBefore);
});

Deno.test("forget key also covers an unsaved key typed in the dialog", () => {
  const storage = memoryStorage({ [AI_PROVIDER_CONFIGS_KEY]: "{}" });
  saveAiCredentials(storage, {
    endpoint: "https://x.test/v1/chat/completions",
    apiKey: KEY,
    model: "m",
    providerId: "custom",
  });
  forgetProviderKey(storage, "openai", [KEY]);
  assertEquals(allValues(storage).includes(KEY), false);
});

Deno.test("clear all removes every provider and the active credential", () => {
  const storage = memoryStorage();
  saveAiCredentials(storage, {
    endpoint: "https://x.test/v1/chat/completions",
    apiKey: KEY,
    model: "m",
    providerId: "custom",
  });
  upsertProviderConfig(storage, "openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "k2",
    model: "m",
  });
  clearAllProviderConfigs(storage);
  assertEquals(loadProviderConfigs(storage), {});
  assertEquals(loadAiCredentials(storage), null);
  assertEquals(allValues(storage).includes(KEY), false);
});

Deno.test("the API key never reaches chat messages, even when a provider echoes it", async () => {
  const creds = {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: KEY,
    model: "gpt-4.1",
  };
  const bodies: string[] = [];
  const ok = ((_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "hello",
    executeTool: () => Promise.resolve({}),
    fetch: ok,
  });
  assertEquals(JSON.stringify(result.messages).includes(KEY), false);
  assertEquals(
    bodies.join("").includes(KEY),
    false,
    "key only travels in the Authorization header",
  );
  const echo = (() =>
    Promise.resolve(
      new Response(`{"error":"Incorrect API key provided: ${KEY}"}`, {
        status: 401,
      }),
    )) as unknown as typeof fetch;
  let message = "";
  try {
    await postChatCompletions(creds, [{ role: "user", content: "x" }], {
      fetch: echo,
    });
  } catch (err) {
    message = (err as Error).message;
  }
  assert(message.includes("401"), message);
  assertEquals(message.includes(KEY), false, message);
});
