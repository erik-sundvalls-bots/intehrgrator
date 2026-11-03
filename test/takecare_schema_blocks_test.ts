import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { registerTargetBlocks } from "@intehrgrator/blockly/blocks/target_blocks.ts";
import { registerExpressionBlocks } from "@intehrgrator/blockly/blocks/expression_blocks.ts";
import { registerTextBlocks } from "@intehrgrator/blockly/blocks/text_blocks.ts";
import { registerIncludeWhenBlock } from "@intehrgrator/blockly/blocks/include_when.ts";
import { registerLogicBlocks } from "@intehrgrator/blockly/blocks/logic_blocks.ts";
import {
  composeSchemaOptionalFields,
  schemaOptionalInputName,
} from "@intehrgrator/blockly/blocks/schema_mutator.ts";
import {
  attachOptionalSchemaChild,
  loadSkeletonIntoWorkspace,
} from "@intehrgrator/blockly/skeleton_loader.ts";
import { createSchemaStructureBlock } from "@intehrgrator/blockly/schema_blocks.ts";
import { findSkeletonNode } from "@intehrgrator/blockly/schema_catalog.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  detectTargetFormat,
  getTargetFormatHandler,
  stripBom,
} from "@intehrgrator/core/target/mod.ts";
import { schemaChildInputKind } from "@intehrgrator/core/target/schema_block_ids.ts";
import "blockly/blocks";

const VALUE_INPUT = 1;
const STATEMENT_INPUT = 3;

function readEdit01(): string {
  return Deno.readTextFileSync(
    join(import.meta.dirname!, "./fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd"),
  );
}

function loadTakeCareWorkspace(): { workspace: Blockly.Workspace; root: Blockly.Block } {
  registerTargetBlocks();
  registerMapBlocks();
  registerExpressionBlocks();
  registerTextBlocks();
  registerIncludeWhenBlock();
  registerLogicBlocks();
  const target = getTargetFormatHandler("xml-schema").load(
    "TakeCare-CasenoteWrite-edit01.xsd",
    readEdit01(),
  );
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(
    workspace,
    target.skeleton,
    createEmptyModel(target.targetId),
    null,
    "en",
    "xml-schema",
  );
  const root = workspace.getAllBlocks(false).find((block) =>
    block.type === "schema_ProfdocHISMessage"
  );
  assert(root, "expected schema_ProfdocHISMessage root");
  return { workspace, root };
}

function childNamed(node: { children: Array<{ rmAttribute?: string; label: string }> }, name: string) {
  return node.children.find((child) => (child.rmAttribute ?? child.label) === name);
}

Deno.test("TakeCare-CasenoteWrite-edit01 orders Signed before Signer and includes Value", () => {
  const edit01 = getTargetFormatHandler("xml-schema").load("edit01.xsd", readEdit01());
  const editRoot = edit01.skeleton[0];
  const names = editRoot.children.map((child) => child.rmAttribute);
  assertEquals(
    names.slice(names.indexOf("EventTime"), names.indexOf("TemplateId") + 1),
    ["EventTime", "Signed", "Signer", "TemplateId"],
    "Signed must precede Signer to match TakeCare XML",
  );
  const numeric = childNamed(childNamed(childNamed(editRoot, "Keywords")!, "NumericKeywords")!, "NumericKeyword");
  assert(childNamed(numeric!, "Value"), "edit01 NumericKeyword includes Value");
});

Deno.test("XSD skeleton inlines primitives and uses mouths only for repeating complexes", () => {
  const target = getTargetFormatHandler("xml-schema").load("edit01.xsd", readEdit01());
  const root = target.skeleton[0];
  assertEquals(root.blockType, "schema_ProfdocHISMessage");
  assertEquals(root.rmAttribute, "ProfdocHISMessage");

  const patId = childNamed(root, "PatId")!;
  assertEquals(patId.kind, "value");
  assertEquals(schemaChildInputKind(patId), "value");

  const keywords = childNamed(root, "Keywords")!;
  assertEquals(keywords.kind, "container");
  assertEquals(keywords.blockType, "schema_Keywords");
  assertEquals(schemaChildInputKind(keywords), "value", "Keywords is a single occurrence puzzle piece");

  const textKeywords = childNamed(keywords, "TextKeywords")!;
  assertEquals(textKeywords.mandatory, false);
  assertEquals(schemaChildInputKind(textKeywords), "value");

  const textKeyWord = childNamed(textKeywords, "TextKeyWord")!;
  assertEquals(textKeyWord.blockType, "schema_TextKeyWord");
  assertEquals(schemaChildInputKind(textKeyWord), "statement", "unbounded TextKeyWord is a mouth");
  assertEquals(childNamed(textKeyWord, "TermId")?.kind, "value");
  assertEquals(childNamed(textKeyWord, "Note")?.kind, "value");

  const msgType = childNamed(root, "MsgType")!;
  assertEquals(msgType.xmlKind, "attribute");
  assertEquals(msgType.fixedValue, "Request");
  assertEquals(childNamed(root, "Time")?.xmlKind, "attribute");
  assertEquals(childNamed(root, "InvokingSystem")?.xmlKind, "attribute");
});

