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
| `release_check.ts` | 2026-10-29: downloads the pinned [z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0) release tarball, checks its SHA-256, the wasm's SHA-256 and `SHA256SUMS` (and with `--attest` the build-provenance attestation via `gh`), then replays `queries.json` under Deno. Writes `release_results.json`. |
| `results.json`, `queries.json`, `browser_results.json`, `hosting_results.json`, `release_results.json`, `sbp_band_gap.smt2` | Output of the runs recorded in [formal-verification-export.md](../../docs/future/formal-verification-export.md#spike-z3-wasm-on-real-fixtures-2026-10-27). |

```sh
cd experiments/z3-spike
deno task spike     # Deno only; ~2 s wall
deno task browser   # needs Playwright Chromium (npx playwright@1.51.0 install chromium)
deno task hosting   # after `spike`; also needs `npm` (fetches z3-solver, z3-josh, coi-serviceworker into /tmp)
deno task josh-deno # after `spike`
deno task release   # after `spike`; z3-wasm-singlethread v0.1.0 (add --attest to also run `gh attestation verify`)
z3 sbp_band_gap.smt2  # optional: same query with a native z3 binary
```

Run on: Deno 2.9.7, z3-solver 5.3.2, z3-josh 0.1.2, coi-serviceworker 0.1.7, Playwright 1.51 Chromium, Linux x86-64 (8 vCPU), 2026-10-27/28.
Timings are from that box. Treat them as orders of magnitude, not benchmarks.

## Follow-up

`z3-josh` was used here only for measurement. Its provenance could not be established, so the
single-threaded Z3 for intEHRgrator is built in
[regionstockholm/z3-wasm-singlethread](https://github.com/regionstockholm/z3-wasm-singlethread)
from a pinned upstream Z3 tag, with attested CI builds. **The build to use is the
[v0.1.0 release](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0)**,
pinned by SHA-256 in `release_check.ts` (`Z3_RELEASE`):

- tarball [`z3-wasm-singlethread-v0.1.0.tar.gz`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-wasm-singlethread-v0.1.0.tar.gz): `76afbdd80edcfc37e87e3fe751cf6e98f6db0e7ed1c85e410075c461345fe5fb`
- [`z3-built.wasm`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-built.wasm): `228258f7523f47b9d50486736a98f3902b7851478056f646a1602b6341453f84`
- provenance: `gh attestation verify <file> -R regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0`

See
[formal-verification-export.md](../../docs/future/formal-verification-export.md#follow-up-provenance-check-and-our-own-build-2026-10-28).
`spike.ts`, `browser_check.ts` and `hosting_check.ts` still use `z3-solver`/`z3-josh` as recorded;
only `release_check.ts` uses the release.
