/**
 * Copy the built workbench into src/desktop/www for `deno desktop --include`.
 * Skips sourcemaps and the VS Code extension bundle.
 */
import { copy, emptyDir, ensureDir, walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const dist = join(root, "dist");
const www = join(root, "src", "desktop", "www");

try {
  await Deno.stat(join(dist, "index.html"));
} catch {
  console.log("dist/ missing — running deno task build");
  const status = await new Deno.Command("deno", {
    args: ["task", "build"],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!status.success) Deno.exit(status.code);
}

await emptyDir(www);
await ensureDir(www);

const skip = (rel: string) =>
  rel.endsWith(".map") ||
  rel === "extension.js" ||
  rel.startsWith("extension.js") ||
  rel.startsWith("extension.mjs") ||
  rel.startsWith("release") ||
  rel.startsWith("desktop-www");

for await (const entry of walk(dist, { includeDirs: false })) {
  const rel = relative(dist, entry.path).replaceAll("\\", "/");
  if (skip(rel)) continue;
  // deno desktop --include treats .js as module-graph roots and evaluating the
  // browser bundle at startup leaves the native window hidden on Windows.
  const destRel = rel.endsWith(".js") ? `${rel}.dat` : rel;
  const dest = join(www, destRel);
  await ensureDir(dirname(dest));
  await copy(entry.path, dest, { overwrite: true });
}

console.log(`Staged workbench assets in ${www}`);
