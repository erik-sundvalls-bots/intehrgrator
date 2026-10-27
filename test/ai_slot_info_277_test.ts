/**
 * #277 enrichment: slot-tree rows and `get_slot` carry meaning, ranges,
 * patterns, value descriptions … from OPT (Web Template), XSD and JSON Schema.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import type { SlotTreeGroup, SlotTreeRow } from "@intehrgrator/core/ai/slot_tree.ts";
import { aqlToSkeletonPath, shortText } from "@intehrgrator/core/ai/slot_info.ts";

const FIX = join(import.meta.dirname!, "fixtures");
const REF = join(FIX, "multilingual-referral");

async function tree(target: string): Promise<{ service: WorkbenchService; groups: SlotTreeGroup[]; rows: Array<SlotTreeRow & { full: string }> }> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { filename: target.split("/").pop(), content: await Deno.readTextFile(target) });
  const groups = (await callAgentTool(service, "list_slots", {}) as { groups: SlotTreeGroup[] }).groups;
  return { service, groups, rows: groups.flatMap((g) => g.slots.map((r) => ({ ...r, full: `${g.group}${r.id}` }))) };
}

Deno.test("shortText and aqlToSkeletonPath", () => {
  assertEquals(shortText("First one. Second one."), "First one.");
  assertEquals(shortText("x".repeat(200))!.length, 160);
  assertEquals(
    aqlToSkeletonPath("/content[openEHR-EHR-OBSERVATION.bp.v2,'BP']/data[at0001]/events[at0006,'Any event']/data[at0003]/items[at0004]"),
    "/content[openEHR-EHR-OBSERVATION.bp.v2]/data/at0001/events/at0006/data/at0003/items/at0004",
  );
});

Deno.test("SDV rows: English descriptions, quantity range, coded values; group description once (#277)", async () => {
  const { groups, rows } = await tree(join(FIX, "simple-diagnose-and-vitals.opt"));
  const systolic = rows.find((r) => r.label === "Systolic")!;
  assertEquals(systolic.description, "Peak systemic arterial blood pressure - measured in systolic or contraction phase of the heart cycle.");
  assertEquals(systolic.range, { min: 0, maxExclusive: 1000 });
  assertEquals(systolic.fixed, { units: "mm[Hg]" });
  const position = rows.find((r) => r.label === "Position")!;
  assertEquals(position.description, "The position of the individual at the time of measurement.");
  assertEquals(position.values?.[0]?.text, "Standing");
  const diagnosis = rows.find((r) => r.label === "Problem/Diagnosis name")!;
  assertEquals(diagnosis.description, "Identification of the problem or diagnosis, by name.");
  // The element's `name/value` slot does not repeat the element's meaning.
  const nameRow = rows.find((r) => r.full.endsWith("/items/at0004/name/value") && r.full.includes("blood_pressure"));
  if (nameRow) assertEquals(nameRow.description, undefined);
  // Archetype description appears once, on a group, not on rows.
  const bpDesc = "The local measurement of arterial blood pressure which is a surrogate for arterial pressure in the systemic circulation.";
  assertEquals(rows.some((r) => r.description === bpDesc), false);
  assert(groups.length > 0);
});

Deno.test("XSD target: name as label, docs as description, facets and enumeration docs (#277)", async () => {
  const { rows } = await tree(join(REF, "referral.xsd"));
  const by = (tail: string) => rows.find((r) => r.full.endsWith(tail))!;
  const pid = by("/PatientId");
  assertEquals(pid.label, undefined, "label = element name, so it is omitted");
  assertEquals(pid.description, "Swedish personal identity number, 12 digits.");
  assertEquals(pid.pattern, "[0-9]{12}");
  const prio = by("/Priority");
  assertEquals(prio.values, [{ code: "ROUTINE", description: "Within 90 days" }, { code: "URGENT", description: "Within 7 days" }]);
  assertEquals(by("/Systolic").range, { min: 0, max: 400 });
  assertEquals(by("/@primary").description, "True for the main diagnosis.");
});

Deno.test("JSON Schema target: title / description / enum + x-enumDescriptions / range / format / examples (#277)", async () => {
  const { rows, service } = await tree(join(REF, "referral.schema.json"));
  const by = (tail: string) => rows.find((r) => r.full.endsWith(tail))!;
  const prio = by("$.priority");
  assertEquals(prio.description, "How urgent the referral is.");
  assertEquals(prio.values, [{ code: "ROUTINE", description: "Within 90 days" }, { code: "URGENT", description: "Within 7 days" }]);
  assertEquals(prio.default, "ROUTINE");
  const sys = by("$.systolic");
  assertEquals(sys.description, "Latest systolic blood pressure in mmHg.");
  assertEquals(sys.range, { min: 0, max: 400 });
  assertEquals(sys.comment, "Leave out when not measured.");
  assertEquals(by("$.patientId").examples, ["191212121212"]);
  assertEquals(by("$.referralDate").format, "date");
  assertEquals(by("$.note").length, { min: 1, max: 500 });
  // get_slot: full text and every language.
  const slot = (await callAgentTool(service, "get_slot", { id: "$.systolic" }) as { slot: { info: { description: string; descriptions: Record<string, string>; labels: Record<string, string> } } }).slot;
  assertEquals(slot.info.description, "Latest systolic blood pressure in mmHg. Measured sitting.");
  assertEquals(slot.info.labels.sv, "Systoliskt");
  assertEquals(slot.info.descriptions.sv, "Senaste systoliska blodtrycket i mmHg.");
});

Deno.test("get_slot on SDV adds the full description and the archetype's meaning (#277)", async () => {
  const { service, rows } = await tree(join(FIX, "simple-diagnose-and-vitals.opt"));
  const systolic = rows.find((r) => r.label === "Systolic")!;
  const slot = (await callAgentTool(service, "get_slot", { id: systolic.full }) as {
    slot: { info: { description: string; range: unknown }; groupInfo?: { description: string } };
  }).slot;
  assertEquals(slot.info.range, { min: 0, maxExclusive: 1000 });
  assert(slot.groupInfo?.description.length, "group description");
});
