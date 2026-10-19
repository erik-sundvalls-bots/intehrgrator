/**
 * Blockly workspace → Mapping Model extract (#37).
 * Public seam: `workspaceToModelJson` in `mod.ts`.
 */

import type { Workspace } from "blockly/core";
import type { Block } from "blockly/core";
import type {
  MappingFunction,
  MappingLoop,
  MappingSlotHatch,
  MappingUnsupportedBlock,
  OptionalRmInsertion,
  TargetSignatureNode,
} from "../types/mod.ts";
import { procedureParamNames } from "../core/function_library/blockly_json.ts";
import {
  expressionBlockFromDataValueShell,
  isDataValueBlock,
  optionalRmExtrasOf,
  optionalRmInputName,
  OPTIONAL_INPUT_PREFIX,
  rmAttributeInputName,
} from "./blocks/rm_blocks.ts";
import { isGenericValueBlockType, isSchemaStructureBlock } from "./blocks/target_blocks.ts";
import { schemaSlotIdForInput } from "./schema_blocks.ts";
import { isSchemaOptionalInput, schemaOptionalExtrasOf, schemaOptionalInputName } from "./blocks/schema_mutator.ts";
import { blockToExpression } from "./expression_serialize.ts";
import { isTermPickBlock } from "./blocks/term_pick.ts";
import { SHEET_ACCESSOR_TYPES } from "./blocks/sheet_blocks.ts";
import { DECISION_TABLE_BLOCK } from "./blocks/decision_table_blocks.ts";
import { MAPS_GET } from "../core/defaults/extract.ts";
import { isVmsEscapeBlockType, isVmsRemovedBlockType } from "./vms.ts";
import { isTemplateEscapeHatch } from "./vms_linter.ts";
import { walkProductStack } from "./instance_root.ts";
import { INSTANCE_ENCODING_FIELD, parseInstanceEncoding } from "../core/output/instance_encoding.ts";
import type { InstanceEncoding } from "../types/mod.ts";
import { isLoopBlockType, sourcePathFromLoopList } from "./loop_block.ts";
import { readAiReview } from "./ai_review.ts";
import type { MappingSlotReview } from "../types/mod.ts";

export interface MappingModelExtract {
  slots: Array<{
    slotId: string;
    rmType: string;
    expression: string;
    hatch?: MappingSlotHatch;
    review?: MappingSlotReview;
  }>;
  loops: MappingLoop[];
  optionalRm: OptionalRmInsertion[];
  targetSignature: TargetSignatureNode[];
  unsupported: MappingUnsupportedBlock[];
  sheetNames: string[];
  instanceEncodings: InstanceEncoding[];
  functions: MappingFunction[];
}

const LOOP_TYPES = new Set(["for_each_list", "for_each_source"]); // legacy type still appears mid-migration

/** Name-only parties stay a string. Identifiers become map("name", …, "id", …, "type", …). */
function partyIdentityExpression(block: Block): string | null {
  const nameBlock = block.getInputTargetBlock(rmAttributeInputName("name"));
  const nameExpr = nameBlock && !nameBlock.isShadow() ? blockToExpression(nameBlock) : null;
  const rows = dvIdentifierRows(block.getInputTargetBlock(rmAttributeInputName("identifiers")));
  if (!rows.length) return nameExpr;
  const parts: string[] = [];
  if (nameExpr) parts.push(`${JSON.stringify("name")}, ${nameExpr}`);
  if (rows.length === 1) {
    const row = rows[0]!;
    if (row.id) parts.push(`${JSON.stringify("id")}, ${row.id}`);
    if (row.type) parts.push(`${JSON.stringify("type")}, ${row.type}`);
  } else {
    const maps = rows.map((row) => {
      const inner: string[] = [];
      if (row.id) inner.push(`${JSON.stringify("id")}, ${row.id}`);
      if (row.type) inner.push(`${JSON.stringify("type")}, ${row.type}`);
      return inner.length ? `map(${inner.join(", ")})` : "";
    }).filter(Boolean);
    if (maps.length) parts.push(`${JSON.stringify("identifiers")}, list(${maps.join(", ")})`);
  }
  return parts.length ? `map(${parts.join(", ")})` : nameExpr;
}

