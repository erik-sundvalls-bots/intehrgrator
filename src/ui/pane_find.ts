/**
 * #218: find-in-pane for the non-CodeMirror panes (Source Schema tree,
 * Example Instances tree, Target Schema tree, Mapping canvas).
 *
 * Same UX as the #208/#215 CodeMirror find: a find panel docked at the top
 * of the pane (match case / regexp / by word, next / previous), every hit
 * highlighted as a substring, the first hit auto-selected, Enter / Shift+Enter
 * to step, Escape to close, Ctrl/Cmd+F to open from inside the pane. The
 * Search entry point is the same semi-transparent upper-right overlay button
 * that #246 put inside every CodeMirror editor.
 */
import type { ChromeMessages } from "./chrome_en.ts";
import { chrome } from "./chrome_i18n.ts";
import { iconSvg, SEARCH_PATH } from "./editor_action_toolbar.ts";
import {
  findHits,
  formatFindCount,
  type PaneFindHit,
  type PaneFindQuery,
  pickCurrentAfterRefresh,
  stepIndex,
} from "./pane_find_core.ts";

/** A resolved hit handed to the adapter: `unit` is the adapter's own unit. */
export type PaneFindMatch<U> = { unit: U; from: number; to: number };

/** Pane-specific part: what text exists, how to paint and reveal hits. */
export interface PaneFindAdapter<U> {
  /** Searchable units in reading order. */
  collect(): U[];
  text(unit: U): string;
  paint(matches: PaneFindMatch<U>[], current: number): void;
  clear(): void;
  /** Bring the current hit into view (and select it, where that means something). */
  reveal(match: PaneFindMatch<U>): void;
  /** Call `changed` whenever the pane content re-renders; returns an unsubscribe. */
  watch(changed: () => void): () => void;
}

export type PaneFindOptions<U> = {
  /** Positioned element that receives the docked panel and the overlay button. */
  host: HTMLElement;
  /** Element the panel is inserted before (docked layout); omit for an absolutely placed panel. */
  dockBefore?: HTMLElement;
  /** Element whose vertical scrollbar the overlay button keeps clear of. */
  scroller?: HTMLElement;
  /** Extra left inset for an absolutely placed panel (e.g. the Blockly toolbox width). */
  panelLeft?: () => number;
  /** Pane identifier (`data-pane-find`, highlight names, tests). */
  id: string;
  titleKey: keyof ChromeMessages;
  locale: () => string;
  adapter: PaneFindAdapter<U>;
};

export type PaneFind = {
  open(): void;
  close(): void;
  isOpen(): boolean;
  next(): void;
  previous(): void;
  /** Re-run the search (content changed outside the adapter's watch). */
  refresh(): void;
  readonly panel: HTMLElement;
  readonly button: HTMLButtonElement;
};

const OVERLAY_INSET = 4;
const registry: Array<{ find: PaneFind; region: HTMLElement }> = [];

function t(locale: string, key: keyof ChromeMessages): string {
  return chrome(locale)[key];
}

function stopPointer(el: HTMLElement): void {
  // Keep Blockly from starting a canvas drag / stealing focus.
  el.addEventListener("pointerdown", (event) => event.stopPropagation());
  el.addEventListener("mousedown", (event) => event.stopPropagation());
  el.addEventListener("wheel", (event) => event.stopPropagation());
}

