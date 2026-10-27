/**
 * Browser UI test (#274): the block context menu maps a DV_TEXT slot as
 * DV_CODED_TEXT and back; each switch is one undo step.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, getSnapshot, waitForTestApi } from "./helpers.ts";

const DIAGNOSIS =
  "simple-diagnose-and-vitals//content[openEHR-EHR-EVALUATION.problem_diagnosis.v1]/data/at0001/items/at0002/value/DV_TEXT/value";

type Api = {
  getSnapshot(): {
    blocklyBlocks: Array<{ id: string; type: string; slotId?: string }>;
  };
  scrollBlockIntoView(id: string): void;
  getBlockClientRect(
    id: string,
  ): { x: number; y: number; width: number; height: number } | null;
  undo(): void;
};

async function textShell(page: Page): Promise<{ id: string; type: string }> {
  const shell = await page.evaluate((slot) => {
    const api = (globalThis as unknown as { intehrgratorTestApi: Api })
      .intehrgratorTestApi;
    const b = api.getSnapshot().blocklyBlocks.find((x) =>
      x.slotId === slot && (x.type === "dv_text" || x.type === "dv_coded_text")
    );
    return b ? { id: b.id, type: b.type } : null;
  }, DIAGNOSIS);
  assert(shell, "no DV_TEXT shell for Problem/Diagnosis name");
  return shell;
}

async function rmType(page: Page): Promise<string | undefined> {
  return (await getSnapshot(page)).model.slots.find((s) =>
    s.slotId === DIAGNOSIS
  )?.rmType;
}

async function openMenuOn(page: Page, id: string): Promise<void> {
  await page.evaluate((blockId) => {
    (globalThis as unknown as { intehrgratorTestApi: Api }).intehrgratorTestApi
      .scrollBlockIntoView(blockId);
  }, id);
  await page.waitForTimeout(300);
  const rect = await page.evaluate(
    (blockId) =>
      (globalThis as unknown as { intehrgratorTestApi: Api })
        .intehrgratorTestApi.getBlockClientRect(blockId),
    id,
  );
  assert(rect, "shell not rendered");
  await page.mouse.click(rect.x + 8, rect.y + Math.min(8, rect.height / 2), {
    button: "right",
  });
}

Deno.test({
  name:
    "UI: #274 context menu switches DV_TEXT to DV_CODED_TEXT and back, with undo",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1600, height: 1000 },
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      page.on("dialog", (dialog) => dialog.accept());
      await page.click("#btn-example-sets");
      await page.locator('[data-example-set-id="Simple-vitals-series"]')
        .click();
      await page.waitForFunction(
        (slot) => {
          const api = (globalThis as unknown as {
            intehrgratorTestApi?: {
              getSnapshot(): { model: { slots: Array<{ slotId: string }> } };
            };
          }).intehrgratorTestApi;
          return Boolean(
            api?.getSnapshot().model.slots.some((s) => s.slotId === slot),
          );
        },
        DIAGNOSIS,
        { timeout: 20_000 },
      );
      assertEquals(await rmType(page), "DV_TEXT");

      const plain = await textShell(page);
      assertEquals(plain.type, "dv_text");
      await openMenuOn(page, plain.id);
      const toCoded = page.locator(".blocklyContextMenu").getByText(
        "Use coded text (DV_CODED_TEXT)",
      );
      await toCoded.waitFor({ timeout: 5_000 });
      await toCoded.click();
      await page.waitForTimeout(500);
      assertEquals((await textShell(page)).type, "dv_coded_text");
      assertEquals(await rmType(page), "DV_CODED_TEXT");

      await page.evaluate(() =>
        (globalThis as unknown as { intehrgratorTestApi: Api })
          .intehrgratorTestApi.undo()
      );
      await page.waitForTimeout(300);
      assertEquals((await textShell(page)).type, "dv_text");
      assertEquals(await rmType(page), "DV_TEXT");

      // The menu offers the way back on a coded shell.
      await page.evaluate(() =>
        (globalThis as unknown as { intehrgratorTestApi: { redo(): void } })
          .intehrgratorTestApi.redo()
      );
      await page.waitForTimeout(300);
      const coded = await textShell(page);
      assertEquals(coded.type, "dv_coded_text");
      await openMenuOn(page, coded.id);
      const toPlain = page.locator(".blocklyContextMenu").getByText(
        "Use plain text (DV_TEXT)",
      );
      await toPlain.waitFor({ timeout: 5_000 });
      await toPlain.click();
      await page.waitForTimeout(500);
      assertEquals((await textShell(page)).type, "dv_text");
      assertEquals(await rmType(page), "DV_TEXT");
    } finally {
      await browser.close();
    }
  },
});
