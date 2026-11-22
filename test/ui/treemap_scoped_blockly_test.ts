import { assert, assertEquals } from "@std/assert";
// deno-lint-ignore no-import-prefix
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";

Deno.test("UI: MHV1 loads instantaneously into Treemap Overview (<300ms), filters, opens Scoped Blockly, and grafts edits back", async () => {
  const mhv1Text = await fixtureText(
    "test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/mapping/mapping.blockly.json",
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "domcontentloaded" });
    await waitForTestApi(page);

    // 1. Load MHV1 and measure Treemap Overview load time (< 300ms, zero WorkspaceSvg full mount).
    const loadResult = await page.evaluate((rawJson) => {
      const doc = JSON.parse(rawJson);
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      const t0 = performance.now();
      api.loadBlocklyState(doc);
      const elapsedMs = performance.now() - t0;
      return {
        elapsedMs,
        mode: api.getEditorMode(),
        mountedBlocks: api.getMountedBlockCount(),
        canonicalBlocks: api.getCanonicalBlockCount(),
      };
    }, mhv1Text);

    assertEquals(loadResult.mode, "treemap", "MHV1 must default to Treemap Overview");
    assertEquals(loadResult.mountedBlocks, 0, "must NOT mount full template into WorkspaceSvg");
    assertEquals(loadResult.canonicalBlocks, 1296, "canonical document must preserve all 1296 blocks");
    assert(
      loadResult.elapsedMs < 300,
      `MHV1 Treemap load took ${loadResult.elapsedMs.toFixed(1)}ms (expected < 300ms)`,
    );

    // Treemap tiles must be rendered in the DOM.
    const initialTileCount = await page.locator("#treemap-host .tm-tile").count();
    assert(initialTileCount > 10, `expected >10 treemap tiles, got ${initialTileCount}`);

    // 2. Filter by Mandatory Missing.
    await page.click('.tm-filter-chip[data-tm-filter="mandatory-missing"]');
    const mandTiles = await page.locator("#treemap-host .tm-tile").count();
    assert(mandTiles > 0, "expected mandatory-missing tiles on MHV1");

    // Reset filter to All, then open a container in Scoped Blockly.
    await page.click('.tm-filter-chip[data-tm-filter="all"]');
    const openBtn = page.locator("#treemap-host .tm-open-blockly-btn").first();
    await openBtn.click();
    await page.waitForTimeout(150);

    const scopedState = await page.evaluate(() => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      return {
        mode: api.getEditorMode(),
        mountedBlocks: api.getMountedBlockCount(),
        canonicalBlocks: api.getCanonicalBlockCount(),
      };
    });
    assertEquals(scopedState.mode, "scoped-blockly");
    assert(scopedState.mountedBlocks > 0, "expected scoped slice blocks mounted");
    assert(
      scopedState.mountedBlocks <= 85,
      `expected adaptive slice <=85 blocks, got ${scopedState.mountedBlocks}`,
    );
    assertEquals(scopedState.canonicalBlocks, 1296);

    // Breadcrumb back button must be visible.
    const backBtn = page.locator("#treemap-breadcrumb .tm-back-btn");
    assertEquals(await backBtn.isVisible(), true);

    // 3. Edit a block's NAME field inside Scoped Blockly, then return to Treemap.
    const editedId = await page.evaluate(() => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      const snap = api.getSnapshot();
      const firstNamed = snap.blocklyBlocks.find((b) => b.type === "element" || b.type === "observation");
      if (!firstNamed) return null;
      api.setBlockField(firstNamed.id, "NAME", "ScopedEditedLabel");
      return firstNamed.id;
    });
    assert(editedId !== null, "expected an editable block inside the scoped slice");
    await page.waitForTimeout(150);

    await backBtn.click();
    await page.waitForTimeout(100);

    const afterReturn = await page.evaluate(() => {
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
        .intehrgratorTestApi;
      return {
        mode: api.getEditorMode(),
        canonicalBlocks: api.getCanonicalBlockCount(),
        canonicalJson: api.getBlocklyStateJson(),
        specText: api.getMappingSpecDocument(),
      };
    });
    assertEquals(afterReturn.mode, "treemap");
    assertEquals(afterReturn.canonicalBlocks, 1296, "untouched siblings must be preserved after graft");
    assert(
      afterReturn.canonicalJson.includes("ScopedEditedLabel"),
      "canonical JSON must contain the grafted edit",
    );
    assert(
      afterReturn.specText.includes("ScopedEditedLabel"),
      "bottom Mapping Spec must reflect the grafted edit",
    );
  } finally {
    await browser.close();
  }
});
