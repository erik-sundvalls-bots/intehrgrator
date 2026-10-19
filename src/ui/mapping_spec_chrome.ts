/**
 * Mapping Spec root layout chrome: list vs tabbed view, root tab bar.
 */
import { projectBlocklyState } from "../workbench/mapping_spec/project.ts";
import { installAnchoredMenu, type AnchoredMenuHandle } from "./anchored_menu.ts";

export type SpecRootLayout = "list" | "tabs";

const STORAGE_KEY = "intehrgrator-spec-root-layout";

export interface SpecRootTab {
  id: string;
  label: string;
}

export function loadSpecRootLayout(): SpecRootLayout {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "tabs" ? "tabs" : "list";
}

export function saveSpecRootLayout(layout: SpecRootLayout): void {
  localStorage.setItem(STORAGE_KEY, layout);
}

export function specRootTabsFromBlockly(blocklyState: unknown): SpecRootTab[] {
  const projection = projectBlocklyState(blocklyState);
  const tabs: SpecRootTab[] = [];
  const seen = new Set<string>();
  for (const line of projection.lines) {
    if (line.kind !== "header" || !line.rootId || seen.has(line.rootId)) continue;
    if (line.type === "conversion_start") continue;
    seen.add(line.rootId);
    tabs.push({ id: line.rootId, label: line.label || line.type });
  }
  return tabs;
}

export function mountMappingSpecChrome(
  specEditorHost: HTMLElement,
  options: {
    getBlocklyState: () => unknown;
    onLayoutChange: (layout: SpecRootLayout, activeRootId: string | null) => void;
  },
): {
  refresh: () => void;
  getLayout: () => SpecRootLayout;
  getActiveRootId: () => string | null;
  setActiveRootId: (rootId: string) => boolean;
  setLayout: (layout: SpecRootLayout) => void;
} {
  let layout = loadSpecRootLayout();
  let activeRootId: string | null = null;

  const rootTabsEl = document.createElement("div");
  rootTabsEl.className = "spec-root-tabs";
  rootTabsEl.hidden = layout !== "tabs";
  specEditorHost.parentElement?.insertBefore(rootTabsEl, specEditorHost);

  const refresh = (): void => {
    const tabs = specRootTabsFromBlockly(options.getBlocklyState());
    rootTabsEl.hidden = layout !== "tabs" || tabs.length <= 1;
    rootTabsEl.replaceChildren();
    if (layout !== "tabs" || tabs.length <= 1) {
      activeRootId = null;
      options.onLayoutChange(layout, null);
      return;
    }
    if (!activeRootId || !tabs.some((t) => t.id === activeRootId)) {
      activeRootId = tabs[0]?.id ?? null;
    }
    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spec-root-tab" + (tab.id === activeRootId ? " active" : "");
      btn.textContent = tab.label;
      btn.title = tab.label;
      btn.addEventListener("click", () => {
        activeRootId = tab.id;
        refresh();
      });
      rootTabsEl.append(btn);
    }
    options.onLayoutChange(layout, activeRootId);
  };

  return {
    refresh,
    getLayout: () => layout,
    getActiveRootId: () => activeRootId,
    /** Show this canvas root's tab (tabbed layout). Returns whether it changed. */
    setActiveRootId: (rootId) => {
      if (layout !== "tabs" || activeRootId === rootId) return false;
      const tabs = specRootTabsFromBlockly(options.getBlocklyState());
      if (!tabs.some((t) => t.id === rootId)) return false;
      activeRootId = rootId;
      refresh();
      return true;
    },
    setLayout: (next) => {
      layout = next;
      saveSpecRootLayout(next);
      refresh();
    },
  };
}

/** Mapping Spec ▾ uses the same anchored split-button menu as Example Sets. */
export function installSpecLayoutMenu(options: {
  chevron: HTMLElement;
  main: HTMLElement;
  menu: HTMLElement;
  onLayout: (layout: SpecRootLayout) => void;
}): AnchoredMenuHandle {
  const handle = installAnchoredMenu({
    menu: options.menu,
    trigger: options.chevron,
    roots: [options.main],
    referenceEls: [options.main, options.chevron],
    minWidth: options.main.parentElement ?? options.chevron,
  });
  for (const item of options.menu.querySelectorAll<HTMLButtonElement>("[data-spec-layout]")) {
    item.classList.add("split-btn-menu-item");
    item.addEventListener("click", () => {
      const layout = item.dataset.specLayout;
      if (layout !== "list" && layout !== "tabs") return;
      handle.close();
      options.onLayout(layout);
    });
  }
  return handle;
}
