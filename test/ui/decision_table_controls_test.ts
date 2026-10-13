/**
 * Browser UI: decision-table controls in Tables & Sheets and on the eval block.
 * Column kind, delete/undo, don't-care, hit policy, and the output dropdown label.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";
import { baseUrl, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: decision table column menu, don't-care, hit policy, and output label",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1400, height: 900 });
      page.on("dialog", (dialog) => {
        if (dialog.type() === "prompt") void dialog.accept("Decision1");
        else void dialog.accept();
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      await page.locator("#tab-sheets").click();
      const actions = page.locator("#sheets-actions");
      await actions.getByRole("button", { name: "Add decision table" }).click();
      await page.locator(".sheets-grid thead td", { hasText: "out" }).first().waitFor({
        timeout: 8_000,
      });

      const tabBox = await page.locator("#tab-sheets").boundingBox();
      const actionsBox = await actions.boundingBox();
      assert(tabBox && actionsBox, "sheets tab and actions are visible");
      assert(
        actionsBox.x > tabBox.x + tabBox.width,
        `sheet buttons sit to the right of the tabs (actions.x=${actionsBox.x}, tab.right=${tabBox.x + tabBox.width})`,
      );
      assert(
        Math.abs(actionsBox.y - tabBox.y) < 24,
        `sheet buttons share the tab row (actions.y=${actionsBox.y}, tab.y=${tabBox.y})`,
      );
      await actions.getByRole("button", { name: "Add sheet" }).waitFor();

      const outHeader = page.locator('.sheets-grid thead td[data-x="2"]');
      assertEquals((await outHeader.locator(".dt-header-cog").getAttribute("aria-label")), "out column menu");
      await outHeader.locator(".dt-header-cog").click();
      const menu = page.locator("#dt-column-menu");
      await menu.waitFor({ state: "visible" });
      const selects = menu.locator("select");
      assertEquals(await selects.count(), 1, "one column-kind dropdown");
      const kind = selects.first();
      const optionLabels = await kind.locator("option").allTextContents();
      assertEquals(optionLabels, ["string", "number", "boolean", "string pattern"]);
      await kind.selectOption({ label: "string pattern" });
      await menu.waitFor({ state: "hidden", timeout: 5_000 });
      assertEquals(await outHeader.getAttribute("data-dt-glyph"), "{}");
      assertEquals((await outHeader.evaluate((el) => el.textContent ?? "")).trim(), "out");

      await page.getByRole("button", { name: "Add input/condition" }).click();
      await page.locator('.sheets-grid thead td[data-x="2"]', { hasText: "in3" }).waitFor({
        timeout: 5_000,
      });

      await page.getByRole("button", { name: "Add output", exact: true }).click();
      const out2 = page.locator('.sheets-grid thead td[data-x="4"]');
      await out2.waitFor({ timeout: 5_000 });
      await out2.locator(".dt-header-cog").click();
      const deleteOut2 = page.locator("#dt-column-menu .dt-column-menu-delete");
      assertEquals(await deleteOut2.textContent(), "Delete out2");
      const deleteColor = await deleteOut2.evaluate((el) => getComputedStyle(el).backgroundColor);
      assert(
        deleteColor === "rgb(198, 40, 40)",
        `delete control is red (background ${deleteColor})`,
      );
      await deleteOut2.click();
      const toast = page.locator(".sheets-toast");
      await toast.waitFor({ state: "visible" });
      assertEquals(
        await toast.textContent(),
        "Deleted column out2. Undo can restore it.",
      );
      await page.locator('.sheets-grid thead td', { hasText: "out2" }).waitFor({
        state: "detached",
        timeout: 5_000,
      });

      await page.locator("#btn-undo").click();
      await page.locator('.sheets-grid thead td', { hasText: "out2" }).first().waitFor({
        timeout: 5_000,
      });

      await page.getByRole("button", { name: "Add default row" }).click();
      const catchAll = page.locator('.sheets-grid td[data-x="0"][data-y="3"]');
      await catchAll.waitFor({ timeout: 5_000 });
      assertEquals((await catchAll.textContent())?.trim(), "—");

      const firstCell = page.locator('.sheets-grid td[data-x="1"][data-y="0"]');
      await firstCell.click({ button: "right" });
      await page.locator(".jss_contextmenu").getByText("Don't care (—)", { exact: true }).click();
      await page.waitForFunction(() => {
        const cell = document.querySelector('.sheets-grid td[data-x="1"][data-y="0"]');
        return cell?.textContent?.trim() === "—";
      }, undefined, { timeout: 5_000 });

      await page.getByRole("button", { name: "About hit policy" }).click();
      const balloon = page.locator("#info-tip-layer .info-tip-balloon");
      await balloon.waitFor({ state: "visible" });
      const help = await balloon.innerText();
      assert(help.includes("FIRST"), help);
      assert(help.includes("UNIQUE"), help);
      assert(help.includes("COLLECT"), help);
      const docs = balloon.locator("a");
      assertEquals(
        await docs.getAttribute("href"),
        "https://github.com/regionstockholm/intehrgrator/blob/main/docs/tutorial/sheets-and-decision-tables.md#hit-policy",
      );

      const blockId = await page.evaluate(() => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        const id = api.newBlock("decision_table");
        if (!id) return null;
        api.setBlockField(id, "NAME", "Decision1");
        api.scrollBlockIntoView(id);
        return id;
      });
      assert(blockId, "decision table block created");
      const outputBox = await page.evaluate((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        return api.getFieldClientRect(id, "OUTPUT");
      }, blockId);
      assert(outputBox, "output dropdown has a box");
      await page.mouse.click(outputBox.x + outputBox.width / 2, outputBox.y + outputBox.height / 2);
      const allOutputs = page.getByRole("option", { name: "all outputs" });
      await allOutputs.waitFor({ state: "visible", timeout: 5_000 });
      await page.getByRole("option", { name: "out2", exact: true }).click();
      await page.waitForFunction((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        const block = api.getSnapshot().blocklyBlocks.find((b) => b.id === id);
        return block?.fields.OUTPUT === "out2";
      }, blockId, { timeout: 5_000 });
      await page.waitForFunction((id) => {
        const root = document.querySelector(`.blocklyDraggable[data-id="${id}"]`);
        const text = (root?.querySelector(".blocklyDropdownText")?.textContent ?? "")
          .replaceAll("\u00a0", " ")
          .replace("▾", "")
          .trim();
        return text === "out2";
      }, blockId, { timeout: 5_000 });
      const labelAfterColumn = await dropdownLabel(page, blockId);
      assertEquals(labelAfterColumn, "out2");

      const outputBoxAgain = await page.evaluate((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        api.scrollBlockIntoView(id);
        return api.getFieldClientRect(id, "OUTPUT");
      }, blockId);
      assert(outputBoxAgain, "output dropdown still has a box");
      await page.mouse.click(
        outputBoxAgain.x + outputBoxAgain.width / 2,
        outputBoxAgain.y + outputBoxAgain.height / 2,
      );
      await page.getByRole("option", { name: "all outputs" }).click();
      await page.waitForFunction((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        const block = api.getSnapshot().blocklyBlocks.find((b) => b.id === id);
        return block?.fields.OUTPUT === "*";
      }, blockId, { timeout: 5_000 });
      await page.waitForFunction((id) => {
        const root = document.querySelector(`.blocklyDraggable[data-id="${id}"]`);
        const text = (root?.querySelector(".blocklyDropdownText")?.textContent ?? "")
          .replaceAll("\u00a0", " ")
          .replace("▾", "")
          .trim();
        return text === "all outputs";
      }, blockId, { timeout: 5_000 });
      assertEquals(await dropdownLabel(page, blockId), "all outputs");
    } finally {
      await browser.close();
    }
  },
});

async function dropdownLabel(
  page: import("npm:playwright@1.51.0").Page,
  blockId: string,
): Promise<string> {
  const text = await page.evaluate((id) => {
    const root = document.querySelector(`.blocklyDraggable[data-id="${id}"]`);
    const el = root?.querySelector(".blocklyDropdownText");
    return el?.textContent ?? "";
  }, blockId);
  return text.replaceAll("\u00a0", " ").replace("▾", "").trim();
}
