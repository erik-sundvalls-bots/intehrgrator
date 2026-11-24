/**
 * Regression tests for scaffolding issues #62, #67, and #118.
 *
 * Spec: docs/prd/prd-openehr-blockly-scaffolding.md (canonical OPT walk,
 * mandatory + silent-mandatory RM only, typed RM blocks).
 */
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import { generateSkeletonFromOperational } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { overlayConceptFallback } from "@intehrgrator/core/skeleton/template_terms.ts";
import { overlayParentScopes, resolveScopeChain } from "ehrtslib/generation/term_scope.ts";
import { detectTargetFormat, getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { registerRmBlocks, rmAttributeInputName } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { loadSkeletonIntoWorkspace } from "@intehrgrator/blockly/skeleton_loader.ts";
import { relabelWorkspaceFromSkeleton } from "@intehrgrator/blockly/block_labels.ts";
import { isSkeletonTitleField } from "@intehrgrator/blockly/field_skeleton_title.ts";
import { setChildBlocksCollapsed } from "@intehrgrator/blockly/skeleton_loader.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { projectBlocklyState } from "@intehrgrator/workbench/mapping_spec/mod.ts";

function occ(lower: number, upper: number | null) {
  return {
    lower,
    upper: upper ?? undefined,
    upper_unbounded: upper == null,
  };
}

function flatten(nodes: SkeletonNode[]): SkeletonNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

const RESPIRATION = "openEHR-EHR-OBSERVATION.respiration.v2";
const PULSE_OX = "openEHR-EHR-OBSERVATION.pulse_oximetry.v1";
const PROBLEM = "openEHR-EHR-EVALUATION.problem_diagnosis.v1";
const SECTION = "openEHR-EHR-SECTION.adhoc.v1";
const BP_PARENT = "openEHR-EHR-OBSERVATION.blood_pressure.v2";
const BP_OVERLAY = "openEHR-EHR-OBSERVATION.ovl-blood_pressure-001.v2";

/** Two sibling observations share at0000; EVALUATION data is RM-mandatory; one event is 0..0. */
export function diagnoseLikeOpt() {
  return {
    template_id: { value: "simple-diagnose-and-vitals" },
    original_language: "en",
    ontology: {
      term_definitions: {
        en: {
          "at0000.1": { text: "simple-diagnose-and-vitals" },
        },
      },
    },
    archetype_term_definitions: {
      [RESPIRATION]: { en: { at0000: { text: "Respiration" } } },
      [PULSE_OX]: { en: { at0000: { text: "Pulse oximetry" } } },
      [PROBLEM]: {
        en: {
          at0000: { text: "Problem/Diagnosis" },
          at0001: { text: "structure" },
          at0002: { text: "Problem/Diagnosis name" },
        },
      },
      [SECTION]: { en: { at0000: { text: "Vital signs" } } },
      [BP_PARENT]: {
        en: {
          at0000: { text: "Blood pressure" },
          at0004: { text: "Systolic" },
        },
      },
      [BP_OVERLAY]: { en: { "ac0.1": { text: "overlay-only" } } },
    },
    definition: {
      rm_type_name: "COMPOSITION",
      node_id: "at0000",
      archetype_ref: "openEHR-EHR-COMPOSITION.encounter.v1",
      occurrences: occ(1, 1),
      attributes: [
        {
          rm_attribute_name: "content",
          children: [
            {
              rm_type_name: "EVALUATION",
              node_id: "at0000",
              archetype_ref: PROBLEM,
              term_archetype_scope: PROBLEM,
              occurrences: occ(0, 1),
              attributes: [{
                rm_attribute_name: "data",
                children: [{
                  rm_type_name: "ITEM_TREE",
                  node_id: "at0001",
                  term_archetype_scope: PROBLEM,
                  attributes: [{
                    rm_attribute_name: "items",
                    children: [
                      {
                        rm_type_name: "ELEMENT",
                        node_id: "at0002",
                        term_archetype_scope: PROBLEM,
                        attributes: [],
                      },
                      {
                        rm_type_name: "ELEMENT",
                        node_id: "at9999",
                        term_archetype_scope: PROBLEM,
                        occurrences: occ(0, 0),
                        attributes: [],
                      },
                    ],
                  }],
                }],
              }],
            },
            {
              rm_type_name: "SECTION",
              node_id: "at0000",
              archetype_ref: SECTION,
              term_archetype_scope: SECTION,
              occurrences: occ(0, 1),
              attributes: [{
                rm_attribute_name: "items",
                children: [
                  observation(RESPIRATION, "at0000"),
                  observation(PULSE_OX, "at0000"),
                  {
                    rm_type_name: "OBSERVATION",
                    node_id: "at0.6",
                    archetype_ref: BP_OVERLAY,
                    term_archetype_scope: BP_OVERLAY,
                    term_name_fallback_node_id: "at0.6",
                    occurrences: occ(0, 1),
                    attributes: [{
                      rm_attribute_name: "data",
                      children: [{
                        rm_type_name: "HISTORY",
                        node_id: "at0001",
                        term_archetype_scope: BP_PARENT,
                        attributes: [{
                          rm_attribute_name: "events",
                          children: [
                            {
                              rm_type_name: "POINT_EVENT",
                              node_id: "at0006",
                              term_archetype_scope: BP_PARENT,
                              attributes: [{
                                rm_attribute_name: "data",
                                children: [{
                                  rm_type_name: "ITEM_TREE",
                                  node_id: "at0003",
                                  term_archetype_scope: BP_OVERLAY,
                                  attributes: [{
                                    rm_attribute_name: "items",
                                    children: [{
                                      rm_type_name: "ELEMENT",
                                      node_id: "at0004",
                                      term_archetype_scope: BP_OVERLAY,
                                      attributes: [],
                                    }],
                                  }],
                                }],
                              }],
                            },
                            {
                              rm_type_name: "INTERVAL_EVENT",
                              node_id: "at1042",
                              term_archetype_scope: BP_PARENT,
                              occurrences: occ(0, 0),
                            },
                          ],
                        }],
                      }],
                    }],
                  },
                ],
              }],
            },
          ],
        },
      ],
    },
  };
}

function observation(archetypeRef: string, nodeId: string) {
  return {
    rm_type_name: "OBSERVATION",
    node_id: nodeId,
    archetype_ref: archetypeRef,
    term_archetype_scope: archetypeRef,
    occurrences: occ(0, 1),
    attributes: [{
      rm_attribute_name: "data",
      children: [{
        rm_type_name: "HISTORY",
        node_id: "at0001",
        term_archetype_scope: archetypeRef,
        attributes: [],
      }],
    }],
  };
}

Deno.test("#67 colliding at0000 siblings get distinct slotIds and keep labels after relabel", () => {
  const { skeleton } = generateSkeletonFromOperational(diagnoseLikeOpt());
  const observations = flatten(skeleton).filter((n) => n.rmType === "OBSERVATION");
  assertEquals(observations.map((n) => n.label).sort(), [
    "Blood pressure",
    "Pulse oximetry",
    "Respiration",
  ]);
  const slotIds = observations.map((n) => n.slotId);
  assertEquals(new Set(slotIds).size, slotIds.length, `duplicate observation slotIds: ${slotIds.join(", ")}`);
  const langSlots = flatten(skeleton)
    .filter((n) => n.rmAttribute === "language" && n.rmType === "CODE_PHRASE")
    .map((n) => n.slotId);
  const entryLangSlots = langSlots.filter((id) => id.includes("/content/"));
  assertEquals(
    new Set(entryLangSlots).size,
    entryLangSlots.length,
    `duplicate ENTRY language slotIds: ${entryLangSlots.join(", ")}`,
  );
  const systolic = flatten(skeleton).find((n) => n.rmType === "ELEMENT" && n.archetypeNodeId === "at0004");
  assertEquals(
    systolic?.label,
    "Systolic",
    "overlay-scoped inner node uses parent at-code, not the overlay concept title",
  );

  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  relabelWorkspaceFromSkeleton(workspace, skeleton);
  const names = workspace.getAllBlocks(false)
    .filter((b) => b.type === "observation")
    .map((b) => String(b.getFieldValue("NAME")))
    .sort();
  assertEquals(names, ["Blood pressure", "Pulse oximetry", "Respiration"]);
  workspace.dispose();
});

Deno.test("#62 every ENTRY language and encoding is a Defaults Map lookup", () => {
  const { skeleton } = generateSkeletonFromOperational(diagnoseLikeOpt());
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  const entries = workspace.getAllBlocks(false).filter((b) =>
    b.type === "observation" || b.type === "evaluation"
  );
  assert(entries.length >= 4, `expected evaluation + observations, got ${entries.length}`);
  for (const entry of entries) {
    const lang = entry.getInputTargetBlock(rmAttributeInputName("language"));
    const enc = entry.getInputTargetBlock(rmAttributeInputName("encoding"));
    assertEquals(
      lang?.type,
      "maps_get",
      `${entry.getFieldValue("NAME")} language should be maps_get, got ${lang?.type}`,
    );
    assertEquals(
      enc?.type,
      "maps_get",
      `${entry.getFieldValue("NAME")} encoding should be maps_get, got ${enc?.type}`,
    );
  }
  workspace.dispose();
});

Deno.test("#118 EVALUATION.data scaffolds ITEM_TREE with a mappable name ELEMENT", () => {
  const { skeleton } = generateSkeletonFromOperational(diagnoseLikeOpt());
  const evaluation = flatten(skeleton).find((n) => n.rmType === "EVALUATION");
  assert(evaluation, "evaluation");
  const data = evaluation.children.find((c) => c.rmAttribute === "data");
  assertEquals(data?.rmType, "ITEM_TREE");
  assertEquals(data?.mandatory, true, "EVALUATION.data is RM 1..1 so the tree is mandatory");
  assertFalse(
    flatten([data!]).some((n) => n.archetypeNodeId === "at9999"),
    "0..0 ELEMENT must not appear on the skeleton",
  );
  const nameEl = flatten([data!]).find((n) => n.rmType === "ELEMENT" && n.archetypeNodeId === "at0002");
  assert(nameEl, "Problem/Diagnosis name ELEMENT");
  const valueShell = nameEl.children.find((c) => c.rmAttribute === "value" && c.rmType === "DV_TEXT");
  assert(valueShell, "ELEMENT without a C_DV_* child still gets a DV_TEXT mapping shell");
  assertEquals(
    valueShell.mandatory,
    false,
    "ELEMENT.value is RM 0..1; optional ELEMENT does not force a mandatory DV_TEXT",
  );

  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  const evalBlock = workspace.getAllBlocks(false).find((b) => b.type === "evaluation");
  const dataBlock = evalBlock?.getInputTargetBlock(rmAttributeInputName("data"));
  assertEquals(dataBlock?.type, "item_tree", "EVALUATION.data mouth must hold ITEM_TREE");
  const nameBlock = workspace.getAllBlocks(false).find((b) =>
    b.type === "element" && String(b.getFieldValue("NAME")) === "Problem/Diagnosis name"
  );
  assert(nameBlock, "template ELEMENT stays visible under EVALUATION.data");
  workspace.dispose();
});

Deno.test("#118 prohibited INTERVAL_EVENT 0..0 is not scaffolded as a math_function pick", () => {
  const { skeleton } = generateSkeletonFromOperational(diagnoseLikeOpt());
  assertFalse(
    flatten(skeleton).some((n) => n.rmType === "INTERVAL_EVENT"),
    "occurrences 0..0 INTERVAL_EVENT must be omitted",
  );

  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  const mathPicks = workspace.getAllBlocks(false).filter((b) =>
    b.type === "term_pick" && String(b.getFieldValue("SET")).includes("event_math_function")
  );
  assertEquals(mathPicks.length, 0, "no event math function term_picks");
  const projection = projectBlocklyState(Blockly.serialization.workspaces.save(workspace));
  assertFalse(
    projection.lines.some((line) =>
      line.type === "term_pick" && (line.summary ?? "").toLowerCase().includes("event math")
    ),
    "mapping spec must not list orphan event math function picks",
  );
  workspace.dispose();
});

Deno.test("Better overlay ids resolve to the specialised parent archetype", () => {
  const overlay = "openEHR-EHR-OBSERVATION.ovl-blood_pressure-001.v2";
  assertEquals(
    overlayParentScopes(overlay),
    ["openEHR-EHR-OBSERVATION.blood_pressure.v2"],
  );
  const bags = {
    "openEHR-EHR-OBSERVATION.ovl-blood_pressure-001.v2": {
      "ac0.1": { text: "overlay-only" },
    },
    "openEHR-EHR-OBSERVATION.blood_pressure.v1": {
      at0000: { text: "Blood pressure" },
    },
  };
  // Exact parent version is always first; other present versions follow.
  assertEquals(
    overlayParentScopes(overlay, Object.keys(bags)),
    [
      "openEHR-EHR-OBSERVATION.blood_pressure.v2",
      "openEHR-EHR-OBSERVATION.blood_pressure.v1",
    ],
  );
  assertEquals(
    resolveScopeChain(overlay, Object.keys(bags)),
    [overlay, "openEHR-EHR-OBSERVATION.blood_pressure.v1"],
  );
  // Last-resort title when the parent bag has no term; still local.
  assertEquals(overlayConceptFallback(overlay), "Blood Pressure");
});

Deno.test("Better .t.json is not parsed as a Web Template", () => {
  const tjson = JSON.stringify({
    "@type": "TEMPLATE",
    templateId: "simple-diagnose-and-vitals",
    archetypeId: { value: "openEHR-EHR-COMPOSITION.encounter.v1" },
    definition: { "@type": "C_COMPLEX_OBJECT", rmTypeName: "COMPOSITION" },
  });
  assertEquals(detectTargetFormat("simple-diagnose-and-vitals.json", tjson), "openehr-template");
  const err = assertThrows(() => {
    getTargetFormatHandler("openehr-template").load("simple-diagnose-and-vitals.t.json", tjson);
  });
  assert(
    String(err).includes(".t.json") && String(err).toLowerCase().includes("github"),
    `expected GitHub .t.json guidance, got ${err}`,
  );
  assertFalse(String(err).toLowerCase().includes("web template"));
});

Deno.test("#187 scaffolded ELEMENT stays ELEMENT and the DV shell does not take the node name", () => {
  const { skeleton } = generateSkeletonFromOperational(diagnoseLikeOpt());
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  relabelWorkspaceFromSkeleton(workspace, skeleton);

  const systolic = workspace.getAllBlocks(false).find((b) =>
    b.type === "element" && String(b.getFieldValue("NAME")) === "Systolic"
  );
  assert(systolic, "expected Systolic ELEMENT");
  const title = systolic.getField("NAME");
  assert(isSkeletonTitleField(title));
  assertEquals(title.classNameText(), "ELEMENT");

  const shells = workspace.getAllBlocks(false).filter((b) =>
    b.type !== "element" && b.type !== "term_pick" && String(b.getFieldValue("RM_TYPE") || "").startsWith("DV_")
  );
  assert(shells.length > 0, "expected at least one DV shell");
  for (const shell of shells) {
    const shellTitle = shell.getField("NAME");
    if (!isSkeletonTitleField(shellTitle)) continue;
    const name = String(shellTitle.getValue() || "");
    assertEquals(name === "Systolic" || name === "Problem/Diagnosis name", false, name);
  }
  workspace.dispose();
});

Deno.test("#194 collapse children folds nested blocks and leaves the parent expanded", () => {
  registerRmBlocks();
  const workspace = new Blockly.Workspace();
  const parent = workspace.newBlock("cluster");
  const child = workspace.newBlock("element");
  const input = parent.getInput(rmAttributeInputName("items"));
  assert(input?.connection && child.previousConnection);
  input.connection.connect(child.previousConnection);
  setChildBlocksCollapsed(parent, true);
  assertEquals(parent.isCollapsed(), false);
  assertEquals(child.isCollapsed(), true);
  setChildBlocksCollapsed(parent, false);
  assertEquals(child.isCollapsed(), false);
  workspace.dispose();
});
