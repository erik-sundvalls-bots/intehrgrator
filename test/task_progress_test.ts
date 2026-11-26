import { assertEquals, assert, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import {
  escapeHtml,
  taskProgressInnerHtml,
  type TaskProgress,
} from "@intehrgrator/workbench/task_progress.ts";
import { parseExampleSetCatalog } from "@intehrgrator/core/example_sets/mod.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const fixturesDir = join(root, "test", "fixtures");
const catalogBase = "https://app.test/examples/example-sets.json";

function stubHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
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
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
    ...overrides,
  };
}

Deno.test("taskProgressInnerHtml lists waiting, running, and finished substeps", () => {
  const progress: TaskProgress = {
    title: "Load example set",
    steps: [
      { id: "target", label: "Load target", state: "finished" },
      { id: "schema", label: "Load source schema", state: "running", detail: "source.schema.json" },
      { id: "example-0", label: "Load example 1", state: "waiting" },
    ],
  };
  const html = taskProgressInnerHtml(progress);
  assertStringIncludes(html, "Load example set");
  assertStringIncludes(html, 'data-step-id="target"');
  assertStringIncludes(html, "task-progress-step--finished");
  assertStringIncludes(html, "task-progress-step--running");
  assertStringIncludes(html, "task-progress-step--waiting");
  assertStringIncludes(html, "source.schema.json");
  assertEquals(html.includes("<script"), false);
});

Deno.test("escapeHtml encodes overlay text", () => {
  assertEquals(escapeHtml(`<img src="x">`), "&lt;img src=&quot;x&quot;&gt;");
});

Deno.test("loadExampleSet reports waiting/running/finished substeps", async () => {
  const catalogText = await Deno.readTextFile(catalogPath);
  const schema = await Deno.readTextFile(
    join(fixturesDir, "dummy-json-vitals", "source.schema.json"),
  );
  const instance1 = await Deno.readTextFile(
    join(fixturesDir, "dummy-json-vitals", "instance-1.json"),
  );
  const instance2 = await Deno.readTextFile(
    join(fixturesDir, "dummy-json-vitals", "instance-2.json"),
  );
  const instance3 = await Deno.readTextFile(
    join(fixturesDir, "dummy-json-vitals", "instance-3.json"),
  );
  const target = await Deno.readTextFile(
    join(fixturesDir, "dummy-json-vitals", "target.schema.json"),
  );
  const files: Record<string, { name: string; text: string }> = {
    [catalogBase]: { name: "example-sets.json", text: catalogText },
    "https://app.test/test/fixtures/dummy-json-vitals/source.schema.json": {
      name: "source.schema.json",
      text: schema,
    },
    "https://app.test/test/fixtures/dummy-json-vitals/instance-1.json": {
      name: "instance-1.json",
      text: instance1,
    },
    "https://app.test/test/fixtures/dummy-json-vitals/instance-2.json": {
      name: "instance-2.json",
      text: instance2,
    },
    "https://app.test/test/fixtures/dummy-json-vitals/instance-3.json": {
      name: "instance-3.json",
      text: instance3,
    },
    "https://app.test/test/fixtures/dummy-json-vitals/target.schema.json": {
      name: "target.schema.json",
      text: target,
    },
  };

  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: (url) => {
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  }));

  const snapshots: TaskProgress[] = [];
  controller.subscribe(() => {
    const progress = controller.getState().taskProgress;
    if (progress) snapshots.push(structuredClone(progress));
  });

  const catalog = parseExampleSetCatalog(catalogText, catalogBase);
  const set = catalog.sets.find((item) => item.id === "dummy-json-vitals");
  if (!set) throw new Error("expected dummy-json-vitals");
  await controller.loadExampleSet(set);

  assert(snapshots.length > 0, "expected taskProgress snapshots during load");
  const ids = snapshots[0]!.steps.map((s) => s.id);
  assert(ids.includes("target"), ids.join(","));
  assert(ids.includes("schema"), ids.join(","));
  // Example Instances load after the overlay, in the examples pane (not overlay steps).
  assert(!ids.some((id) => id.startsWith("example-")), ids.join(","));
  assert(ids.includes("generate"), ids.join(","));
  assertEquals(controller.getState().examples.length, 3);

  const sawWaiting = snapshots.some((p) => p.steps.some((s) => s.state === "waiting"));
  const sawRunning = snapshots.some((p) => p.steps.some((s) => s.state === "running"));
  const sawFinished = snapshots.some((p) => p.steps.some((s) => s.state === "finished"));
  assertEquals(sawWaiting, true);
  assertEquals(sawRunning, true);
  assertEquals(sawFinished, true);

  const targetRunning = snapshots.find((p) =>
    p.steps.find((s) => s.id === "target")?.state === "running" &&
    p.steps.find((s) => s.id === "schema")?.state === "waiting"
  );
  assert(targetRunning, "schema should wait while the target is loading");

  const after = controller.getState();
  assertEquals(after.taskProgress, null);
  assertStringIncludes(after.statusMessage, "Dummy vitals");
});

Deno.test("failed example set marks the running step failed", async () => {
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: () => Promise.reject(new Error("network down")),
  }));
  const snapshots: TaskProgress[] = [];
  controller.subscribe(() => {
    const progress = controller.getState().taskProgress;
    if (progress) snapshots.push(structuredClone(progress));
  });
  try {
    await controller.loadExampleSet({
      id: "broken",
      title: "Broken set",
      source: { instances: [] },
      target: "https://app.test/missing.json",
    });
    throw new Error("expected load to fail");
  } catch (err) {
    assertStringIncludes(err instanceof Error ? err.message : String(err), "network down");
  }
  assert(
    snapshots.some((p) => p.steps.some((s) => s.state === "failed")),
    "expected a failed substep",
  );
  assertEquals(controller.getState().taskProgress, null);
});
