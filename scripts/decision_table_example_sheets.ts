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

export function lungMdtDecisionSheets(): SheetDocument[] {
  return [
    firstValue("imaging_term", ["modality", "term_id"], [
      ["MR", "12683"],
      ["Ultraljud", "4829"],
      ["—", "59"],
    ], 1, 2),
    firstValue("smoking_note", ["status", "snippet"], [
      ["Har aldrig rökt", "{{status}}"],
      [
        "—",
        "{{status}} ({{typ}})\n{{#paketår}}Paketår: {{.}}\n{{/paketår}}{{#slutdatum}}Slutade: {{.}}\n{{/slutdatum}}{{#kommentar}}Kommentar: {{.}}\n{{/kommentar}}",
      ],
    ], 1, 1),
    firstValue("treatment_connector", ["relation", "has_huvud", "snippet"], [
      ["Adjuvant", "true", "Följt av"],
      ["Neoadjuvant", "true", "Föregått av"],
      ["Perioperativ", "true", "Rekommenderas också tilläggsbehandling i form av"],
      ["—", "true", "Patienten rekommenderas"],
      ["Adjuvant", "false", "Följt av adjuvant behandling."],
      ["—", "—", ""],
    ], 2, 5),
    firstValue("regimen_phrase", ["has_regim", "has_antal", "has_annan", "snippet"], [
      ["true", "true", "—", " enligt regim {{regim}}, {{antal_kurer}} kurer."],
      ["true", "—", "—", " enligt regim {{regim}}."],
      ["—", "true", "—", ", {{antal_kurer}} kurer."],
      ["—", "—", "true", " enligt regim {{annan_regim}}."],
      ["—", "—", "—", "."],
    ], 3, 4),
    firstValue("dose_phrase", ["has_fraktion", "has_total", "snippet"], [
      ["true", "true", "Fraktionsdos: {{fraktion}} {{fraktion_unit}}, Totaldos: {{total}} {{total_unit}}."],
      ["true", "—", "Fraktionsdos: {{fraktion}} {{fraktion_unit}}."],
      ["—", "true", "Totaldos: {{total}} {{total_unit}}."],
      ["—", "—", ""],
    ], 2, 3),
    firstValue("chemoradiation_form", ["typ", "has_form", "snippet"], [
      ["Kemoradioterapi", "true", "{{form}} "],
      ["—", "—", ""],
    ], 2, 1),
    firstValue(
      "treatment_frame",
      ["has_intention", "has_huvud", "has_relation", "has_tillägg", "snippet"],
      [
        [
          "true",
          "true",
          "true",
          "true",
          "Patienten rekommenderas {{intention}} {{form}}{{huvud}}{{regimen}} {{connector}} {{relation}} {{tillägg}}",
        ],
        ["true", "true", "—", "—", "Patienten rekommenderas {{intention}} {{form}}{{huvud}}{{regimen}}"],
        ["—", "true", "—", "—", "Patienten rekommenderas {{form}}{{huvud}}{{regimen}}"],
        ["true", "—", "—", "—", "Patienten rekommenderas {{intention}}."],
        ["—", "—", "true", "true", "{{connector}} {{relation}} {{tillägg}}"],
        ["—", "—", "—", "—", ""],
      ],
      4,
      5,
    ),
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
