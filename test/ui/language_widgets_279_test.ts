/**
 * Browser UI (#279): 💬 widgets show the language the target labels and the
 * source descriptions are shown in. Target labels follow `target.lang.1`
 * (the source's language) until the user picks another; the AI menu's
 * Languages… dialog sets `source.lang.N` and the AI context languages.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr279-*.png (never in CI).
 * Set TUTORIAL_SCREENSHOTS=1 to rewrite docs/assets/tutorial/target-language-widget.png.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";

const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";
const TUTORIAL = Deno.env.get("TUTORIAL_SCREENSHOTS") === "1";
// A bilingual XSD target (en, sv): its labels are the `xs:documentation` texts.
const XSD = "test/fixtures/multilingual-referral/referral.xsd";
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
      await load(page, "loadTemplate", "referral.xsd", await fixtureText(XSD));
      await targetBtn.waitFor({ state: "visible", timeout: 5_000 });
      assertEquals((await targetBtn.innerText()).trim(), "💬 en");
      assertStringIncludes(await targetTree.innerText(), "How urgent the referral is.");

      // A Swedish source makes sv target.lang.1: the target follows it.
      await load(page, "loadSchema", "olycka.xml", SV_SOURCE);
      assertEquals((await targetBtn.innerText()).trim(), "💬 sv");
      assertStringIncludes(await targetTree.innerText(), "Hur brådskande remissen är.");
      // Hover shows the other languages' labels.
      const priority = targetTree.locator(".tree-label", { hasText: /^Hur brådskande/ }).first();
      assertStringIncludes((await priority.getAttribute("title")) ?? "", "en: How urgent the referral is.");
      assertEquals(await page.locator("#source-lang-widget").isVisible(), false, "one source language: no widget");

      // Keyboard: open, move to English, pick.
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
      await page.keyboard.press("ArrowDown"); // 1. Swedish (focus starts on "Follow")
      await page.keyboard.press("ArrowDown"); // 2. English
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      assertEquals((await targetBtn.innerText()).trim(), "💬 en");
      assertStringIncludes(await targetTree.innerText(), "How urgent the referral is.");
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

// An XSD target documented in English and in a code that is not ISO 639-1.
const ODD_LANG_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Note">
    <xs:annotation>
      <xs:documentation xml:lang="en">A note.</xs:documentation>
      <xs:documentation xml:lang="qq">Qq note.</xs:documentation>
    </xs:annotation>
    <xs:complexType><xs:sequence>
      <xs:element name="Text" type="xs:string">
        <xs:annotation>
          <xs:documentation xml:lang="en">The text.</xs:documentation>
          <xs:documentation xml:lang="qq">Qq text.</xs:documentation>
        </xs:annotation>
      </xs:element>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

Deno.test({
  name: "UI: 💬 on an OPT XML target (SDV en/sv/de); ?hl=sv does not pick the label language; unknown codes are flagged (#279)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1&hl=sv`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      const targetBtn = page.locator("#target-lang-widget .lang-widget-btn");
      const targetTree = page.locator("#target-schema-tree");
      const menu = page.locator("#target-lang-widget-menu");

      // English source: target.lang.1 = en, whatever the UI language.
      await load(page, "loadTemplate", "simple-diagnose-and-vitals.opt", await fixtureText("test/fixtures/simple-diagnose-and-vitals.opt"));
      await load(page, "loadSchema", "vitals.xml", `<?xml version="1.0"?>\n<vitals xml:lang="en"><systolic>120</systolic></vitals>`);
      await targetBtn.waitFor({ state: "visible", timeout: 10_000 });
      assertEquals((await targetBtn.innerText()).trim(), "💬 en");
      assertStringIncludes(await targetTree.innerText(), "Systolic");

      await targetBtn.click();
      await menu.waitFor({ state: "visible", timeout: 2_000 });
      const langs = await menu.locator("[data-lang]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.lang));
      assertEquals(langs, ["en", "sv", "de"]);
      await menu.locator("[data-lang=sv]").click();
      await page.waitForTimeout(400);
      assertEquals((await targetBtn.innerText()).trim(), "💬 sv");
      assertStringIncludes(await targetTree.innerText(), "Systoliskt");

      // A schema language outside ISO 639-1 is listed as-is, with a warning.
      await load(page, "loadTemplate", "note.xsd", ODD_LANG_XSD);
      await targetBtn.waitFor({ state: "visible", timeout: 5_000 });
      await targetBtn.click();
      const odd = menu.locator("[data-lang=qq]");
      await odd.waitFor({ state: "visible", timeout: 2_000 });
      assertEquals(await odd.getAttribute("data-unknown"), "true");
      assertStringIncludes((await odd.getAttribute("title")) ?? "", "qq");
      assertStringIncludes(await odd.innerText(), "⚠");
      assertEquals(await menu.locator("[data-lang=en]").getAttribute("data-unknown"), null);

      if (TUTORIAL) {
        // English chrome, SDV shown in Swedish, popover open over the target pane.
        const shot = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await shot.goto(`${baseUrl}/?testMode=1&hl=en`, { waitUntil: "networkidle" });
        await waitForTestApi(shot);
        await load(shot, "loadTemplate", "simple-diagnose-and-vitals.opt", await fixtureText("test/fixtures/simple-diagnose-and-vitals.opt"));
        await load(shot, "loadSchema", "vitals.xml", `<?xml version="1.0"?>\n<vitals xml:lang="sv"><systolic>120</systolic></vitals>`);
        await shot.locator("#target-lang-widget .lang-widget-btn").click();
        const m = shot.locator("#target-lang-widget-menu");
        await m.waitFor({ state: "visible", timeout: 2_000 });
        const pane = await shot.locator("#target-schema-tree").boundingBox();
        const mbox = await m.boundingBox();
        if (pane && mbox) {
          const x = Math.min(pane.x, mbox.x) - 10;
          const y = mbox.y - 50;
          await shot.screenshot({
            path: "docs/assets/tutorial/target-language-widget.png",
            clip: { x, y, width: pane.x + pane.width - x + 10, height: 340 },
          });
        }
        await shot.close();
      }
    } finally {
      await browser.close();
    }
  },
});
