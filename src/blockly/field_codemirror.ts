/**
 * Multiline Blockly field that hosts a CodeMirror editor inside a foreignObject.
 * Resizing the host grows the surrounding block via `forceRerender`.
 */
import { Blockly } from "./blockly_core.ts";
import {
  createInlineEditor,
  setEditorDoc,
  type EditorLanguage,
} from "../workbench/codemirror_setup.ts";
import type { EditorView } from "@codemirror/view";
import { createEditorActionOverlay } from "../ui/editor_action_toolbar.ts";
import { chrome } from "../ui/chrome_i18n.ts";

export const FIELD_CODEMIRROR_TYPE = "field_codemirror";
export const DEFAULT_EDITOR_COLS = 40;
export const DEFAULT_EDITOR_ROWS = 3;

const COL_PX = 8;
const ROW_PX = 18;
const CHROME_W = 28;
const CHROME_H = 12;
const SVG_NS = "http://www.w3.org/2000/svg";

type FieldCodeMirrorState = string | {
  text?: string;
  width?: number;
  height?: number;
  language?: string;
};

// deno-lint-ignore no-explicit-any
const FieldBase = Blockly.Field as any;

export class FieldCodeMirror extends FieldBase {
  SERIALIZABLE = true;
  CURSOR = "text";
  EDITABLE = true;

  private language_: EditorLanguage = "handlebars";
  private widthPx_: number;
  private heightPx_: number;
  private foreignObject_: SVGForeignObjectElement | null = null;
  private host_: HTMLDivElement | null = null;
  private view_: EditorView | null = null;
  private resizeObserver_: ResizeObserver | null = null;
  private syncing_ = false;

  constructor(value?: string, language: EditorLanguage = "handlebars") {
    super(value ?? "");
    this.SERIALIZABLE = true;
    this.language_ = language;
    this.widthPx_ = defaultWidth();
    this.heightPx_ = defaultHeight();
    if (this.size_) {
      this.size_.width = this.widthPx_;
      this.size_.height = this.heightPx_;
    }
  }

  static fromJson(options: {
    text?: string;
    value?: string;
    language?: EditorLanguage;
    width?: number;
    height?: number;
  }): FieldCodeMirror {
    const field = new FieldCodeMirror(
      options.text ?? options.value ?? "",
      options.language ?? "handlebars",
    );
    if (typeof options.width === "number" && typeof options.height === "number") {
      field.setEditorSize(options.width, options.height);
    }
    return field;
  }

  getEditorCols(): number {
    return Math.max(1, Math.round((this.widthPx_ - CHROME_W) / COL_PX));
  }

  getEditorRows(): number {
    return Math.max(1, Math.round((this.heightPx_ - CHROME_H) / ROW_PX));
  }

  setLanguage(language: string): void {
    const next = normalizeLanguage(language);
    if (this.language_ === next) return;
    this.language_ = next;
    if (this.view_) {
      setEditorDoc(this.view_, this.view_.state.doc.toString(), next);
    }
  }

  setEditorSize(width: number, height: number): void {
    this.widthPx_ = Math.max(defaultWidth() * 0.5, width);
    this.heightPx_ = Math.max(defaultHeight() * 0.5, height);
    this.applyHostSize_();
    this.updateSize_();
    this.forceRerender?.();
  }

  getValue(): string {
    return String(super.getValue?.() ?? "");
  }

  saveState(): FieldCodeMirrorState {
    const text = this.getValue();
    if (this.widthPx_ === defaultWidth() && this.heightPx_ === defaultHeight()) {
      return text;
    }
    return { text, width: this.widthPx_, height: this.heightPx_ };
  }

  loadState(state: FieldCodeMirrorState): void {
    if (typeof state === "string" || state == null) {
      this.setValue(state ?? "");
      return;
    }
    if (typeof state.width === "number" && typeof state.height === "number") {
      this.setEditorSize(state.width, state.height);
    }
    if (typeof state.language === "string") this.setLanguage(state.language);
    this.setValue(state.text ?? "");
  }

  showEditor_(): void {
    // Inline editor — do not open Blockly's WidgetDiv.
  }

  initView(): void {
    const group = this.fieldGroup_ as SVGGElement | null;
    if (!group || typeof document === "undefined") {
      this.updateSize_();
      return;
    }
    this.foreignObject_ = document.createElementNS(SVG_NS, "foreignObject");
    this.foreignObject_.setAttribute("x", "0");
    this.foreignObject_.setAttribute("y", "0");
    this.host_ = document.createElement("div");
    this.host_.className = "blockly-codemirror-host";
    this.host_.style.resize = "both";
    this.host_.style.overflow = "auto";
    this.host_.style.boxSizing = "border-box";
    this.host_.style.background = "#fff";
    this.host_.style.border = "1px solid rgba(0,0,0,0.25)";
    this.host_.style.borderRadius = "4px";
    this.applyHostSize_();
    this.foreignObject_.appendChild(this.host_);
    group.appendChild(this.foreignObject_);
    for (const type of ["pointerdown", "mousedown", "touchstart", "wheel"]) {
      this.host_.addEventListener(type, (event) => event.stopPropagation());
    }
    this.updateSize_();
  }

