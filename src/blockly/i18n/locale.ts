/**
 * Blockly / application UI locale loading for intEHRgrator.
 * Stock strings: blockly/msg/{lang}. Custom: ./custom_msg.ts
 * This setting drives Blockly messages and the rest of the web app chrome.
 */
import { Blockly } from "../blockly_core.ts";
import {
  isIntehrLocale,
  msg,
  type IntehrLocale,
  SUPPORTED_LOCALES,
} from "./custom_msg.ts";

export { SUPPORTED_LOCALES, msg, type IntehrLocale, isIntehrLocale };

const STORAGE_KEY = "intehrgrator.blockly.hl";
const LOAD_ONCE_BLOCKS_KEY = "intehrgrator.loadOnceBlocks";
const LOAD_ONCE_PROJECT_KEY = "intehrgrator.loadOnceProject";
const LOCALE_RELOAD_AUTOSAVE_KEY = "intehrgrator.localeReloadAutosave";

export function detectLocale(): IntehrLocale {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? "").get("hl");
    if (fromUrl && isIntehrLocale(fromUrl)) return fromUrl;
  } catch {
    // no location
  }
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && isIntehrLocale(stored)) return stored;
  } catch {
    // storage flaky
  }
  return "en";
}

export async function loadBlocklyLocale(locale: IntehrLocale): Promise<void> {
  const table = await importBlocklyMsg(locale);
  Blockly.setLocale(table as unknown as Record<string, string>);
  // Merge custom keys into Blockly.Msg for %{BKY_…} style if needed later
  const custom = msg(locale);
  const Msg = (Blockly as unknown as { Msg: Record<string, string> }).Msg;
  if (Msg) {
    Msg["INTEHR_SOURCE_QUERY"] = custom.SOURCE_QUERY;
    Msg["INTEHR_SOURCE_QUERY_TOOLTIP"] = custom.SOURCE_QUERY_TOOLTIP;
    Msg["INTEHR_FOR_EACH_SOURCE_PREFIX"] = custom.FOR_EACH_SOURCE_PREFIX;
    Msg["INTEHR_FOR_EACH_SOURCE_IN"] = custom.FOR_EACH_SOURCE_IN;
    Msg["INTEHR_FOR_EACH_SOURCE_NODES"] = custom.FOR_EACH_SOURCE_NODES;
    Msg["INTEHR_FOR_EACH_SOURCE_DO"] = custom.FOR_EACH_SOURCE_DO;
    Msg["INTEHR_FOR_EACH_SOURCE_TOOLTIP"] = custom.FOR_EACH_SOURCE_TOOLTIP;
    Msg["INTEHR_ID_LANGUAGE"] = custom.ID_LANGUAGE;
    Msg["INTEHR_ID_LANGUAGE_TOOLTIP"] = custom.ID_LANGUAGE_TOOLTIP;
  }
}

async function importBlocklyMsg(locale: IntehrLocale): Promise<Record<string, string>> {
  const mod = await (async () => {
    switch (locale) {
      case "sv":
        return await import("blockly/msg/sv");
      case "de":
        return await import("blockly/msg/de");
      case "es":
        return await import("blockly/msg/es");
      case "ca":
        return await import("blockly/msg/ca");
      case "fr":
        return await import("blockly/msg/fr");
      default:
        return await import("blockly/msg/en");
    }
  })();
  // deno-lint-ignore no-explicit-any
  const anyMod = mod as any;
  if (anyMod.default && typeof anyMod.default === "object") return anyMod.default;
  return anyMod as Record<string, string>;
}

/** Persist locale and reload (same pattern as Blockly DevSite demo). */
export function changeLocaleAndReload(
  locale: IntehrLocale,
  workspaceState?: unknown,
): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
    if (workspaceState !== undefined) {
      globalThis.sessionStorage?.setItem(
        LOAD_ONCE_BLOCKS_KEY,
        JSON.stringify(workspaceState),
      );
    }
  } catch {
    // storage flaky
  }
  const url = new URL(globalThis.location.href);
  url.searchParams.set("hl", locale);
  globalThis.location.href = url.toString();
}

/**
 * Keep the open project across the UI-language reload.
 * Returns false when sessionStorage rejects the payload (quota); the caller
 * should then write an autosave and set the autosave flag.
 */
export function stashLocaleReloadProject(bundle: unknown): boolean {
  try {
    globalThis.sessionStorage?.setItem(LOAD_ONCE_PROJECT_KEY, JSON.stringify(bundle));
    globalThis.sessionStorage?.removeItem(LOAD_ONCE_BLOCKS_KEY);
    globalThis.sessionStorage?.removeItem(LOCALE_RELOAD_AUTOSAVE_KEY);
    return true;
  } catch {
    try {
      globalThis.sessionStorage?.removeItem(LOAD_ONCE_PROJECT_KEY);
    } catch {
      // storage flaky
    }
    return false;
  }
}

export function markLocaleReloadAutosave(): void {
  try {
    globalThis.sessionStorage?.setItem(LOCALE_RELOAD_AUTOSAVE_KEY, "1");
  } catch {
    // storage flaky
  }
}

export function takeLoadOnceProject(): unknown | null {
  return takeSessionJson(LOAD_ONCE_PROJECT_KEY);
}

/** Shape check for a project JSON stashed across a UI-language reload. */
export function isStashedProjectBundle(value: unknown): value is {
  version: number;
  examples: unknown[];
  mapping: object;
} {
  if (!value || typeof value !== "object") return false;
  const rec = value as { version?: unknown; examples?: unknown; mapping?: unknown };
  return typeof rec.version === "number" &&
    Array.isArray(rec.examples) &&
    rec.mapping != null &&
    typeof rec.mapping === "object";
}

export function takeLocaleReloadAutosave(): boolean {
  try {
    const flag = globalThis.sessionStorage?.getItem(LOCALE_RELOAD_AUTOSAVE_KEY);
    globalThis.sessionStorage?.removeItem(LOCALE_RELOAD_AUTOSAVE_KEY);
    return flag === "1";
  } catch {
    return false;
  }
}

export function takeLoadOnceBlocks(): unknown | null {
  return takeSessionJson(LOAD_ONCE_BLOCKS_KEY);
}

function takeSessionJson(key: string): unknown | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    globalThis.sessionStorage?.removeItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
