import { assertEquals, assert } from "@std/assert";
import { join } from "@std/path";
import { parseTemplateInput } from "ehrtslib/parser/mod.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import {
  generateSkeleton,
  generateSkeletonFromOperational,
  generateSkeletonFromWebTemplate,
  collectValueSlots,
} from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { isAutoFixedValueSlot, mandatoryAttributesFor } from "@intehrgrator/core/rm_mandatory.ts";
import { rmConstrainedTerminologyId } from "@intehrgrator/core/rm_terminology.ts";
import { countUnmappedMandatory, createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";

const fixture = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);

Deno.test("OPT skeleton includes template value slots", () => {
  const { templateId, skeleton } = generateSkeleton(fixture);
  assert(templateId.includes("blood_pressure"));
  const slots = collectValueSlots(skeleton);
  assert(slots.length > 0);
});

Deno.test("collectValueSlots excludes auto-fixed LOCATABLE attrs", () => {
  const { skeleton } = generateSkeleton(fixture);
  const slots = collectValueSlots(skeleton);
  assertEquals(
    slots.some((s) => s.label === "archetype_node_id" || s.label === "name"),
    false,
  );
  const autoFixed = skeleton.flatMap(function walk(n): typeof skeleton {
    const kids = n.children.flatMap((c) => walk(c));
    return n.kind === "value" && isAutoFixedValueSlot(n) ? [n] : kids;
  });
  assert(autoFixed.length > 0, "fixture should still generate silent-mandatory nodes in tree");
});

Deno.test("unmapped mandatory count ignores auto-fixed LOCATABLE attrs", () => {
  const { skeleton } = generateSkeleton(fixture);
  const model = createEmptyModel("t");
  const count = countUnmappedMandatory(model, skeleton);
  const mappableMandatory = collectValueSlots(skeleton).filter((s) => s.mandatory).length;
  assertEquals(count, mappableMandatory);
});

Deno.test("silent-mandatory RM attributes for COMPOSITION", () => {
  const attrs = mandatoryAttributesFor("COMPOSITION");
  assertEquals(attrs.includes("language"), true);
  assertEquals(attrs.includes("composer"), true);
});

Deno.test("skeleton resolves at0004 labels per archetype", () => {
  const { skeleton } = generateSkeleton(fixture);
  const at0004 = skeleton.flatMap(function walk(n): SkeletonNode[] {
    const self = n.archetypeNodeId === "at0004" && n.kind === "container" ? [n] : [];
    return [...self, ...n.children.flatMap((c) => walk(c))];
  });
  assertEquals(at0004.length, 2);
  const labels = at0004.map((n) => n.label).sort();
  assertEquals(labels, ["Manufacturer details", "Systolic"]);
  const archetypes = at0004.map((n) => n.archetypeShortName).sort();
  assertEquals(archetypes, ["sample_blood_pressure", "sample_device"]);
});

Deno.test("ehrtslib OPT parse supplies scoped terms without XML overlay", () => {
  const parsed = parseTemplateInput(fixture);
  const { skeleton } = generateSkeletonFromOperational(parsed.operationalTemplate!);
  const at0004 = flattenSkeleton(skeleton).filter((n) =>
    n.archetypeNodeId === "at0004" && n.kind === "container"
  );
  assertEquals(at0004.map((n) => n.label).sort(), ["Manufacturer details", "Systolic"]);
});

function flattenSkeleton(nodes: SkeletonNode[]): SkeletonNode[] {
  return nodes.flatMap((n) => [n, ...flattenSkeleton(n.children)]);
}

