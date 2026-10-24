import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { createAgentApiHandler } from "@intehrgrator/agent/http.ts";
import { AGENT_TOOLS, AGENT_TOOL_HTTP, callAgentTool } from "@intehrgrator/agent/tools.ts";
import { handleMcpRequest, LocalAgentClient } from "@intehrgrator/agent/mcp_stdio.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { addCatchAllRow, emptyDecisionTable } from "@intehrgrator/core/sheets/decision_table.ts";

const fixtures = join(import.meta.dirname!, "fixtures");

Deno.test("AGENT_TOOLS and HTTP routes stay 1:1", () => {
  const toolNames = AGENT_TOOLS.map((t) => t.name).sort();
  const httpNames = Object.keys(AGENT_TOOL_HTTP).sort();
  assertEquals(toolNames, httpNames);
});

Deno.test("headless MCP tools: load JSON target → import → run_test → generate_script → export", async () => {
  const service = new WorkbenchService();
  const target = await Deno.readTextFile(join(fixtures, "dummy-json-vitals", "target.schema.json"));
  const schema = await Deno.readTextFile(join(fixtures, "dummy-json-vitals", "source.schema.json"));
  const example = await Deno.readTextFile(join(fixtures, "dummy-json-vitals", "instance-1.json"));

  await callAgentTool(service, "load_target", {
    filename: "target.schema.json",
    content: target,
  });
  await callAgentTool(service, "load_source_schema", {
    filename: "source.schema.json",
    content: schema,
  });
  await callAgentTool(service, "add_example", {
    filename: "instance-1.json",
    content: example,
  });

  const slots = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; mapped: boolean }>;
  };
  const systolic = slots.slots.find((s) => s.slotId.includes("systolic"))?.slotId;
  const diastolic = slots.slots.find((s) => s.slotId.includes("diastolic"))?.slotId;
  const unit = slots.slots.find((s) => s.slotId.includes("unit"))?.slotId;
  if (!systolic || !diastolic || !unit) throw new Error(`missing slots: ${slots.slots.map((s) => s.slotId)}`);

  const snap = await callAgentTool(service, "get_snapshot", {}) as {
    revision: string;
    templateId: string;
  };
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    suggestions: [
      { slotId: systolic, block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } } },
      { slotId: diastolic, block: { type: "source_query_number", fields: { EXPRESSION: "$.diastolic" } } },
      { slotId: unit, block: { type: "source_query", fields: { EXPRESSION: "$.unit" } } },
    ],
  };
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 3, imported.report.errors.join("; "));

  const tested = await callAgentTool(service, "run_test", {}) as {
    testResult: { ok: boolean; output?: unknown; error?: string };
  };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));

  const script = await callAgentTool(service, "generate_script", { language: "typescript" }) as {
    code: string;
    language: string;
  };
  assertEquals(script.language, "typescript");
  assertStringIncludes(script.code, "systolic");

  const exported = await callAgentTool(service, "export_bundle", { format: "json" }) as {
    bundle: { target?: { targetId?: string } };
  };
  assertEquals(exported.bundle.target?.targetId, snap.templateId);
});

Deno.test("Agent HTTP load-target, list_slots, lease 409, auth", async () => {
  const service = new WorkbenchService();
  const handler = createAgentApiHandler(service);
  const opt = await Deno.readTextFile(join(fixtures, "blood_pressure.opt"));
  const load = await handler(new Request("http://local/api/v1/load-target", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: "blood_pressure.opt", content: opt }),
  }));
  assertEquals(load.status, 200);

  const slotsRes = await handler(new Request("http://local/api/v1/slots?view=rows"));
  assertEquals(slotsRes.status, 200);
  const slotsBody = await slotsRes.json() as { slots: Array<{ slotId: string }> };
  const slotId = slotsBody.slots.find((s) => s.slotId.endsWith("items/at0004/value/value/value"))?.slotId;
  if (!slotId) throw new Error("missing systolic slot");

  await handler(new Request("http://local/api/v1/register-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "agent-a", displayName: "A" }),
  }));
  await handler(new Request("http://local/api/v1/register-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "agent-b", displayName: "B" }),
  }));

  const leased = await handler(new Request("http://local/api/v1/lease-slot", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Agent-Id": "agent-a", "X-Agent-Name": "A" },
    body: JSON.stringify({ slotId, ttlSec: 60 }),
  }));
  assertEquals(leased.status, 200);

  const blocked = await handler(new Request("http://local/api/v1/map-slot", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Agent-Id": "agent-b", "X-Agent-Name": "B" },
    body: JSON.stringify({ slotId, path: "$.systolic" }),
  }));
  assertEquals(blocked.status, 409);

  const locked = createAgentApiHandler(new WorkbenchService(), { token: "s3cret" });
  const denied = await locked(new Request("http://local/api/v1/snapshot"));
  assertEquals(denied.status, 401);
  const health = await locked(new Request("http://local/api/v1/health"));
  assertEquals(health.status, 200);
  const ok = await locked(new Request("http://local/api/v1/snapshot", {
    headers: { authorization: "Bearer s3cret" },
  }));
  assertEquals(ok.status, 200);
});

