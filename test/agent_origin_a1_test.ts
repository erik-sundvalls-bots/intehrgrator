/**
 * ADR 0014 / PR A1: origin on history entries (human, ai-chat with model,
 * mcp with client), one entry per AI chat turn, and UI commits that report
 * agent changes they replaced.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createAgentApiHandler, uiCommitActor } from "@intehrgrator/agent/http.ts";
import { actorFromHeaders, actorOrigin, aiChatActor, USER_ACTOR } from "@intehrgrator/agent/actor.ts";
import { handleMcpRequest, LocalAgentClient } from "@intehrgrator/agent/mcp_stdio.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";

async function loadBp(service: WorkbenchService): Promise<{ sys: string; dia: string }> {
  const opt = await Deno.readTextFile(join(import.meta.dirname!, "fixtures", "blood_pressure.opt"));
  const example = await Deno.readTextFile(join(import.meta.dirname!, "fixtures", "dummy-json-vitals", "instance-1.json"));
  service.loadTemplateContent("blood_pressure.opt", opt);
  service.addExampleContent("bp_example.json", example);
  const slots = collectValueSlots(service.exportBundle().target?.skeleton ?? []);
  const find = (suffix: string) => slots.find((s) => s.slotId.endsWith(suffix))!.slotId;
  return { sys: find("items/at0004/value/value/value"), dia: find("items/at0005/value/value/value") };
}

Deno.test("actor origin: old entries read as human / mcp; headers carry the MCP client", () => {
  assertEquals(actorOrigin({ kind: "user" }), "human");
  assertEquals(actorOrigin({ kind: "agent" }), "mcp");
  assertEquals(actorOrigin(aiChatActor({ model: "m" })), "ai-chat");
  const registered = actorFromHeaders(new Headers({ "X-Agent-Id": "a1", "X-Agent-Client": "cursor" }));
  assertEquals(registered.origin, "mcp");
  assertEquals(registered.client, "cursor");
  // An MCP client that never registered is not "You".
  const anon = actorFromHeaders(new Headers({ "X-Agent-Client": "claude-desktop" }));
  assertEquals(anon.kind, "agent");
  assertEquals(anon.displayName, "MCP: claude-desktop");
  assertEquals(actorFromHeaders(new Headers()), USER_ACTOR);
});

Deno.test("ui-commit can claim the person or the AI chat, never an MCP agent", () => {
  assertEquals(uiCommitActor(undefined), USER_ACTOR);
  assertEquals(uiCommitActor({ origin: "mcp" } as never), USER_ACTOR);
  const ai = uiCommitActor({ origin: "ai-chat", provider: "gemini", model: "gemini-3-pro", turnId: "t1" });
  assertEquals(ai.origin, "ai-chat");
  assertEquals(ai.displayName, "AI chat (gemini-3-pro)");
  assertEquals(ai.turnId, "t1");
  assertEquals(uiCommitActor({ origin: "ai-chat", provider: "copy-paste" }).displayName, "AI (pasted answer)");
});

Deno.test("one history entry per AI chat turn; the turn's later summary replaces the first", async () => {
  const service = new WorkbenchService();
  const { sys, dia } = await loadBp(service);
  const start = service.listHistory().length;
  const ui = new WorkbenchService();
  ui.loadBundle(service.exportBundle());
  const turn = aiChatActor({ model: "stub", turnId: "turn-1" });
  ui.mapNodeToSlot(sys, "$.systolic", "json");
  service.commitFromUi(ui.exportBundle(), "AI chat: edit", "expression", { actor: turn });
  ui.mapNodeToSlot(dia, "$.diastolic", "json");
  service.commitFromUi(ui.exportBundle(), "AI chat: Mapped Systolic", "expression", { actor: turn });
  service.commitFromUi(ui.exportBundle(), "AI chat: Mapped Systolic; Mapped Diastolic", "expression", { actor: turn });
  const entries = service.listHistory();
  assertEquals(entries.length, start + 1);
  assertEquals(entries.at(-1)!.summary, "AI chat: Mapped Systolic; Mapped Diastolic");
  assertEquals(entries.at(-1)!.actor.origin, "ai-chat");
  // Undo takes back the whole turn.
  service.undo();
  const slots = service.exportBundle().mapping.model.slots;
  assertEquals(slots.find((s) => s.slotId === sys)?.expression ?? "", "");
  assertEquals(slots.find((s) => s.slotId === dia)?.expression ?? "", "");
});

Deno.test("a UI commit reports the agent changes it replaced; both keep their origin", async () => {
  const service = new WorkbenchService();
  const { sys, dia } = await loadBp(service);
  const base = service.getRevision();
  const ui = new WorkbenchService();
  ui.loadBundle(service.exportBundle());
  // An agent maps diastolic after the UI last synced.
  service.setActor({ kind: "agent", id: "probe", displayName: "Probe", origin: "mcp", client: "cursor" });
  service.mapNodeToSlot(dia, "$.diastolic", "json");
  service.setActor(USER_ACTOR);
  ui.mapNodeToSlot(sys, "$.systolic", "json");
  const result = service.commitFromUi(ui.exportBundle(), "Edit mapping", "expression", { baseRevision: base });
  assertEquals(result.overwritten.map((e) => e.actor), ["Probe"]);
  const entries = service.listHistory();
  assertEquals(entries.at(-2)!.actor.client, "cursor");
  assertEquals(entries.at(-1)!.actor.origin, "human");
});

Deno.test("MCP initialize clientInfo.name is recorded on the agent's history entries", async () => {
  const service = new WorkbenchService();
  const { sys } = await loadBp(service);
  const client = new LocalAgentClient(service);
  await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "cursor" } } }, client);
  await client.callTool("register_agent", { displayName: "Cursor agent" });
  await client.callTool("map_slot", { slotId: sys, path: "$.systolic" });
  const last = service.listHistory().at(-1)!;
  assertEquals(last.actor.origin, "mcp");
  assertEquals(last.actor.client, "cursor");
  assertEquals(last.actor.displayName, "Cursor agent");
});

Deno.test("POST /ui-commit takes baseRevision and the ai-chat origin", async () => {
  const service = new WorkbenchService();
  const { sys } = await loadBp(service);
  const handler = createAgentApiHandler(service);
  const ui = new WorkbenchService();
  ui.loadBundle(service.exportBundle());
  ui.mapNodeToSlot(sys, "$.systolic", "json");
  const res = await handler(new Request("http://local/api/v1/ui-commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bundle: ui.exportBundle(),
      summary: "AI chat: Mapped Systolic",
      baseRevision: service.getRevision(),
      origin: { origin: "ai-chat", model: "stub", turnId: "t9" },
    }),
  }));
  assertEquals(res.status, 200);
  const json = await res.json() as { revision: string; overwritten: unknown[] };
  assertEquals(json.overwritten, []);
  assert(json.revision.startsWith("r"));
  const last = service.listHistory().at(-1)!;
  assertEquals(last.actor.displayName, "AI chat (stub)");
});