Deno.test("flattened OPT uses per-archetype term tables, not merged at-codes", () => {
  const observation = "openEHR-EHR-OBSERVATION.blood_pressure.v2";
  const device = "openEHR-EHR-CLUSTER.device.v1";
  const opt = {
    template_id: { value: "colliding_at_codes" },
    original_language: "en",
    ontology: {
      term_definitions: {
        en: {
          at0000: { text: "MERGED-ROOT" },
          at0001: { text: "MERGED-AT0001" },
          at0002: { text: "MERGED-EVENT" },
        },
      },
    },
    archetype_term_definitions: {
      [observation]: {
        en: {
          at0000: { text: "Blood pressure" },
          at0001: { text: "History" },
        },
      },
      [device]: {
        en: {
          at0000: { text: "Device" },
          at0001: { text: "Device name" },
        },
      },
    },
    definition: {
      rm_type_name: "COMPOSITION",
      node_id: "at0000",
      archetype_ref: "openEHR-EHR-COMPOSITION.encounter.v1",
      attributes: [{
        rm_attribute_name: "content",
        children: [
          {
            rm_type_name: "OBSERVATION",
            node_id: "at0000",
            term_archetype_scope: observation,
            attributes: [{
              rm_attribute_name: "data",
              children: [{
                rm_type_name: "HISTORY",
                node_id: "at0001",
                term_archetype_scope: observation,
                attributes: [],
              }],
            }],
          },
          {
            rm_type_name: "CLUSTER",
            node_id: "at0.2",
            archetype_ref: device,
            term_archetype_scope: device,
            term_name_fallback_node_id: "at0000",
            attributes: [{
              rm_attribute_name: "items",
              children: [{
                rm_type_name: "ELEMENT",
                node_id: "at0001",
                term_archetype_scope: device,
                attributes: [],
              }],
            }],
          },
        ],
      }],
    },
  };

  const { skeleton } = generateSkeletonFromOperational(opt);
  const nodes = flattenSkeleton(skeleton);
  const history = nodes.find((n) => n.rmType === "HISTORY" && n.archetypeNodeId === "at0001");
  const deviceRoot = nodes.find((n) => n.rmType === "CLUSTER" && n.archetypeNodeId === "at0.2");
  const deviceName = nodes.find((n) => n.rmType === "ELEMENT" && n.archetypeNodeId === "at0001");
  assertEquals(history?.label, "History");
  assertEquals(deviceRoot?.label, "Device");
  assertEquals(deviceName?.label, "Device name");
  assertEquals(history?.archetypeShortName, "blood_pressure");
  assertEquals(deviceName?.archetypeShortName, "device");
});

Deno.test("web template skeleton keeps per-node names when at-codes collide", () => {
  const wt = {
    templateId: "colliding-at-codes",
    version: "2.3",
    defaultLanguage: "en",
    tree: {
      id: "encounter",
      name: "Encounter",
      rmType: "COMPOSITION",
      nodeId: "openEHR-EHR-COMPOSITION.encounter.v1",
      min: 1,
      max: 1,
      aqlPath: "/",
      children: [
        {
          id: "device",
          name: "Device",
          rmType: "CLUSTER",
          nodeId: "openEHR-EHR-CLUSTER.device.v1",
          min: 0,
          max: 1,
          aqlPath: "/context/other_context[at0001]/items[openEHR-EHR-CLUSTER.device.v1]",
          children: [{
            id: "device_name",
            name: "Device name",
            rmType: "DV_TEXT",
            nodeId: "at0001",
            min: 0,
            max: 1,
            aqlPath:
              "/context/other_context[at0001]/items[openEHR-EHR-CLUSTER.device.v1]/items[at0001]/value",
            inputs: [{ type: "TEXT" }],
          }],
        },
        {
          id: "symptom",
          name: "Symptom",
          rmType: "CLUSTER",
          nodeId: "openEHR-EHR-CLUSTER.symptom.v1",
          min: 0,
          max: 1,
          aqlPath: "/context/other_context[at0001]/items[openEHR-EHR-CLUSTER.symptom.v1]",
          children: [{
            id: "symptom_name",
            name: "Symptom name",
            rmType: "DV_TEXT",
            nodeId: "at0001",
            min: 0,
            max: 1,
            aqlPath:
              "/context/other_context[at0001]/items[openEHR-EHR-CLUSTER.symptom.v1]/items[at0001]/value",
            inputs: [{ type: "TEXT" }],
          }],
        },
      ],
    },
  };

  const { skeleton } = generateSkeletonFromWebTemplate(JSON.stringify(wt));
  const nodes = flattenSkeleton(skeleton);
  const labels = nodes
    .filter((n) => n.archetypeNodeId === "at0001" && n.rmType === "ELEMENT")
    .map((n) => n.label)
    .sort();
  assertEquals(labels, ["Device name", "Symptom name"]);
  const roots = nodes.filter((n) =>
    n.rmType === "CLUSTER" && (n.archetypeShortName === "device" || n.archetypeShortName === "symptom")
  );
  assertEquals(roots.map((n) => n.label).sort(), ["Device", "Symptom"]);
});

