/**
 * Apply a value-set hint action on a Blockly workspace.
 * The Hints tab and MCP `apply_hint` both call this.
 */
import { Blockly } from "./blockly_core.ts";
import type { Block, Workspace } from "blockly/core";
import { initBlocklyGenerators } from "./mod.ts";
import {
  connectExpressionToDataValueShell,
  dvFieldInputName,
  ensureDvFieldVisible,
  ensureElementDataValueShell,
  isDataValueBlock,
} from "./blocks/rm_blocks.ts";
import { createTermPickBlock } from "./blocks/term_pick.ts";
import {
  applyDecisionTableOutputType,
  DECISION_TABLE_BLOCK,
  registerDecisionTableBlocks,
  runDecisionTableSchemaSync,
} from "./blocks/decision_table_blocks.ts";
import { registerSheetBlocks, SHEET_LOOKUP } from "./blocks/sheet_blocks.ts";
import { registerMapBlocks } from "./blocks/map_blocks.ts";
import rowFunctionJson from "../../function-library/coded_value_from_row.intehr-function.json" with {
  type: "json",
};
import { functionBundleFromUnknown } from "../core/function_library/bundle.ts";
import { blockToExpression } from "./expression_serialize.ts";
import { functionStatements } from "./function_statements.ts";
import { mergeFunctionBundle } from "./function_bundle.ts";
import { DECISION_ALL_OUTPUTS } from "../core/sheets/decision_table.ts";
import { termSetForMandatedCode } from "../core/openehr_term_catalog.ts";
import type {
  MappingModel,
  ProjectSettings,
  SkeletonNode,
} from "../types/mod.ts";
import type { SheetDocument } from "../core/sheets/types.ts";
import {
  clearHintMemory,
  collectValueSetHints,
  dismissHint,
  hintFillPrompt,
  planHintGrid,
  restoreHints,
  type ValueSetHint,
  type ValueSetHintAction,
  type ValueSetHintCode,
} from "../core/hints/value_set_hint.ts";

export interface ApplyValueSetHintRequest {
  slotId?: string;
  action: ValueSetHintAction;
  /** Selected codes for grids, or the one code for "use as constant". */
  codes?: string[];
}

export interface ApplyValueSetHintResult {
  settings: ProjectSettings;
  sheets: SheetDocument[];
  summary: string;
  slotId?: string;
  /** Grid the interactive UI may offer to fill. MCP does not surface a prompt. */
  grid?: { name: string; kind: "decision-table" | "sheet"; prompt: string };
}

type MapCreateBlock = Block & { itemCount_: number; updateShape_: () => void };

/** newBlock() alone only creates the model, even on a rendered workspace. */
function finalizeBlock<T extends Block>(block: T): T {
  const svg = block as Block & { initSvg?: () => void; render?: () => void };
  svg.initSvg?.();
  svg.render?.();
  return block;
}

function connectOutput(parent: Block, inputName: string, child: Block): void {
  const input = parent.getInput(inputName);
  if (!input?.connection || !child.outputConnection) return;
  const existing = input.connection.targetBlock();
  if (existing && existing.id !== child.id) existing.dispose(false);
  const attempt = () => {
    if (!input.connection || !child.outputConnection) return;
    if (input.connection.targetConnection !== child.outputConnection) {
      input.connection.connect(child.outputConnection);
    }
  };
  try {
    attempt();
  } catch {
    const prev = input.connection.getCheck();
    input.setCheck(null);
    try {
      attempt();
    } catch {
      /* still incompatible */
    } finally {
      if (prev) input.setCheck(prev);
    }
  }
}

function connectRealText(
  workspace: Workspace,
  parent: Block,
  inputName: string,
  value: string,
): void {
  const text = workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  connectOutput(parent, inputName, finalizeBlock(text));
}

