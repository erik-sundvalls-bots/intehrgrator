/**
 * Browser UI test (#249 review): AI credentials dialog — provider switch drops
 * stale models, Connect & fetch models fills the model dropdown, inline errors,
 * per-provider memory with ✓, and Forget key for this provider.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { baseUrl, waitForTestApi } from "./helpers.ts";

const OPENAI_KEY = "sk-ui-openai-key-0123456789";
const GEMINI_KEY = "gm-ui-gemini-key-0123456789";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

async function openCredentials(page: Page): Promise<void> {
  await page.click("#btn-copy-ai");
  await page.click('[data-ai-action="credentials"]');
  await page.locator("#dialog-ai-credentials").waitFor({
    state: "visible",
    timeout: 5_000,
  });
}

async function storageDump(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const dump = (s: Storage) =>
      Array.from(
        { length: s.length },
        (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`,
      );
    return [...dump(localStorage), ...dump(sessionStorage)].join("\n");
  });
}

Deno.test({
  name:
    "UI: AI credentials — stale model, fetch models, errors, per-provider memory, forget key",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1300, height: 950 },
      });
      page.on("dialog", (dialog) => void dialog.accept());
      await page.route("https://api.openai.com/v1/models", async (route) => {
        if (route.request().method() === "OPTIONS") {
          return await route.fulfill({ status: 204, headers: cors });
        }
        const auth = route.request().headers()["authorization"];
        await route.fulfill({
          status: auth === `Bearer ${OPENAI_KEY}` ? 200 : 401,
          headers: { ...cors, "content-type": "application/json" },
          body: JSON.stringify({
            data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }, { id: "o5" }],
          }),
        });
      });
      await page.route(
        "https://generativelanguage.googleapis.com/v1beta/openai/models",
        async (route) => {
          if (route.request().method() === "OPTIONS") {
            return await route.fulfill({ status: 204, headers: cors });
          }
          await route.fulfill({
            status: 401,
            headers: { ...cors, "content-type": "application/json" },
            body: JSON.stringify({
              error: { message: `API key not valid: ${GEMINI_KEY}` },
            }),
          });
        },
      );
      await page.route(
        "https://opencode.ai/zen/v1/models",
        (route) => route.abort("failed"),
      );
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("intehrgrator.ai.")) localStorage.removeItem(key);
        }
        localStorage.setItem(
          "intehrgrator.ai.chat.p-test",
          JSON.stringify({
            version: 1,
            messages: [{ role: "user", content: "keep me" }],
            display: [],
            contextSent: true,
            attachedChipKeys: [],
          }),
        );
      });
      const history = await page.evaluate(() =>
        localStorage.getItem("intehrgrator.ai.chat.p-test")
      );

      await openCredentials(page);
      const picker = page.locator("#ai-model-picker");
      const fetchBtn = page.locator("#ai-fetch-models");
      const status = page.locator("#ai-models-status");
      // No provider yet: dropdown disabled with its placeholder, fetch disabled.
      assertEquals(await page.locator("#ai-provider").inputValue(), "");
      assertEquals(await picker.isDisabled(), true);
      assertEquals(
        (await picker.locator("option").first().textContent())?.trim(),
        "Select model",
      );
      assertEquals(await fetchBtn.isDisabled(), true);

      // Stale model: Zen's big-pickle does not survive a switch to OpenAI.
      await page.selectOption("#ai-provider", "opencode-zen");
      assertEquals(await page.locator("#ai-model").inputValue(), "big-pickle");
      await page.fill("#ai-api-key", "zen-key-0123456789");
      await page.selectOption("#ai-provider", "openai");
      assertEquals(await page.locator("#ai-model").inputValue(), "gpt-4.1");
      assertEquals(
        await page.locator("#ai-api-key").inputValue(),
        "",
        "keys never carry over to another vendor",
      );
      assertEquals(
        await picker.isDisabled(),
        true,
        "disabled until models are fetched",
      );

      // Connect & fetch models → dropdown with the list; picking fills the field.
      await page.fill("#ai-api-key", OPENAI_KEY);
      await fetchBtn.click();
      await status.locator("text=3 models").waitFor({ timeout: 5_000 });
      assertStringIncludes(
        await status.getAttribute("class") ?? "",
        "ai-models-status--ok",
      );
      assertEquals(await picker.isDisabled(), false);
      const options = await picker.locator("option").evaluateAll((els) =>
        els.map((el) => (el as HTMLOptionElement).value)
      );
      assertEquals(options, ["", "gpt-4.1", "gpt-4.1-mini", "o5", "__other__"]);
      await picker.selectOption("o5");
      assertEquals(await page.locator("#ai-model").inputValue(), "o5");
      assertStringIncludes(
        await page.locator("#ai-provider option[value=openai]").innerText(),
        "✓",
      );
      // Free text still allowed.
      await picker.selectOption("__other__");
      await page.fill("#ai-model", "gpt-4.1-mini");
      assertEquals(await picker.inputValue(), "gpt-4.1-mini");
      await page.click("#ai-credentials-save");
      await page.locator("#dialog-ai-credentials").waitFor({ state: "hidden" });

      // Reopen: OpenAI restored with ✓; Gemini auth error is inline and redacted.
      await openCredentials(page);
      assertEquals(await page.locator("#ai-provider").inputValue(), "openai");
      assertEquals(
        await picker.isDisabled(),
        false,
        "saved model list comes back",
      );
      await page.selectOption("#ai-provider", "gemini");
      assertEquals(
        await page.locator("#ai-model").inputValue(),
        "gemini-3.8-flash",
      );
      await page.fill("#ai-api-key", GEMINI_KEY);
      await fetchBtn.click();
      await status.locator("text=HTTP 401").waitFor({ timeout: 5_000 });
      const authText = await status.innerText();
      assertStringIncludes(authText, "API key");
      assertEquals(authText.includes(GEMINI_KEY), false, authText);
      assertStringIncludes(
        await status.getAttribute("class") ?? "",
        "ai-models-status--error",
      );
      // Network failure → CORS / desktop hint.
      await page.selectOption("#ai-provider", "opencode-zen");
      await fetchBtn.click();
      await status.locator("text=CORS").waitFor({ timeout: 5_000 });
      // Back to OpenAI: its saved values return.
      await page.selectOption("#ai-provider", "openai");
      assertEquals(await page.locator("#ai-api-key").inputValue(), OPENAI_KEY);
      assertEquals(
        await page.locator("#ai-model").inputValue(),
        "gpt-4.1-mini",
      );

      // Forget key for this provider: field cleared, no storage holds it, history kept.
      assertEquals(
        (await page.locator("#ai-credentials-clear").innerText()).trim(),
        "Forget key for this provider",
      );
      await page.click("#ai-credentials-clear");
      assertEquals(await page.locator("#ai-api-key").inputValue(), "");
      assertEquals(
        await page.locator("#ai-model").inputValue(),
        "gpt-4.1-mini",
        "model kept",
      );
      const dump = await storageDump(page);
      assertEquals(dump.includes(OPENAI_KEY), false, dump);
      assertEquals(
        await page.evaluate(() =>
          localStorage.getItem("intehrgrator.ai.credentials")
        ),
        null,
      );
      assertEquals(
        await page.evaluate(() =>
          localStorage.getItem("intehrgrator.ai.chat.p-test")
        ),
        history,
      );
      assert(
        !dump.includes(GEMINI_KEY),
        "unsaved Gemini key was never persisted",
      );
      await page.click("#ai-credentials-cancel");
    } finally {
      await browser.close();
    }
  },
});
