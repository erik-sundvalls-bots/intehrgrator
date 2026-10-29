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
| `hosting_check.ts` | A static server **without** COOP/COEP. (A) `z3-solver` + `coi-serviceworker`, (B) third-party single-threaded `z3-josh`, (C) the pinned z3-wasm-singlethread v0.1.0 package (`createZ3Worker()`, checked by `release_check.ts` first). All replay the 225 queries from `queries.json` in Chromium, with side-effect probes and a cancel test. Writes `hosting_results.json`. |
| `josh_deno_check.ts` | Replays `queries.json` with `z3-josh` under Deno (comparison only; `z3-josh` is rejected). |
| `release_check.ts` | Downloads the pinned [z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0) release tarball, checks its SHA-256, the wasm's SHA-256 and `SHA256SUMS` (and with `--attest` the build-provenance attestation via `gh`), then replays `queries.json` under Deno. Writes `release_results.json`. |
| `results.json`, `queries.json`, `browser_results.json`, `hosting_results.json`, `release_results.json`, `sbp_band_gap.smt2` | Output of the runs recorded in [formal-verification-export.md](../../docs/future/formal-verification-export.md#spike-z3-wasm-on-real-fixtures). |

```sh
cd experiments/z3-spike
deno task spike     # Deno only; ~2 s wall
deno task browser   # needs Playwright Chromium (npx playwright@1.51.0 install chromium)
deno task hosting   # after `spike` and `release`; also needs `npm` (fetches z3-solver, z3-josh, coi-serviceworker into /tmp)
deno task josh-deno # after `spike`
deno task release   # after `spike`; z3-wasm-singlethread v0.1.0 (add --attest to also run `gh attestation verify`)
z3 sbp_band_gap.smt2  # optional: same query with a native z3 binary
```

Run on: Deno 2.9.7, z3-solver 5.3.2, z3-josh 0.1.2, coi-serviceworker 0.1.7, z3-wasm-singlethread v0.1.0, Playwright 1.51 Chromium, Linux x86-64 (8 vCPU).
Timings are from that box. Treat them as orders of magnitude, not benchmarks.

## The build to use

**[z3-wasm-singlethread v0.1.0](https://github.com/regionstockholm/z3-wasm-singlethread/releases/tag/v0.1.0)**,
a single-threaded build of upstream Z3 5.3.2 from a pinned tag, reproducible and attested. It runs in a
plain Worker without COOP/COEP. Every intEHRgrator variant (web app, desktop app, headless / CI) uses this
same build, so verification results do not depend on the variant; `z3-solver` and a native `z3` appear here
only as spike references. `z3-josh` appears here only as a measured alternative; it is rejected
because its provenance cannot be established. The pins live in `release_check.ts` (`Z3_RELEASE`):

- tarball [`z3-wasm-singlethread-v0.1.0.tar.gz`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-wasm-singlethread-v0.1.0.tar.gz): `76afbdd80edcfc37e87e3fe751cf6e98f6db0e7ed1c85e410075c461345fe5fb`
- [`z3-built.wasm`](https://github.com/regionstockholm/z3-wasm-singlethread/releases/download/v0.1.0/z3-built.wasm) (21,895,178 bytes; 6,071,890 with `gzip -9`): `228258f7523f47b9d50486736a98f3902b7851478056f646a1602b6341453f84`
- provenance: `gh attestation verify <file> -R regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0`

See
[formal-verification-export.md](../../docs/future/formal-verification-export.md#provenance-and-the-build-we-use).
`spike.ts` and `browser_check.ts` use `z3-solver` (the spike's reference verdicts); `hosting_check.ts`
compares all three builds; `release_check.ts` checks and replays the release.
