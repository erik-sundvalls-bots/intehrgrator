/**
 * Example sets load Example Instances last, after target, source schema and
 * mapping, so the Mapping Editor is usable while examples are still coming in.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { ExampleSet } from "@intehrgrator/core/example_sets/mod.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";
import type { PickedTextFile } from "@intehrgrator/host/mod.ts";

const SCHEMA = JSON.stringify({
  type: "object",
  properties: { systolic: { type: "number" }, diastolic: { type: "number" } },
});
const TARGET = JSON.stringify({
  type: "object",
  properties: { sys: { type: "number" } },
});

function stubHost(fetchTextUrl: (url: string) => Promise<PickedTextFile>): HostAdapter {
  return {
    pickTextFile: () => Promise.resolve(null),
    pickTextFilesFromDirectory: () => Promise.resolve(null),
    pickBinaryFile: () => Promise.resolve(null),
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: () => Promise.resolve(),
    readClipboard: () => Promise.resolve(""),
    saveAutosave: () => Promise.resolve(),
    saveManualSave: () => Promise.resolve(),
    loadStoredProjectRecord: () => Promise.resolve(null as StoredProjectRecord | null),
    listLoadableProjects: () => Promise.resolve([] as LoadableProjectEntry[]),
    resolveAppUrl: (path) => `https://app.test/${path}`,
    fetchTextUrl,
  };
}

function vitalsSet(id: string, values: number[]): ExampleSet {
  return {
    id,
    title: `Set ${id}`,
    source: {
      schema: `https://app.test/${id}/source.schema.json`,
      instances: values.map((_, i) => `https://app.test/${id}/instance-${i + 1}.json`),
    },
    target: `https://app.test/${id}/target.schema.json`,
  };
}

function filesFor(set: ExampleSet, values: number[]): Map<string, PickedTextFile> {
  const files = new Map<string, PickedTextFile>();
  files.set(set.source.schema!, { name: "source.schema.json", text: SCHEMA });
  files.set(set.target!, { name: "target.schema.json", text: TARGET });
  set.source.instances.forEach((url, i) => {
    files.set(url, { name: `${set.id}-instance-${i + 1}.json`, text: JSON.stringify({ systolic: values[i] }) });
  });
  return files;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

Deno.test("example set fetches Example Instances after target and source schema", async () => {
  const set = vitalsSet("a", [120, 130, 140]);
  const files = filesFor(set, [120, 130, 140]);
  const order: string[] = [];
  const controller = new WorkbenchController(stubHost((url) => {
    order.push(url);
    const file = files.get(url);
    return file ? Promise.resolve(file) : Promise.reject(new Error(`unexpected ${url}`));
  }));

  let atInteractive: ReturnType<WorkbenchController["getState"]> | null = null;
  await controller.loadExampleSet(set, { onInteractive: () => (atInteractive = controller.getState()) });

  const firstInstance = order.findIndex((url) => url.includes("instance-"));
  assert(firstInstance > order.indexOf(set.target!), order.join("\n"));
  assert(firstInstance > order.indexOf(set.source.schema!), order.join("\n"));

  // When the overlay goes away the workspace is usable and the examples pane is still loading.
  assert(atInteractive, "onInteractive should fire");
  const early = atInteractive as ReturnType<WorkbenchController["getState"]>;
  assertEquals(early.taskProgress, null);
  assertEquals(early.examples.length, 0);
  assertEquals(early.exampleSetExamplesLoading?.total, 3);
  assert(early.schemaTree, "source schema is loaded before examples");
  assertStringIncludes(early.statusMessage, 'Loading 3 examples for "Set a"');

  const done = controller.getState();
  assertEquals(done.exampleSetExamplesLoading, null);
  assertEquals(done.examples.map((e) => e.filename), [
    "a-instance-1.json",
    "a-instance-2.json",
    "a-instance-3.json",
  ]);
  assertEquals(done.statusMessage, 'Loaded example set "Set a"');
});

Deno.test("switching example set mid-load drops the superseded set's examples", async () => {
  const a = vitalsSet("a", [120, 130]);
  const b = vitalsSet("b", [99]);
  const files = new Map([...filesFor(a, [120, 130]), ...filesFor(b, [99])]);
  const gate = deferred<void>();
  const controller = new WorkbenchController(stubHost(async (url) => {
    // Hold set A's Example Instances until set B has replaced the workspace.
    if (url.startsWith("https://app.test/a/instance-")) await gate.promise;
    const file = files.get(url);
    if (!file) throw new Error(`unexpected ${url}`);
    return file;
  }));

  const interactiveA = deferred<void>();
  const loadA = controller.loadExampleSet(a, { onInteractive: () => interactiveA.resolve() });
  await interactiveA.promise;
  assertEquals(controller.getState().exampleSetExamplesLoading?.setId, "a");

  await controller.loadExampleSet(b);
  gate.resolve();
  await loadA; // resolves quietly; its results are stale

  const s = controller.getState();
  assertEquals(s.examples.map((e) => e.filename), ["b-instance-1.json"]);
  assertEquals(s.exampleSetExamplesLoading, null);
  assertEquals(s.statusMessage, 'Loaded example set "Set b"');
});

Deno.test("a failed Example Instance keeps the others and reports the error", async () => {
  const set = vitalsSet("a", [120, 130]);
  const files = filesFor(set, [120, 130]);
  files.delete(set.source.instances[1]!);
  const controller = new WorkbenchController(stubHost((url) => {
    const file = files.get(url);
    return file ? Promise.resolve(file) : Promise.reject(new Error("404 instance-2"));
  }));
  let interactive = false;
  let error: unknown = null;
  try {
    await controller.loadExampleSet(set, { onInteractive: () => (interactive = true) });
  } catch (err) {
    error = err;
  }
  assert(interactive, "workspace was usable before the example failure");
  assertStringIncludes(String(error), "404 instance-2");
  const s = controller.getState();
  assertEquals(s.examples.map((e) => e.filename), ["a-instance-1.json"]);
  assertEquals(s.exampleSetExamplesLoading, null);
  assertStringIncludes(s.statusMessage, 'Example set "Set a" failed');
});
