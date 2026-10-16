/**
 * Startup console noise (#217) and Mapping Editor selection (#225).
 *
 * #225 was reported as "selecting a block focuses the lower editor and the
 * lower pane eats the screen." On current main that does not happen: selection
 * highlights the Mapping Spec row and leaves the split and focus where they
 * were. This test locks that behavior. It does not invent a layout change.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium, type ConsoleMessage, type Page } from "npm:playwright@1.51.0";
import { baseUrl, clickBlocklyBlock, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const CONSOLE_MARKERS = [
  "Unable to unregister",
  "translate(NaN",
  'Expected length, "NaN"',
  "form-renderer.js",
  "Can't delete non-existent block",
];

function collectKnownConsoleNoise(page: Page, bucket: string[]): void {
  const push = (text: string) => {
    if (!CONSOLE_MARKERS.some((marker) => text.includes(marker))) return;
    const line = text.replace(/\s+/g, " ").slice(0, 300);
    if (!bucket.includes(line)) bucket.push(line);
  };
  page.on("console", (msg: ConsoleMessage) => push(msg.text()));
  page.on("pageerror", (err) => push(err.message));
  page.on("response", (res) => {
    if (res.status() >= 400) push(`${res.status()} ${res.url()}`);
  });
}

async function mappingSplit(page: Page): Promise<{
  blocklyH: number;
  bottomH: number;
  flex: string;
  focusInSpec: boolean;
}> {
  return await page.evaluate(() => {
    const blockly = document.getElementById("blockly-mount")!;
    const bottom = document.querySelector(".mapping-bottom")!;
    const spec = document.getElementById("spec-editor-wrap");
    const active = document.activeElement;
    return {
      blocklyH: Math.round(blockly.getBoundingClientRect().height),
      bottomH: Math.round(bottom.getBoundingClientRect().height),
      flex: blockly.style.flex,
      focusInSpec: Boolean(active && spec?.contains(active)),
    };
  });
}

Deno.test({
  name: "UI: startup does not log the known workbench console errors",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    const noise: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      collectKnownConsoleNoise(page, noise);
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      await page.waitForTimeout(300);
      assertEquals(noise, [], `startup console noise: ${JSON.stringify(noise)}`);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: selecting a Blockly block keeps the mapping split and spec focus",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      const before = await mappingSplit(page);
      assert(before.blocklyH > 200, JSON.stringify(before));
      assert(before.bottomH > 80, JSON.stringify(before));

      const point = await page.evaluate(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: {
            getSnapshot: () => { blocklyBlocks: Array<{ id: string; type: string }> };
            scrollBlockIntoView: (id: string) => void;
            getBlockClientRect: (
              id: string,
            ) => { x: number; y: number; width: number; height: number } | null;
          };
        }).intehrgratorTestApi;
        const mount = document.getElementById("blockly-mount")!.getBoundingClientRect();
        for (const block of api.getSnapshot().blocklyBlocks) {
          api.scrollBlockIntoView(block.id);
          const rect = api.getBlockClientRect(block.id);
          if (!rect || rect.height < 8 || rect.height > 200) continue;
          const x = rect.x + 12;
          const y = rect.y + 10;
          if (x < mount.left || x > mount.right || y < mount.top || y > mount.bottom) continue;
          return { id: block.id, x, y };
        }
        return null;
      });
      assert(point, "expected a visible Blockly block to click");
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);

      const afterClick = await mappingSplit(page);
      assertEquals(afterClick.flex, before.flex, JSON.stringify({ before, afterClick }));
      assertEquals(afterClick.blocklyH, before.blocklyH, JSON.stringify({ before, afterClick }));
      assertEquals(afterClick.bottomH, before.bottomH, JSON.stringify({ before, afterClick }));
      assertEquals(afterClick.focusInSpec, false, JSON.stringify(afterClick));
      assertEquals(await page.locator(".blocklySelected").count(), 1);

      await clickBlocklyBlock(page, point.id);
      await page.waitForTimeout(200);
      const afterApi = await mappingSplit(page);
      assertEquals(afterApi.flex, before.flex, JSON.stringify({ before, afterApi }));
      assertEquals(afterApi.focusInSpec, false, JSON.stringify(afterApi));
    } finally {
      await browser.close();
    }
  },
});
