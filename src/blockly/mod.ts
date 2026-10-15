import * as Blockly from "blockly/core";
import "blockly/blocks";
import { javascriptGenerator, Order } from "blockly/javascript";
import type { SkeletonNode } from "../types/mod.ts";
import { extractMappingIr, type MappingModelExtract } from "./mapping_ir.ts";
import { registerRmBlocks, rmAttributeInputName } from "./blocks/rm_blocks.ts";
import { registerTargetBlocks } from "./blocks/target_blocks.ts";
import { registerExpressionBlocks } from "./blocks/expression_blocks.ts";
import { registerMapBlocks } from "./blocks/map_blocks.ts";
import { registerSheetBlocks } from "./blocks/sheet_blocks.ts";
import {
  registerDecisionTableBlocks,
} from "./blocks/decision_table_blocks.ts";
import { registerTextBlocks } from "./blocks/text_blocks.ts";
import {
  currentItemName,
  currentLoopItemName,
  LISTS_SET_OPERATION_BLOCK,
  LOGIC_CURRENT_ITEM_BLOCK,
  LOGIC_LIST_RESTRICTION_BLOCK,
  LOGIC_LOOP_INDEX_BLOCK,
  LOGIC_LOOP_LENGTH_BLOCK,
  registerLogicBlocks,
  restrictionCount,
  restrictionItemName,
  restrictionOpNeedsCount,
  restrictionRequiresItems,
} from "./blocks/logic_blocks.ts";
import { registerExtractToFunctionMenu } from "./extract_function.ts";
import { registerTypeScriptExportAdapter } from "./typescript_codegen.ts";
import { registerGoTemplateExportAdapter } from "./go_template_codegen.ts";
import { attributesFor, dataValueLeafTypes, blockTypeForRm, isPrimitiveRmType } from "../core/rm_meta.ts";
import { TERM_PICK_NONE, termSetById } from "../core/openehr_term_catalog.ts";
import { TERM_PICK_BLOCK_TYPE } from "./blocks/term_pick.ts";
import {
  loopIndexBinderName,
  loopIsInsideProcedure,
  loopLengthBinderName,
} from "./loop_block.ts";
import {
  SOURCE_QUERY_BLOCK_TYPES,
  fontoxpathFnForReturnType,
  isSourceQueryBlockType,
  returnTypeFromSourceBlock,
} from "./source_query.ts";

