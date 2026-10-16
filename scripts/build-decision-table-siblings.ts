/**
 * Build #70 sibling Example Sets: lung-MDT and chemo decision-table mappings.
 *
 *   deno run -A --no-check scripts/build-decision-table-siblings.ts
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

function filled(workspace: Blockly.Workspace, path: string): Blockly.Block {
  const cmp = workspace.newBlock("logic_compare");
  cmp.setFieldValue("NEQ", "OP");
  cmp.getInput("A")?.connection?.connect(source(workspace, path).outputConnection!);
  const empty = workspace.newBlock("text");
  empty.setFieldValue("", "TEXT");
  cmp.getInput("B")?.connection?.connect(empty.outputConnection!);
  return cmp;
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

function statementRoot(block: Blockly.Block): Blockly.Block {
  let current = block;
  while (current.getParent()?.type === "controls_if") current = current.getParent()!;
  return current;
}

function textKeywords(workspace: Blockly.Workspace): Blockly.Block[] {
  return workspace.getAllBlocks(false).filter((item) => item.type === "schema_TextKeyWord");
}

const LUNG = {
  modality:
    "$.granskning.utredning_undersökning[0].bilddiagnostik[0].bilddiagnostiskt_resultat[0].typ_av_undersökning[0]['|value']",
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
  intention:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].intention[0]['|value']",
  huvud:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].typ_av_behandling[0]['|value']",
  form:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].form_av_kemoradioterapi[0]['|value']",
  relation:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].tilläggsbehandling[0].relation_till_huvudbehandling[0]['|value']",
  tillägg:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].tilläggsbehandling[0].typ_av_behandling[0]['|value']",
  huvRegim:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].regim[0]['|value']",
  huvAntal:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].antal_kurer[0]['|value']",
  huvAnnan:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].annan_regim[0]['|value']",
  fraktion:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].fraktionsdos[0]['|magnitude']",
  fraktionUnit:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].fraktionsdos[0]['|unit']",
  total:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].totaldos[0]['|magnitude']",
  totalUnit:
    "$.granskning.gemensamt_beslut[0].multidisciplinär_handläggning_vid_cancer[0].rekommenderad_behandlingsstrategi[0].huvudbehandling[0].totaldos[0]['|unit']",
};

function patchLung(workspace: Blockly.Workspace, sheets: SheetDocument[]): void {
  setWorkspaceSheetsProvider(() => sheets);

  const keywords = textKeywords(workspace);
  const byTerm = new Map(keywords.map((block) => [termIdOf(block), block]));
  const imaging = byTerm.get("12683");
  if (!imaging) throw new Error("missing imaging keyword 12683");
  fillValue(
    imaging,
    targetChildInputName("TermId"),
    decisionEval(workspace, "imaging_term", "term_id", [
      ["modality", source(workspace, LUNG.modality)],
    ]),
  );
  const wrap = statementRoot(imaging);
  if (wrap.type === "controls_if") {
    const old = wrap.getInputTargetBlock("IF0");
    if (old) old.dispose(false);
    wrap.getInput("IF0")?.connection?.connect(source(workspace, LUNG.modality, "boolean").outputConnection!);
  }
  for (const extra of ["4829", "59"]) {
    const block = byTerm.get(extra);
    if (block) statementRoot(block).dispose(true);
  }

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
  const connector = decisionEval(workspace, "treatment_connector", "snippet", [
    ["relation", source(workspace, LUNG.relation)],
    ["has_huvud", filled(workspace, LUNG.huvud)],
  ]);
  const regimen = decisionEval(workspace, "regimen_phrase", "snippet", [
    ["has_regim", filled(workspace, LUNG.huvRegim)],
    ["has_antal", filled(workspace, LUNG.huvAntal)],
    ["has_annan", filled(workspace, LUNG.huvAnnan)],
    ["regim", source(workspace, LUNG.huvRegim)],
    ["antal_kurer", source(workspace, LUNG.huvAntal)],
    ["annan_regim", source(workspace, LUNG.huvAnnan)],
  ]);
  const dose = decisionEval(workspace, "dose_phrase", "snippet", [
    ["has_fraktion", filled(workspace, LUNG.fraktion)],
    ["has_total", filled(workspace, LUNG.total)],
    ["fraktion", source(workspace, LUNG.fraktion)],
    ["fraktion_unit", source(workspace, LUNG.fraktionUnit)],
    ["total", source(workspace, LUNG.total)],
    ["total_unit", source(workspace, LUNG.totalUnit)],
  ]);
  const form = decisionEval(workspace, "chemoradiation_form", "snippet", [
    ["typ", source(workspace, LUNG.huvud)],
    ["has_form", filled(workspace, LUNG.form)],
    ["form", source(workspace, LUNG.form)],
  ]);
  fillValue(
    treatment,
    targetChildInputName("Note"),
    decisionEval(workspace, "treatment_frame", "snippet", [
      ["has_intention", filled(workspace, LUNG.intention)],
      ["has_huvud", filled(workspace, LUNG.huvud)],
      ["has_relation", filled(workspace, LUNG.relation)],
      ["has_tillägg", filled(workspace, LUNG.tillägg)],
      ["intention", source(workspace, LUNG.intention)],
      ["huvud", source(workspace, LUNG.huvud)],
      ["relation", source(workspace, LUNG.relation)],
      ["tillägg", source(workspace, LUNG.tillägg)],
      ["connector", connector],
      ["regimen", regimen],
      ["dose", dose],
      ["form", form],
    ]),
  );
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

  const chemoSheets = chemoDecisionSheets();
  const chemoWs = buildChemoSymptomsWorkspace(xsd, chemoScript);
  patchChemo(chemoWs, chemoSheets);
  writeSet(
    join(rootDir, "test/fixtures/patient-reported-chemotherapy-symptoms-decision-tables/mapping"),
    chemoWs,
    chemoSheets,
  );
  chemoWs.dispose();
  console.log("Wrote lung-MDT and chemo decision-table sibling mappings");
}
