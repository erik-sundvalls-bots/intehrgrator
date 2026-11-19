/**
 * #86: the source-tree plus is a small encircled control with an accessible
 * name, and it reveals optional RM rows in place.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, waitForTestApi } from "./helpers.ts";

const WEB_TEMPLATE = JSON.stringify({
  templateId: "demo",
  tree: {
    id: "composition",
    rmType: "COMPOSITION",
    min: 1,
    max: 1,
    aqlPath: "",
    children: [
      {
        id: "context",
        rmType: "EVENT_CONTEXT",
        min: 1,
        max: 1,
        aqlPath: "/context",
        children: [
          {
            id: "start_time",
            rmType: "DV_DATE_TIME",
            min: 1,
            max: 1,
            aqlPath: "/context/start_time",
            inputs: [{ type: "DATETIME" }],
          },
        ],
      },
    ],
  },
});

Deno.test({
  name:
    "UI: openEHR source tree shows silent-mandatory RM and a textless optional plus",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate((content) => {
        (globalThis as unknown as {
          intehrgratorTestApi: {
            loadSchema: (name: string, body: string) => void;
          };
        }).intehrgratorTestApi.loadSchema("demo.wt.json", content);
      }, WEB_TEMPLATE);

      const nameRow = page.locator(
        '#schema-tree .tree-row[data-path="$.name"]',
      );
      await nameRow.waitFor({ timeout: 10_000 });
      assertEquals(
        await nameRow.evaluate((row) =>
          row.classList.contains("tree-row-rm-mandatory")
        ),
        true,
      );
      await page.locator(
        '#schema-tree .tree-row[data-path="$.context.end_time"]',
      ).waitFor({
        state: "detached",
        timeout: 2_000,
      }).catch(() => {});
      assertEquals(
        await page.locator(
          '#schema-tree .tree-row[data-path="$.context.end_time"]',
        ).count(),
        0,
      );

      const toggle = page.locator(
        '#schema-tree .tree-row[data-path="$.context"] .tree-rm-toggle',
      );
      await toggle.waitFor();
      assertEquals((await toggle.innerText()).trim(), "+");
      assertEquals(await toggle.getAttribute("aria-expanded"), "false");
      const label = await toggle.getAttribute("aria-label");
      assert(label?.includes("context"), label ?? "");
      assertEquals(await toggle.getAttribute("title"), label);
      const box = await toggle.boundingBox();
      assert(
        box !== null && box.width <= 16 && box.height <= 16,
        JSON.stringify(box),
      );

      await toggle.click();
      const endTime = page.locator(
        '#schema-tree .tree-row[data-path="$.context.end_time"]',
      );
      await endTime.waitFor();
      assertEquals(
        await endTime.evaluate((row) =>
          row.classList.contains("tree-row-rm-optional")
        ),
        true,
      );
      assertEquals((await toggle.innerText()).trim(), "−");
      assertEquals(await toggle.getAttribute("aria-expanded"), "true");

      await toggle.click();
      await page.locator(
        '#schema-tree .tree-row[data-path="$.context.end_time"]',
      ).waitFor({
        state: "detached",
      });
    } finally {
      await browser.close();
    }
  },
});
