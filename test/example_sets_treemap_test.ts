/**
 * End-to-end catalog guard across all mapped Example Sets in
 * `examples/example-sets.json`:
 * 1. Every mapped set (openEHR, XML Schema, JSON Schema) builds a clean,
 *    readable Treemap hierarchy (no `"Ad hoc heading"` spam, no `"INCLUDE WHEN"`
 *    single-tile collapse, no bare `at`-code depth-1 headings), lays out cleanly
 *    in both `columns` (default) and `pack` modes, and round-trips through
 *    `computeAdaptiveSliceTarget` → `extractSlice` → `graftSlice`.
 * 2. Shared JSON patch helpers support inlined `schema_field` leaves and
 *    protect `decision_table` blocks with `isComplexMapping`.
 * 3. Every mapped set passes strict `outputValidation` in both Preview and
 *    TypeScript (plus Go Template WASM for chemo and Handlebars for lung-MDT).
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, resolve } from "@std/path";
import {
  type BlocklyWorkspaceJson,
  computeAdaptiveSliceTarget,
  extractSlice,
  graftSlice,
  indexDocument,
} from "@intehrgrator/core/slice_engine.ts";
import {
  clearMapping,
  isComplexMapping,
  setLiteralValue,
  setSourceBinding,
} from "@intehrgrator/core/json_patch_helpers.ts";
import {
  buildTreemapHierarchy,
  computeCascadedTreemapLayout,
} from "@intehrgrator/treemap/hierarchy.ts";
import { relabelBlocklyJsonFromSkeleton } from "@intehrgrator/blockly/block_labels.ts";
import {
  detectTargetFormat,
  getTargetFormatHandler,
} from "@intehrgrator/core/target/format_handler.ts";
import { extractModelFromBlocklyJson } from "@intehrgrator/workbench/blockly_sync.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";

const CATALOG_PATH = resolve(import.meta.dirname!, "..", "examples", "example-sets.json");
const CATALOG_DIR = dirname(CATALOG_PATH);
const BARE_AT_RE = /^(?:at|id)\d+(?:\.\d+)*$/i;

interface CatalogEntry {
  id: string;
  title: string;
  target: string;
  mapping?: string;
}

const catalog = JSON.parse(await Deno.readTextFile(CATALOG_PATH)) as { sets: CatalogEntry[] };
const mappedSets = catalog.sets.filter((s) => Boolean(s.mapping));

Deno.test("All mapped Example Sets render cleanly in Treemap (Columns & Pack) and round-trip in Scoped Blockly", async () => {
  assert(mappedSets.length >= 12, `expected >= 12 mapped catalog sets, got ${mappedSets.length}`);

  for (const s of mappedSets) {
    const targetPath = resolve(CATALOG_DIR, s.target);
    const targetText = await Deno.readTextFile(targetPath);
    const def = getTargetFormatHandler(detectTargetFormat(targetPath, targetText))
      .load(targetPath, targetText);
    const raw = JSON.parse(
      await Deno.readTextFile(resolve(CATALOG_DIR, s.mapping!)),
    ) as BlocklyWorkspaceJson;
    const doc = relabelBlocklyJsonFromSkeleton(raw, def.skeleton);

    const idx = indexDocument(doc);
    assert(idx.primaryRootId, `${s.id}: expected non-null primaryRootId`);

    const root = buildTreemapHierarchy(idx);
    assert(root, `${s.id}: buildTreemapHierarchy returned null`);
    assert(root.children.length >= 1, `${s.id}: expected >=1 depth-1 tiles, got 0`);
    assert(
      root.label !== "INCLUDE WHEN",
      `${s.id}: Treemap collapsed to anonymous INCLUDE WHEN root`,
    );
    const done = root.counts.mappedLeaves + root.counts.aiDraftLeaves;
    assert(
      done >= 1,
      `${s.id}: expected >=1 mapped or ai-draft leaf in Treemap, got mapped=${root.counts.mappedLeaves} ai=${root.counts.aiDraftLeaves}`,
    );

    const adHocHeadings = root.children.filter((c) => c.label === "Ad hoc heading");
    assertEquals(
      adHocHeadings.length,
      0,
      `${s.id}: found generic "Ad hoc heading" depth-1 sections`,
    );
    const bareDepth1 = root.children.filter((c) => BARE_AT_RE.test(c.label.trim()));
    assertEquals(
      bareDepth1.map((c) => c.label),
      [],
      `${s.id}: found bare at-code depth-1 headings`,
    );

    // Both default Columns layout and Pack layout must succeed with valid bounds.
    const cols = computeCascadedTreemapLayout(root, 1000, 600, { maxDepth: 3 });
    const pack = computeCascadedTreemapLayout(root, 1000, 600, {
      maxDepth: 3,
      outerLayout: "pack",
    });
    assert(
      cols.tiles.length >= root.children.length,
      `${s.id}: expected >=${root.children.length} columns tiles, got ${cols.tiles.length}`,
    );
    assert(
      pack.tiles.length >= root.children.length,
      `${s.id}: expected >=${root.children.length} pack tiles, got ${pack.tiles.length}`,
    );
    assert(Number.isFinite(cols.naturalWidth) && cols.naturalWidth > 0, `${s.id}: bad cols width`);
    assert(Number.isFinite(pack.naturalWidth) && pack.naturalWidth > 0, `${s.id}: bad pack width`);

    // Adaptive Scoped Blockly extract -> graft round-trip must be lossless.
    const probeId = root.children[0]!.id;
    const targetId = computeAdaptiveSliceTarget(idx, probeId);
    const { sliceJson, handle } = extractSlice(doc, targetId);
    const grafted = graftSlice(doc, handle, sliceJson);
    assertEquals(grafted, doc, `${s.id}: extractSlice -> graftSlice altered canonical JSON`);
  }
});

Deno.test("Schema inline patch helpers work on JSON Schema fields and guard decision_table XML fields", async () => {
  // 1. JSON Schema (`dummy-json-vitals-mapped`): synthetic `schema_field` patching + model extraction.
  const dummyTargetPath = resolve(CATALOG_DIR, "../test/fixtures/dummy-json-vitals/target.schema.json");
  const dummyTarget = getTargetFormatHandler("json-schema").load(
    dummyTargetPath,
    await Deno.readTextFile(dummyTargetPath),
  );
  const dummyDoc = JSON.parse(
    await Deno.readTextFile(resolve(CATALOG_DIR, "../test/fixtures/dummy-json-vitals/mapping.blockly.json")),
  ) as BlocklyWorkspaceJson;
  const dummyIdx = indexDocument(dummyDoc);
  const dummyRoot = buildTreemapHierarchy(dummyIdx)!;
  const systolic = dummyRoot.children.find((c) => c.label === "systolic");
  assert(systolic, "expected systolic schema_field tile");
  assertEquals(isComplexMapping(dummyDoc, systolic.id).complex, false);

  const rebound = setSourceBinding(dummyDoc, systolic.id, "$.bp.sys", "Number");
  const reboundIdx = indexDocument(rebound);
  assertEquals(reboundIdx.nodes.get(systolic.id)?.mappingSummary, "$.bp.sys");

  const withLit = setLiteralValue(rebound, systolic.id, "Number", 125);
  assertEquals(indexDocument(withLit).nodes.get(systolic.id)?.mappingSummary, "125");

  const cleared = clearMapping(withLit, systolic.id);
  assertEquals(indexDocument(cleared).nodes.get(systolic.id)?.status, "mandatory-missing");

  const derived = extractModelFromBlocklyJson(rebound, dummyTarget.skeleton);
  assert(
    derived.slots.some((s) => s.expression.includes("$.bp.sys")),
    "expected rebound schema_field source path in extracted MappingModel",
  );

  // 2. XML Schema with Decision tables (`chemo-symptoms-flat-to-tc-xml-decision-tables`):
  //    repeating TextKeyWord tiles get TermId discriminator labels, and decision_table slots are guarded.
  const chemoDoc = JSON.parse(
    await Deno.readTextFile(
      resolve(
        CATALOG_DIR,
        "../test/fixtures/patient-reported-chemotherapy-symptoms-decision-tables/mapping/mapping.blockly.json",
      ),
    ),
  ) as BlocklyWorkspaceJson;
  const chemoIdx = indexDocument(chemoDoc);
  const discriminated = [...chemoIdx.nodes.values()].filter((n) => n.label.startsWith("TextKeyWord · "));
  assert(
    discriminated.length >= 10,
    `expected TermId-discriminated TextKeyWord labels, got ${discriminated.length}`,
  );
  const dtLeaf = [...chemoIdx.nodes.values()].find(
    (n) =>
      n.type === "schema_field" &&
      n.label === "Note" &&
      /^[a-z0-9_]+(?:\.[a-z0-9_]+)?$/i.test(n.mappingSummary),
  );
  assert(dtLeaf, "expected a decision_table-mapped Note schema_field leaf");
  assertEquals(
    isComplexMapping(chemoDoc, dtLeaf.id).complex,
    true,
    `decision_table leaf (${dtLeaf.mappingSummary}) must trigger isComplexMapping guardrail`,
  );
});

Deno.test("All mapped Example Sets pass Preview, TypeScript, Go Template WASM, and Handlebars validation", async () => {
  // Load vendored Go text/template WASM once so chemo go-template execution is exercised too.
  await ensureGoTemplateWasm();

  for (const s of mappedSets) {
    const service = new WorkbenchService();
    await callAgentTool(service, "load_example_set", {
      catalogPath: CATALOG_PATH,
      setId: s.id,
      includeMapping: true,
    });
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    const firstValid = tree.examples.find((ex) => !/(?:invalid|broken|fail|bad)/i.test(ex.filename));
    assert(firstValid, `${s.id}: expected at least one valid Example Instance`);
    await callAgentTool(service, "set_active_example", { id: firstValid.id });

    for (const outputMode of ["preview", "typescript"] as const) {
      const run = await callAgentTool(service, "run_test", { outputMode }) as {
        valid: boolean;
        testResult: { outputValidation?: { valid?: boolean; messages?: Array<{ message: string }> } };
      };
      assertEquals(
        run.valid,
        true,
        `${s.id} (${outputMode}): ${run.testResult.outputValidation?.messages?.map((m) => m.message).join("; ")}`,
      );
    }

    if (s.id.startsWith("chemo-symptoms-flat-to-tc-xml")) {
      const goRun = await callAgentTool(service, "run_test", { outputMode: "go-template" }) as {
        ok?: boolean;
        testResult: { ok: boolean; output: unknown; error?: string };
      };
      assertEquals(goRun.testResult.ok, true, `${s.id} (go-template): ${goRun.testResult.error}`);
      assert(
        String(goRun.testResult.output).includes("<ProfdocHISMessage"),
        `${s.id}: expected TakeCare XML from Go template WASM`,
      );
    }

    if (s.id.startsWith("lung-mdt-form-to-tc-xml")) {
      const hbsRun = await callAgentTool(service, "run_test", { outputMode: "handlebars" }) as {
        testResult: { ok: boolean; output: unknown; error?: string };
      };
      assertEquals(hbsRun.testResult.ok, true, `${s.id} (handlebars): ${hbsRun.testResult.error}`);
      assert(
        String(hbsRun.testResult.output).includes("<ProfdocHISMessage"),
        `${s.id}: expected TakeCare XML from Handlebars`,
      );
    }
  }
});
