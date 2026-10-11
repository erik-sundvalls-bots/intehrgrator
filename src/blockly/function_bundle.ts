/**
 * Extract / merge a Function bundle against a live Blockly workspace.
 */

import { Blockly } from "./blockly_core.ts";
import { cloneSheet } from "../core/sheets/model.ts";
import type { SheetDocument } from "../core/sheets/types.ts";
import {
  applyClashPolicy,
  type FunctionBundle,
  type FunctionClashPolicy,
  type MergeFunctionResult,
} from "../core/function_library/mod.ts";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import {
  asWorkspaceJson,
  offsetTopBlocks,
  isProcedureDefType,
  procedureDefName,
  procedureHasReturn,
  procedureParamNames,
  referencedGridNames,
  remapWorkspaceIds,
  renameVariableNameInState,
  topBlocks,
  uniqueIdentifier,
  usedVariables,
  type BlocklyBlockJson,
  type BlocklyWorkspaceJson,
} from "../core/function_library/blockly_json.ts";
import { FUNCTION_BUNDLE_KIND, FUNCTION_BUNDLE_VERSION } from "../core/function_library/types.ts";

export interface ExtractFunctionMeta {
  description?: string;
  locale?: string;
  returns?: string;
}

export interface MergeFunctionOptions {
  clash: FunctionClashPolicy;
  sheets: SheetDocument[];
}

function ensureEnLocale(): void {
  ensureStockBlocklyMessages();
}

export function listWorkspaceFunctions(workspace: Blockly.Workspace): Array<{
  name: string;
  parameters: string[];
  hasReturn: boolean;
}> {
  const out: Array<{ name: string; parameters: string[]; hasReturn: boolean }> = [];
  for (const block of workspace.getTopBlocks(false)) {
    if (!isProcedureDefType(block.type)) {
      continue;
    }
    const name = String(block.getFieldValue("NAME") || "").trim();
    if (!name) continue;
    const saved = Blockly.serialization.blocks.save(block) as BlocklyBlockJson | null;
    out.push({
      name,
      parameters: saved ? procedureParamNames(saved) : [],
      hasReturn: procedureHasReturn(block.type),
    });
  }
  return out;
}

export function extractFunctionBundle(
  workspace: Blockly.Workspace,
  name: string,
  sheets: SheetDocument[],
  meta: ExtractFunctionMeta = {},
): FunctionBundle {
  ensureEnLocale();
  const def = workspace.getTopBlocks(false).find((block) =>
    isProcedureDefType(block.type) &&
    String(block.getFieldValue("NAME") || "") === name
  );
  if (!def) throw new Error(`No Blockly Function named "${name}" on the canvas`);
  const saved = Blockly.serialization.workspaces.save(workspace) as BlocklyWorkspaceJson;
  const defJson = topBlocks(saved).find((block) => procedureDefName(block) === name);
  if (!defJson) throw new Error(`Could not serialize Blockly Function "${name}"`);
  const gridNames = new Set(referencedGridNames({ blocks: { blocks: [defJson] } }));
  const decls = topBlocks(saved).filter((block) =>
    block.type === "decision_table_decl" &&
    typeof block.fields?.NAME === "string" &&
    gridNames.has(block.fields.NAME)
  );
  const fragment = [defJson, ...decls];
  const blocklyState: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: saved.blocks?.languageVersion ?? 0,
      blocks: structuredClone(fragment),
    },
    variables: usedVariables(saved, fragment),
  };
  const usedSheets = sheets.filter((sheet) => gridNames.has(sheet.name)).map(cloneSheet);
  return {
    kind: FUNCTION_BUNDLE_KIND,
    version: FUNCTION_BUNDLE_VERSION,
    name,
    description: meta.description ?? "",
    parameters: procedureParamNames(defJson),
    hasReturn: procedureHasReturn(def.type),
    returns: meta.returns ?? (procedureHasReturn(def.type) ? "String" : undefined),
    locale: meta.locale,
    decisionTables: [...gridNames],
    blocklyState: blocklyState as Record<string, unknown>,
    sheets: usedSheets,
  };
}

/** Headless extract: load Blockly JSON, then {@link extractFunctionBundle}. */
export function extractFunctionBundleFromState(
  blocklyState: unknown,
  name: string,
  sheets: SheetDocument[],
  meta: ExtractFunctionMeta = {},
): FunctionBundle {
  ensureEnLocale();
  const workspace = new Blockly.Workspace();
  try {
    if (blocklyState && typeof blocklyState === "object") {
      Blockly.serialization.workspaces.load(
        JSON.parse(JSON.stringify(blocklyState)) as Record<string, unknown>,
        workspace,
      );
    }
    return extractFunctionBundle(workspace, name, sheets, meta);
  } finally {
    workspace.dispose();
  }
}

