import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import "blockly/blocks";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import {
  applyDecisionTableOutputType,
  registerDecisionTableBlocks,
} from "@intehrgrator/blockly/blocks/decision_table_blocks.ts";
import { blockConstraintMessages } from "@intehrgrator/blockly/block_constraints.ts";
import { setWorkspaceSheetsProvider } from "@intehrgrator/blockly/sheets_bridge.ts";
import { syncDecisionTableBlocksFromSheets } from "@intehrgrator/blockly/decision_table_sync.ts";
import { blockToExpression } from "@intehrgrator/blockly/expression_serialize.ts";
import { evaluate, createSourceContext } from "@intehrgrator/core/source/query_runtime.ts";
import { parseExpression, validateExpressionSource } from "@intehrgrator/core/expression/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import {
  addCatchAllRow,
  cloneSheet,
  emptyDecisionTable,
  moveColumns,
  moveRows,
  evaluateDecisionTable,
  isCatchAllRow,
  isDontCare,
  lintDecisionTable,
  lintDecisionTableSnippets,
  normalizeSheet,
  parseNumericPredicate,
  rowMatches,
  sheetsToBag,
} from "@intehrgrator/core/sheets/mod.ts";
import { checkVmsMustache } from "@intehrgrator/core/output/vms_hbs.ts";
import { generateTypeScript } from "@intehrgrator/core/codegen/mod.ts";
import { generateXQuery } from "@intehrgrator/core/codegen/xquery.ts";
import type { MappingModel } from "@intehrgrator/types/mod.ts";

/** Fixture: laterality × finding → value + VMS-Mustache snippet (don't-care on unused). */
const findings = normalizeSheet({
  name: "findings",
  kind: "decision-table",
  hitPolicy: "FIRST",
  collectJoin: "; ",
  headers: ["finding", "laterality", "term_id", "clause"],
  decisionColumns: [
    { role: "condition" },
    { role: "condition" },
    { role: "output", outputKind: "value" },
    { role: "output", outputKind: "snippet" },
  ],
  values: [
    ["effusion", "left", "T_LEFT", "{{laterality}} effusion"],
    ["effusion", "right", "T_RIGHT", "{{laterality}} effusion"],
    ["effusion", "—", "T_EFF", "effusion"],
    ["nodule", "—", "T_NOD", "{{finding}} present"],
  ],
});

Deno.test("moving a decision column keeps its output type and moving a row keeps catch-all", () => {
  const table = addCatchAllRow(emptyDecisionTable("Decision"));
  const moved = moveColumns(table, 2, 0);
  assertEquals(moved.headers, ["out", "in1", "in2"]);
  assertEquals(moved.decisionColumns?.[0]?.role, "output");
  assertEquals(moved.decisionColumns?.[1]?.role, "condition");
  assertEquals(moved.values[0], ["", "", ""]);
  const flagged = moveRows(table, table.values.length - 1, 0);
  assertEquals(flagged.rowCatchAll?.[0], true);
  assertEquals(flagged.rowCatchAll?.[table.values.length - 1], false);
  assertEquals(flagged.values[0]?.[0], "—");
});

const collectJoin = normalizeSheet({
  name: "positive_findings",
  kind: "decision-table",
  hitPolicy: "COLLECT",
  collectJoin: " and ",
  headers: ["flag", "snippet"],
  decisionColumns: [
    { role: "condition" },
    { role: "output", outputKind: "snippet" },
  ],
  values: [
    ["true", "{{name}}"],
    ["true", "also {{name}}"],
    ["false", "skip"],
  ],
});

function baseModel(expression: string, sheetNames?: string[]): MappingModel {
  return {
    modelVersion: 2,
    templateId: "t",
    slots: [{
      slotId: "note",
      rmType: "DV_TEXT",
      expression,
      returnType: "string",
    }],
    optionalRm: [],
    sheetNames,
  };
}

Deno.test("emptyDecisionTable defaults kind and FIRST hit policy", () => {
  const t = emptyDecisionTable("rules");
  assertEquals(t.kind, "decision-table");
  assertEquals(t.hitPolicy, "FIRST");
  assertEquals(t.decisionColumns?.every((c) => c.role === "condition" || c.role === "output"), true);
});

