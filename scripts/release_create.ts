#!/usr/bin/env -S deno run -A
/**
 * Start a new release from GitHub Actions (or a local dry run).
 *
 * Bumps version files, commits on the chosen branch (default main), and pushes
 * an annotated tag. Publish stays in `.github/workflows/release.yml`, which
 * runs on the tag push. This script refuses when that tag already exists or
 * is already on GitHub Pages.
 *
 * Actions passes RELEASE_VERSION, RELEASE_REF, RELEASE_UPDATE_RECOMMENDED,
 * and RELEASE_DRY_RUN. Locally:
 *   deno run -A scripts/release_create.ts --version 0.8.9 --dry-run
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { normalizeManifest, PAGES_SITE_URL, VERSIONS_MANIFEST } from "./pages_site.ts";
import {
  assertCleanGitTree,
  bumpVersionFiles,
  promoteUnreleasedFile,
  releaseCommitFiles,
  releaseCommitMessage,
  releaseTagForVersion,
  releaseTagMessage,
  run,
} from "./release_version.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");

const USAGE = `Usage:
  deno run -A scripts/release_create.ts --version <semver> [--ref <branch>] [--update-recommended] [--dry-run]

Environment (GitHub Actions):
  RELEASE_VERSION, RELEASE_REF, RELEASE_UPDATE_RECOMMENDED=true|false, RELEASE_DRY_RUN=true|false
`;

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const VERSION_TAG = /^v\d+(\.\d+)*$/;

export class ReleaseCreateRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCreateRefused";
  }
}

export interface ReleaseCreateRequest {
  version: string;
  ref?: string;
  updateRecommended: boolean;
  dryRun: boolean;
}

export interface ReleaseCreatePlan {
  version: string;
  tag: string;
  ref: string;
  updateRecommended: boolean;
  dryRun: boolean;
  commitMessage: string;
  tagMessage: string;
}

/** Branch name Release create may commit onto. Blank means main. */
export function assertBranchRef(ref: string | undefined): string {
  const branch = (ref ?? "").trim();
  if (!branch) return "main";
  if (
    branch === "HEAD" ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.startsWith("refs/") ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw new ReleaseCreateRefused(
      `Refusing ref ${JSON.stringify(ref)}: Release create commits onto a branch name (default main)`,
    );
  }
  return branch;
}

export function planReleaseCreate(req: ReleaseCreateRequest): ReleaseCreatePlan {
  const version = req.version ?? "";
  if (!version) throw new ReleaseCreateRefused("version is required");
  if (/\s/.test(version)) throw new ReleaseCreateRefused("version must not contain whitespace");
  let tag: string;
  try {
    tag = releaseTagForVersion(version);
  } catch (error) {
    throw new ReleaseCreateRefused(error instanceof Error ? error.message : String(error));
  }
  const ref = assertBranchRef(req.ref);
  return {
    version,
    tag,
    ref,
    updateRecommended: req.updateRecommended === true,
    dryRun: req.dryRun === true,
    commitMessage: releaseCommitMessage(version),
    tagMessage: releaseTagMessage(version, tag),
  };
}

export function requestFromInputs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ReleaseCreateRequest {
  let version = env.RELEASE_VERSION ?? "";
  let ref = env.RELEASE_REF;
  let updateRecommended = env.RELEASE_UPDATE_RECOMMENDED === "true";
  let dryRun = env.RELEASE_DRY_RUN === "true";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--version") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new ReleaseCreateRefused("--version requires a semver");
      }
      version = value;
      continue;
    }
    if (arg === "--ref") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new ReleaseCreateRefused("--ref requires a branch name");
      ref = value;
      continue;
    }
    if (arg === "--update-recommended") {
      updateRecommended = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new ReleaseCreateRefused(`Unknown argument: ${arg}`);
  }

  return { version, ref, updateRecommended, dryRun };
}

/** `git ls-remote --tags` output for one tag. Empty means the tag is absent. */
export function interpretRemoteTagList(output: string, tag: string): "exists" | "absent" {
  const exact = `refs/tags/${tag}`;
  const lines = output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return "absent";
  for (const line of lines) {
    const ref = line.split("\t")[1]?.trim();
    if (ref !== exact && ref !== `${exact}^{}`) {
      throw new Error(`unexpected ref ${ref ?? line}`);
    }
  }
  return "exists";
}

/** Pages `index.html` status. Only 200 and 404 are answers; anything else refuses. */
export function interpretPagesIndexStatus(status: number): "published" | "absent" {
  if (status === 404) return "absent";
  if (status === 200) return "published";
  throw new Error(`unexpected HTTP ${status}`);
}

