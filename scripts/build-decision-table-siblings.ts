/**
 * Build #70 sibling Example Sets: lung-MDT and chemo decision-table mappings.
 *
 *   deno run -A --no-check scripts/build-decision-table-siblings.ts
 *   deno run -A --no-check scripts/build-decision-table-siblings.ts --only=lung
 *
 * Does not rewrite test/fixtures/lung-MDT-form/ or the chemo Blockly gold.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { Blockly } from "../src/blockly/blockly_core.ts";
import { createSourceQueryBlock } from "../src/blockly/source_query.ts";
import { targetChildInputName } from "../src/blockly/blocks/target_blocks.ts";
import { applyDecisionTableOutputType } from "../src/blockly/blocks/decision_table_blocks.ts";
import { setWorkspaceSheetsProvider } from "../src/blockly/sheets_bridge.ts";
import { buildLungMdtWorkspace } from "./build-lung-mdt-blockly.ts";
import { buildChemoSymptomsWorkspace } from "./build-chemo-symptoms-blockly.ts";
import {
  CHEMO_FLAT,
  chemoDecisionSheets,
  lungMdtDecisionSheets,
} from "./decision_table_example_sheets.ts";
import { extractOrPaths } from "./handlebars_presence.ts";
import type { SheetDocument } from "../src/core/sheets/types.ts";

const rootDir = join(dirname(fromFileUrl(import.meta.url)), "..");

type MapCreate = Blockly.Block & { itemCount_: number; updateShape_: () => void };

function fillValue(parent: Blockly.Block, inputName: string, value: Blockly.Block): void {
  const input = parent.getInput(inputName);
  if (!input?.connection || !value.outputConnection) {
    throw new Error(`Cannot fill ${parent.type}.${inputName}`);
  }
  const existing = input.connection.targetBlock();
  if (existing) existing.dispose(false);
  input.connection.connect(value.outputConnection);
}

function mapsCreate(
  workspace: Blockly.Workspace,
  entries: Array<[string, Blockly.Block]>,
): Blockly.Block {
  const block = workspace.newBlock("maps_create_with") as MapCreate;
  block.itemCount_ = Math.max(1, entries.length);
  block.updateShape_();
  for (const [i, [key, value]] of entries.entries()) {
    block.setFieldValue(key, `KEY${i}`);
    fillValue(block, `VAL${i}`, value);
  }
  return block;
}

function source(workspace: Blockly.Workspace, path: string, returnType = "string"): Blockly.Block {
  return createSourceQueryBlock(workspace, path, returnType);
}

function literal(workspace: Blockly.Workspace, text: string): Blockly.Block {
  const block = workspace.newBlock("text");
  block.setFieldValue(text, "TEXT");
  return block;
}

/** True when the path is filled. A missing path is false, not "unequal to empty". */
function present(workspace: Blockly.Workspace, path: string): Blockly.Block {
  const tern = workspace.newBlock("logic_ternary");
  tern.getInput("IF")?.connection?.connect(source(workspace, path, "boolean").outputConnection!);
  const yes = workspace.newBlock("logic_boolean");
  yes.setFieldValue("TRUE", "BOOL");
  const no = workspace.newBlock("logic_boolean");
  no.setFieldValue("FALSE", "BOOL");
  tern.getInput("THEN")?.connection?.connect(yes.outputConnection!);
  tern.getInput("ELSE")?.connection?.connect(no.outputConnection!);
  return tern;
}

/** Display fold. Snippet cells cannot call toLowerCase (ADR 0009). */
function lowered(workspace: Blockly.Workspace, path: string): Blockly.Block {
  const block = workspace.newBlock("text_changeCase");
  block.setFieldValue("LOWERCASE", "CASE");
  block.getInput("TEXT")?.connection?.connect(source(workspace, path).outputConnection!);
  return block;
}

type ListCreate = Blockly.Block & { itemCount_: number; updateShape_: () => void };

