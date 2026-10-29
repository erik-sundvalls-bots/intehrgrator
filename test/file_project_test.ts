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
  projectMetadata,
  updateFileProject,
  updateProjectManifest,
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

Deno.test("file project: per-file languages rebuild translated ids and descriptions on reopen", async () => {
  const { manifest, contents, files } = await fixture();
  contents.set(
    "targets/vitals.opt",
    await Deno.readTextFile(
      join(import.meta.dirname!, "fixtures/simple-diagnose-and-vitals.opt"),
    ),
  );
  contents.set(
    "schemas/referral.xsd",
    await Deno.readTextFile(
      join(import.meta.dirname!, "fixtures/multilingual-referral/referral.xsd"),
    ),
  );
  contents.set("mapping/main.mapping.json", "{}");
  const config = JSON.parse(manifest);
  config.target = {
    path: "targets/vitals.opt",
    languageSettings: {
      languages: ["en", "sv", "de"],
      idLanguage: "sv",
      labelLanguage: "de",
    },
  };
  config.source.schema = {
    path: "schemas/referral.xsd",
    languageSettings: { languages: ["sv", "en"], labelLanguage: "sv" },
  };
  const first = await loadFileProject(JSON.stringify(config), files);
  assertEquals(
    first.bundle.target?.languageSettings,
    config.target.languageSettings,
  );
  assertEquals(first.bundle.target?.idLanguage, "sv");
  assertEquals(
    first.bundle.sourceSchema?.languageSettings,
    config.source.schema.languageSettings,
  );
  assertStringIncludes(
    first.bundle.target!.webTemplateJson!,
    '"id":"problem_diagnos"',
  );
  contents.set("mapping/main.mapping.json", projectMapping(first.bundle));
  const reopened = await loadFileProject(JSON.stringify(config), files);
  assertEquals(
    reopened.bundle.target?.webTemplateJson,
    first.bundle.target?.webTemplateJson,
  );
  assertEquals(
    reopened.bundle.target?.languageSettings,
    config.target.languageSettings,
  );
  assertEquals(
    reopened.bundle.sourceSchema?.languageSettings,
    config.source.schema.languageSettings,
  );
  delete config.target.languageSettings;
  const legacy = await loadFileProject(JSON.stringify(config), files);
  assertEquals(
    legacy.bundle.target?.idLanguage,
    "sv",
    "Legacy manifests keep the canonical Blockly id choice",
  );
  config.target.languageSettings = {
    languages: ["en", "sv", "de"],
    idLanguage: "primary",
  };
  await assertRejects(
    () => loadFileProject(JSON.stringify(config), files),
    Error,
    "conflicts",
  );
});

Deno.test("file project: metadata-only saves preserve file paths and unrelated configuration", async () => {
  const { manifest, files } = await fixture();
  const project = await loadFileProject(manifest, files);
  const before = projectMetadata(project.bundle);
  const next = structuredClone(before);
  next.sourceSchema!.labelLanguage = "sv";
  const text = updateProjectManifest(manifest, next, before);
  const saved = JSON.parse(text);
  assertEquals(saved.target, "targets/person.schema.json");
  assertEquals(saved.source.schema, {
    path: "schemas/person.schema.json",
    languageSettings: { languages: [], labelLanguage: "sv" },
  });
  assertEquals(saved.output.script, {
    language: "typescript",
    path: "output/conversion.ts",
  });
  assertEquals(updateProjectManifest(text, next, next), text);
});

Deno.test("file project: local target filesets rebuild dependent labels and report missing files", async () => {
  const { manifest, contents, files } = await fixture();
  for (const name of ["root.t.json", "details.t.json"]) {
    contents.set(
      `targets/${name}`,
      await Deno.readTextFile(
        join(import.meta.dirname!, "fixtures/file-project-fileset", name),
      ),
    );
  }
  contents.set("mapping/main.mapping.json", "{}");
  const config = JSON.parse(manifest);
  config.target = {
    path: "targets/root.t.json",
    files: ["targets/root.t.json", "targets/details.t.json"],
  };
  const load = () =>
    loadFileProject(JSON.stringify(config), {
      ...files,
      listExamples: () => Promise.resolve([]),
    });
  const initial = await load();
  assertEquals(initial.bundle.target?.targetId, "FileProjectVitals");
  assertEquals(initial.bundle.target?.fileset?.files.length, 2);
  assertStringIncludes(
    JSON.stringify(initial.bundle.target?.skeleton),
    "Known question",
  );
  contents.set(
    "targets/details.t.json",
    contents.get("targets/details.t.json")!.replace(
      "Known question",
      "Changed question",
    ),
  );
  const refreshed = await load();
  assertStringIncludes(
    JSON.stringify(refreshed.bundle.target?.skeleton),
    "Changed question",
  );
  config.target.languageSettings = {
    languages: ["en", "sv"],
    idLanguage: "sv",
  };
  const swedish = await load();
  assertStringIncludes(
    swedish.bundle.target!.webTemplateJson!,
    '"id":"känd_fråga"',
  );
  contents.set(
    "targets/details.t.json",
    contents.get("targets/details.t.json")!.replace(
      "Känd fråga",
      "Uppdaterad fråga",
    ),
  );
  const updated = await load();
  assertStringIncludes(
    updated.bundle.target!.webTemplateJson!,
    '"id":"uppdaterad_fråga"',
  );
  delete config.target.languageSettings;
  config.target.files = ["targets/root.t.json"];
  const incomplete = await load();
  const diagnostic = generateProjectArtifacts(incomplete).find((artifact) =>
    artifact.path === "output/status.json"
  )!;
  assertStringIncludes(diagnostic.content, "FileProjectDetails");
  config.target.files = ["targets/root.t.json", "targets/details.t.json"];
  contents.delete("targets/details.t.json");
  await assertRejects(load, Error, "Missing targets/details.t.json");
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
