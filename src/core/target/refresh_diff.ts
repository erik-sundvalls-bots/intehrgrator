/**
 * Non-destructive target / source refresh: compare the previous and next trees
 * and warn about mappings that may no longer fit (#140).
 */
import type { SchemaTreeNode, SkeletonNode } from "../../types/mod.ts";
import { NOTES_CONVENTION } from "../ai/response_notes.ts";

export interface RefreshWarning {
  kind: "removed-slot" | "type-change" | "new-slot" | "removed-path" | "new-path";
  path: string;
  message: string;
  previous?: string;
  next?: string;
}

export interface RefreshDiffReport {
  kind: "target" | "source";
  previousFilename: string;
  nextFilename: string;
  warnings: RefreshWarning[];
  previousContent?: string;
  nextContent?: string;
}

function collectSkeletonSlots(
  nodes: SkeletonNode[],
  out = new Map<string, SkeletonNode>(),
): Map<string, SkeletonNode> {
  for (const node of nodes) {
    out.set(node.slotId, node);
    if (node.children.length) collectSkeletonSlots(node.children, out);
  }
  return out;
}

function collectSchemaPaths(
  nodes: SchemaTreeNode[] | SchemaTreeNode | null | undefined,
  out = new Set<string>(),
): Set<string> {
  if (!nodes) return out;
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of list) {
    if (node.path) out.add(node.path);
    if (node.children?.length) collectSchemaPaths(node.children, out);
  }
  return out;
}

export function diffTargetRefresh(options: {
  previousSkeleton: SkeletonNode[];
  nextSkeleton: SkeletonNode[];
  mappedSlotIds: readonly string[];
  previousFilename: string;
  nextFilename: string;
  previousContent?: string;
  nextContent?: string;
}): RefreshDiffReport {
  const previous = collectSkeletonSlots(options.previousSkeleton);
  const next = collectSkeletonSlots(options.nextSkeleton);
  const mapped = new Set(options.mappedSlotIds.filter(Boolean));
  const warnings: RefreshWarning[] = [];
  for (const slotId of mapped) {
    if (!previous.has(slotId)) continue;
    if (!next.has(slotId)) {
      warnings.push({
        kind: "removed-slot",
        path: slotId,
        message: `Mapped slot ${slotId} is missing from the refreshed target. The Blockly on the canvas is left in place (detached if it no longer fits).`,
      });
      continue;
    }
    const before = previous.get(slotId)!;
    const after = next.get(slotId)!;
    if (before.rmType && after.rmType && before.rmType !== after.rmType) {
      warnings.push({
        kind: "type-change",
        path: slotId,
        previous: before.rmType,
        next: after.rmType,
        message: `Slot ${slotId} changed type ${before.rmType} → ${after.rmType}.`,
      });
    }
  }
  for (const [slotId, node] of next) {
    if (previous.has(slotId)) continue;
    if (!node.mandatory) continue;
    warnings.push({
      kind: "new-slot",
      path: slotId,
      message: `New mandatory slot ${slotId} (${node.rmType || node.blockType}). Pull it from Target schema or Apply default context map.`,
    });
  }
  return {
    kind: "target",
    previousFilename: options.previousFilename,
    nextFilename: options.nextFilename,
    warnings,
    previousContent: options.previousContent,
    nextContent: options.nextContent,
  };
}

export function diffSourceRefresh(options: {
  previousTree: SchemaTreeNode | null;
  nextTree: SchemaTreeNode | null;
  mappedPaths: readonly string[];
  previousFilename: string;
  nextFilename: string;
  previousContent?: string;
  nextContent?: string;
}): RefreshDiffReport {
  const previous = collectSchemaPaths(options.previousTree);
  const next = collectSchemaPaths(options.nextTree);
  const warnings: RefreshWarning[] = [];
  for (const path of options.mappedPaths) {
    if (!path) continue;
    if (pathExists(next, path)) continue;
    if (!pathExists(previous, path)) continue;
    warnings.push({
      kind: "removed-path",
      path,
      message: `Mapped source path ${path} is not in the refreshed schema. Source query blocks stay on the canvas so you can retarget them.`,
    });
  }
  for (const path of next) {
    if (previous.has(path)) continue;
    warnings.push({
      kind: "new-path",
      path,
      message: `New source path ${path} is available in the refreshed schema.`,
    });
  }
  return {
    kind: "source",
    previousFilename: options.previousFilename,
    nextFilename: options.nextFilename,
    warnings,
    previousContent: options.previousContent,
    nextContent: options.nextContent,
  };
}

