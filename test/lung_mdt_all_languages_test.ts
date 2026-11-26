/**
 * Lung MDT → TakeCare XML in every Conversion script language.
 *
 * The mapped lung-MDT Example Sets keep branching Notes as nested Code text
 * (LANG=handlebars), path guards as Include when, and (decision-table sibling)
 * VMS-Mustache Decision table snippets. Mapping preview and Handlebars Output
 * evaluated them; TypeScript, XQuery and Go template used to print the
 * Handlebars source verbatim, leave `null` for omitted keywords, or fail.
 * Every runnable language must now produce the same keywords as Handlebars.
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { parseExpression } from "@intehrgrator/core/expression/mod.ts";
import { emitGoExpr, goQuote } from "@intehrgrator/core/codegen/go_template.ts";
import { JAVA_XML_TREE_UNSUPPORTED } from "@intehrgrator/core/codegen/java.ts";
import type { OutputMode, TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const SETS = ["lung-mdt-form-to-tc-xml", "lung-mdt-form-to-tc-xml-decision-tables"];
const RUNNABLE: OutputMode[] = ["preview", "typescript", "xquery", "go-template"];

type Keyword = { kind: string; termId: string; note: string };

function xmlText(raw: string): string {
  return raw.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** TermId + Note per keyword, from TakeCare XML or the TypeScript object form. */
function keywords(output: unknown): Keyword[] {
  const out: Keyword[] = [];
  if (typeof output === "string" && output.trimStart().startsWith("<")) {
    const re = /<(TextKeyWord|DatetimeKeyword)>[\s\S]*?<TermId>\s*([^<]*?)\s*<\/TermId>[\s\S]*?<Note>([\s\S]*?)<\/Note>[\s\S]*?<\/\1>/g;
    for (const m of output.matchAll(re)) out.push({ kind: m[1]!, termId: m[2]!, note: xmlText(m[3]!) });
  } else {
    const doc = (typeof output === "string" ? JSON.parse(output) : output) as {
      Keywords?: {
        TextKeywords?: { TextKeyWord?: unknown };
        DatetimeKeywords?: { DatetimeKeyword?: unknown };
      };
    };
    const lists: Array<[string, unknown]> = [
      ["TextKeyWord", doc.Keywords?.TextKeywords?.TextKeyWord],
      ["DatetimeKeyword", doc.Keywords?.DatetimeKeywords?.DatetimeKeyword],
    ];
    for (const [kind, list] of lists) {
      for (const item of Array.isArray(list) ? list : list == null ? [] : [list]) {
        assert(item != null, `${kind} list holds null: ${JSON.stringify(list)}`);
        const row = item as { TermId?: unknown; Note?: unknown };
        out.push({ kind, termId: String(row.TermId ?? ""), note: String(row.Note ?? "") });
      }
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.termId.localeCompare(b.termId));
}

function text(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

async function run(service: WorkbenchService, outputMode: OutputMode): Promise<TestResult> {
  const tested = await callAgentTool(service, "run_test", { outputMode }) as { testResult: TestResult };
  return tested.testResult;
}

Deno.test("lung-MDT mapped sets: every runnable language matches Handlebars keywords", async () => {
  await ensureXQueryRuntime();
  await ensureGoTemplateWasm();
  const failures: string[] = [];
  for (const setId of SETS) {
    const service = new WorkbenchService();
    await callAgentTool(service, "register_agent", { agentId: `lung-${setId}`, displayName: setId });
    await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    assert(tree.examples.length >= 2, `${setId} examples`);
    for (const ex of tree.examples) {
      await callAgentTool(service, "set_active_example", { id: ex.id });
      const hbs = await run(service, "handlebars");
      assertEquals(hbs.error, undefined, `${setId} ${ex.filename} handlebars: ${hbs.error}`);
      const expected = keywords(hbs.output);
      assert(expected.length >= 6, `${setId} ${ex.filename}: Handlebars keywords ${expected.length}`);
      for (const mode of RUNNABLE) {
        const label = `${setId} ${ex.filename} ${mode}`;
        const result = await run(service, mode);
        if (result.error || !result.ok) {
          failures.push(`${label}: ${result.error ?? text(result.output).slice(0, 300)}`);
          continue;
        }
        const body = text(result.output);
        if (body.includes("{{")) failures.push(`${label}: Handlebars source leaked into the output`);
        if (/\bnull\b/.test(body)) failures.push(`${label}: null in the output`);
        try {
          const actual = keywords(result.output);
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            failures.push(`${label}: keywords differ\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`);
          }
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    // Java cannot run in the app; its slot map would drop 16 of 17 keywords, so it says so.
    const java = await callAgentTool(service, "generate_script", { language: "java" }) as { code: string };
    assertStringIncludes(java.code, "UnsupportedOperationException");
    assertStringIncludes(java.code, JAVA_XML_TREE_UNSUPPORTED);
  }
  assertEquals(failures, [], failures.join("\n\n"));
});

Deno.test("Mapping Expression string literals decode JSON escapes (Code text newlines)", () => {
  const ast = parseExpression(JSON.stringify("a\nb\t\"c\" \\ \u00e9"));
  assertEquals(ast, { kind: "literal", value: "a\nb\t\"c\" \\ \u00e9" });
});

Deno.test("Go template: quoted literals escape newlines; quantifiers unroll or fail loudly", () => {
  assertEquals(goQuote("a\nb"), '"a\\nb"');
  const anyOf = emitGoExpr(parseExpression('any_of(list(xpathString("$.a"), xpathString("$.b")), "item", var("item"))'));
  assertEquals(anyOf, '(or (index .Data "a") (index .Data "b"))');
  assertThrows(
    () => emitGoExpr(parseExpression('any_of(xpathNode("$.list"), "item", var("item"))')),
    Error,
    "Go templates do not support any_of over a computed list",
  );
  assertThrows(() => emitGoExpr(parseExpression('union(list(), list())')), Error, "Go templates do not support union");
});
