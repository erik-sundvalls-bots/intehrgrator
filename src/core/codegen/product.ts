/**
 * Decide whether generated conversion scripts should pull an openEHR library
 * (ehrtslib / Archie / RM XML namespaces). The Conversion start **product** on
 * the canvas wins over a leftover Template Skeleton or slot RM types.
 */
import type { MappingModel, SkeletonNode } from "../../types/mod.ts";
import { hasRmType } from "../rm_meta.ts";

const SKIP_TOP_TYPES = new Set([
  "default_context_map",
  "defaults_block",
  "maps_create_with",
  "conversion_start",
]);

const NON_OPENEHR_BLOCK_TYPES = new Set([
  "json_object",
  "json_array",
  "json_value",
  "json_boolean",
  "json_null",
  "xml_element",
  "xml_document",
  "xml_text",
  "xml_attribute",
  "xml_cdata",
  "text_document",
  "target_structure",
  "target_value",
  "for_each_list",
]);

interface BlocklyNode {
  type?: string;
  next?: { block?: BlocklyNode };
}

export function isOpenEhrRmType(rmType: string | undefined): boolean {
  const t = rmType?.trim();
  if (!t) return false;
  return hasRmType(t) || hasRmType(t.toUpperCase());
}

function blockTypeIsOpenEhr(type: string): boolean {
  if (!type || NON_OPENEHR_BLOCK_TYPES.has(type) || type.startsWith("schema_")) {
    return false;
  }
  if (type === "composition") return true;
  return isOpenEhrRmType(type.replace(/-/g, "_").toUpperCase());
}

function topBlocks(state: unknown): BlocklyNode[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as { blocks?: { blocks?: BlocklyNode[] } }).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

/** Instance-root (and Product stack) block types under Conversion start. */
export function instanceRootTypesFromBlocklyState(state: unknown): string[] {
  const tops = topBlocks(state);
  const start = tops.find((block) => block.type === "conversion_start");
  if (start) {
    const types: string[] = [];
    let current = start.next?.block;
    while (current?.type) {
      types.push(current.type);
      current = current.next?.block;
    }
    return types;
  }
  return tops
    .map((block) => block.type)
    .filter((type): type is string => Boolean(type) && !SKIP_TOP_TYPES.has(type));
}

export interface ProductInspectOptions {
  blocklyState?: unknown;
  skeleton?: SkeletonNode[];
}

/** True when the conversion product is an openEHR RM tree. */
export function usesOpenEhrProduct(
  model: MappingModel,
  options?: ProductInspectOptions,
): boolean {
  const canvasTypes = instanceRootTypesFromBlocklyState(options?.blocklyState);
  if (canvasTypes.length) {
    return canvasTypes.some(blockTypeIsOpenEhr);
  }

  const format = model.targetFormat;
  if (format === "json-schema" || format === "xml-schema" || format === "free-form") {
    return false;
  }
  if (format === "openehr-template") return true;

  const root = options?.skeleton?.[0];
  if (root) {
    if (root.blockType === "composition" || root.rmType === "COMPOSITION") return true;
    if (
      root.blockType &&
      (NON_OPENEHR_BLOCK_TYPES.has(root.blockType) || root.blockType.startsWith("schema_"))
    ) {
      return false;
    }
    if (isOpenEhrRmType(root.rmType)) return true;
  }

  return model.slots.some((slot) => isOpenEhrRmType(slot.rmType));
}

interface CanvasNode {
  type?: string;
  inputs?: Record<string, { block?: CanvasNode; shadow?: CanvasNode }>;
  next?: { block?: CanvasNode };
}

/**
 * True when an XML / XML Schema canvas has structure a Mapping Model slot map
 * cannot hold: `include_when` / `for_each_list`, or a statement input with two
 * blocks of the same element type (17 `TextKeyWord`s share one slot id). A
 * generator that only emits a slot map would silently drop that content.
 */
export function xmlCanvasNeedsTreeWalker(state: unknown): boolean {
  const start = topBlocks(state).find((block) => block.type === "conversion_start") as CanvasNode | undefined;
  const root = start?.next?.block as CanvasNode | undefined;
  if (!root?.type || !(root.type === "xml_element" || root.type.startsWith("schema_"))) return false;
  const visit = (node: CanvasNode | undefined): boolean => {
    if (!node?.type) return false;
    if (node.type === "include_when" || node.type === "for_each_list") return true;
    for (const input of Object.values(node.inputs ?? {})) {
      const child = input.block;
      if (!child) continue;
      const seen = new Set<string>();
      for (let current: CanvasNode | undefined = child; current?.type; current = current.next?.block) {
        if (seen.has(current.type) && (current.type === "xml_element" || current.type.startsWith("schema_"))) {
          return true;
        }
        seen.add(current.type);
        if (visit(current)) return true;
      }
    }
    return false;
  };
  return visit(root);
}
