/**
 * web app chrome translations for the UI language setting.
 * Blockly block text stays in `src/blockly/i18n`. Model language stays separate.
 */
import { isIntehrLocale, type IntehrLocale } from "../blockly/i18n/custom_msg.ts";
import { en, type ChromeMessages } from "./chrome_en.ts";
import { ca } from "./chrome_ca.ts";
import { de } from "./chrome_de.ts";
import { es } from "./chrome_es.ts";
import { fr } from "./chrome_fr.ts";
import { sv } from "./chrome_sv.ts";
import type { TaskProgress } from "../workbench/task_progress.ts";

const TABLE: Record<IntehrLocale, ChromeMessages> = { en, sv, de, es, ca, fr };

const phraseIndex = new Map<IntehrLocale, Map<string, string>>();

export function chromeLocale(locale: string): IntehrLocale {
  return isIntehrLocale(locale) ? locale : "en";
}

export function chrome(locale: string): ChromeMessages {
  return TABLE[chromeLocale(locale)];
}

export function formatMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

function englishToLocal(locale: IntehrLocale): Map<string, string> {
  const cached = phraseIndex.get(locale);
  if (cached) return cached;
  const local = TABLE[locale];
  const map = new Map<string, string>();
  for (const key of Object.keys(en) as Array<keyof ChromeMessages>) {
    map.set(en[key], local[key]);
  }
  phraseIndex.set(locale, map);
  return map;
}

