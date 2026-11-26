/**
 * Patient-reported chemo symptoms → TakeCare XML in every Conversion script language (#386).
 *
 * The chemo Example Sets once held each production `<Note>` as raw Go
 * `text/template` source in a Code text block. Go ran it; Mapping preview,
 * Handlebars, TypeScript and XQuery printed the Go source as the Note. The
 * Notes are now ordinary blocks plus the `clean_free_text` Function, so every
 * runnable language must give the same keywords, and they must match the
 * Notes the production Go script wrote.
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import { ensureXQueryRuntime } from "@intehrgrator/core/codegen/run_xquery.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { JAVA_XML_TREE_UNSUPPORTED } from "@intehrgrator/core/codegen/java.ts";
import {
  codeTextExpression,
  GO_TEMPLATE_CODE_TEXT_UNSUPPORTED,
} from "@intehrgrator/core/output/code_text.ts";
import type { OutputMode, TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const SETS = ["chemo-symptoms-flat-to-tc-xml", "chemo-symptoms-flat-to-tc-xml-decision-tables"];
const FIXTURES = [
  "test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json",
  "test/fixtures/patient-reported-chemotherapy-symptoms-decision-tables/mapping/mapping.blockly.json",
];
const MODES: OutputMode[] = ["preview", "handlebars", "typescript", "xquery", "go-template"];

/** Notes the production Go script (mappningsscript-1-9-1-prod) wrote for 3-ex-composition-full. */
const PROD_NOTES_FULL: Record<string, string> = {
  "2811": "Måttlig trötthet, vilar mindre än 50% av vaken tid.",
  "7643":
    'Svåra besvär, svårt att röra sig. Patientens kommentar angående lokalisation: "hela kroppen känns det som".',
  "7570": "Svåra nagelbesvär, t.ex. avlossning av nagel, helt eller delvis.",
  "5464": "Ökad aptit. Minskat matintag.",
  "1875":
    'Diarré mer än 6 ggr/dag. Upplever smärta i samband med diarréer. Patientens kommentar angående egen behandling: "plommon". Upplever besvär med förstoppning. Patientens kommentar angående egen behandling: "juice".',
  "2310":
    'Ihållande, svåra stickningar/pirrningar/domningar med svår känselnedsättning. Symptomen uppstod i samband med kyla. Patientens kommentar angående lokalisation: "ryggen". Antal dagar med symptom: 8. Upplever sig fumlig. Kan ej knäppa knappar. Kan ej skriva sitt namn. Svårigheter att gå och hålla balansen.',
  "14768":
    'Förvärrade symptom: "svullnaden". Ytterligare biverkningar: "migrän". Frågor angående behandlingen: "ska jag få behandling?".',
  "2025":
    "Har haft en kroppstemperatur över 38 C senaste dygnet. Uppmätt kroppstemperatur senaste dygnet: 39 C",
  "3484": "Patienten anger att kroppsvikten har ökat. Rapporterad kroppsvikt: 60kg",
};

type Keyword = { termId: string; note: string };

function xmlText(raw: string): string {
  return raw.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#xA;|&#10;/g, "\n").replace(/&amp;/g, "&");
}

/** TermId + Note per Text/Numeric keyword, from TakeCare XML or the TypeScript object form. */
function keywords(output: unknown): Keyword[] {
  const out: Keyword[] = [];
  if (typeof output === "string" && output.trimStart().startsWith("<")) {
    const re =
      /<(TextKeyWord|NumericKeyword)>[\s\S]*?<TermId>\s*([^<]*?)\s*<\/TermId>[\s\S]*?<Note>([\s\S]*?)<\/Note>[\s\S]*?<\/\1>/g;
    for (const m of output.matchAll(re)) out.push({ termId: m[2]!, note: xmlText(m[3]!).trim() });
  } else {
    const doc = (typeof output === "string" ? JSON.parse(output) : output) as {
      Keywords?: {
        TextKeywords?: { TextKeyWord?: unknown };
        NumericKeywords?: { NumericKeyword?: unknown };
      };
    };
    for (const list of [doc.Keywords?.TextKeywords?.TextKeyWord, doc.Keywords?.NumericKeywords?.NumericKeyword]) {
      for (const item of Array.isArray(list) ? list : list == null ? [] : [list]) {
        const row = item as { TermId?: unknown; Note?: unknown };
        out.push({ termId: String(row.TermId ?? ""), note: String(row.Note ?? "").trim() });
      }
    }
  }
  return out.sort((a, b) => a.termId.localeCompare(b.termId));
}

