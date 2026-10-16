import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  chatHistoryKey,
  clearChatSession,
  emptyChatSession,
  loadChatSession,
  saveChatSession,
  trimChatSession,
} from "@intehrgrator/core/ai/chat_history.ts";
import { runMappingAgent } from "@intehrgrator/core/ai/mapping_agent.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

Deno.test("chat history is stored per project and clearable", () => {
  const storage = memoryStorage();
  const a = emptyChatSession();
  a.messages.push({ role: "user", content: "hi" });
  a.display.push({ role: "user", text: "hi" });
  a.contextSent = true;
  saveChatSession(storage, "project-a", a);
  assertEquals(loadChatSession(storage, "project-a").messages.length, 1);
  assertEquals(loadChatSession(storage, "project-a").contextSent, true);
  assertEquals(loadChatSession(storage, "project-b").messages.length, 0);
  clearChatSession(storage, "project-a");
  assertEquals(storage.map.has(chatHistoryKey("project-a")), false);
  assertEquals(loadChatSession(storage, "project-a").contextSent, false);
});

Deno.test("chat history trims whole oldest turns and re-sends context", () => {
  const session = emptyChatSession();
  session.contextSent = true;
  session.attachedChipKeys = ["x"];
  session.messages = [
    { role: "user", content: "a".repeat(500) },
    { role: "assistant", content: "ok" },
    { role: "user", content: "b" },
    { role: "assistant", content: "ok" },
  ];
  const trimmed = trimChatSession(session, 200);
  assertEquals(trimmed.messages.map((m) => m.content), ["b", "ok"]);
  assertEquals(trimmed.contextSent, false);
  assertEquals(trimmed.attachedChipKeys, []);
});

const creds = { endpoint: "https://ai.example/v1/chat/completions", apiKey: "k", model: "m" };

Deno.test("runMappingAgent continues a chat from history", async () => {
  const bodies: Array<{ messages: Array<{ role: string; content?: string }> }> = [];
  const fetchStub = ((_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: `answer ${bodies.length}` } }] }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const first = await runMappingAgent({
    credentials: creds,
    prompt: "first",
    executeTool: () => Promise.resolve({}),
    fetch: fetchStub,
  });
  assertEquals(first.messages.map((m) => m.role), ["user", "assistant"]);
  assertStringIncludes(String(first.messages[0]!.content), "Prefer the provided function tools");
  const second = await runMappingAgent({
    credentials: creds,
    prompt: "second",
    history: first.messages,
    executeTool: () => Promise.resolve({}),
    fetch: fetchStub,
  });
  const sent = bodies[1]!.messages;
  assertEquals(sent.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assertEquals(sent[3]!.content, "second");
  assertEquals(second.messages.length, 4);
  assertEquals(second.text, "answer 2");
});
