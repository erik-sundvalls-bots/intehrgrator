import { assert, assertEquals } from "@std/assert";
import {
  acceptAiSuggestion,
  clearMapping,
  isComplexMapping,
  rejectAiSuggestion,
  setFieldInBlocklyJson,
  setLiteralValue,
  setSimpleExpression,
  setSourceBinding,
  setTerminologyBinding,
} from "@intehrgrator/core/json_patch_helpers.ts";
import {
  type BlocklyWorkspaceJson,
  extractSlice,
  indexDocument,
} from "@intehrgrator/core/slice_engine.ts";
import { extractModelFromBlocklyJson } from "@intehrgrator/workbench/blockly_sync.ts";
import { generateTypeScript } from "@intehrgrator/core/codegen/mod.ts";
import { generateSkeletonFromWebTemplate } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";

const MHV1_MAPPING_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/mapping/mapping.blockly.json",
  import.meta.url,
);
const MHV1_WT_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json",
  import.meta.url,
);

function assertLoadsInHeadlessBlockly(doc: BlocklyWorkspaceJson, targetId: string): string[] {
  initBlocklyGenerators();
  const { sliceJson } = extractSlice(doc, targetId);
  const ws = new Blockly.Workspace();
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(sliceJson as Record<string, unknown>, ws);
    const types = ws.getAllBlocks(false).map((b) => b.type);
    assert(types.length > 0, "expected loaded blocks in headless workspace");
    return types;
  } finally {
    ws.dispose();
    Blockly.Events.enable();
  }
}

Deno.test("json_patch_helpers: source binding, literal, terminology, and verifiable simple expressions load in Blockly and pass codegen on MHV1", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const wt = await Deno.readTextFile(MHV1_WT_URL);
  const { skeleton, templateId } = generateSkeletonFromWebTemplate(wt);
  const idx = indexDocument(doc);

  const elements = [...idx.nodes.values()].filter((n) => n.type === "element" && n.status !== "ai-draft");
  assert(elements.length >= 6, "expected >=6 elements in MHV1");
  const [elSrc, elLit, elTerm, elScale, elTrim, elConcat, elFallback] = elements;

  // 1. Source binding
  let next = setSourceBinding(doc, elSrc.id, "$.patient.notes", "DV_TEXT");
  let types = assertLoadsInHeadlessBlockly(next, elSrc.id);
  assert(types.includes("source_query"), `expected source_query in ${types}`);
  assertEquals(indexDocument(next).nodes.get(elSrc.id)?.status, "mapped");

  // 2. Datatype-aware literal
  next = setLiteralValue(next, elLit.id, "DV_QUANTITY", 72.5);
  types = assertLoadsInHeadlessBlockly(next, elLit.id);
  assert(types.includes("dv_quantity") && types.includes("math_number"));
  assertEquals(indexDocument(next).nodes.get(elLit.id)?.status, "mapped");

  // 3. Terminology binding
  next = setTerminologyBinding(next, elTerm.id, "SNOMED-CT", "271649006", "Systolic blood pressure");
  types = assertLoadsInHeadlessBlockly(next, elTerm.id);
  assert(types.includes("dv_coded_text") && types.includes("code_phrase"));
  assertEquals(indexDocument(next).nodes.get(elTerm.id)?.status, "mapped");

  // 4. Simple expressions (verifiable Blockly primitives only)
  next = setSimpleExpression(
    next,
    elScale.id,
    { kind: "scale_offset", sourcePath: "$.weight_g", multiplier: 0.001, offset: 0 },
    "DV_QUANTITY",
  );
  types = assertLoadsInHeadlessBlockly(next, elScale.id);
  assert(types.includes("math_arithmetic") && types.includes("source_query_number"));

  next = setSimpleExpression(next, elTrim.id, { kind: "trim", sourcePath: "$.raw_note" }, "DV_TEXT");
  types = assertLoadsInHeadlessBlockly(next, elTrim.id);
  assert(types.includes("text_trim") && types.includes("source_query"));

  next = setSimpleExpression(
    next,
    elConcat.id,
    {
      kind: "concat",
      parts: [
        { kind: "source", path: "$.first" },
        { kind: "literal", text: " " },
        { kind: "source", path: "$.last" },
      ],
    },
    "DV_TEXT",
  );
  types = assertLoadsInHeadlessBlockly(next, elConcat.id);
  assert(types.includes("text_join"));

  next = setSimpleExpression(
    next,
    elFallback.id,
    { kind: "fallback", sourcePath: "$.opt_note", fallbackValue: "N/A", returnType: "string" },
    "DV_TEXT",
  );
  types = assertLoadsInHeadlessBlockly(next, elFallback.id);
  assert(types.includes("logic_ternary") && types.includes("logic_compare"));

  // 5. Shared field patch & clearMapping
  next = setFieldInBlocklyJson(next, elSrc.id, "NAME", "Patched Element Name");
  assertEquals(indexDocument(next).nodes.get(elSrc.id)?.label, "Patched Element Name");

  const cleared = clearMapping(next, elSrc.id);
  assert(indexDocument(cleared).nodes.get(elSrc.id)?.status !== "mapped");

  // 6. Headless model extraction & TypeScript codegen succeed on patched MHV1.
  const extract = extractModelFromBlocklyJson(next, skeleton);
  const ts = generateTypeScript(
    {
      ...createEmptyModel(templateId),
      slots: extract.slots,
      loops: extract.loops,
      optionalRm: extract.optionalRm,
      instanceEncodings: extract.instanceEncodings,
      functions: extract.functions,
      includes: extract.includes,
    },
    skeleton,
  );
  assert(ts.includes("$.patient.notes"), "generated TS must include patched source path");
  assert(ts.includes("271649006"), "generated TS must include patched terminology code");
});

