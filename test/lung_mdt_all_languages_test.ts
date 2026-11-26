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
import { namedMapsFromBlocklyState } from "@intehrgrator/core/defaults/mod.ts";
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
    // Java builds the XML with StAX; it runs in the JVM test below, not in the app.
    const java = await callAgentTool(service, "generate_script", { language: "java" }) as { code: string };
    assertStringIncludes(java.code, "javax.xml.stream.XMLStreamWriter");
    assert(!java.code.includes("UnsupportedOperationException"), `${setId}: Java must not refuse the canvas`);
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
  // Each item is a real boolean, as TypeScript's `.some(...)`.
  assertEquals(anyOf, '(or (ifElse (index .Data "a") true false) (ifElse (index .Data "b") true false))');
  assertThrows(
    () => emitGoExpr(parseExpression('any_of(xpathNode("$.list"), "item", var("item"))')),
    Error,
    "Go templates do not support any_of over a computed list",
  );
  assertThrows(() => emitGoExpr(parseExpression('union(list(), list())')), Error, "Go templates do not support union");
});

// --- Java (StAX) on a JVM -------------------------------------------------
//
// Java Output mode does not run in the web app. This test compiles the
// generated ConversionScript with the runtime helpers and runs it on every
// example. CI sets up a JDK (actions/setup-java) and must run it; locally it
// is skipped when there is no javac 21.

const MAVEN = "https://repo1.maven.org/maven2";
const JAVA_JARS = [
  "com/github/jknack/handlebars/4.4.0/handlebars-4.4.0.jar",
  "org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar",
  "org/apache/commons/commons-text/1.11.0/commons-text-1.11.0.jar",
  "org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar",
  "org/slf4j/slf4j-nop/2.0.12/slf4j-nop-2.0.12.jar",
  "com/fasterxml/jackson/core/jackson-databind/2.22.2/jackson-databind-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-core/2.22.2/jackson-core-2.22.2.jar",
  "com/fasterxml/jackson/core/jackson-annotations/2.22/jackson-annotations-2.22.jar",
];

async function javac21(): Promise<boolean> {
  try {
    const out = await new Deno.Command("javac", { args: ["--release", "21", "-version"], stdout: "piped", stderr: "piped" })
      .output();
    return out.success;
  } catch {
    return false;
  }
}

async function fetchJavaJars(dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const jar of JAVA_JARS) {
    const dest = join(dir, jar.slice(jar.lastIndexOf("/") + 1));
    const res = await fetch(`${MAVEN}/${jar}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${jar}`);
    await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
    paths.push(dest);
  }
  return paths;
}

const JAVA_MAIN = `import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import se.regionstockholm.intehrgrator.generated.ConversionScript;
import se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime.Sheet;

/** args: defaults.json sheets.json (source.json out.xml)... */
public class LungMain {
  public static void main(String[] args) throws Exception {
    ObjectMapper json = new ObjectMapper();
    @SuppressWarnings("unchecked")
    Map<String, Object> defaults = json.readValue(Files.readString(Path.of(args[0])), Map.class);
    Map<String, Sheet> sheets = Sheet.mapFromJson(Files.readString(Path.of(args[1])));
    for (int i = 2; i + 1 < args.length; i += 2) {
      JsonNode source = json.readTree(Files.readString(Path.of(args[i])));
      Object out = new ConversionScript().convert(source, defaults, sheets);
      Files.writeString(Path.of(args[i + 1]), String.valueOf(out));
    }
  }
}
`;

/** Whitespace between tags and empty-element spellings do not matter; text does. */
function normalizeXml(xml: string): string {
  return xml.replace(/^<\?xml[^>]*\?>/, "").replace(/>\s+</g, "><").replace(/<([A-Za-z_][\w.-]*)([^<>]*?)\/>/g, "<$1$2></$1>")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").trim();
}

