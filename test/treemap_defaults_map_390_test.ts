/**
 * #390: large mapped Example Sets open in Treemap Overview. Hydrating their
 * defaults map must happen on the canonical JSON, keeping the mapping intact.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { hydrateDefaultsMapInCanvasJson } from "@intehrgrator/blockly/defaults_canvas.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { indexDocument, TREEMAP_AUTO_THRESHOLD } from "@intehrgrator/core/slice_engine.ts";
import { buildTreemapHierarchy } from "@intehrgrator/treemap/hierarchy.ts";

type Doc = { blocks: { languageVersion?: number; blocks: Array<Record<string, unknown>> } };
const examplesDir = join(import.meta.dirname!, "..", "examples");
const readJson = (rel: string) => JSON.parse(Deno.readTextFileSync(join(examplesDir, rel)));
const catalog = readJson("example-sets.json");
const sets: Array<{ id: string; mapping?: string; defaults?: string }> = Array.isArray(catalog)
  ? catalog
  : catalog.sets ?? catalog.exampleSets;

Deno.test("#390 hydrateDefaultsMapInCanvasJson replaces only the default context map", () => {
  registerMapBlocks();
  const set = sets.find((s) => s.id === "lung-mdt-form-to-tc-xml-decision-tables")!;
  const doc = readJson(set.mapping!) as Doc;
  const before = structuredClone(doc);
  const out = hydrateDefaultsMapInCanvasJson(doc, readJson(set.defaults!), "sv", "xml-schema");
  assertEquals(doc, before, "input is not mutated");
  const others = (d: Doc) => d.blocks.blocks.filter((b) => b.type !== "default_context_map");
  assertEquals(others(out), others(before));
  const defaults = out.blocks.blocks.filter((b) => b.type === "default_context_map");
  assertEquals(defaults.length, 1);
  const text = JSON.stringify(defaults[0]);
  assertStringIncludes(text, '"KEY2":"UserId"');
  assertStringIncludes(text, "TMBA");
});

Deno.test("#390 every Treemap-sized mapped Example Set keeps tiles after its defaults map", () => {
  registerMapBlocks();
  let treemapSets = 0;
  for (const set of sets) {
    if (!set.mapping) continue;
    let doc = readJson(set.mapping) as Doc;
    if (set.defaults) doc = hydrateDefaultsMapInCanvasJson(doc, readJson(set.defaults), "en");
    const index = indexDocument(doc);
    if (index.totalBlocks <= TREEMAP_AUTO_THRESHOLD) continue;
    treemapSets++;
    const root = buildTreemapHierarchy(index);
    assert(root && root.children.length > 0, `${set.id}: Treemap has tiles`);
  }
  assert(treemapSets >= 3, `expected the lung decision-tables and MHV1 sets to be Treemap-sized, got ${treemapSets}`);
});
