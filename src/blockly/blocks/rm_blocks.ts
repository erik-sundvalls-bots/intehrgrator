import { Blockly } from "../blockly_core.ts";
import type { BlockSvg } from "blockly/core";
import "blockly/blocks";
import { mandatoryAttributesFor } from "../../core/rm_mandatory.ts";
import {
  attributesFor,
  baseRmTypeName,
  blocklyCheckForPrimitiveType,
  blockTypeForRm,
  dataValueLeafTypes,
  getValidAttachments,
  isDataValueType,
  isPrimitiveRmType,
  isRmValueAttribute,
  isSubtypeOf,
  mandatoryAttributes,
  optionalAttributes,
  primaryMappingAttribute,
  subtypesOf,
  type RmAttributeMeta,
} from "../../core/rm_meta.ts";
import { blocklyCheckForDv, blocklyOutputForDv } from "../block_checks.ts";
import {
  appendBlockOutputEmoji,
  appendSlotTypeEmoji,
  isRmTypeEmojiField,
  BLOCK_OUT_EMOJI_FIELD,
  slotRmTypeForAttr,
} from "../rm_type_emoji.ts";
import { FieldSkeletonTitle, humanizeRmType, isSkeletonTitleField } from "../field_skeleton_title.ts";
import { INSTANCE_ROOT_CONNECTION } from "../instance_root.ts";
import { FieldDropdownHug } from "../field_dropdown_hug.ts";
import { INSTANCE_ENCODING_FIELD } from "../../core/output/instance_encoding.ts";
import { ID_LANGUAGE_FIELD, PRIMARY_ID_LANGUAGE } from "../../core/target/id_language.ts";
import { FieldIdLanguage, idLanguageLabel, idLanguageTooltip } from "../field_id_language.ts";
import { instanceEncodingDropdownOptions } from "../../types/mod.ts";
import {
  parseSlotCardinality,
  rmAttributeCardinality,
  type SlotCardinality,
} from "../slot_cardinality.ts";
import { appendSlotLabel } from "../slot_label.ts";
import { enforceMouthCaptionLayout, initMutatorStackMouth, inputAlignLeft, inputAlignRight } from "../mouth_layout.ts";
import {
  appendHiddenSerializable,
  createHiddenSerializableField,
} from "../hidden_serializable_field.ts";
import { createTermPickBlock, configureTermPick, isTermPickBlock, registerTermPickBlock } from "./term_pick.ts";
import { TERM_PICK_NONE, termSetForRmAttribute } from "../../core/openehr_term_catalog.ts";
import {
  appendMutatorCogwheel,
  namesFromMutatorStack,
  openBlockMutator,
  registerDynamicFlyoutMutator,
  type MutatorFlyoutBlock,
} from "../dynamic_mutator.ts";

export { openBlockMutator };

/** RM alias of {@link enforceMouthCaptionLayout}. */
export function enforceOpenEhrBlockLayout(block: Blockly.Block): void {
  enforceMouthCaptionLayout(block);
}

export const EVENT_KIND_OPTIONS: Array<[string, string]> = [
  ["EVENT", "EVENT"],
  ["POINT_EVENT", "POINT_EVENT"],
  ["INTERVAL_EVENT", "INTERVAL_EVENT"],
];

export const ITEM_STRUCTURE_KIND_OPTIONS: Array<[string, string]> = [
  ["ITEM_STRUCTURE", "ITEM_STRUCTURE"],
  ["ITEM_TREE", "ITEM_TREE"],
  ["ITEM_LIST", "ITEM_LIST"],
  ["ITEM_TABLE", "ITEM_TABLE"],
  ["ITEM_SINGLE", "ITEM_SINGLE"],
];

export const OPTIONAL_INPUT_PREFIX = "OPT_";
const OPTIONAL_DV_FIELD_PREFIX = "OPTFLD_";
export const RM_ATTR_INPUT_PREFIX = "ATTR_";
export const DV_FIELD_PREFIX = "FLD_";
/** Puzzle slot on abstract PARTY_PROXY for a concrete subclass. */
export const RM_SPECIALIZATION_INPUT = "KIND";

const STRUCTURE_COLOUR = "#003B49";
const CONTAINER_COLOUR = "#005C53";
const DV_COLOUR = "#4A6FA5";
const ELEMENT_COLOUR = "#3D7A6A";

/** ENTRY attrs shown last and collapsed on scaffold (issue #150). */
export const ENTRY_BOILERPLATE_ATTRS = ["subject", "language", "encoding"] as const;

/** Keep optional RM extras in ENTRY-tail order when the parent is an ENTRY. */
export function sortEntryBoilerplateExtras(rmType: string, names: string[]): string[] {
  if (!isEntryRmType(rmType)) return names;
  const tail = new Set<string>(ENTRY_BOILERPLATE_ATTRS);
  const rest = names.filter((name) => !tail.has(name));
  const trailing = ENTRY_BOILERPLATE_ATTRS.filter((name) => names.includes(name));
  return [...rest, ...trailing];
}

const RM_CONTAINER_TYPES = new Set<string>();

const EXTRA_RM_CONTAINERS = [
  "HISTORY",
  "EVENT",
  "POINT_EVENT",
  "INTERVAL_EVENT",
  "EVENT_CONTEXT",
  "ITEM_STRUCTURE",
  "ITEM_TREE",
  "ITEM_LIST",
  "ITEM_TABLE",
  "ITEM_SINGLE",
  "ACTIVITY",
  "PARTY_IDENTIFIED",
  "PARTY_SELF",
  "PARTY_RELATED",
  "PARTY_PROXY",
  "PARTICIPATION",
  "FEEDER_AUDIT",
  "FEEDER_AUDIT_DETAILS",
  "ISM_TRANSITION",
  "LINK",
  "ARCHETYPED",
  "GENERIC_ENTRY",
];

export function isEventFamilyType(rmType: string): boolean {
  const name = (rmType || "").toUpperCase();
  return name === "EVENT" || isSubtypeOf(name, "EVENT");
}

export function isItemStructureFamilyType(rmType: string): boolean {
  const name = (rmType || "").toUpperCase();
  return name === "ITEM_STRUCTURE" || isSubtypeOf(name, "ITEM_STRUCTURE");
}

function isPartyIdentityType(rmType: string): boolean {
  const name = (rmType || "").toUpperCase();
  return name === "PARTY_IDENTIFIED" || name === "PARTY_RELATED";
}

/** Default-visible identity attrs on PARTY_* blocks (not full Demographics product scope). */
function partyIdentityAttributes(): string[] {
  return ["name", "identifiers", "external_ref"];
}

function attributeTypeName(parentRmType: string, attr: string): string | undefined {
  return attributesFor(parentRmType).find((a) => a.name === attr)?.typeName;
}

function isListAttributeTypeName(typeName: string): boolean {
  return typeName.startsWith("List<");
}

export function isRmContainerBlockType(type: string): boolean {
  if (RM_CONTAINER_TYPES.has(type) || type === "element") return true;
  return EXTRA_RM_CONTAINERS.some((rmType) => blockTypeForRm(rmType) === type) ||
    [
      "composition",
      "section",
      "observation",
      "evaluation",
      "instruction",
      "action",
      "admin_entry",
      "cluster",
    ].includes(type);
}

export function optionalRmInputName(attr: string): string {
  return `${OPTIONAL_INPUT_PREFIX}${attr}`;
}

export function optionalRmExtrasOf(block: Blockly.Block): string[] {
  const extras = (block as Blockly.Block & { extraInputs_?: string[] }).extraInputs_;
  return extras?.length ? [...extras] : [];
}