function dvIdentifierRows(block: Block | null): Array<{ id: string | null; type: string | null }> {
  if (!block) return [];
  const items = block.type === "lists_create_with" ? listCreateItems(block) : [block];
  const rows: Array<{ id: string | null; type: string | null }> = [];
  for (const item of items) {
    if (item.type !== "dv_identifier") continue;
    const id = firstInputExpression(item, ["FLD_id", "OPTFLD_id"]);
    const type = firstInputExpression(item, ["OPTFLD_type", "FLD_type"]);
    if (id || type) rows.push({ id, type });
  }
  return rows;
}

function listCreateItems(block: Block): Block[] {
  const count = Number((block as Block & { itemCount_?: number }).itemCount_ ?? 0);
  const items: Block[] = [];
  for (let i = 0; i < count; i++) {
    const child = block.getInputTargetBlock(`ADD${i}`);
    if (child && !child.isShadow()) items.push(child);
  }
  return items;
}

function firstInputExpression(block: Block, names: string[]): string | null {
  for (const name of names) {
    const child = block.getInputTargetBlock(name);
    if (!child || child.isShadow()) continue;
    const expr = blockToExpression(child);
    if (expr) return expr;
  }
  return null;
}

export function extractMappingIr(workspace: Workspace): MappingModelExtract {
  const slots = slotsFromWorkspace(workspace);
  return {
    slots,
    loops: loopsFromWorkspace(workspace),
    optionalRm: optionalRmFromWorkspace(workspace),
    targetSignature: targetSignatureFromWorkspace(workspace),
    unsupported: unsupportedFromWorkspace(workspace, slots),
    sheetNames: sheetNamesFromWorkspace(workspace),
    instanceEncodings: instanceEncodingsFromWorkspace(workspace),
    functions: functionsFromWorkspace(workspace),
  };
}

function slotsFromWorkspace(workspace: Workspace): MappingModelExtract["slots"] {
  return collectSlots(workspace).slots;
}

/** The value (expression root) block that fills each mapped slot on the canvas. */
export function slotExpressionBlocks(workspace: Workspace): Map<string, Block> {
  return collectSlots(workspace).blocks;
}

function collectSlots(workspace: Workspace): {
  slots: MappingModelExtract["slots"];
  blocks: Map<string, Block>;
} {
  const slots: MappingModelExtract["slots"] = [];
  const blocks = new Map<string, Block>();
  const seen = new Set<string>();
  const record = (slot: MappingModelExtract["slots"][number], exprBlock: Block | null | undefined) => {
    if (exprBlock) {
      blocks.set(slot.slotId, exprBlock);
      const review = readAiReview(exprBlock);
      if (review) slot.review = review;
    }
    slots.push(slot);
  };
  for (const block of workspace.getAllBlocks(false)) {
    if (isTermPickBlock(block)) {
      const slotId = block.getFieldValue("SLOT_ID");
      const expression = blockToExpression(block);
      const rmType = block.getFieldValue("RM_TYPE") || "DV_CODED_TEXT";
      if (slotId && expression && !seen.has(slotId)) {
        seen.add(slotId);
        record({ slotId, rmType, expression }, block);
      }
      continue;
    }
    if (block.type === MAPS_GET) {
      const slotId = block.getFieldValue("SLOT_ID");
      const expression = blockToExpression(block);
      const rmType = block.getFieldValue("RM_TYPE") || "CODE_PHRASE";
      if (slotId && expression && !seen.has(slotId)) {
        seen.add(slotId);
        record({ slotId, rmType, expression }, block);
      }
      continue;
    }
    if (block.type === "party_identified" || block.type === "party_related") {
      const slotId = block.getFieldValue("SLOT_ID");
      const nameBlock = block.getInputTargetBlock(rmAttributeInputName("name"));
      const expression = partyIdentityExpression(block);
      const rmType = block.type === "party_related" ? "PARTY_RELATED" : "PARTY_IDENTIFIED";
      if (slotId && expression && !seen.has(slotId)) {
        seen.add(slotId);
        const hatch = hatchFromExprTree(nameBlock);
        record(hatch ? { slotId, rmType, expression, hatch } : { slotId, rmType, expression }, nameBlock);
      }
      continue;
    }
    if (
      block.type !== "element" && !isGenericValueBlockType(block.type) && !isDataValueBlock(block) &&
      !isSchemaStructureBlock(block)
    ) {
      continue;
    }
    if (isSchemaStructureBlock(block)) {
      for (const input of block.inputList) {
        if (!input.name.startsWith("TARGET_") && !input.name.startsWith("SCHEMA_OPT_")) continue;
        if (input.type === 3) continue;
        const fieldSlot = schemaSlotIdForInput(block, input.name);
        const exprBlock = block.getInputTargetBlock(input.name);
        const expression = blockToExpression(exprBlock);
        if (fieldSlot && expression && !seen.has(fieldSlot)) {
          seen.add(fieldSlot);
          const attr = input.name.replace(/^TARGET_|^SCHEMA_OPT_/, "");
          const hatch = hatchFromExprTree(exprBlock);
          record(
            hatch ? { slotId: fieldSlot, rmType: attr, expression, hatch } : {
              slotId: fieldSlot,
              rmType: attr,
              expression,
            },
            exprBlock,
          );
        }
      }
      continue;
    }
    const slotId = block.getFieldValue("SLOT_ID");
    const rmType = block.getFieldValue("RM_TYPE") || block.getFieldValue("TARGET_TYPE");
    const valueBlock = block.getInputTargetBlock("VALUE");
    const exprBlock = valueBlock && isTermPickBlock(valueBlock)
      ? valueBlock
      : valueBlock && isDataValueBlock(valueBlock)
      ? expressionBlockFromDataValueShell(valueBlock)
      : isDataValueBlock(block)
      ? expressionBlockFromDataValueShell(block)
      : valueBlock;
    const expression = blockToExpression(exprBlock);
    if (slotId && expression && !seen.has(slotId)) {
      seen.add(slotId);
      const hatch = hatchFromExprTree(exprBlock);
      record(hatch ? { slotId, rmType, expression, hatch } : { slotId, rmType, expression }, exprBlock);
    }
  }
  return { slots, blocks };
}

