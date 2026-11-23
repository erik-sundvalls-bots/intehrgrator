/**
 * TermViz V8-inspired content-sized Cascaded Treemap hierarchy builder and
 * Lü & Fogarty (2008) skyline layout engine for large openEHR templates (6A).
 *
 * Pure TypeScript (no DOM required) so layout, filtering, cascade overhang,
 * collapsible blobs, and Sparse-mode ghost overlays can be unit-tested in Deno.
 */
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

export const CASCADE_OFFSET = 4;

export interface ComputedTreemapTile {
  datum: TreemapDatum;
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Visual card width (shifted up-left by CASCADE_OFFSET on expanded containers for Lü & Fogarty overhang). */
  cardW: number;
  /** Visual card height (shifted up-left by CASCADE_OFFSET on expanded containers for Lü & Fogarty overhang). */
  cardH: number;
  isContainer: boolean;
  /** True when rendered as a compact collapsed pill/blob. */
  isBlob: boolean;
  /** 1-based output order among non-ghost siblings in the parent (0 for ghost tiles). */
  siblingIndex: number;
  /** Total non-ghost siblings in the parent (0 for ghost tiles). */
  siblingCount: number;
  /** Parent datum ID for grouping/tracing sibling sequence. */
  parentId: string | null;
}

export interface CascadedLayoutOptions {
  maxDepth?: number;
  cascadeOffset?: number;
  gap?: number;
  leafMaxWidth?: number;
  collapsedIds?: ReadonlySet<string>;
}

export interface CascadedLayoutResult {
  tiles: ComputedTreemapTile[];
  contentWidth: number;
  contentHeight: number;
  /** Exact un-clamped width needed by laid-out tiles (including outer padding). */
  naturalWidth: number;
  /** Exact un-clamped height needed by laid-out tiles (including outer padding). */
  naturalHeight: number;
}

const HDR_PX: Record<string, number> = {
  COMPOSITION: 12,
  SECTION: 11,
  OBSERVATION: 10.5,
  EVALUATION: 10.5,
  INSTRUCTION: 10.5,
  ACTION: 10.5,
  ADMIN_ENTRY: 10.5,
  ENTRY: 10.5,
  EVENT_CONTEXT: 10.5,
  CLUSTER: 10,
  ELEMENT: 10,
};

/** Fast, DOM-free proportional text width estimate (matches TermViz V8 compact sans-serif metrics). */
function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 32 || ch === 105 || ch === 108 || ch === 73 || ch === 46 || ch === 44) {
      units += 0.34;
    } else if (ch === 109 || ch === 119 || ch === 77 || ch === 87) {
      units += 0.82;
    } else if (ch >= 65 && ch <= 90) {
      units += 0.66;
    } else {
      units += 0.56;
    }
  }
  return Math.ceil(units * fontSize * (bold ? 1.05 : 1));
}

interface BoxItem {
  datum: TreemapDatum;
  depth: number;
  w: number;
  h: number;
  rx: number;
  ry: number;
  x: number;
  y: number;
  isLeaf: boolean;
  isBlob: boolean;
  siblingIndex: number;
  siblingCount: number;
  parentId: string | null;
  kids: BoxItem[];
}

interface SkylineSegment {
  x: number;
  w: number;
  y: number;
}

/** Order-preserving skyline bin packer (adapted from TermViz V8). */
function skylinePack(
  items: ReadonlyArray<{ w: number; h: number }>,
  maxW: number,
  gap: number,
): { pos: Array<{ x: number; y: number }>; w: number; h: number } {
  let sk: SkylineSegment[] = [{ x: 0, w: maxW, y: 0 }];
  let maxX = 0;
  let maxY = 0;
  const pos: Array<{ x: number; y: number }> = [];

  for (const it of items) {
    let best: { x: number; y: number } | null = null;
    for (let i = 0; i < sk.length; i++) {
      const x = sk[i].x;
      if (x + it.w > maxW + 0.5) break;
      let y = 0;
      for (let j = i; j < sk.length && sk[j].x < x + it.w - 0.01; j++) {
        if (sk[j].y > y) y = sk[j].y;
      }
      if (!best || y < best.y - 0.01) best = { x, y };
    }
    if (!best) {
      let topY = 0;
      for (const s of sk) if (s.y > topY) topY = s.y;
      best = { x: 0, y: topY };
    }
    pos.push(best);
    const x0 = best.x;
    const x1 = best.x + it.w + gap;
    const ny = best.y + it.h + gap;
    if (x0 + it.w > maxX) maxX = x0 + it.w;
    if (best.y + it.h > maxY) maxY = best.y + it.h;

    const nsk: SkylineSegment[] = [];
    for (const s of sk) {
      const s1 = s.x + s.w;
      if (s1 <= x0 || s.x >= x1) {
        nsk.push(s);
      } else {
        if (s.x < x0) nsk.push({ x: s.x, w: x0 - s.x, y: s.y });
        if (s1 > x1) nsk.push({ x: x1, w: s1 - x1, y: s.y });
      }
    }
    nsk.push({ x: x0, w: Math.min(x1, maxW) - x0, y: ny });
    nsk.sort((a, b) => a.x - b.x);
    sk = [];
    for (const s of nsk) {
      if (s.w <= 0.01) continue;
      const last = sk[sk.length - 1];
      if (last && Math.abs(last.y - s.y) < 0.01) last.w += s.w;
      else sk.push({ ...s });
    }
  }

  return { pos, w: maxX, h: maxY };
}

