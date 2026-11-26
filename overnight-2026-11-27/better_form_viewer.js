// src/host/better_renderer_store.ts
var BETTER_RENDERER_CACHE = "intehrgrator-better-renderer";
var BETTER_RENDERER_FILES = [
  "form-renderer.js",
  "styles.css",
  "styles-theme.css"
];
var SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+\.(?:js|css)$/i;
function betterRendererUrl(pageUrl2, filename) {
  return new URL(`vendor/better/${filename}`, pageUrl2).href;
}
function rendererBasename(name) {
  const base = name.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
  if (!SAFE_ASSET_NAME.test(base)) return null;
  const canonical = BETTER_RENDERER_FILES.find((file) => file.toLowerCase() === base.toLowerCase());
  return canonical ?? base;
}
function rendererContentType(filename) {
  return filename.toLowerCase().endsWith(".css") ? "text/css" : "text/javascript";
}
function browserRendererAssetStore() {
  return {
    async open() {
      const cache = await caches.open(BETTER_RENDERER_CACHE);
      return {
        async match(url) {
          const hit = await cache.match(url);
          return hit ?? void 0;
        },
        put(url, response) {
          return cache.put(url, response);
        },
        async keys() {
          const requests = await cache.keys();
          return requests.map((request) => request.url);
        }
      };
    },
    deleteStore() {
      return caches.delete(BETTER_RENDERER_CACHE);
    }
  };
}
async function missingRendererFiles(store2, pageUrl2) {
  const cache = await store2.open();
  const missing = [];
  for (const filename of BETTER_RENDERER_FILES) {
    const hit = await cache.match(betterRendererUrl(pageUrl2, filename));
    if (!hit) missing.push(filename);
  }
  return missing;
}
async function storeRendererFiles(store2, pageUrl2, files) {
  const cache = await store2.open();
  const stored = [];
  const rejected = [];
  for (const file of files) {
    const filename = rendererBasename(file.name);
    if (!filename) {
      rejected.push(file.name);
      continue;
    }
    const type = rendererContentType(filename);
    const bytes = new Uint8Array(file.bytes);
    await cache.put(
      betterRendererUrl(pageUrl2, filename),
      new Response(new Blob([bytes], { type }), {
        status: 200,
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, max-age=31536000"
        }
      })
    );
    stored.push(filename);
  }
  return {
    stored,
    rejected,
    missing: await missingRendererFiles(store2, pageUrl2)
  };
}
async function clearRendererAssets(store2) {
  await store2.deleteStore();
}
async function rendererFileHref(store2, pageUrl2, filename, options) {
  const cache = await store2.open();
  const url = betterRendererUrl(pageUrl2, filename);
  const hit = await cache.match(url);
  if (!hit) return null;
  if (options.sameOrigin) return url;
  const blob = await hit.blob();
  const create = options.createObjectUrl ?? ((value) => URL.createObjectURL(value));
  return create(blob);
}

// src/core/output/better_form_bridge.ts
var PUSH_TYPE = "intehrgrator:better-form-push";
var PULL_TYPE = "intehrgrator:better-form-pull-request";
var BetterFormMessage = {
  PUSH: PUSH_TYPE,
  PULL_REQUEST: PULL_TYPE,
  COMPOSITION: "intehrgrator:better-form-composition",
  READY: "intehrgrator:better-form-ready"
};

// web/better_form_viewer.ts
var store = browserRendererAssetStore();
var pageUrl = location.href;
var lastComposition = null;
var assetsMounted = false;
var banner = document.getElementById("banner");
var status = document.getElementById("status");
var explainer = document.getElementById("explainer");
var uploadBtn = document.getElementById("upload-vendor-btn");
var clearBtn = document.getElementById("clear-vendor-btn");
var input = document.getElementById("vendor-upload-input");
var host = document.getElementById("host");
if (explainer) {
  explainer.textContent = "The Better Form Renderer is licensed software. intEHRgrator does not include form-renderer.js, styles.css, or styles-theme.css. Upload those three files from your own Better Platform install. They stay in this browser and are not sent to a server.";
}
function setBanner(text, warn) {
  if (!banner) return;
  banner.textContent = text;
  banner.classList.toggle("warn", warn);
}
function showComposition(composition) {
  lastComposition = composition;
  if (!host) return;
  const text = JSON.stringify(composition, null, 2) ?? "";
  host.textContent = text;
}
async function mountStoredAssets() {
  if (assetsMounted) return;
  for (const filename of ["styles.css", "styles-theme.css"]) {
    const href = await rendererFileHref(store, pageUrl, filename, { sameOrigin: false });
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
  const src = await rendererFileHref(store, pageUrl, "form-renderer.js", { sameOrigin: false });
  if (!src) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not run the stored form-renderer.js"));
    document.head.appendChild(script);
  });
  assetsMounted = true;
}
async function refresh(result) {
  const missing = result?.missing ?? await missingRendererFiles(store, pageUrl);
  if (clearBtn) clearBtn.hidden = missing.length === 3 && !result?.stored.length;
  if (missing.length === 0) {
    if (clearBtn) clearBtn.hidden = false;
    try {
      await mountStoredAssets();
      setBanner("Better Form Viewer ready \u2014 Push from intEHRgrator Test Run.", false);
      if (status) status.textContent = "Stored in this browser.";
      globalThis.opener?.postMessage?.({ type: BetterFormMessage.READY }, "*");
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Could not run the stored renderer.", true);
    }
    return;
  }
  setBanner("Better Form Renderer is not in this browser.", true);
  const skipped = result?.rejected.length ? ` Skipped ${result.rejected.join(", ")}.` : "";
  if (status) {
    status.textContent = missing.length === 3 && !result?.stored.length ? `No renderer stored yet.${skipped}` : `Still needed: ${missing.join(", ")}.${skipped}`;
  }
}
uploadBtn?.addEventListener("click", () => {
  if (input instanceof HTMLInputElement) input.click();
});
input?.addEventListener("change", () => {
  if (!(input instanceof HTMLInputElement)) return;
  const selected = [...input.files ?? []];
  input.value = "";
  void (async () => {
    const files = [];
    for (const file of selected) {
      files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const result = await storeRendererFiles(store, pageUrl, files);
    if (result.missing.length === 0) {
      location.reload();
      return;
    }
    await refresh(result);
  })();
});
clearBtn?.addEventListener("click", () => {
  if (!confirm("Remove the Better Form Renderer from this browser?")) return;
  void clearRendererAssets(store).then(() => location.reload());
});
globalThis.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === BetterFormMessage.PUSH) {
    showComposition(data.composition);
    setBanner("Received composition push from intEHRgrator.", false);
  }
  if (data.type === BetterFormMessage.PULL_REQUEST) {
    const source = event.source;
    if (!source) return;
    const message = { type: BetterFormMessage.COMPOSITION, composition: lastComposition };
    if (source instanceof Window) source.postMessage(message, { targetOrigin: "*" });
    else source.postMessage(message);
  }
});
void refresh().catch((error) => {
  setBanner("This browser could not store the Better Form Renderer.", true);
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
});
//# sourceMappingURL=better_form_viewer.js.map
