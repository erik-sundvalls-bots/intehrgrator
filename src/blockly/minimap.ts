import type { WorkspaceSvg } from "blockly/core";
import * as MinimapNs from "@blockly/workspace-minimap";
import { Blockly } from "./blockly_core.ts";
import {
  copyWorkspaceState,
  setAfterBlocklyEventsEnabled,
} from "./blockly_events.ts";
import { initSplitGroup } from "../ui/split_pane.ts";

// Deno/CJS interop: the plugin is a CJS bundle; esbuild sees named exports.
// deno-lint-ignore no-explicit-any
const minimapMod = MinimapNs as any;
const Minimap: typeof MinimapNs.Minimap =
  minimapMod.Minimap ?? minimapMod.default?.Minimap;

const TOOLBOX_FOOT_CLASS = "blockly-toolbox-foot";
const TOOLBOX_RAIL_STORAGE = "layout-toolbox-rail";
/** Category drawers get this share of the toolbox rail by default. */
const TOOLBOX_CONTENTS_FRAC = 2 / 3;
/** Search + a peek of the minimap; drawers keep the rest. */
const TOOLBOX_RAIL_MIN_PX = 64;

function defaultContentsFrac(toolboxEl: HTMLElement, contents: HTMLElement): number {
  const total = toolboxEl.clientHeight;
  if (total <= 0) return TOOLBOX_CONTENTS_FRAC;
  const minFrac = TOOLBOX_RAIL_MIN_PX / total;
  const needed = contents.scrollHeight / total;
  return Math.min(
    Math.max(TOOLBOX_CONTENTS_FRAC, needed),
    Math.max(minFrac, 1 - minFrac),
  );
}

function searchRowOf(toolboxEl: HTMLElement): HTMLElement | null {
  return toolboxEl.querySelector(
    ".blocklyToolboxCategorySearch, .blocklyToolboxCategory:has(input[type='search'])",
  );
}

function ensureToolboxFoot(
  toolboxEl: HTMLElement,
  wrapper: HTMLElement,
): HTMLElement {
  const existing = toolboxEl.querySelector(`:scope > .${TOOLBOX_FOOT_CLASS}`);
  const foot = existing instanceof HTMLElement ? existing : document.createElement("div");
  if (foot.className !== TOOLBOX_FOOT_CLASS) {
    foot.className = TOOLBOX_FOOT_CLASS;
  }
  if (foot.parentElement !== toolboxEl) {
    toolboxEl.appendChild(foot);
  }

  const searchRow = searchRowOf(toolboxEl);
  if (searchRow && searchRow.parentElement !== foot) {
    foot.insertBefore(searchRow, wrapper.parentElement === foot ? wrapper : null);
  }
  if (wrapper.parentElement !== foot) {
    foot.appendChild(wrapper);
  } else if (searchRow && searchRow.nextElementSibling !== wrapper) {
    foot.insertBefore(searchRow, wrapper);
  }
  return foot;
}

/**
 * Official Blockly minimap, reparented into the toolbox rail as its last
 * child so it cannot sit under `.blocklyToolboxDiv` (z-index 70) or cover
 * the canvas. Always shown: once docked in the toolbox it does not steal
 * workspace area.
 *
 * Search + minimap share a resizable foot under the category drawers. The
 * drawers keep 2/3 of the rail by default so all block categories stay
 * reachable without scrolling, while a slice of minimap remains visible.
 *
 * The plugin only mirrors BLOCK_* events. Template scaffolding and the
 * Defaults Map are created with events disabled, so we snapshot-copy the
 * primary workspace after those bulk loads.
 */
class DockedMinimap extends Minimap {
  private splitDispose: (() => void) | null = null;
  private splitContents: HTMLElement | null = null;
  private splitFoot: HTMLElement | null = null;

  syncFromPrimary(): void {
    const mini = this.minimapWorkspace;
    if (!mini) return;
    copyWorkspaceState(this.primaryWorkspace, mini);
    mini.zoomToFit();
    this.repositionFocus();
  }

  /**
   * Size the viewport highlight after both workspaces have blocks.
   * FocusRegion.update divides by the minimap content width; calling it
   * while that width is still 0 sets NaN on the highlight rect.
   */
  private repositionFocus(): void {
    const mini = this.minimapWorkspace;
    const region = this.focusRegion as { update?: () => void } | null;
    if (!mini || !region?.update) return;
    const primaryWidth = this.primaryWorkspace.getMetrics?.()?.contentWidth ?? 0;
    const miniWidth = mini.getMetrics?.()?.contentWidth ?? 0;
    if (!(primaryWidth > 0) || !(miniWidth > 0)) return;
    region.update();
  }

