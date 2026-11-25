import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  applyExpressionEdit,
  createEmptyModel,
} from "@intehrgrator/core/mapping_model/mod.ts";
import { generate, generateXQuery } from "@intehrgrator/core/codegen/mod.ts";
import {
  ensureXQueryRuntime,
  isXQueryRuntimeLoaded,
  runGeneratedXQuery,
} from "@intehrgrator/core/codegen/run_xquery.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { collectValueSlots, generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { normalizeSheet } from "@intehrgrator/core/sheets/mod.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import {
  HANDLEBARS_GREETING_OUTPUT,
  HANDLEBARS_GREETING_SOURCE,
  HANDLEBARS_GREETING_TEMPLATE,
  handlebarsGreetingCanvas,
} from "./handlebars_canvas_fixture.ts";

Deno.test("XQuery runtime module lazy-loads via dynamic import()", async () => {
  const src = await Deno.readTextFile(
    new URL("../src/core/codegen/run_xquery.ts", import.meta.url),
  );
  assertStringIncludes(src, 'import("fontoxpath")');
  assertStringIncludes(src, 'import("slimdom")');
  await ensureXQueryRuntime();
  assertEquals(isXQueryRuntimeLoaded(), true);
});

Deno.test("generate(xquery) with BP skeleton emits COMPOSITION RM XML", async () => {
  const { model, skeleton, xq } = await mappedBpXQuery("xml");
  assertStringIncludes(xq, 'local:rm-to-xml("composition"');
  assertStringIncludes(xq, '"_type": "COMPOSITION"');
  assertStringIncludes(xq, "DV_QUANTITY");
  assertStringIncludes(xq, "$source?systolic");
  assertEquals(xq.includes("element mapping-result"), false);
  assert(skeleton.length > 0);
  assert(model.templateId.length > 0);
});

Deno.test("openEHR JSON instance shape emits XPath maps instead of RM XML", async () => {
  const { xq } = await mappedBpXQuery("json");
  assertStringIncludes(xq, 'declare option output:method "json"');
  assertStringIncludes(xq, 'map { "_type": "COMPOSITION"');
  assertEquals(xq.includes('local:rm-to-xml("composition"'), false);
});

Deno.test("XQuery Output mode runs generated .xq against the Active Example", async () => {
  await ensureXQueryRuntime();
  const { model, skeleton, xq } = await mappedBpXQuery("xml");
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  target.skeleton = skeleton;
  const result = runTest(model, JSON.stringify({ systolic: 120 }), "json", {
    target,
    outputMode: "xquery",
    generatedCode: xq,
    defaults: { language: "en" },
    instanceShape: "xml",
  });
  assertEquals(result.error, undefined, result.error);
  const xml = String(result.output);
  assertStringIncludes(xml, "composition");
  assertStringIncludes(xml, 'xmlns="http://schemas.openehr.org/v1"');
  assertStringIncludes(xml, "120");
});

Deno.test("XQuery sheet_lookup matches TypeScript/preview on a terminology grid", async () => {
  await ensureXQueryRuntime();
  const sheet = normalizeSheet({
    name: "icd10_snomed",
    headers: ["code", "snomed", "rubric"],
    values: [["I10", "38341003", "Hypertension"]],
  });
  const model = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const xq = generate(model, "xquery");
  const preview = runTest(model, "{}", "json", { sheets: [sheet] });
  const xquery = runTest(model, "{}", "json", {
    outputMode: "xquery",
    generatedCode: xq,
    sheets: [sheet],
  });
  assertEquals(xquery.error, undefined, xquery.error);
  const previewSlots = (preview.output as { slots?: Record<string, unknown> }).slots;
  assertEquals(previewSlots?.s1, "38341003");
  const xml = String(xquery.output);
  assertStringIncludes(xml, "38341003");
});

Deno.test("runGeneratedXQuery binds $source JSON maps", async () => {
  await ensureXQueryRuntime();
  const model = applyExpressionEdit(
    createEmptyModel("vitals"),
    "s1",
    'xpathNumber("$.systolic")',
    { rmType: "DV_QUANTITY", returnType: "number" },
  );
  const xq = generateXQuery(model);
  const result = runGeneratedXQuery(xq, { source: { systolic: 118 } });
  assertStringIncludes(String(result), "118");
});

