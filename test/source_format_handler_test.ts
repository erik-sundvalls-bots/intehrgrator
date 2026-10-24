import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  detectSourceFormat,
  getSourceFormatHandler,
  isSourceFormatId,
  listSourceFormatIds,
  registerSourceFormatHandler,
  type SourceFormatHandler,
} from "@intehrgrator/core/source/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { createEmptyModel, applyExpressionEdit } from "@intehrgrator/core/mapping_model/mod.ts";

Deno.test("built-in format handlers are registered", () => {
  const ids = listSourceFormatIds();
  assertEquals(ids.includes("json"), true);
  assertEquals(ids.includes("xml"), true);
  assertEquals(ids.includes("openehr-flat-json"), true);
  assertEquals(ids.includes("openehr-composition"), true);
  assertEquals(isSourceFormatId("json"), true);
  assertEquals(isSourceFormatId("openehr-canonical-json"), true);
});

Deno.test("detectSourceFormat from filename", () => {
  assertEquals(detectSourceFormat("vitals.json"), "json");
  assertEquals(detectSourceFormat("vitals.XML"), "xml");
  assertEquals(detectSourceFormat("schema.xsd"), "xml");
  assertEquals(
    detectSourceFormat("composition.json", '{"_type":"COMPOSITION"}'),
    "openehr-composition",
  );
  assertEquals(
    detectSourceFormat("flat.json", '{"ctx/language":"en","vitals/value|magnitude":120}'),
    "openehr-flat-json",
  );
  assertEquals(detectSourceFormat("unknown.bin"), "json");
});

Deno.test("Avro .avsc record schema loads as field tree, not Avro meta document", async () => {
  const avsc = await Deno.readTextFile(
    join(
      import.meta.dirname!,
      "fixtures",
      "administrerad-medicinsk-onkologisk-behandling",
      "source-schema",
      "AdministrationRCCV1_source_schema.avsc",
    ),
  );
  const handler = getSourceFormatHandler("json");
  const tree = handler.loadSchema(avsc, "AdministrationRCCV1");
  const names = tree.children.map((c) => c.name);
  assertEquals(names.includes("CytodosAdministrationKey"), true, names.join(","));
  assertEquals(names.includes("Substanser"), true, names.join(","));
  assertEquals(names.includes("fields"), false, names.join(","));
  const substanser = tree.children.find((c) => c.name === "Substanser")!;
  assertEquals(substanser.type, "array");
  const itemNames = (substanser.children[0]?.children ?? []).map((c) => c.name);
  assertEquals(itemNames.includes("Innholdstoff_ATC"), true, itemNames.join(","));
  assertEquals(itemNames.includes("Dose"), true, itemNames.join(","));
  assertEquals(names.includes("PDL_vardgivare_Namn"), true, names.join(","));
  assertEquals(names.includes("PDL_vardgivare_HSAID"), true, names.join(","));
});

Deno.test("json handler loadSchema / pathToExpression / evaluate", () => {
  const handler = getSourceFormatHandler("json");
  const tree = handler.loadSchema(JSON.stringify({ vitals: { systolic: 120 } }), "root");
  assertEquals(tree.children[0].name, "vitals");

  const exprPath = handler.pathToExpression("$.vitals.systolic");
  assertEquals(exprPath, "$.vitals.systolic");

  const ctx = handler.createContext(JSON.stringify({ vitals: { systolic: 120 } }));
  const value = handler.evaluate('xpathNumber("$.vitals.systolic")', ctx, "number");
  assertEquals(value, 120);
});

Deno.test("openEHR FLAT source keys evaluate through the format handler", () => {
  const handler = getSourceFormatHandler("openehr-flat-json");
  const content = JSON.stringify({
    "ctx/language": "en",
    "vitals/systolic|magnitude": 118,
  });
  const tree = handler.loadInstance(content, "flat");
  const systolic = tree.children.find((node) => node.name.includes("systolic"))!;
  assertEquals(systolic.path, '$["vitals/systolic|magnitude"]');
  const value = handler.evaluate(
    `xpathNumber(${JSON.stringify(handler.pathToExpression(systolic.path))})`,
    handler.createContext(content),
    "number",
  );
  assertEquals(value, 118);
});

