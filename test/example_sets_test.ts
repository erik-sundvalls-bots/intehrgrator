import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
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
const _fixturesDir = join(root, "test", "fixtures");
const catalogBase = "https://app.test/examples/example-sets.json";
const localFixtures =
  "https://app.test/test/fixtures/";

function isHttpUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/** Collect relative asset refs from the raw catalog (absolute http(s) skipped by callers). */
function relativeAssetRefs(
  set: {
    id: string;
    source?: { schema?: string; instances?: string[] };
    target?: string;
    mapping?: string;
    sheets?: string;
    defaults?: string;
  },
): Array<{ role: string; ref: string }> {
  const out: Array<{ role: string; ref: string }> = [];
  if (set.source?.schema) out.push({ role: "source.schema", ref: set.source.schema });
  for (const [i, ref] of (set.source?.instances ?? []).entries()) {
    out.push({ role: `source.instances[${i}]`, ref });
  }
  if (set.target) out.push({ role: "target", ref: set.target });
  if (set.mapping) out.push({ role: "mapping", ref: set.mapping });
  if (set.sheets) out.push({ role: "sheets", ref: set.sheets });
  if (set.defaults) out.push({ role: "defaults", ref: set.defaults });
  return out;
}

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

async function readCatalog(): Promise<string> {
  return await Deno.readTextFile(catalogPath);
}

async function stubbedCatalogFiles(): Promise<Record<string, { name: string; text: string }>> {
  const text = await readCatalog();
  const files: Record<string, { name: string; text: string }> = {
    [catalogBase]: {
      name: "example-sets.json",
      text,
    },
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
    for (const { ref } of relativeAssetRefs(set)) {
      if (isHttpUrl(ref)) continue;
      const url = resolveCatalogUri(ref, catalogBase);
      if (files[url]) continue;
      const path = normalize(join(catalogDir, ref));
      files[url] = { name: basename(path), text: await Deno.readTextFile(path) };
    }
  }
  return files;
}

Deno.test("example-sets.json relative asset URIs resolve to existing repo files", async () => {
  const text = await readCatalog();
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
  const missing: string[] = [];
  for (const set of raw.sets) {
    for (const { role, ref } of relativeAssetRefs(set)) {
      if (isHttpUrl(ref)) continue;
      const path = normalize(join(catalogDir, ref));
      try {
        const st = await Deno.stat(path);
        if (!st.isFile) missing.push(`${set.id} ${role}: not a file (${ref})`);
      } catch {
        missing.push(`${set.id} ${role}: missing (${ref})`);
      }
    }
  }
  assertEquals(missing, [], missing.join("\n"));
});