Deno.test("skeleton uses template term text for blood pressure nodes", () => {
  const { skeleton } = generateSkeleton(fixture);
  const systolic = skeleton.flatMap(function walk(n): SkeletonNode[] {
    const self = n.label === "Systolic" ? [n] : [];
    return [...self, ...n.children.flatMap((c) => walk(c))];
  })[0];
  assert(systolic, "expected Systolic element node");
  assertEquals(systolic.archetypeNodeId, "at0004");
  assertEquals(systolic.archetypeShortName, "sample_blood_pressure");
});

Deno.test("skeleton generator returns warnings array", () => {
  const { warnings } = generateSkeleton(fixture);
  assert(Array.isArray(warnings));
});

Deno.test("OBSERVATION descendants include rmAttribute on data path", () => {
  const { skeleton } = generateSkeleton(fixture);
  const history = skeleton.flatMap(function walk(n): SkeletonNode[] {
    const self = n.rmType === "HISTORY" ? [n] : [];
    return [...self, ...n.children.flatMap((c) => walk(c))];
  })[0];
  assert(history, "expected HISTORY under observation data");
  assertEquals(history.rmAttribute, "data");
});

function findByAttr(nodes: SkeletonNode[], rmType: string, attr: string): SkeletonNode | undefined {
  for (const node of nodes) {
    if (node.rmType === rmType) {
      const child = node.children.find((c) => c.rmAttribute === attr);
      if (child) return child;
    }
    const nested = findByAttr(node.children, rmType, attr);
    if (nested) return nested;
  }
  return undefined;
}

Deno.test("RM code-set attributes expose their constrained terminology_id", () => {
  assertEquals(rmConstrainedTerminologyId("COMPOSITION", "language"), "ISO_639-1");
  assertEquals(rmConstrainedTerminologyId("COMPOSITION", "territory"), "ISO_3166-1");
  assertEquals(rmConstrainedTerminologyId("OBSERVATION", "language"), "ISO_639-1");
  assertEquals(rmConstrainedTerminologyId("OBSERVATION", "encoding"), "IANA_character-sets");
  assertEquals(rmConstrainedTerminologyId("COMPOSITION", "category"), "openehr");
  assertEquals(rmConstrainedTerminologyId("EVENT_CONTEXT", "setting"), "openehr");
});

Deno.test("skeleton pre-fills RM terminology for language, territory, and encoding", () => {
  const { skeleton } = generateSkeleton(fixture);
  const language = findByAttr(skeleton, "COMPOSITION", "language");
  const territory = findByAttr(skeleton, "COMPOSITION", "territory");
  const encoding = findByAttr(skeleton, "OBSERVATION", "encoding");
  const category = findByAttr(skeleton, "COMPOSITION", "category");
  assertEquals(language?.fixedFields?.terminology_id, "ISO_639-1");
  assertEquals(territory?.fixedFields?.terminology_id, "ISO_3166-1");
  assertEquals(encoding?.fixedFields?.terminology_id, "IANA_character-sets");
  assertEquals(category?.fixedFields?.terminology_id, "openehr");
  assertEquals(category?.fixedFields?.defining_code, "433");
});