/**
 * Pick the most space-efficient order-preserving width for `items` via skyline
 * packing (TermViz V8 `packBest`, strictly preserving clinical sequence).
 */
function packBestOrderPreserving(
  items: ReadonlyArray<{ w: number; h: number }>,
  minW: number,
  maxW: number,
  gap: number,
  aspect: number,
  penalty: number,
): { pos: Array<{ x: number; y: number }>; w: number; h: number } {
  if (items.length === 0) return { pos: [], w: minW, h: 0 };
  if (items.length === 1) return { pos: [{ x: 0, y: 0 }], w: items[0].w, h: items[0].h };

  const sumW = items.reduce((s, d) => s + d.w, 0) + gap * (items.length - 1);
  const hi = Math.max(minW, Math.min(maxW, sumW));
  let best: { pos: Array<{ x: number; y: number }>; w: number; h: number; score: number } | null =
    null;

  const steps = 16;
  for (let t = 0; t <= steps; t++) {
    const W = minW + (hi - minW) * Math.pow(t / steps, 1.4);
    const r = skylinePack(items, Math.max(W, minW), gap);
    const ratio = r.h > 0 ? r.w / r.h : aspect;
    const score = r.w * r.h * (1 + penalty * Math.abs(Math.log(Math.max(0.05, ratio) / aspect)));
    if (!best || score < best.score) {
      best = { pos: r.pos, w: r.w, h: r.h, score };
    }
  }
  return best!;
}

/**
 * Compute TermViz V8 content-sized cascaded treemap layout (Lü & Fogarty 2008).
 *
 * - Leaf ELEMENTs are sized to their text content (never squished into slivers).
 * - Internal containers pack children with an order-preserving skyline packer
 *   and shift their visual card up-left by `cascadeOffset` so children overhang
 *   down-right with zero wasted right/bottom padding.
 * - Collapsed containers (or depth-capped containers) render as compact blobs.
 */