export function registerRmBlocks(): void {
  defineContainerBlock("composition", [
    { name: "language" },
    { name: "territory" },
    { name: "category" },
    { name: "composer" },
    { name: "content", check: "CONTENT_ITEM" },
    { name: "context", check: "EVENT_CONTEXT" },
  ], CONTAINER_COLOUR, { expandable: true, rmType: "COMPOSITION" });

  defineContainerBlock("section", [
    { name: "items", check: "CONTENT_ITEM" },
  ], CONTAINER_COLOUR, {
    expandable: true,
    rmType: "SECTION",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("observation", [
    { name: "data" },
    { name: "state" },
    { name: "protocol" },
  ], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "OBSERVATION",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("evaluation", [
    { name: "data" },
    { name: "protocol" },
  ], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "EVALUATION",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("instruction", [
    { name: "activities" },
    { name: "protocol" },
  ], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "INSTRUCTION",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("action", [
    { name: "description" },
    { name: "protocol" },
  ], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "ACTION",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("admin_entry", [
    { name: "data" },
  ], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "ADMIN_ENTRY",
    nestCheck: "CONTENT_ITEM",
  });

  defineContainerBlock("cluster", [
    { name: "items" },
  ], ELEMENT_COLOUR, {
    expandable: true,
    rmType: "CLUSTER",
    nestCheck: ["ITEM", "CLUSTER", "ELEMENT"],
  });

  defineValueElementBlock();
  definePartyProxyBlock();
  definePartyRefBlock();
  for (const rmType of EXTRA_RM_CONTAINERS) {
    ensureRmContainerBlock(rmType);
  }
  defineDataValueBlocksFromMeta();
  defineCodePhraseBlock();
  registerTermPickBlock();
  registerOptionalRmMutator();
  registerDvFieldsMutator();
}

export function ensureRmBlockType(blockType: string, rmType: string): void {
  if (Blockly.Blocks[blockType]) return;
  if (rmType.startsWith("DV_") || rmType === "CODE_PHRASE" || isDataValueType(rmType)) {
    defineDataValueBlock(rmType);
    return;
  }
  ensureRmContainerBlock(rmType);
}

/** Structural mouths always shown: BMM-mandatory plus silent UI-mandatory (e.g. HISTORY.events). */
function alwaysVisibleMouthAttrs(rmType: string): string[] {
  const silent = new Set(mandatoryAttributesFor(rmType));
  return attributesFor(rmType)
    .filter((attr) => !isPrimitiveRmType(baseRmTypeName(attr.typeName)))
    .filter((attr) => attr.mandatory || silent.has(attr.name))
    .map((attr) => attr.name);
}

function ensureRmContainerBlock(rmType: string): string {
  const type = blockTypeForRm(rmType);
  if (Blockly.Blocks[type]) {
    RM_CONTAINER_TYPES.add(type);
    return type;
  }
  const inputs = alwaysVisibleMouthAttrs(rmType).map((name) => ({ name }));
  defineContainerBlock(type, inputs, STRUCTURE_COLOUR, {
    expandable: true,
    rmType,
    nestCheck: nestCheckFor(rmType),
  });
  return type;
}

function nestCheckFor(rmType: string): string | string[] | null {
  if (rmType === "COMPOSITION") return null;
  if (isSubtypeOf(rmType, "CONTENT_ITEM")) return "CONTENT_ITEM";
  if (isSubtypeOf(rmType, "ITEM")) return ["ITEM", "CLUSTER", "ELEMENT"];
  if (isSubtypeOf(rmType, "EVENT") || rmType === "EVENT") return "EVENT";
  if (rmType === "GENERIC_ENTRY") return "CONTENT_ITEM";
  if (rmType === "HISTORY") return "HISTORY";
  if (isSubtypeOf(rmType, "ITEM_STRUCTURE")) {
    return ["ITEM_STRUCTURE", "ITEM_TREE", "ITEM_LIST", "ITEM_TABLE", "ITEM_SINGLE"];
  }
  if (isSubtypeOf(rmType, "PARTY_PROXY")) return partyProxyNestCheck(rmType);
  if (rmType === "EVENT_CONTEXT") return "EVENT_CONTEXT";
  if (rmType === "ACTIVITY") return "ACTIVITY";
  return rmType;
}

/** Blockly output types: own class plus PARTY_PROXY ancestors so slots match. */
function partyProxyNestCheck(rmType: string): string | string[] {
  const checks = new Set<string>([rmType, "PARTY_PROXY"]);
  if (isSubtypeOf(rmType, "PARTY_IDENTIFIED")) checks.add("PARTY_IDENTIFIED");
  const list = [...checks];
  return list.length === 1 ? list[0]! : list;
}

function partyProxySpecializationCheck(): string[] {
  return subtypesOf("PARTY_PROXY", { concreteOnly: true }).slice().sort();
}

function definePartyProxyBlock(): void {
  defineContainerBlock("party_proxy", [], STRUCTURE_COLOUR, {
    expandable: true,
    rmType: "PARTY_PROXY",
    nestCheck: nestCheckFor("PARTY_PROXY"),
    specializationCheck: partyProxySpecializationCheck(),
  });
}

/** PARTY_REF shell: external reference by id / namespace / type (OBJECT_ID.value flattened to id). */
function definePartyRefBlock(): void {
  const type = "party_ref";
  RM_CONTAINER_TYPES.add(type);
  Blockly.Blocks[type] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputEmoji(header, "PARTY_REF");
      header.appendField(new FieldSkeletonTitle("PARTY_REF"), "NAME");
      for (const attr of ["id", "namespace", "type"] as const) {
        const input = this.appendValueInput(rmAttributeInputName(attr))
          .setAlign(inputAlignRight());
        input.setCheck("String");
        appendSlotLabel(input, attr, {
          card: rmAttributeCardinality("PARTY_REF", attr) ?? { min: 1, max: 1 },
          rmType: "String",
        });
      }
      appendHiddenSerializable(this, "RM_TYPE", "PARTY_REF");
      this.setOutput(true, "PARTY_REF");
      this.setColour(STRUCTURE_COLOUR);
      this.setTooltip("openEHR RM PARTY_REF — external party reference");
      enforceOpenEhrBlockLayout(this);
    },
  };
}

/** Blockly type for a DATA_VALUE leaf, ensuring the def exists. */
export function ensureDataValueBlock(rmType: string): string {
  const type = blockTypeForRm(rmType);
  if (!Blockly.Blocks[type]) {
    defineDataValueBlock(rmType);
  }
  return type;
}

/** Ordered RM attribute names for statement inputs on a container block. */
export function orderedRmAttributes(rmType: string, present: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const meta = attributesFor(rmType);
  const silent = new Set(mandatoryAttributesFor(rmType));
  const boilerplate = isEntryRmType(rmType)
    ? new Set<string>(ENTRY_BOILERPLATE_ATTRS)
    : new Set<string>();
  const mandatoryNames = meta
    .filter((a) => a.mandatory || silent.has(a.name))
    .map((a) => a.name);
  const optionalNames = meta
    .filter((a) => !a.mandatory && !silent.has(a.name))
    .map((a) => a.name);
  const preferred = [...mandatoryNames, ...optionalNames];
  const fallback = preferred.length ? preferred : mandatoryAttributesFor(rmType);

  for (const attr of fallback) {
    if (present.includes(attr) && !seen.has(attr) && !boilerplate.has(attr)) {
      ordered.push(attr);
      seen.add(attr);
    }
  }
  for (const attr of present) {
    if (!seen.has(attr) && !boilerplate.has(attr)) {
      ordered.push(attr);
      seen.add(attr);
    }
  }
  for (const attr of ENTRY_BOILERPLATE_ATTRS) {
    if (present.includes(attr) && !seen.has(attr)) {
      ordered.push(attr);
      seen.add(attr);
    }
  }
  return ordered;
}

export function isEntryRmType(rmType: string): boolean {
  const name = (rmType || "").toUpperCase();
  return name === "ENTRY" || isSubtypeOf(name, "ENTRY");
}

/** Collapse subject / language / encoding children on ENTRY subclasses. */
export function collapseEntryBoilerplateChildren(block: Blockly.Block): void {
  if (!isEntryRmType(rmTypeOfBlock(block))) return;
  for (const attr of ENTRY_BOILERPLATE_ATTRS) {
    const child = block.getInputTargetBlock(rmAttributeInputName(attr)) ??
      block.getInputTargetBlock(optionalRmInputName(attr));
    if (!child) continue;
    if (typeof child.isShadow === "function" && child.isShadow()) continue;
    if (typeof child.setCollapsed === "function") child.setCollapsed(true);
  }
}

/** Replace dynamic RM-attribute statement inputs (labels = lowercase RM names). */
export function syncRmAttributeInputs(
  block: Blockly.Block,
  rmType: string,
  attributes: string[],
  cardinalities?: Record<string, SlotCardinality>,
): void {
  const saved = snapshotAttributeConnections(block);
  for (const input of [...block.inputList]) {
    if (input.name.startsWith(RM_ATTR_INPUT_PREFIX)) {
      block.removeInput(input.name);
    }
  }
  for (const attr of orderedRmAttributes(rmType, attributes)) {
    appendRmAttributeInput(
      block,
      rmType,
      attr,
      undefined,
      cardinalities?.[attr] ?? slotCardinalityFor(block, rmType, attr),
    );
  }
  restoreAttributeConnections(block, saved);
  enforceOpenEhrBlockLayout(block);
}

/**
 * Switch an EVENT-family block between EVENT / POINT_EVENT / INTERVAL_EVENT
 * without dropping already-attached children. Extra INTERVAL_EVENT fields
 * appear when needed; filled extras are kept if the user switches away.
 *
 * `mandatedMathFunction` — only when a template/archetype picks a single
 * math_function code; otherwise the scaffolded term_pick stays on "choose…".
 */
export function applyEventRmType(
  block: Blockly.Block,
  newType: string,
  options?: { mandatedMathFunction?: string },
): void {
  const next = (newType || "").toUpperCase();
  if (!isEventFamilyType(next)) return;

  const current = String(block.getFieldValue("RM_TYPE") || "").toUpperCase();
  if (current !== next && block.getField("RM_TYPE")) {
    block.setFieldValue(next, "RM_TYPE");
  }

  const emoji = block.getField(BLOCK_OUT_EMOJI_FIELD);
  if (isRmTypeEmojiField(emoji)) emoji.setRmType(next);
  const title = block.getField("NAME");
  if (isSkeletonTitleField(title)) title.setClassName(next);

  const connected = presentAttributeNames(block).filter((name) =>
    Boolean(
      block.getInput(rmAttributeInputName(name))?.connection?.targetBlock() ||
        block.getInput(optionalRmInputName(name))?.connection?.targetBlock(),
    )
  );
  const show = eventAttributesToShow(next, connected);
  const cards = { ...(block.slotCardinalities_ ?? {}) };
  syncRmAttributeInputs(block, next, show, cards);
  if (next === "INTERVAL_EVENT") {
    ensureIntervalEventMathFunctionScaffold(block, options?.mandatedMathFunction);
  }
  if (typeof block.render === "function" && typeof document !== "undefined") {
    block.render();
  }
}

/**
 * Attach a built-in math_function term_pick when the mouth is empty.
 * Leaves CODE at "choose…" unless the template mandated a single code.
 * If a choose… pick is already attached and a mandated code arrives, upgrade it.
 */
export function ensureIntervalEventMathFunctionScaffold(
  block: Blockly.Block,
  mandatedCode?: string,
): void {
  if (String(block.getFieldValue("RM_TYPE") || "").toUpperCase() !== "INTERVAL_EVENT") {
    return;
  }
  const input = block.getInput(rmAttributeInputName("math_function"));
  if (!input?.connection || !block.workspace) return;
  const termSet = termSetForRmAttribute("INTERVAL_EVENT", "math_function");
  if (!termSet) return;

  const existing = input.connection.targetBlock();
  if (existing) {
    if (isTermPickBlock(existing) && mandatedCode) {
      const code = String(existing.getFieldValue("CODE") || "");
      if (!code || code === TERM_PICK_NONE) {
        configureTermPick(existing, termSet, mandatedCode);
      }
    }
    return;
  }
  const pick = createTermPickBlock(block.workspace, termSet, mandatedCode);
  try {
    input.connection.connect(pick.outputConnection!);
  } catch {
    pick.dispose(false);
  }
}

function eventAttributesToShow(rmType: string, connected: string[]): string[] {
  const names = new Set<string>(connected);
  for (const attr of ["time", "data"]) names.add(attr);
  if (rmType === "INTERVAL_EVENT") {
    names.add("width");
    names.add("math_function");
    names.add("sample_count");
  }
  return [...names];
}

/**
 * Switch an ITEM_STRUCTURE-family block between abstract ITEM_STRUCTURE and
 * concrete subtypes without dropping already-attached children.
 */
export function applyItemStructureRmType(block: Blockly.Block, newType: string): void {
  const next = (newType || "").toUpperCase();
  if (!isItemStructureFamilyType(next)) return;

  const current = String(block.getFieldValue("RM_TYPE") || "").toUpperCase();
  if (current !== next && block.getField("RM_TYPE")) {
    block.setFieldValue(next, "RM_TYPE");
  }

  const emoji = block.getField(BLOCK_OUT_EMOJI_FIELD);
  if (isRmTypeEmojiField(emoji)) emoji.setRmType(next);
  const title = block.getField("NAME");
  if (isSkeletonTitleField(title)) title.setClassName(next);

  const connected = presentAttributeNames(block).filter((name) =>
    Boolean(
      block.getInput(rmAttributeInputName(name))?.connection?.targetBlock() ||
        block.getInput(optionalRmInputName(name))?.connection?.targetBlock(),
    )
  );
  const show = itemStructureAttributesToShow(next, connected);
  const cards = { ...(block.slotCardinalities_ ?? {}) };
  syncRmAttributeInputs(block, next, show, cards);
  if (typeof block.render === "function" && typeof document !== "undefined") {
    block.render();
  }
}

function itemStructureAttributesToShow(rmType: string, connected: string[]): string[] {
  const names = new Set<string>(connected);
  names.add("name");
  const t = rmType.toUpperCase();
  if (t === "ITEM_SINGLE") names.add("item");
  else if (t === "ITEM_TABLE") names.add("rows");
  else names.add("items");
  return [...names];
}

function slotCardinalityFor(
  block: Blockly.Block,
  rmType: string,
  attr: string,
): SlotCardinality | undefined {
  return block.slotCardinalities_?.[attr] ??
    rmAttributeCardinality(rmType, attr) ??
    parseSlotCardinality("0..1");
}

function snapshotAttributeConnections(
  block: Blockly.Block,
): Record<string, Blockly.Block[]> {
  const saved: Record<string, Blockly.Block[]> = {};
  for (const input of [...block.inputList]) {
    if (!input.name.startsWith(RM_ATTR_INPUT_PREFIX)) continue;
    const attr = input.name.slice(RM_ATTR_INPUT_PREFIX.length);
    const first = input.connection?.targetBlock();
    if (!first) continue;
    const chain: Blockly.Block[] = [];
    if (first.outputConnection && !first.previousConnection) {
      first.outputConnection.disconnect();
      chain.push(first);
    } else {
      let current: Blockly.Block | null = first;
      while (current) {
        const next = current.getNextBlock();
        if (current.nextConnection?.isConnected()) current.nextConnection.disconnect();
        if (current.previousConnection?.isConnected()) {
          current.previousConnection.disconnect();
        }
        chain.push(current);
        current = next;
      }
    }
    saved[attr] = chain;
  }
  return saved;
}

function restoreAttributeConnections(
  block: Blockly.Block,
  saved: Record<string, Blockly.Block[]>,
): void {
  for (const [attr, blocks] of Object.entries(saved)) {
    const input = block.getInput(rmAttributeInputName(attr)) ??
      block.getInput(optionalRmInputName(attr));
    if (!input?.connection || !blocks.length) continue;
    const head = blocks[0]!;
    const headConn = head.outputConnection && !head.previousConnection
      ? head.outputConnection
      : head.previousConnection;
    if (headConn) tryConnect(input, headConn);
    let previous = head;
    for (const child of blocks.slice(1)) {
      if (previous.nextConnection && child.previousConnection) {
        try {
          previous.nextConnection.connect(child.previousConnection);
        } catch {
          /* type mismatch */
        }
      }
      previous = child;
    }
  }
}

function tryConnect(
  input: Blockly.Input,
  childConn: Blockly.Connection,
): void {
  const parentConn = input.connection;
  if (!parentConn) return;
  const attempt = (): void => {
    if (parentConn.isConnected()) parentConn.disconnect();
    parentConn.connect(childConn);
  };
  try {
    attempt();
  } catch {
    /* type check rejected */
  }
  if (parentConn.targetConnection === childConn) return;
  const prevCheck = parentConn.getCheck();
  input.setCheck(null);
  try {
    attempt();
  } catch {
    /* still incompatible */
  } finally {
    if (prevCheck) input.setCheck(prevCheck);
  }
}

function appendRmAttributeInput(
  block: Blockly.Block,
  rmType: string,
  attr: string,
  checkOverride?: string | string[] | null,
  cardinality?: SlotCardinality,
): void {
  const slotType = slotRmTypeForAttr(rmType, attr);
  const typeName = attributeTypeName(rmType, attr) ?? "";
  const listElement = isListAttributeTypeName(typeName)
    ? baseRmTypeName(typeName)
    : null;
  const card = cardinality ?? slotCardinalityFor(block, rmType, attr);
  const rmCard = block.rmCardinalities_?.[attr] ?? rmAttributeCardinality(rmType, attr);
  const labelOpts = { card, rmCard, rmType: slotType as string | undefined };

  if (slotType === "PARTY_REF" || typeName === "PARTY_REF") {
    const input = block.appendValueInput(rmAttributeInputName(attr))
      .setAlign(inputAlignRight());
    // Match party_ref block output check ("PARTY_REF"), not the block type id.
    input.setCheck(checkOverride ?? "PARTY_REF");
    appendSlotLabel(input, attr, { ...labelOpts, rmType: "PARTY_REF" });
    return;
  }

  if (listElement && isDataValueType(listElement)) {
    const input = block.appendValueInput(rmAttributeInputName(attr))
      .setAlign(inputAlignRight());
    const dvCheck = blocklyCheckForDv(listElement);
    // lists_create_with outputs "Array", not its block type name.
    input.setCheck(checkOverride ?? (dvCheck ? [dvCheck, "Array"] : "Array"));
    appendSlotLabel(input, attr, { ...labelOpts, rmType: listElement });
    return;
  }

  if (isRmValueAttribute(rmType, attr) || isPartyProxyType(slotType)) {
    const input = block.appendValueInput(rmAttributeInputName(attr))
      .setAlign(inputAlignRight());
    const check = checkOverride ?? puzzleCheckForAttr(rmType, attr, slotType);
    if (check) input.setCheck(check);
    appendSlotLabel(input, attr, labelOpts);
    return;
  }
  const stmt = block.appendStatementInput(rmAttributeInputName(attr))
    .setAlign(inputAlignRight());
  const check = checkOverride ?? statementCheckForAttr(rmType, attr);
  if (check) stmt.setCheck(check);
  appendSlotLabel(stmt, attr, labelOpts);
}

function puzzleCheckForAttr(
  _rmType: string,
  _attr: string,
  slotType: string | undefined,
): string | string[] | null {
  if (isPartyProxyType(slotType)) return slotType ?? "PARTY_PROXY";
  return slotType ? blocklyCheckForDv(slotType) : null;
}

function isPartyProxyType(rmType: string | undefined): boolean {
  return Boolean(rmType && isSubtypeOf(rmType, "PARTY_PROXY"));
}

function statementCheckForAttr(
  rmType: string,
  attr: string,
): string | string[] | null {
  const slotType = slotRmTypeForAttr(rmType, attr);
  if (!slotType || isPrimitiveRmType(slotType) || isDataValueType(slotType)) return null;
  return nestCheckFor(slotType) ?? slotType;
}

export function rmTypeOfBlock(block: Blockly.Block): string {
  if (block.type === "element") return "ELEMENT";
  return (block.getFieldValue("RM_TYPE") || block.type || "").toUpperCase();
}

/** Concrete DATA_VALUE of an ELEMENT value mouth. Older canvases stored it in RM_TYPE. */
export function elementValueDvType(block: Blockly.Block): string {
  const stored = String(block.getFieldValue("VALUE_RM_TYPE") || "");
  if (stored && isDataValueType(stored) && stored !== "DATA_VALUE" && stored !== "ELEMENT") {
    return stored;
  }
  const legacy = String(block.getFieldValue("RM_TYPE") || "");
  if (legacy && isDataValueType(legacy) && legacy !== "DATA_VALUE" && legacy !== "ELEMENT") {
    return legacy;
  }
  const shellType = String(block.getInputTargetBlock("VALUE")?.getFieldValue("RM_TYPE") || "");
  if (shellType && isDataValueType(shellType) && shellType !== "DATA_VALUE") return shellType;
  return "DV_TEXT";
}

/**
 * Element blocks keep SLOT_ID on the value leaf. Optional RM attaches to the
 * ELEMENT container, which is this id when the field is present.
 */
export function elementContainerSlotId(block: Blockly.Block): string {
  const stored = String(block.getFieldValue("ELEMENT_SLOT_ID") || "");
  if (stored) return stored;
  const slotId = String(block.getFieldValue("SLOT_ID") || "");
  const cut = slotId.search(/\/value(?:\/|$)/);
  return cut > 0 ? slotId.slice(0, cut) : slotId;
}

export function presentAttributeNames(block: Blockly.Block): string[] {
  const names = new Set<string>(block.extraInputs_ ?? []);
  for (const input of block.inputList) {
    if (input.name.startsWith(RM_ATTR_INPUT_PREFIX)) {
      names.add(input.name.slice(RM_ATTR_INPUT_PREFIX.length));
    }
    if (input.name.startsWith(OPTIONAL_INPUT_PREFIX)) {
      names.add(input.name.slice(OPTIONAL_INPUT_PREFIX.length));
    }
  }
  return [...names];
}

/** ATTR_ mouths only — extras stay on OPT_ so extraState round-trips. */
export function presentFixedAttributeNames(block: Blockly.Block): string[] {
  const names: string[] = [];
  for (const input of block.inputList) {
    if (input.name.startsWith(RM_ATTR_INPUT_PREFIX)) {
      names.push(input.name.slice(RM_ATTR_INPUT_PREFIX.length));
    }
  }
  return names;
}

export function rmAttributeInputName(attr: string): string {
  return `${RM_ATTR_INPUT_PREFIX}${attr}`;
}

export function dvFieldInputName(attr: string): string {
  return `${DV_FIELD_PREFIX}${attr}`;
}

/** ELEMENT.value accepts a typed DATA_VALUE shell (not raw expressions). RM existence is 0..1. */
export function configureElementValueSlot(block: Blockly.Block, rmType: string): void {
  const input = block.getInput("VALUE");
  if (!input) return;
  const check = blocklyCheckForDv(rmType);
  input.setCheck(check);
  const card = rmAttributeCardinality("ELEMENT", "value") ?? { min: 0, max: 1 };
  appendSlotLabel(input, "value", { card, rmCard: card, rmType: "DATA_VALUE" });
  if (block.getField("VALUE_RM_TYPE") && rmType && rmType !== "DATA_VALUE") {
    block.setFieldValue(rmType, "VALUE_RM_TYPE");
  }
}

/** Create (or return) the DATA_VALUE shell on an ELEMENT value input. */
export function ensureElementDataValueShell(
  workspace: Blockly.Workspace,
  elementBlock: Blockly.Block,
  rmType: string,
): Blockly.Block | null {
  const valueInput = elementBlock.getInput("VALUE");
  if (!valueInput?.connection) return null;

  const existing = valueInput.connection.targetBlock();
  if (existing && isDataValueBlock(existing)) {
    return existing;
  }
  if (existing) existing.dispose(false);

  const blockType = ensureDataValueBlock(rmType);
  const shell = workspace.newBlock(blockType);
  if (shell.getField("RM_TYPE")) {
    shell.setFieldValue(rmType, "RM_TYPE");
  }
  const slotId = elementBlock.getFieldValue("SLOT_ID");
  if (slotId && shell.getField("SLOT_ID")) {
    shell.setFieldValue(slotId, "SLOT_ID");
  }
  if (shell.outputConnection) {
    valueInput.connection.connect(shell.outputConnection);
  }
  if (typeof document !== "undefined") {
    const shellSvg = shell as BlockSvg;
    shellSvg.initSvg?.();
    shellSvg.render?.();
    const parentSvg = elementBlock as BlockSvg;
    if (typeof parentSvg.render === "function") parentSvg.render();
  }
  return shell;
}

/**
 * Pre-fill RM/template-constrained fields (e.g. terminology_id = ISO_639-1)
 * as Blockly shadow text so they are present from the first canvas.
 */
export function applyFixedFieldsToDataValueShell(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  fields: Record<string, string> | undefined,
): void {
  if (!fields) return;
  const rmType = (shell.getFieldValue("RM_TYPE") || shell.type || "").toUpperCase();
  const isPhrase = shell.type === "code_phrase" || rmType === "CODE_PHRASE";

  if (isPhrase) {
    if (fields.terminology_id) {
      connectLiteralText(workspace, shell, dvFieldInputName("terminology_id"), fields.terminology_id);
    }
    const code = fields.code_string ?? fields.defining_code ?? fields.value;
    if (code) {
      connectLiteralText(workspace, shell, dvFieldInputName("code_string"), code);
    }
    return;
  }

  if (rmType === "DV_ORDINAL" || rmType === "DV_SCALE") {
    applyOrdinalFieldsToDataValueShell(workspace, shell, fields);
    return;
  }

  if (fields.value) {
    ensureDvFieldVisible(shell, "value");
    connectLiteralText(workspace, shell, dvFieldInputName("value"), fields.value);
  }

  if (fields.units) {
    ensureDvFieldVisible(shell, "units");
    connectLiteralText(workspace, shell, dvFieldInputName("units"), fields.units);
  }

  if (fields.terminology_id || fields.defining_code || fields.code_string) {
    ensureDvFieldVisible(shell, "defining_code");
    const phrase = ensureNestedCodePhrase(workspace, shell, dvFieldInputName("defining_code"));
    if (phrase) {
      applyFixedFieldsToDataValueShell(workspace, phrase, {
        terminology_id: fields.terminology_id ?? "",
        code_string: fields.defining_code ?? fields.code_string ?? "",
      });
    }
  }
}

function ensureNestedCodePhrase(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  inputName: string,
): Blockly.Block | null {
  const input = shell.getInput(inputName);
  if (!input?.connection) return null;
  const existing = input.connection.targetBlock();
  if (existing && (existing.type === "code_phrase" || existing.getFieldValue("RM_TYPE") === "CODE_PHRASE")) {
    return existing;
  }
  if (existing) return null;
  ensureRmBlockType("code_phrase", "CODE_PHRASE");
  const phrase = workspace.newBlock("code_phrase");
  if (phrase.outputConnection) {
    input.connection.connect(phrase.outputConnection);
  }
  if (typeof document !== "undefined") {
    const svg = phrase as BlockSvg;
    svg.initSvg?.();
    svg.render?.();
  }
  return phrase;
}

function connectLiteralText(
  _workspace: Blockly.Workspace,
  parent: Blockly.Block,
  inputName: string,
  value: string,
): void {
  if (!value) return;
  const input = parent.getInput(inputName);
  if (!input?.connection) return;
  if (input.connection.targetBlock()) return;
  if (typeof input.connection.setShadowState === "function") {
    input.connection.setShadowState({
      type: "text",
      fields: { TEXT: value },
    });
    return;
  }
  const text = _workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  if (text.outputConnection) input.connection.connect(text.outputConnection);
}

export function applyOrdinalFieldsToDataValueShell(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  fields: Record<string, string>,
): void {
  if (fields.value) {
    ensureDvFieldVisible(shell, "value");
    connectLiteralNumber(workspace, shell, dvFieldInputName("value"), Number(fields.value));
  }
  if (
    fields.symbol_value || fields.terminology_id || fields.defining_code || fields.code_string
  ) {
    ensureDvFieldVisible(shell, "symbol");
    const symbol = ensureNestedDvCodedText(workspace, shell, dvFieldInputName("symbol"));
    if (symbol) {
      applyFixedFieldsToDataValueShell(workspace, symbol, {
        value: fields.symbol_value ?? "",
        terminology_id: fields.terminology_id ?? "",
        defining_code: fields.defining_code ?? fields.code_string ?? "",
        code_string: fields.code_string ?? fields.defining_code ?? "",
      });
    }
  }
}

function connectLiteralNumber(
  workspace: Blockly.Workspace,
  parent: Blockly.Block,
  inputName: string,
  value: number,
): void {
  if (!Number.isFinite(value)) return;
  const input = parent.getInput(inputName);
  if (!input?.connection) return;
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  const num = workspace.newBlock("math_number");
  num.setFieldValue(String(value), "NUM");
  if (num.outputConnection) input.connection.connect(num.outputConnection);
}

function ensureNestedDvCodedText(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  inputName: string,
): Blockly.Block | null {
  const input = shell.getInput(inputName);
  if (!input?.connection) return null;
  const existing = input.connection.targetBlock();
  if (existing && isDataValueBlock(existing) && existing.getFieldValue("RM_TYPE") === "DV_CODED_TEXT") {
    return existing;
  }
  if (existing) return null;
  ensureRmBlockType("dv_coded_text", "DV_CODED_TEXT");
  const coded = workspace.newBlock("dv_coded_text");
  if (coded.outputConnection) {
    input.connection.connect(coded.outputConnection);
  }
  if (typeof document !== "undefined") {
    const svg = coded as BlockSvg;
    svg.initSvg?.();
    svg.render?.();
  }
  return coded;
}

const TEXT_SHELLS = new Set(["DV_TEXT", "DV_CODED_TEXT"]);

/**
 * Swap a DV_TEXT shell for DV_CODED_TEXT or back (#274), keeping its slot id,
 * mandatory flag, parent connection and the `value` mapping. Returns the
 * shell now on the canvas (the same one when nothing changes).
 */
export function switchTextShellRmType(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  rmType: string,
): Blockly.Block {
  const current = String(shell.getFieldValue("RM_TYPE") ?? "");
  if (current === rmType || !TEXT_SHELLS.has(current) || !TEXT_SHELLS.has(rmType)) return shell;
  const parent = shell.outputConnection?.targetConnection ?? null;
  const text = shell.getInputTargetBlock(dvFieldInputName("value"));
  text?.outputConnection?.disconnect();
  const blockType = blockTypeForRm(rmType);
  ensureRmBlockType(blockType, rmType);
  const next = workspace.newBlock(blockType);
  for (const field of ["SLOT_ID", "MANDATORY"]) {
    if (next.getField(field)) next.setFieldValue(shell.getFieldValue(field) ?? "", field);
  }
  shell.dispose(false);
  if (typeof document !== "undefined") {
    (next as BlockSvg).initSvg?.();
    (next as BlockSvg).render?.();
  }
  if (parent && next.outputConnection) parent.connect(next.outputConnection);
  const input = next.getInput(dvFieldInputName("value"));
  if (text?.outputConnection && input?.connection) input.connection.connect(text.outputConnection);
  if (rmType === "DV_CODED_TEXT") {
    // Show the code_string / terminology_id sockets to fill in.
    ensureDvFieldVisible(next, "defining_code");
    ensureNestedCodePhrase(workspace, next, dvFieldInputName("defining_code"));
  }
  return next;
}

export function isDataValueBlock(block: Blockly.Block): boolean {
  const rm = block.getFieldValue("RM_TYPE") || "";
  return block.type.startsWith("dv_") || rm.startsWith("DV_") || block.type === "code_phrase";
}

/** Attach an expression block into the primary mapping field of a DV shell. */
export function connectExpressionToDataValueShell(
  shell: Blockly.Block,
  exprBlock: Blockly.Block,
): boolean {
  if (exprBlock.type === "maps_create_with" && unpackMapCreateOntoDataValue(shell, exprBlock)) {
    return true;
  }
  const rmType = shell.getFieldValue("RM_TYPE") || shell.type.toUpperCase();
  const primary = primaryMappingAttribute(rmType);
  if (!primary) return false;
  ensureDvFieldVisible(shell, primary.name);
  const input = shell.getInput(dvFieldInputName(primary.name));
  if (!input?.connection) return false;
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  if (exprBlock.outputConnection) {
    input.connection.connect(exprBlock.outputConnection);
  }
  return true;
}

type MapCreateBlock = Blockly.Block & { itemCount_?: number };

/** Wire `map("magnitude", …, "units", …)` / coded-text keys onto DV field sockets. */
function unpackMapCreateOntoDataValue(
  shell: Blockly.Block,
  mapBlock: MapCreateBlock,
): boolean {
  const count = Number(mapBlock.itemCount_ ?? 0);
  const pairs: Array<{ key: string; value: Blockly.Block | null }> = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      key: String(mapBlock.getFieldValue(`KEY${i}`) ?? ""),
      value: mapBlock.getInputTargetBlock(`VAL${i}`),
    });
  }
  const known = new Set([
    "magnitude",
    "units",
    "value",
    "code_string",
    "terminology_id",
    "defining_code",
    "id",
    "type",
  ]);
  if (!pairs.some((pair) => known.has(pair.key))) return false;

  const rmType = (shell.getFieldValue("RM_TYPE") || shell.type || "").toUpperCase();
  let phrase: Blockly.Block | null = null;
  const needsPhrase = pairs.some((pair) =>
    pair.key === "code_string" || pair.key === "defining_code" || pair.key === "terminology_id"
  ) && rmType !== "CODE_PHRASE" && shell.type !== "code_phrase";
  if (needsPhrase) {
    ensureDvFieldVisible(shell, "defining_code");
    phrase = ensureNestedCodePhrase(shell.workspace, shell, dvFieldInputName("defining_code"));
  }

  for (const pair of pairs) {
    const child = pair.value;
    if (!child || child.isShadow()) continue;
    child.outputConnection?.disconnect();
    if (
      pair.key === "code_string" || pair.key === "defining_code" || pair.key === "terminology_id"
    ) {
      const target = phrase ?? shell;
      const field = pair.key === "defining_code" ? "code_string" : pair.key;
      ensureDvFieldVisible(target, field);
      connectBlockToDvField(target, field, child);
      continue;
    }
    ensureDvFieldVisible(shell, pair.key);
    connectBlockToDvField(shell, pair.key, child);
  }
  mapBlock.dispose(false);
  return true;
}

