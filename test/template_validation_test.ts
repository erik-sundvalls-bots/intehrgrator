import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import {
  classifyOpenEhrValidationMessage,
  formatOutputValidationMessage,
  validateConvertedOutput,
} from "@intehrgrator/core/output/template_validation.ts";
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

/**
 * An empty mapping leaves COMPOSITION language, territory and composer unset:
 * strict RM validation reports exactly those, and no template errors.
 */
const UNMAPPED_COMPOSITION_MANDATORY = [
  "COMPOSITION.language is required by RM specification",
  "COMPOSITION.territory is required by RM specification",
  "COMPOSITION.composer is required by RM specification",
];

function assertOnlyUnmappedMandatory(
  validation: { valid: boolean; messages: Array<{ message: string }> } | undefined,
  label = "",
): void {
  assertEquals(validation?.valid, false, label);
  assertEquals(
    [...new Set((validation?.messages ?? []).map((m) => m.message))].sort(),
    [...UNMAPPED_COMPOSITION_MANDATORY].sort(),
    label,
  );
}

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
  assertOnlyUnmappedMandatory(empty);
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
  assertOnlyUnmappedMandatory(result.outputValidation);
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
  assertOnlyUnmappedMandatory(result.outputValidation);
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
    assertOnlyUnmappedMandatory(validation, ex.filename);
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

Deno.test("FLAT output: coded text mismatches from ehrtslib v0.8 are output validation errors", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const cuff = "ehrbase_blood_pressure_simple.de.v0/blood_pressure_training_sample/cuff_size";
  const flat = (value: string) => ({
    "ctx/language": "en",
    "ctx/territory": "SE",
    "ctx/composer_name": "Test",
    [`${cuff}|code`]: "at0015",
    [`${cuff}|value`]: value,
  });
  const coded = (value: string) =>
    validateConvertedOutput(flat(value), target).messages.filter((m) =>
      m.message.includes("codedTextMismatch")
    );

  // Library defaults: codedTextMismatch "reject", codedTextDisplayValue "keep".
  assertEquals(coded("Adult"), []);
  assertEquals(coded("Wide cuff"), [], "a valid code with display text is kept");

  const caseOnly = validateConvertedOutput(flat("adult"), target);
  assertEquals(caseOnly.valid, false);
  const [caseMsg] = caseOnly.messages.filter((m) => m.message.includes("codedTextMismatch"));
  assertEquals(caseMsg?.severity, "error");
  assert(caseMsg.message.includes('"Adult"'), caseMsg.message);

  const conflict = coded("Large Adult");
  assertEquals(conflict.length, 1);
  assert(conflict[0].message.includes("at0016"), conflict[0].message);
});

Deno.test("FLAT output: validation errors carry exact line numbers and FLAT targetPath (#373)", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const root = "ehrbase_blood_pressure_simple.de.v0";
  const flatPayload = {
    "ctx/language": "en",
    "ctx/territory": "DE",
    "ctx/composer_name": "Dr Test",
    "ctx/time": "2024-01-01T10:00:00Z",
    "ctx/setting": "228",
    [`${root}/blood_pressure_training_sample:0/systolic|magnitude`]: 120,
    [`${root}/blood_pressure_training_sample:0/systolic|unit`]: "mm[Hg]",
    [`${root}/blood_pressure_training_sample:0/position|code`]: "at1000",
    [`${root}/blood_pressure_training_sample:0/position|value`]: "Standing",
    [`${root}/blood_pressure_training_sample:0/position|terminology`]: "local",
    [`${root}/blood_pressure_training_sample:0/cuff_size|code`]: "at0015",
    [`${root}/blood_pressure_training_sample:0/cuff_size|value`]: "Adult",
    [`${root}/blood_pressure_training_sample:1/systolic|magnitude`]: 130,
    [`${root}/blood_pressure_training_sample:1/systolic|unit`]: "furlong",
    [`${root}/blood_pressure_training_sample:1/position|code`]: "at1000",
    [`${root}/blood_pressure_training_sample:1/position|value`]: "Standing",
    [`${root}/blood_pressure_training_sample:1/position|terminology`]: "local",
    [`${root}/blood_pressure_training_sample:1/cuff_size|code`]: "at0015",
    [`${root}/blood_pressure_training_sample:1/cuff_size|value`]: "adult",
  };

  const validation = validateConvertedOutput(flatPayload, target);
  assertEquals(validation.valid, false);

  const unitErr = validation.messages.find((m) => m.message.includes("furlong"));
  assert(unitErr, "expected unit validation error for furlong");
  assertEquals(unitErr.line, 15);
  assertEquals(unitErr.targetPath, `${root}/blood_pressure_training_sample:1/systolic|unit`);
  assert(!unitErr.sourceIsAncestor);

  const cuffErr = validation.messages.find((m) => m.message.includes("codedTextMismatch"));
  assert(cuffErr, "expected codedTextMismatch error");
  assertEquals(cuffErr.line, 20);
  assertEquals(cuffErr.targetPath, `${root}/blood_pressure_training_sample:1/cuff_size|value`);
  const formattedUnit = formatOutputValidationMessage(unitErr);
  assert(formattedUnit.startsWith(`line 15: ${root}/blood_pressure_training_sample:1/systolic|unit`), formattedUnit);
});

