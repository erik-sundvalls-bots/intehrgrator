/**
 * Shared Search / Copy / Download icon toolbar for CodeMirror editor hosts.
 */
import { openSearchPanel } from "@codemirror/search";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ChromeMessages } from "./chrome_en.ts";
import { chrome } from "./chrome_i18n.ts";

const COPY_PATH =
  "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z";
const CHECK_PATH = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";

const SEARCH_PATH =
  "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";

const COPY_FEEDBACK_MS = 1800;
/** Gap between the overlay and the editor's top / right edge (px). */
const OVERLAY_INSET = 4;

export type EditorActionI18nKeys = {
  searchTitle: keyof ChromeMessages;
  searchAria: keyof ChromeMessages;
  copyTitle: keyof ChromeMessages;
  copyAria: keyof ChromeMessages;
  downloadTitle: keyof ChromeMessages;
  downloadAria: keyof ChromeMessages;
};

export type WireEditorActionToolbarOptions = {
  toolbar: HTMLElement;
  view: EditorView;
  /** Copy full editor document text (or a caller-chosen payload). */
  copyText: (text: string) => Promise<void>;
  /** When omitted, Copy uses `view.state.doc.toString()`. */
  getCopyText?: () => string;
  onDownload: () => void;
  locale: () => string;
  i18n: EditorActionI18nKeys;
};

function iconSvg(pathD: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  svg.append(path);
  return svg;
}

function setIcon(btn: HTMLButtonElement, pathD: string): void {
  btn.replaceChildren(iconSvg(pathD));
}

function labelFor(locale: string, key: keyof ChromeMessages): string {
  return chrome(locale)[key];
}

/**
 * Wire Search / Copy / Download buttons already present under `.editor-action-toolbar`.
 * Buttons are matched by `data-editor-action` (`search` | `copy` | `download`).
 */
export function wireEditorActionToolbar(
  options: WireEditorActionToolbarOptions,
): { downloadButton: HTMLButtonElement } {
  const searchBtn = options.toolbar.querySelector<HTMLButtonElement>(
    '[data-editor-action="search"]',
  );
  const copyBtn = options.toolbar.querySelector<HTMLButtonElement>(
    '[data-editor-action="copy"]',
  );
  const downloadBtn = options.toolbar.querySelector<HTMLButtonElement>(
    '[data-editor-action="download"]',
  );
  if (!searchBtn || !copyBtn || !downloadBtn) {
    throw new Error("editor-action-toolbar: missing search/copy/download button");
  }

  searchBtn.addEventListener("click", () => {
    options.view.focus();
    openSearchPanel(options.view);
  });

  let copyResetTimer: number | undefined;
  copyBtn.addEventListener("click", () => {
    void (async () => {
      const text = options.getCopyText?.() ?? options.view.state.doc.toString();
      await options.copyText(text);
      const locale = options.locale();
      const copied = labelFor(locale, "copied");
      setIcon(copyBtn, CHECK_PATH);
      copyBtn.title = copied;
      copyBtn.setAttribute("aria-label", copied);
      if (copyResetTimer !== undefined) globalThis.clearTimeout(copyResetTimer);
      copyResetTimer = globalThis.setTimeout(() => {
        setIcon(copyBtn, COPY_PATH);
        copyBtn.title = labelFor(locale, options.i18n.copyTitle);
        copyBtn.setAttribute("aria-label", labelFor(locale, options.i18n.copyAria));
        copyResetTimer = undefined;
      }, COPY_FEEDBACK_MS);
    })();
  });

  downloadBtn.addEventListener("click", () => options.onDownload());

  mountEditorActionOverlay(options.toolbar, options.view);
  return { downloadButton: downloadBtn };
}

/**
 * Place an action toolbar as an overlay in the upper-right corner *inside* the
 * CodeMirror editor (`.cm-editor`), below an open top find panel and left of
 * the vertical scrollbar. Styling (semi-transparent until hover/focus) comes
 * from `.editor-action-toolbar--overlay`.
 */
export function mountEditorActionOverlay(toolbar: HTMLElement, view: EditorView): void {
  toolbar.classList.add("editor-action-toolbar--overlay");
  if (toolbar.parentElement !== view.dom) view.dom.appendChild(toolbar);
  const place = () => {
    if (!toolbar.isConnected) return;
    const panels = view.dom.querySelector<HTMLElement>(":scope > .cm-panels-top");
    const scroller = view.scrollDOM;
    const scrollbar = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
    toolbar.style.top = `${(panels?.offsetHeight ?? 0) + OVERLAY_INSET}px`;
    toolbar.style.right = `${scrollbar + OVERLAY_INSET}px`;
  };
  place();
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of(() => view.requestMeasure({ read: place })),
    ),
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => place()).observe(view.dom);
  }
}

export type CreateEditorOverlayOptions = {
  view: EditorView;
  /** Accessible name for the toolbar. */
  ariaLabel: string;
  searchLabel: string;
  copyLabel: string;
  copiedLabel: string;
  copyText?: (text: string) => Promise<void>;
};

/**
 * Build a Search / Copy overlay for an editor that has no markup of its own
 * (inline CodeMirror fields on Blockly blocks). Search needs the editor's
 * find extensions.
 */
export function createEditorActionOverlay(options: CreateEditorOverlayOptions): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "editor-action-toolbar editor-action-toolbar--compact";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", options.ariaLabel);
  const button = (action: string, label: string, path: string) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pane-btn pane-btn-icon editor-action-btn";
    btn.dataset.editorAction = action;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    setIcon(btn, path);
    // Keep Blockly from starting a block drag / stealing focus.
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
    btn.addEventListener("mousedown", (event) => event.stopPropagation());
    toolbar.append(btn);
    return btn;
  };
  const searchBtn = button("search", options.searchLabel, SEARCH_PATH);
  const copyBtn = button("copy", options.copyLabel, COPY_PATH);
  searchBtn.addEventListener("click", () => {
    options.view.focus();
    openSearchPanel(options.view);
  });
  let resetTimer: number | undefined;
  copyBtn.addEventListener("click", () => {
    void (async () => {
      const text = options.view.state.doc.toString();
      const write = options.copyText ??
        ((value: string) => navigator.clipboard?.writeText(value) ?? Promise.resolve());
      try {
        await write(text);
      } catch {
        return;
      }
      setIcon(copyBtn, CHECK_PATH);
      copyBtn.title = options.copiedLabel;
      if (resetTimer !== undefined) globalThis.clearTimeout(resetTimer);
      resetTimer = globalThis.setTimeout(() => {
        setIcon(copyBtn, COPY_PATH);
        copyBtn.title = options.copyLabel;
        resetTimer = undefined;
      }, COPY_FEEDBACK_MS);
    })();
  });
  mountEditorActionOverlay(toolbar, options.view);
  return toolbar;
}
