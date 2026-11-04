#!/usr/bin/env -S deno run -A
/**
 * Build (unless --no-build) and package the VS Code extension as a VSIX.
 *
 * Output matches desktop release assets under dist/release/:
 *   dist/release/intEHRgrator.vsix
 *
 * Usage:
 *   deno task extension:package
 *   deno run -A scripts/package-extension.ts --no-build   # after deno task build
 */
import { ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");

/** Stable release asset name (version comes from the GitHub Release tag). */
export const VSIX_RELEASE_PATH = join("dist", "release", "intEHRgrator.vsix");

function usage(): void {
  console.log(`Usage:
  deno task extension:package
  deno run -A scripts/package-extension.ts [--no-build]

Options:
  --no-build   Skip deno task build (use when dist/ is already fresh)
`);
}

async function run(
  cmd: string,
  args: string[],
): Promise<void> {
  const result = await new Deno.Command(cmd, {
    args,
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    Deno.exit(result.code === 0 ? 1 : result.code);
  }
}

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    usage();
    Deno.exit(0);
  }
  const noBuild = Deno.args.includes("--no-build");
  if (!noBuild) {
    await run("deno", ["task", "build"]);
  }
  await ensureDir(join(root, "dist", "release"));
  const out = join(root, VSIX_RELEASE_PATH);
  await run("deno", [
    "run",
    "-A",
    "--no-lock",
    "npm:@vscode/vsce@4.0.0",
    "package",
    "--no-dependencies",
    "--out",
    out,
  ]);
  console.log(`Wrote ${VSIX_RELEASE_PATH}`);
}
