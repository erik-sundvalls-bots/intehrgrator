# UI Architecture: Integration Workbench

This document details the split-screen mapping interface and its architectural considerations for both GitHub Pages and VS Code environments.

## Layout Overview

**Wireframe reference:** [docs/assets/prototype-ui-v1-consolidated.png](assets/prototype-ui-v1-consolidated.png) (consolidated v1 mockup; supersedes early `mapping-interface.pen` explorations).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               [File] [AI ▾] [Example Sets] [Functions] [Help]                          │
│               File holds New, Load, Save as, Export, and Import                        │
├───────────────┬──────────────────────────────────────────┬─────────────────────────────┤
│ LEFT PANE     │ CENTER PANE                              │ RIGHT PANE                  │
│ Source        │ Mapping Editor                           │ Target & Previews           │
│ (slide-away)  │                                          │ (tabbed, slide-away)        │
│               │                                          │                             │
│ Schema        │ ┌─ Blockly (top) ──────────────────────┐ │ Load target & map           │
│ [Load Schema] │ │ nested RM blocks                     │ │ tabs: Target schema |       │
│               │ │ toolbox: Source/Literals/            │ │ Generated conversion        │
│ Examples      │ │ Logic/Variables                      │ │ script(s) | Conversion      │
│ [+ Add Ex.]   │ ├─ Mapping Spec (bottom) ──────────────┤ │ Test Run(s)                 │
│ [ex-a][ex-b]  │ │ widgets + expressions                │ │                             │
│ instance tree │ └──────────────────────────────────────┘ │                             │
├───────────────┴──────────────────────────────────────────┴─────────────────────────────┤
│ #status-main: Template · Target · Example · unmapped · message │ #status-save │ build │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Resizable split dividers between all three panes (and within Source / Mapping / Output sections) persist layout sizes in `localStorage`.

## Pane Details

### Left Pane: Source Browser

The left pane has two stacked sections: **schema** (upper) and **example instances** (lower, optional but central to testing). A sidebar icon in the upper-left corner of the pane header slides the pane away; the collapsed rail restores it.

#### Upper — Source Schema

- **Purpose:** Structural view for authoring mappings (field names, types, cardinality)
- **Pane action:** **Load Schema** button in the Schema section header
- **Inputs:** Schema file (JSON, XML, or other structural definition), or structure inferred when only instances are loaded
- **Interactions:** Click or drag tree nodes → insert fontoxpath expression into focused mapping slot
- **Note:** Mapping can proceed from schema alone; Test Run still needs an example tab

#### Lower — Example Instances (tabbed)

- **Purpose:** One or more JSON/XML **instance** files for click-to-map with concrete values and for Test Run
- **Pane action:** **+ Add Example** button in the Examples section header
- **UI:** Horizontal **example tabs** — one tab per loaded instance file, plus **+** to add another
- **Active tab:** Drives (1) the instance tree shown below the tabs, (2) **Test Run** input, (3) lower **Conversion Test Run(s)** label (`Running: patient-a.json`)
- **Switching tabs:** Instantly switches instance tree and shows that tab's cached Test Run (Auto-run fills it if it has none yet)
- **Close tab:** `×` on tab; if the last tab closes, Test Run has nothing to run (Auto-run stays on and resumes with the next example)

```
┌─ SCHEMA ────────────────────────────────┐
│ ▼ patient                               │
│   ├─ id          string                 │
│   └─ vitals[]    array                  │
├─ EXAMPLES ──────────────────────────────┤
│ [patient-a] [patient-b] [edge-case] [+] │
├─ instance tree (active tab) ────────────┤
│ ▼ patient                               │
│   └─ vitals[0]                          │
│       └─ systolic  120  ◄──             │  (click-to-map)
└─────────────────────────────────────────┘
```

