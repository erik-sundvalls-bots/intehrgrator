/**
 * #279 / #277 §4 in the controller: target labels follow `target.lang.1`,
 * the AI context does not depend on the language the panes show, and the
 * source pane can show its descriptions in another language.
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";

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
    loadStoredProjectRecord: () => Promise.resolve(null as StoredProjectRecord | null),
    listLoadableProjects: () => Promise.resolve([] as LoadableProjectEntry[]),
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
  };
}

const WT = join(
  import.meta.dirname!,
  "../vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates/Accident report including vital signs.wt.json",
);
const REFERRAL = join(import.meta.dirname!, "fixtures", "multilingual-referral");
const SV_SOURCE = `<?xml version="1.0"?>\n<olycka xml:lang="sv"><skada>Fraktur</skada></olycka>`;

function injurySlot(controller: WorkbenchController) {
  const slot = collectValueSlots(controller.getState().skeleton).find((s) =>
    s.slotId.includes("problem_diagnosis") && s.slotId.includes("items/at0002/")
  );
  assert(slot);
  return slot;
}

Deno.test("target labels follow target.lang.1: a Swedish source switches the target to sv", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("accident.wt.json", await Deno.readTextFile(WT));
  assertEquals(controller.getState().modelLanguage, "en");
  assertEquals(injurySlot(controller).label, "Injury");

  controller.loadSchemaContent("olycka.xml", SV_SOURCE);
  const s = controller.getState();
  assertEquals(controller.getSourceLanguages(), ["sv"]);
  assertEquals(s.targetLanguages[0], "sv");
  assertEquals(s.modelLanguage, "sv");
  assertEquals(injurySlot(controller).label, "Skada");
});

Deno.test("AI prompt is byte-identical when the shown target language changes", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("accident.wt.json", await Deno.readTextFile(WT));
  controller.loadSchemaContent("olycka.xml", SV_SOURCE);
  const before = controller.buildAiPromptText("inline");
  assertStringIncludes(before, "Skada");
  assertStringIncludes(before, "- source languages: sv");

  controller.setModelLanguage("de");
  assertEquals(controller.getState().modelLanguage, "de");
  assertNotEquals(injurySlot(controller).label, "Skada");
  assertEquals(controller.buildAiPromptText("inline"), before);
});

Deno.test("AI context languages: matched / lang1 / all add `labels` per extra language", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("accident.wt.json", await Deno.readTextFile(WT));
  controller.loadSchemaContent("olycka.xml", SV_SOURCE);
  const service = new WorkbenchService({ controller });
  const injuryRow = () => {
    const id = injurySlot(controller).slotId;
    for (const g of service.listSlotTree()) {
      for (const row of g.slots) if (service.resolveSlotRef(g.group + row.id) === id) return row;
    }
    return undefined;
  };
  assert(injuryRow());
  assertEquals(injuryRow()?.labels, undefined);

  controller.setLanguageSettings({ sourceLanguages: ["sv", "en"] });
  assertEquals(controller.getAiLanguages(), ["sv", "en"]);
  assertEquals(injuryRow()?.labels, { en: "Injury" });

  controller.setLanguageSettings({ aiContextLanguages: "all" });
  assertEquals(controller.getAiLanguages().length, 3);
  assert(injuryRow()?.labels?.de);

  controller.setLanguageSettings({ aiContextLanguages: "lang1" });
  assertEquals(injuryRow()?.labels, undefined);
  assertEquals(injuryRow()?.label, "Skada");
});

Deno.test("an explicit target display choice sticks; clearing it follows lang.1 again", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("accident.wt.json", await Deno.readTextFile(WT));
  controller.setModelLanguage("de");
  controller.loadSchemaContent("olycka.xml", SV_SOURCE);
  assertEquals(controller.getState().modelLanguage, "de");
  assert(controller.getState().targetDisplayChosen);
  controller.clearTargetDisplayLanguage();
  assertEquals(controller.getState().modelLanguage, "sv");
});

Deno.test("source 💬: XSD and JSON Schema descriptions switch language", async () => {
  for (const file of ["referral.xsd", "referral.schema.json"]) {
    const controller = new WorkbenchController(stubHost());
    controller.loadSchemaContent(file, await Deno.readTextFile(join(REFERRAL, file)));
    const s = controller.getState();
    assertEquals([...s.sourceSchemaLanguages].sort(), ["en", "sv"], file);
    const text = () => JSON.stringify(controller.getState().schemaTree);
    controller.setSourceDisplayLanguage("sv");
    assertEquals(controller.getState().sourceDisplayLanguage, "sv");
    const sv = text();
    controller.setSourceDisplayLanguage("en");
    const en = text();
    assertNotEquals(sv, en, file);
    assertStringIncludes(en, "Referral");
  }
});

Deno.test("older bundles: modelLanguage becomes the target display choice", async () => {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("accident.wt.json", await Deno.readTextFile(WT));
  controller.setModelLanguage("de");
  const bundle = controller.exportDocumentSnapshot();
  delete bundle.settings.display;
  const next = new WorkbenchController(stubHost());
  next.restoreDocumentSnapshot(bundle);
  assertEquals(next.getState().modelLanguage, "de");
  assertEquals(next.getState().settings.display?.targetLabelLang, "de");
});
