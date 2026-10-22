/**
 * #266: a change to one slot must not rewrite untouched slots. Re-attaching
 * the default context map's `category` (a terminology picker holding a coded
 * text) turned it into `"event"` and dropped code 433, both in the headless
 * Blockly sync (MCP / Agent API, desktop) and on the browser canvas (AI chat).
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { aiChatActor, mcpClientActor } from "@intehrgrator/agent/actor.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import {
  adoptBlocklyState,
  syncModelToBlocklyState,
} from "@intehrgrator/workbench/blockly_sync.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";

const FIX = join(import.meta.dirname!, "fixtures");
const CATEGORY = "//category/DV_CODED_TEXT/value";
const CODED =
  'map("value", "event", "defining_code", map("terminology_id", "openehr", "code_string", "433"))';

async function bp() {
  const service = new WorkbenchService();
  service.loadTemplateContent(
    "blood_pressure.opt",
    await Deno.readTextFile(join(FIX, "blood_pressure.opt")),
  );
  service.addExampleContent(
    "i.json",
    await Deno.readTextFile(join(FIX, "dummy-json-vitals", "instance-1.json")),
  );
  const slots = collectValueSlots(
    service.exportBundle().target?.skeleton ?? [],
  );
  const sys =
    slots.find((s) => s.slotId.endsWith("items/at0004/value/value/value"))!
      .slotId;
  return { service, sys };
}

/** `category` as the model says and as the canonical Blockly JSON says. */
function category(
  service: WorkbenchService,
): { model?: string; canvas?: string } {
  const bundle = service.exportBundle();
  const canvas = adoptBlocklyState(
    bundle.mapping.blocklyState,
    bundle.target?.skeleton ?? [],
    { uiLanguage: "en" },
  );
  return {
    model: bundle.mapping.model.slots.find((s) => s.slotId.endsWith(CATEGORY))
      ?.expression,
    canvas: canvas.extract.slots.find((s) => s.slotId.endsWith(CATEGORY))
      ?.expression,
  };
}

Deno.test("#266: map_slot over MCP keeps the untouched category (model and Blockly JSON)", async () => {
  const { service, sys } = await bp();
  assertEquals(category(service), { model: CODED, canvas: CODED });
  service.setActor(mcpClientActor("cursor"));
  await callAgentTool(service, "map_slot", { slotId: sys, path: "$.systolic" });
  assertEquals(category(service), { model: CODED, canvas: CODED });
});

Deno.test("#266: an AI chat actor's map_slot keeps the category too", async () => {
  const { service, sys } = await bp();
  service.mapNodeToSlot(sys, "$.systolic", "json", undefined, {
    actor: aiChatActor({ model: "m", turnId: "t" }),
  });
  assertEquals(category(service), { model: CODED, canvas: CODED });
});

Deno.test("#266: syncing an unchanged model onto Blockly JSON leaves it as it is", async () => {
  const { service } = await bp();
  const bundle = service.exportBundle();
  const next = syncModelToBlocklyState(
    bundle.mapping.blocklyState,
    bundle.mapping.model,
    bundle.target?.skeleton ?? [],
  );
  assertEquals(next, bundle.mapping.blocklyState);
});
