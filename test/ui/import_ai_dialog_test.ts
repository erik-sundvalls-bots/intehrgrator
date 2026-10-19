/**
 * Browser UI test: Import Suggestions opens a paste dialog that shows
 * parse errors and applied mappings instead of a silent clipboard read.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  waitForMappedSlot,
  waitForTestApi,
} from "./helpers.ts";

Deno.test({
  name: "UI: Import Suggestions dialog shows paste errors and applies mappings",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      await page.click("#btn-copy-ai");
      await page.locator("#menu-copy-ai").waitFor({ state: "visible", timeout: 5_000 });
      await page.click("#btn-import-ai");
      await page.waitForSelector("#dialog-import-ai[open]", { timeout: 5_000 });

      await page.fill("#import-ai-text", "not json at all");
      await page.click("#import-ai-confirm");
      const errorBox = page.locator("#import-ai-report");
      await errorBox.waitFor({ state: "visible", timeout: 5_000 });
      const errorText = await errorBox.innerText();
      assert(errorText.toLowerCase().includes("json") || errorText.toLowerCase().includes("error"), errorText);
      assertEquals(await page.locator("#dialog-import-ai[open]").count(), 1);

      const slotId = await findSystolicSlotId(page);
      const envelope = JSON.stringify({
        version: "2",
        suggestions: [{
          slotId,
          block: {
            type: "source_query_string",
            mutation: { domain: "fontoxpath" },
            fields: { EXPRESSION: "$.systolic" },
          },
        }],
      });
      await page.fill("#import-ai-text", envelope);
      await page.click("#import-ai-confirm");
      await page.waitForFunction(() => {
        const report = document.querySelector("#import-ai-report");
        return Boolean(report && !report.hasAttribute("hidden") && /applied/i.test(report.textContent ?? ""));
      }, { timeout: 5_000 });
      const reportText = await errorBox.innerText();
      assert(reportText.includes("Imported: 1 mapping applied"), reportText);
      // The same text is not imported twice; editing re-enables Import.
      assertEquals(await page.locator("#import-ai-confirm").isDisabled(), true);
      await page.locator("#import-ai-text").press("End");
      await page.locator("#import-ai-text").type(" ");
      assertEquals(await page.locator("#import-ai-confirm").isDisabled(), false);
      assert(
        reportText.toLowerCase().includes("schema") ||
          reportText.includes("source_query") ||
          reportText.includes("format"),
        reportText,
      );
      assertEquals(await page.locator("#import-ai-copy-errors").isVisible(), true);

      await waitForMappedSlot(page, slotId);
      const snap = await getSnapshot(page);
      const mapped = snap.model.slots.find((s) => s.slotId === slotId);
      assert(mapped?.expression?.includes("systolic"), mapped?.expression ?? "(none)");
    } finally {
      await browser.close();
    }
  },
});
