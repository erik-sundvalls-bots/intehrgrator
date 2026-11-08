/**
 * Browser UI test: toolbox Search indexes custom Source / Maps blocks
 * and the search input is clickable (not covered by the category row).
 *
 * Loading a template calls updateToolbox, which builds a new search input.
 * Typing into the input that is about to be replaced leaves the flyout
 * empty. Wait until that node has stopped being replaced, then search.
 */

import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, loadBpFixtures, waitForTestApi } from "./helpers.ts";

const SEARCH = '.blocklyToolboxDiv input[type="search"]';

async function waitForStableSearchField(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const input = document.querySelector('.blocklyToolboxDiv input[type="search"]');
    const state = globalThis as unknown as {
      __toolboxSearchNode?: Element;
      __toolboxSearchSince?: number;
    };
    if (!(input instanceof HTMLInputElement)) return false;
    if (state.__toolboxSearchNode !== input) {
      state.__toolboxSearchNode = input;
      state.__toolboxSearchSince = Date.now();
      return false;
    }
    return Date.now() - (state.__toolboxSearchSince ?? 0) > 400;
  }, undefined, { timeout: 20_000 });
}

async function searchShows(page: Page, query: string, flyoutPattern: string): Promise<void> {
  await waitForStableSearchField(page);
  const search = page.locator(SEARCH);
  await search.click();
  await search.fill("");
  await search.pressSequentially(query, { delay: 20 });
  await page.waitForFunction(
    (expected: { query: string; flyoutPattern: string }) => {
      const input = document.querySelector(
        '.blocklyToolboxDiv input[type="search"]',
      ) as HTMLInputElement | null;
      const flyout = document.querySelector(".blocklyFlyout");
      return Boolean(
        input &&
          input.value === expected.query &&
          flyout &&
          new RegExp(expected.flyoutPattern, "i").test(flyout.textContent ?? ""),
      );
    },
    { query, flyoutPattern },
    { timeout: 8_000 },
  );
}

Deno.test({
  name: "UI: toolbox Search finds custom Source and Maps blocks",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      await searchShows(page, "source", "source");
      await searchShows(page, "maps", "map");
    } finally {
      await browser.close();
    }
  },
});