Deno.test("normalizeSheet preserves decision-table kind and column meta", () => {
  assertEquals(findings.kind, "decision-table");
  assertEquals(findings.hitPolicy, "FIRST");
  assertEquals(findings.decisionColumns?.[3]?.outputKind, "snippet");
});

Deno.test("isDontCare recognizes em dash, hyphen, star, empty", () => {
  assertEquals(isDontCare("—"), true);
  assertEquals(isDontCare("-"), true);
  assertEquals(isDontCare("*"), true);
  assertEquals(isDontCare(""), true);
  assertEquals(isDontCare(null), true);
  assertEquals(isDontCare("left"), false);
});

Deno.test("FIRST hit policy: don't-care row matches after specific rows", () => {
  const left = evaluateDecisionTable(findings, { finding: "effusion", laterality: "left" }, "term_id");
  assertEquals(left, "T_LEFT");
  const anyLat = evaluateDecisionTable(findings, { finding: "effusion", laterality: "bilateral" }, "term_id");
  assertEquals(anyLat, "T_EFF");
  const nodule = evaluateDecisionTable(findings, { finding: "nodule", laterality: "left" }, "term_id");
  assertEquals(nodule, "T_NOD");
});

Deno.test("snippet output interpolates local variable bindings (VMS-Mustache)", () => {
  const clause = evaluateDecisionTable(
    findings,
    { finding: "effusion", laterality: "left" },
    "clause",
  );
  assertEquals(clause, "left effusion");
  const nodule = evaluateDecisionTable(
    findings,
    { finding: "nodule", laterality: "x" },
    "clause",
  );
  assertEquals(nodule, "nodule present");
});

Deno.test("UNIQUE hit policy errors on overlapping matches", () => {
  const unique = normalizeSheet({
    ...findings,
    hitPolicy: "UNIQUE",
    values: [
      ["effusion", "—", "T1", "a"],
      ["effusion", "—", "T2", "b"],
    ],
  });
  assertThrows(
    () => evaluateDecisionTable(unique, { finding: "effusion", laterality: "left" }, "term_id"),
    Error,
    "UNIQUE",
  );
});

Deno.test("COLLECT joins matching snippet cells with collectJoin", () => {
  const out = evaluateDecisionTable(
    collectJoin,
    { flag: "true", name: "edema" },
    "snippet",
  );
  assertEquals(out, "edema and also edema");
});

Deno.test("lintDecisionTableSnippets uses checkVmsMustache", () => {
  const bad = normalizeSheet({
    ...findings,
    values: [["effusion", "left", "T", '{{#if (eq x "a")}}bad{{/if}}']],
  });
  const diags = lintDecisionTableSnippets(bad);
  assertEquals(diags.length > 0, true);
  assertEquals(checkVmsMustache('{{#if (eq x "a")}}bad{{/if}}').ok, false);
  assertEquals(lintDecisionTableSnippets(findings).length, 0);
});

Deno.test("decision_table is a Mapping Expression builtin", () => {
  const src =
    'decision_table("findings", map("finding", "effusion", "laterality", "left"), "term_id")';
  assertEquals(validateExpressionSource(src), null);
  const ast = parseExpression(src);
  assertEquals(ast.kind, "call");
  if (ast.kind === "call") assertEquals(ast.name, "decision_table");
});

Deno.test("decision_table expression evaluates via SourceContext.sheets bag", () => {
  const ctx = createSourceContext("{}", "json");
  ctx.sheets = sheetsToBag([findings]);
  assertEquals(
    evaluate(
      'decision_table("findings", map("finding", "effusion", "laterality", "left"), "clause")',
      ctx,
      "string",
    ),
    "left effusion",
  );
});

