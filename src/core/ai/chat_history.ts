/**
 * AI chat history, persisted per project in browser localStorage (never in the
 * Project Bundle). Users clear it to cut the context sent to the model.
 */
import type { ChatMessage } from "./credentials.ts";

export const CHAT_HISTORY_KEY_PREFIX = "intehrgrator.ai.chat.";
/** Rough cap so one long chat cannot exhaust localStorage. */
export const CHAT_HISTORY_MAX_CHARS = 400_000;

export type ChatApplyMode = "apply" | "approve";

export interface ChatDisplayEntry {
  role: "user" | "assistant" | "note" | "error";
  text: string;
  /** Tool names called during an assistant turn (collapsed lines). */
  toolCalls?: string[];
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

export function saveChatSession(storage: StorageLike, projectId: string, session: ChatSession): ChatSession {
  const trimmed = trimChatSession(session);
  try {
    storage.setItem(chatHistoryKey(projectId), JSON.stringify(trimmed));
  } catch {
    // quota / private mode: the chat still works for this page load
  }
  return trimmed;
}

export function clearChatSession(storage: StorageLike, projectId: string): void {
  try {
    storage.removeItem(chatHistoryKey(projectId));
  } catch {
    // ignore
  }
}
