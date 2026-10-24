/**
 * #277 §1–3: compact slot tree (one id per slot, grouped rows), resolution
 * of every id form back to skeleton ids, `list_slots` tree view, and
 * `get_slot` for OPT, XSD and JSON Schema targets.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { listSlotsInspect } from "@intehrgrator/agent/inspect.ts";
import {
  buildSlotTree,
  compactSlotId,
  formatSlotTree,
  resolveSlotPrefix,
  resolveSlotRef,
  type SlotTreeGroup,
} from "@intehrgrator/core/ai/slot_tree.ts";
import { compactJsonRows } from "@intehrgrator/core/ai/mod.ts";

const FIX = join(import.meta.dirname!, "fixtures");
const SDV = join(FIX, "simple-diagnose-and-vitals.opt");
const TAKECARE = join(FIX, "TakeCare", "TakeCare-CasenoteWrite-edit01.xsd");
const VITALS = join(FIX, "dummy-json-vitals");

async function serviceWith(target: string): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { filename: target.split("/").pop(), content: await Deno.readTextFile(target) });
  return service;
}

async function vitalsService(): Promise<WorkbenchService> {
  const service = await serviceWith(join(VITALS, "target.schema.json"));
  await callAgentTool(service, "load_source_schema", {
    filename: "source.schema.json",
    content: await Deno.readTextFile(join(VITALS, "source.schema.json")),
  });
  await callAgentTool(service, "add_example", {
    filename: "instance-1.json",
    content: await Deno.readTextFile(join(VITALS, "instance-1.json")),
  });
  return service;
}

const rowsOf = (groups: SlotTreeGroup[]) => groups.flatMap((g) => g.slots.map((r) => ({ ...r, full: `${g.group}${r.id}`, g })));

Deno.test("compactSlotId drops the target prefix of openEHR, JSON Schema and XSD ids (#277)", () => {
  assertEquals(compactSlotId("tpl//content[openEHR-EHR-OBSERVATION.bp.v2]/data/at0001/value"), "/content[openEHR-EHR-OBSERVATION.bp.v2]/data/at0001/value");
  assertEquals(compactSlotId("tpl/language/value"), "/language/value");
  assertEquals(compactSlotId("tpl"), "/");
  assertEquals(compactSlotId("https://example.invalid/t.schema.json:$.systolic"), "$.systolic");
  assertEquals(compactSlotId("/A/@Type:/A/@Type"), "/A/@Type");
  assertEquals(compactSlotId("A:/A"), "/A");
});

Deno.test("resolveSlotRef accepts full, // variant, compact and unique tail ids (#277)", () => {
  const known = new Set([
    "tpl//content[x]/events/at0006/data/at0004/value",
    "tpl//content[x]/events/at0006/time/value",
    "tpl//content[y]/events/at0003/time/value",
    "https://t:$.systolic",
  ]);
  assertEquals(resolveSlotRef("tpl//content[x]/events/at0006/time/value", known), "tpl//content[x]/events/at0006/time/value");
  assertEquals(resolveSlotRef("tpl/content[x]/events/at0006/time/value", known), "tpl//content[x]/events/at0006/time/value");
  assertEquals(resolveSlotRef("/content[x]/events/at0006/time/value", known), "tpl//content[x]/events/at0006/time/value");
  assertEquals(resolveSlotRef("/data/at0004/value", known), "tpl//content[x]/events/at0006/data/at0004/value");
  assertEquals(resolveSlotRef("$.systolic", known), "https://t:$.systolic");
  assertEquals(resolveSlotRef(".systolic", known), "https://t:$.systolic");
  // Ambiguous tail and unknown ids stay unresolved.
  assertEquals(resolveSlotRef("/time/value", known), null);
  assertEquals(resolveSlotRef("/nope", known), null);
  assertEquals(resolveSlotPrefix("/content[x]/events/at0006", known), "tpl//content[x]/events/at0006");
});

Deno.test("SDV slot tree groups loop slots once, with units, codes and short ids (#277)", async () => {
  const service = await serviceWith(SDV);
  const groups = (await callAgentTool(service, "list_slots", {}) as { groups: SlotTreeGroup[] }).groups;
  const bp = groups.find((g) => g.loop && g.group.includes("blood_pressure") && g.group.endsWith("/events/at0006"));
  assert(bp, "blood pressure event group");
  assertEquals(bp.label, "Vital signs › Blood pressure › History › Any event");
  assertEquals(bp.type, "POINT_EVENT");
  const systolic = bp.slots.find((r) => r.label === "Systolic")!;
  assertEquals(systolic.id, "/data/at0003/items/at0004/value/value/value");
  assertEquals(systolic.type, "DV_QUANTITY");
  assertEquals(systolic.fixed, { units: "mm[Hg]" });
  const position = bp.slots.find((r) => r.label === "Position")!;
  assertEquals(position.fixed?.terminology ?? position.terminology, "local");
  assertEquals(position.values?.[0], { code: "at1000", text: "Standing" });
  // No pathLabel / attachSlotId / repeated targetId in rows.
  const text = formatSlotTree(groups);
  assertEquals(text.includes("pathLabel"), false);
  assertEquals(text.includes("simple-diagnose-and-vitals//"), false);
  // Every row resolves back to its skeleton id.
  const ids = new Set(listSlotsInspect(service["controller"].getState().skeleton, service["controller"].getState().model).map((r) => r.slotId));
  for (const row of rowsOf(groups)) assert(resolveSlotRef(row.full, ids), row.full);
});

Deno.test("compact rows are smaller than today's manifest rows; TakeCare tree is smaller than its XSD (#277)", async () => {
  for (const target of [SDV, TAKECARE, join(VITALS, "target.schema.json"), join(FIX, "Obstetrix-MHV1", "target", "mhv1-prenatal-visit.encounter.v1.opt")]) {
    const service = await serviceWith(target);
    const s = service["controller"].getState();
    const legacy = compactJsonRows(listSlotsInspect(s.skeleton, s.model).map(({ mapped: _m, ...row }) => row));
    const tree = formatSlotTree(buildSlotTree(s.skeleton));
    assert(tree.length < legacy.length, `${target}: tree ${tree.length} ≥ rows ${legacy.length}`);
    if (target === TAKECARE) {
      const xsd = await Deno.readTextFile(TAKECARE);
      assert(tree.length < xsd.length, `TakeCare tree ${tree.length} ≥ XSD ${xsd.length}`);
    }
  }
});

Deno.test("map_slot, import_suggestions and lease_slot accept compact slot-tree ids (#277)", async () => {
  const service = await vitalsService();
  const groups = (await callAgentTool(service, "list_slots", {}) as { groups: SlotTreeGroup[] }).groups;
  const rows = rowsOf(groups);
  const systolic = rows.find((r) => r.full === "$.systolic")!;
  assertEquals(systolic.full, "$.systolic");
  const mapped = await callAgentTool(service, "map_slot", { slotId: systolic.full, path: "$.systolic" }) as { slotId: string };
  assertEquals(mapped.slotId, "https://example.invalid/dummy-json-vitals/target.schema.json:$.systolic");
  const report = (await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      suggestions: [{ slotId: "$.diastolic", block: { type: "source_query_number", fields: { EXPRESSION: "$.diastolic" } } }],
    }),
  }) as { report: { applied: number } }).report;
  assertEquals(report.applied, 1);
  const after = (await callAgentTool(service, "list_slots", {}) as { groups: SlotTreeGroup[] }).groups;
  const exprs = rowsOf(after).filter((r) => r.expr).map((r) => r.full).sort();
  assertEquals(exprs, ["$.diastolic", "$.systolic"]);
  const lease = await callAgentTool(service, "lease_slot", { slotId: "$.unit" }) as { lease: { slotId: string } };
  assertEquals(lease.lease.slotId, "https://example.invalid/dummy-json-vitals/target.schema.json:$.unit");
  // The older flat view is still there.
  const legacy = await callAgentTool(service, "list_slots", { view: "rows" }) as { slots: Array<{ slotId: string }> };
  assert(legacy.slots.some((r) => r.slotId.endsWith(":$.systolic")));
});

Deno.test("get_slot returns the target's constraint for JSON Schema, XSD and OPT slots (#277)", async () => {
  const vitals = await vitalsService();
  await callAgentTool(vitals, "map_slot", { slotId: "$.systolic", path: "$.systolic", note: "check units" });
  const js = (await callAgentTool(vitals, "get_slot", { id: "$.systolic" }) as { slot: Record<string, unknown> }).slot;
  assertEquals(js.id, "$.systolic");
  assertEquals((js.constraint as { kind: string }).kind, "json-schema");
  assertEquals(((js.constraint as { value: { type?: string } }).value).type, "number");
  assertEquals((js.mapping as { expression: string; note?: string }).note, "check units");

  const takecare = await serviceWith(TAKECARE);
  const tc = (await callAgentTool(takecare, "get_slot", { id: "/ProfdocHISMessage/@MsgType" }) as { slot: Record<string, unknown> }).slot;
  assertEquals(tc.id, "/ProfdocHISMessage/@MsgType");
  const xsd = tc.constraint as { kind: string; value: { name: string; xmlKind: string } };
  assertEquals(xsd.kind, "xsd");
  assertEquals(xsd.value.name, "MsgType");
  assertEquals(xsd.value.xmlKind, "attribute");

  const sdv = await serviceWith(SDV);
  const groups = (await callAgentTool(sdv, "list_slots", {}) as { groups: SlotTreeGroup[] }).groups;
  const position = rowsOf(groups).find((r) => r.label === "Position")!;
  const pos = (await callAgentTool(sdv, "get_slot", { id: position.full }) as { slot: Record<string, unknown> }).slot;
  assertEquals((pos.constraint as { kind: string }).kind, "openehr");
  assertEquals((pos.values as unknown[]).length, 5);
  assertStringIncludes(String(pos.attachSlotId), "/events/at0006");
  assertStringIncludes(String(pos.archetypeId), "blood_pressure");
});

Deno.test("the copy & paste prompt carries the slot tree instead of the manifest (#277)", async () => {
  const service = await serviceWith(SDV);
  const prompt = service["controller"].buildAiPromptText("attach");
  assertStringIncludes(prompt, "## Slot tree");
  assertEquals(prompt.includes("## Slot manifest"), false);
  assertEquals(prompt.includes("## Repeatable containers"), false);
  assertStringIncludes(prompt, '"loop":true');
});

Deno.test("HTTP Agent API: GET /slots is the tree, GET /slot?id= one slot (#277)", async () => {
  const { createAgentApiHandler } = await import("@intehrgrator/agent/http.ts");
  const service = await vitalsService();
  const handler = createAgentApiHandler(service);
  const tree = await (await handler(new Request("http://local/api/v1/slots"))).json() as { groups: SlotTreeGroup[] };
  assertEquals(tree.groups[0]!.slots.some((r) => r.id === ".systolic" || `${tree.groups[0]!.group}${r.id}` === "$.systolic"), true);
  const res = await handler(new Request(`http://local/api/v1/slot?id=${encodeURIComponent("$.systolic")}`));
  assertEquals(res.status, 200);
  const body = await res.json() as { slot: { slotId: string } };
  assertEquals(body.slot.slotId, "https://example.invalid/dummy-json-vitals/target.schema.json:$.systolic");
});
