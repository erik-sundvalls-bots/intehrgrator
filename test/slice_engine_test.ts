import { assert, assertEquals } from "@std/assert";
import {
  type BlocklyWorkspaceJson,
  computeAdaptiveSliceTarget,
  countSubtreeBlocks,
  extractSlice,
  graftSlice,
  indexDocument,
  SLICE_NODE_THRESHOLD,
} from "@intehrgrator/core/slice_engine.ts";
import {
  extractModelFromBlocklyJson,
  scaffoldBlocklyFromSkeleton,
} from "@intehrgrator/workbench/blockly_sync.ts";
import { generateTypeScript } from "@intehrgrator/core/codegen/mod.ts";
import {
  filterSkeletonMandatoryOnly,
  generateSkeletonFromWebTemplate,
} from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";

const MHV1_MAPPING_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/mapping/mapping.blockly.json",
  import.meta.url,
);
const MHV1_WT_URL = new URL(
  "./fixtures/Obstetric-legacy-via-generic-entry/MHV1/target-schema/mhv1-prenatal-visit.encounter.v1.wt.json",
  import.meta.url,
);

async function loadMhv1MappingJson(): Promise<BlocklyWorkspaceJson> {
  return JSON.parse(await Deno.readTextFile(MHV1_MAPPING_URL)) as BlocklyWorkspaceJson;
}

Deno.test("indexDocument indexes real MHV1 mapping fast and accurately", async () => {
  const doc = await loadMhv1MappingJson();
  const t0 = performance.now();
  const idx = indexDocument(doc);
  const elapsedMs = performance.now() - t0;

  assertEquals(idx.totalBlocks, 1296);
  assert(idx.compositionId !== null, "expected COMPOSITION root");
  assert(idx.nodes.size > 300, `expected >300 structural nodes, got ${idx.nodes.size}`);
  assert(elapsedMs < 150, `indexDocument took ${elapsedMs.toFixed(1)}ms (expected <150ms)`);

  const comp = idx.nodes.get(idx.compositionId!)!;
  assertEquals(comp.rmType, "COMPOSITION");
  assertEquals(comp.counts.totalLeaves, 308);
  assertEquals(comp.counts.aiDraftLeaves, 6, "MHV1 fixture has 6 AI-draft mapped elements");
});

Deno.test("extractSlice and graftSlice round-trip losslessly on real MHV1 (including .next siblings)", async () => {
  const doc = await loadMhv1MappingJson();
  const idx = indexDocument(doc);

  // Pick a middle SECTION and a middle ENTRY that both have `.next` siblings.
  const sections = [...idx.nodes.values()].filter((n) => n.rmType === "SECTION");
  assert(sections.length >= 3, "expected multiple sections in MHV1");
  const midSection = sections[1];

  const entries = [...idx.nodes.values()].filter((n) =>
    n.rmType === "OBSERVATION" || n.rmType === "EVALUATION"
  );
  assert(entries.length >= 3, "expected multiple entries in MHV1");
  const midEntry = entries[1];

  for (const target of [midSection, midEntry]) {
    const { sliceJson, handle } = extractSlice(doc, target.id);
    // Outer .next must be severed from the slice root so siblings are not mounted.
    assertEquals(sliceJson.blocks?.blocks?.length, 1);
    assertEquals(sliceJson.blocks?.blocks?.[0]?.next, undefined);
    assertEquals(
      countSubtreeBlocks(sliceJson.blocks?.blocks?.[0]),
      target.subtreeBlockCount,
    );

    const grafted = graftSlice(doc, handle, sliceJson);
    assertEquals(grafted, doc);
  }
});

Deno.test("graftSlice preserves cross-slice variables and merges new/renamed variables", () => {
  const doc: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "composition",
          id: "comp_1",
          x: 10,
          y: 20,
          inputs: {
            ATTR_content: {
              block: {
                type: "observation",
                id: "obs_1",
                fields: { NAME: "Obs 1" },
                next: {
                  block: {
                    type: "observation",
                    id: "obs_2",
                    fields: { NAME: "Obs 2" },
                  },
                },
              },
            },
          },
        },
      ],
    },
    variables: [
      { id: "v_other", name: "usedInObs2" },
      { id: "v_shared", name: "oldName" },
    ],
  };

  const { sliceJson, handle } = extractSlice(doc, "obs_1");
  // Simulate Blockly dropping unused v_other, renaming v_shared, and adding v_new.
  sliceJson.variables = [
    { id: "v_shared", name: "renamedVar" },
    { id: "v_new", name: "addedInObs1" },
  ];
  sliceJson.blocks!.blocks![0].fields = { NAME: "Obs 1 Edited" };

  const grafted = graftSlice(doc, handle, sliceJson);
  const varMap = new Map((grafted.variables ?? []).map((v) => [v.id, v.name]));
  assertEquals(varMap.get("v_other"), "usedInObs2", "must never delete variables from other slices");
  assertEquals(varMap.get("v_shared"), "renamedVar", "must apply explicit variable renames");
  assertEquals(varMap.get("v_new"), "addedInObs1", "must append new variables");

  // Sibling obs_2 must still be attached via .next.
  const obs1 = grafted.blocks!.blocks![0].inputs!.ATTR_content.block!;
  assertEquals(obs1.fields?.NAME, "Obs 1 Edited");
  assertEquals(obs1.next?.block?.id, "obs_2");
});

