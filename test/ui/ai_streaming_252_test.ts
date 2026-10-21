/**
 * Browser UI test (#252, streaming from #251): with AI credentials, Send streams
 * the tool loop into a live bubble (reasoning tail, ✓ line per applied mapping),
 * the Send button becomes Stop while the run is going, and Stop ends the run
 * cleanly (mapping kept, Revert offered). Retired settings ("How AI chat maps",
 * the Apply / Approve select) are migrated away.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr252-*.png (never in CI).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, findSystolicSlotId, loadBpFixtures, waitForMappedSlot, waitForTestApi } from "./helpers.ts";

const ENDPOINT = "https://ai-stream.test/v1/chat/completions";
const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
const delta = (d: Record<string, unknown>, finish?: string) => ({
  choices: [{ index: 0, delta: d, ...(finish ? { finish_reason: finish } : {}) }],
});

Deno.test({
  name: "UI: AI chat streams the tool loop, shows a mapping line, and Stop ends the run",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate((endpoint) => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
        localStorage.setItem("intehrgrator.ai.chatMode", "approve");
        localStorage.setItem("intehrgrator.ai.chatCollapsed", "0");
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({ endpoint, apiKey: "test-key", model: "stub", providerId: "custom", mappingMode: "suggestions" }),
        );
      }, ENDPOINT);
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      const slotId = await findSystolicSlotId(page);

      // Settings migration: the retired keys/fields are gone after load.
      const stored = await page.evaluate(() => ({
        creds: JSON.parse(localStorage.getItem("intehrgrator.ai.credentials") ?? "{}"),
        mode: localStorage.getItem("intehrgrator.ai.chatMode"),
      }));
      assertEquals(stored.creds.mappingMode, undefined);
      assertEquals(stored.creds.model, "stub");
      assertEquals(stored.mode, null);

      const bodies: Array<Record<string, unknown>> = [];
      await page.route(ENDPOINT, async (route) => {
        const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
        if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers });
        bodies.push(JSON.parse(route.request().postData() ?? "{}"));
        if (bodies.length === 1) {
          return await route.fulfill({
            status: 200,
            headers: { ...headers, "content-type": "text/event-stream" },
            body: sse([
              delta({ reasoning_content: "The source has systolic at $.systolic; " }),
              delta({ reasoning_content: "map it to the Systolic slot first." }),
              delta({ content: "Mapping systolic first." }),
              delta({
                tool_calls: [{
                  index: 0,
                  id: "m1",
                  type: "function",
                  function: { name: "map_slot", arguments: JSON.stringify({ slotId, path: "$.systolic" }) },
                }],
              }),
              delta({}, "tool_calls"),
            ]),
          });
        }
        // Step 2 "hangs" (a run going wrong) until the test ends.
        await gate;
        await route.fulfill({ status: 200, headers, body: "{}" }).catch(() => {});
      });

      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map the blood pressure source");
      await page.click("#ai-chat-send");

      // Live bubble: streamed text, reasoning tail, ✓ mapping line; Stop replaces Send.
      const live = page.locator("#ai-chat-live");
      await live.locator(".ai-chat-mapping").waitFor({ state: "visible", timeout: 10_000 });
      assertStringIncludes(await live.locator(".ai-chat-mapping").innerText(), "Mapped ");
      assertStringIncludes(await live.locator(".ai-chat-mapping").innerText(), "← $.systolic");
      assertStringIncludes(await live.locator(".ai-chat-text").innerText(), "Mapping systolic first.");
      assertStringIncludes(await live.locator(".ai-chat-reasoning").innerText(), "Systolic slot first");
      assertEquals(await page.locator("#ai-chat-stop").isVisible(), true);
      assertEquals(await page.locator("#ai-chat-send").isVisible(), false);
      await waitForMappedSlot(page, slotId, "systolic");
      assertEquals(await page.locator("#ai-chat-copy-prompt").isVisible(), false, "only Stop while running");
      if (SHOTS) await page.screenshot({ path: "/workspace/pr252-streaming.png" });

      // The request was streamed with the compact api context and the tools.
      const first = bodies[0]!;
      assertEquals(first.stream, true);
      assert(Array.isArray(first.tools) && (first.tools as unknown[]).length > 0);
      const user = String((first.messages as Array<{ role: string; content: string }>)[1]!.content);
      assertStringIncludes(user, "## Source tree");
      assertEquals(user.includes("--intehrgrator-part"), false, "no file bodies");
      assertEquals(user.includes("Return exactly one"), false, "no JSON-only instruction");

      await page.click("#ai-chat-stop");
      await page.locator(".ai-chat-msg--note", { hasText: "Stopped." }).waitFor({ timeout: 10_000 });
      assertEquals(await page.locator("#ai-chat-live").count(), 0);
      assertEquals(await page.locator("#ai-chat-stop").isVisible(), false);
      assertEquals(await page.locator("#ai-chat-send").isVisible(), true);
      // The mapping made before Stop stays, with its line and a Revert.
      const last = page.locator(".ai-chat-msg--assistant").last();
      assertStringIncludes(await last.locator(".ai-chat-mapping").innerText(), "← $.systolic");
      await page.locator("#ai-chat-revert").waitFor({ state: "visible" });
      if (SHOTS) await page.screenshot({ path: "/workspace/pr252-stopped.png" });
      assertEquals(bodies.length, 2, "nothing is sent after Stop");

      // Credentials dialog: no "How AI chat maps" fieldset any more.
      await page.click("#btn-copy-ai");
      await page.click('[data-ai-action="credentials"]');
      await page.locator("#dialog-ai-credentials").waitFor({ state: "visible", timeout: 5_000 });
      assertEquals(await page.locator("#dialog-ai-credentials .ai-mapping-mode").count(), 0);
      assertEquals((await page.locator("#dialog-ai-credentials").innerText()).includes("How AI chat maps"), false);
      if (SHOTS) await page.locator("#dialog-ai-credentials").screenshot({ path: "/workspace/pr252-credentials.png" });
    } finally {
      release();
      await browser.close();
    }
  },
});
