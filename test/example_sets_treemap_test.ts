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

Deno.test("OBX MHV1 preserves HISTORY labels, MHV1 WT has zero Ad hoc heading/Rubrik (EN & SV), and OPT2 v0.18 fixtures resolve terms", async () => {
  const { generateSkeleton } = await import("@intehrgrator/core/skeleton/generate_skeleton.ts");

  // 1. OBX MHV1 HISTORY blocks keep "history" instead of being overwritten by bare at0002/at0001.
  const obxOptPath = resolve(CATALOG_DIR, "../test/fixtures/Obstetrix-MHV1/target/mhv1-prenatal-visit.encounter.v1.opt");
  const obxMapPath = resolve(CATALOG_DIR, "../test/fixtures/Obstetrix-MHV1/mapping/mapping.blockly.json");
  const obxSkel = generateSkeleton(await Deno.readTextFile(obxOptPath), { filename: obxOptPath, language: "en" }).skeleton;
  const obxRelabeled = relabelBlocklyJsonFromSkeleton(
    JSON.parse(await Deno.readTextFile(obxMapPath)) as BlocklyWorkspaceJson,
    obxSkel,
  );
  const historyNames: string[] = [];
  const collectHistory = (b: Record<string, unknown> | undefined) => {
    if (!b) return;
    if (b.type === "history" && b.fields && typeof (b.fields as Record<string, unknown>).NAME === "string") {
      historyNames.push(String((b.fields as Record<string, unknown>).NAME));
    }
    const inputs = (b.inputs ?? {}) as Record<string, { block?: Record<string, unknown>; shadow?: Record<string, unknown> }>;
    for (const inp of Object.values(inputs)) {
      collectHistory(inp.block);
      collectHistory(inp.shadow);
    }
    const next = b.next as { block?: Record<string, unknown>; shadow?: Record<string, unknown> } | undefined;
    collectHistory(next?.block);
    collectHistory(next?.shadow);
  };
  for (const top of (obxRelabeled.blocks?.blocks ?? []) as Array<Record<string, unknown>>) {
    collectHistory(top);
  }
  assert(historyNames.length >= 2, `expected HISTORY blocks in OBX MHV1, got ${historyNames.length}`);
  for (const name of historyNames) {
    assert(!BARE_AT_RE.test(name), `HISTORY block header must not downgrade to bare at-code, got "${name}"`);
  }

  // 2. MHV1 WT has zero "Ad hoc heading" (EN) and zero "Rubrik" (SV), including nested Current pregnancy sections.
  const mhv1WtPath = resolve(
    CATALOG_DIR,
    "../test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json",
  );
  const mhv1WtText = await Deno.readTextFile(mhv1WtPath);
  for (const lang of ["en", "sv"] as const) {
    const skel = getTargetFormatHandler("openehr-template").load(mhv1WtPath, mhv1WtText, { language: lang }).skeleton;
    const badSections: string[] = [];
    const walkSkel = (nodes: typeof skel) => {
      for (const n of nodes) {
        if (n.rmType === "SECTION" && (n.label === "Ad hoc heading" || n.label === "Rubrik")) {
          badSections.push(`${n.slotId}: ${n.label}`);
        }
        walkSkel(n.children);
      }
    };
    walkSkel(skel);
    assertEquals(badSections, [], `MHV1 WT (${lang}) still had generic section headings: ${badSections.join(", ")}`);
  }

  // 3. Regenerated MHV1 & Partogram .opt2 fixtures resolve >99% of labels with ehrtslib@v0.18.
  for (const rel of [
    "../test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.opt2",
    "../test/fixtures/Obstetric-legacy-via-generic-entry/partogram/target-schema/partogram.v1.opt2",
  ]) {
    const full = resolve(CATALOG_DIR, rel);
    const skel = generateSkeleton(await Deno.readTextFile(full), { filename: full, language: "en" }).skeleton;
    let bare = 0;
    const count = (nodes: typeof skel) => {
      for (const n of nodes) {
        if (BARE_AT_RE.test(String(n.label ?? "").trim())) bare++;
        count(n.children);
      }
    };
    count(skel);
    assert(bare <= 5, `${rel}: expected <= 5 bare at/id-codes with ehrtslib@v0.18, got ${bare}`);
  }
});