function optionalRmFromWorkspace(workspace: Workspace): OptionalRmInsertion[] {
  const out: OptionalRmInsertion[] = [];
  for (const block of workspace.getAllBlocks(false)) {
    const slotId = block.getFieldValue("SLOT_ID");
    if (!slotId) continue;
    const extras = isSchemaStructureBlock(block)
      ? schemaOptionalExtrasOf(block)
      : optionalRmExtrasOf(block);
    if (!extras.length) continue;
    for (const name of extras) {
      const input = isSchemaStructureBlock(block)
        ? block.getInput(schemaOptionalInputName(name))
        : block.getInput(optionalRmInputName(name)) ??
          block.getInput(rmAttributeInputName(name));
      const child = input?.connection?.targetBlock();
      const rmType = child?.getFieldValue("RM_TYPE") ||
        child?.getFieldValue("TARGET_TYPE") ||
        (child ? String(child.type).toUpperCase() : name);
      out.push({ attachmentSlotId: slotId, rmType, attributeName: name });
    }
  }
  return out;
}

function loopsFromWorkspace(workspace: Workspace): MappingLoop[] {
  const loops: MappingLoop[] = [];
  for (const block of workspace.getAllBlocks(false)) {
    if (!isLoopBlockType(block.type)) continue;
    const inner = block.getInputTargetBlock("DO");
    const attachSlotId = firstSlotIdInStack(inner);
    const varName = String(block.getFieldValue("VAR") || "");
    if (!attachSlotId || !varName) continue;
    const sourcePath = sourcePathFromLoopList(block) ??
      (block.type === "for_each_source" ? String(block.getFieldValue("PATH") || "") : "");
    if (sourcePath) {
      loops.push({ attachSlotId, varName, path: sourcePath, kind: "source" });
      continue;
    }
    const listBlock = block.getInputTargetBlock("LIST");
    const collection = blockToExpression(listBlock) ?? undefined;
    loops.push({
      attachSlotId,
      varName,
      path: "",
      kind: "list",
      ...(collection ? { collection } : {}),
    });
  }
  return loops;
}

function firstSlotIdInStack(block: Block | null): string | null {
  let current = block;
  while (current) {
    if (!LOOP_TYPES.has(current.type)) {
      const slotId = current.getFieldValue("SLOT_ID");
      if (slotId) return slotId;
    }
    const nested = isLoopBlockType(current.type)
      ? firstSlotIdInStack(current.getInputTargetBlock("DO"))
      : null;
    if (nested) return nested;
    current = current.getNextBlock();
  }
  return null;
}

