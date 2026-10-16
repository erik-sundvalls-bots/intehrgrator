/**
 * #70 sibling Example Sets: lung-MDT Handlebars and chemo Go, Decision tables
 * with VMS-Mustache snippets. Gold directories stay untouched.
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import {
  assertVmsMustacheSnippets,
  chemoDecisionSheets,
  lungMdtDecisionSheets,
} from "../scripts/decision_table_example_sheets.ts";
import { ensureGoTemplateWasm, executeGoTemplate } from "@intehrgrator/core/output/go_template_runtime.ts";
import { renderHandlebars } from "@intehrgrator/core/output/handlebars_dialect.ts";
import { renderXmlCanvasFromBlockly } from "@intehrgrator/core/output/canvas_xml_runtime.ts";
import { createSourceContext } from "@intehrgrator/core/source/query_runtime.ts";
import type { SheetDocument } from "@intehrgrator/core/sheets/types.ts";
import {
  executeEnvelopeParameters,
  parseJsonDocument,
  unwrapExecuteEnvelope,
} from "@intehrgrator/core/source/json_document.ts";
import type { OutputMode, TestResult } from "@intehrgrator/types/mod.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");
const fixtures = join(root, "test", "fixtures");

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function keywordPairs(xml: string): Array<{ termId: string; note: string }> {
  const pairs: Array<{ termId: string; note: string }> = [];
  // PROD inserts `<!-- … -->` between <TextKeyWord> and <TermId>.
  const re =
    /<TextKeyWord>(?:[\s\S]*?)<TermId>\s*([^<]*?)\s*<\/TermId>(?:[\s\S]*?)<Note>([\s\S]*?)<\/Note>[\s\S]*?<\/TextKeyWord>/gi;
  for (const match of xml.matchAll(re)) {
    pairs.push({ termId: match[1]!.trim(), note: normalizeWs(match[2] ?? "") });
  }
  return pairs.sort((a, b) => a.termId.localeCompare(b.termId) || a.note.localeCompare(b.note));
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output ?? "");
  }
}

async function runMapped(
  setId: string,
  outputMode: OutputMode,
  filename?: string,
): Promise<TestResult> {
  const service = new WorkbenchService();
  await callAgentTool(service, "register_agent", {
    agentId: `issue-70-${setId}`,
    displayName: `Issue 70 ${setId}`,
  });
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId,
    includeMapping: true,
  });
  if (filename) {
    const tree = await callAgentTool(service, "get_source_tree", {}) as {
      examples: Array<{ id: string; filename: string }>;
    };
    const hit = tree.examples.find((ex) => ex.filename === filename);
    if (!hit) throw new Error(`${setId} missing ${filename}`);
    await callAgentTool(service, "set_active_example", { id: hit.id });
  }
  if (outputMode === "go-template") await ensureGoTemplateWasm();
  const tested = await callAgentTool(service, "run_test", { outputMode }) as {
    testResult: TestResult;
  };
  return tested.testResult;
}

Deno.test("#70 sibling Decision table snippets are VMS-Mustache only", () => {
  assertEquals(assertVmsMustacheSnippets(lungMdtDecisionSheets()), []);
  assertEquals(assertVmsMustacheSnippets(chemoDecisionSheets()), []);
  const lungSheets = JSON.parse(
    Deno.readTextFileSync(
      join(fixtures, "lung-MDT-form-decision-tables", "mapping", "mapping.sheets.json"),
    ),
  );
  const chemoSheets = JSON.parse(
    Deno.readTextFileSync(
      join(fixtures, "patient-reported-chemotherapy-symptoms-decision-tables", "mapping", "mapping.sheets.json"),
    ),
  );
  const lungDocs = Array.isArray(lungSheets) ? lungSheets : [lungSheets];
  const chemoDocs = Array.isArray(chemoSheets) ? chemoSheets : [chemoSheets];
  assertEquals(assertVmsMustacheSnippets(lungDocs), []);
  assertEquals(assertVmsMustacheSnippets(chemoDocs), []);
});

Deno.test("#70 sibling mappings keep gold directories and one free-text helper", () => {
  const goldLung = Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form", "mapping", "mapping.blockly.json"),
  );
  const goldChemo = Deno.readTextFileSync(
    join(fixtures, "patient-reported-chemotherapy-symptoms", "mapping", "mapping.blockly.json"),
  );
  const siblingLung = Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form-decision-tables", "mapping", "mapping.blockly.json"),
  );
  const siblingChemo = Deno.readTextFileSync(
    join(fixtures, "patient-reported-chemotherapy-symptoms-decision-tables", "mapping", "mapping.blockly.json"),
  );
  assertEquals(goldLung.includes('"NAME": "imaging_term"'), false);
  assertEquals(goldChemo.includes('"NAME": "fatigue_note"'), false);
  assert(siblingLung.includes('"NAME": "imaging_term"'));
  assert(siblingLung.includes('"NAME": "imaging_note"'));
  assert(siblingLung.includes('"NAME": "treatment_note"'));
  assert(siblingLung.includes("text_changeCase"));
  assert(siblingLung.includes("logic_list_restriction"));
  assertEquals(siblingLung.includes("(or granskning"), false);
  assert(siblingLung.includes("decision_table"));
  assert(siblingChemo.includes('"NAME": "fatigue_note"'));
  const defines = siblingChemo.split('define \\"cleanAndQuoteFreeTextInput\\"').length - 1;
  assertEquals(defines, 1, `expected one cleanAndQuoteFreeTextInput define, got ${defines}`);
  assertEquals(goldChemo.includes("define \\\"cleanAndQuoteFreeTextInput\\\""), true);
});

Deno.test("#70 lung-MDT sibling TermIds and Notes match the PROD script", async () => {
  const prodScript = Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form", "mapping", "mappningsscript-xml-3-2-0-prod.txt"),
  );
  const files = [
    "1-mdt-review-never-smoked-mr.json",
    "2-mdt-review-smoker-ultrasound.json",
  ];
  for (const filename of files) {
    const source = Deno.readTextFileSync(
      join(fixtures, "lung-MDT-form", "source-instance", filename),
    );
    const prodXml = renderHandlebars(prodScript, JSON.parse(source));
    const sibling = await runMapped(
      "lung-mdt-form-to-tc-xml-decision-tables",
      "handlebars",
      filename,
    );
    assertEquals(sibling.error, undefined, `${filename} sibling: ${sibling.error}`);
    assertEquals(sibling.ok, true, `${filename} sibling not ok`);
    const prodPairs = keywordPairs(stripHtmlComments(prodXml));
    const siblingPairs = keywordPairs(stripHtmlComments(outputText(sibling.output)));
    assertEquals(
      siblingPairs,
      prodPairs,
      `${filename}\nprod=${JSON.stringify(prodPairs, null, 2)}\nsibling=${JSON.stringify(siblingPairs, null, 2)}`,
    );
    const noteFor = (termId: string) =>
      siblingPairs.find((pair) => pair.termId === termId)?.note ?? "";
    if (filename.includes("never-smoked")) {
      assert(noteFor("8754").includes("Har aldrig rökt"), `8754 note=${noteFor("8754")}`);
      assert(noteFor("12683").includes("MR, Thorax"), `12683 note=${noteFor("12683")}`);
      assert(
        noteFor("14351").includes("kurativ kirurgi"),
        `14351 note=${noteFor("14351")}`,
      );
      assert(
        noteFor("14351").includes("Cisplatin-vinorelbin, 4 kurer"),
        `14351 note=${noteFor("14351")}`,
      );
    }
    if (filename.includes("smoker")) {
      assert(
        noteFor("5074").includes("Bo Onkolog, lungonkologi"),
        `5074 note=${noteFor("5074")}`,
      );
      assert(
        noteFor("4502").includes("Hosta och viktnedgång sedan tre månader."),
        `4502 note=${noteFor("4502")}`,
      );
      assert(noteFor("8754").includes("Cigaretter"), `8754 note=${noteFor("8754")}`);
      assert(noteFor("8754").includes("35"), `8754 note=${noteFor("8754")}`);
      assert(noteFor("4829").includes("Ultraljud, Hals"), `4829 note=${noteFor("4829")}`);
      assert(
        noteFor("14351").includes("Fraktionsdos: 3 Gy, Totaldos: 30 Gy"),
        `14351 note=${noteFor("14351")}`,
      );
    }
  }
});

type TreatmentArm = {
  typ?: string;
  form?: string;
  regim?: string;
  antal?: string;
  annan?: string;
  fraktion?: number;
  total?: number;
  kommentar?: string;
  relation?: string;
};

function coded(text: string): Array<{ "|value": string }> {
  return [{ "|value": text }];
}

function treatmentArm(spec: TreatmentArm | undefined): unknown[] | undefined {
  if (!spec) return undefined;
  const out: Record<string, unknown> = {};
  if (spec.typ) out.typ_av_behandling = coded(spec.typ);
  if (spec.form) out.form_av_kemoradioterapi = coded(spec.form);
  if (spec.regim) out.regim = coded(spec.regim);
  if (spec.antal) out.antal_kurer = coded(spec.antal);
  if (spec.annan) out.annan_regim = coded(spec.annan);
  if (spec.fraktion != null) out.fraktionsdos = [{ "|magnitude": spec.fraktion, "|unit": "Gy" }];
  if (spec.total != null) out.totaldos = [{ "|magnitude": spec.total, "|unit": "Gy" }];
  if (spec.kommentar) out.kommentar = coded(spec.kommentar);
  if (spec.relation) out.relation_till_huvudbehandling = coded(spec.relation);
  return [out];
}

function treatmentDoc(opts: {
  intention?: string;
  huvud?: TreatmentArm;
  tillägg?: TreatmentArm;
  kommentar?: string;
  vidare?: string;
}): unknown {
  const strategi: Record<string, unknown> = {};
  if (opts.intention) strategi.intention = coded(opts.intention);
  const huvud = treatmentArm(opts.huvud);
  const tillägg = treatmentArm(opts.tillägg);
  if (huvud) strategi.huvudbehandling = huvud;
  if (tillägg) strategi.tilläggsbehandling = tillägg;
  const mdt: Record<string, unknown> = {
    rekommenderad_behandlingsstrategi: [strategi],
  };
  if (opts.kommentar) mdt.kommentar = coded(opts.kommentar);
  if (opts.vidare) mdt.vidare_utredning = coded(opts.vidare);
  return {
    granskning: {
      gemensamt_beslut: [{ multidisciplinär_handläggning_vid_cancer: [mdt] }],
    },
  };
}

function treatmentNote(xml: string): string {
  return keywordPairs(stripHtmlComments(xml)).find((pair) => pair.termId === "14351")?.note ?? "";
}

Deno.test("#70 lung-MDT treatment grammar matches the PROD script on each presence branch", () => {
  const prodScript = Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form", "mapping", "mappningsscript-xml-3-2-0-prod.txt"),
  );
  const state = JSON.parse(Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form-decision-tables", "mapping", "mapping.blockly.json"),
  ));
  const sheets = JSON.parse(Deno.readTextFileSync(
    join(fixtures, "lung-MDT-form-decision-tables", "mapping", "mapping.sheets.json"),
  )) as SheetDocument[];
  const bag = Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet]));
  const cases: Array<{ name: string; doc: unknown }> = [
    {
      name: "all four, regimen on tillägg, strategy comment",
      doc: treatmentDoc({
        intention: "Kurativ",
        huvud: { typ: "Kirurgi" },
        tillägg: { relation: "Adjuvant", typ: "Cytostatika", regim: "Cisplatin-vinorelbin", antal: "4" },
        kommentar: "Patienten informeras via mottagning.",
      }),
    },
    {
      name: "intention + huvud dose",
      doc: treatmentDoc({
        intention: "Palliativ",
        huvud: { typ: "Strålbehandling", fraktion: 3, total: 30 },
      }),
    },
    {
      name: "bara huvud, annan regim",
      doc: treatmentDoc({ huvud: { typ: "Cytostatika", annan: "Annan regim" } }),
    },
    {
      name: "bara tillägg, regim and courses",
      doc: treatmentDoc({ tillägg: { typ: "Cytostatika", regim: "Carboplatin", antal: "2" } }),
    },
    {
      name: "bara intention BSC",
      doc: treatmentDoc({ intention: "Best supportive care (BSC)" }),
    },
    {
      name: "bara intention",
      doc: treatmentDoc({ intention: "Kurativ" }),
    },
    {
      name: "bara relation",
      doc: treatmentDoc({ tillägg: { relation: "Adjuvant" } }),
    },
    {
      name: "huvud + relation",
      doc: treatmentDoc({
        huvud: { typ: "Kirurgi", antal: "3" },
        tillägg: { relation: "Neoadjuvant" },
      }),
    },
    {
      name: "intention + huvud + relation",
      doc: treatmentDoc({
        intention: "Kurativ",
        huvud: { typ: "Kirurgi" },
        tillägg: { relation: "Perioperativ" },
      }),
    },
    {
      name: "relation + tillägg kemoradioterapi",
      doc: treatmentDoc({
        tillägg: { relation: "Adjuvant", typ: "Kemoradioterapi", form: "Konkomitant" },
      }),
    },
    {
      name: "huvud + tillägg, antal only",
      doc: treatmentDoc({
        huvud: { typ: "Kirurgi", antal: "2" },
        tillägg: { typ: "Cytostatika", antal: "4" },
      }),
    },
    {
      name: "intention + relation + tillägg",
      doc: treatmentDoc({
        intention: "Palliativ",
        tillägg: { relation: "Adjuvant", typ: "Cytostatika" },
      }),
    },
    {
      name: "comments and vidare only",
      doc: treatmentDoc({
        kommentar: "Strategi.",
        vidare: "PET",
        huvud: { kommentar: "Huvuddetalj." },
        tillägg: { kommentar: "Tilläggsdetalj." },
      }),
    },
    {
      name: "kemoradioterapi huvud with dose",
      doc: treatmentDoc({
        intention: "Kurativ",
        huvud: { typ: "Kemoradioterapi", form: "Sekventiell", fraktion: 2, total: 60 },
      }),
    },
  ];
  for (const item of cases) {
    const prod = treatmentNote(renderHandlebars(prodScript, item.doc));
    const ctx = createSourceContext(JSON.stringify(item.doc), "json");
    ctx.sheets = bag;
    const siblingXml = renderXmlCanvasFromBlockly(state, ctx) ?? "";
    const sibling = treatmentNote(siblingXml);
    assertEquals(sibling, prod, `${item.name}\nprod=${JSON.stringify(prod)}\nsibling=${JSON.stringify(sibling)}`);
  }
});

Deno.test("#70 chemo sibling TermIds and Notes match PROD script (whitespace-normalized)", async () => {
  await ensureGoTemplateWasm();
  const prodScript = Deno.readTextFileSync(
    join(fixtures, "patient-reported-chemotherapy-symptoms", "mapping", "mappningsscript-1-9-1-prod.txt"),
  );
  const files = [
    "1-ex-composition.txt",
    "3-ex-composition-full.txt",
    "6-ex-composition-nightly.txt",
  ];
  for (const filename of files) {
    const source = Deno.readTextFileSync(
      join(fixtures, "patient-reported-chemotherapy-symptoms", "source-instance", filename),
    );
    const parsed = parseJsonDocument(source);
    const prodXml = executeGoTemplate(prodScript, {
      Parameters: executeEnvelopeParameters(parsed) ?? {},
      Data: unwrapExecuteEnvelope(parsed),
    });
    const sibling = await runMapped(
      "chemo-symptoms-flat-to-tc-xml-decision-tables",
      "go-template",
      filename,
    );
    assertEquals(sibling.error, undefined, `${filename} sibling: ${sibling.error}`);
    assertEquals(sibling.ok, true, `${filename} sibling not ok`);
    const prodPairs = keywordPairs(prodXml);
    const siblingPairs = keywordPairs(outputText(sibling.output));
    assertEquals(
      siblingPairs,
      prodPairs,
      `${filename}\nprod=${JSON.stringify(prodPairs, null, 2)}\nsibling=${JSON.stringify(siblingPairs, null, 2)}`,
    );
  }
});
