/**
 * Value-set hints stay unmapped, and the actions that replace them write
 * ordinary blocks with a blank source column.
 */
import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  initBlocklyGenerators,
  loadSkeletonIntoWorkspace,
  workspaceToModelJson,
} from "@intehrgrator/blockly/mod.ts";
import { applyValueSetHint } from "@intehrgrator/blockly/hint_actions.ts";
import {
  blockConstraintMessages,
  setValueSetHintNoteSlots,
  UNMAPPED_OPTIONAL_SCAFFOLD_WARNING,
  VALUE_SET_HINT_NOTE,
} from "@intehrgrator/blockly/block_constraints.ts";
import {
  collectValueSetHints,
  dismissHint,
  planHintGrid,
  pruneHintSettings,
} from "@intehrgrator/core/hints/value_set_hint.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  DEFAULT_SETTINGS,
  type ProjectSettings,
  type SkeletonNode,
} from "@intehrgrator/types/mod.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import {
  createSourceContext,
  evaluate,
} from "@intehrgrator/core/source/query_runtime.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { runGeneratedTypeScript } from "@intehrgrator/core/codegen/run_typescript.ts";
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
        {
          code: "at1001",
          label: "Sitting",
          terminologyId: "local",
          assumed: true,
        },
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
    slots: workspaceToModelJson(workspace).slots.map((slot) => ({
      ...slot,
      returnType: "String",
    })),
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
  assertEquals(hints[0]?.codes.map((code) => code.text), [
    "Standing",
    "Sitting",
    "Reclining",
  ]);
  assertEquals(
    model.slots.some((slot) => slot.slotId === "bp/position/value"),
    false,
  );
  const element = workspace.getAllBlocks(false).find((block) =>
    block.getFieldValue("NAME") === "Position"
  );
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
  assertEquals(
    collectValueSetHints(skeleton, model, dismissed)[0]?.dismissed,
    true,
  );
  const changed = structuredClone(skeleton);
  changed[0]!.children[0]!.allowedValues = [
    ...(changed[0]!.children[0]!.allowedValues ?? []),
    { code: "at1003", label: "Lying", terminologyId: "local" },
  ];
  assertEquals(
    collectValueSetHints(changed, model, dismissed)[0]?.dismissed,
    false,
  );
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
  assertEquals(plan.sheet.values.map((row) => row[1]), [
    "at1000",
    "at1001",
    "at1002",
  ]);
  assertEquals(plan.sheet.values.map((row) => row[2]), [
    "Standing",
    "Sitting",
    "Reclining",
  ]);
  const applied = applyValueSetHint(workspace, skeleton, model, settings, [], {
    slotId: hint.slotId,
    action: "decision_table",
  });
  assertEquals(applied.sheets[0]?.values[0]?.[0], "");
  assertEquals(applied.grid?.kind, "decision-table");
  assertStringIncludes(applied.grid?.prompt ?? "", "at1001");
  assertEquals(applied.grid?.prompt.includes("$.") ?? false, false);
  const table = workspace.getAllBlocks(false).find((block) =>
    block.type === "decision_table"
  );
  assert(table);
  assertEquals(table.getFieldValue("NAME"), applied.grid?.name);
  const after = {
    ...model,
    slots: workspaceToModelJson(workspace).slots.map((slot) => ({
      ...slot,
      returnType: "String",
    })),
  };
  assertEquals(
    collectValueSetHints(skeleton, after, applied.settings).length,
    0,
  );
  workspace.dispose();
});

Deno.test("use as constant on a local code is an ordinary Function, and a built-in code is a term pick", () => {
  const local = positionSkeleton();
  const localLoaded = load(local);
  const localHint = collectValueSetHints(
    local,
    localLoaded.model,
    settings,
  )[0]!;
  applyValueSetHint(
    localLoaded.workspace,
    local,
    localLoaded.model,
    settings,
    [],
    {
      slotId: localHint.slotId,
      action: "constant",
    },
  );
  const localValue = localLoaded.workspace.getAllBlocks(false)
    .find((block) => block.getFieldValue("NAME") === "Position")
    ?.getInputTargetBlock("VALUE");
  assertEquals(localValue?.type, "procedures_callreturn");
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
        {
          code: "228",
          label: "primary medical care",
          terminologyId: "openehr",
          assumed: true,
        },
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
  await callAgentTool(service, "load_example_set", {
    setId: "Simple-vitals-unmapped",
    includeMapping: false,
  });
  const snap = service.getSnapshot();
  assert(snap.hintSlots > 0);
  assertEquals(snap.mappedSlots, 0);
  const rows = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<
      {
        slotId: string;
        hint?: { assumed?: string; codes: Array<{ code: string }> };
      }
    >;
  };
  const position = rows.slots.find((row) =>
    row.hint?.codes.some((code) => code.code === "at1000")
  );
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
  const run = await callAgentTool(service, "run_test", {
    outputMode: "preview",
  }) as {
    testResult: { output: unknown };
  };
  const text = JSON.stringify(run.testResult.output);
  assertEquals(text.includes("Standing"), false);
});