function targetSignatureFromWorkspace(workspace: Workspace): TargetSignatureNode[] {
  const nodes = new Map<string, TargetSignatureNode>();
  const parentOf = new Map<string, string>();
  const optionalIds = new Set<string>();

  for (const block of workspace.getAllBlocks(false)) {
    if (LOOP_TYPES.has(block.type)) continue;
    const slotId = block.getFieldValue("SLOT_ID");
    if (!slotId || nodes.has(slotId)) continue;
    const rmType = String(
      block.getFieldValue("RM_TYPE") || block.getFieldValue("TARGET_TYPE") || block.type,
    );
    const label = String(block.getFieldValue("LABEL") || block.getFieldValue("NAME") || "");
    nodes.set(slotId, {
      slotId,
      rmType,
      ...(label ? { label } : {}),
      children: [],
    });
    const parent = nearestSlotParent(block);
    if (parent) {
      parentOf.set(slotId, parent.slotId);
      if (parent.optional) optionalIds.add(slotId);
    }
  }

  for (const [id, node] of nodes) {
    if (optionalIds.has(id)) node.optional = true;
    const parentId = parentOf.get(id);
    if (parentId) {
      const parent = nodes.get(parentId);
      if (parent) parent.children.push(node);
    }
  }

  const roots: TargetSignatureNode[] = [];
  for (const [id, node] of nodes) {
    if (!parentOf.has(id)) roots.push(node);
  }
  return roots;
}

function nearestSlotParent(block: Block): { slotId: string; optional: boolean } | null {
  let current: Block | null = block.getParent();
  let child: Block = block;
  while (current) {
    if (!LOOP_TYPES.has(current.type)) {
      const slotId = current.getFieldValue("SLOT_ID");
      if (slotId) {
        return { slotId, optional: isOptionalAttachment(current, child) };
      }
    }
    child = current;
    current = current.getParent();
  }
  return null;
}

function isOptionalAttachment(parent: Block, child: Block): boolean {
  for (const input of parent.inputList) {
    if (!input.name) continue;
    let connected: Block | null = parent.getInputTargetBlock(input.name);
    while (connected) {
      if (connected === child || descendantOf(connected, child)) {
        return input.name.startsWith(OPTIONAL_INPUT_PREFIX) || isSchemaOptionalInput(input.name);
      }
      connected = connected.getNextBlock();
    }
  }
  return false;
}

function descendantOf(root: Block, target: Block): boolean {
  let current: Block | null = target;
  while (current) {
    if (current === root) return true;
    current = current.getParent();
  }
  return false;
}

function unsupportedFromWorkspace(
  workspace: Workspace,
  slots: MappingModelExtract["slots"],
): MappingUnsupportedBlock[] {
  const out: MappingUnsupportedBlock[] = [];
  const seen = new Set<string>();

  const record = (
    block: Block,
    reason: MappingUnsupportedBlock["reason"],
  ): void => {
    if (seen.has(block.id)) return;
    seen.add(block.id);
    const slotId = enclosingSlotId(block);
    const lang = block.type === "text_code" ? String(block.getFieldValue("LANG") || "") : "";
    out.push({
      blockType: block.type,
      reason,
      ...(slotId ? { slotId } : {}),
      ...(lang ? { lang } : {}),
    });
  };

  for (const block of workspace.getAllBlocks(false)) {
    if (block.isShadow?.()) continue;
    if (isVmsRemovedBlockType(block.type)) {
      record(block, "removed");
      continue;
    }
    if (block.type === "text_code") {
      const lang = String(block.getFieldValue("LANG") || "");
      const text = String(block.getFieldValue("TEXT") || "");
      if (isTemplateEscapeHatch("text_code", lang, text)) record(block, "escape");
      continue;
    }
    if (block.type === "text_handlebars") {
      const script = block.getInputTargetBlock("SCRIPT");
      const text = script
        ? String(script.getFieldValue("TEXT") || "")
        : "";
      if (isTemplateEscapeHatch("text_handlebars", undefined, text)) {
        record(block, "escape");
      }
      continue;
    }
    if (isVmsEscapeBlockType(block.type)) record(block, "escape");
  }

  const mapped = new Set(slots.map((s) => s.slotId));
  for (const block of workspace.getAllBlocks(false)) {
    if (block.isShadow?.()) continue;
    if (isVmsRemovedBlockType(block.type) || isVmsEscapeBlockType(block.type)) continue;
    if (LOOP_TYPES.has(block.type)) continue;
    const slotId = block.getFieldValue("SLOT_ID");
    if (!slotId || mapped.has(slotId)) continue;
    const valueBlock = block.getInputTargetBlock("VALUE");
    if (!valueBlock) continue;
    const exprBlock = isDataValueBlock(valueBlock)
      ? expressionBlockFromDataValueShell(valueBlock)
      : valueBlock;
    if (exprBlock && !blockToExpression(exprBlock)) {
      record(exprBlock, isVmsEscapeBlockType(exprBlock.type) ? "escape" : "unsupported");
    }
  }

  return out;
}

