/**
 * Drive the Agent API dispatcher (same as embedded MCP) to produce
 * AI-created mapping artefacts under test/fixtures/<use-case>/mapping/.
 * Persist suggestion envelopes, Sheets, Decision tables, and Conversion
 * Scripts — not full Project Bundles (replay loads the use-case target +
 * example, then imports the envelope).
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { WorkbenchService } from "../src/workbench/service.ts";
import { callAgentTool } from "../src/agent/tools.ts";
import { LocalAgentClient } from "../src/agent/mcp_stdio.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const fixtures = join(root, "test", "fixtures");

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + "\n");
}

function slotId(slots: Array<{ slotId: string }>, part: string): string {
  const suffix = `$.${part}`;
  const row = slots.find((s) =>
    s.slotId.endsWith(suffix) ||
    s.slotId.endsWith(`/${part}`) ||
    s.slotId.endsWith(`:${part}`)
  );
  if (!row) throw new Error(`missing slot ${part}: ${slots.map((s) => s.slotId).join(", ")}`);
  return row.slotId;
}

const sbpBand = {
  name: "sbp_band",
  kind: "decision-table" as const,
  headers: ["sbp", "band"],
  values: [
    ["< 90", "low"],
    ["90..139", "normal"],
    [">= 140", "high"],
  ],
  hitPolicy: "FIRST" as const,
  decisionColumns: [
    { role: "condition" as const },
    { role: "output" as const, outputKind: "value" as const, valueType: "string" as const },
  ],
};

function decisionTableBandBlock() {
  return {
    type: "decision_table",
    fields: { NAME: "sbp_band", OUTPUT: "band" },
    inputs: {
      INPUTS: {
        block: {
          type: "maps_create_with",
          extraState: { itemCount: 1 },
          fields: { KEY0: "sbp" },
          inputs: {
            VAL0: {
              block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
            },
          },
        },
      },
    },
  };
}

async function dummyJsonVitals(): Promise<void> {
  const dir = join(fixtures, "dummy-json-vitals");
  const mappingDir = join(dir, "mapping");
  const service = new WorkbenchService();
  const client = new LocalAgentClient(service);
  await client.registerAgent({ displayName: "AI fixture mapper" });

  await client.callTool("load_target", {
    filename: "target.schema.json",
    path: join(dir, "target.schema.json"),
  });
  await client.callTool("load_source_schema", {
    filename: "source.schema.json",
    path: join(dir, "source.schema.json"),
  });
  await client.callTool("add_example", {
    filename: "instance-1.json",
    path: join(dir, "instance-1.json"),
  });

  await client.callTool("replace_sheets", { sheets: [sbpBand] });

  const slots = await client.callTool("list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string }>;
  };
  const snap = await client.callTool("get_snapshot", {}) as {
    revision: string;
    templateId: string;
  };
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    suggestions: [
      {
        slotId: slotId(slots.slots, "systolic"),
        block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
        note: "AI-created: direct source path",
      },
      {
        slotId: slotId(slots.slots, "diastolic"),
        block: { type: "source_query_number", fields: { EXPRESSION: "$.diastolic" } },
      },
      {
        slotId: slotId(slots.slots, "unit"),
        block: { type: "source_query", fields: { EXPRESSION: "$.unit" } },
      },
    ],
  };
  const imported = await client.callTool("import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  if (imported.report.applied !== 3) {
    throw new Error(`json-schema import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  if (!tested.testResult.ok) throw new Error(`json-schema test: ${tested.testResult.error}`);

  const script = await client.callTool("generate_script", {
    language: "typescript",
    path: join(mappingDir, "ai-created-json-schema.ts"),
  }) as { code: string };
  await writeJson(join(mappingDir, "ai-created-json-schema.intehrgrator-suggestions.json"), envelope);
  await writeJson(join(mappingDir, "ai-created-sbp-band.decision-table.json"), sbpBand);
  if (!script.code.includes("systolic")) throw new Error("generated script missing systolic");
}

async function dummyVitalsSbpBand(): Promise<void> {
  const dir = join(fixtures, "dummy-json-vitals");
  const mappingDir = join(dir, "mapping");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.registerAgent({ displayName: "AI decision-table mapper" });
  await client.callTool("load_target", {
    path: join(mappingDir, "ai-created-sbp-band.target.schema.json"),
  });
  await client.callTool("load_source_schema", { path: join(dir, "source.schema.json") });
  await client.callTool("add_example", { path: join(dir, "instance-1.json") });
  await client.callTool("replace_sheets", { sheets: [sbpBand] });

  const slots = await client.callTool("list_slots", { view: "rows" }) as { slots: Array<{ slotId: string }> };
  const snap = await client.callTool("get_snapshot", {}) as { revision: string; templateId: string };
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    suggestions: [
      {
        slotId: slotId(slots.slots, "systolic"),
        block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
      },
      {
        slotId: slotId(slots.slots, "diastolic"),
        block: { type: "source_query_number", fields: { EXPRESSION: "$.diastolic" } },
      },
      {
        slotId: slotId(slots.slots, "unit"),
        block: { type: "source_query", fields: { EXPRESSION: "$.unit" } },
      },
      {
        slotId: slotId(slots.slots, "band"),
        block: decisionTableBandBlock(),
        note: "AI-created: Decision table is more readable than nested if for SBP bands",
      },
    ],
  };
  const imported = await client.callTool("import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  if (imported.report.applied !== 4) {
    throw new Error(`sbp-band import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await client.callTool("run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: unknown };
  };
  if (!tested.testResult.ok) throw new Error(`sbp-band test: ${tested.testResult.error}`);
  const output = tested.testResult.output as Record<string, unknown> | undefined;
  if (output?.band !== "normal") {
    throw new Error(`expected band=normal for SBP 120, got ${JSON.stringify(tested.testResult.output)}`);
  }
  await writeJson(join(mappingDir, "ai-created-sbp-band.intehrgrator-suggestions.json"), envelope);
}

async function dummyVitalsOpenEhrBp(): Promise<void> {
  const dir = join(fixtures, "dummy-json-vitals");
  const mappingDir = join(dir, "mapping");
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "blood_pressure.opt"),
  });
  await callAgentTool(service, "load_source_schema", {
    path: join(dir, "source.schema.json"),
  });
  await callAgentTool(service, "add_example", {
    path: join(dir, "instance-1.json"),
  });

  const slots = await callAgentTool(service, "list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string }>;
  };
  const systolic = slots.slots.find((s) => s.slotId.endsWith("items/at0004/value/value/value"))?.slotId;
  const diastolic = slots.slots.find((s) => s.slotId.endsWith("items/at0005/value/value/value"))?.slotId;
  if (!systolic || !diastolic) {
    throw new Error(`BP slots: ${slots.slots.map((s) => s.slotId).join("\n")}`);
  }
  const snap = await callAgentTool(service, "get_snapshot", {}) as {
    revision: string;
    templateId: string;
  };
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: snap.templateId },
    suggestions: [
      {
        slotId: systolic,
        block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
        note: "AI-created: OPT magnitude from dummy JSON vitals",
      },
      {
        slotId: diastolic,
        block: { type: "source_query_number", fields: { EXPRESSION: "$.diastolic" } },
      },
    ],
  };
  const imported = await callAgentTool(service, "import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  if (imported.report.applied !== 2) {
    throw new Error(`openEHR import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await callAgentTool(service, "run_test", {}) as { testResult: { ok: boolean; error?: string } };
  if (!tested.testResult.ok) throw new Error(`openEHR test: ${tested.testResult.error}`);

  await writeJson(join(mappingDir, "ai-created-openehr-blood-pressure.intehrgrator-suggestions.json"), envelope);
}

async function icd10SheetLookup(): Promise<void> {
  const mappingDir = join(fixtures, "sheets", "mapping");
  const sheet = JSON.parse(
    await Deno.readTextFile(join(fixtures, "sheets", "icd10_snomed.json")),
  );
  const client = new LocalAgentClient(new WorkbenchService());
  await client.registerAgent({ displayName: "AI sheet mapper" });
  await client.callTool("load_target", {
    path: join(mappingDir, "ai-created-icd10-snomed.target.schema.json"),
  });
  await client.callTool("add_example", {
    path: join(mappingDir, "ai-created-icd10-snomed.source.json"),
  });
  await client.callTool("replace_sheets", { sheets: [sheet] });
  const slots = await client.callTool("list_slots", { view: "rows" }) as { slots: Array<{ slotId: string }> };
  const snap = await client.callTool("get_snapshot", {}) as { revision: string; templateId: string };
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    suggestions: [
      {
        slotId: slotId(slots.slots, "snomed"),
        block: {
          type: "sheet_lookup",
          fields: { NAME: "icd10_snomed" },
          inputs: {
            MATCH_COL: { block: { type: "text", fields: { TEXT: "code" } } },
            MATCH_VAL: {
              block: { type: "source_query", fields: { EXPRESSION: "$.diagnosis.icd10" } },
            },
            RETURN_COL: { block: { type: "text", fields: { TEXT: "snomed" } } },
          },
        },
        note: "AI-created: 1-key terminology Sheet (not a Decision table)",
      },
    ],
  };
  const imported = await client.callTool("import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  if (imported.report.applied !== 1) {
    throw new Error(`sheet import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await client.callTool("run_test", {}) as {
    testResult: { ok: boolean; error?: string; output?: unknown };
  };
  if (!tested.testResult.ok) throw new Error(`sheet test: ${tested.testResult.error}`);
  const output = tested.testResult.output as Record<string, unknown> | undefined;
  if (output?.snomed !== "38341003") {
    throw new Error(`expected SNOMED 38341003 for I10, got ${JSON.stringify(tested.testResult.output)}`);
  }
  await writeJson(join(mappingDir, "ai-created-icd10-snomed.sheet.json"), sheet);
  await writeJson(join(mappingDir, "ai-created-icd10-snomed.intehrgrator-suggestions.json"), envelope);
}

async function legacySimulatedJson(): Promise<void> {
  const dir = join(fixtures, "legacy-simulated-json");
  const mappingDir = join(dir, "mapping");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.registerAgent({ displayName: "AI legacy-json mapper" });
  await client.callTool("load_target", { path: join(dir, "bp-schema.json") });
  await client.callTool("load_source_schema", { path: join(dir, "bp-schema.json") });
  await client.callTool("add_example", { path: join(dir, "instances", "bp-inst.json") });
  const slots = await client.callTool("list_slots", { view: "rows" }) as { slots: Array<{ slotId: string }> };
  const snap = await client.callTool("get_snapshot", {}) as { revision: string; templateId: string };
  const fields = ["patientId", "timestamp", "systolic", "diastolic", "pulse", "bodyPosition"];
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    suggestions: fields.map((name) => ({
      slotId: slotId(slots.slots, name),
      block: {
        type: name === "systolic" || name === "diastolic" || name === "pulse"
          ? "source_query_number"
          : "source_query",
        fields: { EXPRESSION: `$.${name}` },
      },
      note: name === "systolic" ? "AI-created identity map from legacy-simulated-json" : undefined,
    })),
  };
  const imported = await client.callTool("import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[] } };
  if (imported.report.applied !== fields.length) {
    throw new Error(`legacy json import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  if (!tested.testResult.ok) throw new Error(`legacy json test: ${tested.testResult.error}`);
  await writeJson(join(mappingDir, "ai-created-blood-pressure.intehrgrator-suggestions.json"), envelope);
}

async function legacySimulatedJsonSeries(): Promise<void> {
  const dir = join(fixtures, "legacy-simulated-json");
  const mappingDir = join(dir, "mapping");
  const client = new LocalAgentClient(new WorkbenchService());
  await client.registerAgent({ displayName: "AI series mapper" });
  await client.callTool("load_target", { path: join(dir, "bp-series-schema.json") });
  await client.callTool("load_source_schema", { path: join(dir, "bp-series-schema.json") });
  await client.callTool("add_example", {
    path: join(dir, "instances-series", "bp-series-inst.json"),
  });
  const slots = await client.callTool("list_slots", { view: "rows" }) as {
    slots: Array<{ slotId: string; multiplicity?: string }>;
  };
  const snap = await client.callTool("get_snapshot", {}) as { revision: string; templateId: string };
  const measurementsSlot = slots.slots.find((s) =>
    s.slotId.includes("measurements") && (s.multiplicity?.includes("*") || s.slotId.includes("[*]"))
  ) ?? slots.slots.find((s) => s.slotId.includes("measurements") && !s.slotId.includes("."));
  const diagnosisCode = slots.slots.find((s) =>
    s.slotId.endsWith("$.diagnosis.code") || s.slotId.endsWith(".diagnosis.code")
  );
  const systolic = slots.slots.find((s) =>
    s.slotId.endsWith("$.systolic") || s.slotId.endsWith("[*].systolic") || s.slotId.endsWith(".systolic")
  );
  const diastolic = slots.slots.find((s) =>
    s.slotId.endsWith("$.diastolic") || s.slotId.endsWith("[*].diastolic") || s.slotId.endsWith(".diastolic")
  );
  if (!systolic || !diastolic) {
    throw new Error(`series slots: ${slots.slots.map((s) => `${s.slotId} (${s.multiplicity ?? "-"})`).join("\n")}`);
  }
  const attachSlotId = measurementsSlot?.slotId ??
    systolic.slotId.replace(/\.systolic$/, "").replace(/\[\*\]\.systolic$/, "");
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: snap.templateId },
    loops: [
      {
        attachSlotId,
        block: {
          type: "for_each_list",
          fields: { VAR: "reading" },
          inputs: {
            LIST: {
              block: { type: "source_query_node", fields: { EXPRESSION: "$.measurements" } },
            },
          },
        },
        note: "AI-created: repeating measurements",
      },
    ],
    suggestions: [
      ...(diagnosisCode
        ? [{
          slotId: diagnosisCode.slotId,
          block: { type: "source_query", fields: { EXPRESSION: "$.diagnosis.code" } },
        }]
        : []),
      {
        slotId: systolic.slotId,
        loopVar: "reading",
        block: { type: "source_query_number", fields: { EXPRESSION: "systolic" } },
      },
      {
        slotId: diastolic.slotId,
        loopVar: "reading",
        block: { type: "source_query_number", fields: { EXPRESSION: "diastolic" } },
      },
    ],
  };
  const imported = await client.callTool("import_suggestions", {
    text: JSON.stringify(envelope),
    revision: snap.revision,
  }) as { report: { applied: number; errors: string[]; loopsAccepted?: number } };
  if (imported.report.applied < 2) {
    throw new Error(`series import: ${imported.report.errors.join("; ")}`);
  }
  const tested = await client.callTool("run_test", {}) as { testResult: { ok: boolean; error?: string } };
  if (!tested.testResult.ok) throw new Error(`series test: ${tested.testResult.error}`);
  await writeJson(join(mappingDir, "ai-created-bp-series.intehrgrator-suggestions.json"), envelope);
}

if (import.meta.main) {
  await dummyJsonVitals();
  await dummyVitalsSbpBand();
  await dummyVitalsOpenEhrBp();
  await icd10SheetLookup();
  await legacySimulatedJson();
  await legacySimulatedJsonSeries();
  console.log("Wrote AI-created mappings under test/fixtures mapping directories");
}
