import { assert, assertEquals } from "@std/assert";
// deno-lint-ignore no-import-prefix
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";

Deno.test("UI: D3 Inline Popover applies 1:1 source binding, literal, terminology, and simple expression on MHV1 and syncs with Mapping Spec and Scoped Blockly", async () => {
  const mhv1Text = await fixtureText(
    "test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/mapping/mapping.blockly.json",
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(10_000);
    await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "domcontentloaded" });
    await waitForTestApi(page);

    await page.evaluate((rawJson) => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      api.loadBlocklyState(JSON.parse(rawJson));
    }, mhv1Text);

    // Drill into "Lifestyle risk factors" section via its cascaded header bar so multiple leaf ELEMENT tiles are visible.
    const containerHeader = page.locator('#treemap-host .tm-tile--container[aria-label*="Lifestyle"] > .tm-header').first();
    await containerHeader.click();
    await page.waitForTimeout(100);

    const leafTiles = page.locator('#treemap-host .tm-tile[data-rm-type="ELEMENT"]');
    const leafCount = await leafTiles.count();
    assert(leafCount >= 4, `expected >=4 visible ELEMENT tiles after drill-in, got ${leafCount}`);

    // 1. Apply 1:1 Source Binding on leaf 0.
    await leafTiles.nth(0).click();
    const popover = page.locator(".tm-inline-popover");
    await popover.waitFor({ state: "visible" });
    await popover.locator('.tm-pop-tab[data-tm-pop-tab="source"]').click();
    await popover.locator('input[name="sourcePath"]').fill("$.inline_source_field");
    await popover.locator('button[type="submit"]').click();
    await popover.waitFor({ state: "hidden" });

    // 2. Apply Literal on leaf 1.
    await leafTiles.nth(1).click();
    await popover.waitFor({ state: "visible" });
    await popover.locator('.tm-pop-tab[data-tm-pop-tab="literal"]').click();
    const litInput = popover.locator('[name="literalValue"]');
    const tagName = await litInput.evaluate((e) => e.tagName.toLowerCase());
    if (tagName === "select") {
      await litInput.selectOption("true");
    } else {
      const inputType = await litInput.getAttribute("type");
      await litInput.fill(inputType === "number" ? "42" : "InlineConstantText");
    }
    await popover.locator('button[type="submit"]').click();
    await popover.waitFor({ state: "hidden" });

    // 3. Apply Terminology Binding on leaf 2.
    await leafTiles.nth(2).click();
    await popover.waitFor({ state: "visible" });
    await popover.locator('.tm-pop-tab[data-tm-pop-tab="terminology"]').click();
    await popover.locator('input[name="codeSystem"]').fill("SNOMED-CT");
    await popover.locator('input[name="code"]').fill("271649006");
    await popover.locator('input[name="display"]').fill("Systolic BP");
    await popover.locator('button[type="submit"]').click();
    await popover.waitFor({ state: "hidden" });

    // 4. Apply verifiable Simple Expression (trim) on leaf 3.
    await leafTiles.nth(3).click();
    await popover.waitFor({ state: "visible" });
    await popover.locator('.tm-pop-tab[data-tm-pop-tab="expression"]').click();
    await popover.locator('select[name="exprKind"]').selectOption("trim");
    await popover.locator('input[name="exprSource"]').fill("$.trimmed_note");
    await popover.locator('button[type="submit"]').click();
    await popover.waitFor({ state: "hidden" });

    // Verify bottom Mapping Spec & canonical JSON reflect all 4 inline edits.
    const afterInline = await page.evaluate(() => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      return {
        canonicalJson: api.getBlocklyStateJson(),
        specText: api.getMappingSpecDocument(),
      };
    });
    assert(afterInline.canonicalJson.includes("$.inline_source_field"), "canonical JSON must have source binding");
    assert(afterInline.canonicalJson.includes("271649006"), "canonical JSON must have terminology binding");
    assert(afterInline.canonicalJson.includes("text_trim"), "canonical JSON must have verifiable text_trim block");
    assert(afterInline.specText.includes("$.inline_source_field"), "Mapping Spec must reflect inline source binding");
    assert(afterInline.specText.includes("271649006"), "Mapping Spec must reflect inline terminology binding");

    // 5. Escalate to Scoped Blockly from popover on leaf 3 and verify visual blocks match.
    await leafTiles.nth(3).click();
    await popover.waitFor({ state: "visible" });
    await popover.locator('[data-tm-pop-action="escalate-blockly"]').click();
    await page.waitForTimeout(150);

    const scopedCheck = await page.evaluate(() => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      const snap = api.getSnapshot();
      return {
        mode: api.getEditorMode(),
        blockTypes: snap.blocklyBlocks.map((b) => b.type),
      };
    });
    assertEquals(scopedCheck.mode, "scoped-blockly");
    assert(
      scopedCheck.blockTypes.includes("text_trim") || scopedCheck.blockTypes.includes("source_query"),
      `expected inline-edited blocks in Scoped Blockly, got ${scopedCheck.blockTypes.join(", ")}`,
    );
  } finally {
    await browser.close();
  }
});
