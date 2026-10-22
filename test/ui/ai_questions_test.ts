/**
 * Browser UI test (#249 review): an AI chat answer whose Questions are a
 * flat numbered list (question, then two answer options) renders ONE question
 * with two choice buttons. Clicking a choice quotes question + answer into the
 * AI chat input (editable, not sent); Answer quotes only the question.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, findSystolicSlotId, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const ENDPOINT = "https://ai-questions.test/v1/chat/completions";
const QUESTION = "How should missing `bodyPosition` values be handled during blood pressure event creation?";

function answer(slotId: string): string {
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    suggestions: [{ slotId, block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } } }],
  };
  return [
    "```intehrgrator-suggestions",
    JSON.stringify(envelope),
    "```",
    "",
    "### Questions",
    `1. ${QUESTION}`,
    "2. Default to `at1001` (Sitting) (recommended)",
    "3. Do not map `Position` and rely on null flavor / schema-level omission if allowed by downstream validator",
  ].join("\n");
}

Deno.test({
  name: "UI: AI Questions — flat options become choice buttons that prefill the chat input",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate((endpoint) => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
        // Retired "Approve first" select (#252): removed on load, Send applies directly.
        localStorage.setItem("intehrgrator.ai.chatMode", "approve");
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({ endpoint, apiKey: "test-key", model: "stub", providerId: "custom" }),
        );
      }, ENDPOINT);
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      const text = answer(await findSystolicSlotId(page));
      let calls = 0;
      await page.route(ENDPOINT, async (route) => {
        const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
        if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers });
        calls++;
        await route.fulfill({
          status: 200,
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }] }),
        });
      });

      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      assertEquals(await page.locator("#ai-chat-mode").count(), 0, "no Apply / Approve select");
      assertEquals(
        await page.evaluate(() => localStorage.getItem("intehrgrator.ai.chatMode")),
        null,
        "retired chat mode setting migrated away",
      );
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map position");
      await page.click("#ai-chat-send");

      // Send applies the JSON directly (revertible); the import modal is only for pasted answers.
      const chatQ = page.locator(".ai-chat-msg--assistant .ai-notes-question").last();
      await chatQ.waitFor({ state: "visible", timeout: 10_000 });
      assertEquals(await page.locator("#dialog-import-ai[open]").count(), 0, "no import modal on Send");
      assertEquals(await page.locator(".ai-chat-msg--assistant .ai-notes-question").count(), 1);
      const chatChoices = chatQ.locator(".ai-notes-option");
      assertEquals(await chatChoices.count(), 2);
      assertEquals(await chatChoices.first().getAttribute("class"), "ai-notes-option ai-notes-option--recommended");
      await page.locator(".ai-chat-mapping", { hasText: "Imported 1 suggestion" }).waitFor({ timeout: 5_000 });
      assertStringIncludes(await chatQ.locator(".ai-notes-question-text").innerText(), "bodyPosition");
      const choice = chatQ.locator(".ai-notes-option").nth(1);
      assertStringIncludes(await choice.innerText(), "Do not map");

      await choice.click();
      const input = await page.locator("#ai-chat-input").innerText();
      assertStringIncludes(input, `> Q1: ${QUESTION}`);
      assertStringIncludes(input, "Answer: Do not map `Position`");
      assertEquals(calls, 1, "choosing an option does not send");

      // Answer quotes only the question.
      await chatQ.locator(".ai-notes-answer").click();
      const free = await page.locator("#ai-chat-input").innerText();
      assertStringIncludes(free, `> Q1: ${QUESTION}`);
      assertEquals(free.includes("Answer:"), false);
    } finally {
      await browser.close();
    }
  },
});