function anyFilled(workspace: Blockly.Workspace, paths: string[]): Blockly.Block {
  const list = workspace.newBlock("lists_create_with") as ListCreate;
  list.itemCount_ = Math.max(1, paths.length);
  list.updateShape_();
  for (const [i, path] of paths.entries()) {
    list.getInput(`ADD${i}`)?.connection?.connect(source(workspace, path).outputConnection!);
  }
  const restriction = workspace.newBlock("logic_list_restriction");
  restriction.setFieldValue("ANY", "OP");
  restriction.getInput("LIST")?.connection?.connect(list.outputConnection!);
  const item = workspace.newBlock("logic_current_item");
  restriction.getInput("PRED")?.connection?.connect(item.outputConnection!);
  return restriction;
}

/** Replace a long Handlebars `(or path path …)` gate with any-of-these-fields. */
function replaceLongOrGates(workspace: Blockly.Workspace): void {
  for (const block of workspace.getAllBlocks(false)) {
    if (block.type !== "controls_if") continue;
    const cond = block.getInputTargetBlock("IF0");
    if (!cond || (cond.type !== "source_query_boolean" && cond.type !== "source_query")) continue;
    const expr = String(cond.getFieldValue("EXPRESSION") ?? "");
    if (expr.length < 400 || !expr.includes("(or")) continue;
    const paths = extractOrPaths(expr);
    if (!paths?.length) continue;
    cond.dispose(false);
    block.getInput("IF0")?.connection?.connect(anyFilled(workspace, paths).outputConnection!);
  }
}

function decisionEval(
  workspace: Blockly.Workspace,
  name: string,
  output: string,
  entries: Array<[string, Blockly.Block]>,
): Blockly.Block {
  const block = workspace.newBlock("decision_table");
  block.setFieldValue(name, "NAME");
  block.setFieldValue(output, "OUTPUT");
  // Sheets are already installed. Type the output before it is plugged into
  // TermId (Number) or Note (String); the check is saved in extraState.
  applyDecisionTableOutputType(block);
  block.getInput("INPUTS")?.connection?.connect(
    mapsCreate(workspace, entries).outputConnection!,
  );
  return block;
}

function termIdOf(block: Blockly.Block): string | null {
  const term = block.getInputTargetBlock(targetChildInputName("TermId"));
  if (!term) return null;
  if (term.type === "math_number") return String(term.getFieldValue("NUM") ?? "");
  return null;
}

/** The `controls_if` whose DO socket holds this keyword, not an earlier sibling if. */
function owningIf(keyword: Blockly.Block): Blockly.Block | null {
  const parent = keyword.getParent();
  if (parent?.type !== "controls_if") return null;
  return parent;
}

function textKeywords(workspace: Blockly.Workspace): Blockly.Block[] {
  return workspace.getAllBlocks(false).filter((item) => item.type === "schema_TextKeyWord");
}

const LUNG = {
  modality:
    "$.granskning.utredning_undersökning[0].bilddiagnostik[0].bilddiagnostiskt_resultat[0].typ_av_undersökning[0]['|value']",
  studies: "$.granskning.utredning_undersökning[0].bilddiagnostik",
  smokeStatus:
    "$.granskning.nuvarande_situation_och_bakgrund[0].sammanfattning_av_rökvanor_för_tobak[0].övergripande_status[0]['|value']",
  smokeTyp:
    "$.granskning.nuvarande_situation_och_bakgrund[0].sammanfattning_av_rökvanor_för_tobak[0].per_typ[0].typ[0]['|value']",
  smokePaket:
    "$.granskning.nuvarande_situation_och_bakgrund[0].sammanfattning_av_rökvanor_för_tobak[0].per_typ[0].paketår[0]['|value']",
  smokeSlut:
    "$.granskning.nuvarande_situation_och_bakgrund[0].sammanfattning_av_rökvanor_för_tobak[0].per_typ[0].slutdatum[0]['|value']",
  smokeKommentar:
    "$.granskning.nuvarande_situation_och_bakgrund[0].sammanfattning_av_rökvanor_för_tobak[0].per_typ[0].kommentar[0]['|value']",
};

