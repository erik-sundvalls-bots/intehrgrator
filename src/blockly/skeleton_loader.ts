import type { BlockSvg, WorkspaceSvg } from "blockly/core";
import type { AllowedOrdinal, AllowedValue, MappingLoop, MappingModel, SkeletonNode } from "../types/mod.ts";
import { AUTO_FIXED_LOCATABLE_ATTRS } from "../core/rm_mandatory.ts";
import { attributesFor, blockTypeForRm, isDataValueType } from "../core/rm_meta.ts";
import { parseExpression } from "../core/expression/mod.ts";
import { skeletonNodeForOptionalRm, isRepeatingMultiplicity } from "../core/skeleton/generate_skeleton.ts";
import { termSetById, termSetForMandatedCode, termSetForRmAttribute, TERM_PICK_NONE } from "../core/openehr_term_catalog.ts";
import { astToExpressionBlock } from "./expression_serialize.ts";
import { Blockly } from "./blockly_core.ts";
import "blockly/blocks";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import {
  applyFixedFieldsToDataValueShell,
  applyOrdinalFieldsToDataValueShell,
  collapseEntryBoilerplateChildren,
  configureElementValueSlot,
  connectExpressionToDataValueShell,
  elementContainerSlotId,
  elementValueDvType,
  rmTypeOfBlock,
  dvFieldInputName,
  ensureElementDataValueShell,
  ensureRmBlockType,
  isDataValueBlock,
  optionalRmInputName,
  rmAttributeInputName,
  syncRmAttributeInputs,
  ensureIntervalEventMathFunctionScaffold,
} from "./blocks/rm_blocks.ts";
import { enforceMouthCaptionLayout } from "./mouth_layout.ts";
import { createTermPickBlock, isTermPickBlock } from "./blocks/term_pick.ts";
import { applySkeletonBlockLabels } from "./block_labels.ts";
import { createSourceQueryBlock, isSourceQueryBlockType } from "./source_query.ts";
import { FOR_EACH_LIST_BLOCK, isLoopBlockType } from "./loop_block.ts";
import {
  attachDefaultPointLookups,
  captureDefaultsBlockState,
  placeDefaultsBesideSkeleton,
  restoreDefaultsBlockState,
} from "./defaults_canvas.ts";
import { attachStartToInstanceRoot } from "./conversion_start_canvas.ts";
import { findInstanceRootUnderStart } from "./instance_root.ts";
import { isGenericValueBlockType, isSchemaStructureBlock } from "./blocks/target_blocks.ts";
import { targetChildInputName } from "./blocks/target_blocks.ts";
import { schemaOptionalInputName, composeSchemaOptionalFields } from "./blocks/schema_mutator.ts";
import { findSkeletonNode, setSchemaCatalog } from "./schema_catalog.ts";
import {
  createSchemaStructureBlock,
  registerSchemaBlocksFromSkeleton,
  schemaSlotIdForInput,
} from "./schema_blocks.ts";
import {
  isSchemaPrimitiveType,
  isSchemaStructureBlockType,
  schemaChildInputKind,
  schemaFieldName,
} from "../core/target/schema_block_ids.ts";
import type { TargetFormatId } from "../types/mod.ts";
import { refreshWorkspaceConstraints } from "./block_constraints.ts";
import {
  parseSlotCardinality,
  rmAttributeCardinality,
  type SlotCardinality,
} from "./slot_cardinality.ts";
import { runWithoutBlocklyEvents } from "./blockly_events.ts";
import { blocklyCheckForDv } from "./block_checks.ts";

export function loadSkeletonIntoWorkspace(
  workspace: WorkspaceSvg,
  skeleton: SkeletonNode[],
  model: MappingModel,
  listeningSlotId: string | null = null,
  uiLanguage = "en",
  targetFormat?: TargetFormatId,
  options?: { factory?: boolean },
): void {
  setSchemaCatalog(skeleton);
  if (targetFormat === "json-schema" || targetFormat === "xml-schema") {
    registerSchemaBlocksFromSkeleton(skeleton);
  }
  const schemaTarget = targetFormat === "json-schema" || targetFormat === "xml-schema";
  runWithoutBlocklyEvents(() => {
    const savedDefaults = schemaTarget ? null : captureDefaultsBlockState(workspace);
    workspace.clear();
    let y = 20;
    for (const root of skeleton) {
      const block = buildBlockFromNode(workspace, root, true, 0);
      if (!block) continue;
      block.moveBy(20, y);
      const height = typeof block.getHeightWidth === "function"
        ? block.getHeightWidth().height
        : 80;
      y += height + 24;
    }
    applyModelExpressions(workspace, model);
    restoreDefaultsBlockState(workspace, savedDefaults, uiLanguage, targetFormat, options);
    const scaffoldRoot = workspace.getTopBlocks(false).find((b) =>
      b.type !== "default_context_map" && b.type !== "defaults_block" &&
      b.type !== "maps_create_with" && b.type !== "conversion_start"
    );
    if (scaffoldRoot) attachStartToInstanceRoot(workspace, scaffoldRoot);
    placeDefaultsBesideSkeleton(workspace);
    if (!schemaTarget) {
      attachDefaultPointLookups(workspace, skeleton, (parent, insertion) =>
        attachOptionalRmChild(workspace, parent, insertion)
      );
    }
    applyModelOptionalSchemaFields(workspace, model);
    setAllBlocksCollapsed(workspace, false);
    for (const block of workspace.getAllBlocks(false)) {
      collapseEntryBoilerplateChildren(block);
      enforceMouthCaptionLayout(block);
    }
    highlightListeningSlot(workspace, listeningSlotId);
    refreshWorkspaceLayout(workspace);
    refreshWorkspaceConstraints(workspace);
  });
}

/**
 * Place one Template Skeleton leaf/subtree as a detached Blockly stack.
 * Does not clear the workspace or attach Conversion start (product recovery / optional structure).
 */
export function placeSkeletonSubtreeOnWorkspace(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  options: {
    x?: number;
    y?: number;
    skeleton?: SkeletonNode[];
    targetFormat?: TargetFormatId;
  } = {},
): BlockSvg | null {
  const catalog = options.skeleton ?? [node];
  const targetFormat = options.targetFormat;
  if (targetFormat === "json-schema" || targetFormat === "xml-schema") {
    registerSchemaBlocksFromSkeleton(catalog);
  } else {
    setSchemaCatalog(catalog);
  }
  const isRoot = catalog.some((root) => root.slotId === node.slotId);
  const grouped = typeof Blockly.Events.setGroup === "function";
  if (grouped) Blockly.Events.setGroup(true);
  try {
    const block = buildBlockFromNode(workspace, node, isRoot, isRoot ? 0 : 1);
    if (!block) return null;
    moveBlockTo(block, options.x ?? 40, options.y ?? 40);
    const schemaTarget = targetFormat === "json-schema" || targetFormat === "xml-schema";
    if (!schemaTarget) {
      attachDefaultPointLookups(
        workspace,
        [node],
        (parent, insertion) => attachOptionalRmChild(workspace, parent, insertion),
        { root: block },
      );
    }
    for (const child of [block, ...block.getDescendants(false)]) {
      collapseEntryBoilerplateChildren(child);
      enforceMouthCaptionLayout(child);
    }
    refreshWorkspaceLayout(workspace);
    refreshWorkspaceConstraints(workspace);
    return block;
  } finally {
    if (grouped) Blockly.Events.setGroup(false);
  }
}

