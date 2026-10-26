import { assertEquals, assertThrows } from "@std/assert";
import {
  buildPrompt,
  formatImportFollowUp,
  formatMultipart,
  importSuggestions,
  joinLoopPath,
  looksLikeSuggestionsPayload,
  mimeForFilename,
  parseSuggestionsPayload,
  resolveKnownSlotId,
  suggestionBlockToExpression,
  validateSuggestionEnvelope,
} from "@intehrgrator/core/ai/mod.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  exportBundle,
  importBundle,
  BUNDLE_VERSION,
  AUTOSAVE_STORAGE_KEY,
  MANUAL_SAVE_KEY_PREFIX,
  formatSaveTime,
} from "@intehrgrator/core/persistence/mod.ts";
import type { ProjectBundle, SkeletonNode } from "@intehrgrator/types/mod.ts";
import { DEFAULT_SETTINGS } from "@intehrgrator/types/mod.ts";

const skeleton: SkeletonNode[] = [
  {
    slotId: "t1:$.name",
    blockType: "target_value",
    rmType: "string",
    label: "name",
    kind: "value",
    mandatory: true,
    targetPath: "$.name",
    children: [],
  },
];

Deno.test("AI import validates targetId", () => {
  const model = createEmptyModel("expected");
  model.targetFormat = "json-schema";
  assertThrows(() => {
    importSuggestions(model, {
      format: "intehrgrator-suggestions",
      version: "2",
      target: { format: "json-schema", targetId: "other" },
      suggestions: [],
    }, new Set(["s1"]));
  });
});

Deno.test("AI import applies Blockly source_query suggestion", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "json-schema";
  const { model: next, report } = importSuggestions(model, {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: "t1" },
    suggestions: [{
      slotId: "s1",
      block: {
        type: "source_query_number",
        fields: { EXPRESSION: "$.vitals[1].systolic" },
      },
    }],
  }, new Set(["s1"]));
  assertEquals(report.applied, 1);
  assertEquals(report.loopsAccepted, 0);
  assertEquals(next.slots[0].expression, 'xpathNumber("$.vitals[1].systolic")');
});

Deno.test("AI import keeps loopVar relative paths", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "openehr-template";
  const { model: next, report } = importSuggestions(model, {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t1" },
    loops: [{
      attachSlotId: "t1/events",
      block: {
        type: "for_each_source",
        fields: { VAR: "vital", PATH: "$.vitals" },
      },
    }],
    suggestions: [{
      slotId: "t1/events/systolic",
      loopVar: "vital",
      block: {
        type: "source_query_number",
        fields: { EXPRESSION: "systolic" },
      },
    }],
  }, new Set(["t1/events", "t1/events/systolic"]));
  assertEquals(report.loopsAccepted, 1);
  assertEquals(report.applied, 1);
  assertEquals(next.slots[0].expression, 'xpathNumber("systolic")');
  assertEquals(next.loops, [{
    attachSlotId: "t1/events",
    varName: "vital",
    path: "$.vitals",
    kind: "source",
  }]);
});

Deno.test("AI import applies maps_get suggestion", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "openehr-template";
  const { model: next, report } = importSuggestions(model, {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t1" },
    suggestions: [{
      slotId: "t1/language/value",
      block: {
        type: "maps_get",
        fields: { NAME: "defaults" },
        inputs: {
          KEY: { block: { type: "text", fields: { TEXT: "language" } } },
        },
      },
    }],
  }, new Set(["t1/language/value"]));
  assertEquals(report.applied, 1);
  assertEquals(next.slots[0].expression, 'maps_get("defaults", "language")');
});

Deno.test("AI import applies valid entries when envelope has schema issues", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "json-schema";
  const payload = parseSuggestionsPayload(`{
    "format": "intehrgrator-suggestions",
    "version": "2",
    "target": { "format": "json-schema", "targetId": "t1" },
    "suggestions": [
      {
        "slotId": "t1:$.good",
        "block": { "type": "source_query", "fields": { "EXPRESSION": "$.name" } }
      },
      {
        "slotId": "t1:$.bad",
        "block": { "type": "not_a_real_block", "fields": {} }
      }
    ]
  }`);
  const schemaIssues = validateSuggestionEnvelope(JSON.parse(`{
    "format": "intehrgrator-suggestions",
    "version": "2",
    "target": { "format": "json-schema", "targetId": "t1" },
    "suggestions": [
      { "slotId": "t1:$.good", "block": { "type": "source_query", "fields": { "EXPRESSION": "$.name" } } },
      { "slotId": "t1:$.bad", "block": { "type": "not_a_real_block", "fields": {} } }
    ]
  }`));
  const { model: next, report } = importSuggestions(
    model,
    payload,
    new Set(["t1:$.good", "t1:$.bad"]),
  );
  report.schemaIssues = schemaIssues;
  assertEquals(report.applied, 1);
  assertEquals(report.skipped, 1);
  assertEquals(schemaIssues.length > 0, true);
  assertEquals(next.slots[0].expression, 'xpathString("$.name")');
});

