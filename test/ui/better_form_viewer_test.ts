/**
 * The licensed Better renderer is not in the build. The viewer must not
 * request it until the user uploads the three files into this browser.
 */
import { assert, assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { chromium, type Page, type Request } from "npm:playwright@1.51.0";
import { baseUrl } from "./helpers.ts";

function watchRendererRequests(page: Page, bucket: string[]): void {
  const push = (request: Request) => {
    const url = request.url();
    if (url.includes("vendor/better") || url.includes("form-renderer.js")) bucket.push(url);
  };
  page.on("request", push);
}

Deno.test({
  name: "UI: Better form viewer stores an uploaded renderer in the browser and does not fetch it",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    const requests: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      watchRendererRequests(page, requests);
      await page.goto(`${baseUrl}/better-form-viewer.html`, { waitUntil: "networkidle" });
      await page.waitForSelector("#upload-vendor-btn");
      const before = await page.locator("#banner").innerText();
      assert(before.includes("not in this browser"), before);
      assertEquals(requests, [], `viewer requested the renderer before upload: ${requests.join(", ")}`);

      await page.setInputFiles("#vendor-upload-input", [
        {
          name: "form-renderer.js",
          mimeType: "text/javascript",
          buffer: Buffer.from("globalThis.__betterRendererProbe = 'loaded';"),
        },
        {
          name: "styles.css",
          mimeType: "text/css",
          buffer: Buffer.from("body { outline: 1px solid transparent; }"),
        },
        {
          name: "styles-theme.css",
          mimeType: "text/css",
          buffer: Buffer.from("body { caret-color: auto; }"),
        },
      ]);
      await page.waitForFunction(() =>
        document.getElementById("status")?.textContent === "Stored in this browser." &&
        (globalThis as unknown as { __betterRendererProbe?: string }).__betterRendererProbe === "loaded"
      );
      assertEquals(requests, [], `viewer fetched the renderer from the network: ${requests.join(", ")}`);

      page.once("dialog", (dialog) => void dialog.accept());
      await page.click("#clear-vendor-btn");
      await page.waitForSelector("#banner.warn");
      const afterClear = await page.locator("#banner").innerText();
      assert(afterClear.includes("not in this browser"), afterClear);
      const probe = await page.evaluate(() =>
        (globalThis as unknown as { __betterRendererProbe?: string }).__betterRendererProbe ?? null
      );
      assertEquals(probe, null);
      assertEquals(requests, []);
    } finally {
      await browser.close();
    }
  },
});
