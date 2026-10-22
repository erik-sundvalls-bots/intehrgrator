/**
 * Retake the screenshots of docs/tutorial/ai-in-the-web-app.md.
 *
 * Needs a running dev server (`deno task build && deno task dev`). The AI
 * provider is a Playwright route on the Ollama local endpoint that streams a
 * canned answer, so no API key is used, stored or shown.
 *
 *   UI_TEST_BASE_URL=http://127.0.0.1:5173 deno run -A scripts/tutorial_ai_screenshots.ts
 */
import { chromium, type Page } from "npm:playwright@1.51.0";
import { findSystolicSlotId, loadBpFixtures, waitForMappedSlot, waitForTestApi } from "../test/ui/helpers.ts";

const base = Deno.env.get("UI_TEST_BASE_URL") ?? "http://127.0.0.1:5173";
const out = new URL("../docs/assets/tutorial/", import.meta.url).pathname;
const ENDPOINT = "http://localhost:11434/v1/chat/completions";

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const delta = (d: Record<string, unknown>, finish?: string) => ({
  choices: [{ index: 0, delta: d, ...(finish ? { finish_reason: finish } : {}) }],
});

async function openApp(page: Page, credentials: boolean): Promise<void> {
  await page.goto(`${base}/?testMode=1`, { waitUntil: "networkidle" });
  await waitForTestApi(page);
  await page.evaluate(({ endpoint, credentials }) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
    localStorage.setItem("intehrgrator.ai.chatCollapsed", "0");
    if (credentials) {
      localStorage.setItem(
        "intehrgrator.ai.credentials",
        // Ollama local ignores the key; "ollama" is its documented dummy value.
        JSON.stringify({ endpoint, apiKey: "ollama", model: "qwen3", providerId: "ollama-local" }),
      );
    }
  }, { endpoint: ENDPOINT, credentials });
  await page.reload({ waitUntil: "networkidle" });
  await waitForTestApi(page);
  await loadBpFixtures(page);
}

const browser = await chromium.launch({ headless: true });
try {
  // 1. AI menu.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await openApp(page, false);
    await page.click("#btn-copy-ai");
    const menu = page.locator("#menu-copy-ai");
    await menu.waitFor({ state: "visible" });
    const box = (await menu.boundingBox())!;
    await page.screenshot({
      path: `${out}ai-menu.png`,
      clip: { x: 0, y: 0, width: Math.ceil(box.x + box.width + 160), height: Math.ceil(box.y + box.height + 40) },
    });
    await page.close();
  }

  // 2. AI chat without credentials: copy & paste.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await openApp(page, false);
    await page.locator("#ai-chat-input").click();
    await page.keyboard.type("Map the blood pressure source");
    await page.locator("#ai-chat-panel").screenshot({ path: `${out}ai-chat-copy-paste.png` });
    await page.close();
  }

  // 3. Credentials dialog (Ollama local preset, dummy key masked).
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openApp(page, true);
    await page.click("#btn-copy-ai");
    await page.click('[data-ai-action="credentials"]');
    const dialog = page.locator("#dialog-ai-credentials");
    await dialog.waitFor({ state: "visible" });
    await dialog.screenshot({ path: `${out}ai-credentials.png` });
    await page.close();
  }

  // 4. Streaming turn with a ✓ line and Stop, then 5. the finished turn.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    await openApp(page, true);
    const slotId = await findSystolicSlotId(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    await page.route(ENDPOINT, async (route) => {
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
      if (route.request().method() === "OPTIONS") return await route.fulfill({ status: 204, headers });
      calls++;
      const stream = { ...headers, "content-type": "text/event-stream" };
      if (calls === 1) {
        return await route.fulfill({
          status: 200,
          headers: stream,
          body: sse([
            delta({ reasoning_content: "The source has systolic at $.systolic; map it to the Systolic slot first." }),
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
      if (calls === 2) await gate;
      return await route.fulfill({
        status: 200,
        headers: stream,
        body: sse([delta({ content: "Systolic is mapped. Run Test to check the output." }), delta({}, "stop")]),
      });
    });
    await page.locator("#ai-chat-input").click();
    await page.keyboard.type("Map the blood pressure source");
    await page.click("#ai-chat-send");
    await page.locator("#ai-chat-live .ai-chat-mapping").waitFor({ state: "visible", timeout: 10_000 });
    await waitForMappedSlot(page, slotId, "systolic");
    await page.waitForTimeout(400);
    const right = (await page.locator("#ai-chat-panel").boundingBox())!;
    await page.screenshot({
      path: `${out}ai-chat-streaming.png`,
      clip: { x: right.x - 8, y: right.y - 8, width: right.width + 16, height: right.height + 16 },
    });
    release();
    await page.locator(".ai-chat-msg--assistant", { hasText: "Systolic is mapped" }).waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.locator("#ai-chat-panel").screenshot({ path: `${out}ai-chat-done.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Wrote screenshots to ${out}`);