/** Headless merge: load Blockly JSON, merge, return the next workspace snapshot. */
export function mergeFunctionBundleIntoState(
  blocklyState: unknown,
  sheets: SheetDocument[],
  bundle: FunctionBundle,
  clash: FunctionClashPolicy,
): MergeFunctionResult & { blocklyState: unknown } {
  ensureEnLocale();
  const workspace = new Blockly.Workspace();
  try {
    if (blocklyState && typeof blocklyState === "object") {
      Blockly.serialization.workspaces.load(
        JSON.parse(JSON.stringify(blocklyState)) as Record<string, unknown>,
        workspace,
      );
    }
    const result = mergeFunctionBundle(workspace, bundle, { clash, sheets });
    return { ...result, blocklyState: Blockly.serialization.workspaces.save(workspace) };
  } finally {
    workspace.dispose();
  }
}

export function mergeFunctionBundle(
  workspace: Blockly.Workspace,
  bundle: FunctionBundle,
  options: MergeFunctionOptions,
): MergeFunctionResult {
  ensureEnLocale();
  const current = Blockly.serialization.workspaces.save(workspace);
  const { bundle: next, clashes, warnings } = applyClashPolicy(
    current,
    options.sheets,
    bundle,
    options.clash,
  );
  if (options.clash === "replace") {
    for (const name of clashes.functions) disposeProcedure(workspace, name);
    for (const name of clashes.sheets) disposeGridDecl(workspace, name);
  }
  const incoming = structuredClone(asWorkspaceJson(next.blocklyState));
  uniquifyIncomingVariables(incoming, workspace, next.parameters);
  remapWorkspaceIds(incoming);
  offsetTopBlocks(incoming, 24, 24 + maxTopY(workspace));
  for (const variable of incoming.variables ?? []) {
    if (!variable.name) continue;
    if (workspace.getVariable(variable.name)) continue;
    workspace.createVariable(variable.name, variable.type || undefined, variable.id);
  }
  for (const block of incoming.blocks?.blocks ?? []) {
    Blockly.serialization.blocks.append(block as Record<string, unknown>, workspace);
  }
  const sheets = mergeSheets(options.sheets, next.sheets, options.clash);
  return { name: next.name, renamedFrom: next.name === bundle.name ? undefined : bundle.name, sheets, clashes, warnings };
}

function uniquifyIncomingVariables(
  state: BlocklyWorkspaceJson,
  workspace: Blockly.Workspace,
  parameters: string[],
): void {
  const params = new Set(parameters);
  const taken = new Set(workspace.getAllVariables().map((variable) => variable.name));
  for (const variable of [...(state.variables ?? [])]) {
    if (!variable.name || params.has(variable.name) || !taken.has(variable.name)) {
      if (variable.name) taken.add(variable.name);
      continue;
    }
    const renamed = uniqueIdentifier(variable.name, taken);
    taken.add(renamed);
    renameVariableNameInState(state, variable.name, renamed);
  }
}

function mergeSheets(
  existing: SheetDocument[],
  incoming: SheetDocument[],
  policy: FunctionClashPolicy,
): SheetDocument[] {
  const next = existing.map(cloneSheet);
  for (const sheet of incoming) {
    const index = next.findIndex((row) => row.name === sheet.name);
    if (index >= 0) {
      if (policy === "replace") next[index] = cloneSheet(sheet);
    } else {
      next.push(cloneSheet(sheet));
    }
  }
  return next;
}

function disposeProcedure(workspace: Blockly.Workspace, name: string): void {
  for (const block of workspace.getTopBlocks(false)) {
    if (
      isProcedureDefType(block.type) &&
      String(block.getFieldValue("NAME") || "") === name
    ) {
      block.dispose(false);
    }
  }
}

function disposeGridDecl(workspace: Blockly.Workspace, name: string): void {
  for (const block of workspace.getTopBlocks(false)) {
    if (
      (block.type === "decision_table_decl" || block.type === "sheet") &&
      String(block.getFieldValue("NAME") || "") === name
    ) {
      block.dispose(false);
    }
  }
}

function maxTopY(workspace: Blockly.Workspace): number {
  let max = 0;
  for (const block of workspace.getTopBlocks(false)) {
    const xy = typeof block.getRelativeToSurfaceXY === "function"
      ? block.getRelativeToSurfaceXY()
      : { x: 0, y: 0 };
    max = Math.max(max, xy.y ?? 0);
  }
  return max;
}
