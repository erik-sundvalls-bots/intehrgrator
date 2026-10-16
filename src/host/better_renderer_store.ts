/**
 * Licensed Better Form Renderer files, stored in this browser.
 *
 * `form-renderer.js`, `styles.css`, and `styles-theme.css` are proprietary.
 * They are not in the git repo and not in the build. The user uploads them
 * (same three files Kintegrate asked for). Bytes live in a dedicated Cache
 * API store, which is the browser storage Kintegrate used (`kintegrate-vendor-v1`),
 * not in the Project Bundle and not in localStorage.
 *
 * The app-shell service worker must not delete `BETTER_RENDERER_CACHE` on
 * deploy, and must not fetch these URLs from the network.
 */

export const BETTER_RENDERER_CACHE = "intehrgrator-better-renderer";

export const BETTER_RENDERER_FILES = [
  "form-renderer.js",
  "styles.css",
  "styles-theme.css",
] as const;

export type BetterRendererFileName = typeof BETTER_RENDERER_FILES[number];

const SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+\.(?:js|css)$/i;

export interface RendererCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  keys(): Promise<string[]>;
}

export interface RendererAssetStore {
  open(): Promise<RendererCache>;
  deleteStore(): Promise<boolean>;
}

export interface RendererUpload {
  name: string;
  bytes: Uint8Array;
}

export interface RendererStoreResult {
  stored: string[];
  rejected: string[];
  missing: BetterRendererFileName[];
}

/** True for `/vendor/better/…` only. Shoelace and Jspreadsheet stay on the network. */
export function isBetterRendererPath(pathname: string): boolean {
  return pathname.includes("/vendor/better/");
}

/** App-relative URL the viewer and the service worker both use. */
export function betterRendererUrl(pageUrl: string, filename: string): string {
  return new URL(`vendor/better/${filename}`, pageUrl).href;
}

/**
 * Basename only, under `vendor/better/`. Required files are stored under their
 * canonical lowercase names so `Form-Renderer.JS` still completes the set.
 */
export function rendererBasename(name: string): string | null {
  const base = name.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? "";
  if (!SAFE_ASSET_NAME.test(base)) return null;
  const canonical = BETTER_RENDERER_FILES.find((file) => file.toLowerCase() === base.toLowerCase());
  return canonical ?? base;
}

export function rendererContentType(filename: string): string {
  return filename.toLowerCase().endsWith(".css") ? "text/css" : "text/javascript";
}

export function browserRendererAssetStore(): RendererAssetStore {
  return {
    async open() {
      const cache = await caches.open(BETTER_RENDERER_CACHE);
      return {
        async match(url) {
          const hit = await cache.match(url);
          return hit ?? undefined;
        },
        put(url, response) {
          return cache.put(url, response);
        },
        async keys() {
          const requests = await cache.keys();
          return requests.map((request) => request.url);
        },
      };
    },
    deleteStore() {
      return caches.delete(BETTER_RENDERER_CACHE);
    },
  };
}

/** In-memory store for tests. One cache, shared across `open()`. */
export function memoryRendererAssetStore(): RendererAssetStore {
  const entries = new Map<string, Response>();
  const cache: RendererCache = {
    match(url) {
      return Promise.resolve(entries.get(url)?.clone());
    },
    put(url, response) {
      entries.set(url, response.clone());
      return Promise.resolve();
    },
    keys() {
      return Promise.resolve([...entries.keys()]);
    },
  };
  return {
    open() {
      return Promise.resolve(cache);
    },
    deleteStore() {
      entries.clear();
      return Promise.resolve(true);
    },
  };
}

export async function missingRendererFiles(
  store: RendererAssetStore,
  pageUrl: string,
): Promise<BetterRendererFileName[]> {
  const cache = await store.open();
  const missing: BetterRendererFileName[] = [];
  for (const filename of BETTER_RENDERER_FILES) {
    const hit = await cache.match(betterRendererUrl(pageUrl, filename));
    if (!hit) missing.push(filename);
  }
  return missing;
}

export async function rendererAssetsReady(
  store: RendererAssetStore,
  pageUrl: string,
): Promise<boolean> {
  const missing = await missingRendererFiles(store, pageUrl);
  return missing.length === 0;
}

export async function storeRendererFiles(
  store: RendererAssetStore,
  pageUrl: string,
  files: readonly RendererUpload[],
): Promise<RendererStoreResult> {
  const cache = await store.open();
  const stored: string[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const filename = rendererBasename(file.name);
    if (!filename) {
      rejected.push(file.name);
      continue;
    }
    const type = rendererContentType(filename);
    const bytes = new Uint8Array(file.bytes);
    await cache.put(
      betterRendererUrl(pageUrl, filename),
      new Response(new Blob([bytes], { type }), {
        status: 200,
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, max-age=31536000",
        },
      }),
    );
    stored.push(filename);
  }
  return {
    stored,
    rejected,
    missing: await missingRendererFiles(store, pageUrl),
  };
}

export async function clearRendererAssets(store: RendererAssetStore): Promise<void> {
  await store.deleteStore();
}

export interface RendererFileHrefOptions {
  /** When a service worker is controlling the page, return the same-origin URL. */
  sameOrigin: boolean;
  createObjectUrl?: (blob: Blob) => string;
}

/** URL to inject as a stylesheet or classic script. Null when that file is absent. */
export async function rendererFileHref(
  store: RendererAssetStore,
  pageUrl: string,
  filename: string,
  options: RendererFileHrefOptions,
): Promise<string | null> {
  const cache = await store.open();
  const url = betterRendererUrl(pageUrl, filename);
  const hit = await cache.match(url);
  if (!hit) return null;
  if (options.sameOrigin) return url;
  const blob = await hit.blob();
  const create = options.createObjectUrl ?? ((value: Blob) => URL.createObjectURL(value));
  return create(blob);
}