const MDT =
  "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0]";
const STRATEGY = `${MDT}.rekommenderad_behandlingsstrategi[0]`;

type ArmPaths = {
  typ: string;
  form: string;
  regim: string;
  antal: string;
  annan: string;
  fraktion: string;
  fraktionUnit: string;
  total: string;
  totalUnit: string;
  kommentar: string;
};

function armPaths(role: "huvudbehandling" | "tilläggsbehandling"): ArmPaths {
  const base = `${STRATEGY}.${role}[0]`;
  return {
    typ: `${base}.typ_av_behandling[0]['|value']`,
    form: `${base}.form_av_kemoradioterapi[0]['|value']`,
    regim: `${base}.regim[0]['|value']`,
    antal: `${base}.antal_kurer[0]['|value']`,
    annan: `${base}.annan_regim[0]['|value']`,
    fraktion: `${base}.fraktionsdos[0]['|magnitude']`,
    fraktionUnit: `${base}.fraktionsdos[0]['|unit']`,
    total: `${base}.totaldos[0]['|magnitude']`,
    totalUnit: `${base}.totaldos[0]['|unit']`,
    kommentar: `${base}.kommentar[0]['|value']`,
  };
}

function patchLung(workspace: Blockly.Workspace, sheets: SheetDocument[]): void {
  setWorkspaceSheetsProvider(() => sheets);

  const keywords = textKeywords(workspace);
  const byTerm = new Map(keywords.map((block) => [termIdOf(block), block]));
  const imaging = byTerm.get("12683");
  if (!imaging) throw new Error("missing imaging keyword 12683");
  // One keyword. TermId comes from the modality table; the shared Note is one
  // Mustache snippet. The other two copies (Ultraljud / Röntgen) go away.
  for (const extra of ["4829", "59"]) {
    const block = byTerm.get(extra);
    const wrap = block ? owningIf(block) : null;
    if (wrap) wrap.dispose(true);
    else block?.dispose(true);
  }
  fillValue(
    imaging,
    targetChildInputName("TermId"),
    decisionEval(workspace, "imaging_term", "term_id", [
      ["modality", source(workspace, LUNG.modality)],
    ]),
  );
  fillValue(
    imaging,
    targetChildInputName("Note"),
    decisionEval(workspace, "imaging_note", "note", [
      ["studies", source(workspace, LUNG.studies, "node")],
    ]),
  );
  const wrap = owningIf(imaging);
  if (wrap) {
    const old = wrap.getInputTargetBlock("IF0");
    const expr = String(old?.getFieldValue("EXPRESSION") ?? "");
    const paths = extractOrPaths(expr);
    if (!paths?.length) {
      throw new Error(
        `imaging keyword is missing its presence list (${old?.type ?? "none"}, ${expr.length} chars, ${JSON.stringify(expr.slice(0, 80))})`,
      );
    }
    if (old) old.dispose(false);
    wrap.getInput("IF0")?.connection?.connect(anyFilled(workspace, paths).outputConnection!);
  }
  replaceLongOrGates(workspace);

  const smoking = byTerm.get("8754");
  if (!smoking) throw new Error("missing smoking keyword 8754");
  fillValue(
    smoking,
    targetChildInputName("Note"),
    decisionEval(workspace, "smoking_note", "snippet", [
      ["status", source(workspace, LUNG.smokeStatus)],
      ["typ", source(workspace, LUNG.smokeTyp)],
      ["paketår", source(workspace, LUNG.smokePaket)],
      ["slutdatum", source(workspace, LUNG.smokeSlut)],
      ["kommentar", source(workspace, LUNG.smokeKommentar)],
    ]),
  );

  const treatment = byTerm.get("14351");
  if (!treatment) throw new Error("missing treatment keyword 14351");
  const intention = `${STRATEGY}.intention[0]['|value']`;
  const relation =
    `${STRATEGY}.tilläggsbehandling[0].relation_till_huvudbehandling[0]['|value']`;
  const huvud = armPaths("huvudbehandling");
  const tillägg = armPaths("tilläggsbehandling");
  const sentence = decisionEval(workspace, "treatment_frame", "snippet", [
    ["has_intention", present(workspace, intention)],
    ["has_huvud", present(workspace, huvud.typ)],
    ["has_relation", present(workspace, relation)],
    ["has_tillägg", present(workspace, tillägg.typ)],
    ["intention_l", lowered(workspace, intention)],
    ["relation_l", lowered(workspace, relation)],
    ["intention", source(workspace, intention)],
    ["relation", source(workspace, relation)],
    ["huvud_form", formPrefix(workspace, huvud)],
    ["huvud_typ", lowered(workspace, huvud.typ)],
    ["huvud_regimen_comma", regimenPhrase(workspace, huvud, "comma")],
    ["huvud_regimen_space", regimenPhrase(workspace, huvud, "space")],
    ["huvud_dose", dosePhrase(workspace, huvud)],
    ["tillägg_form", formPrefix(workspace, tillägg)],
    ["tillägg_typ", lowered(workspace, tillägg.typ)],
    ["tillägg_regimen_comma", regimenPhrase(workspace, tillägg, "comma")],
    ["tillägg_regimen_space", regimenPhrase(workspace, tillägg, "space")],
    ["tillägg_dose", dosePhrase(workspace, tillägg)],
    ["follow_glue", decisionEval(workspace, "follow_glue", "snippet", [
      ["relation", source(workspace, relation)],
    ])],
    ["relation_tail", decisionEval(workspace, "relation_tail", "snippet", [
      ["relation", source(workspace, relation)],
      ["relation_l", lowered(workspace, relation)],
    ])],
    ["huvud_relation_tail", decisionEval(workspace, "huvud_relation_tail", "snippet", [
      ["relation", source(workspace, relation)],
    ])],
    ["intention_closing", decisionEval(workspace, "intention_closing", "snippet", [
      ["intention", source(workspace, intention)],
      ["intention_l", lowered(workspace, intention)],
    ])],
  ]);
  fillValue(
    treatment,
    targetChildInputName("Note"),
    decisionEval(workspace, "treatment_note", "note", [
      ["sentence", sentence],
      ["huvud_kommentar", source(workspace, huvud.kommentar)],
      ["tillägg_kommentar", source(workspace, tillägg.kommentar)],
      ["strategi_kommentar", source(workspace, `${MDT}.kommentar[0]['|value']`)],
      ["vidare", source(workspace, `${MDT}.vidare_utredning[0]['|value']`)],
    ]),
  );
}