Deno.test("skeleton pre-fills COMPOSITION.category from the template code list", () => {
  const persistent = fixture.replace(
    "<code_list>433</code_list>",
    "<code_list>431</code_list>",
  );
  const { skeleton } = generateSkeleton(persistent);
  const category = findByAttr(skeleton, "COMPOSITION", "category");
  assertEquals(category?.fixedFields?.defining_code, "431");
  assertEquals(category?.fixedFields?.code_string, "431");
});

Deno.test("web template skeleton keeps COMPOSITION.category code from inputs.list", () => {
  const wt = {
    templateId: "category-demo",
    defaultLanguage: "en",
    tree: {
      id: "composition",
      name: "Encounter",
      rmType: "COMPOSITION",
      nodeId: "openEHR-EHR-COMPOSITION.encounter.v1",
      children: [
        {
          id: "category",
          name: "category",
          rmType: "DV_CODED_TEXT",
          aqlPath: "/category",
          min: 1,
          max: 1,
          inputs: [
            {
              suffix: "code",
              type: "CODED_TEXT",
              terminology: "openehr",
              list: [{ value: "431", label: "persistent" }],
            },
          ],
        },
      ],
    },
  };
  const { skeleton } = generateSkeletonFromWebTemplate(JSON.stringify(wt));
  const category = findByAttr(skeleton, "COMPOSITION", "category");
  assertEquals(category?.fixedFields?.defining_code, "431");
  assertEquals(category?.fixedFields?.code_string, "431");
});

Deno.test("COMPOSITION language and territory are CODE_PHRASE values, not ELEMENT", () => {
  const { skeleton } = generateSkeleton(fixture);
  const language = findByAttr(skeleton, "COMPOSITION", "language");
  const territory = findByAttr(skeleton, "COMPOSITION", "territory");
  const category = findByAttr(skeleton, "COMPOSITION", "category");
  assertEquals(language?.rmType, "CODE_PHRASE");
  assertEquals(language?.kind, "value");
  assertEquals(language?.blockType, "code_phrase");
  assertEquals(language?.children.length, 0);
  assertEquals(territory?.rmType, "CODE_PHRASE");
  assertEquals(territory?.kind, "value");
  assertEquals(territory?.children.length, 0);
  assertEquals(category?.rmType, "DV_CODED_TEXT");
  assertEquals(category?.kind, "value");
});

Deno.test("Position DV_CODED_TEXT carries the template local value set", () => {
  const { skeleton } = generateSkeleton(fixture);
  const position = flattenSkeleton(skeleton).find((n) =>
    n.rmType === "ELEMENT" && n.archetypeNodeId === "at0008" && n.label === "Position"
  );
  assert(position, "expected Position ELEMENT");
  const dv = position.children.find((c) => c.rmType === "DV_CODED_TEXT");
  assert(dv, "expected DV_CODED_TEXT under Position");
  assertEquals(dv.allowedValues?.map((v) => v.code), [
    "at1000",
    "at1001",
    "at1002",
    "at1003",
    "at1013",
    "at1014",
  ]);
  assertEquals(dv.allowedValues?.[0]?.label, "Standing");
  assertEquals(dv.allowedValues?.[1]?.label, "Sitting");
  assertEquals(dv.allowedValues?.[2]?.label, "Reclining");
  assertEquals(dv.allowedValues?.[3]?.label, "Lying");
  assertEquals(dv.allowedValues?.[0]?.terminologyId, "local");
  assertEquals(dv.fixedFields?.defining_code, undefined);
  assertEquals(dv.allowedValues?.[1]?.assumed, true);
  assertEquals(dv.allowedValues?.[1]?.code, "at1001");

  const cuff = flattenSkeleton(skeleton).find((n) =>
    n.rmType === "ELEMENT" && n.label === "Cuff size"
  );
  const cuffDv = cuff?.children.find((c) => c.rmType === "DV_CODED_TEXT");
  assert(cuffDv?.allowedValues && cuffDv.allowedValues.length > 1, "expected Cuff size value set");
  assertEquals(cuffDv.allowedValues[0]?.label, "Adult");
});

