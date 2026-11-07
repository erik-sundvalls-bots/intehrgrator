# XQuery Conversion Script Language

**Status:** Implemented (R1 / R2 + COMPOSITION emit + `$sheets` + in-app Test Run) — Conversion script language `xquery`
emits a self-contained `.xq` from the Mapping Model (Blockly-derived slots).
`for_each_source` / `for_each_list` compile to `for $var in … return` loop
bodies ([#39](https://github.com/regionstockholm/intehrgrator/issues/39)).
With a Template Skeleton, export walks the tree into COMPOSITION RM XML
(Model A/C, [#75](https://github.com/regionstockholm/intehrgrator/issues/75)).
Sheet accessors bind `external $sheets` ([#76](https://github.com/regionstockholm/intehrgrator/issues/76)).
In-app Conversion Test Run lazy-loads fontoxpath ([#78](https://github.com/regionstockholm/intehrgrator/issues/78)).
Optional BaseX golden runs are documented in [agents/xquery-engine.md](../agents/xquery-engine.md).

Captured from design discussion 2026-07-02; productised 2026-08-02.

## Idea

Add a **Conversion script language** that emits an **XQuery program** performing
conversion from source JSON/XML based on Blockly mapping choices — evaluating
Mapping Expressions and wrapping results in openEHR `DV_*` RM XML — suitable for
Saxon, BaseX, eXist, and similar server XQuery engines.

This sits alongside **TypeScript** (`ehrtslib`), **Java** (`Archie`), and
**Handlebars** as an alternative runtime path for server-side integration
pipelines.

## What shipped

| Piece | Location |
|-------|----------|
| `ExportTarget` includes `"xquery"` | `src/types/mod.ts` |
| `generateXQuery(model)` + expression emit | `src/core/codegen/xquery.ts` |
| Adapter registry (`.xq`, `application/xquery`) | `src/core/codegen/mod.ts` |
| Output Previews select option | `web/index.html` |
| Tests | `test/codegen_test.ts` |

### Emission model (Model B — slot manifest)

`generate(model, "xquery")` produces an XQuery 3.1 module that:

1. Declares `external` variable `$source` (XML node or XPath 3.1 map).
2. Compiles each Mapping Model slot expression to XQuery (`xpath*` → path
   navigation / lookup; `trim` → `normalize-space`; `concat` / `if` / …).
3. Wraps values in typed `DV_*` element constructors (`local:dv-quantity`, …).
4. Returns a `<mapping-result template="…">` document with one `<slot>` per
   mapped Target value slot.

Literal fontoxpath JSON paths such as `$.patient.systolic` compile to
`$source?patient?systolic`. Literal XML paths such as `/patient/name` compile
to `$source/patient/name`. Dynamic XML paths error at runtime with guidance to
prefer compile-time literals.

**In-app Test Run executes the `.xq`** after a lazy load of fontoxpath (issue #78).
BaseX remains the optional CI/Cloud Agent golden engine.

Recommended production pattern:

```
source ──► generated .xq (mapping-result) ──► generic OPT assembler / Archie
                                                      │
                                                      ▼
                                              CDR / downstream
```

## Motivation (unchanged)

| Driver | Detail |
|--------|--------|
| **Query-language alignment** | Source paths are already XPath/XQuery (fontoxpath). Exporting XQuery keeps source access and transform in one language. |
| **Existing server stacks** | Saxon, eXist-db, BaseX, MarkLogic, XML pipelines can host a `.xq` without a bespoke Archie conversion class. |
| **Declarative pipelines** | Fits ETL-style “source in → composition-shaped artifact out” workflows. |
| **Separation of transform vs validation** | XQuery produces values; Archie (or another OPT validator) can remain an optional post-step. |

## Architecture

```
Mapping Model (language-neutral, from Blockly)
        │
        ├──► TypeScript export (ehrtslib + fontoxpath)
        ├──► Java export (Archie RM constructors)
        ├──► Handlebars (user template / auto slot comments)
        └──► XQuery export → mapping-result .xq (+ DV_* helpers)
```

### Expression mapping

| Mapping Model builtin | XQuery emission |
|-----------------------|-----------------|
| `xpathString($expr)` | Compiled path or `local:string-at($source, …)` |
| `xpathNumber($expr)` | Compiled path or `local:number-at($source, …)` |
| `xpathBoolean($expr)` | Compiled path or `local:boolean-at($source, …)` |
| `trim($s)` | `normalize-space($s)` |
| `concat($a, $b, …)` | `concat($a, $b, …)` |
| `if($c, $t, $e)` | `if ($c) then $t else $e` |
| `switch(…)` | Nested `if … eq …` |
| Slot → `DV_*` | `local:as-value($rm-type, $value)` |

### Module shape (illustrative)

```xquery
xquery version "3.1";
declare namespace rm = "http://schemas.openehr.org/v1";
declare variable $source external;

declare function local:convert($source as item()*) as element(mapping-result) {
  element mapping-result {
    attribute template { "vitals" },
    element slot {
      attribute id { "s1" },
      attribute rm-type { "DV_QUANTITY" },
      local:as-value("DV_QUANTITY", xs:decimal(($source?systolic)[1]))
    }
  }
};

local:convert($source)
```

## Deployment models

| Model | Status |
|-------|--------|
| **B — XQuery extract + assembler** | **Implemented** — Model B slot manifest when no skeleton is passed |
| **A — Pure XQuery full Composition** | **Implemented** — skeleton walk → RM XML (`instanceShape: "xml"`) or JSON maps |
| **C — RM XML literal tree from skeleton** | **Implemented** with A — same walker |

## Remaining work

1. **Units / coded-text fields** — richer multi-field DV shells beyond skeleton `fixedFields`.
2. **JSON source notes** — document engine-specific map lookup vs `fn:json-doc` for non-BaseX hosts.
3. **Archie XML post-validation** of Model A output as an optional Cloud Agent step.

## Related

- [MAPPING_SPECIFICATION.md](../MAPPING_SPECIFICATION.md) — Target instance format vs Conversion script language
- [SOURCE_QUERY.md](../SOURCE_QUERY.md) — fontoxpath and typed evaluators
- [BLOCKLY_INTEGRATION.md](../BLOCKLY_INTEGRATION.md) — dual generators pattern
- [CONTEXT.md](../../CONTEXT.md) — Conversion script language glossary
- [ADR 0001](../adr/0001-mapping-and-target-seams.md) — seams