function moveBlockTo(block: BlockSvg, x: number, y: number): void {
  try {
    const Coord = Blockly.utils?.Coordinate;
    if (typeof block.moveTo === "function" && typeof Coord === "function") {
      block.moveTo(new Coord(x, y));
      return;
    }
    const cur = typeof block.getRelativeToSurfaceXY === "function"
      ? block.getRelativeToSurfaceXY()
      : { x: 0, y: 0 };
    block.moveBy(x - cur.x, y - cur.y);
  } catch {
    // Headless workspace without SVG metrics.
  }
}

const lockedRoots = new WeakSet<Blockly.Block>();

/** Top-level stacks (typically COMPOSITION) stay expanded and cannot be collapsed. */
export function lockWorkspaceRootsExpanded(workspace: Blockly.Workspace): void {
  for (const block of workspace.getTopBlocks(false)) {
    lockRootExpanded(block);
  }
  const instanceRoot = findInstanceRootUnderStart(workspace);
  if (instanceRoot) lockRootExpanded(instanceRoot);
}

/**
 * Collapse or expand every nested block. Workspace roots are always left expanded.
 */
/**
 * Collapse or expand blocks nested under `root` (not `root` itself).
 * Used by the block context menu (#194).
 */
export function setChildBlocksCollapsed(root: Blockly.Block, collapsed: boolean): void {
  const grouped = typeof Blockly.Events.setGroup === "function";
  if (grouped) Blockly.Events.setGroup(true);
  try {
    const visit = (block: Blockly.Block): void => {
      if (typeof block.isShadow === "function" && block.isShadow()) return;
      if (typeof block.setCollapsed === "function") block.setCollapsed(collapsed);
      for (const child of block.getChildren(false)) visit(child);
    };
    for (const child of root.getChildren(false)) visit(child);
  } finally {
    if (grouped) Blockly.Events.setGroup(false);
  }
}

export function setAllBlocksCollapsed(
  workspace: Blockly.Workspace,
  collapsed: boolean,
): void {
  const roots = new Set(workspace.getTopBlocks(false));
  const instanceRoot = findInstanceRootUnderStart(workspace);
  if (instanceRoot) roots.add(instanceRoot);
  const grouped = typeof Blockly.Events.setGroup === "function";
  if (grouped) Blockly.Events.setGroup(true);
  try {
    for (const block of workspace.getAllBlocks(false)) {
      if (typeof block.isShadow === "function" && block.isShadow()) continue;
      if (typeof block.setCollapsed !== "function") continue;
      if (roots.has(block)) {
        block.setCollapsed(false);
        continue;
      }
      block.setCollapsed(collapsed);
    }
  } finally {
    if (grouped) Blockly.Events.setGroup(false);
  }
}

export function applyModelExpressions(
  workspace: Blockly.Workspace,
  model: MappingModel,
  options: { recordUndo?: boolean } = {},
): void {
  const apply = () => {
    const slotMap = new Map(model.slots.filter((s) => s.expression).map((s) => [s.slotId, s]));
    for (const block of workspace.getAllBlocks(false)) {
      if (isSchemaStructureBlock(block)) {
        attachSchemaFieldExpressions(workspace, block, slotMap);
      }
      const slotId = block.getFieldValue("SLOT_ID");
      if (!slotId) continue;
      const slot = slotMap.get(slotId);
      if (!slot) continue;
      if (block.type === "element") {
        attachExpressionToElement(workspace, block, slot.expression, slot.returnType, slot.rmType);
      } else if (block.type === "party_identified" || block.type === "party_related") {
        attachExpressionToPartyName(workspace, block, slot.expression, slot.returnType);
      } else if (isTermPickBlock(block) || isDataValueBlock(block)) {
        attachExpressionToTypedValue(workspace, block, slot.expression, slot.returnType, slot.rmType);
      } else if (isGenericValueBlockType(block.type)) {
        attachExpressionToTarget(workspace, block, slot.expression, slot.returnType);
      }
    }
    applyModelLoops(workspace, model);
    applyModelOptionalSchemaFields(workspace as WorkspaceSvg, model);
    applyModelOptionalRmInsertions(workspace as WorkspaceSvg, model);
  };
  if (options.recordUndo) apply();
  else runWithoutBlocklyEvents(apply);
}

/** Wrap each repeating container with `for_each_list` (source query or list value). */
export function applyModelLoops(
  workspace: Blockly.Workspace,
  model: MappingModel,
): void {
  for (const loop of model.loops ?? []) {
    const inner = findAttachBlock(workspace, loop.attachSlotId);
    if (!inner) continue;
    wrapBlockWithForEachList(workspace, inner, loop);
  }
}

function findAttachBlock(
  workspace: Blockly.Workspace,
  slotId: string,
): Blockly.Block | null {
  const matches: Blockly.Block[] = [];
  for (const block of workspace.getAllBlocks(false)) {
    if (block.getFieldValue("SLOT_ID") !== slotId) continue;
    if (isLoopBlockType(block.type)) continue;
    matches.push(block);
  }
  const repeating = matches.find((block) =>
    Boolean(block.previousConnection) &&
    isRepeatingMultiplicity((block as { slotMultiplicity_?: string }).slotMultiplicity_)
  );
  if (repeating) return repeating;
  return matches.find((block) => Boolean(block.previousConnection)) ?? matches[0] ?? null;
}