Deno.test("joinLoopPath", () => {
  assertEquals(joinLoopPath("$.vitals", "systolic"), "$.vitals[*].systolic");
  assertEquals(joinLoopPath("$.vitals[*]", "systolic"), "$.vitals[*].systolic");
  assertEquals(joinLoopPath("/patient/vitals", "systolic"), "/patient/vitals/systolic");
  assertEquals(joinLoopPath("$.vitals", "$.other"), "$.other");
});

Deno.test("resolveKnownSlotId matches collapsed slashes either way", () => {
  const known = new Set(["Accident report//content/pulse"]);
  assertEquals(resolveKnownSlotId("Accident report//content/pulse", known), "Accident report//content/pulse");
  assertEquals(resolveKnownSlotId("Accident report/content/pulse", known), "Accident report//content/pulse");
  assertEquals(resolveKnownSlotId("Accident report///content/pulse", known), "Accident report//content/pulse");
  assertEquals(resolveKnownSlotId("Accident report/other", known), null);
});

Deno.test("AI import rejects version 1", () => {
  assertThrows(() => {
    parseSuggestionsPayload(`\`\`\`intehrgrator-suggestions
{"format":"intehrgrator-suggestions","version":"1","templateId":"t1","suggestions":[]}
\`\`\``);
  });
});

Deno.test("suggestionBlockToExpression handles trim + source_query", () => {
  const expr = suggestionBlockToExpression({
    type: "text_trim",
    fields: { MODE: "BOTH" },
    inputs: {
      TEXT: {
        block: {
          type: "source_query",
          fields: { EXPRESSION: "$.name.family", RETURN_TYPE: "string" },
        },
      },
    },
  });
  assertEquals(expr, 'trim(xpathString("$.name.family"))');
});

Deno.test("buildPrompt inline embeds multipart body", () => {
  const model = createEmptyModel("PatientSchema");
  model.targetFormat = "json-schema";
  const prompt = buildPrompt({
    scope: "full",
    targetId: "PatientSchema",
    targetFormat: "json-schema",
    targetFilename: "patient.schema.json",
    skeleton,
    model,
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "inline",
    sourceFormat: "json",
    artifacts: [{
      role: "source-schema",
      filename: "patient.schema.json",
      format: "json",
      content: '{"type":"object"}',
    }],
  });
  assertEquals(prompt.includes("## Slot tree") && prompt.includes(`"slots":[`), true);
  assertEquals(prompt.includes("rmType"), false);
  assertEquals(prompt.includes("--intehrgrator-part"), true);
  assertEquals(prompt.includes('X-Intehrgrator-Role: source-schema'), true);
  assertEquals(prompt.includes('{"type":"object"}'), true);
  assertEquals(prompt.includes("AI_SUGGESTION_FORMAT.schema.json"), true);
});

Deno.test("buildPrompt openEHR target includes references and block examples", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "openehr-template";
  const prompt = buildPrompt({
    scope: "full",
    targetId: "t1",
    targetFormat: "openehr-template",
    targetFilename: "bp.opt",
    skeleton: [],
    model,
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "attach",
    artifacts: [],
  });
  assertEquals(prompt.includes("## openEHR references"), true);
  assertEquals(prompt.includes("openehr-assistant MCP"), true);
  assertEquals(prompt.includes("cadasto/openehr-assistant-plugin"), true);
  assertEquals(prompt.includes("llms.txt"), true);
  assertEquals(prompt.includes("deepwiki.com/ErikSundvall/ehrtslib"), true);
  assertEquals(prompt.includes("## Block examples"), true);
  assertEquals(prompt.includes("icd10_snomed"), true);
  assertEquals(prompt.includes("source takes precedence"), true);
  assertEquals(prompt.includes("maps_get"), true);
  assertEquals(prompt.includes("sheet_lookup"), true);
  assertEquals(prompt.includes("OPENEHR_PRIMER.md"), false);
});

