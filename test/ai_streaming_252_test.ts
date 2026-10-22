/**
 * #252 / #251: AI chat Send streams the tool loop, shows a notice per applied
 * mapping, stops on demand, keeps history small, and sends a compact `api`
 * context instead of file bodies.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  AI_CREDENTIALS_STORAGE_KEY,
  type ChatMessage,
  type ChatStreamDelta,
  forwardChatCompletionsProxy,
  loadAiCredentials,
  postChatCompletions,
} from "@intehrgrator/core/ai/credentials.ts";
import {
  compactToolHistory,
  type MappingAgentEvent,
  mappingNoticeFor,
  runMappingAgent,
} from "@intehrgrator/core/ai/mapping_agent.ts";
import { runChatTool } from "./support/chat_tools.ts";
import {
  emptyChatSession,
  estimateChatTokens,
  trimChatSessionToTokens,
} from "@intehrgrator/core/ai/chat_history.ts";
import { buildRefreshMergePrompt, REFRESH_MERGE_RAW_LIMIT_CHARS } from "@intehrgrator/core/target/refresh_diff.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";

const creds = { endpoint: "https://api.example/v1/chat/completions", apiKey: "sk-test", model: "m" };
const FIX = join(import.meta.dirname!, "fixtures");

function host(): HostAdapter {
  return {
    pickTextFile: () => Promise.resolve(null),
    pickTextFilesFromDirectory: () => Promise.resolve(null),
    pickBinaryFile: () => Promise.resolve(null),
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: () => Promise.resolve(),
    readClipboard: () => Promise.resolve(""),
    saveAutosave: () => Promise.resolve(),
    saveManualSave: () => Promise.resolve(),
    loadStoredProjectRecord: () => Promise.resolve(null),
    listLoadableProjects: () => Promise.resolve([]),
    resolveAppUrl: (p: string) => `https://example.test/${p}`,
    fetchTextUrl: () => Promise.reject(new Error("offline")),
  } as unknown as HostAdapter;
}

async function bpController(): Promise<WorkbenchController> {
  const c = new WorkbenchController(host());
  c.loadTemplateContent("blood_pressure.opt", await Deno.readTextFile(join(FIX, "blood_pressure.opt")));
  c.loadSchemaContent(
    "source.schema.json",
    await Deno.readTextFile(join(FIX, "dummy-json-vitals", "source.schema.json")),
  );
  c.addExampleContent("instance-1.json", await Deno.readTextFile(join(FIX, "dummy-json-vitals", "instance-1.json")));
  return c;
}

/** An SSE response built from chunk objects (each becomes one `data:` event). */
function sse(chunks: unknown[], split = 7): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  // Cut the bytes at odd places so events straddle reads.
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (let i = 0; i < bytes.length; i += split) ctrl.enqueue(bytes.slice(i, i + split));
      ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (d: Record<string, unknown>, finish?: string) => ({
  choices: [{ index: 0, delta: d, ...(finish ? { finish_reason: finish } : {}) }],
});

