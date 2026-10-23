/**
 * Warning before the person changes something an MCP agent leases (S-15,
 * ADR 0014: the person wins). Pure helpers; the dialog lives in web/main.ts.
 *
 * - The warning comes once per lease: after "Edit anyway" further edits
 *   inside the same lease go through without asking until that lease ends.
 * - A change is checked when it would be committed (end of a drag, a field
 *   edit, a click-to-map), so typing in a field never asks per keystroke.
 */
import { leaseCovers, type SlotLease } from "../agent/leases.ts";

export interface LeaseHit {
  lease: SlotLease;
  slotIds: string[];
}

/** Identity of one lease: the same agent re-leasing the same part is the same lease (a renewal). */
export function leaseKey(lease: Pick<SlotLease, "agentId" | "slotId" | "subtree">): string {
  return `${lease.agentId}|${lease.slotId}${lease.subtree ? "/**" : ""}`;
}

/** Live leases that cover any of `changed`, minus those already acknowledged. */
export function leaseHits(
  changed: string[],
  leases: SlotLease[],
  acknowledged: ReadonlySet<string>,
  now: number,
): LeaseHit[] {
  const hits = new Map<string, LeaseHit>();
  for (const lease of leases) {
    if (lease.expiresAt <= now || acknowledged.has(leaseKey(lease))) continue;
    const slotIds = changed.filter((id) => leaseCovers(lease, id));
    if (slotIds.length) hits.set(leaseKey(lease), { lease, slotIds });
  }
  return [...hits.values()];
}

/** Forget acknowledgements of leases that ended, so a new lease on the same part warns again. */
export function pruneAcknowledged(acknowledged: Set<string>, leases: SlotLease[], now: number): void {
  const live = new Set(leases.filter((l) => l.expiresAt > now).map(leaseKey));
  for (const key of [...acknowledged]) if (!live.has(key)) acknowledged.delete(key);
}

/**
 * Milliseconds left on each hit's lease, from the newest lease list (renewed
 * leases count from their new expiry; a released lease is 0).
 */
export function remainingByHit(hits: LeaseHit[], leases: SlotLease[], now: number): number[] {
  const byKey = new Map(leases.map((l) => [leaseKey(l), l]));
  return hits.map((hit) => Math.max(0, (byKey.get(leaseKey(hit.lease))?.expiresAt ?? 0) - now));
}

/** "1:05", "0:09". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