function findHosts(workspace: Workspace, slotId: string): Block[] {
  const matches: Block[] = [];
  for (const block of workspace.getAllBlocks(false)) {
    let id = "";
    try {
      id = String(block.getFieldValue("SLOT_ID") ?? "");
    } catch {
      id = "";
    }
    if (id === slotId) matches.push(block);
  }
  return matches;
}

function findHost(workspace: Workspace, slotId: string): Block | null {
  const matches = findHosts(workspace, slotId);
  return matches.find((block) => block.type === "element") ??
    matches.find((block) => isDataValueBlock(block)) ??
    matches[0] ??
    null;
}

function shellFor(
  workspace: Workspace,
  host: Block,
  rmType: string,
): Block | null {
  if (host.type === "element") {
    return ensureElementDataValueShell(workspace, host, rmType);
  }
  if (isDataValueBlock(host)) return host;
  return ensureElementDataValueShell(workspace, host, rmType);
}

function showField(shell: Block, name: string): void {
  ensureDvFieldVisible(shell, name);
  (shell as Block & { updateDvFields_?: () => void }).updateDvFields_?.();
}

function placeOnPrimary(
  workspace: Workspace,
  host: Block,
  rmType: string,
  expr: Block,
): void {
  const shell = shellFor(workspace, host, rmType);
  if (!shell) return;
  connectExpressionToDataValueShell(shell, expr);
}

function placeOnUnits(workspace: Workspace, host: Block, expr: Block): void {
  const shell = shellFor(workspace, host, "DV_QUANTITY");
  if (!shell) return;
  showField(shell, "units");
  connectOutput(shell, dvFieldInputName("units"), expr);
}

function placeCompleteValue(
  _workspace: Workspace,
  host: Block,
  pick: Block,
): void {
  if (host.type === "element" || host.getInput("VALUE")) {
    connectOutput(host, "VALUE", pick);
    return;
  }
  const parent = host.outputConnection?.targetConnection ?? null;
  if (!parent || !pick.outputConnection) return;
  const slotId = String(host.getFieldValue("SLOT_ID") ?? "");
  if (slotId && pick.getField("SLOT_ID")) {
    pick.setFieldValue(slotId, "SLOT_ID");
    pick.setFieldValue(String(host.getFieldValue("RM_TYPE") ?? ""), "RM_TYPE");
  }
  host.dispose(false);
  try {
    parent.connect(pick.outputConnection);
  } catch {
    /* type check rejected */
  }
}

function chosenCode(
  hint: ValueSetHint,
  codes: string[] | undefined,
): ValueSetHintCode {
  const wanted =
    codes?.find((code) => hint.codes.some((item) => item.code === code)) ??
      hint.assumed ??
      hint.codes[0]?.code;
  const item = hint.codes.find((row) => row.code === wanted) ?? hint.codes[0];
  if (!item) throw new Error(`Value-set hint ${hint.slotId} has no codes`);
  return item;
}

function textBlock(workspace: Workspace, value: string): Block {
  const text = workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  return finalizeBlock(text);
}

function sourceMap(workspace: Workspace, sourceColumn: string): Block {
  registerMapBlocks();
  const map = workspace.newBlock("maps_create_with") as MapCreateBlock;
  map.itemCount_ = 1;
  map.updateShape_();
  map.setFieldValue(sourceColumn, "KEY0");
  return finalizeBlock(map);
}

function decisionBlock(
  workspace: Workspace,
  name: string,
  output: string,
  sourceColumn: string,
): Block {
  registerDecisionTableBlocks();
  const block = workspace.newBlock(DECISION_TABLE_BLOCK);
  block.setFieldValue(name, "NAME");
  runDecisionTableSchemaSync(() => block.setFieldValue(output, "OUTPUT"));
  applyDecisionTableOutputType(block);
  finalizeBlock(block);
  const map = sourceMap(workspace, sourceColumn);
  connectOutput(block, "INPUTS", map);
  return block;
}