Deno.test("FLAT, STRUCTURED, and Canonical JSON: missing content reports ancestor line, targetPath, and expectedExample (#373)", async () => {
  const opt = await Deno.readTextFile(bpOptPath);
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const root = "ehrbase_blood_pressure_simple.de.v0";

  // 1. FLAT JSON missing required |unit on second occurrence (line 9)
  const flatMissingUnit = {
    "ctx/language": "en",
    "ctx/territory": "DE",
    "ctx/composer_name": "Dr Test",
    "ctx/time": "2024-01-01T10:00:00Z",
    "ctx/setting": "228",
    [`${root}/blood_pressure_training_sample:0/systolic|magnitude`]: 120,
    [`${root}/blood_pressure_training_sample:0/systolic|unit`]: "mm[Hg]",
    [`${root}/blood_pressure_training_sample:1/systolic|magnitude`]: 135,
  };
  const flatVal = validateConvertedOutput(flatMissingUnit, target);
  const flatUnitMissing = flatVal.messages.find((m) =>
    m.message.includes("units") && m.message.includes("required")
  );
  assert(flatUnitMissing, "expected missing units error in FLAT JSON");
  assertEquals(flatUnitMissing.line, 9);
  assertEquals(flatUnitMissing.sourceIsAncestor, true);
  assertEquals(
    flatUnitMissing.targetPath,
    `${root}/blood_pressure_training_sample:1/systolic|unit`,
  );
  assert(flatUnitMissing.expectedExample?.includes("systolic|unit"), flatUnitMissing.expectedExample);
  const flatFormatted = formatOutputValidationMessage(flatUnitMissing);
  assert(flatFormatted.includes("near line 9"), flatFormatted);
  assert(flatFormatted.includes("expected at"), flatFormatted);
  assert(flatFormatted.includes("systolic|unit"), flatFormatted);

  // 2. STRUCTURED JSON missing required |unit (systolic object opens at line 12)
  const structuredMissingUnit = {
    ctx: {
      language: "en",
      territory: "DE",
      composer_name: "Dr Test",
      time: "2024-01-01T10:00:00Z",
      setting: "228",
    },
    [root]: {
      blood_pressure_training_sample: [
        {
          systolic: [{ "|magnitude": 120 }],
          position: [{ "|code": "at1000", "|value": "Standing", "|terminology": "local" }],
        },
      ],
    },
  };
  const structVal = validateConvertedOutput(structuredMissingUnit, target);
  const structUnitMissing = structVal.messages.find((m) =>
    m.message.includes("units") && m.message.includes("required")
  );
  assert(structUnitMissing, "expected missing units error in STRUCTURED JSON");
  assertEquals(structUnitMissing.line, 13);
  assertEquals(structUnitMissing.sourceIsAncestor, true);
  assert(structUnitMissing.expectedExample?.includes('"|unit"'), structUnitMissing.expectedExample);

  // 3. Canonical JSON missing required setting inside context (line 29)
  const canonicalMissingSetting = {
    _type: "COMPOSITION",
    name: { _type: "DV_TEXT", value: "Blood pressure" },
    archetype_node_id: "openEHR-EHR-COMPOSITION.report.v1",
    language: {
      _type: "CODE_PHRASE",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "ISO_639-1" },
      code_string: "en",
    },
    territory: {
      _type: "CODE_PHRASE",
      terminology_id: { _type: "TERMINOLOGY_ID", value: "ISO_3166-1" },
      code_string: "DE",
    },
    category: {
      _type: "DV_CODED_TEXT",
      value: "event",
      defining_code: {
        _type: "CODE_PHRASE",
        terminology_id: { _type: "TERMINOLOGY_ID", value: "openehr" },
        code_string: "433",
      },
    },
    composer: { _type: "PARTY_IDENTIFIED", name: "Dr Test" },
    context: {
      _type: "EVENT_CONTEXT",
      start_time: { _type: "DV_DATE_TIME", value: "2024-01-01T10:00:00Z" },
    },
  };
  const canonVal = validateConvertedOutput(canonicalMissingSetting, target, {
    deserializeMode: "hybrid",
  });
  const settingErr = canonVal.messages.find((m) =>
    m.path.includes("setting") || m.message.toLowerCase().includes("setting")
  );
  assert(settingErr, "expected missing setting error in Canonical JSON");
  assertEquals(settingErr.line, 40);
  assertEquals(settingErr.sourceIsAncestor, true);
  assert(settingErr.expectedExample?.includes('"setting"'), settingErr.expectedExample);
  const canonFormatted = formatOutputValidationMessage(settingErr);
  assert(canonFormatted.includes("near line 40"), canonFormatted);
  assert(canonFormatted.includes("inside /context"), canonFormatted);
});

