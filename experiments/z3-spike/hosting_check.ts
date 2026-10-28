/**
 * THROWAWAY SPIKE for issue #41 / PR #300: can Verify mapping run on a static host that cannot
 * set COOP/COEP headers (GitHub Pages)? Every server below sends NO isolation headers.
 *
 *   A. z3-solver 5.3.2 (pthreads, needs SharedArrayBuffer) + coi-serviceworker 0.1.7
 *      (a service worker that re-serves same-origin responses with COOP/COEP).
 *      Side-effect probes: a Google Fonts stylesheet (like web/index.html), an <img> from
 *      another localhost origin without CORP, and a CORS fetch to that origin.
 *   B. z3-josh 0.1.2 (single-threaded Z3 WASM, solves in a plain Worker; no SharedArrayBuffer).
 *
 * Both replay every query in queries.json (SMT-LIB text dumped by spike.ts) in headless Chromium.
 *
 *   cd experiments/z3-spike && deno task spike && deno task hosting
 *
 * Needs `npm` (to fetch the two packages into /tmp) and Playwright Chromium. Writes hosting_results.json.
 */
import { chromium } from "playwright";

const here = new URL(".", import.meta.url);
const tmp = "/tmp/z3-hosting-check";
await Deno.mkdir(tmp, { recursive: true });
async function npmPack(spec: string): Promise<string> {
  const dir = `${tmp}/${spec.replace(/[@/]/g, "_")}`;
  try {
    await Deno.stat(`${dir}/package/package.json`);
    return `${dir}/package/`;
  } catch { /* fetch */ }
  await Deno.mkdir(dir, { recursive: true });
  const pack = await new Deno.Command("npm", { args: ["pack", spec, "--silent"], cwd: dir }).output();
  if (!pack.success) throw new Error(new TextDecoder().decode(pack.stderr));
  const tgz = new TextDecoder().decode(pack.stdout).trim().split("\n").pop()!;
  const untar = await new Deno.Command("tar", { args: ["xzf", tgz], cwd: dir }).output();
  if (!untar.success) throw new Error("tar failed");
  return `${dir}/package/`;
}
const z3solver = await npmPack("z3-solver@5.3.2");
const z3josh = await npmPack("z3-josh@0.1.2");
const coi = await npmPack("coi-serviceworker@0.1.7");

// z3-solver's browser entry is CommonJS + `global.initZ3`: bundle a tiny ESM shim (as browser_check.ts).
const bundled = await new Deno.Command(Deno.execPath(), {
  args: ["bundle", "--platform", "browser", "-o", `${tmp}/z3-solver-bundle.js`, "browser_entry.ts"],
  cwd: here,
}).output();
if (!bundled.success) throw new Error(new TextDecoder().decode(bundled.stderr));
const queries = Deno.readTextFileSync(new URL("queries.json", here));

/** Shared in-page bench: init, then replay every SMT-LIB query; report timings and verdict agreement. */
const bench = (importLine: string, initExpr: string) => `
  const out = { crossOriginIsolated: self.crossOriginIsolated, sab: typeof SharedArrayBuffer };
  try {
    const t0 = performance.now();
    ${importLine}
    const api = await ${initExpr};
    out.init_ms = Math.round(performance.now() - t0);
    const Z3 = api.Context("main");
    const qs = await (await fetch("/queries.json")).json();
    let agree = 0; const t1 = performance.now(); let max = 0;
    for (const q of qs) {
      const s = new Z3.Solver();
      s.fromString(q.smt);
      const a = performance.now();
      const r = await s.check();
      max = Math.max(max, performance.now() - a);
      if (r === q.verdict) agree++;
    }
    out.queries = qs.length; out.agree_with_deno_z3_solver = agree;
    out.replay_total_ms = Math.round(performance.now() - t1); out.max_query_ms = Math.round(max);
    // Cancellation: a query Z3 will not finish quickly (x^3 + y^3 + z^3 = 42, x > 1000), interrupted at 300 ms.
    const hard = new Z3.Solver();
    hard.fromString("(declare-const x Int)(declare-const y Int)(declare-const z Int)(assert (= (+ (* x x x) (* y y y) (* z z z)) 42))(assert (> x 1000))");
    const c0 = performance.now();
    const pending = hard.check();
    setTimeout(() => Z3.interrupt(), 300);
    const timeout = new Promise((res) => setTimeout(() => res("no answer after 10 s"), 10000));
    out.cancel_verdict = await Promise.race([pending, timeout]);
    out.cancel_resolved_ms = Math.round(performance.now() - c0);
  } catch (e) { out.error = String(e && e.message || e); }
  window.__z3 = out;`;

