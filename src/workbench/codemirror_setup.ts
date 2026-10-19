import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  getSearchQuery,
  highlightSelectionMatches,
  search,
  searchKeymap,
  setSearchQuery,
} from "@codemirror/search";
import { vmsTemplateLintExtensions } from "./template_lint.ts";

/** Languages we can highlight. `"none"` still gets folding chrome, but no parser. */
export type EditorLanguage =
  | "javascript"
  | "typescript"
  | "json"
  | "xml"
  | "html"
  | "handlebars"
  | "go-template"
  | "none";

/**
 * Code text (`text_code`) LANG dropdown — no JavaScript/TypeScript (ADR 0009 / #40).
 * Generated Export TypeScript viewer still uses `languageSupport("typescript")`.
 */
export const EDITOR_LANGUAGE_OPTIONS: Array<[string, EditorLanguage]> = [
  ["Plain", "none"],
  ["Handlebars", "handlebars"],
  ["Go Template", "go-template"],
  ["JSON", "json"],
  ["XML", "xml"],
  ["HTML", "html"],
];

const languageOf = new WeakMap<EditorView, Compartment>();
const lintOf = new WeakMap<EditorView, Compartment>();
const currentLanguage = new WeakMap<EditorView, EditorLanguage>();

const handlebarsLanguage = StreamLanguage.define({
  name: "handlebars",
  startState: () => ({ inMustache: false }),
  token(stream, state: { inMustache: boolean }) {
    if (!state.inMustache) {
      if (stream.match("{{")) {
        state.inMustache = true;
        return "bracket";
      }
      stream.next();
      stream.eatWhile((ch) => ch !== "{");
      return null;
    }
    if (stream.match("}}")) {
      state.inMustache = false;
      return "bracket";
    }
    if (stream.match(/^[#/][\w.]+/) || stream.match(/^(else|this|as)\b/)) {
      return "keyword";
    }
    if (stream.match(/^[\w.$]+/)) return "variableName";
    stream.next();
    return "string";
  },
});

export function languageSupport(language: EditorLanguage): Extension {
  switch (language) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "json":
      return json();
    case "xml":
      return xml();
    case "html":
      return html();
    case "handlebars":
    case "go-template":
      return handlebarsLanguage;
    case "none":
      return [];
  }
}

/** Guess JSON / JS / XML from leading tokens when the caller has no MIME type. */
export function detectEditorLanguage(text: string): EditorLanguage {
  const trimmed = text.trimStart();
  if (!trimmed) return "none";
  // Handlebars `{{…}}` also starts with `{`; highlight as Handlebars, not JSON.
  if (trimmed.startsWith("{{")) return "handlebars";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<?xml") || /^<[A-Za-z!?]/.test(trimmed)) return "xml";
  if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return "javascript";
  return "none";
}

export function languageForExportTarget(target: string, code = ""): EditorLanguage {
  if (target === "preview") return "javascript";
  if (target === "typescript") return "typescript";
  const detected = detectEditorLanguage(code);
  if (detected === "json" || detected === "xml") return detected;
  if (target === "handlebars" || target === "go-template") return target;
  return "none";
}

/** Copy full document when Mod-c and the selection is empty. */
export type EditorCopyAllHandler = (text: string) => void | Promise<void>;

function copyAllIfEmptyKeymap(copyAll: EditorCopyAllHandler): Extension {
  return keymap.of([{
    key: "Mod-c",
    run: (view) => {
      if (!view.state.selection.main.empty) return false;
      void copyAll(view.state.doc.toString());
      return true;
    },
  }]);
}

/**
 * Orange “current” search mark requires the selection to sit on a match.
 * When the query changes and the caret is not already on a hit, land on the
 * first match so Scripts / Conversion Test Run highlight immediately (and so
 * the first Next advances to the second hit).
 */
export const selectFirstSearchMatchOnQuery = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (!update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) {
      return;
    }
    const query = getSearchQuery(update.state);
    if (!query.valid) return;
    const sel = update.state.selection.main;
    if (!sel.empty) {
      const atSel = query.getCursor(update.state, sel.from, sel.to).next();
      if (!atSel.done && atSel.value.from === sel.from && atSel.value.to === sel.to) {
        return;
      }
    }
    const first = query.getCursor(update.state, 0, update.state.doc.length).next();
    if (first.done) return;
    const view = update.view;
    const target = { from: first.value.from, to: first.value.to };
    queueMicrotask(() => {
      if (view.isDestroyed) return;
      const q = getSearchQuery(view.state);
      if (!q.valid) return;
      const main = view.state.selection.main;
      if (!main.empty) {
        const at = q.getCursor(view.state, main.from, main.to).next();
        if (!at.done && at.value.from === main.from && at.value.to === main.to) return;
      }
      const still = q.getCursor(view.state, target.from, target.to).next();
      if (
        still.done || still.value.from !== target.from || still.value.to !== target.to
      ) {
        const again = q.getCursor(view.state, 0, view.state.doc.length).next();
        if (again.done) return;
        view.dispatch({
          selection: EditorSelection.single(again.value.from, again.value.to),
          effects: EditorView.scrollIntoView(again.value.from, { y: "nearest" }),
          userEvent: "select.search",
        });
        return;
      }
      view.dispatch({
        selection: EditorSelection.single(target.from, target.to),
        effects: EditorView.scrollIntoView(target.from, { y: "nearest" }),
        userEvent: "select.search",
      });
    });
  }
});