/** Translate a fixed English chrome phrase. Unknown text stays as written. */
export function localizePhrase(locale: string, phrase: string): string {
  const code = chromeLocale(locale);
  if (code === "en") return phrase;
  return englishToLocal(code).get(phrase) ?? phrase;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Translate Workbench status text for the status bar.
 * The controller keeps the English sentence so tests and the Agent API stay stable.
 */
export function localizeStatus(locale: string, message: string): string {
  const code = chromeLocale(locale);
  if (code === "en" || !message) return message;
  const t = TABLE[code];
  const exact = englishToLocal(code).get(message);
  if (exact && exact !== message) return exact;

  const rules: Array<{ re: RegExp; render: (m: RegExpMatchArray) => string }> = [
    {
      re: /^Loaded (.+) target (.+) into Target schema \(no product scaffold yet\)$/,
      render: (m) => formatMessage(t.loadedTargetIntoSchema, { format: m[1], id: m[2] }),
    },
    {
      re: /^Loaded (.+) target (.+)$/,
      render: (m) => formatMessage(t.loadedTarget, { format: m[1], id: m[2] }),
    },
    {
      re: /^Loaded GitHub template (.+) \((\d+) files\)( \(\d+ warnings\))?$/,
      render: (m) => formatMessage(t.loadedGithubTemplate, {
        id: m[1],
        n: m[2],
        extra: m[3] ? formatMessage(t.warningsParen, { n: m[3].replace(/\D/g, "") }) : "",
      }),
    },
    {
      re: /^Loaded GitHub schema (.+) \((\d+) files\)( \(\d+ warnings\))?$/,
      render: (m) => formatMessage(t.loadedGithubSchema, {
        id: m[1],
        n: m[2],
        extra: m[3] ? formatMessage(t.warningsParen, { n: m[3].replace(/\D/g, "") }) : "",
      }),
    },
    {
      re: /^Loaded schema (.+)$/,
      render: (m) => formatMessage(t.loadedSchema, { name: m[1] }),
    },
    {
      re: /^Loaded Blockly mapping (.+)$/,
      render: (m) => formatMessage(t.loadedBlockly, { name: m[1] }),
    },
    {
      re: /^Loaded Function library \((\d+)\)$/,
      render: (m) => formatMessage(t.loadedFunctionLibrary, { n: m[1] }),
    },
    {
      re: /^Loaded Function (.+)$/,
      render: (m) => formatMessage(t.loadedFunction, { name: m[1] }),
    },
    {
      re: /^Loaded example-set catalog \((\d+) sets?\)$/,
      render: (m) => formatMessage(t.loadedExampleCatalog, {
        n: m[1],
        sets: plural(Number(m[1]), t.setSingular, t.setPlural),
      }),
    },
    {
      re: /^Loaded example set "(.+)"$/,
      render: (m) => formatMessage(t.loadedExampleSet, { name: m[1] }),
    },
    {
      re: /^Example set "(.+)" failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.exampleSetFailed, { name: m[1], detail: m[2] }),
    },
    {
      re: /^Added example (.+) with (\d+) schema mismatches?$/,
      render: (m) => formatMessage(t.addedExampleMismatch, {
        name: m[1],
        n: m[2],
        mismatch: plural(Number(m[2]), t.mismatchSingular, t.mismatchPlural),
      }),
    },
    {
      re: /^Added example (.+)$/,
      render: (m) => formatMessage(t.addedExample, { name: m[1] }),
    },
    {
      re: /^Added (\d+) examples with (\d+) schema mismatches?( \(\d+ warnings\))?$/,
      render: (m) => {
        const base = formatMessage(t.addedExamplesMismatch, {
          n: m[1],
          m: m[2],
          mismatch: plural(Number(m[2]), t.mismatchSingular, t.mismatchPlural),
        });
        return m[3] ? `${base}${formatMessage(t.warningsParen, { n: m[3].replace(/\D/g, "") })}` : base;
      },
    },
    {
      re: /^Added (\d+) examples( \(\d+ warnings\))?$/,
      render: (m) => {
        const base = formatMessage(t.addedExamples, { n: m[1] });
        return m[2] ? `${base}${formatMessage(t.warningsParen, { n: m[2].replace(/\D/g, "") })}` : base;
      },
    },
    {
      re: /^Saved as "(.+)"$/,
      render: (m) => formatMessage(t.savedAs, { name: m[1] }),
    },
    {
      re: /^AI prompt copied \((.+)\)$/,
      render: (m) => formatMessage(t.aiPromptCopied, { delivery: m[1] }),
    },
    {
      re: /^Listening for source path → (.+)$/,
      render: (m) => m[1] === "source query"
        ? t.listeningSourceQuery
        : formatMessage(t.listeningSlot, { slot: m[1] }),
    },
    {
      re: /^Mapped source query (.+)$/,
      render: (m) => formatMessage(t.mappedSourceQuery, { xpath: m[1] }),
    },
    {
      re: /^Mapped (.+)$/,
      render: (m) => formatMessage(t.mappedWhat, { what: m[1] }),
    },
    {
      re: /^Import: (\d+) applied, (\d+) loops, (\d+) skipped, (\d+) errors(?:, (\d+) schema)?$/,
      render: (m) => formatMessage(t.importSummary, {
        applied: m[1],
        loops: m[2],
        skipped: m[3],
        errors: m[4],
        schema: m[5] ? formatMessage(t.importSchemaNote, { n: m[5] }) : "",
      }),
    },
    {
      re: /^Import failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.importFailed, { detail: m[1] }),
    },
    {
      re: /^Target load failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.targetLoadFailed, { detail: m[1] }),
    },
    {
      re: /^Example load failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.exampleLoadFailed, { detail: m[1] }),
    },
    {
      re: /^Example folder load failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.exampleFolderFailed, { detail: m[1] }),
    },
    {
      re: /^Function library catalog failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.functionCatalogFailed, { detail: m[1] }),
    },
    {
      re: /^Example-set catalog failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.exampleCatalogFailed, { detail: m[1] }),
    },
    {
      re: /^Blockly JSON parse failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.blocklyParseFailed, { detail: m[1] }),
    },
    {
      re: /^Could not load (.+): ([\s\S]+)$/,
      render: (m) => formatMessage(t.couldNotLoad, { name: m[1], detail: m[2] }),
    },
    {
      re: /^Autosave failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.autosaveFailed, { detail: m[1] }),
    },
    {
      re: /^Model language: (.+)$/,
      render: (m) => formatMessage(t.modelLanguageStatus, { language: m[1] }),
    },
    {
      re: /^Call AI failed: ([\s\S]+)$/,
      render: (m) => formatMessage(t.callAiFailed, { detail: m[1] }),
    },
    {
      re: /^Scaffold target (.+) \(click the chip to toggle \*\.\)$/,
      render: (m) => formatMessage(t.scaffoldTarget, { path: m[1] }),
    },
    {
      re: /^Nested (.+) on the default context map$/,
      render: (m) => formatMessage(t.nestedOnMap, { label: m[1] }),
    },
    {
      re: /^Added entry (.+) \((.+)\) at row (\d+)$/,
      render: (m) => formatMessage(t.addedMapEntry, { key: m[1], path: m[2], row: m[3] }),
    },
    {
      re: /^Added (.+) from Target schema$/,
      render: (m) => formatMessage(t.addedFromTarget, { label: m[1] }),
    },
    {
      re: /^Added source (.+)$/,
      render: (m) => formatMessage(t.addedSource, { xpath: m[1] }),
    },
    {
      re: /^Refreshed (\S+) (.+) with no mapping conflicts\.$/,
      render: (m) => formatMessage(t.refreshedClean, { kind: localizePhrase(code, m[1]), name: m[2] }),
    },
    {
      re: /^Refreshed (\S+) (.+) → ([^\n]+)\n(\d+) warnings?:\n([\s\S]*)$/,
      render: (m) => {
        const n = Number(m[4]);
        const head = formatMessage(t.refreshedWithWarnings, {
          kind: localizePhrase(code, m[1]),
          previous: m[2],
          next: m[3],
        });
        const count = formatMessage(t.warningCount, {
          n: m[4],
          warnings: plural(n, t.warningSingular, t.warningPlural),
        });
        return `${head}\n${count}\n${m[5]}`;
      },
    },
    {
      re: /^Defaults catalog unavailable: ([\s\S]+)$/,
      render: (m) => formatMessage(t.defaultsUnavailable, { detail: m[1] }),
    },
    {
      re: /^Selected: (.+)$/,
      render: (m) => formatMessage(t.selectedFile, { name: m[1] }),
    },
    {
      re: /^Using loaded: (.+)$/,
      render: (m) => formatMessage(t.usingLoaded, { name: m[1] }),
    },
    {
      re: /^Fetched: (.+)$/,
      render: (m) => formatMessage(t.fetchedFile, { name: m[1] }),
    },
    {
      re: /^Browsed file: (.+)$/,
      render: (m) => formatMessage(t.browsedFileLabel, { name: m[1] }),
    },
    {
      re: /^autosaved at (.+)$/,
      render: (m) => formatMessage(t.autosavedAt, { time: m[1] }),
    },
    {
      re: /^Load example (\d+)$/,
      render: (m) => formatMessage(t.taskLoadExampleN, { n: m[1] }),
    },
    {
      re: /^Reading labels · (.+)$/,
      render: (m) => formatMessage(t.taskReadingLabels, { lang: m[1] }),
    },
    {
      re: /^Hardcoded “(.+)” into (\d+) lookups?$/,
      render: (m) => formatMessage(t.hardcodedLookups, {
        key: m[1],
        n: m[2],
        lookups: plural(Number(m[2]), t.lookupSingular, t.lookupPlural),
      }),
    },
    {
      re: /^No maps_get\("defaults", "(.+)"\) lookups found on the canvas$/,
      render: (m) => formatMessage(t.noDefaultsLookups, { key: m[1] }),
    },
    {
      re: /^Call AI: (\d+) applied · (\d+) errors(.*)$/,
      render: (m) => formatMessage(t.callAiResult, { applied: m[1], errors: m[2], extra: m[3] }),
    },
  ];

  for (const rule of rules) {
    const match = message.match(rule.re);
    if (match) return rule.render(match);
  }
  return message;
}

