/**
 * Assemble GitHub Pages deploy trees with immutable version subdirectories.
 */
import { copy, ensureDir, emptyDir, walk } from "@std/fs";
import { dirname, join } from "@std/path";

export const PAGES_SITE_URL = "https://regionstockholm.github.io/intehrgrator";
export const VERSIONS_MANIFEST = "versions.json";
/**
 * Every Pages tree lists its files here. Later main deploys re-download frozen
 * version directories from the live site; recursive wget only follows links in
 * HTML, so unlinked catalogs (`examples/`, `function-library/`, `test/fixtures/`)
 * would otherwise disappear from `/vX.Y/`.
 */
export const PAGES_FILE_LIST = "pages-files.txt";
export const RECOMMENDED_ALIAS_DIR = "recommended";

export interface VersionsManifest {
  versions: string[];
  /**
   * Tag (e.g. "v0.7.5") the web app recommends end users stick to, distinct from the
   * bleeding-edge build at the site root. Runtime code in `web/main.ts` reads this to
   * decide whether to show the "not on the recommended version" popup. See
   * `pickRecommendedVersion` for how it is derived on each Pages deploy.
   */
  recommended?: string;
}

export function emptyManifest(): VersionsManifest {
  return { versions: [] };
}

/**
 * Pick the manifest's recommended tag for a new deploy.
 *
 * Precedence: an explicit `override` (e.g. a repo-committed `RECOMMENDED_VERSION` file)
 * wins when it names a still-published version; otherwise the previously recommended tag
 * is kept as long as it is still published; otherwise the newest published tag becomes
 * recommended by default. Returns `undefined` when there are no versions to recommend.
 */
export function pickRecommendedVersion(
  versions: string[],
  opts: { override?: string; previous?: string } = {},
): string | undefined {
  if (opts.override && versions.includes(opts.override)) return opts.override;
  if (opts.previous && versions.includes(opts.previous)) return opts.previous;
  return versions[0];
}