Deno.test({
  name: "lung-MDT mapped sets: generated Java (StAX) on a JVM matches Handlebars on every example",
  sanitizeResources: false,
  async fn() {
    if (!(await javac21())) {
      if (Deno.env.get("CI") === "true") throw new Error("CI must provide javac 21 (actions/setup-java)");
      console.warn("skip: no javac 21 on PATH");
      return;
    }
    const dir = await Deno.makeTempDir({ prefix: "intehrgrator-lung-java-" });
    const lib = join(dir, "lib");
    await Deno.mkdir(lib);
    const cp = (await fetchJavaJars(lib)).join(":");
    const helperRoot = join(root, "src", "core", "codegen", "helpers", "java");
    const failures: string[] = [];
    const results: string[] = [];
    for (const setId of SETS) {
      const service = new WorkbenchService();
      await callAgentTool(service, "register_agent", { agentId: `java-${setId}`, displayName: setId });
      await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
      const tree = await callAgentTool(service, "get_source_tree", {}) as {
        examples: Array<{ id: string; filename: string }>;
      };
      const java = await callAgentTool(service, "generate_script", { language: "java" }) as { code: string };
      // Same defaults map the in-app Test Run uses (the canvas's `defaults` map).
      const bundle = service.exportBundle() as { mapping?: { blocklyState?: unknown } };
      const defaults = namedMapsFromBlocklyState(bundle.mapping?.blocklyState).defaults ?? {};
      assert(Object.keys(defaults).length > 0, `${setId}: canvas defaults map`);
      const work = join(dir, setId);
      const runtimeDir = join(work, "src", "se", "regionstockholm", "intehrgrator", "runtime");
      const generatedDir = join(work, "src", "se", "regionstockholm", "intehrgrator", "generated");
      await Deno.mkdir(runtimeDir, { recursive: true });
      await Deno.mkdir(generatedDir, { recursive: true });
      for (const file of ["IntehrgratorRuntime.java", "HandlebarsSupport.java"]) {
        await Deno.copyFile(join(helperRoot, file), join(runtimeDir, file));
      }
      await Deno.writeTextFile(join(generatedDir, "ConversionScript.java"), java.code);
      await Deno.writeTextFile(join(work, "src", "LungMain.java"), JAVA_MAIN);
      await Deno.writeTextFile(join(work, "defaults.json"), JSON.stringify(defaults));
      await Deno.writeTextFile(join(work, "sheets.json"), JSON.stringify(service.getSheets().sheets ?? []));
      const classes = join(work, "classes");
      const compiled = await new Deno.Command("javac", {
        args: [
          "--release", "21", "-nowarn", "-cp", cp, "-d", classes,
          join(runtimeDir, "IntehrgratorRuntime.java"),
          join(runtimeDir, "HandlebarsSupport.java"),
          join(generatedDir, "ConversionScript.java"),
          join(work, "src", "LungMain.java"),
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(compiled.success, `${setId}: javac failed\n${new TextDecoder().decode(compiled.stderr)}`);

      const expected = new Map<string, string>();
      const runArgs = [join(work, "defaults.json"), join(work, "sheets.json")];
      for (const ex of tree.examples) {
        await callAgentTool(service, "set_active_example", { id: ex.id });
        const hbs = await run(service, "handlebars");
        assertEquals(hbs.error, undefined, `${setId} ${ex.filename} handlebars: ${hbs.error}`);
        expected.set(ex.filename, text(hbs.output));
        const content = service.getExampleState().activeExample?.content;
        assert(typeof content === "string", `${setId} ${ex.filename}: example content`);
        await Deno.writeTextFile(join(work, `${ex.filename}.source.json`), content);
        runArgs.push(join(work, `${ex.filename}.source.json`), join(work, `${ex.filename}.java.xml`));
      }
      const ran = await new Deno.Command("java", {
        args: ["-cp", `${classes}:${cp}`, "LungMain", ...runArgs],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(ran.success, `${setId}: java failed\n${new TextDecoder().decode(ran.stderr)}`);
      for (const ex of tree.examples) {
        const label = `${setId} ${ex.filename} java`;
        const actual = await Deno.readTextFile(join(work, `${ex.filename}.java.xml`));
        const wanted = expected.get(ex.filename)!;
        if (actual.includes("{{")) failures.push(`${label}: Handlebars source leaked into the output`);
        if (/\bnull\b/.test(actual)) failures.push(`${label}: null in the output`);
        if (JSON.stringify(keywords(actual)) !== JSON.stringify(keywords(wanted))) {
          failures.push(`${label}: keywords differ\nexpected=${JSON.stringify(keywords(wanted))}\nactual=${JSON.stringify(keywords(actual))}`);
        } else if (normalizeXml(actual) !== normalizeXml(wanted)) {
          failures.push(`${label}: XML differs\nexpected=${normalizeXml(wanted)}\nactual=${normalizeXml(actual)}`);
        } else {
          results.push(`${label}: ${keywords(actual).length} keywords, XML equal to Handlebars`);
        }
      }
    }
    console.log(results.join("\n"));
    assertEquals(failures, [], failures.join("\n\n"));
  },
});
