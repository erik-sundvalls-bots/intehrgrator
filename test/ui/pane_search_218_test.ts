/**
 * Browser UI test for #218: find-in-pane for the Source Schema tree, the
 * Example Instances tree, the Target Schema tree and the Mapping canvas.
 *
 * Same UX as the CodeMirror find (#208/#215): Search overlay in the pane's
 * upper-right corner, docked find panel, Ctrl/Cmd+F from inside the pane,
 * every hit highlighted as a substring, first hit auto-selected, Enter /
 * Shift+Enter / next / previous to step (wrapping), match case / regexp /
 * by word, Escape closes and clears the marks.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, showOutputTab, waitForTestApi } from "./helpers.ts";

const shot = Deno.env.get("PR218_SCREENSHOTS");

/** Highlighted substrings of a tree pane (CSS Custom Highlight API ranges). */
function treeHighlights(page: Page, id: string) {
  return page.evaluate(async (id) => {
    // A tree re-render (auto-run) repaints on the next frame; read after it.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const reg = (globalThis as unknown as { CSS: { highlights: Map<string, Set<Range>> } }).CSS
      .highlights;
    const texts = (name: string) => [...(reg.get(name) ?? [])].map((r) => r.toString());
    return { hits: texts(`pane-find-${id}`), current: texts(`pane-find-${id}-current`) };
  }, id);
}

const panel = (page: Page, id: string) => page.locator(`.pane-find-panel[data-pane-find="${id}"]`);