/**
 * In-editor search (Ctrl/Cmd+F) and optional Mod-c copy-all when selection empty.
 * Used by readonly script/test viewers and Mapping Spec — not inline Blockly fields.
 */
export function editorFindExtensions(copyAll?: EditorCopyAllHandler): Extension[] {
  return [
    search({ top: true }),
    highlightSelectionMatches(),
    selectFirstSearchMatchOnQuery,
    keymap.of(searchKeymap),
    ...(copyAll ? [copyAllIfEmptyKeymap(copyAll)] : []),
  ];
}

/** Line numbers, fold gutter, foldCode keymap, highlighting. Shared by all editors. */
export const editorChromeExtensions: Extension[] = [
  lineNumbers(),
  foldGutter(),
  history(),
  indentOnInput(),
  bracketMatching(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
];

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
});

function mountEditor(
  parent: HTMLElement,
  doc: string,
  language: EditorLanguage,
  extra: Extension[],
): EditorView {
  const languageConf = new Compartment();
  const lintConf = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        ...editorChromeExtensions,
        languageConf.of(languageSupport(language)),
        lintConf.of(vmsTemplateLintExtensions(language)),
        editorTheme,
        ...extra,
      ],
    }),
  });
  languageOf.set(view, languageConf);
  lintOf.set(view, lintConf);
  currentLanguage.set(view, language);
  return view;
}

/** Compact CodeMirror for embedding inside a Blockly field (no fold gutter). */
export function createInlineEditor(
  parent: HTMLElement,
  doc: string,
  language: EditorLanguage,
  onChange: (text: string) => void,
): EditorView {
  const languageConf = new Compartment();
  const lintConf = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        search({ top: true }),
        highlightSelectionMatches(),
        selectFirstSearchMatchOnQuery,
        keymap.of(searchKeymap),
        languageConf.of(languageSupport(language)),
        lintConf.of(vmsTemplateLintExtensions(language)),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px", backgroundColor: "#fff" },
          ".cm-editor": { height: "100%" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "ui-monospace, Consolas, monospace",
          },
          ".cm-gutters": { minHeight: "100%", backgroundColor: "#f6f6f6" },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  languageOf.set(view, languageConf);
  lintOf.set(view, lintConf);
  currentLanguage.set(view, language);
  return view;
}

export function createReadonlyEditor(
  parent: HTMLElement,
  placeholder = "",
  language: EditorLanguage = "javascript",
  options: { copyAll?: EditorCopyAllHandler } = {},
): EditorView {
  return mountEditor(parent, placeholder, language, [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    ...editorFindExtensions(options.copyAll),
  ]);
}

export function createTextEditor(
  parent: HTMLElement,
  onChange: (text: string) => void,
  language: EditorLanguage = "none",
): EditorView {
  return mountEditor(parent, "", language, [
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ]);
}

export function setEditorDoc(
  view: EditorView,
  doc: string,
  language?: EditorLanguage,
): void {
  const effects = [];
  if (language !== undefined && currentLanguage.get(view) !== language) {
    const compartment = languageOf.get(view);
    if (compartment) {
      effects.push(compartment.reconfigure(languageSupport(language)));
    }
    const lintCompartment = lintOf.get(view);
    if (lintCompartment) {
      effects.push(lintCompartment.reconfigure(vmsTemplateLintExtensions(language)));
    }
    currentLanguage.set(view, language);
  }
  const current = view.state.doc.toString();
  if (current === doc && effects.length === 0) return;
  view.dispatch({
    changes: current === doc ? [] : { from: 0, to: view.state.doc.length, insert: doc },
    effects,
  });
}
