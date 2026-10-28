/**
 * Which Target ids a change touches, for the lease check (S-15): slots whose
 * expression or hatch changed, and the attachment slot of an Optional RM
 * Insertion or loop that was added, removed or changed.
 */
import type { ProjectBundle } from "../types/mod.ts";

type Model = ProjectBundle["mapping"]["model"];

function slotPrints(model: Model | undefined): Map<string, string> {
  return new Map(
    (model?.slots ?? []).map((s) => [s.slotId, `${s.expression ?? ""}|${JSON.stringify(s.hatch ?? null)}`]),
  );
}

function keyed<T>(rows: T[] | undefined, key: (row: T) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows ?? []) {
    const k = key(row);
    out.set(k, [...(out.get(k) ?? []), JSON.stringify(row)].sort());
  }
  return out;
}

function diffKeys(a: Map<string, unknown>, b: Map<string, unknown>, empty: string): string[] {
  const ids = new Set([...a.keys(), ...b.keys()]);
  return [...ids].filter((id) => JSON.stringify(a.get(id) ?? empty) !== JSON.stringify(b.get(id) ?? empty));
}

export function changedTargetIds(before: ProjectBundle, after: ProjectBundle): string[] {
  const mb = before.mapping?.model;
  const ma = after.mapping?.model;
  const out = new Set<string>(diffKeys(slotPrints(mb), slotPrints(ma), "|null"));
  for (const id of diffKeys(keyed(mb?.optionalRm, (r) => r.attachmentSlotId), keyed(ma?.optionalRm, (r) => r.attachmentSlotId), "[]")) {
    out.add(id);
  }
  for (const id of diffKeys(keyed(mb?.loops, (r) => r.attachSlotId), keyed(ma?.loops, (r) => r.attachSlotId), "[]")) {
    out.add(id);
  }
  return [...out];
}