export {
  applyModelExpressions,
  applyModelLoops,
  attachOptionalRmChild,
  attachOptionalSchemaChild,
  highlightListeningSlot,
  loadSkeletonIntoWorkspace,
  placeSkeletonSubtreeOnWorkspace,
  lockWorkspaceRootsExpanded,
  setAllBlocksCollapsed,
  slotIdFromBlock,
} from "./skeleton_loader.ts";
export { applySkeletonBlockLabels, relabelWorkspaceFromSkeleton } from "./block_labels.ts";
export { migrateForEachSourceState } from "./migrate_for_each_source.ts";
export { FOR_EACH_LIST_BLOCK, isLoopBlockType, sourcePathFromLoopList } from "./loop_block.ts";
export {
  refreshWorkspaceConstraints,
  ABSTRACT_EVENT_WARNING,
  ABSTRACT_ITEM_STRUCTURE_WARNING,
  warningTextOf,
  isUnmappedValueBlock,
  blockConstraintMessages,
} from "./block_constraints.ts";
export {
  blockHatchMessages,
  isLiteralSourcePath,
  HATCH_REMOVED,
  HATCH_JSON_XML,
  HATCH_DYNAMIC_PATH,
  HATCH_OUT_OF_DIALECT_HBS,
  HATCH_OUT_OF_DIALECT_GO,
} from "./vms_linter.ts";
export {
  PLACEHOLDER_SOURCE_PATH,
  isPlaceholderSourcePath,
  listeningTargetFromBlock,
  owningValueSlotId,
  hasPlaceholderSourceQuery,
  type ListeningTarget,
} from "./listening.ts";
export { blockToExpression } from "./expression_serialize.ts";
export type { MappingModelExtract } from "./mapping_ir.ts";
export {
  createSourceQueryBlock,
  isSourceQueryBlockType,
  placeSourceQueryBlock,
  sourceBlockTypeForReturnType,
  sourceQueryFieldLabel,
  sourceReturnTypeFromSchemaType,
  SOURCE_TYPE_EMOJI,
  workspacePositionFromClient,
} from "./source_query.ts";
export { createModestTheme } from "./theme.ts";
export { registerCompactThrasosRenderer, COMPACT_RENDERER_NAME } from "./compact_renderer.ts";
export {
  openWorkspaceSnapshotWindow,
  workspaceToStandaloneSvg,
} from "./workspace_snapshot.ts";
export {
  openBlockMutator,
  composeOptionalRmExtras,
  setOptionalRmMutatorChangeHandler,
  applyEventRmType,
  applyItemStructureRmType,
  isEventFamilyType,
  isItemStructureFamilyType,
} from "./blocks/rm_blocks.ts";
export { dataValueLeafTypes, blockTypeForRm, getValidAttachments } from "../core/rm_meta.ts";
export { isRmContainerBlockType } from "./blocks/rm_blocks.ts";
export {
  composeSchemaOptionalFields,
  schemaOptionalExtrasOf,
  setSchemaFieldsMutatorChangeHandler,
} from "./blocks/schema_mutator.ts";
export { setSchemaCatalog, skeletonToolboxSignature, findSkeletonNode } from "./schema_catalog.ts";
export { registerSchemaBlocksFromSkeleton } from "./schema_blocks.ts";
export { buildDemoToolbox, toolboxBlockTypes, type ToolboxContext } from "./toolbox_demo.ts";
export {
  attachDefaultPointLookups,
  applyDefaultContextMap,
  captureDefaultsBlockState,
  ensureDefaultsBlock,
  findDefaultsBlock,
  hydrateDefaultsMapArgument,
  placeDefaultsBesideSkeleton,
  restoreDefaultsBlockState,
  serializeDefaultsMapArgument,
} from "./defaults_canvas.ts";
export {
  attachStartToInstanceRoot,
  ensureConversionStartOnScaffold,
  enforceConversionStartUniqueness,
  findScaffoldInstanceRoot,
} from "./conversion_start_canvas.ts";
export {
  CONVERSION_START_TYPE,
  TEXT_DOCUMENT_BLOCK_TYPE,
  registerConversionStartBlock,
  findInstanceRootUnderStart,
  inferTargetFormatFromRoot,
  isInstanceRootBlockType,
  applyInstanceRootCap,
  productStackBlocks,
} from "./instance_root.ts";
export { setDefaultsMapPickHandler, setDefaultsMapInfoHandler, setDefaultsMapHardcodeHandler, setDefaultContextMapApplyHandler } from "./blocks/map_blocks.ts";
export {
  appendContextMapEntry,
  scaffoldTargetFieldAtClientPoint,
  defaultContextMapAtClientPoint,
  contextMapValueInputAtClientPoint,
} from "./blocks/default_context_map.ts";
export {
  defaultsMapKeys,
  hardcodeDefaultsMapKey,
  listDefaultsMapEntries,
  type DefaultsMapEntryInfo,
} from "./hardcode_defaults.ts";
export { setSheetFocusHandler } from "./blocks/sheet_blocks.ts";
export { setDecisionTableFocusHandler, setDecisionTableInfoHandler } from "./blocks/decision_table_blocks.ts";
export { setWorkspaceSheetsProvider } from "./sheets_bridge.ts";
export { installDecisionTableSync, syncDecisionTableBlocksFromSheets } from "./decision_table_sync.ts";
export { registerGridFlyoutButtons, setGridCreateHandler } from "./grid_flyout.ts";
export {
  canExtractToFunction,
  extractBlockToFunction,
  installExtractToFunctionOnWorkspace,
  registerExtractToFunctionMenu,
  EXTRACT_TO_FUNCTION_MENU_ID,
} from "./extract_function.ts";
export {
  extractFunctionBundle,
  extractFunctionBundleFromState,
  listWorkspaceFunctions,
  mergeFunctionBundle,
  mergeFunctionBundleIntoState,
} from "./function_bundle.ts";
export {
  GRAMMATICAL_JOIN_SPECS,
  JOIN_OXFORD_SPEC,
  JOIN_SWEDISH_SPEC,
  buildGrammaticalJoinBundle,
  defineGrammaticalJoin,
  defineJoinSwedish,
  grammaticalJoinTable,
} from "./grammatical_join.ts";
export { installFunctionLibraryMenus, registerFunctionLibraryMenus } from "./function_library_menu.ts";
export { installBlocklyFloatingOverlays } from "./floating_overlays.ts";
export { installCollapsedPreview } from "./field_collapsed_preview.ts";
export { collapsedHtmlForBlock, shortArchetypeLabel } from "./collapsed_preview.ts";
export {
  generateTypeScriptFromBlocklyState,
  generateTypeScriptFromWorkspace,
  registerTypeScriptExportAdapter,
} from "./typescript_codegen.ts";
export {
  generateGoTemplateFromBlocklyState,
  generateGoTemplateFromWorkspace,
  registerGoTemplateExportAdapter,
} from "./go_template_codegen.ts";

