/**
 * AI chat panel in the lower split of **Target & Previews**.
 *
 * Multi-turn chat with the user's own AI (credentials in this browser only).
 * History is stored per project in localStorage. With credentials, Send runs
 * the streaming tool loop (`runMappingAgent`): text and reasoning stream into a
 * live bubble, each applied mapping gets a short line, and Stop aborts the run.
 * Without credentials the panel offers copy & paste prompting: copy the
 * composed prompt, then import the answer through the Import Suggestions dialog.
 */
import { attachInfoTip } from "./info_tip.ts";
import {
  type ChatInputPart,
  chipDetails,
  chipHeader,
  chipKey,
  composeUserMessage,
  type ContextChip,
  fillPromptPlaceholders,
  normalizeParts,
  partsChips,
} from "../core/ai/chat_context.ts";
import {
  type ChatSession,
  clearChatSession,
  loadChatSession,
  saveChatSession,
  trimChatSessionToTokens,
} from "../core/ai/chat_history.ts";
import type { MappingAgentEvent } from "../core/ai/mapping_agent.ts";
import type { ChatMessage } from "../core/ai/credentials.ts";
import {
  addUserPrompts,
  exportUserPrompts,
  listStoredPrompts,
  parsePromptFile,
  removeUserPrompt,
  type StoredPrompt,
} from "../core/ai/stored_prompts.ts";
import { initSplitGroup } from "./split_pane.ts";
import { detectLocale } from "../blockly/i18n/locale.ts";
import { chrome, formatMessage } from "./chrome_i18n.ts";

import { parseAiAnswerNotes } from "../core/ai/mod.ts";
import type { SuggestionNote } from "../core/ai/response_notes.ts";
import { answerQuote, renderAiNotes } from "./ai_notes_view.ts";
function ui() {
  return chrome(detectLocale());
}

/**
 * Retired "Apply directly / Approve first" select (before #252). Removed on
 * load: Send always applies (one Undo step); the import approval modal is only
 * for pasted answers.
 */
export const LEGACY_AI_CHAT_MODE_KEY = "intehrgrator.ai.chatMode";
/** Reasoning tail shown in the live bubble (characters). */
const REASONING_TAIL_CHARS = 240;
/** "0" = expanded, anything else = collapsed (the default). */
export const AI_CHAT_COLLAPSED_KEY = "intehrgrator.ai.chatCollapsed";
/** Pre-collapse key: "1" meant the panel was open. Read once to migrate. */
const LEGACY_AI_CHAT_OPEN_KEY = "intehrgrator.ai.chatOpen";
export const AI_CHAT_SPLIT_KEY = "layout-output-ai-chat";
export const PROJECT_CONTEXT_HEADING = "## Project context";
/** Smallest message list kept visible while growing the entry box (px). */
const MIN_LOG_PX = 32;

/** Copy/paste delivery modes, same as the header **AI** menu. */
export type AiPromptDelivery = "inline" | "attach" | "uri";

export const AI_CHAT_COPY_MENU: ReadonlyArray<{ delivery: AiPromptDelivery; labelKey: "menuEmbedFiles" | "menuAttachFiles" | "menuBrowseUris" }> = [
  { delivery: "inline", labelKey: "menuEmbedFiles" },
  { delivery: "attach", labelKey: "menuAttachFiles" },
  { delivery: "uri", labelKey: "menuBrowseUris" },
];

export interface AiChatTurnRequest {
  /** Full user message (text, attachments, maybe project context). */
  prompt: string;
  history: ChatMessage[];
  /** Aborted by the Stop button. */
  signal: AbortSignal;
  /** Live progress for the streaming bubble. */
  onEvent: (event: MappingAgentEvent) => void;
}

export interface AiChatTurnResult {
  text: string;
  messages: ChatMessage[];
  toolCalls: string[];
  /** Note shown under the answer (e.g. "review in Import Suggestions"). */
  note?: string;
  /** Per-suggestion notes from envelopes applied with tools (not in `text`). */
  suggestionNotes?: SuggestionNote[];
  /** Short lines for mappings applied this turn. */
  mappings?: string[];
  /** The run was stopped; `text` is what arrived before Stop. */
  stopped?: boolean;
}

export interface AiChatPanelOptions {
  panel: HTMLElement;
  /** Flex column holding `tabs` and `panel`; becomes the split group. */
  stack: HTMLElement;
  tabs: HTMLElement;
  storage: Storage;
  projectId: () => string;
  hasCredentials: () => boolean;
  openCredentials: () => void;
  /**
   * Full project prompt in a delivery mode: the copy & paste text, or `api`
   * (compact context for Send, where the model has the mapping tools).
   */
  buildProjectContext: (delivery?: AiPromptDelivery | "api") => string;
  /** Last copy/paste delivery mode, shared with the header AI menu. */
  getDelivery?: () => AiPromptDelivery;
  setDelivery?: (delivery: AiPromptDelivery) => void;
  /** Copy & paste: also attach the raw target file (#277; default off). */
  getAttachOriginalTarget?: () => boolean;
  setAttachOriginalTarget?: (on: boolean) => void;
  copyToClipboard: (text: string) => Promise<void>;
  pickTextFile: () => Promise<{ name: string; text: string } | null>;
  fetchText: (url: string) => Promise<string>;
  downloadText: (filename: string, text: string) => void;
  openImportDialog: (text?: string) => void;
  runTurn: (request: AiChatTurnRequest) => Promise<AiChatTurnResult>;
  setStatus: (message: string) => void;
  formatError?: (err: unknown) => string;
  onLayout?: () => void;
  confirm?: (message: string) => boolean;
  /** Short label for a slot id in Notes (path label tail). */
  describeSlot?: (slotId: string) => string | undefined;
  prompt?: (message: string) => string | null;
}

