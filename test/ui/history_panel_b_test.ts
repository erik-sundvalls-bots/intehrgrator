/**
 * Browser UI test (ADR 0014, B): the history panel shows one chronological
 * history with author badges; Revert takes back one AI turn as a new change
 * and skips a slot you changed later; Undo to here rewinds from the top; the
 * AI author marker stays on blocks the AI wrote until you change them.
 * Stub provider only: no real API key anywhere.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import {
  baseUrl,
  diastolicSuffix,
  findSlotIdEndingWith,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  waitForMappedSlot,
  waitForTestApi,
} from "./helpers.ts";

const ENDPOINT = "https://ai.test.invalid/v1/chat/completions";
const SHOTS = Deno.env.get("HISTORY_PANEL_SHOTS");

async function expressionOf(page: Page, slotId: string): Promise<string> {
  const snap = await getSnapshot(page);
  return snap.model.slots.find((s) => s.slotId === slotId)?.expression ?? "";
}

async function waitForExpression(
  page: Page,
  slotId: string,
  test: (expr: string) => boolean,
  what: string,
) {
  for (let i = 0; i < 100; i++) {
    if (test(await expressionOf(page, slotId))) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${what}: ${await expressionOf(page, slotId)}`);
}

Deno.test({
  name:
    "UI: history panel — author badges, Revert skips later changes, Undo to here, AI author marker",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1600, height: 900 },
      });
      page.on("dialog", (dialog) => void dialog.accept());
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
      const systolic = await findSystolicSlotId(page);
      const diastolic = await findSlotIdEndingWith(page, diastolicSuffix);

      // Stub provider: one turn maps systolic and diastolic.
      await page.route(`${ENDPOINT}*`, async (route) => {
        const cors = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "POST, OPTIONS",
        };
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers: cors });
          return;
        }
        const body = JSON.parse(route.request().postData() ?? "{}");
        const last = body.messages[body.messages.length - 1];
        const message = last.role === "tool" ? { content: "Mapped both." } : {
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "map_slot",
                arguments: JSON.stringify({
                  slotId: systolic,
                  path: "$.systolic",
                }),
              },
            },
            {
              id: "c2",
              type: "function",
              function: {
                name: "map_slot",
                arguments: JSON.stringify({
                  slotId: diastolic,
                  path: "$.diastolic",
                }),
              },
            },
          ],
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
      await page.locator("#dialog-ai-credentials").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await page.fill("#ai-endpoint", ENDPOINT);
      await page.fill("#ai-api-key", "test-key");
      await page.fill("#ai-model", "stub-model");
      await page.click("#ai-credentials-save");
      await page.locator("#ai-chat-send").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map systolic and diastolic");
      await page.click("#ai-chat-send");
      await waitForMappedSlot(page, systolic);
      await waitForExpression(
        page,
        diastolic,
        (e) => e.includes("diastolic"),
        "AI maps diastolic",
      );
      await page.locator(".ai-chat-msg--assistant", { hasText: "Mapped both." })
        .waitFor({ timeout: 10_000 });

      // The AI author marker sits on both blocks the AI wrote.
      await page.waitForFunction(
        () => document.querySelectorAll(".ai-author-badge").length >= 2,
        null,
        { timeout: 5_000 },
      );
      const aiTitle = await page.locator(".ai-author-badge title").first()
        .textContent();
      assertStringIncludes(aiTitle ?? "", "Written by AI chat (stub-model)");
      // You change diastolic: its marker goes, systolic keeps its marker.
      await page.evaluate((id) => {
        (globalThis as unknown as {
          intehrgratorTestApi: {
            mapNodeToSlot(s: string, p: string, f: string): void;
          };
        })
          .intehrgratorTestApi.mapNodeToSlot(id, "$.systolic", "json");
      }, diastolic);
      await waitForExpression(
        page,
        diastolic,
        (e) => e.includes("systolic"),
        "human edit of diastolic",
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".ai-author-badge").length === 1,
        null,
        { timeout: 5_000 },
      );

      // History panel: newest first, with author badges.
      await page.click("#btn-history");
      const panel = page.locator("#history-panel");
      await panel.waitFor({ state: "visible" });
      const rows = panel.locator(".history-row");
      await rows.first().waitFor({ timeout: 5_000 });
      const aiRow = rows.filter({
        has: page.locator(".history-badge--ai-chat"),
      }).first();
      await aiRow.waitFor({ timeout: 5_000 });
      assertStringIncludes(
        await aiRow.locator(".history-badge").innerText(),
        "stub-model",
      );
      assertEquals(
        await rows.first().locator(".history-badge").innerText(),
        "You",
      );
      assertEquals(
        await rows.first().locator(".history-undo-to").isDisabled(),
        true,
        "newest row has nothing to undo after it",
      );
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/history-panel.png` });

      // Revert the AI turn: systolic goes back, diastolic (changed later by you) is skipped.
      const aiSeq = await aiRow.getAttribute("data-seq");
      await aiRow.locator(".history-revert").click();
      await page.locator("#status-main", {
        hasText: `Revert: took back #${aiSeq} by AI chat (stub-model)`,
      })
        .waitFor({ timeout: 10_000 });
      const status = await page.locator("#status-main").innerText();
      assertStringIncludes(status, "Skipped, changed later:");
      await waitForExpression(
        page,
        systolic,
        (e) => !e.includes("systolic"),
        "revert of systolic",
      );
      assertStringIncludes(
        await expressionOf(page, diastolic),
        "systolic",
        "your later change stays",
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".ai-author-badge").length === 0,
        null,
        { timeout: 5_000 },
      );
      await rows.first().locator(".history-badge--human").waitFor({
        timeout: 5_000,
      });
      assertStringIncludes(await rows.first().innerText(), `Revert #${aiSeq}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/history-revert.png` });

      // Undo to here on the AI row: takes back your edit and the revert; the AI turn is in effect again.
      const aiRowAgain = panel.locator(`.history-row[data-seq="${aiSeq}"]`);
      await aiRowAgain.locator(".history-undo-to").click();
      await waitForExpression(
        page,
        systolic,
        (e) => e.includes("systolic"),
        "undo to AI turn (systolic)",
      );
      await waitForExpression(
        page,
        diastolic,
        (e) => e.includes("diastolic"),
        "undo to AI turn (diastolic)",
      );
      await page.locator("#status-main", {
        hasText: "Undo: took back a change by You",
      }).waitFor({ timeout: 10_000 });
      await panel.locator(".history-row--undone").first().waitFor({
        timeout: 5_000,
      });
      assert(
        await panel.locator(".history-row--undone").count() >= 2,
        "your edit and the revert are marked undone",
      );
      assertStringIncludes(await rows.first().innerText(), `Back to #${aiSeq}`);
    } finally {
      await browser.close();
    }
  },
});
