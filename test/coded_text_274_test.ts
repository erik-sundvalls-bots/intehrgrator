/** #274: a DV_TEXT node may be mapped as its subclass DV_CODED_TEXT. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import {
  applyCodedTextSlots,
  codedTextParts,
  codedTextRmType,
} from "@intehrgrator/core/openehr/coded_text.ts";
import type {
  MappingSlot,
  SkeletonNode,
  TestResult,
} from "@intehrgrator/types/mod.ts";

const catalogPath = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "examples",
  "example-sets.json",
);
const DIAGNOSIS =
  "simple-diagnose-and-vitals//content[openEHR-EHR-EVALUATION.problem_diagnosis.v1]/data/at0001/items/at0002/value/DV_TEXT/value";
const RATE =
  "simple-diagnose-and-vitals//content[openEHR-EHR-SECTION.adhoc.v1]/items[openEHR-EHR-OBSERVATION.respiration.v2]/data/at0001/events/at0002/data/at0003/items/at0004/value/value/value";
const q = (e: string) => ({
  block: { type: "source_query", fields: { EXPRESSION: e } },
});
const CODED_BLOCK = {
  type: "maps_create_with",
  extraState: { itemCount: 3 },
  fields: { KEY0: "value", KEY1: "code_string", KEY2: "terminology_id" },
  inputs: {
    VAL0: q("$.diagnosis.display"),
    VAL1: q("$.diagnosis.code"),
    VAL2: q("$.diagnosis.codeSystem"),
  },
};

type Report = { applied: number; skipped: number; errors: string[] };

async function vitals(): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", {
    agentId: "coded-274",
    displayName: "coded-274",
  });
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId: "Simple-vitals-series",
    includeMapping: true,
  });
  return service;
}

async function suggest(
  service: WorkbenchService,
  suggestion: Record<string, unknown>,
): Promise<Report> {
  const text = JSON.stringify({
    format: "intehrgrator-suggestions",
    version: "2",
    target: "simple-diagnose-and-vitals",
    suggestions: [suggestion],
  });
  return ((await callAgentTool(service, "import_suggestions", { text })) as {
    report: Report;
  }).report;
}

async function run(
  service: WorkbenchService,
  outputMode: "typescript" | "xquery",
): Promise<TestResult> {
  if (outputMode === "xquery") await ensureXQueryRuntime();
  return ((await callAgentTool(service, "run_test", { outputMode })) as {
    testResult: TestResult;
  }).testResult;
}

/** The ELEMENT value of Problem/Diagnosis name in a canonical JSON result. */
function diagnosisValue(result: TestResult): Record<string, unknown> {
  const text = typeof result.output === "string"
    ? result.output
    : JSON.stringify(result.output);
  const found: Record<string, unknown>[] = [];
  JSON.parse(text, (_k, v) => {
    if (
      v && typeof v === "object" && v.archetype_node_id === "at0002" &&
      v._type === "ELEMENT"
    ) found.push(v.value);
    return v;
  });
  assertEquals(found.length, 1, text.slice(0, 400));
  return found[0]!;
}

function slot(
  service: WorkbenchService,
  slotId: string,
): MappingSlot | undefined {
  return (service as unknown as {
    controller: { getState(): { model: { slots: MappingSlot[] } } };
  }).controller.getState().model.slots.find((s) => s.slotId === slotId);
}

Deno.test("codedTextRmType: an explicit choice wins, else a code makes DV_CODED_TEXT", () => {
  const coded =
    'map("value", xpathString("a"), "code_string", xpathString("b"))';
  assertEquals(codedTextRmType(coded), "DV_CODED_TEXT");
  assertEquals(codedTextRmType('xpathString("a")'), "DV_TEXT");
  assertEquals(
    codedTextRmType('xpathString("a")', "DV_CODED_TEXT"),
    "DV_CODED_TEXT",
  );
  assertEquals(codedTextRmType(coded, "DV_TEXT"), "DV_TEXT");
});

Deno.test("codedTextParts reads flat and nested defining_code maps", () => {
  const flat = codedTextParts(
    'map("value", "x", "code_string", "c", "terminology_id", "t")',
  );
  assertEquals(flat?.code, { kind: "literal", value: "c" });
  assertEquals(flat?.terminology, { kind: "literal", value: "t" });
  const nested = codedTextParts(
    'map("value", "event", "defining_code", map("terminology_id", "openehr", "code_string", "433"))',
  );
  assertEquals(nested?.value, { kind: "literal", value: "event" });
  assertEquals(nested?.code, { kind: "literal", value: "433" });
  assertEquals(codedTextParts('xpathString("a")'), null);
});

