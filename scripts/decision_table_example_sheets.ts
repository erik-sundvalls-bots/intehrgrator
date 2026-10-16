/**
 * Decision-table grids for #70 sibling Example Sets (lung-MDT Handlebars and
 * chemo Go). Snippet cells are VMS-Mustache only — no `#if (eq` / `{{if eq`.
 */
import { normalizeSheet } from "../src/core/sheets/mod.ts";
import type { SheetDocument } from "../src/core/sheets/types.ts";

function firstValue(
  name: string,
  headers: string[],
  values: Array<Array<string | number | boolean | null>>,
  conditionCount: number,
  catchAllRow = -1,
): SheetDocument {
  return normalizeSheet({
    name,
    kind: "decision-table",
    hitPolicy: "FIRST",
    collectJoin: "; ",
    headers,
    values,
    columnTypes: headers.map(() => "text"),
    decisionColumns: headers.map((header, i) => {
      if (i < conditionCount) return { role: "condition" as const };
      if (header === "term_id") {
        // TextKeyWord/DatetimeKeyword TermId mouths are Number.
        return { role: "output" as const, outputKind: "value" as const, valueType: "number" as const };
      }
      return { role: "output" as const, outputKind: "snippet" as const };
    }),
    rowCatchAll: values.map((_, i) => i === catchAllRow),
  });
}

/**
 * Shared imaging Note. One VMS-Mustache walk of `studies` (the bilddiagnostik
 * array, or the single study object). Sections replace `#if (or …)` / `#each`.
 * Laterality is the source value; the old helper lowercased it.
 */
const IMAGING_NOTE =
  "{{#studies}}{{#bilddiagnostiskt_resultat}}{{#typ_av_undersökning}}{{[|value]}}{{[|other]}}, {{#../anatomisk_lokalisation_för_undersökning}}{{[|value]}}{{/../anatomisk_lokalisation_för_undersökning}}\n{{/typ_av_undersökning}}{{#datum}}{{[|value]}}\n{{/datum}}{{#bilddiagnostisk_undersökning_av_misstänkt_primärtumör}}{{#anatomisk_lokalisation_misstänkt_primärtumör}}{{#namn_på_kroppsställe}}Misstänkt primärtumör: {{[|value]}}{{[|other]}}\n{{/namn_på_kroppsställe}}{{/anatomisk_lokalisation_misstänkt_primärtumör}}{{^anatomisk_lokalisation_misstänkt_primärtumör}}{{#kommentar}}Misstänkt primärtumör:\n{{/kommentar}}{{/anatomisk_lokalisation_misstänkt_primärtumör}}{{#fysiska_dimensioner}}{{#diameter_största_tumör}}Diameter största tumör: {{[|magnitude]}}{{[|unit]}}\n{{/diameter_största_tumör}}{{/fysiska_dimensioner}}{{#multifokalitet}}Multifokal: {{[|value]}}\n{{/multifokalitet}}{{#kommentar}}Kommentar: {{[|value]}}\n{{/kommentar}}{{/bilddiagnostisk_undersökning_av_misstänkt_primärtumör}}{{#bilddiagnostisk_undersökning_av_misstänkta_lymfkörtelmetastaser.[0]}}\nMisstänkta lymfkörtelmetastaser:\n{{/bilddiagnostisk_undersökning_av_misstänkta_lymfkörtelmetastaser.[0]}}{{#bilddiagnostisk_undersökning_av_misstänkta_lymfkörtelmetastaser}}{{#anatomisk_lokalisation_misstänkta_lymfkörtelmetastaser}}{{#namn_på_kroppsställe}}{{[|value]}}{{[|other]}} {{/namn_på_kroppsställe}}{{#lateralitet}}{{[|value]}}{{/lateralitet}}\n{{/anatomisk_lokalisation_misstänkta_lymfkörtelmetastaser}}{{#kommentar}}Kommentar: {{[|value]}}\n{{/kommentar}}{{/bilddiagnostisk_undersökning_av_misstänkta_lymfkörtelmetastaser}}{{#bilddiagnostisk_undersökning_av_misstänkta_fjärrmetastaser.[0]}}\nMisstänkta fjärrmetastaser:\n{{/bilddiagnostisk_undersökning_av_misstänkta_fjärrmetastaser.[0]}}{{#bilddiagnostisk_undersökning_av_misstänkta_fjärrmetastaser}}{{#anatomisk_lokalisation_misstänkta_fjärrmetastaser}}{{#namn_på_kroppsställe}}{{[|value]}}{{[|other]}} {{/namn_på_kroppsställe}}{{#lateralitet}}{{[|value]}}{{/lateralitet}}\n{{/anatomisk_lokalisation_misstänkta_fjärrmetastaser}}{{#kommentar}}Kommentar: {{[|value]}}\n{{/kommentar}}{{/bilddiagnostisk_undersökning_av_misstänkta_fjärrmetastaser}}{{#kommentar}}\nÖvergripande kommentar: {{[|value]}}\n{{/kommentar}}{{/bilddiagnostiskt_resultat}}{{#kompletterande_bilddiagnostik_hjärna}}{{#datum}}\nKompletterande bilddiagnostik hjärna: {{[|value]}}\n{{/datum}}{{#typ_av_undersökning}}{{#[|other]}}Typ av undersökning: {{[|other]}}\n{{/[|other]}}{{^[|other]}}{{#[|value]}}Typ av undersökning: {{[|value]}}\n{{/[|value]}}{{/[|other]}}{{/typ_av_undersökning}}{{#antal_förekomster_av_ett_observerat_fynd}}{{#antal_lesioner_i_hjärnan}}Antal funna metastaser hjärna: {{[|value]}}\n{{/antal_lesioner_i_hjärnan}}{{/antal_förekomster_av_ett_observerat_fynd}}{{#kommentar}}Kommentar: {{[|value]}}\n{{/kommentar}}{{/kompletterande_bilddiagnostik_hjärna}}{{/studies}}";

