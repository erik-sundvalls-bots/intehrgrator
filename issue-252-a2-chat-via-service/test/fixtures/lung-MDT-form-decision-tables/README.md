# Lung MDT form — decision-table sibling (#70)

Sibling of [`../lung-MDT-form/`](../lung-MDT-form/). **Do not edit** the original
Handlebars gold directory or catalog id `lung-mdt-form-to-tc-xml`.

This set keeps the TakeCare XSD, Defaults Map, and PROD Handlebars script as
references. Combinational Note / TermId logic is authored as Decision tables
(`kind: "decision-table"`) with VMS-Mustache snippet cells (no `#if (eq`).

| Table | Hit policy | Replaces |
|-------|------------|----------|
| `imaging_term` | FIRST | MR / Ultraljud / Röntgen TermIds 12683 / 4829 / 59 |
| `imaging_note` | FIRST | The shared imaging Note (one Mustache snippet over `studies`) |
| `smoking_note` | FIRST | TermId 8754 never-smoked vs smoker snippet |
| `regimen_phrase` | FIRST | `regim` × `antal_kurer` × `annan_regim`, comma and space styles |
| `dose_phrase` | FIRST | fraktionsdos × totaldos |
| `chemoradiation_form` | FIRST | Kemoradioterapi form prefix |
| `follow_glue` | FIRST | Adjuvant / Neoadjuvant / Perioperativ glue when a tillägg type is present |
| `relation_tail` | FIRST | Relation sentence when intention and huvud are present and tillägg type is not |
| `huvud_relation_tail` | FIRST | Relation sentence when only huvud and relation are present |
| `intention_closing` | FIRST | Best supportive care keeps its source spelling; other intentions are folded |
| `treatment_frame` | FIRST | TermId 14351 sentence, one row per presence combination |
| `treatment_note` | FIRST | That sentence plus huvud / tillägg / strategi comments and vidare utredning |

The imaging keyword is one block. `imaging_term` picks the TermId. `imaging_note`
holds the Note as a VMS-Mustache snippet (`{{#studies}}` walks bilddiagnostik).
Long Handlebars `(or path path …)` gates are an any-of list restriction: any
listed field filled. Display words (intention, type, relation, chemoradiation
form) are folded with `text_changeCase` before they reach a snippet.
The treatment sentence reads the first `rekommenderad_behandlingsstrategi`.
Passthrough keywords stay Handlebars on this sibling.

JSONPath locals use the shared Example Instances in
`../lung-MDT-form/source-instance/`.

Regenerate:

`deno run -A --no-check scripts/build-decision-table-siblings.ts --only=lung`

Omit `--only=lung` to regenerate the chemo sibling as well.