  layoutInToolbox(mount: HTMLElement): void {
    const toolboxEl = mount.querySelector(".blocklyToolboxDiv");
    const wrapper = this.minimapWrapper;
    if (!(toolboxEl instanceof HTMLElement) || !wrapper) return;

    const contents = toolboxEl.querySelector(":scope > .blocklyToolboxContents");
    const foot = ensureToolboxFoot(toolboxEl, wrapper);
    if (contents instanceof HTMLElement) {
      this.ensureRailSplit(toolboxEl, contents, foot, mount);
    }

    this.syncMinimapSize(mount, toolboxEl);
  }

  private ensureRailSplit(
    toolboxEl: HTMLElement,
    contents: HTMLElement,
    foot: HTMLElement,
    mount: HTMLElement,
  ): void {
    if (
      this.splitDispose &&
      this.splitContents === contents &&
      this.splitFoot === foot
    ) {
      return;
    }
    this.splitDispose?.();
    const contentsFrac = defaultContentsFrac(toolboxEl, contents);
    this.splitDispose = initSplitGroup(toolboxEl, "column", {
      panes: [contents, foot],
      sizes: [contentsFrac, 1 - contentsFrac],
      minSize: TOOLBOX_RAIL_MIN_PX,
      storageKey: TOOLBOX_RAIL_STORAGE,
      preferredIndex: 0,
      preferredMinFrac: TOOLBOX_CONTENTS_FRAC,
      onResize: () => this.syncMinimapSize(mount, toolboxEl),
    });
    this.splitContents = contents;
    this.splitFoot = foot;
    const handle = toolboxEl.querySelector(":scope > .split-handle");
    handle?.setAttribute("aria-label", "Resize block drawers");
  }

  private syncMinimapSize(mount: HTMLElement, toolboxEl: HTMLElement): void {
    const wrapper = this.minimapWrapper;
    const toolbox = this.primaryWorkspace.getToolbox?.();
    const width = Math.round(
      (typeof toolbox?.getWidth === "function" ? toolbox.getWidth() : 0) ||
        toolboxEl.offsetWidth ||
        0,
    );
    if (width > 0) {
      mount.style.setProperty("--blockly-minimap-width", `${width}px`);
    }
    const height = Math.round(wrapper?.clientHeight || 0);
    if (height > 0) {
      mount.style.setProperty("--blockly-minimap-height", `${height}px`);
    }
    if (this.minimapWorkspace) {
      Blockly.svgResize(this.minimapWorkspace);
      this.minimapWorkspace.zoomToFit();
    }
  }
}

type AttachedMinimap = {
  minimap: DockedMinimap;
  workspace: WorkspaceSvg;
  mount: HTMLElement;
};

let attached: AttachedMinimap | null = null;

export function attachWorkspaceMinimap(
  workspace: WorkspaceSvg,
  mount: HTMLElement,
): void {
  // Init paints the focus highlight immediately. A primary workspace that
  // already has blocks and an empty minimap makes that highlight NaN.
  const saved = Blockly.serialization.workspaces.save(workspace);
  const hadBlocks = workspace.getAllBlocks(false).length > 0;
  if (hadBlocks) {
    Blockly.Events.disable();
    try {
      workspace.clear();
    } finally {
      Blockly.Events.enable();
    }
  }
  const minimap = new DockedMinimap(workspace);
  minimap.init();
  attached = { minimap, workspace, mount };
  if (hadBlocks) {
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(saved, workspace);
    } finally {
      Blockly.Events.enable();
    }
  }
  setAfterBlocklyEventsEnabled(refreshWorkspaceMinimap);
  mount.classList.remove("blockly-minimap-hidden");

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      minimap.layoutInToolbox(mount);
    });
    observer.observe(mount);
  }
  minimap.syncFromPrimary();
  minimap.layoutInToolbox(mount);
}

/** Re-copy primary blocks into the minimap and re-dock under the toolbox. */
export function refreshWorkspaceMinimap(): void {
  if (!attached) return;
  attached.minimap.syncFromPrimary();
  attached.minimap.layoutInToolbox(attached.mount);
}