- **Source querying:** [fontoxpath](https://github.com/FontoXML/fontoxpath) — see [SOURCE_QUERY.md](SOURCE_QUERY.md)
- **Technology:** Custom tree widget, tab bar for examples

**Click-to-map source:** User may click a node in the **schema tree** or the **active example instance tree**; both produce fontoxpath expressions. Example trees help when paths depend on concrete array indices or sampled values.

### Center Pane: Mapping Editor
- **Purpose:** The main workspace where the mapping logic is defined
- **Default layout:** Vertical split (not tabs):
  - **Top — Blockly canvas:** Nested puzzle-piece blocks representing the openEHR RM structure from the loaded OPT
  - **Bottom — Mapping Specification:** Compact **projection** of the Blockly workspace (not pretty-printed JSON, not a custom DSL). One Mapping Spec Widget per semantic row; wrappers with no mapping meaning are omitted. Safe fields (paths, map keys, literals, `text_code`) are editable in the widgets. **Download** / **Upload** still round-trip full Blockly JSON. Synced with Blockly via Mapping Model. See [MAPPING_SPECIFICATION.md](MAPPING_SPECIFICATION.md) and [ADR 0006](adr/0006-compact-mapping-spec-projection.md).
- **Blockly toolbox categories:** Source (orange), Literals (green), Logic (brown), Variables (magenta) — colour-coded in the flyout and category rail
- **Minimap:** Shown when the Blockly workspace content exceeds the visible canvas at the current zoom level, allowing quick navigation in deep templates
- **Sync pattern reference:** The Blockly ↔ text sync follows patterns demonstrated by [BlockMirror](https://blockpy-edu.github.io/BlockMirror/docs/); the text editor implementation uses [CodeMirror 6](https://codemirror.net/) directly
- **Template skeleton:** Auto-generated from loaded OPT. Includes template-constrained nodes **and** silent-mandatory RM fields (required by RM but absent from OPT) — all visible. Unmapped mandatory slots surface at Test Run validation.
- **Optional RM insertion:** `+` button on container blocks opens a **filtered picker** (only RM-valid types for that attachment point). Right-click → "Add RM structure…" opens the same picker. On selection, the parent block undergoes **block expansion** — it is modified to expose the new statement input before the child block is inserted. Pre-rendered empty slots are not shown by default.
- **Technology:** [Blockly](https://developers.google.com/blockly) + [CodeMirror 6](https://codemirror.net/)

### Right Pane: Target & Previews
- **Purpose:** Load the target, browse its schema, preview generated conversion-script code, and run conversion tests
- **Header:** pane title **Target & Previews**; **Load target & default context map**; **Output mode**; sidebar icon in the upper-right corner slides the pane away
- **Tabs** (Shoelace `sl-tab-group`; usually not needed at the same time):
  1. **Target schema** — tree of the loaded target. Pull a leaf or subtree onto empty canvas → corresponding Blockly, scaffolded from the current **default context map**. Leaf → **scaffold target** chips; subtree → map value socket.
  2. **Generated conversion script(s)** — executable TypeScript / Java / Handlebars / XQuery from the Mapping Model (read-only CodeMirror)
  3. **Conversion Test Run(s)** — runs mapping against the **active example tab**; displays the produced instance. Section header includes **Run Test** and **Pause / ▶ Auto-run**. The selected test-file tab is neutral blue; it turns red-tinted only when that file's output has an error (⚠). There is no "Validate as" picker: openEHR JSON output is validated with ehrtslib's canonical-strict preset (#246, #256).
- Unmapped mandatory slots and unmet cardinality show as **Constraint warning** triangles on Blockly and on the matching Mapping Spec Widgets. Click a spec widget or Blockly block to **Select** (yellow border + pan); placeholder Source query blocks also enter **Listening Mode**.

### Web components (Shoelace)

When changing chrome (tabs, dialogs, drawers, menus), prefer [Shoelace](https://shoelace.style/) components already used in the web app (`sl-tab-group` for **Target & Previews**). Keep the Karolinska colour tokens (`--sl-color-primary-*` in `web/styles.css`). Do not rewrite working custom widgets (split panes, tree, Blockly) just to swap libraries.

## Toolbar & Pane Actions

Actions are split between the **header toolbar** (project-wide) and **pane headers/sections** (contextual).

### Header toolbar

| Button | Action | v1 |
|--------|--------|-----|
| AI ▾ | Three sections. **copy/paste for external AI chat:** embed / attach / URI (copy icon), Import AI suggestions (paste icon). **Your own AI:** Configure AI credentials… (the AI chat itself is the always-present panel under Target & Previews). **Desktop** (downloaded app only): Local MCP server… opens a panel that starts or stops agent tools and shows the IDE `mcp.json` | ✓ |
| Example Sets | Load a complete example set (source schema + instances, target, optional mapping) from a URI catalog | ✓ |
| New Project | Reset workspace to empty project (confirm if content present) | ✓ |
| Load Project | Open modal listing autosave + recent manual saves | ✓ |
| Save as | Open modal to name and persist a manual save to IndexedDB | ✓ |
| Export Project | Download self-contained `.intehrgrator` bundle | ✓ |
| Import Project | Load `.intehrgrator` bundle | ✓ |

### Pane actions

| Button | Location | Action | v1 |
|--------|----------|--------|-----|
| Load Schema | Source → Schema section | Split control: main click loads a schema file; chevron offers **From file**, **From URL**, and recent URLs | ✓ |
| + Add Example | Source → Examples section | Split control: main click opens a JSON/XML instance; chevron offers file, URL, and recent URLs | ✓ |
| Load target & default context map | Target & Previews header | Split control: main click opens the joint target + default context map dialog; chevron offers file, URL, GitHub, and non-destructive refresh | ✓ |
| Slide-away | Source / Target & Previews headers | Hide the pane so the Mapping Editor takes the width; rail tabs restore it | ✓ |
| Export TS | Target & Previews pane header | Download the generated TypeScript mapping script | ✓ |
| Run Test | Output → Conversion Test Run(s) | Run every test file once (active first); marks all tabs | ✓ |
| Pause / ▶ Auto-run | Output → Conversion Test Run(s) | Auto-run is **on by default**: debounced (~500 ms) run of all test files after edits. Pause is remembered per browser (slow computers) | ✓ |
| Search (find in pane) | Upper-right overlay inside Source Schema, Example Instances, Target Schema and the Mapping canvas (same faded overlay as the CodeMirror editors) | Opens a find panel docked at the top of that pane; see *Find in pane* below | ✓ |

### Find in pane (#218)

The trees and the Mapping canvas have the same find as the CodeMirror text views (#208/#215):

- **Open:** the Search overlay button in the pane's upper-right corner, or **Ctrl/Cmd+F** after clicking in the pane. Inside a CodeMirror editor (or any text input) Ctrl/Cmd+F stays that editor's own find.
- **Panel:** docked at the top of the pane: query, **next** / **previous**, **match case**, **regexp**, **by word**, a "*n* of *m*" count, close. Enter / Shift+Enter (or F3 / Shift+F3) step and wrap; Escape closes and clears the marks.
- **Matching:** every hit is highlighted as a substring (yellow; current hit orange). The first hit is selected while typing; Next then goes to the second. When the query changes, the current hit is kept while a hit still starts there, otherwise the first hit is selected.
- **Trees:** names, RM types / occurrences and instance values are searched. The current hit's row is scrolled into view (inside the pane only). Marks follow tree re-renders (Auto-run, new examples).
- **Mapping canvas:** visible field text of every block (titles, labels, dropdowns, text inputs) in reading order. The current hit's block is selected (the Mapping Spec follows, as on a click) and panned into view only when it is off screen. Keys typed in the find panel never reach Blockly shortcuts.

### Deferred (not in current web app UI)

| Button | Notes |
|--------|-------|
| Export Java | Generator emits Archie RM (`docs/JAVA_EXPORT.md`); pick Output mode Java to view/download. Not executed in-app. |
| Settings | Target language, theme, validation strictness — planned; export target defaults to TypeScript |

## Test Runner (v1)

The test runner is a core informatician workflow, not a nice-to-have.

1. User loads template + source schema (optional) + one or more **example instance tabs**
2. User authors mappings in Mapping Editor (schema and/or active example tree for click-to-map)
3. Test execution uses the **active example tab** as input:
   - **Auto-run (default on) / Pause** — one switch shared by all test-file tabs
   - **Auto-run on:** debounced run (~500 ms) of **all** test files after mapping, sheet, output-mode and example edits; every tab's ⚠ / ✅ mark updates
   - **Paused:** user clicks **Run Test** (runs all test files once). Pausing is remembered in localStorage, not in the Project Bundle
4. Lower **Conversion Test Run(s)** section shows converted output for active source example; **tab switch** shows the **cached last result** for that tab (no automatic re-run on switch)

**Per-tab result cache:** Each example tab remembers its last Test Run output. Switching tabs is instant. **Run Test** and Auto-run refresh all tabs.

### Auto-run rules

| Condition | Behaviour |
|-----------|-----------|
| Default (new session, any project) | Auto-run **on** |
| No example tabs (schema-only) | Nothing runs; the toggle still works |
| Auto-run on + edit | Debounced run of all test files |
| Tab switch | Cached result; runs only if that tab has none yet |
| Paused + **Run Test** | Runs all test files once |

**Runtime:** Bundled `ehrtslib` in the web app; generated mapping code is executed client-side (no server).

**Out of scope v1:** Java test execution, uploading results to a CDR.

## AI Assist

**Copy prompt** builds markdown for an external chat. **AI chat** is an always-present multi-turn panel in the lower split of **Target & Previews** (draggable; a square toggle collapses it to a slim **AI CHAT** bar; collapsed state and height remembered; visible on every tab). With optional OpenAI-compatible credentials (localStorage, never the Project Bundle) Send streams the answer and any model reasoning into a live bubble, sends OpenAI function tools named like MCP / the HTTP Agent API and runs them on the live workbench (a ✓ line per applied mapping, **Revert last AI turn** for the turn, interim until [ADR 0014](adr/0014-one-write-path-attributed-undo.md) makes each AI turn one attributed undo step); while it runs, Send becomes **Stop** (or Esc). The first Send carries the compact **API chat context** (no file bodies); older turns are dropped against a token budget with a note. The Import Suggestions modal is only for pasted answers (#252). Without credentials the panel offers the same copy & paste flow: **Copy prompt** composes the prompt from the chat input, **Import AI answer…** opens Import Suggestions. Right-click a source schema / example node, a target node, or a Blockly block → **Add to AI chat** for an inline **Context chip**. **Prompts** ▾ (stored prompts) holds built-ins plus user prompts (localStorage). The header stays on one row: an (i) explains the controls per mode, and a trash icon clears the chat history (the next prompt resends the full context). Code: `src/ui/ai_chat_panel.ts`, `src/core/ai/chat_context.ts`, `chat_history.ts`, `stored_prompts.ts`; see [ADR 0013](adr/0013-ai-chat-replaces-call-ai.md). See [docs/future/integrated-ai-assist.md](future/integrated-ai-assist.md).

### Copy prompt / AI chat

1. User optionally selects a single value slot (scopes prompt to that `slotId`) or leaves unselected (all unmapped slots)
2. Expands **AI chat** (toggle on its bar under Target & Previews) or opens ▾ and picks a copy/paste delivery mode (embed, attach, URI) or **Import AI suggestions**
3. **Configure AI credentials…** — pick a provider (Gemini, OpenAI, Anthropic, Ollama local/cloud, LM Studio local/cloud, Hugging Face, OpenCode Zen / cloud runner). Each preset fills the OpenAI-compatible endpoint and links to that vendor’s key page. Walkthrough: [AI_CREDENTIALS.md](AI_CREDENTIALS.md).
4. App copies markdown to clipboard, or POSTs it. AI chat with tools inspects `list_slots` / `get_source_tree` and writes via `map_slot` or `import_suggestions`. One-shot mode still imports `intehrgrator-suggestions` JSON.
   - Task description (map source → loaded **Target instance format**) and scope (`slot` | `full`)
   - Target: format, `targetId`, filename, origin (file or URI), structure summary
   - Source schema and example instance(s): format, filename, origin
   - Slot manifest: `{ slotId, valueType, label, targetPath?, multiplicity? }` for in-scope unmapped slots
   - **Artifact delivery** — one of:
     - **Embed files in prompt** (`inline`) — multipart file bodies in the clipboard text
     - **Attach files in chat** (`attach`) — checklist for chat UI uploads
     - **Browse URIs** (`uri`) — instruct agents that can fetch URLs; local-only files fall back to attach checklist
   - Link to [AI_SUGGESTION_FORMAT.md](AI_SUGGESTION_FORMAT.md) (deployed URL) specifying version 2 Blockly-subset response format
4. User pastes into external AI chat (ChatGPT, Claude, Cursor, etc.)

### Import Suggestions

1. User copies the `intehrgrator-suggestions` fenced JSON (or raw JSON) from the AI response
2. Clicks **Import Suggestions** → paste dialog (pre-filled from clipboard when the text looks like suggestions)
3. App validates version `"2"` against [AI_SUGGESTION_FORMAT.schema.json](AI_SUGGESTION_FORMAT.schema.json); matches `target` when present (otherwise uses the loaded target); resolves each `slotId`; converts Blockly `block` → Mapping Model expression; applies to the value slot
4. Applied / skipped / schema errors stay visible in the dialog; **Copy errors for AI** builds a follow-up the user can paste back into the chat; user verifies with **Run Test**

## Cross-Pane Interaction: "Click-to-Map"

The core user workflow:
1. User clicks on an **element value slot** in the Blockly canvas (top half of Mapping Editor)
2. The slot enters **listening mode** (highlighted)
3. User clicks a **source tree node** in the schema section **or** the active example instance tree
4. A `source_query` block (XPath via fontoxpath) is auto-inserted into the slot, with `returnType` set from the slot's `DV_*` type
5. The CodeMirror panel updates in real time

**Secondary interaction:** Drag a source tree node onto a Blockly value slot (skips listening mode).

**Deferred:** Wildcard placeholder blocks — see [docs/future/wildcard-source-mapping.md](future/wildcard-source-mapping.md).

## Optional RM Insertion

1. User clicks `+` on a container block (e.g. `OBSERVATION`) or right-clicks → "Add RM structure…"
2. **Filtered picker** shows only RM-valid structures for that attachment point (derived from ehrtslib RM definitions + template context)
3. **Block expansion:** the parent block definition is updated to include the corresponding statement input if not already present
4. The chosen structure is inserted as nested Blockly blocks in the new input
5. User maps the new structure's value slots via click-to-map as usual

Validation: the picker never offers types that violate RM cardinality or type constraints at that node.

## CodeMirror Sync Scope (Mapping Editor)

The center CodeMirror panel shows the **[Mapping Specification](MAPPING_SPECIFICATION.md)** — not Generated Export.

| Panel | Content | Editable |
|-------|---------|----------|
| Center / bottom | Mapping Specification (block-aligned DSL) | Expressions only (`=` lines) |
| Right / upper | Generated Export (TypeScript/Java) | Read-only |

| Editable in spec text | Read-only in spec text |
|-----------------------|-------------------------|
| JS-shaped expressions (`xpathNumber(...)`, `trim(...)`, `if(...)`) | `composition`, `section`, `observation`, `element` structure |
| | `slotId`, `:: DV_*` type annotations |
| | Optional RM insertion (use Blockly `+`) |

- Expression edits parse → update expression Blockly blocks + Mapping Model `slots[]`.
- Structural edits in text are rejected; use Blockly.
- Block selection ↔ spec region highlight in both directions.

**Later:** CodeMirror decorations mark read-only vs editable regions — see [text-first-mapping-editor.md](future/text-first-mapping-editor.md).

## Environment Abstraction

The app runs in two environments with shared core code. **v1 ships web app only** (GitHub Pages); VS Code extension is a later milestone using the same Host Abstraction interface.

```
┌─────────────────────────────────────────────┐
│              Shared Core (TypeScript)        │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Blockly  │ │CodeMirror│ │ openEHR      │  │
│  │ Blocks & │ │ Sync     │ │ Template     │  │
│  │Generators│ │ Engine   │ │ Parser       │  │
│  └─────────┘ └──────────┘ └──────────────┘  │
├──────────────────────┬──────────────────────┤
│ web app (GH Pages) │ VS Code Extension    │
│ - HTML host page     │ - Webview Panel      │
│ - File System API    │ - VS Code FS API     │
│ - IndexedDB storage  │ - Workspace storage  │
│ - Copy-paste AI      │ - Integrated AI (LM) │
└──────────────────────┴──────────────────────┘
```

| Milestone | Host | Storage | AI |
|-----------|------|---------|-----|
| **v1** | web app (GitHub Pages) | IndexedDB | Copy-paste AI assist (no API) |
| **Later** | VS Code extension | Workspace storage | Integrated AI (Language Model API) |

## Autosave & Status Bar

The footer status bar has three regions:

| Element | ID | Content |
|---------|-----|---------|
| Main status | `#status-main` | `Template · Target · Example · N unmapped mandatory · {transient message}` |
| Save status | `#status-save` | `unsaved changes` (red) or `autosaved at hh:mm` (green) after debounced autosave |
| Build stamp | `#status-build` | `{BUILD_ID} · {BUILD_TIMESTAMP}` |

**Autosave:** After any workspace edit, a **10 s debounced** timer writes the current Project Bundle to IndexedDB under storage key `__autosave__`. Successful autosave clears the dirty flag and updates `#status-save`. Autosave does not replace named manual saves.

### Task progress overlay

Long-running, multi-step loads (Example Sets, GitHub clinical models) show `#task-progress-overlay`: a dimmed card with a spinner and one row per substep in **waiting / running / finished / failed**. The controller exposes `getState().taskProgress`; `render()` paints the overlay and yields between steps so the UI can update. The footer `#status-main` still shows the current step as a short message. The overlay hides when the task settles.

**Manual save (Save as):** User names the project; bundle is stored under `manual:{uuid}`. Only the **last 5** manual saves are retained (older entries pruned). Clears dirty state and shows a transient confirmation in `#status-main`.

## Project Dialogs

### Save as

1. User clicks **Save as** in the header toolbar
2. Modal prompts for **Project name** (prefilled from current template id when available)
3. On confirm, bundle is written as a manual save; modal closes

### Load project

1. User clicks **Load Project**
2. Modal lists loadable entries in order:
   - **Last autosave** (`__autosave__`), if present
   - Up to **5 most recent manual saves** (`manual:{uuid}`), newest first
3. Each row shows kind label, display name, and save time (`hh:mm`)
4. Selecting an entry replaces the current workspace (confirm if content present)

### New project

1. User clicks **New Project**
2. Browser `confirm()` — stronger warning if workspace has content (template, schema, examples, or mappings)
3. On confirm, workspace resets to empty state (new `projectId`, cleared panes)

## Project Persistence (v1)

Projects are self-contained; see [PROJECT_PERSISTENCE.md](PROJECT_PERSISTENCE.md).

IndexedDB uses a `saves` store (autosave + manual snapshots).

| Storage key | Kind | UI label | Retention |
|-------------|------|----------|-----------|
| `__autosave__` | autosave | Last autosave | Single slot (overwritten) |
| `manual:{uuid}` | manual | Saved project | Last 5, pruned on new save |

- **Save as** writes a manual save to the `saves` store.
- **Load Project** reads from `saves` (autosave + recent manual list).
- **Export Project** downloads a `.intehrgrator` file containing the OPT, source/example content, Blockly workspace, settings, and metadata.
- **Import Project** restores the bundle after validating bundle version and mapping shape (marks workspace dirty).
- Browser file paths are not used as durable references in v1.

## Color Scheme (Karolinska-inspired)

Based on [Karolinska Universitetssjukhuset](https://www.karolinska.se/) and Region Stockholm branding:

| Role | Color | Usage |
|------|-------|-------|
| Primary | `#005C53` | Headers, primary buttons, active states |
| Primary Dark | `#003B49` | Sidebar background, toolbar |
| Accent Warm | `#E87722` | Highlights, call-to-action, AI suggestions |
| Surface | `#FFFFFF` | Main pane backgrounds |
| Surface Alt | `#F5F5F0` | Subtle panel backgrounds, tree pane |
| Text Primary | `#1A1A1A` | Body text |
| Text Secondary | `#666666` | Labels, metadata |
| Border | `#D9D9D9` | Panel dividers, tree lines |
| Success | `#2E7D32` | Validation passed |
| Warning | `#F9A825` | Validation warnings |
| Error | `#C62828` | Validation errors |

For a scale going from source to target we sometimes want to use 
https://colorbrewer2.org/?type=diverging&scheme=PRGn&n=9
['#762a83','#9970ab','#c2a5cf','#e7d4e8','#f7f7f7','#d9f0d3','#a6dba0','#5aae61','#1b7837']

## References

- [Blockly](https://developers.google.com/blockly) — Visual block programming
- [CodeMirror 6](https://codemirror.net/) — Text editor component
- [BlockMirror](https://blockpy-edu.github.io/BlockMirror/docs/) — Blockly + CodeMirror integration reference
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) — Hosting web content in VS Code
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) — AI integration in VS Code
