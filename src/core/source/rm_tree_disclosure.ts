/**
 * openEHR Source Schema RM disclosure (#86, variant A).
 *
 * Web Template trees name clinical nodes, not every RM attribute. This pass
 * inserts the gaps from ehrtslib attribute metadata — the same catalogue the
 * canvas cogwheel uses — without a second RM table:
 *
 * - silent-mandatory attributes the template does not already occupy (stored on the tree)
 * - optional attributes via `optionalSourceRmGaps` (view-only, behind the plus)
 *
 * A child occupies an attribute via `rmAttribute` (AQL segment), a matching
 * name / `|suffix`, or `rmCoveredAttributes` (unsuffixed Web Template input).
 * `unit` → `units` and `code` → `defining_code` follow the Web Template input
 * reading in `generate_skeleton.ts`.
 */

import type { SchemaTreeNode } from "../../types/mod.ts";
import { appendJsonPath } from "./schema_loader.ts";
import {
  attributesFor,
  baseRmTypeName,
  hasRmType,
  primaryMappingAttribute,
  resolveGenericSlotType,
  type RmAttributeMeta,
} from "../rm_meta.ts";

const MAX_SYNTHETIC_DEPTH = 8;

/** RM attributes a Web Template `inputs[]` list already exposes on this node. */
export function rmAttributesCoveredByInputs(
  rmType: string,
  inputs: ReadonlyArray<{ suffix?: unknown }>,
): string[] {
  const known = attributeNames(rmType);
  if (!known.size) return [];
  const covered = new Set<string>();
  let bare = false;
  for (const input of inputs) {
    const suffix = typeof input.suffix === "string" ? input.suffix : "";
    if (!suffix) {
      bare = true;
      continue;
    }
    const attr = aliasRmAttribute(suffix, known);
    if (attr) covered.add(attr);
  }
  if (bare) {
    const primary = primaryMappingAttribute(rmType);
    if (primary && known.has(primary.name)) covered.add(primary.name);
  }
  return [...covered];
}

/**
 * Map a Web Template input suffix or child id onto an RM attribute name.
 * `unit` / `code` are the simplified-format names of `units` / `defining_code`.
 */
export function aliasRmAttribute(
  raw: string,
  known: ReadonlySet<string>,
): string | undefined {
  if (known.has(raw)) return raw;
  if ((raw === "unit" || raw === "units") && known.has("units")) return "units";
  if (
    (raw === "code" || raw === "defining_code") && known.has("defining_code")
  ) {
    return "defining_code";
  }
  if (raw === "code" && known.has("code_string")) return "code_string";
  return undefined;
}

/** Next AQL segment after the parent path: the RM attribute this child sits in. */
export function rmAttributeFromAql(
  parentAql: string,
  childAql: string,
): string | undefined {
  if (!childAql) return undefined;
  const parent = parentAql.replace(/\/$/, "");
  let relative = childAql;
  if (parent && (childAql === parent || childAql.startsWith(`${parent}/`))) {
    relative = childAql.slice(parent.length);
  }
  const segment = relative.split("/").filter(Boolean)[0];
  if (!segment) return undefined;
  const name = segment.split("[")[0];
  return name || undefined;
}

/**
 * Return a tree with silent-mandatory RM gaps inline. Idempotent.
 * Template child order is preserved; gaps follow RM attribute order.
 * Optional attributes are not stored — see `optionalSourceRmGaps`.
 */
export function discloseOpenEhrSourceRm(root: SchemaTreeNode): SchemaTreeNode {
  return discloseNode(root, []);
}

/** Optional RM attributes this node does not already occupy, with their mandatory spine. */
export function optionalSourceRmGaps(node: SchemaTreeNode): SchemaTreeNode[] {
  const rmType = baseRmTypeName(node.type);
  if (!hasRmType(rmType)) return [];
  const names = attributeNames(rmType);
  const occupied = occupiedAttributes(node, node.children, names);
  const gaps: SchemaTreeNode[] = [];
  for (const attr of attributesFor(rmType)) {
    if (attr.mandatory || occupied.has(attr.name)) continue;
    gaps.push(synthesize(rmType, node.path, attr, [rmType]));
  }
  return gaps;
}

