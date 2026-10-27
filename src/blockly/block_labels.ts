import type { Block } from "blockly/core";
import type { SkeletonNode } from "../types/mod.ts";
import { archetypeShortName } from "../core/skeleton/template_terms.ts";
import { humanizeRmType, isSkeletonTitleField } from "./field_skeleton_title.ts";
import { isDataValueBlock } from "./blocks/rm_blocks.ts";
import { isTermPickBlock } from "./blocks/term_pick.ts";

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
    if (block.type === "element") {
      // Ontology name stays on ELEMENT. Class is always ELEMENT, even when
      // SLOT_ID points at the value child (#187).
      nameField.setValue(node.label);
      nameField.setClassName("ELEMENT");
      nameField.setAtCode(node.archetypeNodeId ?? "");
    } else if (isDataValueShell(block)) {
      // Archetype node names (Rate, Systolic, …) belong on the ELEMENT only.
      const rmType = node.rmType || String(block.getFieldValue("RM_TYPE") || "");
      nameField.setValue(humanizeRmType(rmType));
      if (rmType) nameField.setClassName(rmType);
      nameField.setAtCode("");
    } else {
      nameField.setValue(node.label);
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