Deno.test("MHV1 FLAT output validation attaches line numbers, targetPath, and missing-event example (#373)", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", {
    agentId: "mhv1-flat-line-numbers",
    displayName: "mhv1-flat-line-numbers",
  });
  const catalogPath = join(import.meta.dirname!, "..", "examples", "example-sets.json");
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId: "mhv1-generic-entry-flat-wt",
    includeMapping: true,
  });
  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string; filename: string }>;
  };
  const nightly = tree.examples.find((ex) => ex.filename.includes("4-nightly-primigravida"));
  assert(nightly, "expected 4-nightly-primigravida.flat.json in mhv1-generic-entry-flat-wt");
  await callAgentTool(service, "set_active_example", { id: nightly.id });
  const tested = await callAgentTool(service, "run_test", { outputMode: "preview" }) as {
    testResult: TestResult;
  };
  assertEquals(
    tested.testResult.outputValidation?.valid,
    true,
    `expected clean baseline validation on 4-nightly-primigravida, got: ${
      tested.testResult.outputValidation?.messages?.map((m) => m.message).join("; ")
    }`,
  );

  // Inject an observation with language/encoding but no HISTORY events to exercise
  // #373 line-number, targetPath, sourceIsAncestor, and expectedExample diagnostics.
  const baseFlat = typeof tested.testResult.output === "string"
    ? JSON.parse(tested.testResult.output) as Record<string, unknown>
    : structuredClone(tested.testResult.output as Record<string, unknown>);
  baseFlat["mhv1-_prenatal_visit.encounter.v1/lifestyle_risk_factors/observation/language|code"] = "en";
  baseFlat["mhv1-_prenatal_visit.encounter.v1/lifestyle_risk_factors/observation/language|terminology"] = "ISO_639-1";
  baseFlat["mhv1-_prenatal_visit.encounter.v1/lifestyle_risk_factors/observation/encoding|code"] = "UTF-8";
  baseFlat["mhv1-_prenatal_visit.encounter.v1/lifestyle_risk_factors/observation/encoding|terminology"] = "IANA_character-sets";

  const target = service.controller.getState().target!;
  const broken = validateConvertedOutput(JSON.stringify(baseFlat, null, 2), target);
  const messages = broken?.messages ?? [];
  assert(messages.length > 0, "expected validation messages on broken FLAT payload");
  for (const msg of messages) {
    assert(
      typeof msg.line === "number" && msg.line > 0,
      `expected line number on "${msg.path}: ${msg.message}", got ${msg.line}`,
    );
    assert(
      msg.targetPath?.startsWith("mhv1-_prenatal_visit.encounter.v1/"),
      `expected FLAT targetPath on "${msg.path}", got ${msg.targetPath}`,
    );
  }
  const historyErr = messages.find((m) => m.message.includes("HISTORY.Events_valid"));
  assert(historyErr, "expected HISTORY.Events_valid error");
  assertEquals(historyErr.sourceIsAncestor, true);
  assert(
    historyErr.expectedExample?.includes("mhv1-_prenatal_visit.encounter.v1/lifestyle_risk_factors/observation/"),
    `expected FLAT example for empty HISTORY, got: ${historyErr.expectedExample}`,
  );
});



