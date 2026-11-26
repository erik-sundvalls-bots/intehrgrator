/**
 * Chemo symptom Note texts as portable Mapping Expressions (#386).
 *
 * The first chemo example sets were converted once from the production Go
 * mapping script, so each `<Note>` held raw Go `text/template` source in a
 * Code text block. That leaked Go into preview, Handlebars, TypeScript and
 * XQuery output. Here every Note is rebuilt from ordinary blocks (text join,
 * if/then/else, compare, lower case, regex replace) and one Function,
 * `clean_free_text`, that replaces the PROD `cleanAndQuoteFreeTextInput`
 * define. XML escaping is done by every generator, so the define's manual
 * `&amp;`/`&lt;` step is not repeated.
 */

const P = "patientrapporterade_symptom_inför_medicinsk_onkologisk_behandling";
const Q = `${P}/frågeformulär_för_symptom_och_andra_tecken/ospecificerad_händelse:0`;

/** Name of the shared Function that cleans patient free text. */
export const CLEAN_FREE_TEXT_FUNCTION = "clean_free_text";
export const CLEAN_FREE_TEXT_PARAM = "text";

/** Characters PROD keeps: printable ASCII plus Latin-1 letters and signs (µ kept as-is). */
export const ALLOWED_FREE_TEXT_CLASS =
  "[^ -~€¡¢£¤¥§¨¯´µ¶·¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþ]";

/** Body of `clean_free_text(text)`: newlines → space, drop odd characters, collapse spaces, trim. */
export function cleanFreeTextBody(param: string): string {
  const step1 = `regex_replace(${param}, "[\\\\n\\\\r\\\\t]", " ")`;
  const step2 = `regex_replace(${step1}, ${JSON.stringify(ALLOWED_FREE_TEXT_CLASS)}, "")`;
  const step3 = `regex_replace(${step2}, " +", " ")`;
  return `trim(${step3})`;
}

const s = (path: string) => `xpathString(${JSON.stringify(path)})`;
const q = (rel: string) => s(`${Q}/${rel}`);
const lit = (text: string) => JSON.stringify(text);
const join = (...parts: string[]) => parts.length === 1 ? `concat(${parts[0]}, "")` : `concat(${parts.join(", ")})`;
const when = (cond: string, then: string, otherwise = '""') => `if(${cond}, ${then}, ${otherwise})`;
const eq = (rel: string, value: string) => `eq(${q(rel)}, ${lit(value)})`;
const ne = (rel: string, value: string) => `ne(${q(rel)}, ${lit(value)})`;
/** Has a value: joined to "" first so a number and a missing value compare as text in every language. */
const present = (path: string) => `ne(concat(${s(path)}, ""), "")`;
const lower = (expr: string) => `change_case(${expr}, "LOWERCASE")`;
/** Cleaned free text in double quotes, as PROD `cleanAndQuoteFreeTextInput` printed it. */
export const quoted = (expr: string) => join(lit('"'), `call(${lit(CLEAN_FREE_TEXT_FUNCTION)}, ${expr})`, lit('"'));
const quotedQ = (rel: string) => quoted(q(rel));
const sentence = (rel: string) => join(q(rel), lit("."));
const ownTreatment = (rel: string) =>
  join(lit(" Patientens kommentar angående egen behandling: "), quotedQ(rel), lit("."));

const NAILS = "naglar/följdfråga/hur_bedömer_du_förändringarna_av_naglarna|value";
const TINGLE = "stickningar_pirrningar_domningar";