Deno.test("postChatCompletions streams text, reasoning and merged tool-call deltas with Gemini extra_content", async () => {
  const seen: ChatStreamDelta[] = [];
  let sentBody: Record<string, unknown> = {};
  const result = await postChatCompletions(creds, [{ role: "user", content: "hi" }], {
    tools: [{ type: "function", function: { name: "map_slot", description: "", parameters: {} } }],
    onDelta: (d) => seen.push(d),
    fetch: ((_u: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return Promise.resolve(sse([
        delta({ reasoning_content: "Look at " }),
        delta({ reasoning_content: "systolic." }),
        delta({ content: "Mapping " }),
        delta({ content: "now." }),
        delta({
          tool_calls: [{
            index: 0,
            id: "c1",
            function: { name: "map_slot", arguments: '{"slotId":' },
            extra_content: { google: { thought_signature: "SIG" } },
          }],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"s1","path":"$.a"}' } }] }),
        delta({}, "tool_calls"),
      ]));
    }) as typeof fetch,
  });
  assertEquals(sentBody.stream, true);
  assertEquals(result.text, "Mapping now.");
  assertEquals(result.toolCalls?.[0]?.name, "map_slot");
  assertEquals(JSON.parse(result.toolCalls![0]!.arguments), { slotId: "s1", path: "$.a" });
  assertEquals(result.toolCalls?.[0]?.extraContent, { google: { thought_signature: "SIG" } });
  assertEquals(
    (result.assistantMessage?.tool_calls?.[0] as { extra_content?: unknown }).extra_content,
    { google: { thought_signature: "SIG" } },
  );
  assertEquals(seen.filter((d) => d.kind === "reasoning").map((d) => (d as { text: string }).text).join(""), "Look at systolic.");
  assertEquals(seen.filter((d) => d.kind === "text").length, 2);
  assertEquals(seen.filter((d) => d.kind === "tool").length, 1);
});

Deno.test("postChatCompletions falls back to JSON when the provider ignores stream, and retries a stream 400", async () => {
  const seen: string[] = [];
  const json = await postChatCompletions(creds, [{ role: "user", content: "hi" }], {
    onDelta: (d) => d.kind === "text" && seen.push(d.text),
    fetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "whole answer" } }] }), { status: 200 }),
      )) as unknown as typeof fetch,
  });
  assertEquals(json.text, "whole answer");
  assertEquals(seen, ["whole answer"]);

  const bodies: Array<Record<string, unknown>> = [];
  const retried = await postChatCompletions(creds, [{ role: "user", content: "hi" }], {
    onDelta: () => {},
    fetch: ((_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.stream) {
        return Promise.resolve(new Response('{"error":"stream is not supported"}', { status: 400, statusText: "Bad Request" }));
      }
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    }) as typeof fetch,
  });
  assertEquals(retried.text, "ok");
  assertEquals(bodies.map((b) => Boolean(b.stream)), [true, false]);
});

Deno.test("desktop proxy passes a streamed body through unread", async () => {
  const upstream = sse([delta({ content: "a" }), delta({ content: "b" })]);
  const res = await forwardChatCompletionsProxy(
    { endpoint: "https://api.example/v1/chat/completions", apiKey: "k", body: { stream: true } },
    { fetch: (() => Promise.resolve(upstream)) as unknown as typeof fetch },
  );
  assertEquals(res.headers.get("content-type"), "text/event-stream");
  const text = await res.text();
  assertStringIncludes(text, '"content":"a"');
  assertStringIncludes(text, "[DONE]");
});

Deno.test("runMappingAgent streams events and a short mapping notice per applied map_slot", async () => {
  const c = await bpController();
  const slots = ((await runChatTool(c, "list_slots", { unmappedOnly: true })) as { slots: Array<{ slotId: string; label?: string }> }).slots;
  const target = slots.find((s) => /systolic/i.test(`${s.slotId} ${s.label}`)) ?? slots[0]!;
  const events: MappingAgentEvent[] = [];
  let step = 0;
  const signatures: unknown[] = [];
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map systolic",
    executeTool: (name, args) => runChatTool(c, name, args),
    onEvent: (e) => events.push(e),
    fetch: ((_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: ChatMessage[] };
      step++;
      if (step === 1) {
        return Promise.resolve(sse([
          delta({ content: "Mapping systolic." }),
          delta({
            tool_calls: [{
              index: 0,
              id: "m1",
              function: { name: "map_slot", arguments: JSON.stringify({ slotId: target.slotId, path: "$.systolic" }) },
              extra_content: { google: { thought_signature: "S1" } },
            }],
          }),
        ]));
      }
      const assistant = body.messages.find((m) => m.role === "assistant" && m.tool_calls);
      signatures.push((assistant?.tool_calls?.[0] as { extra_content?: unknown })?.extra_content);
      return Promise.resolve(sse([delta({ content: "Done." }, "stop")]));
    }) as typeof fetch,
  });
  assertEquals(result.toolNames, ["map_slot"]);
  assertEquals(result.mappingNotices.length, 1);
  assertStringIncludes(result.mappingNotices[0]!, "Mapped ");
  assertStringIncludes(result.mappingNotices[0]!, "← $.systolic");
  assertEquals(signatures, [{ google: { thought_signature: "S1" } }]);
  const kinds = events.map((e) => e.type);
  assert(kinds.includes("text"));
  assert(kinds.includes("tool"));
  assert(kinds.includes("mapping"));
  assertEquals(result.text, "Mapping systolic.\n\nDone.");
  assert(c.getState().model.slots.some((s) => s.slotId === target.slotId && s.expression));
});