function connectBlockToDvField(
  parent: Blockly.Block,
  attr: string,
  child: Blockly.Block,
): void {
  const input = parent.getInput(dvFieldInputName(attr)) ??
    parent.getInput(`${OPTIONAL_DV_FIELD_PREFIX}${attr}`);
  if (!input?.connection || !child.outputConnection) return;
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  try {
    input.connection.connect(child.outputConnection);
  } catch {
    const prev = input.connection.getCheck();
    input.setCheck(null);
    try {
      input.connection.connect(child.outputConnection);
    } catch {
      /* still incompatible */
    } finally {
      if (prev) input.setCheck(prev);
    }
  }
}

export function expressionBlockFromDataValueShell(
  shell: Blockly.Block | null,
): Blockly.Block | null {
  if (!shell) return null;
  const rmType = shell.getFieldValue("RM_TYPE") || "";
  const primary = primaryMappingAttribute(rmType);
  if (!primary) return null;
  return shell.getInputTargetBlock(dvFieldInputName(primary.name));
}

type StatementInputDef = {
  name: string;
  check?: string | string[] | null;
};

function withEntryBoilerplate(
  rmType: string,
  inputs: StatementInputDef[],
): StatementInputDef[] {
  if (!isEntryRmType(rmType)) return inputs;
  const names = new Set(inputs.map((row) => row.name));
  const extra = ENTRY_BOILERPLATE_ATTRS
    .filter((name) => !names.has(name))
    .map((name) => ({ name }));
  return [...inputs, ...extra];
}

