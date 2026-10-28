/**
 * Browser UI (#289): the id-language dropdown on the COMPOSITION root block.
 * Options are the target's languages (lang.1 first, default); a pick is one
 * Blockly undo step; with mappings present the user confirms first.
 */
import { assert, assertEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSlotIdEndingWith,
  fixtureText,
  getSnapshot,
  waitForTestApi,
} from "./helpers.ts";

type Api = {
  loadTemplate(n: string, c: string): void;
  loadSchema(n: string, c: string): void;
  mapNodeToSlot(slotId: string, path: string, format: string): void;
  undo(): void;
};

function idLanguage(page: Page): Promise<string | undefined> {
  return getSnapshot(page).then((s) =>
    s.blocklyBlocks.find((b) => b.type === "composition")?.fields.ID_LANGUAGE as
      | string
      | undefined
  );
}

type Rect = { x: number; y: number; width: number; height: number };

/** The id-language field's on-screen box, wheeling the canvas until it shows. */
async function fieldBox(page: Page): Promise<Rect> {
  for (let i = 0; i < 8; i++) {
    const r = await page.evaluate((field) => {
      const api = (globalThis as unknown as {
        intehrgratorTestApi: {
          getSnapshot(): { blocklyBlocks: Array<{ type: string; id: string }> };
          getFieldClientRect(id: string, field: string): Rect | null;
        };
      }).intehrgratorTestApi;
      const id = api.getSnapshot().blocklyBlocks.find((b) =>
        b.type === "composition"
      )!.id;
      const pane = document.querySelector(".injectionDiv")!
        .getBoundingClientRect();
      return {
        box: api.getFieldClientRect(id, field),
        pane: { x: pane.x, y: pane.y, width: pane.width, height: pane.height },
      };
    }, "ID_LANGUAGE");
    assert(r.box, "id language field not rendered");
    const { box, pane } = r;
    const inside = box.y >= pane.y + 10 &&
      box.y + box.height <= pane.y + pane.height - 10 &&
      box.x >= pane.x && box.x + box.width <= pane.x + pane.width;
    if (inside) return box;
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.wheel(box.x - (pane.x + 200), box.y - (pane.y + 80));
    await page.waitForTimeout(300);
  }
  throw new Error("id language field never scrolled into view");
}

async function openMenu(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  const box = await fieldBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(".blocklyDropDownDiv .blocklyMenuItem").first().waitFor({
    timeout: 5_000,
  });
}

async function pick(page: Page, option: string): Promise<void> {
  await openMenu(page);
  await page.locator(".blocklyDropDownDiv .blocklyMenuItem", {
    hasText: option,
  }).first().click();
  await page.waitForTimeout(400);
}

Deno.test({
  name: "UI: id language dropdown on the COMPOSITION root (#289)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1600, height: 1400 },
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      const opt = await fixtureText(
        "test/fixtures/simple-diagnose-and-vitals.opt",
      );
      await page.evaluate((opt) => {
        (globalThis as unknown as { intehrgratorTestApi: Api })
          .intehrgratorTestApi.loadTemplate("vitals.opt", opt);
      }, opt);
      await page.waitForFunction(
        () =>
          (globalThis as unknown as {
            intehrgratorTestApi: {
              getSnapshot(): { blocklyBlocks: Array<{ type: string }> };
            };
          })
            .intehrgratorTestApi.getSnapshot().blocklyBlocks.some((b) =>
              b.type === "composition"
            ),
        undefined,
        { timeout: 20_000 },
      );
      assertEquals(await idLanguage(page), "primary");
      // Menu: lang.1 (primary) first, then the OPT's other languages.
      await openMenu(page);
      const items = await page.locator(".blocklyDropDownDiv .blocklyMenuItem")
        .allTextContents();
      assertEquals(items.map((t) => t.trim().slice(0, 2)), ["en", "sv", "de"]);
      assert(items[0]!.includes("lang.1"), items[0]);
      await page.locator(".blocklyDropDownDiv .blocklyMenuItem").first()
        .click();
      await page.waitForTimeout(400);

      // Template defaults only, no source mappings yet: no question asked.
      let asked = 0;
      page.on("dialog", (d) => {
        asked++;
        void d.dismiss();
      });
      await openMenu(page);
      await page.locator(".blocklyDropDownDiv .blocklyMenuItem", {
        hasText: "sv",
      }).first().click();
      await page.waitForTimeout(400);
      assertEquals(asked, 0);
      assertEquals(await idLanguage(page), "sv");

      // One Blockly undo step.
      await page.evaluate(() =>
        (globalThis as unknown as { intehrgratorTestApi: Api })
          .intehrgratorTestApi.undo()
      );
      await page.waitForTimeout(400);
      assertEquals(await idLanguage(page), "primary");

      // With a mapping, the user confirms; dismissing keeps lang.1.
      await page.evaluate(() => {
        (globalThis as unknown as { intehrgratorTestApi: Api })
          .intehrgratorTestApi.loadSchema(
            "vitals.xml",
            `<?xml version="1.0"?>\n<vitals xml:lang="en"><note>x</note></vitals>`,
          );
      });
      await page.waitForTimeout(300);
      const slotId = await findSlotIdEndingWith(page, "/value/value");
      await page.evaluate((slotId) => {
        (globalThis as unknown as { intehrgratorTestApi: Api })
          .intehrgratorTestApi.mapNodeToSlot(slotId, "/vitals/note", "xml");
      }, slotId);
      await page.waitForTimeout(400);
      await pick(page, "de");
      assertEquals(asked, 1);
      assertEquals(await idLanguage(page), "primary");
    } finally {
      await browser.close();
    }
  },
});
