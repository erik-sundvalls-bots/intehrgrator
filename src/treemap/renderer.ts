/**
 * Self-contained TermViz V8-inspired Cascaded Treemap DOM renderer (Decision 6A).
 *
 * Uses Lü & Fogarty (2008) content-sized cascaded box layout:
 * - Expanded containers shift their card up-left by CASCADE_OFFSET (4px) so
 *   children overhang down-right with zero wasted right/bottom padding.
 * - Leaf ELEMENT tiles are text-measured and compact so every label stays legible.
 * - Containers can be collapsed in place to compact blobs (`−` / `+`), drilled
 *   into via header click, or opened in Scoped Blockly (`Blockly ↗` / dblclick).
 * - Combines TermViz V8 openEHR RM colors with accessible status heatmaps.
 */
import type { DocumentIndex, TileStatus } from "../core/slice_engine.ts";
import type { SkeletonNode } from "../types/mod.ts";
import {
  buildTreemapHierarchy,
  computeCascadedTreemapLayout,
  type ComputedTreemapTile,
  type TreemapDatum,
  type TreemapStatusFilter,
} from "./hierarchy.ts";

export interface TreemapRendererCallbacks {
  /** Called when the user clicks a container header to zoom/drill in. */
  onZoomChange?: (zoomRootId: string | null, originRect?: DOMRect | null) => void;
  /** Called when the user clicks "Open in Blockly" or double-clicks a tile. */
  onOpenInBlockly: (nodeId: string) => void;
  /** Called when the user clicks a leaf ELEMENT tile (opens inline popover). */
  onLeafClick?: (datum: TreemapDatum, anchorEl: HTMLElement) => void;
  /** Called when the user clicks an unscaffolded-optional ghost tile in Sparse mode. */
  onGhostClick?: (datum: TreemapDatum, anchorEl: HTMLElement) => void;
  /** Called when the user clicks Accept/Reject AI triage on a tile or container. */
  onAiTriage?: (nodeId: string, action: "accept" | "reject", bulk: boolean) => void;
}

export interface TreemapRenderState {
  index: DocumentIndex;
  zoomRootId: string | null;
  query: string;
  statusFilter: TreemapStatusFilter;
  selectedBlockId: string | null;
  sparseFullSkeleton?: SkeletonNode[] | null;
  showAiBulkActions?: boolean;
}

const STATUS_GLYPH: Record<TileStatus, string> = {
  "unmapped": "○",
  "mandatory-missing": "⚠",
  "ai-draft": "✦",
  "mapped": "✓",
  "validation-error": "✕",
  "unscaffolded-optional": "+",
};

const STATUS_LABEL: Record<TileStatus, string> = {
  "unmapped": "Unmapped",
  "mandatory-missing": "Mandatory missing",
  "ai-draft": "AI draft (pending review)",
  "mapped": "Mapped",
  "validation-error": "Validation error",
  "unscaffolded-optional": "Optional (not scaffolded)",
};

/** TermViz V8 openEHR RM accent palette. */
const RM_COLOR: Record<string, string> = {
  OBSERVATION: "#2f6f9f",
  EVALUATION: "#7a4b8c",
  ACTION: "#c46b1a",
  INSTRUCTION: "#b0882a",
  CLUSTER: "#0f6e6b",
  COMPOSITION: "#1c2430",
  SECTION: "#5c675f",
  ADMIN_ENTRY: "#5c675f",
  ENTRY: "#2f6f9f",
  EVENT_CONTEXT: "#5c675f",
};

export interface TreemapRenderer {
  render(state: TreemapRenderState): void;
  animateZoom(direction: "in" | "out"): void;
  destroy(): void;
}

