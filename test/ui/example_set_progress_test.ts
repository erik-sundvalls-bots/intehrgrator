/**
 * MHV1 generic-entry load must say what it is doing, and those words must be
 * on screen before the long canvas placement (#368).
 */

import { assert, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: MHV1 example set paints template progress before the canvas work",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForTestApi(page);
      await page.evaluate(() => {
        const seen: string[] = [];
        (globalThis as unknown as { __progress: string[] }).__progress = seen;
        const overlay = document.getElementById("task-progress-overlay");
        if (!overlay) return;
        new MutationObserver(() => {
          const text = overlay.innerText.replace(/\s+/g, " ").trim();
          if (text && seen[seen.length - 1] !== text) seen.push(text);
        }).observe(overlay, { childList: true, subtree: true, attributes: true, characterData: true });
      });

      const setId = "mhv1-generic-entry-to-prenatal-visit-unmapped";
      await page.click("#btn-example-sets");
      await page.waitForSelector(`[data-example-set-id="${setId}"]`, { timeout: 20_000 });
      const started = Date.now();
      await page.click(`[data-example-set-id="${setId}"]`);
      await page.waitForFunction(() =>
        (document.getElementById("status-main")?.textContent ?? "").includes("Loaded example set"),
        undefined,
        { timeout: 120_000 },
      );
      const wallMs = Date.now() - started;
      const progress = await page.evaluate(() =>
        (globalThis as unknown as { __progress: string[] }).__progress
      );
      const joined = progress.join("\n");
      assertStringIncludes(joined, "Reading the template");
      assertStringIncludes(joined, "Placing the template on the canvas");
      assert(
        progress.some((line) => line.includes("Reading labels ·")),
        `expected a per-language label step, saw:\n${joined}`,
      );
      const placingAt = progress.findIndex((line) => line.includes("Placing the template on the canvas"));
      assert(placingAt >= 0);
      // The placing line is not the last thing written in the same turn as the load finishing.
      assert(progress.length > placingAt + 1, progress.join(" | "));
      console.log(`MHV1 unmapped load ${wallMs}ms`);
    } finally {
      await browser.close();
    }
  },
});
