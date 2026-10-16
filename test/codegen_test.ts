import { assertEquals, assertStringIncludes, assert } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { createEmptyModel, applyExpressionEdit } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  generate,
  getExportTargetAdapter,
  jsonDollarPathToLookup,
  emitXQueryExpr,
  compileLoopSequence,
  emitJavaExpression,
  createJavaEmitContext,
  createTsEmitContext,
  emitTsExpression,
} from "@intehrgrator/core/codegen/mod.ts";
import { upsertLoop } from "@intehrgrator/core/mapping_model/mod.ts";
import { parseExpression } from "@intehrgrator/core/expression/mod.ts";
import { emitCodePhraseLiteral } from "@intehrgrator/core/codegen/typescript.ts";
import { CODE_PHRASE } from "ehrtslib/openehr_rm.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import {
  runGeneratedTypeScript,
  serializedConversionOutput,
  stripGeneratedTypeScript,
} from "@intehrgrator/core/codegen/run_typescript.ts";
import {
  canvasHandlebarsExpression,
  canvasHandlebarsScriptLiteral,
} from "@intehrgrator/core/output/canvas_handlebars.ts";
import { seedHandlebarsProductOnCanvas } from "@intehrgrator/core/output/canvas_handlebars_seed.ts";
import {
  HANDLEBARS_GREETING_OUTPUT,
  HANDLEBARS_GREETING_SOURCE,
  HANDLEBARS_GREETING_TEMPLATE,
  handlebarsGreetingCanvas,
} from "./handlebars_canvas_fixture.ts";
import { TEXT_DOCUMENT_BLOCK_TYPE } from "@intehrgrator/blockly/instance_root.ts";
import { TEXT_CODE_BLOCK_TYPE, TEXT_HANDLEBARS_BLOCK_TYPE } from "@intehrgrator/blockly/blocks/text_blocks.ts";
import { generateSkeleton, collectValueSlots, collectAllSlotIds } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  initBlocklyGenerators,
  loadSkeletonIntoWorkspace,
  generateTypeScriptFromWorkspace,
  generateTypeScriptFromBlocklyState,
  applyModelExpressions,
} from "@intehrgrator/blockly/mod.ts";
import { attachStartToInstanceRoot } from "@intehrgrator/blockly/conversion_start_canvas.ts";
import { importSuggestions } from "@intehrgrator/core/ai/mod.ts";

Deno.test("typescript codegen contains template id", () => {
  const model = applyExpressionEdit(createEmptyModel("vitals"), "s1", 'xpathNumber("/a")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
  });
  const ts = generate(model, "typescript");
  assertEquals(ts.includes("vitals"), true);
  assertEquals(ts.includes("evaluateXPathToNumber"), true);
  assertEquals(ts.includes("defaults: Record<string, unknown> = {}"), true);
  assertEquals(ts.includes("void evalExpr"), false);
  assertEquals(ts.includes("__evalGenerated"), false);
  assertEquals(ts.includes('"defaults" === "defaults"'), false);
});

Deno.test("typescript codegen emits sheetLookup helper for sheet_lookup slots", () => {
  const model = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const ts = generate(model, "typescript");
  assertStringIncludes(ts, "function sheetLookup");
  assertStringIncludes(ts, "sheetLookup(");
  assertStringIncludes(ts, "sheets:");
});

Deno.test("java codegen structure", () => {
  const model = createEmptyModel("vitals");
  model.targetFormat = "openehr-template";
  const java = generate(model, "java");
  assertEquals(java.includes("class ConversionScript"), true);
  assertStringIncludes(java, "package se.regionstockholm.intehrgrator.generated;");
  assertStringIncludes(java, "com.nedap.archie.rm.composition.Composition");
});

function jsonProductModel(templateId = "person") {
  const model = applyExpressionEdit(
    createEmptyModel(templateId),
    "name",
    'xpathString("$.name")',
    { rmType: "string", returnType: "string", label: "Name" },
  );
  model.targetFormat = "json-schema";
  return model;
}

const leftoverCompositionSkeleton = [{
  slotId: "c",
  blockType: "composition",
  rmType: "COMPOSITION",
  kind: "container" as const,
  mandatory: true,
  children: [],
}];

