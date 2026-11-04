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

Deno.test("Simple-vitals-series: a coded diagnosis on a DV_TEXT node validates in STRUCTURED", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-series" });
  await callAgentTool(service, "set_instance_encoding", { encoding: "structured-json" });
  const run = await callAgentTool(service, "run_test", { outputMode: "typescript" }) as {
    testResult: { outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
  };
  // ehrtslib#255: a coded text where the template allows plain text is read and written as coded text.
  assertEquals(run.testResult.outputValidation?.messages ?? [], []);
  assertEquals(run.testResult.outputValidation?.valid, true);
});

Deno.test("Simple-vitals-series and OBX validate in FLAT and STRUCTURED", async () => {
  for (const setId of ["Simple-vitals-series", "obx-mhv1-mapped-json-to-openehr"]) {
    const service = new WorkbenchService();
    await callAgentTool(service, "load_example_set", { setId });
    const listed = await callAgentTool(service, "list_examples", {}) as {
      examples: Array<{ id: string; filename?: string }>;
    };
    const examples = listed.examples.filter((ex) => !ex.filename?.includes("invalid"));
    for (const encoding of ["flat-json", "structured-json"] as const) {
      await callAgentTool(service, "set_instance_encoding", { encoding });
      for (const example of examples) {
        await callAgentTool(service, "set_active_example", { id: example.id });
        for (const outputMode of ["preview", "typescript"] as const) {
          const run = await callAgentTool(service, "run_test", { outputMode }) as {
            testResult: { outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
          };
          const messages = run.testResult.outputValidation?.messages?.map((m) => m.message).join("; ");
          assertEquals(
            run.testResult.outputValidation?.valid,
            true,
            `${setId} ${example.filename} ${encoding} ${outputMode}: ${messages}`,
          );
        }
      }
    }
  }
});