Deno.test("Dummy JSON outputs JSON across all 5 engines, and openEHR canonical-xml validates across Preview, TS, XQuery, Go Template, and Handlebars", async () => {
  const { ensureXQueryRuntime } = await import("@intehrgrator/core/codegen/run_xquery.ts");
  const { checkVmsHbs } = await import("@intehrgrator/core/output/vms_hbs.ts");
  const { checkVmsGo } = await import("@intehrgrator/core/output/vms_go.ts");
  await ensureGoTemplateWasm();
  await ensureXQueryRuntime();

  // 1. dummy-json-vitals-mapped must output valid JSON in EVERY runnable mode (never XML).
  {
    const svc = new WorkbenchService();
    await callAgentTool(svc, "load_example_set", {
      catalogPath: CATALOG_PATH,
      setId: "dummy-json-vitals-mapped",
      includeMapping: true,
    });
    for (const outputMode of ["preview", "typescript", "xquery", "go-template", "handlebars"] as const) {
      const run = await callAgentTool(svc, "run_test", { outputMode }) as {
        testResult: { ok: boolean; output: unknown; error?: string };
      };
      assertEquals(run.testResult.ok, true, `dummy-json-vitals-mapped (${outputMode}): ${run.testResult.error}`);
      const obj = typeof run.testResult.output === "string"
        ? JSON.parse(run.testResult.output)
        : run.testResult.output;
      assertEquals(obj, { systolic: 120, diastolic: 80, unit: "mm[Hg]" }, `dummy-json-vitals-mapped (${outputMode}) must emit exact JSON`);
    }
  }

  // 2. Helper to switch COMPOSITION.INSTANCE_ENCODING on a Blockly workspace JSON.
  const setEncoding = (blockly: unknown, enc: string): BlocklyWorkspaceJson => {
    const clone = structuredClone(blockly) as BlocklyWorkspaceJson;
    const walk = (b: Record<string, unknown> | undefined) => {
      if (!b) return;
      if (b.type === "composition" && b.fields) {
        (b.fields as Record<string, unknown>).INSTANCE_ENCODING = enc;
      }
      const inputs = (b.inputs ?? {}) as Record<string, { block?: Record<string, unknown>; shadow?: Record<string, unknown> }>;
      for (const inp of Object.values(inputs)) {
        walk(inp.block);
        walk(inp.shadow);
      }
      const next = b.next as { block?: Record<string, unknown>; shadow?: Record<string, unknown> } | undefined;
      walk(next?.block);
      walk(next?.shadow);
    };
    for (const top of (clone.blocks?.blocks ?? []) as Array<Record<string, unknown>>) walk(top);
    return clone;
  };

  // 3. OpenEHR sets in BOTH canonical-xml AND canonical-json across Preview, TS, XQuery, Go Template, and Handlebars.
  const openEhrCases: Array<{ setId: string; encodings: Array<"canonical-json" | "canonical-xml">; modes: Array<"preview" | "typescript" | "xquery" | "go-template" | "handlebars"> }> = [
    { setId: "Simple-vitals", encodings: ["canonical-json", "canonical-xml"], modes: ["preview", "typescript", "xquery", "go-template", "handlebars"] },
    { setId: "Simple-vitals-series", encodings: ["canonical-json", "canonical-xml"], modes: ["preview", "typescript", "xquery", "go-template", "handlebars"] },
    { setId: "obx-mhv1-mapped-json-to-openehr", encodings: ["canonical-xml"], modes: ["preview", "typescript", "xquery", "go-template", "handlebars"] },
    { setId: "karda-ordinationsdata-to-openehr-flat", encodings: ["canonical-xml"], modes: ["preview", "typescript", "xquery"] },
    { setId: "mhv1-generic-entry-flat-wt", encodings: ["canonical-xml"], modes: ["preview", "typescript", "xquery", "go-template", "handlebars"] },
  ];

  for (const tc of openEhrCases) {
    for (const enc of tc.encodings) {
      const svc = new WorkbenchService();
      await callAgentTool(svc, "load_example_set", {
        catalogPath: CATALOG_PATH,
        setId: tc.setId,
        includeMapping: true,
      });
      const tree = await callAgentTool(svc, "get_source_tree", {}) as {
        examples: Array<{ id: string; filename: string }>;
      };
      const firstValid = tree.examples.find((ex) => !/(?:invalid|broken|fail|bad)/i.test(ex.filename));
      assert(firstValid, `${tc.setId}: expected valid example`);
      await callAgentTool(svc, "set_active_example", { id: firstValid.id });
      const st = svc.controller.getState();
      const encBlockly = setEncoding(st.blocklyState, enc);
      const ex = extractModelFromBlocklyJson(encBlockly, st.skeleton);
      svc.controller.syncFromBlockly(encBlockly, ex.slots, ex.loops, ex.optionalRm, {
        targetSignature: ex.targetSignature,
        unsupported: ex.unsupported,
        sheetNames: ex.sheetNames,
        instanceEncodings: ex.instanceEncodings,
        functions: ex.functions,
        includes: ex.includes,
      });

      for (const outputMode of tc.modes) {
        if (outputMode === "go-template" || outputMode === "handlebars") {
          const gen = await callAgentTool(svc, "generate_script", { language: outputMode }) as { code?: string };
          const vms = outputMode === "handlebars"
            ? checkVmsHbs(gen.code ?? "")
            : await checkVmsGo(gen.code ?? "");
          assertEquals(
            vms.ok,
            true,
            `${tc.setId} (${enc}, ${outputMode}) VMS check failed: ${vms.diagnostics.map((d) => d.message).join("; ")}`,
          );
        }
        const run = await callAgentTool(svc, "run_test", { outputMode }) as {
          testResult: {
            ok: boolean;
            output: unknown;
            error?: string;
            outputValidation?: { applicable?: boolean; valid?: boolean; messages?: Array<{ severity: string; path: string; message: string }> };
          };
        };
        const res = run.testResult;
        assertEquals(res.ok, true, `${tc.setId} (${enc}, ${outputMode}): ${res.error}`);
        if (enc === "canonical-xml") {
          assert(
            typeof res.output === "string" && res.output.trim().startsWith("<"),
            `${tc.setId} (${enc}, ${outputMode}): expected XML output`,
          );
        }
        assertEquals(
          res.outputValidation?.applicable,
          true,
          `${tc.setId} (${enc}, ${outputMode}): expected applicable openEHR validation`,
        );
        const errs = res.outputValidation?.messages?.filter((m) => m.severity === "error") ?? [];
        assertEquals(
          res.outputValidation?.valid,
          true,
          `${tc.setId} (${enc}, ${outputMode}): ${errs.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        );
      }
    }
  }
});

Deno.test("MHV1 Web Template elided ITEM_TREE/HISTORY nodes do not leak CJK or unrelated fallback languages (ehrtslib#338)", async () => {
  const wtRaw = await Deno.readTextFile(
    "test/fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json",
  );
  const { getTargetFormatHandler } = await import("../src/core/target/mod.ts");
  const handler = getTargetFormatHandler("openehr-template");
  assert(handler, "expected openehr-template handler");
  for (const lang of ["en", "sv"]) {
    const def = handler.load("mhv1-prenatal-visit.encounter.v1.wt.json", wtRaw, { language: lang });
    const cjkHits: string[] = [];
    let eddTreeLabel = "";
    const walk = (nodes: typeof def.skeleton) => {
      for (const n of nodes) {
        if (/[\u4e00-\u9fff]/.test(n.label)) {
          cjkHits.push(`${n.slotId}: ${n.label}`);
        }
        if (n.slotId.endsWith("/content/at0.21/items/at0.8/items/at0.2/data/at0002")) {
          eddTreeLabel = n.label;
        }
        walk(n.children);
      }
    };
    walk(def.skeleton);
    assertEquals(cjkHits, [], `MHV1 WT [${lang}] must not contain CJK fallback labels`);
    assert(
      eddTreeLabel && !/[\u4e00-\u9fff]/.test(eddTreeLabel) && !/^at\d/i.test(eddTreeLabel),
      `MHV1 WT [${lang}] EDD ITEM_TREE[at0002] should have a readable RM label, got "${eddTreeLabel}"`,
    );
  }
});