export interface AiChatPanelHandle {
  /** Expand the always-present panel (no-op when already expanded). */
  expand(): void;
  collapse(): void;
  isExpanded(): boolean;
  addChip(chip: ContextChip): void;
  /** Replace the input with this text and open the panel. */
  prefill(text: string): void;
  /** Quote an AI question into the input so the user can answer it. */
  /** Prefill the input with the quoted question (and the chosen option), caret at the end. */
  answerQuestion(question: string, index: number, option?: string): void;
  /** Re-read credentials state and the current project's history. */
  refresh(): void;
  inputParts(): ChatInputPart[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string; type?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.type && node instanceof HTMLButtonElement) node.type = props.type as "button";
  return node;
}

/** Read the contenteditable input into text + chip parts. */
export function readInputParts(root: Node): ChatInputPart[] {
  const parts: ChatInputPart[] = [];
  const walk = (node: Node, isRoot: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push({ text: (node.textContent ?? "").replace(/\u00a0/g, " ") });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.chip) {
      try {
        parts.push({ chip: JSON.parse(node.dataset.chip) as ContextChip });
      } catch {
        // ignore a broken chip
      }
      return;
    }
    if (node.tagName === "BR") {
      parts.push({ text: "\n" });
      return;
    }
    const block = !isRoot && (node.tagName === "DIV" || node.tagName === "P");
    if (block && parts.length) parts.push({ text: "\n" });
    for (const child of Array.from(node.childNodes)) walk(child, false);
  };
  walk(root, true);
  return normalizeParts(parts);
}

/** Collapsed unless the user expanded it last time (or had it open before #249). */
export function readCollapsed(storage: Storage): boolean {
  const stored = storage.getItem(AI_CHAT_COLLAPSED_KEY);
  if (stored !== null) return stored !== "0";
  const legacyOpen = storage.getItem(LEGACY_AI_CHAT_OPEN_KEY) === "1";
  storage.removeItem(LEGACY_AI_CHAT_OPEN_KEY);
  return !legacyOpen;
}

