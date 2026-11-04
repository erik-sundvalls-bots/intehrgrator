/**
 * TypeScript mode leaves out an ELEMENT whose source value is missing, as the
 * preview does, instead of an empty ELEMENT or a NaN magnitude (F-M2, F-M10).
 */
import { assert, assertEquals } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const OBS = "simple-diagnose-and-vitals//content[openEHR-EHR-SECTION.adhoc.v1]/items[openEHR-EHR-OBSERVATION.blood_pressure.v2]";
const EVENT = `${OBS}/data/at0001/events/at0006`;

type Run = { valid?: boolean; testResult: { output: unknown; outputValidation?: { messages: Array<{ message: string }> } } };

function collect(node: unknown, pred: (rec: Record<string, unknown>) => boolean, out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(node)) node.forEach((item) => collect(item, pred, out));
  else if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (pred(rec)) out.push(rec);
    Object.values(rec).forEach((value) => collect(value, pred, out));
  }
  return out;
}

async function mappedSeries(): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-series-unmapped", includeMapping: false });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const query = (expression: string, type = "source_query") => ({ block: { type, fields: { EXPRESSION: expression } } });
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      loops: [{
        attachSlotId: EVENT,
        block: { type: "for_each_source", fields: { VAR: "measurement", PATH: "$.measurements" } },
      }],
      suggestions: [
        { slotId: `${EVENT}/data/at0003/items/at0004/value/value/value`, loopVar: "measurement", block: query("systolic", "source_query_number").block },
        { slotId: `${EVENT}/time/value`, loopVar: "measurement", block: query("timestamp").block },
        { slotId: `${EVENT}/state/at0007/items/at0008/value/DV_CODED_TEXT/value`, loopVar: "measurement", block: query("bodyPosition").block },
      ],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 3, imported.report.errors.join("; "));
  return service;
}

Deno.test("TypeScript leaves out a coded ELEMENT whose loop item has no value, as preview (F-M2)", async () => {
  const service = await mappedSeries();
  const listed = await callAgentTool(service, "list_examples", {}) as { examples: Array<{ id: string; filename?: string }> };
  const example = listed.examples.find((row) => row.filename === "bp-series-inst-2.json");
  assert(example);
  await callAgentTool(service, "set_active_example", { id: example.id });
  const positions: number[] = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode, outputFormat: "canonical" }) as Run;
    const messages = (run.testResult.outputValidation?.messages ?? []).map((m) => m.message);
    assertEquals(messages.filter((m) => m.includes("null_flavour")), [], outputMode);
    const output = typeof run.testResult.output === "string" ? JSON.parse(run.testResult.output) : run.testResult.output;
    positions.push(collect(output, (rec) => rec.archetype_node_id === "at0008").length);
    // No ELEMENT without a value and no quantity without a magnitude.
    assertEquals(collect(output, (rec) => rec._type === "ELEMENT" && rec.value == null && rec.null_flavour == null), [], outputMode);
  }
  // Four measurements, the fourth without a body position.
  assertEquals(positions, [3, 3]);
});
