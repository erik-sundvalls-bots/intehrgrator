/** #350: optional RM attributes on DATA_VALUE shells, plus the blocks those mouths need. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators, workspaceToModelJson } from "@intehrgrator/blockly/mod.ts";
import {
  dvFieldInputName,
  dvOptionalFieldNames,
  optionalDvFieldInputName,
  REFERENCE_RANGE_BLOCK,
  rmAttributeInputName,
  TERM_MAPPING_BLOCK,
} from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { generateTypeScriptFromWorkspace } from "@intehrgrator/blockly/typescript_codegen.ts";
import {
  runGeneratedTypeScript,
  serializedConversionOutput,
} from "@intehrgrator/core/codegen/run_typescript.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { octetBytes } from "@intehrgrator/core/rm_shell_fragment.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";

function workspace(): Blockly.Workspace {
  initBlocklyGenerators();
  return new Blockly.Workspace();
}

function showOptional(block: Blockly.Block, fields: string[]): void {
  const live = block as Blockly.Block & {
    loadExtraState?: (state: { fields: string[] }) => void;
  };
  assert(live.loadExtraState, `${block.type} cogwheel mutator`);
  live.loadExtraState({ fields });
}

function connectionCheck(block: Blockly.Block, inputName: string): string[] {
  const check = block.getInput(inputName)?.connection?.getCheck();
  return check ? [...check] : [];
}

Deno.test("#350 cogwheel lists the optional RM attributes that were missing", () => {
  assertEquals(
    dvOptionalFieldNames("DV_TEXT").filter((name) => name === "mappings" || name === "hyperlink").sort(),
    ["hyperlink", "mappings"],
  );
  assertEquals(
    dvOptionalFieldNames("DV_CODED_TEXT").includes("mappings") &&
      dvOptionalFieldNames("DV_CODED_TEXT").includes("hyperlink"),
    true,
  );
  for (const rmType of [
    "DV_QUANTITY",
    "DV_COUNT",
    "DV_PROPORTION",
    "DV_ORDINAL",
    "DV_SCALE",
    "DV_DURATION",
    "DV_DATE",
    "DV_DATE_TIME",
    "DV_TIME",
  ]) {
    const names = dvOptionalFieldNames(rmType);
    assert(names.includes("normal_range"), `${rmType} normal_range`);
    assert(names.includes("other_reference_ranges"), `${rmType} other_reference_ranges`);
  }
  for (const rmType of ["DV_DATE", "DV_DATE_TIME", "DV_TIME"]) {
    assert(dvOptionalFieldNames(rmType).includes("accuracy"), `${rmType} accuracy`);
  }
  assertEquals(dvOptionalFieldNames("DV_DURATION").includes("accuracy"), true);
  const media = dvOptionalFieldNames("DV_MULTIMEDIA");
  for (const name of ["data", "integrity_check", "thumbnail", "uri"]) {
    assert(media.includes(name), `DV_MULTIMEDIA ${name}`);
  }
  assertEquals(dvOptionalFieldNames("DV_INTERVAL").sort(), ["lower", "upper"]);
  assertEquals(dvOptionalFieldNames("TERM_MAPPING"), ["purpose"]);
  assertEquals(dvOptionalFieldNames("REFERENCE_RANGE"), []);
});

Deno.test("#350 optional mouths stay hidden until the cogwheel adds them", () => {
  const ws = workspace();
  const text = ws.newBlock("dv_text");
  assertEquals(text.getInput(optionalDvFieldInputName("mappings")), null);
  assertEquals(text.getInput(dvFieldInputName("value")) != null, true);
  showOptional(text, ["mappings", "hyperlink"]);
  assert(text.getInput(optionalDvFieldInputName("mappings")));
  assert(text.getInput(optionalDvFieldInputName("hyperlink")));
  assertEquals(connectionCheck(text, optionalDvFieldInputName("mappings")), ["TERM_MAPPING", "Array"]);
  assertEquals(connectionCheck(text, optionalDvFieldInputName("hyperlink")), ["DV_URI"]);

  const saved = Blockly.serialization.blocks.save(text);
  assert(saved);
  const again = Blockly.serialization.blocks.append(saved, ws);
  assert(again?.getInput(optionalDvFieldInputName("mappings")), "mappings survives a save/load");
  assert(again?.getInput(optionalDvFieldInputName("hyperlink")));
  ws.dispose();
});

Deno.test("#350 TERM_MAPPING and REFERENCE_RANGE blocks, and the mouths that were mandatory but hidden", () => {
  const ws = workspace();
  const mapping = ws.newBlock(TERM_MAPPING_BLOCK);
  assertEquals(mapping.getFieldValue("RM_TYPE"), "TERM_MAPPING");
  assert(mapping.getInput(dvFieldInputName("match")));
  assert(mapping.getInput(dvFieldInputName("target")));
  assertEquals(mapping.getInput(optionalDvFieldInputName("purpose")), null);
  showOptional(mapping, ["purpose"]);
  assertEquals(connectionCheck(mapping, optionalDvFieldInputName("purpose")).includes("DV_CODED_TEXT"), true);
  assertEquals(connectionCheck(mapping, dvFieldInputName("target")), ["String", "CODE_PHRASE"]);

  const range = ws.newBlock(REFERENCE_RANGE_BLOCK);
  assert(range.getInput(dvFieldInputName("meaning")));
  assert(range.getInput(dvFieldInputName("range")));
  assertEquals(range.getField("MUTATOR_COG") ?? null, null);

  const paragraph = ws.newBlock("dv_paragraph");
  assert(paragraph.getInput(dvFieldInputName("items")), "DV_PARAGRAPH items is mandatory");
  assertEquals(
    connectionCheck(paragraph, dvFieldInputName("items")).includes("DV_TEXT"),
    true,
  );

  const spec = ws.newBlock("dv_general_time_specification");
  assert(spec.getInput(dvFieldInputName("value")), "time specification value is DV_PARSABLE");
  assertEquals(connectionCheck(spec, dvFieldInputName("value")), ["DV_PARSABLE"]);

  const interval = ws.newBlock("dv_interval");
  assertEquals(interval.getInput(optionalDvFieldInputName("lower")), null);
  showOptional(interval, ["lower", "upper"]);
  assertEquals(connectionCheck(interval, optionalDvFieldInputName("lower")), ["DATA_VALUE"]);
  assertEquals(connectionCheck(interval, optionalDvFieldInputName("upper")), ["DATA_VALUE"]);

  const date = ws.newBlock("dv_date");
  showOptional(date, ["accuracy", "normal_range"]);
  assertEquals(connectionCheck(date, optionalDvFieldInputName("accuracy")), ["DV_DURATION"]);
  assertEquals(connectionCheck(date, optionalDvFieldInputName("normal_range")), ["DV_INTERVAL"]);

  const media = ws.newBlock("dv_multimedia");
  showOptional(media, ["data", "uri", "thumbnail"]);
  assertEquals(connectionCheck(media, optionalDvFieldInputName("data")), ["String", "Array"]);
  assertEquals(connectionCheck(media, optionalDvFieldInputName("uri")), ["DV_URI"]);
  assertEquals(connectionCheck(media, optionalDvFieldInputName("thumbnail")), ["DV_MULTIMEDIA"]);
  ws.dispose();
});

function connectText(ws: Blockly.Workspace, parent: Blockly.Block, inputName: string, text: string): void {
  const block = ws.newBlock("text");
  block.setFieldValue(text, "TEXT");
  parent.getInput(inputName)!.connection!.connect(block.outputConnection!);
}

/** ELEMENT's statement check is ITEM, not CONTENT_ITEM, so the test opens the mouth. */
function attachElement(composition: Blockly.Block, element: Blockly.Block): void {
  const content = composition.getInput(rmAttributeInputName("content"))!;
  content.setCheck(null);
  content.connection!.connect(element.previousConnection!);
}

