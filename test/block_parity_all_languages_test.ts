/**
 * Per-block parity in every language (issues #393, #394): each Blockly value
 * block, put on a JSON Schema field through the Agent API, gives the same
 * value in Mapping preview, TypeScript, Handlebars, XQuery, Go Template and
 * Java — or generation in a language fails loudly with a readable error.
 *
 * TypeScript is the reference; preview is compared as text (it coerces to the
 * field's type). Java runs every script in one JVM (`runGeneratedJavaBatch`).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import type { TestResult } from "@intehrgrator/types/mod.ts";
import { requireJavaOrSkip, runGeneratedJavaBatch } from "./support/java_jvm.ts";

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
const pid = () => q("$.patientId");
const sys = () => q("$.systolic", "source_query_number");
const dia = () => q("$.diastolic", "source_query_number");
const cmp = (op: string, a: B, b: B) => blk("logic_compare", { OP: op }, { A: a, B: b });
const arith = (op: string, a: B, b: B) => blk("math_arithmetic", { OP: op }, { A: a, B: b });
const list = (...items: B[]) =>
  blk("lists_create_with", {}, Object.fromEntries(items.map((b, i) => [`ADD${i}`, b])), { itemCount: items.length });
const list3 = () => list(txt("b"), txt("a"), txt("c"));
const nums = () => list(num(3), num(1), num(2), num(2));
const kMap = () => blk("maps_create_with", { KEY0: "k" }, { VAL0: q("$.unit") }, { itemCount: 1 });
const item = () => blk("logic_current_item", { VAR: "" });
/** text_join with one input: an unchecked slot, so any value type connects. */
const wrap = (b: B): B => blk("text_join", {}, { ADD0: b }, { itemCount: 1 });
/** A list as text "x|y|z" (lists_split JOIN), so every language prints it alike. */
const joined = (b: B): B => blk("lists_split", { MODE: "JOIN" }, { INPUT: b, DELIM: txt("|") });
const charAt = (where: string, at?: number) =>
  blk("text_charAt", { WHERE: where }, { VALUE: pid(), ...(at !== undefined ? { AT: num(at) } : {}) });
const sub = (w1: string, a1: number | null, w2: string, a2: number | null) =>
  blk("text_getSubstring", { WHERE1: w1, WHERE2: w2 }, {
    STRING: pid(),
    ...(a1 !== null ? { AT1: num(a1) } : {}),
    ...(a2 !== null ? { AT2: num(a2) } : {}),
  });
const single = (op: string, x: B) => blk("math_single", { OP: op }, { NUM: x });
const prop = (p: string, x: B, d?: B) =>
  blk("math_number_property", { PROPERTY: p }, { NUMBER_TO_CHECK: x, ...(d ? { DIVISOR: d } : {}) });
/** Blockly keeps math_on_list's mode as an XML mutation (MODE outputs a list). */
const onList = (op: string, l: B) => blk("math_on_list", { OP: op }, { LIST: l }, `<mutation op="${op}"></mutation>`);
const sort = (type: string, dir: string, l: B) => blk("lists_sort", { TYPE: type, DIRECTION: dir }, { LIST: l });