Deno.test("json_patch_helpers: acceptAiSuggestion and rejectAiSuggestion work on single tiles and bulk subtrees", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);
  const compId = idx.compositionId!;
  assertEquals(idx.nodes.get(compId)?.counts.aiDraftLeaves, 6);

  // Accept one AI-draft leaf.
  const aiLeaf = [...idx.nodes.values()].find((n) => n.type === "element" && n.hasAiDraft)!;
  const afterOneAccept = acceptAiSuggestion(doc, aiLeaf.id);
  const idxOne = indexDocument(afterOneAccept);
  assertEquals(idxOne.nodes.get(aiLeaf.id)?.status, "mapped");
  assertEquals(idxOne.nodes.get(compId)?.counts.aiDraftLeaves, 5);

  // Bulk accept all remaining AI drafts across the whole composition.
  const afterBulkAccept = acceptAiSuggestion(afterOneAccept, compId, { recursive: true });
  const idxBulk = indexDocument(afterBulkAccept);
  assertEquals(idxBulk.nodes.get(compId)?.counts.aiDraftLeaves, 0);
  assertEquals(idxBulk.nodes.get(compId)?.counts.mappedLeaves, 6);

  // Reject one AI-draft leaf from original doc.
  const afterReject = rejectAiSuggestion(doc, aiLeaf.id);
  const idxRej = indexDocument(afterReject);
  assertEquals(idxRej.nodes.get(aiLeaf.id)?.hasAiDraft, false);
  assert(idxRej.nodes.get(aiLeaf.id)?.status !== "mapped");
  assertEquals(idxRej.nodes.get(compId)?.counts.aiDraftLeaves, 5);
});

Deno.test("json_patch_helpers: isComplexMapping guardrail detects complex Blockly trees and allows simple ones", () => {
  const doc: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "element",
          id: "el_simple",
          fields: { NAME: "Simple", VALUE_RM_TYPE: "DV_TEXT" },
          inputs: {
            VALUE: {
              block: {
                type: "dv_text",
                id: "dv_1",
                inputs: {
                  FLD_value: {
                    block: { type: "source_query", id: "sq_1", fields: { EXPRESSION: "$.a" } },
                  },
                },
              },
            },
          },
        },
        {
          type: "element",
          id: "el_complex_dt",
          fields: { NAME: "Decision Table", VALUE_RM_TYPE: "DV_TEXT" },
          inputs: {
            VALUE: {
              block: {
                type: "dv_text",
                id: "dv_2",
                inputs: {
                  FLD_value: {
                    block: { type: "decision_table_eval", id: "dt_1" },
                  },
                },
              },
            },
          },
        },
        {
          type: "element",
          id: "el_complex_if",
          fields: { NAME: "Compound Logic", VALUE_RM_TYPE: "DV_TEXT" },
          inputs: {
            VALUE: {
              block: {
                type: "dv_text",
                id: "dv_3",
                inputs: {
                  FLD_value: {
                    block: {
                      type: "logic_ternary",
                      id: "tern_1",
                      inputs: {
                        IF: { block: { type: "logic_operation", id: "op_1", fields: { OP: "AND" } } },
                        THEN: { block: { type: "text", id: "t1", fields: { TEXT: "yes" } } },
                        ELSE: { block: { type: "text", id: "t2", fields: { TEXT: "no" } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  assertEquals(isComplexMapping(doc, "el_simple").complex, false);
  assertEquals(isComplexMapping(doc, "el_complex_dt").complex, true);
  assertEquals(isComplexMapping(doc, "el_complex_if").complex, true);
});
