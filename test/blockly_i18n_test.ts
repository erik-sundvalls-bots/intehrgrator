import { assertEquals } from "@std/assert";
import { msg, isIntehrLocale, SUPPORTED_LOCALES } from "@intehrgrator/blockly/i18n/custom_msg.ts";
import {
  isStashedProjectBundle,
  stashLocaleReloadProject,
  takeLoadOnceProject,
} from "@intehrgrator/blockly/i18n/locale.ts";

Deno.test("supported locales include en sv de es ca fr", () => {
  assertEquals(
    SUPPORTED_LOCALES.map((l) => l.code).sort().join(","),
    ["ca", "de", "en", "es", "fr", "sv"].sort().join(","),
  );
  for (const code of ["en", "sv", "de", "es", "ca", "fr"]) {
    assertEquals(isIntehrLocale(code), true);
  }
});

Deno.test("locale reload stashes a project once", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  const previous = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  try {
    const bundle = { version: 1, examples: [{ id: "ex" }], mapping: { model: {} } };
    assertEquals(stashLocaleReloadProject(bundle), true);
    const taken = takeLoadOnceProject();
    assertEquals(isStashedProjectBundle(taken), true);
    assertEquals((taken as { examples: Array<{ id: string }> }).examples[0]?.id, "ex");
    assertEquals(takeLoadOnceProject(), null);
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: previous,
    });
  }
});

Deno.test("custom messages localize Source and Loops & Logic", () => {
  assertEquals(msg("en").CAT_SEARCH, "Search");
  assertEquals(msg("sv").CAT_SEARCH, "Sök");
  assertEquals(msg("sv").CAT_SOURCE, "Källa");
  assertEquals(msg("en").CAT_LOGIC, "Loops & Logic");
  assertEquals(msg("sv").CAT_LOGIC, "Loopar & logik");
  assertEquals(msg("de").FOR_EACH_SOURCE_PREFIX, "für jedes");
  assertEquals(msg("es").CAT_OPENEHR_TYPES, "openEHR");
  assertEquals(msg("ca").LANGUAGE_LABEL, "Idioma");
  assertEquals(msg("en").UI_LANGUAGE_LABEL, "UI");
  assertEquals(msg("sv").MODEL_LANGUAGE_LABEL, "Modell");
  assertEquals(msg("fr").SOURCE_QUERY, "source");
  assertEquals(msg("en").LOGIC_ALL, "all");
  assertEquals(msg("en").CAT_DECISION_TABLES, "Decision Tables");
  assertEquals(msg("en").CAT_SHEETS, "Sheets");
  assertEquals(msg("sv").CAT_DECISION_TABLES, "Beslutstabeller");
  assertEquals(msg("sv").CAT_SHEETS, "Kalkylblad");
  assertEquals(msg("en").LOGIC_LOOP_INDEX, "index");
  assertEquals(msg("sv").LOGIC_LOOP_LENGTH, "längd");
  assertEquals(msg("sv").LOGIC_MATCH, "matchar");
  assertEquals(msg("de").LOGIC_SET_CONN_NOT_IN, "aber nicht in");
});

Deno.test("ensureStockBlocklyMessages populates English fallback and deserializes lists_getIndex", async () => {
  const { ensureStockBlocklyMessages } = await import("@intehrgrator/blockly/mod.ts");
  const { Blockly } = await import("@intehrgrator/blockly/blockly_core.ts");
  ensureStockBlocklyMessages();
  const Msg = (Blockly as unknown as { Msg: Record<string, string> }).Msg;
  assertEquals(typeof Msg.LISTS_GET_INDEX_FIRST, "string");
  assertEquals(typeof Msg.INTEHR_SOURCE_QUERY, "string");

  const workspace = new Blockly.Workspace();
  try {
    const block = workspace.newBlock("lists_getIndex");
    assertEquals(Boolean(block), true);
  } finally {
    workspace.dispose();
  }
});