export function createPaneFind<U>(options: PaneFindOptions<U>): PaneFind {
  const { host, adapter } = options;
  host.classList.add("pane-find-host");

  const panel = document.createElement("div");
  panel.className = "pane-find-panel";
  panel.hidden = true;
  panel.dataset.paneFind = options.id;
  panel.setAttribute("role", "search");
  panel.setAttribute("data-i18n-aria", options.titleKey);
  if (!options.dockBefore) panel.classList.add("pane-find-panel--floating");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "pane-find-input";
  input.setAttribute("data-i18n-placeholder", "paneFindPlaceholder");
  input.setAttribute("data-i18n-aria", "paneFindPlaceholder");
  input.spellcheck = false;
  input.autocomplete = "off";

  const textButton = (role: string, key: keyof ChromeMessages) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pane-find-btn";
    btn.dataset.findAction = role;
    btn.setAttribute("data-i18n", key);
    return btn;
  };
  const nextBtn = textButton("next", "paneFindNext");
  const prevBtn = textButton("previous", "paneFindPrevious");

  const option = (role: string, key: keyof ChromeMessages) => {
    const label = document.createElement("label");
    label.className = "pane-find-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.findOption = role;
    const text = document.createElement("span");
    text.setAttribute("data-i18n", key);
    label.append(box, text);
    return { label, box };
  };
  const caseOpt = option("case", "paneFindMatchCase");
  const regexpOpt = option("regexp", "paneFindRegexp");
  const wordOpt = option("word", "paneFindByWord");

  const count = document.createElement("span");
  count.className = "pane-find-count";
  count.setAttribute("aria-live", "polite");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pane-find-close";
  closeBtn.dataset.findAction = "close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("data-i18n-aria", "paneFindClose");
  closeBtn.setAttribute("data-i18n-title", "paneFindClose");

  panel.append(
    input,
    nextBtn,
    prevBtn,
    caseOpt.label,
    regexpOpt.label,
    wordOpt.label,
    count,
    closeBtn,
  );
  stopPointer(panel);

  const toolbar = document.createElement("div");
  toolbar.className = "editor-action-toolbar editor-action-toolbar--overlay pane-find-overlay";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("data-i18n-aria", options.titleKey);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pane-btn pane-btn-icon editor-action-btn";
  button.dataset.editorAction = "search";
  button.dataset.paneFind = options.id;
  button.setAttribute("data-i18n-title", options.titleKey);
  button.setAttribute("data-i18n-aria", options.titleKey);
  button.append(iconSvg(SEARCH_PATH));
  toolbar.append(button);
  stopPointer(toolbar);

  if (options.dockBefore) host.insertBefore(panel, options.dockBefore);
  else host.append(panel);
  host.append(toolbar);

  const applyLabels = () => {
    const locale = options.locale();
    const title = t(locale, options.titleKey);
    panel.setAttribute("aria-label", title);
    toolbar.setAttribute("aria-label", title);
    button.title = title;
    button.setAttribute("aria-label", title);
    input.placeholder = t(locale, "paneFindPlaceholder");
    input.setAttribute("aria-label", t(locale, "paneFindPlaceholder"));
    nextBtn.textContent = t(locale, "paneFindNext");
    prevBtn.textContent = t(locale, "paneFindPrevious");
    for (const [opt, key] of [
      [caseOpt, "paneFindMatchCase"],
      [regexpOpt, "paneFindRegexp"],
      [wordOpt, "paneFindByWord"],
    ] as const) {
      opt.label.querySelector("span")!.textContent = t(locale, key);
    }
    closeBtn.title = t(locale, "paneFindClose");
    closeBtn.setAttribute("aria-label", t(locale, "paneFindClose"));
  };
  applyLabels();

  const place = () => {
    const top = panel.hidden || !options.dockBefore ? 0 : panel.offsetHeight;
    const floatingTop = !panel.hidden && !options.dockBefore ? panel.offsetHeight : 0;
    const scroller = options.scroller;
    const scrollbar = scroller ? Math.max(0, scroller.offsetWidth - scroller.clientWidth) : 0;
    toolbar.style.top = `${top + floatingTop + OVERLAY_INSET + 1}px`;
    toolbar.style.right = `${scrollbar + OVERLAY_INSET + 1}px`;
    if (!options.dockBefore) panel.style.left = `${options.panelLeft?.() ?? 0}px`;
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => place());
    ro.observe(host);
    ro.observe(panel);
    if (options.scroller) ro.observe(options.scroller);
  }

  let units: U[] = [];
  let hits: PaneFindHit[] = [];
  let current = -1;
  let unwatch: (() => void) | null = null;

  const query = (): PaneFindQuery => ({
    search: input.value,
    caseSensitive: caseOpt.box.checked,
    regexp: regexpOpt.box.checked,
    wholeWord: wordOpt.box.checked,
  });
  const matchAt = (i: number): PaneFindMatch<U> | null => {
    const h = hits[i];
    return h ? { unit: units[h.unit], from: h.from, to: h.to } : null;
  };
  const updateCount = (invalid: boolean) => {
    const locale = options.locale();
    count.textContent = !input.value
      ? ""
      : invalid
      ? t(locale, "paneFindInvalidRegexp")
      : formatFindCount(current, hits.length, t(locale, "paneFindCount"), t(locale, "paneFindNoMatches"));
    panel.classList.toggle("pane-find-panel--none", !!input.value && hits.length === 0);
  };
  const paint = () => {
    adapter.clear();
    if (hits.length) {
      adapter.paint(hits.map((_, i) => matchAt(i)!), current);
    }
  };
  /** Re-collect and re-match; `reveal` scrolls to the current hit when it moved. */
  const run = (reveal: boolean) => {
    if (panel.hidden) return;
    const before = hits;
    const beforeIndex = current;
    const beforeHit = before[beforeIndex];
    units = adapter.collect();
    const next = findHits(units.map((u) => adapter.text(u)), query());
    hits = next ?? [];
    current = pickCurrentAfterRefresh(before, beforeIndex, hits);
    paint();
    updateCount(next === null);
    const now = hits[current];
    const moved = !!now && (!beforeHit || now.unit !== beforeHit.unit || now.from !== beforeHit.from ||
      now.to !== beforeHit.to);
    if (reveal && now && moved) adapter.reveal(matchAt(current)!);
  };
  // Adapters call this after the pane re-rendered (tree: MutationObserver
  // microtask, so the new DOM is complete and no stale frame is painted).
  const refreshAfterRender = () => run(false);
  const step = (dir: 1 | -1) => {
    if (panel.hidden) open();
    if (!hits.length) {
      run(true);
      return;
    }
    current = stepIndex(hits.length, current, dir);
    paint();
    updateCount(false);
    adapter.reveal(matchAt(current)!);
  };

  function open(): void {
    const wasHidden = panel.hidden;
    applyLabels();
    panel.hidden = false;
    host.classList.add("pane-find-host--open");
    place();
    if (wasHidden) {
      unwatch = adapter.watch(refreshAfterRender);
      hits = [];
      current = -1;
      run(true);
    }
    input.focus();
    input.select();
  }
  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    host.classList.remove("pane-find-host--open");
    unwatch?.();
    unwatch = null;
    adapter.clear();
    hits = [];
    current = -1;
    place();
  }

  input.addEventListener("input", () => run(true));
  for (const box of [caseOpt.box, regexpOpt.box, wordOpt.box]) {
    box.addEventListener("change", () => run(true));
  }
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "F3") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    // Keep Blockly's workspace shortcuts (Delete, Ctrl+Z …) away from the find input.
    event.stopPropagation();
  });
  nextBtn.addEventListener("click", () => step(1));
  prevBtn.addEventListener("click", () => step(-1));
  closeBtn.addEventListener("click", () => close());
  button.addEventListener("click", () => open());

  const find: PaneFind = {
    open,
    close,
    isOpen: () => !panel.hidden,
    next: () => step(1),
    previous: () => step(-1),
    refresh: () => run(false),
    panel,
    button,
  };
  registry.push({ find, region: host });
  installShortcut();
  place();
  return find;
}

