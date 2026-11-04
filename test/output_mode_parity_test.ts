/**
 * Mapping preview and TypeScript output (the Conversion Script) must both give
 * canonical openEHR JSON, and the same composition (#309, #310).
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import type { TestResult } from "@intehrgrator/types/mod.ts";

const catalogPath = join(import.meta.dirname!, "..", "examples", "example-sets.json");
const BP = "/content[openEHR-EHR-SECTION.adhoc.v1]/items[openEHR-EHR-OBSERVATION.blood_pressure.v2]";
const EVENT = `${BP}/data/at0001/events/at0006`;

type RunResult = { valid: boolean; testResult: TestResult };

function asJson(output: unknown): unknown {
  return typeof output === "string" ? JSON.parse(output) : output;
}

async function runBoth(service: WorkbenchService) {
  const preview = await callAgentTool(service, "run_test", { outputMode: "preview" }) as RunResult;
  const typescript = await callAgentTool(service, "run_test", { outputMode: "typescript" }) as RunResult;
  return { preview, typescript };
}

function messages(result: RunResult): string {
  return (result.testResult.outputValidation?.messages ?? [])
    .map((m) => `${m.path} ${m.message}`).join("\n");
}

function find(value: unknown, pred: (rec: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const hits: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const rec = v as Record<string, unknown>;
    if (pred(rec)) hits.push(rec);
    Object.values(rec).forEach(walk);
  };
  walk(value);
  return hits;
}

for (const setId of ["Simple-vitals", "Simple-vitals-series"]) {
  Deno.test(`${setId}: preview and TypeScript output are equal and pass strict validation`, async () => {
    const service = new WorkbenchService();
    await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    const valid = tree.examples.filter((ex) => !ex.filename.includes("invalid"));
    assert(valid.length > 0);
    for (const ex of valid) {
      await callAgentTool(service, "set_active_example", { id: ex.id });
      const { preview, typescript } = await runBoth(service);
      assertEquals(preview.valid, true, `${ex.filename} preview:\n${messages(preview)}`);
      assertEquals(typescript.valid, true, `${ex.filename} typescript:\n${messages(typescript)}`);
      const p = asJson(preview.testResult.output);
      const t = asJson(typescript.testResult.output);
      assertEquals(t, p, `${ex.filename}: TypeScript output differs from preview`);
      // Canonical shapes from the #310 table.
      for (const phrase of find(p, (r) => r._type === "CODE_PHRASE")) {
        assert(typeof phrase.code_string === "string" && !("value" in phrase), JSON.stringify(phrase));
      }
      assertEquals(find(p, (r) => "rmType" in r), []);
      assertEquals(find(p, (r) => r._type === "EVENT_CONTEXT" && "name" in r), []);
      for (const entry of find(p, (r) => r._type === "OBSERVATION" || r._type === "EVALUATION")) {
        assert(entry.subject, `${String(entry.archetype_node_id)} has no subject`);
      }
      for (const enc of find(p, (r) => r._type === "OBSERVATION").map((r) => r.encoding)) {
        assertEquals((enc as { terminology_id?: { value?: string } }).terminology_id?.value, "IANA_character-sets");
      }
    }
  });
}

Deno.test("free text mapped to a coded slot gets the code and template rubric in both modes (#309)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId: "Simple-vitals-unmapped",
    includeMapping: false,
  });
  await callAgentTool(service, "map_slot", {
    slotId: `${EVENT}/state/at0007/items/at0008/value/DV_CODED_TEXT/value`,
    path: "$.bodyPosition",
  });
  await callAgentTool(service, "map_slot", {
    slotId: `${EVENT}/data/at0003/items/at0004/value/value/value`,
    path: "$.systolic",
  });
  const { preview, typescript } = await runBoth(service);
  const p = asJson(preview.testResult.output);
  const t = asJson(typescript.testResult.output);
  assertEquals(t, p);
  const position = find(p, (r) => r.archetype_node_id === "at0008")[0]?.value as Record<string, unknown>;
  assertEquals(position?.value, "Sitting");
  assertEquals((position?.defining_code as { code_string?: string })?.code_string, "at1001");
  // The unmapped set leaves only the RM-mandatory EVENT_CONTEXT.setting open.
  for (const result of [preview, typescript]) {
    assertEquals(
      (result.testResult.outputValidation?.messages ?? []).map((m) => m.message),
      ["EVENT_CONTEXT.setting is required by RM specification"],
      messages(result),
    );
  }
});
