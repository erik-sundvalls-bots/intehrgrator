import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { copy, ensureDir } from "@std/fs";
import {
  generateProjectArtifacts,
  loadFileProject,
  parseFileProject,
  projectJson,
  projectMapping,
  updateFileProject,
  writeProjectArtifacts,
} from "../src/workbench/file_project.ts";

const exampleRoot = join(import.meta.dirname!, "../examples/file-project");
async function fixture() {
  const manifest = await Deno.readTextFile(
    join(exampleRoot, "intehrgrator.json"),
  );
  const contents = new Map<string, string>();
  for (
    const path of [
      "mapping/main.mapping.json",
      "targets/person.schema.json",
      "schemas/person.schema.json",
      "source/person-01.json",
    ]
  ) {
    contents.set(path, await Deno.readTextFile(join(exampleRoot, path)));
  }
  return {
    manifest,
    contents,
    files: {
      readText: (path: string) =>
        contents.has(path)
          ? Promise.resolve(contents.get(path)!)
          : Promise.reject(new Error(`Missing ${path}`)),
      listExamples: () =>
        Promise.resolve(
          [...contents.keys()].filter((p) => p.startsWith("source/")).map((p) =>
            p.slice(7)
          ),
        ),
    },
  };
}

Deno.test("file project: saved results show a removed identifier, including while mapping is incomplete", async () => {
  const { manifest, contents, files } = await fixture();
  const project = await loadFileProject(manifest, files);
  const before = generateProjectArtifacts(project);
  const resultPath = "output/examples/person-01.json";
  assertEquals(JSON.parse(before.find((a) => a.path === resultPath)!.content), {
    identifier: "EXAMPLE-12345",
    name: "Example Person",
  });
  const mapping = JSON.parse(contents.get("mapping/main.mapping.json")!);
  const root =
    mapping.blocklyState.blocks.blocks.find((b: { type: string }) =>
      b.type === "conversion_start"
    ).next.block;
  delete root.inputs.TARGET_identifier;
  contents.set("mapping/main.mapping.json", JSON.stringify(mapping));
  const after = generateProjectArtifacts(
    await loadFileProject(manifest, files),
  );
  const changed = JSON.parse(after.find((a) => a.path === resultPath)!.content);
  assertEquals(changed.name, "Example Person");
  assertEquals(changed.identifier, undefined);
  assertStringIncludes(
    after.find((a) => a.path === "output/conversion.ts")!.content,
    "convert",
  );
  assertStringIncludes(
    after.find((a) => a.path === "output/status.json")!.content,
    "identifier",
  );
});

Deno.test("file project: repeat runs and mapping roundtrips preserve results without Git noise", async () => {
  const { manifest, contents, files } = await fixture();
  const first = await loadFileProject(manifest, files);
  const expected = generateProjectArtifacts(first);
  contents.set("mapping/main.mapping.json", projectMapping(first.bundle));
  assertEquals(
    generateProjectArtifacts(await loadFileProject(manifest, files)),
    expected,
  );
  contents.set(
    "source/nested/person-02.json",
    '{"id":"EXAMPLE-2","displayName":"Another Person"}',
  );
  const second = generateProjectArtifacts(
    await loadFileProject(manifest, files),
  );
  assertEquals(
    JSON.parse(
      second.find((a) => a.path === "output/examples/nested/person-02.json")!
        .content,
    ),
    {
      identifier: "EXAMPLE-2",
      name: "Another Person",
    },
  );
});

Deno.test("file project: a conversion failure replaces old output and records the error", async () => {
  const { manifest, contents, files } = await fixture();
  const output = new Map<string, string>();
  const writer = {
    readText: (path: string) =>
      output.has(path)
        ? Promise.resolve(output.get(path)!)
        : Promise.reject(new Error("not found")),
    writeText: (path: string, text: string) => {
      output.set(path, text);
      return Promise.resolve();
    },
    remove: (path: string) => {
      output.delete(path);
      return Promise.resolve();
    },
  };
  await writeProjectArtifacts(await loadFileProject(manifest, files), writer);
  contents.set("source/person-01.json", "not-json");
  await writeProjectArtifacts(await loadFileProject(manifest, files), writer);
  const result = JSON.parse(output.get("output/examples/person-01.json")!);
  assertEquals(result.status, "failed");
  assertEquals(result.identifier, undefined);
  assertStringIncludes(output.get("output/status.json")!, "error");
  contents.delete("source/person-01.json");
  await writeProjectArtifacts(await loadFileProject(manifest, files), writer);
  assertEquals(output.has("output/examples/person-01.json"), false);
});