function wrapBlockWithForEachList(
  workspace: Blockly.Workspace,
  inner: Blockly.Block,
  loop: MappingLoop,
): void {
  const parent = inner.getParent();
  if (parent?.type === FOR_EACH_LIST_BLOCK) {
    parent.setFieldValue(loop.varName, "VAR");
    attachLoopCollection(workspace, parent, loop);
    return;
  }

  const wrap = workspace.newBlock(FOR_EACH_LIST_BLOCK);
  wrap.setFieldValue(loop.varName, "VAR");
  attachLoopCollection(workspace, wrap, loop);
  const svg = wrap as BlockSvg;
  if (typeof document !== "undefined" && typeof svg.initSvg === "function") {
    svg.initSvg();
  }

  const wasTop = !parent;
  const xy = typeof inner.getRelativeToSurfaceXY === "function"
    ? inner.getRelativeToSurfaceXY()
    : { x: 0, y: 0 };
  const prevTarget = inner.previousConnection?.targetConnection ?? null;
  const nextBlock = inner.getNextBlock();
  if (inner.previousConnection?.isConnected()) inner.previousConnection.disconnect();
  if (inner.nextConnection?.isConnected()) inner.nextConnection.disconnect();

  const doConn = wrap.getInput("DO")?.connection;
  if (doConn && inner.previousConnection) {
    doConn.connect(inner.previousConnection);
  }
  if (prevTarget && wrap.previousConnection) {
    prevTarget.connect(wrap.previousConnection);
  }
  if (nextBlock?.previousConnection && wrap.nextConnection) {
    wrap.nextConnection.connect(nextBlock.previousConnection);
  }
  if (wasTop && typeof wrap.moveBy === "function") {
    wrap.moveBy(xy.x, xy.y);
  }
  if (typeof document !== "undefined" && typeof svg.render === "function") {
    svg.render();
  }
}

function attachLoopCollection(
  workspace: Blockly.Workspace,
  wrap: Blockly.Block,
  loop: MappingLoop,
): void {
  if (loop.kind === "list") {
    attachListCollection(workspace, wrap, loop.collection);
    return;
  }
  attachSourceCollection(workspace, wrap, loop.path);
}

function attachSourceCollection(
  workspace: Blockly.Workspace,
  wrap: Blockly.Block,
  path: string,
): void {
  const listInput = wrap.getInput("LIST");
  if (!listInput?.connection) return;
  const existing = listInput.connection.targetBlock();
  if (existing && isSourceQueryBlockType(existing.type)) {
    existing.setFieldValue(path || "/", "EXPRESSION");
    return;
  }
  if (listInput.connection.isConnected()) listInput.connection.disconnect();
  const src = createSourceQueryBlock(workspace, path || "/", "node");
  if (src.outputConnection) listInput.connection.connect(src.outputConnection);
}

function attachListCollection(
  workspace: Blockly.Workspace,
  wrap: Blockly.Block,
  collection: string | undefined,
): void {
  if (!collection?.trim()) return;
  const listInput = wrap.getInput("LIST");
  if (!listInput?.connection) return;
  if (listInput.connection.isConnected()) return;
  try {
    const expr = astToExpressionBlock(
      workspace,
      parseExpression(collection),
      "string",
      finalizeBlock,
    );
    if (expr.outputConnection) listInput.connection.connect(expr.outputConnection);
  } catch {
    // Collection may be an unparsed Keep-list expression; leave the socket empty.
  }
}

export function highlightListeningSlot(
  workspace: Blockly.Workspace,
  listeningSlotId: string | null,
  listeningSourceBlockId: string | null = null,
): void {
  for (const block of workspace.getAllBlocks(false)) {
    const slotId = block.getFieldValue("SLOT_ID");
    const svg = block as BlockSvg;
    if (typeof svg.setHighlighted !== "function") continue;
    const bySlot = Boolean(listeningSlotId && slotId === listeningSlotId);
    const bySource = Boolean(listeningSourceBlockId && block.id === listeningSourceBlockId);
    svg.setHighlighted(bySlot || bySource);
  }
}

export function slotIdFromBlock(block: Blockly.Block | null): string | null {
  if (!block) return null;
  const slotId = block.getFieldValue("SLOT_ID");
  return slotId || null;
}

/** Insert an optional schema field child on a live target_structure block. */
export function attachOptionalSchemaChild(
  workspace: WorkspaceSvg,
  parent: Blockly.Block,
  attributeName: string,
): BlockSvg | null {
  const parentSlotId = parent.getFieldValue("SLOT_ID") || "";
  const parentNode = findSkeletonNode(parentSlotId);
  if (!parentNode) return null;
  const childNode = parentNode.children.find(
    (child) => (child.rmAttribute ?? child.label) === attributeName,
  );
  if (!childNode) return null;
  if (childNode.kind === "value" || isSchemaPrimitiveType(childNode.rmType)) {
    refreshBlockLayout(parent as BlockSvg);
    refreshWorkspaceConstraints(workspace);
    return parent as BlockSvg;
  }
  const child = buildBlockFromNode(workspace, childNode, false, 1);
  if (!child) return null;
  const inputName = parent.getInput(schemaOptionalInputName(attributeName))
    ? schemaOptionalInputName(attributeName)
    : targetChildInputName(attributeName);
  connectAttributeChildren(parent, inputName, [child]);
  refreshBlockLayout(parent as BlockSvg);
  refreshWorkspaceConstraints(workspace);
  return child;
}

function applyModelOptionalSchemaFields(
  workspace: WorkspaceSvg,
  model: MappingModel,
): void {
  const byParent = new Map<string, string[]>();
  for (const extra of model.optionalRm) {
    const parent = findBlockBySlotId(workspace, extra.attachmentSlotId);
    if (!parent || !isSchemaStructureBlock(parent)) continue;
    const list = byParent.get(extra.attachmentSlotId) ?? [];
    list.push(extra.attributeName);
    byParent.set(extra.attachmentSlotId, list);
  }
  for (const [parentSlotId, names] of byParent) {
    const parent = findBlockBySlotId(workspace, parentSlotId);
    if (!parent) continue;
    composeSchemaOptionalFields(parent, names);
    for (const name of names) {
      const input = parent.getInput(schemaOptionalInputName(name));
      if (input?.connection?.targetBlock()) continue;
      attachOptionalSchemaChild(workspace, parent, name);
    }
  }
}

function applyModelOptionalRmInsertions(
  workspace: WorkspaceSvg,
  model: MappingModel,
): void {
  for (const extra of model.optionalRm) {
    const parent = findBlockBySlotId(workspace, extra.attachmentSlotId);
    if (!parent || isSchemaStructureBlock(parent)) continue;
    const inputName = parent.getInput(rmAttributeInputName(extra.attributeName))
      ? rmAttributeInputName(extra.attributeName)
      : optionalRmInputName(extra.attributeName);
    if (parent.getInput(inputName)?.connection?.targetBlock()) continue;
    attachOptionalRmChild(workspace, parent, extra);
  }
}

function findBlockBySlotId(
  workspace: Blockly.Workspace,
  slotId: string,
): Blockly.Block | null {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.getFieldValue("SLOT_ID") === slotId) return block;
  }
  return null;
}

