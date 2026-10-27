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
// --extensionTestsPath deliberately makes VS Code storage in-memory. A normal
// isolated window plus a driver extension exercises real cold-start persistence.
const driver = join(profile, "extensions", "intehrgrator-test-driver");
await ensureDir(driver);
await Deno.writeTextFile(
  join(driver, "package.json"),
  JSON.stringify({
    name: "intehrgrator-test-driver",
    publisher: "intehrgrator-tests",
    version: "1.0.0",
    engines: { vscode: "^1.85.0" },
    activationEvents: ["onStartupFinished"],
    main: "./driver.cjs",
  }),
);
await Deno.writeTextFile(
  join(driver, "driver.cjs"),
  `
const vscode = require('vscode');
exports.activate = async () => {
  try { await require(process.env.INTEHRGRATOR_TEST_SUITE).run(); }
  catch (error) { console.error(error); }
  finally { await vscode.workspace.saveAll(false); await vscode.commands.executeCommand('workbench.action.quit'); }
};
`,
);
for (const phase of ["initial", "restored"]) {
  try { await Deno.remove(join(project, "test-result.json")); } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [
      "--user-data-dir",
      join(profile, "profile"),
      "--extensions-dir",
      join(profile, "extensions"),
      "--extensionDevelopmentPath",
      root,
      "--disable-gpu",
      "--disable-workspace-trust",
      "--skip-welcome",
      project,
    ], {
      env: {
        ...Deno.env.toObject(),
        INTEHRGRATOR_TEST_PROJECT: project,
        INTEHRGRATOR_TEST_PHASE: phase,
        INTEHRGRATOR_TEST_SUITE: join(
          root,
          "test/vscode/file_project_smoke.cjs",
        ),
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const report = JSON.parse(
    await Deno.readTextFile(join(project, "test-result.json")),
  );
  console.log(JSON.stringify({ phase, ...report }, null, 2));
  if (code || !report.ok) Deno.exit(1);
}