function functionsFromWorkspace(workspace: Workspace): MappingFunction[] {
  const out: MappingFunction[] = [];
  for (const block of workspace.getTopBlocks(false)) {
    if (block.type !== "procedures_defreturn" && block.type !== "procedures_defnoreturn") {
      continue;
    }
    const name = String(block.getFieldValue("NAME") || "").trim();
    if (!name) continue;
    const params = liveProcedureParams(block);
    if (block.type === "procedures_defnoreturn") {
      out.push({ name, kind: "statement", params });
      continue;
    }
    const bodyBlock = block.getInputTargetBlock("RETURN") ??
      block.getInputTargetBlock("VALUE");
    const body = blockToExpression(bodyBlock) ?? undefined;
    out.push({ name, kind: "return", params, ...(body ? { body } : {}) });
  }
  return out;
}

function liveProcedureParams(block: Block): string[] {
  const save = (block as { saveExtraState?: () => unknown }).saveExtraState?.();
  if (save && typeof save === "object") {
    return procedureParamNames({
      type: block.type,
      extraState: save as Record<string, unknown>,
    });
  }
  const vars = (block as { getVars?: () => string[] }).getVars?.();
  if (Array.isArray(vars)) {
    return vars.filter((item) => typeof item === "string" && item.trim());
  }
  return [];
}

function enclosingSlotId(block: Block): string | undefined {
  let current: Block | null = block;
  while (current) {
    if (!LOOP_TYPES.has(current.type)) {
      const slotId = current.getFieldValue("SLOT_ID");
      if (slotId) return slotId;
    }
    current = current.getParent();
  }
  return undefined;
}

function hatchFromExprTree(block: Block | null): MappingSlotHatch | undefined {
  if (!block) return undefined;
  if (block.type === "text_code") {
    const lang = String(block.getFieldValue("LANG") || "") || undefined;
    const text = String(block.getFieldValue("TEXT") || "");
    if (!isTemplateEscapeHatch("text_code", lang, text)) return undefined;
    return { kind: "text_code", lang };
  }
  if (block.type === "text_handlebars") {
    const script = block.getInputTargetBlock("SCRIPT");
    const text = script ? String(script.getFieldValue("TEXT") || "") : "";
    if (!isTemplateEscapeHatch("text_handlebars", undefined, text)) return undefined;
    return { kind: "text_handlebars" };
  }
  for (const input of block.inputList) {
    const child = block.getInputTargetBlock(input.name);
    const found = hatchFromExprTree(child);
    if (found) return found;
  }
  return undefined;
}

function sheetNamesFromWorkspace(workspace: Workspace): string[] {
  const names = new Set<string>();
  const accessors = new Set<string>([...SHEET_ACCESSOR_TYPES, DECISION_TABLE_BLOCK]);
  for (const block of workspace.getAllBlocks(false)) {
    if (!accessors.has(block.type)) continue;
    const name = String(block.getFieldValue("NAME") || "").trim();
    if (name) names.add(name);
  }
  return [...names];
}

function instanceEncodingsFromWorkspace(workspace: Workspace): InstanceEncoding[] {
  const encodings: InstanceEncoding[] = [];
  walkProductStack(workspace, (block) => {
    if (block.type !== "composition") return;
    encodings.push(parseInstanceEncoding(block.getFieldValue(INSTANCE_ENCODING_FIELD)));
  });
  if (encodings.length) return encodings;
  for (const block of workspace.getAllBlocks(false)) {
    if (block.type !== "composition") continue;
    encodings.push(parseInstanceEncoding(block.getFieldValue(INSTANCE_ENCODING_FIELD)));
  }
  return encodings;
}