function text(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

async function run(service: WorkbenchService, outputMode: OutputMode): Promise<TestResult> {
  const tested = await callAgentTool(service, "run_test", { outputMode }) as { testResult: TestResult };
  return tested.testResult;
}

/** Runs every mode on the active example; returns the first mode's keywords and collects mismatches. */
async function compareModes(service: WorkbenchService, label: string, failures: string[]): Promise<Keyword[]> {
  let expected: Keyword[] | null = null;
  for (const mode of MODES) {
    const result = await run(service, mode);
    if (result.error || !result.ok) {
      failures.push(`${label} ${mode}: ${result.error ?? text(result.output).slice(0, 300)}`);
      continue;
    }
    const body = text(result.output);
    if (body.includes("{{")) failures.push(`${label} ${mode}: template source leaked into the output`);
    if (body.includes("index .Data")) failures.push(`${label} ${mode}: Go source leaked into the output`);
    const actual = keywords(result.output);
    if (!expected) {
      expected = actual;
      continue;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${label} ${mode}: keywords differ from ${MODES[0]}\nexpected=${JSON.stringify(expected)}\nactual=${
          JSON.stringify(actual)
        }`,
      );
    }
  }
  return expected ?? [];
}

Deno.test("chemo mapped sets hold no Go template Code text", () => {
  for (const rel of FIXTURES) {
    const raw = Deno.readTextFileSync(join(root, rel));
    assert(!raw.includes('"go-template"'), `${rel}: go-template Code text`);
    assert(!/index \.Data|\{\{-? ?(if|template|define)\b/.test(raw), `${rel}: Go template syntax`);
    assertStringIncludes(raw, '"clean_free_text"');
  }
});

Deno.test("chemo mapped sets: every language gives the same Notes as the production Go script", async () => {
  await ensureXQueryRuntime();
  await ensureGoTemplateWasm();
  const failures: string[] = [];
  for (const setId of SETS) {
    const service = new WorkbenchService();
    await callAgentTool(service, "register_agent", { agentId: `chemo-${setId}`, displayName: setId });
    await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    assert(tree.examples.length >= 6, `${setId} examples`);
    for (const ex of tree.examples) {
      await callAgentTool(service, "set_active_example", { id: ex.id });
      const found = await compareModes(service, `${setId} ${ex.filename}`, failures);
      assert(found.some((k) => k.termId === "13700"), `${setId} ${ex.filename}: document id keyword`);
      if (ex.filename === "3-ex-composition-full.txt") {
        const byId = Object.fromEntries(found.map((k) => [k.termId, k.note]));
        for (const [termId, note] of Object.entries(PROD_NOTES_FULL)) {
          if (byId[termId] !== note) {
            failures.push(`${setId} full ${termId}: ${JSON.stringify(byId[termId])} != PROD ${JSON.stringify(note)}`);
          }
        }
      }
      if (ex.filename === "6-ex-composition-nightly.txt") {
        assertEquals(found.map((k) => k.termId), ["13700", "16183"], `${setId} nightly: no-symptom branch`);
      }
    }
    // Java cannot build this XML tree; it says so instead of dropping keywords.
    const java = await callAgentTool(service, "generate_script", { language: "java" }) as { code: string };
    assertStringIncludes(java.code, JAVA_XML_TREE_UNSUPPORTED);
  }
  assertEquals(failures, [], failures.join("\n\n"));
});

Deno.test("chemo clean_free_text: newlines, odd characters and spaces agree in every language", async () => {
  await ensureXQueryRuntime();
  await ensureGoTemplateWasm();
  const full = Deno.readTextFileSync(
    join(root, "test/fixtures/patient-reported-chemotherapy-symptoms/source-instance/3-ex-composition-full.txt"),
  );
  const doc = JSON.parse(full.slice(full.indexOf("{"), full.lastIndexOf("}") + 1)) as {
    Data: Record<string, unknown>;
  };
  const key = Object.keys(doc.Data).find((k) => k.endsWith("/svullnad/följdfråga_2/var_på_kroppen_är_du_svullen"));
  assert(key, "swelling location key");
  doc.Data[key] = '  a<b & "c"\n\tµ  \u{1F600} ok  ';
  const failures: string[] = [];
  for (const setId of SETS) {
    const service = new WorkbenchService();
    await callAgentTool(service, "register_agent", { agentId: `chemo-clean-${setId}`, displayName: setId });
    await callAgentTool(service, "load_example_set", { catalogPath, setId, includeMapping: true });
    const added = await callAgentTool(service, "add_example", {
      filename: "clean-free-text.json",
      content: JSON.stringify(doc),
    }) as { examples: Array<{ id: string; filename: string }> };
    const ex = added.examples.find((e) => e.filename === "clean-free-text.json");
    assert(ex, "synthetic example");
    await callAgentTool(service, "set_active_example", { id: ex.id });
    const found = await compareModes(service, `${setId} clean-free-text`, failures);
    const swelling = found.find((k) => k.termId === "7643")?.note;
    const want = 'Svåra besvär, svårt att röra sig. Patientens kommentar angående lokalisation: "a<b & "c" µ ok".';
    if (swelling !== want) failures.push(`${setId}: swelling note ${JSON.stringify(swelling)}`);
  }
  assertEquals(failures, [], failures.join("\n\n"));
});

Deno.test("Code text with Go template source fails loudly instead of leaking (#386)", () => {
  assertThrows(
    () => codeTextExpression('{{ index .Data "a" }}', "go-template"),
    Error,
    GO_TEMPLATE_CODE_TEXT_UNSUPPORTED,
  );
  assertEquals(codeTextExpression("plain words", "go-template"), '"plain words"');
});
