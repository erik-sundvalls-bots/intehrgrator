import { assert, assertEquals } from "@std/assert";
import {
  type BlocklyWorkspaceJson,
  indexDocument,
} from "@intehrgrator/core/slice_engine.ts";
import {
  buildBreadcrumbTrail,
  buildTreemapHierarchy,
  computeTreemapLayout,
} from "@intehrgrator/treemap/mod.ts";
import {
  filterSkeletonMandatoryOnly,
  generateSkeletonFromWebTemplate,
} from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { scaffoldBlocklyFromSkeleton } from "@intehrgrator/workbench/blockly_sync.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";

const MHV1_MAPPING_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/mapping/mapping.blockly.json",
  import.meta.url,
);
const MHV1_WT_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json",
  import.meta.url,
);

Deno.test("buildTreemapHierarchy and computeTreemapLayout lay out MHV1 fast and preserve clinical order", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const t0 = performance.now();
  const idx = indexDocument(doc);
  const root = buildTreemapHierarchy(idx);
  assert(root !== null, "expected root treemap datum");
  assert(root.children.length >= 10, `expected >=10 top sections, got ${root.children.length}`);

  const tiles = computeTreemapLayout(root, 1000, 600, 3);
  const elapsedMs = performance.now() - t0;

  assert(tiles.length > 20, `expected >20 laid-out tiles, got ${tiles.length}`);
  assert(elapsedMs < 150, `MHV1 index+treemap layout took ${elapsedMs.toFixed(1)}ms (expected <150ms)`);

  // Order-preserving check: depth-1 tiles appear in exact template section order.
  const depth1Ids = tiles.filter((t) => t.depth === 1).map((t) => t.datum.id);
  const expectedTopIds = root.children.map((c) => c.id);
  assertEquals(depth1Ids, expectedTopIds);
});

Deno.test("buildTreemapHierarchy filters by Mandatory Missing, AI Draft, and search query", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);

  const aiOnly = buildTreemapHierarchy(idx, {
    filter: { statusFilter: "ai-draft" },
  });
  assert(aiOnly !== null);
  assert(aiOnly.children.length > 0, "expected sections containing AI drafts");
  for (const sec of aiOnly.children) {
    assert(sec.counts.aiDraftLeaves > 0, "every kept section must have AI drafts");
  }

  const mandMissing = buildTreemapHierarchy(idx, {
    filter: { statusFilter: "mandatory-missing" },
  });
  assert(mandMissing !== null);
  assert(mandMissing.children.length > 0, "expected sections with mandatory-missing elements");

  const searchLifestyle = buildTreemapHierarchy(idx, {
    filter: { query: "Lifestyle" },
  });
  assert(searchLifestyle !== null);
  assertEquals(searchLifestyle.children.length, 1);
  assert(searchLifestyle.children[0].label.toLowerCase().includes("lifestyle"));
});

Deno.test("buildTreemapHierarchy overlays unscaffolded-optional ghost tiles in Sparse mode", async () => {
  const wt = await Deno.readTextFile(MHV1_WT_URL);
  const { skeleton, templateId } = generateSkeletonFromWebTemplate(wt);
  const sparse = scaffoldBlocklyFromSkeleton(skeleton, createEmptyModel(templateId), {
    scaffoldMode: "sparse",
  });
  const idx = indexDocument(sparse.blocklyState as BlocklyWorkspaceJson);
  assert(filterSkeletonMandatoryOnly(skeleton).length > 0);

  const treeWithGhosts = buildTreemapHierarchy(idx, {
    sparseFullSkeleton: skeleton,
  });
  assert(treeWithGhosts !== null);
  const ghostChildren = treeWithGhosts.children.filter((c) => c.isGhost);
  assert(
    ghostChildren.length >= 10,
    `expected >=10 unscaffolded optional sections as ghost tiles, got ${ghostChildren.length}`,
  );
  for (const g of ghostChildren) {
    assertEquals(g.status, "unscaffolded-optional");
  }
});

Deno.test("buildBreadcrumbTrail builds clinical path from COMPOSITION down to target node", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);
  const obs = [...idx.nodes.values()].find((n) => n.rmType === "OBSERVATION")!;
  const trail = buildBreadcrumbTrail(idx, obs.id);
  assert(trail.length >= 3, `expected COMPOSITION > SECTION > OBSERVATION, got ${trail.length}`);
  assertEquals(trail[0].rmType, "COMPOSITION");
  assertEquals(trail[trail.length - 1].id, obs.id);
});