function defineContainerBlock(
  type: string,
  inputs: StatementInputDef[],
  colour: string,
  options: {
    expandable?: boolean;
    rmType: string;
    nestCheck?: string | string[] | null;
    specializationCheck?: string | string[] | null;
  },
): void {
  RM_CONTAINER_TYPES.add(type);
  Blockly.Blocks[type] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputEmoji(header, options.rmType);
      if (isEventFamilyType(options.rmType)) {
        header.appendField(new Blockly.FieldDropdown(EVENT_KIND_OPTIONS), "RM_TYPE");
        this.setFieldValue(options.rmType, "RM_TYPE");
      } else if (isItemStructureFamilyType(options.rmType)) {
        header.appendField(new Blockly.FieldDropdown(ITEM_STRUCTURE_KIND_OPTIONS), "RM_TYPE");
        this.setFieldValue(options.rmType, "RM_TYPE");
      }
      header.appendField(new FieldSkeletonTitle(options.rmType), "NAME");
      if (options.expandable) appendMutatorCogwheel(header);
      if (options.rmType === "COMPOSITION") {
        // Own row under the class title so a long "Canonical JSON" label
        // does not stretch the HEADER (and every C-mouth under it).
        const encoding = this.appendDummyInput("ENCODING").setAlign(inputAlignLeft());
        encoding.appendField(
          new FieldDropdownHug(instanceEncodingDropdownOptions()),
          INSTANCE_ENCODING_FIELD,
        );
        // #289: Web Template id / FLAT path language of this target file.
        const ids = this.appendDummyInput(ID_LANGUAGE_FIELD).setAlign(inputAlignLeft());
        ids.appendField(idLanguageLabel());
        const idField = new FieldIdLanguage();
        idField.setTooltip(idLanguageTooltip());
        ids.appendField(idField, ID_LANGUAGE_FIELD);
      }
      if (options.specializationCheck) {
        const kind = this.appendValueInput(RM_SPECIALIZATION_INPUT)
          .setAlign(inputAlignRight());
        kind.setCheck(options.specializationCheck);
        appendSlotTypeEmoji(kind, options.rmType);
      }
      const inputDefs = withEntryBoilerplate(options.rmType, inputs);
      const byName = new Map(inputDefs.map((row) => [row.name, row]));
      for (const attr of orderedRmAttributes(options.rmType, inputDefs.map((row) => row.name))) {
        const def = byName.get(attr);
        appendRmAttributeInput(this, options.rmType, attr, def?.check);
      }
      if (isPartyIdentityType(options.rmType)) {
        for (const attr of partyIdentityAttributes()) {
          if (!this.getInput(rmAttributeInputName(attr))) {
            appendRmAttributeInput(this, options.rmType, attr);
          }
        }
      }
      appendHiddenSerializable(this, "SLOT_ID", "");
      if (!isEventFamilyType(options.rmType) && !isItemStructureFamilyType(options.rmType)) {
        appendHiddenSerializable(this, "RM_TYPE", options.rmType);
      }
      appendHiddenSerializable(this, "MANDATORY", "");
      appendHiddenSerializable(this, "ARCHETYPE_NODE_ID", "");
      appendHiddenSerializable(this, "ARCHETYPE_CTX", "");
      this.setColour(colour);
      this.setTooltip(`openEHR RM ${options.rmType}`);
      if (isPartyProxyType(options.rmType)) {
        this.setOutput(true, options.nestCheck ?? options.rmType);
      } else if (options.nestCheck) {
        this.setPreviousStatement(true, options.nestCheck);
        this.setNextStatement(true, options.nestCheck);
      }
      if (options.expandable) {
        Blockly.Extensions.apply("optional_rm_mutator", this, true);
      }
      if (options.rmType === "COMPOSITION") {
        this.setPreviousStatement(true, INSTANCE_ROOT_CONNECTION);
        this.setNextStatement(true, INSTANCE_ROOT_CONNECTION);
        this.setFieldValue("canonical-json", INSTANCE_ENCODING_FIELD);
        this.setFieldValue(PRIMARY_ID_LANGUAGE, ID_LANGUAGE_FIELD);
      }
      enforceOpenEhrBlockLayout(this);
      if (options.rmType === "INTERVAL_EVENT") {
        ensureIntervalEventMathFunctionScaffold(this);
      }
    },
  };
}

