/**
 * Measure the tokens AI chat sends (#252): copy & paste prompt contexts, the
 * first Send request (system + tools + compact `api` context), and request
 * growth over a scripted two-turn tool run, for the blood-pressure (bp) and
 * Obstetrix MHV1 (obx) fixtures.
 *
 *   deno run -A scripts/measure_ai_tokens.ts            # exact o200k_base counts (js-tiktoken from npm)
 *   deno run -A scripts/measure_ai_tokens.ts --estimate # offline: characters / 3
 *
 * No AI is called: requests go to a stub fetch that scripts the answers.
 */
import { join } from "@std/path";
import { WorkbenchController } from "../src/workbench/controller.ts";
import type { HostAdapter } from "../src/host/mod.ts";
import { LocalAgentClient } from "../src/agent/client.ts";
import { WorkbenchService } from "../src/workbench/service.ts";

const executeMappingAgentTool = (c: WorkbenchController, name: string, args: Record<string, unknown>) =>
  new LocalAgentClient(new WorkbenchService({ controller: c })).callTool(name, args);
import { runMappingAgent } from "../src/core/ai/mapping_agent.ts";
import { PROJECT_CONTEXT_HEADING } from "../src/ui/ai_chat_panel.ts";

const ROOT = join(import.meta.dirname!, "..", "test", "fixtures");
const SCENARIOS = {
  bp: {
    target: join(ROOT, "blood_pressure.opt"),
    schema: join(ROOT, "dummy-json-vitals", "source.schema.json"),
    example: join(ROOT, "dummy-json-vitals", "instance-1.json"),
  },
  obx: {
    target: join(ROOT, "Obstetrix-MHV1", "target", "mhv1-prenatal-visit.encounter.v1.opt"),
    schema: join(ROOT, "Obstetrix-MHV1", "source-schema", "obx-mhv1.review-1.schema.json"),
    example: join(ROOT, "Obstetrix-MHV1", "source-instance", "2-ivf-multipara.json"),
  },
} as const;

async function tokenCounter(estimate: boolean): Promise<{ count: (text: string) => number; label: string }> {
  if (!estimate) {
    try {
      // Variable specifiers keep this optional dependency out of `deno check` / the lockfile graph.
      const lite = "npm:js-tiktoken@1.0.21/lite";
      const ranks = "npm:js-tiktoken@1.0.21/ranks/o200k_base";
      const { Tiktoken } = await import(lite);
      const o200k = (await import(ranks)).default;
      const enc = new Tiktoken(o200k);
      return { count: (text) => enc.encode(text).length, label: "o200k_base (exact)" };
    } catch (err) {
      console.error(`js-tiktoken unavailable (${err instanceof Error ? err.message : err}); estimating`);
    }
  }
  return { count: (text) => Math.ceil(text.length / 3), label: "estimate (chars / 3)" };
}

function stubHost(): HostAdapter {
  return {
    pickTextFile: () => Promise.resolve(null),
    pickTextFilesFromDirectory: () => Promise.resolve(null),
    pickBinaryFile: () => Promise.resolve(null),
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: () => Promise.resolve(),
    readClipboard: () => Promise.resolve(""),
    saveAutosave: () => Promise.resolve(),
    saveManualSave: () => Promise.resolve(),
    loadStoredProjectRecord: () => Promise.resolve(null),
    listLoadableProjects: () => Promise.resolve([]),
    resolveAppUrl: (path: string) => `https://regionstockholm.github.io/intehrgrator/${path}`,
    fetchTextUrl: () => Promise.reject(new Error("offline")),
  } as unknown as HostAdapter;
}

async function load(sc: { target: string; schema: string; example: string }): Promise<WorkbenchController> {
  const c = new WorkbenchController(stubHost());
  c.loadTemplateContent(sc.target.split("/").pop()!, await Deno.readTextFile(sc.target));
  c.loadSchemaContent(sc.schema.split("/").pop()!, await Deno.readTextFile(sc.schema));
  c.addExampleContent(sc.example.split("/").pop()!, await Deno.readTextFile(sc.example));
  return c;
}

const creds = { endpoint: "https://measure.invalid/v1/chat/completions", apiKey: "k", model: "m" };