Deno.test("#350 TypeScript from the canvas emits mappings, hyperlink, and a reference range", () => {
  const ws = workspace();
  const composition = ws.newBlock("composition");
  const element = ws.newBlock("element");
  element.setFieldValue("note/value", "SLOT_ID");
  const text = ws.newBlock("dv_text");
  showOptional(text, ["mappings", "hyperlink"]);
  connectText(ws, text, dvFieldInputName("value"), "cough");

  const mapping = ws.newBlock(TERM_MAPPING_BLOCK);
  connectText(ws, mapping, dvFieldInputName("match"), "=");
  const phrase = ws.newBlock("code_phrase");
  connectText(ws, phrase, dvFieldInputName("code_string"), "49727002");
  connectText(ws, phrase, dvFieldInputName("terminology_id"), "SNOMED-CT");
  mapping.getInput(dvFieldInputName("target"))!.connection!.connect(phrase.outputConnection!);
  text.getInput(optionalDvFieldInputName("mappings"))!.connection!.connect(mapping.outputConnection!);

  const link = ws.newBlock("dv_uri");
  connectText(ws, link, dvFieldInputName("value"), "https://example.test/cough");
  text.getInput(optionalDvFieldInputName("hyperlink"))!.connection!.connect(link.outputConnection!);
  element.getInput("VALUE")!.connection!.connect(text.outputConnection!);
  attachElement(composition, element);

  const code = generateTypeScriptFromWorkspace(ws, createEmptyModel("note"));
  assert(code, "canvas TypeScript");
  assertStringIncludes(code, "TERM_MAPPING");
  assertStringIncludes(code, "49727002");
  assertStringIncludes(code, "SNOMED-CT");
  assertStringIncludes(code, "hyperlink");
  assertStringIncludes(code, "https://example.test/cough");
  assertStringIncludes(code, "cough");
  const ran = JSON.stringify(serializedConversionOutput(
    runGeneratedTypeScript(code, { format: "json", data: {} }),
  ));
  assertStringIncludes(ran, "TERM_MAPPING");
  assertStringIncludes(ran, "49727002");
  assertStringIncludes(ran, "https://example.test/cough");

  const qty = ws.newBlock("dv_quantity");
  showOptional(qty, ["normal_range", "other_reference_ranges"]);
  const magnitude = ws.newBlock("math_number");
  magnitude.setFieldValue(5, "NUM");
  qty.getInput(dvFieldInputName("magnitude"))!.connection!.connect(magnitude.outputConnection!);
  connectText(ws, qty, dvFieldInputName("units"), "kg");
  const interval = ws.newBlock("dv_interval");
  showOptional(interval, ["lower"]);
  const lower = ws.newBlock("dv_quantity");
  const lowerMag = ws.newBlock("math_number");
  lowerMag.setFieldValue(1, "NUM");
  lower.getInput(dvFieldInputName("magnitude"))!.connection!.connect(lowerMag.outputConnection!);
  connectText(ws, lower, dvFieldInputName("units"), "kg");
  interval.getInput(optionalDvFieldInputName("lower"))!.connection!.connect(lower.outputConnection!);
  qty.getInput(optionalDvFieldInputName("normal_range"))!.connection!.connect(interval.outputConnection!);

  const range = ws.newBlock(REFERENCE_RANGE_BLOCK);
  const meaning = ws.newBlock("dv_text");
  connectText(ws, meaning, dvFieldInputName("value"), "therapeutic");
  range.getInput(dvFieldInputName("meaning"))!.connection!.connect(meaning.outputConnection!);
  const bounds = ws.newBlock("dv_interval");
  range.getInput(dvFieldInputName("range"))!.connection!.connect(bounds.outputConnection!);
  qty.getInput(optionalDvFieldInputName("other_reference_ranges"))!.connection!.connect(range.outputConnection!);
  const qtyHost = ws.newBlock("element");
  qtyHost.setFieldValue("weight/value", "SLOT_ID");
  qtyHost.getInput("VALUE")!.connection!.connect(qty.outputConnection!);
  element.unplug(false);
  attachElement(composition, qtyHost);

  const qtyCode = generateTypeScriptFromWorkspace(ws, createEmptyModel("weight"));
  assert(qtyCode);
  assertStringIncludes(qtyCode, "normal_range");
  assertStringIncludes(qtyCode, "DV_INTERVAL");
  assertStringIncludes(qtyCode, "REFERENCE_RANGE");
  assertStringIncludes(qtyCode, "therapeutic");
  ws.dispose();
});

