import { assert, assertEquals } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { javascriptGenerator } from "blockly/javascript";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import { applyModelLoops } from "@intehrgrator/blockly/mod.ts";
import { buildDemoToolbox, toolboxBlockTypes } from "@intehrgrator/blockly/toolbox_demo.ts";
import { msg } from "@intehrgrator/blockly/i18n/custom_msg.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { VMS_REMOVED_BLOCK_TYPES } from "@intehrgrator/blockly/vms.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  initBlocklyGenerators();
  ready = true;
}

function drawerTypes(
  toolbox: ReturnType<typeof buildDemoToolbox>,
  name: string,
): string[] {
  const root = toolbox as {
    contents: Array<{ name?: string; contents?: Array<{ type?: string }> }>;
  };
  return (root.contents.find((c) => c.name === name)?.contents ?? [])
    .map((block) => block.type)
    .filter((type): type is string => Boolean(type));
}

Deno.test("default toolbox no longer offers verification-hostile blocks", () => {
  const types = toolboxBlockTypes(buildDemoToolbox("en"));
  for (const type of VMS_REMOVED_BLOCK_TYPES) {
    assert(!types.includes(type), `${type} must not appear in the default toolbox`);
  }
});

Deno.test("text_append, text_join, and Variables remain in the default toolbox", () => {
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ name?: string; custom?: string }>;
  };
  const types = toolboxBlockTypes(toolbox);
  assert(types.includes("text_append"), "text_append stays");
  assert(types.includes("text_join"), "text_join stays");
  const variables = toolbox.contents.find((c) => c.custom === "VARIABLE");
  assert(variables, "Variables drawer stays (variables_set / variables_get)");
  assertEquals(variables?.name, msg("en").CAT_VARIABLES);
});

Deno.test("Loops & Logic drawer leads with for_each_list and has no Loops category", () => {
  ensure();
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ name?: string }>;
  };
  const names = toolbox.contents.map((c) => c.name);
  assertEquals(names.includes(msg("en").CAT_LOGIC), true);
  assertEquals(names.includes("Loops"), false);
  const types = drawerTypes(toolbox, msg("en").CAT_LOGIC);
  assertEquals(types[0], "for_each_list");
  assertEquals(types[1], "logic_current_item");
  assertEquals(types[2], "logic_loop_index");
  assertEquals(types[3], "logic_loop_length");
  assertEquals(types.includes("for_each_source"), false);
});

Deno.test("for_each_list is a custom list-item loop without break/continue", () => {
  ensure();
  assert(Blockly.Blocks["for_each_list"], "for_each_list is registered");
  assertEquals(
    Blockly.Blocks["for_each_list"] === Blockly.Blocks["controls_forEach"],
    false,
    "for_each_list is not stock controls_forEach",
  );

  const workspace = new Blockly.Workspace();
  const loop = workspace.newBlock("for_each_list");
  assert(loop.getField("VAR"), "binds VAR");
  assert(loop.getInput("LIST"), "takes a list value");
  assert(loop.getInput("DO"), "has a DO body");
  assertEquals(loop.getInput("BOOL"), null, "not a while-loop");
  assertEquals(
    loop.nextConnection?.getCheck()?.includes("controls_flow_statements") ?? false,
    false,
  );

  javascriptGenerator.init(workspace);
  loop.setFieldValue("code", "VAR");
  const list = workspace.newBlock("lists_create_with");
  loop.getInput("LIST")!.connection!.connect(list.outputConnection!);
  const code = javascriptGenerator.blockToCode(loop) as string;
  assert(code.includes(".map((code,"), code);
  assert(code.includes('__vars["code"]'), code);
  assertEquals(code.includes("break"), false);
  assertEquals(code.includes("continue"), false);
  workspace.dispose();
});

Deno.test("text_join and lists_create_with use the header mutator cogwheel", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const join = workspace.newBlock("text_join");
  const list = workspace.newBlock("lists_create_with");
  assert(join.getField("MUTATOR_COG"), "text_join header cog");
  assert(list.getField("MUTATOR_COG"), "lists_create_with header cog");
  workspace.dispose();
});

Deno.test("Click-to-Map wraps repeating containers with for_each_list", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const event = workspace.newBlock("event");
  event.setFieldValue("evt-1", "SLOT_ID");
  const model = createEmptyModel("t1");
  model.loops = [{ attachSlotId: "evt-1", varName: "measurements", path: "$.measurements" }];
  applyModelLoops(workspace, model);
  assertEquals(event.getParent()?.type, "for_each_list");
  assertEquals(event.getParent()?.getInputTargetBlock("LIST")?.type, "source_query_node");
  workspace.dispose();
});

Deno.test("Math toolbox includes the numeric-limits info note (#393)", () => {
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ name?: string; contents?: Array<{ kind?: string; text?: string }> }>;
  };
  const math = toolbox.contents.find((c) => c.name === msg("en").CAT_MATH);
  const labels = (math?.contents ?? []).filter((c) => c.kind === "label").map((c) => c.text);
  assertEquals(labels.includes(msg("en").MATH_NUMERIC_NOTE), true);
});

Deno.test("stock dropdowns do not offer RANDOM, and a loaded RANDOM value is not kept (#393)", () => {
  ensure();
  const workspace = new Blockly.Workspace();

  const fresh = workspace.newBlock("text_charAt");
  const freshField = fresh.getField("WHERE") as { getOptions(): Array<[string, string]> };
  assertEquals(freshField.getOptions().some((opt) => opt[1] === "RANDOM"), false);
  try {
    fresh.setFieldValue("RANDOM", "WHERE");
  } catch {
    // rejected
  }
  assertEquals(fresh.getFieldValue("WHERE") === "RANDOM", false);
  assertEquals(freshField.getOptions().some((opt) => opt[1] === "RANDOM"), false);

  const list = workspace.newBlock("math_on_list");
  const listField = list.getField("OP") as { getOptions(): Array<[string, string]> };
  assertEquals(listField.getOptions().some((opt) => opt[1] === "RANDOM"), false);

  workspace.dispose();
});

