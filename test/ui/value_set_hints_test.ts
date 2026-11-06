/**
 * Hints tab and canvas badge for a multi-code slot (Design C+).
 * The slot stays empty; the tab lists the codes and can dismiss the hint.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";
import { baseUrl, fixtureText, loadBpFixtures, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: value-set hint badge opens the Hints tab and the slot stays empty",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);

      await page.locator("#tab-hints").click();
      await page.locator("#hints-host:not([hidden])").waitFor();
      const position = page.locator(".hints-row", { hasText: "Position" });
      await position.waitFor();
      await position.click();
      await page.locator(".hints-chip", { hasText: "Standing" }).waitFor();
      await page.locator(".hints-chip", { hasText: "Sitting" }).waitFor();

      const badge = page.locator(".hint-badge").first();
      await badge.waitFor();
      const slotId = await badge.getAttribute("data-slot-id");
      assert(slotId);

      const valueBlock = await page.evaluate((id) => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: {
            getSnapshot: () => { blocklyBlocks: Array<{ type: string; fields?: Record<string, string> }> };
          };
        }).intehrgratorTestApi;
        return api.getSnapshot().blocklyBlocks.some((block) =>
          block.type === "lists_getIndex" ||
          (block.fields?.SLOT_ID === id && block.type === "dv_coded_text")
        );
      }, slotId);
      assertEquals(valueBlock, false);

      await badge.click();
      await page.locator("#tab-hints.active").waitFor();
      await page.locator(`.hints-row[data-hint-slot="${slotId}"][aria-selected="true"]`).waitFor();

      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.locator(".hints-row--dismissed", { hasText: "Position" }).waitFor();
      await page.getByRole("button", { name: "Restore dismissed hints" }).click();
      await page.locator(".hints-row--dismissed", { hasText: "Position" }).waitFor({ state: "detached" });
    } finally {
      await browser.close();
    }
  },
});

// The headless action tests cannot catch missing SVG initialization. Exercise
// the actual Hints buttons and inspect both the connected tree and its SVGs.
for (const kind of ["coded", "units"] as const) {
  for (const action of ["Use as constant", "Decision table", "Sheet lookup"] as const) {
    Deno.test({
      name: `UI: ${kind} hint ${action} creates a rendered connected mapping`,
      sanitizeResources: false,
      sanitizeOps: false,
      async fn() {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
          await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
          await waitForTestApi(page);
          let opt = await fixtureText("test/fixtures/blood_pressure.opt");
          if (kind === "units") {
            // Make the systolic constraint multi-unit without changing the
            // production fixture (single-unit quantities have no hint).
            opt = opt.replace(
              /<list>\s*<magnitude>[\s\S]*?<units>mm\[Hg\]<\/units>\s*<\/list>/,
              (list) => list + list.replace("mm[Hg]", "kPa"),
            );
          }
          await page.evaluate(
            (content) =>
              (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi!.loadTemplate(
                "bp.opt",
                content,
              ),
            opt,
          );
          await page.locator("#tab-hints").click();
          const row = page.locator(".hints-row", { hasText: kind === "coded" ? "Position" : "Systolic" });
          await row.waitFor();
          const slotId = await row.getAttribute("data-hint-slot");
          assert(slotId);
          if (kind === "units") {
            const schema = await fixtureText("test/fixtures/dummy-json-vitals/source.schema.json");
            const example = await fixtureText("test/fixtures/dummy-json-vitals/instance-1.json");
            await page.evaluate(({ schema, example, slotId }) => {
              const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi!;
              api.loadSchema("vitals.schema.json", schema);
              api.addExample("vitals.json", example);
              api.mapNodeToSlot(slotId, "$.systolic", "json");
            }, { schema, example, slotId });
          }
          await row.click();
          if (kind === "units") await page.locator(".hints-chip", { hasText: "kPa" }).click();
          await page.waitForTimeout(100);
          errors.length = 0;
          const undoBefore = await page.evaluate(() =>
            (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.undoCount()
          );
          await page.getByRole("button", {
            name: action === "Decision table" ? "Decision table: source → code" : action,
            exact: true,
          }).click();
          // Let the same controller persistence/render cycle the user sees run.
          await page.waitForTimeout(250);
          const result = await page.evaluate((id) => {
            const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
              .intehrgratorTestApi as IntehrgratorTestApi;
            type SavedBlock = {
              id: string;
              type: string;
              fields?: Record<string, string>;
              inputs?: Record<string, { block?: SavedBlock; shadow?: SavedBlock }>;
              next?: { block?: SavedBlock };
            };
            const state = JSON.parse(api.getBlocklyStateJson()) as { blocks: { blocks: SavedBlock[] } };
            function flatten(block: SavedBlock): SavedBlock[] {
              return [
                block,
                ...Object.values(block.inputs ?? {}).flatMap((input) =>
                  input.block ? flatten(input.block) : input.shadow ? flatten(input.shadow) : []
                ),
                ...(block.next?.block ? flatten(block.next.block) : []),
              ];
            }
            const all = state.blocks.blocks.flatMap(flatten);
            const host = all.find((block) => block.type === "element" && block.fields?.SLOT_ID === id);
            const connected = host ? flatten(host).slice(1) : [];
            return {
              connected: connected.map((block) => ({
                type: block.type,
                fields: block.fields,
                rect: api.getBlockClientRect(block.id),
              })),
              slot: api.getSnapshot().model.slots.find((slot) => slot.slotId === id),
            };
          }, slotId);
          assertEquals(errors, [], "applying a hint must not throw in the rendered workspace");
          const type = action === "Decision table"
            ? "decision_table"
            : action === "Sheet lookup"
            ? "sheet_lookup"
            : "text";
          assert(result.connected.some((block) => block.type === type), `missing connected ${type}`);
          for (const block of result.connected) {
            assert(
              block.rect && block.rect.width > 0 && block.rect.height > 0,
              `${block.type} must have an initialized, rendered SVG`,
            );
          }
          assert(
            kind === "units" ? result.slot?.unitsExpression : result.slot?.expression,
            "connected blocks must project into the mapping model",
          );
          if (kind === "units") assertStringIncludes(result.slot?.expression ?? "", "$.systolic");
          if (action === "Use as constant" && kind === "units") assertEquals(result.slot?.unitsExpression, '"kPa"');
          assertEquals(
            await page.evaluate(() =>
              (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.undoCount()
            ),
            undoBefore + 1,
            "canvas, grid, and hint settings are one undo step",
          );
          // Decline the optional AI offer, then verify a single Undo restores
          // the hint and Redo restores the connected mapping.
          if (action !== "Use as constant") await page.keyboard.press("Escape");
          await page.evaluate(() =>
            (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.undo()
          );
          await page.locator("#tab-hints").click();
          await page.locator(`.hints-row[data-hint-slot="${slotId}"]`).waitFor();
          await page.evaluate(() =>
            (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.redo()
          );
          await page.waitForTimeout(250);
          const redone = await page.evaluate(
            (id) =>
              (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi.getSnapshot()
                .model.slots.find((slot) => slot.slotId === id),
            slotId,
          );
          assertEquals(
            kind === "units" ? redone?.unitsExpression : redone?.expression,
            kind === "units" ? result.slot?.unitsExpression : result.slot?.expression,
          );
        } finally {
          await browser.close();
        }
      },
    });
  }
}