/** Insert an Optional RM child on a live container without rebuilding the canvas. */
export function attachOptionalRmChild(
  workspace: WorkspaceSvg,
  parent: Blockly.Block,
  insertion: { rmType: string; attributeName: string; label?: string },
): BlockSvg | null {
  if (typeof parent.addInput_ === "function") {
    parent.addInput_(insertion.attributeName);
  }
  const parentSlotId = parent.type === "element"
    ? elementContainerSlotId(parent)
    : (parent.getFieldValue("SLOT_ID") || "");
  const parentRmType = rmTypeOfBlock(parent);
  const slash = parentSlotId.indexOf("/");
  const parentNode: SkeletonNode = {
    slotId: parentSlotId,
    blockType: parent.type,
    rmType: parentRmType,
    label: parent.getFieldValue("NAME") || parentRmType,
    kind: "container",
    mandatory: false,
    children: [],
    archetypeId: slash > 0 ? parentSlotId.slice(0, slash) : parentSlotId,
    attachmentPoint: slash >= 0 ? parentSlotId.slice(slash) : "",
  };
  const childNode = skeletonNodeForOptionalRm(
    parentNode,
    insertion.rmType,
    insertion.attributeName,
  );
  if (insertion.label) childNode.label = insertion.label;
  const child = buildBlockFromNode(workspace, childNode, false, 1, parentRmType);
  if (!child) return null;
  const inputName = parent.getInput(rmAttributeInputName(insertion.attributeName))
    ? rmAttributeInputName(insertion.attributeName)
    : optionalRmInputName(insertion.attributeName);
  connectAttributeChildren(parent, inputName, [child]);
  refreshBlockLayout(parent as BlockSvg);
  refreshWorkspaceConstraints(workspace);
  return child;
}

function buildBlockFromNode(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  isRoot: boolean,
  depth: number,
  parentRmType?: string,
): BlockSvg | null {
  let block: BlockSvg | null = null;
  if (isSchemaStructureBlockType(node.blockType) || node.blockType === "target_structure") {
    block = buildTargetStructureBlock(workspace, node, isRoot, depth);
  } else if (node.blockType === "target_value") {
    block = buildTargetValueBlock(workspace, node, isRoot);
  } else if (node.blockType === "element" || node.rmType === "ELEMENT") {
    block = buildElementBlock(workspace, node, isRoot);
  } else if (node.kind === "value") {
    block = buildTypedValueBlock(workspace, node, isRoot, parentRmType);
  } else {
    block = buildContainerBlock(workspace, node, isRoot, depth);
  }
  if (block && isRoot) lockRootExpanded(block);
  return block;
}

function lockRootExpanded(block: Blockly.Block): void {
  const mutable = block as Blockly.Block & {
    setCollapsed: (collapsed: boolean) => void;
  };
  if (typeof mutable.setCollapsed !== "function") return;
  if (mutable.isCollapsed?.()) mutable.setCollapsed(false);
  if (lockedRoots.has(block)) return;
  lockedRoots.add(block);
  const original = mutable.setCollapsed.bind(block);
  mutable.setCollapsed = (_collapsed: boolean) => {
    original(false);
  };
}

function buildTargetStructureBlock(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  isRoot: boolean,
  depth: number,
): BlockSvg {
  const block = createSchemaStructureBlock(workspace, node, isRoot);
  block.setFieldValue(node.rmType, "TARGET_TYPE");
  block.setFieldValue(node.slotId, "SLOT_ID");
  applySkeletonBlockLabels(block, node);
  if (!isRoot && schemaChildInputKind(node) === "statement") {
    // repeating complex types stay statement-connected
  }
  finalizeBlock(block);
  const visibleChildren = node.children.filter((child) => child.mandatory === true);
  for (const child of visibleChildren) {
    const name = schemaFieldName(child);
    const inputName = targetChildInputName(name);
    if (child.kind === "value" || isSchemaPrimitiveType(child.rmType)) {
      if (child.fixedValue && block.getInput(inputName)?.connection) {
        const lit = literalForSchemaPrimitive(workspace, child);
        if (lit?.outputConnection) {
          block.getInput(inputName)!.connection!.connect(lit.outputConnection);
        }
      }
      continue;
    }
    const childBlock = buildBlockFromNode(workspace, child, false, depth + 1);
    if (!childBlock) continue;
    connectAttributeChildren(block, inputName, [childBlock]);
  }
  refreshBlockLayout(block);
  return block;
}

function literalForSchemaPrimitive(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
): BlockSvg | null {
  const value = node.fixedValue;
  if (value == null || value === "") return null;
  const kind = node.rmType.toLowerCase();
  if (
    kind === "int" || kind === "integer" || kind === "number" || kind === "decimal" ||
    kind === "unsignedlong" || kind === "unsignedint" || kind === "long" || kind === "float" ||
    kind === "double"
  ) {
    const num = workspace.newBlock("math_number") as BlockSvg;
    num.setFieldValue(value, "NUM");
    return finalizeBlock(num);
  }
  const text = workspace.newBlock("text") as BlockSvg;
  text.setFieldValue(value, "TEXT");
  return finalizeBlock(text);
}

function buildTargetValueBlock(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  isRoot: boolean,
): BlockSvg {
  const block = workspace.newBlock("target_value") as BlockSvg;
  block.setFieldValue(node.rmType, "TARGET_TYPE");
  block.setFieldValue(node.slotId, "SLOT_ID");
  applySkeletonBlockLabels(block, node);
  if (!isRoot && !block.outputConnection) {
    block.setPreviousStatement(true);
    block.setNextStatement(true);
  }
  setMandatoryFlag(block, node.mandatory);
  return finalizeBlock(block);
}