/** Note expression per TakeCare TermId (same order and meaning as PROD 1.9.1). */
export const CHEMO_NOTE_EXPRESSIONS: Record<string, string> = {
  "16183": lit("Patienten rapporterar inga symptom."),
  "2811": when(
    eq("trötthet/upplever_du_trötthet_fatigue_som_påverkar_ditt_dagliga_liv|value", "Ja"),
    sentence("trötthet/följdfråga/hur_påverkar_tröttheten_ditt_dagliga_liv|value"),
  ),
  "1830": sentence("andning/följdfråga/vilka_svårigheter_upplever_du_med_din_andning|value"),
  "6298": join(
    lit("Patientens kommentar angående besvär från hjärttrakten: "),
    quotedQ("besvär_kring_hjärttrakten/följdfråga/beskriv_de_besvär_du_upplever_kring_hjärttrakten"),
    lit("."),
  ),
  "7643": join(
    when(
      eq("svullnad/följdfråga/hur_upplever_du_dina_besvär_med_svullnad_i_kroppen|code", "at0.3"),
      lit("Svåra besvär, svårt att röra sig."),
      sentence("svullnad/följdfråga/hur_upplever_du_dina_besvär_med_svullnad_i_kroppen|value"),
    ),
    lit(" Patientens kommentar angående lokalisation: "),
    quotedQ("svullnad/följdfråga_2/var_på_kroppen_är_du_svullen"),
    lit("."),
  ),
  "207": join(
    sentence("utslag_eller_hudrodnad/följdfråga/hur_upplever_du_dina_besvär_med_utslag_eller_hudrodnad|value"),
    lit(" Patientens kommentar angående lokalisation: "),
    quotedQ("utslag_eller_hudrodnad/följdfråga/följdfråga/var_på_kroppen_har_du_utslag_eller_rodnad"),
    lit("."),
  ),
  // "Svåra, t.ex. …" → "Svåra nagelbesvär, t.ex. …." (PROD cut the grade word with byte offsets).
  "7570": join(
    `regex_replace(${q(NAILS)}, ",.*$", "")`,
    lit(" nagelbesvär"),
    `regex_replace(${q(NAILS)}, "^[^,]+", "")`,
    lit("."),
  ),
  "1921": join(
    sentence("klåda/följdfråga/hur_upplever_du_dina_besvär_med_klåda|value"),
    when(
      eq("klåda/följdfråga_2/har_du_behandlat_din_klåda_på_något_sätt|value", "Ja"),
      ownTreatment("klåda/följdfråga_2/följdfråga/hur_har_du_behandlat_din_klåda_och_vad_har_det_haft_för_effekt"),
    ),
  ),
  "2018": sentence("mun_svalg/följdfråga/hur_upplever_du_dina_besvär_i_mun_svalg|value"),
  "5464": `trim(${
    join(
      when(ne("aptit/upplever_du_förändrad_aptit|code", "3"), join(sentence("aptit/upplever_du_förändrad_aptit|value"), lit(" "))),
      when(ne("matintag/hur_har_ditt_matintag_förändrats|code", "3"), sentence("matintag/hur_har_ditt_matintag_förändrats|value")),
    )
  })`,
  "1908": join(
    q("illamående/följdfråga1/hur_upplever_du_dina_besvär_av_illamående|value"),
    lit(" besvär av illamående."),
    when(ne("illamående/kräkning/kräks_du|value", "Nej"), join(lit(" "), sentence("illamående/kräkning/kräks_du|value"))),
    when(
      eq("illamående/följdfråga2/har_du_behandlat_ditt_illamående_på_något_sätt|value", "Ja"),
      ownTreatment("illamående/följdfråga2/följdfråga3/hur_har_du_behandlat_ditt_illamående_och_vad_har_det_haft_för_effekt:0"),
    ),
  ),
  "1875": `trim(${
    join(
      when(eq("diarréer/har_du_problem_med_diarréer|value", "Ja"), sentence("diarréer/följdfråga/hur_ofta_har_du_diarré|value")),
      when(
        eq("diarréer/följdfråga_2/upplever_du_smärta_i_samband_med_diaréer|value", "Ja"),
        lit(" Upplever smärta i samband med diarréer."),
      ),
      when(
        eq("diarréer/följdfråga_3/har_du_behandlat_dina_diarréer_på_något_sätt|value", "Ja"),
        ownTreatment("diarréer/följdfråga_3/följdfråga/hur_har_du_behandlat_dina_diarréer_och_vad_har_det_haft_för_effekt"),
      ),
      when(eq("förstoppning/har_du_förstoppning|value", "Ja"), lit(" Upplever besvär med förstoppning.")),
      when(
        eq("förstoppning/följdfråga/har_du_behandlat_din_förstoppning_på_något_sätt|value", "Ja"),
        ownTreatment("förstoppning/följdfråga/följdfråga/hur_har_du_behandlat_din_förstoppning_och_vad_har_det_haft_för_effekt"),
      ),
    )
  })`,
  "2008": join(
    lit("Upplever värk i muskler och/eller leder."),
    when(
      eq("smärta/följdfråga/har_du_behandlat_din_värk_på_något_sätt|value", "Ja"),
      ownTreatment("smärta/följdfråga/följdfråga/hur_har_du_behandlat_din_värk_och_vad_har_det_haft_för_effekt"),
    ),
  ),
  "2310": join(
    when(
      eq(`${TINGLE}/följdfråga/varaktighet/är_stickningarna_pirrningarna_domningarna_ihållande_mest_hela_tiden|value`, "Ja"),
      join(lit("Ihållande, "), lower(q(`${TINGLE}/följdfråga/hur_upplever_du_dina_besvär_av_pirrningar_domningar|value`)), lit(".")),
      sentence(`${TINGLE}/följdfråga/hur_upplever_du_dina_besvär_av_pirrningar_domningar|value`),
    ),
    when(
      eq(`${TINGLE}/följdfråga/uppstod_i_samband_med_kyla/uppstod_symptomen_i_samband_med_kyla|value`, "Ja"),
      lit(" Symptomen uppstod i samband med kyla."),
    ),
    when(
      eq(`${TINGLE}/anatomisk_lokalisation/var_upplever_du_dessa_symptom|code`, "4"),
      join(
        lit(" Patientens kommentar angående lokalisation: "),
        quotedQ(`${TINGLE}/anatomisk_lokalisation/specificera_kroppsdel/om_annan_kroppsdel_specificera_var:0`),
        lit("."),
      ),
      join(lit(" Lokalisation: "), sentence(`${TINGLE}/anatomisk_lokalisation/var_upplever_du_dessa_symptom|value`)),
    ),
    when(
      eq(`${TINGLE}/upplever_du_stickningar_eller_pirrningar_domningar|value`, "Ja"),
      join(
        lit(" Antal dagar med symptom: "),
        sentence(`${TINGLE}/följdfråga/antal_dagar/hur_många_dagar_har_du_haft_dessa_symptom`),
      ),
    ),
    when(
      eq(
        `${TINGLE}/följdfråga/konsekvenser_händer/upplever_du_att_du_är_fumlig_t.ex._har_lätt_för_att_tappa_saker_svårt_att_greppa_saker|value`,
        "Ja",
      ),
      lit(" Upplever sig fumlig."),
    ),
    when(eq(`${TINGLE}/följdfråga/konsekvenser_händer/kan_du_knäppa_knappar|value`, "Nej"), lit(" Kan ej knäppa knappar.")),
    when(eq(`${TINGLE}/följdfråga/konsekvenser_händer/kan_du_skriva_ditt_namn|value`, "Nej"), lit(" Kan ej skriva sitt namn.")),
    when(
      eq(`${TINGLE}/följdfråga/konsekvenser_fötter/har_du_svårt_att_gå_och_hålla_balans.|value`, "Ja"),
      lit(" Svårigheter att gå och hålla balansen."),
    ),
  ),
  "14768": `trim(${
    join(
      when(
        eq(
          "generella_behandlingsrelaterade_frågor/har_något_eller_några_av_de_symptom_du_skattat_förvärrats_sedan_föregående_behandling|value",
          "Ja",
        ),
        join(lit("Förvärrade symptom: "), quotedQ("generella_behandlingsrelaterade_frågor/vilka_symptom_har_förvärrats"), lit(". ")),
      ),
      when(
        eq(
          "generella_behandlingsrelaterade_frågor/har_du_ytterligare_biverkningar_som_du_vill_förmedla_eller_förtydliga_för_oss|value",
          "Ja",
        ),
        join(
          lit("Ytterligare biverkningar: "),
          quotedQ("generella_behandlingsrelaterade_frågor/beskriv_vilka_ytterligare_biverkningar"),
          lit(". "),
        ),
      ),
      when(
        eq("generella_behandlingsrelaterade_frågor/har_du_någon_fråga_inför_kommande_behandling|value", "Ja"),
        join(lit("Frågor angående behandlingen: "), quotedQ("generella_behandlingsrelaterade_frågor/beskriv_din_fråga"), lit(".")),
      ),
    )
  })`,
  "13700": s(`${P}/_uid`),
  // PROD always appended the measured value line; here it appears only when a value exists.
  "2025": join(
    lit("Har haft en kroppstemperatur över 38 C senaste dygnet."),
    when(
      present(`${P}/kroppstemperatur/ospecificerad_händelse:0/ange_kroppstemperatur|magnitude`),
      join(
        lit(" Uppmätt kroppstemperatur senaste dygnet: "),
        s(`${P}/kroppstemperatur/ospecificerad_händelse:0/ange_kroppstemperatur|magnitude`),
        lit(" C"),
      ),
    ),
  ),
  "3484": join(
    lit("Patienten anger att kroppsvikten har "),
    lower(q("vikt/följdfråga/hur_har_den_förändrats|value")),
    lit("."),
    when(
      present(`${P}/kroppsvikt/ospecificerad_händelse:0/ange_kroppsvikt|magnitude`),
      join(
        lit(" Rapporterad kroppsvikt: "),
        s(`${P}/kroppsvikt/ospecificerad_händelse:0/ange_kroppsvikt|magnitude`),
        s(`${P}/kroppsvikt/ospecificerad_händelse:0/ange_kroppsvikt|unit`),
      ),
    ),
  ),
};

/** Flat source key the DT sibling passes through `clean_free_text`. */
export function chemoNoteExpression(termId: string): string {
  const expr = CHEMO_NOTE_EXPRESSIONS[termId];
  if (!expr) throw new Error(`no Note expression for TermId ${termId}`);
  return expr;
}