Deno.test("MCP stdio tools/list writes the full JSON-RPC body", async () => {
  const reqBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const req = new TextEncoder().encode(`Content-Length: ${reqBody.length}\r\n\r\n${reqBody}`);
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--no-check", "src/agent/mcp_stdio.ts"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { ...Deno.env.toObject(), INTEHR_AGENT_URL: "" },
    cwd: join(import.meta.dirname!, ".."),
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(req);
  await writer.close();
  const out = await child.output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
  const text = new TextDecoder().decode(out.stdout);
  const split = text.indexOf("\r\n\r\n");
  assertEquals(split >= 0, true, text.slice(0, 80));
  const payload = text.slice(split + 4);
  const msg = JSON.parse(payload) as { result: { tools: Array<{ name: string }> } };
  const names = msg.result.tools.map((t) => t.name);
  assertEquals(names.includes("load_example_set"), true);
  assertEquals(names.includes("list_function_library"), true);
  assertEquals(names.includes("load_function"), true);
  assertEquals(names.includes("lease_slot"), true);
  assertEquals(names.length, AGENT_TOOLS.length);
});

Deno.test("MCP tools/list and tools/call load_target via LocalAgentClient", async () => {
  const service = new WorkbenchService();
  const client = new LocalAgentClient(service);
  const listed = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, client) as {
    tools: Array<{ name: string }>;
  };
  assertEquals(listed.tools.some((t) => t.name === "load_target"), true);
  assertEquals(listed.tools.some((t) => t.name === "lease_slot"), true);
  assertEquals(listed.tools.some((t) => t.name === "export_bundle"), true);

  const target = await Deno.readTextFile(join(fixtures, "dummy-json-vitals", "target.schema.json"));
  const called = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "load_target",
      arguments: { filename: "target.schema.json", content: target },
    },
  }, client) as { content: Array<{ text: string }> };
  const payload = JSON.parse(called.content[0]!.text) as { snapshot: { templateId: string } };
  assertEquals(Boolean(payload.snapshot.templateId), true);
});

Deno.test("loadBundleFile accepts JSON Project Bundle as well as zip", async () => {
  const dir = join(import.meta.dirname!, "fixtures", "dummy-json-vitals");
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    filename: "target.schema.json",
    content: await Deno.readTextFile(join(dir, "target.schema.json")),
  });
  const json = JSON.stringify(service.exportBundle());
  const other = new WorkbenchService();
  other.loadBundleFile(new TextEncoder().encode(json));
  assertEquals(other.getSnapshot().templateId, service.getSnapshot().templateId);
});

Deno.test("load_bundle accepts unwrapped Project Bundle JSON on HTTP PUT", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "dummy-json-vitals", "target.schema.json"),
  });
  const bundle = service.exportBundle();
  const other = new WorkbenchService();
  const handler = createAgentApiHandler(other);
  const res = await handler(new Request("http://local/api/v1/bundle", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle),
  }));
  assertEquals(res.status, 200);
  assertEquals(other.getSnapshot().templateId, service.getSnapshot().templateId);
});

Deno.test("build_prompt includes Optional RM catalog for an OPT", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "blood_pressure.opt"),
  });
  const built = await callAgentTool(service, "build_prompt", { delivery: "attach" }) as { prompt: string };
  assertEquals(built.prompt.includes("## Optional RM Insertion"), true);
  assertEquals(built.prompt.includes("optional_rm_add"), true);
});

