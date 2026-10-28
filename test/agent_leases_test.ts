import { assertEquals } from "@std/assert";
import { SlotLeaseRegistry } from "@intehrgrator/agent/leases.ts";

Deno.test("SlotLeaseRegistry acquire, renew, foreign block, expiry", () => {
  let now = 1_000_000;
  const leases = new SlotLeaseRegistry(() => now);

  const a = leases.acquire("slot/a", { agentId: "agent-a", displayName: "A" }, 2);
  assertEquals(a.ok, true);
  const blocked = leases.acquire("slot/a", { agentId: "agent-b", displayName: "B" }, 2);
  assertEquals(blocked.ok, false);
  if (!blocked.ok) assertEquals(blocked.holder.agentId, "agent-a");

  const renewed = leases.acquire("slot/a", { agentId: "agent-a" }, 5);
  assertEquals(renewed.ok, true);

  now += 6_000;
  const afterTtl = leases.acquire("slot/a", { agentId: "agent-b" }, 2);
  assertEquals(afterTtl.ok, true);

  assertEquals(leases.release("slot/a", "agent-b"), true);
  assertEquals(leases.foreignHeld(["slot/a"], "agent-a").length, 0);
});

Deno.test("SlotLeaseRegistry foreignHeld lists other agents only", () => {
  const leases = new SlotLeaseRegistry(() => 10);
  leases.acquire("s1", { agentId: "a" }, 10);
  leases.acquire("s2", { agentId: "b" }, 10);
  const held = leases.foreignHeld(["s1", "s2", "s3"], "a");
  assertEquals(held.map((h) => h.slotId), ["s2"]);
});

Deno.test("subtree lease covers slots below its node path and blocks overlapping leases", () => {
  const leases = new SlotLeaseRegistry(() => 10);
  assertEquals(leases.acquire("t//context/EVENT_CONTEXT", { agentId: "a", displayName: "Ada" }, 60, true).ok, true);
  // A slot inside someone else's subtree, and a bigger subtree around it, are blocked.
  assertEquals(leases.acquire("t//context/EVENT_CONTEXT/setting/value", { agentId: "b" }, 60).ok, false);
  assertEquals(leases.acquire("t//context", { agentId: "b" }, 60, true).ok, false);
  // A sibling path that only shares a text prefix is not covered.
  assertEquals(leases.acquire("t//context/EVENT_CONTEXT_X/value", { agentId: "b" }, 60).ok, true);
  const held = leases.foreignHolders(["t//context/EVENT_CONTEXT/start_time/value", "t//content/x"], "b");
  assertEquals([...held.keys()], ["t//context/EVENT_CONTEXT/start_time/value"]);
  assertEquals(held.get("t//context/EVENT_CONTEXT/start_time/value")?.subtree, true);
  // The holder itself may write inside its subtree.
  assertEquals(leases.foreignHolders(["t//context/EVENT_CONTEXT/setting/value"], "a").size, 0);
  assertEquals(leases.releaseAll("a"), 1);
  assertEquals(leases.acquire("t//context", { agentId: "b" }, 60, true).ok, true);
});
