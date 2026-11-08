# Patient-reported chemotherapy symptoms — decision-table sibling (#70)

Sibling of [`../patient-reported-chemotherapy-symptoms/`](../patient-reported-chemotherapy-symptoms/).
**Do not edit** the original Blockly gold except by adding this sibling.

Same TakeCare XSD, Defaults Map, FLAT instances, and PROD Go `text/template`
script. Inner Note `{{if eq}}` branches for fatigue (2811), swelling (7643),
and itch (1921) are FIRST Decision tables with VMS-Mustache snippets.
`cleanAndQuoteFreeTextInput` remains one Go `define` on the canvas, not copied
into snippet cells.

Regenerate:

`deno run -A --no-check scripts/build-decision-table-siblings.ts`
