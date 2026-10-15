/**
 * Keep Blockly Decision table eval/decl sites in lockstep with the grid document.
 * The document owns column names and count; Blockly Map keys and OUTPUT options follow.
 */
import type { Block, Connection, Workspace } from "blockly/core";
import {
  alignMapKeys,
  conditionHeaders,
  isDecisionTable,
  setDecisionHeader,
  type SheetDocument,
} from "../core/sheets/mod.ts";
import {
  applyDecisionTableOutputType,
  DECISION_TABLE_BLOCK,
  isDecisionTableSchemaSyncing,
  runDecisionTableSchemaSync,
} from "./blocks/decision_table_blocks.ts";
import { SHEET_ACCESSOR_TYPES } from "./blocks/sheet_blocks.ts";
import { workspaceSheet } from "./sheets_bridge.ts";

type MapCreateBlock = Block & {
  itemCount_: number;
  updateShape_: () => void;
};

export function syncDecisionTableBlocksFromSheets(
  workspace: Workspace,
  sheets: SheetDocument[],
): void {
  runDecisionTableSchemaSync(() => {
    for (const block of workspace.getAllBlocks(false)) {
      if (block.type !== DECISION_TABLE_BLOCK) continue;
      const name = String(block.getFieldValue("NAME") || "");
      const sheet = sheets.find((s) => s.name === name && isDecisionTable(s));
      if (!sheet) continue;
      bindLocalsMap(block, sheet);
      // Leave OUTPUT as the author chose it. Rewriting a missing header to the
      // first output column would retarget a renamed column and put a field
      // edit on the undo stack above the sheet edit that deleted it.
      applyDecisionTableOutputType(block);
      const outputField = block.getField("OUTPUT") as { forceRerender?: () => void } | null;
      outputField?.forceRerender?.();
    }
  });
}

function bindLocalsMap(block: Block, sheet: SheetDocument): void {
  const map = block.getInputTargetBlock("INPUTS") as MapCreateBlock | null;
  if (!map || map.type !== "maps_create_with" || typeof map.updateShape_ !== "function") return;
  const newKeys = conditionHeaders(sheet);
  const oldKeys: string[] = [];
  for (let i = 0; i < (map.itemCount_ ?? 0); i++) {
    oldKeys.push(String(map.getFieldValue(`KEY${i}`) ?? ""));
  }
  const mapping = alignMapKeys(oldKeys, newKeys);
  const saved: Array<Connection | null> = [];
  for (let i = 0; i < oldKeys.length; i++) {
    saved.push(map.getInput(`VAL${i}`)?.connection?.targetConnection ?? null);
  }
  map.itemCount_ = newKeys.length;
  map.updateShape_();
  for (let i = 0; i < newKeys.length; i++) {
    map.setFieldValue(newKeys[i]!, `KEY${i}`);
    const oldIndex = mapping[i];
    const conn = oldIndex == null ? null : saved[oldIndex];
    const input = map.getInput(`VAL${i}`)?.connection;
    if (conn && input && !input.isConnected()) {
      try {
        input.connect(conn);
      } catch {
        // incompatible leftover
      }
    }
  }
}

/**
 * Blockly field edits that write back to the Decision table document.
 * Returns a new sheets array, or null if nothing changed.
 */
export function sheetsFromDecisionTableBlockEdit(
  workspace: Workspace,
  sheets: SheetDocument[],
  event: { type?: string; name?: string; blockId?: string; oldValue?: string; newValue?: string },
): SheetDocument[] | null {
  if (isDecisionTableSchemaSyncing()) return null;
  if (event.type !== "change" || !event.blockId) return null;
  const block = workspace.getBlockById(event.blockId);
  if (!block) return null;

  if (block.type === "maps_create_with" && event.name?.startsWith("KEY")) {
    const parent = block.outputConnection?.targetBlock();
    if (!parent || parent.type !== DECISION_TABLE_BLOCK) return null;
    const tableName = String(parent.getFieldValue("NAME") || "");
    const sheet = sheets.find((s) => s.name === tableName);
    if (!sheet || !isDecisionTable(sheet)) return null;
    const index = Number(event.name.slice(3));
    const cond = conditionHeaders(sheet);
    if (index < 0 || index >= cond.length) return null;
    const headerIndex = sheet.headers.indexOf(cond[index]!);
    if (headerIndex < 0) return null;
    const next = setDecisionHeader(sheet, headerIndex, String(event.newValue ?? ""));
    if (next.headers[headerIndex] === sheet.headers[headerIndex]) return null;
    return sheets.map((s) => s.name === tableName ? next : s);
  }

  return null;
}

export function installDecisionTableSync(
  workspace: Workspace,
  getSheets: () => SheetDocument[],
  replaceSheets: (sheets: SheetDocument[]) => void,
): () => void {
  const listener = (event: { type?: string; name?: string; blockId?: string; oldValue?: string; newValue?: string }) => {
    if (isDecisionTableSchemaSyncing()) return;
    const next = sheetsFromDecisionTableBlockEdit(workspace, getSheets(), event);
    if (next) {
      replaceSheets(next);
      syncDecisionTableBlocksFromSheets(workspace, next);
      return;
    }
    if (event.type === "change" && event.name === "NAME") {
      syncDecisionTableBlocksFromSheets(workspace, getSheets());
    }
    if (event.type === "change" && event.name === "OUTPUT") {
      const block = event.blockId ? workspace.getBlockById(event.blockId) : null;
      if (block?.type === DECISION_TABLE_BLOCK) applyDecisionTableOutputType(block);
    }
  };
  workspace.addChangeListener(listener);
  return () => workspace.removeChangeListener(listener);
}

function refersToGrid(type: string): boolean {
  return type === DECISION_TABLE_BLOCK ||
    (SHEET_ACCESSOR_TYPES as readonly string[]).includes(type);
}

/** After a grid rename, update Blockly NAME fields that still use `from`. */
export function retargetGridNames(
  workspace: Workspace,
  from: string,
  to: string,
): void {
  const next = to.trim();
  if (!from || !next || from === next) return;
  runDecisionTableSchemaSync(() => {
    for (const block of workspace.getAllBlocks(false)) {
      if (!refersToGrid(block.type)) continue;
      if (String(block.getFieldValue("NAME") || "") !== from) continue;
      block.setFieldValue(next, "NAME");
      if (block.type === DECISION_TABLE_BLOCK) applyDecisionTableOutputType(block);
    }
  });
}

/** After a grid delete, leave referring blocks on the canvas with no name selected. */
export function clearGridNames(workspace: Workspace, name: string): void {
  if (!name) return;
  runDecisionTableSchemaSync(() => {
    for (const block of workspace.getAllBlocks(false)) {
      if (!refersToGrid(block.type)) continue;
      if (String(block.getFieldValue("NAME") || "") !== name) continue;
      block.setFieldValue("", "NAME");
      if (block.type === DECISION_TABLE_BLOCK) applyDecisionTableOutputType(block);
    }
  });
}

export function sheetForEvalBlock(block: Block): SheetDocument | undefined {
  return workspaceSheet(String(block.getFieldValue("NAME") || ""));
}
