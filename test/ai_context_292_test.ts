/** #292: no mapping context is dropped without a marker or the user's choice. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { compactToolHistory } from "@intehrgrator/core/ai/mapping_agent.ts";
import type { ChatMessage } from "@intehrgrator/core/ai/credentials.ts";
import {
  chatHistoryKey,
  chatRecap,
  emptyChatSession,
  loadChatSession,
  saveChatSession,
} from "@intehrgrator/core/ai/chat_history.ts";
import { compactSourceTree } from "../src/agent/inspect.ts";
import { jsonSchemaSlotInfo } from "@intehrgrator/core/ai/slot_info.ts";
import { buildPrompt } from "@intehrgrator/core/ai/mod.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import type { SchemaTreeNode, SkeletonNode } from "@intehrgrator/types/mod.ts";

const big = (tag: string) => JSON.stringify({ body: tag + "x".repeat(3000) });
const call = (id: string, name: string, args: string): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, function: { name, arguments: args } }],
});

Deno.test("compactToolHistory keeps results of the same tool with other arguments (#292 c)", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "map" },
    call("1", "get_example", '{"id":"a"}'),
    { role: "tool", name: "get_example", tool_call_id: "1", content: big("A") },
    call("2", "get_example", '{"id":"b"}'),
    { role: "tool", name: "get_example", tool_call_id: "2", content: big("B") },
    call("3", "get_example", '{ "id": "a" }'),
    { role: "tool", name: "get_example", tool_call_id: "3", content: big("A") },
  ];
  const out = compactToolHistory(messages);
  assertStringIncludes(String(out[2]!.content), "superseded", "same arguments as a newer call");
  assertEquals(out[4]!.content, big("B"), "example b is another result, not an older copy");
  assertEquals(out[6]!.content, big("A"));
});

Deno.test("compactSourceTree marks children it leaves out instead of cutting silently (#292 d)", () => {
  const chain = (depth: number): SchemaTreeNode => ({
    path: `$.n${depth}`,
    name: `n${depth}`,
    type: "object",
    children: depth < 70 ? [chain(depth + 1)] : [],
  });
  let node = compactSourceTree(chain(0));
  let depth = 0;
  while (node?.children?.length) {
    node = node.children[0]!;
    depth++;
  }
  assertEquals(depth, 64, "default depth is 64 (was 8)");
  assertEquals(node?.childrenOmitted, 1);
  assertEquals(compactSourceTree(chain(69))?.childrenOmitted, undefined);
});

Deno.test("saveChatSession cuts only the stored copy and says so (#292 b)", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const session = emptyChatSession();
  for (let i = 0; i < 6; i++) {
    session.messages.push({ role: "user", content: `q${i} ${"y".repeat(100_000)}` }, { role: "assistant", content: `a${i}` });
  }
  const before = session.messages.length;
  const { trimmed, stored } = saveChatSession(storage, "p", session);
  assertEquals(trimmed, true);
  assertEquals(session.messages.length, before, "the live session is untouched");
  assertEquals(stored.messages.length < before, true);
  assertEquals(JSON.parse(data.get(chatHistoryKey("p"))!).messages.length, stored.messages.length);
  assertEquals(saveChatSession(storage, "q", emptyChatSession()).trimmed, false);
  session.storageTrimNoted = true;
  saveChatSession(storage, "p", session);
  assertEquals(loadChatSession(storage, "p").storageTrimNoted, true);
});

Deno.test("chatRecap lists user messages, answers and mappings, not notes (#292 a)", () => {
  const session = emptyChatSession();
  session.display.push(
    { role: "user", text: "Map the vitals" },
    { role: "assistant", text: "Done.", mappings: ["Mapped Systolic ← $.sys"] },
    { role: "note", text: "Prompt copied." },
  );
  assertEquals(chatRecap(session), "User: Map the vitals\n\nAssistant: Done.\n  - Mapped Systolic ← $.sys");
});

Deno.test("JSON Schema examples beyond the first 3 are counted (#292)", () => {
  const skeleton = [{ slotId: "t:$.a", label: "a", targetPath: "$.a", children: [] }] as unknown as SkeletonNode[];
  const schema = JSON.stringify({ type: "object", properties: { a: { type: "string", examples: [1, 2, 3, 4, 5] } } });
  const info = jsonSchemaSlotInfo(schema, skeleton).slots.get("t:$.a");
  assertEquals(info?.examples, [1, 2, 3]);
  assertEquals(info?.examplesOmitted, 2);
});

Deno.test("copy prompt says how many constraint warnings and sheet rows it leaves out (#292)", () => {
  const prompt = buildPrompt({
    scope: "full",
    targetId: "bp",
    targetFormat: "openehr-template",
    targetFilename: "bp.opt",
    skeleton: [],
    model: createEmptyModel("bp"),
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "attach",
    artifacts: [],
    constraintWarnings: Array.from({ length: 30 }, (_, i) => ({ slotId: `s${i}`, message: `Mandatory slot unmapped: ${i}` })),
    sheets: [{ name: "codes", headers: ["k", "v"], values: Array.from({ length: 12 }, (_, i) => [`k${i}`, `v${i}`]) }],
  });
  assertStringIncludes(prompt, "First 24 of 30 shown; 6 more not listed here.");
  assertStringIncludes(prompt, '"rowsOmitted":4');
});