import { registerConversionStartBlock } from "./instance_root.ts";
import { installCollapsedPreview } from "./field_collapsed_preview.ts";
import { installHeaderMutatorChrome } from "./dynamic_mutator.ts";

let generatorsReady = false;

export function initBlocklyGenerators(): void {
  if (!generatorsReady) {
    registerRmBlocks();
    registerTargetBlocks();
    registerExpressionBlocks();
    registerMapBlocks();
    registerSheetBlocks();
    registerDecisionTableBlocks();
    registerTextBlocks();
    registerConversionStartBlock();
    registerLogicBlocks();
    registerExtractToFunctionMenu();
    registerGenerators();
    registerTypeScriptExportAdapter();
    registerGoTemplateExportAdapter();
    installCollapsedPreview();
    generatorsReady = true;
  }
  installHeaderMutatorChrome();
}

function registerGenerators(): void {
  const sourceGenerator = (block: Blockly.Block) => {
    const expr = block.getFieldValue("EXPRESSION");
    const fn = fontoxpathFnForReturnType(returnTypeFromSourceBlock(block));
    return [`${fn}(${JSON.stringify(expr)}, sourceCtx.data)`, Order.FUNCTION_CALL] as [string, number];
  };
  for (const type of SOURCE_QUERY_BLOCK_TYPES) {
    javascriptGenerator.forBlock[type] = sourceGenerator;
  }

  for (const rmType of dataValueLeafTypes()) {
    const type = blockTypeForRm(rmType);
    javascriptGenerator.forBlock[type] = (block) => generateDvConstructor(block, rmType);
  }
  javascriptGenerator.forBlock["dv_quantity_value"] = (block) =>
    generateDvConstructor(block, "DV_QUANTITY");

  javascriptGenerator.forBlock["code_phrase"] = (block) => {
    const code = javascriptGenerator.valueToCode(block, "FLD_code_string", Order.NONE) ||
      '""';
    const terminology = javascriptGenerator.valueToCode(block, "FLD_terminology_id", Order.NONE) ||
      '""';
    return [
      `new openehr_rm.CODE_PHRASE({ terminology_id: { value: ${terminology} }, code_string: ${code} })`,
      Order.NEW,
    ] as [string, number];
  };

  javascriptGenerator.forBlock[TERM_PICK_BLOCK_TYPE] = (block) => {
    const set = termSetById(block.getFieldValue("SET"));
    const rawCode = block.getFieldValue("CODE");
    const code = rawCode === TERM_PICK_NONE ? "" : rawCode;
    const terminology = JSON.stringify(set?.terminologyId ?? "openehr");
    const codeJson = JSON.stringify(code);
    const rubric = set?.codes.find((item) => item.code === code)?.rubric ?? code;
    const phrase =
      `new openehr_rm.CODE_PHRASE({ terminology_id: { value: ${terminology} }, code_string: ${codeJson} })`;
    if (set?.valueRmType === "DV_CODED_TEXT") {
      return [
        `new openehr_rm.DV_CODED_TEXT({ value: ${JSON.stringify(rubric)}, defining_code: ${phrase} })`,
        Order.NEW,
      ] as [string, number];
    }
    return [phrase, Order.NEW] as [string, number];
  };

  javascriptGenerator.forBlock["for_each_list"] = (block) => emitForEachListJs(block);

  javascriptGenerator.forBlock["maps_get"] = (block) => {
    const name = String(block.getFieldValue("NAME") || "defaults");
    const key = javascriptGenerator.valueToCode(block, "KEY", Order.NONE) || '""';
    const code = name === "defaults"
      ? `defaults[${key}]`
      : `((${JSON.stringify(name)} === "defaults" ? defaults : {})[${key}])`;
    return [code, Order.MEMBER];
  };

  javascriptGenerator.forBlock["maps_create_empty"] = () =>
    ["({})", Order.ATOMIC] as [string, number];

  javascriptGenerator.forBlock["maps_create_with"] = (block) => {
    const count = Number((block as Blockly.Block & { itemCount_?: number }).itemCount_ ?? 0);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = JSON.stringify(block.getFieldValue(`KEY${i}`) ?? "");
      const val = javascriptGenerator.valueToCode(block, `VAL${i}`, Order.NONE) || "null";
      parts.push(`${key}: ${val}`);
    }
    return [`({ ${parts.join(", ")} })`, Order.ATOMIC] as [string, number];
  };

  javascriptGenerator.forBlock["default_context_map"] = () => "";

  javascriptGenerator.forBlock["sheet_get_cell"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const a1 = javascriptGenerator.valueToCode(block, "A1", Order.NONE) || '"A1"';
    return [`sheetGetCell(${name}, ${a1})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_get_xy"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    return [`sheetGetXy(${name}, ${x}, ${y})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_get_row"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    return [`sheetGetRow(${name}, ${y})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_get_column"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    return [`sheetGetColumn(${name}, ${x})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_get_header"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    return [`sheetGetHeader(${name}, ${x})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_get_data"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    return [`sheetGetData(${name})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_lookup"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const col = javascriptGenerator.valueToCode(block, "MATCH_COL", Order.NONE) || '""';
    const val = javascriptGenerator.valueToCode(block, "MATCH_VAL", Order.NONE) || '""';
    const ret = javascriptGenerator.valueToCode(block, "RETURN_COL", Order.NONE) || '""';
    return [`sheetLookup(${name}, ${col}, ${val}, ${ret})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["decision_table"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Decision1");
    const inputs = javascriptGenerator.valueToCode(block, "INPUTS", Order.NONE) || "{}";
    const output = JSON.stringify(block.getFieldValue("OUTPUT") || "out");
    return [`decisionTable(${name}, ${inputs}, ${output})`, Order.FUNCTION_CALL] as [string, number];
  };
  javascriptGenerator.forBlock["sheet_set_cell"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const a1 = javascriptGenerator.valueToCode(block, "A1", Order.NONE) || '"A1"';
    const val = javascriptGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
    return `sheetSetCell(${name}, ${a1}, ${val});\n`;
  };
  javascriptGenerator.forBlock["sheet_set_xy"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    const val = javascriptGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
    return `sheetSetXy(${name}, ${x}, ${y}, ${val});\n`;
  };
  javascriptGenerator.forBlock["sheet_set_row"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    const val = javascriptGenerator.valueToCode(block, "VALUE", Order.NONE) || "[]";
    return `sheetSetRow(${name}, ${y}, ${val});\n`;
  };
  javascriptGenerator.forBlock["sheet_set_column"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    const val = javascriptGenerator.valueToCode(block, "VALUE", Order.NONE) || "[]";
    return `sheetSetColumn(${name}, ${x}, ${val});\n`;
  };
  javascriptGenerator.forBlock["sheet_set_header"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    const val = javascriptGenerator.valueToCode(block, "VALUE", Order.NONE) || '""';
    return `sheetSetHeader(${name}, ${x}, ${val});\n`;
  };
  javascriptGenerator.forBlock["sheet_insert_row"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    return `sheetInsertRow(${name}, ${y});\n`;
  };
  javascriptGenerator.forBlock["sheet_delete_row"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const y = javascriptGenerator.valueToCode(block, "Y", Order.NONE) || "0";
    return `sheetDeleteRow(${name}, ${y});\n`;
  };
  javascriptGenerator.forBlock["sheet_insert_column"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    return `sheetInsertColumn(${name}, ${x});\n`;
  };
  javascriptGenerator.forBlock["sheet_delete_column"] = (block) => {
    const name = JSON.stringify(block.getFieldValue("NAME") || "Sheet1");
    const x = javascriptGenerator.valueToCode(block, "X", Order.NONE) || "0";
    return `sheetDeleteColumn(${name}, ${x});\n`;
  };

  javascriptGenerator.forBlock["text_code"] = (block) =>
    [JSON.stringify(block.getFieldValue("TEXT") ?? ""), Order.ATOMIC] as [string, number];

  javascriptGenerator.forBlock["text_handlebars"] = (block) => {
    const script = javascriptGenerator.valueToCode(block, "SCRIPT", Order.NONE) || '""';
    const context = javascriptGenerator.valueToCode(block, "CONTEXT", Order.NONE) || "{}";
    return [`renderHandlebars(${script}, ${context})`, Order.FUNCTION_CALL] as [string, number];
  };

  javascriptGenerator.forBlock[LOGIC_LIST_RESTRICTION_BLOCK] = (block) => {
    const list = javascriptGenerator.valueToCode(block, "LIST", Order.NONE) || "[]";
    const pred = javascriptGenerator.valueToCode(block, "PRED", Order.NONE) || "true";
    const name = restrictionItemName(block);
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "_item";
    const bind = `(__vars[${JSON.stringify(name)}] = ${ident}, ${pred})`;
    const arr = `asList(${list})`;
    const op = String(block.getFieldValue("OP") ?? "ALL");
    let code: string;
    if (restrictionOpNeedsCount(op)) {
      const count = `${arr}.filter((${ident}) => ${bind}).length`;
      const n = restrictionCount(block);
      code = op === "AT_MOST"
        ? `${count} <= ${n}`
        : op === "EXACTLY"
        ? `${count} === ${n}`
        : `${count} >= ${n}`;
    } else {
      code = op === "ANY"
        ? `${arr}.some((${ident}) => ${bind})`
        : op === "NONE"
        ? `${arr}.every((${ident}) => !${bind})`
        : `${arr}.every((${ident}) => ${bind})`;
    }
    if (restrictionRequiresItems(block)) {
      return [`(${arr}.length > 0 && ${code})`, Order.ATOMIC] as [string, number];
    }
    return [code, Order.FUNCTION_CALL] as [string, number];
  };

  javascriptGenerator.forBlock[LOGIC_CURRENT_ITEM_BLOCK] = (block) =>
    [`__vars[${JSON.stringify(currentItemName(block))}]`, Order.MEMBER] as [string, number];

  javascriptGenerator.forBlock[LOGIC_LOOP_INDEX_BLOCK] = (block) =>
    [
      `__vars[${JSON.stringify(loopIndexBinderName(currentLoopItemName(block)))}]`,
      Order.MEMBER,
    ] as [string, number];

  javascriptGenerator.forBlock[LOGIC_LOOP_LENGTH_BLOCK] = (block) =>
    [
      `__vars[${JSON.stringify(loopLengthBinderName(currentLoopItemName(block)))}]`,
      Order.MEMBER,
    ] as [string, number];

  javascriptGenerator.forBlock[LISTS_SET_OPERATION_BLOCK] = (block) => {
    const a = javascriptGenerator.valueToCode(block, "A", Order.NONE) || "[]";
    const b = javascriptGenerator.valueToCode(block, "B", Order.NONE) || "[]";
    const op = String(block.getFieldValue("OP") ?? "BOTH");
    const fn = op === "EITHER"
      ? "setUnion"
      : op === "NOT_IN"
      ? "setDifference"
      : "setIntersection";
    return [`${fn}(asList(${a}), asList(${b}))`, Order.FUNCTION_CALL] as [string, number];
  };

  javascriptGenerator.forBlock["composition"] = (block) => {
    const parts: string[] = [];
    for (const input of block.inputList) {
      if (!input.name.startsWith("ATTR_")) continue;
      const attr = input.name.slice("ATTR_".length);
      const generated = generateRmAttributeCode(block, input.name);
      if (generated.value) {
        parts.push(`${attr}: ${generated.value}`);
        continue;
      }
      if (!generated.stmt?.trim()) continue;
      if (attr === "content") parts.push(`content: [\n${generated.stmt}]`);
      else parts.push(`${attr}: ${stripTrailingComma(generated.stmt)}`);
    }
    return `const composition = new COMPOSITION({ ${parts.join(", ")} });\n`;
  };
  javascriptGenerator.forBlock["section"] = rmObjectStatement("SECTION", ["items"]);
  javascriptGenerator.forBlock["observation"] = rmObjectStatement("OBSERVATION", [
    "data",
    "state",
    "protocol",
  ]);
  javascriptGenerator.forBlock["evaluation"] = rmObjectStatement("EVALUATION", [
    "data",
    "protocol",
  ]);
  javascriptGenerator.forBlock["instruction"] = rmObjectStatement("INSTRUCTION", [
    "activities",
    "protocol",
  ]);
  javascriptGenerator.forBlock["action"] = rmObjectStatement("ACTION", [
    "description",
    "protocol",
  ]);
  javascriptGenerator.forBlock["admin_entry"] = rmObjectStatement("ADMIN_ENTRY", ["data"]);
  javascriptGenerator.forBlock["cluster"] = rmObjectStatement("CLUSTER", ["items"]);
}

export function skeletonToBlocklyXml(skeleton: SkeletonNode[]): string {
  const workspace = new Blockly.Workspace();
  let y = 20;
  for (const node of skeleton) {
    const block = createBlockFromSkeleton(workspace, node);
    if (block) {
      block.moveBy(20, y);
      y += block.getHeightWidth().height + 20;
    }
  }
  const xml = Blockly.serialization.workspaces.save(workspace);
  workspace.dispose();
  return JSON.stringify(xml);
}

function createBlockFromSkeleton(
  workspace: Blockly.Workspace,
  node: SkeletonNode,
): Blockly.Block | null {
  const block = workspace.newBlock(node.blockType);
  block.initSvg();
  block.render();

  if (node.archetypeNodeId) {
    const field = block.getField("ARCHETYPE_NODE_ID");
    if (field) field.setValue(node.archetypeNodeId);
  }
  if (node.label && block.getField("NAME")) {
    block.getField("NAME")!.setValue(node.label);
  }

  if (node.kind === "value") {
    block.setFieldValue(node.rmType, "RM_TYPE");
    block.setFieldValue(node.slotId, "SLOT_ID");
  }

  let inputIndex = 0;
  for (const child of node.children) {
    const childBlock = createBlockFromSkeleton(workspace, child);
    if (!childBlock) continue;
    const input = block.inputList[inputIndex++];
    if (input?.connection) {
      input.connection.connect(childBlock.previousConnection ?? childBlock.outputConnection);
    }
  }

  return block;
}

export function workspaceToModelJson(workspace: Blockly.Workspace): MappingModelExtract {
  return extractMappingIr(workspace);
}

function rmObjectStatement(rmType: string, attrs: string[]) {
  return (block: Blockly.Block) => {
    const parts: string[] = [];
    const seen = new Set<string>();
    const names = [
      ...attrs,
      ...block.inputList
        .filter((input) => input.name.startsWith("ATTR_"))
        .map((input) => input.name.slice("ATTR_".length)),
    ];
    for (const attr of names) {
      if (seen.has(attr)) continue;
      seen.add(attr);
      const inputName = rmAttributeInputName(attr);
      const generated = generateRmAttributeCode(block, inputName);
      if (generated.value) {
        parts.push(`${attr}: ${generated.value}`);
        continue;
      }
      const stmt = generated.stmt ?? "";
      if (!stmt.trim()) continue;
      const asList = ["content", "items", "events", "activities"].includes(attr);
      parts.push(asList ? `${attr}: [\n${stmt}]` : `${attr}: ${stripTrailingComma(stmt)}`);
    }
    return `rm(${rmType}, { ${parts.join(", ")} }),\n`;
  };
}

function emitForEachListJs(block: Blockly.Block): string {
  const name = String(block.getFieldValue("VAR") || "item");
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "__item";
  const indexName = loopIndexBinderName(name);
  const lengthName = loopLengthBinderName(name);
  const body = javascriptGenerator.statementToCode(block, "DO").trim();
  const listBlock = block.getInputTargetBlock("LIST");
  const collection = listBlock && isSourceQueryBlockType(listBlock.type)
    ? `evaluateXPathToNodes(${JSON.stringify(listBlock.getFieldValue("EXPRESSION") || "/")}, sourceCtx.data)`
    : (() => {
      const list = javascriptGenerator.valueToCode(block, "LIST", Order.ATOMIC) || "[]";
      return `(Array.isArray(${list}) ? ${list} : [])`;
    })();
  const bind =
    `  __vars[${JSON.stringify(name)}] = ${ident};\n` +
    `  __vars[${JSON.stringify(indexName)}] = ${ident}_i;\n` +
    `  __vars[${JSON.stringify(lengthName)}] = ${ident}_col.length;\n`;
  if (loopIsInsideProcedure(block)) {
    return (
      `{\n` +
      `  const ${ident}_col = ${collection};\n` +
      `  for (let ${ident}_i = 0; ${ident}_i < ${ident}_col.length; ${ident}_i++) {\n` +
      `    const ${ident} = ${ident}_col[${ident}_i];\n` +
      bind.replace(/^ {2}/gm, "    ") +
      (body ? `    ${body}\n` : "") +
      `  }\n` +
      `}\n`
    );
  }
  const returned = body ? stripTrailingComma(body) : "null";
  return (
    `...${collection}.map((${ident}, ${ident}_i, ${ident}_col) => {\n` +
    bind +
    `  return ${returned};\n` +
    `}),\n`
  );
}

function stripTrailingComma(code: string): string {
  return code.trim().replace(/,\s*$/, "");
}

/** Blockly `inputTypes.STATEMENT` / `ConnectionType.NEXT_STATEMENT`. */
const STATEMENT_INPUT_TYPE = 3;

function generateRmAttributeCode(
  block: Blockly.Block,
  inputName: string,
): { value?: string; stmt?: string } {
  const input = block.getInput(inputName);
  if (!input) return {};
  if (input.type === STATEMENT_INPUT_TYPE) {
    return { stmt: javascriptGenerator.statementToCode(block, inputName) };
  }
  const value = javascriptGenerator.valueToCode(block, inputName, Order.NONE);
  return value ? { value } : {};
}

function generateDvConstructor(block: Blockly.Block, rmType: string): [string, number] {
  const parts: string[] = [];
  for (const attr of attributesFor(rmType)) {
    if (!isPrimitiveRmType(attr.typeName) && attr.typeName !== "CODE_PHRASE") {
      continue;
    }
    const inputName = block.getInput(`FLD_${attr.name}`)
      ? `FLD_${attr.name}`
      : block.getInput(`OPTFLD_${attr.name}`)
      ? `OPTFLD_${attr.name}`
      : null;
    if (!inputName) continue;
    const code = javascriptGenerator.valueToCode(block, inputName, Order.NONE);
    if (!code) continue;
    parts.push(`${attr.name}: ${code}`);
  }
  if (rmType === "DV_QUANTITY" && !parts.some((p) => p.startsWith("magnitude"))) {
    const mag = javascriptGenerator.valueToCode(block, "MAGNITUDE", Order.NONE);
    if (mag) parts.push(`magnitude: ${mag}`);
    const unitsField = block.getFieldValue("UNITS");
    if (unitsField) parts.push(`units: ${JSON.stringify(unitsField)}`);
  }
  return [
    `new openehr_rm.${rmType}({ ${parts.join(", ")} })`,
    Order.NEW,
  ];
}

/** Toolbox entries for concrete DATA_VALUE leaves. */
export function dataValueToolboxContents(): Array<{ kind: string; type: string }> {
  return dataValueLeafTypes().map((rmType) => ({
    kind: "block",
    type: blockTypeForRm(rmType),
  }));
}
