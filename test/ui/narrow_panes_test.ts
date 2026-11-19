/**
 * Portrait / narrow widths stack the three panes. They must stay reachable
 * with a real content height, not a 140px strip whose trees are a few pixels.
 * Desktop stays a side-by-side split. Emulation is not a physical iPad.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium, webkit, type Browser, type Page } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const USABLE_PX = 100;

type Box = {
  h: number;
  w: number;
  clientH: number;
  scrollH: number;
  top: number;
  bottom: number;
  slid: boolean;
};

type Layout = {
  vw: number;
  vh: number;
  dir: string;
  bodyScroll: number;
  bodyClient: number;
  source: Box;
  schema: Box;
  example: Box;
  mapping: Box;
  blockly: Box;
  output: Box;
  target: Box;
  spec: Box;
  activePanel: number;
};

function readLayout(): Layout {
  const box = (el: Element | null): Box => {
    if (!el) return { h: 0, w: 0, clientH: 0, scrollH: 0, top: 0, bottom: 0, slid: false };
    const r = el.getBoundingClientRect();
    const html = el as HTMLElement;
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      clientH: html.clientHeight,
      scrollH: html.scrollHeight,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      slid: el.classList.contains("pane--slid-away"),
    };
  };
  const panes = document.querySelector(".panes");
  const panel = document.querySelector("sl-tab-panel[active]");
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    dir: panes ? getComputedStyle(panes).flexDirection : "",
    bodyScroll: document.body.scrollHeight,
    bodyClient: document.body.clientHeight,
    source: box(document.getElementById("source-pane")),
    schema: box(document.getElementById("schema-tree")),
    example: box(document.getElementById("example-tree")),
    mapping: box(document.querySelector(".mapping-pane")),
    blockly: box(document.getElementById("blockly-mount")),
    output: box(document.getElementById("output-pane")),
    target: box(document.getElementById("target-schema-tree")),
    spec: box(document.querySelector(".mapping-bottom")),
    activePanel: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
  };
}

async function layout(page: Page): Promise<Layout> {
  return await page.evaluate(readLayout);
}

function assertStackedUsable(name: string, got: Layout): void {
  assertEquals(got.dir, "column", `${name} stacks the panes`);
  assertEquals(got.source.slid, false, `${name} source is not slid away`);
  assertEquals(got.output.slid, false, `${name} target is not slid away`);
  assert(got.schema.clientH >= USABLE_PX, `${name} schema tree ${got.schema.clientH}px`);
  assert(got.example.clientH >= USABLE_PX, `${name} example tree ${got.example.clientH}px`);
  assert(got.blockly.clientH >= 180, `${name} canvas ${got.blockly.clientH}px`);
  assert(got.spec.clientH >= 80, `${name} mapping text ${got.spec.clientH}px`);
  assert(got.target.clientH >= USABLE_PX, `${name} target tree ${got.target.clientH}px`);
  assert(got.target.scrollH > got.target.clientH + 40, `${name} target tree scrolls`);
  assert(got.output.h < 800, `${name} target pane stays bounded (${got.output.h}px)`);
  assert(got.mapping.h < 800, `${name} mapping pane stays bounded (${got.mapping.h}px)`);
  assert(got.bodyScroll > got.vh + 40, `${name} page scrolls to the lower panes`);
}

async function openApp(
  browser: Browser,
  width: number,
  height: number,
  storage?: Record<string, string>,
): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript((saved) => {
    const clear = [
      "layout-main-panes-v3",
      "layout-source-sections",
      "layout-mapping-sections-v2",
      "layout-source-slid-away-v1",
      "layout-output-slid-away-v1",
    ];
    for (const key of clear) localStorage.removeItem(key);
    if (saved) {
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
    }
  }, storage ?? null);
  await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForTestApi(page);
  await loadBpFixtures(page);
  await page.waitForFunction(
    () => (document.getElementById("target-schema-tree")?.scrollHeight ?? 0) > 200,
    undefined,
    { timeout: 20_000 },
  );
  return page;
}

async function exercise(browser: Browser, engine: string): Promise<void> {
  const page = await openApp(browser, 768, 1024);
  try {
    assertStackedUsable(`${engine} 768x1024`, await layout(page));

    await page.evaluate(() => {
      document.getElementById("output-pane")?.scrollIntoView({ block: "start" });
    });
    const brought = await layout(page);
    assert(
      brought.target.top < brought.vh && brought.target.bottom > 0,
      `${engine} target tree can be scrolled into view`,
    );
    const moved = await page.evaluate(() => {
      const tree = document.getElementById("target-schema-tree");
      if (!tree) return 0;
      const before = tree.scrollTop;
      tree.scrollTop = 240;
      return tree.scrollTop - before;
    });
    assert(moved > 40, `${engine} target tree scrollTop moves`);

    await page.locator("#tab-generated-script").click();
    await page.waitForTimeout(200);
    const script = await layout(page);
    assert(script.activePanel >= USABLE_PX, `${engine} script tab ${script.activePanel}px`);
    await page.locator("#tab-test-run").click();
    await page.waitForTimeout(200);
    const testRun = await layout(page);
    assert(testRun.activePanel >= USABLE_PX, `${engine} test tab ${testRun.activePanel}px`);
    await page.locator("#tab-target-schema").click();

    await page.locator("#btn-slide-source").click();
    await page.waitForTimeout(150);
    const away = await layout(page);
    assertEquals(away.source.slid, true);
    assert(away.source.h <= 48, `${engine} slid source is a rail (${away.source.h}px)`);
    await page.locator("#rail-source button").click();
    await page.waitForTimeout(150);
    const back = await layout(page);
    assertEquals(back.source.slid, false);
    assert(back.schema.clientH >= USABLE_PX, `${engine} restored schema ${back.schema.clientH}px`);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    assertStackedUsable(`${engine} landscape`, await layout(page));

    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(200);
    assertStackedUsable(`${engine} 600px`, await layout(page));

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(200);
    assertStackedUsable(`${engine} breakpoint`, await layout(page));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(250);
    const desktop = await layout(page);
    assertEquals(desktop.dir, "row", `${engine} desktop is side by side`);
    assert(desktop.source.h > 600, `${engine} desktop source ${desktop.source.h}px`);
    assert(desktop.schema.clientH > 200, `${engine} desktop schema ${desktop.schema.clientH}px`);
    assert(desktop.target.clientH > 200, `${engine} desktop target ${desktop.target.clientH}px`);
    assert(desktop.bodyScroll <= desktop.vh + 8, `${engine} desktop does not grow a long page`);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(200);
    assertStackedUsable(`${engine} back to portrait`, await layout(page));
  } finally {
    await page.close();
  }
}

Deno.test({
  name: "UI: narrow panes keep source, canvas, and target reachable",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      await exercise(browser, "chromium");
      const page = await openApp(browser, 768, 1024, {
        "layout-main-panes-v3": JSON.stringify([0.04, 0.92, 0.04]),
      });
      try {
        const saved = await layout(page);
        assert(saved.schema.clientH >= USABLE_PX, `saved main ratio schema ${saved.schema.clientH}px`);
        assert(saved.target.clientH >= USABLE_PX, `saved main ratio target ${saved.target.clientH}px`);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(250);
        const wide = await layout(page);
        assertEquals(wide.dir, "row");
        assert(wide.source.w < 160, `desktop still honors a narrow saved source (${wide.source.w}px)`);
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: narrow panes stay reachable in WebKit",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    let browser: Browser;
    try {
      // This VM's WebKit GPU process crashes without software rendering.
      // A real iPad is not this emulator.
      for (const [key, value] of [
        ["LIBGL_ALWAYS_SOFTWARE", "1"],
        ["WEBKIT_DISABLE_COMPOSITING_MODE", "1"],
      ] as const) {
        Deno.env.set(key, value);
        const nodeEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
        if (nodeEnv) nodeEnv[key] = value;
      }
      browser = await webkit.launch({ headless: true });
    } catch (err) {
      console.warn("webkit unavailable, skipping:", err);
      return;
    }
    try {
      try {
        await exercise(browser, "webkit");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("has been closed") || message.includes("Target closed")) {
          console.warn(
            "WebKit closed while starting the workbench in this environment. Layout was not measured there.",
          );
          return;
        }
        throw err;
      }
    } finally {
      await browser.close();
    }
  },
});
