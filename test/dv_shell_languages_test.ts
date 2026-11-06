/**
 * #351: Java, XQuery, skeleton TypeScript, and Go templates emit the same
 * optional DATA_VALUE mouths as canvas TypeScript and Mapping preview.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { generateTypeScriptFromSkeleton } from "@intehrgrator/core/codegen/typescript.ts";
import { generateJava } from "@intehrgrator/core/codegen/java.ts";
import { generateXQuery } from "@intehrgrator/core/codegen/xquery.ts";
import { emitBlock } from "@intehrgrator/core/codegen/go_template.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import { generateGoTemplateFromWorkspace } from "@intehrgrator/blockly/go_template_codegen.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  dvFieldInputName,
  optionalDvFieldInputName,
  rmAttributeInputName,
  TERM_MAPPING_BLOCK,
} from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import type { MappingModel, RmShellFragment, SkeletonNode } from "@intehrgrator/types/mod.ts";

const mappings: RmShellFragment = {
  kind: "list",
  items: [{
    kind: "object",
    rmType: "TERM_MAPPING",
    fields: {
      match: { kind: "expr", expression: '"="' },
      target: {
        kind: "object",
        rmType: "CODE_PHRASE",
        fields: {
          terminology_id: { kind: "expr", expression: '"SNOMED-CT"' },
          code_string: { kind: "expr", expression: '"49727002"' },
        },
      },
    },
  }],
};

const hyperlink: RmShellFragment = {
  kind: "object",
  rmType: "DV_URI",
  fields: { value: { kind: "expr", expression: '"https://example.test/cough"' } },
};

function textModel(): MappingModel {
  const model = createEmptyModel("note");
  model.targetFormat = "openehr-template";
  model.slots = [{
    slotId: "note",
    rmType: "DV_TEXT",
    expression: '"cough"',
    returnType: "string",
    shellFragments: { mappings, hyperlink },
  }];
  return model;
}

function textSkeleton(): SkeletonNode[] {
  return [{
    slotId: "note",
    blockType: "dv_text",
    rmType: "DV_TEXT",
    label: "Note",
    kind: "value",
    mandatory: true,
    children: [],
  }];
}

function assertMouths(source: string): void {
  assertStringIncludes(source, "49727002");
  assertStringIncludes(source, "SNOMED-CT");
  assertStringIncludes(source, "https://example.test/cough");
  assertStringIncludes(source, "cough");
}

Deno.test("skeleton TypeScript emits mappings and hyperlink", () => {
  const code = generateTypeScriptFromSkeleton(textModel(), textSkeleton());
  assertMouths(code);
  assertStringIncludes(code, "TERM_MAPPING");
  assertStringIncludes(code, "DV_URI");
});

Deno.test("Java emits mappings and hyperlink with Archie setters", () => {
  const code = generateJava(textModel(), { skeleton: textSkeleton() });
  assertMouths(code);
  assertStringIncludes(code, "setMappings");
  assertStringIncludes(code, "setHyperlink");
  assertStringIncludes(code, "setMatch('=')");
  assertStringIncludes(code, "new TerminologyId(");
  assertStringIncludes(code, "import com.nedap.archie.rm.datavalues.TermMapping;");
});

Deno.test("XQuery JSON and XML emit mappings and hyperlink", () => {
  const model = textModel();
  const json = generateXQuery(model, { skeleton: textSkeleton(), instanceShape: "json" });
  assertMouths(json);
  assertStringIncludes(json, "TERM_MAPPING");
  assertStringIncludes(json, "TERMINOLOGY_ID");
  const xml = generateXQuery(model, { skeleton: textSkeleton(), instanceShape: "xml" });
  assertMouths(xml);
  assertStringIncludes(xml, "rm:mappings");
  assertStringIncludes(xml, "rm:hyperlink");
});

Deno.test("a quantity with no magnitude is omitted even when a range is set", () => {
  const model = createEmptyModel("weight");
  model.targetFormat = "openehr-template";
  model.slots = [{
    slotId: "weight",
    rmType: "DV_QUANTITY",
    expression: "",
    returnType: "number",
    shellFragments: {
      normal_range: {
        kind: "object",
        rmType: "DV_INTERVAL",
        fields: {
          lower_included: { kind: "expr", expression: "true" },
        },
      },
    },
  }];
  const skeleton: SkeletonNode[] = [{
    slotId: "weight",
    blockType: "dv_quantity",
    rmType: "DV_QUANTITY",
    label: "Weight",
    kind: "value",
    mandatory: false,
    children: [],
  }];
  const ts = generateTypeScriptFromSkeleton(model, skeleton);
  const java = generateJava(model, { skeleton });
  const xq = generateXQuery(model, { skeleton, instanceShape: "json" });
  assertEquals(ts.includes("normal_range"), false);
  assertEquals(java.includes("setNormalRange"), false);
  assertEquals(xq.includes("normal_range"), false);
});

Deno.test("Java and XQuery emit a reference range when the quantity has a magnitude", () => {
  const model = createEmptyModel("weight");
  model.targetFormat = "openehr-template";
  model.slots = [{
    slotId: "weight",
    rmType: "DV_QUANTITY",
    expression: "5",
    returnType: "number",
    shellFragments: {
      normal_range: {
        kind: "object",
        rmType: "DV_INTERVAL",
        fields: {
          lower_included: { kind: "expr", expression: "true" },
          lower_unbounded: { kind: "expr", expression: "false" },
        },
      },
    },
  }];
  const skeleton: SkeletonNode[] = [{
    slotId: "weight",
    blockType: "dv_quantity",
    rmType: "DV_QUANTITY",
    label: "Weight",
    kind: "value",
    mandatory: true,
    children: [],
  }];
  const java = generateJava(model, { skeleton });
  assertStringIncludes(java, "setNormalRange");
  assertStringIncludes(java, "DvInterval");
  const xq = generateXQuery(model, { skeleton, instanceShape: "json" });
  assertStringIncludes(xq, "normal_range");
  assertStringIncludes(xq, "DV_INTERVAL");
});

Deno.test("Go template canvas and the JSON walker emit mappings", () => {
  initBlocklyGenerators();
  const ws = new Blockly.Workspace();
  const composition = ws.newBlock("composition");
  const element = ws.newBlock("element");
  const text = ws.newBlock("dv_text") as Blockly.Block & {
    loadExtraState?: (state: { fields: string[] }) => void;
  };
  text.loadExtraState?.({ fields: ["mappings"] });
  const value = ws.newBlock("text");
  value.setFieldValue("cough", "TEXT");
  text.getInput(dvFieldInputName("value"))!.connection!.connect(value.outputConnection!);
  const mapping = ws.newBlock(TERM_MAPPING_BLOCK);
  const match = ws.newBlock("text");
  match.setFieldValue("=", "TEXT");
  mapping.getInput(dvFieldInputName("match"))!.connection!.connect(match.outputConnection!);
  const phrase = ws.newBlock("code_phrase");
  const code = ws.newBlock("text");
  code.setFieldValue("49727002", "TEXT");
  const term = ws.newBlock("text");
  term.setFieldValue("SNOMED-CT", "TEXT");
  phrase.getInput(dvFieldInputName("code_string"))!.connection!.connect(code.outputConnection!);
  phrase.getInput(dvFieldInputName("terminology_id"))!.connection!.connect(term.outputConnection!);
  mapping.getInput(dvFieldInputName("target"))!.connection!.connect(phrase.outputConnection!);
  text.getInput(optionalDvFieldInputName("mappings"))!.connection!.connect(mapping.outputConnection!);
  element.getInput("VALUE")!.connection!.connect(text.outputConnection!);
  const content = composition.getInput(rmAttributeInputName("content"))!;
  content.setCheck(null);
  content.connection!.connect(element.previousConnection!);
  const tmpl = generateGoTemplateFromWorkspace(ws, createEmptyModel("note"));
  assert(tmpl);
  assertStringIncludes(tmpl, "TERM_MAPPING");
  assertStringIncludes(tmpl, "49727002");
  assertStringIncludes(tmpl, "SNOMED-CT");
  assertStringIncludes(tmpl, "cough");
  assertStringIncludes(tmpl, "DV_TEXT");
  ws.dispose();

  const walked = emitBlock({
    type: "dv_text",
    fields: { RM_TYPE: "DV_TEXT" },
    inputs: {
      FLD_value: { block: { type: "text", fields: { TEXT: "cough" } } },
      OPTFLD_mappings: {
        block: {
          type: "term_mapping",
          fields: { RM_TYPE: "TERM_MAPPING" },
          inputs: {
            FLD_match: { block: { type: "text", fields: { TEXT: "=" } } },
            FLD_target: {
              block: {
                type: "code_phrase",
                fields: { RM_TYPE: "CODE_PHRASE" },
                inputs: {
                  FLD_code_string: { block: { type: "text", fields: { TEXT: "49727002" } } },
                  FLD_terminology_id: { block: { type: "text", fields: { TEXT: "SNOMED-CT" } } },
                },
              },
            },
          },
        },
      },
    },
  }).join("");
  assertStringIncludes(walked, "TERM_MAPPING");
  assertStringIncludes(walked, "49727002");
  assertStringIncludes(walked, "cough");
});