Deno.test("codegen omits openEHR libraries when the product is not openEHR", () => {
  const model = jsonProductModel();
  const java = generate(model, "java");
  const ts = generate(model, "typescript");
  const xq = generate(model, "xquery");

  assertEquals(java.includes("com.nedap.archie"), false, java);
  assertEquals(java.includes("Archie"), false, java);
  assertStringIncludes(java, "class ConversionScript");
  assertEquals(java.includes("Composition"), false, java);

  assertEquals(ts.includes("ehrtslib"), false, ts);
  assertEquals(ts.includes("COMPOSITION"), false, ts);
  assertStringIncludes(ts, "xpathString");

  assertEquals(xq.includes("http://schemas.openehr.org/v1"), false, xq);
  assertEquals(xq.includes("Archie"), false, xq);
  assertEquals(xq.includes("local:dv-text"), false, xq);
  assertStringIncludes(xq, "$source?name");
});

Deno.test("java codegen follows the canvas product over a leftover COMPOSITION skeleton", () => {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  try {
    const root = workspace.newBlock("json_object");
    attachStartToInstanceRoot(workspace, root);
    const model = jsonProductModel();
    const java = generate(model, "java", {
      blocklyState: Blockly.serialization.workspaces.save(workspace),
      skeleton: leftoverCompositionSkeleton,
    });
    const ts = generate(model, "typescript", {
      blocklyState: Blockly.serialization.workspaces.save(workspace),
      skeleton: leftoverCompositionSkeleton,
    });
    const xq = generate(model, "xquery", {
      blocklyState: Blockly.serialization.workspaces.save(workspace),
      skeleton: leftoverCompositionSkeleton,
    });
    assertEquals(java.includes("com.nedap.archie"), false, java);
    assertEquals(ts.includes("ehrtslib"), false, ts);
    assertEquals(xq.includes("http://schemas.openehr.org/v1"), false, xq);
  } finally {
    workspace.dispose();
  }
});

Deno.test("java expression emit maps xpath, maps_get, and sheet_lookup", () => {
  const ctx = createJavaEmitContext();
  assertEquals(
    emitJavaExpression(parseExpression('xpathNumber("$.systolic")'), ctx),
    'xpathNumber("$.systolic")',
  );
  assertEquals(
    emitJavaExpression(parseExpression('maps_get("defaults", "language")'), ctx),
    'defaults.get("language")',
  );
  const sheet = emitJavaExpression(
    parseExpression('sheet_lookup("icd10_snomed", "code", "I10", "snomed")'),
    ctx,
  );
  assertEquals(sheet, 'sheetLookup("icd10_snomed", "code", "I10", "snomed")');
  assert(ctx.helpers.has("sheets"));
});

Deno.test("java codegen emits sheetLookup helper for sheet_lookup slots", () => {
  const model = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const java = generate(model, "java");
  assertStringIncludes(java, "sheetLookup(");
  assertStringIncludes(java, "class Sheet");
  assertStringIncludes(java, "Map<String, Sheet> sheets");
});

Deno.test("java codegen emits source-node for_each_list iteration with relative loop paths", () => {
  let model = createEmptyModel("pulse-series");
  model = upsertLoop(model, {
    attachSlotId: "evt-1",
    varName: "measurements",
    path: "$.measurements",
    kind: "source",
  });
  const skeleton = [{
    slotId: "root",
    blockType: "observation",
    rmType: "OBSERVATION",
    label: "Pulse",
    kind: "container" as const,
    mandatory: true,
    children: [{
      slotId: "evt-1",
      blockType: "point_event",
      rmType: "POINT_EVENT",
      label: "Sample",
      kind: "container" as const,
      rmAttribute: "events",
      mandatory: true,
      children: [{
        slotId: "slot/rate",
        blockType: "dv_quantity",
        rmType: "DV_QUANTITY",
        label: "Rate",
        kind: "value" as const,
        rmAttribute: "data",
        mandatory: true,
        children: [],
        fixedFields: { units: "/min" },
      }],
    }],
  }];
  model = applyExpressionEdit(model, "slot/rate", 'xpathNumber("pulse")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
    label: "Rate",
  });
  const java = generate(model, "java", { skeleton });
  assertStringIncludes(java, 'xpathNodes("$.measurements")');
  assertStringIncludes(java, ".stream().map(measurements ->");
  assertStringIncludes(java, 'xpathNumber("pulse", measurements)');
  assertStringIncludes(java, "new PointEvent<>()");
  assertStringIncludes(java, 'new DvQuantity("/min", xpathNumber("pulse", measurements), null)');
});

