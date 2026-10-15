/**
 * Live constraint decorations on RM Blockly blocks.
 *
 * Warning triangles fire when a contained constraint is unmet (unmapped
 * mandatory value, abstract EVENT, empty required slot). They do **not**
 * light up merely because a node is template/RM-mandatory.
 */
import type { Block, Workspace } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { TERM_PICK_NONE } from "../core/openehr_term_catalog.ts";
import { isAbstractType } from "../core/rm_meta.ts";
import { isGenericValueBlockType } from "./blocks/target_blocks.ts";
import {
  expressionBlockFromDataValueShell,
  isDataValueBlock,
  isEventFamilyType,
  isItemStructureFamilyType,
  presentAttributeNames,
  RM_ATTR_INPUT_PREFIX,
  OPTIONAL_INPUT_PREFIX,
} from "./blocks/rm_blocks.ts";
import { isSchemaOptionalInput } from "./blocks/schema_mutator.ts";
import { isTermPickBlock } from "./blocks/term_pick.ts";
import { hasPlaceholderSourceQuery, isPlaceholderSourcePath } from "./listening.ts";
import { isSourceQueryBlockType } from "./source_query.ts";
import {
  cardinalityFieldOnInput,
  formatSlotCardinality,
  isCardinalityMet,
  type SlotCardinality,
} from "./slot_cardinality.ts";
import { blockHatchMessages } from "./vms_linter.ts";
import { DECISION_TABLE_BLOCK } from "./blocks/decision_table_blocks.ts";
import { workspaceSheet } from "./sheets_bridge.ts";
import { lintDecisionTable } from "../core/sheets/decision_table.ts";
import { DEFAULT_CONTEXT_MAP_TYPE, runtimeKeyWarnings } from "../core/defaults/mod.ts";
import { FieldScaffoldTargets } from "./field_scaffold_targets.ts";
import { parseTargetsField } from "../core/defaults/context_map.ts";
import { contextMapItemCount } from "./blocks/default_context_map.ts";

export const ABSTRACT_EVENT_WARNING =
  "EVENT is abstract. Choose POINT_EVENT or INTERVAL_EVENT — runtime instances cannot be the abstract EVENT class.";

export const ABSTRACT_ITEM_STRUCTURE_WARNING =
  "ITEM_STRUCTURE is abstract. Choose ITEM_TREE, ITEM_LIST, ITEM_TABLE, or ITEM_SINGLE — runtime instances cannot be the abstract ITEM_STRUCTURE class.";

export const UNMAPPED_OPTIONAL_SCAFFOLD_WARNING = "Unmapped optional scaffold";

const PROTECTED_SPEC_BLOCK_TYPES = new Set([
  "conversion_start",
  "default_context_map",
  "defaults_block",
  "maps_create_with",
]);

const STATEMENT_INPUT_TYPE = 3;

export function refreshWorkspaceConstraints(workspace: Workspace): void {
  const record = typeof Blockly.Events.getRecordUndo === "function"
    ? Blockly.Events.getRecordUndo()
    : true;
  if (typeof Blockly.Events.setRecordUndo === "function") {
    Blockly.Events.setRecordUndo(false);
  }
  try {
    for (const block of workspace.getAllBlocks(false)) {
      if (typeof block.isShadow === "function" && block.isShadow()) continue;
      refreshSlotCardinalityState(block);
      const messages = blockConstraintMessages(block);
      block.setWarningText(messages.length ? messages.join("\n") : null);
    }
  } finally {
    if (typeof Blockly.Events.setRecordUndo === "function") {
      Blockly.Events.setRecordUndo(record);
    }
  }
}

