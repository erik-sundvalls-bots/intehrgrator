/**
 * #279 / #277 §4 on an OPT XML target: `simple-diagnose-and-vitals.opt` (SDV)
 * carries Swedish and German term definitions per archetype next to its
 * English original. They are target languages too, so the 💬 widget, the
 * `target.lang.N` order and the AI `labels` work for OPT XML files.
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { collectValueSlots, generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
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

const SDV = join(import.meta.dirname!, "fixtures", "simple-diagnose-and-vitals.opt");
const sourceIn = (langs: string[]) =>
  `<?xml version="1.0"?>\n<vitals xml:lang="${langs[0]}">${
    langs.slice(1).map((l) => `<note xml:lang="${l}">x</note>`).join("")
  }<systolic>120</systolic></vitals>`;

function systolic(skeleton: ReturnType<typeof generateSkeleton>["skeleton"]) {
  const slot = collectValueSlots(skeleton).find((s) => s.slotId.includes("blood_pressure") && s.slotId.includes("at0004/value/value/value"));
  assert(slot, "SDV systolic slot");
  return slot;
}

async function sdvController(): Promise<WorkbenchController> {
  const controller = new WorkbenchController(stubHost());
  controller.loadTemplateContent("simple-diagnose-and-vitals.opt", await Deno.readTextFile(SDV));
  return controller;
}

Deno.test("OPT XML lists the languages of its per-archetype term definitions (SDV: en, sv, de)", async () => {
  const opt = await Deno.readTextFile(SDV);
  const en = generateSkeleton(opt);
  assertEquals(en.language, "en");
  assertEquals([...en.languages].sort(), ["de", "en", "sv"]);
  assertEquals(en.languages[0], "en");
  const sv = generateSkeleton(opt, { language: "sv" });
  assertEquals(sv.language, "sv");
  assertEquals(systolic(en.skeleton).label, "Systolic");
  assertEquals(systolic(sv.skeleton).label, "Systoliskt");
  // Same slot ids in every language.
  assertEquals(collectValueSlots(sv.skeleton).map((s) => s.slotId), collectValueSlots(en.skeleton).map((s) => s.slotId));
});

Deno.test("SDV: 💬 to sv changes target and Blockly labels, not target.lang.N, the prompt or the UI language", async () => {
  const controller = await sdvController();
  controller.loadSchemaContent("vitals.xml", sourceIn(["en"]));
  assertEquals(controller.getTargetLanguages(), ["en", "sv", "de"]);
  const before = controller.buildAiPromptText("inline");
  const beforeApi = controller.buildAiPromptText("api");
  assertEquals(systolic(controller.getState().skeleton).label, "Systolic");

  controller.setModelLanguage("sv");
  assertEquals(controller.getState().modelLanguage, "sv");
  assertEquals(systolic(controller.getState().skeleton).label, "Systoliskt");
  assertEquals(controller.getTargetLanguages(), ["en", "sv", "de"]);
  assertEquals(controller.buildAiPromptText("inline"), before);
  assertEquals(controller.buildAiPromptText("api"), beforeApi);
});

/** The examples table in #277 §4, on SDV. */
Deno.test("SDV: #277 §4 language examples (source languages × UI language → target.lang.N and slot tree labels)", async () => {
  const cases: Array<{ source: string[] | null; ui: string; target: string[]; label: string; labels?: Record<string, string> }> = [
    { source: ["sv", "en"], ui: "en", target: ["sv", "en", "de"], label: "Systoliskt", labels: { en: "Systolic" } },
    { source: ["en"], ui: "sv", target: ["en", "sv", "de"], label: "Systolic" },
    { source: null, ui: "sv", target: ["sv", "en", "de"], label: "Systoliskt" },
    { source: ["fr"], ui: "en", target: ["en", "sv", "de"], label: "Systolic" },
  ];
  for (const c of cases) {
    const controller = await sdvController();
    controller.setUiLanguage(c.ui);
    if (c.source) controller.setLanguageSettings({ sourceLanguages: c.source });
    const name = `source ${c.source?.join(",") ?? "unknown"} / UI ${c.ui}`;
    assertEquals(controller.getTargetLanguages(), c.target, name);
    const service = new WorkbenchService({ controller });
    const row = service.listSlotTree().flatMap((g) => g.slots.map((r) => ({ g, r })))
      .find(({ g, r }) => (g.group + r.id).includes("blood_pressure") && (g.group + r.id).includes("at0004/value/value/value"));
    assert(row, name);
    assertEquals(row.r.label, c.label, name);
    assertEquals(row.r.labels, c.labels, name);
    const description = (row.r as { description?: string }).description ?? "";
    if (c.label === "Systoliskt") assertStringIncludes(description, "Det högsta systemiskt arteriella blodtrycket", name);
    else assertStringIncludes(description, "Peak systemic arterial blood pressure", name);
  }
});

