/**
 * TypeScript mode keeps conditions and true/false values the way preview reads
 * them: a source value as an if/else condition (F-M9) and DV_BOOLEAN (F-M11).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const DIAGNOSIS =
  "simple-diagnose-and-vitals//content[openEHR-EHR-EVALUATION.problem_diagnosis.v1]/data/at0001/items/at0002/value/DV_TEXT/value";
const q = (expression: string) => ({ block: { type: "source_query", fields: { EXPRESSION: expression } } });

function diagnosisText(output: unknown): unknown {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return text.match(/"archetype_node_id":"at0002"[^}]*"value":\{"_type":"DV_TEXT","value":"([^"]*)"/)?.[1] ??
    text.match(/"at0002".{0,120}?"value":\{"_type":"DV_TEXT","value":"([^"]*)"/)?.[1];
}

Deno.test("if/else on a plain source value compiles to an is-not-empty test, not false (F-M9)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-series-unmapped", includeMapping: false });
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: "simple-diagnose-and-vitals",
      suggestions: [{
        slotId: DIAGNOSIS,
        block: {
          type: "logic_ternary",
          inputs: { IF: q("$.diagnosis.code"), THEN: q("$.diagnosis.display"), ELSE: { block: { type: "text", fields: { TEXT: "none" } } } },
        },
      }],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 1, imported.report.errors.join("; "));
  const script = (await callAgentTool(service, "generate_script", { language: "typescript" }) as { code: string }).code;
  assertEquals(script.includes("(false ?"), false);
  const texts = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
    texts.push(diagnosisText(run.testResult.output));
  }
  assert(texts[0] && texts[0] !== "none", String(texts[0]));
  assertEquals(texts[1], texts[0]);
  assertStringIncludes(script, "sameItem(");
});

Deno.test("TypeScript writes a mapped DV_BOOLEAN as true/false, as preview (F-M11)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "karda-ordinationsdata-to-openehr-flat", includeMapping: true });
  const values = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
    const output = run.testResult.output;
    const flat = (typeof output === "string" ? JSON.parse(output) : output) as Record<string, unknown>;
    const key = Object.keys(flat).find((k) => k.endsWith("/ges_inom_ramen_för_studie"));
    assert(key, outputMode);
    values.push(flat[key]);
  }
  assertEquals(values, [false, false]);
  const script = (await callAgentTool(service, "generate_script", { language: "typescript" }) as { code: string }).code;
  assertEquals(/DV_BOOLEAN, \{\s*value: String\(/.test(script), false);
});
