/** Shared Blockly block semantics and serialization (issues #393, #394). */
import { assertEquals, assertThrows } from "@std/assert";
import { blocklyOp } from "@intehrgrator/core/codegen/helpers/blockly_ops.ts";
import { jsonBlockReader, stockMathOrOpExpression } from "@intehrgrator/core/expression/blockly_op_blocks.ts";
import { canvasHandlebarsExpression, canvasHandlebarsScriptLiteral } from "@intehrgrator/core/output/canvas_handlebars.ts";
import { parseExpression } from "@intehrgrator/core/expression/mod.ts";

type B = { type: string; fields?: Record<string, unknown>; inputs?: Record<string, { block: B }> };
const serialize = (block: B): string | null =>
  block.type === "math_number"
    ? String(block.fields?.NUM)
    : block.type === "text"
    ? JSON.stringify(block.fields?.TEXT)
    : stockMathOrOpExpression(block.type, jsonBlockReader(block, serialize)) ?? null;

Deno.test("blocklyOp follows Blockly positions and empty results", () => {
  assertEquals(blocklyOp("text_charAt", "abc", "FROM_END", 1), "c");
  assertEquals(blocklyOp("text_charAt", "abc", "FROM_START", 9), "");
  assertEquals(blocklyOp("text_getSubstring", "demo-001", "FIRST", 1, "FROM_END", 4), "demo-");
  assertEquals(blocklyOp("lists_getSublist", ["a", "b", "c"], "FROM_START", 2, "FROM_START", 9), ["b", "c"]);
  assertEquals(blocklyOp("text_indexOf", "a-b-c", "-", "LAST"), 4);
  assertEquals(blocklyOp("lists_indexOf", [1, 2, 2], 2, "FIRST"), 2);
  assertEquals(blocklyOp("math_single", "ROOT", -1), null);
  assertEquals(blocklyOp("math_on_list", "AVERAGE", []), null);
  assertEquals(blocklyOp("math_on_list", "SUM", []), 0);
  assertEquals(blocklyOp("math_on_list", "MODE", [1, 2, 2, 3, 3]), [2, 3]);
  assertEquals(blocklyOp("math_number_property", "DIVISIBLE_BY", 10, 0), false);
  assertEquals(blocklyOp("lists_sort", ["b", "A", "c"], "TEXT", 1), ["A", "b", "c"]);
  assertEquals(blocklyOp("lists_sort", ["10", "9", 1], "NUMERIC", -1), ["10", "9", 1]);
  assertEquals(blocklyOp("lists_split", "SPLIT", "", ","), [""]);
  assertEquals(blocklyOp("power", 2, 3), 8);
  assertEquals(blocklyOp("round_down", -2.5), -3);
});

Deno.test("math blocks serialize POWER and ROUNDUP / ROUNDDOWN instead of + and round", () => {
  const n = (v: number): B => ({ type: "math_number", fields: { NUM: v } });
  const pow: B = { type: "math_arithmetic", fields: { OP: "POWER" }, inputs: { A: { block: n(2) }, B: { block: n(3) } } };
  assertEquals(serialize(pow), "power(2, 3)");
  const up: B = { type: "math_round", fields: { OP: "ROUNDUP" }, inputs: { NUM: { block: n(2.1) } } };
  assertEquals(serialize(up), "round_up(2.1)");
  const down: B = { type: "math_round", fields: { OP: "ROUNDDOWN" }, inputs: { NUM: { block: n(2.1) } } };
  assertEquals(serialize(down), "round_down(2.1)");
  // Every serialization parses as a Mapping Expression.
  for (const block of [pow, up, down]) parseExpression(serialize(block)!);
});

Deno.test("RANDOM modes fail loudly instead of giving a value that changes per run", () => {
  const text: B = { type: "text", fields: { TEXT: "abc" } };
  assertThrows(
    () => serialize({ type: "text_charAt", fields: { WHERE: "RANDOM" }, inputs: { VALUE: { block: text } } }),
    Error,
    "RANDOM positions are not supported",
  );
  assertThrows(
    () => serialize({ type: "math_on_list", fields: { OP: "RANDOM" } }),
    Error,
    "math_on_list RANDOM is not supported",
  );
});

Deno.test("text_handlebars is the whole-canvas product only as the Text document value (#394)", () => {
  const hbs = {
    type: "text_handlebars",
    inputs: {
      SCRIPT: { block: { type: "text_code", fields: { TEXT: "{{name}}", LANG: "handlebars" } } },
      CONTEXT: { block: { type: "source_query_node", fields: { EXPRESSION: "$" } } },
    },
  };
  const product = {
    blocks: {
      blocks: [{ type: "conversion_start", next: { block: { type: "text_document", inputs: { VALUE: { block: hbs } } } } }],
    },
  };
  assertEquals(canvasHandlebarsScriptLiteral(product), "{{name}}");
  assertEquals(canvasHandlebarsExpression(product)?.startsWith("handlebars("), true);
  // The same block as one JSON Schema field value is an ordinary value.
  const field = {
    blocks: {
      blocks: [{
        type: "conversion_start",
        next: { block: { type: "json_schema_root", inputs: { TARGET_unit: { block: hbs } } } },
      }],
    },
  };
  assertEquals(canvasHandlebarsScriptLiteral(field), null);
  assertEquals(canvasHandlebarsExpression(field), null);
});

Deno.test("text blocks count code points, as Go, Java and XQuery do", () => {
  assertEquals(blocklyOp("text_length", "a😀b"), 3);
  assertEquals(blocklyOp("text_charAt", "a😀b", "FROM_START", 2), "😀");
  assertEquals(blocklyOp("text_indexOf", "😀a😀b", "b", "FIRST"), 4);
  assertEquals(blocklyOp("text_getSubstring", "a😀b", "FROM_START", 2, "LAST", null), "😀b");
});