Deno.test("file project: paths cannot overwrite inputs or leave the project", async () => {
  const { manifest, files } = await fixture();
  const raw = JSON.parse(manifest);
  assertThrows(() =>
    parseFileProject(JSON.stringify({ ...raw, mapping: "../outside.json" }))
  );
  assertThrows(() =>
    parseFileProject(
      JSON.stringify({
        ...raw,
        output: { ...raw.output, directory: "source" },
      }),
    )
  );
  assertThrows(() =>
    parseFileProject(
      JSON.stringify({
        ...raw,
        output: {
          ...raw.output,
          script: { ...raw.output.script, path: raw.mapping },
        },
      }),
    )
  );
  await assertRejects(() =>
    loadFileProject(manifest, {
      ...files,
      readText: () => Promise.reject(new Error("missing input")),
    })
  );
  assertEquals(
    projectJson({ z: 2, a: [2, 1] }),
    '{\n  "a": [\n    2,\n    1\n  ],\n  "z": 2\n}\n',
  );
});

Deno.test("file project: invalid mapping invalidates indexed output instead of retaining the last successful result", async () => {
  const { manifest, contents, files } = await fixture();
  const io = {
    ...files,
    writeText: (path: string, text: string) => {
      contents.set(path, text);
      return Promise.resolve();
    },
    remove: (path: string) => {
      contents.delete(path);
      return Promise.resolve();
    },
  };
  await updateFileProject(manifest, io);
  contents.set("mapping/main.mapping.json", "broken-json");
  await assertRejects(() => updateFileProject(manifest, io));
  assertEquals(contents.has("output/examples/person-01.json"), false);
  assertEquals(
    JSON.parse(contents.get("output/status.json")!).status,
    "failed",
  );
  assertStringIncludes(
    contents.get("output/conversion.ts")!,
    "Generation failed",
  );
});

Deno.test("file project: an interrupted cleanup retains ownership until obsolete results are removed", async () => {
  const { manifest, contents, files } = await fixture();
  contents.set(
    "source/person-02.json",
    '{"id":"SECOND","displayName":"Second"}',
  );
  const output = new Map<string, string>();
  let interrupt = false;
  const writer = {
    readText: (path: string) =>
      output.has(path)
        ? Promise.resolve(output.get(path)!)
        : Promise.reject(new Error("not found")),
    writeText: (path: string, text: string) => {
      output.set(path, text);
      return Promise.resolve();
    },
    remove: (path: string) => {
      if (interrupt) return Promise.reject(new Error("simulated interruption"));
      output.delete(path);
      return Promise.resolve();
    },
  };
  await writeProjectArtifacts(await loadFileProject(manifest, files), writer);
  contents.delete("source/person-02.json");
  const project = await loadFileProject(manifest, files);
  interrupt = true;
  await assertRejects(() => writeProjectArtifacts(project, writer));
  assertStringIncludes(output.get("output/status.json")!, "person-02.json");
  interrupt = false;
  await writeProjectArtifacts(project, writer);
  assertEquals(output.has("output/examples/person-02.json"), false);
});

Deno.test("file project CLI: check accepts Windows line endings, detects real changes and never writes results", async () => {
  const tempRoot = join(import.meta.dirname!, "../.local");
  await ensureDir(tempRoot);
  const directory = await Deno.makeTempDir({
    dir: tempRoot,
    prefix: "file-project-check-",
  });
  try {
    await copy(exampleRoot, directory, { overwrite: true });
    const { manifest, files } = await fixture();
    const artifacts = generateProjectArtifacts(
      await loadFileProject(manifest, files),
    );
    for (const artifact of artifacts) {
      await Deno.writeTextFile(
        join(directory, artifact.path),
        artifact.content.replace(/\n/g, "\r\n"),
      );
    }
    const outputPath = join(directory, "output/examples/person-01.json");
    const original = await Deno.readTextFile(outputPath);
    const check = () =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--no-check",
          join(import.meta.dirname!, "../scripts/file-project.ts"),
          join(directory, "intehrgrator.json"),
          "--check",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
    const unchanged = await check();
    assertEquals(
      unchanged.success,
      true,
      new TextDecoder().decode(unchanged.stderr),
    );
    const source = join(directory, "source/person-01.json");
    await Deno.writeTextFile(
      source,
      (await Deno.readTextFile(source)).replace("EXAMPLE-12345", "CHANGED-ID"),
    );
    const changed = await check();
    assertEquals(changed.success, false);
    assertStringIncludes(
      new TextDecoder().decode(changed.stderr),
      "Generated output is out of date",
    );
    assertEquals(await Deno.readTextFile(outputPath), original);
  } finally {
    if (dirname(directory) === tempRoot) {
      await Deno.remove(directory, { recursive: true });
    }
  }
});
