import { assertEquals } from "@std/assert";
import {
  attachNumericLimitLogs,
  collectNumericLimitLogs,
  NUMERIC_LIMIT_NOTE,
  numericLimitWarning,
} from "@intehrgrator/core/codegen/numeric_limits.ts";

Deno.test("numericLimitWarning is silent for ordinary numbers", () => {
  assertEquals(numericLimitWarning(0), null);
  assertEquals(numericLimitWarning(3.14), null);
  assertEquals(numericLimitWarning(1e6), null);
  assertEquals(numericLimitWarning(1e-6), null);
  assertEquals(numericLimitWarning(9007199254740991), null);
});

Deno.test("numericLimitWarning fires at the ECMA-262 / safe-integer bounds", () => {
  const large = numericLimitWarning(1e21);
  const small = numericLimitWarning(1e-7);
  const unsafe = numericLimitWarning(9007199254740993);
  const inf = numericLimitWarning(Infinity);
  assertEquals(Boolean(large && large.includes("1e21")), true);
  assertEquals(Boolean(small && small.includes("1e-6")), true);
  assertEquals(Boolean(unsafe && unsafe.includes("2^53")), true);
  assertEquals(Boolean(inf && inf.includes("finite")), true);
});

Deno.test("collectNumericLimitLogs walks JSON and printed numbers", () => {
  const logs = collectNumericLimitLogs({ n: 1e21, text: "value is 1e-7 and 3" });
  assertEquals(logs.length >= 2, true);
  const result = attachNumericLimitLogs({ ok: true, output: 1e21, warnings: [] }, () => {});
  assertEquals((result.logs?.length ?? 0) > 0, true);
  // Large integer IDs are described in the toolbox note, not logged per conversion.
  assertEquals(collectNumericLimitLogs({ id: 900000000000207000 }), []);
  assertEquals(NUMERIC_LIMIT_NOTE.includes("binary64"), true);
});
