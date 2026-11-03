/**
 * Build test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json
 * from TakeCare-CasenoteWrite-edit01.xsd + mappningsscript-1-9-1-prod.txt.
 *
 *   deno run -A scripts/build-chemo-symptoms-blockly.ts
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { Blockly } from "../src/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "../src/blockly/mod.ts";
import {
  attachOptionalSchemaChild,
  loadSkeletonIntoWorkspace,
} from "../src/blockly/skeleton_loader.ts";
import { createSchemaStructureBlock } from "../src/blockly/schema_blocks.ts";
import { findSkeletonNode } from "../src/blockly/schema_catalog.ts";
import {
  composeSchemaOptionalFields,
  schemaOptionalInputName,
} from "../src/blockly/blocks/schema_mutator.ts";
import { targetChildInputName } from "../src/blockly/blocks/target_blocks.ts";
import { createMapsGetBlock } from "../src/blockly/blocks/map_blocks.ts";
import { createSourceQueryBlock } from "../src/blockly/source_query.ts";
import { applySkeletonBlockLabels } from "../src/blockly/block_labels.ts";
import { createEmptyModel } from "../src/core/mapping_model/mod.ts";
import { getTargetFormatHandler } from "../src/core/target/mod.ts";
import { DEFAULTS_MAP_NAME } from "../src/core/defaults/mod.ts";
import type { SkeletonNode } from "../src/types/mod.ts";
import "blockly/blocks";

const rootDir = join(dirname(fromFileUrl(import.meta.url)), "..");

const Q =
  "patientrapporterade_symptom_inför_medicinsk_onkologisk_behandling/frågeformulär_för_symptom_och_andra_tecken/ospecificerad_händelse:0";

export interface DataCompare {
  path: string;
  op: "EQ" | "NEQ";
  value: string;
}

export interface ChemoKeywordSpec {
  kind: "TextKeyWord" | "NumericKeyword";
  termId: string;
  comment: string;
  /** Outer emission condition. `unless-and` matches PROD `{{if and …}}{{else}}<Keyword>`. */
  when: "eq" | "neq" | "unless-and" | "always";
  compares: DataCompare[];
  group: "none-reported" | "symptom" | "after" | "numeric";
}

