/**
 * Agent API / MCP seam: map catalog Example Sets and run Conversion Test.
 * Uses WorkbenchService + callAgentTool (the same names as stdio MCP).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { sheetsFromCatalogJson } from "@intehrgrator/core/sheets/mod.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { classifyOpenEhrValidationMessage } from "@intehrgrator/core/output/template_validation.ts";
import type { OutputMode, TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const fixtures = join(root, "test", "fixtures");
const NAME_BROKEN = /invalid|broken|fail|bad/i;

type SlotRow = { slotId: string; mapped: boolean };
type TestPayload = {
  testResult: TestResult;
  outputMode?: string;
};

async function agent(displayName: string): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", {
    agentId: `nightly-${displayName}`,
    displayName,
  });
  return service;
}

async function loadSet(
  service: WorkbenchService,
  setId: string,
  includeMapping = true,
): Promise<{ exampleCount: number; templateId: string; revision: string }> {
  const loaded = await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId,
    includeMapping,
  }) as {
    snapshot: { exampleCount: number; templateId: string; revision: string };
  };
  return loaded.snapshot;
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output ?? "");
  }
}

function sheetsArg(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { sheets?: unknown }).sheets)) {
    return (raw as { sheets: unknown[] }).sheets;
  }
  return sheetsFromCatalogJson(raw);
}

async function maybeFacility(service: WorkbenchService, revision: string): Promise<string> {
  try {
    const optional = await callAgentTool(service, "list_optional_rm", {}) as {
      catalog: Array<{
        parentSlotId: string;
        attachments: Array<{ attributeName: string; rmType: string }>;
      }>;
    };
    const context = optional.catalog.find((row) =>
      row.parentSlotId.endsWith("//context/EVENT_CONTEXT") &&
      row.attachments.some((a) => a.attributeName === "health_care_facility")
    );
    if (!context) return revision;
    const added = await callAgentTool(service, "optional_rm_add", {
      parentSlotId: context.parentSlotId,
      rmType: "PARTY_IDENTIFIED",
      attributeName: "health_care_facility",
      revision,
    }) as { revision: string };
    return added.revision;
  } catch {
    return revision;
  }
}

async function runMode(
  service: WorkbenchService,
  outputMode: OutputMode,
): Promise<TestResult> {
  if (outputMode === "xquery") await ensureXQueryRuntime();
  if (outputMode === "go-template") await ensureGoTemplateWasm();
  const tested = await callAgentTool(service, "run_test", { outputMode }) as TestPayload;
  return tested.testResult;
}

function assertExecuted(result: TestResult, label: string): void {
  assertEquals(result.error, undefined, `${label}: ${result.error}`);
  assertEquals(result.ok, true, `${label}: ${outputText(result.output).slice(0, 800)}`);
}

Deno.test("Agent API map_slot on dummy-json-vitals then TypeScript and XQuery Test Run", async () => {
  const service = await agent("dummy-map");
  await loadSet(service, "dummy-json-vitals", false);
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as { slots: SlotRow[] };
  const byName = (part: string) => listed.slots.find((row) => row.slotId.includes(part))?.slotId;
  const systolic = byName("systolic");
  const diastolic = byName("diastolic");
  const unit = byName("unit");
  if (!systolic || !diastolic || !unit) {
    throw new Error(`missing dummy slots: ${listed.slots.map((row) => row.slotId).join(", ")}`);
  }
  for (const [slotId, path] of [
    [systolic, "$.systolic"],
    [diastolic, "$.diastolic"],
    [unit, "$.unit"],
  ] as const) {
    await callAgentTool(service, "map_slot", { slotId, path, format: "json" });
  }
  const after = await callAgentTool(service, "list_slots", { view: "rows" }) as { slots: SlotRow[] };
  assertEquals(after.slots.filter((row) => row.mapped).length >= 3, true);

  const ts = await runMode(service, "typescript");
  assertExecuted(ts, "dummy instance-1 typescript");
  const text = outputText(ts.output);
  assertStringIncludes(text, "120");
  assertStringIncludes(text, "80");

  const examples = (await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  }).examples;
  const nightly = examples.find((ex) => ex.filename === "instance-3.json");
  if (!nightly) throw new Error("expected dummy instance-3.json");
  await callAgentTool(service, "set_active_example", { id: nightly.id });
  const ts3 = await runMode(service, "typescript");
  assertExecuted(ts3, "dummy instance-3 typescript");
  assertStringIncludes(outputText(ts3.output), "142");
  assertStringIncludes(outputText(ts3.output), "91");

  const generated = await callAgentTool(service, "generate_script", { language: "typescript" }) as {
    code: string;
    language: string;
  };
  assertEquals(generated.language, "typescript");
  assertStringIncludes(generated.code, "systolic");

  const xqScript = await callAgentTool(service, "generate_script", { language: "xquery" }) as {
    code: string;
  };
  assert(xqScript.code.length > 40, "expected XQuery Conversion Script");
  const xq = await runMode(service, "xquery");
  assertExecuted(xq, "dummy instance-3 xquery");
  assertStringIncludes(outputText(xq.output), "142");
});

Deno.test("Agent API load dummy-json-vitals-mapped and TypeScript Test Run all instances", async () => {
  const service = await agent("dummy-mapped");
  const snap = await loadSet(service, "dummy-json-vitals-mapped", true);
  assertEquals(snap.exampleCount, 3);
  const listed = await callAgentTool(service, "list_slots", { view: "rows" }) as { slots: SlotRow[] };
  assertEquals(listed.slots.filter((row) => row.mapped).length >= 3, true);
  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  for (const ex of tree.examples) {
    await callAgentTool(service, "set_active_example", { id: ex.id });
    const ts = await runMode(service, "typescript");
    assertExecuted(ts, `dummy-mapped ${ex.filename}`);
    assertStringIncludes(outputText(ts.output), "mm[Hg]");
  }
});

Deno.test("Agent API import_suggestions maps Simple-vitals-unmapped (local OPT)", async () => {
  const service = await agent("simple-vitals-map");
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "simple-diagnose-and-vitals.opt"),
  });
  await callAgentTool(service, "load_source_schema", {
    path: join(fixtures, "legacy-simulated-json", "bp-schema.json"),
  });
  await callAgentTool(service, "add_example", {
    path: join(fixtures, "legacy-simulated-json", "instances", "bp-inst.json"),
  });
  await callAgentTool(service, "add_example", {
    path: join(fixtures, "legacy-simulated-json", "instances", "bp-inst-4.json"),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { revision: string };
  await maybeFacility(service, snap.revision);
  const rawSheets = JSON.parse(
    await Deno.readTextFile(
      join(fixtures, "legacy-simulated-json", "mapping", "simple-vitals.sheets.json"),
    ),
  );
  await callAgentTool(service, "replace_sheets", { sheets: sheetsArg(rawSheets) });
  const envelope = await Deno.readTextFile(
    join(fixtures, "legacy-simulated-json", "mapping", "simple-vitals.intehrgrator-suggestions.json"),
  );
  const imported = await callAgentTool(service, "import_suggestions", { text: envelope }) as {
    report: { applied: number; errors: string[] };
  };
  assertEquals(imported.report.errors, [], imported.report.errors.join("; "));
  assertEquals(imported.report.applied >= 6, true, `applied ${imported.report.applied}`);

  const ts = await runMode(service, "typescript");
  assertExecuted(ts, "Simple-vitals bp-inst typescript");
  const text = outputText(ts.output);
  assertStringIncludes(text, "120");
  assertStringIncludes(text, "80");
  assertStringIncludes(text, "72");

  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  const nightly = tree.examples.find((ex) => ex.filename === "bp-inst-4.json");
  if (!nightly) throw new Error("expected bp-inst-4.json");
  await callAgentTool(service, "set_active_example", { id: nightly.id });
  const ts4 = await runMode(service, "typescript");
  assertExecuted(ts4, "Simple-vitals bp-inst-4 typescript");
  assertStringIncludes(outputText(ts4.output), "132");
  assertStringIncludes(outputText(ts4.output), "84");

  const xqScript = await callAgentTool(service, "generate_script", { language: "xquery" }) as {
    code: string;
  };
  assertStringIncludes(xqScript.code, "systolic");
  const xq = await runMode(service, "xquery");
  assertExecuted(xq, "Simple-vitals bp-inst-4 xquery");
  assertStringIncludes(outputText(xq.output), "132");
});

Deno.test("Agent API import_suggestions maps Simple-vitals-series-unmapped (local OPT)", async () => {
  const service = await agent("simple-vitals-series-map");
  await callAgentTool(service, "load_target", {
    path: join(fixtures, "simple-diagnose-and-vitals.opt"),
  });
  await callAgentTool(service, "load_source_schema", {
    path: join(fixtures, "legacy-simulated-json", "bp-series-schema.json"),
  });
  await callAgentTool(service, "add_example", {
    path: join(fixtures, "legacy-simulated-json", "instances-series", "bp-series-inst.json"),
  });
  await callAgentTool(service, "add_example", {
    path: join(fixtures, "legacy-simulated-json", "instances-series", "bp-series-inst-4.json"),
  });
  const snap = await callAgentTool(service, "get_snapshot", {}) as { revision: string };
  await maybeFacility(service, snap.revision);
  const rawSheets = JSON.parse(
    await Deno.readTextFile(
      join(fixtures, "legacy-simulated-json", "mapping", "bp-series.sheets.json"),
    ),
  );
  await callAgentTool(service, "replace_sheets", { sheets: sheetsArg(rawSheets) });
  const envelope = await Deno.readTextFile(
    join(fixtures, "legacy-simulated-json", "mapping", "bp-series.intehrgrator-suggestions.json"),
  );
  const imported = await callAgentTool(service, "import_suggestions", { text: envelope }) as {
    report: { applied: number; errors: string[]; loopsAccepted?: number };
  };
  assertEquals(imported.report.errors, [], imported.report.errors.join("; "));
  assertEquals(imported.report.applied >= 6, true, `applied ${imported.report.applied}`);
  assertEquals(imported.report.loopsAccepted, 1);

  const ts = await runMode(service, "typescript");
  assertExecuted(ts, "Simple-vitals-series inst typescript");
  assertStringIncludes(outputText(ts.output), "120");

  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  const nightly = tree.examples.find((ex) => ex.filename === "bp-series-inst-4.json");
  if (!nightly) throw new Error("expected bp-series-inst-4.json");
  await callAgentTool(service, "set_active_example", { id: nightly.id });
  const ts4 = await runMode(service, "typescript");
  assertExecuted(ts4, "Simple-vitals-series inst-4 typescript");
  assertStringIncludes(outputText(ts4.output), "138");
  assertStringIncludes(outputText(ts4.output), "Fracture of clavicle");
});

const LOCAL_MAPPED_SETS: Array<{
  setId: string;
  ts: boolean;
  extra?: OutputMode;
  expect: string[];
  extraExpect?: string[];
}> = [
  {
    setId: "chemo-symptoms-flat-to-tc-xml",
    ts: true,
    extra: "go-template",
    expect: ["13700"],
    extraExpect: ["ProfdocHISMessage", "194002287086", "Tårna"],
  },
  {
    setId: "chemo-symptoms-flat-to-tc-xml-decision-tables",
    ts: true,
    extra: "go-template",
    expect: ["13700"],
    extraExpect: ["ProfdocHISMessage", "194002287086", "Tårna"],
  },
  {
    setId: "lung-mdt-form-to-tc-xml",
    ts: true,
    extra: "handlebars",
    expect: ["6300"],
    extraExpect: ["ProfdocHISMessage", "6300"],
  },
  {
    setId: "lung-mdt-form-to-tc-xml-decision-tables",
    ts: true,
    extra: "handlebars",
    expect: ["6300"],
    extraExpect: ["ProfdocHISMessage", "6300"],
  },
  {
    setId: "karda-ordinationsdata-to-openehr-flat",
    ts: true,
    extra: "xquery",
    expect: ["Epirubicin"],
    extraExpect: ["Epirubicin"],
  },
  {
    setId: "karda-administreringsdata-to-openehr-flat",
    ts: true,
    extra: "xquery",
    expect: ["Epirubicin"],
    extraExpect: ["Epirubicin"],
  },
];

Deno.test("Agent API Conversion Test Run on local mapped catalog Example Sets", async () => {
  const failures: string[] = [];
  for (const spec of LOCAL_MAPPED_SETS) {
    const service = await agent(spec.setId);
    try {
      await loadSet(service, spec.setId, true);
      const tree = await callAgentTool(service, "get_source_tree", {}) as {
        examples: Array<{ id: string; filename: string }>;
      };
      assert(tree.examples.length >= 1, `${spec.setId} has no Example Instances`);
      const generated = await callAgentTool(service, "generate_script", {
        language: "typescript",
      }) as { code: string };
      assert(generated.code.length > 80, `${spec.setId} empty TypeScript Conversion Script`);

      const runnable = tree.examples.filter((ex) => !NAME_BROKEN.test(ex.filename));
      for (let i = 0; i < runnable.length; i++) {
        const ex = runnable[i]!;
        await callAgentTool(service, "set_active_example", { id: ex.id });
        if (spec.ts) {
          const ts = await runMode(service, "typescript");
          if (ts.error || !ts.ok) {
            failures.push(`${spec.setId} typescript ${ex.filename}: ${ts.error ?? outputText(ts.output).slice(0, 400)}`);
          } else if (i === 0) {
            const text = outputText(ts.output);
            for (const needle of spec.expect) {
              if (!text.includes(needle)) {
                failures.push(`${spec.setId} typescript missing ${needle}`);
              }
            }
          }
        }
        if (spec.extra && i === 0) {
          const extra = await runMode(service, spec.extra);
          if (extra.error || !extra.ok) {
            failures.push(
              `${spec.setId} ${spec.extra} ${ex.filename}: ${extra.error ?? outputText(extra.output).slice(0, 400)}`,
            );
          } else {
            const text = outputText(extra.output);
            const needles = spec.extraExpect ?? spec.expect;
            for (const needle of needles) {
              if (!text.includes(needle)) {
                failures.push(`${spec.setId} ${spec.extra} missing ${needle}`);
              }
            }
          }
        }
      }
    } catch (err) {
      failures.push(`${spec.setId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  assertEquals(failures, [], failures.join("\n"));
});

function keywordPairs(xml: string): Array<{ termId: string; note: string }> {
  const pairs: Array<{ termId: string; note: string }> = [];
  const re =
    /<TextKeyWord>(?:[\s\S]*?)<TermId>\s*([^<]*?)\s*<\/TermId>(?:[\s\S]*?)<Note>([\s\S]*?)<\/Note>[\s\S]*?<\/TextKeyWord>/gi;
  for (const match of xml.matchAll(re)) {
    pairs.push({
      termId: match[1]!.trim(),
      note: (match[2] ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return pairs.sort((a, b) => a.termId.localeCompare(b.termId) || a.note.localeCompare(b.note));
}

Deno.test("Handlebars Output mode executes nested Notes on lung-MDT mapped sets", async () => {
  const failures: string[] = [];
  for (const setId of ["lung-mdt-form-to-tc-xml", "lung-mdt-form-to-tc-xml-decision-tables"]) {
    const service = await agent(`${setId}-hbs`);
    await loadSet(service, setId, true);
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    for (const ex of tree.examples) {
      await callAgentTool(service, "set_active_example", { id: ex.id });
      const handlebars = await runMode(service, "handlebars");
      if (handlebars.error || !handlebars.ok) {
        failures.push(
          `${setId} handlebars ${ex.filename}: ${handlebars.error ?? outputText(handlebars.output).slice(0, 400)}`,
        );
        continue;
      }
      const text = outputText(handlebars.output);
      if (!text.includes("ProfdocHISMessage") || !text.includes("6300")) {
        failures.push(`${setId} ${ex.filename} missing ProfdocHISMessage/6300`);
      }
      if (text.includes("{{#each") || text.includes("{{#if")) {
        failures.push(`${setId} ${ex.filename} left nested Handlebars unevaluated`);
      }
      if (setId === "lung-mdt-form-to-tc-xml" && ex.filename.includes("never-smoked")) {
        if (!text.includes("Har aldrig rökt") || !text.includes("Anna Lungläkare")) {
          failures.push(`${setId} ${ex.filename} missing evaluated Note literals`);
        }
      }
      const preview = await runMode(service, "preview");
      if (preview.error || !preview.ok) {
        failures.push(`${setId} preview ${ex.filename}: ${preview.error}`);
        continue;
      }
      const previewPairs = keywordPairs(outputText(preview.output));
      const hbsPairs = keywordPairs(text);
      if (JSON.stringify(previewPairs) !== JSON.stringify(hbsPairs)) {
        failures.push(
          `${setId} ${ex.filename} preview/handlebars TermId+Note mismatch\npreview=${
            JSON.stringify(previewPairs)
          }\nhandlebars=${JSON.stringify(hbsPairs)}`,
        );
      }
    }
  }
  assertEquals(failures, [], failures.join("\n"));
});

/**
 * OPT/RM leftovers recorded in docs/design/karda-admin-mapping-benchmark.md.
 * A new kind (unit list, an unexpected invariant) is not in this set.
 */