Deno.test("parseExampleSetCatalog resolves in-repo fixture URIs against the catalog URL", async () => {
  const text = await readCatalog();
  const catalog = parseExampleSetCatalog(text, catalogBase);
  assertEquals(catalog.sets.length >= 18, true, String(catalog.sets.length));
  const vitals = catalog.sets[0]!;
  assertEquals(vitals.id, "dummy-json-vitals");
  assertEquals(vitals.mapping, undefined);
  assertEquals(vitals.defaults, undefined);
  assertEquals(
    vitals.source.schema,
    `${localFixtures}dummy-json-vitals/source.schema.json`,
  );
  assertEquals(vitals.source.instances.length, 3);
  const mapped = catalog.sets[1]!;
  assertEquals(
    mapped.mapping,
    `${localFixtures}dummy-json-vitals/mapping.blockly.json`,
  );
  assertEquals(
    mapped.defaults,
    `${localFixtures}dummy-json-vitals/defaults.map.json`,
  );
  const simpleVitals = catalog.sets.find((set) => set.id === "Simple-vitals");
  if (!simpleVitals) throw new Error("expected Simple-vitals example set");
  assertEquals(
    simpleVitals.mapping,
    `${localFixtures}legacy-simulated-json/mapping/simple-vitals.blockly.json`,
  );
  assertEquals(
    simpleVitals.sheets,
    `${localFixtures}legacy-simulated-json/mapping/simple-vitals.sheets.json`,
  );
  const series = catalog.sets.find((set) => set.id === "Simple-vitals-series");
  if (!series) throw new Error("expected Simple-vitals-series example set");
  assertEquals(series.source.instances.length, 4);
  assertEquals(
    series.mapping,
    `${localFixtures}legacy-simulated-json/mapping/bp-series.blockly.json`,
  );
  assertEquals(
    series.sheets,
    `${localFixtures}legacy-simulated-json/mapping/bp-series.sheets.json`,
  );
  const obx = catalog.sets.find((set) => set.id === "obx-mhv1-unmapped-json-to-openehr");
  if (!obx) throw new Error("expected OBX MHV1 unmapped example set");
  assertEquals(obx.mapping, undefined);
  assertEquals(obx.sheets, undefined);
  const obxMapped = catalog.sets.find((set) => set.id === "obx-mhv1-mapped-json-to-openehr");
  if (!obxMapped) throw new Error("expected OBX MHV1 mapped example set");
  assertEquals(
    obxMapped.mapping,
    `${localFixtures}Obstetrix-MHV1/mapping/mapping.blockly.json`,
  );
  assertEquals(
    obxMapped.sheets,
    `${localFixtures}Obstetrix-MHV1/mapping/mapping.sheets.json`,
  );
  assertEquals(
    obx.source.schema,
    `${localFixtures}Obstetrix-MHV1/source-schema/obx-mhv1.review-1.schema.json`,
  );
  assertEquals(obx.source.instances.length, 4);
  assertEquals(
    obx.source.instances[0],
    `${localFixtures}Obstetrix-MHV1/source-instance/1-primigravida-basprogram.json`,
  );
  assertEquals(
    obx.source.instances[3],
    `${localFixtures}Obstetrix-MHV1/source-instance/4-nightly-primigravida.json`,
  );
  assertEquals(
    obx.target,
    `${localFixtures}Obstetrix-MHV1/target/mhv1-prenatal-visit.encounter.v1.opt`,
  );
  const kardaOrd = catalog.sets.find((set) => set.id === "karda-ordinationsdata-to-openehr-flat");
  if (!kardaOrd) throw new Error("expected karda ordination example set");
  assertEquals(
    kardaOrd.mapping,
    `${localFixtures}ordinerad-medicinsk-onkologisk-behandling/mapping/mapping.blockly.json`,
  );
  const kardaAdmin = catalog.sets.find((set) => set.id === "karda-administreringsdata-to-openehr-flat");
  if (!kardaAdmin) throw new Error("expected karda administration example set");
  assertEquals(
    kardaAdmin.mapping,
    `${localFixtures}administrerad-medicinsk-onkologisk-behandling/mapping/mapping.blockly.json`,
  );
  const chemo = catalog.sets.find((set) => set.id === "chemo-symptoms-flat-to-tc-xml");
  if (!chemo) throw new Error("expected chemo example set");
  assertEquals(chemo.source.schema, undefined);
  assertEquals(
    chemo.target,
    `${localFixtures}TakeCare/TakeCare-CasenoteWrite-edit01.xsd`,
  );
  assertEquals(chemo.source.instances.length, 6);
  assertEquals(
    chemo.mapping,
    `${localFixtures}patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json`,
  );
  const lung = catalog.sets.find((set) => set.id === "lung-mdt-form-to-tc-xml");
  if (!lung) throw new Error("expected lung-MDT example set");
  assertEquals(
    lung.target,
    `${localFixtures}TakeCare/TakeCare-CasenoteWrite-edit01.xsd`,
  );
  assertEquals(
    lung.mapping,
    `${localFixtures}lung-MDT-form/mapping/mapping.blockly.json`,
  );
  assertEquals(lung.source.instances.length, 2);
  const lungDt = catalog.sets.find((set) => set.id === "lung-mdt-form-to-tc-xml-decision-tables");
  if (!lungDt) throw new Error("expected lung-MDT decision-table sibling");
  assertEquals(
    lungDt.mapping,
    `${localFixtures}lung-MDT-form-decision-tables/mapping/mapping.blockly.json`,
  );
  assertEquals(
    lungDt.sheets,
    `${localFixtures}lung-MDT-form-decision-tables/mapping/mapping.sheets.json`,
  );
  const chemoDt = catalog.sets.find((set) =>
    set.id === "chemo-symptoms-flat-to-tc-xml-decision-tables"
  );
  if (!chemoDt) throw new Error("expected chemo decision-table sibling");
  assertEquals(
    chemoDt.mapping,
    `${localFixtures}patient-reported-chemotherapy-symptoms-decision-tables/mapping/mapping.blockly.json`,
  );
});

const TITLE_STATE = / — (unmapped|mapped|mapped, decision tables)$/;