/** JSONPath `$` / XML `/` are roots: they do not mean every descendant exists. */
function normalizeIndexedPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, "[*]");
}

function pathExists(paths: Set<string>, wanted: string): boolean {
  if (!wanted) return false;
  if (paths.has(wanted)) return true;
  const wantedNorm = normalizeIndexedPath(wanted);
  for (const path of paths) {
    if (path === wanted) return true;
    if (normalizeIndexedPath(path) === wantedNorm) return true;
  }
  return false;
}

export function mappedSourcePathsFromExpressions(expressions: readonly string[]): string[] {
  const out: string[] = [];
  for (const expression of expressions) {
    if (!expression) continue;
    for (const match of expression.matchAll(
      /xpath(?:String|Number|Boolean|Node)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
    )) {
      if (match[1]) out.push(match[1]);
    }
    for (const match of expression.matchAll(/["'`](\$(?:\.[^"'`]+)?|\/[^"'`]+)["'`]/g)) {
      const path = match[1];
      if (path && (path.startsWith("$") || path.startsWith("/")) && !out.includes(path)) {
        out.push(path);
      }
    }
  }
  return out;
}

export function formatRefreshReport(report: RefreshDiffReport): string {
  if (!report.warnings.length) {
    return `Refreshed ${report.kind} ${report.nextFilename} with no mapping conflicts.`;
  }
  const lines = [
    `Refreshed ${report.kind} ${report.previousFilename} → ${report.nextFilename}`,
    `${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}:`,
    ...report.warnings.map((warning) => `• ${warning.message}`),
  ];
  return lines.join("\n");
}

/** Raw files ride along only when both fit; otherwise the structured warnings are the diff (#252). */
export const REFRESH_MERGE_RAW_LIMIT_CHARS = 12_000;
/** At most this many warnings are listed; the rest are counted. */
export const REFRESH_MERGE_MAX_WARNINGS = 200;

export function buildRefreshMergePrompt(report: RefreshDiffReport): string {
  const listed = report.warnings.slice(0, REFRESH_MERGE_MAX_WARNINGS);
  const more = report.warnings.length - listed.length;
  const body = [
    `The informatician refreshed a ${report.kind} in intEHRgrator and needs help merging.`,
    `Previous file: ${report.previousFilename}`,
    `New file: ${report.nextFilename}`,
    "",
    "Warnings (structured diff):",
    ...(listed.length ? listed.map((warning) => `- ${warning.message}`) : ["- none"]),
    ...(more > 0 ? [`- … ${more} more warnings not listed`] : []),
    "",
    "Detached Blockly that no longer fits stays on the canvas; do not delete mappings unless the user asks.",
    "Return intehrgrator-suggestions JSON (version 2) only for slots that must be rewired.",
    "See docs/AI_SUGGESTION_FORMAT.md.",
    NOTES_CONVENTION,
  ];
  const prev = report.previousContent ?? "";
  const next = report.nextContent ?? "";
  if (prev.length <= REFRESH_MERGE_RAW_LIMIT_CHARS && next.length <= REFRESH_MERGE_RAW_LIMIT_CHARS) {
    if (prev) body.push("", `--- previous ${report.kind} ---`, prev);
    if (next) body.push("", `--- new ${report.kind} ---`, next);
  } else {
    body.push(
      "",
      `Raw files omitted (${prev.length} and ${next.length} characters; limit ${REFRESH_MERGE_RAW_LIMIT_CHARS} each). The warnings above are the diff; ask for a specific part if you need it.`,
    );
  }
  return body.join("\n");
}