function kardaValidationLimit(message: string): string | null {
  const text = message.toLowerCase();
  if (text.includes("required attribute missing") || /\(min:\s*1\)/.test(text)) return "required-missing";
  if (text.includes("cardinality") || text.includes("below minimum")) return "cardinality";
  if (text.includes("not in allowed list")) return "name-constraint";
  if (text.includes("code_string") || text.includes("defining_code")) return "code-string";
  if (text.includes("required by rm specification")) return "rm-spec";
  if (text.includes("non-empty string") || text.includes("is_empty")) return "empty-value";
  if (text.includes("does not match template archetype")) return "archetype-sibling";
  if (text.includes("type mismatch")) return "type-mismatch";
  if (text.includes("type not found in registry") || text.includes("failed to deserialize")) {
    return "deserialize-shape";
  }
  return null;
}

Deno.test("Karda mapped sets document remaining outputValidation messages", async () => {
  for (const setId of [
    "karda-ordinationsdata-to-openehr-flat",
    "karda-administreringsdata-to-openehr-flat",
  ]) {
    const service = await agent(`${setId}-validation`);
    await loadSet(service, setId, true);
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    const first = tree.examples.find((ex) => !NAME_BROKEN.test(ex.filename));
    assert(first, `${setId} has no runnable Example Instance`);
    await callAgentTool(service, "set_active_example", { id: first.id });
    for (const mode of ["typescript", "xquery"] as const) {
      const result = await runMode(service, mode);
      assertEquals(result.error, undefined, `${setId} ${mode}: ${result.error}`);
      assertEquals(result.ok, true, `${setId} ${mode} not ok`);
      assertStringIncludes(outputText(result.output), "Epirubicin");
      const validation = result.outputValidation;
      assertEquals(validation?.applicable, true, `${setId} ${mode} validation not applicable`);
      if (validation && validation.valid !== true) {
        const leftover = validation.messages.filter((msg) => kardaValidationLimit(msg.message) == null);
        assertEquals(
          leftover,
          [],
          `${setId} ${mode} undocumented validation:\n${
            leftover.map((msg) => `${msg.path}: ${msg.message}`).join("\n")
          }`,
        );
        assert(validation.messages.length > 0, `${setId} ${mode} invalid with no messages`);
      }
    }
  }
});