Deno.test("load_bundle accepts zip bytesBase64", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "dummy-json-vitals", "target.schema.json"),
  });
  const exported = await callAgentTool(service, "export_bundle", { format: "zip" }) as {
    bytesBase64: string;
  };
  const other = new WorkbenchService();
  await callAgentTool(other, "load_bundle", { bytesBase64: exported.bytesBase64 });
  assertEquals(other.getSnapshot().templateId, service.getSnapshot().templateId);
});

Deno.test("load_example_set from local catalogPath hydrates dummy-json-vitals", async () => {
  const service = new WorkbenchService();
  const loaded = await callAgentTool(service, "load_example_set", {
    catalogPath: join(import.meta.dirname!, "..", "examples", "example-sets.json"),
    setId: "dummy-json-vitals",
    includeMapping: false,
  }) as { setId: string; snapshot: { templateId: string; exampleCount: number } };
  assertEquals(loaded.setId, "dummy-json-vitals");
  assertEquals(Boolean(loaded.snapshot.templateId), true);
  assertEquals(loaded.snapshot.exampleCount >= 1, true);
});

Deno.test("load_example_set adopts a mapped catalog set (appliedSlots > 0)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", {
    catalogPath: join(import.meta.dirname!, "..", "examples", "example-sets.json"),
    setId: "dummy-json-vitals-mapped",
    includeMapping: true,
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { appliedSlots: number };
  assertEquals(snap.appliedSlots > 0, true, `appliedSlots=${snap.appliedSlots}`);
});

Deno.test("list_optional_rm catalog includes container RM attachments", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "blood_pressure.opt"),
  });
  const listed = await callAgentTool(service, "list_optional_rm", {}) as {
    catalog: Array<{ parentSlotId: string; attachments: Array<{ attributeName: string; rmType: string }> }>;
  };
  assertEquals(listed.catalog.length >= 1, true, "expected Optional RM catalog on OPT containers");
  const first = listed.catalog[0]!;
  const attr = first.attachments[0]!;
  await callAgentTool(service, "optional_rm_add", {
    parentSlotId: first.parentSlotId,
    rmType: attr.rmType,
    attributeName: attr.attributeName,
  });
  const after = await callAgentTool(service, "list_optional_rm", {
    parentSlotId: first.parentSlotId,
  }) as { attachments: Array<{ attributeName: string }> };
  assertEquals(after.attachments.some((row) => row.attributeName === attr.attributeName), false);
});

Deno.test("import_suggestions skips foreign-leased slots", async () => {
  const service = new WorkbenchService();
  const opt = await Deno.readTextFile(join(fixtures, "blood_pressure.opt"));
  service.loadTemplateContent("blood_pressure.opt", opt);
  const slotId = collectValueSlots(service.exportBundle().target?.skeleton ?? []).find((s) =>
    s.slotId.endsWith("items/at0004/value/value/value")
  )?.slotId;
  if (!slotId) throw new Error("missing slot");
  const targetId = service.exportBundle().target?.targetId ?? "";

  const a = service.registerAgent({ agentId: "a", displayName: "A" });
  service.setActor({ kind: "agent", id: a.agentId, displayName: a.displayName, color: a.color });
  service.leaseSlot(slotId, 60);

  const b = service.registerAgent({ agentId: "b", displayName: "B" });
  service.setActor({ kind: "agent", id: b.agentId, displayName: b.displayName, color: b.color });
  const report = service.importSuggestions(JSON.stringify({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId },
    suggestions: [{
      slotId,
      block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
    }],
  }));
  assertEquals(report.applied, 0);
  assertEquals(report.skipped >= 1, true);
  assertEquals(report.errors.some((e) => e.includes("leased")), true);
});