function formatTooltipHtml(tile: ComputedTreemapTile): string {
  const d = tile.datum;
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const lines: string[] = [
    `<div class="tm-tip-title">${esc(d.label)} <span class="tm-tip-rm">${esc(d.rmType)}</span></div>`,
  ];
  if (!d.isGhost && tile.siblingCount > 1) {
    lines.push(
      `<div class="tm-tip-order">Output order: <strong>#${tile.siblingIndex} of ${tile.siblingCount}</strong> (fixed sibling sequence)</div>`,
    );
  }
  if (d.valueRmType) {
    lines.push(`<div class="tm-tip-meta">Datatype: <code>${esc(d.valueRmType)}</code></div>`);
  }
  lines.push(
    `<div class="tm-tip-meta">Status: <strong>${STATUS_GLYPH[d.status]} ${STATUS_LABEL[d.status]}</strong>${d.mandatory ? " · Mandatory (1..*)" : " · Optional (0..*)"}</div>`,
  );
  if (d.slotId) {
    lines.push(`<div class="tm-tip-path">${esc(d.slotId)}</div>`);
  }
  if (d.mappingSummary) {
    lines.push(`<div class="tm-tip-map">Mapping: <code>${esc(d.mappingSummary)}</code></div>`);
  }
  if (d.hasAiDraft && (d.aiNote || d.aiConfidence !== undefined)) {
    const conf = d.aiConfidence !== undefined ? `${d.aiConfidence}% — ` : "";
    lines.push(`<div class="tm-tip-ai">AI: ${esc(conf + (d.aiNote ?? "Pending review"))}</div>`);
  }
  if (!d.isLeaf && d.counts.totalLeaves > 0) {
    lines.push(
      `<div class="tm-tip-counts">${d.counts.mappedLeaves} mapped · ${d.counts.aiDraftLeaves} AI draft · ${d.counts.mandatoryMissingLeaves} mandatory missing · ${d.counts.totalLeaves} total elements</div>`,
    );
  }
  return lines.join("");
}

let cachedScrollbarSize: number | null = null;

