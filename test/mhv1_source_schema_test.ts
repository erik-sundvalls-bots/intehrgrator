import { assertEquals } from "@std/assert";
import { basename, dirname, fromFileUrl, join, normalize } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import {
  parseExampleSetCatalog,
  resolveCatalogUri,
} from "@intehrgrator/core/example_sets/mod.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const catalogDir = dirname(catalogPath);
const catalogBase = "https://app.test/examples/example-sets.json";

/** Every catalogued obstetric / Obstetrix MHV1 example set. */
const MHV1_SET_IDS = [
  "obx-mhv1-unmapped-json-to-openehr",
  "obx-mhv1-mapped-json-to-openehr",
  "mhv1-generic-entry-to-prenatal-visit-unmapped",
  "mhv1-generic-entry-to-prenatal-visit",
  "mhv1-generic-entry-flat-wt-unmapped",
  "mhv1-generic-entry-flat-wt",
  "mhv1-generic-entry-flat-opt2-unmapped",
  "mhv1-generic-entry-canonical-wt-unmapped",
  "mhv1-generic-entry-canonical-opt2-unmapped",
];

function stubHost(files: Record<string, { name: string; text: string }>): HostAdapter {
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
    fetchTextUrl: (url) => {
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  };
}

Deno.test("each MHV1 example set loads with zero source-schema mismatches", async () => {
  const text = await Deno.readTextFile(catalogPath);
  const catalog = parseExampleSetCatalog(text, catalogBase);
  const files: Record<string, { name: string; text: string }> = {
    [catalogBase]: { name: "example-sets.json", text },
  };
  const raw = JSON.parse(text) as {
    sets: Array<{
      id: string;
      source?: { schema?: string; instances?: string[] };
      target?: string;
      mapping?: string;
      sheets?: string;
      defaults?: string;
    }>;
  };
  for (const set of raw.sets) {
    if (!MHV1_SET_IDS.includes(set.id)) continue;
    const refs = [
      set.source?.schema,
      ...(set.source?.instances ?? []),
      set.target,
      set.mapping,
      set.sheets,
      set.defaults,
    ].filter((ref): ref is string => Boolean(ref));
    for (const ref of refs) {
      const url = resolveCatalogUri(ref, catalogBase);
      if (files[url]) continue;
      const path = normalize(join(catalogDir, ref));
      files[url] = { name: basename(path), text: await Deno.readTextFile(path) };
    }
  }

  const report: string[] = [];
  for (const id of MHV1_SET_IDS) {
    const set = catalog.sets.find((row) => row.id === id);
    if (!set) {
      report.push(`${id}: missing from catalog`);
      continue;
    }
    const controller = new WorkbenchController(stubHost(files));
    await controller.loadExampleSet(set);
    const state = controller.getState();
    if (state.schemaError) report.push(`${id}: schema error: ${state.schemaError}`);
    const validations = state.exampleValidations;
    const examples = state.examples;
    if (examples.length !== set.source.instances.length) {
      report.push(
        `${id}: loaded ${examples.length} examples, catalog has ${set.source.instances.length}`,
      );
    }
    for (const example of examples) {
      const issues = validations[example.id] ?? [];
      if (!issues.length) continue;
      const sample = issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join(
        " | ",
      );
      report.push(
        `${id} ${example.filename} [${example.format}]: ${issues.length} mismatches. ${sample}`,
      );
    }
  }
  assertEquals(report, []);
});
