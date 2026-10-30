/**
 * MCP behaviour from the 0.11 desktop test with two AI agents
 * (#311 catalogUrl, #312 rough edges, #313 discoverability).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { serveDir } from "@std/http/file-server";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { createAgentApiHandler } from "@intehrgrator/agent/http.ts";
import { AGENT_TOOLS, callAgentTool, defaultExampleSetCatalogUrl } from "@intehrgrator/agent/tools.ts";
import { HttpAgentClient, mcpIdentityFromEnv } from "@intehrgrator/agent/mcp_stdio.ts";

const repo = join(import.meta.dirname!, "..");
const SET = "Simple-vitals-unmapped";
const BP = "/content[openEHR-EHR-SECTION.adhoc.v1]/items[openEHR-EHR-OBSERVATION.blood_pressure.v2]";
const SYSTOLIC = `${BP}/data/at0001/events/at0006/data/at0003/items/at0004/value/value/value`;
const POSITION = `${BP}/data/at0001/events/at0006/state/at0007/items/at0008/value/DV_CODED_TEXT/value`;

function serveRepo() {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    (req) => serveDir(req, { fsRoot: repo, quiet: true }),
  );
  return { server, base: `http://127.0.0.1:${server.addr.port}` };
}

async function loadedVitals(): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: SET, includeMapping: false });
  return service;
}

Deno.test("load_example_set and list_example_sets read a catalogUrl over HTTP (#311)", async () => {
  const { server, base } = serveRepo();
  try {
    const catalogUrl = `${base}/examples/example-sets.json`;
    const listed = await callAgentTool(new WorkbenchService(), "list_example_sets", { catalogUrl }) as {
      sets: Array<{ id: string; mapped: boolean }>;
    };
    assertEquals(listed.sets.find((s) => s.id === SET)?.mapped, false);
    assertEquals(listed.sets.find((s) => s.id === "Simple-vitals")?.mapped, true);

    const service = new WorkbenchService();
    const loaded = await callAgentTool(service, "load_example_set", { setId: SET, catalogUrl, includeMapping: false }) as {
      setId: string;
      catalogUrl: string;
      snapshot: { templateId: string };
    };
    assertEquals(loaded.setId, SET);
    assertEquals(loaded.catalogUrl, catalogUrl);
    assertEquals(loaded.snapshot.templateId, "simple-diagnose-and-vitals");
  } finally {
    await server.shutdown();
  }
});

Deno.test("list_function_library and load_function read a catalogUrl over HTTP (#311)", async () => {
  const { server, base } = serveRepo();
  try {
    const catalogUrl = `${base}/function-library/catalog.json`;
    const lib = await callAgentTool(new WorkbenchService(), "list_function_library", { catalogUrl }) as {
      functions: Array<{ id: string }>;
    };
    assert(lib.functions.length > 0);
    const service = await loadedVitals();
    const loaded = await callAgentTool(service, "load_function", { functionId: lib.functions[0]!.id, catalogUrl }) as {
      name: string;
    };
    assert(loaded.name);
  } finally {
    await server.shutdown();
  }
});

Deno.test("Example Sets are discoverable without a catalog argument (#313)", async () => {
  assert(defaultExampleSetCatalogUrl().startsWith("file:"), defaultExampleSetCatalogUrl());
  const names = AGENT_TOOLS.map((t) => t.name);
  assert(names.includes("list_example_sets"));
  const listed = await callAgentTool(new WorkbenchService(), "list_example_sets", {}) as { sets: Array<{ id: string }> };
  assert(listed.sets.some((s) => s.id === SET));
  const service = await loadedVitals();
  assertEquals(service.getSnapshot().templateId, "simple-diagnose-and-vitals");
});

Deno.test("get_snapshot counts scaffold Default points apart from mappings (#312)", async () => {
  const service = await loadedVitals();
  const before = service.getSnapshot();
  assert(before.defaultedSlots > 0);
  assertEquals(before.appliedSlots, before.mappedSlots + before.defaultedSlots);
  // Category is a scaffolded term_pick, not a mapping (#320).
  assertEquals(before.mappedSlots, 0);
  await callAgentTool(service, "map_slot", { slotId: SYSTOLIC, path: "$.systolic" });
  assertEquals(service.getSnapshot().mappedSlots, before.mappedSlots + 1);
});

Deno.test("root slot-tree rows join to /context/…, and the old //context/… form still resolves (#312)", async () => {
  const service = await loadedVitals();
  const tree = await callAgentTool(service, "list_slots", {}) as {
    groups: Array<{ group: string; slots: Array<{ id: string }> }>;
  };
  const ids = tree.groups.flatMap((g) => g.slots.map((r) => g.group + r.id));
  assert(ids.includes("/context/EVENT_CONTEXT/start_time/value"), ids.slice(0, 5).join(" "));
  assertEquals(ids.filter((id) => id.startsWith("//")), []);
  const full = "simple-diagnose-and-vitals//context/EVENT_CONTEXT/start_time/value";
  assertEquals(service.resolveSlotRef("/context/EVENT_CONTEXT/start_time/value"), full);
  assertEquals(service.resolveSlotRef("//context/EVENT_CONTEXT/start_time/value"), full);
  assertEquals(service.resolveSlotRef("context/EVENT_CONTEXT/start_time/value"), full);
});

Deno.test("map_slot sets a constant with value, and warns on a coded slot mapped from a path (#313)", async () => {
  const service = await loadedVitals();
  const setting = await callAgentTool(service, "map_slot", {
    slotId: "/context/EVENT_CONTEXT/setting/value",
    value: "home",
  }) as { mapped: boolean; value: string };
  assertEquals(setting.value, "home");
  const row = service.listSlots().find((r) => r.slotId.endsWith("//context/EVENT_CONTEXT/setting/value"));
  // A coded constant carries its code: "home" is openEHR setting 225.
  assertStringIncludes(row?.expression ?? "", '"225"');
  assertStringIncludes(row?.expression ?? "", '"home"');

  const position = await callAgentTool(service, "map_slot", { slotId: POSITION, path: "$.bodyPosition" }) as {
    warning?: string;
  };
  assertStringIncludes(position.warning ?? "", "Decision table");
  assertStringIncludes(position.warning ?? "", "at1001");
});

Deno.test("run_test returns valid, false when Output validation fails (#312)", async () => {
  const service = await loadedVitals();
  const result = await callAgentTool(service, "run_test", { outputMode: "preview" }) as {
    valid: boolean;
    testResult: { ok: boolean; outputValidation?: { valid: boolean } };
  };
  // Nothing mapped yet: the conversion runs, the composition is not valid.
  assertEquals(result.testResult.ok, true);
  assertEquals(result.testResult.outputValidation?.valid, false);
  assertEquals(result.valid, false);
});

Deno.test("export_bundle with path returns only the path and size (#312)", async () => {
  const service = await loadedVitals();
  const dir = await Deno.makeTempDir();
  try {
    const zip = await callAgentTool(service, "export_bundle", { format: "zip", path: join(dir, "a.intehrgrator") }) as
      Record<string, unknown>;
    assertEquals(Object.keys(zip).sort(), ["bytes", "format", "path", "revision"]);
    assertEquals(zip.bytes, (await Deno.stat(join(dir, "a.intehrgrator"))).size);
    const json = await callAgentTool(service, "export_bundle", { format: "json", path: join(dir, "a.json") }) as
      Record<string, unknown>;
    assertEquals("bundle" in json, false);
    const inline = await callAgentTool(service, "export_bundle", { format: "zip" }) as Record<string, unknown>;
    assertEquals(typeof inline.bytesBase64, "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("INTEHR_AGENT_ID keeps one agent across MCP processes (#312)", async () => {
  const env: Record<string, string> = { INTEHR_AGENT_ID: "box-tester", INTEHR_AGENT_NAME: "Box tester" };
  const identity = mcpIdentityFromEnv((k) => env[k]);
  assertEquals(identity, { agentId: "box-tester", displayName: "Box tester" });
  assertEquals(mcpIdentityFromEnv(() => undefined), undefined);

  const service = await loadedVitals();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, createAgentApiHandler(service, {}));
  const base = `http://127.0.0.1:${server.addr.port}`;
  try {
    // Two MCP processes, one after the other, as a CLI or a restarted IDE chat starts them.
    const first = new HttpAgentClient(base, undefined, identity);
    first.setClientName("box-cli");
    await first.callTool("map_slot", { slotId: SYSTOLIC, path: "$.systolic" });
    const second = new HttpAgentClient(base, undefined, identity);
    second.setClientName("box-cli");
    await second.callTool("map_slot", { slotId: "/context/EVENT_CONTEXT/setting/value", value: "home" });
    const agents = service.registry.list();
    assertEquals(agents.map((a) => [a.agentId, a.displayName]), [["box-tester", "Box tester"]]);
    const actors = service.listHistory().filter((e) => e.actor.kind === "agent").map((e) => e.actor.displayName);
    assertEquals([...new Set(actors)], ["Box tester"]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("map_slot value on a coded slot writes code and text (setting, value set) or explains the form", async () => {
  const service = await loadedVitals();
  await callAgentTool(service, "map_slot", {
    slotId: "/context/EVENT_CONTEXT/setting/value",
    value: "openehr::238|other care|",
  });
  await callAgentTool(service, "map_slot", { slotId: POSITION, value: "Sitting" });
  for (const outputMode of ["preview", "typescript"]) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      testResult: { output: unknown; outputValidation?: { messages: Array<{ message: string }> } };
    };
    const out = typeof run.testResult.output === "string"
      ? JSON.parse(run.testResult.output)
      : run.testResult.output as Record<string, unknown>;
    const setting = (out.context as { setting?: { value?: string; defining_code?: { code_string?: string } } })
      .setting;
    assertEquals(setting?.value, "other care", outputMode);
    assertEquals(setting?.defining_code?.code_string, "238", outputMode);
    const text = JSON.stringify(out);
    assertStringIncludes(text, '"code_string":"at1001"');
    const messages = (run.testResult.outputValidation?.messages ?? []).map((m) => m.message).join("\n");
    assert(!messages.includes("setting"), messages);
  }
  let error = "";
  try {
    await callAgentTool(service, "map_slot", { slotId: "/context/EVENT_CONTEXT/setting/value", value: "somewhere" });
  } catch (e) {
    error = String(e);
  }
  assertStringIncludes(error, "terminology::code|text|");
});

Deno.test("import_suggestions minimal envelope from the tool description has no schema issues", async () => {
  const service = await loadedVitals();
  const result = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      suggestions: [{ slotId: SYSTOLIC, block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } } }],
    }),
  }) as { report: { applied: number; schemaIssues: unknown[] } };
  assertEquals(result.report.applied, 1);
  assertEquals(result.report.schemaIssues, []);
});