function buildContainerBlock(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  isRoot: boolean,
  depth: number,
): BlockSvg {
  function hasMandatoryDataValueDescendant(n: SkeletonNode): boolean {
    for (const c of n.children) {
      if (
        c.kind === "value" &&
        isDataValueType(c.rmType) &&
        c.mandatory === true &&
        !(c.kind === "value" && AUTO_FIXED_LOCATABLE_ATTRS.has(c.label))
      ) return true;
      if (c.kind === "container" && hasMandatoryDataValueDescendant(c)) return true;
    }
    return false;
  }

  const blockType = node.blockType && node.blockType !== "rm_structure"
    ? node.blockType
    : blockTypeForRm(node.rmType);
  ensureRmBlockType(blockType, node.rmType);
  const block = workspace.newBlock(blockType) as BlockSvg;
  setFieldIfPresent(block, "RM_TYPE", node.rmType);
  setFieldIfPresent(block, "SLOT_ID", node.slotId);
  setFieldIfPresent(block, "ARCHETYPE_NODE_ID", node.archetypeNodeId ?? "");
  (block as { slotMultiplicity_?: string }).slotMultiplicity_ = node.multiplicity;
  applySkeletonBlockLabels(block, node);

  const visibleChildren = node.children.filter(
    (child) => {
      if (parseSlotCardinality(child.multiplicity)?.max === 0) return false;
      if (parseSlotCardinality(child.effectiveCardinality)?.max === 0) return false;
      if (child.kind === "value" && AUTO_FIXED_LOCATABLE_ATTRS.has(child.label)) return false;

      // Template-defined content (optional 0..1 observations, ELEMENTs inside
      // EVALUATION.data) must still scaffold so they can be mapped. Optional RM
      // Insertion (`+`) covers attributes that are not in the OPT walk.
      if (
        child.blockType === "section" ||
        child.rmType === "SECTION" ||
        child.rmType === "OBSERVATION" ||
        child.rmType === "EVALUATION" ||
        child.rmType === "INSTRUCTION" ||
        child.rmType === "ACTION" ||
        child.rmType === "ADMIN_ENTRY" ||
        child.rmType === "ELEMENT" ||
        child.blockType === "element"
      ) return true;

      // Default visibility policy:
      // - show openEHR structures that are mandatory in the OPT walk
      // - keep optional RM structures hidden until the user clicks the `+` picker
      if (child.mandatory === true) return true;

      // Keep intermediate structural wrappers visible when they contain
      // mandatory value slots underneath. This avoids “disappearing”
      // subtrees while still hiding optional RM insertions that have no
      // mandatory descendants in the OPT walk.
      return hasMandatoryDataValueDescendant(child);
    },
  );

  const constraintByName = new Map(
    (node.attributeConstraints ?? []).map((row) => [row.name, row]),
  );
  const attributes = [
    ...new Set(
      visibleChildren
        .map((child) => child.rmAttribute)
        .filter((attr): attr is string => Boolean(attr)),
    ),
  ];
  for (const row of node.attributeConstraints ?? []) {
    if (row.prohibited) continue;
    const effective = parseSlotCardinality(row.effectiveCardinality);
    if (effective && effective.min >= 1 && !attributes.includes(row.name)) {
      attributes.push(row.name);
    }
  }
  const cards: Record<string, SlotCardinality> = {};
  const rmCards: Record<string, SlotCardinality> = {};
  for (const attr of attributes) {
    const kids = visibleChildren.filter((child) => child.rmAttribute === attr);
    const constraint = constraintByName.get(attr);
    const effective = parseSlotCardinality(constraint?.effectiveCardinality) ??
      parseSlotCardinality(kids[0]?.effectiveCardinality) ??
      parseSlotCardinality(kids[0]?.slotCardinality ?? kids[0]?.multiplicity) ??
      rmAttributeCardinality(node.rmType, attr);
    const rm = parseSlotCardinality(constraint?.rmCardinality) ??
      parseSlotCardinality(kids[0]?.rmCardinality) ??
      rmAttributeCardinality(node.rmType, attr);
    if (effective) cards[attr] = effective;
    if (rm) rmCards[attr] = rm;
  }
  block.slotCardinalities_ = cards;
  block.rmCardinalities_ = rmCards;
  const rmAttrOrder = attributesFor(node.rmType).map((attr) => attr.name);
  block.prohibitedAttributes_ = (node.attributeConstraints ?? [])
    .filter((row) => row.prohibited)
    .flatMap((row) => {
      const rm = parseSlotCardinality(row.rmCardinality);
      const effective = parseSlotCardinality(row.effectiveCardinality);
      if (!rm || !effective) return [];
      return [{ name: row.name, rm, effective }];
    })
    .sort((a, b) => rmAttrOrder.indexOf(a.name) - rmAttrOrder.indexOf(b.name));
  syncRmAttributeInputs(block, node.rmType, attributes, cards);

  if (!isRoot && !block.outputConnection) {
    block.setPreviousStatement(true);
    block.setNextStatement(true);
  }

  setMandatoryFlag(block, node.mandatory);

  // Initialise SVG before nesting children so puzzle-tab sockets measure correctly.
  finalizeBlock(block);

  // Drop the empty INTERVAL_EVENT math_function scaffold from block init so a
  // template-mandated term_pick (or a fresh choose…) can attach cleanly.
  if (node.rmType === "INTERVAL_EVENT") {
    clearEmptyMathFunctionScaffold(block);
  }

  for (const attr of attributes) {
    const attrChildren = visibleChildren.filter((child) => child.rmAttribute === attr);
    const childBlocks = attrChildren
      .map((child) => buildBlockFromNode(workspace, child, false, depth + 1, node.rmType))
      .filter((child): child is BlockSvg => child !== null);
    connectAttributeChildren(block, rmAttributeInputName(attr), childBlocks);
  }

  if (node.rmType === "INTERVAL_EVENT") {
    ensureIntervalEventMathFunctionScaffold(
      block,
      mandatedMathFunctionCode(visibleChildren),
    );
  }

  refreshBlockLayout(block);
  return block;
}

function buildElementBlock(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  isRoot: boolean,
): BlockSvg {
  ensureRmBlockType("element", "ELEMENT");
  const primary = primaryValueChild(node);
  const block = workspace.newBlock("element") as BlockSvg;
  const dvType = primary?.rmType ?? "DATA_VALUE";
  block.setFieldValue("ELEMENT", "RM_TYPE");
  setFieldIfPresent(block, "VALUE_RM_TYPE", dvType);
  setFieldIfPresent(block, "ELEMENT_SLOT_ID", node.slotId);
  block.setFieldValue(primary?.slotId ?? node.slotId, "SLOT_ID");
  if (node.archetypeNodeId) {
    setFieldIfPresent(block, "ARCHETYPE_NODE_ID", node.archetypeNodeId);
  }
  applySkeletonBlockLabels(block, node);
  configureElementValueSlot(block, dvType);

  if (!isRoot && !block.outputConnection) {
    block.setPreviousStatement(true);
    block.setNextStatement(true);
  }

  const valueMandatory = Boolean(
    (primary?.mandatory ?? false) || Boolean(node.mandatory && primary),
  );
  const allowedValues = primary?.allowedValues ?? node.allowedValues ?? [];
  const allowedOrdinals = primary?.allowedOrdinals ?? node.allowedOrdinals ?? [];
  setMandatoryFlag(block, valueMandatory);

  // Render the ELEMENT shell before attaching the typed DATA_VALUE child.
  finalizeBlock(block);

  const mandated = allowedValues.length === 1 ? allowedValues[0] : undefined;
  const mandatedSet = mandated
    ? termSetForMandatedCode(mandated.terminologyId, mandated.code)
    : undefined;
  const allowedUnits = primary?.allowedUnits ?? node.allowedUnits ?? [];
  if (
    mandatedSet &&
    mandated &&
    (dvType === "DV_CODED_TEXT" || dvType === "CODE_PHRASE")
  ) {
    const pick = createTermPickBlock(
      workspace,
      mandatedSet,
      mandated.code,
      primary?.slotId ?? node.slotId,
    );
    connectBlockToInput(block.getInput("VALUE"), pick);
    finalizeBlock(pick);
  } else if (allowedValues.length > 1 && isCodedChoiceRmType(dvType)) {
    const selector = createCodedValueSetSelector(workspace, dvType, allowedValues);
    connectBlockToInput(block.getInput("VALUE"), selector);
  } else if (allowedOrdinals.length > 1 && isOrdinalChoiceRmType(dvType)) {
    const selector = createOrdinalValueSetSelector(workspace, dvType, allowedOrdinals);
    connectBlockToInput(block.getInput("VALUE"), selector);
  } else if (
    (valueMandatory || allowedValues.length > 1 || allowedOrdinals.length > 1 ||
      allowedUnits.length > 1 ||
      Boolean(primary?.fixedFields?.units ?? node.fixedFields?.units)) &&
    primary &&
    isDataValueType(dvType)
  ) {
    const shell = ensureElementDataValueShell(workspace, block, dvType);
    if (shell) {
      applyFixedFieldsToDataValueShell(
        workspace,
        shell,
        primary.fixedFields ?? node.fixedFields,
      );
      attachValueSetSelector(workspace, shell, allowedValues);
      attachOrdinalSelector(workspace, shell, allowedOrdinals);
      attachUnitSelector(workspace, shell, allowedUnits);
    }
  }

  refreshBlockLayout(block);
  return block;
}

