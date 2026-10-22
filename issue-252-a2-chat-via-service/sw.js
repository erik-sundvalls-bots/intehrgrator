/* intEHRgrator web app — installable PWA service worker.
 * Network-first for navigations / HTML and for app shell assets (bundle.js,
 * styles.css) so a rebuild cannot leave new markup wired to a stale bundle.
 * Cache-first for icons and other static assets.
 * Cache name is stamped at build time so each deploy activates a fresh cache.
 */
const CACHE_PREFIX = "intehrgrator-";
const CACHE_NAME = CACHE_PREFIX + "a6d11a9-2026-10-22T06:30:26.902Z";
// Licensed Better renderer. Keep in sync with BETTER_RENDERER_CACHE
// in src/host/better_renderer_store.ts. Deploys must not wipe it.
const BETTER_RENDERER_CACHE = "intehrgrator-better-renderer";

const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./bundle.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) =>
            key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== BETTER_RENDERER_CACHE
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAppShellAsset(url) {
  const path = url.pathname;
  if (path.includes("/vendor/better/")) return false;
  return (
    path.endsWith("/bundle.js") ||
    path.endsWith("/bundle.js.map") ||
    path.endsWith("/styles.css") ||
    path.endsWith("/sw.js") ||
    path.endsWith("/manifest.webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Proprietary renderer: browser cache only. Never fall through to the
  // network — a missing file must not become a build 404 in the console.
  if (url.pathname.includes("/vendor/better/")) {
    event.respondWith(betterRendererResponse(request));
    return;
  }

  // Navigations / HTML / app shell: network first so deploys show up promptly
  // and HTML cannot race ahead of a cache-first bundle.js.
  if (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html") ||
    isAppShellAsset(url)
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function betterRendererResponse(request) {
  const cache = await caches.open(BETTER_RENDERER_CACHE);
  const cached = (await cache.match(request)) || (await cache.match(request.url));
  if (cached) return cached;
  return new Response(
    "Better Form Renderer is not in this browser. Upload it from the form viewer.",
    {
      status: 404,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    },
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match("./index.html");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return Response.error();
  }
}