Deno.test("XQuery decision_table Test Run matches preview FIRST + range predicates", async () => {
  await ensureXQueryRuntime();
  const table = normalizeSheet({
    name: "sbp_band",
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["sbp", "band"],
    decisionColumns: [{ role: "condition" }, { role: "output", outputKind: "value" }],
    values: [
      ["90..120", "normal"],
      [">= 140", "high"],
      ["—", "other"],
    ],
  });
  const model = applyExpressionEdit(
    createEmptyModel("bands"),
    "s1",
    'decision_table("sbp_band", map("sbp", xpathNumber("$.systolic")), "band")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const preview = runTest(model, JSON.stringify({ systolic: 118 }), "json", { sheets: [table] });
  const xquery = runTest(model, JSON.stringify({ systolic: 118 }), "json", {
    outputMode: "xquery",
    generatedCode: generate(model, "xquery"),
    sheets: [table],
  });
  assertEquals(xquery.error, undefined, xquery.error);
  const previewSlots = (preview.output as { slots?: Record<string, unknown> }).slots;
  assertEquals(previewSlots?.s1, "normal");
  assertStringIncludes(String(xquery.output), "normal");
});

async function mappedBpXQuery(shape: "json" | "xml") {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const { templateId, skeleton } = generateSkeleton(opt);
  const systolic = collectValueSlots(skeleton).find((slot) =>
    slot.slotId.endsWith("items/at0004/value/value/value")
  );
  assert(systolic, "expected systolic value slot");
  let model = createEmptyModel(templateId);
  model.targetFormat = "openehr-template";
  model = applyExpressionEdit(model, systolic.slotId, 'xpathNumber("$.systolic")', {
    rmType: systolic.rmType,
    returnType: "number",
    label: systolic.label,
  });
  const xq = generate(model, "xquery", { skeleton, instanceShape: shape });
  return { model, skeleton, xq, templateId };
}

Deno.test("XQuery codegen emits intehrgrator:handlebars for canvas text_handlebars", () => {
  initBlocklyGenerators();
  const model = createEmptyModel("greeting");
  model.targetFormat = "free-form";
  const xq = generate(model, "xquery", { blocklyState: handlebarsGreetingCanvas() });
  assertStringIncludes(xq, "intehrgrator:handlebars");
  assertStringIncludes(xq, HANDLEBARS_GREETING_TEMPLATE);
  assertEquals(
    /local:convert[\s\S]*"Hello \{\{name\}\}!"\s*$/m.test(xq) &&
      !xq.includes("intehrgrator:handlebars"),
    false,
    "must not silently emit the template string without a render call",
  );
});

Deno.test("XQuery Test Run matches Mapping preview for canvas handlebars()", async () => {
  initBlocklyGenerators();
  await ensureXQueryRuntime();
  const model = createEmptyModel("greeting");
  model.targetFormat = "free-form";
  const canvas = handlebarsGreetingCanvas();
  const preview = runTest(model, HANDLEBARS_GREETING_SOURCE, "json", {
    outputMode: "preview",
    blocklyState: canvas,
    target: {
      format: "free-form",
      targetId: "greeting",
      filename: "g.hbs",
      content: "",
      skeleton: [],
    },
  });
  const xqRun = runTest(model, HANDLEBARS_GREETING_SOURCE, "json", {
    outputMode: "xquery",
    blocklyState: canvas,
    target: {
      format: "free-form",
      targetId: "greeting",
      filename: "g.hbs",
      content: "",
      skeleton: [],
    },
  });
  assertEquals(preview.error, undefined, preview.error);
  assertEquals(xqRun.error, undefined, xqRun.error);
  assertEquals(preview.output, HANDLEBARS_GREETING_OUTPUT);
  assertEquals(xqRun.output, HANDLEBARS_GREETING_OUTPUT);
});