Deno.test({
  name: "UI: #218 find in Source Schema / Example / Target Schema trees and the Mapping canvas",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      // Source Schema tree: overlay button inside the pane, faded until hover.
      const schemaBtn = page.locator('button[data-pane-find="source-schema"]');
      assertEquals(await schemaBtn.count(), 1);
      const overlay = schemaBtn.locator("xpath=..");
      assertEquals(
        await overlay.evaluate((el) => el.parentElement?.contains(document.getElementById("schema-tree"))),
        true,
        "Search overlay shares the tree pane host",
      );
      assert(Number(await overlay.evaluate((el) => getComputedStyle(el).opacity)) < 1);
      assertEquals(await schemaBtn.getAttribute("title"), "Search in Source Schema");

      await schemaBtn.click();
      const schemaPanel = panel(page, "source-schema");
      assertEquals(await schemaPanel.isVisible(), true);
      const input = schemaPanel.locator(".pane-find-input");
      assertEquals(await input.evaluate((el) => el === document.activeElement), true, "input focused");
      await input.fill("STOLIC");
      // Case-insensitive by default; every occurrence marked, first one current.
      let marks = await treeHighlights(page, "source-schema");
      assertEquals(marks.current, ["stolic"]);
      assert(marks.hits.length >= 1, "the other occurrence is marked too");
      assertEquals(await schemaPanel.locator(".pane-find-count").innerText(), `1 of ${marks.hits.length + 1}`);
      const firstRow = await page.locator("#schema-tree .pane-find-row-current").getAttribute("data-path");

      // Enter → second hit; Shift+Enter back; wraps around.
      await input.press("Enter");
      const secondRow = await page.locator("#schema-tree .pane-find-row-current").getAttribute("data-path");
      assert(firstRow !== secondRow, "Enter moves to the next hit");
      assertEquals(await schemaPanel.locator(".pane-find-count").innerText(), `2 of ${marks.hits.length + 1}`);
      await input.press("Shift+Enter");
      assertEquals(await page.locator("#schema-tree .pane-find-row-current").getAttribute("data-path"), firstRow);
      await input.press("Shift+Enter");
      assertEquals(
        await schemaPanel.locator(".pane-find-count").innerText(),
        `${marks.hits.length + 1} of ${marks.hits.length + 1}`,
        "previous wraps to the last hit",
      );

      // Options: match case, by word, regexp.
      await schemaPanel.locator('input[data-find-option="case"]').check();
      assertEquals((await treeHighlights(page, "source-schema")).current, []);
      assertEquals(await schemaPanel.locator(".pane-find-count").innerText(), "No matches");
      await schemaPanel.locator('input[data-find-option="case"]').uncheck();
      await input.fill("sys");
      await schemaPanel.locator('input[data-find-option="word"]').check();
      assertEquals(await schemaPanel.locator(".pane-find-count").innerText(), "No matches");
      await schemaPanel.locator('input[data-find-option="word"]').uncheck();
      await schemaPanel.locator('input[data-find-option="regexp"]').check();
      await input.fill("(sy|dia)stolic");
      marks = await treeHighlights(page, "source-schema");
      assert(marks.current.length === 1 && /stolic$/.test(marks.current[0]));
      await input.fill("(");
      assertEquals(await schemaPanel.locator(".pane-find-count").innerText(), "Invalid regexp");
      await schemaPanel.locator('input[data-find-option="regexp"]').uncheck();
      await input.fill("stolic");
      if (shot) await page.screenshot({ path: `${shot}/pr218-source-schema-find.png`, clip: await clipOf(page, "#schema-tree", 70) });

      // Escape closes the panel and clears the marks.
      await input.press("Escape");
      assertEquals(await schemaPanel.isVisible(), false);
      assertEquals((await treeHighlights(page, "source-schema")).hits.length, 0);

      // Example Instances tree: Ctrl+F after clicking inside the pane; values match too.
      await page.locator("#example-tree .tree-row").first().click();
      await page.keyboard.press("Control+f");
      const examplePanel = panel(page, "source-example");
      assertEquals(await examplePanel.isVisible(), true, "Ctrl+F opens the pane's own find panel");
      await examplePanel.locator(".pane-find-input").fill("mm[hg");
      assertEquals((await treeHighlights(page, "source-example")).current, ["mm[Hg"]);
      // Marks survive a tree re-render (another example added).
      await page.evaluate(() =>
        (globalThis as unknown as { intehrgratorTestApi: { addExample(n: string, c: string): void } })
          .intehrgratorTestApi.addExample("bp_2.json", '{"systolic": 99, "unit": "mm[Hg]"}')
      );
      await page.waitForTimeout(200);
      assertEquals((await treeHighlights(page, "source-example")).current, ["mm[Hg"]);
      if (shot) await page.screenshot({ path: `${shot}/pr218-example-find.png`, clip: await clipOf(page, "#example-tree", 110) });
      await examplePanel.locator('[data-find-action="close"]').click();

      // Target Schema tree (output tab).
      await showOutputTab(page, "target-schema");
      await page.locator('button[data-pane-find="target-schema"]').click();
      const targetPanel = panel(page, "target-schema");
      await targetPanel.locator(".pane-find-input").fill("diastolic");
      const targetMarks = await treeHighlights(page, "target-schema");
      assertEquals(targetMarks.current.map((s) => s.toLowerCase()), ["diastolic"]);
      const currentRowVisible = await page.evaluate(() => {
        const row = document.querySelector("#target-schema-tree .pane-find-row-current");
        const pane = document.getElementById("target-schema-tree");
        if (!row || !pane) return false;
        const r = row.getBoundingClientRect();
        const p = pane.getBoundingClientRect();
        return r.top >= p.top && r.bottom <= p.bottom;
      });
      assertEquals(currentRowVisible, true, "current hit is scrolled into view");
      if (shot) await page.screenshot({ path: `${shot}/pr218-target-schema-find.png`, clip: await clipOf(page, "#target-schema-tree", 70) });
      await targetPanel.locator(".pane-find-input").press("Escape");

      // Ctrl+F inside a CodeMirror editor stays CodeMirror's own find.
      await page.locator("#mapping-spec-editor .cm-content, #spec-editor .cm-content").first().click();
      await page.keyboard.press("Control+f");
      assertEquals(await page.locator(".pane-find-panel:visible").count(), 0, "no pane find over a CodeMirror editor");
      await page.keyboard.press("Escape");

      // Mapping canvas: overlay button, SVG hit rects, current block selected.
      const canvasBtn = page.locator('button[data-pane-find="mapping-canvas"]');
      assertEquals(
        await canvasBtn.evaluate((el) => document.getElementById("blockly-mount")!.contains(el)),
        true,
      );
      await canvasBtn.click();
      const canvasPanel = panel(page, "mapping-canvas");
      await canvasPanel.locator(".pane-find-input").fill("systolic");
      await page.waitForTimeout(150);
      const canvas = await page.evaluate(() => ({
        hits: document.querySelectorAll("#blockly-mount .pane-find-svg-hit").length,
        current: document.querySelectorAll("#blockly-mount .pane-find-svg-hit--current").length,
        selected: document.querySelectorAll("#blockly-mount .blocklySelected").length,
      }));
      assert(canvas.hits >= 1, "canvas hits painted");
      assertEquals(canvas.current, 1);
      assertEquals(canvas.selected, 1, "block of the current hit is selected");
      const countText = await canvasPanel.locator(".pane-find-count").innerText();
      assert(/^1 of \d+$/.test(countText), countText);
      // Hit rect sits inside the visible canvas.
      const inView = await page.evaluate(() => {
        const r = document.querySelector("#blockly-mount .pane-find-svg-hit--current")!.getBoundingClientRect();
        const m = document.getElementById("blockly-mount")!.getBoundingClientRect();
        return r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom;
      });
      assertEquals(inView, true);
      if (Number(countText.split(" of ")[1]) > 1) {
        await canvasPanel.locator('[data-find-action="next"]').click();
        assertEquals(await canvasPanel.locator(".pane-find-count").innerText(), `2 of ${countText.split(" of ")[1]}`);
      }
      if (shot) await page.screenshot({ path: `${shot}/pr218-canvas-find.png`, clip: await clipOf(page, "#blockly-mount", 0) });
      // Typing Delete in the find input must not delete the selected block.
      const before = await page.evaluate(() => document.querySelectorAll("#blockly-mount .blocklyDraggable").length);
      await canvasPanel.locator(".pane-find-input").press("End");
      await canvasPanel.locator(".pane-find-input").press("Delete");
      await canvasPanel.locator(".pane-find-input").press("Backspace");
      const after = await page.evaluate(() => document.querySelectorAll("#blockly-mount .blocklyDraggable").length);
      assertEquals(after, before, "find input keys stay out of Blockly shortcuts");
      await canvasPanel.locator(".pane-find-input").press("Escape");
      assertEquals(await page.locator("#blockly-mount .pane-find-svg-hit").count(), 0);

      assertEquals(errors.filter((e) => !/minimap/i.test(e)), []);
    } finally {
      await browser.close();
    }
  },
});

async function clipOf(page: Page, selector: string, extraTop: number) {
  const box = await page.locator(selector).boundingBox();
  assert(box);
  return {
    x: Math.max(0, box.x - 4),
    y: Math.max(0, box.y - extraTop),
    width: Math.min(box.width + 8, 1600),
    height: Math.min(box.height + extraTop + 4, 700),
  };
}
