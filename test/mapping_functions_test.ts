/**
 * Blockly Functions are first-class Mapping Model + codegen, not a VMS hatch.
 * Value call sites serialize as Mapping Expression `call("name", …)` and
 * Conversion scripts emit a reusable named function where the dialect allows it.
 */
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import * as enMsg from "blockly/msg/en";
import {
  referencedGridNames,
  renameGridInState,
} from "@intehrgrator/core/function_library/blockly_json.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  initBlocklyGenerators,
  workspaceToModelJson,
} from "@intehrgrator/blockly/mod.ts";
import {
  astToExpressionBlock,
  blockToExpression,
} from "@intehrgrator/blockly/expression_serialize.ts";
import {
  applyExpressionEdit,
  createEmptyModel,
} from "@intehrgrator/core/mapping_model/mod.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { generateGoTemplate } from "@intehrgrator/core/codegen/go_template.ts";
import {
  createSourceContext,
  evaluate,
} from "@intehrgrator/core/source/query_runtime.ts";
import {
  parseExpression,
  serialize,
  validateExpressionSource,
} from "@intehrgrator/core/expression/mod.ts";
import { runGeneratedTypeScript } from "@intehrgrator/core/codegen/run_typescript.ts";
import {
  ensureXQueryRuntime,
  runGeneratedXQuery,
} from "@intehrgrator/core/codegen/run_xquery.ts";
import type { MappingFunction } from "@intehrgrator/types/mod.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  const anyMod = enMsg as
    & { default?: Record<string, string> }
    & Record<string, string>;
  const table = anyMod.default && typeof anyMod.default === "object"
    ? anyMod.default
    : anyMod;
  Blockly.setLocale(table);
  initBlocklyGenerators();
  ready = true;
}

const GREET: MappingFunction = {
  name: "greet",
  kind: "return",
  params: ["who"],
  body: 'concat("Hello ", var("who"))',
};

function modelWithGreetCalls(): ReturnType<typeof createEmptyModel> {
  let model = createEmptyModel("fn-demo");
  model.targetFormat = "json-schema";
  model = applyExpressionEdit(model, "s1", 'call("greet", "Ada")', {
    rmType: "string",
    returnType: "string",
    label: "one",
  });
  model = applyExpressionEdit(model, "s2", 'call("greet", "Bo")', {
    rmType: "string",
    returnType: "string",
    label: "two",
  });
  model.functions = [structuredClone(GREET)];
  return model;
}

Deno.test("call is a Mapping Expression builtin (never function()", () => {
  const src = 'call("greet", var("who"))';
  const ast = parseExpression(src);
  assertEquals(serialize(ast), src);
  assertEquals(validateExpressionSource(src), null);
  assertEquals(validateExpressionSource("function greet() {}") !== null, true);
});

Deno.test("procedures_callreturn serializes as call() and is not an escape hatch", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const def = workspace.newBlock("procedures_defreturn");
  def.setFieldValue("greet", "NAME");
  const body = workspace.newBlock("text");
  body.setFieldValue("hello", "TEXT");
  const ret = def.getInput("RETURN") ?? def.getInput("VALUE");
  ret!.connection!.connect(body.outputConnection!);

  const slot = workspace.newBlock("target_value");
  slot.setFieldValue("slot/fn", "SLOT_ID");
  const call = workspace.newBlock("procedures_callreturn");
  call.setFieldValue("greet", "NAME");
  slot.getInput("VALUE")!.connection!.connect(call.outputConnection!);

  assertEquals(blockToExpression(call), 'call("greet")');
  const ir = workspaceToModelJson(workspace);
  assertEquals(
    ir.unsupported.some((u) => u.blockType.startsWith("procedures_")),
    false,
    JSON.stringify(ir.unsupported),
  );
  assertEquals(ir.functions, [{
    name: "greet",
    kind: "return",
    params: [],
    body: '"hello"',
  }]);
  assertEquals(
    ir.slots.find((s) => s.slotId === "slot/fn")?.expression,
    'call("greet")',
  );
  workspace.dispose();
});

Deno.test("Test Run evaluates call() against Mapping Model functions", () => {
  const ctx = createSourceContext("{}", "json");
  ctx.functions = [GREET];
  assertEquals(evaluate('call("greet", "Ada")', ctx, "string"), "Hello Ada");
});