Deno.test("TakeCare Blockly uses value slots, schema types, and connection checks", () => {
  const { workspace, root } = loadTakeCareWorkspace();
  try {
    assertEquals(root.getInput("TARGET_PatId")?.type, VALUE_INPUT);
    assertEquals(root.getInput("TARGET_UserId")?.type, VALUE_INPUT);
    assertEquals(root.getInput("TARGET_EventTime")?.type, VALUE_INPUT);
    assertEquals(root.getInput("TARGET_Signer")?.type, VALUE_INPUT);
    assertEquals(root.getInput("TARGET_Keywords")?.type, VALUE_INPUT);
    assertEquals(root.getInput("TARGET_MsgType")?.type, VALUE_INPUT);

    assertFalse(
      workspace.getAllBlocks(false).some((block) => block.type === "target_value"),
      "primitive UserId/PatId must not be wrapper blocks",
    );

    const keywords = root.getInput("TARGET_Keywords")?.connection?.targetBlock();
    assert(keywords);
    assertEquals(keywords.type, "schema_Keywords");

    composeSchemaOptionalFields(keywords, ["TextKeywords"]);
    attachOptionalSchemaChild(workspace, keywords, "TextKeywords");
    const textKeywords = keywords.getInput(schemaOptionalInputName("TextKeywords"))
      ?.connection?.targetBlock();
    assert(textKeywords);
    assertEquals(textKeywords.type, "schema_TextKeywords");
    assertEquals(textKeywords.getInput("TARGET_TextKeyWord")?.type, STATEMENT_INPUT);

    const textKeyWord = textKeywords.getInput("TARGET_TextKeyWord")?.connection?.targetBlock();
    assert(textKeyWord);
    assertEquals(textKeyWord.type, "schema_TextKeyWord");
    assertEquals(textKeyWord.getInput("TARGET_TermId")?.type, VALUE_INPUT);
    assertEquals(textKeyWord.getInput("TARGET_Note")?.type, VALUE_INPUT);

    const datetimeNode = findSkeletonNode(root.getFieldValue("SLOT_ID"))
      ?.children.find((child) => child.rmAttribute === "Keywords")
      ?.children.find((child) => child.rmAttribute === "DatetimeKeywords")
      ?.children.find((child) => child.rmAttribute === "DatetimeKeyword");
    assert(datetimeNode);
    const datetime = createSchemaStructureBlock(workspace, datetimeNode, false);
    assert(
      !workspace.connectionChecker.canConnect(
        textKeywords.getInput("TARGET_TextKeyWord")!.connection!,
        datetime.previousConnection!,
        false,
      ),
      "DatetimeKeyword must not plug into the TextKeyWord mouth",
    );

    assert(
      !workspace.connectionChecker.canConnect(
        root.getInput("TARGET_PatId")!.connection!,
        keywords.outputConnection!,
        false,
      ),
      "Keywords structure must not plug into the PatId string slot",
    );

    const termIdConn = textKeyWord.getInput("TARGET_TermId")!.connection!;
    const noteBlock = workspace.newBlock("text");
    noteBlock.setFieldValue("not a number", "TEXT");
    assert(
      !workspace.connectionChecker.canConnect(termIdConn, noteBlock.outputConnection!, false),
      "TermId number slot must reject a string literal",
    );
    const number = workspace.newBlock("math_number");
    assert(
      workspace.connectionChecker.canConnect(termIdConn, number.outputConnection!, false),
      "TermId number slot must accept math_number",
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("TakeCare optional TextKeywords survive Blockly JSON reload", () => {
  const { workspace } = loadTakeCareWorkspace();
  const reload = new Blockly.Workspace();
  try {
    const root = workspace.getAllBlocks(false).find((block) =>
      block.type === "schema_ProfdocHISMessage"
    )!;
    const keywords = root.getInput("TARGET_Keywords")?.connection?.targetBlock();
    assert(keywords);
    composeSchemaOptionalFields(keywords, ["TextKeywords"]);
    attachOptionalSchemaChild(workspace, keywords, "TextKeywords");
    const json = Blockly.serialization.workspaces.save(workspace);
    Blockly.serialization.workspaces.load(json, reload);
    const restoredKeywords = reload.getAllBlocks(false).find((block) =>
      block.type === "schema_Keywords"
    );
    assert(restoredKeywords);
    const opt = restoredKeywords.getInput(schemaOptionalInputName("TextKeywords"));
    assertEquals(opt?.type, VALUE_INPUT);
    const textKeywords = opt?.connection?.targetBlock();
    assert(textKeywords);
    assertEquals(textKeywords.type, "schema_TextKeywords");
    assert(textKeywords.outputConnection, "TextKeywords must remain a puzzle piece");
  } finally {
    workspace.dispose();
    reload.dispose();
  }
});

Deno.test("BOM-prefixed XSD still loads as xml-schema", () => {
  const bom = `\uFEFF${readEdit01()}`;
  assertEquals(detectTargetFormat("TakeCare-CasenoteWrite-edit01.xsd", bom), "xml-schema");
  assertEquals(stripBom(bom).charCodeAt(0) !== 0xfeff, true);
  const target = getTargetFormatHandler("xml-schema").load("edit01.xsd", bom);
  assertEquals(target.skeleton[0].blockType, "schema_ProfdocHISMessage");
});

Deno.test("lung-MDT Blockly mapping uses TakeCare schema blocks, not generic XML", async () => {
  const { extractTakeCareKeywords } = await import(
    "../scripts/build-lung-mdt-blockly.ts"
  );
  const script = await Deno.readTextFile(
    join(import.meta.dirname!, "./fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt"),
  );
  const extracted = extractTakeCareKeywords(script);
  assertEquals(extracted.filter((item) => item.kind === "TextKeyWord").length, 17);
  assertEquals(extracted.filter((item) => item.kind === "DatetimeKeyword").length, 1);

  const mapping = JSON.parse(
    await Deno.readTextFile(
      join(import.meta.dirname!, "./fixtures/lung-MDT-form/mapping/mapping.blockly.json"),
    ),
  ) as { blocks?: { blocks?: Array<{ type?: string }> } };
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.type === "string") types.push(rec.type);
    for (const value of Object.values(rec)) walk(value);
  };
  walk(mapping);
  assert(types.includes("schema_ProfdocHISMessage"));
  assertEquals(types.filter((type) => type === "schema_TextKeyWord").length, 17);
  assertEquals(types.filter((type) => type === "schema_DatetimeKeyword").length, 1);
  assertEquals(types.includes("xml_element"), false);
  assertEquals(types.includes("target_value"), false);
  assert(types.includes("logic_compare"));
  assert(types.includes("logic_list_restriction"));
  assertEquals(types.includes("logic_ternary"), false);

  const { workspace } = loadTakeCareWorkspace();
  try {
    Blockly.serialization.workspaces.load(mapping, workspace);
    const loaded = workspace.getAllBlocks(false).map((block) => block.type);
    assertEquals(loaded.filter((type) => type === "schema_TextKeyWord").length, 17);
    const keywords = workspace.getAllBlocks(false).find((block) => block.type === "schema_Keywords");
    assertEquals(keywords?.getInput(schemaOptionalInputName("TextKeywords"))?.type, VALUE_INPUT);
  } finally {
    workspace.dispose();
  }
});

Deno.test("chemo-symptoms Blockly mapping covers every PROD TermId on schema blocks", async () => {
  const {
    ALL_NEJ_COMPARES,
    CHEMO_KEYWORDS,
    extractProdTermIds,
  } = await import("../scripts/build-chemo-symptoms-blockly.ts");
  const script = await Deno.readTextFile(
    join(
      import.meta.dirname!,
      "./fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-prod.txt",
    ),
  );
  assertEquals(
    CHEMO_KEYWORDS.map((item) => item.termId),
    extractProdTermIds(script),
  );
  assertEquals(CHEMO_KEYWORDS.filter((item) => item.kind === "TextKeyWord").length, 16);
  assertEquals(CHEMO_KEYWORDS.filter((item) => item.kind === "NumericKeyword").length, 2);
  const noneChunk = script.slice(
    script.indexOf("Om patienten svarat"),
    script.indexOf("{{else}}"),
  );
  assertEquals(ALL_NEJ_COMPARES.length, 17);
  for (const cmp of ALL_NEJ_COMPARES) {
    assert(noneChunk.includes(cmp.path), `all-Nej if should include ${cmp.path}`);
  }

  const mapping = JSON.parse(
    await Deno.readTextFile(
      join(
        import.meta.dirname!,
        "./fixtures/patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json",
      ),
    ),
  ) as { blocks?: { blocks?: Array<{ type?: string }> } };
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.type === "string") types.push(rec.type);
    for (const value of Object.values(rec)) walk(value);
  };
  walk(mapping);
  assert(types.includes("schema_ProfdocHISMessage"));
  assertEquals(types.filter((type) => type === "schema_TextKeyWord").length, 16);
  assertEquals(types.filter((type) => type === "schema_NumericKeyword").length, 2);
  assertEquals(types.includes("xml_element"), false);
  assertEquals(types.includes("target_value"), false);
  for (const termId of extractProdTermIds(script)) {
    assert(JSON.stringify(mapping).includes(termId), `mapping should include TermId ${termId}`);
  }

  const { workspace } = loadTakeCareWorkspace();
  try {
    Blockly.serialization.workspaces.load(mapping, workspace);
    const loaded = workspace.getAllBlocks(false).map((block) => block.type);
    assertEquals(loaded.filter((type) => type === "schema_TextKeyWord").length, 16);
    assertEquals(loaded.filter((type) => type === "schema_NumericKeyword").length, 2);
    const keywords = workspace.getAllBlocks(false).find((block) =>
      block.type === "schema_Keywords"
    );
    assertEquals(keywords?.getInput(schemaOptionalInputName("TextKeywords"))?.type, VALUE_INPUT);
    assertEquals(keywords?.getInput(schemaOptionalInputName("NumericKeywords"))?.type, VALUE_INPUT);
  } finally {
    workspace.dispose();
  }
});
