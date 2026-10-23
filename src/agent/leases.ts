/**
 * Advisory leases for parallel Agent API / MCP writers (S-15).
 *
 * A lease is on one Target value slot (`slotId`) or, with `subtree`, on a
 * node path: every slot whose id is that path or starts with `path + "/"`
 * (e.g. `…//context/EVENT_CONTEXT` covers all context slots). While an MCP
 * agent holds a lease, other MCP agents cannot change what it covers. The
 * person in the UI (and the in-app AI chat) is never blocked: the canvas
 * shows the lease instead (ADR 0014: the person wins).
 */

export interface SlotLease {
  /** Slot id, or for a subtree lease the node path. */
  slotId: string;
  /** True when `slotId` is a node path covering every slot below it. */
  subtree?: boolean;
  agentId: string;
  displayName: string;
  /** Agent colour (from `register_agent`), for the canvas marker. */
  color?: string;
  expiresAt: number;
}

/** Does a lease on `key` (`subtree` or not) cover slot or node `id`? */
export function leaseCovers(lease: Pick<SlotLease, "slotId" | "subtree">, id: string): boolean {
  return id === lease.slotId || (lease.subtree === true && id.startsWith(`${lease.slotId}/`));
}

/** Two leases overlap when either covers the other's key. */
function overlaps(a: Pick<SlotLease, "slotId" | "subtree">, b: Pick<SlotLease, "slotId" | "subtree">): boolean {
  return leaseCovers(a, b.slotId) || leaseCovers(b, a.slotId);
}

export class SlotLeaseRegistry {
  /** Keyed by `slotId` plus `/**` for subtree leases. */
  private readonly leases = new Map<string, SlotLease>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  list(): SlotLease[] {
    this.purgeExpired();
    return [...this.leases.values()].map((row) => ({ ...row }));
  }

  get(slotId: string): SlotLease | undefined {
    this.purgeExpired();
    const row = this.leases.get(slotId) ?? this.leases.get(`${slotId}/**`);
    return row ? { ...row } : undefined;
  }

  /**
   * Acquire or renew. Returns the lease, or the foreign holder of an
   * overlapping lease when blocked (a slot inside someone's subtree, or a
   * subtree containing someone's slot).
   */
  acquire(
    slotId: string,
    agent: { agentId: string; displayName?: string; color?: string },
    ttlSec = 120,
    subtree = false,
  ): { ok: true; lease: SlotLease } | { ok: false; holder: SlotLease } {
    this.purgeExpired();
    const ttl = Math.min(Math.max(1, Math.floor(ttlSec)), 3600) * 1000;
    const want = { slotId, subtree };
    for (const existing of this.leases.values()) {
      if (existing.agentId !== agent.agentId && overlaps(existing, want)) {
        return { ok: false, holder: { ...existing } };
      }
    }
    const lease: SlotLease = {
      slotId,
      ...(subtree ? { subtree: true } : {}),
      agentId: agent.agentId,
      displayName: agent.displayName?.trim() || agent.agentId,
      ...(agent.color ? { color: agent.color } : {}),
      expiresAt: this.now() + ttl,
    };
    this.leases.set(keyOf(slotId, subtree), lease);
    return { ok: true, lease: { ...lease } };
  }

  /** Release one lease (slot or subtree key). Only the holder may, when `agentId` is given. */
  release(slotId: string, agentId?: string, subtree?: boolean): boolean {
    this.purgeExpired();
    const keys = subtree === undefined ? [keyOf(slotId, false), keyOf(slotId, true)] : [keyOf(slotId, subtree)];
    let released = false;
    for (const key of keys) {
      const existing = this.leases.get(key);
      if (!existing) continue;
      if (agentId && existing.agentId !== agentId) continue;
      this.leases.delete(key);
      released = true;
    }
    return released;
  }

  /** Release every lease `agentId` holds; returns how many. */
  releaseAll(agentId: string): number {
    let n = 0;
    for (const [key, row] of this.leases) {
      if (row.agentId === agentId) {
        this.leases.delete(key);
        n++;
      }
    }
    return n;
  }

  /** Leases held by someone other than `agentId` that cover any id in `ids` (one row per lease). */
  foreignHeld(ids: Iterable<string>, agentId?: string): SlotLease[] {
    this.purgeExpired();
    const out = new Map<string, SlotLease>();
    const foreign = [...this.leases.entries()].filter(([, row]) => row.agentId !== agentId);
    if (!foreign.length) return [];
    for (const id of ids) {
      for (const [key, row] of foreign) {
        if (!out.has(key) && leaseCovers(row, id)) out.set(key, { ...row, slotId: row.slotId });
      }
    }
    return [...out.values()];
  }

  /** For each id in `ids`, the foreign lease covering it (slot id → lease). */
  foreignHolders(ids: Iterable<string>, agentId?: string): Map<string, SlotLease> {
    this.purgeExpired();
    const out = new Map<string, SlotLease>();
    for (const id of ids) {
      for (const row of this.leases.values()) {
        if (row.agentId !== agentId && leaseCovers(row, id)) {
          out.set(id, { ...row });
          break;
        }
      }
    }
    return out;
  }

  private purgeExpired(): void {
    const t = this.now();
    for (const [id, row] of this.leases) {
      if (row.expiresAt <= t) this.leases.delete(id);
    }
  }
}

function keyOf(slotId: string, subtree: boolean): string {
  return subtree ? `${slotId}/**` : slotId;
}
