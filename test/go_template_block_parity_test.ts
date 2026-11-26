/**
 * Per-block Go text/template lowering: each Blockly value construct, put on
 * the canvas through the Agent API, gives the same value in the executed Go
 * script as in the TypeScript script — or Go generation fails loudly with a
 * readable error. Covers both Go emitters: the model-driven JSON Schema product
 * (`go_template_skeleton.ts`) and the canvas Text document (`go_template.ts`).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import type { TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
// { patientId: "demo-001", systolic: 120, diastolic: 80, unit: "mm[Hg]" }
const instance = Deno.readTextFileSync(join(root, "test", "fixtures", "dummy-json-vitals", "instance-1.json"));

type B = Record<string, unknown>;
const blk = (type: string, fields: B = {}, inputs: Record<string, B> = {}, extraState?: unknown): B => ({
  type,
  fields,
  ...(extraState !== undefined ? { extraState } : {}),
  inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }])),
});
const q = (path: string, type = "source_query"): B => ({ type, fields: { EXPRESSION: path } });
const txt = (s: string): B => ({ type: "text", fields: { TEXT: s } });
const num = (n: number): B => ({ type: "math_number", fields: { NUM: n } });
const sys = () => q("$.systolic", "source_query_number");
const dia = () => q("$.diastolic", "source_query_number");
const cmp = (op: string, a: B, b: B) => blk("logic_compare", { OP: op }, { A: a, B: b });
const arith = (op: string, a: B, b: B) => blk("math_arithmetic", { OP: op }, { A: a, B: b });
const list3 = () => blk("lists_create_with", {}, { ADD0: txt("b"), ADD1: txt("a"), ADD2: txt("c") }, { itemCount: 3 });
const kMap = () => blk("maps_create_with", { KEY0: "k" }, { VAL0: q("$.unit") }, { itemCount: 1 });
const item = () => blk("logic_current_item", { VAR: "" });
/** text_join with one input: an unchecked slot, so any value type connects. */
const wrap = (b: B): B => blk("text_join", {}, { ADD0: b }, { itemCount: 1 });

const SAME_AS_TYPESCRIPT: Record<string, B> = {
  "text_changeCase UPPERCASE": blk("text_changeCase", { CASE: "UPPERCASE" }, { TEXT: q("$.patientId") }),
  "text_changeCase TITLECASE": blk("text_changeCase", { CASE: "TITLECASE" }, { TEXT: txt("hello big world") }),
  "math_arithmetic ADD": arith("ADD", sys(), dia()),
  "math_arithmetic MINUS": arith("MINUS", sys(), dia()),
  "math_arithmetic MULTIPLY": arith("MULTIPLY", sys(), num(2)),
  "math_arithmetic DIVIDE": arith("DIVIDE", sys(), num(8)),
  "math_round": blk("math_round", { OP: "ROUND" }, { NUM: arith("DIVIDE", sys(), num(7)) }),
  "math_modulo": blk("math_modulo", {}, { DIVIDEND: sys(), DIVISOR: num(7) }),
  "math_constrain": blk("math_constrain", {}, { VALUE: sys(), LOW: num(0), HIGH: num(100) }),
  "logic_compare GT number": cmp("GT", sys(), num(100)),
  "logic_compare EQ number": cmp("EQ", sys(), num(120)),
  "logic_compare NEQ text": cmp("NEQ", q("$.unit"), txt("kPa")),
  "logic_operation AND": blk("logic_operation", { OP: "AND" }, { A: cmp("GT", sys(), num(100)), B: cmp("LT", dia(), num(90)) }),
  "logic_operation OR (both false)": blk("logic_operation", { OP: "OR" }, { A: cmp("LT", sys(), num(100)), B: cmp("GT", dia(), num(200)) }),
  "logic_negate (false operand)": blk("logic_negate", {}, { BOOL: cmp("LT", sys(), num(100)) }),
  "logic_ternary": blk("logic_ternary", {}, { IF: cmp("GT", sys(), num(100)), THEN: txt("high"), ELSE: txt("normal") }),
  "logic_ternary (false condition)": blk("logic_ternary", {}, { IF: cmp("LT", sys(), num(100)), THEN: txt("low"), ELSE: txt("ok") }),
  "logic_ternary inside text_join keeps spaces": blk("text_join", {}, {
    ADD0: txt("BP "),
    ADD1: blk("logic_ternary", {}, { IF: cmp("GT", sys(), num(100)), THEN: txt("high"), ELSE: txt("normal") }),
    ADD2: txt(" end"),
  }, { itemCount: 3 }),
  "lists_length": blk("lists_length", {}, { VALUE: list3() }),
  "lists_getIndex FIRST": blk("lists_getIndex", { MODE: "GET", WHERE: "FIRST" }, { VALUE: list3() }),
  "lists_getIndex FROM_START": blk("lists_getIndex", { MODE: "GET", WHERE: "FROM_START" }, { VALUE: list3(), AT: num(2) }),
  "lists_getIndex FROM_END": blk("lists_getIndex", { MODE: "GET", WHERE: "FROM_END" }, { VALUE: list3(), AT: num(1) }),
  "lists_getIndex LAST": blk("lists_getIndex", { MODE: "GET", WHERE: "LAST" }, { VALUE: list3() }),
  "logic_list_restriction ANY (literal list)": blk("logic_list_restriction", { OP: "ANY" }, { LIST: list3(), PRED: cmp("EQ", item(), txt("a")) }),
  "logic_list_restriction AT_LEAST 2 (literal list)": blk("logic_list_restriction", { OP: "AT_LEAST", N: 2 }, { LIST: list3(), PRED: cmp("EQ", item(), txt("a")) }, { count: true }),
  "logic_list_restriction EXACTLY 1 (literal list)": blk("logic_list_restriction", { OP: "EXACTLY", N: 1 }, { LIST: list3(), PRED: cmp("EQ", item(), txt("a")) }, { count: true }),
  "maps_get (Map value)": blk("maps_get", {}, { MAP: kMap(), KEY: txt("k") }),
  "sheet_lookup": blk("sheet_lookup", { NAME: "Units" }, { MATCH_COL: txt("code"), MATCH_VAL: q("$.unit"), RETURN_COL: txt("label") }),
};

