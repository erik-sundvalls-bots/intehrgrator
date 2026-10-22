import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  callChatCompletions,
  parseAiCredentials,
  postChatCompletions,
} from "@intehrgrator/core/ai/credentials.ts";
import { runChatTool as executeMappingAgentTool } from "./support/chat_tools.ts";
import { runMappingAgent } from "@intehrgrator/core/ai/mapping_agent.ts";
import { looksLikeSuggestionsPayload } from "@intehrgrator/core/ai/mod.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";

function stubHost(): HostAdapter {
  return {
    pickTextFile: async () => null,
    pickTextFilesFromDirectory: async () => null,
    pickBinaryFile: async () => null,
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: async () => {},
    readClipboard: async () => "",
    saveAutosave: async () => {},
    saveManualSave: async () => {},
    loadStoredProjectRecord: async () => null as StoredProjectRecord | null,
    listLoadableProjects: async () => [] as LoadableProjectEntry[],
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
  };
}

async function loadVitalsController(): Promise<WorkbenchController> {
  const fixtures = join(import.meta.dirname!, "fixtures", "dummy-json-vitals");
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent(
    "target.schema.json",
    await Deno.readTextFile(join(fixtures, "target.schema.json")),
  );
  controller.loadSchemaContent(
    "source.schema.json",
    await Deno.readTextFile(join(fixtures, "source.schema.json")),
  );
  controller.addExampleContent(
    "instance-1.json",
    await Deno.readTextFile(join(fixtures, "instance-1.json")),
  );
  return controller;
}

const creds = {
  endpoint: "https://api.example/v1/chat/completions",
  apiKey: "sk-test",
  model: "test-model",
};

Deno.test("parseAiCredentials keeps providerId and drops the retired mappingMode (#252)", () => {
  assertEquals(
    parseAiCredentials({
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk",
      model: "gpt-4.1",
      providerId: "openai",
      mappingMode: "suggestions",
    }),
    {
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk",
      model: "gpt-4.1",
      providerId: "openai",
    },
  );
});

Deno.test("postChatCompletions sends OpenAI tools and reads tool_calls", async () => {
  const result = await postChatCompletions(
    creds,
    [{ role: "user", content: "map it" }],
    {
      tools: [{
        type: "function",
        function: {
          name: "list_slots",
          description: "slots",
          parameters: { type: "object", properties: {} },
        },
      }],
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        assertEquals(body.tools[0].function.name, "list_slots");
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "list_slots", arguments: "{}" },
                }],
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    },
  );
  assertEquals(result.toolCalls?.map((row) => row.name), ["list_slots"]);
  assertEquals(result.text, "");
});

Deno.test("chat tools list_slots then map_slot then run_test on dummy vitals", async () => {
  const controller = await loadVitalsController();
  const listed = await executeMappingAgentTool(controller, "list_slots", {}) as {
    slots: Array<{ slotId: string; mapped: boolean }>;
  };
  const systolic = listed.slots.find((row) => row.slotId.includes("systolic"))?.slotId;
  if (!systolic) throw new Error("missing systolic slot");
  await executeMappingAgentTool(controller, "map_slot", {
    slotId: systolic,
    path: "$.systolic",
    format: "json",
  });
  const after = await executeMappingAgentTool(controller, "list_slots", {}) as {
    slots: Array<{ slotId: string; mapped: boolean; expression?: string }>;
  };
  const mapped = after.slots.find((row) => row.slotId === systolic);
  assertEquals(mapped?.mapped, true);
  assertStringIncludes(mapped?.expression ?? "", "systolic");
  const tested = await executeMappingAgentTool(controller, "run_test", {}) as {
    testResult: { ok: boolean };
  };
  assertEquals(typeof tested.testResult.ok, "boolean");
});

Deno.test("runMappingAgent loops tool calls then imports leftover suggestions JSON", async () => {
  const controller = await loadVitalsController();
  const listed = await executeMappingAgentTool(controller, "list_slots", {}) as {
    slots: Array<{ slotId: string }>;
  };
  const systolic = listed.slots.find((row) => row.slotId.includes("systolic"))?.slotId;
  if (!systolic) throw new Error("missing systolic");
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: controller.getState().templateId },
    suggestions: [
      { slotId: systolic, block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } } },
    ],
  };
  let calls = 0;
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map systolic",
    executeTool: (name, args) => executeMappingAgentTool(controller, name, args),
    importText: (text) => controller.importAiSuggestions(text),
    fetch: (async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      if (calls === 1) {
        assertEquals(Array.isArray(body.tools), true);
        assertStringIncludes(body.messages[1].content, "Map with the function tools");
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                tool_calls: [{
                  id: "c1",
                  type: "function",
                  function: { name: "list_slots", arguments: "{}" },
                }],
              },
            }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "```intehrgrator-suggestions\n" + JSON.stringify(envelope) + "\n```",
            },
          }],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  assertEquals(result.toolNames, ["list_slots"]);
  assertEquals(looksLikeSuggestionsPayload(result.text), true);
  assertEquals(result.imported?.applied, 1);
});

Deno.test("runMappingAgent executes map_slot on the live controller", async () => {
  const controller = await loadVitalsController();
  const listed = await executeMappingAgentTool(controller, "list_slots", {}) as {
    slots: Array<{ slotId: string }>;
  };
  const systolic = listed.slots.find((row) => row.slotId.includes("systolic"))?.slotId;
  if (!systolic) throw new Error("missing systolic");
  let calls = 0;
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "map systolic with tools",
    executeTool: (name, args) => executeMappingAgentTool(controller, name, args),
    fetch: ((_input, _init) => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: {
                tool_calls: [{
                  id: "m1",
                  type: "function",
                  function: {
                    name: "map_slot",
                    arguments: JSON.stringify({ slotId: systolic, path: "$.systolic", format: "json" }),
                  },
                }],
              },
            }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "mapped systolic" } }] }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  assertEquals(result.toolNames, ["map_slot"]);
  const after = await executeMappingAgentTool(controller, "list_slots", {}) as {
    slots: Array<{ slotId: string; mapped: boolean; expression?: string }>;
  };
  const mapped = after.slots.find((row) => row.slotId === systolic);
  assertEquals(mapped?.mapped, true);
  assertStringIncludes(mapped?.expression ?? "", "systolic");
});

Deno.test("callChatCompletions still posts a one-shot suggestions prompt", async () => {
  const result = await callChatCompletions(
    creds,
    "map systolic",
    {
      fetch: (async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        assertEquals(body.tools, undefined);
        assertStringIncludes(body.messages[0].content, "intehrgrator-suggestions");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"format":"intehrgrator-suggestions"}' } }],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    },
  );
  assertStringIncludes(result.text, "intehrgrator-suggestions");
});

Deno.test("runMappingAgent surfaces HTTP errors", async () => {
  await assertRejects(
    () =>
      runMappingAgent({
        credentials: creds,
        prompt: "hi",
        executeTool: async () => ({}),
        fetch: (async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as typeof fetch,
      }),
    Error,
    "401",
  );
});
