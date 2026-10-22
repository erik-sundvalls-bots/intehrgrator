import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createAgentApiHandler } from "@intehrgrator/agent/http.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { DOCUMENT_SWAP_EVENT_TYPE } from "@intehrgrator/workbench/document_undo.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  isSemanticBlocklyEvent,
  summarizeBlocklyEvent,
} from "@intehrgrator/workbench/semantic_events.ts";

async function loadBpFixture(service: WorkbenchService): Promise<string> {
  const opt = await Deno.readTextFile(join(import.meta.dirname!, "fixtures", "blood_pressure.opt"));
  const example = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "dummy-json-vitals", "instance-1.json"),
  );
  service.loadTemplateContent("blood_pressure.opt", opt);
  service.addExampleContent("bp_example.json", example);
  const slotId = collectValueSlots(service.exportBundle().target?.skeleton ?? []).find((s) =>
    s.slotId.endsWith("items/at0004/value/value/value")
  )?.slotId;
  if (!slotId) throw new Error("missing slot");
  return slotId;
}

Deno.test("register_agent returns id, name, and colour", async () => {
  const service = new WorkbenchService();
  const handler = createAgentApiHandler(service);
  const res = await handler(new Request("http://local/api/v1/register-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Cursor Agent" }),
  }));
  assertEquals(res.status, 200);
  const json = await res.json() as { agentId: string; displayName: string; color: string };
  assertEquals(json.displayName, "Cursor Agent");
  assertEquals(typeof json.agentId, "string");
  assertEquals(json.color.startsWith("hsl("), true);
});

Deno.test("import records agent attribution in history", async () => {
  const service = new WorkbenchService();
  const handler = createAgentApiHandler(service);
  const slotId = await loadBpFixture(service);
  const targetId = service.exportBundle().target?.targetId ?? "";

  await handler(new Request("http://local/api/v1/register-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "test-agent", displayName: "Test Agent" }),
  }));

  const rev = service.getRevision();
  await handler(new Request("http://local/api/v1/import-suggestions", {
    method: "POST",
    headers: {
      "If-Match": rev,
      "content-type": "text/plain",
      "X-Agent-Id": "test-agent",
      "X-Agent-Name": "Test Agent",
    },
    body: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId },
      suggestions: [{
        slotId,
        block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
      }],
    }),
  }));

  const importEntry = service.listHistory().at(-1)!;
  assertEquals(importEntry.actor.kind, "agent");
  assertEquals(importEntry.actor.displayName, "Test Agent");
  assertEquals(importEntry.kind, "import");
});

Deno.test("undo rewinds the newest change whoever made it and appends an undo entry", async () => {
  const service = new WorkbenchService();
  const slotId = await loadBpFixture(service);
  const targetId = service.exportBundle().target?.targetId ?? "";

  service.importSuggestions(JSON.stringify({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId },
    suggestions: [{
      slotId,
      block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
    }],
  }), undefined, {
    actor: { kind: "agent", id: "a1", displayName: "Agent One" },
    kind: "import",
  });

  const agentSeq = service.listHistory().at(-1)!.seq;
  const length = service.listHistory().length;
  assertEquals(service.undoTarget()?.author, "Agent One");
  const undone = service.undo();
  assertEquals(undone?.undoneSeqs, [agentSeq]);
  assertEquals(undone?.author, "Agent One");
  // Never rewritten: the agent entry stays, marked undone, and the undo is appended.
  const history = service.listHistory();
  assertEquals(history.length, length + 1);
  assertEquals(history.find((e) => e.seq === agentSeq)?.undone, true);
  assertEquals(history.at(-1)!.kind, "undo");
  assertEquals(history.at(-1)!.targetSeqs, [agentSeq]);
  assertEquals(service.redo(), true);
  assertEquals(service.listHistory().at(-1)!.kind, "redo");
  assertEquals(service.listHistory().find((e) => e.seq === agentSeq)?.undone, false);
});

Deno.test("restoreAt destructive goes back by appending one undo entry", async () => {
  const service = new WorkbenchService();
  const slotId = await loadBpFixture(service);
  const baseLen = service.listHistory().length;

  service.mapNodeToSlot(slotId, "$.systolic", "json");
  service.mapNodeToSlot(slotId, "$.diastolic", "json");
  const firstMapSeq = service.listHistory()[baseLen]!.seq;

  const result = service.restoreAt(firstMapSeq, "destructive");
  assertEquals(result.ok, true);
  assertEquals(result.discarded.length, 1);
  assertEquals(service.listHistory().length, baseLen + 3);
  assertEquals(service.listHistory().at(-1)!.kind, "undo");
  const slot = service.exportBundle().mapping.model.slots.find((s) => s.slotId === slotId);
  assert(slot?.expression.includes("systolic"));
});

Deno.test("buildPatchPrompt references intehrgrator-suggestions v2", async () => {
  const service = new WorkbenchService();
  const slotId = await loadBpFixture(service);
  service.mapNodeToSlot(slotId, "$.systolic", "json");
  const seq = service.listHistory().at(-1)!.seq;
  const prompt = service.buildPatchPrompt(seq);
  assertStringIncludes(prompt, "intehrgrator-suggestions");
  assertStringIncludes(prompt, "version 2");
  assertStringIncludes(prompt, `seq: ${seq}`);
});

Deno.test("export-discarded returns zip attachment", async () => {
  const service = new WorkbenchService();
  const handler = createAgentApiHandler(service);
  const slotId = await loadBpFixture(service);
  service.mapNodeToSlot(slotId, "$.systolic", "json");
  const entry = service.listHistory().at(-1)!;
  const res = await handler(new Request("http://local/api/v1/export-discarded", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries: [{ afterBundle: entry.afterBundle }] }),
  }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/zip");
});

Deno.test("semantic events ignore pure block drag", () => {
  const drag = {
    isUiEvent: false,
    type: Blockly.Events.BLOCK_MOVE,
    oldParentId: "p1",
    newParentId: "p1",
    oldInputName: "STACK",
    newInputName: "STACK",
    recordUndo: false,
  };
  assertEquals(isSemanticBlocklyEvent(drag as never), false);
});

Deno.test("semantic events accept reconnect moves", () => {
  const move = {
    isUiEvent: false,
    type: Blockly.Events.BLOCK_MOVE,
    oldParentId: null,
    newParentId: "p1",
    recordUndo: true,
  };
  assertEquals(isSemanticBlocklyEvent(move as never), true);
  assertEquals(
    summarizeBlocklyEvent({ type: DOCUMENT_SWAP_EVENT_TYPE, isUiEvent: false } as never),
    "Load project or template",
  );
});
