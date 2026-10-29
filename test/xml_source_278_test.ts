/**
 * #278: XML / XSD Source Schemas in the headless WorkbenchService (no
 * `DOMParser` in Deno) and XSD read as a schema rather than an instance.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchService } from "../src/workbench/service.ts";
import { callAgentTool } from "../src/agent/tools.ts";
import { loadXmlSourceSchema, loadXsdSchemaTree } from "../src/core/source/schema_loader.ts";
import { createSourceContext, evaluate } from "../src/core/source/query_runtime.ts";
import { parseXsd } from "../src/core/xsd/xsd_model.ts";
import { sourceTreeOutline } from "../src/agent/inspect.ts";
import type { SchemaTreeNode } from "../src/types/mod.ts";

// URL.pathname is `/C:/...` on Windows, which Deno.readTextFile rejects (os error 123).
const dir = join(import.meta.dirname!, "fixtures", "multilingual-referral");
const xsdPath = join(dir, "referral.xsd");
const examplePath = join(dir, "referral-example.xml");

function find(node: SchemaTreeNode, path: string): SchemaTreeNode | undefined {
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, path);
    if (hit) return hit;
  }
  return undefined;
}

Deno.test("headless load_source_schema reads an XML instance (no DOMParser in Deno)", async () => {
  assertEquals(typeof (globalThis as { DOMParser?: unknown }).DOMParser, "undefined");
  const service = new WorkbenchService();
  await callAgentTool(service, "load_source_schema", { path: examplePath });
  const tree = (await callAgentTool(service, "get_source_tree", {}) as { schema: SchemaTreeNode }).schema;
  assertEquals(tree.path, "/Referral");
  assertEquals(find(tree, "/Referral/PatientId")?.type, "string");
  assert(find(tree, "/Referral/Diagnosis/Code"));
});

Deno.test("headless load_source_schema reads an XSD as a schema, with docs and attributes", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_source_schema", { path: xsdPath });
  const tree = (await callAgentTool(service, "get_source_tree", {}) as { schema: SchemaTreeNode }).schema;
  assertEquals(tree.path, "/Referral");
  const outline = sourceTreeOutline(loadXsdSchemaTree(Deno.readTextFileSync(xsdPath)));
  assert(!outline.includes("xs:"), outline);
  assertEquals(find(tree, "/Referral/PatientId")?.multiplicity, "1");
  assertEquals(find(tree, "/Referral/Systolic")?.type, "integer");
  assertEquals(find(tree, "/Referral/Systolic")?.multiplicity, "0..1");
  assertEquals(find(tree, "/Referral/Priority")?.type, "string");
  assertEquals(find(tree, "/Referral/Diagnosis")?.multiplicity, "0..*");
  assertEquals(find(tree, "/Referral/Diagnosis/@primary")?.type, "boolean");
  assertEquals(find(tree, "/Referral/Diagnosis/Code")?.description, "ICD-10-SE code.");
});

Deno.test("XSD source descriptions follow the requested language", () => {
  const xsd = Deno.readTextFileSync(xsdPath);
  assertEquals(find(loadXsdSchemaTree(xsd, "sv"), "/Referral/Diagnosis/Code")?.description, "ICD-10-SE-kod.");
  assertEquals(find(loadXsdSchemaTree(xsd, "en"), "/Referral/Diagnosis/Code")?.description, "ICD-10-SE code.");
});

Deno.test("unreadable XML source is a tool error", async () => {
  const service = new WorkbenchService();
  await assertRejects(
    () => callAgentTool(service, "load_source_schema", { filename: "broken.xml", content: "<a><b></a>" }),
    Error,
    "Invalid XML",
  );
});

Deno.test("XML source query evaluates in the headless runtime", () => {
  const xml = Deno.readTextFileSync(examplePath);
  const ctx = createSourceContext(xml, "xml");
  assertEquals(evaluate('xpathString("/Referral/Systolic")', ctx, "string"), "142");
  assertEquals(evaluate('xpathString("/Referral/Diagnosis[1]/@primary")', ctx, "string"), "true");
});

Deno.test("an XML instance and its XSD give the same element paths", () => {
  const fromXsd = loadXmlSourceSchema(Deno.readTextFileSync(xsdPath));
  const fromInstance = loadXmlSourceSchema(Deno.readTextFileSync(examplePath), "referral");
  for (const path of ["/Referral/PatientId", "/Referral/Priority", "/Referral/Systolic", "/Referral/Diagnosis/Code"]) {
    assert(find(fromXsd, path), `xsd ${path}`);
    assert(find(fromInstance, path), `instance ${path}`);
  }
});

Deno.test("parseXsd resolves named types, enumerations with docs, facets and languages", () => {
  const model = parseXsd(Deno.readTextFileSync(xsdPath));
  assertEquals(model.targetNamespace, "urn:example:referral:1");
  assertEquals(model.version, "1.2");
  assertEquals(model.languages, ["en", "sv"]);
  const byPath = new Map<string, ReturnType<typeof parseXsd>["root"]>();
  const walk = (n: typeof model.root) => {
    byPath.set(n.path, n);
    n.children.forEach(walk);
  };
  walk(model.root);
  const priority = byPath.get("/Referral/Priority")!;
  assertEquals(priority.facets?.enumeration?.map((e) => e.value), ["ROUTINE", "URGENT"]);
  assertEquals(priority.facets?.enumeration?.[1].docs, [
    { lang: "en", text: "Within 7 days" },
    { lang: "sv", text: "Inom 7 dagar" },
  ]);
  assertEquals(byPath.get("/Referral/PatientId")!.facets?.pattern, ["[0-9]{12}"]);
  assertEquals(byPath.get("/Referral/Systolic")!.facets?.minInclusive, "0");
  assertEquals(byPath.get("/Referral/Systolic")!.facets?.maxInclusive, "400");
});

Deno.test("parseXsd: ref, group, attributeGroup, extension, simpleContent, recursion", () => {
  const xsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="Doc">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="Note" maxOccurs="unbounded"/>
        <xs:group ref="Meta"/>
        <xs:element name="Child" type="Extended" minOccurs="0"/>
        <xs:element name="Amount" type="Money"/>
        <xs:element name="Tree" type="Node"/>
        <xs:choice><xs:element name="A" type="xs:string"/><xs:element name="B" type="xs:string"/></xs:choice>
      </xs:sequence>
      <xs:attributeGroup ref="Common"/>
    </xs:complexType>
  </xs:element>
  <xs:element name="Note" type="xs:string"/>
  <xs:group name="Meta"><xs:sequence><xs:element name="Author" type="xs:string"/></xs:sequence></xs:group>
  <xs:attributeGroup name="Common"><xs:attribute name="id" type="xs:ID" use="required"/></xs:attributeGroup>
  <xs:complexType name="Base"><xs:sequence><xs:element name="X" type="xs:int"/></xs:sequence></xs:complexType>
  <xs:complexType name="Extended"><xs:complexContent><xs:extension base="Base"><xs:sequence><xs:element name="Y" type="xs:date"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType>
  <xs:complexType name="Money"><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>
  <xs:complexType name="Node"><xs:sequence><xs:element name="Node" type="Node" minOccurs="0"/></xs:sequence></xs:complexType>
</xs:schema>`;
  const tree = loadXsdSchemaTree(xsd);
  assertEquals(find(tree, "/Doc/Note")?.multiplicity, "1..*");
  assertEquals(find(tree, "/Doc/Author")?.type, "string");
  assertEquals(find(tree, "/Doc/@id")?.multiplicity, "1");
  assertEquals(find(tree, "/Doc/Child/X")?.type, "int");
  assertEquals(find(tree, "/Doc/Child/Y")?.type, "date");
  assertEquals(find(tree, "/Doc/Amount")?.type, "decimal");
  assertEquals(find(tree, "/Doc/Amount/@currency")?.type, "string");
  assertEquals(find(tree, "/Doc/A")?.multiplicity, "0..1");
  assert(find(tree, "/Doc/Tree/Node"));
  assertEquals(find(tree, "/Doc/Tree/Node")?.children.length, 0);
});
