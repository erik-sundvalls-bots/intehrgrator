# Verifiable Mustache / Handlebars / Go template snippets

**Status:** Investigation 2026-09-10; **accepted** as [ADR 0009](../adr/0009-verifiable-template-dialects.md) (editor dialects + convert-time whitelist). Lint UI is [#40](https://github.com/regionstockholm/intehrgrator/issues/40).  
**Related:** [formal-verification-export.md](../future/formal-verification-export.md), [decision-tables-for-mapping.md](../future/decision-tables-for-mapping.md), VMS in `src/blockly/vms.ts`, `src/core/output/handlebars_dialect.ts`, `go/texttemplate/main.go`.

## Verdict

1. **Mustache is not fully verifiable as specified.** Lambdas and recursive partials are opaque. A **restricted Mustache** (plain JSON, no lambdas, no partials) *is* the right dialect for decision-table snippet cells.
2. **Lung-MDT PROD/QA Handlebars** does not use hostile holes. Closed Kintegrate helpers only. Nested `#if` is a poor verification *surface* — move branching into decision tables.
3. **Go `text/template` is not fully verifiable as specified** (`call`, `with`, `define`/`template` recursion, `$x =` mutation, arbitrary FuncMap / Sprig). **Chemo PROD/XC do not use those holes.** They use `if`/`eq`/`index`, the curated FuncMap, and one acyclic `define` (`cleanAndQuoteFreeTextInput`). Same story as lung-MDT: lintable dialect, reauthor `if` trees as tables.
4. **Decision table + interpolating snippet** is the product shape. Snippet cells are VMS-Mustache; Template tab is VMS-Hbs; `text_code` Go is VMS-Go. Those three are **not the same syntax**.

---

## 1. Is Mustache fully verifiable?

No. The [Mustache spec](https://github.com/mustache/spec) is “logic-less” only relative to Handlebars helpers. Spec constructs:

| Construct | Verifiable if… | Hole |
|-----------|----------------|------|
| `{{name}}` / dotted names / `{{.}}` | Context is plain JSON, paths literal | — |
| `{{{name}}}` / `{{& name}}` | Same; note unescaped output | String identity vs HTML escape |
| `{{#section}}` / `{{^inverted}}` | Presence or list iteration bounded by input | Section = both `if` and `each` |
| `{{! comment }}` | Ignored | — |
| `{{> partial}}` | Static name, acyclic include graph | Recursive partials |
| `{{=<% %>=}}` (set delimiter) | Parse-time only | Confuses static scanners |
| **Lambdas** (optional module) | **Never** on a verification track | Context value is a function; return value is **re-parsed as template** |

Handlebars is Mustache plus **helpers** (arbitrary JS). Compile-time `knownHelpers` + `knownHelpersOnly: true` is the lock.

**Restricted Mustache** (snippet cells): interpolation + sections/inverted + comments. Compiles to `concat` + `if` + `for_each_*`. Proves dataflow, not clinical *meaning* of prose.

---

## 2. Lung-MDT Handlebars — what they actually use

- [`test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt`](../../test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-0-prod.txt)
- [`test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-1-qa.txt`](../../test/fixtures/lung-MDT-form/mapping/mappningsscript-xml-3-2-1-qa.txt)

**Not used:** `#with`, `lookup`, `#log`, partials, `{{{}}}`, `json`, unregistered helpers, lambdas.

**Used (PROD; QA ±1):** `#if` presence ~192, `#if (eq|ne|and|or)` ~40, `else` 134, `#each` 59, `#unless @last` 3, `toLowerCase` 53, `~` 158.

**Conclusion:** closed dialect, not an open JS hatch. Scale of nested `#if` is the verification problem.

---

## 3. Is Go `text/template` fully verifiable?

No. Official actions ([`text/template` doc](https://pkg.go.dev/text/template)):

| Construct | Verifiable if… | Hole |
|-----------|----------------|------|
| `{{.Field}}` / pipelines `\|` | Literal paths, pure functions | — |
| `{{if}}` / `{{else}}` / `{{else if}}` | Boolean algebra over bound values | — |
| `{{range}}` | Bounded by input length | `break` / `continue` (Go 1.18+) cut the fold |
| `{{index}}` / `{{len}}` | Literal keys | Dynamic keys ≈ Handlebars `lookup` |
| `eq` `ne` `lt` `le` `gt` `ge` `and` `or` `not` | Pure builtins | — |
| `$name :=` in a `define` | Locals, assigned once | `$name =` mutation |
| `{{define}}` / `{{template "name"}}` | Literal name, acyclic | Recursion, dynamic name, `block` override |
| `{{with}}` | Context shift | Same analysis cost as Handlebars `#with` |
| `{{call}}` | **Never** | Function value from data |
| `.Method` on context | Context is JSON | Methods on Go structs |
| Extra FuncMap / Sprig | Closed whitelist | Arbitrary Go, regex/crypto/OS in full Sprig |
| `html` `js` `print` `printf` | Usually layout | Easy to smuggle effects |

intEHRgrator already ships a **curated** FuncMap (`replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `upper`, `substr`, `int`) plus Go comparison builtins. That is the intended VMS-Go ceiling — not “any `text/template`”.

`regexReplaceAll` is a pure string function; SMT-style proof of the regex is out of scope. PBT / gold strings are the check. Prefer a named `cleanAndQuoteFreeTextInput` FuncMap helper so snippet authors do not write regex.

---

## 4. Chemo Go scripts — what they actually use

PROD and XC are the same dialect (TermId / comment copy differs):

- [`test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-prod.txt`](../../test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-prod.txt)
- [`test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-xc.txt`](../../test/fixtures/patient-reported-chemotherapy-symptoms/mapping/mappningsscript-1-9-1-xc.txt)

**Not used (after stripping `{{/* */}}` comments):** `call`, `with`, `range`, `break`/`continue`, `block`, Helm `include` (only in a usage comment), `html`/`js`/`printf`, `$x =` reassignment.

**Used:**

| Construct | ≈ count | Verification note |
|-----------|---------|-------------------|
| `{{if}}` / `{{end}}` | 45 / 46 | Presence + `eq`/`and` trees |
| `{{else}}` | 11 | Finite case split |
| `index .Data "…"` | 107 | Literal FLAT keys |
| `eq` / `ne` / `and` / `or` / `not` | 62 / 5 / 13 / 6 / 2 | Mapping Expression analogues |
| `ge` + `int` | 1 real `if ge (… \| int) 0` | Numeric compare |
| `replace` / `regexReplaceAll` / `trim` / `quote` | sanitizer `define` | Curated FuncMap |
| `lower` / `substr` | 2 / 6 | Note wording (nail severity, laterality) |
| `define` + `template "cleanAndQuoteFreeTextInput"` | 1 / 13 | Acyclic; static name |
| `$input :=` … `$step4 :=` | 5 | Locals inside that `define` only |

**Conclusion:** not an open Go hatch. The sanitizer `define` is the one structured “function”; everything else is `if` + `index` + small string pipelines. Reauthor symptom `if`/`eq` trees as decision tables; keep `cleanAndQuoteFreeTextInput` as a FuncMap helper or a single allowed `define`.

---

## 5. Snippets + decision tables

| regim | antal_kurer | annan_regim | snippet |
|-------|-------------|-------------|---------|
| yes | yes | — | `enligt regim {{regim}}, {{antal_kurer}} kurer.` |
| yes | — | — | `enligt regim {{regim}}.` |
| — | yes | — | `, {{antal_kurer}} kurer.` |

| Layer | Owns | Dialect |
|-------|------|---------|
| Decision table | Which row fires | FIRST / UNIQUE / COLLECT |
| Snippet cell | Interpolate bound names | **VMS-Mustache** |
| Convert | Emit interpolator | Handlebars `{{regim}}` or Go `{{.regim}}` / `{{index .Data "regim"}}` from the same names |
| `for_each_source` / `range` / `#each` | Repeating clusters | Grain, not nested `if` |

Do **not** put `#if (eq …)` or `{{if eq …}}` inside snippet cells.

---

## 6. Dialects (for #40 / mapping-contract)

```text
VMS-Mustache (snippet cells):
  {{name}}, {{a.b}}, {{.}}, {{#list}}…{{/list}}, {{^empty}}…{{/empty}}, comments

VMS-Hbs (Template tab, text_handlebars, text_code LANG=handlebars):
  VMS-Mustache + #if/#unless/else/#each + eq/ne/and/or + toLowerCase/toUpperCase + slot + ~
  knownHelpersOnly: true

VMS-Go (text_code LANG=go-template; WASM FuncMap):
  {{.Path}}, {{index .Data "lit"}}, {{.Parameters.K}}, if/else/range,
  and/or/not/eq/ne/lt/le/gt/ge/index/len,
  replace/regexReplaceAll/trim/quote/lower/upper/substr/int,
  acyclic define/template with literal names, $name := inside define

Not product languages (remove from Code text LANG dropdown — #40):
  javascript, typescript

Escape:
  Handlebars lookup/#with/#log/partials/{{{}}}
  Go call/with/block/break/include/dynamic template names/extra Sprig
  text_code LANG leftover (html/xml/json stay as data, not executable)
```

**Runtime:** Handlebars `knownHelpersOnly`; Go parse + closed FuncMap. **Warn** in the editor (debounced); **fail convert** on unknown actions/helpers.

---

## 7. Same syntax? Mustache vs VMS-Hbs vs VMS-Go

**No.**

| | VMS-Mustache | VMS-Hbs | VMS-Go |
|--|--------------|---------|--------|
| Iterate | `{{#items}}` | that or `{{#each items}}` | `{{range .Items}}` |
| Presence | `{{#name}}` / `{{^}}` | that or `{{#if}}` | `{{if}}` |
| Compare | table row | `{{#if (eq x "MR")}}` | `{{if eq (index .Data "x") "MR"}}` |
| Lookup | `{{name}}` | `{{path}}` / `[|value]` | `{{index .Data "flat\|value"}}` |
| Reuse | none | (partials forbidden) | `{{template "cleanAndQuote…"}}` |
| Valid elsewhere? | ⊂ VMS-Hbs; **not** VMS-Go | not Mustache, not Go | not Mustache, not Handlebars |

---

## 8. Editor lint (not a highlighter)

The workbench StreamLanguage colours `{{` / `#word` / `else` for **both** Handlebars and Go. It cannot tell `#each` from `#with`, or `if` from `call`.

- Handlebars: `Handlebars.parse` + AST walk.
- Go: `text/template.Parse` (WASM already vendors the parser) + action/function walk.
- `@codemirror/lint` `linter(source, { delay: 500–750 })`, warning underline, `autoPanel: false`.
- Panes: Handlebars Template tab; `text_code` when LANG is `handlebars` or `go-template`; `text_handlebars`; later snippet cells (VMS-Mustache profile).

---

## What this does *not* claim

- Prose preserves clinical *meaning*.
- OPT `TemplateValidator` on the snippet string itself.
- SMT proof of `regexReplaceAll` character-class sanitizers — gold XML + PBT.
- A proof of the current nested `if` trees — reauthor as tables.

## Pointers

- [ADR 0009](../adr/0009-verifiable-template-dialects.md)
- [ADR 0004](../adr/0004-go-template-codegen-only.md) — Go remains codegen-only (no Template tab)
- [#40](https://github.com/regionstockholm/intehrgrator/issues/40) — linter, dropdown cut (JS/TS)
- [decision-tables-for-mapping.md](../future/decision-tables-for-mapping.md)