function buildTypedValueBlock(
  workspace: WorkspaceSvg,
  node: SkeletonNode,
  _isRoot: boolean,
  parentRmType?: string,
): BlockSvg {
  const mandatedCode = node.fixedFields?.code_string ?? node.fixedFields?.defining_code;
  const termSet = (parentRmType && node.rmAttribute
    ? termSetForRmAttribute(parentRmType, node.rmAttribute)
    : undefined) ??
    termSetForMandatedCode(node.fixedFields?.terminology_id, mandatedCode);
  if (termSet) {
    const block = createTermPickBlock(workspace, termSet, mandatedCode, node.slotId);
    setMandatoryFlag(block, node.mandatory);
    return finalizeBlock(block);
  }

  if (
    node.allowedOrdinals &&
    node.allowedOrdinals.length > 1 &&
    isOrdinalChoiceRmType(node.rmType)
  ) {
    const selector = createOrdinalValueSetSelector(
      workspace,
      node.rmType,
      node.allowedOrdinals,
    );
    setMandatoryFlag(selector, node.mandatory);
    refreshBlockLayout(selector);
    return selector;
  }

  if (
    node.allowedValues &&
    node.allowedValues.length > 1 &&
    isCodedChoiceRmType(node.rmType)
  ) {
    const selector = createCodedValueSetSelector(workspace, node.rmType, node.allowedValues);
    setMandatoryFlag(selector, node.mandatory);
    refreshBlockLayout(selector);
    return selector;
  }

  const blockType = node.blockType && node.blockType !== "rm_structure" && node.blockType !== "element"
    ? node.blockType
    : blockTypeForRm(node.rmType);
  ensureRmBlockType(blockType, node.rmType);
  const block = workspace.newBlock(blockType) as BlockSvg;
  setFieldIfPresent(block, "RM_TYPE", node.rmType);
  setFieldIfPresent(block, "SLOT_ID", node.slotId);
  applySkeletonBlockLabels(block, node);
  setMandatoryFlag(block, node.mandatory);
  finalizeBlock(block);
  applyFixedFieldsToDataValueShell(workspace, block, node.fixedFields);
  attachValueSetSelector(workspace, block, node.allowedValues);
  attachOrdinalSelector(workspace, block, node.allowedOrdinals);
  attachUnitSelector(workspace, block, node.allowedUnits);
  refreshBlockLayout(block);
  return block;
}

/**
 * Stock Blockly `lists_getIndex` wrapping `lists_create_with` of template
 * choices. Coded leaves use complete DV objects (rubric + defining_code);
 * string/unit lists stay as text items.
 *
 * @see openehr://spec/type/RM/DV_CODED_TEXT
 */
function attachOrdinalSelector(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  values: AllowedOrdinal[] | undefined,
): void {
  if (!values || values.length < 2) return;
  const rmType = (shell.getFieldValue("RM_TYPE") || "").toUpperCase();
  if (!isOrdinalChoiceRmType(rmType)) return;
  const selector = createOrdinalValueSetSelector(workspace, rmType, values);
  connectExpressionToDataValueShell(shell, selector);
}

function attachValueSetSelector(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  values: AllowedValue[] | undefined,
): void {
  if (!values || values.length < 2) return;
  const rmType = (shell.getFieldValue("RM_TYPE") || "").toUpperCase();
  if (isCodedChoiceRmType(rmType)) return;
  const selector = createStringListSelector(workspace, values.map((v) => v.label || v.code));
  connectExpressionToDataValueShell(shell, selector);
}

function attachUnitSelector(
  workspace: Blockly.Workspace,
  shell: Blockly.Block,
  units: string[] | undefined,
): void {
  if (!units || units.length < 2) return;
  const input = shell.getInput(dvFieldInputName("units"));
  if (!input?.connection) return;
  const selector = createStringListSelector(workspace, units);
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  connectBlockToInput(input, selector);
}

function isCodedChoiceRmType(rmType: string): boolean {
  return rmType === "DV_CODED_TEXT" || rmType === "CODE_PHRASE";
}

function isOrdinalChoiceRmType(rmType: string): boolean {
  return rmType === "DV_ORDINAL" || rmType === "DV_SCALE";
}

type ListCreateBlock = BlockSvg & {
  itemCount_: number;
  updateShape_: () => void;
};

type ListGetIndexBlock = BlockSvg & {
  updateAt_?: (hasAt: boolean) => void;
};

/** lists_getIndex dropdown labels come from Blockly.Msg; tests may not have set a locale. */
function ensureStockListMessages(): void {
  ensureStockBlocklyMessages();
}

function createCodedValueSetSelector(
  workspace: Blockly.Workspace,
  rmType: string,
  values: AllowedValue[],
): BlockSvg {
  ensureStockListMessages();
  const blockType = rmType === "CODE_PHRASE" ? "code_phrase" : blockTypeForRm(rmType);
  ensureRmBlockType(blockType, rmType);
  const list = workspace.newBlock("lists_create_with") as ListCreateBlock;
  list.itemCount_ = values.length;
  list.updateShape_();
  for (let i = 0; i < values.length; i++) {
    const choice = workspace.newBlock(blockType) as BlockSvg;
    if (choice.getField("RM_TYPE")) choice.setFieldValue(rmType, "RM_TYPE");
    applyFixedFieldsToDataValueShell(workspace, choice, fieldsForAllowedValue(values[i]!, rmType));
    list.getInput(`ADD${i}`)?.connection?.connect(choice.outputConnection!);
    finalizeBlock(choice);
  }
  finalizeBlock(list);
  const assumedIdx = values.findIndex((value) => value.assumed);
  return createListGetIndex(
    workspace,
    list,
    assumedIdx >= 0 ? assumedIdx : 0,
    blocklyCheckForDv(rmType),
  );
}

