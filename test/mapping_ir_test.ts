import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import * as enMsg from "blockly/msg/en";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  applyModelLoops,
  attachOptionalSchemaChild,
  initBlocklyGenerators,
  loadSkeletonIntoWorkspace,
  workspaceToModelJson,
} from "@intehrgrator/blockly/mod.ts";
import { rmAttributeInputName, syncRmAttributeInputs } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { composeSchemaOptionalFields, schemaOptionalInputName } from "@intehrgrator/blockly/blocks/schema_mutator.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { evaluate, createSourceContext } from "@intehrgrator/core/source/query_runtime.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { MODEL_VERSION } from "@intehrgrator/types/mod.ts";
import type { TargetSignatureNode } from "@intehrgrator/types/mod.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  const anyMod = enMsg as { default?: Record<string, string> } & Record<string, string>;
  const table = anyMod.default && typeof anyMod.default === "object" ? anyMod.default : anyMod;
  Blockly.setLocale(table);
  initBlocklyGenerators();
  ready = true;
}

function findSignature(
  nodes: TargetSignatureNode[],
  slotId: string,
): TargetSignatureNode | undefined {
  for (const node of nodes) {
    if (node.slotId === slotId) return node;
    const child = findSignature(node.children, slotId);
    if (child) return child;
  }
  return undefined;
}

function connectDo(loop: Blockly.Block, body: Blockly.Block): void {
  loop.getInput("DO")!.connection!.connect(body.previousConnection!);
}

function attachSourceList(loop: Blockly.Block, path: string): void {
  const src = loop.workspace.newBlock("source_query_node");
  src.setFieldValue(path, "EXPRESSION");
  loop.getInput("LIST")!.connection!.connect(src.outputConnection!);
}

Deno.test("for_each_list with a source query + relative source_query appears with grain fields", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const loop = workspace.newBlock("for_each_list");
  loop.setFieldValue("measurements", "VAR");
  attachSourceList(loop, "$.measurements");

  const event = workspace.newBlock("event");
  event.setFieldValue("evt-1", "SLOT_ID");
  event.setFieldValue("EVENT", "RM_TYPE");
  connectDo(loop, event);

  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/rate", "SLOT_ID");
  slot.setFieldValue("DV_QUANTITY", "TARGET_TYPE");
  event.nextConnection!.connect(slot.previousConnection!);

  const src = workspace.newBlock("source_query_number");
  src.setFieldValue("pulse", "EXPRESSION");
  slot.getInput("VALUE")!.connection!.connect(src.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  assertEquals(ir.loops, [{
    attachSlotId: "evt-1",
    varName: "measurements",
    path: "$.measurements",
    kind: "source",
  }]);
  const rate = ir.slots.find((s) => s.slotId === "slot/rate");
  assertEquals(rate?.expression, 'xpathNumber("pulse")');
  workspace.dispose();
});

Deno.test("for_each_list extracts kind list and collection expression", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const loop = workspace.newBlock("for_each_list");
  loop.setFieldValue("code", "VAR");

  const list = workspace.newBlock("lists_create_with") as Blockly.Block & {
    itemCount_?: number;
    updateShape_?: () => void;
  };
  list.itemCount_ = 2;
  list.updateShape_?.();
  const a = workspace.newBlock("text");
  a.setFieldValue("I10", "TEXT");
  const b = workspace.newBlock("text");
  b.setFieldValue("E11", "TEXT");
  list.getInput("ADD0")!.connection!.connect(a.outputConnection!);
  list.getInput("ADD1")!.connection!.connect(b.outputConnection!);
  loop.getInput("LIST")!.connection!.connect(list.outputConnection!);

  const element = workspace.newBlock("element");
  element.setFieldValue("slot/code", "SLOT_ID");
  element.setFieldValue("DV_TEXT", "RM_TYPE");
  connectDo(loop, element);

  const item = workspace.newBlock("variables_get");
  element.getInput("VALUE")!.connection!.connect(item.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  assertEquals(ir.loops.length, 1);
  assertEquals(ir.loops[0]!.kind, "list");
  assertEquals(ir.loops[0]!.attachSlotId, "slot/code");
  assertEquals(ir.loops[0]!.varName, "code");
  assertEquals(ir.loops[0]!.collection, 'list("I10", "E11")');
  assertEquals(ir.loops[0]!.path, "");
  workspace.dispose();
});

