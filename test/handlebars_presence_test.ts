import { assertEquals } from "@std/assert";
import { createSourceContext, evaluate } from "../src/core/source/query_runtime.ts";
import { extractOrPaths, handlebarsPathToJson } from "../scripts/handlebars_presence.ts";

Deno.test("Handlebars [0] stays first and [1] addresses the second JSON element", () => {
  assertEquals(
    handlebarsPathToJson("granskning.a.[0].v.[0].[|value]"),
    "granskning.a.[0].v.[0].[|value]",
  );
  assertEquals(
    handlebarsPathToJson("granskning.a.[1].v.[0].[|value]"),
    "granskning.a.[2].v.[0].[|value]",
  );
  const paths = extractOrPaths(
    "(and (ne a.[0].[|value] \"MR\") (or a.[0].[|value] a.[1].b.[0].[|other]))",
  );
  assertEquals(paths, [
    "a.[0].[|value]",
    "a.[2].b.[0].[|other]",
  ]);
});

Deno.test("any_of over rewritten paths is true only when a listed field is filled", () => {
  const paths = extractOrPaths("(or item.[0].name.[0].[|value] item.[1].name.[0].[|value])")!;
  const present = createSourceContext(JSON.stringify({
    item: [{}, { name: [{ "|value": "Höger" }] }],
  }), "json");
  const absent = createSourceContext(JSON.stringify({ item: [{}, {}] }), "json");
  const call = (ctx: ReturnType<typeof createSourceContext>) =>
    evaluate(
      `any_of(list(${paths.map((path) => `xpathString(${JSON.stringify(path)})`).join(", ")}), "item", var("item"))`,
      ctx,
      "boolean",
    );
  assertEquals(call(present), true);
  assertEquals(call(absent), false);
});
