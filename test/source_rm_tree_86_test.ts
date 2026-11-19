/**
 * #86 variant A: openEHR Web Template source trees show silent-mandatory RM
 * the template omitted, and keep optional RM on the node for the tree plus.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { getSourceFormatHandler } from "@intehrgrator/core/source/mod.ts";
import {
  discloseOpenEhrSourceRm,
  optionalSourceRmGaps,
} from "@intehrgrator/core/source/rm_tree_disclosure.ts";
import { validateInstanceAgainstSchema } from "@intehrgrator/core/source/instance_validation.ts";
import type { SchemaTreeNode } from "@intehrgrator/types/mod.ts";

const handler = getSourceFormatHandler("openehr-web-template");

function wt(tree: unknown): string {
  return JSON.stringify({ templateId: "demo", tree });
}

function find(node: SchemaTreeNode, name: string): SchemaTreeNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children) {
    const hit = find(child, name);
    if (hit) return hit;
  }
  return undefined;
}

function child(node: SchemaTreeNode, name: string): SchemaTreeNode | undefined {
  return node.children.find((item) => item.name === name);
}

const MINI = wt({
  id: "composition",
  rmType: "COMPOSITION",
  min: 1,
  max: 1,
  aqlPath: "",
  children: [
    {
      id: "context",
      rmType: "EVENT_CONTEXT",
      min: 1,
      max: 1,
      aqlPath: "/context",
      children: [
        {
          id: "start_time",
          rmType: "DV_DATE_TIME",
          min: 1,
          max: 1,
          aqlPath: "/context/start_time",
          inputs: [{ type: "DATETIME" }],
        },
        {
          id: "setting",
          rmType: "DV_CODED_TEXT",
          min: 1,
          max: 1,
          aqlPath: "/context/setting",
          inputs: [{ suffix: "code", type: "CODED_TEXT" }],
        },
        {
          id: "vårdenhet",
          rmType: "CLUSTER",
          min: 0,
          max: 1,
          aqlPath: "/context/other_context[at0003]/items[cluster]",
        },
      ],
    },
    {
      id: "frågeformulär",
      rmType: "OBSERVATION",
      min: 0,
      max: 1,
      aqlPath: "/content[openEHR-EHR-OBSERVATION.screening.v1]",
      children: [
        {
          id: "symptom",
          rmType: "DV_TEXT",
          min: 0,
          max: 1,
          aqlPath:
            "/content[openEHR-EHR-OBSERVATION.screening.v1]/data[at0001]/events[at0002]/data[at0003]/items[at0004]/value",
          inputs: [{ type: "TEXT" }],
        },
      ],
    },
    {
      id: "temperature",
      rmType: "DV_QUANTITY",
      min: 0,
      max: 1,
      aqlPath: "/content[at0002]/value",
      inputs: [
        { suffix: "magnitude", type: "DECIMAL" },
        { suffix: "unit", type: "CODED_TEXT" },
      ],
    },
  ],
});

Deno.test("web template source tree shows silent-mandatory RM the template omitted", () => {
  const tree = handler.loadSchema(MINI, "composition");
  assertEquals(tree.name, "composition");

  const archetypeNodeId = child(tree, "archetype_node_id");
  const name = child(tree, "name");
  assertEquals(archetypeNodeId?.rmOrigin, "rm-mandatory");
  assertEquals(archetypeNodeId?.type, "String");
  assertEquals(archetypeNodeId?.path, "$.archetype_node_id");
  assertEquals(name?.rmOrigin, "rm-mandatory");
  assertEquals(name?.type, "DV_TEXT");
  assertEquals(child(name!, "value")?.rmOrigin, "rm-mandatory");
  assertEquals(child(name!, "value")?.path, "$.name.value");

  const context = child(tree, "context");
  assertEquals(context?.rmOrigin, undefined);
  assertEquals(child(context!, "start_time")?.rmOrigin, undefined);
  const contextOptional = optionalSourceRmGaps(context!);
  const endTime = contextOptional.find((item) => item.name === "end_time");
  assertEquals(endTime?.rmOrigin, "rm-optional");
  assertEquals(endTime?.type, "DV_DATE_TIME");
  assertEquals(endTime?.path, "$.context.end_time");
  assertEquals(
    contextOptional.some((item) => item.name === "health_care_facility"),
    true,
  );
  // vårdenhet already occupies other_context. Optional gaps are not stored on the tree.
  assertEquals(child(context!, "other_context"), undefined);
  assertEquals(child(context!, "end_time"), undefined);

  // Observations live in content; do not add a second content node.
  assertEquals(child(tree, "content"), undefined);
  const observation = child(tree, "frågeformulär");
  assertEquals(observation?.rmAttribute, "content");
  assertEquals(child(observation!, "data"), undefined);
  assertEquals(child(observation!, "subject")?.rmOrigin, "rm-mandatory");
  assertEquals(child(observation!, "encoding")?.rmOrigin, "rm-mandatory");

  const names = tree.children.map((item) => item.name);
  const templateAt = names.indexOf("context");
  assert(names.indexOf("name") < templateAt);
  assert(names.indexOf("archetype_node_id") < templateAt);
  assertEquals(names.includes("feeder_audit"), false);
  assertEquals(
    optionalSourceRmGaps(tree).some((item) => item.name === "feeder_audit"),
    true,
  );
});

Deno.test("web template inputs cover the value they already show", () => {
  const tree = handler.loadSchema(MINI, "composition");
  const start = find(tree, "start_time");
  assertEquals(child(start!, "value"), undefined);
  assert(
    optionalSourceRmGaps(start!).some((item) =>
      item.name === "magnitude_status"
    ),
  );

  const setting = find(tree, "setting");
  assertEquals(child(setting!, "defining_code"), undefined);
  assertEquals(child(setting!, "|code")?.rmAttribute, "defining_code");
  assertEquals(child(setting!, "value")?.rmOrigin, "rm-mandatory");

  const quantity = find(tree, "temperature");
  assertEquals(child(quantity!, "magnitude"), undefined);
  assertEquals(child(quantity!, "units"), undefined);
  assertEquals(child(quantity!, "|magnitude")?.rmAttribute, "magnitude");
  assertEquals(child(quantity!, "|unit")?.rmAttribute, "units");
  assertEquals(
    optionalSourceRmGaps(quantity!).some((item) => item.name === "precision"),
    true,
  );

  const symptom = find(tree, "symptom");
  assertEquals(child(symptom!, "value"), undefined);
  assertEquals(
    optionalSourceRmGaps(symptom!).some((item) => item.name === "mappings"),
    true,
  );
});

Deno.test("RM disclosure is idempotent", () => {
  const once = handler.loadSchema(MINI, "composition");
  const twice = discloseOpenEhrSourceRm(once);
  assertEquals(twice, once);
});

Deno.test("synthetic RM rows are not example-schema mismatches", () => {
  const schema = handler.loadSchema(MINI, "composition");
  const issues = validateInstanceAgainstSchema(
    "{}",
    "openehr-composition",
    schema,
    MINI,
  );
  const paths = issues.map((issue) => `${issue.path} ${issue.message}`);
  assertEquals(paths.some((line) => line.includes("archetype_node_id")), false);
  assertEquals(paths.some((line) => line.includes("$.name")), false);
  assertEquals(paths.some((line) => line.includes("end_time")), false);
  assert(
    paths.some((line) =>
      line.includes("$.context") && line.includes("Required")
    ),
    paths.join("\n"),
  );
});

Deno.test("JSON schema trees are not given RM rows", () => {
  const json = getSourceFormatHandler("json");
  const tree = json.loadSchema(
    JSON.stringify({
      type: "object",
      properties: { systolic: { type: "number" } },
    }),
    "vitals",
  );
  const flat = JSON.stringify(tree);
  assertEquals(flat.includes("rm-mandatory"), false);
  assertEquals(flat.includes("archetype_node_id"), false);
});

Deno.test("chemo web template discloses RM without dropping clinical nodes", () => {
  const file = join(
    import.meta.dirname!,
    "fixtures",
    "patient-reported-chemotherapy-symptoms",
    "source-schema",
    "Patient_reportet_symptoms_before_medical_oncology_treatment.8.0.2.sv.en.wt.json",
  );
  const tree = handler.loadSchema(Deno.readTextFileSync(file), "chemo");
  assert(
    find(tree, "kroppstemperatur"),
    "clinical observation stays in the tree",
  );
  assertEquals(child(tree, "name")?.rmOrigin, "rm-mandatory");
  const context = child(tree, "context");
  assertEquals(child(context!, "start_time")?.rmOrigin, undefined);
  assertEquals(
    optionalSourceRmGaps(context!).some((item) => item.name === "end_time"),
    true,
  );
  let count = 0;
  const walk = (node: SchemaTreeNode) => {
    count++;
    for (const item of node.children) walk(item);
  };
  walk(tree);
  assert(count < 2500, `disclosed tree has ${count} nodes`);
});
