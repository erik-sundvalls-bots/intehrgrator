/**
 * Karda example sets: Mapping preview and the TypeScript Conversion Script
 * give the same FLAT repeats and coded values (#321, ehrtslib output flavour).
 */
import { join } from "@std/path";
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
    // The existing clinical goldens are the independent source of truth for
    // every form/route TERM_MAPPING (their composition-root name is older).
    const goldenName = row.filename.replace("_source_", "_target_").replace("-source-", "-target-");
    const golden = JSON.parse(await Deno.readTextFile(join(import.meta.dirname!, "fixtures",
      "ordinerad-medicinsk-onkologisk-behandling", "target-instance", goldenName))) as Flat;
    for (const [key, expected] of Object.entries(golden)) {
      if (!key.includes("/_mapping:")) continue;
      const suffix = key.slice(key.indexOf("/"));
      for (const flat of [row.preview, row.typescript]) assertEquals(value(flat, suffix), expected, `${row.filename}: ${suffix}`);
    }
    for (const flat of [row.preview, row.typescript]) {
      assertEquals(value(flat, "ordination_per_substans:0/detaljer_om_substans/form|terminology"), "Cytodos value set");
      const expectedCode = row.filename.includes("used_for_mapping") ? "1" : "2";
      assertEquals(value(flat, "ordination_per_substans:0/detaljer_om_substans/form|code"), expectedCode);
    }
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
  // A 0..* ELEMENT keeps its own max (ehrtslib#268), so the first diagnosis is :0.
  assertEquals(value(admin.typescript, "/diagnos_vårdkontakt:0|code"), "C509");
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

Deno.test("Karda order: the nested Vårdgivare cluster and the identifier type reach both outputs (F-M12)", async () => {
  const order = (await runBoth("karda-ordinationsdata-to-openehr-flat"))[0]!;
  for (const [mode, flat] of [["preview", order.preview], ["typescript", order.typescript]] as const) {
    assertEquals(value(flat, "/context/vårdenhet/vårdgivare/namn"), "PDL-vårdgivare SLL IdP TEST", mode);
    // 0..* identifiers carry :0 (ehrtslib#268). Name-constrained siblings stay apart (ehrtslib#250).
    assertEquals(value(flat, "/context/vårdenhet/identifierare:0|type"), "urn:oid:1.2.752.29.4.19", mode);
    assertEquals(value(flat, "/context/vårdenhet/vårdgivare/organisationsnummer:0|id"), "2321000016", mode);
  }
});

Deno.test("Karda order: the nested Vårdgivare organisation number keeps its template name in canonical output (F-M12)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "karda-ordinationsdata-to-openehr-flat" });
  const listed = await callAgentTool(service, "list_examples", {}) as { examples: Array<{ id: string }> };
  await callAgentTool(service, "set_active_example", { id: listed.examples[0]!.id });
  await callAgentTool(service, "set_instance_encoding", { encoding: "canonical-json" });
  type Node = { name?: { value?: string }; archetype_node_id?: string; items?: Node[]; value?: { id?: string; type?: string } };
  const find = (node: unknown, name: string): Node | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if ((node as Node).name?.value === name && Array.isArray((node as Node).items)) return node as Node;
    for (const child of Object.values(node)) {
      const hit = find(child, name);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const outputMode of ["typescript", "preview"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      testResult: { output: unknown; outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
    };
    const output = run.testResult.output;
    const composition = typeof output === "string" ? JSON.parse(output) : output;
    // Each sibling is checked against its own name (ehrtslib#250), and every
    // ACTIVITY has its RM-mandatory action_archetype_id.
    assertEquals(
      run.testResult.outputValidation?.valid,
      true,
      `${outputMode}: ${run.testResult.outputValidation?.messages?.map((m) => m.message).join("; ")}`,
    );
    const activities = (composition.content[0].items[0].activities ?? []) as Array<{ action_archetype_id?: string }>;
    assert(activities.length > 0, outputMode);
    assertEquals(activities.map((a) => a.action_archetype_id), activities.map(() => "/.*/"), outputMode);
    const vardgivare = find(composition, "Vårdgivare");
    assert(vardgivare, outputMode);
    const ids = vardgivare.items!.filter((item) => item.archetype_node_id === "at0003")
      .map((item) => [item.name?.value, item.value?.id, item.value?.type]);
    assertEquals(ids, [
      ["Identifierare", "SE2321000016-I1MN", "urn:oid:1.2.752.29.4.19"],
      ["Organisationsnummer", "2321000016", "urn:oid:2.5.4.97"],
    ], outputMode);
  }
});