Deno.test("java codegen from BP skeleton emits Archie RM constructors", async () => {
  const { java, model, skeleton } = await mappedBpJava();
  assertStringIncludes(java, "public class ConversionScript");
  assertStringIncludes(java, "new Composition()");
  assertStringIncludes(java, "new Observation()");
  assertStringIncludes(java, "new DvQuantity(");
  assertStringIncludes(java, "xpathNumber");
  assertStringIncludes(java, "$.systolic");
  assertStringIncludes(java, "defaults.get(");
  assertEquals(java.includes("TODO"), false);
  assertEquals(
    /\/\/ [^\n]+ = xpath/.test(java),
    false,
    "Java export must construct RM objects, not comment-only slot stubs",
  );
  assertStringIncludes(java, "RMObjectValidator");
  assert(model.templateId.length > 0);
  assert(skeleton.length > 0);
});

Deno.test("handlebars export target preserves a user-authored template", () => {
  const model = createEmptyModel("summary");
  const template = "Hello {{patient.name}}";
  assertEquals(generate(model, "handlebars", { handlebarsTemplate: template }), template);
});

Deno.test("Handlebars Output mode codegen prefers canvas text_handlebars SCRIPT", () => {
  initBlocklyGenerators();
  const model = createEmptyModel("greeting");
  model.targetFormat = "free-form";
  const hbs = generate(model, "handlebars", { blocklyState: handlebarsGreetingCanvas() });
  assertEquals(hbs, HANDLEBARS_GREETING_TEMPLATE);
  assertEquals(canvasHandlebarsScriptLiteral(handlebarsGreetingCanvas()), HANDLEBARS_GREETING_TEMPLATE);
  assertStringIncludes(
    canvasHandlebarsExpression(handlebarsGreetingCanvas()) ?? "",
    'handlebars("Hello {{name}}!"',
  );
});

Deno.test("Java codegen emits a Handlebars render helper for canvas text_handlebars", () => {
  initBlocklyGenerators();
  const model = createEmptyModel("greeting");
  model.targetFormat = "free-form";
  const java = generate(model, "java", { blocklyState: handlebarsGreetingCanvas() });
  assertStringIncludes(java, "handlebars(");
  assertStringIncludes(java, HANDLEBARS_GREETING_TEMPLATE);
  assertEquals(java.includes('asString("Hello {{name}}!")') && !java.includes("handlebars("), false);
  assert(
    java.includes("com.github.jknack.handlebars") || java.includes("VMS-Hbs"),
    "Java handlebars() must be a real render path or a loud VMS-Hbs stub",
  );
});

Deno.test("xquery codegen emits mapping-result module from Blockly slots", () => {
  const model = applyExpressionEdit(createEmptyModel("vitals"), "s1", 'xpathNumber("$.systolic")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
    label: "Systolic",
  });
  model.slots.push({
    slotId: "s2",
    rmType: "DV_TEXT",
    expression: 'concat(trim(xpathString("$.unit")), " Hg")',
    returnType: "string",
  });

  const xq = generate(model, "xquery");
  assertStringIncludes(xq, 'xquery version "3.1"');
  assertStringIncludes(xq, "vitals");
  assertStringIncludes(xq, "element mapping-result");
  assertStringIncludes(xq, "element slots");
  assertStringIncludes(xq, 'attribute id { "s1" }');
  assertStringIncludes(xq, "local:as-value");
  assertStringIncludes(xq, "DV_QUANTITY");
  assertStringIncludes(xq, "$source?systolic");
  assertStringIncludes(xq, "declare variable $defaults");
  assertStringIncludes(xq, "normalize-space");
  assertStringIncludes(xq, "concat(");

  const adapter = getExportTargetAdapter("xquery");
  assertEquals(adapter.extension, "xq");
  assertEquals(adapter.mime, "application/xquery");
});

Deno.test("typescript and xquery compile openEHR locator sugar before emit", () => {
  const expr =
    'xpathNumber("/content[openEHR-EHR-OBSERVATION.pulse.v2]/data/events[at0003]/value/magnitude")';
  const model = applyExpressionEdit(createEmptyModel("vitals"), "s1", expr, {
    rmType: "DV_QUANTITY",
    returnType: "number",
  });
  const ts = generate(model, "typescript");
  assertStringIncludes(ts, "?*[");
  assertStringIncludes(ts, "archetype_node_id");
  assertEquals(ts.includes("[openEHR-EHR-OBSERVATION.pulse.v2]"), false);

  const xq = generate(model, "xquery");
  assertStringIncludes(xq, "?archetype_node_id");
  assertStringIncludes(xq, "openEHR-EHR-OBSERVATION.pulse.v2");

  const java = generate(model, "java");
  assertStringIncludes(java, "@archetype_node_id=");
  assertEquals(java.includes("[openEHR-EHR-OBSERVATION.pulse.v2]"), false);
});

