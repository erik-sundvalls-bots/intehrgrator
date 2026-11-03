/**
 * Shared release version helpers for desktop tags and GitHub Pages paths.
 */
import { dirname, fromFileUrl, join } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");

export const VERSION_FILES = [
  join(root, "deno.json"),
  join(root, "package.json"),
  join(root, "scripts/desktop.compile.json"),
  join(root, "src/core/persistence/mod.ts"),
] as const;

/** Map package version to release tag (matches existing tags v0.5, v0.2.1). */
export function releaseTagForVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === "" || !/^\d+$/.test(p))) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  const [major, minor, patch = "0"] = parts;
  if (patch === "0") return `v${major}.${minor}`;
  return `v${major}.${minor}.${patch}`;
}

/** Tag-pinned CHANGELOG.md link used in the tag message and the GitHub Release body. */
export function changelogUrlForTag(tag: string): string {
  return `https://github.com/regionstockholm/intehrgrator/blob/${tag}/CHANGELOG.md`;
}

/** Annotated tag message: the given (or default) title plus the changelog link. */
export function releaseTagMessage(version: string, tag: string, message?: string): string {
  return `${message ?? `intEHRgrator desktop ${version}`}\n\nChangelog: ${changelogUrlForTag(tag)}`;
}

const CHANGELOG_REPO = "https://github.com/regionstockholm/intehrgrator";

/** Compare link for the empty Unreleased section after a release. */
export function unreleasedCompareUrl(tag: string): string {
  return `${CHANGELOG_REPO}/compare/${tag}...main`;
}

/** Footer link for a released version heading. */
export function changelogReleaseUrl(tag: string): string {
  return `${CHANGELOG_REPO}/releases/tag/${tag}`;
}

/** Local calendar date `YYYY-MM-DD` (the machine running the release). */
export function localIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Move **Unreleased** notes under `## [version]`.
 * An empty Unreleased section leaves the file unchanged.
 * An existing version heading receives the bullets; it is not duplicated.
 */
export function promoteUnreleasedChangelog(
  markdown: string,
  version: string,
  isoDate: string,
): { text: string; changed: boolean } {
  const lines = markdown.split("\n");
  const headingIdx = lines.findIndex((line) => /^## \[Unreleased\b/.test(line));
  if (headingIdx < 0) return { text: markdown, changed: false };

  let end = headingIdx + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^## /.test(line) || /^\[Unreleased\]:/.test(line)) break;
    end++;
  }
  const notes = lines.slice(headingIdx + 1, end).join("\n").trim();
  if (!notes) return { text: markdown, changed: false };

  const head = lines.slice(0, headingIdx + 1);
  const rest = lines.slice(end);
  const headingRe = new RegExp(`^## \\[${escapeRegExp(version)}\\b`);
  const existingIdx = rest.findIndex((line) => headingRe.test(line));
  const tail = existingIdx >= 0 ? rest.slice(existingIdx + 1) : rest;
  while (tail.length > 0 && tail[0].trim() === "") tail.shift();

  const promoted = existingIdx >= 0
    ? [rest[existingIdx], "", notes, "", ...tail]
    : ["", `## [${version}] - ${isoDate}`, "", notes, "", ...tail];
  if (promoted[0]?.trim() !== "") promoted.unshift("");

  let text = [...head, ...promoted].join("\n");
  if (markdown.endsWith("\n") && !text.endsWith("\n")) text += "\n";

  const tag = releaseTagForVersion(version);
  const unreleasedLine = `[Unreleased]: ${unreleasedCompareUrl(tag)}`;
  if (/^\[Unreleased\]:/m.test(text)) {
    text = text.replace(/^\[Unreleased\]:.*$/m, unreleasedLine);
  } else {
    text = `${text.trimEnd()}\n\n${unreleasedLine}\n`;
  }
  const versionLink = `[${version}]: ${changelogReleaseUrl(tag)}`;
  if (!new RegExp(`^\\[${escapeRegExp(version)}\\]:`, "m").test(text)) {
    text = text.replace(/^\[Unreleased\]:.*$/m, (line) => `${line}\n${versionLink}`);
  }
  return { text, changed: true };
}

/** Write CHANGELOG.md when Unreleased has notes. Returns whether the file changed. */
export async function promoteUnreleasedFile(version: string, isoDate = localIsoDate()): Promise<boolean> {
  const path = join(root, "CHANGELOG.md");
  const current = await Deno.readTextFile(path);
  const next = promoteUnreleasedChangelog(current, version, isoDate);
  if (!next.changed) return false;
  await Deno.writeTextFile(path, next.text);
  return true;
}

export function readVersionFromDenoJson(text: string): string {
  const parsed = JSON.parse(text) as { version?: string };
  if (!parsed.version) throw new Error("deno.json is missing version");
  return parsed.version;
}

export async function readCurrentVersion(): Promise<string> {
  const denoJson = await Deno.readTextFile(join(root, "deno.json"));
  return readVersionFromDenoJson(denoJson);
}

export async function bumpVersionFiles(version: string): Promise<void> {
  for (const path of VERSION_FILES) {
    let text = await Deno.readTextFile(path);
    if (path.endsWith("mod.ts")) {
      text = text.replace(/export const APP_VERSION = "[^"]+";/, `export const APP_VERSION = "${version}";`);
    } else {
      text = text.replace(/"version": "[^"]+"/, `"version": "${version}"`);
    }
    await Deno.writeTextFile(path, text);
  }
}

async function run(cmd: string, args: string[]): Promise<void> {
  const status = await new Deno.Command(cmd, {
    args,
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!status.success) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${status.code})`);
  }
}

export async function assertReleasePrerequisites(): Promise<void> {
  for (const cmd of ["git", "gh"]) {
    const status = await new Deno.Command(cmd, { args: ["--version"], stdout: "null", stderr: "null" }).output();
    if (!status.success) throw new Error(`${cmd} is required for deno task release`);
  }
}

export async function assertCleanGitTree(): Promise<void> {
  const status = await new Deno.Command("git", {
    args: ["status", "--porcelain"],
    cwd: root,
    stdout: "piped",
  }).output();
  const dirty = new TextDecoder().decode(status.stdout).trim();
  if (dirty) {
    throw new Error("Working tree is not clean — commit or stash changes before releasing");
  }
}

export async function assertGhAuth(): Promise<void> {
  const status = await new Deno.Command("gh", {
    args: ["auth", "status"],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!status.success) throw new Error("gh is not authenticated");
}

export { run };