Deno.test("DV_QUANTITY skeleton copies constrained units from the template", () => {
  const { skeleton } = generateSkeleton(fixture);
  const nodes = flattenSkeleton(skeleton);
  const systolic = nodes.find((n) =>
    n.rmType === "DV_QUANTITY" && n.slotId.includes("items/at0004/")
  );
  assert(systolic, "expected Systolic DV_QUANTITY");
  assertEquals(systolic.fixedFields?.units, "mm[Hg]");
  assertEquals(systolic.allowedUnits, undefined);

  const diastolic = nodes.find((n) =>
    n.rmType === "DV_QUANTITY" && n.slotId.includes("items/at0005/")
  );
  assertEquals(diastolic?.fixedFields?.units, "mm[Hg]");

  const tilt = nodes.find((n) =>
    n.rmType === "DV_QUANTITY" && n.slotId.includes("items/at1005/")
  );
  assertEquals(tilt?.fixedFields?.units, "°");
});

const ordinalFixture = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "constrain_test.opt"),
);

Deno.test("DV_ORDINAL skeleton carries template ordinal value set", () => {
  const { skeleton } = generateSkeleton(ordinalFixture);
  const vocalization = flattenSkeleton(skeleton).find((n) =>
    n.rmType === "ELEMENT" && n.label === "Vocalization"
  );
  assert(vocalization, "expected Vocalization ELEMENT");
  const dv = vocalization.children.find((c) => c.rmType === "DV_ORDINAL");
  assert(dv, "expected DV_ORDINAL under Vocalization");
  assertEquals(dv.allowedOrdinals?.map((v) => v.value), [0, 1, 2, 3]);
  assertEquals(dv.allowedOrdinals?.map((v) => v.code), [
    "at0010",
    "at0011",
    "at0012",
    "at0013",
  ]);
  assertEquals(dv.allowedOrdinals?.[0]?.label, "Absent");
  assertEquals(dv.allowedOrdinals?.[1]?.label, "Mild");
  assertEquals(dv.allowedOrdinals?.[0]?.terminologyId, "local");
});

Deno.test("web template unit input list becomes DV_QUANTITY fixed units", () => {
  const wt = {
    templateId: "qty-units",
    defaultLanguage: "en",
    tree: {
      id: "composition",
      name: "Encounter",
      rmType: "COMPOSITION",
      nodeId: "openEHR-EHR-COMPOSITION.encounter.v1",
      children: [
        {
          id: "systolic",
          name: "Systolic",
          rmType: "DV_QUANTITY",
          nodeId: "at0004",
          aqlPath: "/content/items/at0004/value",
          min: 1,
          max: 1,
          inputs: [
            { suffix: "magnitude", type: "DECIMAL" },
            {
              suffix: "unit",
              type: "CODED_TEXT",
              list: [{ value: "mm[Hg]", label: "mm[Hg]" }],
            },
          ],
        },
      ],
    },
  };
  const { skeleton } = generateSkeletonFromWebTemplate(JSON.stringify(wt));
  const qty = flattenSkeleton(skeleton).find((n) => n.rmType === "DV_QUANTITY");
  assertEquals(qty?.fixedFields?.units, "mm[Hg]");
  assertEquals(qty?.fixedFields?.defining_code, undefined);
});