Deno.test("text_code LANG is recorded as an escape hatch, not a silent drop", async () => {
  ensure();
  await ensureGoTemplateWasm();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/note", "SLOT_ID");
  slot.setFieldValue("DV_TEXT", "TARGET_TYPE");
  const code = workspace.newBlock("text_code");
  code.setFieldValue("go-template", "LANG");
  // Out-of-dialect Go (call) remains an escape hatch.
  code.setFieldValue("{{call .Fn}}", "TEXT");
  slot.getInput("VALUE")!.connection!.connect(code.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/note");
  assertEquals(mapped?.expression, JSON.stringify("{{call .Fn}}"));
  assertEquals(mapped?.hatch, { kind: "text_code", lang: "go-template" });
  assert(
    ir.unsupported.some((u) =>
      u.blockType === "text_code" && u.reason === "escape" && u.lang === "go-template"
    ),
    `expected text_code escape, got ${JSON.stringify(ir.unsupported)}`,
  );
  workspace.dispose();
});

Deno.test("in-dialect go-template text_code is not an escape hatch", async () => {
  ensure();
  await ensureGoTemplateWasm();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/note", "SLOT_ID");
  slot.setFieldValue("DV_TEXT", "TARGET_TYPE");
  const code = workspace.newBlock("text_code");
  code.setFieldValue("go-template", "LANG");
  code.setFieldValue('{{ index .Data "raw" }}', "TEXT");
  slot.getInput("VALUE")!.connection!.connect(code.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/note");
  assertEquals(mapped?.hatch, undefined);
  assertEquals(
    ir.unsupported.some((u) => u.blockType === "text_code"),
    false,
  );
  workspace.dispose();
});

Deno.test("Remove-list blocks are unsupported/removed, not first-class IR", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const iff = workspace.newBlock("controls_if");
  const loop = workspace.newBlock("controls_whileUntil");
  loop.setFieldValue("WHILE", "MODE");

  const ir = workspaceToModelJson(workspace);
  assert(ir.unsupported.some((u) => u.blockType === "controls_if" && u.reason === "removed"));
  assert(ir.unsupported.some((u) => u.blockType === "controls_whileUntil" && u.reason === "removed"));
  assertEquals(ir.loops.some((l) => l.kind === "source" && !l.path), false);
  assertEquals(
    ir.loops.some((l) => (l as { if?: unknown }).if != null),
    false,
    "no If node on loops[]",
  );
  assertEquals(iff.type, "controls_if");
  workspace.dispose();
});

Deno.test("nested target signature walks RM parent/child SLOT_IDs", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const cluster = workspace.newBlock("cluster");
  cluster.setFieldValue("c1", "SLOT_ID");
  cluster.setFieldValue("CLUSTER", "RM_TYPE");
  syncRmAttributeInputs(cluster, "CLUSTER", ["items"]);

  const element = workspace.newBlock("element");
  element.setFieldValue("e1", "SLOT_ID");
  element.setFieldValue("ELEMENT", "RM_TYPE");
  cluster.getInput(rmAttributeInputName("items"))!.connection!.connect(element.previousConnection!);

  const ir = workspaceToModelJson(workspace);
  assertEquals(ir.targetSignature.length, 1);
  assertEquals(ir.targetSignature[0]!.slotId, "c1");
  assertEquals(ir.targetSignature[0]!.rmType, "CLUSTER");
  assertEquals(ir.targetSignature[0]!.children.map((c) => c.slotId), ["e1"]);
  assertEquals(ir.targetSignature[0]!.children[0]!.optional, undefined);
  workspace.dispose();
});

Deno.test("sheet accessors collect sheetNames", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const lookup = workspace.newBlock("sheet_lookup");
  lookup.setFieldValue("icd10_snomed", "NAME");
  const ir = workspaceToModelJson(workspace);
  assertEquals(ir.sheetNames, ["icd10_snomed"]);
  workspace.dispose();
});

Deno.test("sheet_lookup in a value slot is a kept expression with sheetNames", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/snomed", "SLOT_ID");
  const lookup = workspace.newBlock("sheet_lookup");
  lookup.setFieldValue("icd10_snomed", "NAME");
  const col = workspace.newBlock("text");
  col.setFieldValue("code", "TEXT");
  const val = workspace.newBlock("text");
  val.setFieldValue("I10", "TEXT");
  const ret = workspace.newBlock("text");
  ret.setFieldValue("snomed", "TEXT");
  lookup.getInput("MATCH_COL")!.connection!.connect(col.outputConnection!);
  lookup.getInput("MATCH_VAL")!.connection!.connect(val.outputConnection!);
  lookup.getInput("RETURN_COL")!.connection!.connect(ret.outputConnection!);
  slot.getInput("VALUE")!.connection!.connect(lookup.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/snomed");
  assertEquals(
    mapped?.expression,
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
  );
  assertEquals(ir.sheetNames, ["icd10_snomed"]);
  assertEquals(
    ir.unsupported.some((u) => u.blockType === "sheet_lookup"),
    false,
    "sheet_lookup is VMS Keep, not unsupported",
  );
  workspace.dispose();
});