Deno.test("coded hint decision table builds a complete coded value from one shared row", () => {
  const skeleton = positionSkeleton();
  const { workspace, model } = load(skeleton);
  try {
    const applied = applyValueSetHint(
      workspace,
      skeleton,
      model,
      settings,
      [],
      {
        slotId: "bp/position/value",
        action: "decision_table",
      },
    );
    const table = workspace.getAllBlocks(false).find((block) =>
      block.type === "decision_table"
    )!;
    const source = workspace.newBlock("text");
    source.setFieldValue("sit", "TEXT");
    table.getInputTargetBlock("INPUTS")!.getInput("VAL0")!.connection!.connect(
      source.outputConnection!,
    );
    const projected = workspaceToModelJson(workspace);
    const expression = projected.slots.find((slot) =>
      slot.slotId === "bp/position/value"
    )!.expression!;
    const ctx = createSourceContext("{}", "json");
    ctx.functions = projected.functions;
    ctx.sheets = Object.fromEntries(
      applied.sheets.map((sheet) => [sheet.name, sheet]),
    );
    // Blank UNIQUE table must not select a target on creation.
    assertThrows(() => evaluate(expression, ctx, "string"), Error, "UNIQUE");
    const sheet = applied.sheets[0]!;
    sheet.values.forEach((row, i) => row[0] = ["stand", "sit", "recline"][i]!);
    const expected = {
      _type: "DV_CODED_TEXT",
      value: "Sitting",
      defining_code: {
        _type: "CODE_PHRASE",
        code_string: "at1001",
        terminology_id: { _type: "TERMINOLOGY_ID", value: "local" },
      },
    };
    assertEquals(evaluate(expression, ctx, "string"), expected);
    assertEquals(
      workspace.getAllBlocks(false).filter((block) =>
        block.type === "decision_table"
      ).length,
      1,
    );
    // Use the generated portable Function (no canvas JS) too.
    const portable = createEmptyModel("coded");
    portable.targetFormat = "json-schema";
    portable.functions = projected.functions;
    portable.slots = [{
      slotId: "coded",
      expression,
      rmType: "string",
      returnType: "string",
    }];
    const output = runGeneratedTypeScript(
      generate(portable, "typescript"),
      { format: "json", data: {} },
      {},
      undefined,
      ctx.sheets,
    );
    assertEquals(output, { coded: expected });
  } finally {
    workspace.dispose();
  }
});

