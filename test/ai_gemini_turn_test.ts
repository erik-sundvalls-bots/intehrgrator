/**
 * Regression (#249 preview bug, Gemini 3.x via the OpenAI-compatible endpoint):
 * a loop request in AI chat showed a cut-off "thinking aloud" answer instead
 * of an import. Gemini returns `tool_calls[].extra_content.google.thought_signature`
 * and rejects the next step with 400 unless it comes back; the 400 mentions
 * "tools", so the chat silently fell back to approve-first, whose long answer
 * then hit `max_tokens` (finish_reason "length") with no notice.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  isToolsUnsupportedError,
  postChatCompletions,
} from "@intehrgrator/core/ai/credentials.ts";
import {
  runMappingAgent,
  runSuggestionsChatTurn,
} from "@intehrgrator/core/ai/mapping_agent.ts";
import { extractSuggestionsJson } from "@intehrgrator/core/ai/mod.ts";

const creds = {
  endpoint:
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  apiKey: "test-key",
  model: "gemini-3.8-flash",
};

/** Real Gemini wording for a missing signature (ai.google.dev thought-signatures docs). */
const GEMINI_SIGNATURE_400 =
  `AI call failed (400 Bad Request): [{"error":{"code":400,"message":"Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance. Additional data, function call \`default_api:list_slots\` , position 2. Please refer to https://ai.google.dev/gemini-api/docs/thought-signatures for more details.","status":"INVALID_ARGUMENT"}}]`;

/** Canned answer from the bug report, cut off by max_tokens inside the fence. */
const TRUNCATED = [
  "The loop needs a slot for each previous pregnancy (`openEHR-EHR-COMPOSITION.t_encounter.v1//content/at0.48/items/at0.6` (at0.48 is Previous pregnancies section, and at0.6 is the repeating SECTION for each previous pregnancy).",
  "",
  "Let's look at the structure of `loops` in `AI_SUGGESTION_FORMAT.md`:",
  "",
  "```json",
  "{",
  '  "version": "2",',
  '  "loops": [{"attachSlotId": "openEHR-EHR-COMPOSITION.t_encounter.v1//content/at0.48/items/at0.6", "loopVar": "graviditet", "block": {"type": "for_each_list",',
].join("\n");

type Body = { messages: Array<Record<string, unknown>>; max_tokens?: number };

/** Gemini-shaped stub: step 1 calls a tool with a signature; step 2 checks it and answers truncated. */
function geminiStub(bodies: Body[]): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const assistant = body.messages.filter((m) =>
      m.role === "assistant" && m.tool_calls
    );
    const json = (payload: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          statusText: status === 200 ? "OK" : "Bad Request",
        }),
      );
    if (!assistant.length) {
      return json({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "fc1",
              type: "function",
              function: { name: "list_slots", arguments: "{}" },
              extra_content: { google: { thought_signature: "SIG-1" } },
            }],
          },
        }],
      });
    }
    const call =
      (assistant[0]!.tool_calls as Array<Record<string, unknown>>)[0]!;
    const sig = (call.extra_content as
      | { google?: { thought_signature?: string } }
      | undefined)?.google?.thought_signature;
    if (sig !== "SIG-1") {
      return json(
        JSON.parse(
          GEMINI_SIGNATURE_400.slice(GEMINI_SIGNATURE_400.indexOf("[")),
        ),
        400,
      );
    }
    return json({
      choices: [{
        finish_reason: "length",
        message: { role: "assistant", content: TRUNCATED },
      }],
    });
  }) as typeof fetch;
}

Deno.test("Gemini tools turn: thought_signature is sent back on the tool call", async () => {
  const bodies: Body[] = [];
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "Help me create a loop over M1TidigareGraviditeter",
    executeTool: () => Promise.resolve({ slots: [] }),
    fetch: geminiStub(bodies),
  });
  assertEquals(bodies.length, 2);
  assertEquals(
    bodies[0]!.max_tokens,
    32768,
    "Gemini gets room for thinking + answer",
  );
  assertEquals(result.text, TRUNCATED);
  assertEquals(result.truncated, true, "finish_reason length is reported");
});

Deno.test("a Gemini thought_signature 400 is not mistaken for 'provider has no tools'", () => {
  assertEquals(isToolsUnsupportedError(new Error(GEMINI_SIGNATURE_400)), false);
  assertEquals(
    isToolsUnsupportedError(
      new Error(
        "AI call failed (400 Bad Request): tools are not supported by this model",
      ),
    ),
    true,
  );
});