Deno.test("Blockly JSON round-trip preserves Mapping Model IR", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const loop = workspace.newBlock("for_each_list");
  loop.setFieldValue("item", "VAR");
  attachSourceList(loop, "/items");
  const event = workspace.newBlock("event");
  event.setFieldValue("evt-1", "SLOT_ID");
  connectDo(loop, event);
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/name", "SLOT_ID");
  event.nextConnection!.connect(slot.previousConnection!);
  const src = workspace.newBlock("source_query");
  src.setFieldValue("name", "EXPRESSION");
  slot.getInput("VALUE")!.connection!.connect(src.outputConnection!);

  const first = workspaceToModelJson(workspace);
  const saved = Blockly.serialization.workspaces.save(workspace);
  workspace.dispose();

  const loaded = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(saved, loaded);
  const second = workspaceToModelJson(loaded);
  assertEquals(second.loops, first.loops);
  assertEquals(second.slots, first.slots);
  assertEquals(second.targetSignature, first.targetSignature);
  loaded.dispose();
});

Deno.test("applyModelLoops restores for_each_list from IR", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const element = workspace.newBlock("element");
  element.setFieldValue("slot/code", "SLOT_ID");
  const model = createEmptyModel("t1");
  model.loops = [{
    attachSlotId: "slot/code",
    varName: "code",
    path: "",
    kind: "list",
    collection: 'list("I10")',
  }];
  applyModelLoops(workspace, model);
  const parent = element.getParent();
  assertEquals(parent?.type, "for_each_list");
  assertEquals(parent?.getFieldValue("VAR"), "code");
  const ir = workspaceToModelJson(workspace);
  assertEquals(ir.loops[0]?.kind, "list");
  assertEquals(ir.loops[0]?.collection, 'list("I10")');
  workspace.dispose();
});

Deno.test("empty model uses Mapping Model version 3", () => {
  assertEquals(createEmptyModel("t").modelVersion, MODEL_VERSION);
  assertEquals(MODEL_VERSION, 3);
});

Deno.test("lists_getIndex in a value slot is a kept expression, not unsupported", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/code", "SLOT_ID");
  const get = workspace.newBlock("lists_getIndex") as Blockly.Block & {
    updateAt_?: (hasAt: boolean) => void;
  };
  get.setFieldValue("GET", "MODE");
  get.setFieldValue("FROM_START", "WHERE");
  get.updateAt_?.(true);
  const list = workspace.newBlock("lists_create_with") as Blockly.Block & {
    itemCount_?: number;
    updateShape_?: () => void;
  };
  list.itemCount_ = 2;
  list.updateShape_?.();
  const a = workspace.newBlock("text");
  a.setFieldValue("I10", "TEXT");
  const b = workspace.newBlock("text");
  b.setFieldValue("E11", "TEXT");
  list.getInput("ADD0")!.connection!.connect(a.outputConnection!);
  list.getInput("ADD1")!.connection!.connect(b.outputConnection!);
  const num = workspace.newBlock("math_number");
  num.setFieldValue("2", "NUM");
  get.getInput("VALUE")!.connection!.connect(list.outputConnection!);
  get.getInput("AT")!.connection!.connect(num.outputConnection!);
  slot.getInput("VALUE")!.connection!.connect(get.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/code");
  assertEquals(mapped?.expression, 'lists_getIndex(list("I10", "E11"), "FROM_START", 2)');
  assertEquals(
    ir.unsupported.some((u) => u.blockType === "lists_getIndex"),
    false,
    "read-only lists_getIndex is VMS Keep, not unsupported",
  );
  assertEquals(
    evaluate(mapped!.expression, createSourceContext("{}", "json"), "string"),
    "E11",
  );
  workspace.dispose();
});

Deno.test("out-of-dialect text_handlebars is recorded as an escape hatch", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/note", "SLOT_ID");
  const render = workspace.newBlock("text_handlebars");
  const script = workspace.newBlock("text");
  script.setFieldValue("{{#with patient}}{{name}}{{/with}}", "TEXT");
  render.getInput("SCRIPT")!.connection!.connect(script.outputConnection!);
  slot.getInput("VALUE")!.connection!.connect(render.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/note");
  assertEquals(mapped?.hatch, { kind: "text_handlebars" });
  assert(ir.unsupported.some((u) => u.blockType === "text_handlebars" && u.reason === "escape"));
  workspace.dispose();
});

