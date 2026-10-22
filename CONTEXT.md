# Integration Workbench (intEHRgrator)

A visual mapping tool for healthcare informaticians to author conversion logic from source data either generic (JSON, XML) or openEHR Compositions (canonical/FLAT/STRUCTURED and other formats supported by ehrtslib) into a chosen **Target instance format** — instances adhering to openEHR templates, JSON Schema, XML Schema, or free-form text — with **Conversion script languages** TypeScript, Java, or Handlebars.

## Language

**Source Pane**:
The left pane with two sections: **Source Schema** (upper, structural tree for mapping) and **Example Instances** (lower, optional tabbed instance files). Source queries use `fontoxpath` behind the Source Format Handler. Slide-away (manual toggle) so the Mapping Editor can take the full width.
_Avoid_: Left panel, input pane

**Source Schema**:
Upper section of the Source Pane — schema file (JSON Schema, XML/XSD sample, openEHR Web Template, or other structural definition) or inferred structure (field names, types, cardinality). Used for authoring mappings without requiring an example file. Empty state prompt: *Load a schema file.*
_Avoid_: Schema tree, structure view

**Example Instance**:
A loaded source data file representing one real source record (JSON, XML, or openEHR Composition/FLAT/STRUCTURED). Shown in its own tab; used for click-to-map with concrete values and as input to Test Run.
_Avoid_: Sample file, test data

**Active Example**:
The currently selected example instance tab. Its tree appears below the tab bar; Test Run and the lower **Conversion Test Run(s)** section in **Target & Previews** always execute against and display results for this tab only.
_Avoid_: Current instance, selected tab