function formPrefix(workspace: Blockly.Workspace, arm: ArmPaths): Blockly.Block {
  return decisionEval(workspace, "chemoradiation_form", "snippet", [
    ["typ", source(workspace, arm.typ)],
    ["has_form", present(workspace, arm.form)],
    ["form_l", lowered(workspace, arm.form)],
  ]);
}

function regimenPhrase(
  workspace: Blockly.Workspace,
  arm: ArmPaths,
  style: "comma" | "space",
): Blockly.Block {
  return decisionEval(workspace, "regimen_phrase", "snippet", [
    ["style", literal(workspace, style)],
    ["has_regim", present(workspace, arm.regim)],
    ["has_antal", present(workspace, arm.antal)],
    ["has_annan", present(workspace, arm.annan)],
    ["has_typ", present(workspace, arm.typ)],
    ["regim", source(workspace, arm.regim)],
    ["antal_kurer", source(workspace, arm.antal)],
    ["annan_regim", source(workspace, arm.annan)],
  ]);
}

function dosePhrase(workspace: Blockly.Workspace, arm: ArmPaths): Blockly.Block {
  return decisionEval(workspace, "dose_phrase", "snippet", [
    ["has_fraktion", present(workspace, arm.fraktion)],
    ["has_total", present(workspace, arm.total)],
    ["fraktion", source(workspace, arm.fraktion)],
    ["fraktion_unit", source(workspace, arm.fraktionUnit)],
    ["total", source(workspace, arm.total)],
    ["total_unit", source(workspace, arm.totalUnit)],
  ]);
}

