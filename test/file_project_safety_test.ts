import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { copy, ensureDir } from "@std/fs";
import { WorkbenchController } from "../src/workbench/controller.ts";
import { createFsHostAdapter } from "../src/host/fs_adapter.ts";
import {
  loadFileProject,
  parseFileProject,
  projectMetadata,
  updateProjectManifest,
} from "../src/workbench/file_project.ts";
import { assertInsideProject } from "../src/workbench/file_project_paths.ts";

const exampleRoot = join(import.meta.dirname!, "../examples/file-project");
const runner = join(import.meta.dirname!, "../scripts/file-project.ts");

async function exampleOnly() {
  const raw = JSON.parse(
    await Deno.readTextFile(join(exampleRoot, "intehrgrator.json")),
  );
  delete raw.source.schema;
  const files = {
    readText: (path: string) => Deno.readTextFile(join(exampleRoot, path)),
    listExamples: () => Promise.resolve(["person-01.json"]),
  };
  return { raw, files };
}

Deno.test("file project: source language settings survive reopen without a Source Schema", async () => {
  const { raw, files } = await exampleOnly();
  const plain = await loadFileProject(JSON.stringify(raw), files);
  assertEquals(projectMetadata(plain.bundle).source, undefined);

  // The editor reports an explicit source.lang.N order and pane language...
  const chosen = { languages: ["sv", "en"], labelLanguage: "sv" };
  const updated = updateProjectManifest(
    JSON.stringify(raw),
    { ...projectMetadata(plain.bundle), source: chosen },
    projectMetadata(plain.bundle),
  );
  assertEquals(JSON.parse(updated).source.languageSettings, chosen);

  // ...and reopening restores both.
  const reopened = await loadFileProject(updated, files);
  assertEquals(reopened.bundle.settings.sourceLanguages, ["sv", "en"]);
  assertEquals(reopened.bundle.settings.display?.sourceLabelLang, "sv");
  assertEquals(projectMetadata(reopened.bundle).source, chosen);

  // Clearing the choice removes it from the manifest again.
  const cleared = updateProjectManifest(
    updated,
    { ...projectMetadata(reopened.bundle), source: undefined },
    projectMetadata(reopened.bundle),
  );
  assertEquals(JSON.parse(cleared).source.languageSettings, undefined);
});

Deno.test("file project: with a Source Schema, source settings stay on source.schema", async () => {
  const raw = JSON.parse(
    await Deno.readTextFile(join(exampleRoot, "intehrgrator.json")),
  );
  const project = await loadFileProject(JSON.stringify(raw), {
    readText: (path) => Deno.readTextFile(join(exampleRoot, path)),
    listExamples: () => Promise.resolve(["person-01.json"]),
  });
  assertEquals(projectMetadata(project.bundle).source, undefined);
});

Deno.test("file project: generated and mapping paths cannot use .git or other dot-folders", async () => {
  const raw = JSON.parse(
    await Deno.readTextFile(join(exampleRoot, "intehrgrator.json")),
  );
  const variants = [
    { output: { ...raw.output, directory: ".git", script: { ...raw.output.script, path: ".git/conversion.ts" } } },
    { output: { ...raw.output, script: { ...raw.output.script, path: "output/.hidden/conversion.ts" } } },
    { output: { ...raw.output, directory: ".vscode", script: { ...raw.output.script, path: ".vscode/settings.json" } } },
    { mapping: ".git/main.mapping.json" },
    { output: { ...raw.output, directory: "../output", script: { ...raw.output.script, path: "../output/c.ts" } } },
  ];
  for (const variant of variants) {
    assertThrows(() => parseFileProject(JSON.stringify({ ...raw, ...variant })));
  }
  parseFileProject(JSON.stringify(raw));
});

const denoRealPathFs = {
  join,
  realPath: async (path: string) => {
    try {
      return await Deno.realPath(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  isSymlink: async (path: string) => {
    try {
      return (await Deno.lstat(path)).isSymlink;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
};

Deno.test({
  name: "file project: writes are contained by real path, including symlinks",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.makeTempDir({ prefix: "file-project-paths-" });
    try {
      const root = join(base, "project");
      const outside = join(base, "outside");
      await ensureDir(join(root, "output/examples"));
      await ensureDir(outside);
      await assertInsideProject(root, "output/examples/a.json", denoRealPathFs);
      await assertInsideProject(root, "output/new/deeper/a.json", denoRealPathFs);
      await Deno.symlink(outside, join(root, "linked"));
      await assertRejects(
        () => assertInsideProject(root, "linked/a.json", denoRealPathFs),
        Error,
        "outside the project",
      );
      await Deno.symlink(join(outside, "x.json"), join(root, "output/dangling.json"));
      await assertRejects(
        () => assertInsideProject(root, "output/dangling.json", denoRealPathFs),
        Error,
        "broken symlink",
      );
      // A symlink that stays inside the project is fine.
      await Deno.symlink(join(root, "output"), join(root, "alias"));
      await assertInsideProject(root, "alias/examples/a.json", denoRealPathFs);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "file project CLI: a symlinked output folder cannot write outside the project",
  ignore: Deno.build.os === "windows",
  async fn() {
    const tempRoot = join(import.meta.dirname!, "../.local");
    await ensureDir(tempRoot);
    const base = await Deno.makeTempDir({ dir: tempRoot, prefix: "file-project-symlink-" });
    try {
      const root = join(base, "project");
      const outside = join(base, "outside");
      await copy(exampleRoot, root);
      await Deno.remove(join(root, "output"), { recursive: true });
      await ensureDir(outside);
      await Deno.symlink(outside, join(root, "output"));
      const run = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-check", runner, join(root, "intehrgrator.json")],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(run.success, false);
      assert(new TextDecoder().decode(run.stderr).includes("outside the project"));
      assertEquals([...Deno.readDirSync(outside)], []);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test("file project host save state: no autosave, dirty state from the host; other hosts still autosave", async () => {
  const saves: string[] = [];
  const host = createFsHostAdapter();
  host.saveAutosave = () => {
    saves.push("autosave");
    return Promise.resolve();
  };
  const fileProject = new WorkbenchController(host, { autosaveDebounceMs: 1 });
  fileProject.useHostSaveState();
  fileProject.markDirty();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fileProject.flushAutosave();
  assertEquals(saves, []);
  assertEquals(fileProject.getSaveStatus().dirty, false);
  fileProject.setHostDirty(true);
  assertEquals(fileProject.getSaveStatus(), { dirty: true, label: "unsaved changes" });
  fileProject.newProject();

  const web = new WorkbenchController(host, { autosaveDebounceMs: 1 });
  web.markDirty();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(saves, ["autosave"]);
  web.newProject();
});