function defineValueElementBlock(): void {
  RM_CONTAINER_TYPES.add("element");
  Blockly.Blocks["element"] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputEmoji(header, "ELEMENT");
      header.appendField(new FieldSkeletonTitle("ELEMENT"), "NAME");
      appendMutatorCogwheel(header);
      const value = this.appendValueInput("VALUE")
        .setAlign(inputAlignRight())
        .setCheck("DATA_VALUE");
      const valueCard = rmAttributeCardinality("ELEMENT", "value") ?? { min: 0, max: 1 };
      appendSlotLabel(value, "value", {
        card: valueCard,
        rmCard: valueCard,
        rmType: slotRmTypeForAttr("ELEMENT", "value"),
      });
      appendHiddenSerializable(this, "RM_TYPE", "ELEMENT");
      appendHiddenSerializable(this, "VALUE_RM_TYPE", "");
      appendHiddenSerializable(this, "ELEMENT_SLOT_ID", "");
      appendHiddenSerializable(this, "MANDATORY", "");
      appendHiddenSerializable(this, "SLOT_ID", "");
      appendHiddenSerializable(this, "ARCHETYPE_NODE_ID", "");
      appendHiddenSerializable(this, "ARCHETYPE_CTX", "");
      this.setPreviousStatement(true, ["ITEM", "ELEMENT", "CLUSTER"]);
      this.setNextStatement(true, ["ITEM", "ELEMENT", "CLUSTER"]);
      this.setColour(ELEMENT_COLOUR);
      this.setTooltip("openEHR RM ELEMENT — named data item with a DATA_VALUE");
      Blockly.Extensions.apply("optional_rm_mutator", this, true);
      enforceOpenEhrBlockLayout(this);
    },
  };
}

