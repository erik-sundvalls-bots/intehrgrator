# Patient-reported chemotherapy symptoms — decision-table sibling (#70)

Sibling of [`../patient-reported-chemotherapy-symptoms/`](../patient-reported-chemotherapy-symptoms/),
built from the same script, then patched.

Same TakeCare XSD, Defaults Map and FLAT instances. The Notes for fatigue
(2811), swelling (7643) and itch (1921) are FIRST Decision tables with
VMS-Mustache snippets. Patient free text reaches the snippets through the
`clean_free_text` Function. Every other Note is the same blocks as the mapped
set, so no Go template text is left on the canvas (#386).

Regenerate:

`deno run -A --no-check scripts/build-decision-table-siblings.ts`