function flatKey(key: string): string {
  return `$.['${key.replace(/'/g, "\\'")}']`;
}

function patchChemo(workspace: Blockly.Workspace, sheets: SheetDocument[]): void {
  setWorkspaceSheetsProvider(() => sheets);
  const byTerm = new Map(
    textKeywords(workspace).map((block) => [termIdOf(block), block]),
  );

  const fatigue = byTerm.get("2811");
  if (!fatigue) throw new Error("missing fatigue keyword 2811");
  fillValue(
    fatigue,
    targetChildInputName("Note"),
    decisionEval(workspace, "fatigue_note", "snippet", [
      ["answer", source(workspace, flatKey(CHEMO_FLAT.fatigueAnswer))],
      ["followup", source(workspace, flatKey(CHEMO_FLAT.fatigueFollowup))],
    ]),
  );

  const swelling = byTerm.get("7643");
  if (!swelling) throw new Error("missing swelling keyword 7643");
  fillValue(
    swelling,
    targetChildInputName("Note"),
    decisionEval(workspace, "swelling_note", "snippet", [
      ["code", source(workspace, flatKey(CHEMO_FLAT.swellingCode))],
      ["severity", source(workspace, flatKey(CHEMO_FLAT.swellingValue))],
      ["location", source(workspace, flatKey(CHEMO_FLAT.swellingLocation))],
    ]),
  );

  const itch = byTerm.get("1921");
  if (!itch) throw new Error("missing itch keyword 1921");
  fillValue(
    itch,
    targetChildInputName("Note"),
    decisionEval(workspace, "itch_note", "snippet", [
      ["treated", source(workspace, flatKey(CHEMO_FLAT.itchTreated))],
      ["severity", source(workspace, flatKey(CHEMO_FLAT.itchSeverity))],
      ["treatment", source(workspace, flatKey(CHEMO_FLAT.itchTreatment))],
    ]),
  );
}

function writeSet(
  dir: string,
  workspace: Blockly.Workspace,
  sheets: SheetDocument[],
): void {
  Deno.mkdirSync(dir, { recursive: true });
  const state = Blockly.serialization.workspaces.save(workspace);
  Deno.writeTextFileSync(
    join(dir, "mapping.blockly.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  Deno.writeTextFileSync(
    join(dir, "mapping.sheets.json"),
    `${JSON.stringify(sheets, null, 2)}\n`,
  );
}

if (import.meta.main) {
  const xsd = Deno.readTextFileSync(
    join(rootDir, "test/fixtures/TakeCare/TakeCare-CasenoteWrite-edit01.xsd"),
  );
  const lungScript = Deno.readTextFileSync(
    join(rootDir, "test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt"),
  );
  const chemoScript = Deno.readTextFileSync(
    join(
      rootDir,
      "test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-prod.txt",
    ),
  );

  const lungSheets = lungMdtDecisionSheets();
  const lungWs = buildLungMdtWorkspace(xsd, lungScript);
  patchLung(lungWs, lungSheets);
  writeSet(
    join(rootDir, "test/fixtures/lung-MDT-form-decision-tables/mapping"),
    lungWs,
    lungSheets,
  );
  lungWs.dispose();

  if (!Deno.args.includes("--only=lung")) {
  const chemoSheets = chemoDecisionSheets();
  const chemoWs = buildChemoSymptomsWorkspace(xsd, chemoScript);
  patchChemo(chemoWs, chemoSheets);
  writeSet(
    join(rootDir, "test/fixtures/patient-reported-chemotherapy-symptoms-decision-tables/mapping"),
    chemoWs,
    chemoSheets,
  );
  chemoWs.dispose();
  }
  console.log(
    Deno.args.includes("--only=lung")
      ? "Wrote lung-MDT decision-table sibling mapping"
      : "Wrote lung-MDT and chemo decision-table sibling mappings",
  );
}
