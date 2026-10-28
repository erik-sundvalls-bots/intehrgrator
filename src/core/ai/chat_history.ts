/**
 * AI chat history, persisted per project in browser localStorage (never in the
 * Project Bundle). Users clear it to cut the context sent to the model.
 */
import type { ChatMessage } from "./credentials.ts";
import type { SuggestionNote } from "./response_notes.ts";
import { parseUsageTotals, type UsageTotals } from "./token_usage.ts";

export const CHAT_HISTORY_KEY_PREFIX = "intehrgrator.ai.chat.";
/** Rough cap so one long chat cannot exhaust localStorage. */
export const CHAT_HISTORY_MAX_CHARS = 400_000;

/**
 * Rough budget for the history sent with a new message (#252). Above it, Send
 * pauses and the user picks: trim old turns, new chat with a recap, or cancel
 * (#292). Nothing is dropped without that choice.
 */
export const CHAT_HISTORY_MAX_TOKENS = 64_000;

/**
 * History limit for a model with a known context window (#276): half the
 * window (the rest is room for this turn's tool results and answer), never
 * below `CHAT_HISTORY_MAX_TOKENS`. Unknown window: `CHAT_HISTORY_MAX_TOKENS`.
 */
export function historyTokenLimit(contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return CHAT_HISTORY_MAX_TOKENS;
  return Math.max(CHAT_HISTORY_MAX_TOKENS, Math.floor(contextWindow / 2));
}

/** Token estimate for wire messages: about 3 characters per token for this JSON-heavy chat (o200k_base). */
export function estimateChatTokens(messages: readonly ChatMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 3);
}

export interface ChatDisplayEntry {
  role: "user" | "assistant" | "note" | "error";
  text: string;
  /**
   * A note with buttons: "raise-budget" raises the token budget and sends
   * "continue" (#276); "history-full" asks how to go on when the history is
   * above the limit (#292).
   */
  action?: "raise-budget" | "history-full";
  /** Tool names called during an assistant turn (collapsed lines). */
  toolCalls?: string[];
  /** Short lines for mappings tools applied this turn ("Mapped Systolic ← $.systolic"). */
  mappings?: string[];
  /** The user pressed Stop during this turn. */
  stopped?: boolean;
  /** Per-suggestion notes from envelopes the AI applied with tools this turn. */
  suggestionNotes?: SuggestionNote[];
}

export interface ChatSession {
  version: 1;
  /** Wire messages without the system prompt. */
  messages: ChatMessage[];
  display: ChatDisplayEntry[];
  /** True once the full project context went out with a user message. */
  contextSent: boolean;
  /** `chipKey`s whose details were already attached. */
  attachedChipKeys: string[];
  /** Token use of every request in this chat until Clear history (#276). */
  usage?: UsageTotals;
  /** The 80 % budget warning was shown for this chat. */
  budgetWarned?: boolean;
  /** Recap of an earlier chat, sent once with the next message (#292). */
  recap?: string;
  /** The user was told that the stored copy of this chat is cut (#292). */
  storageTrimNoted?: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyChatSession(): ChatSession {
  return { version: 1, messages: [], display: [], contextSent: false, attachedChipKeys: [] };
}

export function chatHistoryKey(projectId: string): string {
  return `${CHAT_HISTORY_KEY_PREFIX}${projectId || "default"}`;
}

export function loadChatSession(storage: StorageLike, projectId: string): ChatSession {
  try {
    const raw = storage.getItem(chatHistoryKey(projectId));
    if (!raw) return emptyChatSession();
    const parsed = JSON.parse(raw) as Partial<ChatSession>;
    if (parsed.version !== 1) return emptyChatSession();
    return {
      version: 1,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      display: Array.isArray(parsed.display) ? parsed.display : [],
      contextSent: parsed.contextSent === true,
      attachedChipKeys: Array.isArray(parsed.attachedChipKeys) ? parsed.attachedChipKeys : [],
      ...(parseUsageTotals(parsed.usage) ? { usage: parseUsageTotals(parsed.usage) } : {}),
      ...(parsed.budgetWarned === true ? { budgetWarned: true } : {}),
      ...(typeof parsed.recap === "string" && parsed.recap ? { recap: parsed.recap } : {}),
      ...(parsed.storageTrimNoted === true ? { storageTrimNoted: true } : {}),
    };
  } catch {
    return emptyChatSession();
  }
}

/**
 * Drop the oldest whole turns (from one user message to the next) until the
 * session fits. The first user message carries the project context, so when it
 * goes `contextSent` resets and the next message re-attaches the context.
 */
export function trimChatSession(session: ChatSession, maxChars = CHAT_HISTORY_MAX_CHARS): ChatSession {
  const next: ChatSession = { ...session, messages: [...session.messages] };
  const size = () => JSON.stringify(next.messages).length;
  while (next.messages.length && size() > maxChars) {
    const nextUser = next.messages.findIndex((m, i) => i > 0 && m.role === "user");
    next.messages = nextUser > 0 ? next.messages.slice(nextUser) : [];
    next.contextSent = false;
    next.attachedChipKeys = [];
  }
  return next;
}

/**
 * Drop the oldest whole turns until the history estimate fits `maxTokens`.
 * Only after the user chose "Continue with trimmed history" (#292).
 */
export function trimChatSessionToTokens(
  session: ChatSession,
  maxTokens = CHAT_HISTORY_MAX_TOKENS,
): { session: ChatSession; trimmed: boolean; tokens: number } {
  const next: ChatSession = { ...session, messages: [...session.messages] };
  let trimmed = false;
  while (next.messages.length && estimateChatTokens(next.messages) > maxTokens) {
    const nextUser = next.messages.findIndex((m, i) => i > 0 && m.role === "user");
    next.messages = nextUser > 0 ? next.messages.slice(nextUser) : [];
    next.contextSent = false;
    next.attachedChipKeys = [];
    trimmed = true;
  }
  return { session: next, trimmed, tokens: estimateChatTokens(next.messages) };
}

/**
 * Persist the chat. Only the stored copy is cut to `CHAT_HISTORY_MAX_CHARS`;
 * the caller keeps its full session and tells the user when `trimmed` (#292).
 */
export function saveChatSession(
  storage: StorageLike,
  projectId: string,
  session: ChatSession,
): { stored: ChatSession; trimmed: boolean } {
  const stored = trimChatSession(session);
  try {
    storage.setItem(chatHistoryKey(projectId), JSON.stringify(stored));
  } catch {
    // quota / private mode: the chat still works for this page load
  }
  return { stored, trimmed: stored.messages.length < session.messages.length };
}

/**
 * Plain-text recap of a chat for "Start new chat with summary" (#292): every
 * user message, answer and applied mapping line, in order. Notes and errors
 * are left out; the mappings themselves are on the project, whose context the
 * new chat re-attaches.
 */
export function chatRecap(session: ChatSession): string {
  const lines: string[] = [];
  for (const entry of session.display) {
    if (entry.role === "user") lines.push(`User: ${entry.text}`);
    else if (entry.role === "assistant") {
      const block = [entry.text.trim() ? `Assistant: ${entry.text.trim()}` : "Assistant:"];
      for (const m of entry.mappings ?? []) block.push(`  - ${m}`);
      if (block.length > 1 || entry.text.trim()) lines.push(block.join("\n"));
    }
  }
  return lines.join("\n\n");
}

export function clearChatSession(storage: StorageLike, projectId: string): void {
  try {
    storage.removeItem(chatHistoryKey(projectId));
  } catch {
    // ignore
  }
}