Deno.test("catalog titles put mapping state last with a shared family+route prefix", async () => {
  const text = await readCatalog();
  const catalog = parseExampleSetCatalog(text, catalogBase);
  const pairs: Array<[string, string, string?]> = [
    ["dummy-json-vitals", "dummy-json-vitals-mapped"],
    ["Simple-vitals-unmapped", "Simple-vitals"],
    ["Simple-vitals-series-unmapped", "Simple-vitals-series"],
    ["obx-mhv1-unmapped-json-to-openehr", "obx-mhv1-mapped-json-to-openehr"],
    ["chemo-symptoms-flat-to-tc-xml-unmapped", "chemo-symptoms-flat-to-tc-xml", "chemo-symptoms-flat-to-tc-xml-decision-tables"],
    ["lung-mdt-form-to-tc-xml-unmapped", "lung-mdt-form-to-tc-xml", "lung-mdt-form-to-tc-xml-decision-tables"],
    ["karda-ordinationsdata-to-openehr-flat-unmapped", "karda-ordinationsdata-to-openehr-flat"],
    ["karda-administreringsdata-to-openehr-flat-unmapped", "karda-administreringsdata-to-openehr-flat"],
  ];
  for (const set of catalog.sets) {
    assertEquals(
      TITLE_STATE.test(set.title),
      true,
      `${set.id} title must end with mapping state: ${set.title}`,
    );
  }
  for (const [unmappedId, mappedId, decisionId] of pairs) {
    const unmapped = catalog.sets.find((set) => set.id === unmappedId);
    const mapped = catalog.sets.find((set) => set.id === mappedId);
    if (!unmapped || !mapped) throw new Error(`missing pair ${unmappedId}/${mappedId}`);
    const unmappedPrefix = unmapped.title.replace(TITLE_STATE, "");
    const mappedPrefix = mapped.title.replace(TITLE_STATE, "");
    assertEquals(unmappedPrefix, mappedPrefix, `${unmappedId} vs ${mappedId} family+route`);
    assertEquals(unmapped.title.endsWith(" — unmapped"), true, unmapped.title);
    assertEquals(mapped.title.endsWith(" — mapped"), true, mapped.title);
    if (decisionId) {
      const decision = catalog.sets.find((set) => set.id === decisionId);
      if (!decision) throw new Error(`missing decision-table set ${decisionId}`);
      assertEquals(decision.title.replace(TITLE_STATE, ""), mappedPrefix, decisionId);
      assertEquals(decision.title.endsWith(" — mapped, decision tables"), true, decision.title);
    }
  }
});

Deno.test("catalog has an unmapped and a mapped Example Set for each source schema", async () => {
  const text = await readCatalog();
  const catalog = parseExampleSetCatalog(text, catalogBase);
  const pairs: Array<[string, string]> = [
    ["dummy-json-vitals", "dummy-json-vitals-mapped"],
    ["Simple-vitals-unmapped", "Simple-vitals"],
    ["Simple-vitals-series-unmapped", "Simple-vitals-series"],
    ["obx-mhv1-unmapped-json-to-openehr", "obx-mhv1-mapped-json-to-openehr"],
    ["chemo-symptoms-flat-to-tc-xml-unmapped", "chemo-symptoms-flat-to-tc-xml"],
    ["lung-mdt-form-to-tc-xml-unmapped", "lung-mdt-form-to-tc-xml"],
    ["karda-ordinationsdata-to-openehr-flat-unmapped", "karda-ordinationsdata-to-openehr-flat"],
    ["karda-administreringsdata-to-openehr-flat-unmapped", "karda-administreringsdata-to-openehr-flat"],
  ];
  for (const [unmappedId, mappedId] of pairs) {
    const unmapped = catalog.sets.find((set) => set.id === unmappedId);
    const mapped = catalog.sets.find((set) => set.id === mappedId);
    if (!unmapped) throw new Error(`missing unmapped Example Set ${unmappedId}`);
    if (!mapped) throw new Error(`missing mapped Example Set ${mappedId}`);
    assertEquals(unmapped.mapping, undefined, unmappedId);
    assertEquals(typeof mapped.mapping, "string", mappedId);
    assertEquals(unmapped.target, mapped.target, `${unmappedId} vs ${mappedId} target`);
    assertEquals(unmapped.source.schema, mapped.source.schema, `${unmappedId} schema`);
    assertEquals(
      unmapped.source.instances.length >= 1,
      true,
      `${unmappedId} needs at least one Example Instance`,
    );
    assertEquals(unmapped.source.instances, mapped.source.instances, `${mappedId} instances`);
  }
});

