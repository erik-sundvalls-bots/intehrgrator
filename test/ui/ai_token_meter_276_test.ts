/**
 * Browser UI test (#276): the token meter next to Stop counts provider usage
 * live, the ring shows how full the model's context window is, and an
 * optional token budget pauses the chat at 100 % until the user raises it.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr276-*.png (never in CI).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, findSystolicSlotId, loadBpFixtures, waitForMappedSlot, waitForTestApi } from "./helpers.ts";

const ENDPOINT = "https://ai-usage.test/v1/chat/completions";
const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
const delta = (d: Record<string, unknown>, finish?: string) => ({
  choices: [{ index: 0, delta: d, ...(finish ? { finish_reason: finish } : {}) }],
});
const usage = (input: number, output: number, cached = 0) => ({
  choices: [],
  usage: { prompt_tokens: input, completion_tokens: output, prompt_tokens_details: { cached_tokens: cached } },
});

Deno.test({
  name: "UI: AI chat token meter, context ring and token budget (#276)",
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
        localStorage.setItem("intehrgrator.ai.chatCollapsed", "0");
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({ endpoint, apiKey: "test-key", model: "gpt-4o", providerId: "custom" }),
        );
      }, ENDPOINT);
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      const slotId = await findSystolicSlotId(page);

      const bodies: Array<Record<string, unknown>> = [];
      const replies: Array<() => Promise<string>> = [
        // Turn 1, step 1: map systolic.
        () =>
          Promise.resolve(sse([
            delta({ content: "Mapping systolic." }),
            delta({
              tool_calls: [{
                index: 0,
                id: "m1",
                type: "function",
                function: { name: "map_slot", arguments: JSON.stringify({ slotId, path: "$.systolic" }) },
              }],
            }),
            delta({}, "tool_calls"),
            usage(40_000, 200),
          ])),
        // Turn 1, step 2: waits until the test has looked at the live meter.
        async () => {
          await gate;
          return sse([delta({ content: "Done." }), delta({}, "stop"), usage(41_000, 150, 40_000)]);
        },
        // Turn 2 (after a 100k budget): one tool step pushes the chat past the budget.
        () =>
          Promise.resolve(sse([
            delta({ tool_calls: [{ index: 0, id: "l1", type: "function", function: { name: "list_slots", arguments: "{}" } }] }),
            delta({}, "tool_calls"),
            usage(45_000, 100, 41_000),
          ])),
        // "continue" after Raise budget.
        () => Promise.resolve(sse([delta({ content: "All mapped." }), delta({}, "stop"), usage(46_000, 50, 45_000)])),
      ];
      await page.route(ENDPOINT, async (route) => {
        const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
        if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers });
        bodies.push(JSON.parse(route.request().postData() ?? "{}"));
        const reply = replies[bodies.length - 1];
        const body = reply ? await reply() : sse([delta({ content: "?" }, "stop")]);
        await route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body })
          .catch(() => {});
      });

      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      const meter = page.locator("#ai-chat-usage");
      assertEquals(await meter.isVisible(), true, "meter shows with credentials");
      assertEquals((await meter.innerText()).trim(), "0");

      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map the blood pressure source");
      await page.click("#ai-chat-send");
      await waitForMappedSlot(page, slotId, "systolic");
      // Live: step 1's reported usage is on the meter while step 2 runs.
      await page.waitForFunction(() => document.querySelector("#ai-chat-usage")?.textContent?.includes("40k"));
      assertEquals(await page.locator("#ai-chat-stop").isVisible(), true);
      assertEquals(await page.locator("#ai-chat-context-ring").isVisible(), true, "gpt-4o has a known window");
      assertStringIncludes((await meter.getAttribute("title")) ?? "", "of 128k tokens (31 %)");
      if (SHOTS) await page.locator(".ai-chat-panel").screenshot({ path: "/workspace/pr276-running.png" });
      release();
      await page.locator("#ai-chat-send").waitFor({ state: "visible", timeout: 10_000 });
      assertEquals((await meter.innerText()).trim(), "81k");
      const title = (await meter.getAttribute("title")) ?? "";
      assertStringIncludes(title, "This chat: 81k in (40k cached) · 350 out · 2 request(s)");
      assertStringIncludes(title, "Context: 41k of 128k tokens (32 %)");
      assertEquals((bodies[0]!.stream_options as { include_usage?: boolean })?.include_usage, true);

      // Budget: 100k per chat; 81k used is above 80 %.
      await meter.click();
      await page.locator("#ai-chat-usage-popover").waitFor({ state: "visible" });
      await page.fill("#ai-chat-budget", "100k");
      if (SHOTS) {
        const box = (await page.locator(".ai-chat-panel").boundingBox())!;
        await page.screenshot({
          path: "/workspace/pr276-popover.png",
          clip: { x: box.x - 80, y: box.y, width: box.width + 80, height: box.height },
        });
      }
      await page.click("#ai-chat-usage-save");
      assertEquals((await meter.innerText()).trim(), "81k / 100k");
      assert(await meter.evaluate((el) => el.classList.contains("ai-usage-btn--warn")));

      // Turn 2 crosses the budget after one step: the chat pauses with a Raise button.
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map the rest");
      await page.click("#ai-chat-send");
      const raise = page.locator("#ai-chat-raise-budget");
      await raise.waitFor({ state: "visible", timeout: 10_000 });
      assertEquals(bodies.length, 3, "paused after the request that reached the budget");
      assertStringIncludes(await page.locator(".ai-chat-msg--note").last().innerText(), "Paused: this chat used 126k of its 100k token budget");
      assert(await meter.evaluate((el) => el.classList.contains("ai-usage-btn--over")));
      assertStringIncludes(await raise.innerText(), "Raise budget to 200k and continue");
      if (SHOTS) await page.locator(".ai-chat-panel").screenshot({ path: "/workspace/pr276-paused.png" });

      // Send again without raising: still paused, nothing sent.
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("go on");
      await page.click("#ai-chat-send");
      assertEquals(bodies.length, 3);

      await raise.click();
      await page.locator(".ai-chat-msg--assistant", { hasText: "All mapped." }).waitFor({ timeout: 10_000 });
      assertEquals(bodies.length, 4);
      const lastUser = (bodies[3]!.messages as Array<{ role: string; content: string }>).filter((m) => m.role === "user").pop();
      assertEquals(lastUser?.content, "continue");
      assertEquals((await meter.innerText()).trim(), "173k / 200k");
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("intehrgrator.ai.chatLimits") ?? "{}"));
      assertEquals(stored.budget, 200_000);
      if (SHOTS) await page.locator(".ai-chat-panel").screenshot({ path: "/workspace/pr276-continued.png" });

      // Clear history starts a new chat: the meter goes back to 0.
      await page.click("#ai-chat-clear");
      assertEquals((await meter.innerText()).trim(), "0 / 200k");
    } finally {
      release();
      await browser.close();
    }
  },
});