Deno.test("xquery expression emit maps builtins and JSON paths", () => {
  assertEquals(
    jsonDollarPathToLookup("$.patient.vitals[1].systolic"),
    "$source?patient?vitals?1?systolic",
  );
  assertEquals(
    jsonDollarPathToLookup("$.KurDagar[*].Substanser"),
    "$source?KurDagar?*?Substanser",
  );
  assertEquals(
    emitXQueryExpr(parseExpression('xpathString("/patient/name")')),
    'xs:string(($source/patient/name)[1])',
  );
  assertEquals(
    emitXQueryExpr(parseExpression('if(xpathBoolean("$.ok"), "a", "b")')),
    '(if (xs:boolean(($source?ok)[1])) then "a" else "b")',
  );
  assertEquals(
    emitXQueryExpr(parseExpression('maps_get("defaults", "language")')),
    '(if ("defaults" eq "defaults") then map:get($defaults, "language") else ())',
  );
  assertEquals(
    emitXQueryExpr(parseExpression('sheet_lookup("t", "code", "I10", "snomed")')),
    'local:sheet-lookup("t", "code", "I10", "snomed")',
  );
});

Deno.test("xquery export emits $sheets helpers for sheet accessors", () => {
  const model = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const xq = generate(model, "xquery");
  assertStringIncludes(xq, "declare variable $sheets");
  assertStringIncludes(xq, "local:sheet-lookup");
  assertStringIncludes(xq, "local:decision-table");
  assertStringIncludes(xq, '"icd10_snomed"');
});

Deno.test("xquery export emits source-node for_each_list iteration with relative loop paths", () => {
  let model = createEmptyModel("pulse-series");
  model = upsertLoop(model, {
    attachSlotId: "evt-1",
    varName: "measurements",
    path: "$.measurements",
    kind: "source",
  });
  model = applyExpressionEdit(model, "slot/rate", 'xpathNumber("pulse")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
    label: "Rate",
  });
  model = applyExpressionEdit(model, "slot/time", 'xpathString("timestamp")', {
    rmType: "DV_DATE_TIME",
    returnType: "string",
    label: "Time",
  });
  model = applyExpressionEdit(model, "slot/patient", 'xpathString("$.patient.id")', {
    rmType: "DV_TEXT",
    returnType: "string",
    label: "Patient",
  });

  const xq = generate(model, "xquery");
  assertStringIncludes(xq, "let $measurements_col := local:iterable-sequence($source?measurements)");
  assertStringIncludes(xq, "for $measurements at $measurements_pos in $measurements_col");
  assertStringIncludes(xq, "let $measurements_index := $measurements_pos - 1");
  assertStringIncludes(xq, "let $measurements_length := count($measurements_col)");
  assertStringIncludes(xq, "element loops");
  assertStringIncludes(xq, 'attribute attach-slot-id { "evt-1" }');
  assertStringIncludes(xq, 'attribute id { "slot/rate" }');
  assertStringIncludes(xq, "$measurements?pulse");
  assertStringIncludes(xq, "$measurements?timestamp");
  assertStringIncludes(xq, 'attribute id { "slot/patient" }');
  assertStringIncludes(xq, "$source?patient?id");
  assertEquals(xq.includes('attribute id { "slot/rate" }'), xq.indexOf("element loops") < xq.indexOf('attribute id { "slot/rate" }'));
  assertEquals(
    compileLoopSequence({ attachSlotId: "e", varName: "items", path: "$.readings[*]", kind: "source" }),
    "local:iterable-sequence($source?readings)",
  );
});

Deno.test("test runner evaluates json slot", () => {
  const model = applyExpressionEdit(createEmptyModel("vitals"), "s1", 'xpathNumber("$.systolic")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
  });
  const result = runTest(model, JSON.stringify({ systolic: 120 }), "json");
  assertEquals(result.ok || (result.output as Record<string, unknown>)?.slots !== undefined, true);
});

