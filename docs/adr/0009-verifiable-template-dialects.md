# Editors only accept verifiable Handlebars and Go template dialects

- Status: accepted
- Date: 2026-09-10
- Amended: 2026-10-29 — out-of-dialect templates are not accepted (no hatch); see [Amendment 2026-10-29](#amendment-2026-10-29)

## Context

Unrestricted Handlebars.js and Go `text/template` are opaque `string × context → string` (arbitrary helpers / FuncMap, `call`, dynamic names). Investigation: [verifiable-template-snippets.md](../proposals/verifiable-template-snippets.md).

**Handlebars (lung-MDT PROD/QA):** no `lookup` / `#with` / `#log` / partials / lambdas. Closed Kintegrate helpers only.

**Go `text/template` (chemo PROD/XC):** no `call` / `with` / `range` / `break` / Helm `include` (the `include` line is comment-only). Uses `if`/`eq`/`and`/`index`, curated FuncMap (`replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `substr`, `int`), and one acyclic `define`/`template` named `cleanAndQuoteFreeTextInput`. Nested `if` is a poor *authoring* surface (decision tables + interpolating snippets) but it is still a finite dialect.

CodeMirror only **token-colours** `{{…}}`. Restricting the highlighter cannot enforce a helper/action whitelist. ADR 0004 stays: Go has no Authored Template tab; snippets live in `text_code` LANG=`go-template`.

## Decision

1. **Authoring surface.** Handlebars editors (`text_handlebars`, `text_code` LANG=`handlebars`) accept only **VMS-Hbs**. Go snippet editors (`text_code` LANG=`go-template`) accept only **VMS-Go**. Decision-table snippet cells use **VMS-Mustache** (bound-name interpolation); codegen emits Handlebars or Go interpolators from those names. Full Handlebars.js, full Sprig, and JS/TS in `text_code` are not product languages. The Mapping Editor Template tab is retired (#114); loading a free-form `.hbs` seeds the canvas product.
2. **Hard gate at convert.** Handlebars: `knownHelpersOnly` against the VMS-Hbs whitelist. Go WASM: parse + FuncMap limited to the curated set; unknown functions / `call` / `with` do not run.
3. **Lint while typing.** Debounced `@codemirror/lint` (`delay` ≈ 500–750 ms), `autoPanel: false`, so authors can keep typing. Same family as **Constraint warning**. Out-of-dialect text is reported as **not accepted** — there is no hatch for it ([#40](https://github.com/regionstockholm/intehrgrator/issues/40); amended 2026-10-29). The implemented severity is still **warning**; raising it to **error** is a proposal (see the amendment).
4. **Drop JS/TS from the Code text LANG dropdown** ([#40](https://github.com/regionstockholm/intehrgrator/issues/40)). Generated Export TypeScript **viewer** is unchanged.

### VMS-Hbs whitelist

Allowed: `{{path}}` (bracket FLAT keys), comments, `~`, `{{else}}`, `{{#if}}` / `{{#unless}}` / `{{#each}}`, `@index`/`@first`/`@last`/`@key`, `eq` `ne` `lt` `gt` `lte` `gte` `and` `or`, `toLowerCase` `toUpperCase`, `slot`, Mustache-style `{{#path}}` / `{{^path}}`.

Forbidden: `lookup`, `#with`, `#log`, partials, `{{{…}}}` / `{{&}}`, `json` of arbitrary context, set-delimiter, decorators, unregistered helpers, lambdas.

### VMS-Go whitelist

Allowed: `{{.Path}}`, `{{index .Data "literal"}}`, `{{.Parameters.Key}}`, pipelines `|`, `if`/`else`/`else if`/`end`, `range` (bounded), builtins `and` `or` `not` `eq` `ne` `lt` `le` `gt` `ge` `index` `len`, FuncMap `replace` `regexReplaceAll` `trim` `quote` `lower` `upper` `substr` `int` `dict` `handlebars` (host-bound VMS-Hbs for canvas `handlebars()`), `decisionTable` / `sheetLookup` (host-bound convert-time Sheets, ADR 0005), trim-markers `-`, comments, `$` root. **Static** `define`/`template` with literal names and an **acyclic** call graph (the chemo sanitizer). `$name :=` locals inside a `define` (no `$name =` reassignment). `regexReplaceAll` matches Sprig/Helm `regexReplaceAll REGEX SRC REPLACEMENT` (the sanitizer’s `$step3 := regexReplaceAll "…" $step2 ""`), not pipeline-last `src | regexReplaceAll REGEX REPL`.

Forbidden: `call`, `with`, `block`, `break`/`continue`, `html`/`js`/`urlquery`/`print`/`printf`/`println`, `slice`, Helm `include`, dynamic template names, method calls on context, extra Sprig, `$x =` reassignment.

Prefer promoting `cleanAndQuoteFreeTextInput` to a named FuncMap helper later so authors do not need `define`.

### VMS-Mustache (snippet cells)

`{{name}}` / `{{a.b}}` / `{{.}}` / `{{#list}}` / `{{^empty}}` / comments. No helpers, no Go actions. **Not** the same syntax as VMS-Hbs or VMS-Go.

## Consequences

- In-dialect templates are **VMS**. Out-of-dialect fails closed at convert.
- **Syntax:** VMS-Mustache ⊂ VMS-Hbs. VMS-Hbs is not Mustache. VMS-Go is neither (`{{if}}` vs `{{#if}}`, `index`, `define`, `|`).
- Highlighter restriction is **not** sufficient — parse + walk (`Handlebars.parse`; Go `text/template.Parse`).
- Lung-MDT and chemo PROD/XC stay loadable. Reauthoring nested `if` into tables is a separate example-set task, not a dialect violation.
- Toolbox still offers `text_handlebars` / `text_code`; lint reports out-of-dialect text and convert refuses to run it ([#40](https://github.com/regionstockholm/intehrgrator/issues/40)). Out-of-dialect text is not a `trust: author` hatch (amended 2026-10-29).

**Considered:** (a) keep all templates as opaque hatches — rejected; both production scripts already sit in closed dialects. (b) Mustache-only in every editor — rejected; lung-MDT and chemo would not load. (c) Forbid Go `define`/`template` immediately — rejected until the sanitizer is a FuncMap builtin. (d) Enforce only by shrinking the CodeMirror tokenizer — rejected.

## Amendment 2026-10-29

**Change:** intEHRgrator does **not accept** out-of-dialect Handlebars or Go template text in mappings. VMS-Hbs, VMS-Go and VMS-Mustache are the only template languages; there is no hatch and no `trust: author` exemption for templates. Decided by Erik Sundvall; recorded in PR #304.

**Original wording of Decision 3 (2026-09-10):** "**Soft gate while typing.** Debounced `@codemirror/lint` (`delay` ≈ 500–750 ms), **warning** severity, `autoPanel: false`. Same family as **Constraint warning**. Out-of-dialect text keeps a hatch warning."

**What already holds:** Decision 2 (the convert-time hard gate) is unchanged, so out-of-dialect text already does not run.

**Not yet implemented (proposal; mechanism open):** the editor lint (`src/workbench/template_lint.ts`) still uses `warning` severity, and the workspace linter (`src/blockly/vms_linter.ts`) still labels out-of-dialect text as a hatch ("Handlebars outside VMS-Hbs — unverified / not in declarative export", same for Go). Proposed: raise these findings to **error**, reword them as "not accepted", and report them as failing findings in Verify mapping, Generated Export and the evidence pack. Still open: whether save / Project Bundle load should refuse such text or load it flagged for fixing.

**Legacy examples:** older mapping examples with out-of-dialect constructs are kept only as **comparative material for one-off tests**, after translation to VMS-Hbs / VMS-Go (or Decision tables with VMS-Mustache cells). They are not a supported input.

See [formal-verification-export.md — Out-of-dialect templates: not accepted](../future/formal-verification-export.md#out-of-dialect-templates-not-accepted).
