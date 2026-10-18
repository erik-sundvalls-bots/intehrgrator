/**
 * Browser UI test (#249 preview bug): a Gemini-shaped provider sends a tool
 * call with `extra_content.google.thought_signature` (400 if it is not sent
 * back), then an answer cut off at max_tokens (finish_reason "length").
 * The chat must keep tools mode (no silent approve-first fallback) and say
 * the answer was truncated instead of just showing half a JSON block.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const ENDPOINT = "https://ai.test.invalid/v1beta/openai/chat/completions";
const CUT = 'Looking at the loop.\n\n```json\n{"version":"2","loops":[{"attachSlotId":"x","block":{"type":"for_each_list",';

Deno.test({
  name: "UI: AI chat — truncated answer is flagged; Gemini thought signature keeps tools mode",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
      });
      await loadBpFixtures(page);
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, OPTIONS",
      };
      let requests = 0;
      await page.route(`${ENDPOINT}*`, async (route) => {
        if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers: cors });
        requests++;
        const body = JSON.parse(route.request().postData() ?? "{}");
        const call = body.messages.find((m: { tool_calls?: unknown[] }) => m.tool_calls)?.tool_calls?.[0];
        const reply = (status: number, payload: unknown) =>
          route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(payload) });
        if (!call) {
          return await reply(200, {
            choices: [{
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "fc1",
                  type: "function",
                  function: { name: "get_snapshot", arguments: "{}" },
                  extra_content: { google: { thought_signature: "SIG-1" } },
                }],
              },
            }],
          });
        }
        if (call.extra_content?.google?.thought_signature !== "SIG-1") {
          return await reply(400, [{
            error: {
              code: 400,
              message: "Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly.",
            },
          }]);
        }
        return await reply(200, { choices: [{ finish_reason: "length", message: { role: "assistant", content: CUT } }] });
      });

      await page.locator("#ai-chat-panel").waitFor({ state: "visible", timeout: 5_000 });
      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      await page.click("#ai-chat-configure");
      await page.locator("#dialog-ai-credentials").waitFor({ state: "visible", timeout: 5_000 });
      await page.fill("#ai-endpoint", ENDPOINT);
      await page.fill("#ai-api-key", "test-key");
      await page.fill("#ai-model", "gemini-3.8-flash");
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-send").waitFor({ state: "visible", timeout: 5_000 });

      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Help me create a loop");
      await page.click("#ai-chat-send");
      const note = page.locator("#ai-chat-log .ai-chat-msg--note", { hasText: "cut off" });
      await note.waitFor({ timeout: 10_000 });
      const log = await page.locator("#ai-chat-log").innerText();
      assertStringIncludes(log, "Looking at the loop.", "the beginning of the answer is shown");
      assertEquals(log.includes("rejected the mapping tools"), false, "no silent approve-first fallback");
      assertEquals(requests, 2);
      assertEquals(await page.locator("#dialog-import-ai[open]").count(), 0, "nothing to import");
    } finally {
      await browser.close();
    }
  },
});