export function installAiChatPanel(options: AiChatPanelOptions): AiChatPanelHandle {
  const { panel, stack, tabs, storage } = options;
  const confirmFn = options.confirm ?? ((m: string) => globalThis.confirm(m));
  const promptFn = options.prompt ?? ((m: string) => globalThis.prompt(m));
  const formatError = options.formatError ??
    ((err: unknown) => (err instanceof Error ? err.message : String(err)));

  let session: ChatSession = loadChatSession(storage, options.projectId());
  let sessionProject = options.projectId();
  let disposeSplit: (() => void) | null = null;
  let collapsed = readCollapsed(storage);
  let sending = false;
  /** Stop button target while a turn runs. */
  let running: AbortController | null = null;
  /** Live streaming bubble content for the running turn. */
  let live: { text: string; reasoning: string; tool: string; mappings: string[]; errors: number } | null = null;
  let liveRow: HTMLElement | null = null;
  let liveFrame = 0;
  let forceContext = false;
  let savedRange: Range | null = null;
  /** × on the credentials notice; in memory only, so a reload shows it again. */
  let credsDismissed = false;

  panel.replaceChildren();
  panel.classList.add("ai-chat-panel");

  // ── header ────────────────────────────────────────────────────────────────
  const header = el("div", { className: "ai-chat-header" });
  const title = el("h3", { className: "ai-chat-title", text: ui().aiChat });
  title.id = "ai-chat-title";

  const promptsWrap = el("div", { className: "ai-chat-prompts" });
  const promptsBtn = el("button", {
    className: "pane-btn ai-chat-prompts-btn",
    text: `${ui().aiChatStoredPromptsShort} ▾`,
    title: ui().aiChatStoredPrompts,
    type: "button",
  });
  promptsBtn.id = "ai-chat-prompts-btn";
  promptsBtn.setAttribute("aria-label", ui().aiChatStoredPrompts);
  promptsBtn.setAttribute("aria-haspopup", "menu");
  const promptsMenu = el("div", { className: "split-btn-menu ai-chat-prompts-menu" });
  promptsMenu.id = "ai-chat-prompts-menu";
  promptsMenu.setAttribute("role", "menu");
  promptsMenu.hidden = true;
  promptsWrap.append(promptsBtn, promptsMenu);

  // Retired mode select: drop its stored value (Send always applies).
  try {
    storage.removeItem(LEGACY_AI_CHAT_MODE_KEY);
  } catch {
    // private mode
  }

  const spacer = el("span", { className: "ai-chat-spacer" });
  const clearBtn = el("button", {
    className: "pane-btn pane-btn-icon ai-chat-icon-btn ai-chat-clear",
    title: ui().aiChatClearTitle,
    type: "button",
  });
  clearBtn.id = "ai-chat-clear";
  clearBtn.setAttribute("aria-label", ui().aiChatClearTitle);
  // MUI DeleteOutline.
  clearBtn.innerHTML = '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24">' +
    '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5z"></path></svg>';

  // (i): explains every control; text depends on cut & paste vs API mode.
  const infoTip = el("span", { className: "info-tip info-tip--end ai-chat-info" });
  const infoBtn = el("button", { className: "info-tip-btn", text: "i", type: "button" });
  infoBtn.id = "ai-chat-info-btn";
  infoBtn.setAttribute("aria-expanded", "false");
  infoBtn.setAttribute("aria-label", ui().aiChatHelpAria);
  infoBtn.setAttribute("aria-describedby", "ai-chat-info-balloon");
  const infoBalloon = el("span", { className: "info-tip-balloon ai-chat-info-balloon" });
  infoBalloon.id = "ai-chat-info-balloon";
  infoBalloon.setAttribute("role", "tooltip");
  infoTip.append(infoBtn, infoBalloon);
  let infoMode: boolean | null = null;
  const renderInfo = (hasCreds: boolean) => {
    if (infoMode === hasCreds) return;
    infoMode = hasCreds;
    infoBalloon.innerHTML = hasCreds ? ui().aiChatHelpApiHtml : ui().aiChatHelpPasteHtml;
  };
  // Same square toggle as the Source / Target & Previews slide buttons, with a
  // bottom-half glyph: the chat is never closed, only collapsed to this header.
  const toggleBtn = el("button", { className: "pane-btn pane-slide-btn ai-chat-toggle", type: "button" });
  toggleBtn.id = "ai-chat-toggle";
  toggleBtn.setAttribute("aria-controls", panel.id || "ai-chat-panel");
  toggleBtn.innerHTML =
    '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24">' +
    '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect>' +
    '<rect x="3.7" y="13.4" width="16.6" height="5.9" rx="1" fill="currentColor"></rect></svg>';
  // Tools wrap inside their own group so the toggle stays on the first row.
  const tools = el("div", { className: "ai-chat-header-tools" });
  tools.append(promptsWrap, spacer, clearBtn);
  header.append(title, infoTip, tools, toggleBtn);
  attachInfoTip(infoTip);

  // ── body ──────────────────────────────────────────────────────────────────
  const body = el("div", { className: "ai-chat-body" });
  const credsNotice = el("div", { className: "ai-chat-creds" });
  credsNotice.id = "ai-chat-creds";
  const credsText = el("p", { text: ui().aiChatNoCredentials });
  const credsBtn = el("button", { className: "pane-btn", text: ui().aiChatConfigure, type: "button" });
  credsBtn.id = "ai-chat-configure";
  const credsDismiss = el("button", {
    className: "ai-chat-creds-dismiss",
    text: "×",
    title: ui().aiChatDismissNotice,
    type: "button",
  });
  credsDismiss.id = "ai-chat-creds-dismiss";
  credsDismiss.setAttribute("aria-label", ui().aiChatDismissNotice);
  credsNotice.append(credsText, credsBtn, credsDismiss);

  const log = el("div", { className: "ai-chat-log" });
  log.id = "ai-chat-log";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  const composer = el("div", { className: "ai-chat-composer" });
  const input = el("div", { className: "ai-chat-input" });
  input.id = "ai-chat-input";
  input.contentEditable = "true";
  input.setAttribute("role", "textbox");
  input.setAttribute("aria-multiline", "true");
  input.dataset.placeholder = ui().aiChatPlaceholder;
  const actions = el("div", { className: "ai-chat-actions" });
  const iconLabel = (btn: HTMLButtonElement, icon: string, text: string) => {
    const glyph = el("span", { className: "material-symbols-outlined split-btn-menu-icon", text: icon });
    glyph.setAttribute("aria-hidden", "true");
    btn.replaceChildren(glyph, el("span", { text }));
  };
  const copySplit = el("div", { className: "split-btn ai-chat-copy-split" });
  const copyBtn = el("button", {
    className: "pane-btn split-btn-main",
    title: ui().aiChatCopyPromptTitle,
    type: "button",
  });
  copyBtn.id = "ai-chat-copy-prompt";
  iconLabel(copyBtn, "content_copy", ui().aiChatCopyPrompt);
  const copyChevron = el("button", { className: "pane-btn split-btn-chevron", text: "▾", type: "button" });
  copyChevron.id = "ai-chat-copy-menu-btn";
  copyChevron.setAttribute("aria-haspopup", "menu");
  copyChevron.setAttribute("aria-expanded", "false");
  copyChevron.setAttribute("aria-label", ui().aiChatCopyMenuAria);
  copyChevron.title = ui().aiChatCopyMenuAria;
  const copyMenu = el("div", { className: "split-btn-menu ai-chat-copy-menu" });
  copyMenu.id = "ai-chat-copy-menu";
  copyMenu.setAttribute("role", "menu");
  copyMenu.hidden = true;
  for (const { delivery, labelKey } of AI_CHAT_COPY_MENU) {
    const item = el("button", { className: "split-btn-menu-item split-btn-menu-item--icon", type: "button" });
    item.setAttribute("role", "menuitem");
    item.dataset.aiChatDelivery = delivery;
    iconLabel(item, "content_copy", ui()[labelKey]);
    item.addEventListener("click", () => {
      closeCopyMenu();
      options.setDelivery?.(delivery);
      void copyPrompt(delivery);
    });
    copyMenu.append(item);
  }
  if (options.setAttachOriginalTarget) {
    const check = el("label", { className: "split-btn-menu-item split-btn-menu-item--icon split-btn-menu-check" });
    check.title = ui().menuAttachOriginalTargetTitle;
    const box = el("input");
    box.type = "checkbox";
    box.id = "ai-chat-attach-target";
    box.checked = Boolean(options.getAttachOriginalTarget?.());
    box.addEventListener("change", () => options.setAttachOriginalTarget?.(box.checked));
    check.append(box, el("span", { text: ui().menuAttachOriginalTarget }));
    copyMenu.append(check);
    // Keep in step with the AI menu's checkbox.
    copyChevron.addEventListener("click", () => {
      box.checked = Boolean(options.getAttachOriginalTarget?.());
    });
  }
  copySplit.append(copyBtn, copyChevron, copyMenu);
  const importBtn = el("button", { className: "pane-btn", type: "button" });
  importBtn.id = "ai-chat-import-answer";
  iconLabel(importBtn, "content_paste", ui().aiChatImportAnswer);
  const sendBtn = el("button", { className: "pane-btn pane-btn-primary", text: ui().aiChatSend, type: "button" });
  sendBtn.id = "ai-chat-send";
  const stopBtn = el("button", {
    className: "pane-btn ai-chat-stop",
    title: ui().aiChatStopTitle,
    type: "button",
  });
  stopBtn.id = "ai-chat-stop";
  iconLabel(stopBtn, "stop_circle", ui().aiChatStop);
  stopBtn.hidden = true;
  actions.append(copySplit, importBtn, el("span", { className: "ai-chat-spacer" }), stopBtn, sendBtn);
  composer.append(input, actions);
  // Same look as every split_pane.ts divider (6px bar, centred 3-dot grip).
  const grip = el("div", { className: "split-handle split-handle--row ai-chat-grip", title: ui().aiChatResizeInput });
  grip.id = "ai-chat-grip";
  grip.tabIndex = 0;
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");
  grip.setAttribute("aria-label", ui().aiChatResizeInput);
  body.append(credsNotice, log, grip, composer);

  const popover = el("div", { className: "ai-chip-popover" });
  popover.hidden = true;
  popover.setAttribute("role", "tooltip");
  panel.append(header, body);
  document.body.append(popover);

  // ── chips ─────────────────────────────────────────────────────────────────
  const showPopover = (chip: ContextChip, anchor: HTMLElement) => {
    popover.replaceChildren(el("div", { className: "ai-chip-popover-header", text: chipHeader(chip) }));
    const dl = el("dl");
    for (const [key, value] of chipDetails(chip)) {
      dl.append(el("dt", { text: key }), el("dd", { text: value }));
    }
    popover.append(dl);
    popover.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(420, globalThis.innerWidth - 16);
    popover.style.maxWidth = `${width}px`;
    const left = Math.max(8, Math.min(rect.left, globalThis.innerWidth - width - 8));
    popover.style.left = `${left}px`;
    const below = rect.bottom + 6;
    popover.style.top = `${below}px`;
    const height = popover.getBoundingClientRect().height;
    if (below + height > globalThis.innerHeight - 8) {
      popover.style.top = `${Math.max(8, rect.top - height - 6)}px`;
    }
  };
  const hidePopover = () => {
    popover.hidden = true;
  };

  const chipElement = (chip: ContextChip): HTMLElement => {
    const span = el("span", { className: `ai-chip ai-chip--${chip.kind}` });
    span.contentEditable = "false";
    span.dataset.chip = JSON.stringify(chip);
    span.dataset.chipKey = chipKey(chip);
    const icon = chip.kind === "block" ? "▣" : chip.kind === "target" ? "◎" : "◇";
    span.append(el("span", { className: "ai-chip-icon", text: icon }), el("span", { text: chip.label }));
    const remove = el("button", { className: "ai-chip-remove", text: "×", type: "button" });
    remove.tabIndex = -1;
    remove.setAttribute("aria-label", ui().aiChatChipRemove);
    remove.addEventListener("mousedown", (ev) => ev.preventDefault());
    remove.addEventListener("click", () => {
      span.remove();
      hidePopover();
    });
    span.append(remove);
    span.addEventListener("mouseenter", () => showPopover(chip, span));
    span.addEventListener("mouseleave", hidePopover);
    return span;
  };

  const setInputParts = (parts: ChatInputPart[]) => {
    input.replaceChildren();
    parts.forEach((part, i) => {
      if (!("chip" in part)) {
        input.append(document.createTextNode(part.text));
        return;
      }
      input.append(chipElement(part.chip));
      const next = parts[i + 1];
      // Keep a caret spot after a chip unless text with a space follows.
      if (!next || !("text" in next) || !/^\s/.test(next.text)) {
        input.append(document.createTextNode("\u00a0"));
      }
    });
  };

  /** Quote a question from the AI into the input, caret after it. */
  const answerQuestion = (question: string, index: number, option?: string) => {
    expand();
    setInputParts([{ text: answerQuote(question, index, option) }]);
    input.focus();
    const sel = globalThis.getSelection?.();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const rememberRange = () => {
    const sel = globalThis.getSelection?.();
    if (sel && sel.rangeCount && input.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  input.addEventListener("keyup", rememberRange);
  input.addEventListener("mouseup", rememberRange);
  input.addEventListener("input", rememberRange);
  input.addEventListener("blur", rememberRange);

  const insertChip = (chip: ContextChip) => {
    const node = chipElement(chip);
    const space = document.createTextNode("\u00a0");
    if (savedRange && input.contains(savedRange.commonAncestorContainer)) {
      savedRange.deleteContents();
      savedRange.insertNode(space);
      savedRange.insertNode(node);
      const range = document.createRange();
      range.setStartAfter(space);
      range.collapse(true);
      savedRange = range;
    } else {
      input.append(node, space);
    }
  };

  input.addEventListener("paste", (ev) => {
    const text = ev.clipboardData?.getData("text/plain");
    if (text === undefined) return;
    ev.preventDefault();
    document.execCommand("insertText", false, text);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && running) {
      ev.preventDefault();
      stop();
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void send();
    }
  });

  // ── log ───────────────────────────────────────────────────────────────────
  const mappingLines = (lines: string[]) => {
    const box = el("div", { className: "ai-chat-mappings" });
    for (const line of lines) box.append(el("div", { className: "ai-chat-mapping", text: `✓ ${line}` }));
    return box;
  };

  /** The live bubble: reasoning tail, current tool, mapping lines, streamed text. */
  const renderLive = () => {
    liveFrame = 0;
    if (!live) return;
    const row = liveRow ?? el("div", { className: "ai-chat-msg ai-chat-msg--assistant ai-chat-msg--streaming" });
    row.id = "ai-chat-live";
    liveRow = row;
    row.replaceChildren();
    if (live.reasoning.trim()) {
      const tail = live.reasoning.trim().replace(/\s+/g, " ");
      const reasoning = el("div", {
        className: "ai-chat-reasoning",
        text: tail.length > REASONING_TAIL_CHARS ? `…${tail.slice(-REASONING_TAIL_CHARS)}` : tail,
        title: ui().aiChatReasoning,
      });
      row.append(reasoning);
    }
    if (live.mappings.length) row.append(mappingLines(live.mappings));
    if (live.text) row.append(el("div", { className: "ai-chat-text", text: live.text }));
    const status = live.tool
      ? formatMessage(ui().aiChatRunningTool, { name: live.tool })
      : live.text || live.mappings.length
      ? ui().aiChatStreaming
      : ui().aiChatSending;
    row.append(el("p", { className: "ai-chat-pending", text: status }));
    if (!row.isConnected) log.append(row);
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (nearBottom || !live.text) log.scrollTop = log.scrollHeight;
  };
  const scheduleLive = () => {
    if (liveFrame) return;
    liveFrame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(renderLive)
      : setTimeout(renderLive, 16) as unknown as number;
  };
  const onTurnEvent = (event: MappingAgentEvent) => {
    if (!live) return;
    switch (event.type) {
      case "text":
        live.text += event.text;
        live.tool = "";
        break;
      case "reasoning":
        live.reasoning += event.text;
        break;
      case "tool":
        live.tool = event.name;
        break;
      case "mapping":
        live.mappings.push(event.text);
        break;
      case "tool-error":
        live.errors++;
        break;
      case "step":
        // A new step starts a new paragraph of streamed text.
        if (live.text && !live.text.endsWith("\n\n")) live.text += "\n\n";
        live.tool = "";
        break;
    }
    scheduleLive();
  };

  const stop = () => {
    if (!running || running.signal.aborted) return;
    running.abort();
    stopBtn.disabled = true;
    if (live) {
      live.tool = "";
      scheduleLive();
    }
  };

  const renderLog = () => {
    log.replaceChildren();
    if (!session.display.length) {
      log.append(el("p", { className: "ai-chat-empty", text: ui().aiChatEmpty }));
    }
    liveRow = null;
    session.display.forEach((entry, index) => {
      const row = el("div", { className: `ai-chat-msg ai-chat-msg--${entry.role}` });
      if (entry.mappings?.length) row.append(mappingLines(entry.mappings));
      if (entry.toolCalls?.length) {
        const details = el("details", { className: "ai-chat-tools" });
        details.append(
          el("summary", { text: formatMessage(ui().aiChatToolCalls, { count: entry.toolCalls.length }) }),
        );
        for (const name of entry.toolCalls) {
          details.append(el("div", { className: "ai-chat-tool", text: formatMessage(ui().aiChatToolCall, { name }) }));
        }
        row.append(details);
      }
      if (entry.role === "assistant" && entry.text) {
        // Option C: Notes / Questions outside the suggestions fence get their own box.
        const parsed = parseAiAnswerNotes(entry.text);
        if (entry.suggestionNotes?.length) parsed.suggestionNotes.push(...entry.suggestionNotes);
        if (parsed.body) row.append(el("div", { className: "ai-chat-text", text: parsed.body }));
        const box = renderAiNotes(parsed, {
          describeSlot: options.describeSlot,
          onAnswer: (question, i, option) => answerQuestion(question, i, option),
        });
        if (box) row.append(box);
      } else if (entry.text) {
        row.append(el("div", { className: "ai-chat-text", text: entry.text }));
      }
      log.append(row);
    });
    if (sending && live) renderLive();
    else if (sending) log.append(el("p", { className: "ai-chat-pending", text: ui().aiChatSending }));
    log.scrollTop = log.scrollHeight;
  };

  const persist = () => {
    session = saveChatSession(storage, sessionProject, session);
  };

  /** Switch to the current project's history. Returns true when it changed. */
  const syncProject = (): boolean => {
    const current = options.projectId();
    if (current === sessionProject) return false;
    sessionProject = current;
    session = loadChatSession(storage, current);
    return true;
  };

  const refreshChrome = () => {
    const hasCreds = options.hasCredentials();
    renderInfo(hasCreds);
    credsNotice.hidden = hasCreds || credsDismissed;
    sendBtn.hidden = !hasCreds || Boolean(running);
    sendBtn.disabled = sending;
    stopBtn.hidden = !running;
    stopBtn.disabled = Boolean(running?.signal.aborted);
    // While a run streams, the row holds only Stop (copy / import make no sense then).
    copySplit.hidden = Boolean(running);
    importBtn.hidden = Boolean(running);
    copyBtn.classList.toggle("pane-btn-primary", !hasCreds);
    copyChevron.classList.toggle("pane-btn-primary", !hasCreds);
    // Stored prompts and Clear history live only in the expanded panel.
    promptsWrap.hidden = collapsed;
    clearBtn.hidden = collapsed;
    panel.classList.toggle("ai-chat-panel--collapsed", collapsed);
    toggleBtn.title = collapsed ? ui().aiChatExpand : ui().aiChatCollapse;
    toggleBtn.setAttribute("aria-label", toggleBtn.title);
    toggleBtn.setAttribute("aria-expanded", String(!collapsed));
  };

  // ── compose / send ────────────────────────────────────────────────────────
  const composePrompt = (delivery?: AiPromptDelivery | "api") => {
    const parts = readInputParts(input);
    const composed = composeUserMessage(parts, session.attachedChipKeys);
    const withContext = forceContext || !session.contextSent;
    const prompt = withContext
      ? `${composed.text}\n\n${PROJECT_CONTEXT_HEADING}\n\n${options.buildProjectContext(delivery ?? options.getDelivery?.())}`
      : composed.text;
    return { parts, composed, prompt, withContext };
  };

  const commitUserTurn = (c: ReturnType<typeof composePrompt>) => {
    session.display.push({ role: "user", text: c.composed.displayText });
    session.attachedChipKeys = [...new Set([...session.attachedChipKeys, ...c.composed.attachedKeys])];
    if (c.withContext) session.contextSent = true;
    forceContext = false;
    input.replaceChildren();
    savedRange = null;
  };

  const send = async () => {
    if (sending) return;
    syncProject();
    if (!options.hasCredentials()) {
      await copyPrompt();
      return;
    }
    if (!readInputParts(input).some((part) => "chip" in part || part.text.trim())) return;
    // Keep the history sent with this message under the token budget (#252).
    // Dropping the first turn also drops the project context, so it is re-attached.
    const fitted = trimChatSessionToTokens(session);
    if (fitted.trimmed) {
      session = fitted.session;
      session.display.push({ role: "note", text: ui().aiChatHistoryTrimmed });
    }
    const c = composePrompt("api");
    if (!c.composed.displayText) return;
    const history = session.messages;
    commitUserTurn(c);
    sending = true;
    const controller = new AbortController();
    running = controller;
    live = { text: "", reasoning: "", tool: "", mappings: [], errors: 0 };
    persist();
    renderLog();
    refreshChrome();
    try {
      const result = await options.runTurn({
        prompt: c.prompt,
        history,
        signal: controller.signal,
        onEvent: onTurnEvent,
      });
      session.messages = result.messages;
      const mappings = result.mappings ?? live?.mappings ?? [];
      session.display.push({
        role: "assistant",
        text: result.text,
        toolCalls: result.toolCalls,
        ...(mappings.length ? { mappings } : {}),
        ...(result.stopped ? { stopped: true } : {}),
        ...(result.suggestionNotes?.length ? { suggestionNotes: result.suggestionNotes } : {}),
      });
      const note = result.stopped
        ? [ui().aiChatStopped, result.note].filter(Boolean).join(" ")
        : result.note;
      if (note) session.display.push({ role: "note", text: note });
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped before the first step finished: nothing reached the canvas.
        if (live?.text.trim()) session.display.push({ role: "assistant", text: live.text.trim(), stopped: true });
        session.display.push({ role: "note", text: ui().aiChatStopped });
      } else {
        session.display.push({ role: "error", text: formatError(err) });
      }
      // Keep the user message in the wire history so a retry has context.
      session.messages = [...history, { role: "user", content: c.prompt }];
    } finally {
      sending = false;
      running = null;
      live = null;
      if (liveFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(liveFrame);
      liveFrame = 0;
      persist();
      renderLog();
      refreshChrome();
    }
  };

  const copyPrompt = async (delivery?: AiPromptDelivery) => {
    syncProject();
    const c = composePrompt(delivery);
    if (!c.composed.displayText) return;
    await options.copyToClipboard(c.prompt);
    commitUserTurn(c);
    session.messages = [...session.messages, { role: "user", content: c.prompt }];
    session.display.push({ role: "note", text: ui().aiChatPromptCopied });
    persist();
    renderLog();
    options.setStatus(ui().aiChatPromptCopied);
  };

  // ── menus ─────────────────────────────────────────────────────────────────
  /** Fixed-position menu next to its trigger, flipping above when needed. */
  const placeMenu = (menu: HTMLElement, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, globalThis.innerWidth - menuRect.width - 8))}px`;
    menu.style.top = rect.bottom + menuRect.height > globalThis.innerHeight - 8
      ? `${Math.max(8, rect.top - menuRect.height - 4)}px`
      : `${rect.bottom + 4}px`;
  };

  function closeCopyMenu() {
    copyMenu.hidden = true;
    copyChevron.setAttribute("aria-expanded", "false");
  }
  copyChevron.addEventListener("click", () => {
    if (!copyMenu.hidden) {
      closeCopyMenu();
      return;
    }
    copyMenu.hidden = false;
    copyChevron.setAttribute("aria-expanded", "true");
    placeMenu(copyMenu, copySplit);
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!copyMenu.hidden && !copySplit.contains(ev.target as Node)) closeCopyMenu();
  });

  // ── stored prompts ────────────────────────────────────────────────────────
  const closePromptsMenu = () => {
    promptsMenu.hidden = true;
    promptsBtn.setAttribute("aria-expanded", "false");
  };

  const applyStoredPrompt = (prompt: StoredPrompt) => {
    closePromptsMenu();
    const text = prompt.text;
    if (prompt.dynamic === "project") forceContext = true;
    const current = readInputParts(input);
    const chips = partsChips(current);
    const filled = fillPromptPlaceholders(text, chips);
    const used = new Set(partsChips(filled).map(chipKey));
    const rest = current.filter((part) => !("chip" in part) || !used.has(chipKey(part.chip)));
    const restHasContent = rest.some((part) => "chip" in part || part.text.trim());
    setInputParts(restHasContent ? [...filled, { text: "\n" }, ...rest] : filled);
    input.focus();
  };

  const addPromptsFrom = (filename: string, text: string) => {
    try {
      const added = addUserPrompts(storage, parsePromptFile(filename, text));
      options.setStatus(formatMessage(ui().aiChatPromptsAdded, { count: added.length }));
    } catch (err) {
      const message = formatMessage(ui().aiChatPromptLoadFailed, { detail: formatError(err) });
      options.setStatus(message);
      globalThis.alert?.(message);
    }
  };

  const renderPromptsMenu = () => {
    promptsMenu.replaceChildren();
    for (const prompt of listStoredPrompts(storage)) {
      const row = el("div", { className: "ai-chat-prompt-row" });
      const pick = el("button", {
        className: "split-btn-menu-item ai-chat-prompt-pick",
        text: prompt.name,
        title: prompt.dynamic ? prompt.name : prompt.text,
        type: "button",
      });
      pick.setAttribute("role", "menuitem");
      pick.dataset.promptId = prompt.id;
      pick.addEventListener("click", () => applyStoredPrompt(prompt));
      row.append(pick);
      if (!prompt.builtIn) {
        const remove = el("button", {
          className: "ai-chat-prompt-remove",
          text: "×",
          title: ui().aiChatRemovePrompt,
          type: "button",
        });
        remove.setAttribute("aria-label", `${ui().aiChatRemovePrompt}: ${prompt.name}`);
        remove.dataset.promptId = prompt.id;
        remove.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!confirmFn(formatMessage(ui().aiChatRemovePromptConfirm, { name: prompt.name }))) return;
          removeUserPrompt(storage, prompt.id);
          renderPromptsMenu();
        });
        row.append(remove);
      }
      promptsMenu.append(row);
    }
    promptsMenu.append(el("div", { className: "split-btn-menu-separator" }));
    const action = (text: string, id: string, fn: () => void) => {
      const btn = el("button", { className: "split-btn-menu-item", text, type: "button" });
      btn.id = id;
      btn.setAttribute("role", "menuitem");
      btn.addEventListener("click", () => {
        closePromptsMenu();
        fn();
      });
      promptsMenu.append(btn);
    };
    action(ui().aiChatAddPromptFile, "ai-chat-add-prompt-file", () => {
      void options.pickTextFile().then((file) => {
        if (file) addPromptsFrom(file.name, file.text);
      });
    });
    action(ui().aiChatAddPromptUrl, "ai-chat-add-prompt-url", () => {
      const url = promptFn(ui().aiChatPromptUrlAsk)?.trim();
      if (!url) return;
      void options.fetchText(url).then(
        (text) => addPromptsFrom(url, text),
        (err) => {
          const message = formatMessage(ui().aiChatPromptLoadFailed, { detail: formatError(err) });
          options.setStatus(message);
          globalThis.alert?.(message);
        },
      );
    });
    action(ui().aiChatExportPrompts, "ai-chat-export-prompts", () => {
      options.downloadText("intehrgrator-stored-prompts.json", exportUserPrompts(storage));
    });
  };

  promptsBtn.addEventListener("click", () => {
    if (!promptsMenu.hidden) {
      closePromptsMenu();
      return;
    }
    renderPromptsMenu();
    promptsMenu.hidden = false;
    placeMenu(promptsMenu, promptsBtn);
    promptsBtn.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!promptsMenu.hidden && !promptsWrap.contains(ev.target as Node)) closePromptsMenu();
  });

  // ── layout ────────────────────────────────────────────────────────────────
  const unsplit = () => {
    disposeSplit?.();
    disposeSplit = null;
  };
  const split = () => {
    unsplit();
    disposeSplit = initSplitGroup(stack, "column", {
      panes: [tabs, panel],
      sizes: [2, 1],
      minSize: 96,
      storageKey: AI_CHAT_SPLIT_KEY,
      onResize: options.onLayout,
    });
  };

  const setCollapsed = (next: boolean, focus = false) => {
    syncProject();
    collapsed = next;
    storage.setItem(AI_CHAT_COLLAPSED_KEY, collapsed ? "1" : "0");
    if (collapsed) {
      unsplit();
      closeCopyMenu();
      closePromptsMenu();
      hidePopover();
    } else {
      split();
    }
    refreshChrome();
    if (!collapsed) renderLog();
    options.onLayout?.();
    if (!collapsed && focus) input.focus();
  };
  const expand = () => {
    if (collapsed) setCollapsed(false, true);
  };
  const collapse = () => {
    if (!collapsed) setCollapsed(true);
  };

  toggleBtn.addEventListener("click", () => setCollapsed(!collapsed, true));
  title.addEventListener("dblclick", () => setCollapsed(!collapsed, true));
  // Collapsed, the whole slim bar is a target for expanding.
  header.addEventListener("click", (ev) => {
    if (collapsed && !toggleBtn.contains(ev.target as Node)) expand();
  });
  clearBtn.addEventListener("click", () => {
    if (!confirmFn(ui().aiChatClearConfirm)) return;
    syncProject();
    clearChatSession(storage, sessionProject);
    session = loadChatSession(storage, sessionProject);
    // contextSent is false again (persisted), so the next prompt carries the full project context.
    forceContext = false;
    session.display.push({
      role: "note",
      text: options.hasCredentials() ? ui().aiChatClearedApi : ui().aiChatClearedPaste,
    });
    persist();
    renderLog();
  });
  credsBtn.addEventListener("click", () => options.openCredentials());
  credsDismiss.addEventListener("click", () => {
    credsDismissed = true;
    refreshChrome();
  });
  // Entry box resize: drag the grip on the divider above the composer. Up makes
  // the entry box taller (message list shorter), down makes it shorter.
  const inputMinPx = () => parseFloat(getComputedStyle(input).minHeight) || 34;
  const inputMaxPx = () => {
    // The credentials notice shrinks (and scrolls) down to its min-height.
    const notice = credsNotice.hidden ? 0 : parseFloat(getComputedStyle(credsNotice).minHeight) || 0;
    const room = body.clientHeight - notice -
      (composer.offsetHeight - input.offsetHeight) - grip.offsetHeight - MIN_LOG_PX;
    return Math.max(inputMinPx(), room);
  };
  /** `keepMax` stops a drag from shrinking a box that is already past the room limit. */
  const setInputHeight = (px: number, keepMax = 0) => {
    const clamped = Math.round(Math.min(Math.max(inputMaxPx(), keepMax), Math.max(inputMinPx(), px)));
    input.style.height = `${clamped}px`;
    input.style.maxHeight = "none";
    grip.setAttribute("aria-valuenow", String(clamped));
  };
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    grip.classList.add("split-handle--active");
    const startY = ev.clientY;
    const startH = input.getBoundingClientRect().height;
    const onMove = (move: PointerEvent) => setInputHeight(startH + (startY - move.clientY), startH);
    const onUp = () => {
      grip.classList.remove("split-handle--active");
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });
  grip.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
    ev.preventDefault();
    const step = ev.shiftKey ? 64 : 16;
    setInputHeight(input.getBoundingClientRect().height + (ev.key === "ArrowUp" ? step : -step));
  });
  sendBtn.addEventListener("click", () => void send());
  stopBtn.addEventListener("click", () => stop());
  copyBtn.addEventListener("click", () => void copyPrompt());
  importBtn.addEventListener("click", () => options.openImportDialog());

  panel.hidden = false;
  setCollapsed(collapsed);

  return {
    expand,
    collapse,
    isExpanded: () => !collapsed,
    addChip(chip) {
      expand();
      insertChip(chip);
    },
    answerQuestion: (question, index, option) => answerQuestion(question, index, option),
    prefill(text) {
      expand();
      setInputParts([{ text }]);
      input.focus();
    },
    refresh() {
      const changed = syncProject();
      refreshChrome();
      if (changed && !collapsed) renderLog();
    },
    inputParts: () => readInputParts(input),
  };
}
