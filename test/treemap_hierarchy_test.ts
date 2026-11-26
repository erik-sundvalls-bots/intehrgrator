import { assert, assertEquals } from "@std/assert";
import {
  type BlocklyWorkspaceJson,
  indexDocument,
} from "@intehrgrator/core/slice_engine.ts";
import {
  buildBreadcrumbTrail,
  buildTreemapHierarchy,
  CASCADE_OFFSET,
  computeCascadedTreemapLayout,
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

Deno.test("computeCascadedTreemapLayout applies TermViz V8 overhang and collapses containers into blobs", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);
  const root = buildTreemapHierarchy(idx)!;

  const { tiles } = computeCascadedTreemapLayout(root, 1000, 600, { maxDepth: 3 });
  const expandedContainer = tiles.find((t) => t.isContainer && !t.isBlob)!;
  assert(expandedContainer !== undefined, "expected expanded container tile");
  assertEquals(
    expandedContainer.cardW,
    (expandedContainer.x1 - expandedContainer.x0) - CASCADE_OFFSET,
    "expanded container cardW must overhang by CASCADE_OFFSET",
  );
  assertEquals(
    expandedContainer.cardH,
    (expandedContainer.y1 - expandedContainer.y0) - CASCADE_OFFSET,
    "expanded container cardH must overhang by CASCADE_OFFSET",
  );

  // Collapsing a top section turns it into a compact 21px blob and hides its descendants.
  const collapsed = computeCascadedTreemapLayout(root, 1000, 600, {
    maxDepth: 3,
    collapsedIds: new Set([expandedContainer.datum.id]),
  });
  const blobTile = collapsed.tiles.find((t) => t.datum.id === expandedContainer.datum.id)!;
  assertEquals(blobTile.isBlob, true);
  assertEquals(blobTile.cardH, 21);
  assert(collapsed.tiles.length < tiles.length, "collapsing a section must omit its children");
});

Deno.test("computeCascadedTreemapLayout assigns 1-based siblingIndex/siblingCount and exact natural bounds", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);
  const root = buildTreemapHierarchy(idx)!;

  const res = computeCascadedTreemapLayout(root, 1000, 600, { maxDepth: 3, outerLayout: "pack" });
  const depth1 = res.tiles.filter((t) => t.depth === 1);
  assert(depth1.length >= 10);
  depth1.forEach((tile, i) => {
    assertEquals(tile.siblingIndex, i + 1);
    assertEquals(tile.siblingCount, depth1.length);
    assertEquals(tile.parentId, root.id);
  });

  // Exact naturalWidth must not inflate beyond available width when all tiles fit horizontally.
  const maxRight = Math.max(...res.tiles.map((t) => t.x1));
  assert(res.naturalWidth >= maxRight, `naturalWidth (${res.naturalWidth}) must cover rightmost tile (${maxRight})`);
  assert(res.naturalWidth <= 1000, `naturalWidth (${res.naturalWidth}) should fit within 1000px viewport`);
});