export function blockConstraintMessages(block: Block): string[] {
  const messages: string[] = [];
  const rmType = (block.getFieldValue("RM_TYPE") || "").toUpperCase();
  if (rmType === "EVENT") {
    messages.push(ABSTRACT_EVENT_WARNING);
  }
  if (rmType === "ITEM_STRUCTURE") {
    messages.push(ABSTRACT_ITEM_STRUCTURE_WARNING);
  }

  if (isMandatoryFlag(block) && isUnmappedValueBlock(block)) {
    messages.push("Unmapped mandatory value");
  }

  if (
    !isMandatoryFlag(block) &&
    block.getFieldValue("SLOT_ID") &&
    isUnmappedBlockTree(block)
  ) {
    messages.push(UNMAPPED_OPTIONAL_SCAFFOLD_WARNING);
  }

  for (const unmet of unmetSlotCards(block)) {
    messages.push(
      `${unmet.attr} needs ${formatSlotCardinality(unmet.card)} (has ${unmet.count})`,
    );
  }

  // VMS hatch / dialect warnings (#40) share the Constraint warning triangle.
  messages.push(...blockHatchMessages(block));

  if (block.type === DECISION_TABLE_BLOCK) {
    const name = String(block.getFieldValue("NAME") || "");
    const sheet = name ? workspaceSheet(name) : undefined;
    if (sheet) {
      for (const d of lintDecisionTable(sheet)) {
        messages.push(d.message);
      }
    }
  }

  if (block.type === DEFAULT_CONTEXT_MAP_TYPE) {
    const count = contextMapItemCount(block);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const runtimeKey = String(block.getFieldValue(`KEY${i}`) ?? "");
      const field = block.getField(`TARGETS${i}`) as FieldScaffoldTargets | null;
      const scaffoldTargets = field?.getTargets() ??
        parseTargetsField(block.getFieldValue(`TARGETS${i}`));
      entries.push({ runtimeKey, scaffoldTargets });
    }
    messages.push(...runtimeKeyWarnings(entries));
  }
  return messages;
}

export function warningTextOf(block: Block): string | null {
  const iconsApi = Blockly.icons as
    | { WarningIcon?: { TYPE?: unknown } }
    | undefined;
  const type = iconsApi?.WarningIcon?.TYPE;
  const getIcon = (block as unknown as {
    getIcon?: (iconType: unknown) => { getText?: () => string } | null;
  }).getIcon;
  if (type && typeof getIcon === "function") {
    const text = getIcon.call(block, type)?.getText?.() ?? "";
    if (text) return text;
  }
  const legacy = block as unknown as { getWarningText?: () => string | null };
  if (typeof legacy.getWarningText === "function") {
    return legacy.getWarningText() || null;
  }
  return null;
}

export function isAbstractEventBlock(block: Block): boolean {
  const rmType = (block.getFieldValue("RM_TYPE") || "").toUpperCase();
  return rmType === "EVENT" && (isEventFamilyType(rmType) || isAbstractType("EVENT"));
}

function refreshSlotCardinalityState(block: Block): void {
  for (const input of block.inputList) {
    const field = cardinalityFieldOnInput(input);
    if (!field) continue;
    const count = countInputChildren(block, input.name);
    field.setUnmet(!isCardinalityMet(count, { min: field.min, max: field.max }));
  }
}

function unmetSlotCards(
  block: Block,
): Array<{ attr: string; card: SlotCardinality; count: number }> {
  const out: Array<{ attr: string; card: SlotCardinality; count: number }> = [];
  for (const input of block.inputList) {
    const field = cardinalityFieldOnInput(input);
    if (!field) continue;
    const card = { min: field.min, max: field.max };
    const count = countInputChildren(block, input.name);
    if (isCardinalityMet(count, card)) continue;
    const attr = input.name.startsWith(RM_ATTR_INPUT_PREFIX)
      ? input.name.slice(RM_ATTR_INPUT_PREFIX.length)
      : input.name.startsWith(OPTIONAL_INPUT_PREFIX)
      ? input.name.slice(OPTIONAL_INPUT_PREFIX.length)
      : input.name.toLowerCase();
    out.push({ attr, card, count });
  }
  return out;
}

export function countInputChildren(block: Block, inputName: string): number {
  const input = block.getInput(inputName);
  if (!input?.connection) return 0;
  const first = input.connection.targetBlock();
  if (!first) return 0;
  if (input.type !== STATEMENT_INPUT_TYPE) return 1;
  let n = 0;
  let current: Block | null = first;
  while (current) {
    n++;
    current = current.getNextBlock();
  }
  return n;
}

