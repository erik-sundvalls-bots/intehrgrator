/**
 * Order-preserving D3 Cascaded Treemap hierarchy builder and layout engine
 * for large openEHR templates (Decision 6A).
 *
 * Pure TypeScript (no DOM required) so layout, filtering, and Sparse-mode
 * ghost overlays can be unit-tested directly in Deno.
 */
import {
  hierarchy,
  treemap,
  treemapBinary,
} from "d3-hierarchy";
import type {
  DocumentIndex,
  IndexedBlockNode,
  StatusCounts,
  TileStatus,
} from "../core/slice_engine.ts";
import type { SkeletonNode } from "../types/mod.ts";

export type TreemapStatusFilter =
  | "all"
  | "mandatory-missing"
  | "unmapped"
  | "ai-draft"
  | "mapped"
  | "validation-error";

export interface TreemapDatum {
  id: string;
  label: string;
  rmType: string;
  valueRmType: string;
  slotId: string;
  archetypeNodeId: string;
  mandatory: boolean;
  status: TileStatus;
  counts: StatusCounts;
  mappingSummary: string;
  hasAiDraft: boolean;
  aiConfidence?: number;
  aiNote?: string;
  subtreeBlockCount: number;
  isLeaf: boolean;
  isGhost: boolean;
  children: TreemapDatum[];
}

export interface TreemapFilterOptions {
  query?: string;
  statusFilter?: TreemapStatusFilter;
}

export interface BuildTreemapOptions {
  /** Root node ID to zoom/focus into (defaults to COMPOSITION or first root). */
  zoomRootId?: string | null;
  /** Full target skeleton for Sparse-mode ghost tiles (`unscaffolded-optional`). */
  sparseFullSkeleton?: SkeletonNode[] | null;
  /** Optional search + status filter. */
  filter?: TreemapFilterOptions;
}

/** Structural wrappers collapsed visually so SECTION -> ENTRY -> CLUSTER -> ELEMENT stays clean. */
const TRANSPARENT_WRAPPERS = new Set([
  "HISTORY",
  "POINT_EVENT",
  "INTERVAL_EVENT",
  "EVENT",
  "ITEM_TREE",
  "ITEM_LIST",
  "ITEM_SINGLE",
  "ITEM_TABLE",
  "INCLUDE_WHEN",
  "FOR_EACH_LIST",
  "ACTIVITY",
]);

function emptyCounts(): StatusCounts {
  return {
    totalLeaves: 0,
    mappedLeaves: 0,
    mandatoryMissingLeaves: 0,
    aiDraftLeaves: 0,
    unmappedLeaves: 0,
    validationErrorLeaves: 0,
  };
}

function nodeToDatum(
  index: DocumentIndex,
  nodeId: string,
): TreemapDatum[] {
  const node = index.nodes.get(nodeId);
  if (!node) return [];

  const childData: TreemapDatum[] = [];
  for (const cid of node.children) {
    childData.push(...nodeToDatum(index, cid));
  }

  // Flatten transparent RM wrappers (HISTORY, POINT_EVENT, ITEM_TREE, include_when)
  // so clinical hierarchy stays SECTION -> ENTRY -> CLUSTER -> ELEMENT.
  if (TRANSPARENT_WRAPPERS.has(node.rmType) && childData.length > 0) {
    return childData;
  }

  const isLeaf = node.type === "element" || childData.length === 0;
  return [
    {
      id: node.id,
      label: node.label,
      rmType: node.rmType,
      valueRmType: node.valueRmType,
      slotId: node.slotId,
      archetypeNodeId: node.archetypeNodeId,
      mandatory: node.mandatory,
      status: node.status,
      counts: { ...node.counts },
      mappingSummary: node.mappingSummary,
      hasAiDraft: node.hasAiDraft,
      aiConfidence: node.aiConfidence,
      aiNote: node.aiNote,
      subtreeBlockCount: node.subtreeBlockCount,
      isLeaf,
      isGhost: false,
      children: isLeaf ? [] : childData,
    },
  ];
}

function collectPresentSlotIds(index: DocumentIndex): Set<string> {
  const present = new Set<string>();
  for (const node of index.nodes.values()) {
    if (node.slotId) present.add(node.slotId);
  }
  return present;
}

