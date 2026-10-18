/**
 * Browser UI test (#249): AI chat polish — dismissible credentials notice,
 * resizable entry box, Copy prompt split menu, Stored prompts divider, and no
 * built-in Refresh merge prompt.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: AI chat notice ×, entry resize, copy/paste menu, prompts divider",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        localStorage.removeItem("intehrgrator.ai.credentials");
        localStorage.removeItem("intehrgrator.ai.chatOpen");
        localStorage.removeItem("intehrgrator.aiDelivery");
      });
      await loadBpFixtures(page);
      const openChat = async () => {
        await page.click("#btn-copy-ai");
        await page.click("#btn-start-ai-chat");
        await page.locator("#ai-chat-panel").waitFor({ state: "visible", timeout: 5_000 });
      };
      await openChat();

      // 1. × hides the notice for this opening only.
      const notice = page.locator("#ai-chat-creds");
      await notice.waitFor({ state: "visible" });
      await page.click("#ai-chat-creds-dismiss");
      await notice.waitFor({ state: "hidden" });
      await page.click("#ai-chat-close");
      await openChat();
      await notice.waitFor({ state: "visible" });

      // 2. Drag the entry box taller than the old 9em cap.
      const input = page.locator("#ai-chat-input");
      const before = (await input.boundingBox())!;
      await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
      await page.mouse.down();
      await page.mouse.move(before.x + before.width - 3, before.y + before.height + 220, { steps: 8 });
      await page.mouse.up();
      const after = (await input.boundingBox())!;
      const fontPx = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(after.height > fontPx * 9 + 10, `height ${after.height} should pass 9em (${fontPx * 9})`);
      await input.click();
      await page.keyboard.type("Still typing");
      assertStringIncludes(await input.innerText(), "Still typing");

      // 3. Copy prompt split menu mirrors the header copy/paste section.
      await page.click("#ai-chat-copy-menu-btn");
      const menu = page.locator("#ai-chat-copy-menu");
      await menu.waitFor({ state: "visible" });
      const items = await menu.locator(".split-btn-menu-item").evaluateAll((els) =>
        els.map((el) => [el.querySelector(".material-symbols-outlined")?.textContent, el.textContent?.trim()])
      );
      assertEquals(items.map(([icon]) => icon), ["content_copy", "content_copy", "content_copy"]);
      assertStringIncludes(String(items[0]![1]), "Embed files in prompt");
      assertStringIncludes(String(items[1]![1]), "Attach files in chat");
      assertStringIncludes(String(items[2]![1]), "Browse URIs");
      // Menu icons stay dark on white; button icons follow the light button text.
      const menuIconColor = await menu.locator(".split-btn-menu-icon").first().evaluate((el) => getComputedStyle(el).color);
      const btnIcon = await page.locator("#ai-chat-copy-prompt .split-btn-menu-icon").evaluate((el) => [
        getComputedStyle(el).color,
        getComputedStyle(el.closest("button")!).color,
      ]);
      assertEquals(btnIcon[0], btnIcon[1]);
      assert(menuIconColor !== btnIcon[0], `menu icon ${menuIconColor} should differ from button text ${btnIcon[0]}`);
      assertEquals(
        await page.locator("#ai-chat-import-answer .material-symbols-outlined").textContent(),
        "content_paste",
      );
      await page.click('[data-ai-chat-delivery="attach"]');
      await page.locator("#ai-chat-log .ai-chat-msg--user").waitFor({ timeout: 5_000 });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assertStringIncludes(copied, "Still typing");
      assertStringIncludes(copied, "## Project context");
      assertEquals(await page.evaluate(() => localStorage.getItem("intehrgrator.aiDelivery")), "attach");
      await page.click("#ai-chat-import-answer");
      await page.waitForSelector("#dialog-import-ai[open]", { timeout: 5_000 });
      await page.click("#import-ai-cancel");

      // 4 + 5. Stored prompts: visible divider above file actions; no Refresh merge.
      await page.click("#ai-chat-prompts-btn");
      await page.locator("#ai-chat-prompts-menu").waitFor({ state: "visible" });
      assertEquals(await page.locator('[data-prompt-id="builtin:refresh-merge"]').count(), 0);
      assertEquals(await page.locator('[data-prompt-id="builtin:map-project"]').count(), 1);
      assertEquals(await page.locator('[data-prompt-id="builtin:for-each"]').count(), 1);
      const divider = await page.locator("#ai-chat-add-prompt-file").evaluate((el) => {
        const prev = el.previousElementSibling as HTMLElement | null;
        return prev && prev.classList.contains("split-btn-menu-separator")
          ? getComputedStyle(prev).borderTopWidth
          : null;
      });
      assertEquals(divider, "1px");
    } finally {
      await browser.close();
    }
  },
});
