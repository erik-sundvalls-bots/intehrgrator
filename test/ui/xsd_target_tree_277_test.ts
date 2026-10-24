/**
 * Browser UI (#277): an XSD target is read with the shared XSD reader, so the
 * elements of a named complex type (`Diagnosis: DiagnosisType`) and its
 * attributes appear in the target tree.
 *
 * Set PR_SCREENSHOTS=1 to write /workspace/pr277-xsd-target.png (never in CI).
 */
import { assert, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, fixtureText, waitForTestApi } from "./helpers.ts";

const SHOTS = Deno.env.get("PR_SCREENSHOTS") === "1";

Deno.test({
  name: "UI: XSD target tree shows named complex type children and attributes (#277)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      const xsd = await fixtureText("test/fixtures/multilingual-referral/referral.xsd");
      await page.evaluate((content) => {
        (globalThis as unknown as { intehrgratorTestApi: { loadTemplate: (n: string, c: string) => void } })
          .intehrgratorTestApi.loadTemplate("referral.xsd", content);
      }, xsd);
      await page.waitForTimeout(400);
      const tree = page.locator("#target-schema-tree");
      await tree.waitFor({ state: "visible", timeout: 5_000 });
      const text = await tree.innerText();
      // Labels are the English documentation of Diagnosis/Code and Diagnosis/@primary.
      assertStringIncludes(text, "ICD-10-SE code.");
      assertStringIncludes(text, "True for the main diagnosis.");
      assert(text.includes("Diagnosis that motivates the referral."), text.slice(0, 400));
      if (SHOTS) await tree.screenshot({ path: "/workspace/pr277-xsd-target.png" });
    } finally {
      await browser.close();
    }
  },
});
