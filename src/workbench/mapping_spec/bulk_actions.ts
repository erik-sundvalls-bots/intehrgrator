import type { Block, Workspace } from "blockly/core";
import {
  blockConstraintMessages,
  isInNonMandatoryField,
  isProtectedSpecBlock,
  isUnmappedBlockTree,
  UNMAPPED_OPTIONAL_SCAFFOLD_WARNING,
} from "../../blockly/block_constraints.ts";
import { replaceCanvasUndoable } from "../../blockly/blockly_events.ts";
import type { BlocklyJsonDocument, SpecLine } from "./project.ts";

/** Wrapper aliases that belong to the row itself (not a folded ELEMENT value). */
function ownAliasIds(line: SpecLine): string[] {
  const folded = new Set(line.foldedIds ?? []);
  return (line.aliasIds ?? []).filter((id) => !folded.has(id));
}

function lineWarning(line: SpecLine, warnings: Record<string, string>): string | null {
  if (line.blockId && warnings[line.blockId]) return warnings[line.blockId] ?? null;
  for (const id of ownAliasIds(line)) {
    if (warnings[id]) return warnings[id] ?? null;
  }
  return null;
}

function lineAssociatedBlockIds(line: SpecLine): string[] {
  return [line.blockId, ...ownAliasIds(line)].filter((id): id is string => Boolean(id));
}

/** Optional unmapped scaffold tree eligible for bulk mark/delete. */
export function isOptionalUnmappedScaffoldBlock(block: Block, warning: string): boolean {
  if (isProtectedSpecBlock(block)) return false;
  if (!isInNonMandatoryField(block)) return false;
  if (!isUnmappedBlockTree(block)) return false;
  return warning.includes(UNMAPPED_OPTIONAL_SCAFFOLD_WARNING);
}

function ancestorBlockIds(workspace: Workspace, blockId: string): Set<string> {
  const block = workspace.getBlockById(blockId);
  if (!block) return new Set();
  const ancestors = new Set<string>();
  let current: Block | null = block;
  while (current) {
    const parent = current.getParent() ?? current.getSurroundParent?.() ?? null;
    if (!parent) break;
    ancestors.add(parent.id);
    current = parent;
  }
  return ancestors;
}

/** Top-level ids only — skip a block when an ancestor is also selected. */
export function topLevelBlockIds(workspace: Workspace, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    for (const ancestorId of ancestorBlockIds(workspace, id)) {
      if (set.has(ancestorId)) return false;
    }
    return true;
  });
}

/** Outermost workspace blocks that root an optional unmapped scaffold subtree. */
export function optionalUnmappedScaffoldRootIds(workspace: Workspace): Set<string> {
  const eligible = blocksEligibleForBulkMark(workspace);
  return new Set(topLevelBlockIds(workspace, eligible));
}

/** True when the block is a root or descendant of an optional unmapped scaffold tree. */
export function isWithinOptionalUnmappedScaffold(
  workspace: Workspace,
  blockId: string,
  roots: ReadonlySet<string> = optionalUnmappedScaffoldRootIds(workspace),
): boolean {
  if (roots.has(blockId)) return true;
  const block = workspace.getBlockById(blockId);
  if (!block) return false;
  let current: Block | null = block;
  while (current) {
    if (roots.has(current.id)) return true;
    current = current.getParent() ?? current.getSurroundParent?.() ?? null;
  }
  return false;
}

/**
 * Every mapping-spec row block id inside an optional unmapped scaffold subtree
 * that shows a constraint warning (root clusters, nested elements, units, …).
 */
export function specRowBlockIdsEligibleForBulkMark(
  workspace: Workspace,
  doc: BlocklyJsonDocument,
  warnings: Record<string, string>,
): string[] {
  const roots = optionalUnmappedScaffoldRootIds(workspace);
  if (!roots.size) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const widget of doc.widgets) {
    const line = widget.line;
    if (line.kind === "header" || !line.blockId) continue;
    // A folded ELEMENT value (DV block) can be optional scaffold on its own:
    // mark that block, not the ELEMENT that shares its row.
    for (const id of line.foldedIds ?? []) {
      if (!warnings[id] || seen.has(id)) continue;
      if (!isWithinOptionalUnmappedScaffold(workspace, id, roots)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (!lineWarning(line, warnings)) continue;
    const inSubtree = lineAssociatedBlockIds(line).some((id) =>
      isWithinOptionalUnmappedScaffold(workspace, id, roots)
    );
    if (!inSubtree) continue;
    if (seen.has(line.blockId)) continue;
    seen.add(line.blockId);
    ids.push(line.blockId);
  }
  return ids;
}

/** All workspace blocks eligible for bulk mark (includes nested trees). */
export function blocksEligibleForBulkMark(workspace: Workspace): string[] {
  const eligible: string[] = [];
  for (const block of workspace.getAllBlocks(false)) {
    if (typeof block.isShadow === "function" && block.isShadow()) continue;
    const warning = blockConstraintMessages(block).join("\n");
    if (!isOptionalUnmappedScaffoldBlock(block, warning)) continue;
    eligible.push(block.id);
  }
  return eligible;
}

/** Delete checked spec rows as one undoable canvas step; returns removed root ids. */
export function deleteMarkedSpecBlocks(
  workspace: Workspace,
  checkedIds: ReadonlySet<string>,
): string[] {
  const roots = topLevelBlockIds(
    workspace,
    [...checkedIds].filter((id) => {
      const block = workspace.getBlockById(id);
      return block && !isProtectedSpecBlock(block);
    }),
  );
  if (!roots.length) return [];
  replaceCanvasUndoable(workspace, () => {
    for (const id of roots) {
      workspace.getBlockById(id)?.dispose(true);
    }
  });
  return roots;
}

/** Drop stale checks after the canvas or spec projection changes. */
export function pruneCheckedBlockIds(
  workspace: Workspace,
  checkedIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of checkedIds) {
    if (workspace.getBlockById(id)) next.add(id);
  }
  return next;
}
