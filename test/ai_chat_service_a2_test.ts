/**
 * ADR 0014 / PR A2: the in-app AI chat runs `callAgentTool` on a
 * WorkbenchService through an AgentClient, so the chat and MCP share one tool
 * surface and one write path; the chat's tool list is derived from AGENT_TOOLS.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AGENT_TOOLS } from "@intehrgrator/agent/tools.ts";
import { LocalAgentClient } from "@intehrgrator/agent/client.ts";
import { aiChatActor, USER_ACTOR } from "@intehrgrator/agent/actor.ts";
import { CALL_AI_TOOL_NAMES, isMutatingCallAiTool, mappingAgentOpenAiTools } from "@intehrgrator/core/ai/chat_tools.ts";
import { runMappingAgentOnClient } from "@intehrgrator/core/ai/mapping_agent.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { createFsHostAdapter } from "@intehrgrator/host/fs_adapter.ts";

const FIX = join(import.meta.dirname!, "fixtures");
const creds = { endpoint: "https://api.example/v1/chat/completions", apiKey: "sk-test", model: "m" };

async function bp(): Promise<{ controller: WorkbenchController; service: WorkbenchService; sys: string }> {
  const controller = new WorkbenchController(createFsHostAdapter());
  controller.loadTemplateContent("blood_pressure.opt", await Deno.readTextFile(join(FIX, "blood_pressure.opt")));
  controller.addExampleContent("instance-1.json", await Deno.readTextFile(join(FIX, "dummy-json-vitals", "instance-1.json")));
  const service = new WorkbenchService({ controller });
  const sys = service.listSlots().find((s) => s.slotId.endsWith("items/at0004/value/value/value"))!.slotId;
  return { controller, service, sys };
}

function reply(message: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
}

Deno.test("chat tools are AGENT_TOOLS entries with the same description and parameters (no revision)", () => {
  const byName = new Map(AGENT_TOOLS.map((t) => [t.name, t]));
  const tools = mappingAgentOpenAiTools();
  assertEquals(tools.map((t) => t.function.name), [...CALL_AI_TOOL_NAMES]);
  for (const tool of tools) {
    const mcp = byName.get(tool.function.name)!;
    assertEquals(tool.function.description, mcp.description);
    const props = { ...((mcp.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}) };
    delete props.revision;
    assertEquals((tool.function.parameters as { properties: unknown }).properties, props);
  }
  assert(isMutatingCallAiTool("map_slot") && !isMutatingCallAiTool("list_slots"));
});

Deno.test("a chat turn writes through the service on the caller's controller, attributed to the AI", async () => {
  const { controller, service, sys } = await bp();
  const client = new LocalAgentClient(service);
  const turnId = "turn-1";
  client.setActor(aiChatActor({ provider: "custom", model: "m", turnId }));
  let step = 0;
  let wrapped = 0;
  const result = await runMappingAgentOnClient(client, {
    credentials: creds,
    prompt: "map systolic",
    asAiWrite: async (fn) => {
      wrapped++;
      return await fn();
    },
    fetch: (() =>
      Promise.resolve(
        step++ === 0
          ? reply({
            content: null,
            tool_calls: [
              { id: "a", type: "function", function: { name: "list_slots", arguments: "{}" } },
              { id: "b", type: "function", function: { name: "map_slot", arguments: JSON.stringify({ slotId: sys, path: "$.systolic" }) } },
              { id: "c", type: "function", function: { name: "load_target", arguments: "{}" } },
            ],
          })
          : reply({ content: "done" }),
      )) as typeof fetch,
  });
  client.setActor(null);
  assertEquals(result.text, "done");
  assertEquals(wrapped, 1, "only the mutating tool is an AI write");
  // The caller's controller (the live canvas in the browser) has the mapping.
  const slot = controller.getState().model.slots.find((s) => s.slotId === sys);
  assert(slot?.expression?.includes("systolic"), "mapped on the shared controller");
  const history = service.listHistory();
  assertEquals(history.length, 1);
  assertEquals(history[0]!.actor.origin, "ai-chat");
  assertEquals(history[0]!.actor.turnId, turnId);
  // A tool outside the chat list is refused with a readable error for the model.
  const toolMessages = result.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
  assert(toolMessages.some((m) => m.includes("AI chat cannot run load_target")));
  // map_slot answers like the old chat executor (label / mapped) plus the revision.
  const mapMessage = result.messages.find((m) => m.role === "tool" && m.name === "map_slot");
  const mapped = JSON.parse(String(mapMessage?.content)) as { slotId: string; mapped: boolean };
  assertEquals(mapped.slotId, sys);
  assertEquals(mapped.mapped, true);
  // After the turn the client acts for the user again.
  await client.callTool("map_slot", { slotId: sys, path: "$.diastolic" });
  assertEquals(service.listHistory().at(-1)!.actor.id, USER_ACTOR.id);
});

Deno.test("map_slot over MCP now validates the slot like the chat did", async () => {
  const { service } = await bp();
  const client = new LocalAgentClient(service);
  await assertRejects(() => client.callTool("map_slot", { slotId: "nope", path: "$.x" }), Error, "Unknown slotId");
  await assertRejects(() => client.callTool("replace_sheets", {}), Error, "sheets[]");
});
