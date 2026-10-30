/**
 * #289: per-target-file id language (Web Template ids / Simplified FLAT paths),
 * chosen on the COMPOSITION root block, and per-file language settings that
 * survive save → load.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/format_handler.ts";
import {
  ID_LANGUAGE_FIELD,
  idLanguageChoices,
  idLanguageFromBlocklyState,
  PRIMARY_ID_LANGUAGE,
  webTemplateWithIdLanguage,
} from "@intehrgrator/core/target/id_language.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type {
  LoadableProjectEntry,
  StoredProjectRecord,
} from "@intehrgrator/core/persistence/mod.ts";
import type { ProjectBundle } from "@intehrgrator/types/mod.ts";

const FIXTURES = join(import.meta.dirname!, "fixtures");
const VITALS = join(FIXTURES, "simple-diagnose-and-vitals.opt"); // en primary, + sv, de
const KARDA = join(
  FIXTURES,
  "ordinerad-medicinsk-onkologisk-behandling/target-schema/OrdineradMedicinskOnkologiskBehandling_MedKurdag.1.0.0-alpha.27.sv.en.opt",
); // sv primary (top-level <language>), English archetype originals
const REFERRAL_XSD = join(FIXTURES, "multilingual-referral", "referral.xsd"); // en + sv

function stubHost(): HostAdapter {
  return {
    pickTextFile: () => Promise.resolve(null),
    pickTextFilesFromDirectory: () => Promise.resolve(null),
    pickBinaryFile: () => Promise.resolve(null),
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: () => Promise.resolve({}),
    readClipboard: () => Promise.resolve(""),
    saveAutosave: () => Promise.resolve({}),
    saveManualSave: () => Promise.resolve({}),
    loadStoredProjectRecord: () =>
      Promise.resolve(null as StoredProjectRecord | null),
    listLoadableProjects: () => Promise.resolve([] as LoadableProjectEntry[]),
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
  };
}

function ids(webTemplateJson: string | undefined): string[] {
  assert(webTemplateJson);
  const out: string[] = [];
  // deno-lint-ignore no-explicit-any
  const walk = (n: any, path: string) => {
    out.push(`${path}/${n.id}`);
    for (const c of n.children ?? []) walk(c, `${path}/${n.id}`);
  };
  walk(JSON.parse(webTemplateJson).tree, "");
  return out;
}

function canvasWithIdLanguage(value: string) {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: "composition", fields: { [ID_LANGUAGE_FIELD]: value } }],
    },
  };
}

Deno.test("id language choices: lang.1 (primary) first; OPT 1.4 primary is the top-level <language>", async () => {
  const handler = getTargetFormatHandler("openehr-template");
  const vitals = handler.load("v.opt", await Deno.readTextFile(VITALS));
  assertEquals(idLanguageChoices(vitals), ["en", "sv", "de"]);
  const karda = handler.load("k.opt", await Deno.readTextFile(KARDA));
  assertEquals(idLanguageChoices(karda)[0], "sv");
});

Deno.test("ids follow the chosen language; primary gives the first load's ids back", async () => {
  const target = getTargetFormatHandler("openehr-template").load(
    "v.opt",
    await Deno.readTextFile(VITALS),
  );
  const primary = ids(target.webTemplateJson);
  assert(primary.some((p) => p.endsWith("/problem_diagnosis")));
  const sv = ids(webTemplateWithIdLanguage(target, "sv"));
  assertEquals(sv.length, primary.length);
  assert(sv.some((p) => p.endsWith("/problem_diagnos")));
  assertEquals(
    ids(webTemplateWithIdLanguage(target, PRIMARY_ID_LANGUAGE)),
    primary,
  );
  // Labels are untouched: only ids change.
  const label = (wt?: string) => JSON.parse(wt!).tree.children[0].name;
  assertEquals(
    label(webTemplateWithIdLanguage(target, "sv")),
    label(target.webTemplateJson),
  );
});

Deno.test("primary ≠ archetype original: a sv.en OPT has Swedish ids by default, English on request", async () => {
  const target = getTargetFormatHandler("openehr-template").load(
    "k.opt",
    await Deno.readTextFile(KARDA),
  );
  const primary = ids(target.webTemplateJson);
  const en = ids(webTemplateWithIdLanguage(target, "en"));
  assertNotEquals(primary, en);
  assert(
    primary.some((p) => /ordination|lakemedel|läkemedel/.test(p)),
    primary.slice(0, 5).join("\n"),
  );
});

Deno.test("idLanguageFromBlocklyState reads the first COMPOSITION root", () => {
  assertEquals(idLanguageFromBlocklyState(canvasWithIdLanguage("sv")), "sv");
  assertEquals(
    idLanguageFromBlocklyState({
      blocks: { blocks: [{ type: "composition" }] },
    }),
    undefined,
  );
  assertEquals(idLanguageFromBlocklyState(null), undefined);
});

Deno.test("controller: the canvas choice sets the target's ids; undoing it restores primary ids", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("v.opt", await Deno.readTextFile(VITALS));
  const primary = ids(
    controller.exportDocumentSnapshot().target?.webTemplateJson,
  );
  assertEquals(controller.getState().targetIdLanguages, ["en", "sv", "de"]);

  controller.syncFromBlockly(canvasWithIdLanguage("sv"), []);
  const snap = controller.exportDocumentSnapshot();
  assertEquals(controller.getState().targetIdLanguage, "sv");
  assertEquals(snap.target?.languageSettings?.idLanguage, "sv");
  assert(
    ids(snap.target?.webTemplateJson).some((p) =>
      p.endsWith("/problem_diagnos")
    ),
  );

  // Blockly undo hands the earlier canvas back.
  controller.syncFromBlockly(canvasWithIdLanguage(PRIMARY_ID_LANGUAGE), []);
  assertEquals(
    ids(controller.exportDocumentSnapshot().target?.webTemplateJson),
    primary,
  );
  assertEquals(controller.getState().targetIdLanguage, PRIMARY_ID_LANGUAGE);
});

Deno.test("save → load round-trips per-file language settings of two files with different languages", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("k.opt", await Deno.readTextFile(KARDA)); // target: sv primary
  controller.loadSchemaContent(
    "referral.xsd",
    await Deno.readTextFile(REFERRAL_XSD),
  ); // source: en, sv
  controller.setModelLanguage("en");
  controller.setSourceDisplayLanguage("sv");
  controller.syncFromBlockly(canvasWithIdLanguage("en"), []);

  const saved: ProjectBundle = JSON.parse(
    JSON.stringify(controller.exportDocumentSnapshot()),
  );
  assertEquals(saved.target?.languageSettings?.languages[0], "sv");
  assertEquals(saved.target?.languageSettings?.idLanguage, "en");
  assertEquals(saved.target?.languageSettings?.labelLanguage, "en");
  assertEquals(saved.sourceSchema?.languageSettings?.labelLanguage, "sv");
  assertEquals(
    [...(saved.sourceSchema?.languageSettings?.languages ?? [])].sort(),
    ["en", "sv"],
  );

  // Per-file settings are what restores them, not the project-wide copy.
  delete saved.settings.display;
  const next = new WorkbenchController(stubHost());
  next.restoreDocumentSnapshot(saved);
  const s = next.getState();
  assertEquals(s.modelLanguage, "en");
  assertEquals(s.sourceDisplayLanguage, "sv");
  assertEquals(s.targetIdLanguage, "en");
  assertEquals(s.targetIdLanguages[0], "sv");
  assertEquals(
    ids(next.exportDocumentSnapshot().target?.webTemplateJson),
    ids(controller.exportDocumentSnapshot().target?.webTemplateJson),
  );
  assertEquals(
    next.exportDocumentSnapshot().target?.languageSettings,
    saved.target?.languageSettings,
  );
  assertEquals(
    next.exportDocumentSnapshot().sourceSchema?.languageSettings,
    saved.sourceSchema?.languageSettings,
  );
});