for (
  const rmType of ["DV_CODED_TEXT", "DV_ORDINAL", "CODE_PHRASE", "DV_SCALE"]
) {
  for (
    const action of ["constant", "sheet_lookup", "decision_table"] as const
  ) {
    Deno.test(`${rmType} hint ${action} keeps rubric, code and terminology together`, () => {
      const skeleton = positionSkeleton();
      const value = skeleton[0]!.children[0]!;
      value.rmType = rmType;
      value.blockType = rmType.toLowerCase();
      if (rmType === "DV_ORDINAL" || rmType === "DV_SCALE") {
        value.allowedOrdinals = [
          {
            value: 0,
            label: "Standing",
            code: "at1000",
            terminologyId: "local",
          },
          {
            value: 1,
            label: "Sitting",
            code: "at1001",
            terminologyId: "SNOMED-CT",
          },
        ];
        delete value.allowedValues;
      }
      const { workspace, model } = load(skeleton);
      try {
        const applied = applyValueSetHint(
          workspace,
          skeleton,
          model,
          settings,
          [],
          {
            slotId: "bp/position/value",
            action,
            codes: ["at1000"],
          },
        );
        if (action !== "constant") {
          const reader = workspace.getAllBlocks(false).find((block) =>
            block.type ===
              (action === "sheet_lookup" ? "sheet_lookup" : "decision_table")
          )!;
          const input = action === "sheet_lookup"
            ? reader
            : reader.getInputTargetBlock("INPUTS")!;
          const socket = input.getInput(
            action === "sheet_lookup" ? "MATCH_VAL" : "VAL0",
          )!.connection!;
          socket.targetBlock()?.dispose(false);
          const source = workspace.newBlock("text");
          source.setFieldValue("stand", "TEXT");
          socket.connect(source.outputConnection!);
          applied.sheets[0]!.values.forEach((row, i) =>
            row[0] = i === 0 ? "stand" : "sit"
          );
        }
        const projected = workspaceToModelJson(workspace);
        const expression = projected.slots.find((slot) =>
          slot.slotId === "bp/position/value"
        )!.expression!;
        const ctx = createSourceContext("{}", "json");
        ctx.functions = projected.functions;
        ctx.sheets = Object.fromEntries(
          applied.sheets.map((sheet) => [sheet.name, sheet]),
        );
        const result = evaluate(expression, ctx, "string") as Record<
          string,
          unknown
        >;
        const phrase = {
          code_string: "at1000",
          terminology_id: { _type: "TERMINOLOGY_ID", value: "local" },
        };
        const coded = { value: "Standing", defining_code: phrase };
        const expected = rmType === "CODE_PHRASE"
          ? phrase
          : rmType === "DV_ORDINAL" || rmType === "DV_SCALE"
          ? { value: 0, symbol: coded }
          : coded;
        assertObjectMatch(result, expected);
        const preview = runTest(
          { ...model, slots: projected.slots, functions: projected.functions },
          "{}",
          "json",
          {
            sheets: applied.sheets,
            target: {
              format: "openehr-template",
              filename: "t.opt",
              targetId: "t",
              content: "",
              skeleton,
            },
          },
        );
        assertStringIncludes(JSON.stringify(preview.output), "at1000");
        assertStringIncludes(JSON.stringify(preview.output), "TERMINOLOGY_ID");
        if (action !== "constant") {
          assertEquals(
            workspace.getAllBlocks(false).filter((block) =>
              block.type ===
                (action === "sheet_lookup" ? "sheet_lookup" : "decision_table")
            ).length,
            1,
          );
        }
      } finally {
        workspace.dispose();
      }
    });
  }
}

Deno.test("coded hint Functions reuse one import without overwriting a name clash or edited definition", () => {
  const skeleton = [1, 2, 3].flatMap((n) =>
    JSON.parse(
      JSON.stringify(positionSkeleton()).replaceAll(
        "bp/position",
        `bp/position${n}`,
      ),
    ) as SkeletonNode[]
  );
  const { workspace, model } = load(skeleton);
  try {
    const unrelated = Blockly.serialization.blocks.append({
      type: "procedures_defreturn",
      fields: { NAME: "coded_value_from_row" },
    }, workspace);
    for (const n of [1, 2]) {
      applyValueSetHint(workspace, skeleton, model, settings, [], {
        slotId: `bp/position${n}/value`,
        action: "sheet_lookup",
      });
    }
    const definitions = workspace.getTopBlocks(false).filter((block) =>
      block.type === "procedures_defreturn"
    );
    assertEquals(definitions.length, 2);
    const imported = definitions.find((block) => block.id !== unrelated.id)!;
    const name = imported.getFieldValue("NAME");
    assert(name !== "coded_value_from_row");
    const calls = workspace.getAllBlocks(false).filter((block) =>
      block.type === "procedures_callreturn"
    );
    assertEquals(calls.map((block) => block.getFieldValue("NAME")), [
      name,
      name,
    ]);
    imported.getInputTargetBlock("RETURN")!.dispose(false);
    const custom = workspace.newBlock("text");
    custom.setFieldValue("my customized Function", "TEXT");
    imported.getInput("RETURN")!.connection!.connect(custom.outputConnection!);
    applyValueSetHint(workspace, skeleton, model, settings, [], {
      slotId: "bp/position3/value",
      action: "sheet_lookup",
    });
    assertEquals(
      imported.getInputTargetBlock("RETURN")!.getFieldValue("TEXT"),
      "my customized Function",
    );
    assertEquals(
      workspace.getTopBlocks(false).filter((block) =>
        block.type === "procedures_defreturn"
      ).length,
      3,
    );
  } finally {
    workspace.dispose();
  }
});

