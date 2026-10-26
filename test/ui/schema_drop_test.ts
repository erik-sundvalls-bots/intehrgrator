/**
 * Browser UI test: dropping a Source Schema file onto #schema-tree.
 * Invalid JSON must show an in-pane error (not a silent no-op).
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  dropTextFile,
  fixtureText,
  getSnapshot,
  waitForTestApi,
} from "./helpers.ts";

Deno.test({
  name: "UI: drop truncated schema JSON onto #schema-tree shows an error",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const truncated = await fixtureText("test/fixtures/ui/bp_sche_truncated.json");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      await dropTextFile(page, "#schema-tree", "bp-sche.json", truncated);
      await page.waitForSelector("#schema-tree .tree-pane-error", { timeout: 5_000 });

      const snap = await getSnapshot(page);
      assert(snap.schemaError, snap.statusMessage);
      assert(snap.schemaError.includes("bp-sche.json"), snap.schemaError);
      const pane = await page.locator("#schema-tree").innerText();
      assert(pane.includes("Could not load"), pane);
      assertEquals(pane.includes("Load a schema file."), false);
      assert(
        errors.some((line) => line.includes("bp-sche.json")),
        `expected console.error for schema load, got: ${errors.join(" | ")}`,
      );
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: drop JSON Schema onto #schema-tree renders field tree",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const schema = await fixtureText("test/fixtures/dummy-json-vitals/source.schema.json");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      await dropTextFile(page, "#schema-tree", "bp-sche.json", schema);
      await page.waitForSelector('#schema-tree .tree-row[data-path="$.systolic"]', {
        timeout: 5_000,
      });

      const snap = await getSnapshot(page);
      assertEquals(snap.schemaError, null);
      const pane = await page.locator("#schema-tree").innerText();
      assert(pane.includes("systolic"), pane);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: JSON Schema $defs $ref fields appear in #schema-tree",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const schema = await fixtureText(
      "test/fixtures/administrerad-medicinsk-onkologisk-behandling/source-schema/AdministrationRCCV1_source_schema.json",
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      await dropTextFile(page, "#schema-tree", "AdministrationRCCV1_source_schema.json", schema);
      await page.waitForSelector('#schema-tree .tree-row[data-path="$.Substanser[*].Dose"]', {
        timeout: 5_000,
      });
      await page.waitForSelector(
        '#schema-tree .tree-row[data-path="$.Substanser[*].Innholdstoff_ATC"]',
        { timeout: 5_000 },
      );

      const snap = await getSnapshot(page);
      assertEquals(snap.schemaError, null);
      const defRows = await page.locator('#schema-tree .tree-row[data-path*="$defs"]').count();
      assertEquals(defRows, 0);
      const pane = await page.locator("#schema-tree").innerText();
      assert(pane.includes("Dose"), pane);
      assert(pane.includes("Innholdstoff_ATC"), pane);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: drop an XSD onto #schema-tree renders element paths, not xs:* markup (#278)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const xsd = await fixtureText("test/fixtures/multilingual-referral/referral.xsd");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);

      await dropTextFile(page, "#schema-tree", "referral.xsd", xsd);
      await page.waitForSelector('#schema-tree .tree-row[data-path="/Referral/PatientId"]', {
        timeout: 5_000,
      });
      const snap = await getSnapshot(page);
      assertEquals(snap.schemaError, null);
      const paths = await page.locator("#schema-tree .tree-row[data-path]").evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.path ?? "")
      );
      assert(paths.includes("/Referral/Diagnosis/@primary"), paths.join(", "));
      assertEquals(paths.some((p) => p.includes("xs:")), false, paths.join(", "));
    } finally {
      await browser.close();
    }
  },
});