let shortcutInstalled = false;
let lastPointerRegion: HTMLElement | null = null;

function regionOf(node: Node | null): { find: PaneFind; region: HTMLElement } | null {
  if (!node) return null;
  return registry.find((r) => r.region.contains(node)) ?? null;
}

/** Text editors keep their own Ctrl/Cmd+F (CodeMirror find, browser inputs). */
function ownsFindShortcut(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest(".pane-find-panel")) return false;
  if (el.closest(".cm-editor")) return true;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable === true;
}

function installShortcut(): void {
  if (shortcutInstalled || typeof document === "undefined") return;
  shortcutInstalled = true;
  document.addEventListener("pointerdown", (event) => {
    lastPointerRegion = regionOf(event.target as Node)?.region ?? null;
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const active = document.activeElement;
    if (ownsFindShortcut(active)) return;
    const hit = regionOf(active && active !== document.body ? active : null) ??
      registry.find((r) => r.region === lastPointerRegion && r.region.isConnected) ?? null;
    if (!hit || !isShown(hit.region)) return;
    event.preventDefault();
    event.stopPropagation();
    hit.find.open();
  }, true);
}

function isShown(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ---------------------------------------------------------------------------
// DOM tree adapter (Source Schema, Example Instances, Target Schema trees)

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!css?.highlights || typeof Highlight !== "function") return null;
  return { registry: css.highlights, Highlight };
}

