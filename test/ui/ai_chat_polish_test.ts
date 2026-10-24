/**
 * Browser UI test (#249): AI chat polish — always-present panel that collapses
 * to a header bar (state remembered), dismissible credentials notice,
 * resizable entry box, Copy prompt split menu, Stored prompts divider, and no
 * built-in Refresh merge prompt.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: AI chat collapse toggle, notice ×, entry resize, copy/paste menu, prompts divider",
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
        localStorage.removeItem("intehrgrator.aiDelivery");
      });
      await loadBpFixtures(page);
      const panel = page.locator("#ai-chat-panel");
      const toggle = page.locator("#ai-chat-toggle");

      // 0. No "Start AI chat" menu item: the chat is always there, collapsed by default.
      assertEquals(await page.locator('#menu-copy-ai [data-ai-action="chat"]').count(), 0);
      await panel.waitFor({ state: "visible", timeout: 5_000 });
      assertEquals(await page.locator("#ai-chat-close").count(), 0);
      assertEquals(await toggle.getAttribute("aria-expanded"), "false");
      assertEquals((await page.locator("#ai-chat-title").innerText()).trim(), "AI CHAT");
      for (const id of ["#ai-chat-prompts-btn", "#ai-chat-clear", "#ai-chat-input"]) {
        assertEquals(await page.locator(id).isVisible(), false, `${id} hidden while collapsed`);
      }
      const barH = (await panel.boundingBox())!.height;
      assert(barH < 48, `collapsed bar is slim (${barH}px)`);
      // Toggle reuses the slide-button square + panel-half svg, solid primary on the light bar.
      const [toggleBg, slideBg] = await page.evaluate(() => [
        getComputedStyle(document.getElementById("ai-chat-toggle")!).backgroundColor,
        getComputedStyle(document.querySelector(".pane-btn:not(.pane-btn-on-dark):not(.ai-chat-toggle)")!).backgroundColor,
      ]);
      assertEquals(toggleBg, slideBg);
      assertEquals(await toggle.locator("svg").count(), 1);
      await toggle.click();
      assertEquals(await toggle.getAttribute("aria-expanded"), "true");
      await page.locator("#ai-chat-input").waitFor({ state: "visible" });
      await page.locator("#ai-chat-prompts-btn").waitFor({ state: "visible" });
      await page.locator("#ai-chat-clear").waitFor({ state: "visible" });
      assertEquals(await page.evaluate(() => localStorage.getItem("intehrgrator.ai.chatCollapsed")), "0");

      // 1. × hides the notice until reload (collapse/expand keeps it hidden).
      const notice = page.locator("#ai-chat-creds");
      await notice.waitFor({ state: "visible" });
      await page.click("#ai-chat-creds-dismiss");
      await notice.waitFor({ state: "hidden" });
      await toggle.click();
      assertEquals(await toggle.getAttribute("aria-expanded"), "false");
      assertEquals(await page.evaluate(() => localStorage.getItem("intehrgrator.ai.chatCollapsed")), "1");
      await toggle.click();
      assertEquals(await notice.isVisible(), false);
      // Expanded state survives a reload; the notice comes back.
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      assertEquals(await toggle.getAttribute("aria-expanded"), "true");
      await notice.waitFor({ state: "visible" });

      // 2. (Notice dismissed so the short chat split has room.) Drag the divider grip up: entry box taller (past the old 9em cap), list shorter.
      await page.click("#ai-chat-creds-dismiss");
      const input = page.locator("#ai-chat-input");
      assertEquals(await input.evaluate((el) => getComputedStyle(el).resize), "none");
      const grip = page.locator("#ai-chat-grip");
      assertEquals(await grip.evaluate((el) => getComputedStyle(el).cursor), "row-resize");
      const before = (await input.boundingBox())!;
      assert(before.height > 0);
      const logBefore = (await page.locator("#ai-chat-log").boundingBox())!;
      const g = (await grip.boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 400, { steps: 8 });
      await page.mouse.up();
      const after = (await input.boundingBox())!;
      const logAfter = (await page.locator("#ai-chat-log").boundingBox())!;
      const fontPx = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(after.height > fontPx * 9 + 10, `height ${after.height} should pass 9em (${fontPx * 9})`);
      assert(after.height > before.height, "drag up grows the entry box");
      assert(logAfter.height < logBefore.height, "drag up shrinks the message list");
      assert(logAfter.height >= 30, `message list keeps a minimum (${logAfter.height})`);
      // Drag down shrinks it again, never below the minimum height.
      const g2 = (await grip.boundingBox())!;
      await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
      await page.mouse.down();
      await page.mouse.move(g2.x + g2.width / 2, g2.y + 600, { steps: 8 });
      await page.mouse.up();
      const shrunk = (await input.boundingBox())!;
      const minPx = await input.evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
      assert(shrunk.height < after.height && shrunk.height >= minPx - 1, `shrunk ${shrunk.height} (min ${minPx})`);
      // Keyboard on the grip also resizes.
      await grip.focus();
      await page.keyboard.press("ArrowUp");
      assert((await input.boundingBox())!.height > shrunk.height, "ArrowUp grows the entry box");
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y - 400, { steps: 8 });
      await page.mouse.up();
      await input.click();
      await page.keyboard.type("Still typing");
      assertStringIncludes(await input.innerText(), "Still typing");

      // 3. Copy prompt split menu mirrors the header copy/paste section.
      await page.click("#ai-chat-copy-menu-btn");
      const menu = page.locator("#ai-chat-copy-menu");
      await menu.waitFor({ state: "visible" });
      const items = await menu.locator(".split-btn-menu-item:not(.split-btn-menu-check)").evaluateAll((els) =>
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
