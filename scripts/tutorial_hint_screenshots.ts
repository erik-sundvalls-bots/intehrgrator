/**
 * Retake docs/tutorial/value-set-hints.md screenshots from the local build.
 * No AI request or credentials: only the bundled blood-pressure fixtures.
 *
 * deno task build && deno task dev
 * UI_TEST_BASE_URL=http://127.0.0.1:5173 deno run -A scripts/tutorial_hint_screenshots.ts
 */
import { chromium } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../src/ui_test/test_api.ts";
import { baseUrl, loadBpFixtures, waitForTestApi } from "../test/ui/helpers.ts";

const out = new URL("../docs/assets/tutorial/", import.meta.url).pathname;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
  await waitForTestApi(page);
  await loadBpFixtures(page);
  await page.locator("#btn-slide-source").click();
  await page.locator("#btn-slide-output").click();
  await page.locator("#tab-hints").click();
  await page.locator(".hints-row", { hasText: "Position" }).click();
  await page.waitForTimeout(300);
  await page.locator(".mapping-pane").screenshot({ path: `${out}value-set-hints.png` });

  await page.getByRole("button", { name: "Decision table: source → code", exact: true }).click();
  await page.locator("#dialog-hint-ai").screenshot({ path: `${out}value-set-hint-ai-offer.png` });
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  const tableId = await page.evaluate(() => {
    const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi;
    const table = api.getSnapshot().blocklyBlocks.find((block) => block.type === "decision_table");
    if (table) api.scrollBlockIntoView(table.id);
    return table?.id;
  });
  if (!tableId) throw new Error("Expected the connected decision-table block");
  await page.waitForTimeout(300);
  await page.locator(".mapping-pane").screenshot({ path: `${out}value-set-hint-decision-table.png` });
} finally {
  await browser.close();
}
console.log(`Wrote value-set hint screenshots to ${out}`);