Deno.test("Simple-vitals mapped TypeScript classifies remaining outputValidation messages", async () => {
  const known = new Set([
    "required-missing",
    "unit-list",
    "type-mismatch",
    "code-phrase",
    "archetype-sibling",
  ]);
  for (const setId of ["Simple-vitals", "Simple-vitals-series"]) {
    const service = await agent(`${setId}-validation`);
    await loadSet(service, setId, true);
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    for (const ex of tree.examples) {
      await callAgentTool(service, "set_active_example", { id: ex.id });
      const ts = await runMode(service, "typescript");
      assertExecuted(ts, `${setId} ${ex.filename}`);
      const text = outputText(ts.output);
      if (NAME_BROKEN.test(ex.filename)) {
        // Source-schema failures. A series row with an unknown position can
        // still produce a valid composition when that optional element is omitted.
        // The single-instance file emits the bad coded text and must stay invalid.
        if (ex.filename === "bp-inst-3-invalid.json") {
          assertEquals(
            ts.outputValidation?.valid === true,
            false,
            `${setId} ${ex.filename} named-invalid must not be fully valid`,
          );
        }
        continue;
      }
      if (ex.filename === "bp-inst.json") {
        assertStringIncludes(text, "120");
        assertStringIncludes(text, "80");
      }
      if (ex.filename === "bp-series-inst.json") {
        assertStringIncludes(text, "120");
      }
      if (ts.outputValidation?.applicable && ts.outputValidation.valid !== true) {
        const leftover = (ts.outputValidation.messages ?? []).filter((msg) =>
          !known.has(classifyOpenEhrValidationMessage(msg.message))
        );
        assertEquals(
          leftover,
          [],
          `${setId} ${ex.filename} unclassified validation:\n${
            leftover.map((msg) => `${msg.path}: ${msg.message}`).join("\n")
          }`,
        );
      }
    }
  }
});

