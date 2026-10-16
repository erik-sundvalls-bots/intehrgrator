import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  BETTER_RENDERER_CACHE,
  BETTER_RENDERER_FILES,
  betterRendererUrl,
  clearRendererAssets,
  isBetterRendererPath,
  memoryRendererAssetStore,
  missingRendererFiles,
  rendererAssetsReady,
  rendererFileHref,
  storeRendererFiles,
} from "@intehrgrator/host/better_renderer_store.ts";

const pageUrl = "https://app.example/intehrgrator/better-form-viewer.html";

function upload(name: string, text: string) {
  return { name, bytes: new TextEncoder().encode(text) };
}

Deno.test("Better renderer URLs stay under vendor/better and ignore other vendor assets", () => {
  assertEquals(
    betterRendererUrl(pageUrl, "form-renderer.js"),
    "https://app.example/intehrgrator/vendor/better/form-renderer.js",
  );
  assert(isBetterRendererPath("/intehrgrator/vendor/better/styles.css"));
  assert(!isBetterRendererPath("/vendor/shoelace/themes/light.css"));
  assert(!isBetterRendererPath("/vendor/jspreadsheet/jsuites.css"));
  assert(!isBetterRendererPath("/vendor/betterish/form-renderer.js"));
});

Deno.test("the three licensed files are ready only after the user stores all of them", async () => {
  const store = memoryRendererAssetStore();
  assertEquals(await rendererAssetsReady(store, pageUrl), false);
  assertEquals(await missingRendererFiles(store, pageUrl), [...BETTER_RENDERER_FILES]);

  const partial = await storeRendererFiles(store, pageUrl, [
    upload("form-renderer.js", "globalThis.__better = 1;"),
    upload("styles.css", "body{}"),
  ]);
  assertEquals(partial.stored, ["form-renderer.js", "styles.css"]);
  assertEquals(partial.missing, ["styles-theme.css"]);
  assertEquals(await rendererAssetsReady(store, pageUrl), false);

  const done = await storeRendererFiles(store, pageUrl, [
    upload("C:\\licensed\\styles-theme.css", "form-renderer{}"),
  ]);
  assertEquals(done.stored, ["styles-theme.css"]);
  assertEquals(done.rejected, []);
  assertEquals(done.missing, []);
  assertEquals(await rendererAssetsReady(store, pageUrl), true);

  const href = await rendererFileHref(store, pageUrl, "form-renderer.js", {
    sameOrigin: false,
    createObjectUrl: () => "blob:renderer",
  });
  assertEquals(href, "blob:renderer");
  assertEquals(
    await rendererFileHref(store, pageUrl, "styles.css", { sameOrigin: true }),
    "https://app.example/intehrgrator/vendor/better/styles.css",
  );

  await clearRendererAssets(store);
  assertEquals(await missingRendererFiles(store, pageUrl), [...BETTER_RENDERER_FILES]);
  assertEquals(
    await rendererFileHref(store, pageUrl, "form-renderer.js", { sameOrigin: true }),
    null,
  );
});

Deno.test("uploads that are not a js or css basename are rejected and not stored", async () => {
  const store = memoryRendererAssetStore();
  const result = await storeRendererFiles(store, pageUrl, [
    upload("../secret.txt", "nope"),
    upload("notes.md", "nope"),
    upload("Form-Renderer.JS", "ok"),
  ]);
  assertEquals(result.rejected, ["../secret.txt", "notes.md"]);
  assertEquals(result.stored, ["form-renderer.js"]);
  const hit = await (await store.open()).match(betterRendererUrl(pageUrl, "form-renderer.js"));
  assertEquals(await hit?.text(), "ok");
});

Deno.test("the build and service worker do not ship or fetch the licensed renderer", async () => {
  const root = join(dirname(fromFileUrl(import.meta.url)), "..");
  const build = await Deno.readTextFile(join(root, "scripts/build.ts"));
  const tasks = await Deno.readTextFile(join(root, "deno.json"));
  const sw = await Deno.readTextFile(join(root, "web/sw.js"));
  assert(!build.includes("better-form-renderer"));
  assert(!build.includes("__BETTER_RENDERER_AVAILABLE__"));
  assert(!tasks.includes("setup:better-forms"));
  assertStringIncludes(sw, BETTER_RENDERER_CACHE);
  assertStringIncludes(sw, "key !== BETTER_RENDERER_CACHE");
  const handler = sw.slice(
    sw.indexOf("async function betterRendererResponse"),
    sw.indexOf("async function networkFirst"),
  );
  assert(handler.includes("caches.open"));
  assert(!handler.includes("fetch("));
  assert(handler.includes("status: 404"));
});
