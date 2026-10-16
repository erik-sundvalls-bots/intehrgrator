/**
 * Optional Better form viewer. Licensed renderer files are uploaded here and
 * read back from the browser cache. This page never requests them from the
 * network.
 */
import {
  browserRendererAssetStore,
  clearRendererAssets,
  missingRendererFiles,
  rendererFileHref,
  storeRendererFiles,
  type RendererAssetStore,
  type RendererStoreResult,
} from "../src/host/better_renderer_store.ts";
import { BetterFormMessage } from "../src/core/output/better_form_bridge.ts";

const store: RendererAssetStore = browserRendererAssetStore();
const pageUrl = location.href;
let lastComposition: unknown = null;
let assetsMounted = false;

const banner = document.getElementById("banner");
const status = document.getElementById("status");
const explainer = document.getElementById("explainer");
const uploadBtn = document.getElementById("upload-vendor-btn");
const clearBtn = document.getElementById("clear-vendor-btn");
const input = document.getElementById("vendor-upload-input");
const host = document.getElementById("host");

if (explainer) {
  explainer.textContent =
    "The Better Form Renderer is licensed software. intEHRgrator does not include form-renderer.js, styles.css, or styles-theme.css. Upload those three files from your own Better Platform install. They stay in this browser and are not sent to a server.";
}

function setBanner(text: string, warn: boolean): void {
  if (!banner) return;
  banner.textContent = text;
  banner.classList.toggle("warn", warn);
}

function showComposition(composition: unknown): void {
  lastComposition = composition;
  if (!host) return;
  const text = JSON.stringify(composition, null, 2) ?? "";
  host.textContent = text;
}

async function mountStoredAssets(): Promise<void> {
  if (assetsMounted) return;
  for (const filename of ["styles.css", "styles-theme.css"] as const) {
    const href = await rendererFileHref(store, pageUrl, filename, { sameOrigin: false });
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
  const src = await rendererFileHref(store, pageUrl, "form-renderer.js", { sameOrigin: false });
  if (!src) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not run the stored form-renderer.js"));
    document.head.appendChild(script);
  });
  assetsMounted = true;
}

async function refresh(result?: RendererStoreResult): Promise<void> {
  const missing = result?.missing ?? await missingRendererFiles(store, pageUrl);
  if (clearBtn) clearBtn.hidden = missing.length === 3 && !result?.stored.length;
  if (missing.length === 0) {
    if (clearBtn) clearBtn.hidden = false;
    try {
      await mountStoredAssets();
      setBanner("Better Form Viewer ready — Push from intEHRgrator Test Run.", false);
      if (status) status.textContent = "Stored in this browser.";
      globalThis.opener?.postMessage?.({ type: BetterFormMessage.READY }, "*");
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Could not run the stored renderer.", true);
    }
    return;
  }
  setBanner("Better Form Renderer is not in this browser.", true);
  const skipped = result?.rejected.length
    ? ` Skipped ${result.rejected.join(", ")}.`
    : "";
  if (status) {
    status.textContent = missing.length === 3 && !result?.stored.length
      ? `No renderer stored yet.${skipped}`
      : `Still needed: ${missing.join(", ")}.${skipped}`;
  }
}

uploadBtn?.addEventListener("click", () => {
  if (input instanceof HTMLInputElement) input.click();
});

input?.addEventListener("change", () => {
  if (!(input instanceof HTMLInputElement)) return;
  const selected = [...(input.files ?? [])];
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

void refresh().catch((error: unknown) => {
  setBanner("This browser could not store the Better Form Renderer.", true);
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
});