function isMandatoryFlag(block: Block): boolean {
  return isMandatoryBlock(block);
}

export function isMandatoryBlock(block: Block): boolean {
  const raw = block.getFieldValue("MANDATORY");
  return raw === "1" || raw === "true";
}

export function isProtectedSpecBlock(block: Block): boolean {
  return PROTECTED_SPEC_BLOCK_TYPES.has(block.type);
}

function parentConnectionInputName(block: Block): string | null {
  const parent = block.getParent() ?? block.getSurroundParent?.() ?? null;
  if (!parent) return null;
  for (const input of parent.inputList) {
    if (input.connection?.targetBlock()?.id === block.id) return input.name;
  }
  return null;
}

/** Template-optional slot or block without the mandatory flag. */
export function isInNonMandatoryField(block: Block): boolean {
  if (!isMandatoryBlock(block)) return true;
  const inputName = parentConnectionInputName(block);
  if (!inputName) return false;
  return inputName.startsWith(OPTIONAL_INPUT_PREFIX) || isSchemaOptionalInput(inputName);
}

export function blockHasMappedExpression(block: Block): boolean {
  if (isSourceQueryBlockType(block.type)) {
    return !isPlaceholderSourcePath(block.getFieldValue("EXPRESSION"));
  }
  if (isTermPickBlock(block)) {
    const code = block.getFieldValue("CODE");
    return Boolean(code && code !== TERM_PICK_NONE);
  }
  if (isDataValueBlock(block)) {
    const expr = expressionBlockFromDataValueShell(block);
    return expr ? blockHasMappedExpression(expr) : false;
  }
  if (block.type === "element" || isGenericValueBlockType(block.type)) {
    return !isUnmappedValueBlock(block) && !hasPlaceholderSourceQuery(block);
  }
  if (
    block.type === "text" ||
    block.type === "math_number" ||
    block.type === "logic_boolean" ||
    block.type === "text_handlebars" ||
    block.type === "text_code"
  ) {
    return true;
  }
  for (const child of block.getChildren(false)) {
    if (blockHasMappedExpression(child)) return true;
  }
  return false;
}

/** True when the block and its descendants have no mapped expressions yet. */
export function isUnmappedBlockTree(block: Block): boolean {
  if (isProtectedSpecBlock(block)) return false;
  return !blockHasMappedExpression(block);
}

function elementNullFlavourIsSet(block: Block): boolean {
  const child = block.getInput(`${OPTIONAL_INPUT_PREFIX}null_flavour`)?.connection?.targetBlock() ??
    null;
  if (!child) return false;
  if (isTermPickBlock(child)) {
    const code = child.getFieldValue("CODE");
    return Boolean(code && code !== TERM_PICK_NONE);
  }
  if (isDataValueBlock(child)) return Boolean(expressionBlockFromDataValueShell(child));
  return false;
}

export function isUnmappedValueBlock(block: Block): boolean {
  if (isTermPickBlock(block)) {
    const code = block.getFieldValue("CODE");
    return !code || code === TERM_PICK_NONE;
  }
  if (block.type === "element" && elementNullFlavourIsSet(block)) return false;
  if (block.type === "element" || isGenericValueBlockType(block.type)) {
    const value = block.getInput("VALUE")?.connection?.targetBlock();
    if (!value) return true;
    if (isTermPickBlock(value)) return isUnmappedValueBlock(value);
    if (isDataValueBlock(value)) {
      return !expressionBlockFromDataValueShell(value);
    }
    return false;
  }
  if (isDataValueBlock(block)) {
    return !expressionBlockFromDataValueShell(block);
  }
  return false;
}

/** Used by tests and optional RM to know which ATTR_/OPT_ mouths exist. */
export function connectedAttributeNames(block: Block): string[] {
  return presentAttributeNames(block).filter((name) => {
    const input = block.getInput(`${RM_ATTR_INPUT_PREFIX}${name}`) ??
      block.getInput(`${OPTIONAL_INPUT_PREFIX}${name}`);
    return Boolean(input?.connection?.targetBlock());
  });
}