/** Issue #393: text, math and list blocks. */
const BLOCKS_393: Record<string, B> = {
  "text_length": blk("text_length", {}, { VALUE: pid() }),
  "text_length (code points)": blk("text_length", {}, { VALUE: txt("a😀b") }),
  "text_charAt (code points)": blk("text_charAt", { WHERE: "FROM_END" }, { VALUE: txt("a😀b"), AT: num(2) }),
  "text_isEmpty (filled)": blk("text_isEmpty", {}, { VALUE: pid() }),
  "text_isEmpty (empty)": blk("text_isEmpty", {}, { VALUE: txt("") }),
  "text_indexOf FIRST": blk("text_indexOf", { END: "FIRST" }, { VALUE: pid(), FIND: txt("-") }),
  "text_indexOf LAST": blk("text_indexOf", { END: "LAST" }, { VALUE: pid(), FIND: txt("0") }),
  "text_indexOf absent": blk("text_indexOf", { END: "FIRST" }, { VALUE: pid(), FIND: txt("x") }),
  "text_charAt FROM_START": charAt("FROM_START", 2),
  "text_charAt FROM_END": charAt("FROM_END", 1),
  "text_charAt FIRST": charAt("FIRST"),
  "text_charAt LAST": charAt("LAST"),
  "text_charAt out of range": charAt("FROM_START", 20),
  "text_getSubstring FROM_START..FROM_START": sub("FROM_START", 1, "FROM_START", 4),
  "text_getSubstring FROM_END..LAST": sub("FROM_END", 3, "LAST", null),
  "text_getSubstring FIRST..FROM_END": sub("FIRST", null, "FROM_END", 4),
  "math_single ROOT": single("ROOT", num(16)),
  "math_single ROOT of negative (empty)": single("ROOT", num(-1)),
  "math_single ABS": single("ABS", num(-3)),
  "math_single NEG": single("NEG", sys()),
  "math_single LN": single("LN", num(1)),
  "math_single LOG10": single("LOG10", num(1000)),
  "math_single EXP": single("EXP", num(0)),
  "math_single POW10": single("POW10", num(2)),
  "math_number_property EVEN": prop("EVEN", sys()),
  "math_number_property ODD": prop("ODD", num(7)),
  "math_number_property PRIME": prop("PRIME", num(7)),
  "math_number_property PRIME (9)": prop("PRIME", num(9)),
  "math_number_property WHOLE": prop("WHOLE", num(2.5)),
  "math_number_property POSITIVE": prop("POSITIVE", dia()),
  "math_number_property NEGATIVE": prop("NEGATIVE", num(-1)),
  "math_number_property DIVISIBLE_BY": prop("DIVISIBLE_BY", sys(), num(8)),
  "math_number_property DIVISIBLE_BY (no)": prop("DIVISIBLE_BY", sys(), num(7)),
  "math_number_property DIVISIBLE_BY 0": prop("DIVISIBLE_BY", sys(), num(0)),
  "math_on_list SUM": onList("SUM", nums()),
  "math_on_list MIN": onList("MIN", nums()),
  "math_on_list MAX": onList("MAX", nums()),
  "math_on_list AVERAGE": onList("AVERAGE", nums()),
  "math_on_list MEDIAN": onList("MEDIAN", nums()),
  "math_on_list MODE": joined(onList("MODE", nums())),
  "math_on_list STD_DEV": onList("STD_DEV", nums()),
  "math_on_list SUM of source numbers": onList("SUM", list(sys(), dia())),
  "lists_isEmpty (filled)": blk("lists_isEmpty", {}, { VALUE: list3() }),
  "lists_isEmpty (empty)": blk("lists_isEmpty", {}, { VALUE: list() }),
  "lists_indexOf FIRST": blk("lists_indexOf", { END: "FIRST" }, { VALUE: list3(), FIND: txt("a") }),
  "lists_indexOf LAST": blk("lists_indexOf", { END: "LAST" }, { VALUE: nums(), FIND: num(2) }),
  "lists_indexOf absent": blk("lists_indexOf", { END: "FIRST" }, { VALUE: list3(), FIND: txt("z") }),
  "lists_getSublist": joined(
    blk("lists_getSublist", { WHERE1: "FROM_START", WHERE2: "LAST" }, { LIST: list3(), AT1: num(2) }),
  ),
  "lists_getSublist FROM_END": joined(
    blk("lists_getSublist", { WHERE1: "FIRST", WHERE2: "FROM_END" }, { LIST: list3(), AT2: num(2) }),
  ),
  "lists_reverse": joined(blk("lists_reverse", {}, { LIST: list3() })),
  "lists_sort TEXT": joined(sort("TEXT", "1", list3())),
  "lists_sort NUMERIC descending": joined(sort("NUMERIC", "-1", nums())),
  "lists_sort IGNORE_CASE": joined(sort("IGNORE_CASE", "1", list(txt("b"), txt("A"), txt("c")))),
  "lists_split SPLIT": joined(blk("lists_split", { MODE: "SPLIT" }, { INPUT: pid(), DELIM: txt("-") })),
  "lists_split JOIN": blk("lists_split", { MODE: "JOIN" }, { INPUT: list3(), DELIM: txt(", ") }),
  "math_arithmetic POWER": arith("POWER", num(2), num(3)),
  "math_arithmetic POWER (source)": arith("POWER", dia(), num(2)),
  "math_round ROUNDUP": blk("math_round", { OP: "ROUNDUP" }, { NUM: num(2.1) }),
  "math_round ROUNDDOWN": blk("math_round", { OP: "ROUNDDOWN" }, { NUM: num(-2.5) }),
  "math_round ROUND": blk("math_round", { OP: "ROUND" }, { NUM: num(2.5) }),
};

