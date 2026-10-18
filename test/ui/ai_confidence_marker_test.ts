/**
 * Browser UI test (#249 review, Option B): a low-confidence AI suggestion
 * imported via the dialog marks its mapped block (outline + `NN%` badge +
 * comment); the raw confidence and note persist in block data across
 * save / load, and *Mark as reviewed* hides the marker and records the outcome.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  waitForTestApi,
} from "./helpers.ts";

type Api = {
  intehrgratorTestApi: {
    getBlocklyStateJson(): string;
    loadBlocklyJson(filename: string, content: string): void;
  };
};

Deno.test({
  name:
    "UI: low-confidence import shows a marker on the mapped block; Mark as reviewed clears it",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      const slotId = await findSystolicSlotId(page);
      const envelope = {
        format: "intehrgrator-suggestions",
        version: "2",
        suggestions: [{
          slotId,
          block: {
            type: "source_query_number",
            fields: { EXPRESSION: "$.systolic" },
          },
          confidence: 30,
          note: "Guessed path: systolic may be in $.bp.sys",
        }],
      };
      await page.click("#btn-copy-ai");
      await page.click("#btn-import-ai");
      await page.waitForSelector("#dialog-import-ai[open]");
      await page.fill(
        "#import-ai-text",
        "```intehrgrator-suggestions\n" + JSON.stringify(envelope) + "\n```",
      );
      const badge = page.locator("#import-ai-notes .ai-confidence-badge--low");
      await badge.waitFor();
      assertEquals(await badge.innerText(), "30%");
      await page.click("#import-ai-confirm");
      await page.locator("#import-ai-report", { hasText: "Imported: 1 mapping applied" }).waitFor(
        { timeout: 5_000 },
      );
      await page.click("#import-ai-cancel").catch(() =>
        page.keyboard.press("Escape")
      );

      const marker = page.locator(
        "#blockly-mount g.ai-review-marker.ai-review--low",
      );
      await marker.first().waitFor({ state: "attached", timeout: 5_000 });
      assertEquals(
        await page.locator("#blockly-mount .ai-review-badge--low text").first()
          .textContent(),
        "30%",
      );
      const review = (await getSnapshot(page)).model.slots.find((s) =>
        s.slotId === slotId
      )?.review;
      assertEquals(review, {
        confidence: 30,
        note: "Guessed path: systolic may be in $.bp.sys",
      });

      // Save / load keeps the raw value in block data and redraws the marker.
      const spec = await page.evaluate(() =>
        (globalThis as unknown as Api).intehrgratorTestApi.getBlocklyStateJson()
      );
      assertStringIncludes(spec, "aiReview");
      assertStringIncludes(spec, "confidence");
      await page.evaluate(
        (text) =>
          (globalThis as unknown as Api).intehrgratorTestApi.loadBlocklyJson(
            "m.json",
            text,
          ),
        spec,
      );
      await marker.first().waitFor({ state: "attached", timeout: 5_000 });

      // Mark as reviewed (block context menu) → marker hidden, outcome recorded.
      const blockId = await marker.first().getAttribute("data-id");
      await page.evaluate(
        (id) =>
          (globalThis as unknown as {
            intehrgratorTestApi: { scrollBlockIntoView(id: string): void };
          })
            .intehrgratorTestApi.scrollBlockIntoView(id!),
        blockId,
      );
      await page.waitForTimeout(300);
      await marker.first().locator("> path.blocklyPath").click({
        button: "right",
        position: { x: 40, y: 10 },
      });
      await page.locator(".blocklyMenuItem", { hasText: "Mark as reviewed" })
        .click();
      await page.waitForFunction(() =>
        !document.querySelector("#blockly-mount g.ai-review-marker")
      );
      const after = (await getSnapshot(page)).model.slots.find((s) =>
        s.slotId === slotId
      )?.review;
      assertEquals(after?.outcome, "reviewed");
      assertEquals(after?.confidence, 30);
      assert(after?.outcomeAt, "outcome timestamp recorded");
    } finally {
      await browser.close();
    }
  },
});
