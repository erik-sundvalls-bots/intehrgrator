import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  balancedJsonEnd,
  collectSuggestionNotes,
  NOTES_CONVENTION,
  parseAiResponseNotes,
} from "@intehrgrator/core/ai/response_notes.ts";
import {
  applySuggestionReviewDefaults,
  extractSuggestionsJson,
  importSuggestions,
  looksLikeSuggestionsPayload,
  parseAiAnswerNotes,
  parseAiConfidence,
  parseSuggestionsPayload,
  slotReviewFrom,
  validateSuggestionEnvelope,
} from "@intehrgrator/core/ai/mod.ts";
import {
  CONFIDENCE_BANDS,
  confidenceBand,
} from "@intehrgrator/core/ai/response_notes.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  MAPPING_TOOLS_SYSTEM,
  SUGGESTIONS_SYSTEM,
} from "@intehrgrator/core/ai/credentials.ts";
import { buildRefreshMergePrompt } from "@intehrgrator/core/target/refresh_diff.ts";
import { runMappingAgent } from "@intehrgrator/core/ai/mapping_agent.ts";

const ENVELOPE = {
  format: "intehrgrator-suggestions",
  version: "2",
  loops: [{
    attachSlotId: "t/items/at0004",
    block: { type: "for_each_list" },
    note: "One row per reading",
  }],
  suggestions: [
    {
      slotId: "t/items/at0004/value/magnitude",
      block: { type: "source_query" },
      note: "Assumed mmHg",
    },
    {
      slotId: "t/items/at0005/value/magnitude",
      block: { type: "source_query" },
    },
  ],
};
const FENCE = "```intehrgrator-suggestions\n" +
  JSON.stringify(ENVELOPE, null, 2) + "\n```";

Deno.test("no sections: body is the whole answer, nothing extracted", () => {
  const text = `Here you go.\n\n${FENCE}`;
  const parsed = parseAiResponseNotes(text);
  assertEquals(parsed.notes, []);
  assertEquals(parsed.questions, []);
  assertEquals(parsed.body, text);
});

Deno.test("Notes and Questions outside the fence are extracted, body keeps the rest", () => {
  const text = [
    "Mapped the vitals.",
    "",
    FENCE,
    "",
    "### Notes",
    "- Assumed systolic is in mmHg.",
    "- Skipped `device/name`: no source field",
    "  (the device block is empty in all examples).",
    "",
    "### Questions",
    "1. Should missing diastolic fall back to the default? (yes / no)",
    "2. Which example is canonical? Options: instance-1, instance-2",
  ].join("\n");
  const parsed = parseAiResponseNotes(text);
  assertEquals(parsed.notes, [
    "Assumed systolic is in mmHg.",
    "Skipped `device/name`: no source field (the device block is empty in all examples).",
  ]);
  assertEquals(parsed.questions, [
    { text: "Should missing diastolic fall back to the default?", options: [{ text: "yes" }, { text: "no" }] },
    { text: "Which example is canonical? Options: instance-1, instance-2", options: [] },
  ]);
  assertStringIncludes(parsed.body, "Mapped the vitals.");
  assertStringIncludes(parsed.body, "```intehrgrator-suggestions");
  assertEquals(parsed.body.includes("### Notes"), false);
});

Deno.test("headings are tolerant: level, case, bold, colon, Swedish", () => {
  const text =
    "## NOTES:\nplain line note\n\n**Frågor**\n- Vilken enhet?\n\n#### anteckningar\n* extra\n\n# Summary\nDone.";
  const parsed = parseAiResponseNotes(text);
  assertEquals(parsed.notes, ["plain line note", "extra"]);
  assertEquals(parsed.questions, [{ text: "Vilken enhet?", options: [] }]);
  assertStringIncludes(parsed.body, "# Summary\nDone.");
});

Deno.test("a 'Notes' heading inside a code fence is not a section", () => {
  const text = "```md\n### Notes\n- inside\n```\nafter";
  const parsed = parseAiResponseNotes(text);
  assertEquals(parsed.notes, []);
  assertStringIncludes(parsed.body, "- inside");
});