Deno.test("list_constraint_warnings reports unmapped mandatory slots on an OPT", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "blood_pressure.opt"),
  });
  const listed = await callAgentTool(service, "list_constraint_warnings", {}) as {
    warnings: Array<{ message: string; slotId?: string }>;
  };
  assertEquals(
    listed.warnings.some((w) => w.message.includes("Mandatory slot unmapped")),
    true,
    JSON.stringify(listed.warnings.slice(0, 5)),
  );

  const snap = await callAgentTool(service, "get_snapshot", {}) as {
    constraintWarningCount: number;
  };
  assertEquals(snap.constraintWarningCount >= 1, true);

  const built = await callAgentTool(service, "build_prompt", { delivery: "attach" }) as {
    prompt: string;
  };
  assertEquals(built.prompt.includes("## Constraint warnings"), true);
});

Deno.test("headless load_target scaffolds Conversion start so Instance encoding can be set", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "blood_pressure.opt"),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as {
    productStack: Array<{ type: string; encoding?: string }>;
  };
  assertEquals(
    snap.productStack.some((row) => row.type === "composition"),
    true,
    JSON.stringify(snap.productStack),
  );
  assertEquals(
    snap.productStack.some((row) => row.encoding === "canonical-json"),
    true,
    JSON.stringify(snap.productStack),
  );
  const encoded = await callAgentTool(service, "set_instance_encoding", {
    encoding: "flat-json",
  }) as { stack: Array<{ encoding?: string; type: string }> };
  assertEquals(
    encoded.stack.some((row) => row.encoding === "flat-json"),
    true,
    JSON.stringify(encoded.stack),
  );
});

Deno.test("list_slots includes attachSlotId for repeating administration ACTION", async () => {
  const service = new WorkbenchService();
  const opt = join(
    fixtures,
    "administrerad-medicinsk-onkologisk-behandling",
    "target-schema",
    "AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt",
  );
  await callAgentTool(service, "load_target", { path: opt });
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{
      slotId: string;
      attachSlotId?: string;
      pathLabel?: string;
      parentRmType?: string;
      allowedValues?: Array<{ code: string }>;
      codeFixed?: string;
    }>;
    repeatable: Array<{ slotId: string; rmType: string }>;
  };
  const dose = listed.slots.find((s) => s.slotId.endsWith("items/at0139/value/value/value"));
  if (!dose) throw new Error(`missing dose slot: ${listed.slots.map((s) => s.slotId).join(",")}`);
  assertEquals(Boolean(dose.attachSlotId), true, JSON.stringify(dose));
  assertEquals(
    dose.attachSlotId?.endsWith("//content[openEHR-EHR-ACTION.medication.v1]"),
    true,
    dose.attachSlotId,
  );
  assertEquals(dose.pathLabel?.includes("Administrerad dos"), true, dose.pathLabel);
  assertEquals(dose.parentRmType, "ACTION", JSON.stringify(dose));
  const diagnosis = listed.slots.find((s) =>
    s.slotId.includes("//content[openEHR-EHR-EVALUATION.reason_for_encounter.v1]/")
  );
  assertEquals(diagnosis?.parentRmType, "EVALUATION", diagnosis?.slotId);
  assertEquals(
    listed.repeatable.some((row) =>
      row.slotId.endsWith("//content[openEHR-EHR-ACTION.medication.v1]") && row.rmType === "ACTION"
    ),
    true,
    JSON.stringify(listed.repeatable),
  );
  assertEquals(
    listed.slots.some((s) =>
      s.slotId.includes("//content[openEHR-EHR-EVALUATION.reason_for_encounter.v1]/")
    ),
    true,
    "EVALUATION content path must use the archetype id, not at0000",
  );
  const slotIds = listed.slots.map((s) => s.slotId);
  assertEquals(slotIds.length, new Set(slotIds).size, "list_slots must not repeat slotId");
  assertEquals(
    listed.slots.some((s) => Boolean(s.codeFixed) || Boolean(s.allowedValues?.length)),
    true,
    "expected a coded slot to publish codeFixed or allowedValues",
  );
});

