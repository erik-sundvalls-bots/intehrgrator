/**
 * Browser UI test (#249 review): the AI CHAT header fits one row at a 360px
 * panel, the trash icon clears history (next prompt carries the full project
 * context again, also after a reload), and the (i) popover explains the
 * controls for copy & paste vs API mode.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const HEADER_IDS = [
  "#ai-chat-title",
  "#ai-chat-info-btn",
  "#ai-chat-prompts-btn",
  "#ai-chat-clear",
  "#ai-chat-toggle",
];

async function setPanelWidth(page: Page, px: number): Promise<void> {
  await page.evaluate((w) => {
    (document.getElementById("output-pane") as HTMLElement).style.flex =
      `0 0 ${w}px`;
  }, px);
  await page.waitForTimeout(150);
}

async function assertOneRow(
  page: Page,
  ids: string[],
  label: string,
): Promise<void> {
  const boxes = [];
  for (const id of ids) {
    const box = await page.locator(id).boundingBox();
    assert(box, `${id} visible (${label})`);
    boxes.push({ id, ...box });
  }
  const centers = boxes.map((b) => b.y + b.height / 2);
  const spread = Math.max(...centers) - Math.min(...centers);
  assert(
    spread < 6,
    `${label}: header controls on one row (centers spread ${spread}px: ${
      JSON.stringify(boxes)
    })`,
  );
  const header = (await page.locator(".ai-chat-header").boundingBox())!;
  assert(
    header.height < 40,
    `${label}: header is one row (${header.height}px)`,
  );
  for (const b of boxes) {
    assert(
      b.x + b.width <= header.x + header.width + 0.5,
      `${label}: ${b.id} inside the header`,
    );
  }
}

async function copyPrompt(page: Page, text: string): Promise<string> {
  await page.locator("#ai-chat-input").click();
  await page.keyboard.type(text);
  await page.click("#ai-chat-copy-prompt");
  await page.waitForFunction(() =>
    document.getElementById("ai-chat-input")!.textContent === ""
  );
  return await page.evaluate(() => navigator.clipboard.readText());
}

Deno.test({
  name:
    "UI: AI chat header on one row, trash clears context, (i) explains controls per mode",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1400, height: 1000 },
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: baseUrl,
      });
      const page = await context.newPage();
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
      });
      await loadBpFixtures(page);
      if (
        await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !==
          "true"
      ) {
        await page.click("#ai-chat-toggle");
      }
      await setPanelWidth(page, 360);
      const panelW =
        (await page.locator("#ai-chat-panel").boundingBox())!.width;
      assert(panelW <= 362, `panel is ~360px (${panelW})`);
      await assertOneRow(page, HEADER_IDS, "copy & paste");
      const clear = page.locator("#ai-chat-clear");
      assertEquals(
        await clear.getAttribute("aria-label"),
        "Clear chat history",
      );
      assertEquals(await clear.locator("svg").count(), 1);
      assertEquals(
        await page.locator("#ai-chat-prompts-btn").getAttribute("aria-label"),
        "Stored prompts",
      );

      // (i) on hover: copy & paste explanation.
      await page.hover("#ai-chat-info-btn");
      const balloon = page.locator("#ai-chat-info-balloon");
      await balloon.waitFor({ state: "visible" });
      assertStringIncludes(
        await balloon.innerText(),
        "start a new chat in your external AI",
      );
      await page.mouse.move(5, 5);
      await balloon.waitFor({ state: "hidden" });
      // … and on click (stays open).
      await page.click("#ai-chat-info-btn");
      await balloon.waitFor({ state: "visible" });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(300);
      assert(await balloon.isVisible(), "click keeps the popover open");
      await page.keyboard.press("Escape");
      await balloon.waitFor({ state: "hidden" });

      // Full context on the first prompt, not on the second; after clear (and reload) again.
      assertStringIncludes(
        await copyPrompt(page, "first"),
        "## Project context",
      );
      assertEquals(
        (await copyPrompt(page, "second")).includes("## Project context"),
        false,
      );
      await clear.click();
      assertStringIncludes(
        await page.locator("#ai-chat-log").innerText(),
        "start a new chat in your external AI",
      );
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      assertStringIncludes(
        await copyPrompt(page, "after clear"),
        "## Project context",
      );

      // API mode: mode select joins the row; (i) explains the fresh context.
      await page.evaluate(() =>
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({
            endpoint: "https://ai.test.invalid/v1/chat/completions",
            apiKey: "k",
            model: "m",
            providerId: "custom",
          }),
        )
      );
      await page.click("#btn-copy-ai");
      await page.click('[data-ai-action="credentials"]');
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-mode").waitFor({ state: "visible" });
      await setPanelWidth(page, 360);
      await assertOneRow(page, [...HEADER_IDS, "#ai-chat-mode"], "API mode");
      await page.hover("#ai-chat-info-btn");
      await balloon.waitFor({ state: "visible" });
      assertStringIncludes(await balloon.innerText(), "starts a fresh context");
      assertStringIncludes(
        await balloon.innerText(),
        "Apply directly / Approve first",
      );
    } finally {
      await browser.close();
    }
  },
});
