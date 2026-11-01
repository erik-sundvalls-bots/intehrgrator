/**
 * Karda example sets: Mapping preview and the TypeScript Conversion Script
 * give the same FLAT repeats and coded values (#321, ehrtslib v0.9 output flavour).
 */
import { assert, assertEquals } from "@std/assert";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

type Flat = Record<string, unknown>;

async function runBoth(setId: string): Promise<Array<{ filename: string; preview: Flat; typescript: Flat }>> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId, includeMapping: true });
  const listed = await callAgentTool(service, "list_examples", {}) as {
    examples: Array<{ id: string; filename?: string }>;
  };
  const rows = [];
  for (const example of listed.examples) {
    await callAgentTool(service, "set_active_example", { id: example.id });
    const out: Record<string, Flat> = {};
    for (const outputMode of ["preview", "typescript"] as const) {
      const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
      const output = run.testResult.output;
      out[outputMode] = (typeof output === "string" ? JSON.parse(output) : output) as Flat;
    }
    rows.push({ filename: example.filename ?? example.id, preview: out.preview!, typescript: out.typescript! });
  }
  return rows;
}

function repeats(flat: Flat): string[] {
  const found = new Set<string>();
  for (const key of Object.keys(flat)) {
    for (const match of key.matchAll(/([a-zåäö_]+_per_(?:substans|kurdag)):(\d+)/g)) found.add(`${match[1]}:${match[2]}`);
  }
  return [...found].sort();
}

function value(flat: Flat, suffix: string): unknown {
  const key = Object.keys(flat).find((k) => k.endsWith(suffix));
  return key ? flat[key] : undefined;
}

Deno.test("Karda order: preview emits every substance of a treatment day, as TypeScript does (#321)", async () => {
  const rows = await runBoth("karda-ordinationsdata-to-openehr-flat");
  assertEquals(rows.length, 7);
  let multi = 0;
  for (const row of rows) {
    const preview = repeats(row.preview);
    assertEquals(preview, repeats(row.typescript), row.filename);
    if (preview.includes("ordination_per_substans:1")) multi++;
    // The substance itself, not an empty coded text.
    const substance = value(row.preview, "ordination_per_substans:0/detaljer_om_substans/substans|value");
    assert(typeof substance === "string" && substance.trim(), `${row.filename}: ${substance}`);
  }
  // Four examples have two or three substances on one day.
  assertEquals(multi, 4);
  const prov = rows.find((row) => row.filename.includes("PRÖV"));
  assert(prov && repeats(prov.preview).includes("ordination_per_substans:2"));
});

Deno.test("Karda TypeScript FLAT codes category, ISM state and coded records; preview writes mapped units", async () => {
  const order = (await runBoth("karda-ordinationsdata-to-openehr-flat"))[0]!;
  assertEquals(value(order.typescript, "/category|code"), "433");
  assertEquals(Object.keys(order.typescript).some((key) => key.startsWith("ctx/")), false);
  assertEquals(value(order.preview, "ordination_per_substans:0/detaljer_om_substans/ordinerad_dos|unit"), "mg");

  const admin = (await runBoth("karda-administreringsdata-to-openehr-flat"))[0]!;
  assertEquals(value(admin.typescript, "/category|code"), "433");
  assertEquals(value(admin.typescript, "/diagnos_vårdkontakt|code"), "C509");
  assertEquals(Object.values(admin.typescript).includes("[object Object]"), false);
  assertEquals(value(admin.typescript, "administrerad_läkemedelsbehandling:0/ism_transition/current_state|code"), "532");
  assertEquals(value(admin.preview, "administrerad_läkemedelsbehandling:0/detaljer_per_substans/administrerad_dos|unit"), "mg");
});

Deno.test("OBX mapped: preview and TypeScript output validate (DV_IDENTIFIER type, category code)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "obx-mhv1-mapped-json-to-openehr", includeMapping: true });
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      valid: boolean;
      testResult: { outputValidation?: { messages: Array<{ path: string; message: string }> } };
    };
    const messages = (run.testResult.outputValidation?.messages ?? []).map((m) => `${m.path}: ${m.message}`);
    assertEquals(messages, [], `${outputMode}\n${messages.join("\n")}`);
    assertEquals(run.valid, true, outputMode);
  }
});
