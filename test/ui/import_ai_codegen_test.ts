/**
 * Browser UI: Copy AI Prompt → Import Suggestions maps systolic and refreshes
 * Generated conversion script(s). Prefer this over guessing canvas clicks.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import {
  baseUrl,
  getSnapshot,
  loadBpFixtures,
  runTestAndWait,
  waitForMappedSlot,
  waitForTestApi,
} from "./helpers.ts";

const systolicSuffix = "items/at0004/value/value/value";

Deno.test({
  name: "UI: Copy AI Prompt + Import Suggestions maps systolic and updates generated TypeScript",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      await page.selectOption("#export-target", "typescript");

      const before = await getSnapshot(page);
      assertEquals(
        before.generatedCode.includes("$.systolic"),
        false,
        "unmapped canvas should not already query $.systolic",
      );
      assertStringIncludes(before.generatedCode, "new COMPOSITION({");

      await page.evaluate(() => {
        const w = globalThis as unknown as { __clip?: string };
        w.__clip = "";
        navigator.clipboard.writeText = async (text: string) => {
          w.__clip = text;
        };
        navigator.clipboard.readText = async () => w.__clip ?? "";
      });

      await page.click("#btn-copy-ai");
      await page.locator("#menu-copy-ai").waitFor({ state: "visible", timeout: 5_000 });
      await page.click('[data-ai-delivery="inline"]');
      await page.waitForFunction(() => {
        return Boolean((globalThis as unknown as { __clip?: string }).__clip);
      }, { timeout: 10_000 });
      const prompt = await page.evaluate(() =>
        (globalThis as unknown as { __clip?: string }).__clip ?? ""
      );
      assertStringIncludes(prompt, "## Slot tree");
      assertStringIncludes(prompt, "intehrgrator-suggestions");
      assertStringIncludes(prompt, "## References");
      assertStringIncludes(prompt, "openehr-assistant MCP");
      assertStringIncludes(prompt, "cadasto/openehr-assistant-plugin");
      assertStringIncludes(prompt, "icd10_snomed");

      const { slotId, targetId, envelope } = suggestionsFromPrompt(prompt);
      assert(slotId.endsWith(systolicSuffix), slotId);
      assert(targetId.length > 0);

      await page.evaluate((text) => {
        (globalThis as unknown as { __clip?: string }).__clip = text;
      }, envelope);

      await page.click("#btn-copy-ai");
      await page.locator("#menu-copy-ai").waitFor({ state: "visible", timeout: 5_000 });
      await page.click("#btn-import-ai");
      await page.waitForSelector("#dialog-import-ai[open]", { timeout: 5_000 });
      const prefilled = await page.inputValue("#import-ai-text");
      if (!prefilled.trim()) await page.fill("#import-ai-text", envelope);
      await page.click("#import-ai-confirm");
      await page.waitForFunction(() => {
        const report = document.querySelector("#import-ai-report");
        return Boolean(report && !report.hasAttribute("hidden") && /Imported: 1 mapping applied/.test(report.textContent ?? ""));
      }, { timeout: 5_000 });
      await page.click("#import-ai-cancel");
      await page.waitForSelector("#dialog-import-ai[open]", { state: "detached", timeout: 5_000 }).catch(async () => {
        await page.waitForFunction(() => !document.querySelector("#dialog-import-ai")?.hasAttribute("open"), {
          timeout: 5_000,
        });
      });

      // The prompt's slot tree id is compact (#277); the model keeps the full skeleton id.
      const fullSlotId = await page.waitForFunction((compact) => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getSnapshot: () => { model: { slots: Array<{ slotId: string }> } } };
        }).intehrgratorTestApi;
        return api.getSnapshot().model.slots.find((s) => s.slotId.endsWith(compact))?.slotId ?? false;
      }, slotId, { timeout: 10_000 }).then((h) => h.jsonValue() as Promise<string>);
      await waitForMappedSlot(page, fullSlotId);
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getSnapshot: () => { generatedCode: string } };
        }).intehrgratorTestApi;
        return api.getSnapshot().generatedCode.includes("$.systolic");
      }, { timeout: 10_000 });

      const after = await getSnapshot(page);
      const mapped = after.model.slots.find((s) => s.slotId === fullSlotId);
      assert(mapped?.expression.includes("xpathNumber"), mapped?.expression);
      assertStringIncludes(after.generatedCode, "xpathNumber");
      assertStringIncludes(after.generatedCode, "$.systolic");
      assertStringIncludes(after.generatedCode, "DV_QUANTITY");
      assertStringIncludes(after.generatedCode, "new COMPOSITION({");
      assertEquals(after.generatedCode.includes("void evalExpr"), false);
      assert(
        after.blocklyBlocks.some((b) => b.type === "source_query_number"),
        `expected source_query_number on canvas, got: ${after.blocklyBlocks.map((b) => b.type).join(", ")}`,
      );
      // CodeMirror virtualizes the preview; the document the pane is bound to is generatedCode.

      // Mapping preview Test Run. TypeScript output mode executes the generated
      // script and currently rejects empty Defaults CODE_PHRASE (`ISO_639-1::`).
      await page.selectOption("#export-target", "preview");
      await runTestAndWait(page);

      const snap = await getSnapshot(page);
      const output = snap.testResult?.output as Record<string, unknown> | undefined;
      assertEquals(
        snap.testResult?.ok,
        true,
        snap.testResult?.error ?? (snap.testResult?.warnings ?? []).join("; "),
      );
      assert(output && !("slots" in output), `openEHR Test Run must not include a slots sidecar: ${JSON.stringify(output)}`);
      assertStringIncludes(JSON.stringify(output), "120");
      assertEquals(
        typeof (output as { convertSourceToComposition?: unknown }).convertSourceToComposition,
        "undefined",
        "Test Run JSON is a composition instance, not the generated script",
      );
    } finally {
      await browser.close();
    }
  },
});

function suggestionsFromPrompt(prompt: string): {
  slotId: string;
  targetId: string;
  envelope: string;
} {
  const targetMatch = prompt.match(/- targetId: `([^`]+)`/);
  const targetId = targetMatch?.[1] ?? "";
  const fence = prompt.match(/\n## Slot tree\n```json\s*([\s\S]*?)```/);
  if (!fence) throw new Error("Copy AI Prompt did not include a slot tree");
  // #277: slot id = group path + row id.
  const groups = JSON.parse(fence[1]) as Array<{ group: string; slots: Array<{ id: string; label?: string }> }>;
  const manifest = groups.flatMap((g) => g.slots.map((row) => ({ slotId: `${g.group}${row.id}`, label: row.label })));
  const slot = manifest.find((item) => item.slotId.endsWith(systolicSuffix) || /systolic/i.test(item.label ?? ""));
  if (!slot) {
    throw new Error(
      `no systolic slot in AI prompt slot tree (${manifest.length} slots)`,
    );
  }
  const envelope = [
    "```intehrgrator-suggestions",
    JSON.stringify({
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "openehr-template", targetId },
      suggestions: [{
        slotId: slot.slotId,
        block: {
          type: "source_query_number",
          fields: { EXPRESSION: "$.systolic" },
        },
      }],
    }, null, 2),
    "```",
  ].join("\n");
  return { slotId: slot.slotId, targetId, envelope };
}