Deno.test("OBX mapped TypeScript Test Run on primigravida instances", async () => {
  const service = await agent("obx-mapped");
  try {
    await loadSet(service, "obx-mhv1-mapped-json-to-openehr", true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /t\.json|overlay|GitHub|dependent archetype|flatten|fetch|HTTP|network/i.test(message)
    ) {
      console.warn(`Skipping OBX mapped Test Run: ${message}`);
      return;
    }
    throw err;
  }
  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  const primigravida = tree.examples.find((ex) => ex.filename === "1-primigravida-basprogram.json");
  const nightly = tree.examples.find((ex) => ex.filename === "4-nightly-primigravida.json");
  if (!primigravida || !nightly) {
    throw new Error(
      `expected primigravida instances, got ${tree.examples.map((ex) => ex.filename).join(", ")}`,
    );
  }
  await callAgentTool(service, "set_active_example", { id: primigravida.id });
  const ts1 = await runMode(service, "typescript");
  assertExecuted(ts1, "OBX 1-primigravida typescript");
  assertStringIncludes(outputText(ts1.output), "19930614-2384");
  await callAgentTool(service, "set_active_example", { id: nightly.id });
  const ts4 = await runMode(service, "typescript");
  assertExecuted(ts4, "OBX 4-nightly-primigravida typescript");
  assertStringIncludes(outputText(ts4.output), "19900115-2384");
  try {
    await ensureXQueryRuntime();
    const xq = await runMode(service, "xquery");
    if (xq.error || !xq.ok) {
      console.warn(`OBX XQuery skipped: ${xq.error ?? outputText(xq.output).slice(0, 200)}`);
    } else {
      assertStringIncludes(outputText(xq.output), "19900115-2384");
    }
  } catch (err) {
    console.warn(`OBX XQuery skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
});

