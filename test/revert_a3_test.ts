/**
 * ADR 0014 / PR A3: Revert (sv: Häv) of a history entry is a new change at
 * the end that skips slots changed later; Undo (sv: Ångra) rewinds from the
 * top whoever made the change. The history is never rewritten.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { aiChatActor, USER_ACTOR } from "@intehrgrator/agent/actor.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";

const FIX = join(import.meta.dirname!, "fixtures");

async function bp(): Promise<{ service: WorkbenchService; sys: string; dia: string; rate: string }> {
  const service = new WorkbenchService();
  service.loadTemplateContent("blood_pressure.opt", await Deno.readTextFile(join(FIX, "blood_pressure.opt")));
  service.addExampleContent("i.json", await Deno.readTextFile(join(FIX, "dummy-json-vitals", "instance-1.json")));
  const slots = collectValueSlots(service.exportBundle().target?.skeleton ?? []);
  const find = (suffix: string) => slots.find((s) => s.slotId.endsWith(suffix))!.slotId;
  return {
    service,
    sys: find("items/at0004/value/value/value"),
    dia: find("items/at0005/value/value/value"),
    rate: find("items/at1006/value/value/value"),
  };
}

const expr = (service: WorkbenchService, slotId: string) =>
  service.exportBundle().mapping.model.slots.find((s) => s.slotId === slotId)?.expression ?? "";

Deno.test("revert an AI turn: its slots go back, a later human edit on one of them is kept and reported", async () => {
  const { service, sys, dia, rate } = await bp();
  service.mapNodeToSlot(rate, "$.pulse", "json", undefined, { actor: USER_ACTOR });
  const turn = aiChatActor({ provider: "custom", model: "m", turnId: "t1" });
  service.mapNodeToSlot(sys, "$.systolic", "json", undefined, { actor: turn });
  service.mapNodeToSlot(dia, "$.diastolic", "json", undefined, { actor: turn });
  const aiSeq = service.listHistory().at(-1)!.seq;
  assertEquals(service.listHistory().at(-1)!.actor.origin, "ai-chat");
  // A person changes one of the AI's slots afterwards.
  service.mapNodeToSlot(dia, "$.systolic", "json", undefined, { actor: USER_ACTOR });
  const length = service.listHistory().length;

  const result = service.revert(aiSeq, { actor: USER_ACTOR });
  assertEquals(result.ok, true);
  assertEquals(result.reverted, [sys]);
  assertEquals(result.skipped.map((s) => [s.slotId, s.reason]), [[dia, "changed-later"]]);
  assertEquals(result.author, "AI chat (m)");
  assertEquals(expr(service, sys), "", "AI mapping reverted");
  assert(expr(service, dia).includes("systolic"), "later human edit kept");
  assert(expr(service, rate).includes("pulse"), "earlier human edit kept");
  // Appended, not rewritten.
  const history = service.listHistory();
  assertEquals(history.length, length + 1);
  assertEquals(history.at(-1)!.kind, "revert");
  assertEquals(history.at(-1)!.targetSeqs, [aiSeq]);
  assertEquals(history.find((e) => e.seq === aiSeq)?.actor.origin, "ai-chat");
  // The revert itself is a change Undo can rewind.
  assertEquals(service.undoTarget()?.seq, history.at(-1)!.seq);
  service.undo();
  assert(expr(service, sys).includes("systolic"), "undo of the revert brings the AI mapping back");
});

Deno.test("revert of a slot set before: the previous mapping comes back", async () => {
  const { service, sys } = await bp();
  service.mapNodeToSlot(sys, "$.systolic", "json");
  service.mapNodeToSlot(sys, "$.diastolic", "json");
  const seq = service.listHistory().at(-1)!.seq;
  const result = service.revert(seq);
  assertEquals(result.reverted, [sys]);
  assert(expr(service, sys).includes("systolic"));
});

Deno.test("revert with nothing left to revert changes nothing and says why", async () => {
  const { service, sys } = await bp();
  service.mapNodeToSlot(sys, "$.systolic", "json");
  const seq = service.listHistory().at(-1)!.seq;
  service.mapNodeToSlot(sys, "$.diastolic", "json");
  const length = service.listHistory().length;
  const result = service.revert(seq);
  assertEquals(result.ok, false);
  assertEquals(result.skipped.map((s) => s.reason), ["changed-later"]);
  assertEquals(service.listHistory().length, length);
});

Deno.test("Undo rewinds the newest change regardless of author; MCP revert / undo tools", async () => {
  const { service, sys, dia } = await bp();
  service.mapNodeToSlot(sys, "$.systolic", "json", undefined, { actor: USER_ACTOR });
  service.mapNodeToSlot(dia, "$.diastolic", "json", undefined, {
    actor: { kind: "agent", id: "a1", displayName: "MCP: cursor", origin: "mcp", client: "cursor" },
  });
  const undone = await callAgentTool(service, "undo", {}) as { ok: boolean; author: string };
  assertEquals(undone.ok, true);
  assertEquals(undone.author, "MCP: cursor");
  assertEquals(expr(service, dia), "");
  assert(expr(service, sys).includes("systolic"));
  const humanSeq = service.listHistory().find((e) => e.actor.id === USER_ACTOR.id && e.kind === "map_slot")!.seq;
  const reverted = await callAgentTool(service, "revert", { seq: humanSeq }) as { ok: boolean; reverted: string[] };
  assertEquals(reverted.reverted, [sys]);
  assertEquals(expr(service, sys), "");
  let threw = false;
  try {
    await callAgentTool(service, "undo", { scope: "agent" });
  } catch {
    threw = true;
  }
  assert(threw, "per-author undo is Revert now");
});
