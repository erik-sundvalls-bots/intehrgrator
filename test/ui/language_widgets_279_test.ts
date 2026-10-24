/**
 * Browser UI (#279): 💬 widgets show the language the target labels and the
 * source descriptions are shown in. Target labels follow `target.lang.1`
 * (the source's language) until the user picks another; the AI menu's
 * Languages… dialog sets `source.lang.N` and the AI context languages.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr279-*.png (never in CI).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";

const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";
const WT = "vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates/Accident report including vital signs.wt.json";
const SV_SOURCE = `<?xml version="1.0"?>\n<olycka xml:lang="sv"><skada>Fraktur</skada></olycka>`;

type Api = { loadTemplate(n: string, c: string): void; loadSchema(n: string, c: string): void };

async function load(page: Page, kind: "loadTemplate" | "loadSchema", name: string, content: string) {
  await page.evaluate(({ kind, name, content }) => {
    (globalThis as unknown as { intehrgratorTestApi: Api }).intehrgratorTestApi[kind](name, content);
  }, { kind, name, content });
  await page.waitForTimeout(300);
}

Deno.test({
  name: "UI: 💬 language widgets and the Languages dialog (#279)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      const targetBtn = page.locator("#target-lang-widget .lang-widget-btn");
      const targetTree = page.locator("#target-schema-tree");
      await load(page, "loadTemplate", "accident.wt.json", await fixtureText(WT));
      await targetBtn.waitFor({ state: "visible", timeout: 5_000 });
      assertEquals((await targetBtn.innerText()).trim(), "💬 en");
      assertStringIncludes(await targetTree.innerText(), "Injury");

      // A Swedish source makes sv target.lang.1: the target follows it.
      await load(page, "loadSchema", "olycka.xml", SV_SOURCE);
      assertEquals((await targetBtn.innerText()).trim(), "💬 sv");
      assertStringIncludes(await targetTree.innerText(), "Skada");
      // Hover shows the other languages' labels.
      const skada = targetTree.locator(".tree-label", { hasText: /^Skada/ }).first();
      assertStringIncludes((await skada.getAttribute("title")) ?? "", "en: Injury");
      assertEquals(await page.locator("#source-lang-widget").isVisible(), false, "one source language: no widget");

      // Keyboard: open, move to Deutsch, pick.
      await targetBtn.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.locator("#target-lang-widget-menu");
      await menu.waitFor({ state: "visible", timeout: 2_000 });
      const items = await menu.locator("[role=menuitemradio]").allInnerTexts();
      assert(items[0]!.includes("(sv)"), items.join(" | "));
      assert(items[1]!.startsWith("1."), items.join(" | "));
      if (SHOTS) {
        const box = await page.locator("#target-lang-widget").boundingBox();
        const mbox = await menu.boundingBox();
        if (box && mbox) {
          const x = Math.max(0, Math.min(box.x, mbox.x) - 260);
          await page.screenshot({
            path: "/workspace/pr279-target-widget.png",
            clip: { x, y: Math.max(0, box.y - 10), width: box.x + box.width - x + 20, height: mbox.y + mbox.height - box.y + 20 },
          });
        }
        await page.screenshot({ path: "/workspace/pr279-target-widget-page.png" });
      }
      const deIndex = items.findIndex((t) => t.includes("de"));
      await menu.locator("[role=menuitemradio]").nth(deIndex).focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      assertEquals((await targetBtn.innerText()).trim(), "💬 de");
      assertEquals(await menu.isVisible(), false);

      // Back to following the source.
      await targetBtn.click();
      await menu.locator(".lang-widget-follow").click();
      await page.waitForTimeout(300);
      assertEquals((await targetBtn.innerText()).trim(), "💬 sv");

      // A bilingual XSD source: the source widget switches its descriptions.
      await load(page, "loadSchema", "referral.xsd", await fixtureText("test/fixtures/multilingual-referral/referral.xsd"));
      const sourceBtn = page.locator("#source-lang-widget .lang-widget-btn");
      await sourceBtn.waitFor({ state: "visible", timeout: 5_000 });
      const sourceTree = page.locator("#schema-tree");
      await sourceBtn.click();
      await page.locator("#source-lang-widget-menu [data-lang=sv]").click();
      await page.waitForTimeout(300);
      const svHtml = await sourceTree.innerHTML();
      await sourceBtn.click();
      await page.locator("#source-lang-widget-menu [data-lang=en]").click();
      await page.waitForTimeout(300);
      const enHtml = await sourceTree.innerHTML();
      assert(svHtml !== enHtml, "source descriptions should change language");
      assertStringIncludes(enHtml, "Referral");
      assertEquals((await sourceBtn.innerText()).trim(), "💬 en");

      // AI menu → Languages…
      await page.click("#btn-copy-ai");
      await page.locator("#menu-ai-languages").click();
      const dialog = page.locator("#dialog-ai-languages");
      await dialog.waitFor({ state: "visible", timeout: 2_000 });
      await page.fill("#ai-source-languages", "sv, en, xx");
      await page.locator("input[name=ai-context-languages][value=all]").check();
      assertStringIncludes(await page.locator("#ai-source-languages-hint").innerText(), "xx");
      const preview = await page.locator("#ai-languages-preview").innerText();
      assertStringIncludes(preview, "sv, en");
      if (SHOTS) await dialog.screenshot({ path: "/workspace/pr279-languages-dialog.png" });
      await page.click("#ai-languages-save");
      await page.waitForTimeout(200);
      // Saved: reopening shows the list (unknown code dropped) and the mode.
      await page.click("#btn-copy-ai");
      await page.locator("#menu-ai-languages").click();
      await dialog.waitFor({ state: "visible", timeout: 2_000 });
      assertEquals(await page.inputValue("#ai-source-languages"), "sv, en");
      assertEquals(await page.locator("input[name=ai-context-languages][value=all]").isChecked(), true);
      await page.click("#ai-languages-cancel");
    } finally {
      await browser.close();
    }
  },
});
