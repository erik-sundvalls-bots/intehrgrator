import type { Block } from "blockly/core";
import type { SkeletonNode } from "../types/mod.ts";
import type { BlocklyBlockJson, BlocklyWorkspaceJson } from "../core/slice_engine.ts";
import { archetypeShortName, isGenericRmTypeLabel } from "../core/skeleton/template_terms.ts";
import { isDataValueType } from "../core/rm_mandatory.ts";
import { humanizeRmType, isSkeletonTitleField } from "./field_skeleton_title.ts";
import { isDataValueBlock } from "./blocks/rm_blocks.ts";
import { isTermPickBlock } from "./blocks/term_pick.ts";

const BARE_NODE_CODE_RE = /^(?:at|id)\d+(?:\.\d+)*$/i;

/**
 * True when `label` is empty, a bare openEHR `at`/`id` code (e.g. `at0.6`,
 * `at0004.1`), or a generic RM class placeholder (e.g. `SECTION`, `element`).
 */
export function isUnresolvedSkeletonLabel(
  label: string | undefined,
  rmType?: string,
  archetypeNodeId?: string,
): boolean {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return true;
  if (BARE_NODE_CODE_RE.test(trimmed)) return true;
  if (archetypeNodeId && trimmed === archetypeNodeId.trim()) return true;
  if (isGenericRmTypeLabel(trimmed, rmType)) return true;
  return false;
}

function isBareNodeCodeLabel(
  label: string | undefined,
  archetypeNodeId?: string,
): boolean {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return true;
  if (BARE_NODE_CODE_RE.test(trimmed)) return true;
  if (archetypeNodeId && trimmed === archetypeNodeId.trim()) return true;
  return false;
}

function shouldPreserveExistingLabel(
  existingLabel: string | undefined,
  candidateLabel: string | undefined,
  rmType?: string,
  archetypeNodeId?: string,
): boolean {
  // Never downgrade a human-readable label (even a generic RM label like
  // "history" or "Item tree") to an empty string or bare at/id code ("at0002").
  if (
    !isBareNodeCodeLabel(existingLabel, archetypeNodeId) &&
    isBareNodeCodeLabel(candidateLabel, archetypeNodeId)
  ) {
    return true;
  }
  return !isUnresolvedSkeletonLabel(existingLabel, rmType, archetypeNodeId) &&
    isUnresolvedSkeletonLabel(candidateLabel, rmType, archetypeNodeId);
}

export function skeletonBlockTooltip(node: SkeletonNode): string {
  const parts: string[] = [];
  if (node.archetypeRef) {
    parts.push(node.archetypeRef);
    const short = node.archetypeShortName ?? archetypeShortName(node.archetypeRef);
    if (short && short !== node.archetypeRef) parts.push(`(${short})`);
  }
  if (node.archetypeNodeId) parts.push(node.archetypeNodeId);
  if (node.rmType) parts.push(node.rmType);
  parts.push(node.slotId);
  return parts.join(" · ");
}

export function applySkeletonBlockLabels(block: Block, node: SkeletonNode): void {
  const nameField = block.getField("NAME");
  // `maps_get` (and other lookups) reuse field name NAME for the Map name.
  // Relabel must not overwrite that with the skeleton slot label (e.g. "territory").
  if (isSkeletonTitleField(nameField) && !isTermPickBlock(block)) {
    const existing = String(nameField.getValue() ?? "").trim();
    if (block.type === "element") {
      // Ontology name stays on ELEMENT. Class is always ELEMENT, even when
      // SLOT_ID points at the value child (#187). Never downgrade an existing
      // human label to a bare at-code when the loaded OPT lacks term definitions (#374).
      if (!shouldPreserveExistingLabel(existing, node.label, "ELEMENT", node.archetypeNodeId)) {
        nameField.setValue(node.label);
      }
      nameField.setClassName("ELEMENT");
      nameField.setAtCode(node.archetypeNodeId ?? "");
    } else if (isDataValueShell(block)) {
      // Archetype node names (Rate, Systolic, …) belong on the ELEMENT only.
      const rmType = node.rmType || String(block.getFieldValue("RM_TYPE") || "");
      nameField.setValue(humanizeRmType(rmType));
      if (rmType) nameField.setClassName(rmType);
      nameField.setAtCode("");
    } else {
      if (!shouldPreserveExistingLabel(existing, node.label, node.rmType, node.archetypeNodeId)) {
        nameField.setValue(node.label);
      }
      if (node.rmType) nameField.setClassName(node.rmType);
      nameField.setAtCode(node.archetypeNodeId ?? "");
    }
    nameField.setDocumentation(node.documentation);
  } else if (node.archetypeNodeId && block.type !== "element") {
    setFieldIfPresent(block, "AT_CODE", node.archetypeNodeId);
  } else if (block.type === "element" && node.archetypeNodeId) {
    setFieldIfPresent(block, "ARCHETYPE_NODE_ID", node.archetypeNodeId);
  }
  if (node.archetypeRef) {
    const short = node.archetypeShortName ?? archetypeShortName(node.archetypeRef);
    setFieldIfPresent(block, "ARCHETYPE_CTX", short);
  }
  block.setTooltip(skeletonBlockTooltip(node));
}