Deno.test("buildPrompt uri lists browseable URLs", () => {
  const model = createEmptyModel("t1");
  model.targetFormat = "openehr-template";
  const prompt = buildPrompt({
    scope: "full",
    targetId: "t1",
    targetFormat: "openehr-template",
    targetFilename: "bp.opt",
    skeleton: [],
    model,
    formatDocUrl: "https://example.test/fmt",
    delivery: "uri",
    artifacts: [
      {
        role: "target",
        filename: "bp.opt",
        format: "openehr-template",
        content: "<template/>",
        originUrl: "https://example.test/bp.opt",
      },
      {
        role: "example",
        filename: "local.json",
        format: "json",
        content: "{}",
      },
    ],
  });
  assertEquals(prompt.includes("## Browse URIs"), true);
  assertEquals(prompt.includes("https://example.test/bp.opt"), true);
  assertEquals(prompt.includes("## Attachments (no URI — upload these)"), true);
  assertEquals(prompt.includes("`local.json`"), true);
});

Deno.test("mimeForFilename and formatMultipart", () => {
  assertEquals(mimeForFilename("a.json"), "application/json");
  assertEquals(mimeForFilename("a.opt"), "application/xml");
  const body = formatMultipart([{
    role: "example",
    filename: "x.json",
    format: "json",
    content: "{}",
    originUrl: "https://example.test/x.json",
  }]);
  assertEquals(body.includes("X-Intehrgrator-Origin: https://example.test/x.json"), true);
  assertEquals(body.endsWith("--intehrgrator-part--"), true);
});

Deno.test("project bundle round-trip", () => {
  const bundle: ProjectBundle = {
    version: BUNDLE_VERSION,
    projectId: "p1",
    appVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    target: null,
    sourceSchema: null,
    examples: [],
    activeExampleId: null,
    mapping: { blocklyState: null, model: createEmptyModel("t1") },
    settings: DEFAULT_SETTINGS,
  };
  const restored = importBundle(exportBundle(bundle));
  assertEquals(restored.projectId, "p1");
});

Deno.test("autosave and manual save use distinct storage keys", () => {
  assertEquals(AUTOSAVE_STORAGE_KEY, "__autosave__");
  assertEquals(MANUAL_SAVE_KEY_PREFIX, "manual:");
  assertEquals(AUTOSAVE_STORAGE_KEY.startsWith(MANUAL_SAVE_KEY_PREFIX), false);
});

Deno.test("formatSaveTime renders hh:mm", () => {
  const formatted = formatSaveTime("2026-07-02T14:05:00.000Z");
  assertEquals(/^\d{2}:\d{2}$/.test(formatted), true);
});

/** Shape Gemini actually returned: missing format/target, nested loops, Blockly mutation noise. */
const GEMINI_SHAPED = `{
  "version": "2",
  "suggestions": [
    {
      "slotId": "Accident report//context/start_time/value",
      "block": {
        "type": "source_query_string",
        "mutation": { "domain": "fontoxpath" },
        "fields": { "EXPRESSION": "$.header.timestamp" }
      }
    },
    {
      "attachSlotId": "Accident report//content/pulse/events/at0003",
      "for_each_source": "$.readings[*]",
      "loopVar": "item",
      "suggestions": [
        {
          "slotId": "Accident report//content/pulse/events/at0003/data/at0004/value/value/value",
          "block": {
            "type": "source_query_number",
            "mutation": { "domain": "fontoxpath" },
            "fields": { "EXPRESSION": "$item?pulse" }
          }
        },
        {
          "slotId": "Accident report//content/pulse/events/at0003/time/value",
          "block": {
            "type": "source_query_string",
            "fields": { "EXPRESSION": "$item?timestamp" }
          }
        }
      ]
    },
    {
      "attachSlotId": "Accident report//content/respiration/events/at0002",
      "for_each_source": "$.readings[*]",
      "loopVar": "item",
      "suggestions": [
        {
          "slotId": "Accident report//content/respiration/events/at0002/data/at0004/value/value/value",
          "block": {
            "type": "source_query_number",
            "fields": { "EXPRESSION": "$item?respiration_rate" }
          }
        }
      ]
    }
  ]
}`;

Deno.test("looksLikeSuggestionsPayload accepts Gemini-shaped JSON, not Copy AI Prompt markdown", () => {
  assertEquals(looksLikeSuggestionsPayload(GEMINI_SHAPED), true);
  assertEquals(
    looksLikeSuggestionsPayload("# intEHRgrator mapping assist\n\n## Slot manifest\n```json\n[]\n```\n"),
    false,
  );
});

