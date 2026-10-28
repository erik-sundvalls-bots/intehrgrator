# Z3 WASM spike (throwaway — issue #41)

> **Not product code.** Nothing in `src/`, `web/` or `test/` imports this folder, and it has its own
> `deno.json` (`"lock": false`, `"nodeModulesDir": "none"`), so it does not touch the app's
> `deno.lock` or `node_modules`. Delete it once #41 has a real SMT emitter.

It answers one question: does `npm:z3-solver` (Z3 compiled to WASM) work for intEHRgrator, in Deno
and in a browser, on **real fixture mappings**, and does it find anything?

| File | What it does |
|------|--------------|
| `spike.ts` | Hand-encodes Decision tables from `test/fixtures/**` as SMT (mirroring `src/core/sheets/decision_table.ts`), solves with Z3 WASM under Deno, replays every counterexample on the app's own `evaluateDecisionTable`. Writes `results.json` and `sbp_band_gap.smt2`. |
| `browser_check.ts` + `browser_entry.ts` | Serves a tiny page from `localhost` with and without COOP/COEP, loads Z3 in headless Chromium (same Playwright pin as `test/ui`), solves the sbp_band query. Writes `browser_results.json`. |
| `hosting_check.ts` | 2026-10-28: a static server **without** COOP/COEP. (A) `z3-solver` + `coi-serviceworker`, (B) single-threaded `z3-josh`. Both replay all 225 queries from `queries.json` in Chromium, with side-effect probes. Writes `hosting_results.json`. |
| `josh_deno_check.ts` | Replays `queries.json` with `z3-josh` under Deno. |
| `results.json`, `queries.json`, `browser_results.json`, `hosting_results.json`, `sbp_band_gap.smt2` | Output of the runs recorded in [formal-verification-export.md](../../docs/future/formal-verification-export.md#spike-z3-wasm-on-real-fixtures-2026-10-27). |

```sh
cd experiments/z3-spike
deno task spike     # Deno only; ~2 s wall
deno task browser   # needs Playwright Chromium (npx playwright@1.51.0 install chromium)
deno task hosting   # after `spike`; also needs `npm` (fetches z3-solver, z3-josh, coi-serviceworker into /tmp)
deno task josh-deno # after `spike`
z3 sbp_band_gap.smt2  # optional: same query with a native z3 binary
```

Run on: Deno 2.9.7, z3-solver 5.3.2, z3-josh 0.1.2, coi-serviceworker 0.1.7, Playwright 1.51 Chromium, Linux x86-64 (8 vCPU), 2026-10-27/28.
Timings are from that box. Treat them as orders of magnitude, not benchmarks.
