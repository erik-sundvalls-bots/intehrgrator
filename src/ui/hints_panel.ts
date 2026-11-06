/**
 * Hints tab: every value-set slot, and the actions that turn one hint into a mapping.
 * The interactive AI offer is the caller's job. This panel never runs a prompt.
 */
import type { ValueSetHint, ValueSetHintKind } from "../core/hints/value_set_hint.ts";

export interface HintsPanelChrome {
  filter: string;
  filterAria: string;
  kindAll: string;
  kindCoded: string;
  kindOrdinal: string;
  kindString: string;
  kindUnits: string;
  useConstant: string;
  decisionTable: string;
  sheetLookup: string;
  dismiss: string;
  restore: string;
  empty: string;
  dismissed: string;
  assumed: string;
  noAssumed: string;
  blankSource: string;
}

export interface HintsPanelActions {
  apply(request: { slotId?: string; action: "constant" | "decision_table" | "sheet_lookup" | "dismiss" | "restore"; codes?: string[] }): {
    grid?: { prompt: string };
  };
  /** Called after a decision table or sheet lookup, so the UI can offer a prompt once. */
  onGrid?(prompt: string): void;
  onSelect?(slotId: string): void;
}

const KINDS: Array<{ id: "all" | ValueSetHintKind; key: keyof HintsPanelChrome }> = [
  { id: "all", key: "kindAll" },
  { id: "coded", key: "kindCoded" },
  { id: "ordinal", key: "kindOrdinal" },
  { id: "string_list", key: "kindString" },
  { id: "units", key: "kindUnits" },
];

