import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  detectTargetFormat,
  getTargetFormatHandler,
  listTargetFormatIds,
} from "@intehrgrator/core/target/mod.ts";
import {
  buildHandlebarsPath,
  buildHandlebarsTree,
  renderHandlebars,
} from "@intehrgrator/core/output/handlebars_dialect.ts";
import {
  applyExpressionEdit,
  createEmptyModel,
} from "@intehrgrator/core/mapping_model/mod.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import { applyOptionalRmToSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";

Deno.test("target format handlers cover structured and free-form outputs", () => {
  assertEquals(listTargetFormatIds(), [
    "openehr-template",
    "json-schema",
    "xml-schema",
    "free-form",
  ]);
  assertEquals(detectTargetFormat("target.schema.json", '{"type":"object"}'), "json-schema");
  assertEquals(detectTargetFormat("target.xsd", ""), "xml-schema");
  assertEquals(detectTargetFormat("summary.hbs", ""), "free-form");
});

Deno.test("JSON Schema target skeleton inlines $defs $ref children", () => {
  const schema = JSON.stringify({
    $id: "bundle",
    title: "Bundle",
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { $ref: "#/$defs/Item" },
      },
    },
    $defs: {
      Item: {
        type: "object",
        properties: { sku: { type: "string" } },
      },
    },
  });
  const target = getTargetFormatHandler("json-schema").load("bundle.json", schema);
  const sku = target.skeleton[0]?.children
    .find((node) => node.label === "items")
    ?.children[0]
    ?.children.find((node) => node.label === "sku");
  assert(sku, "expected sku target slot from $defs Item");
  assertEquals(sku.targetPath, "$.items[*].sku");
});

Deno.test("JSON Schema target produces mappable tree and object output", () => {
  const schema = JSON.stringify({
    $id: "patient-summary",
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
    },
  });
  const target = getTargetFormatHandler("json-schema").load("summary.json", schema);
  const nameSlot = target.skeleton[0].children.find((node) => node.label === "name")!;
  let model = createEmptyModel(target.targetId);
  model.targetFormat = target.format;
  model = applyExpressionEdit(model, nameSlot.slotId, 'xpathString("$.patient.name")', {
    rmType: "string",
    returnType: "string",
  });
  const result = runTest(
    model,
    JSON.stringify({ patient: { name: "Ada" } }),
    "json",
    { target },
  );
  assertEquals(result.ok, true);
  assertEquals(result.output, { name: "Ada" });
});

Deno.test("XML Schema target renders XML", () => {
  const xsd = `<?xml version="1.0"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="message">
        <xs:complexType><xs:sequence>
          <xs:element name="text" type="xs:string"/>
        </xs:sequence></xs:complexType>
      </xs:element>
    </xs:schema>`;
  const target = getTargetFormatHandler("xml-schema").load("message.xsd", xsd);
  const textSlot = target.skeleton[0].children[0]!;
  let model = createEmptyModel(target.targetId);
  model.targetFormat = target.format;
  model = applyExpressionEdit(model, textSlot.slotId, 'xpathString("$.text")', {
    rmType: "string",
    returnType: "string",
  });
  const result = runTest(model, '{"text":"A & B"}', "json", { target });
  assertEquals(result.output, "<message><text>A &amp; B</text></message>");
});

Deno.test("XML Schema target uses xml:lang documentation as labels", () => {
  const xsd = `<?xml version="1.0"?>
    <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xs:element name="report">
        <xs:annotation>
          <xs:documentation xml:lang="en">Accident report</xs:documentation>
          <xs:documentation xml:lang="sv">Olycksrapport</xs:documentation>
        </xs:annotation>
        <xs:complexType><xs:sequence>
          <xs:element name="injury" type="xs:string">
            <xs:annotation>
              <xs:documentation xml:lang="en">Injury</xs:documentation>
              <xs:documentation xml:lang="sv">Skada</xs:documentation>
            </xs:annotation>
          </xs:element>
        </xs:sequence></xs:complexType>
      </xs:element>
    </xs:schema>`;
  const en = getTargetFormatHandler("xml-schema").load("report.xsd", xsd, { language: "en" });
  const sv = getTargetFormatHandler("xml-schema").load("report.xsd", xsd, { language: "sv" });
  assertEquals(en.languages?.sort(), ["en", "sv"]);
  assertEquals(en.skeleton[0].label, "Accident report");
  assertEquals(en.skeleton[0].children[0]?.label, "Injury");
  assertEquals(sv.skeleton[0].label, "Olycksrapport");
  assertEquals(sv.skeleton[0].children[0]?.label, "Skada");
});

