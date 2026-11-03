import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { inferSchemaFromInstance, loadJsonSchema, pathToFontoxpath, canonicalSyncPath } from "@intehrgrator/core/source/schema_loader.ts";
import { evaluate, createSourceContext, collectJsonNodes } from "@intehrgrator/core/source/query_runtime.ts";

Deno.test("loadJsonSchema from json document", () => {
  const tree = loadJsonSchema(JSON.stringify({ patient: { id: "x" } }), "patient");
  assertEquals(tree.name, "patient");
  assertEquals(tree.children[0].name, "patient");
  assertEquals(tree.children[0].children[0].type, "string");
  assertEquals(tree.children[0].children[0].multiplicity, "1");
  assertEquals(tree.children[0].children[0].value, undefined);
});

Deno.test("loadJsonSchema from json schema document", () => {
  const tree = loadJsonSchema(JSON.stringify({
    type: "object",
    properties: {
      id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
  }), "root");
  assertEquals(tree.type, "object");
  const idNode = tree.children.find((c) => c.name === "id");
  const tagsNode = tree.children.find((c) => c.name === "tags");
  assertEquals(idNode?.multiplicity, "1");
  assertEquals(tagsNode?.type, "array");
  assertEquals(tagsNode?.multiplicity, "0..*");
});

Deno.test("canonicalSyncPath aligns schema and instance paths", () => {
  assertEquals(canonicalSyncPath("$.patient.id"), "$.patient.id");
  assertEquals(canonicalSyncPath("$/patient/id"), "$.patient.id");
  assertEquals(canonicalSyncPath("$.vitals[1].systolic"), "$.vitals[*].systolic");
});

Deno.test("schema inference from json instance", () => {
  const tree = inferSchemaFromInstance(JSON.stringify({ patient: { id: "x" } }));
  assertEquals(tree.children[0].name, "patient");
  assertEquals(tree.children[0].children[0].path, "$.patient.id");
  assertEquals(tree.children[0].children[0].value, "x");
});

Deno.test("fontoxpath json number evaluation", () => {
  const ctx = createSourceContext(JSON.stringify({ vitals: [{ systolic: 130 }] }), "json");
  const value = evaluate('xpathNumber("$.vitals[1].systolic")', ctx, "number");
  assertEquals(value, 130);
});

Deno.test("legacy-simulated BP series supports indexed iteration paths", async () => {
  const instanceText = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "instances-series", "bp-series-inst.json"),
  );
  const schemaText = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "legacy-simulated-json", "bp-series-schema.json"),
  );
  const tree = loadJsonSchema(schemaText, "BloodPressureSeries");
  const measurements = tree.children.find((c) => c.name === "measurements");
  const diagnosis = tree.children.find((c) => c.name === "diagnosis");
  assertEquals(diagnosis?.type, "object");
  assertEquals(diagnosis?.multiplicity, "1");
  assertEquals(measurements?.type, "array");
  assertEquals(measurements?.multiplicity, "1..*");
  assertEquals(
    measurements?.children[0]?.children.some((c) => c.name === "diagnosis"),
    false,
  );

  const ctx = createSourceContext(instanceText, "json");
  assertEquals(evaluate('xpathString("$.diagnosis.code")', ctx, "string"), "S06.0");
  assertEquals(evaluate('xpathString("$.diagnosis.display")', ctx, "string"), "Concussion");
  assertEquals(evaluate('xpathNumber("$.measurements[1].systolic")', ctx, "number"), 120);
  assertEquals(evaluate('xpathNumber("$.measurements[2].systolic")', ctx, "number"), 128);
  assertEquals(evaluate('xpathNumber("$.measurements[3].diastolic")', ctx, "number"), 78);
  assertEquals(evaluate('xpathString("$.measurements[3].timestamp")', ctx, "string"), "2026-07-03T07:45:00Z");
  assertEquals(evaluate('xpathNumber("$.measurements[*].systolic")', ctx, "number"), [120, 128, 118]);
  assertEquals(evaluate('xpathNumber("$.measurements[*].pulse")', ctx, "number"), [72, 76, undefined]);
  const first = collectJsonNodes("$.measurements", ctx.json)[0];
  assertEquals(
    evaluate('xpathNumber("pulse")', { ...ctx, json: first, data: first }, "number"),
    72,
  );
  assertEquals(evaluate('xpathString("$.measurements[*].timestamp")', ctx, "string"), [
    "2026-07-02T08:30:00Z",
    "2026-07-02T14:15:00Z",
    "2026-07-03T07:45:00Z",
  ]);
});

Deno.test("quoted JSON keys resolve and a missing index stays empty", () => {
  const ctx = createSourceContext(JSON.stringify({
    övergripande_status: [{ "|value": "Har aldrig rökt" }],
    per_typ: [],
  }), "json");
  assertEquals(
    evaluate(`xpathString("$.övergripande_status[1]['|value']")`, ctx, "string"),
    "Har aldrig rökt",
  );
  assertEquals(
    evaluate(`xpathString("$.per_typ[1].typ[1]['|value']")`, ctx, "string"),
    undefined,
  );
});

Deno.test("a boolean source path is false when missing and true when filled", () => {
  const ctx = createSourceContext(JSON.stringify({
    övergripande_status: [{ "|value": "Har aldrig rökt" }],
    per_typ: [],
  }), "json");
  assertEquals(
    evaluate(`xpathBoolean("$.övergripande_status[1]['|value']")`, ctx, "boolean"),
    true,
  );
  assertEquals(
    evaluate(`xpathBoolean("$.per_typ[1].typ[1]['|value']")`, ctx, "boolean"),
    false,
  );
  assertEquals(evaluate('xpathBoolean("$.missing")', ctx, "boolean"), false);
  // The word "false" is a filled string, the same as Handlebars {{#if}}.
  const word = createSourceContext(JSON.stringify({ flag: "false" }), "json");
  assertEquals(evaluate('xpathBoolean("$.flag")', word, "boolean"), true);
});

Deno.test("pathToFontoxpath json", () => {
  assertEquals(pathToFontoxpath("$.patient.id", "json"), "$.patient.id");
});

Deno.test("openEHR locator predicates evaluate against JSON RM maps", () => {
  const ctx = createSourceContext(JSON.stringify({
    content: [
      {
        archetype_node_id: "openEHR-EHR-OBSERVATION.pulse.v2",
        data: {
          events: [{
            archetype_node_id: "at0003",
            data: {
              items: [{ archetype_node_id: "at0004", value: { magnitude: 72 } }],
            },
          }],
        },
      },
      {
        archetype_node_id: "openEHR-EHR-OBSERVATION.body_temperature.v2",
        data: {
          events: [{
            archetype_node_id: "at0003",
            data: {
              items: [{ archetype_node_id: "at0004", value: { magnitude: 37.2 } }],
            },
          }],
        },
      },
    ],
  }), "json");
  assertEquals(
    evaluate(
      'xpathNumber("/content[openEHR-EHR-OBSERVATION.pulse.v2]/data/events[at0003]/data/items[at0004]/value/magnitude")',
      ctx,
      "number",
    ),
    72,
  );
  assertEquals(
    evaluate(
      'xpathNumber("/content[openEHR-EHR-OBSERVATION.body_temperature.v2]/data/events[at0003]/data/items[at0004]/value/magnitude")',
      ctx,
      "number",
    ),
    37.2,
  );
});
