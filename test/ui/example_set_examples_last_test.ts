/**
 * Example sets load Example Instances last: the task overlay goes away once
 * target, source schema and mapping are in, and the examples pane shows its
 * own spinner until the examples arrive.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, getSnapshot, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: example set is usable while its examples load behind an examples-pane spinner",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("dialog", (dialog) => dialog.accept());
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      // Hold the Example Instances so the in-between state is observable.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/dummy-json-vitals/instance-*.json", async (route) => {
        await held;
        await route.continue();
      });

      await page.click("#btn-example-sets");
      const item = page.locator('[data-example-set-id="dummy-json-vitals-mapped"]');
      await item.waitFor({ timeout: 10_000 });
      await item.click();

      const spinner = page.locator("#example-tree [data-examples-loading]");
      await spinner.waitFor({ timeout: 30_000 });
      assertEquals(await spinner.getAttribute("data-examples-loading"), "3");
      assert(await page.locator("#task-progress-overlay").isHidden(), "overlay is gone while examples load");
      const mid = await getSnapshot(page);
      assertEquals(mid.examplesLoading, 3);
      assertEquals(mid.exampleCount, 0);
      assertEquals(mid.taskProgress, null);
      assert(mid.blocklyBlocks.length > 0, "mapping is on the canvas before the examples");
      // The Mapping Editor is usable: the source schema tree is rendered and clickable.
      const firstSchemaRow = page.locator("#schema-tree .tree-row[data-path]").first();
      await firstSchemaRow.waitFor({ timeout: 10_000 });
      await firstSchemaRow.click();

      release();
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi?: { getSnapshot: () => { exampleCount: number; examplesLoading: number | null; statusMessage: string } };
        }).intehrgratorTestApi;
        const snap = api?.getSnapshot();
        return Boolean(
          snap && snap.exampleCount === 3 && snap.examplesLoading === null &&
            snap.statusMessage.startsWith("Loaded example set"),
        );
      }, undefined, { timeout: 30_000 });
      assertEquals(await spinner.count(), 0);
      assertEquals(await page.locator("#example-tabs .example-tab").count(), 3);
    } finally {
      await browser.close();
    }
  },
});