Deno.test("import_suggestions maps_create_with fills DV_QUANTITY magnitude and units", async () => {
  const service = new WorkbenchService();
  const opt = join(
    fixtures,
    "administrerad-medicinsk-onkologisk-behandling",
    "target-schema",
    "AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt",
  );
  await callAgentTool(service, "load_target", { path: opt });
  await callAgentTool(service, "add_example", {
    filename: "dose.json",
    content: JSON.stringify({ Dose: 140, UnitCode: "mg" }),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string }>;
  };
  const doseId = listed.slots.find((s) => s.slotId.endsWith("items/at0139/value/value/value"))?.slotId;
  if (!doseId) throw new Error("missing Administrerad dos slot");
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      suggestions: [{
        slotId: doseId,
        block: {
          type: "maps_create_with",
          extraState: { itemCount: 2 },
          fields: { KEY0: "magnitude", KEY1: "units" },
          inputs: {
            VAL0: {
              block: { type: "source_query_number", fields: { EXPRESSION: "$.Dose" } },
            },
            VAL1: {
              block: { type: "source_query", fields: { EXPRESSION: "$.UnitCode" } },
            },
          },
        },
      }],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 1, imported.report.errors.join("; "));
  const tested = await callAgentTool(service, "run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: unknown };
  };
  assertEquals(tested.testResult.ok, true, String(tested.testResult.error));
  const qty: Array<{ magnitude?: unknown; units?: unknown }> = [];
  walkDv(tested.testResult.output, (rec) => {
    if (rec._type === "DV_QUANTITY") qty.push(rec);
  });
  assertEquals(qty.some((q) => Number(q.magnitude) === 140 && q.units === "mg"), true, JSON.stringify(qty));
});

Deno.test("openEHR Test Run nests DV_CODED_TEXT defining_code and DV_IDENTIFIER.id", async () => {
  const service = new WorkbenchService();
  const opt = join(
    fixtures,
    "administrerad-medicinsk-onkologisk-behandling",
    "target-schema",
    "AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt",
  );
  await callAgentTool(service, "load_target", { path: opt });
  await callAgentTool(service, "add_example", {
    filename: "id.json",
    content: JSON.stringify({ HSA: "CCJ3" }),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string }>;
  };
  const categoryId = listed.slots.find((s) => s.slotId.includes("//category/"))?.slotId;
  const identId = listed.slots.find((s) =>
    s.slotId.includes("other_context") && s.slotId.endsWith("items/at0003/value/DV_IDENTIFIER/value") &&
    !s.slotId.includes("items/at0000/items/at0000/")
  )?.slotId;
  if (!categoryId || !identId) {
    throw new Error(`missing slots category=${categoryId} ident=${identId}`);
  }
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      suggestions: [
        {
          slotId: categoryId,
          block: { type: "text", fields: { TEXT: "event" } },
        },
        {
          slotId: identId,
          block: { type: "source_query", fields: { EXPRESSION: "$.HSA" } },
        },
      ],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 2, imported.report.errors.join("; "));
  const tested = await callAgentTool(service, "run_test", {}) as {
    testResult: { output?: Record<string, unknown> };
  };
  const category = tested.testResult.output?.category as Record<string, unknown> | undefined;
  const phrase = category?.defining_code as Record<string, unknown> | undefined;
  assertEquals(typeof phrase, "object", JSON.stringify(category));
  assertEquals(phrase?._type, "CODE_PHRASE");
  assertEquals(typeof phrase?.code_string, "string");
  const ids: Array<{ id?: unknown; value?: unknown }> = [];
  walkDv(tested.testResult.output, (rec) => {
    if (rec._type === "DV_IDENTIFIER") ids.push(rec);
  });
  assertEquals(ids.some((row) => row.id === "CCJ3" && row.value === undefined), true, JSON.stringify(ids));
});