/** Issue #394: constructs the Handlebars generator dropped or got wrong. */
const BLOCKS_394: Record<string, B> = {
  "text_changeCase UPPERCASE": blk("text_changeCase", { CASE: "UPPERCASE" }, { TEXT: pid() }),
  "text_changeCase TITLECASE": blk("text_changeCase", { CASE: "TITLECASE" }, { TEXT: txt("hello big world") }),
  "math_arithmetic ADD": arith("ADD", sys(), dia()),
  "math_arithmetic DIVIDE": arith("DIVIDE", sys(), num(8)),
  "math_round": blk("math_round", { OP: "ROUND" }, { NUM: arith("DIVIDE", sys(), num(7)) }),
  "math_modulo": blk("math_modulo", {}, { DIVIDEND: sys(), DIVISOR: num(7) }),
  "math_constrain": blk("math_constrain", {}, { VALUE: sys(), LOW: num(0), HIGH: num(100) }),
  "logic_compare EQ number": cmp("EQ", sys(), num(120)),
  "logic_compare NEQ text": cmp("NEQ", q("$.unit"), txt("kPa")),
  "logic_compare GT": cmp("GT", sys(), num(100)),
  "logic_operation AND": blk("logic_operation", { OP: "AND" }, { A: cmp("GT", sys(), num(100)), B: cmp("LT", dia(), num(90)) }),
  "logic_operation OR (both false)": blk("logic_operation", { OP: "OR" }, { A: cmp("LT", sys(), num(100)), B: cmp("GT", dia(), num(200)) }),
  "logic_negate (false operand)": blk("logic_negate", {}, { BOOL: cmp("LT", sys(), num(100)) }),
  "logic_ternary (false condition)": blk("logic_ternary", {}, { IF: cmp("LT", sys(), num(100)), THEN: txt("low"), ELSE: txt("ok") }),
  "logic_ternary (empty THEN)": blk("logic_ternary", {}, { IF: cmp("GT", sys(), num(100)), THEN: txt(""), ELSE: txt("else") }),
  "lists_length": blk("lists_length", {}, { VALUE: list3() }),
  "lists_getIndex FROM_END": blk("lists_getIndex", { MODE: "GET", WHERE: "FROM_END" }, { VALUE: list3(), AT: num(1) }),
  "logic_list_restriction ANY (literal list)": blk("logic_list_restriction", { OP: "ANY" }, { LIST: list3(), PRED: cmp("EQ", item(), txt("a")) }),
  "logic_list_restriction NONE (literal list)": blk("logic_list_restriction", { OP: "NONE" }, { LIST: list3(), PRED: cmp("EQ", item(), txt("z")) }),
  "logic_list_restriction EXACTLY 1 (literal list)": blk("logic_list_restriction", { OP: "EXACTLY", N: 1 }, { LIST: list3(), PRED: cmp("EQ", item(), txt("a")) }, { count: true }),
  "maps_get (Map value)": blk("maps_get", {}, { MAP: kMap(), KEY: txt("k") }),
  "sheet_lookup": blk("sheet_lookup", { NAME: "Units" }, { MATCH_COL: txt("code"), MATCH_VAL: q("$.unit"), RETURN_COL: txt("label") }),
};

const CASES: Record<string, B> = { ...BLOCKS_393, ...BLOCKS_394 };

/** Constructs a language cannot express: generation fails with this message. */
const LOUD: Record<string, { block: B; languages: Record<string, string> }> = {
  "lists_set_operation": {
    block: blk("lists_set_operation", { OP: "BOTH" }, { A: list3(), B: list(txt("a")) }),
    languages: {
      handlebars: "Handlebars scripts do not support list set operations",
      "go-template": "Go templates do not support intersection",
    },
  },
  "maps_entries": {
    block: blk("maps_entries", {}, { MAP: kMap() }),
    languages: {
      handlebars: "Handlebars scripts do not support Map-value entries",
      "go-template": "Go templates do not support Map-value entries",
    },
  },
};

const SHEETS = [
  { name: "Units", kind: "sheet", headers: ["code", "label"], values: [["mm[Hg]", "millimetre of mercury"], ["kPa", "kilopascal"]] },
];

const MODES = ["typescript", "preview", "handlebars", "xquery", "go-template"] as const;

async function serviceWith(value: B): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", { agentId: "blocks", displayName: "blocks" });
  await callAgentTool(service, "load_example_set", { catalogPath, setId: "dummy-json-vitals-mapped", includeMapping: true });
  const { bundle } = await callAgentTool(service, "get_bundle", {}) as {
    bundle: { mapping?: { blocklyState?: unknown } };
  };
  const state = structuredClone(bundle.mapping!.blocklyState) as { blocks: { blocks: B[] } };
  const start = state.blocks.blocks.find((b) => b.type === "conversion_start") as { next: { block: B } };
  (start.next.block.inputs as Record<string, unknown>).TARGET_unit = { block: wrap(value) };
  await callAgentTool(service, "replace_sheets", { sheets: SHEETS });
  await callAgentTool(service, "put_blockly", { blocklyState: state });
  return service;
}

