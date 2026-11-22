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
  onZoomChange?: (zoomRootId: string | null) => void;
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
  destroy(): void;
}

function formatTooltipHtml(d: TreemapDatum): string {
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const lines: string[] = [
    `<div class="tm-tip-title">${esc(d.label)} <span class="tm-tip-rm">${esc(d.rmType)}</span></div>`,
  ];
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
  const collapsedIds = new Set<string>();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (lastState) paint(lastState);
    });
    resizeObserver.observe(canvas);
  }

  function showTooltip(event: PointerEvent, datum: TreemapDatum): void {
    tooltip.innerHTML = formatTooltipHtml(datum);
    tooltip.hidden = false;
    const hostRect = host.getBoundingClientRect();
    const x = Math.min(
      hostRect.width - 280,
      Math.max(8, event.clientX - hostRect.left + 14),
    );
    const y = Math.min(
      hostRect.height - 140,
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
    el.style.left = `${tile.x0}px`;
    el.style.top = `${tile.y0}px`;
    el.style.width = `${tile.cardW}px`;
    el.style.height = `${tile.cardH}px`;
    el.style.setProperty("--tm-rm-color", rmAccent);
    el.setAttribute(
      "aria-label",
      `${d.label} (${d.rmType}) — ${STATUS_LABEL[d.status]}`,
    );

    const isHeaderRow = tile.isContainer || tile.isBlob;
    const header = document.createElement("div");
    header.className = isHeaderRow ? "tm-header" : "tm-leaf-body";

    const glyph = document.createElement("span");
    glyph.className = "tm-status-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = STATUS_GLYPH[d.status];

    const title = document.createElement("span");
    title.className = "tm-title";
    title.textContent = d.label;

    if (isHeaderRow) {
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

    el.addEventListener("pointermove", (e) => showTooltip(e, d));
    el.addEventListener("pointerleave", hideTooltip);

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
          callbacks.onZoomChange?.(d.id);
        }
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        callbacks.onOpenInBlockly(d.id);
      });
    } else if (tile.isContainer) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onZoomChange?.(d.id);
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

    const width = Math.max(320, Math.floor(canvas.clientWidth || host.clientWidth || 720));
    const height = Math.max(220, Math.floor(canvas.clientHeight || host.clientHeight || 420));

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
      stage.style.width = "100%";
      stage.style.height = "100%";
      stage.replaceChildren(empty);
      return;
    }

    // At template root, cap depth at 3 (SECTION -> ENTRY -> CLUSTER blobs) for crisp overview;
    // when zoomed into a SECTION/ENTRY/CLUSTER, expand deeper to reveal all leaf ELEMENTs.
    const maxDepth = state.zoomRootId && state.zoomRootId !== state.index.compositionId ? 5 : 3;
    const { tiles, contentWidth, contentHeight } = computeCascadedTreemapLayout(
      rootDatum,
      width,
      height,
      { maxDepth, collapsedIds },
    );

    stage.style.width = `${contentWidth}px`;
    stage.style.height = `${contentHeight}px`;

    const frag = document.createDocumentFragment();
    for (const tile of tiles) {
      frag.append(renderTileElement(tile, state));
    }
    stage.replaceChildren(frag);
  }

  return {
    render: paint,
    destroy() {
      resizeObserver?.disconnect();
      host.replaceChildren();
    },
  };
}
