/**
 * Collapse button stays inside each block's own outline and off header icons.
 * getHeightWidth() includes the next block, so a bounds check against that
 * box would hide the overlap this test is for.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";

type GlyphAudit = {
  glyphs: number;
  outside: number;
  overlap: number;
  collapsed: number;
  plates: number;
};

function auditExpression(): GlyphAudit {
  const hit = (a: DOMRect, b: DOMRect) =>
    a.left < b.right - 0.5 && a.right > b.left + 0.5 &&
    a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  let outside = 0;
  let overlap = 0;
  let collapsed = 0;
  let plates = 0;
  for (const glyph of document.querySelectorAll<SVGGElement>(".block-collapse-glyph")) {
    const host = glyph.closest("g.blocklyDraggable");
    const path = host?.querySelector(":scope > path.blocklyPath");
    if (!host || !path) {
      outside++;
      continue;
    }
    const button = glyph.getBoundingClientRect();
    const outline = path.getBoundingClientRect();
    if (button.width < 8 || outline.width < 8) continue;
    const inside = button.left >= outline.left - 1 &&
      button.top >= outline.top - 1 &&
      button.right <= outline.right + 2 &&
      button.bottom <= outline.bottom + 2;
    if (!inside) outside++;
    if (glyph.querySelector("rect.block-collapse-glyph-plate")?.getAttribute("rx") === "3") {
      plates++;
    }
    if (glyph.getAttribute("aria-label") === "Expand Block") collapsed++;
    for (const image of host.querySelectorAll("image")) {
      if (image.closest("g.blocklyDraggable") !== host) continue;
      if (image.closest("foreignObject")) continue;
      const icon = image.getBoundingClientRect();
      if (icon.width >= 8 && hit(button, icon)) overlap++;
    }
  }
  return {
    glyphs: document.querySelectorAll(".block-collapse-glyph").length,
    outside,
    overlap,
    collapsed,
    plates,
  };
}

async function audit(page: Page): Promise<GlyphAudit> {
  return await page.evaluate(auditExpression);
}

Deno.test({
  name: "UI: collapse button clears header icons on the blood-pressure scaffold",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const opt = await fixtureText("test/fixtures/blood_pressure.opt");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForTestApi(page);
      await page.evaluate((text) => {
        (globalThis as unknown as {
          intehrgratorTestApi: { loadTemplate: (name: string, body: string) => void };
        }).intehrgratorTestApi.loadTemplate("blood_pressure.opt", text);
      }, opt);
      await page.waitForFunction(
        () => document.querySelectorAll(".block-collapse-glyph").length > 50,
        undefined,
        { timeout: 20_000 },
      );

      const expanded = await audit(page);
      assert(expanded.glyphs >= 90, `expected the scaffold glyphs, saw ${expanded.glyphs}`);
      assertEquals(expanded.outside, 0, "button outside a block outline");
      assertEquals(expanded.overlap, 0, "button covering a header icon");
      assert(expanded.collapsed > 0, "scaffolded get-defaults blocks start collapsed");
      assertEquals(expanded.plates, expanded.glyphs);

      const zoom = page.locator(".blocklyZoom image").first();
      if (await zoom.count()) await zoom.click({ force: true });
      await page.setViewportSize({ width: 900, height: 700 });
      const zoomed = await audit(page);
      assertEquals(zoomed.outside, 0, "zoomed button outside the outline");
      assertEquals(zoomed.overlap, 0, "zoomed button covering a header icon");

      await page.evaluate(() => {
        document.querySelector<SVGGElement>(".block-collapse-glyph[aria-label='Expand Block']")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(200);
      const after = await audit(page);
      assertEquals(after.outside, 0, "expanded lookup button outside the outline");
      assertEquals(after.overlap, 0, "expanded lookup button covering a header icon");
      assert(after.collapsed < expanded.collapsed, "one collapsed lookup expanded");
    } finally {
      await browser.close();
    }
  },
});
