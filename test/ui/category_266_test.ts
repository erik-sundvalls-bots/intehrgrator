/**
 * Browser UI test (#266): an AI chat turn that maps Systolic leaves the
 * default context map's category alone: the model and the canvas keep the
 * coded text with code 433. Stub provider only: no real API key anywhere.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import {
  baseUrl,
  findSlotIdEndingWith,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  waitForTestApi,
} from "./helpers.ts";

const ENDPOINT = "https://ai.test.invalid/v1/chat/completions";
const CATEGORY = "//category/DV_CODED_TEXT/value";
const CODED =
  'map("value", "event", "defining_code", map("terminology_id", "openehr", "code_string", "433"))';

async function categoryOnCanvas(page: Page): Promise<string> {
  const json = await page.evaluate(() =>
    (globalThis as unknown as {
      intehrgratorTestApi: { getBlocklyStateJson(): string };
    }).intehrgratorTestApi
      .getBlocklyStateJson()
  );
  return json;
}

Deno.test({
  name:
    "UI: #266 AI chat turn keeps the default context map's category (code 433)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        localStorage.removeItem("intehrgrator.ai.credentials");
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.chat")) {
            localStorage.removeItem(key);
          }
        }
      });
      await loadBpFixtures(page);
      const category = await findSlotIdEndingWith(page, CATEGORY);
      const expr = async () =>
        (await getSnapshot(page)).model.slots.find((s) => s.slotId === category)
          ?.expression;
      assertEquals(await expr(), CODED);
      const canvasBefore = await categoryOnCanvas(page);
      assertStringIncludes(canvasBefore, "433");

      const sys = await findSystolicSlotId(page);
      await page.route(`${ENDPOINT}*`, async (route) => {
        const cors = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST, OPTIONS",
        };
        if (route.request().method() === "OPTIONS") {
          return await route.fulfill({ status: 204, headers: cors });
        }
        const body = JSON.parse(route.request().postData() ?? "{}");
        const last = body.messages[body.messages.length - 1];
        const message = last.role === "tool" ? { content: "Done." } : {
          tool_calls: [{
            id: "c1",
            type: "function",
            function: {
              name: "map_slot",
              arguments: JSON.stringify({ slotId: sys, path: "$.systolic" }),
            },
          }],
        };
        await route.fulfill({
          status: 200,
          headers: { ...cors, "content-type": "application/json" },
          body: JSON.stringify({ choices: [{ message }] }),
        });
      });
      if (
        await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !==
          "true"
      ) {
        await page.click("#ai-chat-toggle");
      }
      await page.click("#ai-chat-configure");
      await page.fill("#ai-endpoint", ENDPOINT);
      await page.fill("#ai-api-key", "test-key");
      await page.fill("#ai-model", "stub-model");
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map systolic");
      await page.click("#ai-chat-send");
      await page.locator(".ai-chat-msg--assistant", { hasText: "Done." })
        .waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);

      assertStringIncludes(
        (await getSnapshot(page)).model.slots.find((s) => s.slotId === sys)
          ?.expression ?? "",
        "systolic",
      );
      assertEquals(await expr(), CODED, "the model keeps the coded category");
      assertStringIncludes(
        await categoryOnCanvas(page),
        "433",
        "the canvas keeps code 433",
      );
    } finally {
      await browser.close();
    }
  },
});
