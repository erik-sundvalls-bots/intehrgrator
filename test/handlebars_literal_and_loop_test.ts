import { assertEquals, assertStringIncludes } from "@std/assert";
import { lowerLiteralHandlebarsToExpr } from "@intehrgrator/core/codegen/handlebars_literal.ts";
import { renderHandlebars } from "@intehrgrator/core/output/handlebars_dialect.ts";

Deno.test("literal Handlebars values lower to parent expressions (#394)", () => {
  const ctx = '@root._data';
  assertEquals(
    lowerLiteralHandlebarsToExpr("{{toUpperCase patientId}}", ctx),
    `(toUpperCase (jget ${ctx} "patientId"))`,
  );
  assertEquals(
    lowerLiteralHandlebarsToExpr("Hello {{name}}", ctx),
    `(concat "Hello " (jget ${ctx} "name"))`,
  );
  const lowered = lowerLiteralHandlebarsToExpr("{{#if ok}}yes{{else}}no{{/if}}", ctx);
  assertStringIncludes(lowered, "ifElse");
  assertStringIncludes(lowered, '"yes"');
});

Deno.test("eachLen precomputes @len and sheetLookup reads _sheets (#394)", () => {
  const template = "{{#eachLen items}}{{@index}}/{{@len}}:{{this}}{{#unless @last}},{{/unless}}{{/eachLen}}";
  const out = renderHandlebars(template, { items: ["a", "b", "c"] });
  assertEquals(out, "0/3:a,1/3:b,2/3:c");

  const lookup = '{{sheetLookup "Units" "code" unit "label"}}';
  const sheets = {
    Units: {
      name: "Units",
      kind: "sheet" as const,
      headers: ["code", "label"],
      values: [["mm[Hg]", "millimetre of mercury"]],
    },
  };
  const label = renderHandlebars(lookup, { unit: "mm[Hg]" }, { sheets });
  assertEquals(label, "millimetre of mercury");
});
