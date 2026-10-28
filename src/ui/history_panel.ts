/**
 * History panel (ADR 0014): the project's one chronological history, newest
 * first, with an author badge per change (you / AI chat + model / MCP +
 * client) and per row **Undo to here** (take back every later change) and
 * **Revert** (take back only this change, as a new change at the end).
 */
import { detectLocale } from "../blockly/i18n/locale.ts";
import { chrome } from "./chrome_i18n.ts";

function ui() {
  return chrome(detectLocale());
}

export interface HistoryPanelRow {
  seq: number;
  kind: string;
  summary: string;
  timestamp: string;
  actor: {
    kind: string;
    id?: string;
    displayName: string;
    origin?: string;
    client?: string;
    model?: string;
  };
  undone?: boolean;
}

export interface HistoryPanelOptions {
  panel: HTMLElement;
  load: () => Promise<HistoryPanelRow[]>;
  undoTo: (row: HistoryPanelRow) => Promise<void>;
  revert: (row: HistoryPanelRow) => Promise<void>;
}

export interface HistoryPanelHandle {
  refresh(): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (node instanceof HTMLButtonElement) node.type = "button";
  return node;
}

/** Badge text and class for an entry's author. */
export function authorBadge(
  actor: HistoryPanelRow["actor"],
): { origin: "human" | "ai-chat" | "mcp"; label: string; detail?: string } {
  const origin = actor.origin === "ai-chat" || actor.origin === "mcp" ||
      actor.origin === "human"
    ? actor.origin
    : actor.kind === "agent"
    ? "mcp"
    : "human";
  if (origin === "human") return { origin, label: ui().historyYou };
  if (origin === "ai-chat") {
    const pasted = actor.displayName.includes("pasted");
    return {
      origin,
      label: ui().historyAiChat,
      detail: actor.model ?? (pasted ? ui().historyPasted : undefined),
    };
  }
  // Parallel agents from one IDE share a client name: show the agent's own
  // name too ("Bo · cursor"), as on its canvas lease tag.
  const name = actor.displayName.replace(/^MCP:\s*/, "");
  const client = actor.client;
  return {
    origin,
    label: "MCP",
    detail: client && name !== client ? `${name} · ${client}` : client ?? name,
  };
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function installHistoryPanel(
  options: HistoryPanelOptions,
): HistoryPanelHandle {
  const { panel } = options;
  panel.classList.add("history-panel");
  panel.hidden = true;
  const header = el("div", { className: "history-panel-header" });
  const title = el("span", {
    className: "history-panel-title",
    text: ui().historyTitle,
  });
  const close = el("button", {
    className: "pane-btn history-panel-close",
    text: "×",
    title: ui().historyClose,
  });
  close.setAttribute("aria-label", ui().historyClose);
  close.addEventListener("click", () => toggle(false));
  header.append(title, close);
  const intro = el("p", {
    className: "history-panel-intro",
    text: ui().historyIntroPanel,
  });
  const list = el("ol", { className: "history-list" });
  list.id = "history-list";
  panel.replaceChildren(header, intro, list);
  let busy = false;
  let loading: Promise<void> | null = null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
      refresh();
    }
  };

  function render(rows: HistoryPanelRow[]): void {
    list.replaceChildren();
    if (!rows.length) {
      list.append(
        el("li", { className: "history-empty", text: ui().historyEmpty }),
      );
      return;
    }
    const newest = rows.at(-1)!.seq;
    for (const row of [...rows].reverse()) {
      const item = el("li", {
        className: `history-row${row.undone ? " history-row--undone" : ""}`,
      });
      item.dataset.seq = String(row.seq);
      const badge = authorBadge(row.actor);
      const tag = el("span", {
        className: `history-badge history-badge--${badge.origin}`,
        text: badge.label,
      });
      if (badge.detail) tag.append(el("small", { text: ` ${badge.detail}` }));
      tag.title = row.actor.displayName;
      const meta = el("div", { className: "history-meta" });
      meta.append(
        tag,
        el("span", { className: "history-seq", text: `#${row.seq}` }),
        el("span", { className: "history-time", text: timeOf(row.timestamp) }),
      );
      if (row.undone) {
        meta.append(
          el("span", { className: "history-undone", text: ui().historyUndone }),
        );
      }
      const summary = el("div", {
        className: "history-summary",
        text: row.summary,
      });
      const actions = el("div", { className: "history-actions" });
      const undoTo = el("button", {
        className: "pane-btn history-undo-to",
        text: ui().historyUndoTo,
        title: ui().historyUndoToTitle,
      });
      undoTo.disabled = row.seq === newest;
      undoTo.addEventListener(
        "click",
        () => void run(() => options.undoTo(row)),
      );
      const revert = el("button", {
        className: "pane-btn history-revert",
        text: ui().historyRevert,
        title: ui().historyRevertTitle,
      });
      revert.disabled = Boolean(row.undone);
      revert.addEventListener(
        "click",
        () => void run(() => options.revert(row)),
      );
      actions.append(undoTo, revert);
      item.append(meta, summary, actions);
      list.append(item);
    }
  }

  let again = false;
  function refresh(): void {
    if (panel.hidden) return;
    if (loading) {
      again = true;
      return;
    }
    loading = options.load().then(render).catch(() => {}).finally(() => {
      loading = null;
      if (again) {
        again = false;
        refresh();
      }
    });
  }

  function toggle(open = panel.hidden): void {
    panel.hidden = !open;
    if (open) refresh();
  }

  return { refresh, toggle, isOpen: () => !panel.hidden };
}