const probes = (otherOrigin: string) => `
<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Google+Sans:400,500"
  onload="window.__fontCss='loaded'" onerror="window.__fontCss='error'">
<img src="${otherOrigin}/pixel.gif" onload="window.__img='loaded'" onerror="window.__img='error'">
<script>
  fetch("${otherOrigin}/data.json").then(r => r.json()).then(() => window.__cors = "ok", e => window.__cors = "error: " + e);
</script>`;

const pages: Record<string, string> = {
  "/coi/": `<!doctype html><meta charset="utf-8">
<script src="/coi-serviceworker.js"></script>
${probes("http://127.0.0.1:8783")}
<script src="/z3-built.js"></script>
<script type="module">${bench('const { init } = await import("/z3-solver-bundle.js");', "init()")}</script>`,
  "/josh/": `<!doctype html><meta charset="utf-8">
${probes("http://127.0.0.1:8783")}
<script type="module">${bench('const { init } = await import("/josh/dist/index.js");', "init()")}</script>`,
};

const types: Record<string, string> = { js: "text/javascript", wasm: "application/wasm", json: "application/json" };
const fileFor = (path: string): string | null => {
  if (path === "/coi-serviceworker.js") return coi + "coi-serviceworker.js";
  if (path === "/z3-built.js" || path === "/z3-built.wasm") return z3solver + "build" + path;
  if (path === "/z3-solver-bundle.js") return `${tmp}/z3-solver-bundle.js`;
  const m = /^\/josh\/(dist\/[\w./-]+)$/.exec(path);
  if (m && !m[1].includes("..")) return z3josh + m[1];
  return null;
};
const requests: string[] = [];
// Static origin WITHOUT COOP/COEP (like GitHub Pages).
const app = Deno.serve({ port: 8782, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const path = new URL(req.url).pathname;
  requests.push(path);
  if (pages[path]) return new Response(pages[path], { headers: { "content-type": "text/html" } });
  if (path === "/queries.json") return new Response(queries, { headers: { "content-type": "application/json" } });
  const f = fileFor(path);
  if (!f) return new Response("nf", { status: 404 });
  return new Response(await Deno.readFile(f), {
    headers: { "content-type": types[path.split(".").pop()!] ?? "text/plain", "cache-control": "max-age=3600" },
  });
});
// A different origin with no CORP header; CORS allowed for the JSON.
const gif = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const other = Deno.serve({ port: 8783, hostname: "127.0.0.1", onListen() {} }, (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/pixel.gif") return new Response(gif, { headers: { "content-type": "image/gif" } });
  return new Response('{"ok":true}', {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
});

const results: Record<string, unknown> = {};
const browser = await chromium.launch();
for (const variant of ["coi", "josh"] as const) {
  const ctx = await browser.newContext();
  for (const visit of ["first_visit", "second_visit"] as const) {
    const page = await ctx.newPage();
    let navigations = 0;
    let docCoep = "";
    page.on("response", (res) => {
      if (res.request().resourceType() === "document") {
        docCoep = res.headers()["cross-origin-embedder-policy"] ?? "(none)";
      }
    });
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigations++;
    });
    const before = requests.length;
    const t0 = performance.now();
    await page.goto(`http://127.0.0.1:8782/${variant}/`);
    // coi: the first document is not isolated; coi-serviceworker reloads it. Wait for the isolated
    // document (or give up after 20 s and report what the page has).
    const ready = variant === "coi"
      ? "window.__z3 !== undefined && self.crossOriginIsolated === true"
      : "window.__z3 !== undefined";
    await page.waitForFunction(ready, null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction("window.__z3 !== undefined", null, { timeout: 120000 });
    await page.waitForTimeout(500); // let the probes settle
    const r = await page.evaluate(
      "({ ...window.__z3, fontCss: window.__fontCss ?? 'pending', img: window.__img ?? 'pending', cors: window.__cors ?? 'pending', sw_controlled: !!navigator.serviceWorker?.controller, window_chrome: typeof window.chrome })",
    ) as Record<string, unknown>;
    r.page_total_ms = Math.round(performance.now() - t0);
    r.main_frame_navigations = navigations;
    r.last_document_coep = docCoep;
    r.requests_reaching_server = requests.length - before;
    results[`${variant}_${visit}`] = r;
    await page.close();
  }
  await ctx.close();
}
await browser.close();
await app.shutdown();
await other.shutdown();

const size = (p: string) => Deno.statSync(p).size;
results.sizes = {
  z3_solver_wasm: size(z3solver + "build/z3-built.wasm"),
  z3_solver_js: size(z3solver + "build/z3-built.js"),
  z3_josh_wasm: size(z3josh + "dist/z3-built.wasm"),
  z3_josh_index_js: size(z3josh + "dist/index.js"),
  z3_josh_worker_js: size(z3josh + "dist/z3-worker.js"),
};
Deno.writeTextFileSync(new URL("hosting_results.json", here), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