/** Run one scripted agent turn; returns every request body sent. */
async function scriptedTurn(
  c: WorkbenchController,
  prompt: string,
  script: Array<Array<{ name: string; args: Record<string, unknown> }> | null>,
  history?: Parameters<typeof runMappingAgent>[0]["history"],
) {
  const bodies: string[] = [];
  let step = 0;
  const fetchStub = ((_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    const calls = script[step++] ?? null;
    const message = calls
      ? {
        role: "assistant",
        content: null,
        tool_calls: calls.map((call, i) => ({
          id: `c${step}_${i}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      }
      : { role: "assistant", content: "Mapped what I could; test ran." };
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 }));
  }) as typeof fetch;
  const result = await runMappingAgent({
    credentials: creds,
    prompt,
    history,
    executeTool: (name, args) => executeMappingAgentTool(c, name, args),
    fetch: fetchStub,
  });
  return { bodies, result };
}

if (import.meta.main) {
  const tok = await tokenCounter(Deno.args.includes("--estimate"));
  const rows: Array<[string, string, number]> = [];
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    const c = await load(sc);
    for (const d of ["inline", "attach", "uri", "api"] as const) {
      rows.push([name, `context ${d}`, tok.count(c.buildAiPromptText(d))]);
    }
    // First Send request: what the browser POSTs (system, tools, user + api context).
    const first = await scriptedTurn(c, `Map the source\n\n${PROJECT_CONTEXT_HEADING}\n\n${c.buildAiPromptText("api")}`, [null]);
    rows.push([name, "first Send request (api)", tok.count(first.bodies[0]!)]);
    // Same request with the copy & paste inline context, as Send used before #252.
    const legacy = await scriptedTurn(
      c,
      `Map the source\n\n${PROJECT_CONTEXT_HEADING}\n\n${c.buildAiPromptText("inline")}`,
      [null],
    );
    rows.push([name, "first Send request (inline context, pre-#252)", tok.count(legacy.bodies[0]!)]);

    // Growth: list_slots + get_source_tree, three map_slot, run_test, list_slots again, answer.
    const c2 = await load(sc);
    const slots = ((await executeMappingAgentTool(c2, "list_slots", { unmappedOnly: true })) as {
      slots: Array<{ slotId: string }>;
    }).slots.slice(0, 3);
    const turn1 = await scriptedTurn(
      c2,
      `Map the source\n\n${PROJECT_CONTEXT_HEADING}\n\n${c2.buildAiPromptText("api")}`,
      [
        [{ name: "list_slots", args: {} }, { name: "get_source_tree", args: {} }],
        slots.map((s) => ({ name: "map_slot", args: { slotId: s.slotId, path: "$.systolic" } })),
        [{ name: "run_test", args: {} }],
        [{ name: "list_slots", args: { unmappedOnly: true } }],
        null,
      ],
    );
    rows.push([name, "turn 1 last request (5 steps)", tok.count(turn1.bodies.at(-1)!)]);
    const turn2 = await scriptedTurn(c2, "Thanks, what is left?", [null], turn1.result.messages);
    rows.push([name, "turn 2 request", tok.count(turn2.bodies[0]!)]);
  }
  // Multilingual target (#252 languages criterion): the api context carries no
  // OPT text, only slot labels in the model language.
  for (
    const [name, file] of [
      ["simple-diagnose-and-vitals.opt (de/en/sv)", join(ROOT, "simple-diagnose-and-vitals.opt")],
    ] as const
  ) {
    const c = new WorkbenchController(stubHost());
    c.loadTemplateContent(file.split("/").pop()!, await Deno.readTextFile(file));
    rows.push([name, "target file", tok.count(await Deno.readTextFile(file))]);
    rows.push([name, "context inline", tok.count(c.buildAiPromptText("inline"))]);
    rows.push([name, "context api", tok.count(c.buildAiPromptText("api"))]);
  }
  console.log(`Tokens: ${tok.label}\n`);
  console.log("| fixture | measure | tokens |\n|---|---|---:|");
  for (const [fixture, what, n] of rows) console.log(`| ${fixture} | ${what} | ${n.toLocaleString("en-US")} |`);
}
