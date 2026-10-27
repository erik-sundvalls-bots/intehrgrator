/**
 * Target schema tree: SkeletonNode → Source-pane-shaped rows, plus canvas drag MIME.
 *
 * Drag onto empty canvas is product recovery. Leaf → scaffold-target chip and
 * subtree → default-context-map value socket are handled by the web app drop path.
 */

import type { SchemaTreeNode, SkeletonNode } from "../types/mod.ts";

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
      ...(alt ? { altLabels: alt } : {}),
      children: node.children.map(toTree),
    };
  };
  return nodes.map(toTree);
}

export type TargetTreeSelectHandler = (slotId: string, event?: MouseEvent) => void;

export function renderTargetSchemaTree(
  container: HTMLElement,
  nodes: TargetTreeNode[],
  onSelect: TargetTreeSelectHandler = () => {},
  emptyLabel = "Load a target schema or template.",
): void {
  container.classList.add("target-schema-tree");
  container.innerHTML = "";
  if (!nodes.length) {
    container.textContent = emptyLabel;
    return;
  }
  for (const node of nodes) {
    container.appendChild(buildTargetNode(node, onSelect, 0));
  }
}

function buildTargetNode(
  node: TargetTreeNode,
  onSelect: TargetTreeSelectHandler,
  depth: number,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${depth * 12}px`;
  row.dataset.path = node.path;
  row.dataset.slotId = node.path;

  const label = document.createElement("span");
  label.className = "tree-label tree-label-schema";
  const meta = document.createElement("span");
  meta.className = "tree-meta";
  const metaParts = [node.type];
  if (node.multiplicity) metaParts.push(`[${node.multiplicity}]`);
  meta.textContent = `  ${metaParts.join(" ")}`;
  label.append(document.createTextNode(node.name), meta);
  label.draggable = true;
  label.title = [node.description ?? node.path, node.altLabels].filter(Boolean).join("\n");
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
  row.appendChild(label);

  const wrap = document.createElement("div");
  wrap.appendChild(row);
  for (const child of node.children) {
    wrap.appendChild(buildTargetNode(child, onSelect, depth + 1));
  }
  return wrap;
}
