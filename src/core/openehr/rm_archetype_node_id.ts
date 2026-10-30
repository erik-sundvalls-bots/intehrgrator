/**
 * RM `archetype_node_id` for a skeleton node.
 *
 * Archetype roots are addressed by their archetype id (Web Template AQL
 * predicates such as `/content[openEHR-EHR-ACTION.medication.v1]` and
 * `items[openEHR-EHR-CLUSTER.medication.v2]`). Nodes inside an archetype
 * keep the at-code stored on `archetypeNodeId`.
 * The skeleton field itself stays the at-code so slot ids and term lookup
 * do not change.
 */

import type { SkeletonNode } from "../../types/mod.ts";
import { isArchetypeId } from "../skeleton/template_terms.ts";

/** Skeleton `name` and `archetype_node_id` are identity, not a mapped clinical value. */
export function isLocatableIdentityAttribute(name: string): boolean {
  return name === "name" || name === "archetype_node_id";
}

/**
 * RM attributes filled by context defaults (language, event time, …).
 * They ride along on a node that already has a clinical value, and do not
 * by themselves justify emitting an optional subtree.
 */
export function isRmBoilerplateAttribute(name: string): boolean {
  return isLocatableIdentityAttribute(name) ||
    name === "language" ||
    name === "encoding" ||
    name === "subject" ||
    name === "time" ||
    name === "origin" ||
    name === "territory" ||
    name === "category" ||
    name === "composer";
}

/**
 * The output LOCATABLE.name of a node the user has not renamed: the template's
 * name constraint when there is one, otherwise the term in the primary
 * language. Never the display (UI / 💬) language.
 */
export function rmLocatableName(node: { nameConstraint?: string; primaryName?: string; label?: string }): string {
  return node.nameConstraint?.trim() || node.primaryName?.trim() || node.label?.trim() || "";
}

/**
 * Output name of a block named `shown`: a block still showing its node's label
 * (not renamed by the user) gets `rmLocatableName`; a renamed one keeps its name.
 */
export function outputLocatableName(
  shown: string,
  node: { nameConstraint?: string; primaryName?: string; label?: string } | undefined,
): string {
  return node && shown === (node.label?.trim() ?? "") ? rmLocatableName(node) || shown : shown;
}

/** True when every emitted field is identity or RM boilerplate. */
export function propsLackClinicalContent(props: ReadonlyArray<[string, unknown]>): boolean {
  return props.every(([key]) => isRmBoilerplateAttribute(key));
}

export function rmArchetypeNodeId(
  node: Pick<SkeletonNode, "archetypeNodeId" | "archetypeRef">,
  parentArchetypeRef?: string,
): string | undefined {
  const ref = node.archetypeRef;
  if (ref && isArchetypeId(ref) && ref !== parentArchetypeRef) return ref;
  const at = node.archetypeNodeId?.trim();
  return at || undefined;
}

/** Slot ids whose emitted RM identity is an archetype id, not the at-code on the block. */
export function archetypeRootIdBySlot(nodes: SkeletonNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: SkeletonNode, parentRef?: string) => {
    const id = rmArchetypeNodeId(node, parentRef);
    if (id && isArchetypeId(id) && id !== node.archetypeNodeId) {
      map.set(node.slotId, id);
    }
    const next = node.archetypeRef ?? parentRef;
    for (const child of node.children) walk(child, next);
  };
  for (const node of nodes) walk(node);
  return map;
}