/** Versions listed in Pages `versions.json`. A missing array refuses (fail closed). */
export function publishedVersionsFromManifest(raw: unknown): string[] {
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) ||
    !Array.isArray((raw as { versions?: unknown }).versions)
  ) {
    throw new ReleaseCreateRefused(
      "Refusing to create a release: versions.json has no versions array",
    );
  }
  return normalizeManifest(raw).versions;
}

export function assertReleaseCreateAllowed(opts: {
  tag: string;
  remoteTagList: string;
  publishedVersions: readonly string[];
  pagesIndexStatus: number;
}): void {
  const reasons: string[] = [];
  try {
    if (interpretRemoteTagList(opts.remoteTagList, opts.tag) === "exists") {
      reasons.push(`tag ${opts.tag} already exists on origin`);
    }
  } catch (error) {
    reasons.push(
      `could not verify origin tags (${error instanceof Error ? error.message : error})`,
    );
  }
  if (opts.publishedVersions.includes(opts.tag)) {
    reasons.push(`GitHub Pages versions.json already lists ${opts.tag}`);
  }
  try {
    if (interpretPagesIndexStatus(opts.pagesIndexStatus) === "published") {
      reasons.push(`GitHub Pages already serves /${opts.tag}/index.html`);
    }
  } catch (error) {
    reasons.push(
      `could not verify Pages /${opts.tag}/index.html (${error instanceof Error ? error.message : error})`,
    );
  }
  if (reasons.length > 0) {
    throw new ReleaseCreateRefused(`Refusing to create ${opts.tag}: ${reasons.join("; ")}`);
  }
}

/** `git push` refspecs. One atomic update, never `--force`. */
export function releasePushArgs(ref: string, tag: string, committed: boolean): string[] {
  const branch = assertBranchRef(ref);
  if (branch !== ref) {
    throw new ReleaseCreateRefused(`Refusing to push tag onto ref ${JSON.stringify(ref)}`);
  }
  if (!VERSION_TAG.test(tag)) throw new ReleaseCreateRefused(`Refusing to push tag ${tag}`);
  const args = ["push", "--atomic", "origin"];
  if (committed) args.push(`HEAD:refs/heads/${branch}`);
  args.push(`refs/tags/${tag}`);
  return args;
}

/** Text of repo-root `RECOMMENDED_VERSION` (the tag, not the package version). */
export function recommendedVersionFileText(tag: string): string {
  if (!VERSION_TAG.test(tag)) {
    throw new ReleaseCreateRefused(`Refusing RECOMMENDED_VERSION value ${JSON.stringify(tag)}`);
  }
  return `${tag}\n`;
}

/**
 * Bot identity for commits made on a GitHub-hosted runner.
 * Local runs keep the maintainer's git identity.
 */
export function actionsBotIdentity(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  if (env.GITHUB_ACTIONS !== "true") return undefined;
  const name = env.GIT_AUTHOR_NAME || BOT_NAME;
  const email = env.GIT_AUTHOR_EMAIL || BOT_EMAIL;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME || name,
    GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL || email,
  };
}

async function captureGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) };
}

async function currentBranch(): Promise<string> {
  const result = await captureGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.code !== 0) {
    throw new ReleaseCreateRefused(
      `Refusing to create a release: could not read the current branch (${result.stderr.trim() || `exit ${result.code}`})`,
    );
  }
  return result.stdout.trim();
}

async function remoteTagList(tag: string): Promise<string> {
  const result = await captureGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (result.code !== 0) {
    throw new ReleaseCreateRefused(
      `Refusing to create ${tag}: could not list origin tags (${result.stderr.trim() || `exit ${result.code}`})`,
    );
  }
  return result.stdout;
}

async function fetchNoStore(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ReleaseCreateRefused(
      `Refusing to create a release: could not read ${url} (${error instanceof Error ? error.message : error})`,
    );
  }
}

