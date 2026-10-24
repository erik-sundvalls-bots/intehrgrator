import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { LocalAgentClient } from "@intehrgrator/agent/mcp_stdio.ts";

const fixtures = join(import.meta.dirname!, "fixtures");

Deno.test("committed AI-created dummy JSON mapping re-imports and Test Run passes", async () => {
  const dir = join(fixtures, "dummy-json-vitals");
  const service = new WorkbenchService();
  const client = new LocalAgentClient(service);
  await client.registerAgent({ displayName: "AI fixture replay" });
  await client.callTool("load_target", {
    filename: "target.schema.json",
    content: await Deno.readTextFile(join(dir, "target.schema.json")),
  });
  await client.callTool("add_example", {
    filename: "instance-1.json",
    content: await Deno.readTextFile(join(dir, "instance-1.json")),
  });
  const text = await Deno.readTextFile(
    join(dir, "mapping", "ai-created-json-schema.intehrgrator-suggestions.json"),
  );
  const imported = await client.callTool("import_suggestions", { text }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.applied, 3, imported.report.errors.join("; "));
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
});

Deno.test("committed AI-created SBP Decision table mapping Test Run yields band=normal", async () => {
  const dir = join(fixtures, "dummy-json-vitals");
  const mappingDir = join(dir, "mapping");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.callTool("load_target", {
    path: join(mappingDir, "ai-created-sbp-band.target.schema.json"),
  });
  await client.callTool("add_example", { path: join(dir, "instance-1.json") });
  const sheet = JSON.parse(await Deno.readTextFile(join(mappingDir, "ai-created-sbp-band.decision-table.json")));
  await client.callTool("replace_sheets", { sheets: [sheet] });
  const text = await Deno.readTextFile(join(mappingDir, "ai-created-sbp-band.intehrgrator-suggestions.json"));
  const imported = await client.callTool("import_suggestions", { text }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.applied, 4, imported.report.errors.join("; "));
  const tested = await client.callTool("run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: Record<string, unknown> };
  };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
  assertEquals(tested.testResult.output?.band, "normal");
});

Deno.test("committed AI-created openEHR BP mapping re-imports and Test Run passes", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    filename: "blood_pressure.opt",
    content: await Deno.readTextFile(join(fixtures, "blood_pressure.opt")),
  });
  await callAgentTool(service, "add_example", {
    filename: "instance-1.json",
    content: await Deno.readTextFile(join(fixtures, "dummy-json-vitals", "instance-1.json")),
  });
  const text = await Deno.readTextFile(
    join(fixtures, "dummy-json-vitals", "mapping", "ai-created-openehr-blood-pressure.intehrgrator-suggestions.json"),
  );
  const imported = await callAgentTool(service, "import_suggestions", { text }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.applied, 2, imported.report.errors.join("; "));
  const tested = await callAgentTool(service, "run_test", {}) as { testResult: { ok: boolean; error?: string } };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
});

Deno.test("committed AI-created ICD-10 Sheet lookup Test Run yields SNOMED 38341003", async () => {
  const mappingDir = join(fixtures, "sheets", "mapping");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.callTool("load_target", {
    path: join(mappingDir, "ai-created-icd10-snomed.target.schema.json"),
  });
  await client.callTool("add_example", {
    path: join(mappingDir, "ai-created-icd10-snomed.source.json"),
  });
  const sheet = JSON.parse(await Deno.readTextFile(join(mappingDir, "ai-created-icd10-snomed.sheet.json")));
  await client.callTool("replace_sheets", { sheets: [sheet] });
  const text = await Deno.readTextFile(join(mappingDir, "ai-created-icd10-snomed.intehrgrator-suggestions.json"));
  const imported = await client.callTool("import_suggestions", { text }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.applied, 1, imported.report.errors.join("; "));
  const tested = await client.callTool("run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: Record<string, unknown> };
  };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
  assertEquals(tested.testResult.output?.snomed, "38341003");
});

Deno.test("committed AI-created legacy-simulated-json identity mapping Test Run passes", async () => {
  const dir = join(fixtures, "legacy-simulated-json");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.callTool("load_target", { path: join(dir, "bp-schema.json") });
  await client.callTool("add_example", { path: join(dir, "instances", "bp-inst.json") });
  const text = await Deno.readTextFile(
    join(dir, "mapping", "ai-created-blood-pressure.intehrgrator-suggestions.json"),
  );
  const imported = await client.callTool("import_suggestions", { text }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.applied, 6, imported.report.errors.join("; "));
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
});

Deno.test("committed AI-created BP series mapping with source loop Test Run passes", async () => {
  const dir = join(fixtures, "legacy-simulated-json");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.callTool("load_target", { path: join(dir, "bp-series-schema.json") });
  await client.callTool("add_example", { path: join(dir, "instances-series", "bp-series-inst.json") });
  const text = await Deno.readTextFile(
    join(dir, "mapping", "ai-created-bp-series.intehrgrator-suggestions.json"),
  );
  const imported = await client.callTool("import_suggestions", { text }) as {
    report: { applied: number; errors: string[]; loopsAccepted?: number };
  };
  assertEquals(imported.report.applied >= 2, true, imported.report.errors.join("; "));
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
});

Deno.test("node-by-node map_slot maps dummy JSON vitals and Test Run passes", async () => {
  const dir = join(fixtures, "dummy-json-vitals");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.registerAgent({ displayName: "node-by-node mapper" });
  await client.callTool("load_target", { path: join(dir, "target.schema.json") });
  await client.callTool("add_example", { path: join(dir, "instance-1.json") });
  const listed = await client.callTool("list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string }>;
  };
  const systolic = listed.slots.find((s) => s.slotId.endsWith("$.systolic"))?.slotId;
  const diastolic = listed.slots.find((s) => s.slotId.endsWith("$.diastolic"))?.slotId;
  const unit = listed.slots.find((s) => s.slotId.endsWith("$.unit"))?.slotId;
  if (!systolic || !diastolic || !unit) {
    throw new Error(`missing slots: ${listed.slots.map((s) => s.slotId).join(", ")}`);
  }
  await client.callTool("map_slot", { slotId: systolic, path: "$.systolic", format: "json" });
  await client.callTool("map_slot", { slotId: diastolic, path: "$.diastolic", format: "json" });
  await client.callTool("map_slot", { slotId: unit, path: "$.unit", format: "json" });
  const tested = await client.callTool("run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: Record<string, unknown> };
  };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
  assertEquals(tested.testResult.output?.systolic, 120);
  assertEquals(tested.testResult.output?.diastolic, 80);
});
