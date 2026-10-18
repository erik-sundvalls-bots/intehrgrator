/**
 * Browser UI test (#249 review, Option C): Notes / Questions outside the
 * suggestions fence, plus per-suggestion `note` fields, show in the Import AI
 * suggestions dialog and in the AI chat; **Answer** quotes a question into chat.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSystolicSlotId,
  loadBpFixtures,
  waitForTestApi,
} from "./helpers.ts";

const ENDPOINT = "https://ai-notes.test/v1/chat/completions";

function answer(slotId: string): string {
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    suggestions: [{
      slotId,
      block: {
        type: "source_query_number",
        fields: { EXPRESSION: "$.systolic" },
      },
      note: "Assumed mmHg; source has no unit field",
    }],
  };
  return [
    "Mapped systolic.",
    "",
    "```intehrgrator-suggestions",
    JSON.stringify(envelope, null, 2),
    "```",
    "",
    "### Notes",
    "- Skipped diastolic: two candidate fields.",
    "",
    "### Questions",
    "1. Use `$.bp.dia` or `$.diastolic` for diastolic? (a / b)",
  ].join("\n");
}

Deno.test({
  name: "UI: AI Notes / Questions in the import dialog and the AI chat",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
      });
      await loadBpFixtures(page);
      const slotId = await findSystolicSlotId(page);
      const text = answer(slotId);

      // Cut & paste: the import dialog shows notes, questions and the per-suggestion note.
      await page.click("#btn-copy-ai");
      await page.click("#btn-import-ai");
      await page.waitForSelector("#dialog-import-ai[open]", { timeout: 5_000 });
      await page.fill("#import-ai-text", text);
      const box = page.locator("#import-ai-notes");
      await box.waitFor({ state: "visible" });
      assertStringIncludes(
        await box.innerText(),
        "Skipped diastolic: two candidate fields.",
      );
      assertStringIncludes(
        await box.innerText(),
        "Use `$.bp.dia` or `$.diastolic`",
      );
      const slotNote = box.locator(".ai-notes-slot-note");
      assertStringIncludes(await slotNote.innerText(), "Assumed mmHg");
      assertEquals(
        await slotNote.locator("code").getAttribute("title"),
        slotId,
      );
      assert(
        !(await slotNote.locator("code").innerText()).includes("/"),
        "slot shown by its path label",
      );
      // Import still applies the suggestion despite the surrounding prose.
      await page.click("#import-ai-confirm");
      await page.locator("#import-ai-report", { hasText: "1 applied" }).waitFor(
        { timeout: 5_000 },
      );
      // Answer → dialog closes, chat expands with the question quoted.
      await box.locator(".ai-notes-answer").first().click();
      await page.waitForSelector("#dialog-import-ai:not([open])", {
        state: "attached",
      });
      assertEquals(
        await page.locator("#ai-chat-toggle").getAttribute("aria-expanded"),
        "true",
      );
      assertStringIncludes(
        await page.locator("#ai-chat-input").innerText(),
        "> Q1: Use `$.bp.dia`",
      );

      // AI chat (apply directly, provider stub): the final answer's notes render as a box.
      await page.route(ENDPOINT, async (route) => {
        const headers = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        };
        if (route.request().method() === "OPTIONS") {
          return await route.fulfill({ status: 204, headers });
        }
        await route.fulfill({
          status: 200,
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            choices: [{ message: { role: "assistant", content: text } }],
          }),
        });
      });
      await page.evaluate((endpoint) => {
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({
            endpoint,
            apiKey: "test-key-123",
            model: "stub",
            providerId: "custom",
          }),
        );
      }, ENDPOINT);
      await page.click("#btn-copy-ai");
      await page.click('[data-ai-action="credentials"]');
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-send").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await page.locator("#ai-chat-input").click();
      await page.keyboard.press("End");
      await page.keyboard.type(" a");
      await page.click("#ai-chat-send");
      const chatBox = page.locator(".ai-chat-msg--assistant .ai-notes").last();
      await chatBox.waitFor({ timeout: 10_000 });
      assertStringIncludes(await chatBox.innerText(), "Skipped diastolic");
      assertStringIncludes(await chatBox.innerText(), "Assumed mmHg");
      const body = await page.locator(".ai-chat-msg--assistant .ai-chat-text")
        .last().innerText();
      assertStringIncludes(body, "Mapped systolic.");
      assertEquals(
        body.includes("### Notes"),
        false,
        "sections move out of the message text",
      );
      await chatBox.locator(".ai-notes-answer").click();
      assertStringIncludes(
        await page.locator("#ai-chat-input").innerText(),
        "> Q1:",
      );
    } finally {
      await browser.close();
    }
  },
});