Deno.test("#374 relabelBlocklyJsonFromSkeleton preserves human labels over bare at-codes and upgrades stale WT labels", async () => {
  const { relabelBlocklyJsonFromSkeleton } = await import("@intehrgrator/blockly/block_labels.ts");
  const { detectTargetFormat, getTargetFormatHandler, reloadTargetLanguage } = await import(
    "@intehrgrator/core/target/format_handler.ts"
  );

  // 1. OBX MHV1 — mapped: OPT lacks term definitions (at0.6, at0.2, ...), saved mapping has real clinical names.
  const obxOpt = await Deno.readTextFile(
    new URL("./fixtures/Obstetrix-MHV1/target/mhv1-prenatal-visit.encounter.v1.opt", import.meta.url),
  );
  const obxDef = getTargetFormatHandler(detectTargetFormat("t.opt", obxOpt)).load("t.opt", obxOpt);
  const obxSaved = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/Obstetrix-MHV1/mapping/mapping.blockly.json", import.meta.url),
    ),
  ) as BlocklyWorkspaceJson;
  const obxRelabeled = relabelBlocklyJsonFromSkeleton(obxSaved, obxDef.skeleton);
  const obxRoot = buildTreemapHierarchy(indexDocument(obxRelabeled))!;
  assertEquals(obxRoot.children[0].label, "General information");
  assertEquals(obxRoot.children[0].children[0].label, "Body weight");
  assertEquals(obxRoot.children[1].label, "Social summary");

  // 2. MHV1 Web Template: path-exact labels avoid cross-archetype at0.2/at0004.1 collisions.
  const wtText = await Deno.readTextFile(MHV1_WT_URL);
  const wtDef = getTargetFormatHandler(detectTargetFormat("t.wt.json", wtText)).load("t.wt.json", wtText);
  const mhv1Saved = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const wtRelabeled = relabelBlocklyJsonFromSkeleton(mhv1Saved, wtDef.skeleton);
  const wtRoot = buildTreemapHierarchy(indexDocument(wtRelabeled))!;
  assertEquals(wtRoot.children[0].children[0].label, "Body weight during registration");
  assertEquals(wtRoot.children[1].children[0].label, "Living arrangement");
  assertEquals(wtRoot.children[1].children[1].label, "Occupation details");
  assertEquals(wtRoot.children[2].children[0].label, "Problem/Diagnosis screening questionnaire");

  // 3. MHV1 OPT2: root label uses template root (not alphabetical Blood transfusion.v1)
  //    and reloadTargetLanguage re-reads OPT2 rather than falling back to lossy generic section/observation labels.
  const opt2Text = await Deno.readTextFile(
    new URL(
      "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.opt2",
      import.meta.url,
    ),
  );
  const opt2Def = getTargetFormatHandler(detectTargetFormat("t.opt2", opt2Text)).load("t.opt2", opt2Text);
  assertEquals(opt2Def.skeleton[0]?.label, "MHV1- Encounter.v1");
  const opt2En = reloadTargetLanguage(opt2Def, "en");
  assertEquals(opt2En.skeleton[0]?.label, "MHV1- Encounter.v1");
  assert(
    !opt2En.skeleton[0]?.children.some((c) => c.label === "section"),
    "reloading OPT2 language must not replace nodes with generic 'section' labels",
  );
});

Deno.test("computeCascadedTreemapLayout defaults to columns mode ordering outermost tiles top-to-bottom", async () => {
  const doc = JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
  const idx = indexDocument(doc);
  const root = buildTreemapHierarchy(idx)!;
  const cols = computeCascadedTreemapLayout(root, 960, 420, {
    maxDepth: 3,
  });
  const depth1 = cols.tiles.filter((t) => t.depth === 1);
  assert(depth1.length >= 10, "expected >=10 depth-1 sections in MHV1");

  // Group depth-1 tiles by column x0; within each column y0 strictly increases,
  // and each new column begins to the right of the previous column.
  let prevColX = -1;
  let prevY = -1;
  let columnCount = 0;
  for (let i = 0; i < depth1.length; i++) {
    const t = depth1[i];
    assertEquals(t.siblingIndex, i + 1);
    if (t.x0 !== prevColX) {
      assert(t.x0 > prevColX, `columns must advance strictly to the right (${t.x0} > ${prevColX})`);
      assertEquals(t.y0, 8, "each new column must start at top outer padding (8px)");
      prevColX = t.x0;
      prevY = t.y0;
      columnCount++;
    } else {
      assert(t.y0 > prevY, `items within a column must flow top-to-bottom (${t.y0} > ${prevY})`);
      prevY = t.y0;
    }
  }
  assert(columnCount >= 2, `expected multiple columns at height 420, got ${columnCount}`);
  assert(cols.naturalWidth > 960, `expected columns to extend horizontally for sideways scrolling (${cols.naturalWidth})`);
});