Deno.test("AI import accepts Gemini-shaped envelope (nested loops, aliases, // slot ids)", () => {
  const model = createEmptyModel("Accident report");
  model.targetFormat = "openehr-template";
  const startTime = "Accident report/context/start_time/value";
  const pulseEvent = "Accident report/content/pulse/events/at0003";
  const pulseRate = "Accident report/content/pulse/events/at0003/data/at0004/value/value/value";
  const pulseTime = "Accident report/content/pulse/events/at0003/time/value";
  const respEvent = "Accident report/content/respiration/events/at0002";
  const respRate = "Accident report/content/respiration/events/at0002/data/at0004/value/value/value";

  const payload = parseSuggestionsPayload(GEMINI_SHAPED, {
    fallbackTarget: { format: "openehr-template", targetId: "Accident report" },
  });
  const { model: next, report } = importSuggestions(
    model,
    payload,
    new Set([startTime, pulseEvent, pulseRate, pulseTime, respEvent, respRate]),
  );

  assertEquals(report.errors, []);
  assertEquals(report.applied, 4);
  assertEquals(report.loopsAccepted, 2);
  assertEquals(next.slots.find((s) => s.slotId === startTime)?.expression, 'xpathString("$.header.timestamp")');
  assertEquals(next.slots.find((s) => s.slotId === pulseRate)?.expression, 'xpathNumber("pulse")');
  assertEquals(next.slots.find((s) => s.slotId === pulseTime)?.expression, 'xpathString("timestamp")');
  assertEquals(next.slots.find((s) => s.slotId === respRate)?.expression, 'xpathNumber("respiration_rate")');
  assertEquals(next.loops, [
    { attachSlotId: pulseEvent, varName: "item", path: "$.readings[*]", kind: "source" },
    { attachSlotId: respEvent, varName: "item", path: "$.readings[*]", kind: "source" },
  ]);
});

Deno.test("suggestion JSON Schema accepts the documented repeating-vitals example", () => {
  const issues = validateSuggestionEnvelope({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "vitals_encounter_v1" },
    loops: [{
      attachSlotId: "vitals_encounter_v1/content/data/events",
      block: {
        type: "for_each_list",
        fields: { VAR: "vital" },
        inputs: {
          LIST: {
            block: { type: "source_query_node", fields: { EXPRESSION: "$.vitals" } },
          },
        },
      },
    }],
    suggestions: [{
      slotId: "vitals_encounter_v1/content/data/events/data/items/at0004/value/value/value",
      loopVar: "vital",
      block: {
        type: "source_query_number",
        fields: { EXPRESSION: "systolic" },
      },
    }],
  });
  assertEquals(issues, []);
});

Deno.test("suggestion JSON Schema still accepts legacy for_each_source", () => {
  const issues = validateSuggestionEnvelope({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "vitals_encounter_v1" },
    loops: [{
      attachSlotId: "vitals_encounter_v1/content/data/events",
      block: {
        type: "for_each_source",
        fields: { VAR: "vital", PATH: "$.vitals" },
      },
    }],
    suggestions: [{
      slotId: "vitals_encounter_v1/content/data/events/data/items/at0004/value/value/value",
      loopVar: "vital",
      block: {
        type: "source_query_number",
        fields: { EXPRESSION: "systolic" },
      },
    }],
  });
  assertEquals(issues, []);
});

Deno.test("suggestion JSON Schema accepts maps_get", () => {
  const issues = validateSuggestionEnvelope({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t1" },
    suggestions: [{
      slotId: "t1/language/value",
      block: {
        type: "maps_get",
        fields: { NAME: "defaults" },
        inputs: {
          KEY: { block: { type: "text", fields: { TEXT: "language" } } },
        },
      },
    }],
  });
  assertEquals(issues, []);
});

Deno.test("suggestion JSON Schema explains Gemini-shaped deviations", () => {
  const issues = validateSuggestionEnvelope(JSON.parse(GEMINI_SHAPED));
  const text = issues.map((i) => i.message).join("\n");
  assertEquals(issues.some((i) => i.path === "$" && i.message.includes("format")), true);
  assertEquals(issues.some((i) => i.path === "$" && i.message.includes("target")), true);
  assertEquals(/source_query_string|invalid block type/.test(text), true);
  assertEquals(/mutation/.test(text), true);
  assertEquals(/nested loops/.test(text), true);

  const followUp = formatImportFollowUp({
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    schemaUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.schema.json",
    payload: GEMINI_SHAPED,
    schemaIssues: issues,
    errors: [],
  });
  assertEquals(followUp.includes("JSON Schema:"), true);
  assertEquals(followUp.includes("Previous payload"), true);
  assertEquals(followUp.includes("nested loops") || followUp.includes("source_query"), true);
});

