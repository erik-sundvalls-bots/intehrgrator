/**
 * Rewrite retired `for_each_source` Blockly JSON to `for_each_list` with a
 * `source_query_node` in LIST so old projects and fixtures keep loading (#130).
 */

const LEGACY_TYPE = "for_each_source";
const LIST_TYPE = "for_each_list";
const SOURCE_NODE_TYPE = "source_query_node";

import { migrateDefaultContextMapState } from "../core/defaults/context_map.ts";
import { stripGridDeclarationBlocks } from "./strip_grid_declarations.ts";

export function migrateForEachSourceState<T>(state: T): T {
  return stripGridDeclarationBlocks(walk(migrateDefaultContextMapState(state))) as T;
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => {
      if (item === LEGACY_TYPE) return LIST_TYPE;
      return walk(item);
    });
  }
  if (!node || typeof node !== "object") return node;
  const rec = node as Record<string, unknown>;
  if (rec.type === LEGACY_TYPE) return migrateLoopBlock(rec);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec)) {
    out[key] = walk(value);
  }
  return out;
}

function migrateLoopBlock(block: Record<string, unknown>): Record<string, unknown> {
  const fieldsIn = isRecord(block.fields) ? block.fields : {};
  const path = String(fieldsIn.PATH ?? "/");
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fieldsIn)) {
    if (key === "PATH") continue;
    fields[key] = value;
  }
  const inputsIn = isRecord(block.inputs) ? block.inputs : {};
  const inputs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inputsIn)) {
    inputs[name] = walk(value);
  }
  if (!hasListChild(inputs.LIST)) {
    const id = typeof block.id === "string" && block.id ? `${block.id}_src` : "for_each_src";
    inputs.LIST = {
      block: {
        type: SOURCE_NODE_TYPE,
        id,
        fields: { EXPRESSION: path },
      },
    };
  }
  const out: Record<string, unknown> = { ...block, type: LIST_TYPE, fields, inputs };
  return out;
}

function hasListChild(listInput: unknown): boolean {
  if (!isRecord(listInput)) return false;
  return isRecord(listInput.block) || isRecord(listInput.shadow);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
