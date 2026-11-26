/**
 * Retake the general tutorial screenshots (docs/tutorial/basic-mapping.md,
 * default-context.md, sheets-and-decision-tables.md and treemap.md) from the
 * local build. Only bundled Example Sets are used; no AI request.
 *
 *   deno task build && deno task dev
 *   UI_TEST_BASE_URL=http://127.0.0.1:5173 deno run -A scripts/tutorial_screenshots.ts [--only treemap|dialogs]
 *
 * The MHV1 Example Set takes a minute or two to load in headless Chromium.
 * Value-set hints and AI screenshots have their own scripts
 * (tutorial_hint_screenshots.ts, tutorial_ai_screenshots.ts).
 */
import { chromium, type Locator, type Page } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../src/ui_test/test_api.ts";
import { baseUrl, waitForTestApi } from "../test/ui/helpers.ts";

const out = new URL("../docs/assets/tutorial/", import.meta.url).pathname;
const onlyIdx = Deno.args.indexOf("--only");
const only = onlyIdx >= 0 ? Deno.args[onlyIdx + 1] : null;
const MHV1 = "Obstetric MHV1 generic entry (Simplified FLAT, Web Template) — mapped";
const CHEMO_DT = "Patient-reported chemotherapy symptoms (FLAT → TakeCare XML) — mapped, decision tables";

async function openApp(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
  await waitForTestApi(page);
}

async function loadExampleSet(page: Page, title: string): Promise<void> {
  page.once("dialog", (d) => void d.accept());
  await page.click("#btn-example-sets");
  await page.locator("#menu-example-sets").getByText(title, { exact: true }).click();
  await page.waitForFunction(
    (t) => document.body.innerText.includes(`Loaded example set "${t}"`),
    title,
    { timeout: 300_000 },
  );
  await page.locator("#blockly-load-overlay").waitFor({ state: "hidden", timeout: 120_000 });
  await page.waitForTimeout(1500);
}

function editorMode(page: Page): Promise<string> {
  return page.evaluate(() =>
    (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.getEditorMode()
  );
}

/** Screenshot the Mapping Editors header plus the canvas / treemap stage (not the tabs below). */
async function shootEditorTop(page: Page, file: string, extraHeight = 0): Promise<void> {
  const header = (await page.locator(".mapping-pane .pane-header").boundingBox())!;
  const stage = (await page.locator("#mapping-top-stage").boundingBox())!;
  await page.screenshot({
    path: `${out}${file}`,
    clip: {
      x: header.x,
      y: header.y,
      width: header.width,
      height: Math.ceil(stage.y + stage.height - header.y + extraHeight),
    },
  });
}

async function shoot(locator: Locator, file: string): Promise<void> {
  await locator.screenshot({ path: `${out}${file}` });
}

const browser = await chromium.launch({ headless: true });
try {
  if (!only || only === "dialogs") {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openApp(page);
    // default-context.md: the joint load dialog.
    await page.click("#btn-open-template");
    const dialog = page.locator("#dialog-joint-load");
    await dialog.waitFor({ state: "visible" });
    await shoot(dialog, "default-context.png");
    await page.keyboard.press("Escape");

    // sheets-and-decision-tables.md: a decision table in Tables & Sheets.
    await loadExampleSet(page, CHEMO_DT);
    await page.locator(".mapping-pane").getByRole("button", { name: "Tables & Sheets" }).click();
    await page.waitForTimeout(600);
    await shoot(page.locator(".mapping-pane"), "sheets-tab.png");
    await page.close();
  }

  if (!only || only === "treemap") {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await openApp(page);
    await page.locator("#btn-slide-source").click();
    await page.locator("#btn-slide-output").click();
    await loadExampleSet(page, MHV1);
    if (await editorMode(page) !== "treemap") throw new Error("MHV1 should open in Treemap Overview");

    await shootEditorTop(page, "treemap-overview.png");

    await page.click('[data-tm-filter="mandatory-missing"]');
    await page.waitForTimeout(800);
    await shootEditorTop(page, "treemap-filter.png");
    await page.click('[data-tm-filter="all"]');
    await page.waitForTimeout(500);

    await page.locator(".tm-header", { hasText: "Social summary" }).first().click();
    await page.waitForTimeout(1000);
    await page.locator(".tm-leaf-row").first().click();
    await page.locator(".tm-inline-popover").waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    await shootEditorTop(page, "treemap-inline-editor.png");
    await page.keyboard.press("Escape");

    await page.locator(".tm-action-btn", { hasText: "Blockly ↗" }).first().click();
    await page.waitForFunction(() =>
      (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi
        .getEditorMode() === "scoped-blockly"
    );
    await page.locator("#blockly-load-overlay").waitFor({ state: "hidden", timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shootEditorTop(page, "treemap-scoped-blockly.png");
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Wrote tutorial screenshots to ${out}`);
