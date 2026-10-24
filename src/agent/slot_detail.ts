/**
 * `get_slot` (#277 §3): everything the compact slot-tree row omits for one
 * slot: full documentation, value sets, the constraint as the target defines
 * it, the current mapping and any lease.
 */
import type { MappingModel, SkeletonNode } from "../types/mod.ts";
import { findSkeletonTrail, nearestContentAncestor, nearestRepeatingContainer, pathLabelFromTrail } from "../core/skeleton/generate_skeleton.ts";
import { compactSlotIdMap } from "../core/ai/slot_tree.ts";
import { parseXsd, type XsdNode } from "../core/xsd/xsd_model.ts";
import { type SlotInfo, slotInfoFor, type SlotInfoIndex } from "../core/ai/slot_info.ts";

export interface TargetSource {
  format: string;
  filename: string;
  content: string;
}

export interface SlotDetail {
  slotId: string;
  /** Compact id used in the slot tree. */
  id: string;
  type: string;
  label?: string;
  pathLabel?: string;
  mult?: string;
  mandatory?: boolean;
  /** Repeating ancestor (`loops[].attachSlotId`). */
  attachSlotId?: string;
  parentRmType?: string;
  targetPath?: string;
  documentation?: string;
  archetypeId?: string;
  archetypeNodeId?: string;
  nameConstraint?: string;
  fixed?: Record<string, string>;
  units?: string[];
  values?: SkeletonNode["allowedValues"];
  ordinals?: SkeletonNode["allowedOrdinals"];
  /** The constraint as the target file has it: JSON Schema subschema, XSD element/attribute, or the template node. */
  constraint?: { kind: "json-schema" | "xsd" | "openehr"; value: unknown };
  /** Full meaning, comment, bindings, ranges, value descriptions and per-language texts (#277). */
  info?: SlotInfo;
  /** The enclosing group's meaning (archetype, event, object), full text. */
  groupInfo?: { slotId: string; label?: string; description: string };
  mapping?: { expression: string; note?: string; confidence?: number };
  lease?: { agentId: string; displayName?: string; expiresAt?: string; subtree?: boolean };
}

/** JSON Schema subschema for `$.a.b[*].c` (local `$ref` followed). */
export function jsonSubschemaAt(schemaText: string, path: string): unknown {
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(schemaText);
  } catch {
    return undefined;
  }
  const deref = (node: unknown, depth = 0): Record<string, unknown> | undefined => {
    if (!node || typeof node !== "object") return undefined;
    const rec = node as Record<string, unknown>;
    if (typeof rec.$ref === "string" && rec.$ref.startsWith("#/") && depth < 16) {
      let target: unknown = root;
      for (const part of rec.$ref.slice(2).split("/")) {
        target = (target as Record<string, unknown> | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      return deref(target, depth + 1);
    }
    return rec;
  };
  const steps = path.replace(/^\$/, "").match(/\.[^.[\]]+|\[[^\]]*\]/g) ?? [];
  let node = deref(root);
  for (const step of steps) {
    if (!node) return undefined;
    if (step.startsWith("[")) {
      node = deref(node.items);
      continue;
    }
    const name = step.slice(1);
    node = deref((node.properties as Record<string, unknown> | undefined)?.[name]);
  }
  return node;
}

/** XSD element / attribute for an XML slot path (`/A/B/@c`), without its children. */
export function xsdNodeAt(xsdText: string, path: string): Omit<XsdNode, "children"> | undefined {
  let found: XsdNode | undefined;
  try {
    const model = parseXsd(xsdText);
    const walk = (node: XsdNode) => {
      if (found) return;
      if (node.path === path) found = node;
      else node.children.forEach(walk);
    };
    walk(model.root);
  } catch {
    return undefined;
  }
  if (!found) return undefined;
  const { children: _children, ...rest } = found;
  return rest;
}

function templateConstraint(node: SkeletonNode): Record<string, unknown> {
  const out: Record<string, unknown> = { rmType: node.rmType };
  const keep: Array<keyof SkeletonNode> = [
    "archetypeRef",
    "archetypeNodeId",
    "rmAttribute",
    "nameConstraint",
    "fixedValue",
    "fixedFields",
    "slotCardinality",
    "rmCardinality",
    "effectiveCardinality",
    "attributeConstraints",
  ];
  for (const key of keep) {
    const value = node[key];
    if (value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)) out[key] = value;
  }
  return out;
}