export function computeCascadedTreemapLayout(
  rootDatum: TreemapDatum,
  width: number,
  height: number,
  options?: CascadedLayoutOptions,
): CascadedLayoutResult {
  if (width <= 0 || height <= 0) {
    return { tiles: [], contentWidth: 0, contentHeight: 0, naturalWidth: 0, naturalHeight: 0 };
  }

  const maxDepth = options?.maxDepth ?? 3;
  const P = options?.cascadeOffset ?? CASCADE_OFFSET;
  const g = options?.gap ?? 3;
  const leafMax = options?.leafMaxWidth ?? 185;
  const collapsedIds = options?.collapsedIds;
  const outerPad = 8;
  const usableW = Math.max(240, width - outerPad * 2);

  function layoutNode(
    datum: TreemapDatum,
    depth: number,
    maxAvailW: number,
    siblingIndex: number,
    siblingCount: number,
    parentId: string | null,
  ): BoxItem {
    const hpx = HDR_PX[datum.rmType] ?? 10.5;
    const hasKids = datum.children.length > 0;
    const isCollapsed = hasKids && (Boolean(collapsedIds?.has(datum.id)) || depth >= maxDepth);
    const orderExtra = !datum.isGhost && siblingCount > 1
      ? (siblingIndex >= 10 ? 18 : 14)
      : 0;

    if (isCollapsed) {
      const done = datum.counts.mappedLeaves + datum.counts.aiDraftLeaves;
      const badge = datum.counts.totalLeaves > 0 ? `${done}/${datum.counts.totalLeaves}` : "";
      const w = Math.min(
        maxAvailW,
        Math.max(
          54,
          estimateTextWidth(datum.label, 10.5, true) + 26 + orderExtra +
            (badge ? estimateTextWidth(badge, 9.5, true) + 12 : 0),
        ),
      );
      return {
        datum,
        depth,
        w,
        h: 21,
        rx: 0,
        ry: 0,
        x: 0,
        y: 0,
        isLeaf: false,
        isBlob: true,
        siblingIndex,
        siblingCount,
        parentId,
        kids: [],
      };
    }

    if (!hasKids) {
      const sub = datum.mappingSummary;
      const labelW = estimateTextWidth(datum.label, 10, true) + 20 + orderExtra;
      const subW = sub ? estimateTextWidth(sub, 9.5, false) + 12 : 0;
      const w = Math.min(leafMax, Math.min(maxAvailW, Math.max(40, labelW, subW)));
      const h = sub ? 29 : 19;
      return {
        datum,
        depth,
        w,
        h,
        rx: 0,
        ry: 0,
        x: 0,
        y: 0,
        isLeaf: true,
        isBlob: false,
        siblingIndex,
        siblingCount,
        parentId,
        kids: [],
      };
    }

    const childMaxW = Math.max(120, Math.floor((depth === 0 ? maxAvailW : maxAvailW * 0.94) - P));
    const nonGhostTotal = datum.children.filter((c) => !c.isGhost).length;
    let nonGhostOrdinal = 0;
    const kids = datum.children.map((c) => {
      const idx = c.isGhost ? 0 : ++nonGhostOrdinal;
      const count = c.isGhost ? 0 : nonGhostTotal;
      return layoutNode(c, depth + 1, childMaxW, idx, count, datum.id);
    });

    if (depth === 0) {
      // Root packs its top-level children directly across the viewport width.
      const maxChildW = kids.reduce((m, k) => Math.max(m, k.w), 0);
      const packW = Math.max(maxChildW, usableW);
      const r = skylinePack(kids, packW, g + 3);
      kids.forEach((k, i) => {
        k.rx = outerPad + r.pos[i].x;
        k.ry = outerPad + r.pos[i].y;
      });
      return {
        datum,
        depth: 0,
        w: r.w + outerPad * 2,
        h: r.h + outerPad * 2,
        rx: 0,
        ry: 0,
        x: 0,
        y: 0,
        isLeaf: false,
        isBlob: false,
        siblingIndex: 0,
        siblingCount: 0,
        parentId: null,
        kids,
      };
    }

    const Lh = Math.round(hpx + 8); // 18–19px crisp cascaded header strip
    const statExtra = datum.counts.totalLeaves > 0 ? 34 : 0;
    const actionExtra = datum.isGhost ? 0 : 62;
    const labW = Math.min(
      maxAvailW,
      estimateTextWidth(datum.label, hpx, true) + 22 + orderExtra + statExtra + actionExtra,
    );
    const maxChildW = kids.reduce((m, k) => Math.max(m, k.w), 0);
    const minW = Math.max(maxChildW, Math.max(0, labW - P));
    const targetAspect = depth === 1 ? 1.8 : 2.1;
    const r = packBestOrderPreserving(
      kids,
      minW,
      Math.max(minW, childMaxW),
      g,
      targetAspect,
      depth === 1 ? 0.55 : 0.35,
    );

    kids.forEach((k, i) => {
      k.rx = P + r.pos[i].x;
      k.ry = Lh + r.pos[i].y;
    });

    return {
      datum,
      depth,
      w: Math.max(r.w + P, labW),
      h: Lh + r.h,
      rx: 0,
      ry: 0,
      x: 0,
      y: 0,
      isLeaf: false,
      isBlob: false,
      siblingIndex,
      siblingCount,
      parentId,
      kids,
    };
  }

  const rootBox = layoutNode(rootDatum, 0, usableW, 0, 0, null);
  const tiles: ComputedTreemapTile[] = [];

  function place(box: BoxItem, x: number, y: number): void {
    box.x = x;
    box.y = y;
    if (box.depth > 0) {
      const isExpandedContainer = !box.isLeaf && !box.isBlob && box.kids.length > 0;
      const cardW = isExpandedContainer ? Math.max(24, box.w - P) : box.w;
      const cardH = isExpandedContainer ? Math.max(18, box.h - P) : box.h;
      tiles.push({
        datum: box.datum,
        depth: box.depth,
        x0: Math.round(x),
        y0: Math.round(y),
        x1: Math.round(x + box.w),
        y1: Math.round(y + box.h),
        cardW: Math.round(cardW),
        cardH: Math.round(cardH),
        isContainer: !box.isLeaf,
        isBlob: box.isBlob,
        siblingIndex: box.siblingIndex,
        siblingCount: box.siblingCount,
        parentId: box.parentId,
      });
    }
    for (const k of box.kids) {
      place(k, x + k.rx, y + k.ry);
    }
  }

  place(rootBox, 0, 0);

  const naturalWidth = Math.ceil(rootBox.w);
  const naturalHeight = Math.ceil(rootBox.h);

  return {
    tiles,
    contentWidth: Math.max(width, naturalWidth),
    contentHeight: Math.max(height, naturalHeight),
    naturalWidth,
    naturalHeight,
  };
}

/**
 * Convenience wrapper returning laid-out `ComputedTreemapTile[]` (backward-compatible).
 */
export function computeTreemapLayout(
  rootDatum: TreemapDatum,
  width: number,
  height: number,
  maxDepth = 3,
): ComputedTreemapTile[] {
  return computeCascadedTreemapLayout(rootDatum, width, height, { maxDepth }).tiles;
}