Deno.test("typescript codegen from BP skeleton uses ehrtslib constructors and lookups", async () => {
  const { model, skeleton, ts } = await mappedBpTypeScript();
  assertStringIncludes(ts, "new COMPOSITION({");
  assertStringIncludes(ts, 'from "ehrtslib/openehr_rm.ts"');
  assertStringIncludes(ts, "xpathNumber");
  assertStringIncludes(ts, "$.systolic");
  assertStringIncludes(ts, 'defaults["language"]');
  assertEquals(ts.includes("void evalExpr"), false);
  assertEquals(ts.includes("TODO: wire to RM path"), false);
  assertEquals(ts.includes("__evalGenerated"), false);
  assertEquals(ts.includes('"defaults" === "defaults"'), false);
  assertStringIncludes(ts, "convertSourceToComposition");
  assertStringIncludes(ts, "ISO_639-1::");
  assert(model.templateId.length > 0);
  assert(skeleton.length > 0);
});

Deno.test("Conversion Test Run JSON comes from the Target format handler, not generated TypeScript", async () => {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const { model, skeleton, systolic, ts } = await mappedBpTypeScript();
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const result = runTest(model, JSON.stringify({ systolic: 120 }), "json", { target });
  assertEquals(result.ok, true);
  const output = result.output as Record<string, unknown>;
  assertEquals(output._type, "COMPOSITION");
  assertEquals("slots" in output, false);
  const rendered = JSON.stringify(output);
  assertStringIncludes(rendered, "120");
  assertStringIncludes(ts, "new COMPOSITION({");
  assertEquals(typeof output.convertSourceToComposition, "undefined");
  assert(
    !rendered.includes("xpathNumber"),
    "Test Run JSON is a composition instance, not the generated script",
  );
  assert(systolic);
  assert(skeleton.length > 0);
});

Deno.test("TypeScript Output mode executes the generated conversion script", async () => {
  const { model, ts } = await mappedBpTypeScript();
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const result = runTest(model, JSON.stringify({ systolic: 118 }), "json", {
    target,
    outputMode: "typescript",
    generatedCode: ts,
    defaults: { language: "en" },
  });
  assertEquals(result.error, undefined, result.error);
  const output = result.output as Record<string, unknown>;
  assertEquals(output._type, "COMPOSITION");
  assertStringIncludes(JSON.stringify(output), "118");
  const rm = runGeneratedTypeScript(ts, { format: "json", data: { systolic: 118 } }, {
    language: "en",
  });
  assertEquals((rm as { constructor: { name: string } }).constructor.name, "COMPOSITION");
  assertEquals((serializedConversionOutput(rm) as { _type?: string })._type, "COMPOSITION");
});

Deno.test("Java Output mode does not execute Conversion Test Run", () => {
  const model = createEmptyModel("vitals");
  const result = runTest(model, "{}", "json", { outputMode: "java" });
  assertEquals(result.ok, false);
  assertStringIncludes(String(result.output), "Java");
  assertStringIncludes(String(result.output), "not implemented");
});

Deno.test("typescript codegen from Blockly canvas updates when a source query is added", async () => {
  initBlocklyGenerators();
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const { templateId, skeleton } = generateSkeleton(opt);
  const systolic = collectValueSlots(skeleton).find((slot) =>
    slot.slotId.endsWith("items/at0004/value/value/value")
  );
  assert(systolic, "expected systolic value slot");

  const workspace = new Blockly.Workspace();
  try {
    const empty = createEmptyModel(templateId);
    empty.targetFormat = "openehr-template";
    loadSkeletonIntoWorkspace(workspace, skeleton, empty);

    const before = generateTypeScriptFromWorkspace(workspace, empty);
    assert(before, "expected generated TypeScript from skeleton canvas");
    assertStringIncludes(before, "new COMPOSITION({");
    assertEquals(before.includes("$.systolic"), false);
    assertStringIncludes(before, "Blockly canvas");
    assertStringIncludes(before, "mm[Hg]");
    assertStringIncludes(before, "new DV_CODED_TEXT");
    assertStringIncludes(before, "at1001");

    const mapped = applyExpressionEdit(empty, systolic.slotId, 'xpathNumber("$.systolic")', {
      rmType: systolic.rmType,
      returnType: "number",
      label: systolic.label,
    });
    loadSkeletonIntoWorkspace(workspace, skeleton, mapped);
    const after = generateTypeScriptFromWorkspace(workspace, mapped);
    assert(after, "expected generated TypeScript after mapping");
    assertStringIncludes(after, "xpathNumber");
    assertStringIncludes(after, "$.systolic");
    assertStringIncludes(after, "DV_QUANTITY");
    assertEquals(after.includes("void evalExpr"), false);

    const saved = Blockly.serialization.workspaces.save(workspace);
    const fromState = generateTypeScriptFromBlocklyState(saved, mapped);
    assert(fromState, "expected TypeScript from serialized Blockly state");
    assertStringIncludes(fromState, "$.systolic");

    const viaGenerate = generate(mapped, "typescript", {
      blocklyState: saved,
      skeleton,
    });
    assertStringIncludes(viaGenerate, "$.systolic");
    assertStringIncludes(viaGenerate, "new COMPOSITION({");
  } finally {
    workspace.dispose();
  }
});

