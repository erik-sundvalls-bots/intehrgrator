/**
 * Call AI mapping loop: OpenAI-compatible tools named like MCP / Agent API.
 */
import { applySuggestionReviewDefaults, extractSuggestionsJson, looksLikeSuggestionsPayload } from "./mod.ts";
import { collectSuggestionNotes, type SuggestionNote } from "./response_notes.ts";
import {
  MAPPING_TOOLS_SYSTEM,
  SUGGESTIONS_SYSTEM,
  postChatCompletions,
  type AiProviderCredentials,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatStreamDelta,
} from "./credentials.ts";
import { isCallAiToolName, isMutatingCallAiTool, mappingAgentOpenAiTools } from "./chat_tools.ts";
import type { ImportSuggestionsReport } from "../../types/mod.ts";
import type { AgentClient } from "../../agent/client.ts";

export interface MappingAgentResult {
  text: string;
  toolNames: string[];
  imported?: ImportSuggestionsReport;
  steps: number;
  /** Conversation after this turn, without the system prompt (for multi-turn chat). */
  messages: ChatMessage[];
  /** Per-suggestion `note` fields from envelopes sent to import_suggestions this turn. */
  suggestionNotes: SuggestionNote[];
  /** The last answer stopped at the output-token limit (finish_reason length). */
  truncated?: boolean;
  /** The loop ran out of steps while the model still wanted to call tools. */
  stepLimitReached?: boolean;
  /** The user pressed Stop (or the caller aborted): text is what arrived so far. */
  stopped?: boolean;
  /** One short line per mapping a tool applied this turn (the inline stream notices). */
  mappingNotices: string[];
}

/**
 * Live progress of one agent turn, for the streaming chat bubble: text and
 * reasoning deltas, tool starts, and a short notice when a tool changed the
 * mapping ("Mapped Systolic ← $.systolic").
 */
export type MappingAgentEvent =
  | { type: "step"; step: number }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string }
  | { type: "mapping"; text: string }
  | { type: "tool-error"; name: string; error: string };

export interface RunMappingAgentOptions {
  credentials: AiProviderCredentials;
  prompt: string;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  proxyUrl?: string;
  maxSteps?: number;
  onAfterMutation?: () => void;
  importText?: (text: string) => ImportSuggestionsReport | Promise<ImportSuggestionsReport>;
  /**
   * Earlier chat turns (no system prompt). When non-empty, `prompt` is sent as
   * a follow-up user message without the tools prefix.
   */
  history?: ChatMessage[];
  /** Stream the answer (SSE) and report progress. Without it each step is one JSON call. */
  onEvent?: (event: MappingAgentEvent) => void;
  /** Per-request timeout in ms (each step gets its own; Stop is `signal`). Default 180 s. */
  stepTimeoutMs?: number;
}

export const DEFAULT_STEP_TIMEOUT_MS = 180_000;

/** Tools whose results are large snapshots: only the newest copy stays in history. */
const SNAPSHOT_TOOLS = new Set([
  "list_slots",
  "get_source_tree",
  "get_example",
  "get_sheets",
  "list_optional_rm",
  "list_constraint_warnings",
  "get_snapshot",
  "run_test",
]);
/** Snapshot results shorter than this stay as they are. */
const STUB_MIN_CHARS = 1_500;

/**
 * Replace older copies of snapshot tool results (list_slots, get_source_tree,
 * run_test, …) with a one-line stub, keeping the newest copy of each. The
 * `tool_call_id` stays, so the wire conversation remains valid (#252).
 */
export function compactToolHistory(messages: ChatMessage[]): ChatMessage[] {
  const newest = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role === "tool" && m.name && SNAPSHOT_TOOLS.has(m.name)) newest.set(m.name, i);
  });
  return messages.map((m, i) => {
    if (m.role !== "tool" || !m.name || !SNAPSHOT_TOOLS.has(m.name)) return m;
    if (newest.get(m.name) === i) return m;
    if ((m.content ?? "").length < STUB_MIN_CHARS || (m.content ?? "").startsWith('{"superseded"')) return m;
    return {
      ...m,
      content: JSON.stringify({
        superseded: `Older ${m.name} result removed to save tokens; a newer one is below. Call ${m.name} again if you need it.`,
      }),
    };
  });
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}