Deno.test("SDV: the UI language alone does not change the prompt when a source language matches", async () => {
  const controller = await sdvController();
  controller.loadSchemaContent("vitals.xml", sourceIn(["sv"]));
  controller.setUiLanguage("en");
  const en = controller.buildAiPromptText("api");
  const enCopy = controller.buildAiPromptText("uri");
  assertStringIncludes(en, "Systoliskt");
  controller.setUiLanguage("sv");
  assertEquals(controller.buildAiPromptText("api"), en);
  assertEquals(controller.buildAiPromptText("uri"), enCopy);
  controller.setUiLanguage("de");
  assertEquals(controller.buildAiPromptText("api"), en);
});

Deno.test("SDV: the stable prefix is the same whatever the target and source languages", async () => {
  const a = await sdvController();
  a.loadSchemaContent("vitals.xml", sourceIn(["sv"]));
  const b = await sdvController();
  b.loadSchemaContent("vitals.xml", sourceIn(["de"]));
  const pa = a.buildAiPromptText("uri");
  const pb = b.buildAiPromptText("uri");
  assertNotEquals(pa, pb);
  const cut = (p: string) => p.slice(0, p.indexOf("# Project"));
  assertEquals(cut(pa), cut(pb));
  assert(cut(pa).length > 1000);
  assertEquals(a.buildAiSystemPrefix("api"), b.buildAiSystemPrefix("api"));
  assert(pa.startsWith(a.buildAiSystemPrefix("copy")));
});

Deno.test("SDV: get_slot gives every language's label", async () => {
  const controller = await sdvController();
  const service = new WorkbenchService({ controller });
  const id = systolic(controller.getState().skeleton).slotId;
  const slot = service.getSlot(id) as { info?: { labels?: Record<string, string> } };
  assertEquals(slot.info?.labels?.sv, "Systoliskt");
  assert(slot.info?.labels?.de, "German label");
  assertEquals(slot.info?.labels?.en, "Systolic");
});

Deno.test("SDV: the Web Template for Simplified FLAT ids stays the original language's when the shown language changes", async () => {
  const controller = await sdvController();
  const before = (controller as unknown as { target: { webTemplateJson?: string } }).target.webTemplateJson;
  assert(before);
  controller.setModelLanguage("sv");
  const after = (controller as unknown as { target: { webTemplateJson?: string } }).target;
  assertEquals(after.webTemplateJson, before);
  // One Web Template carries every language (ehrtslib #160).
  assertStringIncludes(before, "Systoliskt");
});

Deno.test("SDV: an OPT XML loaded after picking sv in 💬 keeps original-language Web Template ids", async () => {
  const controller = await sdvController();
  controller.setModelLanguage("sv");
  controller.loadTemplateContent("simple-diagnose-and-vitals.opt", await Deno.readTextFile(SDV));
  const target = (controller as unknown as { target: { language?: string; webTemplateJson?: string } }).target;
  assertEquals(target.language, "sv");
  assertEquals(systolic(controller.getState().skeleton).label, "Systoliskt");
  type Node = { id: string; name?: string; children?: Node[] };
  const find = (n: Node): Node | undefined => n.id === "systolic" ? n : n.children?.map(find).find(Boolean);
  const node = find((JSON.parse(target.webTemplateJson!) as { tree: Node }).tree);
  assert(node, "Web Template id from the English original");
  assertEquals(node.name, "Systoliskt");
});