export function localizeSaveLabel(locale: string, label: string): string {
  return localizeStatus(locale, label);
}

export function localizeTaskProgress(locale: string, progress: TaskProgress): TaskProgress {
  return {
    title: localizeStatus(locale, progress.title),
    steps: progress.steps.map((step) => ({
      ...step,
      label: localizeStatus(locale, step.label),
      detail: step.detail ? localizeStatus(locale, step.detail) : undefined,
    })),
  };
}

const I18N_SELECTOR = [
  "[data-i18n]",
  "[data-i18n-html]",
  "[data-i18n-title]",
  "[data-i18n-aria]",
  "[data-i18n-placeholder]",
].join(",");

function messageFor(table: ChromeMessages, key: string | null): string | null {
  if (!key || !(key in table)) return null;
  return table[key as keyof ChromeMessages];
}

/** Apply catalog strings to elements marked with data-i18n* attributes. */
export function applyChrome(root: ParentNode, locale: string): void {
  const table = chrome(locale);
  if (root instanceof Document) {
    root.documentElement.lang = chromeLocale(locale);
    root.title = table.appTitle;
    const description = root.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", table.appDescription);
  }
  const nodes = root.querySelectorAll(I18N_SELECTOR);
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    const text = messageFor(table, node.getAttribute("data-i18n"));
    if (text !== null && !node.hasAttribute("data-i18n-html")) node.textContent = text;
    const html = messageFor(table, node.getAttribute("data-i18n-html"));
    if (html !== null) node.innerHTML = html;
    const title = messageFor(table, node.getAttribute("data-i18n-title"));
    if (title !== null) node.setAttribute("title", title);
    const aria = messageFor(table, node.getAttribute("data-i18n-aria"));
    if (aria !== null) node.setAttribute("aria-label", aria);
    const placeholder = messageFor(table, node.getAttribute("data-i18n-placeholder"));
    if (placeholder !== null && "placeholder" in node) {
      (node as HTMLInputElement).placeholder = placeholder;
    }
  }
}