/** Combine the user's Stop signal with a per-step timeout. */
function stepSignal(user: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  if (!user) return timeout;
  if (!timeout) return user;
  if ("any" in AbortSignal) return (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([user, timeout]);
  return user;
}

/** Short inline line for a tool call that changed the mapping, or undefined. */
export function mappingNoticeFor(name: string, args: Record<string, unknown>, payload: unknown): string | undefined {
  const rec = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (rec.error) return undefined;
  switch (name) {
    case "map_slot": {
      const label = typeof rec.label === "string" && rec.label ? rec.label : String(args.slotId ?? "");
      return `Mapped ${label} ← ${String(args.path ?? "")}`;
    }
    case "import_suggestions": {
      const report = rec.report as ImportSuggestionsReport | undefined;
      if (!report) return undefined;
      const loops = report.loopsAccepted ? `, ${report.loopsAccepted} loop${report.loopsAccepted === 1 ? "" : "s"}` : "";
      const errors = report.errors?.length ? `, ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}` : "";
      return `Imported ${report.applied} suggestion${report.applied === 1 ? "" : "s"}${loops}${errors}`;
    }
    case "optional_rm_add":
      return `Added optional ${String(args.attributeName ?? "")} (${String(args.rmType ?? "")})`;
    case "optional_rm_remove":
      return `Removed optional ${String(args.attributeName ?? "")}`;
    case "replace_sheets": {
      const n = Array.isArray(args.sheets) ? args.sheets.length : 0;
      return `Replaced Sheets / Decision tables (${n})`;
    }
    case "set_active_example":
      return `Active Example → ${String(args.id ?? "")}`;
    default:
      return undefined;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function assistantMessageForLoop(
  message: ChatMessage | undefined,
  toolCalls: Array<{ id: string; name: string; arguments: string; extraContent?: unknown }>,
): ChatMessage {
  if (message?.tool_calls?.length) return message;
  return {
    role: "assistant",
    content: message?.content ?? null,
    tool_calls: toolCalls.map((row) => ({
      id: row.id,
      type: "function",
      function: { name: row.name, arguments: row.arguments },
      ...(row.extraContent !== undefined ? { extra_content: row.extraContent } : {}),
    })),
  };
}

export const MAPPING_TOOLS_USER_PREFIX =
  "The markdown that follows is project context (slot manifest, source tree, example list). Map with the function tools: map_slot for Click-to-Map paths, import_suggestions for loops / Decision tables / bulk envelopes, get_example for example values, then run_test.";

export async function runMappingAgent(options: RunMappingAgentOptions): Promise<MappingAgentResult> {
  const tools = mappingAgentOpenAiTools();
  const history = options.history ?? [];
  const messages: ChatMessage[] = [
    { role: "system", content: MAPPING_TOOLS_SYSTEM },
    ...history,
    {
      role: "user",
      content: history.length ? options.prompt : `${MAPPING_TOOLS_USER_PREFIX}\n\n${options.prompt}`,
    },
  ];
  const conversation = () => messages.slice(1);
  const toolNames: string[] = [];
  const maxSteps = options.maxSteps ?? 16;
  let lastText = "";
  // Text the model writes next to tool calls is part of the answer (models
  // continue a sentence across steps): keep every step's text, not only the last.
  const texts: string[] = [];
  const answer = () => texts.join("\n\n");
  let imported: ImportSuggestionsReport | undefined;
  const suggestionNotes: SuggestionNote[] = [];

  const mappingNotices: string[] = [];
  const emit = options.onEvent;
  let partial = "";
  const onDelta = emit
    ? (delta: ChatStreamDelta) => {
      if (delta.kind === "text") {
        partial += delta.text;
        emit({ type: "text", text: delta.text });
      } else if (delta.kind === "reasoning") emit({ type: "reasoning", text: delta.text });
      else emit({ type: "tool", name: delta.name });
    }
    : undefined;
  const result = (step: number, extra: Partial<MappingAgentResult>): MappingAgentResult => ({
    text: answer(),
    toolNames,
    imported,
    steps: step,
    messages: compactToolHistory(conversation()),
    suggestionNotes,
    mappingNotices,
    ...extra,
  });
  const stopped = (step: number): MappingAgentResult => {
    if (partial.trim()) texts.push(partial.trim());
    return result(step, { stopped: true });
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (options.signal?.aborted) return stopped(step - 1);
    emit?.({ type: "step", step });
    partial = "";
    let completion: ChatCompletionResult;
    try {
      completion = await postChatCompletions(options.credentials, compactToolHistory(messages), {
        fetch: options.fetch,
        signal: stepSignal(options.signal, options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS),
        proxyUrl: options.proxyUrl,
        tools,
        ...(onDelta ? { onDelta } : {}),
      });
    } catch (err) {
      if (options.signal?.aborted && isAbortError(err, options.signal)) return stopped(step);
      throw err;
    }
    partial = "";
    lastText = completion.text;
    if (completion.text.trim()) texts.push(completion.text.trim());
    const calls = completion.toolCalls ?? [];
    if (!calls.length) {
      if (options.importText && looksLikeSuggestionsPayload(completion.text)) {
        imported = await options.importText(completion.text);
        const notice = mappingNoticeFor("import_suggestions", {}, { report: imported });
        if (notice) {
          mappingNotices.push(notice);
          emit?.({ type: "mapping", text: notice });
        }
      }
      messages.push(completion.assistantMessage ?? { role: "assistant", content: completion.text });
      return result(step, completion.truncated ? { truncated: true } : {});
    }

    messages.push(assistantMessageForLoop(completion.assistantMessage, calls));
    let mutated = false;
    for (const call of calls) {
      toolNames.push(call.name);
      const args = parseToolArgs(call.arguments);
      let payload: unknown;
      // After Stop, answer the remaining calls without running them so the
      // stored conversation stays valid (every tool_call has a tool result).
      if (options.signal?.aborted) {
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify({ error: "Stopped by the user before this tool ran" }),
        });
        continue;
      }
      try {
        if (call.name === "import_suggestions" || call.name === "map_slot") {
          suggestionNotes.push(...notesFromToolArgs(call.name, args));
        }
        payload = await options.executeTool(call.name, args);
        if (isMutatingCallAiTool(call.name)) mutated = true;
        if (call.name === "import_suggestions" && payload && typeof payload === "object" && "report" in payload) {
          imported = (payload as { report: ImportSuggestionsReport }).report;
        }
        const notice = mappingNoticeFor(call.name, args, payload);
        if (notice) {
          mappingNotices.push(notice);
          emit?.({ type: "mapping", text: notice });
        }
      } catch (err) {
        payload = { error: err instanceof Error ? err.message : String(err) };
        emit?.({ type: "tool-error", name: call.name, error: String((payload as { error: string }).error) });
      }
      messages.push({
        role: "tool",
        name: call.name,
        tool_call_id: call.id,
        content: JSON.stringify(payload),
      });
    }
    if (mutated) options.onAfterMutation?.();
    if (options.signal?.aborted) return stopped(step);
  }

  if (options.importText && looksLikeSuggestionsPayload(lastText)) {
    imported = await options.importText(lastText);
  }
  return result(maxSteps, { stepLimitReached: true });
}

function notesFromToolArgs(name: string, args: Record<string, unknown>): SuggestionNote[] {
  try {
    if (name === "map_slot") {
      return collectSuggestionNotes({ suggestions: [{ slotId: args.slotId, note: args.note, confidence: args.confidence }] });
    }
    if (typeof args.text === "string") {
      return collectSuggestionNotes(
        extractSuggestionsJson(applySuggestionReviewDefaults(args.text, args.note, args.confidence)),
      );
    }
    return collectSuggestionNotes(args.envelope ?? args);
  } catch {
    return [];
  }
}

/** Appended to the user message when the provider rejected function tools. */
export const SUGGESTIONS_FALLBACK_INSTRUCTION =
  "Function tools are not available for this provider, so ignore any tool instructions above: reply with exactly one fenced `intehrgrator-suggestions` JSON block (version \"2\", Blockly `block` fragments; copy each `slotId` from the slot manifest), plus optional `### Notes` / `### Questions`.";

/**
 * One suggestions-JSON chat turn (no tools) with the chat history. AI chat uses
 * it only as the fallback for a provider that rejects function tools; the
 * caller applies the JSON directly (revertible), without the import modal.
 */
export async function runSuggestionsChatTurn(options: {
  credentials: AiProviderCredentials;
  prompt: string;
  history?: ChatMessage[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  proxyUrl?: string;
  /** Stream text / reasoning deltas into the chat bubble. */
  onEvent?: (event: MappingAgentEvent) => void;
}): Promise<{ text: string; messages: ChatMessage[]; truncated?: boolean }> {
  const history = options.history ?? [];
  const messages: ChatMessage[] = [
    { role: "system", content: SUGGESTIONS_SYSTEM },
    ...history,
    { role: "user", content: options.prompt },
  ];
  const completion = await postChatCompletions(options.credentials, messages, {
    fetch: options.fetch,
    signal: options.signal,
    proxyUrl: options.proxyUrl,
    ...(options.onEvent
      ? {
        onDelta: (delta: ChatStreamDelta) => {
          if (delta.kind === "text") options.onEvent?.({ type: "text", text: delta.text });
          else if (delta.kind === "reasoning") options.onEvent?.({ type: "reasoning", text: delta.text });
        },
      }
      : {}),
  });
  messages.push({ role: "assistant", content: completion.text });
  return {
    text: completion.text,
    messages: messages.slice(1),
    ...(completion.truncated ? { truncated: true } : {}),
  };
}

/**
 * Run the chat's tool loop through an `AgentClient` (ADR 0014): the same
 * `callAgentTool` on a `WorkbenchService` as MCP. Only the chat tools
 * (`CALL_AI_TOOL_NAMES`) run; anything else is answered with an error.
 */
export async function runMappingAgentOnClient(
  client: AgentClient,
  options: Omit<RunMappingAgentOptions, "executeTool" | "importText"> & {
    /**
     * Wraps each write the AI makes (a mutating tool, an answer applied as
     * suggestions JSON), e.g. to attribute it to the AI (ADR 0014).
     */
    asAiWrite?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<MappingAgentResult> {
  const { asAiWrite, ...rest } = options;
  const write = <T>(fn: () => Promise<T>): Promise<T> => asAiWrite ? asAiWrite(fn) : fn();
  return await runMappingAgent({
    ...rest,
    executeTool: (name, args) => {
      if (!isCallAiToolName(name)) {
        return Promise.reject(new Error(`AI chat cannot run ${name}; use MCP / Agent API for that tool`));
      }
      return isMutatingCallAiTool(name) ? write(() => client.callTool(name, args)) : client.callTool(name, args);
    },
    importText: (text) =>
      write(async () => ((await client.callTool("import_suggestions", { text })) as { report: ImportSuggestionsReport }).report),
  });
}
