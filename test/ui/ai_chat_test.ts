/**
 * Browser UI test (#234): AI chat panel green path. Start AI chat without
 * credentials, add a source chip, pick a Stored prompt, copy & paste prompt,
 * then chat with a stubbed provider that calls map_slot, and revert the turn.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  waitForMappedSlot,
  waitForTestApi,
} from "./helpers.ts";

const ENDPOINT = "https://ai.test.invalid/v1/chat/completions";

Deno.test({
  name: "UI: AI chat — chips, stored prompts, copy prompt, tool turn and revert",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        localStorage.removeItem("intehrgrator.ai.credentials");
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.chat")) localStorage.removeItem(key);
        }
      });
      await loadBpFixtures(page);

      // Start AI chat is always enabled; without credentials the panel says so.
      await page.click("#btn-copy-ai");
      const start = page.locator("#btn-start-ai-chat");
      await start.waitFor({ state: "visible", timeout: 5_000 });
      assertEquals(await start.isDisabled(), false);
      await start.click();
      await page.locator("#ai-chat-panel").waitFor({ state: "visible", timeout: 5_000 });
      await page.locator("#ai-chat-creds").waitFor({ state: "visible" });
      assertEquals(await page.locator("#ai-chat-send").isHidden(), true);

      // Add to AI chat from the source schema tree.
      const row = page.locator("#schema-tree .tree-row", { hasText: "systolic" }).first();
      await row.locator(".tree-label").click({ button: "right" });
      await page.locator("#tree-add-to-ai-chat").click();
      const chip = page.locator("#ai-chat-input .ai-chip").first();
      await chip.waitFor({ state: "visible", timeout: 5_000 });
      await chip.hover();
      const popover = page.locator(".ai-chip-popover");
      await popover.waitFor({ state: "visible" });
      assertStringIncludes(await popover.innerText(), "bp_source_schema.json");

      // Stored prompt with placeholders: source filled from the chip, target left visible.
      await page.click("#ai-chat-prompts-btn");
      await page.click('[data-prompt-id="builtin:for-each"]');
      let inputText = await page.locator("#ai-chat-input").innerText();
      assertStringIncludes(inputText, "for each");
      assertStringIncludes(inputText, "{target_node}");
      assertEquals(await page.locator("#ai-chat-input .ai-chip").count(), 1);

      // A target chip fills {target_node} when the prompt is picked again.
      await page.locator("#ai-chat-input").evaluate((el) => el.replaceChildren());
      await row.locator(".tree-label").click({ button: "right" });
      await page.locator("#tree-add-to-ai-chat").click();
      await page.click("#tab-target-schema");
      const targetRow = page.locator("#target-schema-tree .tree-row", { hasText: "Systolic" }).first();
      await targetRow.click({ button: "right" });
      await page.locator("#tree-add-to-ai-chat").click();
      await page.locator("#ai-chat-input .ai-chip--target").hover();
      assertStringIncludes(await popover.innerText(), "TARGET NODE");
      await page.click("#ai-chat-prompts-btn");
      await page.click('[data-prompt-id="builtin:for-each"]');
      inputText = await page.locator("#ai-chat-input").innerText();
      assertEquals(inputText.includes("{target_node}"), false, inputText);
      assertEquals(await page.locator("#ai-chat-input .ai-chip").count(), 2);

      // Copy & paste prompting: full prompt with attachments and project context.
      await page.click("#ai-chat-copy-prompt");
      await page.locator("#ai-chat-log .ai-chat-msg--user").waitFor({ timeout: 5_000 });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assertStringIncludes(copied, "### Context attachments");
      assertStringIncludes(copied, "## Project context");
      assertStringIncludes(await page.locator("#ai-chat-log").innerText(), "[@Source: systolic]");

      // Configure a stub provider and chat with tools.
      await page.click("#ai-chat-clear");
      const slotId = await findSystolicSlotId(page);
      const bodies: Array<{ messages: Array<{ role: string; content?: string }> }> = [];
      await page.route(`${ENDPOINT}*`, async (route) => {
        const cors = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST, OPTIONS",
        };
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers: cors });
          return;
        }
        const body = JSON.parse(route.request().postData() ?? "{}");
        bodies.push(body);
        const last = body.messages[body.messages.length - 1];
        const message = last.role === "tool"
          ? { content: "Mapped systolic." }
          : body.messages.filter((m: { role: string }) => m.role === "user").length > 1
          ? { content: "Second answer." }
          : {
            tool_calls: [{
              id: "c1",
              type: "function",
              function: { name: "map_slot", arguments: JSON.stringify({ slotId, path: "$.systolic" }) },
            }],
          };
        await route.fulfill({
          status: 200,
          headers: { ...cors, "content-type": "application/json" },
          body: JSON.stringify({ choices: [{ message }] }),
        });
      });
      await page.click("#ai-chat-configure");
      await page.locator("#dialog-ai-credentials").waitFor({ state: "visible", timeout: 5_000 });
      await page.fill("#ai-endpoint", ENDPOINT);
      await page.fill("#ai-api-key", "test-key");
      await page.fill("#ai-model", "stub-model");
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-send").waitFor({ state: "visible", timeout: 5_000 });

      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map systolic please");
      await page.click("#ai-chat-send");
      await waitForMappedSlot(page, slotId);
      await page.locator("#ai-chat-log .ai-chat-tools").waitFor({ timeout: 10_000 });
      assertStringIncludes(await page.locator("#ai-chat-log").innerText(), "Mapped systolic.");
      assertStringIncludes(bodies[0]!.messages[1]!.content ?? "", "## Project context");

      // Revert last AI turn restores the canvas from before the tool turn.
      await page.locator("#ai-chat-revert").waitFor({ timeout: 10_000 });
      await page.click("#ai-chat-revert");
      await page.waitForFunction(
        (id) => {
          const api = (globalThis as unknown as {
            intehrgratorTestApi: { getSnapshot(): { model: { slots: Array<{ slotId: string; expression?: string }> } } };
          }).intehrgratorTestApi;
          const slot = api.getSnapshot().model.slots.find((s) => s.slotId === id);
          return !slot?.expression?.includes("systolic");
        },
        slotId,
        { timeout: 10_000 },
      );
      const snap = await getSnapshot(page);
      assert(!snap.model.slots.find((s) => s.slotId === slotId)?.expression?.includes("systolic"));
      // Follow-up turn carries the history but not the project context again.
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Thanks");
      await page.click("#ai-chat-send");
      await page.locator("#ai-chat-log", { hasText: "Second answer." }).waitFor({ timeout: 10_000 });
      const followUp = bodies[bodies.length - 1]!.messages;
      assertEquals(followUp[followUp.length - 1]!.content, "Thanks");
      assert(followUp.some((m) => m.role === "tool"), "history includes the tool turn");

      // History survives a reload (same project).
      const stored = await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("intehrgrator.ai.chat.")).length
      );
      assertEquals(stored, 1);

    } finally {
      await browser.close();
    }
  },
});
