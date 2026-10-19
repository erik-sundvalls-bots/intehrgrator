/**
 * Browser UI test for #246 (UI issues: validation, test runs, Spec, editors).
 *
 *  1  no "Validate as" picker (lenient default)
 *  2a ELEMENT + single leaf value share one Spec row; clicking the DV block
 *     on the canvas selects that row
 *  2b ELEMENT rows are badged ELEMENT, not SLOT
 *  2c a Spec click then a canvas click leaves exactly one block outlined;
 *     a click on empty canvas clears it
 *  3  tabbed Spec follows canvas clicks to the owning root's tab
 *  4  selected test-file tab is blue (red only with an error); no coloured
 *     sidebars on Source Schema / Example Instances
 *  5  auto-run is on by default and marks every test-file tab
 *  6  Search/Copy/Download overlay inside each CodeMirror editor, faded
 *     until hover (inline code fields included)
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import {
  baseUrl,
  diastolicSuffix,
  findElementBlockId,
  findSlotIdEndingWith,
  findSystolicSlotId,
  fixtureText,
  loadBpFixtures,
  showOutputTab,
  waitForTestApi,
} from "./helpers.ts";

type Api = {
  addExample(filename: string, content: string): void;
  mapNodeToSlot(slotId: string, path: string, format: string): void;
  getBlocklyStateJson(): string;
  clickBlock(id: string): void;
  scrollBlockIntoView(id: string): void;
  getBlockClientRect(id: string): { x: number; y: number; width: number; height: number } | null;
  newBlock(type: string): string | null;
};

function api(page: Page) {
  return {
    call: <T>(fn: (a: Api, arg: unknown) => T, arg?: unknown) =>
      page.evaluate(
        ({ src, arg }) => {
          const a = (globalThis as unknown as { intehrgratorTestApi: Api }).intehrgratorTestApi;
          return (0, eval)(src)(a, arg);
        },
        { src: fn.toString(), arg },
      ) as Promise<T>,
  };
}

type BlockJson = { id?: string; type?: string; fields?: Record<string, unknown>; inputs?: Record<string, { block?: BlockJson }>; next?: { block?: BlockJson } };

function findBlock(root: BlockJson | undefined, pred: (b: BlockJson) => boolean): BlockJson | null {
  if (!root) return null;
  if (pred(root)) return root;
  for (const input of Object.values(root.inputs ?? {})) {
    const hit = findBlock(input.block, pred);
    if (hit) return hit;
  }
  return findBlock(root.next?.block, pred);
}

async function blocklyRoots(page: Page): Promise<BlockJson[]> {
  const json = await api(page).call((a) => a.getBlocklyStateJson());
  return (JSON.parse(json as string).blocks?.blocks ?? []) as BlockJson[];
}

async function realClickBlock(page: Page, id: string): Promise<void> {
  await api(page).call((a, id) => a.scrollBlockIntoView(id as string), id);
  await page.waitForTimeout(250);
  const r = await api(page).call((a, id) => a.getBlockClientRect(id as string), id);
  assert(r, `block ${id} has a client rect`);
  await page.mouse.click(r.x + 24, r.y + 8);
  await page.waitForTimeout(250);
}

const selectedBlocks = (page: Page) =>
  page.evaluate(() => document.querySelectorAll("#blockly-mount .blocklySelected").length);

Deno.test({
  name: "UI: #246 validation picker, Spec rows/selection/tabs, test-file tabs, auto-run, editor overlays",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      const second = (await fixtureText("test/fixtures/dummy-json-vitals/instance-1.json"))
        .replace("120", "135");
      await api(page).call((a, c) => a.addExample("bp_example_2.json", c as string), second);

      // 1 — no ehrtslib preset picker.
      assertEquals(await page.locator("#validation-deserialize-mode").count(), 0);

      // 5 — auto-run is on without the user pressing anything; every tab gets a mark.
      await showOutputTab(page, "test");
      assertEquals((await page.locator("#btn-autoplay").innerText()).includes("Pause"), true);
      const systolic = await findSystolicSlotId(page);
      await api(page).call((a, s) => a.mapNodeToSlot(s as string, "systolic", "json"), systolic);
      await page.waitForFunction(() => {
        const tabs = [...document.querySelectorAll("#test-output-tabs .example-tab")];
        return tabs.length === 2 &&
          tabs.every((t) => t.querySelector(".output-tab-mark, .example-tab-warn"));
      }, undefined, { timeout: 10_000 });

      // 4 — selected tab is neutral blue; red tint only with an error.
      const tabColours = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("#test-output-tabs .example-tab.active, #example-tabs .example-tab.active")]
          .map((t) => ({ error: t.classList.contains("example-tab--error"), border: getComputedStyle(t).borderTopColor }))
      );
      assert(tabColours.length >= 1);
      for (const tab of tabColours) {
        assertNotEquals(tab.border, "rgb(232, 119, 34)", "selected tab must not be orange");
        assertEquals(tab.border, tab.error ? "rgb(198, 40, 40)" : "rgb(74, 111, 165)");
      }
      const sidebars = await page.evaluate(() =>
        ["schema-tree", "example-tree"].map((id) => {
          const css = getComputedStyle(document.getElementById(id)!);
          return css.borderLeftWidth === css.borderRightWidth && css.borderLeftColor === css.borderRightColor;
        })
      );
      assertEquals(sidebars, [true, true], "no coloured left sidebar on the trees");

      // 6 — overlays sit inside .cm-editor and are faded until hovered.
      for (const id of ["test-output-toolbar", "spec-editor-toolbar", "export-editor-toolbar"]) {
        const parentIsEditor = await page.evaluate(
          (id) => document.getElementById(id)?.parentElement?.classList.contains("cm-editor") ?? false,
          id,
        );
        assertEquals(parentIsEditor, true, `${id} is inside its CodeMirror editor`);
      }
      const testToolbar = page.locator("#test-output-toolbar");
      const fadedOpacity = Number(await testToolbar.evaluate((el) => getComputedStyle(el).opacity));
      assert(fadedOpacity < 1, `toolbar faded (opacity ${fadedOpacity})`);
      await testToolbar.hover();
      await page.waitForTimeout(250);
      assertEquals(await testToolbar.evaluate((el) => getComputedStyle(el).opacity), "1");
      const toolbarBox = await testToolbar.boundingBox();
      const editorBox = await page.locator("#test-output .cm-editor").boundingBox();
      assert(toolbarBox && editorBox);
      assert(
        toolbarBox.x + toolbarBox.width <= editorBox.x + editorBox.width &&
          toolbarBox.y >= editorBox.y && toolbarBox.y - editorBox.y < 40 &&
          editorBox.x + editorBox.width - (toolbarBox.x + toolbarBox.width) < 40,
        "toolbar in the editor's upper-right corner",
      );
      await api(page).call((a) => a.newBlock("text_code"));
      await page.waitForSelector(".blockly-codemirror-host .cm-editor > .editor-action-toolbar--overlay", { timeout: 5_000 });

      // 2b — ELEMENT badge; 2a — Diastolic ELEMENT + units share one row.
      const diastolicSlot = await findSlotIdEndingWith(page, diastolicSuffix);
      const diastolic = await findElementBlockId(page, diastolicSlot);
      const row = page.locator(`.spec-widget[data-block-id="${diastolic}"]`).first();
      assertEquals(await row.locator(":scope > .spec-widget-badge").innerText(), "ELEMENT");
      assertEquals(await row.locator(".spec-widget-inline").count(), 1);
      const roots = await blocklyRoots(page);
      const diastolicJson = roots.map((r) => findBlock(r, (b) => b.id === diastolic)).find(Boolean)!;
      const dvId = diastolicJson.inputs?.VALUE?.block?.id;
      assert(dvId, "Diastolic has a DV block");
      await api(page).call((a, id) => a.clickBlock(id as string), dvId);
      await page.waitForTimeout(250);
      assertEquals(
        await page.locator(".spec-widget--selected").first().getAttribute("data-block-id"),
        diastolic,
        "clicking the DV block selects the ELEMENT row",
      );

      // 2c — Spec click, then canvas click: exactly one outline; empty canvas clears it.
      const systolicEl = await findElementBlockId(page, systolic);
      await page.locator(`.spec-widget[data-block-id="${systolicEl}"] > .spec-widget-badge`).first().click();
      await page.waitForTimeout(250);
      assertEquals(await selectedBlocks(page), 1);
      await realClickBlock(page, diastolic);
      assertEquals(await selectedBlocks(page), 1, "previous Spec-driven selection is cleared");
      const canvas = await page.locator("#blockly-mount").boundingBox();
      assert(canvas);
      await page.mouse.click(canvas.x + canvas.width - 80, canvas.y + 30);
      await page.waitForTimeout(250);
      assertEquals(await selectedBlocks(page), 0, "empty-canvas click clears the outline");

      // 3 — tabbed Spec follows canvas clicks.
      await page.locator("#tab-mapping-json-menu").click();
      await page.locator("[data-spec-layout=tabs]").click();
      await page.waitForSelector(".spec-root-tab", { timeout: 5_000 });
      const defaults = roots.find((r) => r.type === "default_context_map" || r.type === "defaults_block");
      assert(defaults?.id, "canvas has a Default context map");
      await api(page).call((a, id) => a.clickBlock(id as string), diastolic);
      await page.waitForTimeout(300);
      assertEquals(await page.locator(".spec-root-tab.active").innerText(), "COMPOSITION");
      assertEquals(await page.locator(`.spec-widget--selected[data-block-id="${diastolic}"]`).count(), 1);
      await api(page).call((a, id) => a.clickBlock(id as string), defaults.id);
      await page.waitForTimeout(300);
      assertEquals(await page.locator(".spec-root-tab.active").innerText(), "Default context map");
    } finally {
      await browser.close();
    }
  },
});
