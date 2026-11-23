/**
 * Browser UI test: Mapping Editor Undo reverses a Click-to-Map action.
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
  clickBlocklyBlock,
  findElementBlockId,
} from "./helpers.ts";

Deno.test({
  name: "UI: undo reverses Click-to-Map and redo restores it",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      const slotId = await findSystolicSlotId(page);
      const blockId = await findElementBlockId(page, slotId);
      await clickBlocklyBlock(page, blockId);
      await page.click('#example-tree .tree-row[data-path="$.systolic"] .tree-label');
      await waitForMappedSlot(page, slotId);
      const beforeUndo = await page.evaluate(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: {
            undoCount(): number;
            redoCount(): number;
            undoEventTypes(): string[];
          };
        }).intehrgratorTestApi;
        const undoBtn = document.getElementById("btn-undo") as HTMLButtonElement | null;
        return {
          undo: api.undoCount(),
          redo: api.redoCount(),
          types: api.undoEventTypes(),
          undoDisabled: Boolean(undoBtn?.disabled),
        };
      });
      if (beforeUndo.undoDisabled || beforeUndo.undo === 0) {
        throw new Error(`Undo not recorded after Click-to-Map: ${JSON.stringify(beforeUndo)}`);
      }
      const canvasSwaps = beforeUndo.types.filter((t) => t === "intehr_canvas_swap");
      assertEquals(
        canvasSwaps.length,
        1,
        `Click-to-Map should be one undo step, got ${JSON.stringify(beforeUndo)}`,
      );

      await page.evaluate(() => {
        (globalThis as unknown as { intehrgratorTestApi: { undo(): void } })
          .intehrgratorTestApi.undo();
      });
      await page.waitForFunction((id) => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: {
            getSnapshot(): { model: { slots: Array<{ slotId: string; expression?: string }> } };
          };
        }).intehrgratorTestApi;
        const slot = api.getSnapshot().model.slots.find((s) => s.slotId === id);
        return !slot?.expression?.includes("systolic");
      }, slotId, { timeout: 10_000 }).catch(() => {
        throw new Error(`Undo did not clear mapping; before ${JSON.stringify(beforeUndo)}`);
      });

      await page.waitForFunction(() => {
        const btn = document.getElementById("btn-redo");
        return btn instanceof HTMLButtonElement && !btn.disabled;
      }, { timeout: 5_000 });
      await page.click("#btn-redo");
      await waitForMappedSlot(page, slotId);
      const afterRedo = await getSnapshot(page);
      assertEquals(
        Boolean(afterRedo.model.slots.find((s) => s.slotId === slotId)?.expression.includes("systolic")),
        true,
      );

      // #376: Blockly canvas zoom control icons must load from bundled local media, not dead appspot URL.
      const spriteCheck = await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll(".blocklyZoom image")];
        const hrefs = imgs.map((el) => el.getAttribute("xlink:href") ?? el.getAttribute("href") ?? "");
        const firstHref = hrefs[0] ?? "";
        let status = 0;
        let contentType = "";
        let byteLen = 0;
        if (firstHref) {
          const res = await fetch(firstHref);
          status = res.status;
          contentType = res.headers.get("content-type") ?? "";
          byteLen = (await res.arrayBuffer()).byteLength;
        }
        return { count: imgs.length, hrefs, status, contentType, byteLen };
      });
      assert(spriteCheck.count >= 3, `expected >=3 Blockly zoom control images, got ${spriteCheck.count}`);
      for (const href of spriteCheck.hrefs) {
        assert(
          href.includes("vendor/blockly/media/sprites.png"),
          `expected local bundled Blockly sprites.png, got "${href}"`,
        );
        assert(!href.includes("appspot.com"), `must not point at defunct appspot URL: "${href}"`);
      }
      assertEquals(spriteCheck.status, 200, "bundled sprites.png must return HTTP 200");
      assert(
        spriteCheck.contentType.includes("image/png"),
        `expected image/png content-type, got "${spriteCheck.contentType}"`,
      );
      assert(spriteCheck.byteLen > 500, `expected non-empty PNG bytes, got ${spriteCheck.byteLen}`);

      // #375: Switching to a new project clears Blockly undo stack and resets History panel to that project.
      page.on("dialog", (dialog) => void dialog.accept());
      await page.click("#btn-menu-file");
      await page.click("#btn-new-project");
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { undoCount(): number; redoCount(): number };
        }).intehrgratorTestApi;
        const undoBtn = document.getElementById("btn-undo") as HTMLButtonElement | null;
        return api.undoCount() === 0 && api.redoCount() === 0 && Boolean(undoBtn?.disabled);
      }, undefined, { timeout: 5_000 });

      await page.click("#btn-history");
      await page.locator("#history-panel").waitFor({ state: "visible" });
      const historyRows = await page.locator("#history-panel .history-row").count();
      assertEquals(historyRows, 0, "history panel must not retain entries from the previous project");
    } finally {
      await browser.close();
    }
  },
});