Deno.test("Kintegrate Handlebars helpers and openEHR keys remain compatible", () => {
  const output = renderHandlebars(
    "{{toUpperCase patient.name}}: {{#if (gte patient.score 5)}}ok{{/if}}",
    { patient: { name: "Ada", score: 7 } },
  );
  assertEquals(output, "ADA: ok");
  assertEquals(
    buildHandlebarsPath('$["ctx/language"]'),
    "[ctx/language]",
  );
  assertEquals(
    buildHandlebarsTree("$.patient.name"),
    "{{#with patient}}\n  {{name}}\n{{/with}}",
  );
  assertEquals(
    buildHandlebarsTree("$.items[1].label"),
    "{{#each items}}\n  {{label}}\n{{/each}}",
  );
  assertEquals(
    buildHandlebarsTree('$.akutmall.abcde[1].spo[1]["|numerator"]'),
    "{{#with akutmall}}\n  {{#each abcde}}\n    {{#each spo}}\n      {{[|numerator]}}\n    {{/each}}\n  {{/each}}\n{{/with}}",
  );
  assertEquals(
    renderHandlebars("{{slot \"target:name\"}}", {}, {
      slots: { "target:name": "Ada" },
    }),
    "Ada",
  );
  // ADR 0009: json / {{{…}}} are outside VMS-Hbs — convert hard-gates via knownHelpersOnly.
  let threw = false;
  try {
    renderHandlebars("{{{json (slot \"target:name\")}}}", {}, {
      slots: { "target:name": "Ada" },
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("openEHR Test Run emits string locatable identity, not silent-mandatory DV_TEXT", async () => {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const target = getTargetFormatHandler("openehr-template").load("blood_pressure.opt", opt);
  const model = createEmptyModel(target.targetId);
  model.targetFormat = "openehr-template";
  const result = runTest(model, "{}", "json", { target });
  assertEquals(result.ok, true, (result.warnings ?? []).join("; "));
  const ids: unknown[] = [];
  walkRecords(result.output, (rec) => {
    if ("archetype_node_id" in rec) ids.push(rec.archetype_node_id);
  });
  assert(ids.length > 0, "expected locatable nodes in Test Run output");
  for (const id of ids) {
    assertEquals(
      typeof id,
      "string",
      `archetype_node_id must stay a string, got ${JSON.stringify(id)}`,
    );
  }
});

function walkRecords(node: unknown, visit: (rec: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkRecords(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  visit(rec);
  for (const value of Object.values(rec)) walkRecords(value, visit);
}

Deno.test("Handlebars Test Run can walk source without a structured target", () => {
  const model = createEmptyModel("narrative");
  model.targetFormat = "free-form";
  const result = runTest(
    model,
    JSON.stringify({ patient: { name: "Ada", score: 7 } }),
    "json",
    {
      outputMode: "handlebars",
      handlebarsTemplate:
        "{{toUpperCase patient.name}} score={{patient.score}}{{#if (gte patient.score 5)}} ok{{/if}}",
    },
  );
  assertEquals(result.ok, true);
  assertEquals(result.output, "ADA score=7 ok");
});

Deno.test("openEHR preview omits scaffold nodes that have no mapped value", () => {
  const textValue = (slotId: string): SkeletonNode => ({
    slotId,
    blockType: "dv_text",
    rmType: "DV_TEXT",
    label: "value",
    kind: "value",
    mandatory: true,
    rmAttribute: "value",
    children: [],
  });
  const element = (slotId: string, label: string): SkeletonNode => ({
    slotId,
    blockType: "element",
    rmType: "ELEMENT",
    label,
    archetypeNodeId: "at0001",
    kind: "container",
    mandatory: false,
    rmAttribute: "items",
    children: [textValue(`${slotId}/value`)],
  });
  const composition: SkeletonNode = {
    slotId: "composition",
    blockType: "composition",
    rmType: "COMPOSITION",
    label: "Encounter",
    kind: "container",
    mandatory: true,
    children: [element("empty", "Unmapped optional"), element("filled", "Systolic")],
  };
  const output = getTargetFormatHandler("openehr-template").render({
    definition: {
      format: "openehr-template",
      filename: "t.opt",
      targetId: "t",
      content: "<opt/>",
      skeleton: [composition],
    },
    slotValues: { "filled/value": "120" },
  }) as {
    items?: Array<{ name?: { value?: string }; value?: { value?: string } }>;
  };
  assertEquals(output.items?.map((item) => item.name?.value), ["Systolic"]);
  assertEquals(output.items?.[0]?.value?.value, "120");
});

Deno.test("repeating EVENT keeps a copy that has a per-item time and no magnitude", () => {
  const time = (slotId: string): SkeletonNode => ({
    slotId,
    blockType: "dv_date_time",
    rmType: "DV_DATE_TIME",
    label: "time",
    kind: "value",
    mandatory: true,
    rmAttribute: "time",
    children: [],
  });
  const magnitude = (slotId: string): SkeletonNode => ({
    slotId,
    blockType: "dv_quantity",
    rmType: "DV_QUANTITY",
    label: "magnitude",
    kind: "value",
    mandatory: false,
    rmAttribute: "value",
    children: [],
  });
  const event: SkeletonNode = {
    slotId: "event",
    blockType: "point_event",
    rmType: "POINT_EVENT",
    label: "Any event",
    kind: "container",
    mandatory: false,
    multiplicity: "0..*",
    rmAttribute: "events",
    children: [time("event/time"), magnitude("event/magnitude")],
  };
  const output = getTargetFormatHandler("openehr-template").render({
    definition: {
      format: "openehr-template",
      filename: "t.opt",
      targetId: "t",
      content: "<opt/>",
      skeleton: [event],
    },
    slotValues: {
      "event/time": ["2026-07-02T08:30:00Z", "2026-07-03T07:45:00Z"],
      "event/magnitude": [72, undefined],
    },
  }) as Array<{ time?: { value?: string }; value?: { magnitude?: number } }>;
  assertEquals(output.map((item) => item.time?.value), [
    "2026-07-02T08:30:00Z",
    "2026-07-03T07:45:00Z",
  ]);
  assertEquals(output.map((item) => item.value?.magnitude), [72, undefined]);
});

Deno.test("openEHR preview keeps language only beside a clinical value", () => {
  const language = (slotId: string): SkeletonNode => ({
    slotId,
    blockType: "code_phrase",
    rmType: "CODE_PHRASE",
    label: "language",
    kind: "value",
    mandatory: true,
    rmAttribute: "language",
    children: [],
  });
  const magnitude = (slotId: string): SkeletonNode => ({
    slotId,
    blockType: "dv_quantity",
    rmType: "DV_QUANTITY",
    label: "magnitude",
    kind: "value",
    mandatory: false,
    rmAttribute: "value",
    children: [],
  });
  const observation = (slotId: string, label: string, valueSlot: string): SkeletonNode => ({
    slotId,
    blockType: "observation",
    rmType: "OBSERVATION",
    label,
    kind: "container",
    mandatory: false,
    rmAttribute: "items",
    children: [language(`${slotId}/language`), magnitude(valueSlot)],
  });
  const output = getTargetFormatHandler("openehr-template").render({
    definition: {
      format: "openehr-template",
      filename: "t.opt",
      targetId: "t",
      content: "<opt/>",
      skeleton: [{
        slotId: "composition",
        blockType: "composition",
        rmType: "COMPOSITION",
        label: "Encounter",
        kind: "container",
        mandatory: true,
        children: [
          observation("empty", "Respiration", "empty/value"),
          observation("pulse", "Pulse", "pulse/value"),
        ],
      }],
    },
    slotValues: {
      "empty/language": "en",
      "pulse/language": "en",
      "pulse/value": 72,
    },
  }) as {
    items?: Array<{
      name?: { value?: string };
      language?: { code_string?: string; terminology_id?: { value?: string } };
      value?: { magnitude?: number };
    }>;
  };
  assertEquals(output.items?.map((item) => item.name?.value), ["Pulse"]);
  // Canonical CODE_PHRASE, not a stray `value` (#310).
  assertEquals(output.items?.[0]?.language?.code_string, "en");
  assertEquals(output.items?.[0]?.language?.terminology_id?.value, "ISO_639-1");
  assertEquals(output.items?.[0]?.value?.magnitude, 72);
});

Deno.test("optional null_flavour on an element value slot attaches to the ELEMENT", () => {
  const element: SkeletonNode = {
    slotId: "tpl//items/at0002",
    blockType: "element",
    rmType: "ELEMENT",
    label: "Problem/Diagnosis name",
    kind: "container",
    mandatory: true,
    archetypeId: "tpl",
    attachmentPoint: "//items/at0002",
    children: [{
      slotId: "tpl//items/at0002/value/DV_TEXT/value",
      blockType: "dv_text",
      rmType: "DV_TEXT",
      label: "value",
      kind: "value",
      mandatory: false,
      rmAttribute: "value",
      children: [],
    }],
  };
  const next = applyOptionalRmToSkeleton([element], [{
    attachmentSlotId: "tpl//items/at0002/value/DV_TEXT/value",
    attributeName: "null_flavour",
    rmType: "DV_CODED_TEXT",
  }]);
  const flavour = next[0]?.children.find((child) => child.rmAttribute === "null_flavour");
  assertEquals(flavour?.rmType, "DV_CODED_TEXT");
  assertEquals(flavour?.slotId, "tpl//items/at0002/null_flavour/value");
});

Deno.test("ELEMENT null_flavour renders without a value", () => {
  const output = getTargetFormatHandler("openehr-template").render({
    definition: {
      format: "openehr-template",
      filename: "t.opt",
      targetId: "t",
      content: "<opt/>",
      skeleton: [{
        slotId: "name",
        blockType: "element",
        rmType: "ELEMENT",
        label: "Problem/Diagnosis name",
        archetypeNodeId: "at0002",
        kind: "container",
        mandatory: true,
        children: [{
          slotId: "name/null_flavour/value",
          blockType: "dv_coded_text",
          rmType: "DV_CODED_TEXT",
          label: "null_flavour",
          kind: "value",
          mandatory: false,
          rmAttribute: "null_flavour",
          children: [],
        }, {
          slotId: "name/value",
          blockType: "dv_text",
          rmType: "DV_TEXT",
          label: "value",
          kind: "value",
          mandatory: false,
          rmAttribute: "value",
          children: [],
        }],
      }],
    },
    slotValues: {
      "name/null_flavour/value": {
        value: "no information",
        defining_code: { terminology_id: "openehr", code_string: "271" },
      },
    },
  }) as {
    value?: unknown;
    null_flavour?: {
      value?: string;
      defining_code?: { code_string?: string; terminology_id?: { value?: string } };
    };
  };
  assertEquals(output.value, undefined);
  assertEquals(output.null_flavour?.value, "no information");
  assertEquals(output.null_flavour?.defining_code?.code_string, "271");
  assertEquals(output.null_flavour?.defining_code?.terminology_id?.value, "openehr");
});

Deno.test("openEHR preview uses the template name constraint and coded-text choice", () => {
  const output = getTargetFormatHandler("openehr-template").render({
    definition: {
      format: "openehr-template",
      filename: "t.opt",
      targetId: "t",
      content: "<opt/>",
      skeleton: [{
        slotId: "cluster",
        blockType: "cluster",
        rmType: "CLUSTER",
        label: "Vårdgivare",
        nameConstraint: "Vårdenhet",
        kind: "container",
        mandatory: false,
        children: [{
          slotId: "position",
          blockType: "dv_coded_text",
          rmType: "DV_CODED_TEXT",
          label: "Position",
          kind: "value",
          mandatory: false,
          rmAttribute: "value",
          allowedValues: [
            { code: "at1001", label: "Sitting", terminologyId: "local" },
            { code: "at1000", label: "Lying", terminologyId: "local" },
          ],
          children: [],
        }],
      }],
    },
    slotValues: { position: "Sitting" },
  }) as {
    name?: { value?: string };
    value?: { value?: string; defining_code?: { code_string?: string } };
  };
  assertEquals(output.name?.value, "Vårdenhet");
  assertEquals(output.value?.value, "Sitting");
  assertEquals(output.value?.defining_code?.code_string, "at1001");
});
