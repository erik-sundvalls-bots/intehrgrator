# Loop index / length codegen (Java, Go, Handlebars) and 0- vs 1-based indexing

**Status:** Investigation — 2026-09-17. No codegen or glossary change in this ticket.  
**Issue:** [#137](https://github.com/regionstockholm/intehrgrator/issues/137)  
**Related:** [#85](https://github.com/regionstockholm/intehrgrator/issues/85) (authoring: `for_each_list` binds `var("item_index")` / `var("item_length")`), [#41](https://github.com/regionstockholm/intehrgrator/issues/41) (SMT), [ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md), [ADR 0004](../adr/0004-go-template-codegen-only.md), [ADR 0009](../adr/0009-verifiable-template-dialects.md), [formal-verification-export.md](formal-verification-export.md).

This note compares **how** Conversion script languages that do not yet bind Loop index / Loop length should emit them, and whether the **authoring algebra** should stay 0-based or switch to 1-based. It does **not** pick a single global codegen shape. Per-language findings are in §3.

---

## Verdict (findings, not a product decision)

1. **Java and Go should both use indexed iteration plus length-at-entry**, not zip-to-pairs and not per-item `indexOf` / mutable SMT-invisible counters.
2. **The two languages should still look different**, because their current emitters have different grain:
   - **Java** skeleton codegen is an *expression tree* (`stream().map(item -> new PointEvent(…)).toList()`). Keep that grain with a generated helper `mapIndexed(col, (item, i, n) -> …)` whose helper *implementation* is a counted `for`. Function-body loops should use a counted `for` like TypeScript `emitTsIndexedFor`.
   - **Go `text/template`** should emit `{{ $col := … }}{{ $len := len $col }}{{ range $i, $el := $col }}…{{ end }}` and stop compiling every `var()` to `.`. Zip-to-pairs is not available in VMS-Go without a new FuncMap that *builds* a pair list.
3. **Handlebars codegen (when it lands)** should follow the same algebra: `#each` already has `@index` / `@first` / `@last` as an **escape hatch**. Product names stay **Loop index** / **Loop length** / Mapping Expression `var("item_index")`. Do not export `@index` on the Blockly face (`CONTEXT.md` Avoid).
4. **Length is a loop invariant** in every language: bind once at loop entry. Inside a Go `range`, `len .` is the length of the *current item*, not the collection.
5. **0- vs 1-based is independent of the Java/Go technique choice.** Both bases are equally SMT-encodable. Pedagogically and for declarative languages (XPath/XQuery `at`, SQL `ROW_NUMBER`, Scratch, Blockly `lists_getIndex`), **1-based is the better authoring algebra**. Implementation of generated TypeScript / Java / Go / Handlebars is cheaper if the product stays **0-based**. The cheap window is **now**: Java and Go do not bind index yet; only TypeScript, XQuery, tests, and copy would move. Change-point list: §5.

---

## 1. What shipped after #85 (baseline)

Blockly **Source iteration** (`for_each_list`) exposes **Loop index** and **Loop length** (`logic_loop_index` / `logic_loop_length`). They serialize as Mapping Expression `var("item_index")` / `var("item_length")` — not workspace Variables. Nested loops pick an outer item name from the same dropdown pattern as **Current item**. Not bound on **List restriction**.

| Surface | Index / length today |
|---------|----------------------|
| Glossary / tooltips | 0-based; `is first` is `index = 0`; `is last` is `index = length − 1` (`CONTEXT.md`, `LOGIC_LOOP_INDEX_TOOLTIP`) |
| Mapping preview Test Run | **Does not bind** index or length. `evaluateLoopSlots` / `itemContext` only set `vars[item] = node` (`src/core/test_runner/mod.ts`, `src/core/source/query_runtime.ts`) |
| TypeScript canvas + skeleton | Binds `__vars["item"]`, `__vars["item_index"]`, `__vars["item_length"]`. RM spread uses `.map((item, i, col) => …)`; Function / Product-stack loops use `emitTsIndexedFor` (`for (let i = 0; i < col.length; i++)`) |
| XQuery | `for $item at $pos in $col` then `$item_index := $pos - 1`, `$item_length := count($col)` (XQuery `at` is 1-based; product stays 0-based) |
| Java | `vars.get(…)` exists. `emitSkeletonLoop` is still `.stream().map(item -> …)` with **no** index/length `vars.put` |
| Go template | `var()` is always `.` (current `range` item). Generated `range` does not declare `$i` or `len` |
| Handlebars Conversion Script | Blockly→Handlebars codegen still deferred (`generateHandlebars` copies the canvas SCRIPT or slot comments). VMS-Hbs `@index` / `@first` / `@last` remain an escape hatch |

JoinNames (#85 variant F) does **not** store raw indexes in the Decision table. Condition columns are booleans `first` / `last` computed as `eq(index, 0)` and `eq(index, length − 1)`. Switching the product base would change those two Blockly compares, not the table rows.

---

## 2. Technique comparison

Issue #137 asked for four candidates. Scores are for **generated Conversion Scripts** that informaticians and reviewers read, that #41 can lower to SMT, and that Go WASM / Archie can run.

Legend: **R** readability, **V** verification / SMT, **C** runtime cost, **B** binder mapping (`var("item")` / `var("item_index")` / `var("item_length")`).

### 2.1 Indexed range / stream

**Go** (native, 0-based for slices/arrays — [pkg.go.dev/text/template](https://pkg.go.dev/text/template)):

```
{{- $col := index .Data "measurements" -}}
{{- $len := len $col -}}
{{- range $i, $el := $col -}}
  {{- /* $el and . are the item; $i is 0-based; $len is |col| at entry */ -}}
{{- end -}}
```

Official rule: `range $index, $element := pipeline` sets index/key and element; with no variables, `.` is the element. Variable scope extends to the `end` of the control structure, or the whole template if declared outside `if`/`with`/`range`. `$name :=` is allowed outside `define`; VMS-Go only forbids `$name =` reassignment (`go/texttemplate/main.go`). ADR 0009’s “`$name :=` inside a define” describes the chemo sanitizer, not a codegen ban.

**Java** (expression grain, keeps today’s setter shape):

```java
mapIndexed(xpathNodes("$.measurements"), (measurements, measurements_i, measurements_length) -> {
  vars.put("measurements", measurements);
  vars.put("measurements_index", measurements_i);
  vars.put("measurements_length", measurements_length);
  return new PointEvent(/* … */);
})
```

Helper (counted `for`, length once, no extra pair list):

```java
private static <T, R> List<R> mapIndexed(List<T> col, IndexedFn<T, R> fn) {
  int n = col.size();
  List<R> out = new ArrayList<>(n);
  for (int i = 0; i < n; i++) out.add(fn.apply(col.get(i), i, n));
  return out;
}
```

`IntStream.range(0, n).mapToObj(i -> …)` is the same algebra with more boxing and a noisier script. Java 21 `IntStream.range` is half-open `startInclusive` … `endExclusive` ([Java 21 IntStream](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/IntStream.html)).

**TypeScript (already):** `.map((item, i, col) => …)` and `for (let i = 0; i < col.length; i++)`. Closest cousin.

| | R | V | C | B |
|--|---|---|---|---|
| Go indexed `range` | High for template readers (`$i`, `$len`, `.` still the item) | Finite domain `0 ≤ i < len`; `range` already VMS-Go; no `break`/`continue` | One pass, no extra alloc | Must stop emitting every `var()` as `.` — look up binders (`item` → `.` / `$el`, `item_index` → `$i`, `item_length` → `$len`) like XQuery’s `bind` map |
| Java `mapIndexed` / counted `for` | High; helper name documents the algebra | Counted `for` is a list homomorphism; avoid mutating a counter *inside* `forEach` / `stream().forEach` | O(n); `ArrayList` of results already required | `vars.put` three keys per iteration; `vars.get` already compiles `var()` |

### 2.2 Zip to pairs `(item, index)`

Build `[{item, index}, …]` then iterate the pairs.

| | R | V | C | B |
|--|---|---|---|---|
| Java `record Pair(Object item, int i)` + `stream` | Extra type in every script; noisier than `mapIndexed` | Same homomorphism, more surface | Extra list of n pairs | Pairs still need `vars.put`; no win |
| Go | **Not available** in VMS-Go: no pair constructor, no `slice`, no extra Sprig. Would need a new FuncMap (`enumerate`) that *allocates* the pairs — then `range` over that. Strictly worse than `range $i, $el` | Would encode as the same zip in SMT | Extra alloc on every Go WASM Test Run | `.` would become the pair; `var("item")` would break unless authors write `index . "item"` |

**Finding:** reject zip-to-pairs for both Java and Go.

### 2.3 Length once at loop entry

Not an alternative to indexed range — a **constraint on every winner**.

Blockly tooltip: length is “fixed at loop entry”. SMT: `length = |collection|` is a loop invariant, not `len(item)` on each turn.

| Language | Do | Don’t |
|----------|----|--------|
| Go | `$len := len $col` **before** `range` | `len .` inside `range` (item length); `len` on every iteration of a huge slice is cheap but the *wrong value* if `.` is the item |
| Java | `int n = col.size()` once (the `mapIndexed` helper already does this) | `col.size()` on a freshly-fetched xpath inside the body |
| XQuery (already close) | Prefer `let $col := … let $len := count($col) for $item at $pos in $col` | `let $len := count($col)` *inside* the `for` (engines may hoist; the script should still say “once”) |
| TypeScript (already) | `col.length` from the `.map` third argument / `ident_col.length` in indexed `for` | |

### 2.4 Avoid (all languages)

- Per-item `indexOf` scans (O(n²), wrong on duplicates).
- `AtomicInteger` / `$i = $i + 1` mutation. VMS-Go already forbids `$name =`. SMT cannot see the counter as a function of the item.
- Exporting Handlebars `@index` / `@first` / `@last` as Blockly names (`CONTEXT.md` Avoid).

---

## 3. Per-language findings

### 3.1 Java (Archie Conversion Script)

**Winner: indexed helper + counted `for` inside the helper; length once.**

Why not a raw counted `for` in skeleton emit? `emitSkeletonLoop` today returns an **expression** plugged into `setEvents(…)`. A statement `for` would force a builder/statement-list refactor of `java.ts`. A `mapIndexed` helper keeps the expression grain, matches TypeScript `.map((item, i, col) => …)`, and hides the counter in one verified helper (same idea as `asList` / `listGet`).

Function bodies (`procedures_defreturn`) should use a counted `for` — TypeScript already splits that grain (`loopIsInsideProcedure` → `emitTsIndexedFor`).

`vars.put` already exists for quantifiers (`emitQuantifierJava`). Loop bind is the same map. Nested loops: put three keys per item name (`measurements_index`); outer keys remain until overwritten — same as TypeScript `__vars`.

Java is not a web app Test Run oracle ([ADR 0003](../adr/0003-mapping-preview-vs-generated-script.md)). Generated scripts should still be human-readable and SMT-*shaped*; optional `javac` remains the compile check (`docs/JAVA_EXPORT.md`).

### 3.2 Go `text/template` (WASM Test Run)

**Winner: `$col` / `$len` / `range $i, $el`; extend `GoEmitContext` with a bind map.**

`var()` → `.` is correct **only** for the current item. After #85, `var("item_index")` would today also emit `.` and silently print the item. That is the main Go bug-to-be.

Sketch of binder lowering (0-based product):

| Mapping Expression | VMS-Go |
|--------------------|--------|
| `var("item")` | `.` (or `$el`) |
| `var("item_index")` | `$i` (declared by `range $i, $el`) |
| `var("item_length")` | `$item_len` (declared before `range`) |
| `eq(var("item_index"), 0)` | `eq $i 0` |
| `eq(var("item_index"), (var("item_length") - 1))` | `eq $i (sub $item_len 1)` — **Go templates have no `+`/`-` on integers** |

That last row matters for 1-based vs 0-based (§4): VMS-Go FuncMap today is `replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `upper`, `substr`, `int`, `dict`, `handlebars` plus builtins `and`/`or`/`not`/`eq`/…/`index`/`len`. There is **no `add`/`sub`/`inc`**. So:

- **Stay 0-based:** `is first` is `eq $i 0`. `is last` needs either a FuncMap `sub`/`dec` **or** a Blockly-level `eq(index, length − 1)` that Go cannot emit faithfully today (same gap as any arithmetic in Go export).
- **Switch to 1-based:** `is first` is `eq $idx 1` after `$idx := inc $i`. Still needs a tiny pure FuncMap (`inc` or `add`).

Either product base that uses `length − 1` in generated Go needs a numeric helper. That is a small ADR 0009 whitelist add (`inc`/`dec`/`add`/`sub`), independent of zip vs range.

Existing loops that treat `.` as the item keep working if codegen still uses `range` (with or without `$i, $el`): `.` remains the element ([Go docs](https://pkg.go.dev/text/template)). Declaring `$i, $el` does not change `.`.

### 3.3 Handlebars (later codegen)

Follow the **same algebra**, different syntax:

| Product | VMS-Hbs lowering |
|---------|------------------|
| Loop item | `this` / `{{.}}` inside `#each` |
| Loop index (0-based) | `@index` ([Handlebars `@data` variables](https://handlebarsjs.com/api-reference/data-variables.html): “Zero-based index”) |
| Loop length | not builtin — bind once with a helper, or `eq @index @last` via `@last` for lastness |
| `is first` / `is last` | `@first` / `@last` **only inside generated `#each`**, never as Blockly names |

If the product is 1-based, generated Hbs becomes `(add @index 1)` or a local helper; `@first`/`@last` stay valid regardless of displayed index.

Lung-MDT already uses `@first` / `@last` inside authored `#each` (`test/fixtures/kintegrate/handlebars-script1.hbs`). That remains the escape hatch until those scripts are reauthored as Function + Decision table (#85).

### 3.4 XQuery / TypeScript (already bound)

Keep the same algebra. If the product stays 0-based, keep `$pos - 1`. If it switches to 1-based, bind `$item_index := $pos` and drop the subtract. Optionally hoist `count($col)` above the `for` (§2.3).

---

## 4. 0-based vs 1-based Loop index

Issue #137 asks whether 1-based would be better pedagogically, for clinical integration, formal verification, or implementation, given that **authors write mapping definitions, not low-level programs**.

### 4.1 What each world uses (primary sources)

| World | Base | Source |
|-------|------|--------|
| **Scratch** list “item # of [] in []” | 1-based (“c is 3”) | [Scratch Wiki](https://en.scratch-wiki.info/wiki/Item_Number_of_()_in_()_(block)) |
| **Blockly** `lists_getIndex` `FROM_START` | 1-based **default** (`oneBasedIndex` defaults to `true`) | [Blockly workspace options](https://docs.blockly.com/guides/configure/configuration_struct/); [Block vs text languages](https://developers.google.com/blockly/guides/design/languages): “One is the first number.” intEHRgrator does not set `oneBasedIndex`, so it stays true. Canvas emit subtracts 1 for JS arrays (`emitListsGetIndex`) |
| **XPath / XQuery** `position()`, FLWOR `at $p` | 1-based, “starting with one” | [XQuery 3.1](https://www.w3.org/TR/xquery-31/) positional variable definition |
| **SQL** `ROW_NUMBER()` | 1-based | SQL:2003 window functions (ordinal positions start at 1) |
| **fontoxpath JSON arrays** | 1-based (`$[1]` is first) | `handlebars_to_blockly.ts` comment; Source Path authoring |
| **Handlebars** `@index` | 0-based | [handlebarsjs.com `@index`](https://handlebarsjs.com/api-reference/data-variables.html) |
| **Go** `range $i, $el` over a slice | 0-based | [text/template](https://pkg.go.dev/text/template); `walkRange` `for i := 0; i < val.Len(); i++` |
| **JS / Java lists** | 0-based | language |
| **openEHR Simplified FLAT** instance index | 0-based (`node_id:0`) | `openehr://guides/simplified_formats/rules` — **out of scope** for minting `:n` slot ids per #137, but informaticians still *see* `:0` |
| **Sheet** `sheet_get_xy` | 0-based; A1 is 1-based | `CONTEXT.md` |

### 4.2 Axes the issue named

**Pedagogy.** Blockly’s own design note: novices react badly to 0-based lists. Informaticians in this product already use 1-based `lists_getIndex` and 1-based Source Paths. A 0-based Loop index plugged into `lists_getIndex FROM_START` is an off-by-one on the same canvas. Stock Math **is odd** on a 0-based index makes the *first* item even; on a 1-based index, “1st, 3rd, 5th” matches “odd”. `is last` as `index = length` (1-based) needs no minus-one block.

**Clinical integration.** Mapping definitions are closer to XPath/XQuery, SQL, and “first/second measurement” than to C arrays. FLAT `:0` is the main 0-based artefact they already know; #137 forbids using Loop index to mint those slot ids, so FLAT should not drive the Blockly number.

**Formal verification (#41).** Both are a finite integer domain:

- 0-based: `0 ≤ index < length`; first `index = 0`; last `index = length − 1`
- 1-based: `1 ≤ index ≤ length`; first `index = 1`; last `index = length`

Last-as-equality is simpler 1-based (no subtraction in the SMT). Neither needs lambdas-as-values. Empty collection: 0-based domain is empty; 1-based domain is empty (`length = 0` ⇒ no index). Same grain property (“add one node ⇒ one more child”).

**Implementation.** 0-based matches TypeScript `.map` `i`, Go `$i`, Handlebars `@index`, Java `List.get`. 1-based matches XQuery `at` (today’s `$pos - 1` would go away) and Blockly lists. Go/Hbs 1-based needs an `inc` helper. #85 already shipped 0-based tests (`test/join_list_test.ts` expects leftover index `2` after three items).

**“We are not writing low-level programs.”** That argument favours **1-based**. The canvas is a Mapping Specification (declarative slot tree + constructors). Conversion Scripts are a lowering. The authoring number should match Blockly lists, XPath, and “first item”, even if the lowering subtracts 1 in TypeScript/Java/Go — the same way `lists_getIndex` already subtracts 1 in JS emit.

### 4.3 Lean (still not a decision)

| Stay 0-based | Switch to 1-based |
|--------------|-------------------|
| Already shipped (#85); JoinNames booleans already isolate first/last | Authoring matches Scratch / Blockly lists / XPath / SQL |
| TS / Go / Hbs native indexes need no `+ 1` | `is last` is `index = length`; `is odd` matches natural counting |
| FLAT `:0` looks like Loop index (even though minting `:n` is out of scope) | XQuery drops `$pos - 1`; Mapping Expression matches `at $pos` |
| Cheaper codegen in TS/Java/Go | Off-by-one with `lists_getIndex` goes away |
| | Must update copy, tests, TS/XQuery emit **before** Java/Go grow a 0-based bind |

If the product switches, do it **before** Java/Go bind index. After those land, every lowering has a baked-in base.

---

## 5. Change-point list if Loop index becomes 1-based

Authoring / glossary:

- `CONTEXT.md` — **Loop index** / **Loop length** (`is first` → `index = 1`; `is last` → `index = length`)
- `src/blockly/i18n/custom_msg.ts` — `LOGIC_LOOP_INDEX_TOOLTIP` in **en, sv, de, es, ca, fr**; English `FOR_EACH_LIST_TOOLTIP` (other locales do not yet mention 0-based)
- `src/core/loop_binders.ts` — comment on `loopIndexBinderName`
- `src/core/ai/mod.ts` — agent prompt “0-based; length fixed at loop entry”
- `docs/AI_SUGGESTION_FORMAT.md` if it repeats the 0-based rule
- `test/blockly_i18n_test.ts` if it asserts tooltip copy

Semantics / tests:

- `test/join_list_test.ts` — `eq(var("item_index"), 0)` → `1`; `eq(index, length − 1)` → `eq(index, length)`; after a 3-item Function loop, leftover index `2` → `3`
- Any golden script that asserts `__vars["item_index"] = i` without `+ 1`
- JoinNames Blockly locals (`plug(…, number(workspace, 0))`) — table rows themselves stay boolean

Codegen / runtimes:

- `src/blockly/mod.ts` `emitForEachListJs` — bind `ident_i + 1`
- `src/blockly/typescript_codegen.ts` `emitTsLoopBind` / `emitTsIndexedFor`
- `src/core/codegen/typescript.ts` skeleton `.map((ident, ident_i, ident_col) =>` bind
- `src/core/codegen/xquery.ts` — `$item_index := $item_pos` (drop `- 1`) in `emitLoop` and `emitSkelLoop`
- `src/core/test_runner/mod.ts` `evaluateLoopSlots` — bind index/length at all (gap today), then 1-based
- `src/core/source/query_runtime.ts` `itemContext` — same if list-grain preview grows binders
- Future Java `mapIndexed` — pass `i + 1` as the product index (keep 0-based `List.get` inside the helper)
- Future Go — `$idx := inc $i` **or** document product index as `$i + 1` via new FuncMap; ADR 0009 whitelist + `go/texttemplate` `vmsGoAllowedIdents`
- Future Handlebars codegen — `@index` plus one, or a helper; `@first`/`@last` unchanged

Do **not** change:

- `lists_getIndex` 1-based `FROM_START` (already)
- `sheet_get_xy` 0-based (different surface)
- FLAT `:0` emission (out of scope)
- List restriction (no index by design)
- VMS-Hbs authored `@index` in lung-MDT escape-hatch scripts

---

## 6. Mapping preview gap (independent of 0 vs 1)

TypeScript Test Run executes generated binds. Mapping preview `evaluateLoopSlots` only sets `vars[loop.varName]`. A slot that reads `var("item_index")` is `null` in preview and a number in TypeScript — an ADR 0003 oracle split. Whoever implements Java/Go binds should bind preview in the same change, or preview vs TS goldens will fail the first time a VMS fixture uses Loop index in a Target value slot.

---

## 7. Recommended follow-up tickets (not this investigation)

1. **Java:** `mapIndexed` helper + `vars.put` of item/index/length; Function-body counted `for`; tests beside `test/codegen_test.ts` java loop case.
2. **Go:** bind map on `GoEmitContext`; `$col`/`$len`/`range $i, $el`; stop `var()` → always `.`; optional `inc`/`sub` FuncMap if lastness or 1-based is required.
3. **Mapping preview:** bind index/length in `evaluateLoopSlots` (and list-grain preview) so preview ≡ TypeScript.
4. **Product base:** decide 0 vs 1 using §4 **before** (1) and (2) grow a hardcoded base. If 1-based, apply §5 in the same PR as the glossary change.
5. **Handlebars codegen** (whenever Blockly→Hbs lands): lower `var("item_index")` to `@index` (or `@index`+1); never name Blockly reporters `@index`.

---

## Sources

- Issue text: [#137](https://github.com/regionstockholm/intehrgrator/issues/137), [#85](https://github.com/regionstockholm/intehrgrator/issues/85), [#41](https://github.com/regionstockholm/intehrgrator/issues/41)
- Code: `src/core/loop_binders.ts`, `src/core/codegen/{java,go_template,xquery,typescript}.ts`, `src/blockly/{mod,typescript_codegen,go_template_codegen}.ts`, `src/core/test_runner/mod.ts`, `go/texttemplate/main.go`
- Go `text/template` variables / `range $index, $element`: https://pkg.go.dev/text/template
- Blockly `oneBasedIndex` default true: https://docs.blockly.com/guides/configure/configuration_struct/
- Blockly “One is the first number”: https://developers.google.com/blockly/guides/design/languages
- Scratch 1-based item #: https://en.scratch-wiki.info/wiki/Item_Number_of_()_in_()_(block)
- Handlebars `@index` 0-based: https://handlebarsjs.com/api-reference/data-variables.html
- XQuery 3.1 positional variable “starting with one”: https://www.w3.org/TR/xquery-31/
- openEHR FLAT instance index 0-based: `openehr://guides/simplified_formats/rules`
- Java 21 `IntStream.range`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/stream/IntStream.html
