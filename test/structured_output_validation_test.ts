/**
 * Simplified STRUCTURED output is read back through ehrtslib and validated
 * against the template, as Simplified FLAT output is.
 */
import { assertEquals } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

Deno.test("Simple-vitals: STRUCTURED output validates in preview and TypeScript", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals" });
  await callAgentTool(service, "set_instance_encoding", { encoding: "structured-json" });
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      testResult: { output: unknown; outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
    };
    const output = run.testResult.output;
    const doc = typeof output === "string" ? JSON.parse(output) : output;
    assertEquals(Object.keys(doc), ["simple-diagnose-and-vitals"], outputMode);
    assertEquals(
      run.testResult.outputValidation?.valid,
      true,
      `${outputMode}: ${run.testResult.outputValidation?.messages?.map((m) => m.message).join("; ")}`,
    );
  }
});

Deno.test("STRUCTURED output with an unknown field is an output validation error", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-series" });
  await callAgentTool(service, "set_instance_encoding", { encoding: "structured-json" });
  const run = await callAgentTool(service, "run_test", { outputMode: "typescript" }) as {
    testResult: { outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
  };
  // The diagnosis is coded on a DV_TEXT-only node; STRUCTURED has no field for its code.
  assertEquals(run.testResult.outputValidation?.valid, false);
  assertEquals(
    run.testResult.outputValidation?.messages?.some((m) => m.message.includes('DV_TEXT has no FLAT field "|code"')),
    true,
  );
});
