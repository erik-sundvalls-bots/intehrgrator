/**
 * Shared body of the `go_template_all_sets_parity_*_test.ts` shards.
 *
 * Every catalog Example Set: the Go text/template Conversion Script, executed in
 * the Go WASM runtime, gives the same output as the Handlebars script (the two
 * share one output shape). Guards the Go lowering of every Blockly construct
 * the shipped sets use; see `go_template_block_parity_test.ts` for per-block cases.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import type { TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const catalogPath = join(root, "examples", "example-sets.json");
const catalog = JSON.parse(Deno.readTextFileSync(catalogPath)) as { sets: Array<{ id: string }> };

/** Sets whose Go output is known to differ, with the reason. */
const KNOWN_DIFFERENT: Record<string, string> = {};
/** Sets Go cannot express: generation must fail loudly, never emit a wrong document. */
const LOUD_IN_GO: Record<string, string> = {
  "karda-ordinationsdata-to-openehr-flat": "statement-bodied Function",
  "karda-administreringsdata-to-openehr-flat": "statement-bodied Function",
};

function norm(output: unknown): string {
  if (output == null) return "<null>";
  if (typeof output !== "string") return canon(output);
  const t = output.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return canon(JSON.parse(t));
    } catch {
      return t;
    }
  }
  if (t.startsWith("<")) {
    return t.replace(/<\?xml[^>]*\?>/, "").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
  }
  return t;
}

function canon(value: unknown): string {
  return JSON.stringify(value, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x);
}

async function run(service: WorkbenchService, outputMode: string): Promise<TestResult> {
  const r = await callAgentTool(service, "run_test", { outputMode }) as { testResult: TestResult };
  return r.testResult;
}

/** Register the parity tests for every `shardCount`-th set (round robin keeps shards similar in time). */
export function registerGoParityShard(shard: number, shardCount: number): void {
  catalog.sets.forEach((set, i) => {
    if (i % shardCount !== shard || KNOWN_DIFFERENT[set.id]) return;
    registerSet(set.id);
  });
}

function registerSet(setId: string): void {
  Deno.test(`Go template equals Handlebars on every example: ${setId}`, async () => {
    await ensureGoTemplateWasm();
    const service = new WorkbenchService();
    await callAgentTool(service, "register_agent", { agentId: "go-parity", displayName: "go-parity" });
    await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
    const { examples } = await callAgentTool(service, "list_examples", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    assert(examples.length > 0, `${setId} has examples`);
    for (const example of examples) {
      await callAgentTool(service, "set_active_example", { id: example.id });
      const go = await run(service, "go-template");
      const label = `${setId} / ${example.filename}`;
      const loud = LOUD_IN_GO[setId];
      if (loud) {
        assertEquals(go.ok, false, `${label}: Go must fail loudly`);
        assertStringIncludes(String(go.error), loud, label);
        continue;
      }
      assertEquals(go.error, undefined, `${label}: ${go.error}`);
      const hbs = await run(service, "handlebars");
      assertEquals(hbs.ok, true, `${label}: Handlebars ${hbs.error}`);
      assertEquals(norm(go.output), norm(hbs.output), label);
    }
  });
}
