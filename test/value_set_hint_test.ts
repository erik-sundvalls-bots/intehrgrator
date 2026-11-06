/**
 * Value-set hints stay unmapped, and the actions that replace them write
 * ordinary blocks with a blank source column.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators, loadSkeletonIntoWorkspace, workspaceToModelJson } from "@intehrgrator/blockly/mod.ts";
import { applyValueSetHint } from "@intehrgrator/blockly/hint_actions.ts";
import {
  blockConstraintMessages,
  setValueSetHintNoteSlots,
  VALUE_SET_HINT_NOTE,
  UNMAPPED_OPTIONAL_SCAFFOLD_WARNING,
} from "@intehrgrator/blockly/block_constraints.ts";
import {
  collectValueSetHints,
  dismissHint,
  planHintGrid,
  pruneHintSettings,
} from "@intehrgrator/core/hints/value_set_hint.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { DEFAULT_SETTINGS, type ProjectSettings, type SkeletonNode } from "@intehrgrator/types/mod.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const settings = { ...DEFAULT_SETTINGS } satisfies ProjectSettings;

function positionSkeleton(): SkeletonNode[] {
  return [{
    slotId: "bp/position",
    blockType: "element",
    rmType: "ELEMENT",
    label: "Position",
    kind: "container",
    mandatory: false,
    children: [{
      slotId: "bp/position/value",
      blockType: "dv_coded_text",
      rmType: "DV_CODED_TEXT",
      label: "Position",
      rmAttribute: "value",
      kind: "value",
      mandatory: false,
      children: [],
      allowedValues: [
        { code: "at1000", label: "Standing", terminologyId: "local" },
        { code: "at1001", label: "Sitting", terminologyId: "local", assumed: true },
        { code: "at1002", label: "Reclining", terminologyId: "local" },
      ],
    }],
  }];
}

function load(skeleton: SkeletonNode[]) {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  const empty = createEmptyModel("t");
  loadSkeletonIntoWorkspace(workspace, skeleton, empty, null);
  const model = {
    ...empty,
    slots: workspaceToModelJson(workspace).slots.map((slot) => ({ ...slot, returnType: "String" })),
  };
  return { workspace, model, skeleton };
}

Deno.test("a multi-code slot is an unmapped hint and assumed_value does not fill it", () => {
  const skeleton = positionSkeleton();
  const { workspace, model } = load(skeleton);
  const hints = collectValueSetHints(skeleton, model, settings);
  assertEquals(hints.map((hint) => hint.slotId), ["bp/position/value"]);
  assertEquals(hints[0]?.kind, "coded");
  assertEquals(hints[0]?.assumed, "at1001");
  assertEquals(hints[0]?.codes.map((code) => code.text), ["Standing", "Sitting", "Reclining"]);
  assertEquals(model.slots.some((slot) => slot.slotId === "bp/position/value"), false);
  const element = workspace.getAllBlocks(false).find((block) => block.getFieldValue("NAME") === "Position");
  assert(element);
  assertEquals(element.getInputTargetBlock("VALUE"), null);
  setValueSetHintNoteSlots(workspace, ["bp/position/value"]);
  const note = blockConstraintMessages(element).join("\n");
  assertStringIncludes(note, VALUE_SET_HINT_NOTE);
  assertEquals(note.includes(UNMAPPED_OPTIONAL_SCAFFOLD_WARNING), false);
  assertEquals(note.includes("Unmapped mandatory value"), false);
  workspace.dispose();
});

Deno.test("a changed allowed-code list restores a dismissed hint", () => {
  const skeleton = positionSkeleton();
  const model = createEmptyModel("t");
  const hints = collectValueSetHints(skeleton, model, settings);
  const dismissed = dismissHint(settings, hints[0]!);
  assertEquals(collectValueSetHints(skeleton, model, dismissed)[0]?.dismissed, true);
  const changed = structuredClone(skeleton);
  changed[0]!.children[0]!.allowedValues = [
    ...(changed[0]!.children[0]!.allowedValues ?? []),
    { code: "at1003", label: "Lying", terminologyId: "local" },
  ];
  assertEquals(collectValueSetHints(changed, model, dismissed)[0]?.dismissed, false);
  const pruned = pruneHintSettings(changed, model, dismissed);
  assertEquals(pruned.dismissedHints, undefined);
});

Deno.test("decision table from a hint prefills codes and leaves source blank", () => {
  const skeleton = positionSkeleton();
  const { workspace, model } = load(skeleton);
  const hint = collectValueSetHints(skeleton, model, settings)[0]!;
  const sheetPlan = planHintGrid(hint, [], "sheet");
  assertEquals(sheetPlan.sheet.values.map((row) => row[0]), ["", "", ""]);
  const plan = planHintGrid(hint, [], "decision-table");
  assertEquals(plan.sheet.headers[0], "source");
  assertEquals(plan.sheet.values.map((row) => row[0]), ["", "", ""]);
  assertEquals(plan.sheet.values.map((row) => row[1]), ["at1000", "at1001", "at1002"]);
  assertEquals(plan.sheet.values.map((row) => row[2]), ["Standing", "Sitting", "Reclining"]);
  const applied = applyValueSetHint(workspace, skeleton, model, settings, [], {
    slotId: hint.slotId,
    action: "decision_table",
  });
  assertEquals(applied.sheets[0]?.values[0]?.[0], "");
  assertEquals(applied.grid?.kind, "decision-table");
  assertStringIncludes(applied.grid?.prompt ?? "", "at1001");
  assertEquals(applied.grid?.prompt.includes("$.") ?? false, false);
  const table = workspace.getAllBlocks(false).find((block) => block.type === "decision_table");
  assert(table);
  assertEquals(table.getFieldValue("NAME"), applied.grid?.name);
  const after = {
    ...model,
    slots: workspaceToModelJson(workspace).slots.map((slot) => ({ ...slot, returnType: "String" })),
  };
  assertEquals(collectValueSetHints(skeleton, after, applied.settings).length, 0);
  workspace.dispose();
});

Deno.test("use as constant on a local code is a coded shell, and a built-in code is a term pick", () => {
  const local = positionSkeleton();
  const localLoaded = load(local);
  const localHint = collectValueSetHints(local, localLoaded.model, settings)[0]!;
  applyValueSetHint(localLoaded.workspace, local, localLoaded.model, settings, [], {
    slotId: localHint.slotId,
    action: "constant",
  });
  const localValue = localLoaded.workspace.getAllBlocks(false)
    .find((block) => block.getFieldValue("NAME") === "Position")
    ?.getInputTargetBlock("VALUE");
  assertEquals(localValue?.type, "dv_coded_text");
  assertEquals(localValue?.type === "term_pick", false);
  localLoaded.workspace.dispose();

  const setting: SkeletonNode[] = [{
    slotId: "comp/setting",
    blockType: "element",
    rmType: "ELEMENT",
    label: "Setting",
    kind: "container",
    mandatory: false,
    children: [{
      slotId: "comp/setting/value",
      blockType: "dv_coded_text",
      rmType: "DV_CODED_TEXT",
      label: "Setting",
      rmAttribute: "value",
      kind: "value",
      mandatory: false,
      children: [],
      allowedValues: [
        { code: "225", label: "home", terminologyId: "openehr" },
        { code: "228", label: "primary medical care", terminologyId: "openehr", assumed: true },
      ],
    }],
  }];
  const loaded = load(setting);
  const hint = collectValueSetHints(setting, loaded.model, settings)[0]!;
  assertEquals(hint.assumed, "228");
  applyValueSetHint(loaded.workspace, setting, loaded.model, settings, [], {
    slotId: hint.slotId,
    action: "constant",
  });
  const settingValue = loaded.workspace.getAllBlocks(false)
    .find((block) => block.getFieldValue("NAME") === "Setting")
    ?.getInputTargetBlock("VALUE");
  assertEquals(settingValue?.type, "term_pick");
  assertEquals(settingValue?.getFieldValue("CODE"), "228");
  loaded.workspace.dispose();
});

Deno.test("headless apply_hint and list_slots share the hint, and preview does not emit Standing", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-unmapped", includeMapping: false });
  const snap = service.getSnapshot();
  assert(snap.hintSlots > 0);
  assertEquals(snap.mappedSlots, 0);
  const rows = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; hint?: { assumed?: string; codes: Array<{ code: string }> } }>;
  };
  const position = rows.slots.find((row) => row.hint?.codes.some((code) => code.code === "at1000"));
  assert(position?.hint);
  assert(position.hint.codes.some((code) => code.code === "at1001"));
  const table = await callAgentTool(service, "apply_hint", {
    slotId: position.slotId,
    action: "decision_table",
  }) as { grid?: string; prompt?: string };
  assert(table.grid);
  assertEquals("prompt" in table, false);
  const after = service.getSnapshot();
  assert(after.hintSlots < snap.hintSlots);
  const run = await callAgentTool(service, "run_test", { outputMode: "preview" }) as {
    testResult: { output: unknown };
  };
  const text = JSON.stringify(run.testResult.output);
  assertEquals(text.includes("Standing"), false);
});
