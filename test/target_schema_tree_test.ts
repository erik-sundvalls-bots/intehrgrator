/**
 * Target schema tree (from Template Skeleton) and pull-to-canvas Blockly.
 * UI chrome (tabs, drag) lives in test/ui/target_schema_tabs_test.ts.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { registerExpressionBlocks } from "@intehrgrator/blockly/blocks/expression_blocks.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { registerRmBlocks } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { registerTargetBlocks } from "@intehrgrator/blockly/blocks/target_blocks.ts";
import {
  loadSkeletonIntoWorkspace,
  placeSkeletonSubtreeOnWorkspace,
} from "@intehrgrator/blockly/skeleton_loader.ts";
import { MAPS_GET } from "@intehrgrator/core/defaults/mod.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import {
  findSkeletonNodeIn,
  parseTargetDragPayload,
  renderTargetSchemaTree,
  TARGET_DRAG_MIME,
  targetSchemaTreeFromSkeleton,
} from "@intehrgrator/workbench/target_schema_tree.ts";
import { renderSchemaTree } from "@intehrgrator/workbench/tree_views.ts";
import "blockly/blocks";

const opt = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);
const jsonSchema = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "dummy-json-vitals", "target.schema.json"),
);

function walkRm(nodes: SkeletonNode[], rmType: string): SkeletonNode | undefined {
  return findBy(nodes, (node) => node.rmType === rmType || node.blockType === rmType.toLowerCase());
}

function findBy(
  nodes: SkeletonNode[],
  pred: (node: SkeletonNode) => boolean,
): SkeletonNode | undefined {
  for (const node of nodes) {
    if (pred(node)) return node;
    const nested = findBy(node.children, pred);
    if (nested) return nested;
  }
  return undefined;
}

function loadBpSkeleton(): SkeletonNode[] {
  return getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt).skeleton;
}

let blocksReady = false;
function ensureBlocks(): void {
  if (blocksReady) return;
  registerRmBlocks();
  registerExpressionBlocks();
  registerMapBlocks();
  registerTargetBlocks();
  blocksReady = true;
}

Deno.test("Target schema tree includes COMPOSITION and systolic ELEMENT from the OPT", () => {
  const skeleton = loadBpSkeleton();
  const tree = targetSchemaTreeFromSkeleton(skeleton);
  assert(tree.length >= 1, "expected a target root");
  assertEquals(tree[0]?.type, "COMPOSITION");
  const systolic = findSkeletonNodeIn(
    skeleton,
    findBy(skeleton, (n) => (n.slotId ?? "").includes("at0004"))?.slotId ?? "",
  );
  assert(systolic, "blood pressure OPT must expose systolic at0004");
  const paths: string[] = [];
  const collect = (nodes: typeof tree) => {
    for (const node of nodes) {
      paths.push(node.path);
      collect(node.children);
    }
  };
  collect(tree);
  assert(
    paths.some((path) => path.includes("at0004")),
    `expected systolic at0004 in Target schema tree, got ${paths.slice(0, 12).join(", ")}…`,
  );
});

Deno.test("parseTargetDragPayload reads slotId from MIME JSON and text/plain", () => {
  const dt = {
    getData: (type: string) =>
      type === TARGET_DRAG_MIME || type === "text/plain"
        ? JSON.stringify({ slotId: "bp/content[at0000]" })
        : "",
  } as DataTransfer;
  assertEquals(parseTargetDragPayload(dt)?.slotId, "bp/content[at0000]");

  const plain = {
    getData: (type: string) => type === "text/plain" ? "template/items/at0004" : "",
  } as DataTransfer;
  assertEquals(parseTargetDragPayload(plain)?.slotId, "template/items/at0004");
});

Deno.test("pulling an OBSERVATION subtree onto the canvas adds RM blocks without clearing COMPOSITION", () => {
  ensureBlocks();
  const skeleton = loadBpSkeleton();
  const observation = walkRm(skeleton, "OBSERVATION");
  assert(observation, "expected an OBSERVATION in the blood pressure skeleton");

  const workspace = new Blockly.Workspace();
  try {
    loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
    const compositionId = workspace.getAllBlocks(false).find((b) => b.type === "composition")?.id;
    assert(compositionId, "full scaffold must include COMPOSITION");
    const beforeObs = workspace.getAllBlocks(false).filter((b) => b.type === "observation").length;

    const placed = placeSkeletonSubtreeOnWorkspace(workspace, observation, {
      x: 420,
      y: 40,
      skeleton,
      targetFormat: "openehr-template",
    });
    assert(placed, "expected Blockly for the pulled OBSERVATION");
    assertEquals(placed.type, "observation");

    const still = workspace.getAllBlocks(false).find((b) => b.id === compositionId);
    assert(still, "existing COMPOSITION must survive a subtree pull");
    const afterObs = workspace.getAllBlocks(false).filter((b) => b.type === "observation");
    assert(
      afterObs.length === beforeObs + 1,
      `expected one extra observation, before=${beforeObs} after=${afterObs.length}`,
    );
    assert(
      workspace.getTopBlocks(false).some((b) => b.id === placed.id),
      "pulled subtree must be a detached top stack",
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("pulling a COMPOSITION root joins Default points from the canvas Defaults Map", () => {
  ensureBlocks();
  const skeleton = loadBpSkeleton();
  const root = skeleton[0];
  assert(root, "expected COMPOSITION skeleton root");

  const workspace = new Blockly.Workspace();
  try {
    loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "sv");
    const originalIds = new Set(workspace.getAllBlocks(false).map((b) => b.id));
    const placed = placeSkeletonSubtreeOnWorkspace(workspace, root, {
      x: 480,
      y: 20,
      skeleton,
      targetFormat: "openehr-template",
    });
    assert(placed, "expected pulled COMPOSITION");
    assertEquals(placed.type, "composition");
    const newLookups = workspace.getAllBlocks(false).filter((b) =>
      !originalIds.has(b.id) && b.type === MAPS_GET
    );
    assert(
      newLookups.length > 0,
      "pulled COMPOSITION must scaffold Default points from the current Defaults Map",
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("pulling a JSON Schema leaf yields a schema/target Blockly block", () => {
  ensureBlocks();
  const target = getTargetFormatHandler("json-schema").load(
    "target.schema.json",
    jsonSchema,
  );
  const systolic = findBy(
    target.skeleton,
    (n) => n.label.toLowerCase() === "systolic" || n.slotId.toLowerCase().includes("systolic"),
  );
  assert(systolic, "JSON Schema target must expose systolic");

  const workspace = new Blockly.Workspace();
  try {
    loadSkeletonIntoWorkspace(
      workspace,
      target.skeleton,
      createEmptyModel(target.targetId),
      null,
      "en",
      "json-schema",
    );
    const placed = placeSkeletonSubtreeOnWorkspace(workspace, systolic, {
      x: 200,
      y: 80,
      skeleton: target.skeleton,
      targetFormat: "json-schema",
    });
    assert(placed, "expected Blockly for the pulled systolic leaf");
    assert(
      placed.type === "target_value" ||
        placed.type.startsWith("schema_") ||
        Boolean(placed.getFieldValue("SLOT_ID")),
      `unexpected block type ${placed.type}`,
    );
    assert(
      String(placed.getFieldValue("SLOT_ID") || placed.getFieldValue("TARGET_TYPE") || "")
        .toLowerCase()
        .includes("systolic") ||
        systolic.slotId === placed.getFieldValue("SLOT_ID"),
      `pulled leaf should keep the systolic slot, slotId=${placed.getFieldValue("SLOT_ID")}`,
    );
  } finally {
    workspace.dispose();
  }
});

Deno.test("openEHR target tree discloses optional RM independently of the source tree", async () => {
  const { JSDOM } = await import("npm:jsdom@25");
  const dom = new JSDOM("<!doctype html><body></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const skeleton = loadBpSkeleton();
    const tree = targetSchemaTreeFromSkeleton(skeleton);
    const target = document.createElement("div");
    const source = document.createElement("div");
    renderTargetSchemaTree(target, tree, () => {}, "empty", { discloseOptionalRm: true });
    renderSchemaTree(source, {
      path: "$",
      name: "text",
      type: "DV_TEXT",
      children: [],
    }, () => {});
    const targetPlus = target.querySelector<HTMLButtonElement>(".tree-rm-toggle");
    const sourcePlus = source.querySelector<HTMLButtonElement>(".tree-rm-toggle");
    assert(targetPlus, "openEHR target root should offer optional RM");
    assert(sourcePlus, "source DV_TEXT should offer optional RM");
    assertEquals(targetPlus.textContent, "+");
    assert(targetPlus.getAttribute("aria-label")?.includes(tree[0]?.name ?? ""));
    assertEquals(targetPlus.querySelector("span")?.getAttribute("aria-hidden"), "true");
    targetPlus.click();
    assert(target.querySelector(".tree-row-rm-optional"), "opening the plus reveals optional attributes");
    assertEquals(target.querySelector(".tree-rm-toggle")?.textContent, "\u2212");
    assertEquals(source.querySelectorAll(".tree-row-rm-optional").length, 0);
    const optional = target.querySelector<HTMLElement>(".tree-row-rm-optional");
    assert(optional && !optional.dataset.slotId, "optional RM rows are not canvas slots");
    assert(target.querySelector<HTMLElement>(".tree-row")?.dataset.slotId, "template rows stay draggable slots");
    target.querySelector<HTMLButtonElement>(".tree-rm-toggle")?.click();
    assertEquals(target.querySelectorAll(".tree-row-rm-optional").length, 0);

    const plain = document.createElement("div");
    renderTargetSchemaTree(plain, tree);
    assertEquals(plain.querySelectorAll(".tree-rm-toggle").length, 0);
    const json = document.createElement("div");
    renderTargetSchemaTree(json, [{
      path: "#/systolic",
      name: "systolic",
      type: "number",
      children: [],
    }], () => {}, "empty", { discloseOptionalRm: true });
    assertEquals(json.querySelectorAll(".tree-rm-toggle").length, 0);
  } finally {
    if (previous) globalThis.document = previous;
    else delete (globalThis as { document?: Document }).document;
  }
});