/** Compare `vX.Y(.Z)` tags numerically, newest first (`v0.10` before `v0.9.2`; `v0.9` equals `v0.9.0`). */
export function compareVersionTagsNewestFirst(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function normalizeManifest(raw: unknown): VersionsManifest {
  if (!raw || typeof raw !== "object") return emptyManifest();
  const versions = (raw as VersionsManifest).versions;
  if (!Array.isArray(versions)) return emptyManifest();
  const normalizedVersions = [
    ...new Set(versions.filter((v): v is string => typeof v === "string" && VERSION_TAG_REGEX.test(v))),
  ].sort(compareVersionTagsNewestFirst);
  const rawRecommended = (raw as VersionsManifest).recommended;
  const recommended = typeof rawRecommended === "string" && normalizedVersions.includes(rawRecommended)
    ? rawRecommended
    : undefined;
  return recommended ? { versions: normalizedVersions, recommended } : { versions: normalizedVersions };
}

export async function readVersionsManifest(path: string): Promise<VersionsManifest> {
  try {
    const text = await Deno.readTextFile(path);
    return normalizeManifest(JSON.parse(text));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return emptyManifest();
    throw error;
  }
}

export async function writeVersionsManifest(path: string, manifest: VersionsManifest): Promise<void> {
  const normalized = normalizeManifest(manifest);
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
}

export async function fetchVersionsManifest(baseUrl: string): Promise<VersionsManifest> {
  try {
    const res = await fetch(`${baseUrl}/${VERSIONS_MANIFEST}`);
    if (!res.ok) return emptyManifest();
    return normalizeManifest(await res.json());
  } catch {
    return emptyManifest();
  }
}

/** Path segments under the host in `baseUrl` (e.g. intehrgrator → 1). */
export function pagesRepoPathDepth(baseUrl: string): number {
  const path = new URL(baseUrl).pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return 0;
  return path.split("/").filter(Boolean).length;
}

async function runWget(args: string[]): Promise<void> {
  const status = await new Deno.Command("wget", {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  // 8 = some files missing on partial mirrors; acceptable for Pages trees.
  if (!status.success && status.code !== 8) {
    throw new Error(`wget failed (exit ${status.code})`);
  }
}

/** Flatten wget output when it nests under the final URL path segment. */
export async function flattenWgetNest(dest: string, nestedName: string): Promise<void> {
  const nested = join(dest, nestedName);
  try {
    await Deno.stat(nested);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  for await (const entry of walk(nested, { includeDirs: false })) {
    const rel = entry.path.slice(nested.length + 1);
    const target = join(dest, rel);
    await ensureDir(dirname(target));
    await Deno.rename(entry.path, target);
  }
  await Deno.remove(nested, { recursive: true });
}

export async function versionHasIndex(root: string, tag: string): Promise<boolean> {
  try {
    const st = await Deno.stat(join(root, tag, "index.html"));
    return st.isFile;
  } catch {
    return false;
  }
}

/** Mirror the live Pages site (root + frozen versions) into dest. */
export async function mirrorLiveSite(baseUrl: string, dest: string): Promise<void> {
  await emptyDir(dest);
  await ensureDir(dest);
  const cut = pagesRepoPathDepth(baseUrl);
  const args = ["-q", "-r", "-np", "-nH"];
  if (cut > 0) args.push(`--cut-dirs=${cut}`);
  args.push("-P", dest, `${baseUrl}/`);
  await runWget(args);
  // Older mirrors / alternate wget layouts may still nest under the repo segment.
  const repoSeg = new URL(baseUrl).pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).pop();
  if (repoSeg) await flattenWgetNest(dest, repoSeg);
}

/**
 * Mirror a single frozen version subdirectory from the live Pages site.
 * Fails if `index.html` is missing so we never publish empty `/vX.Y/` dirs.
 */
export async function mirrorVersionSubdir(
  baseUrl: string,
  tag: string,
  destRoot: string,
): Promise<void> {
  const dest = join(destRoot, tag);
  await emptyDir(dest);
  await ensureDir(dest);
  const listUrl = `${baseUrl.replace(/\/$/, "")}/${tag}/${PAGES_FILE_LIST}`;
  try {
    const listed = await fetch(listUrl);
    if (listed.ok) {
      const listText = await listed.text();
      if (listText.includes("index.html")) {
        await mirrorFromFileList(baseUrl, tag, dest, listText);
        if (!(await versionHasIndex(destRoot, tag))) {
          throw new Error(
            `Failed to mirror frozen Pages version /${tag}/ — index.html missing after file list`,
          );
        }
        return;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Failed to mirror")) throw error;
    if (error instanceof Error && error.message.startsWith("Refusing unsafe")) throw error;
    console.warn(
      `File list for ${tag} unavailable, falling back to wget: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  // Legacy trees have no file list. wget -r only follows HTML links.
  const cut = pagesRepoPathDepth(baseUrl) + 1;
  const args = ["-q", "-r", "-np", "-nH", `--cut-dirs=${cut}`, "-P", dest, `${baseUrl}/${tag}/`];
  await runWget(args);
  // Belt-and-suspenders for layouts that still nest.
  const repoSeg = new URL(baseUrl).pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).pop();
  if (repoSeg) await flattenWgetNest(dest, repoSeg);
  await flattenWgetNest(dest, tag);

  if (!(await versionHasIndex(destRoot, tag))) {
    throw new Error(
      `Failed to mirror frozen Pages version /${tag}/ — index.html missing after wget`,
    );
  }
}

async function copyDistContents(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  await copy(src, dest, { overwrite: true });
  await writePagesFileList(dest);
}

export const VERSION_TAG_REGEX = /^v\d+(\.\d+)*$/;

/**
 * Generate client-side redirect HTML that sends users from `/recommended/` to the
 * pinned `/vX.Y(.Z)/` recommended release (or site root when no recommendation exists).
 */
export function generateRecommendedRedirectHtml(recommendedTag?: string): string {
  if (recommendedTag !== undefined && !VERSION_TAG_REGEX.test(recommendedTag)) {
    throw new Error(`Invalid version tag for redirect: ${recommendedTag}`);
  }
  const target = recommendedTag ? `../${recommendedTag}/` : "../";
  const label = recommendedTag ?? "latest";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Redirecting to recommended version...</title>
  <meta http-equiv="refresh" content="0; url=${target}">
  <link rel="canonical" href="${target}">
  <script>
    window.location.replace("${target}" + window.location.search + window.location.hash);
  </script>
</head>
<body>
  <p>Redirecting to recommended version: <a href="${target}">${label}</a></p>
</body>
</html>
`;
}

/**
 * Write `/recommended/index.html` into the Pages output directory to alias the current
 * recommended release tag.
 */
export async function writeRecommendedRedirect(
  outDir: string,
  recommendedTag?: string,
): Promise<void> {
  const targetDir = join(outDir, RECOMMENDED_ALIAS_DIR);
  await ensureDir(targetDir);
  await Deno.writeTextFile(
    join(targetDir, "index.html"),
    generateRecommendedRedirectHtml(recommendedTag),
  );
}

/** Relative paths, one per line, of every file currently in a Pages tree. */
export async function writePagesFileList(root: string): Promise<void> {
  const files: string[] = [];
  for await (const entry of walk(root, { includeDirs: false })) {
    let rel = entry.path.slice(root.length);
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
    rel = rel.replaceAll("\\", "/");
    if (!rel || rel === PAGES_FILE_LIST) continue;
    files.push(rel);
  }
  files.sort();
  await Deno.writeTextFile(join(root, PAGES_FILE_LIST), `${files.join("\n")}\n`);
}

function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return false;
  return rel.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

async function mirrorFromFileList(
  baseUrl: string,
  tag: string,
  dest: string,
  listText: string,
): Promise<void> {
  const paths = listText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const rel of paths) {
    if (!isSafeRelativePath(rel)) {
      throw new Error(`Refusing unsafe pages file path in ${tag}: ${rel}`);
    }
  }
  const base = `${baseUrl.replace(/\/$/, "")}/${tag}/`;
  await Deno.writeTextFile(
    join(dest, PAGES_FILE_LIST),
    listText.endsWith("\n") ? listText : `${listText}\n`,
  );
  let cursor = 0;
  const workerCount = Math.min(16, paths.length);
  const failures: string[] = [];
  async function worker(): Promise<void> {
    while (cursor < paths.length) {
      const rel = paths[cursor++];
      const target = join(dest, ...rel.split("/"));
      try {
        const res = await fetch(new URL(rel, base).href);
        if (!res.ok) {
          failures.push(`${rel} (${res.status})`);
          continue;
        }
        await ensureDir(dirname(target));
        await Deno.writeFile(target, new Uint8Array(await res.arrayBuffer()));
      } catch (error) {
        failures.push(`${rel} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failures.length) {
    throw new Error(`Failed to mirror ${tag}: ${failures.slice(0, 5).join("; ")}`);
  }
}

/**
 * Main-branch deploy: publish bleeding-edge root and keep frozen version subdirs.
 * Versions that cannot be mirrored are dropped from the manifest (never publish empty dirs).
 */
export async function assembleMainPagesSite(opts: {
  baseUrl: string;
  rootDist: string;
  outDir: string;
  recommendedOverride?: string;
}): Promise<VersionsManifest> {
  await emptyDir(opts.outDir);
  await copyDistContents(opts.rootDist, opts.outDir);

  const listed = await fetchVersionsManifest(opts.baseUrl);
  const preserved: string[] = [];
  for (const tag of listed.versions) {
    try {
      await mirrorVersionSubdir(opts.baseUrl, tag, opts.outDir);
      preserved.push(tag);
    } catch (error) {
      console.warn(
        `Dropping frozen Pages version ${tag}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        await Deno.remove(join(opts.outDir, tag), { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  const manifest = normalizeManifest({
    versions: preserved,
    recommended: pickRecommendedVersion(preserved, {
      override: opts.recommendedOverride,
      previous: listed.recommended,
    }),
  });
  await writeVersionsManifest(join(opts.outDir, VERSIONS_MANIFEST), manifest);
  await writeRecommendedRedirect(opts.outDir, manifest.recommended);
  return manifest;
}

/**
 * Release deploy: publish the new dist as the bleeding-edge root and add an immutable
 * version subdirectory. `pages.yml` skips `chore: release` commits, so this is the deploy
 * that must refresh the site root.
 */
export async function assembleReleasePagesSite(opts: {
  baseUrl: string;
  versionTag: string;
  versionDist: string;
  outDir: string;
  recommendedOverride?: string;
}): Promise<VersionsManifest> {
  const listed = await fetchVersionsManifest(opts.baseUrl);
  if (listed.versions.includes(opts.versionTag)) {
    throw new Error(
      `GitHub Pages version ${opts.versionTag} already exists — release web builds are immutable`,
    );
  }

  await emptyDir(opts.outDir);
  await copyDistContents(opts.versionDist, opts.outDir);

  // Keep only frozen versions that actually mirrored with an index.html.
  const preserved: string[] = [];
  for (const tag of listed.versions) {
    try {
      await mirrorVersionSubdir(opts.baseUrl, tag, opts.outDir);
      preserved.push(tag);
    } catch (error) {
      console.warn(
        `Not preserving missing frozen Pages version ${tag}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        await Deno.remove(join(opts.outDir, tag), { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  if (await versionHasIndex(opts.outDir, opts.versionTag)) {
    throw new Error(
      `GitHub Pages path /${opts.versionTag}/ already exists — release web builds are immutable`,
    );
  }

  await copyDistContents(opts.versionDist, join(opts.outDir, opts.versionTag));
  if (!(await versionHasIndex(opts.outDir, opts.versionTag))) {
    throw new Error(`Release dist for ${opts.versionTag} is missing index.html`);
  }

  const nextVersions = normalizeManifest({ versions: [...preserved, opts.versionTag] }).versions;
  const next = normalizeManifest({
    versions: nextVersions,
    recommended: pickRecommendedVersion(nextVersions, {
      override: opts.recommendedOverride,
      previous: listed.recommended,
    }),
  });
  await writeVersionsManifest(join(opts.outDir, VERSIONS_MANIFEST), next);
  await writeRecommendedRedirect(opts.outDir, next.recommended);
  return next;
}