/** Measure native classic scrollbar width once (0 on overlay-scrollbar platforms). */
function measureScrollbarSize(): number {
  if (cachedScrollbarSize !== null) return cachedScrollbarSize;
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none;";
  document.body.append(probe);
  const size = Math.max(0, probe.offsetWidth - probe.clientWidth);
  probe.remove();
  cachedScrollbarSize = size;
  return size;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function createTreemapRenderer(
  host: HTMLElement,
  callbacks: TreemapRendererCallbacks,
): TreemapRenderer {
  const canvas = document.createElement("div");
  canvas.className = "treemap-canvas";
  canvas.setAttribute("role", "region");
  canvas.setAttribute("aria-label", "Template treemap overview");

  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  canvas.append(stage);

  const tooltip = document.createElement("div");
  tooltip.className = "treemap-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "tooltip");

  host.replaceChildren(canvas, tooltip);

  let lastState: TreemapRenderState | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeRafId: number | null = null;
  let lastHostW = 0;
  let lastHostH = 0;
  const collapsedIds = new Set<string>();

  // Sibling order hover-trace state (rebuilt on each paint).
  let orderOverlay: SVGSVGElement | null = null;
  let siblingsByParent = new Map<string, ComputedTreemapTile[]>();
  let tileElementsById = new Map<string, HTMLElement>();
  let activeSeqParentId: string | null = null;

  // Observe `host` (overflow: hidden), NOT `canvas` (overflow: auto), so toggling
  // scrollbars inside `canvas` can never shrink the observed element and cause a
  // ResizeObserver feedback / flicker loop.
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (!lastState) return;
      const w = Math.floor(host.clientWidth);
      const h = Math.floor(host.clientHeight);
      if (w <= 0 || h <= 0) return;
      if (w === lastHostW && h === lastHostH) return;
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (!lastState) return;
        const cw = Math.floor(host.clientWidth);
        const ch = Math.floor(host.clientHeight);
        if (cw <= 0 || ch <= 0) return;
        if (cw === lastHostW && ch === lastHostH) return;
        paint(lastState);
      });
    });
    resizeObserver.observe(host);
  }

  function clearSiblingSequence(): void {
    if (activeSeqParentId !== null) {
      const prevSiblings = siblingsByParent.get(activeSeqParentId) ?? [];
      for (const s of prevSiblings) {
        const el = tileElementsById.get(s.datum.id);
        el?.classList.remove("tm-tile--sibling-seq", "tm-tile--sibling-active");
      }
      activeSeqParentId = null;
    }
    if (orderOverlay) {
      orderOverlay.replaceChildren();
    }
  }

  function showSiblingSequence(parentId: string | null, hoveredId: string): void {
    if (!parentId) {
      clearSiblingSequence();
      return;
    }
    const siblings = siblingsByParent.get(parentId);
    if (!siblings || siblings.length < 2) {
      clearSiblingSequence();
      return;
    }
    if (activeSeqParentId !== parentId) {
      clearSiblingSequence();
      activeSeqParentId = parentId;
      for (const s of siblings) {
        tileElementsById.get(s.datum.id)?.classList.add("tm-tile--sibling-seq");
      }
      if (orderOverlay) {
        const defs = document.createElementNS(SVG_NS, "defs");
        const marker = document.createElementNS(SVG_NS, "marker");
        marker.setAttribute("id", "tm-seq-arrow");
        marker.setAttribute("viewBox", "0 0 8 8");
        marker.setAttribute("refX", "6.5");
        marker.setAttribute("refY", "4");
        marker.setAttribute("markerWidth", "6");
        marker.setAttribute("markerHeight", "6");
        marker.setAttribute("orient", "auto-start-reverse");
        const arrowPath = document.createElementNS(SVG_NS, "path");
        arrowPath.setAttribute("d", "M 0 1 L 7 4 L 0 7 z");
        arrowPath.setAttribute("fill", "rgba(0, 92, 83, 0.75)");
        marker.append(arrowPath);
        defs.append(marker);
        orderOverlay.append(defs);

        for (let i = 0; i < siblings.length - 1; i++) {
          const a = siblings[i];
          const b = siblings[i + 1];
          const x1 = a.x0 + 10;
          const y1 = a.y0 + 10;
          const x2 = b.x0 + 10;
          const y2 = b.y0 + 10;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.hypot(dx, dy);
          if (dist < 14) continue;
          const padStart = 8;
          const padEnd = 10;
          const ux = dx / dist;
          const uy = dy / dist;
          const sx = x1 + ux * padStart;
          const sy = y1 + uy * padStart;
          const ex = x2 - ux * padEnd;
          const ey = y2 - uy * padEnd;

          const line = document.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(Math.round(sx)));
          line.setAttribute("y1", String(Math.round(sy)));
          line.setAttribute("x2", String(Math.round(ex)));
          line.setAttribute("y2", String(Math.round(ey)));
          line.setAttribute("class", "tm-seq-line");
          line.setAttribute("marker-end", "url(#tm-seq-arrow)");
          orderOverlay.append(line);
        }
      }
    }
    for (const s of siblings) {
      const el = tileElementsById.get(s.datum.id);
      if (el) el.classList.toggle("tm-tile--sibling-active", s.datum.id === hoveredId);
    }
  }

  stage.addEventListener("pointerleave", () => {
    clearSiblingSequence();
    hideTooltip();
  });

  function showTooltip(event: PointerEvent, tile: ComputedTreemapTile): void {
    tooltip.innerHTML = formatTooltipHtml(tile);
    tooltip.hidden = false;
    const hostRect = host.getBoundingClientRect();
    const x = Math.min(
      hostRect.width - 280,
      Math.max(8, event.clientX - hostRect.left + 14),
    );
    const y = Math.min(
      hostRect.height - 150,
      Math.max(8, event.clientY - hostRect.top + 14),
    );
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip(): void {
    tooltip.hidden = true;
  }

  function renderTileElement(
    tile: ComputedTreemapTile,
    state: TreemapRenderState,
  ): HTMLElement {
    const d = tile.datum;
    const rmAccent = RM_COLOR[d.rmType] ?? "#5c675f";
    const showOrder = !d.isGhost && tile.siblingCount > 1;

    const el = document.createElement("div");
    el.className = [
      "tm-tile",
      tile.isBlob
        ? "tm-tile--blob"
        : tile.isContainer
        ? "tm-tile--container"
        : "tm-tile--leaf",
      `tm-status--${d.status}`,
      `tm-depth--${Math.min(tile.depth, 4)}`,
      state.selectedBlockId === d.id ? "tm-tile--selected" : "",
    ].filter(Boolean).join(" ");
    el.dataset.blockId = d.id;
    el.dataset.rmType = d.rmType;
    el.dataset.status = d.status;
    if (showOrder) {
      el.dataset.siblingIndex = String(tile.siblingIndex);
      el.dataset.siblingCount = String(tile.siblingCount);
    }
    if (tile.parentId) {
      el.dataset.parentId = tile.parentId;
    }
    el.style.left = `${tile.x0}px`;
    el.style.top = `${tile.y0}px`;
    el.style.width = `${tile.cardW}px`;
    el.style.height = `${tile.cardH}px`;
    el.style.setProperty("--tm-rm-color", rmAccent);
    const orderAria = showOrder ? `, #${tile.siblingIndex} of ${tile.siblingCount}` : "";
    el.setAttribute(
      "aria-label",
      `${d.label} (${d.rmType}${orderAria}) — ${STATUS_LABEL[d.status]}`,
    );

    const isHeaderRow = tile.isContainer || tile.isBlob;
    const header = document.createElement("div");
    header.className = isHeaderRow ? "tm-header" : "tm-leaf-body";

    const orderBadge = showOrder ? document.createElement("span") : null;
    if (orderBadge) {
      orderBadge.className = "tm-order";
      orderBadge.setAttribute("aria-hidden", "true");
      orderBadge.textContent = String(tile.siblingIndex);
    }

    const glyph = document.createElement("span");
    glyph.className = "tm-status-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = STATUS_GLYPH[d.status];

    const title = document.createElement("span");
    title.className = "tm-title";
    title.textContent = d.label;

    if (isHeaderRow) {
      if (orderBadge) header.append(orderBadge);
      header.append(glyph, title);
      if (!d.isGhost && d.counts.totalLeaves > 0) {
        const stat = document.createElement("span");
        stat.className = "tm-stat";
        const done = d.counts.mappedLeaves + d.counts.aiDraftLeaves;
        stat.textContent = `${done}/${d.counts.totalLeaves}`;
        header.append(stat);
      }

      if (!d.isGhost && !tile.isBlob) {
        const actions = document.createElement("span");
        actions.className = "tm-header-actions";

        if (state.showAiBulkActions && d.counts.aiDraftLeaves > 0 && callbacks.onAiTriage) {
          const acceptBtn = document.createElement("button");
          acceptBtn.type = "button";
          acceptBtn.className = "tm-action-btn tm-action-btn--accept";
          acceptBtn.title = "Accept all AI drafts in this section";
          acceptBtn.textContent = "✓ AI";
          acceptBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            callbacks.onAiTriage?.(d.id, "accept", true);
          });
          actions.append(acceptBtn);
        }

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "tm-action-btn tm-open-blockly-btn";
        openBtn.title = `Open ${d.label} in Scoped Blockly`;
        openBtn.textContent = "Blockly ↗";
        openBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          callbacks.onOpenInBlockly(d.id);
        });
        actions.append(openBtn);

        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "tm-collapse-btn";
        collapseBtn.title = `Collapse ${d.label} to blob`;
        collapseBtn.setAttribute("aria-label", `Collapse ${d.label}`);
        collapseBtn.textContent = "−";
        collapseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          collapsedIds.add(d.id);
          if (lastState) paint(lastState);
        });
        actions.append(collapseBtn);

        header.append(actions);
      }
    } else {
      const topRow = document.createElement("div");
      topRow.className = "tm-leaf-row";
      if (orderBadge) topRow.append(orderBadge);
      topRow.append(glyph, title);
      header.append(topRow);
      if (d.mappingSummary) {
        const sub = document.createElement("div");
        sub.className = "tm-leaf-summary";
        sub.textContent = d.mappingSummary;
        header.append(sub);
      }
    }

    el.append(header);

    el.addEventListener("pointerenter", () => {
      if (showOrder) showSiblingSequence(tile.parentId, d.id);
      else clearSiblingSequence();
    });
    el.addEventListener("pointermove", (e) => showTooltip(e, tile));
    el.addEventListener("pointerleave", (e) => {
      hideTooltip();
      const next = e.relatedTarget as HTMLElement | null;
      if (!next || !next.closest(".tm-tile")) {
        clearSiblingSequence();
      }
    });

    if (d.isGhost) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onGhostClick?.(d, el);
      });
    } else if (tile.isBlob) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsedIds.has(d.id)) {
          collapsedIds.delete(d.id);
          if (lastState) paint(lastState);
        } else {
          callbacks.onZoomChange?.(d.id, el.getBoundingClientRect());
        }
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        callbacks.onOpenInBlockly(d.id);
      });
    } else if (tile.isContainer) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onZoomChange?.(d.id, el.getBoundingClientRect());
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        callbacks.onOpenInBlockly(d.id);
      });
    } else {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onLeafClick?.(d, el);
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        callbacks.onOpenInBlockly(d.id);
      });
    }

    return el;
  }

  function paint(state: TreemapRenderState): void {
    lastState = state;
    hideTooltip();
    clearSiblingSequence();

    // Measure the outer `host` (overflow: hidden) rather than `canvas` so
    // scrollbar appearance/disappearance cannot alter our input dimensions.
    const viewportW = Math.floor(host.clientWidth || canvas.clientWidth || 720);
    const viewportH = Math.floor(host.clientHeight || canvas.clientHeight || 420);
    lastHostW = viewportW;
    lastHostH = viewportH;

    const rootDatum = buildTreemapHierarchy(state.index, {
      zoomRootId: state.zoomRootId,
      sparseFullSkeleton: state.sparseFullSkeleton,
      filter: {
        query: state.query,
        statusFilter: state.statusFilter,
      },
    });

    if (!rootDatum || rootDatum.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "treemap-empty";
      empty.textContent = state.query || state.statusFilter !== "all"
        ? "No template nodes match the current search/filter."
        : "Load a target template to view its Treemap overview.";
      canvas.style.overflowX = "hidden";
      canvas.style.overflowY = "hidden";
      stage.style.width = "100%";
      stage.style.height = "100%";
      siblingsByParent = new Map();
      tileElementsById = new Map();
      orderOverlay = null;
      stage.replaceChildren(empty);
      return;
    }

    // At template root, cap depth at 3 (SECTION -> ENTRY -> CLUSTER blobs) for crisp overview;
    // when zoomed into a SECTION/ENTRY/CLUSTER, expand deeper to reveal all leaf ELEMENTs.
    const maxDepth = state.zoomRootId && state.zoomRootId !== state.index.compositionId ? 5 : 3;
    const sb = measureScrollbarSize();

    // Deterministic scrollbar decision: pack for full viewport first; if vertical
    // scrolling is needed on a classic-scrollbar platform, re-pack once for
    // `viewportW - sb` so horizontal content fits cleanly without triggering an X scrollbar.
    let layout = computeCascadedTreemapLayout(
      rootDatum,
      Math.max(320, viewportW),
      Math.max(220, viewportH),
      { maxDepth, collapsedIds },
    );
    let needsV = layout.naturalHeight > viewportH;
    if (needsV && sb > 0 && viewportW - sb >= 320) {
      layout = computeCascadedTreemapLayout(
        rootDatum,
        viewportW - sb,
        Math.max(220, viewportH),
        { maxDepth, collapsedIds },
      );
      needsV = layout.naturalHeight > viewportH;
    }
    const innerW = needsV ? Math.max(320, viewportW - sb) : Math.max(320, viewportW);
    const needsH = layout.naturalWidth > innerW;
    if (needsH && !needsV && sb > 0 && layout.naturalHeight > Math.max(220, viewportH - sb)) {
      needsV = true;
      if (viewportW - sb >= 320) {
        layout = computeCascadedTreemapLayout(
          rootDatum,
          viewportW - sb,
          Math.max(220, viewportH - sb),
          { maxDepth, collapsedIds },
        );
      }
    }

    canvas.style.overflowX = needsH ? "auto" : "hidden";
    canvas.style.overflowY = needsV ? "auto" : "hidden";
    stage.style.width = needsH ? `${layout.naturalWidth}px` : "100%";
    stage.style.height = needsV ? `${layout.naturalHeight}px` : "100%";

    siblingsByParent = new Map();
    tileElementsById = new Map();

    const frag = document.createDocumentFragment();
    for (const tile of layout.tiles) {
      if (!tile.datum.isGhost && tile.siblingCount > 1 && tile.parentId) {
        const list = siblingsByParent.get(tile.parentId);
        if (list) list.push(tile);
        else siblingsByParent.set(tile.parentId, [tile]);
      }
      const tileEl = renderTileElement(tile, state);
      tileElementsById.set(tile.datum.id, tileEl);
      frag.append(tileEl);
    }

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tm-order-overlay");
    svg.setAttribute("aria-hidden", "true");
    orderOverlay = svg;
    frag.append(svg);

    stage.replaceChildren(frag);
  }

  function animateZoom(direction: "in" | "out"): void {
    stage.classList.remove("treemap-stage--zoom-in", "treemap-stage--zoom-out");
    // Force reflow so rapid consecutive zooms re-trigger CSS keyframe animation.
    void stage.offsetWidth;
    stage.classList.add(
      direction === "in" ? "treemap-stage--zoom-in" : "treemap-stage--zoom-out",
    );
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
  }

  return {
    render: paint,
    animateZoom,
    destroy() {
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      resizeObserver?.disconnect();
      host.replaceChildren();
    },
  };
}
