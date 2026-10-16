import { assertEquals, assertExists } from "@std/assert";
import { parseExpression, serialize, validateExpressionSource } from "@intehrgrator/core/expression/mod.ts";
import { createSourceContext, evaluate } from "@intehrgrator/core/source/query_runtime.ts";

Deno.test("expression parse and serialize round-trip", () => {
  const src = 'trim(xpathNumber("/vitals[1]/systolic"))';
  const ast = parseExpression(src);
  assertEquals(serialize(ast), src);
});

Deno.test("expression rejects import", () => {
  const err = validateExpressionSource('import fs from "fs"');
  assertExists(err);
});

Deno.test("if expression", () => {
  const ast = parseExpression('if(xpathBoolean("/active"), xpathNumber("/a"), xpathNumber("/b"))');
  assertEquals(ast.kind, "call");
});

Deno.test("lists_getIndex is a Mapping Expression builtin", () => {
  const src = 'lists_getIndex(list("I10", "E11"), "FROM_START", 2)';
  const ast = parseExpression(src);
  assertEquals(serialize(ast), src);
  assertEquals(validateExpressionSource(src), null);
});

Deno.test("change_case folds display text and leaves a missing path empty", () => {
  const src = 'change_case(xpathString("$.typ"), "LOWERCASE")';
  assertEquals(serialize(parseExpression(src)), src);
  const present = createSourceContext(JSON.stringify({ typ: "Strålbehandling" }), "json");
  const absent = createSourceContext(JSON.stringify({}), "json");
  assertEquals(evaluate(src, present, "string"), "strålbehandling");
  assertEquals(evaluate(src, absent, "string"), "");
  assertEquals(
    evaluate('change_case("Best supportive care (BSC)", "LOWERCASE")', present, "string"),
    "best supportive care (bsc)",
  );
});

Deno.test("switch and literal expressions", () => {
  const src = 'switch(xpathString("/type"), "a", 1, "b", 2, 0)';
  const ast = parseExpression(src);
  assertEquals(serialize(ast), src);
  const lit = parseExpression('"hello"');
  assertEquals(serialize(lit), '"hello"');
});