const injectedHighlightStyles = new Set<string>();

function ensureHighlightStyle(id: string): void {
  if (injectedHighlightStyles.has(id)) return;
  injectedHighlightStyles.add(id);
  const style = document.createElement("style");
  style.dataset.paneFindHighlight = id;
  style.textContent = `::highlight(pane-find-${id}){background-color:#ffe200;color:#111}` +
    `::highlight(pane-find-${id}-current){background-color:#e65100;color:#fff}`;
  document.head.append(style);
}

/** Keep `rect` visible inside `scroller` without scrolling the page. */
function scrollIntoScroller(scroller: HTMLElement, rect: DOMRect): void {
  const box = scroller.getBoundingClientRect();
  const margin = 24;
  if (rect.top < box.top + margin || rect.bottom > box.bottom - margin) {
    scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
  }
  if (rect.left < box.left || rect.right > box.right) {
    scroller.scrollLeft += rect.left - box.left - margin;
  }
}

/**
 * Tree panes: every text node inside a `.tree-label` (names, RM types,
 * occurrences, instance values) is searchable. Hits are painted with the CSS
 * Custom Highlight API (no DOM changes, so tree click / drag wiring is left
 * alone); without it the matching rows get a wash instead.
 */
export function treeFindAdapter(tree: HTMLElement, id: string): PaneFindAdapter<Text> {
  const rowClasses = ["pane-find-row-hit", "pane-find-row-current"];
  return {
    collect() {
      const out: Text[] = [];
      const walker = document.createTreeWalker(tree, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest(".tree-label") && node.nodeValue
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
      return out;
    },
    text: (unit) => unit.nodeValue ?? "",
    paint(matches, current) {
      const api = highlightApi();
      const range = (m: PaneFindMatch<Text>) => {
        const r = document.createRange();
        r.setStart(m.unit, m.from);
        r.setEnd(m.unit, m.to);
        return r;
      };
      if (api) {
        ensureHighlightStyle(id);
        api.registry.set(
          `pane-find-${id}`,
          new api.Highlight(...matches.filter((_, i) => i !== current).map(range)),
        );
        if (matches[current]) {
          api.registry.set(`pane-find-${id}-current`, new api.Highlight(range(matches[current])));
        }
      }
      matches.forEach((m, i) => {
        const row = m.unit.parentElement?.closest(".tree-row");
        row?.classList.add(i === current ? rowClasses[1] : rowClasses[0]);
      });
    },
    clear() {
      const api = highlightApi();
      api?.registry.delete(`pane-find-${id}`);
      api?.registry.delete(`pane-find-${id}-current`);
      for (const cls of rowClasses) {
        for (const el of Array.from(tree.querySelectorAll(`.${cls}`))) el.classList.remove(cls);
      }
    },
    reveal(match) {
      const r = document.createRange();
      r.setStart(match.unit, match.from);
      r.setEnd(match.unit, match.to);
      scrollIntoScroller(tree, r.getBoundingClientRect());
    },
    watch(changed) {
      const observer = new MutationObserver(() => changed());
      observer.observe(tree, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    },
  };
}

/**
 * Wrap a tree pane so the find panel docks above it and the Search overlay
 * sits in its upper-right corner (same placement as the CodeMirror overlay).
 */
export function installTreePaneFind(
  tree: HTMLElement,
  id: string,
  titleKey: keyof ChromeMessages,
  locale: () => string,
): PaneFind {
  const host = document.createElement("div");
  host.className = "pane-find-host pane-find-host--tree";
  tree.parentElement!.insertBefore(host, tree);
  host.append(tree);
  return createPaneFind({
    host,
    dockBefore: tree,
    scroller: tree,
    id,
    titleKey,
    locale,
    adapter: treeFindAdapter(tree, id),
  });
}