function fieldsForAllowedValue(
  value: AllowedValue,
  rmType: string,
): Record<string, string> {
  const terminology = value.terminologyId ?? "local";
  if (rmType === "CODE_PHRASE") {
    return { terminology_id: terminology, code_string: value.code };
  }
  return {
    value: value.label || value.code,
    terminology_id: terminology,
    defining_code: value.code,
    code_string: value.code,
  };
}

function fieldsForAllowedOrdinal(value: AllowedOrdinal): Record<string, string> {
  return {
    value: String(value.value),
    symbol_value: value.label,
    terminology_id: value.terminologyId ?? "local",
    defining_code: value.code,
    code_string: value.code,
  };
}

function createOrdinalValueSetSelector(
  workspace: Blockly.Workspace,
  rmType: string,
  values: AllowedOrdinal[],
): BlockSvg {
  ensureStockListMessages();
  const blockType = blockTypeForRm(rmType);
  ensureRmBlockType(blockType, rmType);
  const list = workspace.newBlock("lists_create_with") as ListCreateBlock;
  list.itemCount_ = values.length;
  list.updateShape_();
  for (let i = 0; i < values.length; i++) {
    const choice = workspace.newBlock(blockType) as BlockSvg;
    if (choice.getField("RM_TYPE")) choice.setFieldValue(rmType, "RM_TYPE");
    applyOrdinalFieldsToDataValueShell(
      workspace,
      choice,
      fieldsForAllowedOrdinal(values[i]!),
    );
    list.getInput(`ADD${i}`)?.connection?.connect(choice.outputConnection!);
    finalizeBlock(choice);
  }
  finalizeBlock(list);
  const assumedIdx = values.findIndex((value) => value.assumed);
  return createListGetIndex(
    workspace,
    list,
    assumedIdx >= 0 ? assumedIdx : 0,
    blocklyCheckForDv(rmType),
  );
}

function createStringListSelector(
  workspace: Blockly.Workspace,
  items: string[],
): BlockSvg {
  ensureStockListMessages();
  const list = workspace.newBlock("lists_create_with") as ListCreateBlock;
  list.itemCount_ = items.length;
  list.updateShape_();
  for (let i = 0; i < items.length; i++) {
    const text = workspace.newBlock("text") as BlockSvg;
    text.setFieldValue(items[i]!, "TEXT");
    list.getInput(`ADD${i}`)?.connection?.connect(text.outputConnection!);
    finalizeBlock(text);
  }
  finalizeBlock(list);
  return createListGetIndex(workspace, list, 0, "String");
}

/** 0-based index; Blockly `FROM_START` AT is 1-based (`emitListsGetIndex` subtracts 1). */
function createListGetIndex(
  workspace: Blockly.Workspace,
  list: BlockSvg,
  indexFromStart: number,
  outputCheck?: string | string[] | null,
): BlockSvg {
  ensureStockListMessages();
  const get = workspace.newBlock("lists_getIndex") as ListGetIndexBlock;
  get.setFieldValue("GET", "MODE");
  get.setFieldValue("FROM_START", "WHERE");
  get.updateAt_?.(true);
  const num = workspace.newBlock("math_number") as BlockSvg;
  num.setFieldValue(String(indexFromStart + 1), "NUM");
  get.getInput("AT")?.connection?.connect(num.outputConnection!);
  finalizeBlock(num);
  get.getInput("VALUE")?.connection?.connect(list.outputConnection!);
  if (outputCheck) get.setOutput(true, outputCheck);
  return finalizeBlock(get);
}