const LOUD_IN_GO: Record<string, [B, string]> = {
  "lists_set_operation": [
    blk("lists_set_operation", { OP: "BOTH" }, { A: list3(), B: blk("lists_create_with", {}, { ADD0: txt("a") }, { itemCount: 1 }) }),
    "Go templates do not support intersection",
  ],
  "maps_entries": [blk("maps_entries", {}, { MAP: kMap() }), "Go templates do not support Map-value entries"],
};

const SHEETS = [
  { name: "Units", kind: "sheet", headers: ["code", "label"], values: [["mm[Hg]", "millimetre of mercury"], ["kPa", "kilopascal"]] },
];

type Path = "json-schema" | "text-document";

async function canvasWith(path: Path, value: B): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", { agentId: "go-blocks", displayName: "go-blocks" });
  let state: { blocks: { blocks: B[] } };
  if (path === "json-schema") {
    await callAgentTool(service, "load_example_set", { catalogPath, setId: "dummy-json-vitals-mapped", includeMapping: true });
    const { bundle } = await callAgentTool(service, "get_bundle", {}) as {
      bundle: { mapping?: { blocklyState?: unknown } };
    };
    state = structuredClone(bundle.mapping!.blocklyState) as typeof state;
    const start = state.blocks.blocks.find((b) => b.type === "conversion_start") as { next: { block: B } };
    (start.next.block.inputs as Record<string, unknown>).TARGET_unit = { block: wrap(value) };
  } else {
    await callAgentTool(service, "add_example", { filename: "instance-1.json", content: instance });
    state = {
      blocks: {
        blocks: [{
          type: "conversion_start",
          x: 20,
          y: 20,
          next: { block: blk("text_document", {}, { VALUE: wrap(value) }) },
        }],
      },
    };
  }
  await callAgentTool(service, "replace_sheets", { sheets: SHEETS });
  await callAgentTool(service, "put_blockly", { blocklyState: state });
  return service;
}

async function valueOf(service: WorkbenchService, path: Path, outputMode: string): Promise<{ result: TestResult; value: unknown }> {
  const { testResult } = await callAgentTool(service, "run_test", { outputMode }) as { testResult: TestResult };
  const out = testResult.output;
  if (!testResult.ok) return { result: testResult, value: undefined };
  if (path === "text-document") return { result: testResult, value: typeof out === "string" ? out.trim() : JSON.stringify(out) };
  const parsed = typeof out === "string" ? JSON.parse(out) : out;
  return { result: testResult, value: (parsed as Record<string, unknown>)?.unit };
}

for (const path of ["json-schema", "text-document"] as const) {
  for (const [name, block] of Object.entries(SAME_AS_TYPESCRIPT)) {
    Deno.test(`Go block parity (${path}): ${name}`, async () => {
      await ensureGoTemplateWasm();
      const service = await canvasWith(path, block);
      const ts = await valueOf(service, path, "typescript");
      assert(ts.result.ok, `TypeScript: ${ts.result.error}`);
      const go = await valueOf(service, path, "go-template");
      assert(go.result.ok, `Go: ${go.result.error}`);
      assertEquals(go.value, ts.value);
      if (path === "json-schema") {
        // put_blockly refreshes the model, so the preview runs the new canvas too.
        const preview = await valueOf(service, path, "preview");
        assertEquals(String(preview.value), String(ts.value));
      }
    });
  }
  for (const [name, [block, message]] of Object.entries(LOUD_IN_GO)) {
    Deno.test(`Go block parity (${path}): ${name} fails loudly`, async () => {
      await ensureGoTemplateWasm();
      const service = await canvasWith(path, block);
      const go = await valueOf(service, path, "go-template");
      assertEquals(go.result.ok, false);
      assertStringIncludes(String(go.result.error), message);
      const ts = await valueOf(service, path, "typescript");
      assert(ts.result.ok, "a Go-only limit must not break the TypeScript script");
    });
  }
}