export function mountHintsPanel(
  root: HTMLElement,
  getHints: () => ValueSetHint[],
  actions: HintsPanelActions,
  chrome: () => HintsPanelChrome,
): { refresh: () => void; select: (slotId: string) => void; selectedSlotId: () => string | null } {
  let selected: string | null = null;
  let kind: "all" | ValueSetHintKind = "all";
  let query = "";
  const pressed = new Map<string, Set<string>>();

  root.classList.add("hints-panel");
  root.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "hints-toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "hints-filter";
  const kinds = document.createElement("div");
  kinds.className = "hints-kinds";
  kinds.setAttribute("role", "group");
  toolbar.append(filter, kinds);

  const body = document.createElement("div");
  body.className = "hints-body";
  const list = document.createElement("div");
  list.className = "hints-list";
  list.setAttribute("role", "listbox");
  const detail = document.createElement("div");
  detail.className = "hints-detail";
  body.append(list, detail);

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "pane-btn hints-restore";
  root.append(toolbar, body, restore);

  filter.addEventListener("input", () => {
    query = filter.value.trim().toLowerCase();
    paint();
  });
  restore.addEventListener("click", () => {
    actions.apply({ action: "restore" });
    paint();
  });

  function selectedCodes(hint: ValueSetHint): string[] {
    const set = pressed.get(hint.slotId);
    if (set && set.size) return [...set];
    return hint.assumed ? [hint.assumed] : [];
  }

  function toggleCode(hint: ValueSetHint, code: string): void {
    const set = new Set(pressed.get(hint.slotId) ?? (hint.assumed ? [hint.assumed] : []));
    if (set.has(code)) set.delete(code);
    else set.add(code);
    pressed.set(hint.slotId, set);
    paint();
  }

  function run(hint: ValueSetHint, action: "constant" | "decision_table" | "sheet_lookup" | "dismiss"): void {
    const codes = action === "dismiss" ? undefined : selectedCodes(hint);
    const result = actions.apply({
      slotId: hint.slotId,
      action,
      ...(codes && action !== "dismiss" ? { codes } : {}),
    });
    if ((action === "decision_table" || action === "sheet_lookup") && result.grid && actions.onGrid) {
      actions.onGrid(result.grid.prompt);
    }
    paint();
  }

  function paint(): void {
    const t = chrome();
    filter.placeholder = t.filter;
    filter.setAttribute("aria-label", t.filterAria);
    restore.textContent = t.restore;
    kinds.innerHTML = "";
    for (const item of KINDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hints-kind";
      button.textContent = t[item.key];
      button.setAttribute("aria-pressed", String(kind === item.id));
      button.addEventListener("click", () => {
        kind = item.id;
        paint();
      });
      kinds.append(button);
    }
    const hints = getHints().filter((hint) => {
      if (kind !== "all" && hint.kind !== kind) return false;
      if (!query) return true;
      const hay = [hint.label, hint.pathLabel ?? "", hint.slotId, ...hint.codes.flatMap((code) => [code.code, code.text])]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
    if (selected && !getHints().some((hint) => hint.slotId === selected)) selected = null;
    if (!selected && hints.length) selected = hints[0]!.slotId;
    list.innerHTML = "";
    if (!hints.length) {
      const empty = document.createElement("p");
      empty.className = "hints-empty";
      empty.textContent = t.empty;
      list.append(empty);
    }
    for (const hint of hints) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "hints-row";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(hint.slotId === selected));
      row.dataset.hintSlot = hint.slotId;
      if (hint.dismissed) row.classList.add("hints-row--dismissed");
      const name = document.createElement("span");
      name.className = "hints-row-name";
      name.textContent = hint.label;
      const chip = document.createElement("span");
      chip.className = "hints-row-kind";
      chip.textContent = t[KINDS.find((item) => item.id === hint.kind)?.key ?? "kindCoded"];
      row.append(name, chip);
      if (hint.dismissed) {
        const mark = document.createElement("span");
        mark.className = "hints-row-dismissed";
        mark.textContent = t.dismissed;
        row.append(mark);
      }
      row.addEventListener("click", () => {
        selected = hint.slotId;
        actions.onSelect?.(hint.slotId);
        paint();
      });
      list.append(row);
    }
    paintDetail(t, getHints().find((hint) => hint.slotId === selected) ?? null);
  }

  function paintDetail(t: HintsPanelChrome, hint: ValueSetHint | null): void {
    detail.innerHTML = "";
    if (!hint) {
      const empty = document.createElement("p");
      empty.className = "hints-empty";
      empty.textContent = t.empty;
      detail.append(empty);
      return;
    }
    const title = document.createElement("h3");
    title.className = "hints-detail-title";
    title.textContent = hint.pathLabel || hint.label;
    const assumed = document.createElement("p");
    assumed.className = "hints-assumed";
    assumed.textContent = hint.assumed ? `${t.assumed} ★` : `${t.noAssumed} ☆`;
    const chips = document.createElement("div");
    chips.className = "hints-chips";
    const chosen = new Set(selectedCodes(hint));
    for (const code of hint.codes) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "hints-chip";
      if (code.assumed) chip.classList.add("hints-chip--assumed");
      chip.setAttribute("aria-pressed", String(chosen.has(code.code)));
      chip.disabled = hint.dismissed;
      const star = code.assumed ? "★ " : "";
      const value = code.value !== undefined ? ` ${code.value}` : "";
      chip.textContent = `${star}${code.text || code.code}${code.text && code.text !== code.code ? ` (${code.code})` : ""}${value}`;
      chip.addEventListener("click", () => toggleCode(hint, code.code));
      chips.append(chip);
    }
    const note = document.createElement("p");
    note.className = "hints-note";
    note.textContent = t.blankSource;
    const buttons = document.createElement("div");
    buttons.className = "hints-actions";
    const specs: Array<{ action: "constant" | "decision_table" | "sheet_lookup" | "dismiss"; label: string }> = [
      { action: "constant", label: t.useConstant },
      { action: "decision_table", label: t.decisionTable },
      { action: "sheet_lookup", label: t.sheetLookup },
      { action: "dismiss", label: t.dismiss },
    ];
    for (const spec of specs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pane-btn";
      button.textContent = spec.label;
      button.disabled = hint.dismissed;
      button.addEventListener("click", () => run(hint, spec.action));
      buttons.append(button);
    }
    detail.append(title, assumed, chips, note, buttons);
  }

  return {
    refresh: paint,
    select(slotId: string) {
      selected = slotId;
      paint();
    },
    selectedSlotId: () => selected,
  };
}