  render_(): void {
    this.ensureEditor_();
    this.syncEditorDoc_();
    this.updateSize_();
  }

  updateSize_(): void {
    if (!this.size_) return;
    if (this.host_) {
      const w = this.host_.offsetWidth || this.widthPx_;
      const h = this.host_.offsetHeight || this.heightPx_;
      this.widthPx_ = w;
      this.heightPx_ = h;
    }
    this.size_.width = this.widthPx_;
    this.size_.height = this.heightPx_;
    if (this.foreignObject_) {
      this.foreignObject_.setAttribute("width", String(this.widthPx_));
      this.foreignObject_.setAttribute("height", String(this.heightPx_));
    }
  }

  disposeView(): void {
    this.teardownEditor_();
    super.disposeView?.();
  }

  protected doValueUpdate_(newValue: string): void {
    super.doValueUpdate_?.(newValue);
    this.syncEditorDoc_();
  }

  private ensureEditor_(): void {
    if (this.view_ || !this.host_ || typeof document === "undefined") return;
    const block = this.getSourceBlock?.();
    if (block?.isInFlyout) {
      this.host_.classList.add("blockly-codemirror-host--flyout");
      this.host_.textContent = firstLine(this.getValue());
      this.host_.style.resize = "none";
      this.host_.style.font = "12px ui-monospace, Consolas, monospace";
      this.host_.style.padding = "4px 6px";
      this.host_.style.whiteSpace = "pre";
      return;
    }
    this.view_ = createInlineEditor(
      this.host_,
      this.getValue(),
      this.language_,
      (text) => this.onEditorInput_(text),
    );
    const t = chrome(document.documentElement.lang || "en");
    createEditorActionOverlay({
      view: this.view_,
      ariaLabel: t.codeFieldActionsAria,
      searchLabel: t.searchCodeFieldTitle,
      copyLabel: t.copyCodeFieldTitle,
      copiedLabel: t.copied,
    });
    if (typeof ResizeObserver === "function") {
      this.resizeObserver_ = new ResizeObserver(() => this.onHostResize_());
      this.resizeObserver_.observe(this.host_);
    }
  }

  private onEditorInput_(text: string): void {
    if (this.syncing_) return;
    this.syncing_ = true;
    this.setValue(text);
    this.syncing_ = false;
  }

  private onHostResize_(): void {
    if (!this.host_) return;
    const w = this.host_.offsetWidth;
    const h = this.host_.offsetHeight;
    if (!w || !h) return;
    if (w === this.widthPx_ && h === this.heightPx_) return;
    this.widthPx_ = w;
    this.heightPx_ = h;
    this.updateSize_();
    this.forceRerender?.();
  }

  private syncEditorDoc_(): void {
    if (!this.view_ || this.syncing_) return;
    const text = this.getValue();
    if (this.view_.state.doc.toString() === text) return;
    this.syncing_ = true;
    setEditorDoc(this.view_, text, this.language_);
    this.syncing_ = false;
  }

  /** Insert text at the caret (or append when the CodeMirror view is not mounted). */
  insertAtCaret(text: string): void {
    if (!text) return;
    if (this.view_) {
      const sel = this.view_.state.selection.main;
      this.syncing_ = true;
      this.view_.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
      this.syncing_ = false;
      this.setValue(this.view_.state.doc.toString());
      return;
    }
    this.setValue(`${this.getValue()}${text}`);
  }

  private applyHostSize_(): void {
    if (!this.host_) return;
    this.host_.style.width = `${this.widthPx_}px`;
    this.host_.style.height = `${this.heightPx_}px`;
    this.host_.style.minWidth = `${defaultWidth() * 0.5}px`;
    this.host_.style.minHeight = `${defaultHeight() * 0.5}px`;
  }

  private teardownEditor_(): void {
    this.resizeObserver_?.disconnect();
    this.resizeObserver_ = null;
    this.view_?.destroy();
    this.view_ = null;
    this.host_ = null;
    this.foreignObject_ = null;
  }
}

function defaultWidth(): number {
  return DEFAULT_EDITOR_COLS * COL_PX + CHROME_W;
}

function defaultHeight(): number {
  return DEFAULT_EDITOR_ROWS * ROW_PX + CHROME_H;
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line || " ";
}

function normalizeLanguage(value: string): EditorLanguage {
  switch (value) {
    case "javascript":
    case "typescript":
    case "json":
    case "xml":
    case "html":
    case "handlebars":
    case "go-template":
    case "none":
      return value;
    default:
      return "handlebars";
  }
}

let registered = false;
export function registerFieldCodeMirror(): void {
  if (registered) return;
  registered = true;
  try {
    Blockly.fieldRegistry?.register(FIELD_CODEMIRROR_TYPE, FieldCodeMirror);
  } catch {
    // Already registered in this runtime (HMR / repeated init).
  }
}