/** Every TakeCare TermId emitted by mappningsscript-1-9-1-prod.txt */
export const CHEMO_KEYWORDS: ChemoKeywordSpec[] = [
  {
    kind: "TextKeyWord",
    termId: "16183",
    comment: "Patientrapporterade utfallsmått (PROM)",
    when: "always",
    compares: [],
    group: "none-reported",
  },
  {
    kind: "TextKeyWord",
    termId: "2811",
    comment: "Fatigue",
    when: "neq",
    compares: [{
      path: `${Q}/trötthet/upplever_du_trötthet_fatigue_som_påverkar_ditt_dagliga_liv|value`,
      op: "NEQ",
      value: "Nej",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "1830",
    comment: "Andning",
    when: "eq",
    compares: [{
      path: `${Q}/andning/upplever_du_svårigheter_med_din_andning|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "6298",
    comment: "Hjärta-kärl",
    when: "eq",
    compares: [{
      path:
        `${Q}/besvär_kring_hjärttrakten/upplever_du_någon_typ_av_besvär_kring_hjärttrakten_hjärtklappning_hård_puls_tryck_över_bröstet_eller_liknande|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "7643",
    comment: "Svullnad",
    when: "eq",
    compares: [{
      path: `${Q}/svullnad/har_du_ökad_svullnad_i_kroppen|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "207",
    comment: "Hud",
    when: "eq",
    compares: [{
      path: `${Q}/utslag_eller_hudrodnad/har_du_utslag_eller_hudrodnad|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "7570",
    comment: "Nagelfunktioner",
    when: "eq",
    compares: [{
      path: `${Q}/naglar/har_du_förändringar_av_naglarna|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "1921",
    comment: "Klåda",
    when: "eq",
    compares: [{
      path: `${Q}/klåda/har_du_klåda|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "2018",
    comment: "Munhåla och svalg",
    when: "eq",
    compares: [{
      path: `${Q}/mun_svalg/har_du_förändringar_i_mun_svalg|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "5464",
    comment: "Aptitförändring",
    when: "unless-and",
    compares: [
      { path: `${Q}/aptit/upplever_du_förändrad_aptit|code`, op: "EQ", value: "3" },
      { path: `${Q}/matintag/hur_har_ditt_matintag_förändrats|code`, op: "EQ", value: "3" },
    ],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "1908",
    comment: "Illamående/kräkning",
    when: "eq",
    compares: [{
      path: `${Q}/illamående/upplever_du_besvär_av_illamående|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "1875",
    comment: "Elimination",
    when: "unless-and",
    compares: [
      { path: `${Q}/diarréer/har_du_problem_med_diarréer|value`, op: "EQ", value: "Nej" },
      { path: `${Q}/förstoppning/har_du_förstoppning|value`, op: "EQ", value: "Nej" },
    ],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "2008",
    comment: "Smärta",
    when: "eq",
    compares: [{
      path: `${Q}/smärta/upplever_du_värk_i_muskler_och_eller_leder|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "2310",
    comment: "Sinnesintryck",
    when: "eq",
    compares: [{
      path:
        `${Q}/stickningar_pirrningar_domningar/upplever_du_stickningar_eller_pirrningar_domningar|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "symptom",
  },
  {
    kind: "TextKeyWord",
    termId: "14768",
    comment: "Patientens kommentar",
    when: "unless-and",
    compares: [
      {
        path:
          `${Q}/generella_behandlingsrelaterade_frågor/har_något_eller_några_av_de_symptom_du_skattat_förvärrats_sedan_föregående_behandling|value`,
        op: "EQ",
        value: "Nej",
      },
      {
        path:
          `${Q}/generella_behandlingsrelaterade_frågor/har_du_ytterligare_biverkningar_som_du_vill_förmedla_eller_förtydliga_för_oss|value`,
        op: "EQ",
        value: "Nej",
      },
      {
        path:
          `${Q}/generella_behandlingsrelaterade_frågor/har_du_någon_fråga_inför_kommande_behandling|value`,
        op: "EQ",
        value: "Nej",
      },
    ],
    group: "after",
  },
  {
    kind: "TextKeyWord",
    termId: "13700",
    comment: "DokumentID från extern system",
    when: "always",
    compares: [],
    group: "after",
  },
  {
    kind: "NumericKeyword",
    termId: "2025",
    comment: "Kroppstemperatur",
    when: "eq",
    compares: [{
      path: `${Q}/feber/har_du_haft_en_kroppstemperatur_över_38_grader_senaste_dygnet|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "numeric",
  },
  {
    kind: "NumericKeyword",
    termId: "3484",
    comment: "Viktförändring",
    when: "eq",
    compares: [{
      path: `${Q}/vikt/har_din_vikt_förändrats_de_senaste_veckorna|value`,
      op: "EQ",
      value: "Ja",
    }],
    group: "numeric",
  },
];

/** 17 screening equals that PROD ANDs before emitting TermId 16183. */
export const ALL_NEJ_COMPARES: DataCompare[] = [
  { path: `${Q}/trötthet/upplever_du_trötthet_fatigue_som_påverkar_ditt_dagliga_liv|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/andning/upplever_du_svårigheter_med_din_andning|value`, op: "EQ", value: "Nej" },
  {
    path:
      `${Q}/besvär_kring_hjärttrakten/upplever_du_någon_typ_av_besvär_kring_hjärttrakten_hjärtklappning_hård_puls_tryck_över_bröstet_eller_liknande|value`,
    op: "EQ",
    value: "Nej",
  },
  { path: `${Q}/svullnad/har_du_ökad_svullnad_i_kroppen|value`, op: "EQ", value: "Nej" },
  {
    path: `${Q}/feber/har_du_haft_en_kroppstemperatur_över_38_grader_senaste_dygnet|value`,
    op: "EQ",
    value: "Nej",
  },
  { path: `${Q}/utslag_eller_hudrodnad/har_du_utslag_eller_hudrodnad|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/klåda/har_du_klåda|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/naglar/har_du_förändringar_av_naglarna|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/mun_svalg/har_du_förändringar_i_mun_svalg|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/aptit/upplever_du_förändrad_aptit|code`, op: "EQ", value: "3" },
  { path: `${Q}/matintag/hur_har_ditt_matintag_förändrats|code`, op: "EQ", value: "3" },
  { path: `${Q}/vikt/har_din_vikt_förändrats_de_senaste_veckorna|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/illamående/upplever_du_besvär_av_illamående|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/diarréer/har_du_problem_med_diarréer|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/förstoppning/har_du_förstoppning|value`, op: "EQ", value: "Nej" },
  { path: `${Q}/smärta/upplever_du_värk_i_muskler_och_eller_leder|value`, op: "EQ", value: "Nej" },
  {
    path:
      `${Q}/stickningar_pirrningar_domningar/upplever_du_stickningar_eller_pirrningar_domningar|value`,
    op: "EQ",
    value: "Nej",
  },
];

export function extractGoDefine(script: string, name: string): string {
  const start = script.indexOf(`{{- define "${name}" -}}`);
  if (start < 0) throw new Error(`missing define ${name}`);
  const endMarker = "{{- end -}}";
  const end = script.indexOf(endMarker, start);
  if (end < 0) throw new Error(`unclosed define ${name}`);
  return script.slice(start, end + endMarker.length);
}

export function extractNoteForTermId(script: string, termId: string): string {
  const re = new RegExp(
    `<TermId>\\s*${termId}\\s*</TermId>\\s*<Note>([\\s\\S]*?)</Note>`,
  );
  const match = script.match(re);
  if (!match) throw new Error(`missing <Note> for TermId ${termId}`);
  return match[1];
}

export function extractProdTermIds(script: string): string[] {
  return [...script.matchAll(/<TermId>\s*(\d+)\s*<\/TermId>/g)].map((m) => m[1]!);
}

function descendant(node: SkeletonNode | undefined, ...names: string[]): SkeletonNode | undefined {
  let current = node;
  for (const name of names) {
    current = current?.children.find((child) => (child.rmAttribute ?? child.label) === name);
  }
  return current;
}

function fillValue(parent: Blockly.Block, inputName: string, value: Blockly.Block): void {
  const input = parent.getInput(inputName);
  if (!input?.connection || !value.outputConnection) {
    throw new Error(`Cannot fill ${parent.type}.${inputName}`);
  }
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  input.connection.connect(value.outputConnection);
}

function appendStatement(parent: Blockly.Block, inputName: string, block: Blockly.Block): void {
  const input = parent.getInput(inputName);
  if (!input?.connection || !block.previousConnection) {
    throw new Error(`Cannot append ${block.type} onto ${parent.type}.${inputName}`);
  }
  const first = input.connection.targetBlock();
  if (!first) {
    input.connection.connect(block.previousConnection);
    return;
  }
  let tail: Blockly.Block = first;
  while (tail.getNextBlock()) tail = tail.getNextBlock()!;
  if (!tail.nextConnection) throw new Error(`No next connection on ${tail.type}`);
  tail.nextConnection.connect(block.previousConnection);
}

function mapsGet(workspace: Blockly.Workspace, key: string): Blockly.Block {
  return createMapsGetBlock(workspace, DEFAULTS_MAP_NAME, key);
}

function mathNumber(workspace: Blockly.Workspace, value: string): Blockly.Block {
  const block = workspace.newBlock("math_number");
  block.setFieldValue(value, "NUM");
  return block;
}

function textLiteral(workspace: Blockly.Workspace, value: string): Blockly.Block {
  const block = workspace.newBlock("text");
  block.setFieldValue(value, "TEXT");
  return block;
}

function goTextCode(workspace: Blockly.Workspace, text: string): Blockly.Block {
  const block = workspace.newBlock("text_code");
  if (block.getField("LANG")) block.setFieldValue("go-template", "LANG");
  block.setFieldValue(text, "TEXT");
  return block;
}

function structureFromNode(
  workspace: Blockly.Workspace,
  node: SkeletonNode,
): Blockly.Block {
  const block = createSchemaStructureBlock(workspace, node, false);
  block.setFieldValue(node.rmType, "TARGET_TYPE");
  block.setFieldValue(node.slotId, "SLOT_ID");
  applySkeletonBlockLabels(block, node);
  return block;
}

function compareData(workspace: Blockly.Workspace, cmp: DataCompare): Blockly.Block {
  const block = workspace.newBlock("logic_compare");
  block.setFieldValue(cmp.op, "OP");
  const src = createSourceQueryBlock(workspace, cmp.path, "string");
  block.getInput("A")?.connection?.connect(src.outputConnection!);
  block.getInput("B")?.connection?.connect(textLiteral(workspace, cmp.value).outputConnection!);
  return block;
}

function andAll(workspace: Blockly.Workspace, compares: DataCompare[]): Blockly.Block {
  if (!compares.length) throw new Error("andAll needs compares");
  let acc = compareData(workspace, compares[0]!);
  for (const next of compares.slice(1)) {
    const op = workspace.newBlock("logic_operation");
    op.setFieldValue("AND", "OP");
    op.getInput("A")?.connection?.connect(acc.outputConnection!);
    op.getInput("B")?.connection?.connect(compareData(workspace, next).outputConnection!);
    acc = op;
  }
  return acc;
}

function wrapIf(
  workspace: Blockly.Workspace,
  inner: Blockly.Block,
  spec: ChemoKeywordSpec,
): Blockly.Block {
  if (spec.when === "always") return inner;
  const guard = workspace.newBlock("include_when");
  const cond = spec.compares.length === 1
    ? compareData(workspace, spec.compares[0]!)
    : andAll(workspace, spec.compares);
  guard.getInput("WHEN")?.connection?.connect(cond.outputConnection!);
  const branch = spec.when === "unless-and" ? "ELSE" : "DO";
  guard.getInput(branch)?.connection?.connect(inner.previousConnection!);
  return guard;
}

function keywordBlock(
  workspace: Blockly.Workspace,
  node: SkeletonNode,
  spec: ChemoKeywordSpec,
  script: string,
): Blockly.Block {
  const block = structureFromNode(workspace, node);
  if (typeof block.setCommentText === "function") block.setCommentText(spec.comment);
  fillValue(block, targetChildInputName("TermId"), mathNumber(workspace, spec.termId));
  const note = extractNoteForTermId(script, spec.termId);
  if (spec.kind === "TextKeyWord") {
    fillValue(block, targetChildInputName("Note"), goTextCode(workspace, note));
  } else {
    composeSchemaOptionalFields(block, ["Note"]);
    fillValue(block, schemaOptionalInputName("Note"), goTextCode(workspace, note));
  }
  return block;
}

export function buildChemoSymptomsWorkspace(xsd: string, script: string): Blockly.Workspace {
  initBlocklyGenerators();
  const target = getTargetFormatHandler("xml-schema").load(
    "TakeCare-CasenoteWrite-edit01.xsd",
    xsd,
  );
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(
    workspace,
    target.skeleton,
    createEmptyModel(target.targetId),
    null,
    "en",
    "xml-schema",
  );

  const define = goTextCode(workspace, extractGoDefine(script, "cleanAndQuoteFreeTextInput"));
  define.moveBy(20, 20);

  const root = workspace.getAllBlocks(false).find((block) =>
    block.type === "schema_ProfdocHISMessage"
  );
  if (!root) throw new Error("missing schema_ProfdocHISMessage");

  const headerKeys: Record<string, string> = {
    PatId: "PatientId",
    UserId: "UserId",
    EventTime: "Time",
    Signer: "Signer",
    TemplateId: "TemplateId",
    Time: "Time",
    InvokingSystem: "InvokingSystem",
  };
  for (const [field, key] of Object.entries(headerKeys)) {
    if (!root.getInput(targetChildInputName(field))) continue;
    fillValue(root, targetChildInputName(field), mapsGet(workspace, key));
  }
  fillValue(root, targetChildInputName("TemplateType"), mathNumber(workspace, "1"));
  composeSchemaOptionalFields(root, ["Signed", "UUID"]);
  fillValue(root, schemaOptionalInputName("Signed"), mathNumber(workspace, "0"));
  fillValue(root, schemaOptionalInputName("UUID"), mapsGet(workspace, "UUID"));

  const keywords = root.getInput("TARGET_Keywords")?.connection?.targetBlock();
  if (!keywords) throw new Error("missing Keywords");
  composeSchemaOptionalFields(keywords, ["TextKeywords", "NumericKeywords"]);
  attachOptionalSchemaChild(workspace, keywords, "TextKeywords");
  attachOptionalSchemaChild(workspace, keywords, "NumericKeywords");

  const textKeywords = keywords.getInput(schemaOptionalInputName("TextKeywords"))
    ?.connection?.targetBlock();
  const numericKeywords = keywords.getInput(schemaOptionalInputName("NumericKeywords"))
    ?.connection?.targetBlock();
  if (!textKeywords || !numericKeywords) throw new Error("missing keyword containers");

  textKeywords.getInput("TARGET_TextKeyWord")?.connection?.targetBlock()?.dispose(false);
  numericKeywords.getInput("TARGET_NumericKeyword")?.connection?.targetBlock()?.dispose(false);

  const rootNode = findSkeletonNode(root.getFieldValue("SLOT_ID"));
  const textNode = descendant(rootNode, "Keywords", "TextKeywords", "TextKeyWord");
  const numericNode = descendant(rootNode, "Keywords", "NumericKeywords", "NumericKeyword");
  if (!textNode || !numericNode) throw new Error("missing keyword skeleton nodes");

  const none = CHEMO_KEYWORDS.find((k) => k.group === "none-reported")!;
  const symptoms = CHEMO_KEYWORDS.filter((k) => k.group === "symptom");
  const after = CHEMO_KEYWORDS.filter((k) => k.group === "after");
  const numeric = CHEMO_KEYWORDS.filter((k) => k.group === "numeric");

  const noneIf = workspace.newBlock("include_when");
  noneIf.getInput("WHEN")?.connection?.connect(andAll(workspace, ALL_NEJ_COMPARES).outputConnection!);
  noneIf.getInput("DO")?.connection?.connect(
    keywordBlock(workspace, textNode, none, script).previousConnection!,
  );
  for (const spec of symptoms) {
    appendStatement(
      noneIf,
      "ELSE",
      wrapIf(workspace, keywordBlock(workspace, textNode, spec, script), spec),
    );
  }
  appendStatement(textKeywords, targetChildInputName("TextKeyWord"), noneIf);

  for (const spec of after) {
    appendStatement(
      textKeywords,
      targetChildInputName("TextKeyWord"),
      wrapIf(workspace, keywordBlock(workspace, textNode, spec, script), spec),
    );
  }

  for (const spec of numeric) {
    appendStatement(
      numericKeywords,
      targetChildInputName("NumericKeyword"),
      wrapIf(workspace, keywordBlock(workspace, numericNode, spec, script), spec),
    );
  }

  return workspace;
}

if (import.meta.main) {
  const xsd = Deno.readTextFileSync(
    join(rootDir, "test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd"),
  );
  const script = Deno.readTextFileSync(
    join(rootDir, "test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-prod.txt"),
  );
  const prodIds = extractProdTermIds(script);
  const specIds = CHEMO_KEYWORDS.map((k) => k.termId);
  if (prodIds.join() !== specIds.join()) {
    throw new Error(
      `CHEMO_KEYWORDS TermIds drift from PROD (script ${prodIds.join(",")} vs spec ${specIds.join(",")})`,
    );
  }
  for (const spec of CHEMO_KEYWORDS) extractNoteForTermId(script, spec.termId);

  const workspace = buildChemoSymptomsWorkspace(xsd, script);
  const state = Blockly.serialization.workspaces.save(workspace) as {
    blocks?: { blocks?: Array<{ type?: string }> };
  };
  const top = state.blocks?.blocks;
  if (Array.isArray(top)) {
    const defineIdx = top.findIndex((block) => block.type === "text_code");
    if (defineIdx > 0) {
      const [defineBlock] = top.splice(defineIdx, 1);
      top.unshift(defineBlock!);
    }
  }
  const out = join(
    rootDir,
    "test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json",
  );
  Deno.writeTextFileSync(out, `${JSON.stringify(state, null, 2)}\n`);
  workspace.dispose();
  console.log(`Wrote ${out} (${specIds.length} TermIds)`);
}