function defineDataValueBlocksFromMeta(): void {
  for (const rmType of dataValueLeafTypes()) {
    defineDataValueBlock(rmType);
  }
}

function defineDataValueBlock(rmType: string): void {
  const type = blockTypeForRm(rmType);
  if (Blockly.Blocks[type]) return;

  Blockly.Blocks[type] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputEmoji(header, rmType);
      header.appendField(new FieldSkeletonTitle(rmType, humanizeRmType(rmType)), "NAME");
      if (optionalAttributes(rmType).some((a) => isMappableField(a))) {
        appendMutatorCogwheel(header);
      }
      appendHiddenSerializable(this, "SLOT_ID", "");
      appendHiddenSerializable(this, "RM_TYPE", rmType);
      appendHiddenSerializable(this, "MANDATORY", "");

      const mandatory = mandatoryAttributes(rmType).filter((a) =>
        isMappableField(a)
      );
      for (const attr of mandatory) {
        appendDvFieldInput(this, attr, false);
      }

      if (optionalAttributes(rmType).some((a) => isMappableField(a))) {
        Blockly.Extensions.apply("dv_fields_mutator", this, true);
      }

      this.setOutput(true, blocklyOutputForDv(rmType));
      this.setColour(DV_COLOUR);
      this.setTooltip(rmType);
      enforceOpenEhrBlockLayout(this);
    },
  };
}

export const OPTIONAL_RM_MUTATOR_CONTAINER = "optional_rm_mutator_container";
export const OPTIONAL_RM_MUTATOR_ITEM = "optional_rm_mutator_item";
export const DV_FIELDS_MUTATOR_CONTAINER = "dv_fields_mutator_container";
export const DV_FIELDS_MUTATOR_ITEM = "dv_fields_mutator_item";
export const PROHIBITED_RM_INPUT_PREFIX = "PROHIBITED_";

export type OptionalRmMutatorChange = {
  parent: Blockly.Block;
  added: string[];
  removed: string[];
};

let optionalRmMutatorChangeHandler: ((change: OptionalRmMutatorChange) => void) | null =
  null;

/** Workbench syncs Mapping Model + auto-attaches typed children after compose. */
export function setOptionalRmMutatorChangeHandler(
  handler: ((change: OptionalRmMutatorChange) => void) | null,
): void {
  optionalRmMutatorChangeHandler = handler;
}

/** Apply a mutator stack of optional RM extras (used by tests and the workbench seam). */
export function composeOptionalRmExtras(block: Blockly.Block, names: string[]): void {
  if (!block.decompose || !block.compose) return;
  const banned = prohibitedNameSet(block);
  const allowed = sortEntryBoilerplateExtras(
    rmTypeOfBlock(block),
    names.filter((name) => name && !banned.has(name)),
  );
  const bubble = new Blockly.Workspace();
  try {
    const container = block.decompose(bubble);
    let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
    while (item) {
      const next = item.getNextBlock();
      item.dispose(false);
      item = next;
    }
    let connection = container.getInput("STACK")?.connection ?? null;
    for (const name of allowed) {
      const quark = bubble.newBlock(OPTIONAL_RM_MUTATOR_ITEM);
      initSvgIfPresent(quark);
      if (name) applyMutatorItemLabel(quark, name, name);
      if (connection && quark.previousConnection) {
        connection.connect(quark.previousConnection);
        connection = quark.nextConnection;
      }
    }
    block.saveConnections?.(container);
    block.compose(container);
  } finally {
    bubble.dispose();
  }
}

function defineCodePhraseBlock(): void {
  if (Blockly.Blocks["code_phrase"]) return;
  Blockly.Blocks["code_phrase"] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputEmoji(header, "CODE_PHRASE");
      header.appendField(new FieldSkeletonTitle("CODE_PHRASE", humanizeRmType("CODE_PHRASE")), "NAME");
      const code = this.appendValueInput(dvFieldInputName("code_string"))
        .setAlign(inputAlignRight())
        .setCheck("String");
      appendSlotLabel(code, "code", { rmType: "String" });
      const terminology = this.appendValueInput(dvFieldInputName("terminology_id"))
        .setAlign(inputAlignRight())
        .setCheck("String");
      appendSlotLabel(terminology, "terminology", { rmType: "String" });
      this.setOutput(true, "CODE_PHRASE");
      this.setColour(DV_COLOUR);
      enforceOpenEhrBlockLayout(this);
      appendHiddenSerializable(this, "RM_TYPE", "CODE_PHRASE");
      appendHiddenSerializable(this, "SLOT_ID", "");
    },
  };
}

function isMappableField(attr: RmAttributeMeta): boolean {
  if (isPrimitiveRmType(attr.typeName)) return true;
  const base = attr.typeName.split("<")[0]!;
  return base === "CODE_PHRASE" || base === "Terminology_code" ||
    base === "DV_CODED_TEXT";
}

function appendDvFieldInput(
  block: Blockly.Block,
  attr: RmAttributeMeta,
  optional: boolean,
): void {
  const name = optional
    ? `${OPTIONAL_DV_FIELD_PREFIX}${attr.name}`
    : dvFieldInputName(attr.name);
  if (block.getInput(name)) return;
  const check = blocklyCheckForPrimitiveType(attr.typeName) ??
    (attr.typeName.startsWith("CODE_PHRASE") || attr.typeName === "CODE_PHRASE"
      ? ["String", "CODE_PHRASE"]
      : attr.typeName === "DV_CODED_TEXT"
      ? blocklyCheckForDv("DV_CODED_TEXT")
      : "String");
  const input = block.appendValueInput(name)
    .setAlign(inputAlignRight())
    .setCheck(check);
  appendSlotLabel(input, attr.name, { rmType: baseRmTypeName(attr.typeName) });
}

function ensureDvFieldVisible(block: Blockly.Block, attrName: string): void {
  if (block.getInput(dvFieldInputName(attrName))) return;
  if (block.getInput(`${OPTIONAL_DV_FIELD_PREFIX}${attrName}`)) return;
  const rmType = block.getFieldValue("RM_TYPE");
  const attr = attributesFor(rmType).find((a) => a.name === attrName);
  if (!attr) return;
  if (!attr.mandatory) {
    block.extraDvFields_ = block.extraDvFields_ ?? [];
    if (!block.extraDvFields_.includes(attrName)) {
      block.extraDvFields_.push(attrName);
      block.updateDvFields_?.();
    }
  }
}

type ProhibitedRmRow = {
  name: string;
  rm: SlotCardinality;
  effective: SlotCardinality;
};

type OptionalRmMutatorState = {
  extras?: string[];
  attrs?: string[];
  /** RM class at save time — fields load after extraState, so restore needs this. */
  rmType?: string;
  prohibited?: ProhibitedRmRow[];
  slotCards?: Record<string, SlotCardinality>;
  rmCards?: Record<string, SlotCardinality>;
};

function parseSlotCardMap(raw: unknown): Record<string, SlotCardinality> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SlotCardinality> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const rec = value as { min?: unknown; max?: unknown };
    const min = Number(rec.min ?? 0);
    if (!Number.isFinite(min)) continue;
    if (rec.max == null) {
      out[name] = { min, max: null };
      continue;
    }
    const max = Number(rec.max);
    out[name] = { min, max: Number.isFinite(max) ? max : null };
  }
  return out;
}

function parseMutatorExtraState(
  state: OptionalRmMutatorState | string | null,
): {
  extras: string[];
  attrs: string[];
  rmType: string;
  prohibited: ProhibitedRmRow[];
  slotCards: Record<string, SlotCardinality>;
  rmCards: Record<string, SlotCardinality>;
} {
  if (state == null || state === "") {
    return {
      extras: [],
      attrs: [],
      rmType: "",
      prohibited: [],
      slotCards: {},
      rmCards: {},
    };
  }
  const obj = typeof state === "string"
    ? JSON.parse(state) as OptionalRmMutatorState
    : state;
  return {
    extras: Array.isArray(obj.extras) ? obj.extras : [],
    attrs: Array.isArray(obj.attrs) ? obj.attrs : [],
    rmType: typeof obj.rmType === "string" ? obj.rmType : "",
    prohibited: Array.isArray(obj.prohibited) ? obj.prohibited : [],
    slotCards: parseSlotCardMap(obj.slotCards),
    rmCards: parseSlotCardMap(obj.rmCards),
  };
}