Deno.test("for_each_list attach prefers repeating ACTION over EVALUATION", async () => {
  const service = new WorkbenchService();
  const opt = join(
    fixtures,
    "administrerad-medicinsk-onkologisk-behandling",
    "target-schema",
    "AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt",
  );
  await callAgentTool(service, "load_target", { path: opt });
  await callAgentTool(service, "add_example", {
    filename: "two.json",
    content: JSON.stringify({
      Substanser: [
        { Dose: 10, UnitCode: "mg", Innholdstoff_Navn: "A" },
        { Dose: 20, UnitCode: "mg", Innholdstoff_Navn: "B" },
      ],
    }),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; attachSlotId?: string }>;
  };
  const dose = listed.slots.find((s) => s.slotId.endsWith("items/at0139/value/value/value"));
  if (!dose?.attachSlotId) throw new Error("missing dose attachSlotId");
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      loops: [{
        attachSlotId: dose.attachSlotId,
        block: { type: "for_each_source", fields: { VAR: "substans", PATH: "$.Substanser" } },
      }],
      suggestions: [{
        slotId: dose.slotId,
        loopVar: "substans",
        block: {
          type: "maps_create_with",
          extraState: { itemCount: 2 },
          fields: { KEY0: "magnitude", KEY1: "units" },
          inputs: {
            VAL0: {
              block: { type: "source_query_number", fields: { EXPRESSION: "Dose" } },
            },
            VAL1: {
              block: { type: "source_query", fields: { EXPRESSION: "UnitCode" } },
            },
          },
        },
      }],
    }),
  }) as { report: { applied: number; errors: string[]; loopsAccepted?: number } };
  assertEquals(imported.report.applied, 1, imported.report.errors.join("; "));
  assertEquals(imported.report.loopsAccepted, 1);
  const tested = await callAgentTool(service, "run_test", {}) as {
    testResult: { output?: unknown };
  };
  const mags: number[] = [];
  walkDv(tested.testResult.output, (rec) => {
    if (rec._type === "DV_QUANTITY" && rec.magnitude != null) mags.push(Number(rec.magnitude));
  });
  assertEquals(mags.includes(10) && mags.includes(20), true, JSON.stringify(mags));
});

function walkDv(
  node: unknown,
  visit: (rec: Record<string, unknown>) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkDv(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  visit(rec);
  for (const value of Object.values(rec)) walkDv(value, visit);
}

const adminOpt = join(
  fixtures,
  "administrerad-medicinsk-onkologisk-behandling",
  "target-schema",
  "AdministreradMedicinskOnkologiskBehandlingPerSubstans.1.0.0-alpha.5.sv.en.opt",
);

Deno.test("replace_sheets bumps the Agent API revision", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "dummy-json-vitals", "target.schema.json"),
  });
  const before = await callAgentTool(service, "get_snapshot", {}) as { revision: string };
  const sheet = addCatchAllRow(emptyDecisionTable("sbp_band"));
  const replaced = await callAgentTool(service, "replace_sheets", { sheets: [sheet] }) as {
    revision: string;
  };
  assertEquals(replaced.revision !== before.revision, true, `${before.revision} → ${replaced.revision}`);
});

Deno.test("OPT load attaches a Web Template for Simplified FLAT Test Run", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { path: adminOpt });
  const wt = service.exportBundle().target?.webTemplateJson;
  assertEquals(Boolean(wt && wt.trim().startsWith("{")), true, "expected webTemplateJson on OPT load");
});

Deno.test("list_slots includes composer and scaffolded health_care_facility", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { path: adminOpt });
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; valueType: string }>;
  };
  const composer = listed.slots.find((s) => s.slotId.endsWith("//composer"));
  assertEquals(composer?.valueType, "PARTY_IDENTIFIED", JSON.stringify(composer));
  const facility = listed.slots.find((s) =>
    s.valueType === "PARTY_IDENTIFIED" && s.slotId.includes("health_care_facility")
  );
  assertEquals(Boolean(facility), true, JSON.stringify(listed.slots.map((s) => s.slotId)));
});

async function ensureOptionalRm(
  service: WorkbenchService,
  parentSuffix: string,
  attributeName: string,
  rmType: string,
): Promise<void> {
  const listedRm = await callAgentTool(service, "list_optional_rm", {}) as {
    catalog: Array<{
      parentSlotId: string;
      attachments: Array<{ attributeName: string; rmType: string }>;
    }>;
  };
  const row = listedRm.catalog.find((item) =>
    item.parentSlotId.endsWith(parentSuffix) &&
    item.attachments.some((a) => a.attributeName === attributeName)
  );
  if (!row) return;
  await callAgentTool(service, "optional_rm_add", {
    parentSlotId: row.parentSlotId,
    rmType,
    attributeName,
  });
}

