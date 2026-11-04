/**
 * A loop inside a loop may use a LIST path relative to the outer item
 * (`Substanser` inside the treatment-day loop), in preview, TypeScript and XQuery (F-M7).
 */
import { assert, assertEquals } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";

const DAY = "/content/at0000";
const ACTIVITY = `${DAY}/items[openEHR-EHR-INSTRUCTION.medication_order.v3]/activities/at0001`;
const NAME = `${ACTIVITY}/description/at0002/items/at0070/value/DV_TEXT/value`;

const loop = (attachSlotId: string, varName: string, path: string) => ({
  attachSlotId,
  block: {
    type: "for_each_list",
    fields: { VAR: varName },
    inputs: { LIST: { block: { type: "source_query_node", fields: { EXPRESSION: path } } } },
  },
});

/** Substance names of every ACTIVITY in canonical output. */
function substances(output: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec._type === "ELEMENT" && rec.archetype_node_id === "at0070") {
      names.push(String((rec.value as Record<string, unknown> | undefined)?.value ?? ""));
    }
    Object.values(rec).forEach(walk);
  };
  walk(typeof output === "string" ? JSON.parse(output) : output);
  return names;
}

Deno.test("nested loop with a relative LIST walks from the outer item (F-M7)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "karda-ordinationsdata-to-openehr-flat-unmapped", includeMapping: false });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: snap.templateId,
      loops: [loop(DAY, "dag", "$.KurDagar"), loop(ACTIVITY, "substans", "Substanser")],
      suggestions: [{ slotId: NAME, loopVar: "substans", block: { type: "source_query", fields: { EXPRESSION: "Innholdstoff_Navn" } } }],
    }),
  }) as { report: { applied: number; errors: string[]; loopsAccepted?: number } };
  assertEquals(imported.report.applied, 1, imported.report.errors.join("; "));
  assertEquals(imported.report.loopsAccepted, 2);
  await ensureXQueryRuntime();
  const found = [];
  for (const outputMode of ["preview", "typescript", "xquery"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
    found.push(substances(run.testResult.output));
  }
  assert(found[0]!.length >= 2 && found[0]!.every((name) => name.trim()), JSON.stringify(found));
  assertEquals(found[1], found[0]);
  assertEquals(found[2], found[0]);
});