/**
 * Fields are applied after `loadExtraState`, so prefer the saved rmType.
 * Infer INTERVAL_EVENT from its exclusive attrs when older saves omit rmType.
 */
function rmTypeForMutatorRestore(
  block: Blockly.Block,
  savedRmType: string,
  attrs: string[],
): string {
  if (block.type === "element") return "ELEMENT";
  const saved = (savedRmType || "").toUpperCase();
  if (saved) return saved;
  const current = rmTypeOfBlock(block);
  if (
    isEventFamilyType(current) &&
    attrs.some((name) =>
      name === "math_function" || name === "width" || name === "sample_count"
    )
  ) {
    return "INTERVAL_EVENT";
  }
  return current;
}

function restoreMutatorAttributes(
  block: Blockly.Block,
  extras: string[],
  attrs: string[],
  savedRmType = "",
): void {
  block.extraInputs_ = sortEntryBoilerplateExtras(rmTypeOfBlock(block), extras);
  const extraSet = new Set(extras);
  // Keep extras on OPT_ unless init already exposed a fixed ATTR_ mouth
  // (HISTORY.events). Older extraState mixed extras into attrs.
  const fixed = attrs.filter((name) =>
    !extraSet.has(name) || Boolean(block.getInput(rmAttributeInputName(name)))
  );
  if (fixed.length) {
    syncRmAttributeInputs(
      block,
      rmTypeForMutatorRestore(block, savedRmType, fixed),
      fixed,
      block.slotCardinalities_,
    );
  }
  block.updateShape_?.();
}

function optionalRmMutatorChoices(block: Blockly.Block): Array<[string, string]> {
  const rmType = rmTypeOfBlock(block);
  const locked = new Set(
    presentAttributeNames(block).filter((name) =>
      Boolean(block.getInput(rmAttributeInputName(name)))
    ),
  );
  const labels = new Map<string, string>();
  for (const opt of getValidAttachments(rmType, {
    presentAttributes: locked,
    templateConstrained: locked,
    prohibitedAttributes: prohibitedNameSet(block),
  })) {
    labels.set(opt.attributeName, opt.label);
  }
  for (const name of block.extraInputs_ ?? []) {
    if (!labels.has(name) && !prohibitedNameSet(block).has(name)) {
      labels.set(name, name);
    }
  }
  const rows = [...labels.entries()].map(([name, label]) => [label, name] as [string, string]);
  return rows.length ? rows : [["(none)", ""]];
}

function prohibitedNameSet(block: Blockly.Block): Set<string> {
  return new Set((block.prohibitedAttributes_ ?? []).map((row) => row.name));
}

export function prohibitedRmInputName(attr: string): string {
  return `${PROHIBITED_RM_INPUT_PREFIX}${attr}`;
}

function appendProhibitedMutatorRows(container: Blockly.Block, parent: Blockly.Block): void {
  for (const row of parent.prohibitedAttributes_ ?? []) {
    const input = container.appendDummyInput(prohibitedRmInputName(row.name));
    appendSlotLabel(input, row.name, {
      card: row.effective,
      rmCard: row.rm,
    });
  }
}

function humanizeAttrName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function optionalDvFieldChoices(block: Blockly.Block): Array<[string, string]> {
  const rmType = block.getFieldValue("RM_TYPE");
  const rows = optionalAttributes(rmType)
    .filter((a) => isMappableField(a))
    .map((a) => [humanizeAttrName(a.name), a.name] as [string, string]);
  return rows.length ? rows : [["(none)", ""]];
}

export function applyMutatorItemLabel(
  item: Blockly.Block,
  attr: string,
  label: string,
): void {
  item.setFieldValue(label, "LABEL");
  item.setFieldValue(attr, "ATTR");
}

export function buildOptionalRmFlyoutContents(
  block: Blockly.Block,
  stackNames: string[],
): MutatorFlyoutBlock[] {
  return optionalRmMutatorChoices(block)
    .filter(([, name]) => name && name !== "(none)")
    .filter(([, name]) => !stackNames.includes(name))
    .map(([label, name]) => ({
      kind: "block" as const,
      type: OPTIONAL_RM_MUTATOR_ITEM,
      extraState: { attr: name, label },
    }));
}

function buildOptionalDvFlyoutContents(
  block: Blockly.Block,
  stackNames: string[],
): MutatorFlyoutBlock[] {
  return optionalDvFieldChoices(block)
    .filter(([, name]) => name && name !== "(none)")
    .filter(([, name]) => !stackNames.includes(name))
    .map(([label, name]) => ({
      kind: "block" as const,
      type: DV_FIELDS_MUTATOR_ITEM,
      extraState: { attr: name, label },
    }));
}

function defineMutatorItemBlock(type: string, colour: string): void {
  if (Blockly.Blocks[type]) return;
  Blockly.Blocks[type] = {
    init: function (this: Blockly.Block) {
      // Single row: a second dummy input for hidden ATTR doubled block height (~59px).
      this.appendDummyInput()
        .appendField(new Blockly.FieldLabelSerializable(""), "LABEL")
        .appendField(createHiddenSerializableField(""), "ATTR");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(colour);
      this.contextMenu = false;
      this.setInputsInline(true);
    },
    loadExtraState: function (
      this: Blockly.Block,
      state: { attr?: string; label?: string },
    ) {
      const attr = state?.attr ?? "";
      const label = state?.label ?? attr;
      this.setFieldValue(label, "LABEL");
      this.setFieldValue(attr, "ATTR");
    },
    saveExtraState: function (this: Blockly.Block) {
      return {
        attr: String(this.getFieldValue("ATTR") || ""),
        label: String(this.getFieldValue("LABEL") || ""),
      };
    },
  };
}

function initSvgIfPresent(block: Blockly.Block): void {
  const svg = block as Blockly.Block & { initSvg?: () => void };
  svg.initSvg?.();
}

function bindMutatorOpener(this: Blockly.Block): void {
  this.firePlusClick = () => openBlockMutator(this);
}

function extraInputName(attr: string): string {
  return `${OPTIONAL_INPUT_PREFIX}${attr}`;
}

function defineOptionalMutatorQuarks(): void {
  if (!Blockly.Blocks[OPTIONAL_RM_MUTATOR_CONTAINER]) {
    Blockly.Blocks[OPTIONAL_RM_MUTATOR_CONTAINER] = {
      init: function (this: Blockly.Block) {
        initMutatorStackMouth(this, "optional RM");
        this.setColour(CONTAINER_COLOUR);
        this.contextMenu = false;
      },
    };
  }
  defineMutatorItemBlock(OPTIONAL_RM_MUTATOR_ITEM, CONTAINER_COLOUR);
  if (!Blockly.Blocks[DV_FIELDS_MUTATOR_CONTAINER]) {
    Blockly.Blocks[DV_FIELDS_MUTATOR_CONTAINER] = {
      init: function (this: Blockly.Block) {
        initMutatorStackMouth(this, "optional fields");
        this.setColour(DV_COLOUR);
        this.contextMenu = false;
      },
    };
  }
  defineMutatorItemBlock(DV_FIELDS_MUTATOR_ITEM, DV_COLOUR);
}

function stackMutatorItems(
  workspace: Blockly.Workspace,
  containerType: string,
  itemType: string,
  names: string[],
  labels: Map<string, string>,
): Blockly.Block {
  const container = workspace.newBlock(containerType);
  initSvgIfPresent(container);
  let connection = container.getInput("STACK")?.connection ?? null;
  for (const name of names) {
    const item = workspace.newBlock(itemType);
    initSvgIfPresent(item);
    if (name) applyMutatorItemLabel(item, name, labels.get(name) ?? name);
    if (connection && item.previousConnection) {
      connection.connect(item.previousConnection);
      connection = item.nextConnection;
    }
  }
  return container;
}

let optionalRmMutatorRegistered = false;