Deno.test("locals map decomposes complex sources for conditions + snippets", () => {
  const source = { imaging: { finding: "effusion", side: "right" } };
  const ctx = createSourceContext(JSON.stringify(source), "json");
  ctx.sheets = sheetsToBag([findings]);
  ctx.vars = {
    finding: "effusion",
    laterality: "right",
  };
  assertEquals(
    evaluate(
      'decision_table("findings", map("finding", var("finding"), "laterality", var("laterality")), "clause")',
      ctx,
      "string",
    ),
    "right effusion",
  );
});

Deno.test("Blockly decision_table block serializes to Mapping Expression", () => {
  registerMapBlocks();
  registerDecisionTableBlocks();
  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock("decision_table");
    block.setFieldValue("findings", "NAME");
    block.setFieldValue("clause", "OUTPUT");
    const map = workspace.newBlock("maps_create_with") as Blockly.Block & {
      itemCount_: number;
      updateShape_: () => void;
    };
    map.itemCount_ = 2;
    map.updateShape_();
    map.setFieldValue("finding", "KEY0");
    map.setFieldValue("laterality", "KEY1");
    const f0 = workspace.newBlock("text");
    f0.setFieldValue("effusion", "TEXT");
    map.getInput("VAL0")?.connection?.connect(f0.outputConnection!);
    const f1 = workspace.newBlock("text");
    f1.setFieldValue("left", "TEXT");
    map.getInput("VAL1")?.connection?.connect(f1.outputConnection!);
    block.getInput("INPUTS")?.connection?.connect(map.outputConnection!);
    assertEquals(
      blockToExpression(block),
      'decision_table("findings", map("finding", "effusion", "laterality", "left"), "clause")',
    );
    assertEquals(block.getInputsInline(), false);
    const check = block.getInput("INPUTS")?.connection?.getCheck();
    assertEquals(Array.isArray(check) ? check.includes("Map") : check === "Map", true);
  } finally {
    workspace.dispose();
  }
});

Deno.test("schema sync rewrites locals Map keys from Decision table headers", () => {
  registerMapBlocks();
  registerDecisionTableBlocks();
  const sheet = emptyDecisionTable("Decision1");
  sheet.headers[0] = "age";
  sheet.headers[1] = "weight";
  setWorkspaceSheetsProvider(() => [sheet]);
  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock("decision_table");
    block.setFieldValue("Decision1", "NAME");
    const map = workspace.newBlock("maps_create_with") as Blockly.Block & {
      itemCount_: number;
      updateShape_: () => void;
    };
    map.itemCount_ = 2;
    map.updateShape_();
    map.setFieldValue("in1", "KEY0");
    map.setFieldValue("in2", "KEY1");
    block.getInput("INPUTS")?.connection?.connect(map.outputConnection!);
    syncDecisionTableBlocksFromSheets(workspace, [sheet]);
    assertEquals(map.getFieldValue("KEY0"), "age");
    assertEquals(map.getFieldValue("KEY1"), "weight");
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});

Deno.test("TypeScript codegen emits decisionTable helper call", () => {
  const model = baseModel(
    'decision_table("findings", map("finding", "effusion", "laterality", "left"), "term_id")',
    ["findings"],
  );
  const code = generateTypeScript(model);
  assertEquals(code.includes("decisionTable("), true);
  assertEquals(code.includes("function decisionTable"), true);
  assertEquals(code.includes("rowCatchAll"), true);
  assertEquals(code.includes("collectDedupe"), true);
  assertEquals(code.includes("cellMatch"), true);
});

Deno.test("XQuery export emits decision_table helper bound to $sheets", () => {
  const model = baseModel(
    'decision_table("findings", map("finding", "effusion", "laterality", "left"), "term_id")',
  );
  const xq = generateXQuery(model);
  assertStringIncludes(xq, "declare variable $sheets");
  assertStringIncludes(xq, "local:decision-table");
  assertStringIncludes(xq, "map { \"finding\": \"effusion\", \"laterality\": \"left\" }");
});

Deno.test("Test Run evaluates decision_table against project sheets", () => {
  const model = baseModel(
    'decision_table("findings", map("finding", "effusion", "laterality", "left"), "clause")',
    ["findings"],
  );
  const result = runTest(model, "{}", "json", { sheets: [findings] });
  assertEquals(result.ok, true);
  const output = result.output as { slots?: Record<string, unknown> };
  assertEquals(output.slots?.note, "left effusion");
});