Deno.test("per-suggestion and loop note fields are surfaced", () => {
  assertEquals(collectSuggestionNotes(ENVELOPE), [
    { kind: "loop", slotId: "t/items/at0004", note: "One row per reading" },
    {
      kind: "suggestion",
      slotId: "t/items/at0004/value/magnitude",
      note: "Assumed mmHg",
    },
  ]);
  const parsed = parseAiAnswerNotes(`${FENCE}\n\n### Questions\n1. OK?`);
  assertEquals(parsed.suggestionNotes.length, 2);
  assertEquals(parsed.questions, [{ text: "OK?", options: [] }]);
});

Deno.test("raw JSON followed by Notes prose still parses as suggestions", () => {
  const text = `${JSON.stringify(ENVELOPE)}\n\n### Notes\n- brace } in prose {`;
  assertEquals(looksLikeSuggestionsPayload(text), true);
  assertEquals(
    (extractSuggestionsJson(text) as { suggestions: unknown[] }).suggestions
      .length,
    2,
  );
  assertEquals(parseAiAnswerNotes(text).notes, ["brace } in prose {"]);
  assertEquals(balancedJsonEnd('{"a":"}{","b":{}} tail', 0), 17);
});

Deno.test("prompts carry the Notes / Questions convention without forbidding prose", () => {
  assertStringIncludes(NOTES_CONVENTION, "### Notes");
  assertStringIncludes(SUGGESTIONS_SYSTEM, "### Questions");
  assertEquals(/JSON[^.]*\bonly\b/i.test(SUGGESTIONS_SYSTEM), false);
  assertStringIncludes(MAPPING_TOOLS_SYSTEM, "summary");
  assertStringIncludes(MAPPING_TOOLS_SYSTEM, "### Notes");
  const refresh = buildRefreshMergePrompt({
    kind: "target",
    previousFilename: "a",
    nextFilename: "b",
    warnings: [],
  });
  assertStringIncludes(refresh, NOTES_CONVENTION);
});

Deno.test("apply-directly: notes from import_suggestions envelopes are returned", async () => {
  let step = 0;
  const fetchStub = (() => {
    const message = step++ === 0
      ? {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "c1",
          type: "function",
          function: {
            name: "import_suggestions",
            arguments: JSON.stringify({ text: FENCE }),
          },
        }],
      }
      : { role: "assistant", content: "Done.\n\n### Notes\n- Check units" };
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 }),
    );
  }) as typeof fetch;
  const result = await runMappingAgent({
    credentials: {
      endpoint: "https://x.test/v1/chat/completions",
      apiKey: "k",
      model: "m",
    },
    prompt: "map",
    executeTool: () =>
      Promise.resolve({
        report: { applied: 1, skipped: 0, errors: [], loopsAccepted: 1 },
      }),
    fetch: fetchStub,
  });
  assertEquals(result.suggestionNotes.map((n) => n.note), [
    "One row per reading",
    "Assumed mmHg",
  ]);
  assertEquals(parseAiAnswerNotes(result.text).notes, ["Check units"]);
});

Deno.test("confidence: strict 0..100 number, rounded; everything else ignored", () => {
  assertEquals(parseAiConfidence(0), 0);
  assertEquals(parseAiConfidence(100), 100);
  assertEquals(parseAiConfidence(72.6), 73);
  for (
    const bad of [-1, 101, NaN, Infinity, "80", "high", null, true, undefined]
  ) {
    assertEquals(parseAiConfidence(bad), undefined, String(bad));
  }
  assertEquals(confidenceBand(CONFIDENCE_BANDS.low - 1), "low");
  assertEquals(confidenceBand(CONFIDENCE_BANDS.low), "medium");
  assertEquals(confidenceBand(CONFIDENCE_BANDS.medium), "high");
  assertEquals(slotReviewFrom(" ", undefined), undefined);
  assertEquals(slotReviewFrom("Guessed path", 40.2), {
    confidence: 40,
    note: "Guessed path",
  });
  assertEquals(slotReviewFrom(undefined, "low"), undefined);
});

