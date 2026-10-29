/**
 * THROWAWAY SPIKE (#41 / PR #300): replay queries.json with the pinned
 * regionstockholm/z3-wasm-singlethread v0.1.0 GitHub release under Deno.
 *
 * Downloads the release tarball once into /tmp, refuses to run unless its SHA-256 and the
 * wasm's SHA-256 match the pins below and every file matches the bundled SHA256SUMS, then
 * replays every query. Run `deno task spike` first (writes queries.json).
 *
 *   cd experiments/z3-spike && deno task release
 *
 * Provenance (optional, needs the GitHub CLI):
 *   gh attestation verify /tmp/z3-wasm-singlethread-v0.1.0/z3-wasm-singlethread-v0.1.0.tar.gz \
 *     -R regionstockholm/z3-wasm-singlethread --source-ref refs/tags/v0.1.0
 * Pass `--attest` to run that from this script (fails if `gh` is missing or verification fails).
 */

/** The single source of truth for the Z3 build intEHRgrator uses (PR #300, Q19). */
export const Z3_RELEASE = {
  repo: "regionstockholm/z3-wasm-singlethread",
  tag: "v0.1.0",
  commit: "f7913333a1456b7bbfebf5711e822fcb88284e7a",
  z3: "5.3.2",
  tarball: "z3-wasm-singlethread-v0.1.0.tar.gz",
  tarballSha256: "76afbdd80edcfc37e87e3fe751cf6e98f6db0e7ed1c85e410075c461345fe5fb",
  wasmSha256: "228258f7523f47b9d50486736a98f3902b7851478056f646a1602b6341453f84",
} as const;
const base = `https://github.com/${Z3_RELEASE.repo}/releases/download/${Z3_RELEASE.tag}/`;

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0"))
    .join("");

const dir = `/tmp/z3-wasm-singlethread-${Z3_RELEASE.tag}`;
const tgz = `${dir}/${Z3_RELEASE.tarball}`;
await Deno.mkdir(`${dir}/pkg`, { recursive: true });
let tarBytes: Uint8Array<ArrayBuffer>;
try {
  tarBytes = await Deno.readFile(tgz);
} catch {
  const res = await fetch(base + Z3_RELEASE.tarball);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${base + Z3_RELEASE.tarball}`);
  tarBytes = new Uint8Array(await res.arrayBuffer());
  await Deno.writeFile(tgz, tarBytes);
}
const tarSha = await sha256(tarBytes);
if (tarSha !== Z3_RELEASE.tarballSha256) {
  throw new Error(`tarball SHA-256 ${tarSha} != pinned ${Z3_RELEASE.tarballSha256}; delete ${tgz} and retry`);
}

if (Deno.args.includes("--attest")) {
  const att = await new Deno.Command("gh", {
    args: ["attestation", "verify", tgz, "-R", Z3_RELEASE.repo, "--source-ref", `refs/tags/${Z3_RELEASE.tag}`],
  }).output();
  if (!att.success) throw new Error(`gh attestation verify failed:\n${new TextDecoder().decode(att.stderr)}`);
}

const untar = await new Deno.Command("tar", { args: ["xzf", tgz, "-C", `${dir}/pkg`] }).output();
if (!untar.success) throw new Error("tar failed");
for (const line of Deno.readTextFileSync(`${dir}/pkg/SHA256SUMS`).trim().split("\n")) {
  const [want, name] = line.split(/\s+/);
  if (name === Z3_RELEASE.tarball) continue; // not inside the tarball
  const got = await sha256(await Deno.readFile(`${dir}/pkg/${name}`));
  if (got !== want) throw new Error(`${name}: SHA-256 ${got} != SHA256SUMS ${want}`);
}
const wasmSha = await sha256(await Deno.readFile(`${dir}/pkg/z3-built.wasm`));
if (wasmSha !== Z3_RELEASE.wasmSha256) throw new Error(`wasm SHA-256 ${wasmSha} != pinned ${Z3_RELEASE.wasmSha256}`);

const t0 = performance.now();
const { init } = await import(`file://${dir}/pkg/index.mjs`);
const z3 = await init();
const init_ms = Math.round(performance.now() - t0);
const qs = JSON.parse(Deno.readTextFileSync(new URL("queries.json", import.meta.url))) as {
  label: string;
  smt: string;
  verdict: string;
}[];
let agree = 0;
let max = 0;
const mismatches: string[] = [];
const t1 = performance.now();
for (const q of qs) {
  const a = performance.now();
  const verdict = z3.evalSmtlib2(q.smt + "\n(check-sat)\n").trim().split("\n").pop();
  max = Math.max(max, performance.now() - a);
  if (verdict === q.verdict) agree++;
  else mismatches.push(`${q.label}: ${verdict} (z3-solver: ${q.verdict})`);
}
const out = {
  release: `${Z3_RELEASE.repo}@${Z3_RELEASE.tag}`,
  z3_version: z3.version(),
  tarball_sha256: tarSha,
  wasm_sha256: wasmSha,
  attestation_checked: Deno.args.includes("--attest"),
  deno: Deno.version.deno,
  init_ms,
  queries: qs.length,
  agree_with_z3_solver: agree,
  mismatches,
  replay_total_ms: Math.round(performance.now() - t1),
  max_query_ms: Math.round(max),
};
console.log(JSON.stringify(out, null, 2));
Deno.writeTextFileSync(new URL("release_results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
if (mismatches.length) Deno.exit(1);
