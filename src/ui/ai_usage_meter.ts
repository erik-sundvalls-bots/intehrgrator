/**
 * Token / cost meter next to Stop in the AI chat (#276, #354): tokens (and $
 * when priceable) used by this chat, a ring for the model's context window,
 * and a popover with dual in/out counters, the optional USD or token budget,
 * and the context-window setting.
 */
import {
  type BudgetKind,
  budgetState,
  costBreakdown,
  effectiveCost,
  formatTokens,
  formatUsd,
  type ModelRate,
  parseTokenCount,
  parseUsdAmount,
  totalTokens,
  type UsageTotals,
} from "../core/ai/token_usage.ts";
import { chrome, formatMessage } from "./chrome_i18n.ts";
import { detectLocale } from "../blockly/i18n/locale.ts";

function ui() {
  return chrome(detectLocale());
}

export interface UsageMeterState {
  /** Finished turns of this chat. */
  chat?: UsageTotals;
  /** The running turn so far. */
  turn?: UsageTotals;
  running: boolean;
  model: string;
  /** Active budget kind for the current model. */
  budgetKind: BudgetKind;
  /** Token budget when `budgetKind === "tokens"`. */
  budgetTokens?: number;
  /** USD budget when `budgetKind === "usd"`. */
  budgetUsd?: number;
  /** Rates for the current model (dual $ + estimates). */
  modelRate?: ModelRate;
  /** Whether the meter may offer a USD budget (rates or reported cost). */
  canPrice: boolean;
  /** Window used for the ring: the user's value, else the known table. */
  contextWindow?: number;
  /** The user's value for this model, if any (shown in the field). */
  contextWindowOverride?: number;
  /** Context estimate before any request (history characters / 3). */
  contextEstimate?: number;
}

export interface UsageMeterOptions {
  /** The user saved a budget / context window (undefined = cleared). */
  onSave: (
    limits: {
      budgetUsd?: number;
      budgetTokens?: number;
      contextWindow?: number;
    },
  ) => void;
}

export interface UsageMeterHandle {
  element: HTMLElement;
  update(state: UsageMeterState): void;
  close(): void;
}

const RING_R = 7;
const RING_C = 2 * Math.PI * RING_R;