Deno.test("Stop aborts the run: partial text kept, every tool_call answered, nothing after Stop runs", async () => {
  const stop = new AbortController();
  const ran: string[] = [];
  let step = 0;
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "go",
    signal: stop.signal,
    onEvent: () => {},
    executeTool: (name) => {
      ran.push(name);
      // The user presses Stop while the first tool runs.
      stop.abort();
      return Promise.resolve({ ok: true });
    },
    fetch: (() => {
      step++;
      return Promise.resolve(sse([
        delta({ content: "Working" }),
        delta({
          tool_calls: [
            { index: 0, id: "a", function: { name: "list_slots", arguments: "{}" } },
            { index: 1, id: "b", function: { name: "get_source_tree", arguments: "{}" } },
          ],
        }),
      ]));
    }) as unknown as typeof fetch,
  });
  assertEquals(step, 1);
  assertEquals(ran, ["list_slots"]);
  assertEquals(result.stopped, true);
  assertEquals(result.text, "Working");
  const toolMsgs = result.messages.filter((m) => m.role === "tool");
  assertEquals(toolMsgs.map((m) => m.tool_call_id), ["a", "b"]);
  assertStringIncludes(String(toolMsgs[1]!.content), "Stopped");
});

Deno.test("Stop during a streamed step returns the partial text as stopped", async () => {
  const stop = new AbortController();
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "go",
    signal: stop.signal,
    onEvent: (e) => {
      if (e.type === "text") stop.abort();
    },
    executeTool: () => Promise.resolve({}),
    fetch: ((_u: string, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta({ content: "Half an" }))}\n\n`));
          signal?.addEventListener("abort", () => ctrl.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    }) as typeof fetch,
  });
  assertEquals(result.stopped, true);
  assertEquals(result.text, "Half an");
  assertEquals(result.messages.map((m) => m.role), ["user"]);
});

Deno.test("compactToolHistory keeps only the newest copy of big snapshot results", () => {
  const big = JSON.stringify({ slots: "x".repeat(3000) });
  const messages: ChatMessage[] = [
    { role: "user", content: "a" },
    { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "list_slots", arguments: "{}" } }] },
    { role: "tool", name: "list_slots", tool_call_id: "1", content: big },
    { role: "assistant", content: null, tool_calls: [{ id: "2", function: { name: "list_slots", arguments: "{}" } }] },
    { role: "tool", name: "list_slots", tool_call_id: "2", content: big },
    { role: "tool", name: "map_slot", tool_call_id: "3", content: big },
  ];
  const out = compactToolHistory(messages);
  assertStringIncludes(String(out[2]!.content), "superseded");
  assertEquals(out[2]!.tool_call_id, "1");
  assertEquals(out[4]!.content, big);
  assertEquals(out[5]!.content, big, "map_slot results are not snapshots");
});

Deno.test("mappingNoticeFor summarises mutating tools only", () => {
  assertEquals(mappingNoticeFor("map_slot", { slotId: "x", path: "$.a" }, { label: "Systolic" }), "Mapped Systolic ← $.a");
  assertEquals(
    mappingNoticeFor("import_suggestions", {}, { report: { applied: 3, skipped: 0, errors: [], loopsAccepted: 1, schemaIssues: [] } }),
    "Imported 3 suggestions, 1 loop",
  );
  assertEquals(mappingNoticeFor("list_slots", {}, {}), undefined);
  assertEquals(mappingNoticeFor("map_slot", { slotId: "x", path: "$.a" }, { error: "nope" }), undefined);
});

Deno.test("loadAiCredentials migrates stored credentials without the retired mappingMode", () => {
  const data = new Map<string, string>([[
    AI_CREDENTIALS_STORAGE_KEY,
    JSON.stringify({ ...creds, providerId: "openai", mappingMode: "suggestions" }),
  ]]);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
  const loaded = loadAiCredentials(storage);
  assertEquals(loaded, { ...creds, providerId: "openai" });
  assertEquals(JSON.parse(data.get(AI_CREDENTIALS_STORAGE_KEY)!).mappingMode, undefined);
});

Deno.test("trimChatSessionToTokens drops whole old turns and resets contextSent", () => {
  const session = emptyChatSession();
  session.contextSent = true;
  for (let i = 0; i < 6; i++) {
    session.messages.push({ role: "user", content: `q${i} ${"x".repeat(3000)}` });
    session.messages.push({ role: "assistant", content: `a${i}` });
  }
  const fitted = trimChatSessionToTokens(session, 2500);
  assert(fitted.trimmed);
  assert(fitted.tokens <= 2500);
  assertEquals(fitted.session.messages[0]!.role, "user");
  assertEquals(fitted.session.contextSent, false);
  assertEquals(estimateChatTokens(fitted.session.messages), fitted.tokens);
  assertEquals(trimChatSessionToTokens(session, 1_000_000).trimmed, false);
});

Deno.test("api prompt context: no file bodies, source outline + example manifest, tool wording", async () => {
  const c = await bpController();
  const api = c.buildAiPromptText("api");
  const inline = c.buildAiPromptText("inline");
  assert(!api.includes("--intehrgrator-part"), "no multipart bodies");
  assert(!api.includes("Return exactly one"), "tools mode does not ask for one JSON block");
  assert(!/Attach these files|Fetch each URL/.test(api));
  assertStringIncludes(api, "## Source tree");
  assertStringIncludes(api, "## Examples");
  assertStringIncludes(api, "instance-1.json");
  assertStringIncludes(api, "list_optional_rm");
  assertStringIncludes(inline, "--intehrgrator-part", "copy & paste inline still embeds files");
  assertStringIncludes(inline, "Return exactly one");
  assert(api.length * 3 < inline.length, `api ${api.length} vs inline ${inline.length}`);
});

Deno.test("get_example / list_examples / list_slots filters", async () => {
  const c = await bpController();
  const listed = (await runChatTool(c, "list_examples", {})) as { examples: Array<{ id: string; active?: boolean; chars: number }> };
  assertEquals(listed.examples.length, 1);
  assertEquals(listed.examples[0]!.active, true);
  const ex = (await runChatTool(c, "get_example", { maxChars: 20 })) as { content: string; truncated?: boolean };
  assertEquals(ex.content.length, 20);
  assertEquals(ex.truncated, true);
  const all = ((await runChatTool(c, "list_slots", {})) as { slots: unknown[] }).slots.length;
  const some = ((await runChatTool(c, "list_slots", { query: "systolic" })) as { slots: Array<{ slotId: string }> }).slots;
  assert(some.length > 0 && some.length < all);
});

Deno.test("refresh merge prompt bounds raw files", () => {
  const big = "<x/>".repeat(REFRESH_MERGE_RAW_LIMIT_CHARS);
  const prompt = buildRefreshMergePrompt({
    kind: "target",
    previousFilename: "a.opt",
    nextFilename: "b.opt",
    warnings: [{ kind: "removed-slot", message: "Slot gone" }],
    previousContent: big,
    nextContent: big,
  } as never);
  assertStringIncludes(prompt, "Raw files omitted");
  assertStringIncludes(prompt, "Slot gone");
  assert(prompt.length < 4000);
});

Deno.test("a multi-step tools turn resends at most one full copy of list_slots / get_source_tree", async () => {
  const c = await bpController();
  const bodies: string[] = [];
  const script = [
    ["list_slots", "get_source_tree"],
    ["list_slots", "get_source_tree"],
    ["list_slots", "get_source_tree"],
  ];
  let step = 0;
  await runMappingAgent({
    credentials: creds,
    prompt: "map",
    executeTool: (name, args) => runChatTool(c, name, args),
    fetch: ((_u: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const names = script[step++];
      const message = names
        ? {
          content: null,
          tool_calls: names.map((name, i) => ({ id: `${step}${i}`, type: "function", function: { name, arguments: "{}" } })),
        }
        : { content: "done" };
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 }));
    }) as typeof fetch,
  });
  const listSlotsChars = JSON.stringify(JSON.stringify(await runChatTool(c, "list_slots", {}))).length;
  const last = JSON.parse(bodies.at(-1)!) as { messages: ChatMessage[] };
  const full = last.messages.filter((m) => m.role === "tool" && !String(m.content).startsWith('{"superseded"'));
  assertEquals(full.filter((m) => m.name === "list_slots").length, 1);
  const trees = full.filter((m) => m.name === "get_source_tree");
  // bp's source tree is tiny (below the stub threshold), so small copies may stay.
  assert(trees.length === 1 || trees.every((m) => String(m.content).length < 1500));
  // Request size grows by about one copy, not three.
  assert(bodies.at(-1)!.length < bodies[0]!.length + 2 * listSlotsChars, `${bodies.at(-1)!.length}`);
});

Deno.test("AI chat mapping tools are a subset of the MCP / Agent API tools with the same parameters", async () => {
  const { AGENT_TOOLS, callAgentTool } = await import("@intehrgrator/agent/tools.ts");
  const { mappingAgentOpenAiTools } = await import("@intehrgrator/core/ai/chat_tools.ts");
  const byName = new Map(AGENT_TOOLS.map((t) => [t.name, t]));
  for (const tool of mappingAgentOpenAiTools()) {
    const mcp = byName.get(tool.function.name);
    assert(mcp, `${tool.function.name} missing from AGENT_TOOLS`);
    const chatProps = Object.keys((tool.function.parameters.properties ?? {}) as Record<string, unknown>).sort();
    const mcpProps = Object.keys(((mcp.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}))
      .filter((k) => k !== "revision" && k !== "agentId" && k !== "summary")
      .sort();
    for (const prop of chatProps) {
      assert(mcpProps.includes(prop) || prop === "revision", `${tool.function.name}.${prop} not in MCP schema (${mcpProps})`);
    }
  }
  // The shared readers answer the same way over MCP.
  const { WorkbenchService } = await import("@intehrgrator/workbench/service.ts");
  const service = new WorkbenchService();
  service.loadTemplateContent("blood_pressure.opt", await Deno.readTextFile(join(FIX, "blood_pressure.opt")));
  service.addExampleContent("instance-1.json", await Deno.readTextFile(join(FIX, "dummy-json-vitals", "instance-1.json")));
  const listed = await callAgentTool(service, "list_examples", {}) as { examples: Array<{ active?: boolean }> };
  assertEquals(listed.examples[0]?.active, true);
  const ex = await callAgentTool(service, "get_example", { maxChars: "10" }) as { content: string; truncated?: boolean };
  assertEquals(ex.content.length, 10);
  const filtered = await callAgentTool(service, "list_slots", { unmappedOnly: "true", query: "systolic" }) as {
    slots: unknown[];
  };
  assert(filtered.slots.length > 0);
});
