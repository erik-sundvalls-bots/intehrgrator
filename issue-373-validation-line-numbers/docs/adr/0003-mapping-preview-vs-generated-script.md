# Mapping preview interprets the Mapping Model; TypeScript executes Generated Export

Test Run used to always evaluate Mapping Model slot expressions (ADR 0001). **Output mode** now splits that:

- **Mapping preview** — evaluates slot expressions and renders through the Target instance format handler. For **free-form** targets, evaluates canvas `handlebars(script, context)` (seeded from a loaded `.hbs` as Conversion start → Text document → `text_handlebars` with `xpathNode("$")`). On **XML Schema** canvases (TakeCare), Mapping preview walks the same canvas as Handlebars Output mode and evaluates nested Code text LANG=handlebars, so TermId and Note pairs agree. JSON Schema and openEHR stay on slot-fill plus the format handler.
- **TypeScript** — executes the generated Conversion Script with bundled ehrtslib.
- **Handlebars** (Output mode) — same canvas `handlebars()` product as Mapping preview when present; otherwise a `handlebarsTemplate` / target-content override. Generated `.hbs` is the canvas SCRIPT literal when a `text_handlebars` product exists.
- **Go Template** — executes the **generated** Go `text/template` script via vendored WASM (`{ Parameters: defaults, Data: source }`), including host-bound `handlebars` / `dict` so canvas `handlebars()` Test Run matches preview. See ADR 0004.
- **Java** — generates an Archie RM conversion class (`src/core/codegen/java.ts`: Template Skeleton + Mapping Model, `new Composition()` / `new DvQuantity(…)`, sheet/`maps_get` helpers, `for_each_source` streams, `RMObjectValidator` hook). **Not executed** in the web app (no bundled JVM). Optional `javac` against Maven Central Archie jars: `test/java_archie_compile_test.ts`. See [JAVA_EXPORT.md](../JAVA_EXPORT.md).
- **XQuery** — generate a script and, once the runtime is lazy-loaded, execute it in Conversion Test Run against the Active Example (`$source`, `$defaults`, `$sheets`).

Output mode is session-only and defaults to Mapping preview after load. Generated Export and Test Run output are not persisted in the Project Bundle.

**Considered:** executing generated Handlebars scripts in Test Run. Canvas `text_handlebars` is now the authoring surface (#114 / #115); Handlebars Output mode Test Run evaluates that product (or a `handlebarsTemplate` override for fixtures).

## Verification oracle (VMS golden tests — issue #38)

On the **Verifiable Mapping Subset (VMS)**, CI treats these paths as cross-check oracles:

| Role | Path | Notes |
|------|------|-------|
| **Primary execution oracle** | Mapping preview (`runTest` + `outputMode: "preview"`) | Evaluates Mapping Model slots + loops, sheets, and Target format render. Default Test Run truth for authors. |
| **Cross-check oracle** | Generated TypeScript (`outputMode: "typescript"`) | Executable today via bundled ehrtslib/fontoxpath. Golden tests require normalized clinical output ≡ preview on VMS fixtures (`test/vms_golden_test.ts`). |
| **Structural postcondition** | ehrtslib `TemplateValidator` | Wired in `validateConvertedOutput()` after preview/TS runs. |
| **Cross-check oracle (XQuery)** | Generated XQuery (`outputMode: "xquery"`) | Lazy-loaded fontoxpath + slimdom in the web app. VMS fixtures compare clinical values with Mapping preview (`test/xquery_runtime_test.ts`, `test/vms_golden_test.ts`). BaseX remains the optional external engine (`docs/agents/xquery-engine.md`). |
| **Generated Java (static)** | Archie RM conversion class | `generate(model, "java")` emits real RM construction plus an optional `RMObjectValidator` hook. Not a CI execution oracle (web app has no JVM). |
| **Deferred external oracle** | Archie JVM run | Preferred when a Java toolchain is available to *execute* generated Java and independently validate; not required for current CI. |

When preview and TypeScript disagree on a VMS mapping, treat it as a **mapping bug** (robustness violation per formal-verification-export.md), not an author workflow choice.

Silent `undefined` in generated TypeScript for VMS-kept block types is forbidden; see `test/vms_golden_test.ts`.
