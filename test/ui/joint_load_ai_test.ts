/**
 * Chrome for joint load + Copy prompt / AI chat (#158 / #140 remainder).
 * File pickers stay on the Test API; this file clicks the dialogs and menus.
 */

import { assert, assertEquals } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import { baseUrl, getSnapshot, loadBpFixtures, waitForTestApi } from "./helpers.ts";

Deno.test({
  name: "UI: AI menu offers copy/paste and AI credentials (no Start AI chat)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      assertEquals((await page.locator("#btn-copy-ai").innerText()).trim(), "AI");
      await page.click("#btn-open-template");
      await page.locator("#dialog-joint-load").waitFor({ state: "visible", timeout: 5_000 });
      assertEquals(await page.locator("#joint-load-confirm").isDisabled(), true);
      await page.click("#joint-load-cancel");
      await page.click("#btn-copy-ai");
      await page.locator("#menu-copy-ai").waitFor({ state: "visible", timeout: 5_000 });
      const order = await page.locator(
        "#menu-copy-ai [data-ai-section], #menu-copy-ai [data-ai-action], #menu-copy-ai [data-ai-delivery], #btn-import-ai",
      ).evaluateAll((els) =>
        els.map((el) =>
          el.getAttribute("data-ai-section") ??
            el.getAttribute("data-ai-action") ??
            el.getAttribute("data-ai-delivery") ??
            el.id
        )
      );
      assertEquals(order, [
        "copy",
        "inline",
        "attach",
        "uri",
        "btn-import-ai",
        "own",
        "credentials",
        "desktop",
        "local-mcp",
      ]);
      assertEquals(
        (await page.locator('[data-ai-section="copy"]').textContent())?.trim(),
        "copy/paste for external AI chat",
      );
      await page.locator('[data-ai-delivery="inline"] .material-symbols-outlined').waitFor({
        state: "visible",
      });
      assertEquals(
        await page.locator('[data-ai-delivery="inline"] .material-symbols-outlined').textContent(),
        "content_copy",
      );
      assertEquals(
        await page.locator("#btn-import-ai .material-symbols-outlined").textContent(),
        "content_paste",
      );
      assertEquals(
        (await page.locator('[data-ai-section="own"]').textContent())?.trim(),
        "Your own AI",
      );
      assertEquals(await page.locator("#ai-menu-desktop").isHidden(), true);
      assertEquals(await page.locator('[data-ai-action="chat"]').count(), 0);
      await page.locator('[data-ai-action="credentials"]').waitFor({ state: "visible" });
      await page.click('[data-ai-action="credentials"]');
      await page.locator("#dialog-ai-credentials").waitFor({ state: "visible", timeout: 5_000 });
      await page.selectOption("#ai-provider", "gemini");
      assertEquals(
        await page.locator("#ai-endpoint").inputValue(),
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
      assertEquals(
        await page.locator("#ai-key-docs").getAttribute("href"),
        "https://aistudio.google.com/app/apikey",
      );
      // #252: no "How AI chat maps" choice; Send always uses the mapping tools.
      assertEquals(await page.locator("#ai-mapping-mode-tools, #ai-mapping-mode-suggestions").count(), 0);
      assert(
        (await page.locator("#ai-credentials-guide").getAttribute("href"))?.includes("AI_CREDENTIALS.md"),
      );
      await page.selectOption("#ai-provider", "openai");
      assertEquals(await page.locator("#ai-endpoint").inputValue(), "https://api.openai.com/v1/chat/completions");
      assertEquals((await page.locator("#ai-key-docs").innerText()).trim(), "Get an OpenAI key");
      await page.selectOption("#ai-provider", "huggingface");
      assertEquals(
        await page.locator("#ai-key-docs").getAttribute("href"),
        "https://huggingface.co/settings/tokens",
      );
      await page.selectOption("#ai-provider", "ollama-local");
      assertEquals(await page.locator("#ai-api-key").inputValue(), "ollama");
      await page.selectOption("#ai-provider", "opencode-cloud");
      assert(
        (await page.locator("#ai-provider-help").innerText()).includes("opencode serve"),
      );
      await page.click("#ai-credentials-cancel");
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: target chevron lists non-destructive refresh",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.click("#btn-open-template-menu");
      await page.locator("#menu-open-template").waitFor({ state: "visible", timeout: 5_000 });
      const text = await page.locator("#menu-open-template").innerText();
      assert(text.includes("Refresh from file"), text);
      assert(text.includes("Refresh from URL"), text);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: schema chevron lists non-destructive refresh",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.click("#btn-load-schema-menu");
      await page.locator("#menu-load-schema").waitFor({ state: "visible", timeout: 5_000 });
      const text = await page.locator("#menu-load-schema").innerText();
      assert(text.includes("Refresh from file"), text);
      assert(text.includes("Refresh from URL"), text);
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: "UI: joint load New on a loaded target keeps the Product stack and empties the map",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await loadBpFixtures(page);
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi?: { getSnapshot: () => { blocklyBlocks: Array<{ type: string }> } };
        }).intehrgratorTestApi;
        return api?.getSnapshot().blocklyBlocks.some((block) => block.type === "composition") === true;
      }, undefined, { timeout: 20_000 });
      await page.click("#btn-open-template");
      await page.locator("#dialog-joint-load").waitFor({ state: "visible", timeout: 5_000 });
      await page.click("#joint-target-current");
      await page.locator('input[name="joint-map"][value="new"]').click();
      assertEquals((await page.locator("#joint-load-confirm").innerText()).trim(), "Load into Target schema");
      assertEquals(await page.locator("#joint-load-confirm").isDisabled(), false);
      await page.click("#joint-load-confirm");
      await page.locator("#dialog-joint-load").waitFor({ state: "hidden", timeout: 5_000 });
      const after = await getSnapshot(page);
      assert(
        after.blocklyBlocks.some((block) => block.type === "composition"),
        "New map must not rebuild away the Product stack",
      );
      const map = after.blocklyBlocks.find((block) => block.type === "default_context_map");
      assert(map, "default context map stays on the canvas");
      assertEquals(map?.fields.KEY0 ?? "", "");
    } finally {
      await browser.close();
    }
  },
});
