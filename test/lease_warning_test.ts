import { assertEquals } from "@std/assert";
import {
  formatCountdown,
  leaseHits,
  leaseKey,
  pruneAcknowledged,
  remainingByHit,
} from "@intehrgrator/web/lease_warning.ts";
import type { SlotLease } from "@intehrgrator/agent/leases.ts";

const tree = "t//content/at0000/data/at0003";
const sys = `${tree}/items/at0004/value`;
const dia = `${tree}/items/at0005/value`;
const other = "t//context/setting/value";
const now = 1_000_000;
const bo: SlotLease = { slotId: tree, subtree: true, agentId: "bo", displayName: "Bo", expiresAt: now + 65_000 } as SlotLease;
const cy: SlotLease = { slotId: other, agentId: "cy", displayName: "Cy", expiresAt: now + 9_000 } as SlotLease;

Deno.test("lease warning: a change inside a subtree lease hits it, with the covered slots", () => {
  const hits = leaseHits([sys, dia, "t//elsewhere"], [bo, cy], new Set(), now);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].lease.agentId, "bo");
  assertEquals(hits[0].slotIds, [sys, dia]);
});

Deno.test("lease warning: an acknowledged (Edit anyway) or expired lease does not warn", () => {
  assertEquals(leaseHits([sys], [bo], new Set([leaseKey(bo)]), now), []);
  assertEquals(leaseHits([sys], [bo], new Set(), bo.expiresAt), []);
  assertEquals(leaseHits([other], [cy], new Set(), now).length, 1);
});

Deno.test("lease warning: acknowledgements end with the lease, so a new lease warns again", () => {
  const acked = new Set([leaseKey(bo), leaseKey(cy)]);
  pruneAcknowledged(acked, [bo], now);
  assertEquals([...acked], [leaseKey(bo)]);
  // A renewal (same agent, same part, later expiry) is the same lease.
  pruneAcknowledged(acked, [{ ...bo, expiresAt: now + 120_000 }], now);
  assertEquals([...acked], [leaseKey(bo)]);
  pruneAcknowledged(acked, [], now);
  assertEquals(acked.size, 0);
});

Deno.test("lease warning: countdown follows renewals and releases", () => {
  const hits = leaseHits([sys, other], [bo, cy], new Set(), now);
  assertEquals(remainingByHit(hits, [bo, cy], now), [65_000, 9_000]);
  assertEquals(remainingByHit(hits, [{ ...bo, expiresAt: now + 100_000 }], now), [100_000, 0]);
  assertEquals(formatCountdown(65_000), "1:05");
  assertEquals(formatCountdown(8_200), "0:09");
  assertEquals(formatCountdown(-5), "0:00");
});