Deno.test("#350 multimedia data emits as octet numbers, not a base64 string", () => {
  const ws = workspace();
  const composition = ws.newBlock("composition");
  const element = ws.newBlock("element");
  const media = ws.newBlock("dv_multimedia");
  showOptional(media, ["data"]);
  connectText(ws, media, optionalDvFieldInputName("data"), btoa("ab"));
  const phrase = ws.newBlock("code_phrase");
  connectText(ws, phrase, dvFieldInputName("code_string"), "image/png");
  connectText(ws, phrase, dvFieldInputName("terminology_id"), "IANA_media-types");
  media.getInput(dvFieldInputName("media_type"))!.connection!.connect(phrase.outputConnection!);
  const size = ws.newBlock("math_number");
  size.setFieldValue(2, "NUM");
  media.getInput(dvFieldInputName("size"))!.connection!.connect(size.outputConnection!);
  element.getInput("VALUE")!.connection!.connect(media.outputConnection!);
  attachElement(composition, element);
  const code = generateTypeScriptFromWorkspace(ws, createEmptyModel("media"));
  assert(code);
  assertStringIncludes(code, "atob");
  assertStringIncludes(code, btoa("ab"));
  ws.dispose();
});

Deno.test("#350 octet helper decodes base64 and keeps a byte list", () => {
  assertEquals(octetBytes(btoa("ab")), [97, 98]);
  assertEquals(octetBytes([4, 5]), [4, 5]);
  assertEquals(octetBytes(""), []);
});

