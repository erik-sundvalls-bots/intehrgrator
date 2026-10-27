import { dirname, join, resolve } from "@std/path";
import { walk } from "@std/fs";
import {
  generateProjectArtifacts,
  loadFileProject,
  updateFileProject,
} from "../src/workbench/file_project.ts";

const args = Deno.args.filter((arg) => arg !== "--check");
if (args.length !== 1) {
  console.error(
    "Usage: deno task project:run <path/to/intehrgrator.json> [--check]",
  );
  Deno.exit(2);
}
const manifestPath = resolve(args[0]);
const root = dirname(manifestPath);
const files = {
  readText: (path: string) => Deno.readTextFile(join(root, path)),
  listExamples: async (directory: string) => {
    const paths: string[] = [];
    const base = join(root, directory);
    for await (
      const entry of walk(base, { includeDirs: false, followSymlinks: false })
    ) {
      if (/\.(json|xml)$/i.test(entry.name)) {
        paths.push(entry.path.slice(base.length + 1).replaceAll("\\", "/"));
      }
    }
    return paths.sort();
  },
  writeText: async (path: string, text: string) => {
    const file = join(root, path);
    await Deno.mkdir(dirname(file), { recursive: true });
    let current: string | undefined;
    try {
      current = await Deno.readTextFile(file);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (current !== text) await Deno.writeTextFile(file, text);
  },
  remove: async (path: string) => {
    try {
      await Deno.remove(join(root, path));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  },
};
const manifest = await Deno.readTextFile(manifestPath);
if (Deno.args.includes("--check")) {
  const project = await loadFileProject(manifest, files);
  const changed: string[] = [];
  for (const artifact of generateProjectArtifacts(project)) {
    let current: string | undefined;
    try {
      current = await files.readText(artifact.path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (current?.replace(/\r\n/g, "\n") !== artifact.content) {
      changed.push(artifact.path);
    }
  }
  if (changed.length) {
    console.error(`Generated output is out of date:\n${changed.join("\n")}`);
    Deno.exit(1);
  }
  console.log("Generated code and example results match the saved mapping.");
} else {
  const artifacts = await updateFileProject(manifest, files);
  console.log(`Updated ${artifacts.length} code, result and status files.`);
}