async function publishedReleaseState(
  tag: string,
): Promise<{ versions: string[]; indexStatus: number }> {
  const base = PAGES_SITE_URL.replace(/\/$/, "");
  const manifestUrl = `${base}/${VERSIONS_MANIFEST}?ts=${Date.now()}`;
  const indexUrl = `${base}/${encodeURIComponent(tag)}/index.html?ts=${Date.now()}`;
  const manifestRes = await fetchNoStore(manifestUrl);
  const indexRes = await fetchNoStore(indexUrl);
  if (manifestRes.status !== 200) {
    await manifestRes.body?.cancel();
    await indexRes.body?.cancel();
    throw new ReleaseCreateRefused(
      `Refusing to create ${tag}: ${VERSIONS_MANIFEST} returned HTTP ${manifestRes.status}`,
    );
  }
  let raw: unknown;
  try {
    raw = await manifestRes.json();
  } catch (error) {
    await indexRes.body?.cancel();
    throw new ReleaseCreateRefused(
      `Refusing to create ${tag}: versions.json is not JSON (${error instanceof Error ? error.message : error})`,
    );
  }
  await indexRes.body?.cancel();
  return {
    versions: publishedVersionsFromManifest(raw),
    indexStatus: indexRes.status,
  };
}

function applyActionsGitIdentity(): void {
  const identity = actionsBotIdentity(Deno.env.toObject());
  if (!identity) return;
  for (const [key, value] of Object.entries(identity)) Deno.env.set(key, value);
}

async function main(): Promise<void> {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const plan = planReleaseCreate(requestFromInputs(Deno.args, Deno.env.toObject()));
  const branch = await currentBranch();
  if (branch !== plan.ref) {
    throw new ReleaseCreateRefused(
      `Refusing to create ${plan.tag}: checked-out branch is ${branch}, expected ${plan.ref}. Release create commits the version bump onto that branch.`,
    );
  }

  const [tagList, pages] = await Promise.all([
    remoteTagList(plan.tag),
    publishedReleaseState(plan.tag),
  ]);
  assertReleaseCreateAllowed({
    tag: plan.tag,
    remoteTagList: tagList,
    publishedVersions: pages.versions,
    pagesIndexStatus: pages.indexStatus,
  });

  console.log(`Release ${plan.version} → tag ${plan.tag} on ${plan.ref}`);
  console.log(`Checked origin and ${PAGES_SITE_URL}/${VERSIONS_MANIFEST} plus /${plan.tag}/index.html.`);

  if (plan.dryRun) {
    if (plan.updateRecommended) console.log(`Would set RECOMMENDED_VERSION to ${plan.tag}`);
    console.log(
      `Dry run: would commit "${plan.commitMessage}" and push annotated tag ${plan.tag}. No commit, tag, or push performed.`,
    );
    return;
  }

  if (plan.updateRecommended) console.log(`Setting RECOMMENDED_VERSION to ${plan.tag}`);

  await assertCleanGitTree();
  applyActionsGitIdentity();
  await bumpVersionFiles(plan.version);
  const changelogChanged = await promoteUnreleasedFile(plan.version);
  if (changelogChanged) console.log(`Moved CHANGELOG Unreleased notes under ${plan.version}`);
  if (plan.updateRecommended) {
    await Deno.writeTextFile(join(root, "RECOMMENDED_VERSION"), recommendedVersionFileText(plan.tag));
  }

  const commitFiles = releaseCommitFiles({
    versionBump: true,
    changelogChanged,
    updateRecommended: plan.updateRecommended,
  });
  await run("git", ["add", "--", ...commitFiles]);
  const staged = await captureGit(["diff", "--cached", "--name-only"]);
  if (staged.code !== 0) {
    throw new ReleaseCreateRefused(
      `Refusing to create ${plan.tag}: could not inspect the staged release commit (${staged.stderr.trim()})`,
    );
  }
  const stagedNames = staged.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  let committed = false;
  if (stagedNames.length > 0) {
    console.log(`Committing ${stagedNames.join(", ")}`);
    await run("git", ["commit", "-m", plan.commitMessage]);
    committed = true;
  } else {
    console.log("Version files already match this release; tagging the current commit.");
  }

  const localTag = await captureGit(["show-ref", "--verify", "--quiet", `refs/tags/${plan.tag}`]);
  if (localTag.code === 0) {
    throw new ReleaseCreateRefused(`Refusing to create ${plan.tag}: the tag already exists locally`);
  }
  if (localTag.code !== 1) {
    throw new ReleaseCreateRefused(
      `Refusing to create ${plan.tag}: could not check local tags (${localTag.stderr.trim() || `exit ${localTag.code}`})`,
    );
  }

  await run("git", ["tag", "-a", plan.tag, "-m", plan.tagMessage]);
  await run("git", releasePushArgs(plan.ref, plan.tag, committed));
  console.log(`Pushed ${plan.tag}. release.yml publishes Pages, desktop binaries, the VSIX, and the GitHub Release.`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!(error instanceof ReleaseCreateRefused) && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    Deno.exit(1);
  }
}
