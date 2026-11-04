/**
 * A composer / health_care_facility mapped as map(name, id) reaches the canvas:
 * it is saved in the Blockly state, used by TypeScript mode and kept when the
 * instance encoding changes (F-M15, F-M5, F-M4).
 */
import { assert, assertEquals } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const ROOT = "OrdineradMedicinskOnkologiskBehandling_MedKurdag/";
const COMPOSER = `${ROOT}/composer`;
const FACILITY = `${ROOT}/context/EVENT_CONTEXT/health_care_facility`;

const text = (value: string) => ({ block: { type: "text", fields: { TEXT: value } } });
const party = (name: string, id: string) => ({
  type: "maps_create_with",
  extraState: { itemCount: 2 },
  fields: { KEY0: "name", KEY1: "id" },
  inputs: { VAL0: text(name), VAL1: text(id) },
});

function parties(output: unknown): Array<string | undefined> {
  const flat = (typeof output === "string" ? JSON.parse(output) : output) as Record<string, unknown>;
  const find = (suffix: string) => Object.entries(flat).find(([k]) => k.endsWith(suffix))?.[1] as string | undefined;
  return [find("/composer|name"), find("/_health_care_facility|name")];
}

Deno.test("party map on composer and facility is saved on the canvas and survives an encoding change", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "karda-ordinationsdata-to-openehr-flat-unmapped", includeMapping: false });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: snap.templateId,
      suggestions: [
        { slotId: COMPOSER, block: party("Dr Mapped", "HSA-1") },
        { slotId: FACILITY, block: party("Mapped unit", "HSA-2") },
      ],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 2, imported.report.errors.join("; "));

  const state = JSON.stringify((service as unknown as { controller: { getState(): { blocklyState: unknown } } })
    .controller.getState().blocklyState);
  assert(state.includes("Dr Mapped") && state.includes("Mapped unit"), "the canvas keeps the party map");

  await callAgentTool(service, "set_instance_encoding", { encoding: "flat-json" });
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
    assertEquals(parties(run.testResult.output), ["Dr Mapped", "Mapped unit"], outputMode);
  }
});