function discloseNode(
  node: SchemaTreeNode,
  syntheticStack: string[],
): SchemaTreeNode {
  const rmType = baseRmTypeName(node.type);
  const known = hasRmType(rmType);
  const blocked = known &&
    (syntheticStack.includes(rmType) ||
      syntheticStack.length >= MAX_SYNTHETIC_DEPTH);
  const childStack = node.rmOrigin && known
    ? [...syntheticStack, rmType]
    : syntheticStack;
  const children = node.children.map((child) =>
    discloseNode(child, childStack)
  );
  if (!known || blocked) return { ...node, children };

  const names = attributeNames(rmType);
  const occupied = occupiedAttributes(node, children, names);
  const mandatory: SchemaTreeNode[] = [];
  const stackForGaps = [...syntheticStack, rmType];
  for (const attr of attributesFor(rmType)) {
    if (!attr.mandatory || occupied.has(attr.name)) continue;
    mandatory.push(synthesize(rmType, node.path, attr, stackForGaps));
  }

  const templateChildren = children.filter((child) =>
    child.rmOrigin !== "rm-mandatory"
  );
  const existingMandatory = children.filter((child) =>
    child.rmOrigin === "rm-mandatory"
  );
  return {
    ...node,
    children: [...existingMandatory, ...mandatory, ...templateChildren],
  };
}

function synthesize(
  parentRmType: string,
  parentPath: string,
  attr: RmAttributeMeta,
  syntheticStack: string[],
): SchemaTreeNode {
  const node: SchemaTreeNode = {
    path: appendJsonPath(parentPath, attr.name),
    name: attr.name,
    type: displayRmType(parentRmType, attr.typeName),
    multiplicity: formatMultiplicity(attr.multiplicity),
    rmOrigin: attr.mandatory ? "rm-mandatory" : "rm-optional",
    rmAttribute: attr.name,
    children: [],
  };
  return discloseNode(node, syntheticStack);
}

function occupiedAttributes(
  node: SchemaTreeNode,
  children: SchemaTreeNode[],
  known: ReadonlySet<string>,
): Set<string> {
  const occupied = new Set<string>();
  for (const name of node.rmCoveredAttributes ?? []) {
    if (known.has(name)) occupied.add(name);
  }
  for (const child of children) {
    const attr = occupiedAttribute(child, known);
    if (attr) occupied.add(attr);
  }
  return occupied;
}

function occupiedAttribute(
  child: SchemaTreeNode,
  known: ReadonlySet<string>,
): string | undefined {
  if (child.rmAttribute) {
    return known.has(child.rmAttribute) ? child.rmAttribute : undefined;
  }
  const raw = child.name.startsWith("|") ? child.name.slice(1) : child.name;
  return aliasRmAttribute(raw, known);
}

function attributeNames(rmType: string): Set<string> {
  if (!hasRmType(baseRmTypeName(rmType))) return new Set();
  return new Set(attributesFor(rmType).map((attr) => attr.name));
}

function displayRmType(parentRmType: string, typeName: string): string {
  if (typeName.startsWith("List<") && typeName.endsWith(">")) {
    const inner = typeName.slice("List<".length, -1);
    return `List<${displayRmType(parentRmType, inner)}>`;
  }
  if (typeName === "T") return resolveGenericSlotType(parentRmType, typeName);
  if (typeName.endsWith("<T>")) return typeName.slice(0, -"<T>".length);
  return typeName;
}

function formatMultiplicity(
  multiplicity: { min: number; max: number | null },
): string {
  if (multiplicity.max === 1) return multiplicity.min > 0 ? "1" : "0..1";
  return multiplicity.min > 0 ? "1..*" : "0..*";
}