Deno.test("envelope: top-level notes/questions and confidence validate, bad confidence warns and is ignored", () => {
  const env = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t" },
    notes: ["Source unit unclear"],
    questions: ["mmHg or kPa?"],
    suggestions: [
      {
        slotId: "t/a",
        block: { type: "source_query", fields: { EXPRESSION: "$.a" } },
        confidence: 42,
      },
      {
        slotId: "t/b",
        block: { type: "source_query", fields: { EXPRESSION: "$.b" } },
        confidence: "high",
      },
      {
        slotId: "t/c",
        block: { type: "source_query", fields: { EXPRESSION: "$.c" } },
        confidence: 140,
      },
    ],
  };
  const issues = validateSuggestionEnvelope(env);
  assertEquals(issues.map((i) => i.path), [
    "$.suggestions[1].confidence",
    "$.suggestions[2].confidence",
  ]);
  assertStringIncludes(issues[0]!.message, "Ignored");
  const parsed = parseSuggestionsPayload(JSON.stringify(env));
  assertEquals(parsed.notes, ["Source unit unclear"]);
  assertEquals(parsed.questions, ["mmHg or kPa?"]);
  assertEquals(parsed.suggestions.map((s) => s.confidence), [
    42,
    undefined,
    undefined,
  ]);
  const view = parseAiAnswerNotes(
    JSON.stringify(env) + "\n\n### Questions\n1. mmHg or kPa?\n2. Keep b?",
  );
  assertEquals(view.notes, ["Source unit unclear"]);
  assertEquals(view.questions.map((q) => q.text), ["mmHg or kPa?", "Keep b?"]);
  assertEquals(view.suggestionNotes, [{
    kind: "suggestion",
    note: "",
    slotId: "t/a",
    confidence: 42,
  }]);
  // A valid envelope with the new fields has no schema issues.
  assertEquals(
    validateSuggestionEnvelope({ ...env, suggestions: [env.suggestions[0]] }),
    [],
  );
});

Deno.test("import stores note + raw confidence on the mapped slot", () => {
  const model = createEmptyModel("t");
  const payload = parseSuggestionsPayload(JSON.stringify({
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t" },
    suggestions: [
      {
        slotId: "t/a",
        block: { type: "source_query", fields: { EXPRESSION: "$.a" } },
        confidence: 35,
        note: "Lossy",
      },
      {
        slotId: "t/b",
        block: { type: "source_query", fields: { EXPRESSION: "$.b" } },
      },
    ],
  }));
  const { model: next } = importSuggestions(
    model,
    payload,
    new Set(["t/a", "t/b"]),
  );
  assertEquals(next.slots.find((s) => s.slotId === "t/a")?.review, {
    confidence: 35,
    note: "Lossy",
  });
  assertEquals(next.slots.find((s) => s.slotId === "t/b")?.review, undefined);
});

Deno.test("import_suggestions call-level note/confidence are defaults only", () => {
  const out = applySuggestionReviewDefaults(FENCE, "Check", 60);
  const env = extractSuggestionsJson(out) as {
    suggestions: Array<{ note?: string; confidence?: number }>;
  };
  assertEquals(env.suggestions.map((s) => [s.note, s.confidence]), [[
    "Assumed mmHg",
    60,
  ], ["Check", 60]]);
  assertEquals(applySuggestionReviewDefaults(FENCE, undefined, "x"), FENCE);
});

// ── Questions with options (#249 review: options rendered as separate questions) ──

const q = (text: string) => parseAiResponseNotes(`### Questions\n${text}`).questions;