Deno.test("typescript codegen updates after Import Suggestions apply to Blockly", async () => {
  initBlocklyGenerators();
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const { templateId, skeleton } = generateSkeleton(opt);
  const systolic = collectValueSlots(skeleton).find((slot) =>
    slot.slotId.endsWith("items/at0004/value/value/value")
  );
  assert(systolic, "expected systolic value slot");

  const workspace = new Blockly.Workspace();
  try {
    const empty = createEmptyModel(templateId);
    empty.targetFormat = "openehr-template";
    loadSkeletonIntoWorkspace(workspace, skeleton, empty);
    const staleState = Blockly.serialization.workspaces.save(workspace);

    const { model, report } = importSuggestions(empty, {
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: templateId },
      suggestions: [{
        slotId: systolic.slotId,
        block: {
          type: "source_query_number",
          fields: { EXPRESSION: "$.systolic" },
        },
      }],
    }, new Set(collectAllSlotIds(skeleton)), new Map([
      [systolic.slotId, {
        rmType: systolic.rmType,
        returnType: "number",
        label: systolic.label,
        mandatory: systolic.mandatory,
      }],
    ]));
    assertEquals(report.applied, 1);
    assertEquals(model.slots[0]?.expression, 'xpathNumber("$.systolic")');

    const fromStaleCanvas = generate(model, "typescript", {
      blocklyState: staleState,
      skeleton,
    });
    assertEquals(
      fromStaleCanvas.includes("$.systolic"),
      false,
      "stale Blockly snapshot must not be treated as the applied mapping",
    );

    applyModelExpressions(workspace, model);
    const after = generateTypeScriptFromWorkspace(workspace, model);
    assert(after, "expected TypeScript after applying imported expressions to the canvas");
    assertStringIncludes(after, "xpathNumber");
    assertStringIncludes(after, "$.systolic");
    assertStringIncludes(after, "DV_QUANTITY");
    assertStringIncludes(after, "new COMPOSITION({");
    assertEquals(after.includes("void evalExpr"), false);
  } finally {
    workspace.dispose();
  }
});

Deno.test("generated TypeScript conversion script is executable with ehrtslib", async () => {
  const { ts } = await mappedBpTypeScript();
  const outDir = join(import.meta.dirname!, "..", "tmp");
  await Deno.mkdir(outDir, { recursive: true });
  const genPath = join(outDir, `generated_convert_${crypto.randomUUID()}.ts`);
  await Deno.writeTextFile(genPath, ts);
  try {
    const mod = await import(toFileUrl(genPath).href) as {
      convertSourceToComposition: (
        sourceCtx: { format: string; data: unknown },
        defaults?: Record<string, unknown>,
      ) => { language?: { code_string?: string }; content?: unknown };
    };
    const composition = mod.convertSourceToComposition(
      { format: "json", data: { systolic: 118, diastolic: 76 } },
      { language: "en", territory: "GB", time: "2026-08-25T10:00:00Z" },
    );
    assertEquals(composition?.constructor?.name, "COMPOSITION");
    const languageCode = composition.language?.code_string;
    assertEquals(languageCode, "en");
    const tree = JSON.stringify(composition);
    assertStringIncludes(tree, "118");
  } finally {
    await Deno.remove(genPath);
  }
});

async function mappedBpTypeScript() {
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
  const language = collectValueSlots(skeleton).find((slot) =>
    slot.rmType === "CODE_PHRASE" && slot.slotId.includes("//language/")
  );
  if (language) {
    model = applyExpressionEdit(model, language.slotId, 'maps_get("defaults", "language")', {
      rmType: language.rmType,
      returnType: "string",
    });
  }
  const ts = generate(model, "typescript", { skeleton });
  return { model, skeleton, systolic, ts, templateId };
}