Deno.test("approve-first: a length-truncated answer is flagged and has no importable envelope", async () => {
  const result = await runSuggestionsChatTurn({
    credentials: creds,
    prompt: "Help me create a loop",
    fetch: (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              finish_reason: "length",
              message: { content: TRUNCATED },
            }],
          }),
        ),
      )) as typeof fetch,
  });
  assertEquals(result.truncated, true);
  assertEquals(
    result.text,
    TRUNCATED,
    "the beginning of the answer is kept verbatim",
  );
  let parsed: unknown = null;
  try {
    parsed = extractSuggestionsJson(result.text);
  } catch {
    parsed = null;
  }
  assertEquals(parsed, null, "an unterminated fence never imports");
});

Deno.test("finish_reason variants: length / MAX_TOKENS / max_tokens are truncation, stop is not", async () => {
  for (
    const [reason, expected] of [["length", true], ["MAX_TOKENS", true], [
      "max_tokens",
      true,
    ], ["stop", false]] as const
  ) {
    const r = await postChatCompletions(
      creds,
      [{ role: "user", content: "x" }],
      {
        fetch: (() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{
                  finish_reason: reason,
                  message: { content: "hi" },
                }],
              }),
            ),
          )) as typeof fetch,
      },
    );
    assertEquals(r.truncated ?? false, expected, reason);
  }
});

Deno.test("tools turn: text sent alongside earlier tool calls is kept in the answer", async () => {
  let step = 0;
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "loop",
    executeTool: () => Promise.resolve({ ok: true }),
    fetch: (() => {
      step++;
      const message = step === 1
        ? {
          role: "assistant",
          content: "First I check slot `at0.6",
          tool_calls: [{
            id: "a",
            type: "function",
            function: { name: "list_slots", arguments: "{}" },
          }],
        }
        : { role: "assistant", content: "` (the repeating SECTION). Done." };
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message }] }),
        ),
      );
    }) as typeof fetch,
  });
  assertStringIncludes(result.text, "First I check slot `at0.6");
  assertStringIncludes(result.text, "` (the repeating SECTION). Done.");
  assert(result.text.indexOf("First") < result.text.indexOf("Done."));
});

Deno.test("tools turn: hitting the step limit is reported", async () => {
  const result = await runMappingAgent({
    credentials: creds,
    prompt: "loop",
    maxSteps: 2,
    executeTool: () => Promise.resolve({ ok: true }),
    fetch: (() =>
      Promise.resolve(
        new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "a",
                type: "function",
                function: { name: "get_snapshot", arguments: "{}" },
              }],
            },
          }],
        })),
      )) as typeof fetch,
  });
  assertEquals(result.stepLimitReached, true);
});

Deno.test("OBX MHV1: the completed loop the model was writing (M1TidigareGraviditeter → at0.6) imports", async () => {
  const { WorkbenchController } = await import("@intehrgrator/workbench/controller.ts");
  const F = new URL("./fixtures/Obstetrix-MHV1/", import.meta.url);
  const read = (p: string) => Deno.readTextFile(new URL(p, F));
  const c = new WorkbenchController({
    pickTextFile: async () => null,
    pickTextFilesFromDirectory: async () => null,
    pickBinaryFile: async () => null,
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: async () => {},
    readClipboard: async () => "",
    saveAutosave: async () => {},
    saveManualSave: async () => {},
    loadStoredProjectRecord: async () => null,
    listLoadableProjects: async () => [],
    resolveAppUrl: (p: string) => p,
    fetchTextUrl: () => Promise.reject(new Error("no")),
  });
  c.loadTemplateContent("t.opt", await read("target/mhv1-prenatal-visit.encounter.v1.opt"));
  c.loadSchemaContent("s.json", await read("source-schema/obx-mhv1.review-1.schema.json"));
  c.addExampleContent("2.json", await read("source-instance/2-ivf-multipara.json"));
  const container = "openEHR-EHR-COMPOSITION.t_encounter.v1//content/at0.48/items/at0.6";
  const envelope = {
    format: "intehrgrator-suggestions",
    version: "2",
    loops: [{
      attachSlotId: container,
      loopVar: "graviditet",
      block: {
        type: "for_each_list",
        fields: { VAR: "graviditet" },
        inputs: {
          LIST: { block: { type: "source_query_node", fields: { EXPRESSION: "$[*].M1TidigareGraviditeter" } } },
        },
      },
    }],
    suggestions: [{
      slotId: `${container}/items/at0.8/data/at0001/items/at0083.1/value/value`,
      loopVar: "graviditet",
      block: { type: "source_query", fields: { EXPRESSION: "Ar" } },
    }],
  };
  const report = c.importAiSuggestions("```intehrgrator-suggestions\n" + JSON.stringify(envelope) + "\n```");
  assertEquals(report.errors, []);
  assertEquals(report.loopsAccepted, 1);
  assertEquals(report.applied, 1);
});