/** Context the model holds now: the newest request's input + output, else the estimate. */
export function contextUsed(
  state: Pick<UsageMeterState, "chat" | "turn" | "contextEstimate">,
): { tokens: number; estimated: boolean } {
  if (state.turn?.requests) {
    return { tokens: state.turn.lastContext, estimated: state.turn.estimated };
  }
  if (state.chat?.requests) {
    return { tokens: state.chat.lastContext, estimated: state.chat.estimated };
  }
  return { tokens: state.contextEstimate ?? 0, estimated: true };
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function mergeLive(
  chat?: UsageTotals,
  turn?: UsageTotals,
): UsageTotals | undefined {
  if (!chat?.requests && !turn?.requests) return undefined;
  if (!chat?.requests) return turn;
  if (!turn?.requests) return chat;
  return {
    input: chat.input + turn.input,
    output: chat.output + turn.output,
    cachedInput: chat.cachedInput + turn.cachedInput,
    ...((chat.cost !== undefined || turn.cost !== undefined)
      ? { cost: (chat.cost ?? 0) + (turn.cost ?? 0) }
      : {}),
    requests: chat.requests + turn.requests,
    estimated: chat.estimated || turn.estimated,
    lastContext: turn.lastContext,
  };
}

function usageLine(
  label: string,
  u: UsageTotals | undefined,
  rate?: ModelRate,
): string {
  if (!u?.requests) return formatMessage(ui().aiUsageLineNone, { label });
  const cached = u.cachedInput
    ? formatMessage(ui().aiUsageCached, { cached: formatTokens(u.cachedInput) })
    : "";
  const tokens = formatMessage(ui().aiUsageLine, {
    label,
    input: formatTokens(u.input),
    cached,
    output: formatTokens(u.output),
    requests: u.requests,
  });
  const split = costBreakdown(u, rate);
  const spent = effectiveCost(u, rate);
  let money = "";
  if (split) {
    money = ` · ${
      formatMessage(ui().aiUsageCostSplit, {
        input: formatUsd(split.input, spent?.estimated ?? true),
        output: formatUsd(split.output, spent?.estimated ?? true),
      })
    }`;
  } else if (spent) {
    money = ` · ${formatUsd(spent.cost, spent.estimated)}`;
  }
  return tokens + money + (u.estimated ? ` ${ui().aiUsageEstimatedMark}` : "");
}

export function installUsageMeter(
  options: UsageMeterOptions,
): UsageMeterHandle {
  const wrap = document.createElement("span");
  wrap.className = "ai-usage";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ai-chat-usage";
  btn.className = "pane-btn ai-usage-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-expanded", "false");
  const svgNs = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(svgNs, "svg");
  ring.setAttribute("viewBox", "0 0 18 18");
  ring.setAttribute("aria-hidden", "true");
  ring.classList.add("ai-usage-ring");
  ring.id = "ai-chat-context-ring";
  const track = document.createElementNS(svgNs, "circle");
  const arc = document.createElementNS(svgNs, "circle");
  for (const c of [track, arc]) {
    c.setAttribute("cx", "9");
    c.setAttribute("cy", "9");
    c.setAttribute("r", String(RING_R));
    c.setAttribute("fill", "none");
    c.setAttribute("stroke-width", "3");
  }
  track.classList.add("ai-usage-ring-track");
  arc.classList.add("ai-usage-ring-arc");
  arc.setAttribute("transform", "rotate(-90 9 9)");
  arc.setAttribute("stroke-dasharray", `0 ${RING_C}`);
  ring.append(track, arc);
  const label = document.createElement("span");
  label.className = "ai-usage-label";
  btn.append(ring, label);

  const pop = document.createElement("div");
  pop.className = "ai-usage-popover";
  pop.id = "ai-chat-usage-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", ui().aiUsageTitle);
  pop.hidden = true;
  const details = document.createElement("div");
  details.className = "ai-usage-details";
  const form = document.createElement("form");
  form.className = "ai-usage-form";
  const field = (id: string, text: string, hint: string) => {
    const row = document.createElement("label");
    row.className = "ai-usage-field";
    const span = document.createElement("span");
    span.textContent = text;
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = hint;
    row.append(span, input);
    return { row, input, span };
  };
  const budgetField = field(
    "ai-chat-budget",
    ui().aiUsageBudgetLabelUsd,
    ui().aiUsageBudgetHintUsd,
  );
  const windowField = field(
    "ai-chat-context-window",
    ui().aiUsageWindowLabel,
    "",
  );
  const help = document.createElement("p");
  help.className = "ai-usage-help";
  help.textContent = ui().aiUsageHelp;
  const buttons = document.createElement("div");
  buttons.className = "ai-usage-buttons";
  const save = document.createElement("button");
  save.type = "submit";
  save.id = "ai-chat-usage-save";
  save.className = "pane-btn pane-btn-primary";
  save.textContent = ui().aiUsageSave;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pane-btn";
  close.textContent = ui().aiUsageClose;
  buttons.append(close, save);
  form.append(budgetField.row, windowField.row, help, buttons);
  pop.append(details, form);
  wrap.append(btn, pop);

  let state: UsageMeterState = {
    running: false,
    model: "",
    budgetKind: "none",
    canPrice: false,
  };

  const render = () => {
    const live = mergeLive(state.chat, state.turn);
    const tokensUsed = totalTokens(live ?? { input: 0, output: 0 });
    const spent = live ? effectiveCost(live, state.modelRate) : undefined;
    const estimated = Boolean(live?.estimated || spent?.estimated);
    const tokenCap = state.budgetKind === "tokens"
      ? state.budgetTokens
      : undefined;
    const usdCap = state.budgetKind === "usd" ? state.budgetUsd : undefined;
    const showUsd = state.budgetKind === "usd" ||
      (state.canPrice && state.budgetKind !== "tokens" && spent !== undefined);
    const usedForBudget = usdCap !== undefined
      ? (spent?.cost ?? 0)
      : tokensUsed;
    const budgetCap = usdCap ?? tokenCap;
    const level = budgetState(usedForBudget, budgetCap);
    btn.classList.toggle("ai-usage-btn--warn", level === "warn");
    btn.classList.toggle("ai-usage-btn--over", level === "over");
    btn.classList.toggle("ai-usage-btn--running", state.running);
    if (showUsd || usdCap !== undefined) {
      const usedLabel = spent ? formatUsd(spent.cost, estimated) : formatUsd(0);
      label.textContent = usdCap !== undefined
        ? `${usedLabel} / ${formatUsd(usdCap)}`
        : usedLabel;
    } else {
      const tokens = `${estimated && !spent ? "~" : ""}${
        formatTokens(tokensUsed)
      }`;
      label.textContent = tokenCap
        ? `${tokens} / ${formatTokens(tokenCap)}`
        : tokens;
    }
    const ctx = contextUsed(state);
    const lines: string[] = [];
    if (state.contextWindow) {
      const share = Math.min(1, ctx.tokens / state.contextWindow);
      ring.style.display = "";
      arc.setAttribute(
        "stroke-dasharray",
        `${(share * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`,
      );
      ring.classList.toggle("ai-usage-ring--high", share >= 0.8);
      lines.push(formatMessage(ui().aiUsageContext, {
        used: `${ctx.estimated ? "~" : ""}${formatTokens(ctx.tokens)}`,
        window: formatTokens(state.contextWindow),
        percent: percent(ctx.tokens, state.contextWindow),
      }));
    } else {
      ring.style.display = "none";
      lines.push(ui().aiUsageContextUnknown);
    }
    if (state.running) {
      lines.push(usageLine(ui().aiUsageThisTurn, state.turn, state.modelRate));
    }
    lines.push(usageLine(ui().aiUsageThisChat, state.chat, state.modelRate));
    if (usdCap !== undefined) {
      lines.push(formatMessage(ui().aiUsageBudgetLine, {
        used: spent ? formatUsd(spent.cost, spent.estimated) : formatUsd(0),
        budget: formatUsd(usdCap),
        percent: percent(spent?.cost ?? 0, usdCap),
      }));
    } else if (tokenCap !== undefined) {
      lines.push(formatMessage(ui().aiUsageBudgetLine, {
        used: formatTokens(tokensUsed),
        budget: formatTokens(tokenCap),
        percent: percent(tokensUsed, tokenCap),
      }));
    }
    btn.title = [ui().aiUsageTitle, ...lines].join("\n");
    btn.setAttribute("aria-label", btn.title);
    details.replaceChildren(...lines.map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    }));
    windowField.input.placeholder =
      state.contextWindow && !state.contextWindowOverride
        ? formatMessage(ui().aiUsageWindowKnown, {
          tokens: formatTokens(state.contextWindow),
        })
        : ui().aiUsageWindowUnknownHint;
  };

  const syncBudgetField = () => {
    const usd = state.canPrice || state.budgetKind === "usd";
    budgetField.span.textContent = usd
      ? ui().aiUsageBudgetLabelUsd
      : ui().aiUsageBudgetLabelTokens;
    budgetField.input.placeholder = usd
      ? ui().aiUsageBudgetHintUsd
      : ui().aiUsageBudgetHintTokens;
    budgetField.input.inputMode = usd ? "decimal" : "numeric";
    help.textContent = usd ? ui().aiUsageHelpUsd : ui().aiUsageHelpTokens;
    if (usd) {
      budgetField.input.value = state.budgetUsd
        ? formatUsd(state.budgetUsd).replace(/^~/, "")
        : "";
    } else {
      budgetField.input.value = state.budgetTokens
        ? formatTokens(state.budgetTokens)
        : "";
    }
  };

  const open = () => {
    syncBudgetField();
    windowField.input.value = state.contextWindowOverride
      ? formatTokens(state.contextWindowOverride)
      : "";
    (windowField.row.firstChild as HTMLElement).textContent = formatMessage(
      ui().aiUsageWindowLabel,
      { model: state.model || "?" },
    );
    pop.hidden = false;
    // Fixed above the button, kept inside the window (the chat pane clips overflow).
    const rect = btn.getBoundingClientRect();
    const width = Math.min(320, globalThis.innerWidth - 16);
    pop.style.width = `${width}px`;
    pop.style.left = `${
      Math.max(
        8,
        Math.min(rect.right - width, globalThis.innerWidth - width - 8),
      )
    }px`;
    const height = pop.getBoundingClientRect().height;
    pop.style.top = `${Math.max(8, rect.top - height - 6)}px`;
    btn.setAttribute("aria-expanded", "true");
    budgetField.input.focus();
  };
  const hide = () => {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => (pop.hidden ? open() : hide()));
  close.addEventListener("click", hide);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const usd = state.canPrice || state.budgetKind === "usd";
    const raw = budgetField.input.value.trim();
    options.onSave({
      ...(usd
        ? {
          budgetUsd: raw ? parseUsdAmount(raw) : undefined,
          budgetTokens: undefined,
        }
        : {
          budgetTokens: raw ? parseTokenCount(raw) : undefined,
          budgetUsd: undefined,
        }),
      contextWindow: parseTokenCount(windowField.input.value),
    });
    hide();
  });
  pop.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      hide();
      btn.focus();
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!pop.hidden && !wrap.contains(ev.target as Node)) hide();
  });

  render();
  return {
    element: wrap,
    update(next) {
      state = next;
      render();
    },
    close: hide,
  };
}