function connectBlockToInput(
  input: Blockly.Input | null | undefined,
  child: Blockly.Block,
): void {
  if (!input?.connection || !child.outputConnection) return;
  const parentConn = input.connection;
  const childConn = child.outputConnection;
  const attempt = (): void => {
    if (parentConn.isConnected() && parentConn.targetConnection !== childConn) {
      parentConn.disconnect();
    }
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

function primaryValueChild(node: SkeletonNode): SkeletonNode | undefined {
  return node.children.find(
    (child) =>
      child.kind === "value" &&
      isDataValueType(child.rmType) &&
      !AUTO_FIXED_LOCATABLE_ATTRS.has(child.label),
  );
}

function connectAttributeChildren(
  parent: Blockly.Block,
  inputName: string,
  blocks: Blockly.Block[],
): void {
  if (!blocks.length) return;
  const input = parent.getInput(inputName);
  if (!input?.connection) return;
  if (blocks[0]?.outputConnection && !blocks[0].previousConnection) {
    input.connection.connect(blocks[0].outputConnection);
    return;
  }
  connectStatementChain(parent, inputName, blocks);
}

/** Dispose an init-time choose… math_function pick so skeleton children can attach. */
function clearEmptyMathFunctionScaffold(block: Blockly.Block): void {
  const input = block.getInput(rmAttributeInputName("math_function"));
  const existing = input?.connection?.targetBlock() ?? null;
  if (!existing || !isTermPickBlock(existing)) return;
  const code = String(existing.getFieldValue("CODE") || "");
  if (code && code !== TERM_PICK_NONE) return;
  existing.dispose(false);
}

/** Single OPT-mandated math_function code, if the template locked one in. */
function mandatedMathFunctionCode(children: SkeletonNode[]): string | undefined {
  const mathChild = children.find((child) => child.rmAttribute === "math_function");
  if (!mathChild) return undefined;
  const fromFixed = mathChild.fixedFields?.code_string ?? mathChild.fixedFields?.defining_code;
  if (fromFixed) return fromFixed;
  if (mathChild.allowedValues?.length === 1) return mathChild.allowedValues[0]!.code;
  return undefined;
}

function connectStatementChain(
  parent: Blockly.Block,
  inputName: string,
  blocks: Blockly.Block[],
): void {
  if (!blocks.length) return;
  const input = parent.getInput(inputName);
  if (!input?.connection) return;

  let previous: Blockly.Block | null = null;
  for (const block of blocks) {
    if (!previous) {
      if (block.previousConnection) {
        input.connection.connect(block.previousConnection);
      }
    } else if (previous.nextConnection && block.previousConnection) {
      previous.nextConnection.connect(block.previousConnection);
    }
    previous = block;
  }
}

function attachExpressionToPartyName(
  workspace: Blockly.Workspace,
  party: Blockly.Block,
  expression: string,
  returnType: string,
): void {
  const exprBlock = expressionToBlock(workspace, expression, returnType);
  if (exprBlock.type === "maps_create_with") {
    const count = Number((exprBlock as Blockly.Block & { itemCount_?: number }).itemCount_ ?? 0);
    for (let i = 0; i < count; i++) {
      const key = String(exprBlock.getFieldValue(`KEY${i}`) ?? "");
      const child = exprBlock.getInputTargetBlock(`VAL${i}`);
      if (key !== "name" || !child || child.isShadow()) continue;
      child.outputConnection?.disconnect();
      const input = party.getInput(rmAttributeInputName("name"));
      if (!input?.connection || !child.outputConnection) continue;
      const existing = input.connection.targetBlock();
      if (existing) existing.dispose(false);
      try {
        input.connection.connect(child.outputConnection);
      } catch {
        const prev = input.connection.getCheck();
        input.setCheck(null);
        try {
          input.connection.connect(child.outputConnection);
        } finally {
          if (prev) input.setCheck(prev);
        }
      }
    }
    exprBlock.dispose(false);
    return;
  }
  const input = party.getInput(rmAttributeInputName("name"));
  if (!input?.connection) return;
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  if (!exprBlock.outputConnection) return;
  try {
    input.connection.connect(exprBlock.outputConnection);
  } catch {
    const prevCheck = input.connection.getCheck();
    input.setCheck(null);
    try {
      input.connection.connect(exprBlock.outputConnection);
    } catch {
      /* still incompatible */
    } finally {
      if (prevCheck) input.setCheck(prevCheck);
    }
  }
}

function attachExpressionToTypedValue(
  workspace: Blockly.Workspace,
  valueBlock: Blockly.Block,
  expression: string,
  returnType: string,
  rmTypeHint?: string,
): void {
  const exprBlock = expressionToBlock(workspace, expression, returnType);
  if (isTermPickBlock(valueBlock)) {
    const parentConnection = valueBlock.outputConnection?.targetConnection;
    const set = termSetById(valueBlock.getFieldValue("SET"));
    const slotId = valueBlock.getFieldValue("SLOT_ID");
    const rmType = rmTypeHint || set?.valueRmType || "CODE_PHRASE";
    valueBlock.dispose(false);
    const shellType = rmType === "DV_CODED_TEXT" ? "DV_CODED_TEXT" : "CODE_PHRASE";
    ensureRmBlockType(blockTypeForRm(shellType), shellType);
    const shell = workspace.newBlock(blockTypeForRm(shellType));
    if (shell.getField("RM_TYPE")) shell.setFieldValue(shellType, "RM_TYPE");
    if (slotId && shell.getField("SLOT_ID")) shell.setFieldValue(slotId, "SLOT_ID");
    if (shell.outputConnection && parentConnection) {
      parentConnection.connect(shell.outputConnection);
    }
    applyFixedFieldsToDataValueShell(workspace, shell, {
      terminology_id: set?.terminologyId ?? "",
    });
    connectExpressionToDataValueShell(shell, exprBlock);
    finalizeBlock(shell as BlockSvg);
    return;
  }
  connectExpressionToDataValueShell(valueBlock, exprBlock);
}

function attachExpressionToElement(
  workspace: Blockly.Workspace,
  elementBlock: Blockly.Block,
  expression: string,
  returnType: string,
  rmTypeHint?: string,
): void {
  const rmType = rmTypeHint || elementValueDvType(elementBlock);
  const shell = ensureElementDataValueShell(workspace, elementBlock, rmType);
  if (!shell) return;

  const exprBlock = expressionToBlock(workspace, expression, returnType);
  connectExpressionToDataValueShell(shell, exprBlock);
  elementBlock.setWarningText(null);

  // Expand collapsed ancestors so the mapped leaf is visible
  let parent = elementBlock.getParent();
  while (parent) {
    if (typeof parent.setCollapsed === "function" && parent.isCollapsed?.()) {
      parent.setCollapsed(false);
    }
    parent = parent.getParent();
  }
}

function attachSchemaFieldExpressions(
  workspace: Blockly.Workspace,
  block: Blockly.Block,
  slotMap: Map<string, { expression: string; returnType: string; rmType?: string }>,
): void {
  for (const input of block.inputList) {
    if (!input.name.startsWith("TARGET_") && !input.name.startsWith("SCHEMA_OPT_")) continue;
    if (input.type === 3) continue; // statement mouth
    const slotId = schemaSlotIdForInput(block, input.name);
    if (!slotId) continue;
    const slot = slotMap.get(slotId);
    if (!slot) continue;
    const existing = input.connection?.targetBlock();
    if (existing) existing.dispose(false);
    const exprBlock = expressionToBlock(workspace, slot.expression, slot.returnType);
    if (exprBlock.outputConnection && input.connection) {
      try {
        input.connection.connect(exprBlock.outputConnection);
      } catch {
        /* type check */
      }
    }
  }
}

function attachExpressionToTarget(
  workspace: Blockly.Workspace,
  targetBlock: Blockly.Block,
  expression: string,
  returnType: string,
): void {
  const input = targetBlock.getInput("VALUE");
  if (!input?.connection) return;
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  const exprBlock = expressionToBlock(workspace, expression, returnType);
  if (exprBlock.outputConnection) input.connection.connect(exprBlock.outputConnection);
  targetBlock.setWarningText(null);
}

function expressionToBlock(
  workspace: Blockly.Workspace,
  expression: string,
  returnType: string,
): BlockSvg {
  try {
    return astToExpressionBlock(workspace, parseExpression(expression), returnType, finalizeBlock);
  } catch {
    return createSourceQueryBlock(workspace, expression, returnType);
  }
}

function finalizeBlock(block: BlockSvg): BlockSvg {
  if (typeof document !== "undefined") {
    block.initSvg();
    block.render();
  }
  return block;
}

function refreshBlockLayout(block: BlockSvg): void {
  if (typeof document !== "undefined" && typeof block.render === "function") {
    block.render();
  }
}

/** Re-measure all blocks after programmatic skeleton assembly. */
function refreshWorkspaceLayout(workspace: WorkspaceSvg): void {
  if (typeof document === "undefined") return;
  for (const block of workspace.getAllBlocks(false)) {
    refreshBlockLayout(block as BlockSvg);
  }
  if (typeof Blockly.svgResize === "function") {
    Blockly.svgResize(workspace);
  }
}

function setFieldIfPresent(block: Blockly.Block, name: string, value: string): void {
  const field = block.getField(name);
  if (field) field.setValue(value);
}

function setMandatoryFlag(block: Blockly.Block, mandatory: boolean): void {
  setFieldIfPresent(block, "MANDATORY", mandatory ? "1" : "");
}
