import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalDecimal,
  exactnessWarning,
  formatNumber,
  NumberFormatError,
  numberFormForRmAttribute,
  numberFormForSchemaType,
  stringifyJson,
} from "@intehrgrator/core/codegen/numeric_format.ts";
import { kintegrateHandlebarsHelpers } from "@intehrgrator/core/codegen/helpers/handlebars.ts";

Deno.test("JSON RFC 8259: shortest form, integers without .0, reject NaN/Infinity", () => {
  assertEquals(formatNumber(3, "json").text, "3");
  assertEquals(formatNumber(3.0, "json").text, "3");
  assertEquals(formatNumber(-0, "json").text, "0");
  assertEquals(formatNumber(0.1, "json").text, "0.1");
  assertEquals(formatNumber(1e-7, "json").text, "1e-7");
  assertEquals(formatNumber(-12.5, "json").text, "-12.5");
  assertThrows(() => formatNumber(NaN, "json"), NumberFormatError, "RFC 8259");
  assertThrows(() => formatNumber(Infinity, "json"), NumberFormatError, "RFC 8259");
  assertThrows(() => formatNumber(-Infinity, "json"), NumberFormatError, "RFC 8259");
  assertThrows(() => stringifyJson({ n: Infinity }), NumberFormatError, "RFC 8259");
  assertEquals(stringifyJson({ n: 3.0, x: 1e-7 }), '{"n":3,"x":1e-7}');
});

Deno.test("XML Schema xs:integer canonical form", () => {
  assertEquals(formatNumber(3, "xml-integer").text, "3");
  assertEquals(formatNumber(3.0, "xml-integer").text, "3");
  assertEquals(formatNumber(-0, "xml-integer").text, "0");
  assertEquals(formatNumber(-12, "xml-integer").text, "-12");
  assertThrows(() => formatNumber(1.5, "xml-integer"), NumberFormatError, "whole number");
  assertThrows(() => formatNumber(NaN, "xml-integer"), NumberFormatError, "xs:integer");
  assertThrows(() => formatNumber(Infinity, "xml-integer"), NumberFormatError, "xs:integer");
  assertThrows(
    () => formatNumber(2147483648, "xml-integer", { schemaType: "xs:int" }),
    NumberFormatError,
    "range",
  );
  assertEquals(formatNumber(12, "xml-integer", { schemaType: "xs:int" }).text, "12");
});

Deno.test("XML Schema xs:decimal canonical form never uses an exponent", () => {
  assertEquals(formatNumber(3, "xml-decimal").text, "3");
  assertEquals(formatNumber(3.0, "xml-decimal").text, "3");
  assertEquals(formatNumber(1.50, "xml-decimal").text, "1.5");
  assertEquals(formatNumber(1e-7, "xml-decimal").text, "0.0000001");
  assertEquals(formatNumber(1e21, "xml-decimal").text.includes("e"), false);
  assertEquals(canonicalDecimal(1e-7), "0.0000001");
  assertThrows(() => formatNumber(NaN, "xml-decimal"), NumberFormatError, "xs:decimal");
  assertThrows(() => formatNumber(Infinity, "xml-decimal"), NumberFormatError, "xs:decimal");
  assertEquals(formatNumber(78.5, "xml-decimal", { precision: 3 }).text, "78.500");
  assertEquals(formatNumber(110.2, "xml-decimal", { precision: 0 }).text, "110");
});

Deno.test("XML Schema xs:double allows INF / NaN and a plain decimal otherwise", () => {
  assertEquals(formatNumber(NaN, "xml-double").text, "NaN");
  assertEquals(formatNumber(Infinity, "xml-double").text, "INF");
  assertEquals(formatNumber(-Infinity, "xml-double").text, "-INF");
  assertEquals(formatNumber(-0, "xml-double").text, "-0");
  assertEquals(formatNumber(110, "xml-double").text, "110");
  assertEquals(formatNumber(1e-7, "xml-double").text, "0.0000001");
});

Deno.test("schema and RM types pick the right form", () => {
  assertEquals(numberFormForSchemaType("xs:integer", "xml"), "xml-integer");
  assertEquals(numberFormForSchemaType("xs:int", "xml"), "xml-integer");
  assertEquals(numberFormForSchemaType("xs:decimal", "xml"), "xml-decimal");
  assertEquals(numberFormForSchemaType("xs:double", "xml"), "xml-double");
  assertEquals(numberFormForSchemaType("integer", "json"), "xml-integer");
  assertEquals(numberFormForSchemaType("number", "json"), "json");
  assertEquals(numberFormForRmAttribute("DV_COUNT", "magnitude", "json"), "xml-integer");
  assertEquals(numberFormForRmAttribute("DV_QUANTITY", "magnitude", "xml"), "xml-double");
  assertEquals(numberFormForRmAttribute("DV_QUANTITY", "magnitude", "json"), "json");
  assertEquals(numberFormForRmAttribute("DV_PROPORTION", "numerator", "xml"), "xml-double");
  assertEquals(numberFormForRmAttribute("DV_ORDINAL", "value", "xml"), "xml-integer");
});

Deno.test("exactnessWarning is silent when the target can hold the value", () => {
  assertEquals(exactnessWarning(1e-7, "json"), undefined);
  assertEquals(exactnessWarning(1e-7, "xml-decimal"), undefined);
  assertEquals(exactnessWarning(3.14, "json"), undefined);
  assertEquals(exactnessWarning(Infinity, "xml-double"), undefined);
  assertEquals(Boolean(exactnessWarning(9007199254740993, "json")?.includes("2^53")), true);
  assertEquals(Boolean(exactnessWarning(Infinity, "json")?.includes("cannot express")), true);
});

Deno.test("Handlebars toJson uses the shared JSON formatter", () => {
  const toJson = kintegrateHandlebarsHelpers.toJson;
  assertEquals(toJson({ magnitude: 3.0 }), '{"magnitude":3}');
  assertThrows(() => toJson(NaN), NumberFormatError, "RFC 8259");
});