Deno.test("xml handler pathToExpression", () => {
  const handler = getSourceFormatHandler("xml");
  assertEquals(handler.pathToExpression("/patient/id"), "/patient/id");
  assertEquals(handler.pathToExpression("patient/id"), "/patient/id");
});

Deno.test({
  // Headless Deno has no DOMParser; the slimdom fallback covers it (#278).
  name: "xml handler loadInstance / evaluate",
  fn() {
    const handler = getSourceFormatHandler("xml");
    const xml = "<patient><id>abc</id></patient>";
    const tree = handler.loadInstance(xml, "patient");
    assertEquals(tree.children[0].name, "id");

    const ctx = handler.createContext(xml);
    const value = handler.evaluate('xpathString("/patient/id")', ctx, "string");
    assertEquals(value, "abc");
  },
});

Deno.test("unknown format throws at the handler seam", () => {
  assertThrows(
    () => getSourceFormatHandler("not-a-real-format"),
    Error,
    "Unsupported source format",
  );
});

Deno.test("openehr-composition alias evaluates canonical Composition JSON", () => {
  const handler = getSourceFormatHandler("openehr-composition");
  const content = JSON.stringify({
    _type: "COMPOSITION",
    content: [{ _type: "OBSERVATION", data: { value: 42 } }],
  });
  const value = handler.evaluate(
    'xpathNumber("$.content[1].data.value")',
    handler.createContext(content),
    "number",
  );
  assertEquals(value, 42);
});

Deno.test("registerSourceFormatHandler plugs a new adapter", () => {
  const extId = "test-custom-format";
  const custom: SourceFormatHandler = {
    id: extId,
    loadSchema: () => ({ path: "$", name: "stub", type: "object", children: [] }),
    loadInstance: () => ({ path: "$", name: "stub", type: "object", children: [] }),
    pathToExpression: (p) => `STUB:${p}`,
    createContext: (content) => {
      const json = JSON.parse(content);
      return { format: extId, kind: "json", data: json, json };
    },
    evaluate: () => "stubbed",
  };
  registerSourceFormatHandler(custom);
  assertEquals(isSourceFormatId(extId), true);
  assertEquals(getSourceFormatHandler(extId).pathToExpression("a.b"), "STUB:a.b");
  assertEquals(getSourceFormatHandler(extId).evaluate("x", custom.createContext("{}"), "string"), "stubbed");
});

Deno.test("Test Run goes through Source Format Handler", () => {
  let model = createEmptyModel("tmpl");
  model = applyExpressionEdit(model, "slot/systolic", 'xpathNumber("$.systolic")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
  });
  const result = runTest(model, JSON.stringify({ systolic: 118 }), "json");
  assertEquals(result.ok, true);
  const output = result.output as { slots: Record<string, unknown> };
  assertEquals(output.slots["slot/systolic"], 118);
});

Deno.test("prose-prefixed FLAT execute envelope unwraps Data keys", () => {
  const content = Deno.readTextFileSync(
    new URL("./fixtures/patient-reported-chemotherapy-symptoms/source-instance/1-ex-composition.txt", import.meta.url),
  );
  assertEquals(detectSourceFormat("1-ex-composition.txt", content), "openehr-flat-json");
  const handler = getSourceFormatHandler("openehr-flat-json");
  const ctx = handler.createContext(content);
  const data = ctx.data as Record<string, unknown>;
  assertEquals(
    typeof data[
      "patientrapporterade_symptom_inför_medicinsk_onkologisk_behandling/_uid"
    ],
    "string",
  );
  assertEquals(ctx.namedMaps?.defaults?.PatientId, "194002287086");
});