function buildGhostFromSkeleton(
  node: SkeletonNode,
  presentSlots: ReadonlySet<string>,
): TreemapDatum[] {
  // Skip already-scaffolded nodes and silent-mandatory RM plumbing.
  if (node.silentMandatory) return [];
  if (presentSlots.has(node.slotId)) {
    // Descend to check if optional children inside a scaffolded parent are missing.
    const nested: TreemapDatum[] = [];
    for (const child of node.children) {
      nested.push(...buildGhostFromSkeleton(child, presentSlots));
    }
    return nested;
  }

  const rm = (node.rmType || "").toUpperCase();
  const children: TreemapDatum[] = [];
  for (const child of node.children) {
    children.push(...buildGhostFromSkeleton(child, presentSlots));
  }

  if (TRANSPARENT_WRAPPERS.has(rm) && children.length > 0) {
    return children;
  }

  const isMeaningful = rm === "SECTION" ||
    rm === "OBSERVATION" ||
    rm === "EVALUATION" ||
    rm === "INSTRUCTION" ||
    rm === "ACTION" ||
    rm === "ADMIN_ENTRY" ||
    rm === "ENTRY" ||
    rm === "CLUSTER" ||
    rm === "ELEMENT" ||
    rm === "EVENT_CONTEXT";
  if (!isMeaningful) return children;

  const isLeaf = rm === "ELEMENT" || children.length === 0;
  return [
    {
      id: `ghost:${node.slotId}`,
      label: node.label || rm,
      rmType: rm,
      valueRmType: node.kind === "value" ? rm : "",
      slotId: node.slotId,
      archetypeNodeId: node.archetypeNodeId ?? "",
      mandatory: Boolean(node.mandatory),
      status: "unscaffolded-optional",
      counts: emptyCounts(),
      mappingSummary: "",
      hasAiDraft: false,
      subtreeBlockCount: 0,
      isLeaf,
      isGhost: true,
      children: isLeaf ? [] : children,
    },
  ];
}

function matchesQuery(datum: TreemapDatum, q: string): boolean {
  if (!q) return true;
  const hay = `${datum.label} ${datum.rmType} ${datum.archetypeNodeId} ${datum.slotId} ${datum.mappingSummary}`
    .toLowerCase();
  return hay.includes(q);
}

function matchesStatus(datum: TreemapDatum, filter: TreemapStatusFilter): boolean {
  if (filter === "all") return true;
  if (datum.isLeaf) return datum.status === filter;
  if (filter === "mandatory-missing") return datum.counts.mandatoryMissingLeaves > 0;
  if (filter === "unmapped") return datum.counts.unmappedLeaves > 0;
  if (filter === "ai-draft") return datum.counts.aiDraftLeaves > 0;
  if (filter === "mapped") return datum.counts.mappedLeaves > 0;
  if (filter === "validation-error") return datum.counts.validationErrorLeaves > 0;
  return true;
}

/**
 * Filter a `TreemapDatum` tree by search query and/or status chip, keeping
 * ancestors of matching nodes so clinical context stays intact.
 */