Deno.test("questions: flat numbered list — non-question items after a question become its options", () => {
  assertEquals(
    q([
      "1. How should missing `bodyPosition` values be handled during blood pressure event creation?",
      "2. Default to `at1001` (Sitting)",
      "3. Do not map `Position` and rely on null flavor / schema-level omission if allowed by downstream validator",
    ].join("\n")),
    [{
      text: "How should missing `bodyPosition` values be handled during blood pressure event creation?",
      options: [
        { text: "Default to `at1001` (Sitting)" },
        { text: "Do not map `Position` and rely on null flavor / schema-level omission if allowed by downstream validator" },
      ],
    }],
  );
});

Deno.test("questions: nested '- ' sub-bullets with (recommended), then a second question", () => {
  assertEquals(
    q("1. Which unit?\n   - mmHg (recommended)\n   - kPa\n2. Keep the device block?\n   - yes\n   - no"),
    [
      { text: "Which unit?", options: [{ text: "mmHg", recommended: true }, { text: "kPa" }] },
      { text: "Keep the device block?", options: [{ text: "yes" }, { text: "no" }] },
    ],
  );
});

Deno.test("questions: lettered a) / A. options, and unindented '- ' under a numbered question", () => {
  assertEquals(q("1. Position default?\na) Sitting [recommended]\nb) Leave empty."), [
    { text: "Position default?", options: [{ text: "Sitting", recommended: true }, { text: "Leave empty" }] },
  ]);
  assertEquals(q("1. Position default?\n  A. Sitting\n  B. Lying\n2. Cuff size?\n- Adult\n- Child"), [
    { text: "Position default?", options: [{ text: "Sitting" }, { text: "Lying" }] },
    { text: "Cuff size?", options: [{ text: "Adult" }, { text: "Child" }] },
  ]);
});

Deno.test("questions: Swedish heading and (rekommenderas)", () => {
  const parsed = parseAiResponseNotes(
    "**Frågor**\n1. Hur ska saknad kroppsställning hanteras?\n   - Sittande (rekommenderas)\n   - Lämna tomt",
  );
  assertEquals(parsed.questions, [{
    text: "Hur ska saknad kroppsställning hanteras?",
    options: [{ text: "Sittande", recommended: true }, { text: "Lämna tomt" }],
  }]);
});

Deno.test("questions: several real questions, no options, and a non-question item stay separate", () => {
  assertEquals(q("1. mmHg or kPa?\n2. Keep b?").map((x) => x.options.length), [0, 0]);
  // The previous item is not a question, so the heuristic does not apply.
  assertEquals(q("1. Confirm the unit mapping\n2. Leave device empty").length, 2);
  assertEquals(q("- Only one?"), [{ text: "Only one?", options: [] }]);
});

Deno.test("questions in the envelope: string or {text, options}; validate and merge with prose", () => {
  const env = {
    format: "intehrgrator-suggestions",
    version: "2",
    target: { format: "openehr-template", targetId: "t" },
    questions: [
      "Which cuff?",
      { text: "Default position?", options: ["Sitting (recommended)", { text: "Lying" }] },
    ],
    suggestions: [],
  };
  assertEquals(validateSuggestionEnvelope(env), []);
  assertEquals(parseSuggestionsPayload(JSON.stringify(env)).questions, [
    "Which cuff?",
    { text: "Default position?", options: [{ text: "Sitting", recommended: true }, "Lying"] },
  ]);
  const view = parseAiAnswerNotes(`${JSON.stringify(env)}\n\n### Questions\n1. Default position?\n2. New one?`);
  assertEquals(view.questions, [
    { text: "Which cuff?", options: [] },
    { text: "Default position?", options: [{ text: "Sitting", recommended: true }, { text: "Lying" }] },
    { text: "New one?", options: [] },
  ]);
  const bad = validateSuggestionEnvelope({ ...env, questions: [{ options: ["x"] }] });
  assertEquals(bad.length > 0, true, "a question object needs text");
});

Deno.test("prompt texts state the fixed Questions syntax", () => {
  for (const text of [NOTES_CONVENTION, MAPPING_TOOLS_SYSTEM]) {
    assertStringIncludes(text, "sub-bullets");
    assertStringIncludes(text, "(recommended)");
  }
});
