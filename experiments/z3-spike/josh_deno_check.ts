/**
 * THROWAWAY SPIKE (#41 / PR #300): replay queries.json with z3-josh 0.1.2 (single-threaded Z3 WASM)
 * under Deno, for comparison with z3-solver. Run `deno task spike` first.
 */
const t0 = performance.now();
const { init } = await import("z3-josh");
const api = await init();
const init_ms = Math.round(performance.now() - t0);
const Z3 = api.Context("main");
const qs = JSON.parse(Deno.readTextFileSync(new URL("queries.json", import.meta.url))) as {
  smt: string;
  verdict: string;
}[];
let agree = 0;
let max = 0;
const t1 = performance.now();
for (const q of qs) {
  const s = new Z3.Solver();
  s.fromString(q.smt);
  const a = performance.now();
  if ((await s.check()) === q.verdict) agree++;
  max = Math.max(max, performance.now() - a);
}
console.log(JSON.stringify({
  z3_josh: "0.1.2",
  deno: Deno.version.deno,
  init_ms,
  queries: qs.length,
  agree_with_z3_solver: agree,
  replay_total_ms: Math.round(performance.now() - t1),
  max_query_ms: Math.round(max),
}));
(api as unknown as { terminate?: () => void }).terminate?.();