Deno.test("parseExampleSetCatalog rejects a missing sets array", () => {
  try {
    parseExampleSetCatalog(JSON.stringify({ version: 1 }), catalogBase);
    throw new Error("expected parse to throw");
  } catch (err) {
    assertStringIncludes(err instanceof Error ? err.message : String(err), "sets");
  }
});

Deno.test("resolveCatalogUri keeps absolute https URIs", () => {
  assertEquals(
    resolveCatalogUri("https://example.test/schema.json", catalogBase),
    "https://example.test/schema.json",
  );
});

Deno.test("controller loads a dummy example set from catalog URIs", async () => {
  const files = await stubbedCatalogFiles();
  const requested: string[] = [];
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: (url) => {
      requested.push(url);
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  }));

  const catalog = await controller.loadExampleSetCatalog();
  assertEquals(catalog.sets[0]?.id, "dummy-json-vitals");
  await controller.loadExampleSet(catalog.sets[0]!);

  const state = controller.getState();
  assertEquals(state.schemaError, null);
  assertEquals(state.schemaFilename, "source.schema.json");
  assertEquals(state.examples.length, 3);
  assertEquals(state.activeExample?.filename, "instance-1.json");
  assertStringIncludes(state.statusMessage, "Dummy vitals");
  assertEquals(requested[0], catalogBase);
});

Deno.test("controller loads optional Blockly mapping from the catalog", async () => {
  const files = await stubbedCatalogFiles();
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: (url) => {
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  }));

  const catalog = await controller.loadExampleSetCatalog(catalogBase);
  const mapped = catalog.sets.find((set) => set.id === "dummy-json-vitals-mapped");
  if (!mapped) throw new Error("expected mapped dummy set");
  await controller.loadExampleSet(mapped);
  const state = controller.getState();
  assertEquals(state.examples.length, 3);
  assertEquals(state.blocklyState && typeof state.blocklyState, "object");
  const queued = controller.consumePendingDefaultsMap();
  assertEquals(queued && typeof queued, "object");
  assertEquals((queued as { type?: string }).type, "default_context_map");
});

Deno.test("controller loads chemo FLAT example set with TakeCare XSD target", async () => {
  const files = await stubbedCatalogFiles();
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: (url) => {
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  }));

  const catalog = await controller.loadExampleSetCatalog(catalogBase);
  const chemo = catalog.sets.find((set) => set.id === "chemo-symptoms-flat-to-tc-xml");
  if (!chemo) throw new Error("expected chemo example set");
  await controller.loadExampleSet(chemo);
  const state = controller.getState();
  assertEquals(state.examples.length, 6);
  assertEquals(state.templateFilename, "TakeCare-CasenoteWrite-edit01.xsd");
  assertEquals(state.target?.format, "xml-schema");
  assertEquals(state.skeleton[0]?.blockType, "schema_ProfdocHISMessage");
  assertEquals(state.blocklyState && typeof state.blocklyState, "object");
  const queued = controller.consumePendingDefaultsMap();
  assertEquals(queued && typeof queued, "object");
});

Deno.test("controller loads lung-MDT Example Set with catalogued instances", async () => {
  const files = await stubbedCatalogFiles();
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: (url) => {
      const file = files[url];
      if (!file) return Promise.reject(new Error(`unexpected url ${url}`));
      return Promise.resolve(file);
    },
  }));

  const catalog = await controller.loadExampleSetCatalog(catalogBase);
  const lung = catalog.sets.find((set) => set.id === "lung-mdt-form-to-tc-xml");
  if (!lung) throw new Error("expected lung-MDT example set");
  await controller.loadExampleSet(lung);
  const state = controller.getState();
  assertEquals(state.examples.length, 2);
  assertEquals(state.templateFilename, "TakeCare-CasenoteWrite-edit01.xsd");
  assertEquals(state.skeleton[0]?.blockType, "schema_ProfdocHISMessage");
  assertEquals(state.blocklyState && typeof state.blocklyState, "object");
});

Deno.test("controller surfaces catalog fetch failure", async () => {
  const controller = new WorkbenchController(stubHost({
    fetchTextUrl: () => Promise.reject(new Error("HTTP 404")),
  }));
  await assertRejects(
    () => controller.loadExampleSetCatalog("https://example.test/missing.json"),
    Error,
    "404",
  );
  assertStringIncludes(controller.getState().statusMessage, "404");
});
