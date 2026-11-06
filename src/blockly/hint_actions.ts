/**
 * Apply a value-set hint action on a Blockly workspace.
 * The Hints tab and MCP `apply_hint` both call this.
 */
import type { Block, Workspace } from "blockly/core";
import { initBlocklyGenerators } from "./mod.ts";
import {
  applyOrdinalFieldsToDataValueShell,
  connectExpressionToDataValueShell,
  dvFieldInputName,
  ensureDvFieldVisible,
  ensureElementDataValueShell,
  ensureRmBlockType,
  isDataValueBlock,
} from "./blocks/rm_blocks.ts";
import { createTermPickBlock } from "./blocks/term_pick.ts";
import { DECISION_TABLE_BLOCK, registerDecisionTableBlocks } from "./blocks/decision_table_blocks.ts";
import { registerSheetBlocks, SHEET_LOOKUP } from "./blocks/sheet_blocks.ts";
import { registerMapBlocks } from "./blocks/map_blocks.ts";
import { blockTypeForRm } from "../core/rm_meta.ts";
import { termSetForMandatedCode } from "../core/openehr_term_catalog.ts";
import type { MappingModel, ProjectSettings, SkeletonNode } from "../types/mod.ts";
import type { SheetDocument } from "../core/sheets/types.ts";
import {
  clearHintMemory,
  collectValueSetHints,
  dismissHint,
  hintFillPrompt,
  planHintGrid,
  restoreHints,
  subsetHint,
  type ValueSetHint,
  type ValueSetHintAction,
  type ValueSetHintCode,
} from "../core/hints/value_set_hint.ts";