function registerOptionalRmMutator(): void {
  if (optionalRmMutatorRegistered) return;
  optionalRmMutatorRegistered = true;
  defineOptionalMutatorQuarks();
  registerDynamicFlyoutMutator(
    "optional_rm_mutator",
    {
    mutationToDom: function (this: Blockly.Block) {
      const xml = Blockly.utils.xml.createElement("mutation");
      const extras = this.extraInputs_ ?? [];
      xml.setAttribute("extras", JSON.stringify(extras));
      xml.setAttribute("attrs", JSON.stringify(presentFixedAttributeNames(this)));
      xml.setAttribute("rmType", rmTypeOfBlock(this));
      xml.setAttribute("slotCards", JSON.stringify(this.slotCardinalities_ ?? {}));
      xml.setAttribute("rmCards", JSON.stringify(this.rmCardinalities_ ?? {}));
      xml.setAttribute("prohibited", JSON.stringify(this.prohibitedAttributes_ ?? []));
      return xml;
    },
    domToMutation: function (this: Blockly.Block, xmlElement: Element) {
      const extras = JSON.parse(xmlElement.getAttribute("extras") || "[]") as string[];
      this.extraInputs_ = extras;
      const attrs = JSON.parse(xmlElement.getAttribute("attrs") || "[]") as string[];
      this.slotCardinalities_ = parseSlotCardMap(
        JSON.parse(xmlElement.getAttribute("slotCards") || "{}"),
      );
      this.rmCardinalities_ = parseSlotCardMap(
        JSON.parse(xmlElement.getAttribute("rmCards") || "{}"),
      );
      const prohibited = JSON.parse(
        xmlElement.getAttribute("prohibited") || "[]",
      ) as ProhibitedRmRow[];
      if (Array.isArray(prohibited) && prohibited.length) {
        this.prohibitedAttributes_ = prohibited;
      }
      const savedRmType = xmlElement.getAttribute("rmType") || "";
      restoreMutatorAttributes(this, extras, attrs, savedRmType);
    },
    saveExtraState: function (this: Blockly.Block) {
      return {
        extras: this.extraInputs_ ?? [],
        attrs: presentFixedAttributeNames(this),
        rmType: rmTypeOfBlock(this),
        prohibited: this.prohibitedAttributes_ ?? [],
        slotCards: this.slotCardinalities_ ?? {},
        rmCards: this.rmCardinalities_ ?? {},
      };
    },
    loadExtraState: function (
      this: Blockly.Block,
      state: OptionalRmMutatorState | string | null,
    ) {
      const parsed = parseMutatorExtraState(state);
      this.extraInputs_ = parsed.extras;
      if (Object.keys(parsed.slotCards).length) {
        this.slotCardinalities_ = parsed.slotCards;
      }
      if (Object.keys(parsed.rmCards).length) {
        this.rmCardinalities_ = parsed.rmCards;
      }
      if (parsed.prohibited.length) this.prohibitedAttributes_ = parsed.prohibited;
      restoreMutatorAttributes(this, parsed.extras, parsed.attrs, parsed.rmType);
    },
    decompose: function (this: Blockly.Block, workspace: Blockly.Workspace) {
      const labels = new Map(optionalRmMutatorChoices(this));
      const container = stackMutatorItems(
        workspace,
        OPTIONAL_RM_MUTATOR_CONTAINER,
        OPTIONAL_RM_MUTATOR_ITEM,
        this.extraInputs_ ?? [],
        labels,
      );
      appendProhibitedMutatorRows(container, this);
      return container;
    },
    compose: function (this: Blockly.Block, container: Blockly.Block) {
      const banned = prohibitedNameSet(this);
      const next = namesFromMutatorStack(container).filter((name) => !banned.has(name));
      const prev = [...(this.extraInputs_ ?? [])];
      const connections = new Map<string, Blockly.Connection | null>();
      let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
      while (item) {
        if (!item.isInsertionMarker()) {
          const name = String(item.getFieldValue("ATTR") || "");
          if (name) connections.set(name, item.savedConnection_ ?? null);
        }
        item = item.getNextBlock();
      }
      this.extraInputs_ = sortEntryBoilerplateExtras(rmTypeOfBlock(this), next);
      this.updateShape_?.();
      for (const name of next) {
        const mouth = this.getInput(rmAttributeInputName(name))
          ? rmAttributeInputName(name)
          : extraInputName(name);
        connections.get(name)?.reconnect(this, mouth);
      }
      const added = next.filter((name) => !prev.includes(name));
      const removed = prev.filter((name) => !next.includes(name));
      if (added.length || removed.length) {
        optionalRmMutatorChangeHandler?.({ parent: this, added, removed });
      }
    },
    saveConnections: function (this: Blockly.Block, container: Blockly.Block) {
      let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
      while (item) {
        if (!item.isInsertionMarker()) {
          const name = String(item.getFieldValue("ATTR") || "");
          const mouth = this.getInput(rmAttributeInputName(name))
            ? rmAttributeInputName(name)
            : extraInputName(name);
          const input = this.getInput(mouth);
          item.savedConnection_ = input?.connection?.targetConnection ?? null;
        }
        item = item.getNextBlock();
      }
    },
    addInput_: function (this: Blockly.Block, name: string) {
      if (prohibitedNameSet(this).has(name)) return;
      if (this.getInput(rmAttributeInputName(name))) return;
      this.extraInputs_ = this.extraInputs_ ?? [];
      if (!this.extraInputs_.includes(name)) {
        this.extraInputs_.push(name);
        this.updateShape_?.();
      }
    },
    updateShape_: function (this: Blockly.Block) {
      for (const input of [...this.inputList]) {
        if (input.name.startsWith(OPTIONAL_INPUT_PREFIX)) {
          this.removeInput(input.name);
        }
      }
      for (const name of sortEntryBoilerplateExtras(rmTypeOfBlock(this), this.extraInputs_ ?? [])) {
        const parentRm = rmTypeOfBlock(this);
        // Skip attrs that already have a fixed ATTR_ mouth (e.g. HISTORY.events).
        if (this.getInput(rmAttributeInputName(name))) continue;
        const slotType = slotRmTypeForAttr(parentRm, name);
        const card = this.slotCardinalities_?.[name] ??
          rmAttributeCardinality(parentRm, name);
        const rmCard = this.rmCardinalities_?.[name] ??
          rmAttributeCardinality(parentRm, name);
        if (isRmValueAttribute(parentRm, name) || isPartyProxyType(slotType)) {
          const input = this.appendValueInput(`${OPTIONAL_INPUT_PREFIX}${name}`)
            .setAlign(inputAlignRight());
          const check = isPartyProxyType(slotType)
            ? slotType
            : (slotType ? blocklyCheckForDv(slotType) : null);
          if (check) input.setCheck(check);
          appendSlotLabel(input, name, { card, rmCard, rmType: slotType });
          continue;
        }
        const stmt = this.appendStatementInput(`${OPTIONAL_INPUT_PREFIX}${name}`)
          .setAlign(inputAlignRight());
        appendSlotLabel(stmt, name, { card, rmCard, rmType: slotType });
      }
      enforceOpenEhrBlockLayout(this);
    },
    },
    bindMutatorOpener,
    buildOptionalRmFlyoutContents,
    (block) => block.extraInputs_ ?? [],
  );
}

let dvFieldsMutatorRegistered = false;

function registerDvFieldsMutator(): void {
  if (dvFieldsMutatorRegistered) return;
  dvFieldsMutatorRegistered = true;
  defineOptionalMutatorQuarks();
  registerDynamicFlyoutMutator(
    "dv_fields_mutator",
    {
    mutationToDom: function (this: Blockly.Block) {
      const xml = Blockly.utils.xml.createElement("mutation");
      xml.setAttribute("fields", JSON.stringify(this.extraDvFields_ ?? []));
      return xml;
    },
    domToMutation: function (this: Blockly.Block, xmlElement: Element) {
      this.extraDvFields_ = JSON.parse(xmlElement.getAttribute("fields") || "[]") as string[];
      this.updateDvFields_?.();
    },
    saveExtraState: function (this: Blockly.Block) {
      return { fields: this.extraDvFields_ ?? [] };
    },
    loadExtraState: function (this: Blockly.Block, state: { fields?: string[] } | string | null) {
      if (state == null || state === "") {
        this.extraDvFields_ = [];
      } else if (typeof state === "string") {
        this.extraDvFields_ = JSON.parse(state) as string[];
      } else {
        this.extraDvFields_ = Array.isArray(state.fields) ? state.fields : [];
      }
      this.updateDvFields_?.();
    },
    decompose: function (this: Blockly.Block, workspace: Blockly.Workspace) {
      const labels = new Map(optionalDvFieldChoices(this));
      return stackMutatorItems(
        workspace,
        DV_FIELDS_MUTATOR_CONTAINER,
        DV_FIELDS_MUTATOR_ITEM,
        this.extraDvFields_ ?? [],
        labels,
      );
    },
    compose: function (this: Blockly.Block, container: Blockly.Block) {
      const next = namesFromMutatorStack(container);
      const connections = new Map<string, Blockly.Connection | null>();
      let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
      while (item) {
        if (!item.isInsertionMarker()) {
          const name = String(item.getFieldValue("ATTR") || "");
          if (name) connections.set(name, item.savedConnection_ ?? null);
        }
        item = item.getNextBlock();
      }
      this.extraDvFields_ = next;
      this.updateDvFields_?.();
      for (const name of next) {
        connections.get(name)?.reconnect(this, `${OPTIONAL_DV_FIELD_PREFIX}${name}`);
      }
    },
    saveConnections: function (this: Blockly.Block, container: Blockly.Block) {
      let item: Blockly.Block | null = container.getInputTargetBlock("STACK");
      while (item) {
        if (!item.isInsertionMarker()) {
          const name = String(item.getFieldValue("ATTR") || "");
          const input = this.getInput(`${OPTIONAL_DV_FIELD_PREFIX}${name}`);
          item.savedConnection_ = input?.connection?.targetConnection ?? null;
        }
        item = item.getNextBlock();
      }
    },
    updateDvFields_: function (this: Blockly.Block) {
      for (const input of [...this.inputList]) {
        if (input.name.startsWith(OPTIONAL_DV_FIELD_PREFIX)) {
          this.removeInput(input.name);
        }
      }
      const rmType = this.getFieldValue("RM_TYPE");
      for (const name of this.extraDvFields_ ?? []) {
        const attr = attributesFor(rmType).find((a) => a.name === name);
        if (attr) appendDvFieldInput(this, attr, true);
      }
      enforceOpenEhrBlockLayout(this);
    },
    },
    bindMutatorOpener,
    buildOptionalDvFlyoutContents,
    (block) => block.extraDvFields_ ?? [],
  );
}

declare module "blockly/core" {
  interface Block {
    extraInputs_?: string[];
    extraDvFields_?: string[];
    slotCardinalities_?: Record<string, SlotCardinality>;
    rmCardinalities_?: Record<string, SlotCardinality>;
    prohibitedAttributes_?: Array<{
      name: string;
      rm: SlotCardinality;
      effective: SlotCardinality;
    }>;
    savedConnection_?: Blockly.Connection | null;
    firePlusClick?: () => void;
    addInput_?: (name: string) => void;
    updateShape_?: () => void;
    updateDvFields_?: () => void;
    decompose?: (workspace: Blockly.Workspace) => Blockly.Block;
    compose?: (container: Blockly.Block) => void;
    saveConnections?: (container: Blockly.Block) => void;
  }
}

