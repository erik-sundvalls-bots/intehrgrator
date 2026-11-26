/**
 * #390: a large mapped Example Set that also has a defaults map opens in
 * Treemap Overview. Applying the defaults map must hydrate the canonical
 * mapping JSON, not the unmounted Blockly workspace, or the mapping is
 * replaced by an empty canvas and the Treemap shows no tiles.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI #390: lung MDT decision-tables set opens Treemap Overview with its mapping and defaults",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.on("dialog", (dialog) => dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.click("#btn-example-sets");
      const item = page.locator('[data-example-set-id="lung-mdt-form-to-tc-xml-decision-tables"]');
      await item.waitFor({ timeout: 10_000 });
      await item.click();
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi?: { getSnapshot: () => { statusMessage: string; examplesLoading: number | null } };
        }).intehrgratorTestApi;
        const snap = api?.getSnapshot();
        return Boolean(snap && snap.examplesLoading === null && snap.statusMessage.startsWith("Loaded example set"));
      }, undefined, { timeout: 60_000 });
      await page.locator(".tm-title").first().waitFor({ timeout: 10_000 });

      const info = await page.evaluate(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getEditorMode: () => string; getCanonicalBlockCount: () => number };
        }).intehrgratorTestApi;
        return {
          mode: api.getEditorMode(),
          canonical: api.getCanonicalBlockCount(),
          tiles: document.querySelectorAll(".tm-title").length,
          empty: document.querySelector("#treemap-host .treemap-empty")?.textContent ?? null,
        };
      });
      assertEquals(info.mode, "treemap");
      assertEquals(info.empty, null, "Treemap must not show its empty-state message");
      assert(info.tiles > 5, `expected Treemap tiles, got ${info.tiles}`);
      assert(info.canonical > 400, `mapping must survive the defaults map (got ${info.canonical} blocks)`);

      // The defaults map was applied (its values show up on the canvas), and
      // Total Blockly mounts the whole mapping (the JSON holds 325 blocks).
      await page.click("#btn-mode-full");
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getEditorMode: () => string; getMountedBlockCount: () => number };
        }).intehrgratorTestApi;
        return api.getEditorMode() === "full-blockly" && api.getMountedBlockCount() > 300;
      }, undefined, { timeout: 30_000 });
      const hasDefaultsValue = await page.evaluate(() =>
        Array.from(document.querySelectorAll("#blockly-mount .blocklyText")).some((t) => t.textContent === "TMBA")
      );
      assert(hasDefaultsValue, "defaults map values (UserId TMBA) are on the canvas");
    } finally {
      await browser.close();
    }
  },
});