/** Vitals-style FIRST table: SBP bands with inclusive range + bounds + exact equality. */
const vitalsSbp = normalizeSheet({
  name: "sbp_band",
  kind: "decision-table",
  hitPolicy: "FIRST",
  headers: ["sbp", "band"],
  decisionColumns: [
    { role: "condition" },
    { role: "output", outputKind: "value" },
  ],
  values: [
    ["< 90", "low"],
    ["90..120", "normal"],
    [">= 140", "high"],
    ["130", "prehigh"],
  ],
});

Deno.test("parseNumericPredicate recognizes range, bounds, and leaves bare equality alone", () => {
  assertEquals(parseNumericPredicate("90..120"), { kind: "range", min: 90, max: 120 });
  assertEquals(parseNumericPredicate("90 .. 120"), { kind: "range", min: 90, max: 120 });
  assertEquals(parseNumericPredicate(">= 140"), { kind: "ge", value: 140 });
  assertEquals(parseNumericPredicate(">=140"), { kind: "ge", value: 140 });
  assertEquals(parseNumericPredicate("< 90"), { kind: "lt", value: 90 });
  assertEquals(parseNumericPredicate("> 140"), { kind: "gt", value: 140 });
  assertEquals(parseNumericPredicate("<= 90"), { kind: "le", value: 90 });
  assertEquals(parseNumericPredicate("-10..0"), { kind: "range", min: -10, max: 0 });
  assertEquals(parseNumericPredicate("140"), null);
  assertEquals(parseNumericPredicate("left"), null);
  assertEquals(parseNumericPredicate("—"), null);
  assertEquals(parseNumericPredicate("*"), null);
});

Deno.test("range predicates match inclusive bounds when the input is numeric", () => {
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 90 }, "band"), "normal");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 120 }, "band"), "normal");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 100 }, "band"), "normal");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 89 }, "band"), "low");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 140 }, "band"), "high");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 200 }, "band"), "high");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: 130 }, "band"), "prehigh");
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: "105" }, "band"), "normal");
});

Deno.test("range predicates do not match non-numeric inputs (string equality stays for enums)", () => {
  assertEquals(evaluateDecisionTable(vitalsSbp, { sbp: "unknown" }, "band"), null);
  assertEquals(evaluateDecisionTable(findings, { finding: "effusion", laterality: "left" }, "term_id"), "T_LEFT");
  const mixed = normalizeSheet({
    name: "mixed",
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["finding", "sbp", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["effusion", ">= 140", "hypertensive-effusion"],
      ["effusion", "—", "effusion"],
    ],
  });
  assertEquals(
    evaluateDecisionTable(mixed, { finding: "effusion", sbp: 150 }, "out"),
    "hypertensive-effusion",
  );
  assertEquals(evaluateDecisionTable(mixed, { finding: "effusion", sbp: 80 }, "out"), "effusion");
  assertEquals(rowMatches(mixed, 0, { finding: "effusion", sbp: 150 }), true);
  assertEquals(rowMatches(mixed, 0, { finding: "effusion", sbp: 80 }), false);
});

Deno.test("catch-all row fires only when no earlier specific row matches (FIRST)", () => {
  const table = normalizeSheet({
    name: "risk",
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["flag", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["high", "urgent"],
      ["low", "watch"],
      ["—", "default"],
    ],
    rowCatchAll: [false, false, true],
  });
  assertEquals(evaluateDecisionTable(table, { flag: "high" }, "out"), "urgent");
  assertEquals(evaluateDecisionTable(table, { flag: "low" }, "out"), "watch");
  assertEquals(evaluateDecisionTable(table, { flag: "other" }, "out"), "default");
  assertEquals(isCatchAllRow(table, 2), true);
  assertEquals(isCatchAllRow(table, 0), false);
});

