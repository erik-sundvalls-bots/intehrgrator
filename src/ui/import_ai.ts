/**
 * Paste dialog for AI mapping suggestions.
 * Shows the payload, JSON Schema errors, and a copy-for-AI follow-up.
 */

import type { ImportSuggestionsReport } from "../types/mod.ts";
import {
  formatImportFollowUp,
  looksLikeSuggestionsPayload,
  schemaUrlFromFormatDoc,
} from "../core/ai/mod.ts";
import { locateIssueInText } from "../core/ai/json_locate.ts";
import { parseAiAnswerNotes } from "../core/ai/mod.ts";
import { renderAiNotes } from "./ai_notes_view.ts";
import { detectLocale } from "../blockly/i18n/locale.ts";
import { chrome } from "./chrome_i18n.ts";

function ui() {
  return chrome(detectLocale());
}

export interface ImportAiDialogOptions {
  dialog: HTMLDialogElement;
  textarea: HTMLTextAreaElement;
  report: HTMLElement;
  cancel: HTMLButtonElement;
  clipboard: HTMLButtonElement;
  copyErrors: HTMLButtonElement;
  openButton: HTMLButtonElement;
  formatDocUrl: string;
  readClipboard: () => Promise<string>;
  copyToClipboard: (text: string) => Promise<void>;
  importText: (text: string) => ImportSuggestionsReport;
  /** Box above the textarea for the answer's Notes / Questions (Option C). */
  notes?: HTMLElement;
  describeSlot?: (slotId: string) => string | undefined;
  /** **Answer** on a question (e.g. close and quote it into AI chat). */
  onAnswer?: (question: string, index: number) => void;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Summary after **Import** ran (the report comes from the real import, so
 * "applied" is past tense on purpose). Nothing is counted before Import.
 */
export function formatImportReport(report: ImportSuggestionsReport): {
  summary: string;
  kind: "ok" | "partial" | "error";
} {
  const schemaCount = report.schemaIssues?.length ?? 0;
  const imported = report.applied + report.loopsAccepted > 0;
  const validNote = schemaCount > 0 && imported ? " · valid entries only" : "";
  const summary = `${imported ? "Imported" : "Nothing imported"}: ${
    [
      count(report.applied, "mapping applied", "mappings applied"),
      count(report.loopsAccepted, "loop added", "loops added"),
      `${report.skipped} skipped`,
      count(report.errors.length, "error", "errors"),
      count(schemaCount, "schema issue", "schema issues"),
    ].join(" · ")
  }${validNote}`;
  const hasProblems = report.errors.length > 0 || schemaCount > 0;
  if (!hasProblems && imported) {
    return { summary, kind: "ok" };
  }
  if (imported) return { summary, kind: "partial" };
  return { summary, kind: "error" };
}

export interface ImportAiDialogHandle {
  /**
   * Open the dialog. With `text` (e.g. an AI chat answer), prefill it for
   * review instead of reading the clipboard; nothing is applied until Apply.
   */
  open(text?: string): Promise<void>;
}

export function installImportAiDialog(options: ImportAiDialogOptions): ImportAiDialogHandle {
  const {
    dialog,
    textarea,
    report,
    cancel,
    clipboard,
    copyErrors,
    openButton,
    formatDocUrl,
    readClipboard,
    copyToClipboard,
    importText,
  } = options;
  const form = dialog.querySelector("form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;
  /** After a successful Import the same text is not imported twice; editing it re-enables Import. */
  const setImportDone = (done: boolean) => {
    if (submit) submit.disabled = done;
  };
  let lastReport: ImportSuggestionsReport | null = null;

  /** Notes / Questions outside the fence and per-suggestion `note` fields. */
  const renderNotes = () => {
    const box = options.notes;
    if (!box) return;
    const view = renderAiNotes(parseAiAnswerNotes(textarea.value), {
      describeSlot: options.describeSlot,
      onAnswer: options.onAnswer
        ? (question, index) => {
          dialog.close();
          options.onAnswer!(question, index);
        }
        : undefined,
    });
    box.replaceChildren(...(view ? [view] : []));
    box.hidden = !view;
  };
  textarea.addEventListener("input", renderNotes);
  textarea.addEventListener("input", () => {
    // A clean import's summary is about the old text; reports with errors stay to guide the fix.
    if (lastReport && formatImportReport(lastReport).kind === "ok") clearReport();
    setImportDone(false);
  });

  const clearReport = () => {
    lastReport = null;
    setImportDone(false);
    report.hidden = true;
    report.classList.remove("import-ai-report--ok", "import-ai-report--partial", "import-ai-report--error");
    report.replaceChildren();
    copyErrors.hidden = true;
    copyErrors.textContent = "Copy errors for AI";
    textarea.classList.remove("import-ai-text--invalid");
    textarea.removeAttribute("aria-invalid");
  };

  const showReport = (result: ImportSuggestionsReport) => {
    lastReport = result;
    const { summary, kind } = formatImportReport(result);
    report.hidden = false;
    report.classList.remove("import-ai-report--ok", "import-ai-report--partial", "import-ai-report--error");
    report.classList.add(`import-ai-report--${kind}`);

    const summaryEl = document.createElement("p");
    summaryEl.className = "import-ai-summary";
    summaryEl.textContent = summary;

    const list = document.createElement("ul");
    list.className = "import-ai-error-list";
    const items: Array<{ path: string; message: string }> = [
      ...(result.schemaIssues ?? []).map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
      ...result.errors.map((err) => ({ path: "", message: err })),
    ];
    for (const item of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "import-ai-error";
      if (item.path) {
        const code = document.createElement("code");
        code.textContent = item.path;
        btn.append(code, document.createTextNode(" — " + stripPathPrefix(item.message, item.path)));
      } else {
        btn.textContent = item.message;
      }
      btn.addEventListener("click", () => highlightIssue(item));
      li.append(btn);
      list.append(li);
    }

    report.replaceChildren(summaryEl);
    if (items.length) report.append(list);

    const hasProblems = items.length > 0;
    copyErrors.hidden = !hasProblems;
    textarea.classList.toggle("import-ai-text--invalid", hasProblems && result.applied === 0);
    textarea.setAttribute("aria-invalid", hasProblems ? "true" : "false");
    const imported = result.applied + result.loopsAccepted > 0;
    cancel.textContent = imported ? ui().close : ui().cancel;
    setImportDone(imported);
  };

  const highlightIssue = (item: { path: string; message: string }) => {
    const span = locateIssueInText(textarea.value, item.path, item.message);
    if (!span) return;
    textarea.focus();
    textarea.setSelectionRange(span.start, span.end);
  };

  const fillFromClipboard = async () => {
    const text = await readClipboard();
    if (looksLikeSuggestionsPayload(text)) {
      textarea.value = text;
      return true;
    }
    return false;
  };

  const open = async (prefill?: string) => {
    clearReport();
    cancel.textContent = ui().cancel;
    textarea.value = "";
    renderNotes();
    if (!dialog.open) dialog.showModal();
    if (prefill !== undefined) {
      textarea.value = prefill;
      renderNotes();
      textarea.focus();
      return;
    }
    const filled = await fillFromClipboard();
    renderNotes();
    if (!filled) {
      textarea.placeholder = '{"format":"intehrgrator-suggestions","version":"2","suggestions":[…]}';
    }
    textarea.focus();
    if (filled) textarea.select();
  };

  const apply = () => {
    const text = textarea.value.trim();
    if (!text) {
      showReport({
        applied: 0,
        skipped: 0,
        errors: [ui().pasteJsonFirst],
        loopsAccepted: 0,
        schemaIssues: [],
      });
      return;
    }
    showReport(importText(text));
  };

  const copyFollowUp = async () => {
    if (!lastReport) return;
    const text = formatImportFollowUp({
      formatDocUrl,
      schemaUrl: schemaUrlFromFormatDoc(formatDocUrl),
      payload: textarea.value,
      schemaIssues: lastReport.schemaIssues ?? [],
      errors: lastReport.errors,
    });
    await copyToClipboard(text);
    copyErrors.textContent = ui().copied;
    copyErrors.dataset.copied = "1";
    globalThis.setTimeout(() => {
      if (copyErrors.dataset.copied === "1") {
        delete copyErrors.dataset.copied;
        copyErrors.textContent = ui().copyErrorsForAi;
      }
    }, 2000);
  };

  openButton.addEventListener("click", () => void open());
  clipboard.addEventListener("click", () => {
    void (async () => {
      const text = await readClipboard();
      if (!text) {
        showReport({
          applied: 0,
          skipped: 0,
          errors: [ui().clipboardEmpty],
          loopsAccepted: 0,
          schemaIssues: [],
        });
        return;
      }
      textarea.value = text;
      clearReport();
      renderNotes();
    })();
  });
  copyErrors.addEventListener("click", () => void copyFollowUp());
  cancel.addEventListener("click", () => dialog.close());
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    apply();
  });
  return { open };
}

function stripPathPrefix(message: string, path: string): string {
  const prefix = `${path}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}
