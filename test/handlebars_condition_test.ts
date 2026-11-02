import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { extractTakeCareKeywords } from "../scripts/build-lung-mdt-blockly.ts";
import {
  parseHandlebarsCondition,
  pathOnlyOr,
} from "../scripts/handlebars_condition.ts";

const script = Deno.readTextFileSync(
  join(import.meta.dirname!, "fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt"),
);

Deno.test("lung-MDT keyword guards parse as paths, compares, and path-only ors", () => {
  const conditions = extractTakeCareKeywords(script)
    .map((item) => item.condition)
    .filter((condition): condition is string => Boolean(condition));
  assertEquals(conditions.length, 17);
  let paths = 0;
  let ors = 0;
  let ands = 0;
  for (const condition of conditions) {
    const expr = parseHandlebarsCondition(condition);
    if (expr.kind === "path") paths++;
    else if (expr.kind === "call" && expr.name === "or") {
      ors++;
      const list = pathOnlyOr(expr);
      assertEquals(list !== null && list.length >= 2, true, condition.slice(0, 80));
    } else if (expr.kind === "call" && expr.name === "and") ands++;
    else throw new Error(condition.slice(0, 80));
  }
  assertEquals(paths, 9);
  assertEquals(ors, 5);
  assertEquals(ands, 3);
});

Deno.test("an imaging guard is modality compare and a presence list", () => {
  const imaging = extractTakeCareKeywords(script).find((item) => item.termId === "12683");
  const expr = parseHandlebarsCondition(imaging?.condition ?? "");
  assertEquals(expr.kind, "call");
  if (expr.kind !== "call") return;
  assertEquals(expr.name, "and");
  assertEquals(expr.args[0]?.kind === "call" && expr.args[0].name === "eq", true);
  const paths = expr.args[1] ? pathOnlyOr(expr.args[1]) : null;
  assertEquals((paths?.length ?? 0) > 4, true);
});
