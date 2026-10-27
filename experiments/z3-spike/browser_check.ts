/**
 * THROWAWAY SPIKE for issue #41: does z3-solver (WASM, pthreads) start in headless Chromium,
 * with and without COOP/COEP headers? Serves a tiny page on two ports and records timings.
 *
 *   cd experiments/z3-spike && deno task browser
 *
 * Uses the same Playwright pin as test/ui. Writes `browser_results.json`.
 */
import { chromium } from "playwright";

// z3-solver's browser build is CommonJS and needs `global.initZ3`, so bundle a tiny ESM entry,
// and serve z3-built.js / z3-built.wasm straight from Deno's npm cache.
const denoDir = Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`;
const build = new URL(`file://${denoDir}/npm/registry.npmjs.org/z3-solver/5.3.2/build/`);
const bundled = await new Deno.Command(Deno.execPath(), {
  args: ["bundle", "--platform", "browser", "-o", "/tmp/z3-browser-bundle.js", "browser_entry.ts"],
  cwd: new URL(".", import.meta.url),
}).output();
if (!bundled.success) throw new Error(new TextDecoder().decode(bundled.stderr));
const bundle = await Deno.readFile("/tmp/z3-browser-bundle.js");
const page = `<!doctype html><meta charset="utf-8">
<script src="/z3-built.js"></script>
<script type="module">
  const out = { crossOriginIsolated: self.crossOriginIsolated, sab: typeof SharedArrayBuffer };
  try {
    const t0 = performance.now();
    const { init } = await import("/bundle.js");
    const { Context } = await init();
    out.init_ms = Math.round(performance.now() - t0);
    const Z3 = Context("main");
    const sbp = Z3.Real.const("sbp");
    const s = new Z3.Solver();
    s.add(Z3.Not(Z3.Or(sbp.lt(90), Z3.And(sbp.ge(90), sbp.le(139)), sbp.ge(140))));
    const t1 = performance.now();
    out.verdict = await s.check();
    out.solve_ms = Math.round(performance.now() - t1);
    out.model = s.model().eval(sbp, true).toString();
  } catch (e) { out.error = String(e && e.message || e); }
  window.__z3 = out;
</script>`;

const types: Record<string, string> = { js: "text/javascript", wasm: "application/wasm" };
function serve(port: number, isolate: boolean) {
  return Deno.serve({ port, onListen() {} }, async (req) => {
    const path = new URL(req.url).pathname;
    const h = new Headers();
    if (isolate) {
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Embedder-Policy", "require-corp");
    }
    if (path === "/") return new Response(page, { headers: (h.set("content-type", "text/html"), h) });
    const name = path.slice(1);
    if (name === "bundle.js") return new Response(bundle, { headers: (h.set("content-type", "text/javascript"), h) });
    if (!/^z3-built\.(js|wasm)$/.test(name)) {
      return new Response("nf", { status: 404 });
    }
    h.set("content-type", types[name.split(".").pop()!] ?? "text/plain");
    return new Response(await Deno.readFile(new URL(name, build)), { headers: h });
  });
}

const results: Record<string, unknown> = {};
const browser = await chromium.launch();
for (const [port, isolate] of [[8771, false], [8772, true]] as const) {
  const server = serve(port, isolate);
  const p = await browser.newPage();
  const t0 = performance.now();
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction("window.__z3 !== undefined", null, { timeout: 60000 });
  const r = await p.evaluate("window.__z3") as Record<string, unknown>;
  r.page_total_ms = Math.round(performance.now() - t0);
  results[isolate ? "with_coop_coep" : "without_coop_coep"] = r;
  await p.close();
  await server.shutdown();
}
await browser.close();
Deno.writeTextFileSync(new URL("browser_results.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
