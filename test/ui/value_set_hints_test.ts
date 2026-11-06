/**
 * Hints tab and canvas badge for a multi-code slot (Design C+).
 * The slot stays empty; the tab lists the codes and can dismiss the hint.
 */
import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: value-set hint badge opens the Hints tab and the slot stays empty",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      await page.locator("#tab-hints").click();
      await page.locator("#hints-host:not([hidden])").waitFor();
      const position = page.locator(".hints-row", { hasText: "Position" });
      await position.waitFor();
      await position.click();
      await page.locator(".hints-chip", { hasText: "Standing" }).waitFor();
      await page.locator(".hints-chip", { hasText: "Sitting" }).waitFor();

      const badge = page.locator(".hint-badge").first();
      await badge.waitFor();
      const slotId = await badge.getAttribute("data-slot-id");
      assert(slotId);

      const valueBlock = await page.evaluate((id) => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: {
            getSnapshot: () => { blocklyBlocks: Array<{ type: string; fields?: Record<string, string> }> };
          };
        }).intehrgratorTestApi;
        return api.getSnapshot().blocklyBlocks.some((block) =>
          block.type === "lists_getIndex" ||
          (block.fields?.SLOT_ID === id && block.type === "dv_coded_text")
        );
      }, slotId);
      assertEquals(valueBlock, false);

      await badge.click();
      await page.locator("#tab-hints.active").waitFor();
      await page.locator(`.hints-row[data-hint-slot="${slotId}"][aria-selected="true"]`).waitFor();

      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.locator(".hints-row--dismissed", { hasText: "Position" }).waitFor();
      await page.getByRole("button", { name: "Restore dismissed hints" }).click();
      await page.locator(".hints-row--dismissed", { hasText: "Position" }).waitFor({ state: "detached" });
    } finally {
      await browser.close();
    }
  },
});
