import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { validateConvertedOutput, classifyOpenEhrValidationMessage } from "@intehrgrator/core/output/template_validation.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { DEFAULT_SETTINGS, type TestResult } from "@intehrgrator/types/mod.ts";

function stubHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    pickTextFile: async () => null,
    pickTextFilesFromDirectory: async () => null,
    pickBinaryFile: async () => null,
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: async () => {},
    readClipboard: async () => "",
    saveAutosave: async () => {},
    saveManualSave: async () => {},
    loadStoredProjectRecord: async () => null as StoredProjectRecord | null,
    listLoadableProjects: async () => [] as LoadableProjectEntry[],
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
    ...overrides,
  };
}

const bpOptPath = join(import.meta.dirname!, "fixtures", "blood_pressure.opt");

Deno.test("validateConvertedOutput deserializes preview JSON and reports template errors", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const { skeleton } = generateSkeleton(opt);
  const target = {
    format: "openehr-template" as const,
    filename: "blood_pressure.opt",
    targetId: "openEHR-EHR-COMPOSITION.sample_encounter.v1",
    content: opt,
    skeleton,
  };
  const output = getTargetFormatHandler("openehr-template").render({
    definition: target,
    slotValues: {},
  });
  const empty = validateConvertedOutput(output, target, { deserializeMode: "hybrid" });
  assert(empty.applicable);
  assertEquals(empty.valid, true, empty.messages.map((m) => m.message).join("; "));
  const bad = {
    ...(output as Record<string, unknown>),
    category: { _type: "DV_CODED_TEXT", value: "not-a-code" },
  };
  const validation = validateConvertedOutput(bad, target, { deserializeMode: "hybrid" });
  assert(validation.applicable);
  assertEquals(validation.valid, false);
  assert(
    validation.messages.length > 0,
    `expected template errors, got: ${validation.messages.map((m) => m.message).join("; ")}`,
  );
  assert(
    !validation.messages.some((m) => m.message.includes("canonical deserializer")),
    "hybrid mode should not surface canonical deserializer strict-mode errors",
  );
});

Deno.test("canonical strict mode differs from hybrid for preview JSON", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const { skeleton } = generateSkeleton(opt);
  const target = {
    format: "openehr-template" as const,
    filename: "blood_pressure.opt",
    targetId: "openEHR-EHR-COMPOSITION.sample_encounter.v1",
    content: opt,
    skeleton,
  };
  const output = getTargetFormatHandler("openehr-template").render({
    definition: target,
    slotValues: {},
  });
  const bad = {
    ...(output as Record<string, unknown>),
    category: { _type: "DV_CODED_TEXT", value: "not-a-code" },
  };
  const hybrid = validateConvertedOutput(bad, target, { deserializeMode: "hybrid" });
  const strict = validateConvertedOutput(bad, target, { deserializeMode: "canonical-strict" });
  assert(hybrid.applicable && strict.applicable);
  assertEquals(hybrid.valid, false);
  assertEquals(strict.valid, false);
  assert(hybrid.messages.length > 0, "hybrid should reach template validator");
});

Deno.test("DEFAULT_SETTINGS use canonical-strict for openEHR JSON validation", () => {
  assertEquals(DEFAULT_SETTINGS.openEhrJsonDeserializeMode, "canonical-strict");
});

Deno.test("Simple-vitals BP preview and TypeScript pass strict output validation with 0 messages", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", {
    agentId: "strict-bp-validation",
    displayName: "strict-bp-validation",
  });
  const catalogPath = join(import.meta.dirname!, "..", "examples", "example-sets.json");
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId: "Simple-vitals",
    includeMapping: true,
  });
  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  const bp = tree.examples.find((ex) => ex.filename === "bp-inst.json");
  assert(bp, "expected bp-inst.json in Simple-vitals");
  await callAgentTool(service, "set_active_example", { id: bp.id });
  for (const outputMode of ["preview", "typescript"] as const) {
    const tested = await callAgentTool(service, "run_test", { outputMode }) as {
      testResult: TestResult;
    };
    const validation = tested.testResult.outputValidation;
    assertEquals(validation?.applicable, true, outputMode);
    assertEquals(
      validation?.valid,
      true,
      `${outputMode}: ${(validation?.messages ?? []).map((m) => m.message).join("; ")}`,
    );
    assertEquals(validation?.messages.length ?? 0, 0);
  }
});

