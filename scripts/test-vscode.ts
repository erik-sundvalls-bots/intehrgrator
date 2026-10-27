import { spawn } from "node:child_process";
import { copy, ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";

const root = dirname(dirname(fromFileUrl(import.meta.url)));
const executable = Deno.env.get("VSCODE_EXECUTABLE");
if (!executable) {
  console.error(
    "Set VSCODE_EXECUTABLE to a VS Code executable (Code.exe on Windows).",
  );
  Deno.exit(2);
}
await ensureDir(join(root, ".local"));
const project = await Deno.makeTempDir({
  dir: join(root, ".local"),
  prefix: "vscode-file-project-",
});
await copy(join(root, "examples/file-project"), project, { overwrite: true });
await Deno.remove(join(project, "output/examples/person-01.json"));
const profile = await Deno.makeTempDir({
  dir: join(root, ".local"),
  prefix: "vscode-profile-",
});
const code = await new Promise<number>((resolve, reject) => {
  const process = spawn(executable, [
    "--user-data-dir",
    join(profile, "profile"),
    "--extensions-dir",
    join(profile, "extensions"),
    "--extensionDevelopmentPath",
    root,
    "--extensionTestsPath",
    join(root, "test/vscode/file_project_smoke.cjs"),
    "--disable-gpu",
    "--disable-workspace-trust",
    "--skip-welcome",
    project,
  ], {
    env: { ...Deno.env.toObject(), INTEHRGRATOR_TEST_PROJECT: project },
    stdio: "inherit",
    windowsHide: true,
  });
  process.on("error", reject);
  process.on("exit", (code) => resolve(code ?? 1));
});
const report = JSON.parse(
  await Deno.readTextFile(join(project, "test-result.json")),
);
console.log(JSON.stringify(report, null, 2));
if (code || !report.ok) Deno.exit(1);
