/**
 * Measure the slot context the AI sees (#277): raw target, the legacy slot
 * manifest and `list_slots` rows, the compact slot tree, and the `api` / copy
 * prompts, for SDV, Obstetrix MHV1, TakeCare (XSD) and dummy-json-vitals.
 * Background numbers for regressions, not limits: the #276 token budget is
 * the limit mechanism.
 *
 *   deno task measure:context             # exact o200k_base counts (js-tiktoken from npm)
 *   deno task measure:context --estimate  # offline: characters / 3
 *
 * No AI is called.
 */
import { join } from "@std/path";
import { WorkbenchService } from "../src/workbench/service.ts";
import { callAgentTool } from "../src/agent/tools.ts";
import { listSlotsInspect } from "../src/agent/inspect.ts";
import { compactJsonRows } from "../src/core/ai/mod.ts";
import { buildSlotTree, formatSlotTree } from "../src/core/ai/slot_tree.ts";
import { tokenCounter } from "./measure_ai_tokens.ts";

const ROOT = join(import.meta.dirname!, "..", "test", "fixtures");
const FIXTURES: Record<string, { target: string; schema?: string; example?: string }> = {
  "SDV": { target: join(ROOT, "simple-diagnose-and-vitals.opt") },
  "MHV1": {
    target: join(ROOT, "Obstetrix-MHV1", "target", "mhv1-prenatal-visit.encounter.v1.opt"),
    schema: join(ROOT, "Obstetrix-MHV1", "source-schema", "obx-mhv1.review-1.schema.json"),
    example: join(ROOT, "Obstetrix-MHV1", "source-instance", "2-ivf-multipara.json"),
  },
  "TakeCare XSD": { target: join(ROOT, "TakeCare", "TakeCare-CasenoteWrite-edit01.xsd") },
  "dummy-json-vitals": {
    target: join(ROOT, "dummy-json-vitals", "target.schema.json"),
    schema: join(ROOT, "dummy-json-vitals", "source.schema.json"),
    example: join(ROOT, "dummy-json-vitals", "instance-1.json"),
  },
};

const name = (path: string) => path.split("/").pop()!;

/** Rows `[measure, text]` for one fixture. */
export async function slotContextTexts(fx: { target: string; schema?: string; example?: string }): Promise<Array<[string, string]>> {
  const service = new WorkbenchService();
  const raw = await Deno.readTextFile(fx.target);
  await callAgentTool(service, "load_target", { filename: name(fx.target), content: raw });
  if (fx.schema) await callAgentTool(service, "load_source_schema", { filename: name(fx.schema), content: await Deno.readTextFile(fx.schema) });
  if (fx.example) await callAgentTool(service, "add_example", { filename: name(fx.example), content: await Deno.readTextFile(fx.example) });
  const { skeleton, model } = service["controller"].getState();
  const rows = listSlotsInspect(skeleton, model).map(({ mapped: _m, ...row }) => row);
  const tree = buildSlotTree(skeleton, { model });
  const c = service["controller"];
  return [
    ["raw target", raw],
    [`legacy manifest rows (${rows.length} slots)`, compactJsonRows(rows)],
    ["list_slots rows (view:rows)", JSON.stringify(await callAgentTool(service, "list_slots", { view: "rows" }))],
    [`slot tree (${tree.length} groups)`, formatSlotTree(tree)],
    ["list_slots (tree, default)", JSON.stringify(await callAgentTool(service, "list_slots", {}))],
    ["prompt api", c.buildAiPromptText("api")],
    ["prompt copy uri", c.buildAiPromptText("uri")],
    ["prompt copy inline", c.buildAiPromptText("inline")],
  ];
}

if (import.meta.main) {
  const tok = await tokenCounter(Deno.args.includes("--estimate"));
  console.log(`Tokens: ${tok.label}\n`);
  console.log("| fixture | measure | tokens |\n|---|---|---:|");
  for (const [fixture, fx] of Object.entries(FIXTURES)) {
    for (const [what, text] of await slotContextTexts(fx)) {
      console.log(`| ${fixture} | ${what} | ${tok.count(text).toLocaleString("en-US")} |`);
    }
  }
}