Deno.test("suggestion JSON Schema accepts decision_table and for_each_list", () => {
  const decision = validateSuggestionEnvelope({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: "DummyVitalsTarget" },
    suggestions: [{
      slotId: "DummyVitalsTarget:$.band",
      block: {
        type: "decision_table",
        fields: { NAME: "sbp_band", OUTPUT: "band" },
        inputs: {
          INPUTS: {
            block: {
              type: "maps_create_with",
              extraState: { itemCount: 1 },
              fields: { KEY0: "sbp" },
              inputs: {
                VAL0: {
                  block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } },
                },
              },
            },
          },
        },
      },
    }],
  });
  assertEquals(decision, []);

  const listLoop = validateSuggestionEnvelope({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "json-schema", targetId: "t1" },
    loops: [{
      attachSlotId: "t1:$.items",
      block: {
        type: "for_each_list",
        fields: { VAR: "item" },
        inputs: {
          LIST: {
            block: { type: "source_query_node", fields: { EXPRESSION: "$.readings" } },
          },
        },
      },
    }],
    suggestions: [{
      slotId: "t1:$.items.value",
      loopVar: "item",
      block: { type: "source_query", fields: { EXPRESSION: "code" } },
    }],
  });
  assertEquals(listLoop, []);
});

Deno.test("suggestionBlockToExpression serializes decision_table", () => {
  const expr = suggestionBlockToExpression({
    type: "decision_table",
    fields: { NAME: "sbp_band", OUTPUT: "band" },
    inputs: {
      INPUTS: {
        block: {
          type: "maps_create_with",
          extraState: { itemCount: 1 },
          fields: { KEY0: "sbp" },
          inputs: {
            VAL0: { block: { type: "source_query_number", fields: { EXPRESSION: "$.systolic" } } },
          },
        },
      },
    },
  });
  assertEquals(expr, 'decision_table("sbp_band", map("sbp", xpathNumber("$.systolic")), "band")');
});

Deno.test("buildPrompt includes Decision table grids and product stack", () => {
  const model = createEmptyModel("PatientSchema");
  model.targetFormat = "json-schema";
  const prompt = buildPrompt({
    scope: "full",
    targetId: "PatientSchema",
    targetFormat: "json-schema",
    targetFilename: "patient.schema.json",
    skeleton,
    model,
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "attach",
    artifacts: [],
    sheets: [{
      name: "sbp_band",
      kind: "decision-table",
      headers: ["sbp", "band"],
      values: [[">= 140", "high"]],
      hitPolicy: "FIRST",
      decisionColumns: [{ role: "condition" }, { role: "output", outputKind: "value" }],
    }],
    productStack: [{ type: "json_instance_root", encoding: "canonical_json" }],
  });
  assertEquals(prompt.includes("## Sheets and Decision tables"), true);
  assertEquals(prompt.includes("sbp_band"), true);
  assertEquals(prompt.includes("decision-table"), true);
  assertEquals(prompt.includes("## Product stack"), true);
  assertEquals(prompt.includes("decision_table"), true);
  assertEquals(prompt.includes("more readable to humans"), true);
});

Deno.test("buildPrompt includes Optional RM Insertion catalog", () => {
  const model = createEmptyModel("bp");
  const prompt = buildPrompt({
    scope: "full",
    targetId: "bp",
    targetFormat: "openehr-template",
    targetFilename: "blood_pressure.opt",
    skeleton,
    model,
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "attach",
    artifacts: [],
    optionalRm: [{
      parentSlotId: "bp/content[openEHR-EHR-OBSERVATION.blood_pressure.v2]",
      attachments: [{ rmType: "FEEDER_AUDIT", attributeName: "feeder_audit", label: "feeder_audit" }],
    }],
  });
  assertEquals(prompt.includes("## Optional RM Insertion"), true);
  assertEquals(prompt.includes("optional_rm_add"), true);
  assertEquals(prompt.includes("feeder_audit"), true);
});

Deno.test("buildPrompt includes Constraint warnings", () => {
  const model = createEmptyModel("bp");
  const prompt = buildPrompt({
    scope: "full",
    targetId: "bp",
    targetFormat: "openehr-template",
    targetFilename: "blood_pressure.opt",
    skeleton,
    model,
    formatDocUrl: "https://example.test/docs/AI_SUGGESTION_FORMAT.md",
    delivery: "attach",
    artifacts: [],
    constraintWarnings: [{
      slotId: "bp/content/data/events/data/items/at0004/value/value",
      message: "Mandatory slot unmapped: Systolic",
    }],
  });
  assertEquals(prompt.includes("## Constraint warnings"), true);
  assertEquals(prompt.includes("Mandatory slot unmapped: Systolic"), true);
  assertEquals(prompt.includes("list_constraint_warnings"), true);
});