export function filterTreemapTree(
  root: TreemapDatum,
  options?: TreemapFilterOptions,
): TreemapDatum | null {
  const q = (options?.query ?? "").trim().toLowerCase();
  const statusFilter = options?.statusFilter ?? "all";
  if (!q && statusFilter === "all") return root;

  function prune(node: TreemapDatum, isRoot: boolean): TreemapDatum | null {
    const filteredChildren: TreemapDatum[] = [];
    for (const child of node.children) {
      const kept = prune(child, false);
      if (kept) filteredChildren.push(kept);
    }

    const selfMatchesQuery = matchesQuery(node, q);
    const selfMatchesStatus = matchesStatus(node, statusFilter);

    if (isRoot) {
      return { ...node, children: filteredChildren };
    }
    if (filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
    if (selfMatchesQuery && selfMatchesStatus) {
      return { ...node, children: [] };
    }
    return null;
  }

  return prune(root, true);
}

/**
 * Build a `TreemapDatum` tree from a `DocumentIndex` (and optional Sparse-mode
 * full skeleton for `unscaffolded-optional` ghost tiles).
 */
export function buildTreemapHierarchy(
  index: DocumentIndex,
  options?: BuildTreemapOptions,
): TreemapDatum | null {
  const rootId = options?.zoomRootId && index.nodes.has(options.zoomRootId)
    ? options.zoomRootId
    : (index.compositionId ?? index.roots[0] ?? null);
  if (!rootId) return null;

  const built = nodeToDatum(index, rootId);
  if (built.length === 0) return null;
  let root = built[0];

  // Overlay unscaffolded optional nodes when viewing the template root in Sparse mode.
  if (
    options?.sparseFullSkeleton &&
    options.sparseFullSkeleton.length > 0 &&
    (!options.zoomRootId || options.zoomRootId === index.compositionId)
  ) {
    const presentSlots = collectPresentSlotIds(index);
    const ghosts: TreemapDatum[] = [];
    for (const skRoot of options.sparseFullSkeleton) {
      for (const child of skRoot.children) {
        ghosts.push(...buildGhostFromSkeleton(child, presentSlots));
      }
    }
    if (ghosts.length > 0) {
      root = {
        ...root,
        isLeaf: false,
        children: [...root.children, ...ghosts],
      };
    }
  }

  if (options?.filter) {
    return filterTreemapTree(root, options.filter);
  }
  return root;
}

/** Build breadcrumb trail from COMPOSITION down to `nodeId`. */
export function buildBreadcrumbTrail(
  index: DocumentIndex,
  nodeId: string | null,
): Array<{ id: string; label: string; rmType: string }> {
  const trail: Array<{ id: string; label: string; rmType: string }> = [];
  let cur: IndexedBlockNode | undefined = nodeId ? index.nodes.get(nodeId) : undefined;
  while (cur) {
    if (!TRANSPARENT_WRAPPERS.has(cur.rmType)) {
      trail.unshift({ id: cur.id, label: cur.label, rmType: cur.rmType });
    }
    cur = cur.parentId ? index.nodes.get(cur.parentId) : undefined;
  }
  if (trail.length === 0 && index.compositionId) {
    const comp = index.nodes.get(index.compositionId);
    if (comp) trail.push({ id: comp.id, label: comp.label, rmType: comp.rmType });
  }
  return trail;
}

export interface ComputedTreemapTile {
  datum: TreemapDatum;
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  isContainer: boolean;
}

/**
 * Compute cascaded treemap rectangles using order-preserving `treemapBinary`
 * (never sorting by area so clinical template sequence is preserved).
 *
 * Caps rendered depth at `maxDepth` (default 3: root -> SECTION -> ENTRY -> CLUSTER)
 * so leaf ELEMENTs don't collapse into unreadable slivers at overview zoom.
 */
export function computeTreemapLayout(
  rootDatum: TreemapDatum,
  width: number,
  height: number,
  maxDepth = 3,
): ComputedTreemapTile[] {
  if (width <= 0 || height <= 0) return [];

  // Prune children beyond `maxDepth` so D3 allocates space cleanly for visible tiles.
  function capDepth(node: TreemapDatum, depth: number): TreemapDatum {
    if (depth >= maxDepth || node.children.length === 0) {
      return { ...node, children: [] };
    }
    return {
      ...node,
      children: node.children.map((c) => capDepth(c, depth + 1)),
    };
  }

  const capped = capDepth(rootDatum, 0);

  interface RectNode {
    data: TreemapDatum;
    depth: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    children?: RectNode[];
  }

  const root = hierarchy(capped, (d: TreemapDatum) =>
    d.children.length > 0 ? d.children : null
  ).sum((d: TreemapDatum) => {
    if (d.children.length > 0) return 0;
    // Weight leaf / capped container by leaf count (clamped so empty tiles stay legible).
    return Math.max(1, Math.min(24, d.counts.totalLeaves || 1));
  });
  // Intentionally DO NOT call `.sort(...)` so clinical template order is preserved!

  const layout = treemap()
    .tile(treemapBinary)
    .size([width, height])
    .paddingOuter(4)
    .paddingInner(3)
    .paddingTop((node: RectNode) => {
      if (node.depth === 0) return 0;
      if (!node.children || node.children.length === 0) return 0;
      return node.depth === 1 ? 26 : 22;
    })
    .round(true);

  const laidOut = layout(root) as { each: (fn: (node: RectNode) => void) => void };

  const tiles: ComputedTreemapTile[] = [];
  laidOut.each((node: RectNode) => {
    if (node.depth === 0) return; // Root occupies full canvas; its children are top-level tiles.
    if (node.x1 - node.x0 < 2 || node.y1 - node.y0 < 2) return;
    tiles.push({
      datum: node.data,
      depth: node.depth,
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
      isContainer: Boolean(node.children && node.children.length > 0),
    });
  });

  return tiles;
}
