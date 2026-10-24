/**
 * #277 §5: source tree enrichment. Source nodes carry their description and,
 * when it is not in the tree's description language, that language; the
 * AI chat outline and `get_source_tree` say which language the descriptions
 * are in, and `get_source_tree {language}` gives them in another one.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { loadXsdSchemaTree, localizeSourceTree } from "@intehrgrator/core/source/schema_loader.ts";
import { sourceTreeOutline } from "@intehrgrator/agent/inspect.ts";
import type { SchemaTreeNode } from "@intehrgrator/types/mod.ts";

const DIR = join(import.meta.dirname!, "fixtures", "multilingual-referral");
const XSD = join(DIR, "referral.xsd");
const JSON_SCHEMA = join(DIR, "referral.schema.json");
const SDV = join(import.meta.dirname!, "fixtures", "simple-diagnose-and-vitals.opt");

// en + sv on the root; one element documented in English only.
const PARTLY_SV_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Visit">
    <xs:annotation>
      <xs:documentation xml:lang="en">An outpatient visit.</xs:documentation>
      <xs:documentation xml:lang="sv">Ett öppenvårdsbesök.</xs:documentation>
    </xs:annotation>
    <xs:complexType><xs:sequence>
      <xs:element name="Pulse" type="xs:integer">
        <xs:annotation><xs:documentation xml:lang="sv">Puls i slag per minut.</xs:documentation><xs:documentation xml:lang="en">Pulse in beats per minute.</xs:documentation></xs:annotation>
      </xs:element>
      <xs:element name="Weight" type="xs:decimal">
        <xs:annotation><xs:documentation xml:lang="en">Body weight in kg.</xs:documentation></xs:annotation>
      </xs:element>
      <xs:element name="Note" type="xs:string"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

function setup(): { controller: WorkbenchController; service: WorkbenchService } {
  const host = { resolveAppUrl: (path: string) => path } as unknown as HostAdapter;
  const controller = new WorkbenchController(host);
  return { controller, service: new WorkbenchService({ controller }) };
}

function find(node: SchemaTreeNode | undefined | null, path: string): SchemaTreeNode | undefined {
  if (!node) return undefined;
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, path);
    if (hit) return hit;
  }
  return undefined;
}

Deno.test("XSD source nodes carry the language of their description", () => {
  const tree = loadXsdSchemaTree(PARTLY_SV_XSD, "sv");
  assertEquals(find(tree, "/Visit")?.descriptionLang, "sv");
  assertEquals(find(tree, "/Visit/Pulse")?.description, "Puls i slag per minut.");
  assertEquals(find(tree, "/Visit/Pulse")?.descriptionLang, "sv");
  // No Swedish text: the English one, marked as English.
  assertEquals(find(tree, "/Visit/Weight")?.description, "Body weight in kg.");
  assertEquals(find(tree, "/Visit/Weight")?.descriptionLang, "en");
  assertEquals(find(tree, "/Visit/Note")?.descriptionLang, undefined);
});

Deno.test("JSON Schema source: x-i18n descriptions are marked with their language, defaults with x-lang", async () => {
  const content = await Deno.readTextFile(JSON_SCHEMA);
  const { controller } = setup();
  controller.loadSchemaContent("referral.schema.json", content);
  const tree = controller.getState().schemaTree!;
  const sv = localizeSourceTree(tree, content, "json", "sv");
  const priority = sv.children.find((c) => c.name === "priority");
  assertEquals(priority?.description, "Hur brådskande remissen är.");
  assertEquals(priority?.descriptionLang, "sv");
  const date = sv.children.find((c) => c.name === "referralDate");
  assertEquals(date?.description, "Date the referral was written.");
  assertEquals(date?.descriptionLang, "en", "plain description is in the schema's x-lang");
});

Deno.test("get_source_tree: description language once, per node only where it differs; {language} switches", async () => {
  const { controller, service } = setup();
  controller.loadSchemaContent("visit.xsd", PARTLY_SV_XSD);
  controller.setLanguageSettings({ sourceLanguages: ["sv", "en"] });
  const result = await callAgentTool(service, "get_source_tree", {}) as {
    schema: SchemaTreeNode & { lang?: string };
    descriptionLanguage?: string;
    sourceLanguages?: string[];
    schemaLanguages?: string[];
  };
  assertEquals(result.descriptionLanguage, "sv");
  assertEquals(result.sourceLanguages, ["sv", "en"]);
  assertEquals(result.schemaLanguages, ["sv", "en"]);
  const pulse = find(result.schema, "/Visit/Pulse") as SchemaTreeNode & { lang?: string };
  assertEquals(pulse.description, "Puls i slag per minut.");
  assertEquals(pulse.lang, undefined);
  const weight = find(result.schema, "/Visit/Weight") as SchemaTreeNode & { lang?: string };
  assertEquals(weight.lang, "en");
  assertEquals((weight as { descriptionLang?: string }).descriptionLang, undefined, "compact form uses `lang`");

  const en = await callAgentTool(service, "get_source_tree", { language: "en" }) as {
    schema: SchemaTreeNode;
    descriptionLanguage?: string;
  };
  assertEquals(en.descriptionLanguage, "en");
  assertEquals(find(en.schema, "/Visit/Pulse")?.description, "Pulse in beats per minute.");
  // The pane's own language is untouched by the tool.
  assertEquals(controller.getSourceDisplayLanguage(), "sv");
});

Deno.test("AI chat source outline: descriptions in source.lang.1, other languages marked", () => {
  const { controller } = setup();
  controller.loadTemplateContent("simple-diagnose-and-vitals.opt", Deno.readTextFileSync(SDV));
  controller.loadSchemaContent("visit.xsd", PARTLY_SV_XSD);
  controller.setLanguageSettings({ sourceLanguages: ["sv"] });
  const prompt = controller.buildAiPromptText("api");
  assertStringIncludes(prompt, "/Visit/Pulse integer [1] — Puls i slag per minut.");
  assertStringIncludes(prompt, "/Visit/Weight decimal [1] — (en) Body weight in kg.");
  assertStringIncludes(prompt, "Descriptions in `sv`");
  const outline = sourceTreeOutline(loadXsdSchemaTree(PARTLY_SV_XSD, "sv"), 1500, "sv");
  assert(!outline.includes("(sv)"), outline);
});

Deno.test("XSD fixture: get_source_tree on a fully bilingual source has no per-node lang", async () => {
  const { controller, service } = setup();
  controller.loadSchemaContent("referral.xsd", await Deno.readTextFile(XSD));
  const result = await callAgentTool(service, "get_source_tree", {}) as { schema: SchemaTreeNode; descriptionLanguage?: string };
  assertEquals(result.descriptionLanguage, "en");
  assert(!JSON.stringify(result.schema).includes('"lang"'));
});