function lookupBlock(
  workspace: Workspace,
  name: string,
  sourceColumn: string,
  output: string,
): Block {
  registerSheetBlocks();
  const block = workspace.newBlock(SHEET_LOOKUP);
  block.setFieldValue(name, "NAME");
  finalizeBlock(block);
  connectOutput(block, "MATCH_COL", textBlock(workspace, sourceColumn));
  // A blank match would equal the blank source cells and return the first code.
  connectOutput(block, "MATCH_VAL", textBlock(workspace, "…"));
  connectOutput(block, "RETURN_COL", textBlock(workspace, output));
  return block;
}

function requireHint(
  hints: ValueSetHint[],
  slotId: string | undefined,
): ValueSetHint {
  if (!slotId) throw new Error("apply_hint requires slotId");
  const hint = hints.find((row) => row.slotId === slotId);
  if (!hint) throw new Error(`No value-set hint for ${slotId}`);
  return hint;
}

function codedConstant(
  workspace: Workspace,
  hint: ValueSetHint,
  item: ValueSetHintCode,
): Block {
  const entries: Array<[string, Block]> = [
    ["code", textBlock(workspace, item.code)],
    ["rubric", textBlock(workspace, item.text || item.code)],
    ["terminology", textBlock(workspace, item.terminologyId ?? "local")],
  ];
  if (hint.kind === "ordinal") {
    const number = workspace.newBlock("math_number");
    number.setFieldValue(item.value ?? 0, "NUM");
    entries.push(["value", finalizeBlock(number)]);
  }
  const row = workspace.newBlock("maps_create_with") as MapCreateBlock;
  row.itemCount_ = entries.length;
  row.updateShape_();
  entries.forEach(([key, value], i) => {
    row.setFieldValue(key, `KEY${i}`);
    connectOutput(row, `VAL${i}`, value);
  });
  return completeCodedValue(workspace, finalizeBlock(row), hint.rmType);
}

/** One row expression, one ordinary Function call: no duplicated lookup/Map. */
function completeCodedValue(
  workspace: Workspace,
  row: Block,
  rmType: string,
): Block {
  const bundle = functionBundleFromUnknown(rowFunctionJson);
  // Never replace or silently reuse an unrelated end-user Function with this name.
  // Reuse an unmodified import; a customized definition gets a renamed import.
  const signature = (block: Block): string => {
    const params =
      (block as Block & { getProcedureDef: () => [string, string[], boolean] })
        .getProcedureDef()[1];
    return "hint-coded-value:" + JSON.stringify([
      params,
      blockToExpression(block.getInputTargetBlock("RETURN")),
      functionStatements(block.getInputTargetBlock("STACK")),
    ]);
  };
  const existing = workspace.getTopBlocks(false).find((block) => {
    if (
      block.type !== "procedures_defreturn" ||
      !block.data?.startsWith("hint-coded-value:")
    ) return false;
    try {
      return block.data === signature(block);
    } catch {
      return false;
    }
  });
  let name = existing ? String(existing.getFieldValue("NAME")) : bundle.name;
  if (!existing) {
    name =
      mergeFunctionBundle(workspace, bundle, { clash: "rename", sheets: [] })
        .name;
    const definition = workspace.getTopBlocks(false).find((block) =>
      block.type === "procedures_defreturn" &&
      String(block.getFieldValue("NAME")) === name
    );
    if (definition) definition.data = signature(definition);
  }
  const call = Blockly.serialization.blocks.append({
    type: "procedures_callreturn",
    extraState: { name, params: bundle.parameters },
  }, workspace) as Block;
  connectOutput(call, "ARG0", row);
  connectOutput(call, "ARG1", textBlock(workspace, rmType));
  return finalizeBlock(call);
}

function placeGrid(
  workspace: Workspace,
  hint: ValueSetHint,
  expr: Block,
): void {
  const host = findHost(workspace, hint.slotId);
  if (!host) throw new Error(`No canvas block for ${hint.slotId}`);
  if (hint.kind === "coded" || hint.kind === "ordinal") {
    placeCompleteValue(
      workspace,
      host,
      completeCodedValue(workspace, expr, hint.rmType),
    );
  } else if (hint.kind === "units") placeOnUnits(workspace, host, expr);
  else placeOnPrimary(workspace, host, hint.rmType, expr);
}