export function slotDetail(
  skeleton: SkeletonNode[],
  model: MappingModel,
  slotId: string,
  target: TargetSource | null,
  info: SlotInfoIndex | undefined,
  lease?: { agentId: string; displayName?: string; expiresAt?: string; subtree?: boolean },
): SlotDetail | undefined {
  const trail = findSkeletonTrail(skeleton, slotId);
  const node = trail.at(-1);
  if (!node) return undefined;
  const ids: string[] = [];
  const collect = (nodes: SkeletonNode[]) => nodes.forEach((n) => (ids.push(n.slotId), collect(n.children)));
  collect(skeleton);
  const compact = compactSlotIdMap(ids).get(slotId) ?? slotId;
  const repeating = nearestRepeatingContainer(trail.slice(0, -1));
  const parent = nearestContentAncestor(trail);
  const pathLabel = pathLabelFromTrail(trail);
  const mapped = model.slots.find((s) => s.slotId === slotId);
  const targetPath = node.targetPath ?? (compact.startsWith("$") || compact.startsWith("/") ? compact : undefined);
  let constraint: SlotDetail["constraint"];
  if (target?.format === "json-schema" && targetPath) {
    const value = jsonSubschemaAt(target.content, targetPath);
    if (value !== undefined) constraint = { kind: "json-schema", value };
  } else if (target?.format === "xml-schema" && targetPath) {
    const value = xsdNodeAt(target.content, targetPath);
    if (value) constraint = { kind: "xsd", value };
  } else if (target?.format === "openehr-template") {
    constraint = { kind: "openehr", value: templateConstraint(node) };
  }
  const slotInfo = info ? slotInfoFor(info, slotId) : undefined;
  const groupNode = [...trail].reverse().find((n) => n !== node && info?.groups.get(n.slotId)?.description);
  const groupText = groupNode ? info?.groups.get(groupNode.slotId)?.description : undefined;
  return {
    slotId,
    id: compact,
    type: node.rmType,
    ...(node.label ? { label: node.label } : {}),
    ...(pathLabel ? { pathLabel } : {}),
    ...(node.multiplicity ? { mult: node.multiplicity } : {}),
    ...(node.mandatory ? { mandatory: true } : {}),
    ...(repeating ? { attachSlotId: repeating.slotId } : {}),
    ...(parent ? { parentRmType: parent.rmType } : {}),
    ...(targetPath ? { targetPath } : {}),
    ...(node.documentation ? { documentation: node.documentation } : {}),
    ...(node.archetypeRef ? { archetypeId: node.archetypeRef } : {}),
    ...(node.archetypeNodeId ? { archetypeNodeId: node.archetypeNodeId } : {}),
    ...(node.nameConstraint ? { nameConstraint: node.nameConstraint } : {}),
    ...(node.fixedFields && Object.keys(node.fixedFields).length ? { fixed: { ...node.fixedFields } } : {}),
    ...(node.allowedUnits?.length ? { units: [...node.allowedUnits] } : {}),
    ...(node.allowedValues?.length ? { values: node.allowedValues.map((v) => ({ ...v })) } : {}),
    ...(node.allowedOrdinals?.length ? { ordinals: node.allowedOrdinals.map((v) => ({ ...v })) } : {}),
    ...(constraint ? { constraint } : {}),
    ...(slotInfo ? { info: slotInfo } : {}),
    ...(groupNode && groupText ? { groupInfo: { slotId: groupNode.slotId, ...(groupNode.label ? { label: groupNode.label } : {}), description: groupText } } : {}),
    ...(mapped?.expression
      ? {
        mapping: {
          expression: mapped.expression,
          ...(mapped.review?.note ? { note: mapped.review.note } : {}),
          ...(mapped.review?.confidence !== undefined ? { confidence: mapped.review.confidence } : {}),
        },
      }
      : {}),
    ...(lease ? { lease } : {}),
  };
}