async function mappedBpJava() {
  const { model, skeleton, systolic, templateId } = await mappedBpTypeScript();
  const java = generate(model, "java", { skeleton });
  return { model, skeleton, systolic, java, templateId };
}

Deno.test("stripGeneratedTypeScript removes default Handlebars import", () => {
  const { names, body } = stripGeneratedTypeScript(
    'import Handlebars from "handlebars";\nfunction convertSourceToComposition() { return Handlebars; }',
  );
  assertEquals(names.includes("Handlebars"), true);
  assertEquals(body.includes("import"), false);
});

Deno.test("stripGeneratedTypeScript drops optional params and object type annotations", () => {
  const { body } = stripGeneratedTypeScript(`
export function convertSourceToComposition(
  sheets: Record<string, unknown> = {},
) {
  function sheetLookup(name: string, returnCol?: string | number) {
    const rec: Record<string, unknown> = {};
    const holds = (p: { op: string; a: number; b?: number }, n: number) => n;
    return (cmp[1] as string) + String(rec) + holds({ op: "range", a: 1 }, 1);
  }
  const walk = (cur: unknown, rest: unknown[]): unknown => cur;
  return walk(sheets, []);
}
`);
  assertEquals(body.includes("?:"), false, body);
  assertEquals(body.includes(" as string"), false, body);
  assertEquals(body.includes("Record<"), false, body);
  assertEquals(/:\s*unknown/.test(body), false, body);
  const convert = new Function(`${body}\nreturn convertSourceToComposition;`)();
  assertEquals(typeof convert, "function");
});

Deno.test("stripGeneratedTypeScript keeps composer object-literal properties", () => {
  const { body } = stripGeneratedTypeScript(`
export function convertSourceToComposition() {
  return new COMPOSITION({
    composer: { name: xpathString("$.SignatureUser_FullName") },
    language: "sv",
  });
}
`);
  assertEquals(body.includes("composer: { name: xpathString"), true, body);
  assertEquals(body.includes("composer,"), false, body);
});

Deno.test("TypeScript Test Run xpath helpers coerce non-string paths", () => {
  const out = runGeneratedTypeScript(
    `
export function convertSourceToComposition() {
  function jsonQuery(path: unknown): string {
    const trimmed = String(path ?? "").trim();
    return trimmed;
  }
  function xpathString(path: unknown): string {
    const p = typeof path === "string" ? path : String(path ?? "");
    return p;
  }
  return xpathString(["Cel", "[degF]"]);
}
`,
    { format: "json", data: {} },
  );
  assertEquals(out, "Cel,[degF]");
});

Deno.test("typescript codegen folds change_case instead of treating it as a path", () => {
  const ctx = createTsEmitContext();
  const src = emitTsExpression(
    parseExpression('change_case(xpathString("$.typ"), "LOWERCASE")'),
    ctx,
  );
  assertEquals(src, 'String(xpathString("$.typ") ?? "").toLowerCase()');
});

Deno.test("typescript codegen emits lists_getIndex as array access, not xpathString", () => {
  const ctx = createTsEmitContext();
  const src = emitTsExpression(
    parseExpression('lists_getIndex(list("Cel", "[degF]"), "FROM_START", 1)'),
    ctx,
  );
  assertEquals(src.includes("xpathString"), false, src);
  assertStringIncludes(src, "listGetIndex");
  assertStringIncludes(src, '"Cel"');
  assertEquals(ctx.helpers.has("logic"), true);
});

Deno.test("emitCodePhraseLiteral uses object form for SNOMED URL terminology ids", () => {
  assertEquals(emitCodePhraseLiteral("openehr", "433"), '"openehr::433"');
  const snomed = "http://snomed.info/sct/900000000000207008";
  const emitted = emitCodePhraseLiteral(snomed, "43741000");
  assertEquals(
    emitted,
    `{ terminology_id: "http://snomed.info/sct/900000000000207008", code_string: "43741000" }`,
  );
  const phrase = new Function(
    "CODE_PHRASE",
    `return new CODE_PHRASE(${emitted});`,
  )(CODE_PHRASE) as { code_string?: string; terminology_id?: { value?: string } };
  assertEquals(phrase.code_string, "43741000");
  assertEquals(phrase.terminology_id?.value, snomed);
});

