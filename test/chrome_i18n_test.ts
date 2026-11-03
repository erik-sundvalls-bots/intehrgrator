import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { en, type ChromeMessages } from "@intehrgrator/ui/chrome_en.ts";
import { ca } from "@intehrgrator/ui/chrome_ca.ts";
import { de } from "@intehrgrator/ui/chrome_de.ts";
import { es } from "@intehrgrator/ui/chrome_es.ts";
import { fr } from "@intehrgrator/ui/chrome_fr.ts";
import { sv } from "@intehrgrator/ui/chrome_sv.ts";
import {
  applyChrome,
  chrome,
  localizeStatus,
  localizeTaskProgress,
} from "@intehrgrator/ui/chrome_i18n.ts";

const LOCALES = { sv, de, es, ca, fr } as const;

Deno.test("Attach original target format too is translated in every UI language", () => {
  assertEquals(en.menuAttachOriginalTarget, "Attach original target format too");
  assertEquals(sv.menuAttachOriginalTarget, "Bifoga ursprungligt målformat också");
  assertEquals(de.menuAttachOriginalTarget, "Ursprüngliches Zielformat auch anhängen");
  assertEquals(es.menuAttachOriginalTarget, "Adjuntar también el formato de destino original");
  assertEquals(ca.menuAttachOriginalTarget, "Adjunta també el format de destinació original");
  assertEquals(fr.menuAttachOriginalTarget, "Joindre aussi le format cible d'origine");
  for (const table of [sv, de, es, ca, fr]) {
    assert(table.menuAttachOriginalTarget !== en.menuAttachOriginalTarget);
  }
});

Deno.test("chrome catalogs translate the shell and keep English as the fallback", () => {
  assertEquals(chrome("sv").source, "Källa");
  assertEquals(chrome("en").source, "Source");
  assertEquals(chrome("fr").source, "Source");
  assertEquals(chrome("fr").saveAs, "Enregistrer sous");
  assertEquals(chrome("fr").undo, "Annuler");
  assertEquals(chrome("fr").redo, "Rétablir");
  assertEquals(chrome("fr").cancel, "Annuler");
  assertEquals(chrome("fr").close, "Fermer");
  assertEquals(chrome("fr").tabTargetSchema, "Schéma cible");
  assertEquals(chrome("de").newProject === en.newProject, false);
  assertEquals(chrome("es").newProject === en.newProject, false);
  assertEquals(chrome("ca").newProject === en.newProject, false);
  assertEquals(chrome("fr").newProject === en.newProject, false);
  assertEquals(chrome("sv").projectLoaded, "Projekt laddat");

  const keys = Object.keys(en) as Array<keyof ChromeMessages>;
  for (const [code, table] of Object.entries(LOCALES)) {
    const same = keys.filter((key) => table[key] === en[key]);
    assert(
      same.length / keys.length < 0.4,
      `${code} leaves ${same.length}/${keys.length} strings identical to English`,
    );
    for (const key of keys) {
      assert(table[key].length > 0, `${code}.${key} is empty`);
    }
  }
});

Deno.test("index.html chrome keys exist in the English catalog", async () => {
  const html = await Deno.readTextFile(new URL("../web/index.html", import.meta.url));
  const keys = new Set<string>();
  for (const match of html.matchAll(/data-i18n(?:-html|-title|-aria|-placeholder)="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  assert(keys.size > 40, `expected annotated chrome, found ${keys.size} keys`);
  const missing = [...keys].filter((key) => !(key in en));
  assertEquals(missing, []);
  assert(html.includes('data-i18n="source"'));
  assert(!html.includes('id="ui-language-label" data-i18n'));
  assert(html.includes(">Tables & Sheets</button>"));
});

Deno.test("HTML chrome keeps anchor ids in every locale", () => {
  const htmlKeys = [
    "needGithubHtml",
    "aiCredentialsIntroHtml",
    "bleedingEdgeHtml",
    "newHereHtml",
  ] as const;
  for (const key of htmlKeys) {
    const ids = [...en[key].matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    assert(ids.length > 0, key);
    for (const code of ["sv", "de", "es", "ca", "fr"] as const) {
      for (const id of ids) {
        assertStringIncludes(chrome(code)[key], `id="${id}"`);
      }
    }
  }
});

Deno.test("status and task labels translate at paint time", () => {
  assertEquals(localizeStatus("en", "Loaded schema bp.json"), "Loaded schema bp.json");
  assertEquals(localizeStatus("sv", "Project loaded"), chrome("sv").projectLoaded);
  assertStringIncludes(localizeStatus("sv", "Loaded schema bp.json"), "bp.json");
  const painted = localizeTaskProgress("sv", {
    title: "Load target",
    steps: [{ id: "example-2", label: "Load example 3", state: "waiting" }],
  });
  assertEquals(painted.title, chrome("sv").taskLoadTarget);
  assertEquals(painted.steps[0].label, "Ladda exempel 3");
});

Deno.test("applyChrome replaces marked text when a DOM is available", () => {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.innerHTML = `<h2 data-i18n="source">Source</h2>`;
  applyChrome(host, "sv");
  assertEquals(host.querySelector("h2")?.textContent, "Källa");
  applyChrome(host, "en");
  assertEquals(host.querySelector("h2")?.textContent, "Source");
});
