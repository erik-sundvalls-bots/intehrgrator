/**
 * 💬 language widget (#279): a small button showing the language a pane's
 * labels / descriptions are shown in, with a popover to pick another one or
 * go back to following `lang.1`. Hidden when the pane has fewer than two
 * languages. Keyboard: Enter/Space/ArrowDown open, arrows move, Escape closes.
 */

export interface LanguageWidgetState {
  /** Languages in priority order (`lang.1` first). */
  languages: string[];
  current: string | null;
  /** The user picked `current` (else it follows `lang.1`). */
  chosen: boolean;
}

export interface LanguageWidgetOptions {
  /** Shown name of a code, in the UI language. */
  nameOf: (code: string) => string;
  /** False for a code that is not in the ISO 639-1 codeset: shown as-is with a warning (#279). */
  isKnown?: (code: string) => boolean;
  /** `null` = follow `lang.1` again. */
  onPick: (code: string | null) => void;
  texts: () => { aria: string; title: string; follow: string; chosen: string; unknown?: string };
}

export interface LanguageWidget {
  root: HTMLElement;
  update(state: LanguageWidgetState): void;
}

export function createLanguageWidget(root: HTMLElement, options: LanguageWidgetOptions): LanguageWidget {
  root.classList.add("lang-widget");
  root.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lang-widget-btn";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "lang-widget-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  if (root.id) {
    menu.id = `${root.id}-menu`;
    button.setAttribute("aria-controls", menu.id);
  }
  root.replaceChildren(button);
  // In <body>, fixed under the button: pane stacking contexts cannot cover it.
  if (root.classList.contains("lang-widget--on-dark")) menu.classList.add("lang-widget-menu--from-dark");
  document.body.appendChild(menu);

  let state: LanguageWidgetState = { languages: [], current: null, chosen: false };
  let signature = "";

  const items = () => [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
  const close = (focusButton = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusButton) button.focus();
  };
  const onOutside = (event: Event) => {
    const target = event.target as Node;
    if (!root.contains(target) && !menu.contains(target)) close();
  };
  const place = () => {
    const r = button.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.right = `${Math.max(4, Math.round(globalThis.innerWidth - r.right))}px`;
  };
  const open = (focusIndex?: number) => {
    place();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    const list = items();
    const index = focusIndex ?? Math.max(0, list.findIndex((b) => b.getAttribute("aria-checked") === "true"));
    list[index]?.focus();
  };

  button.addEventListener("click", () => (menu.hidden ? open() : close()));
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowUp" ? items().length - 1 : undefined);
    }
  });
  menu.addEventListener("keydown", (event) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      list[event.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  });

  const render = () => {
    const t = options.texts();
    const { languages, current, chosen } = state;
    root.hidden = languages.length < 2;
    const others = languages.filter((l) => l !== current).map(options.nameOf).join(", ");
    button.textContent = `💬 ${current ?? ""}`;
    const name = current ? options.nameOf(current) : "";
    button.setAttribute("aria-label", `${t.aria}: ${name}`);
    button.title = `${t.title}: ${name}${chosen ? ` (${t.chosen})` : ""}${others ? `\n${others}` : ""}`;
    menu.setAttribute("aria-label", t.aria);
    const rows: HTMLElement[] = [];
    const follow = document.createElement("button");
    follow.type = "button";
    follow.className = "lang-widget-item lang-widget-follow";
    follow.setAttribute("role", "menuitemradio");
    follow.setAttribute("aria-checked", String(!chosen));
    follow.textContent = `${t.follow} (${languages[0] ?? ""})`;
    follow.addEventListener("click", () => {
      close(true);
      options.onPick(null);
    });
    rows.push(follow);
    languages.forEach((code, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lang-widget-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(chosen && code === current));
      item.dataset.lang = code;
      const rank = document.createElement("span");
      rank.className = "lang-widget-rank";
      rank.textContent = `${i + 1}.`;
      item.append(rank, document.createTextNode(` ${options.nameOf(code)} `));
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      item.append(codeEl);
      if (options.isKnown && !options.isKnown(code)) {
        const warn = document.createElement("span");
        warn.className = "lang-widget-unknown";
        warn.textContent = " ⚠";
        warn.setAttribute("aria-hidden", "true");
        item.append(warn);
        item.title = (t.unknown ?? "Not an ISO 639-1 code: {code}").replace("{code}", code);
        item.dataset.unknown = "true";
      }
      if (code === current) item.classList.add("is-current");
      item.addEventListener("click", () => {
        close(true);
        options.onPick(code);
      });
      rows.push(item);
    });
    menu.replaceChildren(...rows);
  };

  return {
    root,
    update(next) {
      const sig = JSON.stringify(next);
      if (sig === signature) return;
      signature = sig;
      state = next;
      const wasOpen = !menu.hidden;
      render();
      if (wasOpen) open();
    },
  };
}