Deno.test("per-column * remains don't-care and is not a catch-all row", () => {
  const table = normalizeSheet({
    name: "laterality",
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["finding", "side", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["effusion", "*", "any-side"],
      ["nodule", "left", "nodule-left"],
    ],
  });
  assertEquals(isDontCare("*"), true);
  assertEquals(isCatchAllRow(table, 0), false);
  assertEquals(
    evaluateDecisionTable(table, { finding: "effusion", side: "right" }, "out"),
    "any-side",
  );
});

Deno.test("UNIQUE does not throw when a specific row matches and a later catch-all exists", () => {
  const table = normalizeSheet({
    name: "unique_default",
    kind: "decision-table",
    hitPolicy: "UNIQUE",
    headers: ["flag", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["high", "urgent"],
      ["—", "default"],
    ],
    rowCatchAll: [false, true],
  });
  assertEquals(evaluateDecisionTable(table, { flag: "high" }, "out"), "urgent");
  assertEquals(evaluateDecisionTable(table, { flag: "x" }, "out"), "default");
});

Deno.test("COLLECT omits a catch-all when a specific row already matched", () => {
  const table = normalizeSheet({
    name: "collect_default",
    kind: "decision-table",
    hitPolicy: "COLLECT",
    collectJoin: ", ",
    headers: ["flag", "snippet"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "snippet" },
    ],
    values: [
      ["true", "hit"],
      ["true", "also"],
      ["—", "otherwise"],
    ],
    rowCatchAll: [false, false, true],
  });
  assertEquals(evaluateDecisionTable(table, { flag: "true" }, "snippet"), "hit, also");
  assertEquals(evaluateDecisionTable(table, { flag: "false" }, "snippet"), "otherwise");
});

Deno.test("addCatchAllRow appends a flagged otherwise row; clone/normalize persist it", () => {
  const added = addCatchAllRow(emptyDecisionTable("risk"));
  assertEquals(isCatchAllRow(added, added.values.length - 1), true);
  assertEquals(added.rowCatchAll?.filter(Boolean).length, 1);
  const cloned = cloneSheet(added);
  assertEquals(cloned.rowCatchAll, added.rowCatchAll);
  const roundTrip = normalizeSheet(JSON.parse(JSON.stringify(added)));
  assertEquals(roundTrip.rowCatchAll?.[roundTrip.values.length - 1], true);
});

Deno.test("UNIQUE overlap surfaces as a Constraint warning without removing the runtime throw", () => {
  const unique = normalizeSheet({
    name: "overlap",
    kind: "decision-table",
    hitPolicy: "UNIQUE",
    headers: ["finding", "laterality", "term_id"],
    decisionColumns: [
      { role: "condition" },
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["effusion", "—", "T1"],
      ["effusion", "—", "T2"],
    ],
  });
  assertThrows(
    () => evaluateDecisionTable(unique, { finding: "effusion", laterality: "left" }, "term_id"),
    Error,
    "UNIQUE",
  );
  const probed = lintDecisionTable(unique, { finding: "effusion", laterality: "left" });
  assertEquals(probed.some((d) => d.message.includes("UNIQUE") && d.severity === "warning"), true);
  const staticDiags = lintDecisionTable(unique);
  assertEquals(staticDiags.some((d) => d.message.includes("UNIQUE")), true);
  assertEquals(lintDecisionTable(findings).some((d) => d.message.includes("UNIQUE")), false);
});

Deno.test("multiple catch-all rows are a Constraint warning", () => {
  const table = normalizeSheet({
    name: "two_defaults",
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["flag", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["a", "A"],
      ["—", "d1"],
      ["—", "d2"],
    ],
    rowCatchAll: [false, true, true],
  });
  const diags = lintDecisionTable(table);
  assertEquals(diags.some((d) => /catch-all|otherwise/i.test(d.message)), true);
});