/** Update NAME / ontology labels on existing workspace blocks from a new skeleton. */
export function relabelWorkspaceFromSkeleton(
  workspace: { getAllBlocks: (ordered?: boolean) => Block[] },
  skeleton: SkeletonNode[],
): void {
  const bySlot = new Map<string, SkeletonNode>();
  walkSkeleton(skeleton, (node) => bySlot.set(node.slotId, node));
  for (const block of workspace.getAllBlocks(false)) {
    const slotId = labelSlotId(block);
    if (!slotId) continue;
    const node = bySlot.get(slotId);
    if (node) applySkeletonBlockLabels(block, node);
  }
}

const NON_SKELETON_NAME_BLOCK_TYPES = new Set([
  "maps_get",
  "maps_set",
  "maps_has",
  "maps_delete",
  "term_pick",
  "decision_table_eval",
  "sheet_lookup",
]);

function jsonBlockLabelSlotId(block: BlocklyBlockJson): string {
  const fields = block.fields ?? {};
  if (block.type === "element") {
    const stored = String(fields.ELEMENT_SLOT_ID ?? "");
    if (stored) return stored;
    const slotId = String(fields.SLOT_ID ?? "");
    const cut = slotId.search(/\/value(?:\/|$)/);
    return cut > 0 ? slotId.slice(0, cut) : slotId;
  }
  return String(fields.SLOT_ID ?? "");
}

/**
 * Pure JSON counterpart to `relabelWorkspaceFromSkeleton` for Treemap / headless
 * mode: updates `fields.NAME` from `skeleton` without mounting a `WorkspaceSvg`,
 * while preserving existing human-readable labels when `skeleton` only has bare
 * at-codes or generic RM placeholders (#374).
 */
export function relabelBlocklyJsonFromSkeleton(
  docJson: BlocklyWorkspaceJson,
  skeleton: SkeletonNode[],
): BlocklyWorkspaceJson {
  if (!skeleton.length || !docJson?.blocks?.blocks?.length) return docJson;
  const bySlot = new Map<string, SkeletonNode>();
  walkSkeleton(skeleton, (node) => bySlot.set(node.slotId, node));
  if (bySlot.size === 0) return docJson;

  const clone = structuredClone(docJson);
  const walk = (block: BlocklyBlockJson | undefined): void => {
    if (!block) return;
    if (!NON_SKELETON_NAME_BLOCK_TYPES.has(block.type) && !block.type.startsWith("sheet_")) {
      const slotId = jsonBlockLabelSlotId(block);
      const node = slotId ? bySlot.get(slotId) : undefined;
      if (node && block.fields) {
        const rmType = String(block.fields.RM_TYPE ?? node.rmType ?? "");
        const isDvShell = block.type !== "element" && isDataValueType(rmType);
        if (!isDvShell && typeof block.fields.NAME === "string") {
          const existing = block.fields.NAME.trim();
          const targetRm = block.type === "element" ? "ELEMENT" : node.rmType;
          if (!shouldPreserveExistingLabel(existing, node.label, targetRm, node.archetypeNodeId)) {
            block.fields.NAME = node.label;
          }
        }
        if (node.archetypeNodeId && typeof block.fields.ARCHETYPE_NODE_ID === "string" && !block.fields.ARCHETYPE_NODE_ID) {
          block.fields.ARCHETYPE_NODE_ID = node.archetypeNodeId;
        }
      }
    }
    if (block.inputs) {
      for (const inp of Object.values(block.inputs)) {
        if (inp.block) walk(inp.block);
        if (inp.shadow) walk(inp.shadow);
      }
    }
    if (block.next?.block) walk(block.next.block);
    if (block.next?.shadow) walk(block.next.shadow);
  };

  for (const top of clone.blocks?.blocks ?? []) walk(top);
  return clone;
}

/** ELEMENT blocks store the value-leaf id in SLOT_ID; labels use the container. */
export function labelSlotId(block: Block): string {
  if (block.type === "element") {
    const stored = String(block.getFieldValue("ELEMENT_SLOT_ID") || "");
    if (stored) return stored;
    const slotId = String(block.getFieldValue("SLOT_ID") || "");
    const cut = slotId.search(/\/value(?:\/|$)/);
    return cut > 0 ? slotId.slice(0, cut) : slotId;
  }
  return String(block.getFieldValue("SLOT_ID") || "");
}

function isDataValueShell(block: Block): boolean {
  return block.type !== "element" && isDataValueBlock(block);
}

export function walkSkeleton(nodes: SkeletonNode[], visit: (node: SkeletonNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children.length) walkSkeleton(node.children, visit);
  }
}

function setFieldIfPresent(block: Block, name: string, value: string): void {
  const field = block.getField(name);
  if (field) field.setValue(value);
}
