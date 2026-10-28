/**
 * #277 §6–8: models named once, stable prompt prefix first, original target
 * only on request, MCP `instructions` with a version-pinned workflow link.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { describeModels, formatModelsBlock } from "@intehrgrator/core/ai/models_block.ts";
import { stablePromptPrefix } from "@intehrgrator/core/ai/mod.ts";
import { handleMcpRequest, LocalAgentClient } from "@intehrgrator/agent/mcp_stdio.ts";

const FIX = join(import.meta.dirname!, "fixtures");
const SDV = join(FIX, "simple-diagnose-and-vitals.opt");
const MHV1 = join(FIX, "Obstetrix-MHV1", "target", "mhv1-prenatal-visit.encounter.v1.opt");
const TAKECARE = join(FIX, "TakeCare", "TakeCare-CasenoteWrite-edit01.xsd");
const VITALS = join(FIX, "dummy-json-vitals");

async function serviceWith(target: string, source?: string): Promise<WorkbenchService> {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_target", { filename: target.split("/").pop(), content: await Deno.readTextFile(target) });
  if (source) {
    await callAgentTool(service, "load_source_schema", { filename: source.split("/").pop(), content: await Deno.readTextFile(source) });
  }
  return service;
}

const prompt = (s: WorkbenchService, d: "api" | "inline" | "uri" | "attach") => s["controller"].buildAiPromptText(d);

Deno.test("Models block: SDV lists template, every archetype with version, once (#277 §7)", async () => {
  const s = await serviceWith(SDV);
  const text = prompt(s, "inline");
  const block = text.slice(text.indexOf("## Models"), text.indexOf("\n## Slot tree\n"));
  assertStringIncludes(block, "template id `simple-diagnose-and-vitals`");
  assertStringIncludes(block, "original language `en`");
  for (const id of ["openEHR-EHR-OBSERVATION.blood_pressure.v2", "openEHR-EHR-EVALUATION.problem_diagnosis.v1", "openEHR-EHR-COMPOSITION.encounter.v1"]) {
    assertEquals(block.split(id).length - 1, 1, id);
  }
  // Placed directly before the slot tree.
  assert(text.indexOf("## Models") < text.indexOf("\n## Slot tree\n"));
  assertEquals(text.split("## Models").length - 1, 1);
});

Deno.test("Models block: XSD target namespace / root, JSON Schema $id, nothing invented (#277 §7)", async () => {
  const tc = describeModels({ role: "target", format: "xml-schema", filename: "TakeCare-CasenoteWrite-edit01.xsd", content: await Deno.readTextFile(TAKECARE) });
  const tcText = formatModelsBlock([tc]);
  assertStringIncludes(tcText, "root element `ProfdocHISMessage`");
  assertStringIncludes(tcText, "`TakeCare-CasenoteWrite-edit01.xsd`");

  const withId = describeModels({ role: "target", format: "json-schema", filename: "t.schema.json", content: JSON.stringify({ $id: "https://x.invalid/t.json", $schema: "https://json-schema.org/draft/2020-12/schema", title: "T" }) });
  assertStringIncludes(formatModelsBlock([withId]), "$id `https://x.invalid/t.json`");
  const noId = describeModels({ role: "source", format: "json", filename: "s.schema.json", content: JSON.stringify({ title: "S", type: "object" }) });
  const noIdText = formatModelsBlock([noId]);
  assertEquals(noIdText.includes("$id"), false);
  assertStringIncludes(noIdText, "title `S`");
});

Deno.test("stable prefix is byte-identical across fixtures and comes first (#277 §6)", async () => {
  const services = [
    await serviceWith(SDV),
    await serviceWith(MHV1),
    await serviceWith(TAKECARE),
    await serviceWith(join(VITALS, "target.schema.json"), join(VITALS, "source.schema.json")),
  ];
  for (const mode of ["inline", "uri", "attach"] as const) {
    const prefix = stablePromptPrefix("copy", s0Url(services[0]!));
    for (const s of services) {
      const text = prompt(s, mode);
      assert(text.startsWith(prefix), `${mode}: prompt does not start with the stable prefix`);
    }
  }
  const prefix = stablePromptPrefix("copy", s0Url(services[0]!));
  for (const forbidden of ["simple-diagnose", "TakeCare", "Obstetrix", "dummy", "revision", "slotId: `"]) {
    assertEquals(prefix.includes(forbidden), false, forbidden);
  }
  // The api context leaves the prefix to the system message.
  const api = prompt(services[0]!, "api");
  assertEquals(api.includes("## Block examples"), false);
  assertStringIncludes(api, "## Slot tree");
});

function s0Url(s: WorkbenchService): string {
  const text = prompt(s, "inline");
  return text.match(/per: (\S+AI_SUGGESTION_FORMAT\.md)/)![1]!;
}

Deno.test("copy & paste prompt attaches the raw target only when asked (#277 §6)", async () => {
  const s = await serviceWith(SDV);
  const inline = prompt(s, "inline");
  assertEquals(inline.includes("<template xmlns"), false);
  assertStringIncludes(inline, "Attach original target");
  s["controller"].setAiAttachOriginalTarget(true);
  assertStringIncludes(prompt(s, "inline"), "<template xmlns");
});

Deno.test("MCP initialize returns instructions with a version-pinned AGENT_WORKFLOW link (#277 §8)", async () => {
  const service = new WorkbenchService();
  const res = await handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "t" } } },
    new LocalAgentClient(service),
  ) as { instructions: string };
  const text = res.instructions;
  assertStringIncludes(text, "register_agent");
  assertStringIncludes(text, "get_slot");
  assert(/https:\/\/regionstockholm\.github\.io\/intehrgrator\/v\d+\.\d+(\.\d+)?\/docs\/AGENT_WORKFLOW\.md/.test(text), text);
});