Deno.test("TypeScript / Java / XQuery emit a reusable named function, not an inlined body", () => {
  const model = modelWithGreetCalls();
  const ts = generate(model, "typescript");
  assertStringIncludes(ts, "function fn_greet(");
  assertEquals(
    ts.split("function fn_greet(").length - 1,
    1,
    "one TypeScript helper",
  );
  assertEquals(ts.split('fn_greet("Ada")').length - 1, 1);
  assertEquals(ts.split('fn_greet("Bo")').length - 1, 1);
  assertEquals(ts.includes('["Hello ", "Ada"].join("")'), false);

  const java = generate(model, "java");
  assertStringIncludes(java, "private Object fn_greet(");
  assertEquals(java.split("private Object fn_greet(").length - 1, 1);
  assertStringIncludes(java, 'fn_greet("Ada")');
  assertStringIncludes(java, 'fn_greet("Bo")');

  const xq = generate(model, "xquery");
  assertStringIncludes(xq, "declare function local:greet(");
  assertEquals(xq.split("declare function local:greet(").length - 1, 1);
  assertStringIncludes(xq, 'local:greet("Ada")');
  assertStringIncludes(xq, 'local:greet("Bo")');
});

Deno.test("VMS-Go emits acyclic define/template, not the call builtin", () => {
  const model = modelWithGreetCalls();
  const go = generateGoTemplate(model);
  assertStringIncludes(go, '{{- define "greet" -}}');
  assertEquals(go.split('{{- define "greet" -}}').length - 1, 1);
  assertStringIncludes(go, 'template "greet" (dict "who" "Ada")');
  assertStringIncludes(go, 'template "greet" (dict "who" "Bo")');
  assertEquals(go.includes("{{call "), false);
  assertEquals(go.includes("(template "), false);
});

Deno.test("VMS-Go rejects statement Function values instead of dropping the STACK", () => {
  const model = modelWithGreetCalls();
  model.functions![0].stack = [{ kind: "set", name: "who", value: '"Ada"' }];
  assertThrows(
    () => generateGoTemplate(model),
    Error,
    "statement-bodied Function greet",
  );
});

Deno.test("VMS-Go rejects Map-value Functions instead of treating their inputs as named Maps", () => {
  for (
    const body of ['maps_entries(var("who"))', 'maps_get(var("who"), "code")']
  ) {
    const model = modelWithGreetCalls();
    model.functions![0].body = body;
    assertThrows(() => generateGoTemplate(model), Error, "Map-value");
  }
});

Deno.test("unsupported Function statements fail rather than hollowing out their body", () => {
  ensure();
  const ws = new Blockly.Workspace();
  try {
    const def = ws.newBlock("procedures_defreturn");
    def.setFieldValue("not_portable_yet", "NAME");
    const repeat = ws.newBlock("controls_repeat_ext");
    def.getInput("STACK")!.connection!.connect(repeat.previousConnection!);
    assertThrows(
      () => workspaceToModelJson(ws),
      Error,
      "Unsupported portable Function statement: controls_repeat_ext",
    );
  } finally {
    ws.dispose();
  }
});

Deno.test("maps_entries accepts a Function parameter Map, not a named Map", () => {
  ensure();
  const ws = new Blockly.Workspace();
  try {
    const entries = ws.newBlock("maps_entries");
    const variable = ws.createVariable("columns");
    const get = ws.newBlock("variables_get");
    get.setFieldValue(variable.getId(), "VAR");
    entries.getInput("MAP")!.connection!.connect(get.outputConnection!);
    assertEquals(blockToExpression(entries), 'maps_entries(var("columns"))');
    const ctx = createSourceContext("{}", "json");
    ctx.functions = [{
      name: "entries",
      kind: "return",
      params: ["columns"],
      body: blockToExpression(entries)!,
    }];
    assertEquals(
      evaluate(
        'call("entries", map("SNOMED", "snomed", "Local", "code"))',
        ctx,
        "string",
      ),
      [["SNOMED", "snomed"], ["Local", "code"]],
    );
  } finally {
    ws.dispose();
  }
});

Deno.test("sheet_lookup takes its Sheet name from a connected Function parameter", () => {
  ensure();
  const ws = new Blockly.Workspace();
  try {
    const lookup = ws.newBlock("sheet_lookup");
    const variable = ws.createVariable("sheet_name");
    const get = ws.newBlock("variables_get");
    get.setFieldValue(variable.getId(), "VAR");
    lookup.getInput("SHEET")!.connection!.connect(get.outputConnection!);
    assertEquals(
      blockToExpression(lookup),
      'sheet_lookup(var("sheet_name"), "", "")',
    );
    const state = Blockly.serialization.workspaces.save(ws);
    state.blocks.blocks[0].fields.NAME = "Sheet1";
    assertEquals(referencedGridNames(state), []);
    renameGridInState(state, "Sheet1", "renamed");
    assertEquals(state.blocks.blocks[0].fields.NAME, "Sheet1");
  } finally {
    ws.dispose();
  }
});

