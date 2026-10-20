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
