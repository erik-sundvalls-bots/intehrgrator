import { assertEquals } from "@std/assert";
import {
  attachNumericLimitLogs,
  collectNumericLimitLogs,
  NUMERIC_LIMIT_NOTE,
  numericLimitWarning,
} from "@intehrgrator/core/codegen/numeric_limits.ts";

Deno.test("numericLimitWarning is silent when the target can express the value", () => {
  assertEquals(numericLimitWarning(0), null);
  assertEquals(numericLimitWarning(3.14), null);
  assertEquals(numericLimitWarning(1e6), null);
  assertEquals(numericLimitWarning(1e-6), null);
  assertEquals(numericLimitWarning(1e-7, "json"), null);
  assertEquals(numericLimitWarning(1e-7, "xml-decimal"), null);
  assertEquals(numericLimitWarning(1e21, "json") != null, true); // 1e21 is an unsafe integer
  assertEquals(numericLimitWarning(9007199254740991), null);
});

Deno.test("numericLimitWarning fires only when the target cannot express the value exactly", () => {
  const unsafe = numericLimitWarning(9007199254740993, "json");
  const infJson = numericLimitWarning(Infinity, "json");
  const infDouble = numericLimitWarning(Infinity, "xml-double");
  assertEquals(Boolean(unsafe && unsafe.includes("2^53")), true);
  assertEquals(Boolean(infJson && infJson.includes("cannot express")), true);
  assertEquals(infDouble, null);
});

Deno.test("collectNumericLimitLogs does not flag expressible scientific or large IDs", () => {
  assertEquals(collectNumericLimitLogs({ n: 1e-7, text: "value is 1e-7 and 3" }, "json"), []);
  assertEquals(collectNumericLimitLogs({ id: 900000000000207000 }), []);
  const infLogs = collectNumericLimitLogs({ n: Infinity }, "json");
  assertEquals(infLogs.length > 0, true);
  const xmlExp = collectNumericLimitLogs("<Value>1e-7</Value>", "xml-decimal");
  assertEquals(xmlExp.length > 0, true);
  const result = attachNumericLimitLogs({ ok: true, output: Infinity, warnings: [] }, () => {});
  assertEquals((result.logs?.length ?? 0) > 0, true);
  assertEquals(NUMERIC_LIMIT_NOTE.includes("RFC 8259"), true);
});