Deno.test("validateConvertedOutput defaults to canonical-strict deserialization", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const { skeleton } = generateSkeleton(opt);
  const target = {
    format: "openehr-template" as const,
    filename: "blood_pressure.opt",
    targetId: "openEHR-EHR-COMPOSITION.sample_encounter.v1",
    content: opt,
    skeleton,
  };
  const example = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "instances", "bp-inst.json"),
  );
  const model = createEmptyModel("openEHR-EHR-COMPOSITION.sample_encounter.v1");
  const result = runTest(model, example, "json", { target, outputMode: "preview" });
  assert(result.outputValidation?.applicable);
  assertEquals(result.outputValidation?.valid, true, (result.outputValidation?.messages ?? []).map((m) => m.message).join("; "));
  assertEquals(result.outputValidation?.messages.length ?? 0, 0);
});

Deno.test("runTest preview on BP target with legacy JSON instance collects output validation", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const example = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "instances", "bp-inst.json"),
  );
  const model = createEmptyModel("openEHR-EHR-COMPOSITION.sample_encounter.v1");
  const { skeleton } = generateSkeleton(opt);
  const target = {
    format: "openehr-template" as const,
    filename: "blood_pressure.opt",
    targetId: "openEHR-EHR-COMPOSITION.sample_encounter.v1",
    content: opt,
    skeleton,
  };
  const result = runTest(model, example, "json", {
    target,
    outputMode: "preview",
  });
  assert(result.outputValidation?.applicable);
  assertEquals(
    result.outputValidation?.valid,
    true,
    (result.outputValidation?.messages ?? []).map((m) => m.message).join("; "),
  );
});

Deno.test("runAllTests validates every loaded example for autoplay", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const inst1 = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "instances", "bp-inst.json"),
  );
  const inst2 = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "instances", "bp-inst-3-invalid.json"),
  );
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("blood_pressure.opt", opt);
  controller.addExampleContent("bp-inst.json", inst1);
  controller.addExampleContent("bp-inst-3-invalid.json", inst2);
  controller.runAllTests();
  const state = controller.getState();
  assertEquals(state.examples.length, 2);
  for (const ex of state.examples) {
    const validation = state.outputValidations[ex.id];
    assert(validation?.applicable, `expected validation for ${ex.filename}`);
    assertEquals(
      validation?.valid,
      true,
      `${ex.filename}: ${(validation?.messages ?? []).map((m) => m.message).join("; ")}`,
    );
  }
});

Deno.test("classifyOpenEhrValidationMessage splits Simple-vitals leftover kinds", () => {
  assertEquals(
    classifyOpenEhrValidationMessage("Required attribute missing (min:1) on /content[openEHR-EHR-OBSERVATION]/data/events"),
    "required-missing",
  );
  assertEquals(
    classifyOpenEhrValidationMessage("units value mm[Hg] is not in C_DV_QUANTITY.list"),
    "unit-list",
  );
  assertEquals(
    classifyOpenEhrValidationMessage("Type mismatch: expected ELEMENT, found CLUSTER"),
    "type-mismatch",
  );
  assertEquals(
    classifyOpenEhrValidationMessage("CODE_PHRASE completeness: encoding defining_code missing"),
    "code-phrase",
  );
  assertEquals(
    classifyOpenEhrValidationMessage(
      'archetype_node_id "openEHR-EHR-OBSERVATION.pulse.v2" does not match template archetype "openEHR-EHR-OBSERVATION.respiration.v2"',
    ),
    "archetype-sibling",
  );
  assertEquals(classifyOpenEhrValidationMessage("unexpected RM invariant"), "other");
});