Deno.test("in-dialect text_handlebars is not an escape hatch", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/note", "SLOT_ID");
  const render = workspace.newBlock("text_handlebars");
  const script = workspace.newBlock("text");
  script.setFieldValue("{{name}}", "TEXT");
  render.getInput("SCRIPT")!.connection!.connect(script.outputConnection!);
  slot.getInput("VALUE")!.connection!.connect(render.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  const mapped = ir.slots.find((s) => s.slotId === "slot/note");
  assertEquals(mapped?.expression, 'handlebars("{{name}}", map())');
  assertEquals(mapped?.hatch, undefined);
  assertEquals(
    ir.unsupported.some((u) => u.blockType === "text_handlebars"),
    false,
  );
  workspace.dispose();
});

Deno.test("procedures_callreturn is a first-class call(), not an escape hatch", () => {
  ensure();
  assert(Blockly.Blocks["procedures_callreturn"], "procedures_callreturn stays registered");
  const workspace = new Blockly.Workspace();
  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/fn", "SLOT_ID");
  const call = workspace.newBlock("procedures_callreturn");
  call.setFieldValue("greet", "NAME");
  slot.getInput("VALUE")!.connection!.connect(call.outputConnection!);

  const ir = workspaceToModelJson(workspace);
  assertEquals(
    ir.unsupported.some((u) => u.blockType === "procedures_callreturn"),
    false,
    `expected no procedures hatch, got ${JSON.stringify(ir.unsupported)}`,
  );
  assertEquals(ir.slots.find((s) => s.slotId === "slot/fn")?.expression, 'call("greet")');
  workspace.dispose();
});

Deno.test("schema optional fields are marked optional on targetSignature", () => {
  ensure();
  const xsd = Deno.readTextFileSync(
    join(import.meta.dirname!, "./fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd"),
  );
  const target = getTargetFormatHandler("xml-schema").load("edit01.xsd", xsd);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(
    workspace,
    target.skeleton,
    createEmptyModel(target.targetId),
    null,
    "en",
    "xml-schema",
  );
  const keywords = workspace.getAllBlocks(false).find((block) => block.type === "schema_Keywords");
  assert(keywords, "expected schema_Keywords");
  composeSchemaOptionalFields(keywords, ["TextKeywords"]);
  attachOptionalSchemaChild(workspace, keywords, "TextKeywords");
  const child = keywords.getInput(schemaOptionalInputName("TextKeywords"))?.connection?.targetBlock();
  assert(child, "expected optional TextKeywords child");
  const childSlot = child.getFieldValue("SLOT_ID");
  assert(childSlot, "optional child has SLOT_ID");

  const ir = workspaceToModelJson(workspace);
  const node = findSignature(ir.targetSignature, childSlot);
  assertEquals(node?.optional, true);
  assert(ir.optionalRm.some((row) => row.attributeName === "TextKeywords"));
  workspace.dispose();
});

Deno.test("lung-MDT fixture Blockly extracts unsupported Remove types and round-trips", () => {
  ensure();
  const xsd = Deno.readTextFileSync(
    join(import.meta.dirname!, "./fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd"),
  );
  const target = getTargetFormatHandler("xml-schema").load("edit01.xsd", xsd);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(
    workspace,
    target.skeleton,
    createEmptyModel(target.targetId),
    null,
    "en",
    "xml-schema",
  );
  const mapping = JSON.parse(
    Deno.readTextFileSync(
      join(import.meta.dirname!, "./fixtures/lung-MDT-form/mapping/mapping.blockly.json"),
    ),
  );
  Blockly.serialization.workspaces.load(mapping, workspace);
  const first = workspaceToModelJson(workspace);
  assert(
    first.unsupported.some((u) => u.blockType === "controls_if" && u.reason === "removed"),
    "leftover statement-if is recorded as removed, not an If IR node",
  );
  assertEquals(
    first.unsupported.some((u) => u.blockType === "text_code" && u.reason === "escape"),
    false,
    "lung-MDT Handlebars text_code is VMS-Hbs, not an escape hatch",
  );
  assertEquals(first.loops.some((loop) => (loop as { if?: unknown }).if != null), false);
  const saved = Blockly.serialization.workspaces.save(workspace);
  workspace.dispose();

  const loaded = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(
    loaded,
    target.skeleton,
    createEmptyModel(target.targetId),
    null,
    "en",
    "xml-schema",
  );
  Blockly.serialization.workspaces.load(saved, loaded);
  const second = workspaceToModelJson(loaded);
  assertEquals(second.unsupported, first.unsupported);
  assertEquals(second.slots, first.slots);
  assertEquals(second.targetSignature, first.targetSignature);
  loaded.dispose();
});