Deno.test("COLLECT skips empty snippet cells and optional collectDedupe drops duplicates", () => {
  const findingsCollect = normalizeSheet({
    name: "positive_findings",
    kind: "decision-table",
    hitPolicy: "COLLECT",
    collectJoin: "; ",
    headers: ["flag", "snippet"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "snippet" },
    ],
    values: [
      ["true", "{{name}}"],
      ["true", ""],
      ["true", "   "],
      ["true", "{{name}}"],
      ["true", "also {{name}}"],
      ["false", "skip"],
    ],
  });
  assertEquals(
    evaluateDecisionTable(findingsCollect, { flag: "true", name: "nodule" }, "snippet"),
    "nodule; nodule; also nodule",
  );
  const deduped = normalizeSheet({ ...findingsCollect, collectDedupe: true });
  assertEquals(
    evaluateDecisionTable(deduped, { flag: "true", name: "nodule" }, "snippet"),
    "nodule; also nodule",
  );
});

Deno.test("decision table output dropdown label shows the selected column", () => {
  registerDecisionTableBlocks();
  const sheet = emptyDecisionTable("Decision1");
  sheet.headers[sheet.headers.length - 1] = "code";
  setWorkspaceSheetsProvider(() => [sheet]);
  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock("decision_table");
    block.setFieldValue("Decision1", "NAME");
    block.setFieldValue("code", "OUTPUT");
    const field = block.getField("OUTPUT") as {
      getText: () => string;
      selectedOption?: [string, string];
    } | null;
    assertEquals(field?.getText(), "code");
    // Blockly can leave the closed label on the first menu entry.
    if (field) field.selectedOption = ["out", "out"];
    assertEquals(field?.getText(), "code");
    const previousConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    try {
      block.setFieldValue("*", "OUTPUT");
      assertEquals(field?.getText(), "all outputs");
      block.setFieldValue("out", "OUTPUT");
    } finally {
      globalThis.confirm = previousConfirm;
    }
    // A header that no longer matches OUTPUT is left alone. Snapping to the
    // first output would change which column the block reads.
    syncDecisionTableBlocksFromSheets(workspace, [sheet]);
    assertEquals(block.getFieldValue("OUTPUT"), "out");
    assertEquals(field?.getText(), "out");
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});

Deno.test("UNIQUE overlap is a Constraint warning on the Decision table eval block", () => {
  registerDecisionTableBlocks();
  const unique = normalizeSheet({
    name: "overlap",
    kind: "decision-table",
    hitPolicy: "UNIQUE",
    headers: ["finding", "out"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "value" },
    ],
    values: [
      ["effusion", "T1"],
      ["effusion", "T2"],
    ],
  });
  setWorkspaceSheetsProvider(() => [unique]);
  const workspace = new Blockly.Workspace();
  try {
    const evalBlock = workspace.newBlock("decision_table");
    evalBlock.setFieldValue("overlap", "NAME");
    const messages = blockConstraintMessages(evalBlock);
    assertEquals(messages.some((m) => m.includes("UNIQUE")), true);
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});

Deno.test("numeric decision_table output stays in a Number socket after reload", () => {
  registerDecisionTableBlocks();
  if (!Blockly.Blocks["num_holder"]) {
    Blockly.Blocks["num_holder"] = {
      init: function (this: Blockly.Block) {
        this.appendValueInput("N").setCheck("Number");
      },
    };
  }
  const sheet = normalizeSheet({
    name: "imaging_term",
    kind: "decision-table",
    headers: ["modality", "term_id"],
    decisionColumns: [
      { role: "condition" },
      { role: "output", outputKind: "value", valueType: "number" },
    ],
    values: [["MR", 12683]],
  });
  setWorkspaceSheetsProvider(() => [sheet]);
  const workspace = new Blockly.Workspace();
  try {
    const holder = workspace.newBlock("num_holder");
    const table = workspace.newBlock("decision_table");
    table.setFieldValue("imaging_term", "NAME");
    table.setFieldValue("term_id", "OUTPUT");
    applyDecisionTableOutputType(table);
    holder.getInput("N")!.connection!.connect(table.outputConnection!);
    const saved = Blockly.serialization.workspaces.save(workspace);
    const encoded = JSON.stringify(saved);
    assertStringIncludes(encoded, '"outputCheck":"Number"');
    const loaded = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(saved, loaded);
    const again = loaded.getAllBlocks(false).find((block) => block.type === "decision_table");
    assertEquals(again?.getParent()?.type, "num_holder");
    loaded.dispose();
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});