Deno.test("optional_rm_add health_care_facility then map party name and identifier", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { path: adminOpt });
  await callAgentTool(service, "add_example", {
    filename: "party.json",
    content: JSON.stringify({
      SignatureUser_FullName: "TakeCare_Test",
      SignatureUser_UserName: "A1D8",
      Vardenhet_namn: "S MBA A10",
      Vardenhet_HSAID: "C4DS",
    }),
  });
  await ensureOptionalRm(
    service,
    "//context/EVENT_CONTEXT",
    "health_care_facility",
    "PARTY_IDENTIFIED",
  );
  const snap = await callAgentTool(service, "get_snapshot", {}) as { templateId: string };
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; valueType: string }>;
  };
  const composerId = listed.slots.find((s) => s.slotId.endsWith("//composer"))?.slotId;
  const facilityId = listed.slots.find((s) =>
    s.valueType === "PARTY_IDENTIFIED" && s.slotId.includes("health_care_facility")
  )?.slotId;
  if (!composerId || !facilityId) {
    throw new Error(`missing party slots composer=${composerId} facility=${facilityId}`);
  }
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId: snap.templateId },
      suggestions: [
        {
          slotId: composerId,
          block: {
            type: "maps_create_with",
            extraState: { itemCount: 3 },
            fields: { KEY0: "name", KEY1: "id", KEY2: "type" },
            inputs: {
              VAL0: {
                block: { type: "source_query", fields: { EXPRESSION: "$.SignatureUser_FullName" } },
              },
              VAL1: {
                block: { type: "source_query", fields: { EXPRESSION: "$.SignatureUser_UserName" } },
              },
              VAL2: {
                block: { type: "text", fields: { TEXT: "urn:oid:1.2.752.29.4.19" } },
              },
            },
          },
        },
        {
          slotId: facilityId,
          block: {
            type: "maps_create_with",
            extraState: { itemCount: 2 },
            fields: { KEY0: "name", KEY1: "id" },
            inputs: {
              VAL0: {
                block: { type: "source_query", fields: { EXPRESSION: "$.Vardenhet_namn" } },
              },
              VAL1: {
                block: { type: "source_query", fields: { EXPRESSION: "$.Vardenhet_HSAID" } },
              },
            },
          },
        },
      ],
    }),
  }) as { report: { applied: number; errors: string[] } };
  assertEquals(imported.report.applied, 2, imported.report.errors.join("; "));
  const tested = await callAgentTool(service, "run_test", {}) as {
    testResult: { output?: unknown; error?: string };
  };
  const names: string[] = [];
  const ids: string[] = [];
  walkDv(tested.testResult.output, (rec) => {
    if (rec._type === "PARTY_IDENTIFIED") {
      if (typeof rec.name === "string") names.push(rec.name);
      const ident = rec.identifiers;
      if (Array.isArray(ident)) {
        for (const row of ident) {
          if (row && typeof row === "object" && "id" in row) {
            ids.push(String((row as { id: unknown }).id));
          }
        }
      }
    }
  });
  assertEquals(names.includes("TakeCare_Test"), true, JSON.stringify(names));
  assertEquals(names.includes("S MBA A10"), true, JSON.stringify(names));
  assertEquals(ids.includes("A1D8") && ids.includes("C4DS"), true, JSON.stringify(ids));
});

Deno.test("list_constraint_warnings includes Decision table catch-all lint", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "dummy-json-vitals", "target.schema.json"),
  });
  const sheet = addCatchAllRow(addCatchAllRow(emptyDecisionTable("sbp_band")));
  await callAgentTool(service, "replace_sheets", { sheets: [sheet] });
  const listed = await callAgentTool(service, "list_constraint_warnings", {}) as {
    warnings: Array<{ message: string; sheetName?: string }>;
  };
  assertEquals(
    listed.warnings.some((w) => w.message.includes("catch-all")),
    true,
    JSON.stringify(listed.warnings),
  );
});

Deno.test("list_constraint_warnings reports abstract EVENT in Blockly JSON", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "put_blockly", {
    blocklyState: {
      blocks: {
        blocks: [{
          type: "rm_event",
          id: "evt-abstract",
          fields: { RM_TYPE: "EVENT" },
        }],
      },
    },
  });
  const listed = await callAgentTool(service, "list_constraint_warnings", {}) as {
    warnings: Array<{ message: string; blockId?: string }>;
  };
  assertEquals(
    listed.warnings.some((w) => w.blockId === "evt-abstract" && w.message.includes("EVENT is abstract")),
    true,
    JSON.stringify(listed.warnings),
  );
});
