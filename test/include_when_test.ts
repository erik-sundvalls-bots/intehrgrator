/**
 * Include when omits an optional EVENT. Existence drops a measurement with no
 * pulse. A value comparison drops pulses that fail the test. Preview and
 * TypeScript agree. A required node is flagged.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators, workspaceToModelJson } from "@intehrgrator/blockly/mod.ts";
import { VMS_REMOVED_BLOCK_TYPES } from "@intehrgrator/blockly/vms.ts";
import { buildDemoToolbox, toolboxBlockTypes } from "@intehrgrator/blockly/toolbox_demo.ts";
import {
  applyExpressionEdit,
  createEmptyModel,
  upsertLoop,
  validateModel,
} from "@intehrgrator/core/mapping_model/mod.ts";
import {
  collectValueSlots,
  findSkeletonTrail,
  nearestRepeatingContainer,
} from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

function findPulseEvents(node: unknown): Array<{
  time?: { value?: string };
  data?: { items?: Array<{ archetype_node_id?: string; value?: { magnitude?: number } }> };
}> {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(findPulseEvents);
  const rec = node as Record<string, unknown>;
  if (rec.archetype_node_id === "openEHR-EHR-OBSERVATION.pulse.v2") {
    const data = rec.data as { events?: unknown } | undefined;
    return Array.isArray(data?.events) ? data.events as Array<{
      time?: { value?: string };
      data?: { items?: Array<{ archetype_node_id?: string; value?: { magnitude?: number } }> };
    }> : [];
  }
  return Object.values(rec).flatMap(findPulseEvents);
}

function magnitudes(events: ReturnType<typeof findPulseEvents>): Array<number | undefined> {
  return events.map((event) => {
    const item = event.data?.items?.find((row) => row.archetype_node_id === "at0004");
    return item?.value?.magnitude;
  });
}

async function pulseFixture() {
  const opt = await Deno.readTextFile(join(
    import.meta.dirname!,
    "fixtures/simple-diagnose-and-vitals.opt",
  ));
  const target = getTargetFormatHandler("openehr-template").load(
    "simple-diagnose-and-vitals.opt",
    opt,
  );
  const rate = collectValueSlots(target.skeleton).find((slot) =>
    slot.slotId.includes("OBSERVATION.pulse.v2") &&
    slot.slotId.includes("items/at0004/") &&
    slot.rmType === "DV_QUANTITY"
  );
  const time = collectValueSlots(target.skeleton).find((slot) =>
    slot.slotId.includes("OBSERVATION.pulse.v2") &&
    slot.slotId.includes("events/at0003/time/") &&
    slot.kind === "value"
  );
  if (!rate || !time) throw new Error("pulse slots missing");
  const event = nearestRepeatingContainer(findSkeletonTrail(target.skeleton, rate.slotId));
  if (!event) throw new Error("pulse EVENT missing");
  let model = createEmptyModel(target.targetId);
  model.targetFormat = "openehr-template";
  model = upsertLoop(model, {
    attachSlotId: event.slotId,
    varName: "measurement",
    path: "$.measurements",
    kind: "source",
  });
  model = applyExpressionEdit(model, rate.slotId, 'xpathNumber("pulse")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
    label: "Rate",
  });
  model = applyExpressionEdit(model, time.slotId, 'xpathString("timestamp")', {
    rmType: time.rmType,
    returnType: "string",
    label: "Time",
  });
  return { target, model, event };
}

async function runBoth(when: string) {
  const { target, model, event } = await pulseFixture();
  model.includes = [{ slotId: event.slotId, when }];
  const instance = await Deno.readTextFile(join(
    import.meta.dirname!,
    "fixtures/legacy-simulated-json/instances-series/bp-series-inst.json",
  ));
  const preview = runTest(model, instance, "json", { target });
  const typescript = runTest(model, instance, "json", { target, outputMode: "typescript" });
  assertEquals(preview.warnings ?? [], [], preview.error);
  assertEquals(typescript.warnings ?? [], [], typescript.error);
  const previewEvents = findPulseEvents(preview.output);
  const tsOutput = typeof typescript.output === "string" ? JSON.parse(typescript.output) : typescript.output;
  const tsEvents = findPulseEvents(tsOutput);
  return { previewEvents, tsEvents, event, target, model };
}

Deno.test("include when a pulse exists: no time-only EVENT, preview matches TypeScript", async () => {
  const { previewEvents, tsEvents } = await runBoth('xpathBoolean("pulse")');
  assertEquals(previewEvents.length, 2);
  assertEquals(magnitudes(previewEvents), [72, 76]);
  assertEquals(
    previewEvents.map((event) => event.time?.value),
    ["2026-07-02T08:30:00Z", "2026-07-02T14:15:00Z"],
  );
  assertEquals(magnitudes(tsEvents), magnitudes(previewEvents));
  assertEquals(tsEvents.map((event) => event.time?.value), previewEvents.map((event) => event.time?.value));
});

Deno.test("include when pulse is greater than 74: only the matching EVENT", async () => {
  const { previewEvents, tsEvents } = await runBoth('gt(xpathNumber("pulse"), 74)');
  assertEquals(magnitudes(previewEvents), [76]);
  assertEquals(previewEvents.map((event) => event.time?.value), ["2026-07-02T14:15:00Z"]);
  assertEquals(magnitudes(tsEvents), [76]);
});

Deno.test("include when on a required node is a constraint warning unless else emits it", async () => {
  const { target, model, event } = await pulseFixture();
  const composition = target.skeleton[0]!;
  model.includes = [{ slotId: composition.slotId, when: 'xpathBoolean("pulse")' }];
  const warned = validateModel(model, target.skeleton);
  assert(
    warned.some((issue) => issue.slotId === composition.slotId && issue.message.includes("required")),
    JSON.stringify(warned),
  );
  model.includes = [{ slotId: event.slotId, when: 'xpathBoolean("pulse")' }];
  const optional = validateModel(model, target.skeleton);
  assertEquals(optional.filter((issue) => issue.message.includes("required")), []);
  model.includes = [{
    slotId: composition.slotId,
    when: 'xpathBoolean("pulse")',
    elseEmits: true,
  }];
  const withElse = validateModel(model, target.skeleton);
  assertEquals(withElse.filter((issue) => issue.message.includes("required")), []);
});

Deno.test("include when is in the toolbox and controls_if stays removed", () => {
  initBlocklyGenerators();
  const types = toolboxBlockTypes(buildDemoToolbox("en"));
  assert(types.includes("include_when"));
  assertEquals(types.includes("controls_if"), false);
  assert(VMS_REMOVED_BLOCK_TYPES.includes("controls_if"));
  assertEquals((VMS_REMOVED_BLOCK_TYPES as readonly string[]).includes("include_when"), false);
  const workspace = new Blockly.Workspace();
  const guard = workspace.newBlock("include_when");
  assert(guard.getInput("WHEN"));
  assert(guard.getInput("DO"));
  assert(guard.getInput("ELSE"));
  const event = workspace.newBlock("element");
  event.setFieldValue("/event", "SLOT_ID");
  guard.getInput("DO")!.connection!.connect(event.previousConnection!);
  const when = workspace.newBlock("source_query_boolean");
  when.setFieldValue("pulse", "EXPRESSION");
  guard.getInput("WHEN")!.connection!.connect(when.outputConnection!);
  const extracted = workspaceToModelJson(workspace);
  assertEquals(extracted.includes, [{ slotId: "/event", when: 'xpathBoolean("pulse")' }]);
});

Deno.test("Simple-vitals-series include when drops the measurement with no pulse", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", {
    setId: "Simple-vitals-series-unmapped",
    includeMapping: false,
  });
  const rows = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; rmType?: string; label?: string }>;
  };
  const rate = rows.slots.find((slot) =>
    slot.slotId.includes("OBSERVATION.pulse.v2") && slot.slotId.includes("/at0004/")
  );
  const time = rows.slots.find((slot) =>
    slot.slotId.includes("OBSERVATION.pulse.v2") && slot.slotId.includes("/events/") &&
    slot.slotId.includes("/time/")
  );
  if (!rate || !time) {
    throw new Error(`pulse slots missing: ${rows.slots.map((slot) => slot.slotId).filter((id) => id.includes("pulse")).join(" | ")}`);
  }
  const eventId = time.slotId.slice(0, time.slotId.indexOf("/time/"));
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      loops: [{
        attachSlotId: eventId,
        block: {
          type: "for_each_list",
          fields: { VAR: "measurement" },
          inputs: {
            LIST: { block: { type: "source_query_node", fields: { EXPRESSION: "$.measurements" } } },
          },
        },
      }],
      includes: [{
        slotId: eventId,
        when: { type: "source_query_boolean", fields: { EXPRESSION: "pulse" } },
      }],
      suggestions: [
        {
          slotId: rate.slotId,
          loopVar: "measurement",
          block: { type: "source_query_number", fields: { EXPRESSION: "pulse" } },
        },
        {
          slotId: time.slotId,
          loopVar: "measurement",
          block: { type: "source_query", fields: { EXPRESSION: "timestamp" } },
        },
      ],
    }),
  }) as { report: { applied: number; includesAccepted?: number; errors: string[] } };
  assertEquals(imported.report.applied, 2, imported.report.errors.join("; "));
  assertEquals(imported.report.includesAccepted, 1, imported.report.errors.join("; "));
  const listed = await callAgentTool(service, "list_examples", {}) as {
    examples: Array<{ id: string; filename?: string }>;
  };
  const example = listed.examples.find((row) => row.filename === "bp-series-inst.json");
  if (!example) throw new Error("bp-series-inst.json missing");
  await callAgentTool(service, "set_active_example", { id: example.id });
  const counts: number[] = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", {
      outputMode,
      outputFormat: "canonical",
    }) as { testResult: { output: unknown } };
    const output = typeof run.testResult.output === "string"
      ? JSON.parse(run.testResult.output)
      : run.testResult.output;
    const events = findPulseEvents(output);
    assertEquals(events.length, 2, outputMode);
    assertEquals(magnitudes(events), [72, 76], outputMode);
    counts.push(events.length);
  }
  assertEquals(counts, [2, 2]);
});
