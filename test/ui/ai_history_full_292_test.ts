/**
 * Browser UI test (#292): when the chat history is above the limit, Send stops
 * with a card (trim / new chat with recap / cancel) instead of dropping old
 * turns on its own.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const ENDPOINT = "https://ai-history.test/v1/chat/completions";
const BIG = "A".repeat(200_000); // ~67k tokens, above the 64k limit of a model with an unknown window

const sse = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

Deno.test({
  name: "UI: AI chat history above the limit pauses Send with choices (#292)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate((endpoint) => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
        localStorage.setItem("intehrgrator.ai.chatCollapsed", "0");
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({ endpoint, apiKey: "test-key", model: "custom-model", providerId: "custom" }),
        );
      }, ENDPOINT);
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
      await page.route(ENDPOINT, async (route) => {
        const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
        if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers });
        bodies.push(JSON.parse(route.request().postData() ?? "{}"));
        const body = sse(bodies.length === 3 ? "Fine." : BIG);
        await route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body })
          .catch(() => {});
      });
      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      const say = async (text: string) => {
        await page.locator("#ai-chat-input").click();
        await page.keyboard.type(text);
        await page.click("#ai-chat-send");
      };
      const idle = () => page.locator("#ai-chat-send").waitFor({ state: "visible", timeout: 10_000 });
      const lastNote = () => page.locator(".ai-chat-msg--note").last().innerText();

      await say("first");
      await idle();
      assertEquals(bodies.length, 1);

      // Above the limit: nothing goes out, the card asks.
      await say("second");
      await page.locator("#ai-chat-history-trim").waitFor({ state: "visible" });
      assertEquals(bodies.length, 1);
      assertStringIncludes(await lastNote(), "Nothing sent");
      await page.click("#ai-chat-history-cancel");
      assertStringIncludes(await lastNote(), "Not sent");
      assertEquals(await page.locator("#ai-chat-history-trim").count(), 0);
      assertStringIncludes(await page.locator("#ai-chat-input").innerText(), "second");

      // Continue with trimmed history: the big old turn is dropped, context re-attached.
      await page.click("#ai-chat-send");
      await page.click("#ai-chat-history-trim");
      await idle();
      assertEquals(bodies.length, 2);
      const sent = bodies[1]!.messages.filter((m) => m.role !== "system");
      assertEquals(sent.some((m) => m.content === BIG), false);
      assertStringIncludes(sent.at(-1)!.content, "second");
      assertStringIncludes(sent.at(-1)!.content, "## Project context");

      // Start new chat with summary: empty wire history plus a recap.
      await say("third");
      await page.click("#ai-chat-history-recap");
      await idle();
      assertEquals(bodies.length, 3);
      const fresh = bodies[2]!.messages.filter((m) => m.role !== "system");
      assertEquals(fresh.length, 1);
      assertStringIncludes(fresh[0]!.content, "third");
      assertStringIncludes(fresh[0]!.content, "## Earlier chat (recap)");
      assertStringIncludes(fresh[0]!.content, "User: first");
      assertStringIncludes(fresh[0]!.content, "## Project context");
    } finally {
      await browser.close();
    }
  },
});