Deno.test("#350 mapping preview includes mappings taken from the shell", () => {
  const ws = workspace();
  const element = ws.newBlock("element");
  element.setFieldValue("note/value", "SLOT_ID");
  const text = ws.newBlock("dv_text");
  showOptional(text, ["mappings"]);
  connectText(ws, text, dvFieldInputName("value"), "cough");
  const mapping = ws.newBlock(TERM_MAPPING_BLOCK);
  connectText(ws, mapping, dvFieldInputName("match"), "=");
  const phrase = ws.newBlock("code_phrase");
  connectText(ws, phrase, dvFieldInputName("code_string"), "49727002");
  connectText(ws, phrase, dvFieldInputName("terminology_id"), "SNOMED-CT");
  mapping.getInput(dvFieldInputName("target"))!.connection!.connect(phrase.outputConnection!);
  text.getInput(optionalDvFieldInputName("mappings"))!.connection!.connect(mapping.outputConnection!);
  element.getInput("VALUE")!.connection!.connect(text.outputConnection!);

  const extracted = workspaceToModelJson(ws).slots.find((slot) => slot.slotId === "note/value");
  const mappings = extracted?.shellFragments?.mappings;
  assert(mappings && mappings.kind === "list" && mappings.items.length === 1);
  const row = mappings.items[0]!;
  assertEquals(row.kind, "object");
  if (row.kind === "object") assertEquals(row.rmType, "TERM_MAPPING");

  const model = createEmptyModel("note");
  model.slots = [{
    slotId: "note/value",
    rmType: "DV_TEXT",
    expression: '"cough"',
    returnType: "string",
    shellFragments: extracted!.shellFragments,
  }];
  const skeleton: SkeletonNode[] = [{
    slotId: "note/value",
    blockType: "dv_text",
    rmType: "DV_TEXT",
    label: "Note",
    kind: "value",
    mandatory: true,
    children: [],
  }];
  const result = runTest(model, "{}", "json", {
    target: {
      format: "openehr-template",
      filename: "note.opt",
      targetId: "note",
      content: "",
      skeleton,
    },
  });
  const rendered = JSON.stringify(result.output);
  assertStringIncludes(rendered, "cough");
  assertStringIncludes(rendered, "TERM_MAPPING");
  assertStringIncludes(rendered, "49727002");
  assertStringIncludes(rendered, "SNOMED-CT");
  assertStringIncludes(rendered, "TERMINOLOGY_ID");
  ws.dispose();
});
