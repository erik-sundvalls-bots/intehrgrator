import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  initBlocklyGenerators,
  workspaceToModelJson,
} from "@intehrgrator/blockly/mod.ts";
import { mergeFunctionBundle } from "@intehrgrator/blockly/function_bundle.ts";
import { parseFunctionBundle } from "@intehrgrator/core/function_library/mod.ts";
import {
  ensureXQueryRuntime,
  runGeneratedXQuery,
} from "@intehrgrator/core/codegen/run_xquery.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { runGeneratedTypeScript } from "@intehrgrator/core/codegen/run_typescript.ts";
import {
  applyExpressionEdit,
  createEmptyModel,
} from "@intehrgrator/core/mapping_model/mod.ts";
import { assertEquals } from "@std/assert";
import {
  createSourceContext,
  evaluate,
} from "@intehrgrator/core/source/query_runtime.ts";

initBlocklyGenerators();
const libraryBundle = parseFunctionBundle(
  await Deno.readTextFile(
    new URL(
      "../function-library/coded_text_from_sheet.intehr-function.json",
      import.meta.url,
    ),
  ),
);
function libraryFunctions() {
  const workspace = new Blockly.Workspace();
  try {
    mergeFunctionBundle(workspace, libraryBundle, {
      clash: "rename",
      sheets: [],
    });
    return workspaceToModelJson(workspace).functions;
  } finally {
    workspace.dispose();
  }
}

Deno.test("Sheet Function coded text keeps the primary code and adds equivalent terminology mappings", () => {
  const ctx = createSourceContext("{}", "json");
  ctx.functions = libraryFunctions();
  ctx.sheets = {
    medicines: {
      name: "medicines",
      headers: ["key", "text", "code", "snomed", "other", "empty"],
      values: [["A", "Tablet", "03.0000", "421378002", "X7", ""]],
    },
  };
  assertEquals(
    evaluate(
      'call("coded_text_from_sheet", "medicines", "key", "A", "text", "code", "Local", map("SNOMED-CT", "snomed", "Other", "other", "Empty", "empty"))',
      ctx,
      "string",
    ),
    {
      _type: "DV_CODED_TEXT",
      value: "Tablet",
      defining_code: {
        _type: "CODE_PHRASE",
        code_string: "03.0000",
        terminology_id: { _type: "TERMINOLOGY_ID", value: "Local" },
      },
      mappings: [
        {
          _type: "TERM_MAPPING",
          match: "=",
          target: {
            _type: "CODE_PHRASE",
            code_string: "421378002",
            terminology_id: { _type: "TERMINOLOGY_ID", value: "SNOMED-CT" },
          },
        },
        {
          _type: "TERM_MAPPING",
          match: "=",
          target: {
            _type: "CODE_PHRASE",
            code_string: "X7",
            terminology_id: { _type: "TERMINOLOGY_ID", value: "Other" },
          },
        },
      ],
    },
  );
});

Deno.test("Sheet Function coded text omits missing primaries and blank mapping codes without inventing a value", () => {
  const ctx = createSourceContext("{}", "json");
  ctx.functions = libraryFunctions();
  ctx.sheets = {
    codes: {
      name: "codes",
      headers: ["key", "text", "code", "snomed"],
      values: [
        ["blank-map", "Tablet", "03", ""],
        ["no-code", "Tablet", "", "123"],
        ["no-text", "", "03", "123"],
      ],
    },
  };
  const run = (key: string, term = "Local") =>
    evaluate(
      `call("coded_text_from_sheet", "codes", "key", "${key}", "text", "code", "${term}", map("SNOMED-CT", "snomed"))`,
      ctx,
      "string",
    );
  for (const key of ["missing", "", "no-code", "no-text"]) {
    assertEquals(run(key), null, key);
  }
  assertEquals(run("blank-map", ""), null);
  assertEquals(run("blank-map"), {
    _type: "DV_CODED_TEXT",
    value: "Tablet",
    defining_code: {
      _type: "CODE_PHRASE",
      code_string: "03",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "Local" },
    },
  });
});