async function unitIn(service: WorkbenchService, outputMode: string): Promise<{ result: TestResult; value: unknown }> {
  const { testResult } = await callAgentTool(service, "run_test", { outputMode }) as { testResult: TestResult };
  if (!testResult.ok) return { result: testResult, value: undefined };
  const out = testResult.output;
  const parsed = typeof out === "string" ? JSON.parse(out) : out;
  return { result: testResult, value: (parsed as Record<string, unknown>)?.unit ?? null };
}

/** Java's `Map.toString` form of a JSON value (Double whole numbers end in ".0"). */
function javaText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? `${value}.0` : String(value);
  if (Array.isArray(value)) return `[${value.map(javaText).join(", ")}]`;
  return String(value);
}

const javaScripts: Array<{ id: string; code: string }> = [];
const tsValues = new Map<string, unknown>();

Deno.test("block parity: load the Go and XQuery runtimes", async () => {
  await ensureGoTemplateWasm();
  await ensureXQueryRuntime();
});

for (const [name, block] of Object.entries(CASES)) {
  Deno.test(`block parity (all languages): ${name}`, async () => {
    const service = await serviceWith(block);
    const values: Record<string, unknown> = {};
    for (const mode of MODES) {
      const { result, value } = await unitIn(service, mode);
      assert(result.ok, `${mode}: ${result.error}`);
      values[mode] = value;
    }
    const ts = values.typescript;
    tsValues.set(name, ts);
    assertEquals(String(values.preview ?? ""), ts === null ? "" : String(ts), "preview");
    for (const mode of ["handlebars", "xquery", "go-template"] as const) {
      assertEquals(values[mode], ts, mode);
    }
    const java = await callAgentTool(service, "generate_script", { language: "java" }) as { code: string };
    javaScripts.push({ id: name, code: java.code });
  });
}

for (const [name, { block, languages }] of Object.entries(LOUD)) {
  Deno.test(`block parity (all languages): ${name} fails loudly where unsupported`, async () => {
    const service = await serviceWith(block);
    const ts = await unitIn(service, "typescript");
    assert(ts.result.ok, `a language limit must not break TypeScript: ${ts.result.error}`);
    for (const [mode, message] of Object.entries(languages)) {
      const { result } = await unitIn(service, mode);
      assertEquals(result.ok, false, `${mode} must fail`);
      assertStringIncludes(String(result.error), message);
    }
  });
}

Deno.test("block parity (all languages): text_handlebars on one field stays a field value (#394)", async () => {
  const hbs = blk("text_handlebars", {}, {
    SCRIPT: blk("text_code", { LANG: "handlebars", TEXT: "{{toUpperCase patientId}}" }),
    CONTEXT: q("$", "source_query_node"),
  });
  const service = await serviceWith(hbs);
  const ts = await unitIn(service, "typescript");
  assert(ts.result.ok, `TypeScript: ${ts.result.error}`);
  assertEquals(ts.value, "DEMO-001");
  // The other fields are still mapped: the block no longer takes over the document.
  const raw = ts.result.output;
  const out = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  assertEquals([out.systolic, out.diastolic], [120, 80]);
  for (const mode of ["preview", "xquery", "go-template"]) {
    const { result, value } = await unitIn(service, mode);
    assert(result.ok, `${mode}: ${result.error}`);
    assertEquals(value, "DEMO-001", mode);
  }
  for (const mode of ["handlebars"] as const) {
    const { result, value } = await unitIn(service, mode);
    assert(result.ok, `${mode}: ${result.error}`);
    assertEquals(value, "DEMO-001", mode);
  }
});

Deno.test("block parity (all languages): Java gives the TypeScript value for every block", async () => {
  if (!(await requireJavaOrSkip())) return;
  assertEquals(javaScripts.length, Object.keys(CASES).length, "every block generated a Java script");
  const outputs = await runGeneratedJavaBatch("blocks", javaScripts, {}, SHEETS, instance);
  const failures: string[] = [];
  for (const { id } of javaScripts) {
    const out = outputs.get(id) ?? "";
    const match = /\$\.unit=(.*?)(?:, https:|\}$)/s.exec(out);
    const actual = out.startsWith("OK ") && match ? match[1] : out;
    const ts = tsValues.get(id);
    const wanted = javaText(ts);
    // A whole number may be a Java int / long (`3`) or a Double (`3.0`).
    const sameNumber = typeof ts === "number" && actual.trim() !== "" && Number(actual) === ts;
    if (actual !== wanted && !sameNumber) failures.push(`${id}: Java ${actual} ≠ TypeScript ${wanted}`);
  }
  assertEquals(failures, []);
});