for (const action of ["constant", "decision_table", "sheet_lookup"] as const) {
  Deno.test(`Position hint ${action} emits a complete coded text in real preview and TypeScript Test Run`, async () => {
    const service = new WorkbenchService();
    await callAgentTool(service, "load_example_set", {
      setId: "Simple-vitals-unmapped",
      includeMapping: false,
    });
    const rows = await callAgentTool(service, "list_slots", {
      view: "rows",
    }) as {
      slots: Array<
        { slotId: string; hint?: { codes: Array<{ code: string }> } }
      >;
    };
    const position = rows.slots.find((row) =>
      row.hint?.codes.some((code) => code.code === "at1001")
    )!;
    await callAgentTool(service, "apply_hint", {
      slotId: position.slotId,
      action,
      codes: ["at1001"],
    });
    if (action !== "constant") {
      const bundle = service.exportBundle();
      const workspace = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(
          bundle.mapping.blocklyState as Record<string, unknown>,
          workspace,
        );
        const reader = workspace.getAllBlocks(false).find((block) =>
          block.type ===
            (action === "decision_table" ? "decision_table" : "sheet_lookup")
        )!;
        const parent = action === "decision_table"
          ? reader.getInputTargetBlock("INPUTS")!
          : reader;
        const socket = parent.getInput(
          action === "decision_table" ? "VAL0" : "MATCH_VAL",
        )!.connection!;
        socket.targetBlock()?.dispose(false);
        const source = workspace.newBlock("text");
        source.setFieldValue("sit", "TEXT");
        socket.connect(source.outputConnection!);
        bundle.mapping.blocklyState = Blockly.serialization.workspaces.save(
          workspace,
        );
        const projected = workspaceToModelJson(workspace);
        bundle.mapping.model.slots.find((slot) =>
          slot.slotId === position.slotId
        )!.expression = projected.slots.find((slot) =>
          slot.slotId === position.slotId
        )!.expression!;
        bundle.mapping.model.functions = projected.functions;
      } finally {
        workspace.dispose();
      }
      const sheets = bundle.mapping.sheets!;
      sheets[0]!.values.forEach((row) =>
        row[0] = row[1] === "at1001" ? "sit" : String(row[1])
      );
      service.loadBundle(bundle);
    }
    for (const outputMode of ["preview", "typescript"]) {
      const run = await callAgentTool(service, "run_test", { outputMode }) as {
        testResult: { output: unknown; error?: string };
      };
      assertEquals(run.testResult.error, undefined);
      const text = JSON.stringify(run.testResult.output);
      assertStringIncludes(text, '"value":"Sitting"');
      assertStringIncludes(text, '"code_string":"at1001"');
      assertStringIncludes(text, '"value":"local"');
    }
  });
}

Deno.test("a complete Function replaces a standalone CODE_PHRASE attribute without losing its slot", () => {
  const slotId = "composition/language";
  const skeleton: SkeletonNode[] = [{
    slotId: "composition",
    blockType: "composition",
    rmType: "COMPOSITION",
    label: "Composition",
    kind: "container",
    mandatory: true,
    children: [{
      slotId,
      blockType: "code_phrase",
      rmType: "CODE_PHRASE",
      rmAttribute: "language",
      label: "Language",
      kind: "value",
      mandatory: true,
      children: [],
      allowedValues: [
        { code: "en", label: "English", terminologyId: "my-local-languages" },
        { code: "sv", label: "Swedish", terminologyId: "my-local-languages" },
      ],
    }],
  }];
  const { workspace, model } = load(skeleton);
  model.slots = model.slots.filter((slot) => slot.slotId !== slotId);
  try {
    applyValueSetHint(workspace, skeleton, model, settings, [], {
      slotId,
      action: "constant",
      codes: ["sv"],
    });
    const projected = workspaceToModelJson(workspace);
    const slot = projected.slots.find((slot) => slot.slotId === slotId)!;
    assertStringIncludes(slot.expression!, "coded_value_from_row");
    const context = createSourceContext("{}", "json");
    context.functions = projected.functions;
    const result = evaluate(slot.expression!, context, "string");
    assertObjectMatch(result as Record<string, unknown>, {
      _type: "CODE_PHRASE",
      code_string: "sv",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "my-local-languages" },
    });
    const state = Blockly.serialization.workspaces.save(workspace);
    workspace.clear();
    Blockly.serialization.workspaces.load(state, workspace);
    assertEquals(
      workspaceToModelJson(workspace).slots.find((s) => s.slotId === slotId)
        ?.expression,
      slot.expression,
    );
  } finally {
    workspace.dispose();
  }
});
