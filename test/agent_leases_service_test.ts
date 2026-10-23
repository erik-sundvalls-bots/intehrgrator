/**
 * Leases on the shared WorkbenchService (S-15): an MCP agent cannot change,
 * undo or revert what another agent leases; the person in the UI is never
 * blocked; two unregistered chats from one IDE are separate agents.
 */
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { createAgentApiHandler } from "@intehrgrator/agent/http.ts";
import { HttpAgentClient } from "@intehrgrator/agent/client.ts";

const fx = join(import.meta.dirname!, "fixtures");
const tpl = "ehrbase_blood_pressure_simple.de.v0//";
const data = `${tpl}content/at0000/data/at0001/events/at0002/data/at0003`;
const sys = `${data}/items/at0004/value/value/value`;
const dia = `${data}/items/at0005/value/value/value`;
const setting = `${tpl}context/EVENT_CONTEXT/setting/value`;

const as = (id: string, name: string) => ({ _agentId: id, _agentName: name });

async function loaded(): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { path: join(fx, "blood_pressure.opt") });
  await callAgentTool(service, "load_source_schema", { path: join(fx, "dummy-json-vitals/source.schema.json") });
  await callAgentTool(service, "add_example", { path: join(fx, "dummy-json-vitals/instance-1.json") });
  service.registerAgent({ agentId: "bo", displayName: "Bo" });
  service.registerAgent({ agentId: "cy", displayName: "Cy" });
  return service;
}

const expr = (s: WorkbenchService, id: string) => s.listSlots().find((r) => r.slotId === id)?.expression ?? "";

Deno.test("subtree lease: another agent's map_slot inside it fails, outside it works", async () => {
  const s = await loaded();
  const lease = await callAgentTool(s, "lease_slot", { slotId: data, subtree: true, ...as("bo", "Bo") }) as {
    lease: { covers: number; color?: string; subtree?: boolean };
  };
  assert(lease.lease.covers >= 5);
  assertEquals(lease.lease.subtree, true);
  assert(lease.lease.color);
  await assertRejects(
    () => callAgentTool(s, "map_slot", { slotId: sys, path: "$.systolic", ...as("cy", "Cy") }),
    Error,
    "leased by Bo",
  );
  await callAgentTool(s, "map_slot", { slotId: setting, path: "$.patientId", ...as("cy", "Cy") });
  await callAgentTool(s, "map_slot", { slotId: sys, path: "$.systolic", ...as("bo", "Bo") });
  assertStringIncludes(expr(s, sys), "systolic");
});

Deno.test("an agent's Undo / Revert cannot take back a change in another agent's lease; the person's can", async () => {
  const s = await loaded();
  await callAgentTool(s, "lease_slot", { slotId: dia, ...as("bo", "Bo") });
  await callAgentTool(s, "map_slot", { slotId: dia, path: "$.diastolic", ...as("bo", "Bo") });
  const seq = s.listHistory().at(-1)!.seq;
  await assertRejects(() => callAgentTool(s, "undo", as("cy", "Cy")), Error, "leased by Bo");
  await assertRejects(() => callAgentTool(s, "revert", { seq, ...as("cy", "Cy") }), Error, "leased by Bo");
  assertStringIncludes(expr(s, dia), "diastolic");
  const entries = s.listHistory().length;
  // The person (no agent headers) wins.
  s.setActor({ kind: "user", id: "user", displayName: "You", origin: "human" });
  s.undo();
  assertEquals(expr(s, dia), "");
  assertEquals(s.listHistory().length, entries + 1);
});

Deno.test("a blocked whole-project write (load_bundle) is rolled back: project and history unchanged", async () => {
  const s = await loaded();
  const oldBundle = structuredClone(s.exportBundle());
  await callAgentTool(s, "lease_slot", { slotId: `${tpl}context/EVENT_CONTEXT`, subtree: true, ...as("bo", "Bo") });
  await callAgentTool(s, "map_slot", { slotId: setting, path: "$.unit", ...as("bo", "Bo") });
  const mapped = expr(s, setting);
  assert(mapped);
  const before = s.getRevision();
  const n = s.listHistory().length;
  // Cy loads a project from before Bo's mapping: that would wipe a slot in Bo's subtree.
  await assertRejects(
    () => callAgentTool(s, "load_bundle", { bundle: oldBundle, ...as("cy", "Cy") }),
    Error,
    "leased by Bo",
  );
  assertEquals(expr(s, setting), mapped);
  assertEquals(s.getRevision(), before);
  assertEquals(s.listHistory().length, n);
});

Deno.test("subtree lease on a path with no slots is refused", async () => {
  const s = await loaded();
  await assertRejects(
    () => callAgentTool(s, "lease_slot", { slotId: `${tpl}nope`, subtree: true, ...as("bo", "Bo") }),
    Error,
    "No Target value slots",
  );
});

Deno.test("release_slot all releases every lease of this agent only", async () => {
  const s = await loaded();
  await callAgentTool(s, "lease_slot", { slotId: sys, ...as("bo", "Bo") });
  await callAgentTool(s, "lease_slot", { slotId: `${tpl}context`, subtree: true, ...as("bo", "Bo") });
  await callAgentTool(s, "lease_slot", { slotId: dia, ...as("cy", "Cy") });
  const r = await callAgentTool(s, "release_slot", { all: true, ...as("bo", "Bo") }) as { released: number };
  assertEquals(r.released, 2);
  assertEquals(s.leases.list().map((l) => l.agentId), ["cy"]);
});

Deno.test("two unregistered MCP processes from the same IDE are separate agents over HTTP", async () => {
  const s = await loaded();
  const handler = createAgentApiHandler(s, {});
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, handler);
  const base = `http://127.0.0.1:${server.addr.port}`;
  try {
    const one = new HttpAgentClient(base);
    const two = new HttpAgentClient(base);
    one.setClientName("cursor");
    two.setClientName("cursor");
    const l1 = await one.callTool("lease_slot", { slotId: sys }) as { lease: { displayName: string } };
    assertEquals(l1.lease.displayName, "cursor");
    await assertRejects(() => two.callTool("map_slot", { slotId: sys, path: "$.systolic" }), Error, "leased by cursor");
    const l2 = await two.callTool("lease_slot", { slotId: dia }) as { lease: { displayName: string; agentId: string } };
    assertEquals(l2.lease.displayName, "cursor 2");
    // register_agent after the automatic registration renames the same agent (its lease follows).
    const reg = await two.callTool("register_agent", { displayName: "Bo" }) as { agentId: string };
    assertEquals(reg.agentId, l2.lease.agentId);
    assertEquals(s.leases.list().find((l) => l.agentId === reg.agentId)?.displayName, "Bo");
  } finally {
    await server.shutdown();
  }
});
