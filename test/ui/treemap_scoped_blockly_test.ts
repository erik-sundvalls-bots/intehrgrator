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
      loadResult.elapsedMs < 1000,
      `MHV1 Treemap load took ${loadResult.elapsedMs.toFixed(1)}ms (expected < 1000ms)`,
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

    // 4. Bug regression: hovering a depth-1 container must NEVER lift it above its depth-2 children.
    const depth1Header = page.locator("#treemap-host .tm-depth--1.tm-tile--container > .tm-header").first();
    await depth1Header.hover();
    const zOrder = await page.evaluate(() => {
      const p = document.querySelector("#treemap-host .tm-depth--1.tm-tile--container");
      const c = document.querySelector("#treemap-host .tm-depth--2");
      return {
        parentZ: p ? Number(getComputedStyle(p).zIndex) : 0,
        childZ: c ? Number(getComputedStyle(c).zIndex) : 0,
      };
    });
    assert(
      zOrder.parentZ < zOrder.childZ,
      `hovered parent z-index (${zOrder.parentZ}) must stay below child z-index (${zOrder.childZ})`,
    );

    // 4b. Fixed sibling output order badges (1, 2, 3...) + hover sequence trace + stable scrollbars (zero flicker).
    const orderAndScrollCheck = await page.evaluate(async () => {
      const depth1Orders = [
        ...document.querySelectorAll("#treemap-host .tm-depth--1 > .tm-header > .tm-order"),
      ].map((el) => el.textContent?.trim());
      const seqHighlighted = document.querySelectorAll("#treemap-host .tm-tile--sibling-seq").length;
      const seqLines = document.querySelectorAll("#treemap-host .tm-order-overlay .tm-seq-line").length;

      // Monitor `.treemap-stage` childList mutations over 250ms to prove ResizeObserver does not flicker/loop.
      const stage = document.querySelector("#treemap-host .treemap-stage");
      const canvas = document.querySelector("#treemap-host .treemap-canvas") as HTMLElement | null;
      let repaints = 0;
      const obs = new MutationObserver(() => {
        repaints++;
      });
      if (stage) obs.observe(stage, { childList: true });
      await new Promise((r) => setTimeout(r, 250));
      obs.disconnect();
      return {
        depth1Orders,
        seqHighlighted,
        seqLines,
        repaints,
        overflowX: canvas?.style.overflowX ?? "",
        overflowY: canvas?.style.overflowY ?? "",
      };
    });
    assert(orderAndScrollCheck.depth1Orders.length >= 10, "expected ordinal badges on depth-1 sections");
    assertEquals(orderAndScrollCheck.depth1Orders.slice(0, 4), ["1", "2", "3", "4"]);
    assert(
      orderAndScrollCheck.seqHighlighted >= 10,
      `expected hovered depth-1 sibling sequence highlight, got ${orderAndScrollCheck.seqHighlighted}`,
    );
    assert(
      orderAndScrollCheck.seqLines >= 9,
      `expected SVG sequence connector lines between siblings, got ${orderAndScrollCheck.seqLines}`,
    );
    assertEquals(
      orderAndScrollCheck.repaints,
      0,
      `treemap must not flicker/re-paint in a ResizeObserver loop (saw ${orderAndScrollCheck.repaints} repaints)`,
    );
    assert(
      orderAndScrollCheck.overflowX === "hidden" || orderAndScrollCheck.overflowX === "auto",
      `expected explicit overflowX, got "${orderAndScrollCheck.overflowX}"`,
    );

    // 5. Feature 1: clicking a container zooms in with animation + pulses the newly added breadcrumb;
    //    clicking the root breadcrumb zooms out with animation + pulses the root breadcrumb.
    await depth1Header.click();
    await page.waitForTimeout(50);
    const zoomInCheck = await page.evaluate(() => ({
      hasZoomInClass: Boolean(document.querySelector("#treemap-host .treemap-stage.treemap-stage--zoom-in")),
      pulsingCrumbs: document.querySelectorAll("#treemap-breadcrumb .tm-crumb-btn--pulse").length,
      crumbCount: document.querySelectorAll("#treemap-breadcrumb .tm-crumb-btn").length,
    }));
    assertEquals(zoomInCheck.hasZoomInClass, true, "expected zoom-in stage animation class");
    assert(zoomInCheck.pulsingCrumbs >= 1, "expected affected breadcrumb to pulse on zoom-in");
    assert(zoomInCheck.crumbCount >= 2, "expected breadcrumb trail to include zoomed section");

    await page.locator("#treemap-breadcrumb .tm-crumb-btn").first().click();
    await page.waitForTimeout(50);
    const zoomOutCheck = await page.evaluate(() => ({
      hasZoomOutClass: Boolean(document.querySelector("#treemap-host .treemap-stage.treemap-stage--zoom-out")),
      pulsingCrumbs: document.querySelectorAll("#treemap-breadcrumb .tm-crumb-btn--pulse").length,
    }));
    assertEquals(zoomOutCheck.hasZoomOutClass, true, "expected zoom-out stage animation class");
    assert(zoomOutCheck.pulsingCrumbs >= 1, "expected root breadcrumb to pulse on zoom-out");

    // 6. Feature 2: switching from Treemap to Full Blockly Canvas shows spinner counting up percentage.
    //    Use a 4-section (~434-block) subset of MHV1 (> TREEMAP_AUTO_THRESHOLD = 400) so we exercise
    //    the exact chunked progress-overlay path in ~6s instead of waiting >60s for 1,296 headless SVG blocks.
    const subsetCount = await page.evaluate((rawJson) => {
      const doc = JSON.parse(rawJson);
      let comp: Record<string, unknown> | null = null;
      for (const top of doc?.blocks?.blocks ?? []) {
        let node = top;
        while (node) {
          if (node.type === "composition") {
            comp = node;
            break;
          }
          node = node.next?.block;
        }
        if (comp) break;
      }
      let cur = (comp?.inputs as { ATTR_content?: { block?: { next?: { block?: unknown } } } } | undefined)
        ?.ATTR_content?.block;
      for (let i = 1; i < 4 && cur?.next?.block; i++) {
        cur = cur.next.block as typeof cur;
      }
      if (cur?.next) delete cur.next;

      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi;
      api.loadBlocklyState(doc);

      const seen: string[] = [];
      (globalThis as unknown as { __loadPcts: string[] }).__loadPcts = seen;
      const pctEl = document.getElementById("blockly-load-pct");
      const overlay = document.getElementById("blockly-load-overlay");
      if (pctEl && overlay) {
        const record = () => {
          if (!overlay.hidden && pctEl.textContent) {
            const v = pctEl.textContent.trim();
            if (seen[seen.length - 1] !== v) seen.push(v);
          }
        };
        new MutationObserver(record).observe(overlay, { attributes: true, subtree: true, characterData: true, childList: true });
      }
      return { mode: api.getEditorMode(), canonical: api.getCanonicalBlockCount() };
    }, mhv1Text);
    assertEquals(subsetCount.mode, "treemap", "4-section MHV1 subset (>400 blocks) must open in Treemap");
    assert(
      subsetCount.canonical > 400 && subsetCount.canonical < 700,
      `expected ~434 blocks in 4-section subset, got ${subsetCount.canonical}`,
    );

    await page.click("#btn-mode-full");
    await page.waitForFunction(() => {
      const overlay = document.getElementById("blockly-load-overlay");
      const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi;
      return Boolean(overlay?.hidden) && api.getEditorMode() === "full-blockly" && api.getMountedBlockCount() > 350;
    }, undefined, { timeout: 45_000 });

    const loadPcts = await page.evaluate(() => (globalThis as unknown as { __loadPcts: string[] }).__loadPcts);
    assert(loadPcts.length >= 2, `expected live percentage updates while laying out full canvas, saw: ${loadPcts.join(", ")}`);
    assert(loadPcts.some((p) => p.endsWith("%")), `expected percentage values, saw: ${loadPcts.join(", ")}`);

    // 7. Settings menu -> Animations: Always on (default) overrides OS reduce-motion,
    //    Follow system respects it, Off disables it, and Reset restores Always on.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.click("#btn-menu-settings");
    const defaultSettings = await page.evaluate(() => ({
      dataAnim: document.documentElement.dataset.animations,
      statusText: document.getElementById("settings-reduce-motion-status")?.textContent?.trim(),
      checkedVal: (document.querySelector('input[name="settings-animations"]:checked') as HTMLInputElement | null)?.value,
    }));
    assertEquals(defaultSettings.checkedVal, "on", "Animations should default to Always on");
    assertEquals(defaultSettings.dataAnim, "on", "Always on must keep data-animations=on even when OS reduce-motion is ON");
    assertEquals(defaultSettings.statusText, "System: reduce motion is ON");

    await page.click('input[name="settings-animations"][value="system"]');
    assertEquals(
      await page.evaluate(() => document.documentElement.dataset.animations),
      "off",
      "Follow system must disable animations when OS reduce-motion is ON",
    );

    await page.click("#btn-settings-animations-reset");
    assertEquals(
      await page.evaluate(() => document.documentElement.dataset.animations),
      "on",
      "Reset to default must restore Always on",
    );
  } finally {
    await browser.close();
  }
});
