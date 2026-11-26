# Convert-time Sheet bag, not baked grid literals

Generated Conversion Scripts take a `sheets` argument (named **Sheet** documents: headers + 2D values) and resolve **Sheet** accessors at convert time. Test Run passes the project-owned Sheet JSON (the widget is a view). Baking cell literals into the script would make terminology grids non-reusable across sites and messages.

This is the same convert-time argument pattern as ADR 0002 (**Defaults Map** / `maps_get`). Maps stay 1D key→value; Sheets are the 2D structure.

**Considered:** inlining current sheet cells at codegen time — simpler scripts, but a code/rubric edit would require regenerating the mapping.

**Considered:** requiring the jspreadsheet DOM widget at Test Run — rejected (grill Q2 A).