/**
 * Mutates `workspace` for actions that create blocks. Returns the next
 * settings and sheets. Does not offer or run an AI prompt.
 */
export function applyValueSetHint(
  workspace: Workspace,
  skeleton: SkeletonNode[],
  model: MappingModel,
  settings: ProjectSettings,
  sheets: SheetDocument[],
  request: ApplyValueSetHintRequest,
): ApplyValueSetHintResult {
  initBlocklyGenerators();
  const hints = collectValueSetHints(skeleton, model, settings);
  const action = request.action;
  if (action === "restore") {
    const next = restoreHints(settings, request.slotId);
    const summary = request.slotId
      ? `Restore value-set hint ${request.slotId}`
      : "Restore dismissed value-set hints";
    return {
      settings: next,
      sheets,
      summary,
      ...(request.slotId ? { slotId: request.slotId } : {}),
    };
  }
  const hint = requireHint(hints, request.slotId);
  if (action === "dismiss") {
    return {
      settings: dismissHint(settings, hint),
      sheets,
      summary: `Dismiss value-set hint ${hint.label}`,
      slotId: hint.slotId,
    };
  }
  if (action === "constant") {
    const item = chosenCode(hint, request.codes);
    const host = findHost(workspace, hint.slotId);
    if (!host) throw new Error(`No canvas block for ${hint.slotId}`);
    if (hint.kind === "coded") {
      const set = termSetForMandatedCode(item.terminologyId, item.code);
      if (set) {
        const pick = finalizeBlock(
          createTermPickBlock(workspace, set, item.code, hint.slotId),
        );
        placeCompleteValue(workspace, host, pick);
      } else {
        placeCompleteValue(
          workspace,
          host,
          codedConstant(workspace, hint, item),
        );
      }
    } else if (hint.kind === "ordinal") {
      placeCompleteValue(workspace, host, codedConstant(workspace, hint, item));
    } else if (hint.kind === "units") {
      placeOnUnits(workspace, host, textBlock(workspace, item.code));
    } else {
      const shell = shellFor(workspace, host, hint.rmType || "DV_TEXT");
      if (!shell) throw new Error(`No value shell for ${hint.slotId}`);
      showField(shell, "value");
      connectRealText(
        workspace,
        shell,
        dvFieldInputName("value"),
        item.text || item.code,
      );
    }
    return {
      settings: clearHintMemory(settings, hint.slotId),
      sheets,
      summary: `Use ${item.text || item.code} as constant on ${hint.label}`,
      slotId: hint.slotId,
    };
  }
  if (action === "decision_table" || action === "sheet_lookup") {
    const gridKind = action === "decision_table" ? "decision-table" : "sheet";
    const plan = planHintGrid(hint, sheets, gridKind);
    const coded = hint.kind === "coded" || hint.kind === "ordinal";
    const expr = action === "decision_table"
      ? decisionBlock(
        workspace,
        plan.name,
        coded ? DECISION_ALL_OUTPUTS : plan.outputColumn,
        plan.sourceColumn,
      )
      : lookupBlock(
        workspace,
        plan.name,
        plan.sourceColumn,
        coded ? "" : plan.outputColumn,
      );
    placeGrid(workspace, hint, expr);
    return {
      settings: clearHintMemory(settings, hint.slotId),
      sheets: [...sheets, plan.sheet],
      summary: action === "decision_table"
        ? `Decision table ${plan.name} for ${hint.label}`
        : `Sheet lookup ${plan.name} for ${hint.label}`,
      slotId: hint.slotId,
      grid: {
        name: plan.name,
        kind: plan.kind,
        prompt: hintFillPrompt(hint, plan),
      },
    };
  }
  throw new Error(`Unknown hint action: ${action}`);
}
