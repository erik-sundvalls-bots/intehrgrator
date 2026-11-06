# Convert-time Defaults Map, not baked literals

Generated Conversion Scripts take a `defaults` map argument and resolve **Map lookup**s at convert time (Test Run passes the values bound on the unique defaults canvas block). Baking `ctx` scalars into the script would make mappings non-reusable across sites and messages. Hardcoding a particular slot is an authoring act: replace that slot’s Map lookup with a literal on the canvas.

**Considered:** inlining current default values at codegen time — simpler scripts, but a language/territory change would require regenerating the mapping, which is the opposite of a convert-time defaults argument.

**See also:** [ADR 0011](0011-default-context-map-runtime-keys.md) — the canvas artefact is a **default context map** whose convert-time bag is keyed only by simple **runtime keys**; RM paths and wildcards are **scaffold targets**.