export function lungMdtDecisionSheets(): SheetDocument[] {
  return [
    firstValue("imaging_term", ["modality", "term_id"], [
      ["MR", "12683"],
      ["Ultraljud", "4829"],
      ["—", "59"],
    ], 1, 2),
    firstValue("imaging_note", ["ready", "note"], [
      ["—", IMAGING_NOTE],
    ], 1, 0),
    firstValue("smoking_note", ["status", "snippet"], [
      ["Har aldrig rökt", "{{status}}"],
      [
        "—",
        "{{status}} ({{typ}})\n{{#paketår}}Paketår: {{.}}\n{{/paketår}}{{#slutdatum}}Slutade: {{.}}\n{{/slutdatum}}{{#kommentar}}Kommentar: {{.}}\n{{/kommentar}}",
      ],
    ], 1, 1),
    // Regimen suffix. `style` only changes the antal-only row (comma vs space);
    // the production script uses both. Every non-empty suffix ends with ". ".
    firstValue(
      "regimen_phrase",
      ["style", "has_regim", "has_antal", "has_annan", "has_typ", "snippet"],
      [
        ["—", "true", "true", "—", "—", " enligt regim {{regim}}, {{antal_kurer}} kurer. "],
        ["—", "true", "—", "—", "—", " enligt regim {{regim}}. "],
        ["comma", "—", "true", "—", "—", ", {{antal_kurer}} kurer. "],
        ["space", "—", "true", "—", "—", " {{antal_kurer}} kurer. "],
        ["—", "—", "—", "true", "—", " enligt regim {{annan_regim}}. "],
        ["—", "—", "—", "—", "true", ". "],
        ["—", "—", "—", "—", "—", ""],
      ],
      5,
      6,
    ),
    firstValue("dose_phrase", ["has_fraktion", "has_total", "snippet"], [
      ["true", "true", "Fraktionsdos: {{fraktion}} {{fraktion_unit}}, Totaldos: {{total}} {{total_unit}}."],
      ["true", "—", "Fraktionsdos: {{fraktion}} {{fraktion_unit}}."],
      ["—", "true", "Totaldos: {{total}} {{total_unit}}."],
      ["—", "—", ""],
    ], 2, 3),
    // Lowercased form, only when the type is Kemoradioterapi and a form is filled.
    firstValue("chemoradiation_form", ["typ", "has_form", "snippet"], [
      ["Kemoradioterapi", "true", "{{form_l}} "],
      ["—", "—", ""],
    ], 2, 1),
    firstValue("follow_glue", ["relation", "snippet"], [
      ["Adjuvant", "Följt av"],
      ["Neoadjuvant", "Föregått av"],
      ["Perioperativ", "Rekommenderas också tilläggsbehandling i form av"],
      ["—", "Patienten rekommenderas"],
    ], 1, 3),
    // intention + huvud + relation, and the tillägg type is absent.
    firstValue("relation_tail", ["relation", "snippet"], [
      ["Adjuvant", "Följt av adjuvant behandling."],
      ["Neoadjuvant", "Föregått av neoadjuvant behandling."],
      ["Perioperativ", "Rekommenderas också perioperativ behandling."],
      ["—", "Relation till huvudbehandling: {{relation_l}}."],
    ], 1, 3),
    // huvud + relation, no intention and no tillägg type. Perioperativ has no period.
    firstValue("huvud_relation_tail", ["relation", "snippet"], [
      ["Adjuvant", "Följt av adjuvant behandling."],
      ["Neoadjuvant", "Föregått av neoadjuvant behandling."],
      ["Perioperativ", "Rekommenderas också perioperativ tilläggsbehandling."],
      ["—", ""],
    ], 1, 3),
    firstValue("intention_closing", ["intention", "snippet"], [
      ["Best supportive care (BSC)", " {{intention}}."],
      ["—", " {{intention_l}} behandling."],
    ], 1, 1),
    // Presence combination of intention / huvud / relation / tillägg. FIRST, most
    // specific row wins. Display words arrive already lowercased.
    firstValue(
      "treatment_frame",
      ["has_intention", "has_huvud", "has_relation", "has_tillägg", "snippet"],
      [
        ["true", "true", "true", "true", "Patienten rekommenderas {{intention_l}} {{huvud_form}}{{huvud_typ}}{{huvud_regimen_comma}}{{huvud_dose}} {{follow_glue}} {{relation_l}} {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["false", "true", "true", "true", "Patienten rekommenderas {{huvud_form}}{{huvud_typ}}{{huvud_regimen_comma}}{{huvud_dose}} {{follow_glue}} {{relation_l}} {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["true", "false", "true", "true", "Patienten rekommenderas {{intention_l}} behandling. {{follow_glue}} {{relation_l}} {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["false", "false", "true", "true", "Patienten rekommenderas {{relation_l}} {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["true", "true", "false", "true", "Patienten rekommenderas {{intention_l}} {{huvud_form}}{{huvud_typ}}{{huvud_regimen_comma}}{{huvud_dose}} Tillsammans med {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["true", "true", "true", "false", "Patienten rekommenderas {{intention_l}} {{huvud_form}}{{huvud_typ}}{{huvud_regimen_comma}}{{huvud_dose}} {{relation_tail}}"],
        ["true", "true", "false", "false", "Patienten rekommenderas {{intention_l}} {{huvud_form}}{{huvud_typ}}{{huvud_regimen_comma}}{{huvud_dose}}"],
        ["true", "false", "false", "true", "Patienten rekommenderas {{intention_l}} {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_comma}}{{tillägg_dose}}"],
        ["true", "false", "true", "false", "Patienten rekommenderas {{intention_l}} {{relation_l}} behandling."],
        ["false", "true", "false", "true", "Patienten rekommenderas {{huvud_form}}{{huvud_typ}}{{huvud_regimen_space}}{{huvud_dose}} Tillsammans med {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_space}}{{tillägg_dose}}"],
        ["false", "true", "true", "false", "Patienten rekommenderas {{huvud_form}}{{huvud_typ}}{{huvud_regimen_space}}{{huvud_dose}} {{huvud_relation_tail}}"],
        ["false", "true", "false", "false", "Patienten rekommenderas {{huvud_form}}{{huvud_typ}}{{huvud_regimen_space}}{{huvud_dose}}"],
        ["false", "false", "false", "true", "Patienten rekommenderas {{tillägg_form}}{{tillägg_typ}}{{tillägg_regimen_space}}{{tillägg_dose}}"],
        ["false", "false", "true", "false", "Patienten rekommenderas {{relation_l}} tilläggsbehandling."],
        ["true", "false", "false", "false", "Patienten rekommenderas{{intention_closing}}"],
        ["—", "—", "—", "—", ""],
      ],
      4,
      15,
    ),
    firstValue("treatment_note", ["ready", "note"], [
      ["—", "{{sentence}}{{#huvud_kommentar}}\nDetaljer om huvudbehandling: {{.}}\n{{/huvud_kommentar}}{{#tillägg_kommentar}}\nDetaljer om tilläggsbehandling: {{.}}\n{{/tillägg_kommentar}}{{#strategi_kommentar}}\nKommentar om behandlingsstrategi: {{.}}\n{{/strategi_kommentar}}{{#vidare}}\nVidare utredning: {{.}}\n{{/vidare}}"],
    ], 1, 0),
  ];
}

const Q =
  "patientrapporterade_symptom_inför_medicinsk_onkologisk_behandling/frågeformulär_för_symptom_och_andra_tecken/ospecificerad_händelse:0";

export const CHEMO_FLAT = {
  fatigueAnswer: `${Q}/trötthet/upplever_du_trötthet_fatigue_som_påverkar_ditt_dagliga_liv|value`,
  fatigueFollowup:
    `${Q}/trötthet/följdfråga/hur_påverkar_tröttheten_ditt_dagliga_liv|value`,
  swellingCode:
    `${Q}/svullnad/följdfråga/hur_upplever_du_dina_besvär_med_svullnad_i_kroppen|code`,
  swellingValue:
    `${Q}/svullnad/följdfråga/hur_upplever_du_dina_besvär_med_svullnad_i_kroppen|value`,
  swellingLocation: `${Q}/svullnad/följdfråga_2/var_på_kroppen_är_du_svullen`,
  itchTreated: `${Q}/klåda/följdfråga_2/har_du_behandlat_din_klåda_på_något_sätt|value`,
  itchSeverity: `${Q}/klåda/följdfråga/hur_upplever_du_dina_besvär_med_klåda|value`,
  itchTreatment:
    `${Q}/klåda/följdfråga_2/följdfråga/hur_har_du_behandlat_din_klåda_och_vad_har_det_haft_för_effekt`,
} as const;

export function chemoDecisionSheets(): SheetDocument[] {
  return [
    firstValue("fatigue_note", ["answer", "snippet"], [
      ["Ja", "{{followup}}."],
      ["—", ""],
    ], 1, 1),
    firstValue("swelling_note", ["code", "snippet"], [
      ["at0.3", "Svåra besvär, svårt att röra sig. Patientens kommentar angående lokalisation: \"{{location}}\"."],
      ["—", "{{severity}}. Patientens kommentar angående lokalisation: \"{{location}}\"."],
    ], 1, 1),
    firstValue("itch_note", ["treated", "snippet"], [
      ["Ja", "{{severity}}. Patientens kommentar angående egen behandling: \"{{treatment}}\"."],
      ["—", "{{severity}}."],
    ], 1, 1),
  ];
}

export function assertVmsMustacheSnippets(sheets: SheetDocument[]): string[] {
  const bad: string[] = [];
  for (const sheet of sheets) {
    const kinds = sheet.decisionColumns ?? [];
    for (const [r, row] of sheet.values.entries()) {
      for (const [c, cell] of row.entries()) {
        if (kinds[c]?.outputKind !== "snippet") continue;
        const text = String(cell ?? "");
        if (/\{\{#if\s+\(eq/.test(text) || /\{\{if\s+eq/.test(text) || /#if \(eq/.test(text)) {
          bad.push(`${sheet.name} r${r}c${c}: nested if eq in snippet`);
        }
      }
    }
  }
  return bad;
}
