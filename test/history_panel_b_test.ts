/**
 * ADR 0014 / PR B: in the web app the browser's service records your canvas
 * edits into the one history; the AI author marker is display only (it does
 * not change the revision); the panel's author badges.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  aiChatActor,
  mcpClientActor,
  USER_ACTOR,
} from "@intehrgrator/agent/actor.ts";
import { bundleRevision } from "@intehrgrator/agent/revision.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { createFsHostAdapter } from "../src/host/fs_adapter.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { changedSlots, slotFingerprints } from "../src/blockly/ai_author.ts";
import { authorBadge } from "../src/ui/history_panel.ts";
import type { ProjectBundle } from "@intehrgrator/types/mod.ts";

const FIX = join(import.meta.dirname!, "fixtures");

Deno.test("live canvas: your edits are recorded as your entries, before the next service change", async () => {
  const controller = new WorkbenchController(createFsHostAdapter());
  controller.loadTemplateContent(
    "blood_pressure.opt",
    await Deno.readTextFile(join(FIX, "blood_pressure.opt")),
  );
  const service = new WorkbenchService({ controller });
  const slots = collectValueSlots(
    service.exportBundle().target?.skeleton ?? [],
  );
  const sys =
    slots.find((s) => s.slotId.endsWith("items/at0004/value/value/value"))!
      .slotId;
  const dia =
    slots.find((s) => s.slotId.endsWith("items/at0005/value/value/value"))!
      .slotId;

  // Nothing changed: nothing recorded.
  assertEquals(service.recordLiveChange("Edit mapping"), null);
  // A person maps systolic on the canvas, outside the service.
  controller.mapNodeToSlot(sys, "$.systolic", "json");
  const mine = service.recordLiveChange("Mapped Systolic");
  assertEquals(mine?.actor.displayName, USER_ACTOR.displayName);
  // A person's edit not recorded yet becomes their own entry before an AI write.
  controller.mapNodeToSlot(dia, "$.systolic", "json");
  service.mapNodeToSlot(dia, "$.diastolic", "json", undefined, {
    actor: aiChatActor({ model: "m", turnId: "t" }),
  });
  const [gap, ai] = service.listHistory().slice(-2);
  assertEquals(gap!.actor.origin, "human");
  assertEquals(ai!.actor.origin, "ai-chat");
  // Taking the canvas as recorded (a marker update) records nothing.
  service.acceptLiveState();
  assertEquals(service.recordLiveChange("Edit mapping"), null);
});

Deno.test("the AI author marker does not change the revision", () => {
  const bundle = (data?: string): ProjectBundle =>
    ({
      mapping: {
        model: { slots: [] },
        blocklyState: {
          blocks: {
            blocks: [{ type: "x", id: "b1", ...(data ? { data } : {}) }],
          },
        },
      },
    }) as unknown as ProjectBundle;
  const mark = JSON.stringify({
    aiAuthor: {
      by: "AI chat (m)",
      origin: "ai-chat",
      at: "2026-10-22T10:00:00Z",
    },
  });
  assertEquals(bundleRevision(bundle(mark)), bundleRevision(bundle()));
  const markAndReview = JSON.stringify({
    aiAuthor: { by: "x" },
    aiReview: { confidence: "low" },
  });
  assertEquals(
    bundleRevision(bundle(markAndReview)),
    bundleRevision(bundle(JSON.stringify({ aiReview: { confidence: "low" } }))),
  );
  assert(bundleRevision(bundle(markAndReview)) !== bundleRevision(bundle()));
});

Deno.test("slot fingerprints name the slots a change touched", () => {
  const before = slotFingerprints([{ slotId: "a", expression: "1" }, {
    slotId: "b",
    expression: "2",
  }]);
  const after = slotFingerprints([{ slotId: "a", expression: "1" }, {
    slotId: "b",
    expression: "3",
  }, { slotId: "c" }]);
  assertEquals(changedSlots(before, after), ["b"]);
  assertEquals(
    changedSlots(before, slotFingerprints([{ slotId: "a", expression: "1" }])),
    ["b"],
  );
});

Deno.test("history author badges: you, AI chat + model, MCP + client", () => {
  assertEquals(authorBadge(USER_ACTOR), { origin: "human", label: "You" });
  assertEquals(authorBadge(aiChatActor({ model: "qwen3" })), {
    origin: "ai-chat",
    label: "AI chat",
    detail: "qwen3",
  });
  assertEquals(
    authorBadge(aiChatActor({ provider: "copy-paste" })).detail,
    "pasted",
  );
  assertEquals(authorBadge(mcpClientActor("cursor")), {
    origin: "mcp",
    label: "MCP",
    detail: "cursor",
  });
});
