/**
 * Browser UI (#277 §6): copy & paste prompts carry the slot tree, not the raw
 * OPT, unless **Attach original target** is ticked in the AI menu.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr277-*.png and the tutorial
 * screenshot (never in CI).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";

Deno.test({
  name: "UI: Attach original target toggles the raw OPT in the copied prompt (#277)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      await page.evaluate(() => {
        const w = globalThis as unknown as { __clip?: string };
        w.__clip = "";
        navigator.clipboard.writeText = async (text: string) => {
          w.__clip = text;
        };
      });
      const copyInline = async () => {
        await page.evaluate(() => (globalThis as unknown as { __clip?: string }).__clip = "");
        await page.click("#btn-copy-ai");
        await page.locator("#menu-copy-ai").waitFor({ state: "visible", timeout: 5_000 });
        await page.click('[data-ai-delivery="inline"]');
        await page.waitForFunction(() => Boolean((globalThis as unknown as { __clip?: string }).__clip), { timeout: 10_000 });
        return await page.evaluate(() => (globalThis as unknown as { __clip?: string }).__clip ?? "");
      };

      const lean = await copyInline();
      assertStringIncludes(lean, "## Slot tree");
      assertStringIncludes(lean, "## Models");
      assertEquals(lean.includes("<template xmlns"), false, "raw OPT should not be attached by default");
      assert(lean.startsWith("# intEHRgrator mapping assist"));

      await page.click("#btn-copy-ai");
      const box = page.locator("#menu-ai-attach-target");
      await box.waitFor({ state: "visible", timeout: 5_000 });
      assertEquals(await box.isChecked(), false);
      await box.check();
      if (SHOTS) {
        await page.locator("#menu-copy-ai").screenshot({ path: "/workspace/pr277-attach-target.png" });
        await page.locator("#menu-copy-ai").screenshot({ path: "docs/assets/tutorial/ai-menu-attach-target.png" });
      }
      await page.keyboard.press("Escape");

      const full = await copyInline();
      assertStringIncludes(full, "<template xmlns");
      assert(full.length > lean.length * 3, `${full.length} vs ${lean.length}`);

      // The AI chat copy menu shows the same, project-saved choice.
      const chatChevron = page.locator("#ai-chat-copy-menu-btn");
      if (await chatChevron.isVisible()) {
        await chatChevron.click();
        assertEquals(await page.locator("#ai-chat-attach-target").isChecked(), true);
      }
    } finally {
      await browser.close();
    }
  },
});
