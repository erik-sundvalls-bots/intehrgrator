/**
 * Desktop / headless MCP retest after #315 (#316–#320).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { serveDir } from "@std/http/file-server";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { createAgentApiHandler } from "@intehrgrator/agent/http.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { mcpInstructions } from "@intehrgrator/agent/mcp_stdio.ts";

const repo = join(import.meta.dirname!, "..");
const BP = "/content[openEHR-EHR-SECTION.adhoc.v1]/items[openEHR-EHR-OBSERVATION.blood_pressure.v2]";
const SYSTOLIC = `${BP}/data/at0001/events/at0006/data/at0003/items/at0004/value/value/value`;
const SETTING = "/context/EVENT_CONTEXT/setting/value";

function findNode(value: unknown, archetypeNodeId: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNode(item, archetypeNodeId);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.archetype_node_id === archetypeNodeId) return record;
  for (const child of Object.values(record)) {
    const found = findNode(child, archetypeNodeId);
    if (found) return found;
  }
  return undefined;
}

function asRecord(output: unknown): Record<string, unknown> {
  const value = typeof output === "string" ? JSON.parse(output) : output;
  return value as Record<string, unknown>;
}

Deno.test("get_history is compact unless bundles are requested (#316)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-unmapped", includeMapping: false });
  await callAgentTool(service, "map_slot", { slotId: SYSTOLIC, path: "$.systolic" });
  await callAgentTool(service, "map_slot", { slotId: SETTING, value: "home" });
  const listed = await callAgentTool(service, "get_history", {}) as {
    entries: Array<Record<string, unknown>>;
  };
  assert(listed.entries.length >= 3);
  const text = JSON.stringify(listed);
  assert(text.length < 20_000, `history JSON is ${text.length} bytes`);
  assertEquals("beforeBundle" in listed.entries[0]!, false);
  assertEquals("afterBundle" in listed.entries[0]!, false);
  for (const key of ["seq", "revisionAfter", "actor", "kind", "summary", "affectedSlotIds", "timestamp"]) {
    assert(key in listed.entries[0]!, key);
  }
  const full = await callAgentTool(service, "get_history", { includeBundles: true }) as {
    entries: Array<{ beforeBundle?: unknown; afterBundle?: unknown }>;
  };
  assert(full.entries[0]?.beforeBundle);
  assert(full.entries[0]?.afterBundle);
  const one = await callAgentTool(service, "get_history", { seq: listed.entries.at(-1)!.seq }) as {
    entries: Array<{ seq: number; afterBundle?: unknown }>;
  };
  assertEquals(one.entries.length, 1);
  assert(one.entries[0]?.afterBundle);
  const page = await callAgentTool(service, "get_history", { sinceSeq: 1, limit: 1 }) as {
    entries: Array<{ seq: number }>;
  };
  assertEquals(page.entries.map((entry) => entry.seq), [2]);
});

Deno.test("a header-less request during load_example_set does not attribute the load to You (#317)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sawCatalog = false;
  const files = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    if (new URL(req.url).pathname.endsWith("/examples/example-sets.json")) {
      sawCatalog = true;
      await gate;
    }
    return await serveDir(req, { fsRoot: repo, quiet: true });
  });
  const service = new WorkbenchService();
  const api = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, createAgentApiHandler(service, {}));
  const base = `http://127.0.0.1:${api.addr.port}`;
  const catalogUrl = `http://127.0.0.1:${files.addr.port}/examples/example-sets.json`;
  const headers = {
    "content-type": "application/json",
    "X-Agent-Id": "retest-agent",
    "X-Agent-Name": "Retest agent",
  };
  try {
    const reg = await fetch(`${base}/api/v1/register-agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentId: "retest-agent", displayName: "Retest agent" }),
    });
    assertEquals(reg.status, 200);
    const loading = fetch(`${base}/api/v1/load-example-set`, {
      method: "POST",
      headers,
      body: JSON.stringify({ setId: "Simple-vitals-unmapped", includeMapping: false, catalogUrl }),
    });
    const started = Date.now();
    while (!sawCatalog) {
      if (Date.now() - started > 15000) throw new Error("catalog was not requested");
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const interloper = await fetch(`${base}/api/v1/snapshot`);
    assertEquals(interloper.status, 200);
    await interloper.body?.cancel();
    release();
    const loaded = await loading;
    assertEquals(loaded.status, 200, await loaded.text());
    const history = await callAgentTool(service, "get_history", {}) as {
      entries: Array<{ summary: string; actor: { id: string; displayName: string } }>;
    };
    const entry = history.entries.find((row) => row.summary.includes("Simple-vitals-unmapped"));
    assert(entry, history.entries.map((row) => row.summary).join(" | "));
    assertEquals(entry.actor.id, "retest-agent");
    assertEquals(entry.actor.displayName, "Retest agent");
  } finally {
    release();
    await api.shutdown();
    await files.shutdown();
  }
});

Deno.test("map_slot history names the constant and uses the list_slots id (#318)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-unmapped", includeMapping: false });
  await callAgentTool(service, "map_slot", { slotId: SYSTOLIC, path: "$.pulse" });
  await callAgentTool(service, "map_slot", { slotId: SETTING, value: "home" });
  const history = await callAgentTool(service, "get_history", {}) as {
    entries: Array<{ kind: string; summary: string }>;
  };
  const mapped = history.entries.find((entry) => entry.summary.startsWith("Map "));
  const set = history.entries.find((entry) => entry.summary.startsWith("Set "));
  assert(mapped, history.entries.map((entry) => entry.summary).join(" | "));
  assertEquals(mapped.kind, "map_slot");
  assertStringIncludes(mapped.summary, "/content[openEHR-EHR-SECTION.adhoc.v1]/");
  assertEquals(mapped.summary.includes("//"), false, mapped.summary);
  assert(set);
  assertEquals(set.kind, "map_slot");
  assertEquals(set.summary, "Set /context/EVENT_CONTEXT/setting/value = home");
});

Deno.test("FLAT preview and TypeScript validate the document they emit (#319)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals", includeMapping: true });
  await callAgentTool(service, "set_instance_encoding", { encoding: "flat-json" });
  const listed = await callAgentTool(service, "list_examples", {}) as {
    examples: Array<{ id: string; filename?: string }>;
  };
  const example = listed.examples.find((row) => row.filename === "bp-inst.json");
  assert(example);
  await callAgentTool(service, "set_active_example", { id: example.id });
  const runs: Record<string, { valid: boolean; messages: string[]; keys: string[] }> = {};
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      valid: boolean;
      testResult: { output: unknown; outputValidation?: { messages: Array<{ message: string }> } };
    };
    const output = asRecord(run.testResult.output);
    runs[outputMode] = {
      valid: run.valid,
      messages: (run.testResult.outputValidation?.messages ?? []).map((message) => message.message).sort(),
      keys: Object.keys(output).sort(),
    };
  }
  assertEquals(runs.typescript!.keys, runs.preview!.keys);
  assertEquals(runs.typescript!.keys.length, 16);
  assertEquals(runs.preview!.valid, runs.typescript!.valid);
  assertEquals(runs.preview!.valid, false);
  assertEquals(runs.preview!.messages, runs.typescript!.messages);
  const joined = runs.preview!.messages.join("\n");
  assertStringIncludes(joined, "LOCATABLE.name is required by RM specification");
  assertStringIncludes(joined, "ENTRY.subject is required by RM specification");
  assertStringIncludes(joined, "EVENT_CONTEXT.setting is required by RM specification");
});

Deno.test("unmapped coded pickers, script path, setting codes, flying, and mappedSlots (#320)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", { setId: "Simple-vitals-unmapped", includeMapping: false });
  assertEquals(service.getSnapshot().mappedSlots, 0);
  assert(service.getSnapshot().defaultedSlots > 0);

  const tree = await callAgentTool(service, "list_slots", {}) as {
    groups: Array<{ group: string; slots: Array<{ id: string; values?: Array<{ code: string; text?: string }> }> }>;
  };
  const setting = tree.groups.flatMap((group) => group.slots.map((row) => ({ id: group.group + row.id, values: row.values })))
    .find((row) => row.id === SETTING);
  assert(setting?.values?.some((value) => value.code === "225" && value.text === "home"));
  assert(setting?.values?.some((value) => value.code === "227"));

  await callAgentTool(service, "map_slot", { slotId: SETTING, value: "home" });
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as { testResult: { output: unknown } };
    const text = JSON.stringify(run.testResult.output);
    assertEquals(text.includes("Standing"), false, outputMode);
    assertEquals(text.includes("blood_pressure"), false, outputMode);
    assertStringIncludes(text, "home");
  }

  const dir = await Deno.makeTempDir();
  try {
    const written = await callAgentTool(service, "generate_script", {
      language: "typescript",
      path: join(dir, "convert.ts"),
    }) as Record<string, unknown>;
    assertEquals(Object.keys(written).sort(), ["bytes", "language", "path"]);
    assertEquals(written.language, "typescript");
    assertEquals(written.bytes, (await Deno.stat(join(dir, "convert.ts"))).size);
    assertEquals("code" in written, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }

  const mapped = new WorkbenchService();
  await callAgentTool(mapped, "load_example_set", { setId: "Simple-vitals", includeMapping: true });
  const examples = await callAgentTool(mapped, "list_examples", {}) as {
    examples: Array<{ id: string; filename?: string }>;
  };
  const invalid = examples.examples.find((row) => row.filename === "bp-inst-3-invalid.json");
  assert(invalid);
  await callAgentTool(mapped, "set_active_example", { id: invalid.id });
  const positions: unknown[] = [];
  const codeMessages: string[][] = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(mapped, "run_test", { outputMode }) as {
      testResult: {
        output: unknown;
        outputValidation?: { messages: Array<{ message: string }> };
      };
    };
    const messages = (run.testResult.outputValidation?.messages ?? []).map((message) => message.message);
    assert(
      messages.some((message) => message.startsWith("value 'flying' is not in the value set:")),
      messages.join("\n"),
    );
    assert(messages.some((message) => message.includes("at1000")), messages.join("\n"));
    positions.push(findNode(asRecord(run.testResult.output), "at0008")?.value);
    codeMessages.push(messages.filter((message) => /defining_code|code_string/.test(message)).sort());
  }
  assertEquals(positions[0], { _type: "DV_CODED_TEXT", value: "" });
  assertEquals(positions[1], positions[0]);
  assertEquals(codeMessages[0], codeMessages[1]);

  assertStringIncludes(mcpInstructions(), "blob/main/docs/AGENT_WORKFLOW.md");
  assertStringIncludes(mcpInstructions(), "v0.11/docs/AGENT_WORKFLOW.md");
});