**Example Set**:
A catalogued bundle that loads a Source Schema, one or more Example Instances, a target, optionally a Blockly mapping, and optionally a **default context map**, all by HTTP(S) URI. intEHRgrator ships the catalog under `examples/example-sets.json`; in-repo asset URIs are relative under `test/fixtures/` (served from the built site). External targets may use absolute GitHub URLs. Toolbar: **Example Sets** (▾ lists sets and catalog URLs). A `defaults` URI hydrates the unique **default context map** block via the same path as picking a saved map. Each **family** (same source + target) has an **unmapped** set (no mouths filled) and a **mapped** sibling (saved Blockly, often Sheets / Defaults). Lung-MDT and chemo also have a **mapped, decision tables** sibling ([#70](https://github.com/regionstockholm/intehrgrator/issues/70)) that must not rewrite the gold directories. Catalog **titles** mark that state in the same trailing position on every row (`… — unmapped` / `… — mapped` / `… — mapped, decision tables`). See [docs/TUTORIAL.md](docs/TUTORIAL.md#11-example-sets-and-languages).
_Avoid_: Sample pack, demo project (that is a saved Project Bundle)

**Source Path**:
XPath or XQuery expression (fontoxpath) identifying a value in the loaded source. Click-to-map inserts the expression via the active Source Format Handler; typed evaluators (`xpathString`, `xpathNumber`, …) follow the Target value slot type.
_Avoid_: JSON path, get_source dot notation

**Source Format Handler**:
Small adapter interface (`loadSchema`, `loadInstance`, `pathToExpression`, `createContext`, `evaluate`) that isolates JSON / XML / openEHR-as-source quirks from Click-to-Map, Test Run, and codegen. See `docs/SOURCE_FORMATS.md`.
_Avoid_: Format switch, source parser union

**Target instance format**:
Shape of produced instances, adhering to `openehr-template`, `json-schema`, `xml-schema`, or `free-form`. Loaded via **Load target & default context map** in **Target & Previews**; drives the **Template Skeleton** (Blockly Target value slots). Separate from Conversion script language — a Handlebars script may emit non-openEHR text while slots still map into a schema target. Persisted as `targetFormat` / Project Bundle `target`. Distinct from **Instance encoding** (how that instance is serialized).
_Avoid_: Target Format alone, Output format (ambiguous with script language and with Instance encoding), template-only framing, a separate Target value slot tree pane, **Open** as the load action, prefix label `Target:`

**Target instance format handler**:
Adapter seam (`load`, `render`) that turns a target definition into a Template Skeleton / Target value slot tree and renders slot values into the produced instance (generic JSON, XML document, or free-form passthrough). For `openehr-template`, render produces an RM instance that is then serialized with the **Instance encoding** on that **Instance root**.
_Avoid_: Target Format Handler (old name), Target parser union, treating ITS-JSON as the only openEHR product

**Instance encoding**:
How a produced instance of a general model is serialized. Chosen on that **Instance root** (COMPOSITION now; CONTRIBUTION later; FHIR later). Mixed encodings on one **Product stack** are allowed — each root serializes independently. **Text document** has no encoding dropdown (it is already a string). Factory default is Canonical JSON (`canonical-json`). OpenEHR offers the official instance encodings: Canonical JSON / ITS-JSON (`canonical-json`), Canonical XML / ITS-XML (`canonical-xml`), Simplified FLAT JSON (`flat-json`), Simplified STRUCTURED JSON (`structured-json`). Mapping preview, Test Run, and Generated Export read the encoding per root. Not a Target instance format and not an Output mode.
_UI labels:_ **Canonical JSON**, **Canonical XML**, **Simplified FLAT**, **Simplified STRUCTURED**.
_Avoid_: Output format, Target instance format, Output mode, **openEHR instance shape** (session-only XQuery JSON/XML toggle), a workspace-wide encoding, forcing every RM root on a stack to match, treating JSON Schema vs XML Schema as this dropdown, ehrtslib deserialize presets (hybrid / compact / terse), experimental ZipEHR / YAML

**Instance root**:
A typed Blockly constructor that can occupy the **Product stack**: an **RM Block** `composition` (later `CONTRIBUTION`), a JSON Schema or XML Schema scaffold root, a schema-less JSON object, an **XML document** or schema-less **XML element**, or a **Text document**. Nested constructors inside that tree (SECTION, EVENT, JSON members, …) are not instance roots.
_Avoid_: calling every JSON/XML toolbox block a root, generic file(s) wrapper, treating openEHR CONTRIBUTION as a file format (it is an RM class)

**Product stack**:
The ordered chain **Conversion start** designates as the conversion product: **Instance roots** plus the remaining VMS loop (`for_each_list`). Mapping preview and Generated Export walk it and **juxtapose** each serialized fragment in stack order — no implicit delimiter, array wrapper, or newline. Glue is authorial: a **Text document** for JSONL newlines, MIME boundaries, Kafka/record framing, brackets, or nothing. Loops wrap roots (or nested loops) in their body; each iteration appends fragments. Not a Scratch script and not every leftover statement — `variables_set` and nested RM containers stay out.
_Avoid_: untyped statement spine, statement `controls_if` / while / for, treating stack order as side effects, N output files from one stack, a hidden JSON array or JSONL mode

**Conversion start**:
The unique Blockly hat that designates the **Product stack**. It snaps onto the first block of that stack. Looks like Scratch’s green flag but is not an event and does not run a statement script — stack order is juxtaposition of fragments. At most one per workspace. Scaffolding a target (and loading a cap-less skeleton) attaches one if missing. See [ADR 0008](docs/adr/0008-conversion-start-designates-product.md) and [ADR 0010](docs/adr/0010-product-stack-and-instance-encoding.md).
_Avoid_: when green flag clicked, script trigger, fork/parallelize, multiple Starts, canvas x,y as product order, putting purged VMS blocks under Start

**Text document**:
A statement-shaped **Instance root** in the Text drawer whose value is a String (**Code text block**, **Handlebars text block**, or a string **Source query**). Alone under **Conversion start**, the conversion product is that string (a text file). In a **Product stack** among other roots it is a fragment: delimiters, wrapper starts/ends, MIME boundaries, record separators, and similar glue. Distinct from a generated Handlebars Conversion Script.
_Avoid_: stock `text` as the file root, treating a retired workspace Template tab as this block, a second delimiter block type, implicit newlines between roots

**XML document**:
The XML **Instance root** for a complete document: XML declaration (version, encoding, optional standalone), namespace declarations via the cogwheel mutator, and one root **XML element**. A schema-less XML element can still be an instance root for a fragment without a declaration.
_Avoid_: treating every XML element as the document, putting `<?xml?>` in a **Code text block**

**XML element**:
Ad-hoc Blockly constructor for an XML tag: one text slot, a stacked attributes mouth, and nested child elements. Distinct from XSD-driven schema target blocks.
_Avoid_: mixing attributes and text in one mouth, XML document (the file root)

**CDATA section**:
XML character data emitted as `<![CDATA[ … ]]>` instead of escaped text. Plugs into an **XML element** text slot.
_Avoid_: using **Code text** as the only way to emit CDATA

**Source iteration (`for_each_list`)**:
Blockly loop that binds each item from a list or each node from a multi-valued Source Path to a named variable, plus **Loop index** (0-based) and **Loop length** (collection size at loop entry). Plug a list (☰) or a `source_query_node` (📂) into the **in** slot. Same block, two grains: nested inside an **Instance root** it repeats a target container (Click-to-Map wraps `HISTORY.events` and stores relative paths); in the **Product stack** it wraps **Instance roots** and each iteration appends fragments. Preferred way to map over a substructure — not a Source Pane “context root” framing (kintegrate Handlebars pattern). See `docs/future/source-context-root.md`. Not a driver for many output files.
_Avoid_: Context boundary, frame as context root (unless discussing kintegrate), using this loop as NDJSON/multi-file packaging, a second product-only loop type, a dedicated `for_each_source` block, a compact `join_list` builtin (grammatical lists are a Function + this loop + a Decision table; see #85)

**Loop index** / **Loop length**:
Number reporters (`logic_loop_index` / `logic_loop_length`) for the enclosing `for_each_list`. Same nearest-enclosing dropdown pattern as **Current item**; nested loops can pick an outer item name from the dropdown. They serialize as Mapping Expression `var("item_index")` / `var("item_length")` — not workspace Variables. `is first` is `index = 0`; `is last` is `index = length − 1`; odd/even is the stock Math block `index is odd`. Not bound on **List restriction** (quantifiers stay order-insensitive).
_Avoid_: Handlebars `@index` / `@first` / `@last` as product names, binding index on `logic_list_restriction`, using index to mint `:n` slot ids

**Map**:
A key-value collection in the Mapping Editor, parallel to a Blockly List. Entries are retrieved by key, not by index. Used for nested values, quantity unpack, and other 1D lookups. Not the **default context map**. Toolbox: list and map blocks share one **Lists & maps** drawer. **Decision tables** and **Sheets** are separate drawers below the divider, with **Variables** and **Functions**. A flyout button adds the grid; the blocks pick its name from a dropdown.
_Avoid_: Dictionary, hashmap, JSON object (the object/member stack is a different Blockly metaphor), **Sheet** (2D grid), treating the default context map as a plugged `maps_create_with`

**Sheet** (matrix / spreadsheet):
A named 2D grid in the Mapping Editor: optional unique **column headers** (top), optional unique **row names** (left), cells that need not be unique. The project owns the grid (headers + values). Blockly **accessor** blocks (`sheet_get_*`, `sheet_lookup`) refer to it by name and read it at convert time. The grid is not a canvas block. Distinct from **Map**, **Decision table**, and from openEHR `ITEM_TABLE`.
_Avoid_: table (ambiguous with RM `ITEM_TABLE`), Excel (the desktop app), treating a Sheet as a 1D Map, a canvas declaration chip

**Decision table**:
A Sheets-adjacent project-owned grid with `kind: decision-table`: **condition** columns and **output** columns (**value** or **VMS-Mustache snippet**). Condition cells are **equality**, per-column **don't-care** (`—`, `*`, empty), or **numeric predicates** (`90..120` inclusive, `>= 140`, `< 90`) applied when the bound input coerces to a finite number; non-numeric / enum columns keep equality + don't-care. A **catch-all** (otherwise) row is a row-level flag (`rowCatchAll`), not the per-column `*` glyph — it matches only when no earlier row has matched (place it last). Hit policies **FIRST**, **UNIQUE**, and **COLLECT**. UNIQUE still throws at convert time on overlap; the Mapping Editor also shows a yellow **Constraint warning** (Sheets lint) for overlapping rows or multiple catch-alls. COLLECT joins matching outputs in RULE ORDER, skips blank snippet/value cells, and may **dedupe** (`collectDedupe`) while keeping first occurrence. That grid document owns the column names and the column count. Blockly eval sites for the table use those same names — not a second schema. The eval block takes one schema-bound **inputs** Map (keys = condition column headers, in order; mouth label **inputs**, glyph **↦**). Flatten nested/complex sources into those inputs (or via `variables_set` / `variables_get`) before eval. By default the eval block returns **one** output column, chosen by a dropdown of output headers (a selector, not a second name for the column). That column has an **output column type** (String, Number, or Boolean) shown as the left puzzle glyph (🔤 / 🔢 / ✓); snippet columns are String. **All-outputs** mode returns a **Map** of every output column (left glyph **↦**) instead. The eval block refers to that grid by name. The grid is not a canvas block. Same editor and convert-time bag as **Sheet**; distinct kind (ADR 0005 / #69 / #84). TypeScript Test Run evaluates the table in-process (range predicates flatten to comparisons in the generated helper). No FEEL; no DMN XML yet.
_UI label:_ **string pattern** for a snippet output column.
_Avoid_: treating as a data **Sheet**, DMN/FEEL, putting branching inside snippet cells, a Blockly-only list of input names that can drift from the grid, extra Map keys that are not condition columns, treating the OUTPUT field as a column rename, returning a Map when only one output column is selected, Sheet widget `columnTypes` (text/numeric/dropdown) as the Blockly type, treating per-column `*` don't-care as a catch-all row, a canvas declaration chip, calling that mouth **locals**

**Default context map**:
The unique canvas declaration that *is* the convert-time defaults table. At most one per workspace. It is not a **Map** argument plugged into a second block. Rows are **default context map entries**. Carries folder / **Save as** / Browse / hardcode. A blank project has no factory rows; the informatician picks a catalogued map (per-family factory or named snapshot) together with the target, or uses **New** after the target schema is in the browser. Scaffolding **joins** **Default point**s to this block. See [ADR 0002](docs/adr/0002-convert-time-defaults.md) and [ADR 0011](docs/adr/0011-default-context-map-runtime-keys.md).
_UI label:_ **Default context map**.
_Avoid_: Defaults Map, Defaults block, Default context mapping, Context, CTX, Composition Context, default Blockly field values, model language, treating a FLAT/STRUCTURED `ctx` file as the canonical store, dumping an openEHR factory on a blank canvas

**Default context map entry**:
One row of the **default context map**: a **runtime key**, one or more **scaffold targets**, and a nested Blockly **value** (same sockets as today’s map `VAL`: **term pick**, `PARTY_IDENTIFIED`, text, …). Duplicate **runtime keys** are a **Constraint warning**.
_Avoid_: a Decision table or Sheet for this wiring, a sidecar table plus a plugged Map, putting RM paths in the convert-time argument

**Runtime key**:
The simple convert-time identifier on an **entry** (`language`, `territory`, `time`, `facility`, …). `maps_get("defaults", runtimeKey)` and the Conversion Script `defaults` argument use only these keys. Empty is invalid.
_Avoid_: `*.language` as a pipeline key, simplified-format `ctx` path names as the only allowed keys, a second `defaults_get` block type

**Scaffold target**:
An RM/schema path or wildcard on an **entry**, used only at a scaffold act (joint confirm, explicit **Apply default context map**, or later target refresh). OpenEHR grammar is #157’s: `Class.attribute`, ancestor paths, `*.attribute`. Most-specific match wins. Optional RM insert when a target matches. Never appears in the convert-time argument. Empty list → runtime-only key that lights no slot. JSON Schema / XML Schema path grammars wait until those family catalogs need them.
_Avoid_: convert-time keys, treating per-column `*` don't-care as this wildcard, putting wildcards in `maps_get`

**Map lookup**:
A Blockly value block that retrieves a value from a named **Map**, or from the **default context map** when `NAME` is `"defaults"`. For defaults, `KEY` is the **runtime key**. Used in Target value slots. Refers to the map by name, not by a wire.
_Avoid_: `defaults_get` as a separate block type, connecting a Map constructor into multiple slots, looking up a scaffold target string at convert time

**Mapping Editor**:
The center pane where the user authors mapping logic. Default layout is a vertical split: nested Blockly blocks on top; the bottom slice (adjustable) holds **Mapping Specification** and **Sheets** tabs. **Sheets** embeds a spreadsheet widget (Excel/Sheets paste, CSV import/export, optional fullscreen) bound to project-owned Sheet JSON. A minimap appears when the Blockly canvas exceeds the visible area at the current zoom level.
_Avoid_: Target pane, center panel, BlockMirror (that is a third-party sync pattern reference, not our editor library), Target value slots rail / Slots Pane (removed)

**Target schema**:
Tree of the loaded **Target instance format** in the **Target schema** tab of **Target & Previews**. Pull a leaf or subtree onto empty canvas to create corresponding Blockly (recover a deleted scaffold or add optional structure). A leaf onto **scaffold target** chips, or a subtree onto a **default context map** value socket, authors that map. Scaffolding still joins **Default point**s from the current **default context map**.
_Avoid_: OPT tree, target pane tree, treating this drag as **Load target & default context map** (that loads a whole target)

**Target & Previews**:
The right pane, tabbed and slide-away: **Target schema** (tree of the loaded target; pull leaf/subtree onto the canvas), **Generated conversion script(s)**, **Conversion Test Run(s)**. Header includes **Output mode** and **Load target & default context map**. Both script and test tabs are views of the **Mapping Specification**, not saved artifacts.
_UI labels:_ pane title **Target & Previews**; tabs **Target schema**, **Generated conversion script(s)**, **Conversion Test Run(s)**; load action **Load target & default context map**.
_Avoid_: Output Previews (old pane title), Right pane (ambiguous — could mean mapping), test pane alone, Slots Pane / slot rail, short **Open**, prefix `Target:`

**Output mode**:
The **Target & Previews** header select: **Mapping preview**, or a **Conversion script language** (TypeScript, Java, Handlebars, XQuery). Chooses what those two sections show. Mapping preview is not a script dialect. Session-only — after app start or Project Bundle load the select is Mapping preview; a Conversion script language is chosen only for the current session.
_UI label:_ first option **Mapping preview**.
_Avoid_: Export Target as the name of this control, treating Mapping preview as a Conversion script language, persisting this select in the Project Bundle, **Instance encoding** (that lives on the Instance root)

**Mapping preview**:
Output mode whose **Conversion Test Run(s)** interpret the Mapping Model against the Active Example (today's Test Run), including canvas **Handlebars text block** rendering for free-form / Kintegrate. **Generated conversion script(s)** shows a prompt to pick a Conversion script language rather than a script. Not itself a Conversion Script.
_Avoid_: Preview (collides with the pane title and with Test Run), dry run, calling this a Conversion script language

**openEHR instance shape**:
Current session-only JSON vs XML control in **Target & Previews** on openEHR targets. Mapping preview and TypeScript still produce ehrtslib JSON. XQuery export / Test Run emit COMPOSITION RM XML when XML is selected, or XPath 3.1 maps (JSON instance) when JSON is selected. Distinct from **Instance encoding** (per-root, persisted, includes FLAT/STRUCTURED); this control is the shipped XQuery JSON/XML switch until encoding on the **Instance root** drives every Conversion script language.
_Avoid_: treating this as a Conversion script language, treating this as **Instance encoding**, persisting it in the Project Bundle

**Test Run**:
When Output mode is **Mapping preview**: evaluate Mapping Model slot expressions against the Active Example (including **Map lookup**s against **runtime keys** on the **default context map**, and **Sheet** accessors against project Sheet JSON), then render through the selected Target instance format handler (then serialize each **Instance root** with its **Instance encoding**), or through canvas `handlebars()` when the target is free-form. When Output mode is TypeScript: execute the Generated Export Conversion Script (same text as **Generated conversion script(s)**) against the Active Example. Java Output mode generates an Archie conversion class but does not execute it in the web app (see [JAVA_EXPORT.md](docs/JAVA_EXPORT.md)). Handlebars Output mode evaluates the canvas **Handlebars text block** (or a legacy `handlebarsTemplate` override) against the Active Example, and on XML Schema canvases also evaluates nested **Code text block** LANG=handlebars (TakeCare Note fields). On an XML Schema canvas, Mapping preview evaluates those nested Code text blocks the same way, so TakeCare TermId and Note pairs agree; JSON Schema and openEHR Mapping preview still render through the Target format handler. XQuery Output mode lazy-loads fontoxpath and executes the generated `.xq` against the Active Example (`$source`, `$defaults`, `$sheets`); COMPOSITION emit currently follows **openEHR instance shape**. The conversion product is a payload string (juxtaposed fragments). The editor pretty-prints that payload when the **Product stack** is a single JSON-family root (Canonical JSON, Simplified FLAT, or Simplified STRUCTURED) or a single Canonical XML root; a glued or mixed stack shows as text. Displays the payload even when **Output validation** fails. Derived after the Mapping Specification is restored — not stored in the Project Bundle. Value edits on the **default context map** re-run with Autoplay; new **scaffold targets** wait for a scaffold act.
_UI label:_ section title **Conversion Test Run(s)**; action button **Run Test**.
_Avoid_: Preview, dry run, pretty-printing a MIME/glued stack as if it were one document

**Autoplay**:
When enabled, Test Run re-executes automatically (debounced) after mapping edits. Tab switches show cached results only. Toggle disabled when no example instance tabs are open.
_Avoid_: Auto-run, live preview

**Conversion Script**:
Executable TypeScript, Java, Handlebars, or XQuery produced by a Conversion script language adapter from the Mapping Model (and canvas **Handlebars text block** when present). Takes a convert-time `defaults` argument keyed by **runtime keys** (not **scaffold targets**) for **Map lookup**s and a convert-time **Sheet** bag for **Sheet** accessors. Walks the **Product stack** under **Conversion start** and returns one payload string (juxtaposed fragments; a single **Instance root** is the one-item case). Splitting that payload onto a queue or into files is the pipeline around the script.
_Avoid_: Mapper, transformer (too generic), baking default context map values into the script as the only way to hardcode, emitting several files from one script, a Kafka/MIME producer inside convert

**Template Skeleton**:
The Blockly block tree auto-generated by walking the loaded OPT constraint tree plus silent-mandatory RM fields from ehrtslib's `MANDATORY_RM_ATTRIBUTES` (see `ehrtslib` `rm_instance_generator.ts`) — schema-driven, not instance-driven. RM types are BMM-derived within ehrtslib; intEHRgrator does not parse BMM. Scaffolding copies usable OPT/Web Template constraints onto DATA_VALUE Blocks: a unique `C_QUANTITY`/`C_DV_QUANTITY` unit list item becomes `DV_QUANTITY.units`; a local coded value set becomes a Blockly list of complete `DV_CODED_TEXT` objects (rubric + `defining_code`), defaulting to the AOM `assumed_value`; a `C_ORDINAL`/`C_DV_ORDINAL` value set becomes a Blockly list of complete `DV_ORDINAL` / `DV_SCALE` objects (`value` + `symbol`), likewise defaulting to `assumed_value` when present. Non-mandatory RM structures are added via Optional RM Insertion (cogwheel mutator), not pre-rendered. For **JSON Schema** / **XML Schema** targets the same scaffold policy applies via `target_structure` / `target_value` blocks: mandatory schema fields on load, optional fields via `schema_fields_mutator`, plus always-visible generic JSON/XML toolbox drawers for ad-hoc editing. Scaffolding **joins** a **Conversion start** onto the skeleton **Instance root** rather than replacing the **default context map**.
_Avoid_: Target structure, block template

**Silent-Mandatory RM Field**:
An RM attribute or child object required by the Reference Model but not explicitly constrained in the OPT. Included in the Template Skeleton visibly alongside template-defined content.
_Avoid_: Hidden mandatory, RM default

**Default point**:
A Target value slot that a scaffold act fills with a **Map lookup** of the matching **default context map entry**’s **runtime key**, chosen by matching **scaffold targets** to that slot. One wildcard may bind many slots (`*.language` → COMPOSITION and ENTRY language). `Class.attribute` and ancestor paths select a narrower set; the most specific matching **scaffold target** wins. When the entry **value** is a built-in **term pick** (full `CODE_PHRASE`), the lookup plugs into the RM attribute mouth (`COMPOSITION.language`, `ENTRY.encoding`, …), not into `code_string` on an embedded `CODE_PHRASE` shell. Object-valued party values (`COMPOSITION.composer`, `EVENT_CONTEXT.health_care_facility` as `PARTY_IDENTIFIED`) likewise plug into the RM attribute mouth. Scalar timestamps still plug into the leaf of the typed shell. Party `*.subject` plugs into `PARTY_PROXY.KIND`. RM `terminology_id` stays a fixed field on leftover shells. Optional RM attributes are inserted so the lookup has a slot when an entry has a matching **scaffold target**. **COMPOSITION.category** is not a default point: scaffolding attaches the built-in `openehr:composition_category` term pick and auto-selects the template’s constrained code (`433` event, `431` persistent, `451` episodic). Hardcoding that slot is replacing the lookup with a literal on the canvas (padlock still keys off the **runtime key**), not a generator bake mode. Structure apply is discrete; value edits are live.
_Avoid_: Silent-Mandatory RM Field (that is why a mandatory slot exists), treating a `ctx/` path as a slot id, replacing the typed shell with a bare Map lookup, simplified-format `ctx` aliases as **runtime keys** that also do matching, live re-walk of the skeleton on every entry edit

**Source query block**:
One of the typed Blockly blocks that hold a **Source Path**: `source_query` (string), `source_query_number`, `source_query_boolean`, or `source_query_node` (JSON/XML subtree). Orange Source category on the canvas and in the toolbox. The node variant outputs a **Source** value — a root or subtree via fontoxpath — used as Handlebars context (or other Map-shaped inputs), not a scalar string/number/boolean.
_Avoid_: generic “source block”, xpath block (the expression helpers are different)

**Code text block**:
Text-category Blockly block (`text_code`) that emits a multiline string. Instead of Blockly’s one-line string field it embeds a resizable CodeMirror editor (default 3 rows × 40 characters) with a language dropdown (Plain, Handlebars, Go Template, JSON, XML, HTML). Handlebars LANG is **VMS-Hbs**; Go Template LANG is **VMS-Go** (ADR 0009) with debounced lint. JavaScript/TypeScript are not offered ([#40](https://github.com/regionstockholm/intehrgrator/issues/40) drops them from the dropdown).
_Avoid_: stock `text` block (single-line), a workspace-level Handlebars Template tab (retired; VMS-Hbs lives on the canvas)

**Handlebars text block**:
Text-category Blockly block (`text_handlebars`) that takes a Handlebars script (String — typically a **Code text block**) and a context (**Map** or **Source query** node) and emits rendered prose/text. Script must be **VMS-Hbs**.
_Avoid_: a workspace-level Handlebars Template tab (retired), generated Handlebars Conversion Script, unrestricted Handlebars.js

**Placeholder source path**:
The unmapped factory **Source Path** on a **Source query block**: empty, or the default field value `/path`. A real mapped path such as `$.systolic` is not a placeholder.
_Avoid_: treating every XML `/path` in source data as unmapped (a real map to `/path` looks like the placeholder)

**Selection**:
One shared selected Blockly block, shown in two places: the matching **Mapping Spec Widget** row is marked selected (and scrolled into view), and the canvas pans to that block with a yellow border. Clicking either the widget or the block selects the same block. Selection does not enter **Listening Mode**, except when the block is a **Source query block** whose path is still a **Placeholder source path**.
_Avoid_: Listening Mode (that is arming for Click-to-Map), Constraint warning (that is the triangle), a second highlight that is not Blockly's selected block

**Listening Mode**:
Transient state waiting for a source tree node click to write a **Source Path**. Entered by clicking an empty Target value slot on the Blockly canvas, or by **Selection** of a **Source query block** that still has a **Placeholder source path**. If that source query is plugged into a Target value slot, the next source click maps that **slot** (same as today’s Click-to-Map). If it is free-floating, only that block’s `EXPRESSION` is filled — no Mapping Model slot until it is plugged in.
_Avoid_: Focus mode, mapping mode, arming on every spec click

**Click-to-Map**:
The primary mapping interaction: enter **Listening Mode** → click a source tree node → the waiting Target value slot (or free-floating **Source query block**) receives a fontoxpath **Source Path**. Typed evaluator follows the slot's `DV_*` type, or the source query's string/number/boolean kind when there is no slot. Drag-and-drop from source tree onto a value slot is supported as a secondary interaction. When a **Code text block** (LANG = Handlebars) or a **Handlebars text block** is selected, a source click inserts a VMS-Hbs path (`{{path}}`) at the caret instead of a Blockly binding — Shift+click inserts nested `#with`/`#each`. If no eligible Handlebars editor is selected, fall through to Listening Mode.
_Avoid_: Wildcard mapping (deferred — see `docs/future/wildcard-source-mapping.md`)

**Optional RM Insertion**:
Adding a valid RM structure not present in the loaded OPT (e.g. `feeder_audit`) via the native Blockly **cogwheel mutator** on a container block (same family as `controls_if` elseif/else). The mini-workspace lists RM-optional attributes in RM order; adding one expands the parent and auto-attaches a typed child when the mouth is empty. An attribute bound to one openEHR code set (for example `ELEMENT.null_flavour`) attaches a **built-in** term pick left on “choose…”, with no flavour selected. An attribute whose RM type is an abstract class (`uid` → `UID_BASED_ID`, `protocol` → `ITEM_STRUCTURE`) opens the mouth and does not scaffold a child; nested abstract classes inside a concrete scaffold (for example `HISTORY.events` → `EVENT`) are left out the same way. Removing an optional attribute disconnects its child onto the canvas (does not delete it). Template-mandatory, AM-mandated (RM-optional made `min ≥ 1`), and silent-mandatory mouths stay on the block and locked — they are not behind this cogwheel. Attributes the operational template prohibits (`existence` / occurrences `0..0`) stay in the mutator as non-addable **Constraint Overlay** rows (`Δ [0..0]` with the RM interval struck through) so the RM inventory remains visible; they never become mouths on the canvas. Replaces the former encircled-`+` HTML picker.
_Avoid_: RM insertion hook, extra fields menu, treating the old `+` popup as current UI, silently dropping template-excluded RM attributes from the mutator, allowing insert of `max=0` attributes, leaving template-mandated attributes only in the mutator

**Block Expansion**:
When an optional RM structure is chosen in the cogwheel mutator, the parent container block is automatically modified to expose the corresponding statement input, then the new child block is inserted there if the mouth was empty — except an abstract RM type, which stays an empty mouth, and a single openEHR code set, which inserts a **built-in** term pick with no flavour selected.
_Avoid_: Dynamic slot, mutating block

**Mapping Expression**:
Editable fragment inside a value slot in the Mapping Specification — XPath via fontoxpath builtins (`xpathNumber`, `xpathString`, …) plus JS-shaped helpers (`trim`, `concat`, `if`) and Description-Logic list restrictions (`all_of` / `any_of` / `none_of` / `at_least` / `at_most` / `exactly`) plus class operators (`intersection`, `union`, `difference`). Not TypeScript/Java export code.
_Avoid_: Value mapping, get_source

**List restriction**:
One Logic-category Blockly value (Boolean, `logic_list_restriction`) reading “⟨all⟩ of ⟨list⟩ match ⟨condition⟩”. Its dropdown covers the OWL Manchester quantifiers — `all` (∀ *R.C*, all_of), `any` (∃ *R.C*, any_of), `none` (∀ *R.*¬*C*, none_of) — and the cardinalities `at least` / `at most` / `exactly` n, whose threshold is a numeric field that appears only for those three. The list input is the related individuals; the condition is class *C*, evaluated with relative Source Paths against each item. An empty list makes `all`, `none` and `at most` true, so those three also carry the **Empty-list guard**.
_Avoid_: Manchester keywords on the block face (`only`/`some`/`none`), separate quantifier and cardinality blocks, unlabelled sockets, treating this as a statement loop (`for_each_source`), Open-World “unknown” (Test Run is closed-world over the loaded example)

**Empty-list guard**:
The **require at least one item** checkbox on a **List restriction**, shown for the operators that hold vacuously (`all`, `none`, `at most`). Unchecked (the default) the block is exactly its OWL call; checked it emits `and(any_of(list, v, true), <call>)`, since `any_of(list, v, true)` already means “the list has an item”. Deliberately visible rather than hidden, because vacuous truth is the trap it exists to prevent.
_Avoid_: a `non_empty` builtin, checked-by-default, silently non-vacuous quantifiers, hiding the choice in the tooltip

**Current item**:
The list item a **List restriction** is testing, referenced inside the condition by the `logic_current_item` block (“this item”, with a dropdown onto outer names when nested). The binder name is a plain text field on the restriction, hidden until nesting needs it — reveal it from the context menu (**Name the current item**), and it appears automatically when one restriction lands inside another’s condition. It is not a workspace Variable.
_Avoid_: `field_variable` binder, an `item` entry in the Variables drawer, an always-visible `as ⟨name⟩` field

**Set class operator**:
A Lists & maps Blockly value (Array, `lists_set_operation`) combining two lists as OWL classes: “items in both ⟨A⟩ and ⟨B⟩” (intersection ∩), “items in either ⟨A⟩ or ⟨B⟩” (union ∪), “items in ⟨A⟩ but not in ⟨B⟩” (difference ∖, arguments in reading order). It sits with the list blocks rather than in Logic because it returns a list — which is also what keeps it visually apart from Boolean `logic_operation` / `logic_negate`.
_Avoid_: Boolean AND/OR/NOT, bare `and`/`or` labels on list operands, a Logic-drawer home, `not … in …` phrasing that reverses the operands, Map merge

**Constraint warning**:
A yellow warning triangle on a Blockly block (and the matching **Mapping Spec Widget**) when a contained constraint is unmet — unmapped mandatory value, abstract EVENT, or unmet slot cardinality. It does not light up merely because a node is template/RM-mandatory, and it is not the **Constraint Overlay** (that overlay teaches narrowing; the triangle reports a live mapping that breaks the effective interval).
_Avoid_: the former slot-rail red/green borders, treating Mapping Model `validateModel` as a second warning UI, using the triangle to mean “this node was narrowed”

**RM Block**:
A typed Blockly shell for an openEHR Reference Model class on the canvas (`composition`, `observation`, `element`, `dv_quantity`, …). The Template Skeleton instantiates these from the operational template; Optional RM Insertion adds further Attribute mouths. Pedagogically an RM Block with a Constraint Overlay is the specialized/semantic RM — the same RM class after archetype and template narrowing — not a second block vocabulary.
_Avoid_: sRM as a separate Blockly type family, generic `rm_structure` for openEHR targets, calling these “target_structure” blocks

**Attribute mouth**:
The Blockly value or statement input on an **RM Block** that accepts children for one RM attribute. Its caption shows existence (single-valued attributes) or cardinality (container attributes). Object **occurrences** belong on the child node, not on this caption, when they need to be shown at all.
_Avoid_: unlabelled sockets, treating object occurrences as the mouth interval, slot rail

**Constraint Overlay**:
The condensed visual for two-level modelling on an RM Block: when the operational template’s effective existence/cardinality (or later, a value-domain constraint) is narrower than the unconstrained RM, the Attribute mouth (or, for `max=0` prohibition, the matching Optional RM Insertion row) shows a delta glyph (Δ), the effective interval in overlay colour, and the RM interval with strikethrough. Mouths that still match the RM stay as a single interval. Comparison is RM BMM vs flattened OPT, not a three-layer RM/archetype/template stack on the mouth.
_Avoid_: drawing archetype and template as two extra intervals on the mouth, colour-only signalling, showing a delta when nothing changed, Better “original vs current” copy as a third Blockly field vocabulary, teaching prohibition by hiding the RM attribute

**DATA_VALUE Block**:
A typed Blockly shell for an openEHR `DV_*` (e.g. `DV_QUANTITY`) that wraps Mapping Expressions / literals into target RM fields. Structure still comes from the Template Skeleton or Optional RM Insertion — not free-form composition building from the toolbox. v1 covers the full RM leaf set (including `DV_INTERVAL`, `DV_MULTIMEDIA`, `DV_PARSABLE`, etc.). Field layouts are driven at runtime from ehrtslib’s type registry plus attribute metadata (not a hand-maintained DV field table); gaps in ehrtslib introspection are treated as library improvements. Mandatory value slots (RM- or template/archetype-mandatory) auto-attach the matching shell in the Template Skeleton; optional slots stay empty until Click-to-Map / Listening Mode, which then inserts the typed shell around the Mapping Expression. On each shell, only mandatory attributes are shown by default; optional attributes appear via the cogwheel mutator on that block. Authoritative sources for RM types and attributes are the openEHR specs and ehrtslib — not `docs/OPENEHR_PRIMER.md` (illustrative only). Implementation of registry-driven shells waits on the ehrtslib RM attribute introspection API (`docs/proposals/ehrtslib-rm-attribute-introspection.md`); no interim hand-maintained meta table in intEHRgrator.
_Avoid_: Value constructor block, DV builder, free-form RM block, “+ fields” image button

**Modest Blockly Theme**:
Visual style aligned with the Blockly DevSite landing demo (thrasos renderer, Google Sans, pastel category accents) plus intEHRgrator Source / Data values categories. See `docs/BLOCKLY_INTEGRATION.md` Attribution.
_Avoid_: Default Blockly look, ad-hoc category colours unrelated to the demo palette

**Cross-Cutting RM Structure**:
Optional RM types attachable via Optional RM Insertion (cogwheel mutator / context menu **Optional attributes…**), not free toolbox construction — e.g. feeder audit, links, party proxies, participations — wherever the RM permits on the parent. Nested mandatory children auto-attach; optional children stay lazy. RM attribute facts come from ehrtslib introspection (proposed BMM-generated meta API); which optional attributes are offered in the mutator (OPT context, already-present, product policy) stays in intEHRgrator — not an ehrtslib `validAttachments` helper.
_Avoid_: Primer-only RM list, toolbox free-build of LOCATABLE extras, library-level attachment picker API

**Mapping Specification**:
Canonical interchange is native Blockly workspace JSON (`ProjectBundle.mapping.blocklyState`). The Mapping Spec tab shows a compact projection of that JSON, not the JSON document itself. Blockly is used **declaratively**: the canvas is a slot tree plus constructors (including a **default context map**) and lookups — not an imperative program. **Conversion start** designates the **Product stack**; stack order is juxtaposition of fragments, not “then do this.” Optional **Blockly Function**s are reusable fragments of that tree, not a sequential script. See `docs/MAPPING_SPECIFICATION.md`, ADR 0001, ADR 0006, ADR 0008, ADR 0010, and ADR 0011.
_Avoid_: Private `@template` DSL, Mapping script as a third language, treating the canvas as a sequential script

**Blockly Function**:
A stock Blockly procedure (Functions drawer): a **value** definition (`procedures_defreturn`) or a **statement** definition (`procedures_defnoreturn`), plus call sites. `procedures_ifreturn` is an early-return statement *inside* a definition, not a third Function kind. **Extract to function** on a block context menu moves that subtree onto a new definition and leaves a call in place. Still Mapping Specification (Blockly JSON). Derived into Mapping Model `functions[]`; value call sites serialize as Mapping Expression `call("name", …)` (never `function(`). Conversion scripts emit a reusable named function where the dialect allows it (TypeScript inner function, Java method, XQuery `declare function`, VMS-Go `define`/`template`). VMS-Hbs forbids partials, so Handlebars does not emit a named helper. Persist one Function (definition + Decision tables it uses) as a **Function bundle**; load from disk or the **Function library**. Name clash: rename (default) or replace.
_Avoid_: treating Functions as an unverified escape hatch, inlining the same helper at every call site in TS/Java/XQuery/Go, TypeScript/Java export function, Conversion script, custom DSL subroutine

**Function bundle**:
Portable JSON (`kind: "intehrgrator-function"`, version 1) for one Blockly Function: `name`, `description`, `parameters`, `hasReturn`, `decisionTables`, `blocklyState` fragment, `sheets`. Filename `*.intehr-function.json`. Not a Project Bundle.
_Avoid_: Project Bundle, Conversion script module

**Function library**:
Curated Function bundles at `function-library/` (`catalog.json` + per-Function JSON). Default GitHub catalog is this repo’s `function-library/catalog.json`. Starters: `join_swedish` and `join_oxford` (FIRST Decision tables, not a `join_list` builtin). Contribute files a GitHub issue (description required; signup/login if unauthenticated). Agent index: `function-library/index.md`. Accepting contributions: `function-library/AGENTS.md`.
_Avoid_: auto-merge contributions, `join_list` Mapping Expression builtin, Conversion script helpers

**Mapping Spec Widget**:
One projected row in the Mapping Spec tab: a compact, indented view of one semantic mapping (source path, map lookup, sheet lookup, literal, text generation, flattened condition, or container). Safe Blockly fields are editable in the row (paths, map keys, literals, compare operands, loop VAR/PATH, `text_code` LANG/TEXT). Wrappers that do not change mapping meaning (`xml_text`, `xml_cdata`, `DV_*` shells, unnamed maps) are omitted; their Blockly ids stay on the visible row. Download/Upload still round-trip the **full Blockly JSON document**.
_Avoid_: JSON fragment, custom DSL, treating the Spec view as the persistence format

**Mapping Model**:
Derived semantic index (`templateId`, `targetFormat`, `slots[]` with expressions and optional escape-hatch metadata, `loops[]` with grain/`kind`, nested `targetSignature`, `optionalRm`, `unsupported`, `sheetNames`, `functions[]` for Blockly Functions). Rebuilt from Blockly JSON on workspace change; used by validation, AI suggestion import, codegen, and Test Run. Does **not** include Conversion script language.
_Avoid_: Mapping schema, parallel IR, structural language

**Verifiable Mapping Subset (VMS)**:
The product profile for mappings that are safe to verify and to codegen consistently: hostile stock Blockly (while/for/random/print, statement `controls_if`, list-index mutators) and sheet mutators are **removed from the toolbox**. **VMS-Hbs** and **VMS-Go** (ADR 0009) are in-dialect, not hatches. Remaining hatches (out-of-dialect templates, ad-hoc JSON/XML trees) are flagged for lint ([#40](https://github.com/regionstockholm/intehrgrator/issues/40)). Blockly Functions are first-class (`call` + `functions[]`), not a hatch. Implemented in `src/blockly/vms.ts` (PR #58, closed [#35](https://github.com/regionstockholm/intehrgrator/issues/35) / [#37](https://github.com/regionstockholm/intehrgrator/issues/37)). Golden oracles and preview/codegen equivalence are [#38](https://github.com/regionstockholm/intehrgrator/issues/38)+.
_Avoid_: treating every Blockly block as VMS, re-adding sheet mutators to the default toolbox, treating all Handlebars or Go templates as unverified

**VMS-Hbs**:
The Handlebars dialect editors and `renderHandlebars` accept: paths, `#if`/`#unless`/`#each`/`else`, comparison helpers (`eq`/`ne`/…/`and`/`or`), `toLowerCase`/`toUpperCase`, `slot`, `~` whitespace, Mustache-style `{{#path}}` sections. Not the same syntax as **VMS-Mustache** or **VMS-Go**. See [ADR 0009](docs/adr/0009-verifiable-template-dialects.md).
_Avoid_: full Handlebars.js, `#with`/`lookup`/`#log`/partials, calling VMS-Hbs “Mustache”

**VMS-Go**:
The Go `text/template` dialect `text_code` (LANG=`go-template`) and the WASM runtime accept: `{{.Path}}`, `{{index .Data "literal"}}`, `if`/`else`/`range`, comparison builtins, curated FuncMap (`replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `upper`, `substr`, `int`), acyclic `define`/`template` with literal names. Not Mustache and not VMS-Hbs. See [ADR 0009](docs/adr/0009-verifiable-template-dialects.md).
_Avoid_: `call`, `with`, Helm `include`, full Sprig, JS/TS in `text_code`

**Generated Export**:
Executable TypeScript, Java, Handlebars, or XQuery produced by Conversion script language adapters from the Mapping Model (and canvas **Handlebars text block** when present). Shown in **Generated conversion script(s)** only when Output mode is a Conversion script language — not in the center pane, and not while Mapping preview is selected. Derived from the Mapping Specification after restore; not stored in the Project Bundle. Scripts that contain **Map lookup**s take a convert-time `defaults` argument keyed by **runtime keys** (see [ADR 0002](docs/adr/0002-convert-time-defaults.md) and [ADR 0011](docs/adr/0011-default-context-map-runtime-keys.md)).
_UI label:_ section title **Generated conversion script(s)**.
_Avoid_: Export code, preview TypeScript

**Sync Scope**:
Blockly workspace JSON (canonical structure) ⇄ Mapping Spec widgets for **safe field edits** (source paths, map name/key, literals, compare operands, loop VAR/PATH, `text_code` LANG/TEXT) → Mapping Model slots[] (derived index) → codegen / Test Run. The compact projection is not persisted; Download/Upload keep **full Blockly JSON**. Structure, Optional RM Insertion, ids, and coordinates stay Blockly-only. Canvas undo/redo is the single history. Center CodeMirror is **not** Generated Export.
_Avoid_: Full handwritten Blockly JSON as primary editor, custom DSL as middle language

**Web app**:
Local-first web app (GitHub Pages) using browser file picker and IndexedDB behind `WebHostAdapter`. Optional in-app **AI chat** uses credentials stored in this browser only; copy-paste and IDE/MCP remain valid.
_Avoid_: Web Shell (former name), GH Pages app, browser version

**Desktop app**:
The same workbench, packaged with `deno desktop` as a native window (OS webview) that serves the built `dist/` on `127.0.0.1`. File pickers and IndexedDB still go through `WebHostAdapter`. Rebuild with `deno task compile:desktop`.
_Avoid_: Electron, ehrtslib CLI release, treating the desktop binary as a different mapping engine

**VS Code / Cursor Host**:
Second Host adapter (`VsCodeWebviewHostAdapter` + `extension/`) packaging the same Mapping Editor webview bundle; workspace FS and extension storage replace IndexedDB/file picker.
_Avoid_: Separate fork of the workbench

**AI Assist**:
**Copy prompt** builds a markdown prompt (target/source origins as file or URI; delivery mode: inline multipart, chat attach, or URI browse; slot manifest; link to response format spec). **AI chat** (always-present, collapsible panel under **Target & Previews**) sends prompts to an optional OpenAI-compatible chat endpoint whose credentials live in Host localStorage — never in the Project Bundle. Send streams a tool loop with MCP / Agent API tool names (`map_slot`, `import_suggestions`, `run_test`, …) on the live workbench; a provider that rejects tools gets one suggestions-JSON turn instead, applied directly. IDE/MCP mapping and a remote HTTP Agent API remain valid without in-app credentials. Provider keys: `docs/AI_CREDENTIALS.md`. Architecture: `docs/MCP_ARCHITECTURE.md`.
_Avoid_: AI Suggest button as the only path, baking API keys into the Project Bundle, **Call AI** (former one-shot action, replaced by **AI chat**)

**AI chat**:
Multi-turn chat panel in the lower split of **Target & Previews** (draggable, collapses to a slim bar via its toggle, collapsed state and height remembered, visible on every tab). Never closed: without credentials it offers copy & paste prompting (compose the prompt from the chat input, then **Import AI answer…** into **Mapping Suggestion Import**). With credentials **Send** streams the answer (and any model reasoning) into a live bubble; tool calls change the canvas right away, each applied mapping shows as a short ✓ line, and the whole turn is one **Undo** step attributed to the AI (ADR 0014; the chat writes through the same `WorkbenchService` as MCP). While a run goes, **Send** becomes **Stop** (also Esc), which ends the run and keeps what was applied. The Import Suggestions approval modal is only for pasted answers. The first message carries the project context: for Send the compact **API chat context** (slot manifest, source path outline, example list; no file bodies), for copy & paste the **Copy prompt** text; later messages carry only the user text and newly added **Context chip** details. History is kept per project in browser localStorage, never in the Project Bundle; before Send, older turns are dropped when the history estimate passes a token budget (the chat says so and re-attaches the context); The trash button (**Clear chat history**) shrinks the context: the next message (or copied prompt) carries the full project context again, so in copy & paste mode the user also starts a new chat in the external AI. An (i) in the header explains every control for the current mode. See ADR 0013.
_Avoid_: Call AI, Revert last AI turn (retired), copilot, saving chat history in the Project Bundle, Approve first / Apply directly (retired AI chat modes, #252)

**API chat context**:
The project context AI chat **Send** attaches to the first message (`buildAiPromptText("api")`): compact slot manifest, a one-line-per-node source path outline, and an example manifest, with pointers to the tools for Optional RM Insertion, Constraint warnings and example values (`list_optional_rm`, `list_constraint_warnings`, `get_example`). It never carries file bodies (raw OPT, schema, examples) or attach / URI wording; those stay in the copy & paste deliveries (inline, attach, URI).
_Avoid_: inlining the OPT for Send

**Context chip**:
Inline reference in the AI chat input to a source schema node, Example Instance node, target node, or Blockly block, added with right-click → **Add to AI chat**. Hover shows the full identification (file, path, type, example value; template, slot, RM type; block type, id, bound slot / source path). On send it is written as `[@Kind: label]` in the text and expanded once per chat into a fixed **Context attachments** markdown block.
_Avoid_: canvas declaration chip, **scaffold target** chips (different concepts), pasting paths by hand

**Stored prompt**:
Reusable AI chat prompt from the **Prompts** ▾ (stored prompts) menu. Built-ins are read-only (**Map the whole project** = the Copy prompt text, **Loop with a for each block**); user prompts live in browser localStorage, are added from a `.md` / `.txt` (one prompt) or `.json` (list of `{name, text}`) file or URL, removed with ×, and exported as JSON. `{source_node}` / `{target_node}` placeholders are filled from **Context chips** in the input and stay visible when no chip matches.
_Avoid_: prompt template (clashes with openEHR templates), storing prompts in the Project Bundle

**Mapping Suggestion Import**:
Applying parsed suggestions from an external AI response in `intehrgrator-suggestions` JSON version 2 (slot-keyed Blockly block subset). The dialog also shows the answer's Notes / Questions and per-suggestion notes and confidence. See `docs/AI_SUGGESTION_FORMAT.md`.

**AI review marker**:
An imported suggestion's `note` and `confidence` (integer percent the model estimates the mapping is correct) kept on the mapped value block. It shows as a dashed outline, an `NN%` badge and a comment until the user edits the block or chooses **Mark as reviewed**. The raw value and that outcome stay in block data for later calibration.
_Avoid_: AI paste, bulk map

**Host Abstraction**:
Shared interface (`pickTextFile` / bytes, storage, clipboard, download, `resolveAppUrl`) so core mapping logic is host-agnostic. Adapters: Web (IndexedDB) and VS Code/Cursor webview. No DOM `File` types cross the seam.
_Avoid_: Environment abstraction layer, platform bindings

**Workbench Test API**:
Programmatic seam exposed as `window.intehrgratorTestApi` when the web app is opened with `?testMode=1`. Loads Template Skeleton / Source Schema / Example Instance fixtures without file pickers; reports Mapping Model, Blockly block summary, and Test Run results. UI tests still click Target value slots, Example Instance tree rows, and **Run Test** so Click-to-Map is exercised through the real DOM. See `docs/UI_TESTING.md`.
_Avoid_: formTestApi (kintegrate name), Cypress-only harness

**Workbench Agent API**:
Headless localhost HTTP surface on the **desktop app** (`/api/v1/*`), backed by **`WorkbenchService`** (Blockly JSON / Mapping Model / Project Bundle — no DOM). The compiled / `deno run` entry accepts **`--headless`** (no browser / hidden native window), **`--load`**, **`--port` / `--bind`**, and **`--token`** (required when bind is not loopback). IDE agents and the stdio **MCP** server share the same tools: load target/schema/examples/**Example Set** / **Function library**, inspect slots/source/sheets/product stack, import suggestions, map-slot, Optional RM, Instance encoding, advisory **slot leases**, build-prompt, run-test, undo/redo, generate Conversion Script, and bundle load/export. Mutations return a **session revision** token (`If-Match` / 409 on conflict; 409 also for a foreign slot lease). The open UI polls `/api/v1/snapshot` and reloads the bundle when revision changes. Disabled with `INTEHR_AGENT_API=0`. See `docs/AGENT_WORKFLOW.md`.
_Avoid_: conflating with Workbench Test API, treating the GitHub Pages web app as the Agent API host

**Slot lease**:
Advisory lock on one Target value slot so parallel Agent API / MCP writers do not overwrite each other (archived S-15, now in the headless Agent API). `lease_slot` acquires (default TTL 120s), `release_slot` drops it, `list_leases` lists holders. A foreign `map_slot` is **409**; `import_suggestions` **skips** those slots and reports them. Not a CRDT and not an exclusive file lock — a second agent can wait or map other slots.
_Avoid_: CRDT, treating a lease as a mutex over the whole Project Bundle

**Undo** (sv: Ångra):
Take back the newest change still in effect, whoever made it (you, AI chat or an MCP agent); Redo puts it back. Undo works from the top of the history down: **Undo to here** on an older history entry takes back every later change in one step. The status line says whose change was taken back. Undo is itself recorded in the history; nothing is deleted from it.
_Avoid_: per-author undo (that is **Revert**), rollback, deleting history entries

**Revert** (sv: Häv):
Take back one earlier history entry, for example one AI chat turn, by a new change at the end of the history. Changes made after that entry stay: slots that were changed again later are left as they are and listed, so nothing newer is lost.
_Avoid_: Revert last AI turn (retired button), undo (Undo always takes back the newest change first)

**History panel**:
The list of every change to the mapping, newest first, opened with the clock button next to Undo / Redo. Each row says who made the change (you, AI chat with its model, or MCP with the client) and offers **Undo to here** and **Revert**. Undone rows stay in the list, struck through.
_Avoid_: timeline (the observer's scrubber), audit log

**AI author marker**:
A small "AI" badge on a mapping block that the AI chat or an MCP agent wrote, naming the author on hover. It stays until you change that slot yourself; it is separate from the review marker, which says how sure the AI was.
_Avoid_: review marker, confidence badge

**Session revision**:
FNV-style hash of Mapping Model + Blockly workspace JSON returned as `revision` / `r<hex>` on Agent API reads and after each mutation. Agents pass **`If-Match: <revision>`** (or MCP `revision`) for optimistic concurrency; **`undo` / `redo`** walk a joint **attributed semantic history** (user + registered agents) from the top, whoever made the change, and **`revert`** takes back one entry as a new change (ADR 0014); the history is only appended to. Blockly canvas undo remains for direct block edits; service history merges UI semantic commits via `/ui-commit`. On the desktop every semantic UI change (Blockly edits and controller changes such as Click-to-Map, AI chat tools and Import Suggestions) is committed before an agent change is synced in, and each synced agent change is one canvas undo step (ADR 0014). Open **observer** for timeline scrub, going back to an entry (an appended Undo), and patch-undo prompts.
_Avoid_: wall-clock timestamps, assuming revision survives a full browser reload without re-fetching snapshot

**Agent actor**:
Registered MCP session identity `{ agentId, displayName, color }` returned from **`register_agent`**. Mutations carry **`X-Agent-Id` / `X-Agent-Name`** headers; history entries record actor + summary and an **origin** (ADR 0014): `human`, `ai-chat` (provider, model and a turn id; one entry per AI chat turn, a pasted AI answer included) or `mcp` (the MCP client from `initialize` `clientInfo.name`, sent as **`X-Agent-Client`**; an unregistered client shows as `MCP: <client>`, not as the user). Desktop assigns colour from id hash when omitted.
_Avoid_: anonymous agent rows when registration is available

**Agent observer**:
**Open observer** extends the Open canvas popup: live Blockly snapshot, per-agent legend, and **history timeline** (scrub preview, destructive rollback with optional **discarded-branch** `.intehrgrator` download, copy patch-undo prompt). Main canvas shows subtle pulse on agent-touched slots; **Follow agent** (opt-in) pans the main workspace.
_Avoid_: auto-scrolling the main canvas by default while a human is editing elsewhere

**Conversion script language** (older docs said Export dialect / Export Target; code key `exportTarget` was a persisted setting — no longer saved):
An **Output mode** value that generates a Conversion Script (`typescript` | `java` | `handlebars` | `xquery`). Downstream of the Mapping Model — Blockly blocks and mappings are language-agnostic. Distinct from Target instance format and from Mapping preview. Not stored in the Project Bundle.
_Avoid_: Export dialect, Export Target (prefer this term), Target language alone, conflating with Target instance format or Mapping preview

**UI language**:
The application locale for Blockly messages and the rest of the web app chrome (toolbar setting). ISO 639-1 codes (`en`, `sv`, `de`, `es`, `ca`, `fr`). Distinct from **model language** (ontology labels in **Target & Previews**) and from composition language on a **default context map** — a factory openEHR map may copy UI language into **runtime key** `language` (scaffold target `*.language`) once, when the factory instance is created, and does not rewrite it if the toolbar locale later changes.
_Avoid_: Model language, conflating with default context map `language`

**Handlebars Template**:
Canvas-authored **VMS-Hbs** conversion template (`text_handlebars` plus **Code text block** LANG = Handlebars). Loading a free-form `.hbs` target seeds that product stack with a source-root context (`xpathNode("$")`). **Mapping preview** and Handlebars Output mode Test Run evaluate `handlebars(script, context)` against the Active Example. Distinct from a generated Handlebars Conversion Script (Output mode Handlebars `.hbs` export), which is the SCRIPT literal when a canvas product exists.
_Avoid_: Mapping Specification (that term means Blockly JSON), treating Handlebars as a Target instance format, calling this tab Mustache, a Mapping Editor Template tab (retired in #114)

**Output validation**:
ehrtslib `TemplateValidator` check of each openEHR RM fragment in the **Product stack** against the loaded operational template (RM specification plus template constraints), when Target instance format is `openehr-template`. Runs on the fragment *before* juxtaposition, using that root’s **Instance encoding**. ✅ on the Conversion Test Run tab if every fragment is valid; ⚠ with a formatted error list if not. Distinct from Source Pane example-tab ⚠ (instance vs Source Schema). Invalid output still appears in the editor. The glued payload string is not itself the validation input.
_Avoid_: copying Source Schema mismatch onto Conversion Test Run tabs, RM-only validation when an OPT is loaded, validating MIME/glue text as a Composition

**Better Form Bridge**:
Optional seam for Push/Pull against a licensed Better Form Renderer the user supplies in the browser. The renderer is not part of the application. See `docs/adr/0012-better-renderer-browser-cache.md`.
_Avoid_: formTestApi (kintegrate name for the form viewer API)

**Project Bundle**:
Self-contained saved workspace containing target definition (`target`), source/example content, Blockly workspace, Mapping Model, optional Sheets, settings, and metadata. Persisted via the Host and exportable as a single `.intehrgrator` file. Does **not** include Generated Export or Test Run output — those are regenerated from the Mapping Specification after the bundle is loaded.
_Avoid_: Mapping file, saved state

## Example dialogue

> **Informatician:** I loaded the vitals template and my HL7 JSON export. Where do I wire systolic pressure?
>
> **Developer:** Click the value slot on `systolic` in the Mapping Editor, then click `vitals[0].systolic` in the **active example tab** tree. Blockly JSON below is the canonical Mapping Specification; **Mapping preview** Test Run reads the Mapping Model. Pick a Conversion script language in Output mode when you want Generated Export.
>
> **Informatician:** Can I test it without exporting?
>
> **Developer:** Yes — stay on **Mapping preview** and click **Run Test**. **Conversion Test Run(s)** evaluates your Mapping Model against the loaded example and renders through the Target instance format (Composition JSON for an OPT target). A Conversion Script is only needed when you want the mapping in your own pipeline.
>
> **Informatician:** The template doesn't include feeder audit but I need provenance. How do I add it?
>
> **Developer:** Click the cogwheel on the observation block, add `feeder_audit` in the mutator mini-workspace — only valid optional attributes show. The block expands with a new slot and the structure appears nested inside. Map its fields the same way as template fields. To drop it again, remove it from the same cogwheel (the child is left on the canvas, not deleted).
>
> **Informatician:** Can AI help me map the boring fields?
>
> **Developer:** Click **Copy prompt**, or expand **AI chat** below Target & Previews and right-click nodes → **Add to AI chat** to point at them. ▾ also chooses embed files, chat attach, URI browse, or **AI credentials**. Paste a chat reply into **Import Suggestions**, or let AI chat apply it. Run Test to verify before exporting.
>
> **Informatician:** I want every composition to say St. Dummy Demo Hospital and Swedish.
>
> **Developer:** **Load target & default context map** and pick the openEHR factory (or a clinic snapshot). Confirm scaffolds **Default point**s with `maps_get("defaults", …)` on **runtime keys**. `language` on a fresh factory follows **UI language**; it is not **model language**. To build a new map, load the target into the **Target schema** tab first, pull PARTY / term pieces onto value sockets, chip the **scaffold targets**, then **Save as**. Generated Conversion Scripts still take `{ language, territory, … }` at convert time — not `*.language`.
>
> **Informatician:** The old Target slot list is gone. How do I find an unmapped field and wire it?
>
> **Developer:** **Constraint warning** triangles on Blockly and in the Mapping Specification mark unmet slots. Click a spec row to **Select** it — the canvas pans with a yellow border. If that row is a **Source query block** still showing `/path`, **Listening Mode** starts; then click the source tree. Load target now lives in **Target & Previews**.
>
> **Informatician:** I need a JSON file out, not a composition, and I do not have a JSON Schema.
>
> **Developer:** Drag **Conversion start** onto a JSON object from the JSON drawer — that object is the **Instance root**. Mapping preview and Generated Export walk the **Product stack**. Load a JSON Schema if you want a **Template Skeleton**; Start is still attached on top. Same pattern for XML and a **Text document**. One Start, one concatenated product — extra files belong in the pipeline around this script, not on the canvas.
>
> **Informatician:** I need two compositions in one payload, with brackets around them.
>
> **Developer:** Stack the two COMPOSITION **Instance roots** under Start. Put **Text document** fragments between and around them for `[`, `,`, `]`. A `for_each_list` in that stack repeats a root per source node; a `for_each_list` *inside* a COMPOSITION still repeats `content`, not the product list.