Deno.test("the library Function imports without project data and returns a complete coded value", async () => {
  initBlocklyGenerators();
  const bundle = parseFunctionBundle(
    await Deno.readTextFile(
      new URL(
        "../function-library/coded_text_from_sheet.intehr-function.json",
        import.meta.url,
      ),
    ),
  );
  const workspace = new Blockly.Workspace();
  workspace.createVariable("key"); // A function parameter may already exist on the destination canvas.
  try {
    const merged = mergeFunctionBundle(workspace, bundle, {
      clash: "rename",
      sheets: [],
    });
    assertEquals(merged.sheets, []);
    const ctx = createSourceContext("{}", "json");
    ctx.functions = libraryFunctions();
    ctx.functions = workspaceToModelJson(workspace).functions;
    ctx.sheets = {
      local: {
        name: "local",
        headers: ["id", "label", "primary", "other"],
        values: [["A", "Tablet", "003", "X7"]],
      },
    };
    assertEquals(
      evaluate(
        'call("coded_text_from_sheet", "local", "id", "A", "label", "primary", "Local", map("Other", "other"))',
        ctx,
        "string",
      ),
      {
        _type: "DV_CODED_TEXT",
        value: "Tablet",
        defining_code: {
          _type: "CODE_PHRASE",
          code_string: "003",
          terminology_id: { _type: "TERMINOLOGY_ID", value: "Local" },
        },
        mappings: [{
          _type: "TERM_MAPPING",
          match: "=",
          target: {
            _type: "CODE_PHRASE",
            code_string: "X7",
            terminology_id: { _type: "TERMINOLOGY_ID", value: "Other" },
          },
        }],
      },
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("XQuery Sheet coded text returns equivalent mappings without stringifying the record", async () => {
  await ensureXQueryRuntime();
  const model = createEmptyModel("Function parity");
  model.targetFormat = "json-schema";
  model.functions = libraryFunctions();
  const query = generate(model, "xquery").replace(
    /local:convert\(\$source\)\s*$/,
    'local:coded-text-from-sheet("local", "id", "A", "label", "primary", "Local", map { "Other": "other", "Empty": "empty" })',
  );
  const output = runGeneratedXQuery(query, {
    source: {},
    sheets: {
      local: {
        name: "local",
        headers: ["id", "label", "primary", "other", "empty"],
        values: [["A", "Tablet", "003", "X7", ""]],
      },
    },
  });
  const primaryOnly = runGeneratedXQuery(
    query.replace('map { "Other": "other", "Empty": "empty" }', "map {}"),
    {
      source: {},
      sheets: {
        local: {
          name: "local",
          headers: ["id", "label", "primary"],
          values: [["A", "Tablet", "003"]],
        },
      },
    },
  );
  assertEquals(primaryOnly, {
    _type: "DV_CODED_TEXT",
    value: "Tablet",
    defining_code: {
      _type: "CODE_PHRASE",
      code_string: "003",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "Local" },
    },
  });
  assertEquals(output, {
    _type: "DV_CODED_TEXT",
    value: "Tablet",
    defining_code: {
      _type: "CODE_PHRASE",
      code_string: "003",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "Local" },
    },
    mappings: [{
      _type: "TERM_MAPPING",
      match: "=",
      target: {
        _type: "CODE_PHRASE",
        code_string: "X7",
        terminology_id: { _type: "TERMINOLOGY_ID", value: "Other" },
      },
    }],
  });
});

Deno.test("generated TypeScript executes the ordinary coded Function STACK without a canvas", () => {
  const model = applyExpressionEdit(
    createEmptyModel("coded"),
    "coded",
    'call("coded_text_from_sheet", "local", "id", "A", "label", "primary", "Local", map("Other", "other"))',
    { rmType: "string", returnType: "string" },
  );
  model.targetFormat = "json-schema";
  model.functions = libraryFunctions();
  const output = runGeneratedTypeScript(
    generate(model, "typescript"),
    { format: "json", data: {} },
    {},
    undefined,
    {
      local: {
        name: "local",
        headers: ["id", "label", "primary", "other"],
        values: [["A", "Tablet", "003", "X7"]],
      },
    },
  ) as {
    coded: {
      defining_code: { code_string: string };
      mappings: Array<{ target: { code_string: string } }>;
    };
  };
  assertEquals(output.coded.defining_code.code_string, "003");
  assertEquals(output.coded.mappings[0]?.target.code_string, "X7");
});