Deno.test("join_swedish retains its statement STACK in portable preview", async () => {
  ensure();
  const { mergeFunctionBundle } = await import(
    "@intehrgrator/blockly/function_bundle.ts"
  );
  const { parseFunctionBundle } = await import(
    "@intehrgrator/core/function_library/mod.ts"
  );
  const bundle = parseFunctionBundle(
    await Deno.readTextFile(
      "function-library/join_swedish.intehr-function.json",
    ),
  );
  const ws = new Blockly.Workspace();
  try {
    const merged = mergeFunctionBundle(ws, bundle, {
      clash: "rename",
      sheets: [],
    });
    const ctx = createSourceContext("{}", "json");
    ctx.functions = workspaceToModelJson(ws).functions;
    ctx.sheets = Object.fromEntries(merged.sheets.map((s) => [s.name, s]));
    assertEquals(
      evaluate(
        'call("join_swedish_words", list("Ada", "Bo", "Cia"))',
        ctx,
        "string",
      ),
      "Ada, Bo och Cia",
    );
    assertEquals(
      evaluate('call("join_swedish_words", list("Ada"))', ctx, "string"),
      "Ada",
    );
    assertEquals(
      evaluate('call("join_swedish_words", list())', ctx, "string"),
      "",
    );
    const model = applyExpressionEdit(
      createEmptyModel("joins"),
      "result",
      'call("join_swedish_words", list("Ada", "Bo", "Cia"))',
      { rmType: "string", returnType: "string" },
    );
    model.targetFormat = "json-schema";
    model.functions = ctx.functions;
    assertEquals(
      runGeneratedTypeScript(
        generate(model, "typescript"),
        { format: "json", data: {} },
        {},
        undefined,
        ctx.sheets,
      ),
      { result: "Ada, Bo och Cia" },
    );
    await ensureXQueryRuntime();
    const xq = generate(model, "xquery").replace(
      /local:convert\(\$source\)\s*$/,
      'local:join-swedish-words(("Ada", "Bo", "Cia"))',
    );
    assertEquals(
      runGeneratedXQuery(xq, { source: {}, sheets: ctx.sheets }),
      "Ada, Bo och Cia",
    );
    assertEquals(
      runGeneratedXQuery(
        xq.replace(
          /local:join-swedish-words\(\("Ada", "Bo", "Cia"\)\)\s*$/,
          "local:join-swedish-words(())",
        ),
        { source: {}, sheets: ctx.sheets },
      ),
      "",
    );
  } finally {
    ws.dispose();
  }
});

Deno.test("generic Map getter round-trips a record parameter and a computed key; missing means null", async () => {
  ensure();
  const ws = new Blockly.Workspace();
  try {
    const source = 'maps_get(var("record"), var("key"))';
    const block = astToExpressionBlock(
      ws,
      parseExpression(source),
      "string",
      (block) => block,
    );
    assertEquals(blockToExpression(block), source);
    const fn: MappingFunction = {
      name: "pick",
      kind: "return",
      params: ["record", "key"],
      body: source,
    };
    const ctx = createSourceContext("{}", "json");
    ctx.functions = [fn];
    assertEquals(
      evaluate('call("pick", map("code", "003"), "code")', ctx, "string"),
      "003",
    );
    assertEquals(
      evaluate('call("pick", map("code", "003"), "missing")', ctx, "string"),
      null,
    );
    const model = applyExpressionEdit(
      createEmptyModel("record"),
      "result",
      'call("pick", map("code", "003"), "code")',
      { rmType: "string", returnType: "string" },
    );
    model.targetFormat = "json-schema";
    model.functions = [fn];
    assertEquals(
      runGeneratedTypeScript(generate(model, "typescript"), {
        format: "json",
        data: {},
      }),
      { result: "003" },
    );
    await ensureXQueryRuntime();
    const query = generate(model, "xquery").replace(
      /local:convert\(\$source\)\s*$/,
      'local:pick(map {"code": "003"}, "code")',
    );
    assertEquals(runGeneratedXQuery(query, { source: {} }), "003");
  } finally {
    ws.dispose();
  }
});