Deno.test("TypeScript Output mode executes handlebars text block canvas mapping", () => {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  try {
    const document = workspace.newBlock(TEXT_DOCUMENT_BLOCK_TYPE);
    const script = workspace.newBlock(TEXT_CODE_BLOCK_TYPE);
    script.setFieldValue("handlebars", "LANG");
    script.setFieldValue("My: {{a}} + {{b}}", "TEXT");
    const context = workspace.newBlock("maps_create_with") as Blockly.Block & {
      itemCount_: number;
      updateShape_: () => void;
    };
    context.itemCount_ = 2;
    context.updateShape_();
    context.setFieldValue("a", "KEY0");
    context.setFieldValue("b", "KEY1");
    const valA = workspace.newBlock("text");
    valA.setFieldValue("foo", "TEXT");
    const valB = workspace.newBlock("text");
    valB.setFieldValue("2foo", "TEXT");
    context.getInput("VAL0")?.connection?.connect(valA.outputConnection!);
    context.getInput("VAL1")?.connection?.connect(valB.outputConnection!);
    const render = workspace.newBlock(TEXT_HANDLEBARS_BLOCK_TYPE);
    render.getInput("SCRIPT")?.connection?.connect(script.outputConnection!);
    render.getInput("CONTEXT")?.connection?.connect(context.outputConnection!);
    document.getInput("VALUE")?.connection?.connect(render.outputConnection!);
    attachStartToInstanceRoot(workspace, document);

    const model = createEmptyModel("dummy-json-vitals");
    model.targetFormat = "free-form";
    const ts = generateTypeScriptFromWorkspace(workspace, model);
    assert(ts, "expected generated TypeScript from handlebars canvas");
    assertStringIncludes(ts!, 'import Handlebars from "handlebars"');
    assertStringIncludes(ts!, 'handlebars("My: {{a}} + {{b}}"');

    const out = runGeneratedTypeScript(ts!, { format: "json", data: {} }, {});
    assertEquals(out, "My: foo + 2foo");

    const state = Blockly.serialization.workspaces.save(workspace);
    const result = runTest(model, "{}", "json", {
      outputMode: "typescript",
      generatedCode: ts!,
      blocklyState: state,
      target: { format: "free-form", targetId: "dummy", filename: "t.hbs", content: "", skeleton: [] },
    });
    assertEquals(result.error, undefined, result.error);
    assertEquals(result.output, "My: foo + 2foo");
  } finally {
    workspace.dispose();
  }
});

Deno.test("seedHandlebarsProductOnCanvas injects text_handlebars product stack", () => {
  initBlocklyGenerators();
  const seeded = seedHandlebarsProductOnCanvas(null, "Hello {{name}}") as {
    blocks?: { blocks?: Array<{ type?: string; next?: { block?: { type?: string } } }> };
  };
  const tops = seeded.blocks?.blocks ?? [];
  const start = tops.find((block) => block.type === "conversion_start");
  assert(start, "expected conversion_start after seeding");
  assertEquals(start?.next?.block?.type, "text_document");
  const json = JSON.stringify(seeded);
  assertStringIncludes(json, "text_handlebars");
  assertStringIncludes(json, "Hello {{name}}");
  assertStringIncludes(json, "source_query_node");
});

Deno.test("TypeScript Test Run matches Mapping preview for canvas handlebars()", () => {
  initBlocklyGenerators();
  const model = createEmptyModel("greeting");
  model.targetFormat = "free-form";
  const canvas = handlebarsGreetingCanvas();
  const ts = generate(model, "typescript", { blocklyState: canvas });
  assertStringIncludes(ts, "handlebars(");
  assertStringIncludes(ts, HANDLEBARS_GREETING_TEMPLATE);
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
  const tsRun = runTest(model, HANDLEBARS_GREETING_SOURCE, "json", {
    outputMode: "typescript",
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
  assertEquals(tsRun.error, undefined, tsRun.error);
  assertEquals(preview.output, HANDLEBARS_GREETING_OUTPUT);
  assertEquals(tsRun.output, HANDLEBARS_GREETING_OUTPUT);
});

Deno.test("Handlebars Output mode Test Run matches canvas handlebars() preview", () => {
  initBlocklyGenerators();
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
  const handlebarsMode = runTest(model, HANDLEBARS_GREETING_SOURCE, "json", {
    outputMode: "handlebars",
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
  assertEquals(handlebarsMode.error, undefined, handlebarsMode.error);
  assertEquals(preview.output, HANDLEBARS_GREETING_OUTPUT);
  assertEquals(handlebarsMode.output, HANDLEBARS_GREETING_OUTPUT);
});
