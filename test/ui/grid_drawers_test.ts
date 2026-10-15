/**
 * Browser UI: Decision Tables and Sheets sit with Variables and Functions.
 * The flyout add button creates a grid in the Tables & Sheets tab and does not
 * place a declaration chip.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";
import { baseUrl, waitForTestApi } from "./helpers.ts";

/** Blockly draws field spaces as NBSP, and appends the dropdown arrow. */
async function flyoutText(page: { locator: (selector: string) => { first: () => { evaluate: (fn: (el: Element) => string) => Promise<string> } } }): Promise<string> {
  return await page.locator(".blocklyFlyout").first().evaluate((el) =>
    (el.textContent ?? "").replaceAll("\u00a0", " ")
  );
}

Deno.test({
  name: "UI: grid drawers sit with Variables and add a grid from the flyout",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1400, height: 900 });
      page.on("dialog", (dialog) => {
        if (dialog.type() === "prompt") void dialog.accept(dialog.defaultValue() || "FromDrawer");
        else void dialog.accept();
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      const order = await page.evaluate(() => {
        const labels = [...document.querySelectorAll(".blocklyTreeLabel")].map((el) =>
          (el.textContent ?? "").trim()
        );
        return {
          decision: labels.indexOf("Decision Tables"),
          sheets: labels.indexOf("Sheets"),
          variables: labels.indexOf("Variables"),
          functions: labels.indexOf("Functions"),
          labels,
        };
      });
      assert(order.decision >= 0, `Decision Tables missing: ${order.labels.join(" | ")}`);
      assert(
        order.decision < order.sheets && order.sheets < order.variables && order.variables < order.functions,
        `drawers should be Decision Tables, Sheets, Variables, Functions: ${order.labels.join(" | ")}`,
      );

      await page.locator(".blocklyToolboxCategoryDecisionTables").click();
      await page.locator(".blocklyFlyout").getByText("Add decision table", { exact: true }).waitFor();
      assert((await flyoutText(page)).includes("-- select table --"), "empty decision name should prompt to select");
      await page.locator(".blocklyFlyout").getByText("Add decision table", { exact: true }).click();
      await page.locator("#tab-sheets.active").waitFor({ timeout: 5_000 });
      const decisionName = await page.locator(".sheets-select").inputValue();
      assertEquals(decisionName, "Decision");
      await page.locator(".sheets-grid").waitFor({ state: "visible", timeout: 8_000 });

      await page.locator(".blocklyToolboxCategorySheets").click();
      await page.locator(".blocklyFlyout").getByText("Add sheet", { exact: true }).waitFor();
      assert((await flyoutText(page)).includes("-- select sheet --"), "empty sheet name should prompt to select");
      await page.locator(".blocklyFlyout").getByText("Add sheet", { exact: true }).click();
      const sheetName = await page.locator(".sheets-select").inputValue();
      assertEquals(sheetName, "Sheet");

      await page.locator(".blocklyToolboxCategoryDecisionTables").click();
      await page.locator(".blocklyFlyout").getByText("Add decision table", { exact: true }).waitFor();
      const decisionFlyout = await flyoutText(page);
      assert(decisionFlyout.includes("Decision"), `sole decision table should be preselected: ${decisionFlyout}`);
      assert(!decisionFlyout.includes("-- select table --"), decisionFlyout);
      assert(decisionFlyout.includes("inputs"), `decision mouth should say inputs: ${decisionFlyout}`);

      await page.locator(".blocklyToolboxCategorySheets").click();
      await page.locator(".blocklyFlyout").getByText("Add sheet", { exact: true }).waitFor();
      const sheetFlyout = await flyoutText(page);
      assert(sheetFlyout.includes("Sheet"), `sole sheet should be preselected: ${sheetFlyout}`);
      assert(!sheetFlyout.includes("-- select sheet --"), sheetFlyout);

      const types = await page.evaluate(() => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        return api.getSnapshot().blocklyBlocks.map((block) => block.type);
      });
      assertEquals(types.includes("decision_table_decl"), false);
      assertEquals(types.includes("sheet"), false);
    } finally {
      await browser.close();
    }
  },
});