export interface ApplyValueSetHintRequest {
  slotId?: string;
  action: ValueSetHintAction;
  /** Subset codes, or the one code for "use as constant". */
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

function connectRealText(workspace: Workspace, parent: Block, inputName: string, value: string): void {
  const text = workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  connectOutput(parent, inputName, text);
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

function shellFor(workspace: Workspace, host: Block, rmType: string): Block | null {
  if (host.type === "element") return ensureElementDataValueShell(workspace, host, rmType);
  if (isDataValueBlock(host)) return host;
  return ensureElementDataValueShell(workspace, host, rmType);
}

function showField(shell: Block, name: string): void {
  ensureDvFieldVisible(shell, name);
  (shell as Block & { updateDvFields_?: () => void }).updateDvFields_?.();
}

function placeOnPrimary(workspace: Workspace, host: Block, rmType: string, expr: Block): void {
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

function placeTermPick(_workspace: Workspace, host: Block, pick: Block): void {
  if (host.type === "element" || host.getInput("VALUE")) {
    connectOutput(host, "VALUE", pick);
    return;
  }
  const parent = host.outputConnection?.targetConnection ?? null;
  if (!parent || !pick.outputConnection) return;
  host.dispose(false);
  try {
    parent.connect(pick.outputConnection);
  } catch {
    /* type check rejected */
  }
}

function fillCodedShell(
  workspace: Workspace,
  shell: Block,
  item: ValueSetHintCode,
): void {
  const rm = String(shell.getFieldValue("RM_TYPE") || "");
  if (rm === "CODE_PHRASE" || shell.type === "code_phrase") {
    showField(shell, "terminology_id");
    showField(shell, "code_string");
    if (item.terminologyId) connectRealText(workspace, shell, dvFieldInputName("terminology_id"), item.terminologyId);
    connectRealText(workspace, shell, dvFieldInputName("code_string"), item.code);
    return;
  }
  showField(shell, "value");
  connectRealText(workspace, shell, dvFieldInputName("value"), item.text || item.code);
  showField(shell, "defining_code");
  ensureRmBlockType("code_phrase", "CODE_PHRASE");
  const phrase = workspace.newBlock("code_phrase");
  if (phrase.getField("RM_TYPE")) phrase.setFieldValue("CODE_PHRASE", "RM_TYPE");
  connectOutput(shell, dvFieldInputName("defining_code"), phrase);
  if (item.terminologyId) {
    showField(phrase, "terminology_id");
    connectRealText(workspace, phrase, dvFieldInputName("terminology_id"), item.terminologyId);
  }
  showField(phrase, "code_string");
  connectRealText(workspace, phrase, dvFieldInputName("code_string"), item.code);
}

function chosenCode(hint: ValueSetHint, codes: string[] | undefined): ValueSetHintCode {
  const wanted = codes?.find((code) => hint.codes.some((item) => item.code === code)) ??
    hint.assumed ??
    hint.codes[0]?.code;
  const item = hint.codes.find((row) => row.code === wanted) ?? hint.codes[0];
  if (!item) throw new Error(`Value-set hint ${hint.slotId} has no codes`);
  return item;
}

function textBlock(workspace: Workspace, value: string): Block {
  const text = workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  return text;
}

function sourceMap(workspace: Workspace, sourceColumn: string): Block {
  registerMapBlocks();
  const map = workspace.newBlock("maps_create_with") as MapCreateBlock;
  map.itemCount_ = 1;
  map.updateShape_();
  map.setFieldValue(sourceColumn, "KEY0");
  return map;
}

function decisionBlock(workspace: Workspace, name: string, output: string, sourceColumn: string): Block {
  registerDecisionTableBlocks();
  const block = workspace.newBlock(DECISION_TABLE_BLOCK);
  block.setFieldValue(name, "NAME");
  block.setFieldValue(output, "OUTPUT");
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
  connectOutput(block, "MATCH_COL", textBlock(workspace, sourceColumn));
  // A blank match would equal the blank source cells and return the first code.
  connectOutput(block, "MATCH_VAL", textBlock(workspace, "…"));
  connectOutput(block, "RETURN_COL", textBlock(workspace, output));
  return block;
}

function requireHint(hints: ValueSetHint[], slotId: string | undefined): ValueSetHint {
  if (!slotId) throw new Error("apply_hint requires slotId");
  const hint = hints.find((row) => row.slotId === slotId);
  if (!hint) throw new Error(`No value-set hint for ${slotId}`);
  return hint;
}

function placeGrid(
  workspace: Workspace,
  hint: ValueSetHint,
  expr: Block,
): void {
  const host = findHost(workspace, hint.slotId);
  if (!host) throw new Error(`No canvas block for ${hint.slotId}`);
  if (hint.kind === "units") placeOnUnits(workspace, host, expr);
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
    const summary = request.slotId ? `Restore value-set hint ${request.slotId}` : "Restore dismissed value-set hints";
    return { settings: next, sheets, summary, ...(request.slotId ? { slotId: request.slotId } : {}) };
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
  if (action === "subset") {
    return {
      settings: subsetHint(settings, hint, request.codes ?? []),
      sheets,
      summary: `Pick value-set subset ${hint.label}`,
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
        const pick = createTermPickBlock(workspace, set, item.code, hint.slotId);
        placeTermPick(workspace, host, pick);
      } else {
        const rm = hint.rmType === "CODE_PHRASE" ? "CODE_PHRASE" : "DV_CODED_TEXT";
        const shell = shellFor(workspace, host, rm);
        if (!shell) throw new Error(`No value shell for ${hint.slotId}`);
        if (shell.getField("RM_TYPE")) shell.setFieldValue(rm, "RM_TYPE");
        const blockType = rm === "CODE_PHRASE" ? "code_phrase" : blockTypeForRm(rm);
        ensureRmBlockType(blockType, rm);
        fillCodedShell(workspace, shell, item);
      }
    } else if (hint.kind === "ordinal") {
      const shell = shellFor(workspace, host, hint.rmType);
      if (!shell) throw new Error(`No value shell for ${hint.slotId}`);
      applyOrdinalFieldsToDataValueShell(workspace, shell, {
        value: String(item.value ?? ""),
        symbol_value: item.text,
        terminology_id: item.terminologyId ?? "local",
        defining_code: item.code,
        code_string: item.code,
      });
    } else if (hint.kind === "units") {
      placeOnUnits(workspace, host, textBlock(workspace, item.code));
    } else {
      const shell = shellFor(workspace, host, hint.rmType || "DV_TEXT");
      if (!shell) throw new Error(`No value shell for ${hint.slotId}`);
      showField(shell, "value");
      connectRealText(workspace, shell, dvFieldInputName("value"), item.text || item.code);
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
    const expr = action === "decision_table"
      ? decisionBlock(workspace, plan.name, plan.outputColumn, plan.sourceColumn)
      : lookupBlock(workspace, plan.name, plan.sourceColumn, plan.outputColumn);
    placeGrid(workspace, hint, expr);
    return {
      settings: clearHintMemory(settings, hint.slotId),
      sheets: [...sheets, plan.sheet],
      summary: action === "decision_table"
        ? `Decision table ${plan.name} for ${hint.label}`
        : `Sheet lookup ${plan.name} for ${hint.label}`,
      slotId: hint.slotId,
      grid: { name: plan.name, kind: plan.kind, prompt: hintFillPrompt(hint, plan) },
    };
  }
  throw new Error(`Unknown hint action: ${action}`);
}