Deno.test("web template AQL-style node ids are sanitized and EVENT multiplicity is preserved", async () => {
  const wt = await Deno.readTextFile(
    join(
      import.meta.dirname!,
      "../vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates/Accident report including vital signs.wt.json",
    ),
  );
  const { skeleton } = generateSkeletonFromWebTemplate(wt);
  const nodes = flattenSkeleton(skeleton);
  const evalNode = nodes.find((n) => n.rmType === "EVALUATION");
  assertEquals(evalNode?.multiplicity, "0..*");
  const pulseEvent = nodes.find((n) =>
    n.rmType === "EVENT" && n.slotId.includes("OBSERVATION.pulse.v2")
  );
  assertEquals(pulseEvent?.multiplicity, "0..*");
  const injury = nodes.find((n) =>
    n.kind === "value" && n.slotId.includes("problem_diagnosis") &&
    n.slotId.includes("items/at0002/")
  );
  assert(injury, "expected Injury value slot");
  assertEquals(injury.label, "Injury");
  assertEquals(injury.archetypeNodeId, "at0002");
  assertEquals(injury.slotId.includes("'"), false);
  const vitalSigns = nodes.find((n) => n.rmType === "SECTION" && n.label === "Vital signs");
  const calculated = nodes.find((n) => n.rmType === "SECTION" && n.label === "Calculated scales");
  assert(vitalSigns, "expected Vital signs section");
  assert(calculated, "expected Calculated scales section");
  const context = nodes.find((n) => n.rmType === "EVENT_CONTEXT");
  assertEquals(context?.kind, "container");
});

Deno.test("web template skeleton labels follow requested ontology language", async () => {
  const wt = await Deno.readTextFile(
    join(
      import.meta.dirname!,
      "../vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates/Accident report including vital signs.wt.json",
    ),
  );
  const en = generateSkeletonFromWebTemplate(wt, { language: "en" });
  const sv = generateSkeletonFromWebTemplate(wt, { language: "sv" });
  assertEquals(en.languages.sort().join(","), "de,en,sv");
  assertEquals(en.language, "en");
  assertEquals(sv.language, "sv");
  const findInjury = (skeleton: SkeletonNode[]) =>
    flattenSkeleton(skeleton).find((n) =>
      n.kind === "value" && n.slotId.includes("problem_diagnosis") &&
      n.slotId.includes("items/at0002/")
    );
  assertEquals(findInjury(en.skeleton)?.label, "Injury");
  assertEquals(findInjury(sv.skeleton)?.label, "Skada");
});

Deno.test("a template's name constraint labels a renamed archetype node in the primary language", async () => {
  const dir = join(
    import.meta.dirname!,
    "../vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates",
  );
  const sections = (skeleton: SkeletonNode[]) =>
    flattenSkeleton(skeleton).filter((n) => n.rmType === "SECTION" && n.archetypeRef?.includes("SECTION.adhoc"));

  // Both headings are SECTION.adhoc; the archetype term text is the same for
  // both, so only the template's name constraint tells them apart.
  const en = generateSkeleton(
    await Deno.readTextFile(join(dir, "Accident report including vital signs.opt")),
    { language: "en" },
  );
  assertEquals(sections(en.skeleton).map((n) => n.label), ["Vital signs", "Calculated scales"]);

  const sv = await Deno.readTextFile(join(dir, "Accident report including vital signs.sv.opt"));
  assertEquals(
    sections(generateSkeleton(sv, { language: "sv" }).skeleton).map((n) => n.label),
    ["Vitalparametrar", "Beräkningar"],
  );
  // Another display language shows archetype term text; output names stay the template's.
  const de = sections(generateSkeleton(sv, { language: "de" }).skeleton);
  assertEquals(de.map((n) => n.label), ["Ad hoc Überschrift", "Ad hoc Überschrift"]);
  assertEquals(de.map((n) => n.primaryName), ["Vitalparametrar", "Beräkningar"]);
});

Deno.test("web template renamed sections keep their own names in every language", async () => {
  const wt = await Deno.readTextFile(
    join(
      import.meta.dirname!,
      "../vendor/openEHR-model-examples/local/theme-packs/sport-event-details/templates/Accident report including vital signs.wt.json",
    ),
  );
  for (const language of ["en", "sv", "de"]) {
    const sections = flattenSkeleton(generateSkeletonFromWebTemplate(wt, { language }).skeleton)
      .filter((n) => n.rmType === "SECTION");
    assertEquals(
      sections.map((n) => n.primaryName ?? n.label),
      ["Vital signs", "Calculated scales"],
      language,
    );
  }
});