Deno.test("applyCodedTextSlots switches only DV_TEXT value nodes mapped as DV_CODED_TEXT", () => {
  const node = (slotId: string, rmType: string): SkeletonNode =>
    ({
      slotId,
      kind: "value",
      rmType,
      blockType: rmType.toLowerCase(),
      children: [],
    }) as unknown as SkeletonNode;
  const skeleton = [
    node("a", "DV_TEXT"),
    node("b", "DV_TEXT"),
    node("c", "DV_QUANTITY"),
  ];
  const slots = [
    { slotId: "a", rmType: "DV_CODED_TEXT" },
    { slotId: "c", rmType: "DV_CODED_TEXT" },
  ] as MappingSlot[];
  const next = applyCodedTextSlots(skeleton, slots);
  assertEquals(next.map((n) => n.rmType), [
    "DV_CODED_TEXT",
    "DV_TEXT",
    "DV_QUANTITY",
  ]);
  assertEquals(next[0]!.blockType, "dv_coded_text");
  assert(applyCodedTextSlots(skeleton, []) === skeleton);
});

Deno.test("#274 a code on a DV_TEXT slot maps it as DV_CODED_TEXT in TypeScript and XQuery", async () => {
  const service = await vitals();
  const report = await suggest(service, {
    slotId: DIAGNOSIS,
    block: CODED_BLOCK,
  });
  assertEquals(report.applied, 1, JSON.stringify(report));
  const mapped = slot(service, DIAGNOSIS);
  assertEquals(mapped?.rmType, "DV_CODED_TEXT");
  assertStringIncludes(mapped?.expression ?? "", '"code_string"');
  for (const mode of ["typescript", "xquery"] as const) {
    const result = await run(service, mode);
    assertEquals(result.ok, true, `${mode}: ${result.error}`);
    const value = diagnosisValue(result);
    assertEquals(value._type, "DV_CODED_TEXT", mode);
    assertEquals(value.value, "Concussion", mode);
    const code = value.defining_code as {
      code_string: string;
      terminology_id: unknown;
    };
    assertEquals(code.code_string, "S06.0", mode);
    assertStringIncludes(JSON.stringify(code.terminology_id), "ICD-10", mode);
    const messages = (result.outputValidation?.messages ?? []).filter((m) =>
      m.path?.includes("at0002")
    );
    assertEquals(messages, [], `${mode}: ${JSON.stringify(messages)}`);
  }
  const java = JSON.stringify(
    await callAgentTool(service, "generate_script", { language: "java" }),
  );
  assertStringIncludes(
    java,
    'new DvCodedText(xpathString(\\"$.diagnosis.display\\"), xpathString(\\"$.diagnosis.codeSystem\\") + \\"::\\" + xpathString(\\"$.diagnosis.code\\"))',
  );
});

Deno.test("#274 rmType DV_TEXT switches a coded slot back to plain text", async () => {
  const service = await vitals();
  await suggest(service, { slotId: DIAGNOSIS, block: CODED_BLOCK });
  const report = await suggest(service, {
    slotId: DIAGNOSIS,
    rmType: "DV_TEXT",
    block: q("$.diagnosis.display").block,
  });
  assertEquals(report.applied, 1, JSON.stringify(report));
  assertEquals(slot(service, DIAGNOSIS)?.rmType, "DV_TEXT");
  const value = diagnosisValue(await run(service, "typescript"));
  assertEquals(value._type, "DV_TEXT");
  assertEquals(value.value, "Concussion");
});

Deno.test("#274 rmType on a slot that is not DV_TEXT is skipped", async () => {
  const service = await vitals();
  const report = await suggest(service, {
    slotId: RATE,
    rmType: "DV_CODED_TEXT",
    block: q("$.respiration").block,
  });
  assertEquals(report.applied, 0);
  assertStringIncludes(report.errors.join(" "), "DV_TEXT");
});

Deno.test("#274 FLAT output carries the code and terminology of a coded DV_TEXT", async () => {
  const service = await vitals();
  await suggest(service, { slotId: DIAGNOSIS, block: CODED_BLOCK });
  await callAgentTool(service, "set_instance_encoding", {
    encoding: "flat-json",
  });
  const result = await run(service, "typescript");
  assertEquals(result.ok, true, result.error);
  const flat = JSON.parse(
    typeof result.output === "string"
      ? result.output
      : JSON.stringify(result.output),
  );
  const entries = Object.entries(Array.isArray(flat) ? flat[0] : flat).filter((
    [k],
  ) => k.includes("problem_diagnosis"));
  const byKey = Object.fromEntries(entries);
  const base = Object.keys(byKey).find((k) => k.endsWith("|code"))?.replace(
    /\|code$/,
    "",
  );
  assert(base, JSON.stringify(entries).slice(0, 600));
  assertEquals(byKey[`${base}|code`], "S06.0");
  assertEquals(byKey[`${base}|terminology`], "ICD-10");
  assertEquals(byKey[`${base}|value`], "Concussion");
});
