/**
 * Target schema tree: SkeletonNode → Source-pane-shaped rows, plus canvas drag MIME.
 *
 * Drag onto empty canvas is product recovery. Leaf → scaffold-target chip and
 * subtree → default-context-map value socket are handled by the web app drop path.
 */

import type { SchemaTreeNode, SkeletonNode } from "../types/mod.ts";
import { optionalSourceRmGaps } from "../core/source/rm_tree_disclosure.ts";
import {
  createOptionalRmToggle,
  markDeprecatedTreeName,
  rmExpansionPaths,
  type SchemaTreeRenderOptions,
} from "./tree_views.ts";

/** Custom MIME for Target schema → Blockly canvas drag. */
export const TARGET_DRAG_MIME = "application/x-intehrgrator-target";

export interface TargetDragPayload {
  slotId: string;
}

export function parseTargetDragPayload(dt: DataTransfer | null): TargetDragPayload | null {
  const fromTransfer = parseTargetDragPayloadFromTransfer(dt);
  if (fromTransfer) return fromTransfer;
  return activeTargetDrag;
}

let activeTargetDrag: TargetDragPayload | null = null;

export function getActiveTargetDrag(): TargetDragPayload | null {
  return activeTargetDrag;
}

function parseTargetDragPayloadFromTransfer(dt: DataTransfer | null): TargetDragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(TARGET_DRAG_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TargetDragPayload>;
    if (parsed.slotId && typeof parsed.slotId === "string") {
      return { slotId: parsed.slotId };
    }
  } catch {
    // slotId as plain text (Playwright text-only drops)
  }
  if (raw.includes("/") || raw.includes("::") || raw.startsWith("#")) {
    return { slotId: raw };
  }
  return null;
}

export function findParentSkeletonNode(
  nodes: SkeletonNode[],
  slotId: string,
  parent: SkeletonNode | null = null,
): SkeletonNode | null {
  for (const node of nodes) {
    if (node.slotId === slotId) return parent;
    const inner = findParentSkeletonNode(node.children, slotId, node);
    if (inner || node.children.some((child) => child.slotId === slotId)) {
      return inner ?? node;
    }
  }
  return null;
}

export function findSkeletonNodeIn(
  nodes: SkeletonNode[],
  slotId: string,
): SkeletonNode | undefined {
  for (const node of nodes) {
    if (node.slotId === slotId) return node;
    const nested = findSkeletonNodeIn(node.children, slotId);
    if (nested) return nested;
  }
  return undefined;
}

/** A target tree row; `altLabels` = the label in the target's other languages (hover, #279). */
export interface TargetTreeNode extends SchemaTreeNode {
  altLabels?: string;
  children: TargetTreeNode[];
}

/** Full target (including optional template nodes) for the Target schema tab. */
export function targetSchemaTreeFromSkeleton(
  nodes: SkeletonNode[],
  altLabels?: (slotId: string) => string | undefined,
): TargetTreeNode[] {
  const toTree = (node: SkeletonNode): TargetTreeNode => {
    const alt = altLabels?.(node.slotId);
    return {
      path: node.slotId,
      name: node.label || node.rmType || node.blockType,
      type: node.rmType || node.blockType,
      multiplicity: node.multiplicity ?? node.effectiveCardinality,
      description: node.documentation,
      ...(node.rmAttribute ? { rmAttribute: node.rmAttribute } : {}),
      ...(alt ? { altLabels: alt } : {}),
      children: node.children.map(toTree),
    };
  };
  return nodes.map(toTree);
}

export type TargetTreeSelectHandler = (slotId: string, event?: MouseEvent) => void;

export interface TargetSchemaTreeOptions {
  /** openEHR targets only. Other formats keep the tree they had before. */
  discloseOptionalRm?: boolean;
  rmOptionalToggleLabel?: SchemaTreeRenderOptions["rmOptionalToggleLabel"];
}

export function renderTargetSchemaTree(
  container: HTMLElement,
  nodes: TargetTreeNode[],
  onSelect: TargetTreeSelectHandler = () => {},
  emptyLabel = "Load a target schema or template.",
  options: TargetSchemaTreeOptions = {},
): void {
  container.classList.add("target-schema-tree");
  const disclose = options.discloseOptionalRm === true;
  const expanded = disclose
    ? rmExpansionPaths(container, `target\0${nodes[0]?.path ?? ""}\0${nodes.length}`)
    : new Set<string>();
  const rerender = () => renderTargetSchemaTree(container, nodes, onSelect, emptyLabel, options);
  container.innerHTML = "";
  if (!nodes.length) {
    container.textContent = emptyLabel;
    return;
  }
  for (const node of nodes) {
    container.appendChild(buildTargetNode(node, onSelect, 0, disclose, expanded, options, rerender, ""));
  }
}

function buildTargetNode(
  node: TargetTreeNode | SchemaTreeNode,
  onSelect: TargetTreeSelectHandler,
  depth: number,
  disclose: boolean,
  expanded: Set<string>,
  options: TargetSchemaTreeOptions,
  rerender: () => void,
  parentRmType: string,
): HTMLElement {
  const synthetic = node.rmOrigin === "rm-optional" || node.rmOrigin === "rm-mandatory";
  const row = document.createElement("div");
  row.className = "tree-row";
  if (node.rmOrigin === "rm-mandatory") row.classList.add("tree-row-rm-mandatory");
  if (node.rmOrigin === "rm-optional") row.classList.add("tree-row-rm-optional");
  row.style.paddingLeft = `${depth * 12}px`;
  row.dataset.path = node.path;
  if (!synthetic) row.dataset.slotId = node.path;

  const label = document.createElement("span");
  label.className = "tree-label tree-label-schema";
  const meta = document.createElement("span");
  meta.className = "tree-meta";
  const metaParts = [node.type];
  if (node.multiplicity) metaParts.push(`[${node.multiplicity}]`);
  meta.textContent = `  ${metaParts.join(" ")}`;
  const nameEl = document.createElement("span");
  nameEl.className = "tree-name";
  nameEl.textContent = node.name;
  markDeprecatedTreeName(nameEl, parentRmType, node.rmAttribute);
  label.append(nameEl, meta);
  const alt = "altLabels" in node ? node.altLabels : undefined;
  if (!synthetic) {
    label.draggable = true;
    label.title = [node.description ?? node.path, alt].filter(Boolean).join("\n");
    label.addEventListener("click", (event) => onSelect(node.path, event));
    label.addEventListener("dragstart", (e) => {
      const payload: TargetDragPayload = { slotId: node.path };
      activeTargetDrag = payload;
      const json = JSON.stringify(payload);
      e.dataTransfer?.setData(TARGET_DRAG_MIME, json);
      e.dataTransfer?.setData("text/plain", json);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
    label.addEventListener("dragend", () => {
      queueMicrotask(() => {
        activeTargetDrag = null;
      });
    });
  }
  row.appendChild(label);

  const gaps = disclose ? optionalSourceRmGaps(node) : [];
  if (gaps.length > 0) {
    row.appendChild(createOptionalRmToggle(node, expanded, options, rerender));
  }

  const childRm = node.type;
  const wrap = document.createElement("div");
  wrap.appendChild(row);
  for (const child of node.children) {
    wrap.appendChild(
      buildTargetNode(child, onSelect, depth + 1, disclose, expanded, options, rerender, childRm),
    );
  }
  if (disclose && expanded.has(node.path)) {
    for (const child of gaps) {
      wrap.appendChild(
        buildTargetNode(child, onSelect, depth + 1, disclose, expanded, options, rerender, childRm),
      );
    }
  }
  return wrap;
}