Deno.test("extractSlice collapseUnmappedOptionalClusters collapses only unmapped optional clusters (4B)", () => {
  const doc: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "observation",
          id: "obs_1",
          inputs: {
            ATTR_data: {
              block: {
                type: "cluster",
                id: "cl_opt_unmapped",
                fields: { NAME: "Optional Unmapped", MANDATORY: "" },
                inputs: {
                  ATTR_items: {
                    block: {
                      type: "element",
                      id: "el_1",
                      fields: { NAME: "E1", MANDATORY: "" },
                    },
                  },
                },
                next: {
                  block: {
                    type: "cluster",
                    id: "cl_opt_mapped",
                    fields: { NAME: "Optional Mapped", MANDATORY: "" },
                    inputs: {
                      ATTR_items: {
                        block: {
                          type: "element",
                          id: "el_2",
                          fields: { NAME: "E2", MANDATORY: "" },
                          inputs: {
                            VALUE: {
                              block: {
                                type: "source_query",
                                id: "sq_1",
                                fields: { EXPRESSION: "$.x" },
                              },
                            },
                          },
                        },
                      },
                    },
                    next: {
                      block: {
                        type: "cluster",
                        id: "cl_mand",
                        fields: { NAME: "Mandatory Unmapped", MANDATORY: "1" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  const { sliceJson, handle } = extractSlice(doc, "obs_1", {
    collapseUnmappedOptionalClusters: true,
  });
  assertEquals(handle.autoCollapsedIds, ["cl_opt_unmapped"]);
  const cl1 = sliceJson.blocks!.blocks![0].inputs!.ATTR_data.block!;
  const cl2 = cl1.next!.block!;
  const cl3 = cl2.next!.block!;
  assertEquals(cl1.collapsed, true);
  assertEquals(cl2.collapsed, undefined);
  assertEquals(cl3.collapsed, undefined);
});

Deno.test("computeAdaptiveSliceTarget picks ENTRY below threshold and falls back to CLUSTER above threshold (3B)", () => {
  // Build a synthetic ENTRY with 80 blocks containing a 20-block CLUSTER.
  const makeElements = (prefix: string, count: number) => {
    let head: Record<string, unknown> | undefined;
    let tail: Record<string, unknown> | undefined;
    for (let i = 0; i < count; i++) {
      const el: Record<string, unknown> = {
        type: "element",
        id: `${prefix}_el_${i}`,
        fields: { NAME: `El ${i}` },
      };
      if (!head) head = el;
      if (tail) tail.next = { block: el };
      tail = el;
    }
    return head;
  };

  const doc: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "composition",
          id: "comp",
          inputs: {
            ATTR_content: {
              block: {
                type: "observation",
                id: "small_obs",
                fields: { NAME: "Small Obs" },
                inputs: {
                  ATTR_data: {
                    block: {
                      type: "cluster",
                      id: "small_cl",
                      fields: { NAME: "Small Cl" },
                      inputs: {
                        ATTR_items: { block: makeElements("s", 5) as never },
                      },
                    },
                  },
                },
                next: {
                  block: {
                    type: "observation",
                    id: "big_obs",
                    fields: { NAME: "Big Obs" },
                    inputs: {
                      ATTR_data: {
                        block: {
                          type: "cluster",
                          id: "big_cl_a",
                          fields: { NAME: "Cluster A" },
                          inputs: {
                            ATTR_items: { block: makeElements("a", 40) as never },
                          },
                          next: {
                            block: {
                              type: "cluster",
                              id: "big_cl_b",
                              fields: { NAME: "Cluster B" },
                              inputs: {
                                ATTR_items: { block: makeElements("b", 40) as never },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  const idx = indexDocument(doc);
  assertEquals(computeAdaptiveSliceTarget(idx, "s_el_0", SLICE_NODE_THRESHOLD), "small_obs");
  assertEquals(computeAdaptiveSliceTarget(idx, "a_el_0", SLICE_NODE_THRESHOLD), "big_cl_a");
  assertEquals(computeAdaptiveSliceTarget(idx, "b_el_0", SLICE_NODE_THRESHOLD), "big_cl_b");
});

Deno.test("Invariant B: headless codegen from canonical MHV1 JSON matches direct workspace extraction byte-for-byte", async () => {
  const doc = await loadMhv1MappingJson();
  const wt = await Deno.readTextFile(MHV1_WT_URL);
  const { skeleton, templateId } = generateSkeletonFromWebTemplate(wt);

  const headlessExtract = extractModelFromBlocklyJson(doc, skeleton);
  const model = {
    ...createEmptyModel(templateId),
    slots: headlessExtract.slots,
    loops: headlessExtract.loops,
    optionalRm: headlessExtract.optionalRm,
    instanceEncodings: headlessExtract.instanceEncodings,
    functions: headlessExtract.functions,
    includes: headlessExtract.includes,
  };
  const ts1 = generateTypeScript(model, skeleton);
  assert(ts1.length > 500, "expected substantial generated TypeScript for MHV1");

  // Round-trip a slice and verify byte-identical TypeScript output.
  const idx = indexDocument(doc);
  const obs = [...idx.nodes.values()].find((n) => n.rmType === "OBSERVATION")!;
  const { sliceJson, handle } = extractSlice(doc, obs.id);
  const grafted = graftSlice(doc, handle, sliceJson);
  const headlessExtract2 = extractModelFromBlocklyJson(grafted, skeleton);
  const model2 = {
    ...createEmptyModel(templateId),
    slots: headlessExtract2.slots,
    loops: headlessExtract2.loops,
    optionalRm: headlessExtract2.optionalRm,
    instanceEncodings: headlessExtract2.instanceEncodings,
    functions: headlessExtract2.functions,
    includes: headlessExtract2.includes,
  };
  const ts2 = generateTypeScript(model2, skeleton);
  assertEquals(ts2, ts1);

  // Benchmark headless slice load (< 150ms for <=80-block slice).
  initBlocklyGenerators();
  const t0 = performance.now();
  const ws = new Blockly.Workspace();
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(sliceJson as Record<string, unknown>, ws);
    assert(ws.getAllBlocks(false).length <= 80);
  } finally {
    ws.dispose();
    Blockly.Events.enable();
  }
  const mountMs = performance.now() - t0;
  assert(mountMs < 150, `scoped slice headless load took ${mountMs.toFixed(1)}ms (expected <150ms)`);
});

Deno.test("Pre-scaffolding Full vs Sparse (mandatory only) produces expected node counts while preserving full Target schema", async () => {
  const wt = await Deno.readTextFile(MHV1_WT_URL);
  const { skeleton, templateId } = generateSkeletonFromWebTemplate(wt);

  const sparse = filterSkeletonMandatoryOnly(skeleton);
  const countNodes = (list: typeof skeleton): number =>
    list.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);

  const fullCount = countNodes(skeleton);
  const sparseCount = countNodes(sparse);
  assert(fullCount > 1000, `expected >1000 full skeleton nodes on MHV1, got ${fullCount}`);
  assert(sparseCount < 30, `expected <30 mandatory-only nodes on MHV1, got ${sparseCount}`);
  assert(sparseCount >= 5, `expected root + mandatory RM attrs, got ${sparseCount}`);

  const sparseScaffold = scaffoldBlocklyFromSkeleton(skeleton, createEmptyModel(templateId), {
    scaffoldMode: "sparse",
  });
  const sparseIdx = indexDocument(sparseScaffold.blocklyState as BlocklyWorkspaceJson);
  assert(sparseIdx.compositionId !== null, "sparse scaffold must contain COMPOSITION");
  assert(sparseIdx.totalBlocks < 50, `expected compact sparse canvas, got ${sparseIdx.totalBlocks} blocks`);

  // WorkbenchController keeps full Target schema even when scaffoldMode === "sparse".
  const controller = new WorkbenchController();
  controller.loadTargetContent("mhv1-prenatal-visit.encounter.v1.wt.json", wt, undefined, "replace", "sparse");
  const state = controller.getState();
  assertEquals(state.scaffoldMode, "sparse");
  assertEquals(countNodes(state.skeleton), fullCount, "Target schema tab must retain full template");
});
