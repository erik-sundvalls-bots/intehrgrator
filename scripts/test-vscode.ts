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
// Use the same CLI entry point as code.cmd/bin/code: --wait follows the test
// window, rather than waiting for VS Code's background broker to terminate.
const executableDirectory = dirname(executable);
const cliCandidates = [
  join(executableDirectory, "resources", "app", "out", "cli.js"),
  join(executableDirectory, "..", "Resources", "app", "out", "cli.js"),
];
for await (const entry of Deno.readDir(executableDirectory)) {
  if (entry.isDirectory) {
    cliCandidates.push(
      join(
        executableDirectory,
        entry.name,
        "resources",
        "app",
        "out",
        "cli.js",
      ),
    );
  }
}
const cli = cliCandidates.find((path) => {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
});
if (!cli) {
  throw new Error("Could not find VS Code's CLI beside VSCODE_EXECUTABLE");
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
// Install the built extension into an isolated profile and use a normal window,
// so native document backups exercise the same path as an installed VSIX.
const installedExtension = join(
  profile,
  "extensions",
  "regionstockholm.intehrgrator",
);
await ensureDir(installedExtension);
await copy(
  join(root, "package.json"),
  join(installedExtension, "package.json"),
);
await copy(join(root, "dist"), join(installedExtension, "dist"));
const driver = join(profile, "extensions", "intehrgrator-test-driver");
await ensureDir(driver);
const profileSettings = JSON.stringify({
  "files.hotExit": "onExit",
  "files.autoSave": "off",
  "window.restoreWindows": "all",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
});
for (
  const directory of [
    join(profile, "profile", "User"),
    join(profile, "portable", "user-data", "User"),
  ]
) {
  await ensureDir(directory);
  await Deno.writeTextFile(join(directory, "settings.json"), profileSettings);
}
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
  finally {
    if (process.env.INTEHRGRATOR_TEST_PHASE !== 'initial') await vscode.workspace.saveAll(false);
    await vscode.commands.executeCommand('workbench.action.quit');
  }
};
`,
);
for (const phase of ["initial", "restored"]) {
  try {
    await Deno.remove(join(project, "test-result.json"));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const child = new Deno.Command(executable, {
    args: [
      cli,
      "--wait",
      "--new-window",
      "--user-data-dir",
      join(profile, "profile"),
      "--extensions-dir",
      join(profile, "extensions"),
      "--disable-gpu",
      "--disable-workspace-trust",
      "--skip-welcome",
      project,
    ],
    env: {
      ...Deno.env.toObject(),
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_DEV: "",
      VSCODE_PORTABLE: join(profile, "portable"),
      INTEHRGRATOR_TEST_PROJECT: project,
      INTEHRGRATOR_TEST_PHASE: phase,
      INTEHRGRATOR_TEST_SUITE: join(
        root,
        "test/vscode/file_project_smoke.cjs",
      ),
    },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const { code } = await child.status;
  const report = JSON.parse(
    await Deno.readTextFile(join(project, "test-result.json")),
  );
  console.log(JSON.stringify({ phase, ...report }, null, 2));
  if (code || !report.ok) Deno.exit(1);
}
