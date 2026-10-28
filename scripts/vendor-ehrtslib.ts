import { ensureDir } from "@std/fs";
import { join } from "@std/path";

type VendorSpec = {
  dir: string;
  url: string;
};

const repos: VendorSpec[] = [
  {
    dir: "openEHR-model-examples",
    url: "https://github.com/Ehrlibs/openEHR-model-examples.git",
  },
];

await ensureDir(join(Deno.cwd(), "vendor"));

let failed = false;
for (const spec of repos) {
  try {
    await vendorRepo(spec);
  } catch (err) {
    failed = true;
    console.error(err instanceof Error ? err.message : String(err));
  }
}
if (failed) Deno.exit(1);

const staleEhrtslib = join(Deno.cwd(), "vendor", "ehrtslib");
try {
  await Deno.remove(staleEhrtslib, { recursive: true });
  console.log(`Removed full-repo checkout ${staleEhrtslib}`);
} catch {
  // no previous clone
}

async function vendorRepo(spec: VendorSpec): Promise<void> {
  const { dir, url } = spec;
  const vendorDir = join(Deno.cwd(), "vendor", dir);
  const hasGit = await exists(join(vendorDir, ".git"));

  if (!hasGit) {
    try {
      await Deno.remove(vendorDir, { recursive: true });
    } catch {
      // nothing to replace
    }
    console.log(`Cloning ${dir} into ${vendorDir}…`);
    await runGit(["clone", "--depth", "1", url, vendorDir]);
  } else {
    // Always reset to origin/main so a previous pin or local drift cannot hide
    // upstream breaks from CI.
    console.log(`Updating ${dir} to origin/main…`);
    await runGit(["-C", vendorDir, "fetch", "--depth", "1", "origin", "main"]);
    await runGit(["-C", vendorDir, "checkout", "-B", "main", "origin/main"]);
    await runGit(["-C", vendorDir, "reset", "--hard", "origin/main"]);
  }

  const sha = await revParse(vendorDir);
  console.log(`${dir} at ${sha} (origin/main)`);
}

async function revParse(cwd: string): Promise<string> {
  const { success, stdout } = await new Deno.Command("git", {
    args: ["-C", cwd, "rev-parse", "--short=7", "HEAD"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!success) return "unknown";
  return new TextDecoder().decode(stdout).trim() || "unknown";
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args: string[]): Promise<void> {
  const status = await new Deno.Command("git", {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(`git ${args.join(" ")} failed (${status.code})`);
  }
}
