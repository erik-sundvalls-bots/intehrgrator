# Tasks: Roadmap implementation chunks

> **⚠️ ARCHIVED** — Chunk tracking moved to [GitHub Issues](https://github.com/regionstockholm/intehrgrator/issues). Kept for historical reference only.

Based on [ROADMAP.md](./ROADMAP.md) and [PRD-intehrgrator-v1.md](../prd/PRD-intehrgrator-v1.md). Glossary: [CONTEXT.md](../../CONTEXT.md).

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

Example:

- `- [ ] 1.1 Read file` → `- [x] 1.1 Read file` (after completing)

Update the file after completing each sub-task, not just after completing an entire parent task. If implementation steps happen to fulfil several things at once then ticking off several boxes is OK.

If running in interactive mode (e.g. Gemini CLI) then stop after each parent task and let user review. If running in autonomus batch mode e.g. dispatched to Jules, then just stop if user input is crucial in order to understand further steps.

## Grill round 1 (Chunk 1 frontier)

Asked after this plan was written, before coding Chunk 1. Recommended answers **adopted** so implementation can proceed; revisit if a later review disagrees.

❓ **Q1** - **Cogwheel scope**: The new B item replaces the encircled **+** popup with Blockly’s native cogwheel mutator (same family as `controls_if` elseif/else). Does that cover only container **Optional RM Insertion**, also DATA_VALUE **+ fields**, or template-optional skeleton slots too?

➡️ **Adopted: containers + DATA_VALUE shells.** Template-mandatory and silent-mandatory `ATTR_`* / `FLD_*` slots stay locked (not in the mutator stack). Optional RM extras (`OPT_*`) and optional DV fields (`OPTFLD_*`) are add/remove via the cogwheel. Skeleton `ATTR_*` mouths are not removed from the mutator.

---

❓ **Q2** - **Mutator UI**: Mini-workspace of stackable attribute blocks (true `MutatorIcon`, like if/elseif), or a cog that still opens a checkbox popup?

➡️ **Adopted: native** `MutatorIcon` **mini-workspace.** Flyout quark `optional_rm_mutator_item` / `dv_fields_mutator_item` with an attribute dropdown; container quark holds the STACK. HTML `#dialog-optional-rm` goes away.

---

❓ **Q3** - **Removing an optional attribute that already has children**: Disconnect and leave the subtree on the canvas (Blockly default), confirm-then-delete, or refuse until the child is detached?

➡️ **Adopted: disconnect / orphan.** `saveConnections` + `compose` reconnect remaining sockets; a removed extra’s child is left on the canvas, not silently deleted. Mapping Model `optionalRm[]` drops that insertion.

---

❓ **Q4** - **Empty slot vs auto child**: When the mutator *adds* `feeder_audit`, should the workbench only open an empty mouth (pure Blockly) or still auto-attach a typed child as today’s + picker does via `attachOptionalRmChild`?

➡️ **Adopted: auto-attach a typed child when the new mouth is empty** (same as current + picker). If a saved connection is already reconnected, do not create a second child.

---

❓ **Q5** - **Chunk order after this**: Next unfinished clusters are RM completeness (PARTY_IDENTIFIED / ITEM_STRUCTURE morph), mapping-editor undo, Handlebars hardening, and tables. Which next?

➡️ **Adopted: Chunk 2 = remaining B UX that shares Blockly editor surface (undo/redo, toolbox-search, Mapping Spec gutter markers); Chunk 3 = F RM completeness.** Handlebars and tables stay later (higher risk, less blocking).

## Grill round 3 (Chunk 4 frontier)

Asked before coding Chunk 4 (AI copy-paste polish). Recommended answers **adopted**.

❓ **Q1** - **openEHR references in prompt**: Should Copy AI Prompt mention the openehr-assistant MCP, link to docs, or both?

➡️ **Adopted: both.** Add an **openEHR references** section when the target is an openEHR template: hint to use the openehr-assistant MCP for spec/archetype lookup, plus links to `docs/OPENEHR_PRIMER.md`, `docs/AI_SUGGESTION_FORMAT.md`, and DeepWiki/ehrtslib.

---

❓ **Q2** - **Import button label**: Toolbar still says “Import Suggestions”; rename to “Import AI suggestions”?

➡️ **Adopted: already fixed on `main`.** No further work.

---

❓ **Q3** - **CI validation depth**: Should recurring CI call a live LLM, or only fixture/round-trip tests?

➡️ **Adopted: fixture/round-trip only; no live LLM in recurring CI.**

---

❓ **Q4** - **Suggestion envelope breadth**: Expand allowed value `block.type` list and prompt examples (e.g. `maps_get`, loops, party `name` slots)?

➡️ **Adopted: yes.** Add `maps_get` to schema + import codegen; document examples for defaults lookup, repeating containers, and party identity value slots (`name` via `source_query` / `text`).

---

❓ **Q5** - **Partial import**: On schema/apply errors, import valid entries only and report counts?

➡️ **Adopted: yes.** Keep apply-valid-only behaviour; surface applied / loops / skipped / errors / schema counts in the import dialog summary.

## Grill round 1 (Chunk 5 frontier)

Asked before coding Chunk 5 (local app + installable AI skill + agent/MCP driving). User answers **adopted** 2026-08-31.

❓ **Q1** - **Chunk 5 boundary**: Docs/skill only, thin Agent API, or full MCP server in this chunk?

➡️ **Adopted: C (MCP server in Chunk 5).** Include PEN-style MCP on the running desktop app. OK to **split implementation into separate commits/parts** (e.g. core service → HTTP API → MCP tools → docs/skill) for easier review and testing.

---

❓ **Q2** - **Primary agent workflow**: Files on disk, live session, copy-paste only, or combined?

➡️ **Adopted: D.** File-first baseline (`.intehrgrator` / project folder) **plus** live session when desktop is open. Web shell stays copy-paste primary.

---

❓ **Q3** - **API layer**: Extend test API, core service, HTTP wrapper, or phased extraction?

➡️ **Adopted: D (phased).** Extract **`WorkbenchService`** in core operating on **`ProjectBundle` / Blockly JSON / Mapping Model** — **no HTML DOM manipulation**. Desktop exposes localhost HTTP; MCP calls the same service. `intehrgratorTestApi` becomes a thin UI/test client where possible.

---

❓ **Q4** - **Write granularity**: Import-only, single-slot map, loops/optional RM/defaults, full workspace replace?

➡️ **Adopted: C + D.** Agent API must support **`importSuggestions`**, **loops**, **optional RM extras**, and **defaults map** edits. **`loadBlocklyJson` / full workspace replace** remains an escape hatch. Loops are first-class for mapping.

---

❓ **Q5** - **Concurrency & revision**: Defer, revision token only, undo exposure, or both?

➡️ **Adopted: D.** Mutating calls return a **revision token** (optimistic concurrency) **and** expose **undo / redo** on the Agent API.

---

❓ **Q6** - **Installable skill packaging**

➡️ **Adopted: A.** In-repo `.cursor/skills/intehrgrator-mapping/SKILL.md` (and agents mirror) **plus** `docs/AGENT_WORKFLOW.md`.

---

❓ **Q7** - **Golden path documentation**

➡️ **Adopted: B primary** — IDE + **desktop app side-by-side**; agent calls **localhost API** while user watches the canvas update. **Fallback (C-like):** when MCP/API is unavailable, document read-only / downstream export of mapping spec or generated conversion script (not round-trip authoring).

## Grill round 1 (Chunk 5 follow-up — multi-agent MCP presence & attribution)

Asked after Chunk 5 shipped (0.3 desktop: Agent API + MCP + skill). Deferred from 5.3: scroll/highlight, multi-agent visibility, actor-attributed undo. User answers **adopted** 2026-08-31 (Q7 resolved via design investigation).

Context from product direction:

- Scrolling the **main** Mapping Editor canvas to follow an agent likely **disrupts** a human who is editing or reviewing elsewhere on the canvas.
- The existing **Open canvas** button (`openCanvasSnapshot` / `workspace_snapshot.ts`) opens a **separate popup** with a standalone Blockly SVG (print/save today). That window could become a **live observer** for agent activity — PEN-style — without moving the user's viewport.
- Chunk 5 already has **revision tokens + undo/redo** on `WorkbenchService` / Agent API, but undo entries carry **no actor** (user vs named agent). Blockly's native undo stack is separate and also actor-less.
- Roadmap D still has an open item: MCP scroll/highlight (currently unchecked).

❓ **Q1** - **Chunk placement**: Where does multi-agent MCP presence land relative to schema toolboxes (current Chunk 6)?

**A** — New **Chunk 6** (multi-agent MCP UX + attribution); push dynamic schema toolboxes to Chunk 7+.  
**B** — Small **Chunk 5.1** patch release before any Chunk 6 work.  
**C** — Fold into Chunk 6 schema toolboxes (same PR).  
**D** — Split: **6a** actor/undo attribution only; **6b** observer UI / colours later.

➡️ **Adopted: B.** Chunk **5.1** patch release before schema toolboxes (Chunk 6).

---

❓ **Q2** - **Main canvas behaviour on agent edits**: Should MCP/API mutations ever scroll or pan the primary Mapping Editor?

**A** — **Never** auto-scroll/pan the main canvas on agent edits (user keeps full viewport control).  
**B** — Opt-in toolbar setting: “Follow active agent”.  
**C** — Scroll/pan **only** in the observer window (see Q3), never the main canvas.  
**D** — Brief in-canvas flash/highlight on touched blocks **without** changing scroll position.

➡️ **Adopted: B + D.** Opt-in **Follow active agent** (default off). When off, at most subtle pulse/highlight on touched blocks **without** scroll. Observer window handles spatial tracking.

---

❓ **Q3** - **Observer surface**: How should users *watch* multiple simultaneous agents (PEN.dev-like)?

**A** — Extend **Open canvas** popup into a **live multi-agent observer** (layered SVG, per-agent colour, legend with agent names). Static print/save remains available.  
**B** — New dedicated **“Agent activity”** top-level window (separate from Open canvas).  
**C** — Docked **pane inside** the main window (split view below or beside Mapping Editor).  
**D** — No live UI — agents only; user reads MCP logs / IDE chat.

➡️ **Adopted: A.** Live observer via extended Open canvas popup; print/save retained.

---

❓ **Q4** - **Agent identity (name, id, colour)**: How are concurrent agents distinguished?

**A** — **Register on connect** (MCP `initialize` or new `register_agent` tool): `{ agentId, displayName, color? }`.  
**B** — Pass **`agentName` / `agentId` on every mutating API call** (header or JSON field); desktop assigns colour from id hash if omitted.  
**C** — Desktop **UI registry** — user names/colours agents before IDE connects.  
**D** — Anonymous sessions; colour by MCP connection order only.

➡️ **Adopted: B + A combined.** MCP session **registers** at start (`register_agent` or extended `initialize`): `{ agentId, displayName?, color? }` — name persists for the session. Mutations carry identity for attribution. Desktop returns assigned **name + colour** to the agent (agent may **suggest** a name from user prompt). Optional user override in desktop UI later.

---

❓ **Q5** - **Highlight semantics**: What does each agent’s colour mean, and for how long?

**A** — **Transient** outline on blocks/slots touched by last mutation; fade after N seconds.  
**B** — **Persistent** tint on all blocks last edited by that agent until someone else edits them.  
**C** — **Observer window only** — full per-agent layers; main canvas shows only neutral bundle sync (no colours).  
**D** — **Dual**: subtle badge/pulse on main canvas + full colour-coded overlay in observer window.

➡️ **Adopted: D.** Subtle main-canvas signal; full per-agent layers in observer.

---

❓ **Q6** - **Undo/redo attribution**: Who gets credit in history — and where is it stored?

**A** — **`WorkbenchService` / Agent API undo stack only** — each entry `{ actor: user | agent, id, displayName, revision, summary }`; Blockly native undo unchanged for direct user block edits.  
**B** — **Unified history** — merge Blockly events + service snapshots into one timeline with actor on every row.  
**C** — **Separate stacks** — “Undo my edit” (Blockly) vs “Undo last agent change” (API).  
**D** — Extend **Blockly custom events** (`DocumentSwapEvent`, future slot events) with an `actor` field so one stack serves both.

➡️ **Adopted direction:** **Joint undo/redo history** with actor on every entry, plus **UI affordances like C** (“Undo my edit” / “Undo last agent change” / walk full timeline). **Feasible without CRDT in Phase 1** — see design investigation [`DESIGN-multi-agent-undo-crdt.md`](../design/DESIGN-multi-agent-undo-crdt.md). Phase 1: append-only attributed history log + unify UI/service session + debounced Blockly commits into same log. Phase 2+: CRDT on **Mapping Model slots** (Automerge / Yjs / Loro — do not reinvent) when human multi-user live co-editing is required.

---

❓ **Q7** - **Simultaneous writes & conflicts**: Two agents edit different slots at once — what happens?

**A** — **Revision + 409** (current): second writer refreshes snapshot and retries; no slot-level locking.  
**B** — **Slot leases**: optional `POST /api/v1/lease-slot` so an agent holds a slotId while thinking.  
**C** — **Serial queue** per project — one mutation at a time globally.  
**D** — **Merge report** — apply non-conflicting slot updates; return conflicts for human/agent retry (like partial import).

➡️ **Adopted (from design investigation):** **Phase 5.1: A + D** — revision + 409; slot-level **merge report** for batch agent writes (reuse partial-import pattern). **Phase 5.2 optional: + B** slot leases. **Phase 6+ multi-user humans: + CRDT on model.** Avoid global serial queue (C). Details: [`docs/design/DESIGN-multi-agent-undo-crdt.md`](../design/DESIGN-multi-agent-undo-crdt.md#q7-recommendation-after-analysis).

---

## Grill round 2 (Chunk 5.1 — undo/history semantics)

Asked after [`DESIGN-multi-agent-undo-crdt.md`](./DESIGN-multi-agent-undo-crdt.md). User answers **adopted** 2026-08-31.

❓ **Q1** - **Session unification / history commits:** Immediate revision bump per canvas edit, or batched commits?

➡️ **Adopted: semantics-based, not time-based.** Record history when **mapping semantics** change: block **attached / detached / added / removed**, slot **expression** change, **loop** / **optionalRm** / **import** mutations. **Ignore** pure x/y layout moves until something structural changes. Coalesce multiple semantic events in one “transaction burst” if they share one user gesture (e.g. mutator compose). Agents bump revision on each API mutation (already atomic).

---

❓ **Q2** - **Selective undo semantics:** Snapshot replace vs compensating merge?

➡️ **Adopted: both, user-chosen + timeline.** Provide:
1. **Timeline scrubber** — run forward/backward for **viewing** (read-only playback at each `seq`).
2. **Destructive rollback** — jump to history point `seq` after **warning/confirmation** (replaces document state; truncates or forks redo — TBD in implementation).
3. **Compensating patch (best-effort)** — attempt to remove effects of a **single** history entry while keeping later work; may fail on conflicts. Offer **AI-assisted patch**: generate a small prompt + metadata for an external agent with MCP access to history/undo; result appended as **new timeline entry** (undoable if it messes up).

Shortcut menu items (“Undo my last edit”, “Undo last agent change”) remain filters on the same timeline.

---

❓ **Q3** - **Blockly history granularity:**

➡️ **Adopted: same as Q1** — semantic attach/detach/add/remove and mapping-field changes only; not x/y.

---

❓ **Q4** - **History retention:**

➡️ **Adopted: no arbitrary cap** unless memory risk. **Web:** warn user before purging oldest entries if approaching memory limit. **Desktop/local:** persist history **on disk** (append log / sidecar with project); load recent window into memory as needed.

---

❓ **Q5** - **Human multi-user roadmap:**

➡️ **Adopted: yes, near end of roadmap.** Chunk 5.1 = **architecture-only prep** in [`ARCHITECTURE-multi-user-collab-prep.md`](../design/ARCHITECTURE-multi-user-collab-prep.md). Full CRDT/sync deferred to **Chunk 14**.

---

## Grill round 3 (Chunk 5.1 — timeline UX & patch undo)

Asked after grill round 2 history semantics. User answers **adopted** 2026-08-31.

❓ **Q1** - **Destructive rollback:** Offer save/download of discarded branch?

➡️ **Adopted: yes.** Before destructive `restore-at`, offer download of the discarded branch as a full **`.intehrgrator`** project file (`POST /export-discarded`).

---

❓ **Q2** - **Patch undo format:** Free text vs strict suggestions envelope?

➡️ **Adopted: strict `intehrgrator-suggestions` version 2** via `build_patch_prompt` / `POST /patch-prompt` — apply with `import_suggestions`, not prose patches.

---

❓ **Q3** - **Undo/redo discoverability:** Hint observer window on main canvas undo?

➡️ **Adopted: yes.** Main Undo/Redo tooltips point users to **Open observer** for full attributed timeline (main canvas Blockly undo remains for direct edits).

---

❓ **Q4** - **History granularity:** One entry per semantic change?

➡️ **Adopted: yes** — same semantics as grill round 2 Q1/Q3 (attach/detach/expression/import; ignore pure x/y).

---

### Relevant files (Chunk 5.1 — adopted scope)

- `src/workbench/service.ts` — undo stack + actor metadata on mutations
- `src/agent/http.ts` / `src/agent/mcp_stdio.ts` — `agentId` / `agentName` on tools; `GET /history`
- `src/web/agent_bridge.ts` — push agent highlight events to UI without scrolling main workspace
- `src/blockly/workspace_snapshot.ts` — live observer window (multi-agent SVG layers)
- `web/main.ts` — Open canvas → observer mode; undo menu shows actor
- `docs/design/DESIGN-multi-agent-undo-crdt.md` — undo/history feasibility, library evaluation
- `docs/design/ARCHITECTURE-multi-user-collab-prep.md` — Chunk 14 prep (5.1 lays seams only)
- `docs/AGENT_WORKFLOW.md` — multi-agent setup, colours, observer window
- `CONTEXT.md` — Agent actor, observer canvas, attributed undo

## Relevant Files (Chunk 5)

- `src/workbench/controller.ts` — extract `WorkbenchService` seam
- `src/core/persistence/mod.ts` — `ProjectBundle` load/save
- `src/core/ai/mod.ts` — `buildPrompt`, `importSuggestions`
- `src/ui_test/test_api.ts` — thin client over service (not DOM-first agent API)
- `src/desktop/` — localhost Agent API + MCP server (opt-in)
- `docs/AGENT_WORKFLOW.md` — golden path (B) + fallback (C)
- `.cursor/skills/intehrgrator-mapping/SKILL.md` — installable agent SOP
- `CONTEXT.md` — Workbench Agent API, session revision (when implemented)

## Relevant Files (Chunks 1–4)

- `src/blockly/blocks/rm_blocks.ts` — `optional_rm_mutator` / `dv_fields_mutator`, + image fields, compose/decompose
- `web/main.ts` — Optional RM HTML picker + context menu
- `web/index.html` — `#dialog-optional-rm`
- `src/blockly/skeleton_loader.ts` — `attachOptionalRmChild`
- `src/workbench/controller.ts` — `addOptionalRm` / optional attachment catalog
- `src/core/rm_meta.ts` — `getValidAttachments`
- `test/blockly_rm_blocks_test.ts`
- `CONTEXT.md`, `docs/BLOCKLY_INTEGRATION.md`, `docs/ROADMAP.md`



## Priority-ordered chunks

**Status as of 2026-09-10:** Chunks **1–8** and **5.1** are done (merged). Next unfinished chunk work is **7.1** (Handlebars Mapping preview hardening), then **9–14**. VMS toolbox cut and Mapping Model IR extension (**#35**, **#37**) merged in PR #58; Chunk 9 core is **#38+** (preview/codegen equivalence, XQuery loops, VMS linter, PBT). Suggested issue groupings: [`SUGGESTED-ISSUES-roadmap-remaining.md`](./SUGGESTED-ISSUES-roadmap-remaining.md).


| Prio | Chunk                                   | Status | Roadmap items                                                                                                                                            | Why this grouping                                                                          |
| ---- | --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | Native cogwheel for optional attributes | **done** | B: replace + popup with cogwheel; non-mandatory can be removed                                                                                           | First unfinished item; Blockly-native mutator; unblocks honest optional RM/DV editing      |
| 2    | Mapping Editor chrome                   | **done** | B: undo/redo; toolbox-search plugin; Mapping Spec gutter error markers                                                                                   | Shared editor surface; independent of RM class work                                        |
| 3    | RM Blockly completeness                 | **done** | F: missing classes; toolbox sort/groups/colour; PARTY_IDENTIFIED `name`/`identifiers`; ITEM_STRUCTURE morph like EVENT                                   | Uses cogwheel once it exists; `openehr://spec/type/RM/PARTY_IDENTIFIED` + `ITEM_STRUCTURE` |
| 4    | AI copy-paste polish                    | **done** | I: validate assist; openehr-assistant prompt hint; clarify Import AI suggestions label                                                                   | Small, isolated toolbar/prompt work                                                        |
| 5    | Local/offline AI skill + MCP            | **done** | D: parallel IDE + local app; installable AI skill; Agent API + MCP                                                                                       | Docs + skill + desktop API                                                                 |
| 5.1  | Multi-agent MCP presence                | **done** | D: observer, follow-agent, attributed history                                                                                                            | Patch before schema toolboxes                                                              |
| 6    | Dynamic schema toolboxes                | **done** | H: JSON/XSD target drawers from schema (TakeCare term ids deferred)                                                                                      | Productized schema-specific Blockly                                                        |
| 7    | Template languages (Go + Handlebars CTR)| **done** | G: Go codegen/WASM + Authored Handlebars in Conversion Test Run; Blockly↔Handlebars codegen deferred                                                     | 7.0 merged (PR #22)                                                                        |
| 7.1  | Handlebars Mapping preview hardening    | **open** | G: fixture-first preview parity with Conversion Test Run (7.6 carry-over)                                                                                | Patch before / alongside later Handlebars work                                             |
| 8    | Spreadsheet / matrix                    | **done** | C: sheet widget + persist + Blockly accessors/mutators; CSV/Excel paste. FHIR/DMN/decision tables deferred                                               | Maps stay 1D; sheet is the 2D structure                                                    |
| 9    | Conversion scripts                      | **open** | J golden TS/Java/XQuery/Handlebars; K full COMPOSITION XML emit + Saxon/BaseX CI — **#38–#41** (VMS **#35/#37** done in PR #58)                        | After mapping/RM is trustworthy; golden oracles and equivalence are the live track         |
| 10   | Persistence, i18n, versioning           | **open** | B: GitHub save if logged in; full UI i18n; L: source/target version hashes                                                                               | Platform, not mapping semantics                                                            |
| 11   | Better Form parity                      | **open** | G: ScriptApi / formTestApi / Cypress port                                                                                                                | Licensed optional path                                                                     |
| 12   | Later hosts                             | **open** | v1 follow-ups: Java Export UI; VS Code host; Autoplay E2E                                                                                                | Explicitly post-v1                                                                         |
| 13   | Cross-pane a11y                         | **open** | B: colourblind in→conv→out; sync highlight mapping ↔ Conversion Test Run                                                                                 | Visual language; after editor mechanics settle                                             |
| 14   | Human multi-user collaboration          | **open** | D follow-up + DESIGN/ARCHITECTURE docs: CRDT/sync, shared rooms, live co-editing                                                                         | Late; 5.1 lays history/actor/timeline seams only — see ARCHITECTURE-multi-user-collab-prep |


Already done (do not re-open unless regression): A small fixes (including `.xml` pickers), maps de-uglify, sheets + Lists & maps, target visualisation pane removal, CLUSTER/SECTION colour/cleanup, Handlebars language + template tab, Go template codegen/WASM, schema-driven JSON/XSD toolboxes, XQuery Model B emit, MCP/observer/attributed history, Constraint Overlay Phase 1 (#46).

## Tasks

- [x] 0.0 Create feature branch
  - [x] 0.1 `git checkout -b cursor/xml-file-pickers-7430` from latest `origin/main` (branch name kept; Chunk 1 is now the cogwheel item because XML pickers landed on `main`)
- [x] 1.0 Chunk 1 — Native Blockly cogwheel for optional RM / DV attributes
  - [x] 1.1 Register `optional_rm_mutator` with `decompose` / `compose` / `saveConnections` and quark types so Blockly adds a `MutatorIcon` cogwheel
  - [x] 1.2 Remove encircled + on containers and the HTML Optional RM dialog; context menu opens the mutator bubble
  - [x] 1.3 Same cogwheel pattern for DATA_VALUE `dv_fields_mutator`; remove + fields image
  - [x] 1.4 Auto-attach typed child for newly added empty structural mouths; orphan on remove; sync `optionalRm[]`
  - [x] 1.5 Tests: add/remove extra via compose without dropping remaining children; DV optional field; no PLUS input
  - [x] 1.6 Update CONTEXT.md, BLOCKLY_INTEGRATION.md, ROADMAP.md
- [x] 2.0 Chunk 2 — Mapping Editor chrome (undo/redo, toolbox-search, spec gutter markers)
  - [x] 2.1 Fix GitHub CI/Pages Test Run locatable identity (string `archetype_node_id`)
  - [x] 2.2 Canvas is source of truth: spec widget edits, Click-to-Map, and cogwheel extras stay in Blockly undo
  - [x] 2.3 Undo/Redo buttons; group user-perceived actions; Open template / Example Sets / Load Project are undoable; saves/exports are not
  - [x] 2.4 `@blockly/toolbox-search` indexes all `kind: "block"` toolbox drawers including Source, openEHR types, and Maps
  - [x] 2.5 Mapping Spec right-hand overview ticks from the same constraint warnings as Blockly triangles; click selects/pans
  - [x] 2.6 Docs: ROADMAP, CONTEXT, MAPPING_SPECIFICATION
- [x] 3.0 Chunk 3 — RM Blockly completeness (PARTY identity, ITEM_STRUCTURE morph, toolbox)
  - [x] 3.1 `PARTY_IDENTIFIED` / `PARTY_RELATED`: `name`, `identifiers`, `external_ref` slots
  - [x] 3.2 `party_ref` block + `dv_identifier` in Party toolbox drawer
  - [x] 3.3 Abstract `item_structure` morph + abstract warning
  - [x] 3.4 Nested openEHR toolbox drawers; missing RM blocks in flyout
  - [x] 3.5 TypeScript codegen for `PARTY_REF`, list-valued `identifiers`
  - [x] 3.6 Tests + README note (full Demographics compositions still future)
- [x] 4.0 Chunk 4 — AI copy-paste polish (roadmap I)
  - [x] 4.1 `buildPrompt`: openEHR references section (openehr-assistant MCP hint + doc links) when target is openEHR
  - [x] 4.2 Expand suggestion envelope: `maps_get` in schema, docs, import codegen; prompt examples for loops / defaults / party `name`
  - [x] 4.3 Import dialog: apply-valid-only with clear applied / skipped / schema counts (Q5)
  - [x] 4.4 Fixture + round-trip tests only (no live LLM in CI)
  - [x] 4.5 ROADMAP I items ticked; Q2 label already on `main`
- [x] 5.0 Chunk 5 — Local app + installable AI skill + MCP (roadmap D)
  - [x] 5.1 Extract `WorkbenchService` (bundle I/O, prompt, import, loops, test, slot map) on Blockly JSON / model — no DOM
  - [x] 5.2 Desktop localhost Agent API (opt-in): revision + undo/redo; UI subscribes to service
  - [x] 5.3 MCP stdio server over same service (scroll/highlight on edit deferred to follow-up)
  - [x] 5.4 `docs/AGENT_WORKFLOW.md` — golden path B (IDE + desktop API); fallback C when MCP unavailable
  - [x] 5.5 `.cursor/skills/intehrgrator-mapping/SKILL.md` + agents mirror
  - [x] 5.6 Tests: service round-trips without browser; MCP/HTTP integration tests (separate commits per part OK)
- [x] 5.1 Chunk 5.1 — Multi-agent MCP presence (patch release before Chunk 6)
  - [x] 5.1.1 Agent registration at MCP session start (`register_agent`); return name/colour; optional name suggestion
  - [x] 5.1.2 Live Open canvas observer window (per-agent layers, legend); dual highlight on main canvas (Q5 D)
  - [x] 5.1.3 Opt-in “Follow active agent” on main canvas (default off); pulse-without-scroll when off (Q2 B+D)
  - [x] 5.1.4 Joint attributed **semantic** history log + **timeline UI** (scrub, destructive rollback, best-effort/AI patch undo) — see DESIGN + ARCHITECTURE prep
  - [x] 5.1.5 Conflict: revision + 409 + slot-level merge report (Q7 A+D); optional leases in 5.2
  - [x] 5.1.6 History persistence: disk on desktop (`INTEHR_HISTORY_PATH`); web memory warn deferred
  - [x] 5.1.7 Docs: AGENT_WORKFLOW multi-agent, CONTEXT glossary, skill update
  - [x] 5.1.8 Tests: registration, semantic history, timeline playback (no live LLM)
- [x] 6.0 Chunk 6 — Schema-driven dynamic toolboxes (roadmap H)

## Grill round 1 (Chunk 6 frontier — dynamic schema toolboxes)

Asked after **0.4** desktop release (Chunk 5.1 shipped: multi-agent observer, attributed history). User answers **adopted** 2026-08-31.

Context from current code:

- JSON Schema / XML Schema targets already load via **Target Format Handler** → `SkeletonNode[]` → generic `target_structure` / `target_value` canvas blocks.
- `buildDemoToolbox` adds a **Target schema** flyout (prefilled generic blocks, **max 40**, flat list) when a JSON/XSD target is loaded — not per-type Blockly definitions.
- openEHR targets use typed RM blocks + cogwheel optional-field mutators; JSON/XSD has **no equivalent mutator** for optional properties.
- **Generic JSON** and **Generic XML** drawers already exist (`json_object` / `json_array` / `json_value`, `xml_element` / `xml_text`) and must **stay always visible** for ad-hoc structure authoring.
- PRD Q7 (JSON/XSD) answered **B**: generic output blocks **and** dynamically generated blocks from the selected schema — only the generic half exists today.

❓ **Q1** - **Block vocabulary + toolbox layering:** Generic JSON/XML vs schema-specific drawers?

➡️ **Adopted (user composite — supersedes A/B/C):**

1. **Always visible:** generic **JSON-structure** and **XML-structure** toolboxes so users can build **any** JSON or XML structure/instance (free-form, not tied to loaded target).
2. **On target load:** automatically plug in **schema-specific toolbox drawer(s)** for the loaded JSON Schema / XML Schema target.
3. **Schema-specific drawer behaviour ≈ openEHR:** mandatory attributes/fields visible; optional ones add/remove via **cogwheel mutator**; **canvas scaffold** instantiated from **mandatory** fields only.
4. **Defaults Map:** an **empty** Defaults Map block may be placed on canvas for JSON/XSD targets, but **must not** participate in scaffolding (schema unknown until runtime load — no pre-wired default points like openEHR OPT).

---

❓ **Q2** - **Optional property UX (JSON/XSD):** How should users add/remove non-mandatory schema fields?

➡️ **Adopted: A (generalize cogwheel mutator)** — same family as RM `optional_rm_mutator` / `dv_fields_mutator`, driven by skeleton optional-field catalog for schema structure blocks. See Q1.

---

❓ **Q3** - **Target schema drawer shape:** How to organize the dynamic drawer for large schemas?

➡️ **Adopted: B — nested categories** mirroring the schema tree (complexTypes / `$defs` / XSD sections), similar to how openEHR nests Entries / Items / Party / DV drawers — not a flat 40-block cap.

---

❓ **Q4** - **TakeCare integration mode**

➡️ **Deferred** — TakeCare-specific fixture/validation to **later roadmap** (not Chunk 6). Chunk 6 proves **arbitrary** JSON/XSD schema load; TakeCare becomes a manual or late golden when schema toolbox is stable.

---

❓ **Q5** - **TakeCare term identifiers (test vs prod)**

➡️ **Deferred** with Q4 — term-id blocks / test-prod system switch **not in Chunk 6**.

---

❓ **Q6** - **Canvas vs toolbox parity** *(reframed — original wording was unclear)*

**What this meant:** When you load a JSON/XSD target, should the **canvas auto-scaffold** (mandatory tree on load) use the **same block “shapes”** as the schema-specific toolbox drawer — or stay generic while only the toolbox is schema-aware?

**openEHR reference today:** loading an OPT scaffolds typed RM blocks on canvas **and** the toolbox offers matching typed blocks + cogwheel optional fields.

➡️ **Adopted (from Q1 — openEHR parity):** **Both** canvas scaffold and schema-specific toolbox use **schema-aware structure blocks** (named after schema types / elements). Mandatory nodes appear on canvas at load; optional via cogwheel. **Generic JSON/XML drawers remain separate** and always available for ad-hoc editing outside the schema scaffold — they do not replace the schema-specific vocabulary.

---

❓ **Q7** - **Toolbox refresh + Agent API** *(reframed — original wording was unclear)*

**What this meant:** When the user (or agent) loads a new target schema, how should **IDE agents** learn the new **slotIds** and toolbox structure?

| Option | Meaning |
| --- | --- |
| **A** | Refresh toolbox on target load; **`build_prompt` / Copy AI Prompt manifest** lists slotIds (current Agent API path). |
| **B** | New dedicated **`GET /api/v1/schema-toolbox`** returning drawer tree + slotIds for MCP agents. |
| **C** | Agents read **`/bundle` only**; no toolbox metadata API. |

➡️ **Adopted: A.** Refresh toolbox when target loads; slotIds stay in **`build_prompt` manifest** and bundle skeleton (existing golden path). No new schema-toolbox HTTP endpoint in Chunk 6 unless a follow-up need appears.

---

### Chunk 6 implementation notes (from adoption)

- **Audit generic JSON/XML blocks** (`json_object`, `json_array`, `json_value`, `xml_element`, `xml_text`) for formalism gaps (attributes, namespaces, mixed content, JSON null/boolean, etc.) and usability; extend drawers before or alongside schema-specific work.
- Replace flat `schemaFlyoutContents` (40-cap) with **nested category builder** from `SkeletonNode[]`.
- Generalize **cogwheel mutator** to schema structure blocks; wire optional catalog from target format handler.
- **`skeleton_loader`**: scaffold mandatory schema tree on canvas (openEHR-like policy).
- **`syncToolbox`**: invalidate on target load + skeleton structure hash (not just length).
- TakeCare / vendor-specific term ids → late roadmap (after spreadsheet/matrix Chunk 8 or a dedicated vendor chunk; FHIR ConceptMap import is deferred).

### Relevant files (Chunk 6 — adopted scope)

- `src/blockly/toolbox_demo.ts` — always-visible JSON/XML + dynamic nested schema drawer
- `src/blockly/blocks/target_blocks.ts` — generic + schema structure blocks; cogwheel mutator seam
- `src/core/target/format_handler.ts` — JSON/XSD skeleton, optional/mandatory metadata, `$ref` fidelity
- `src/blockly/skeleton_loader.ts` — mandatory-only canvas scaffold
- `web/main.ts` — `syncToolbox` invalidation
- `docs/ROADMAP.md` §H — TakeCare deferred note
- `test/target_format_handler_test.ts`, new schema-toolbox golden tests

- [x] 6.1 Audit & extend generic JSON/XML Blockly drawers (always visible)
- [x] 6.2 Schema-specific nested toolbox drawer(s) on target load
- [x] 6.3 Cogwheel optional-field mutator for schema structure blocks
- [x] 6.4 Mandatory-only canvas scaffold (openEHR-like) + empty Defaults Map (non-scaffolding)
- [x] 6.5 Toolbox sync hash + Agent prompt manifest slotIds (Q7 A)
- [x] 6.6 Tests: nested drawer, mutator, scaffold round-trip (generic JSON Schema + XSD fixtures; no TakeCare)
- [x] 6.7 Docs: ROADMAP H, BLOCKLY_INTEGRATION, CONTEXT

- [x] 7.0 Chunk 7 — Template languages: Kintegrate Handlebars + Go text/template codegen (roadmap G)

## Grill round 1 (Chunk 7 frontier — template languages)

Asked before coding Chunk 7. User answers **adopted** 2026-09-03.

Context from the mapping scripts in `examples/patient-reported-chemotherapy-symptoms/mapping/`:

- Go `text/template` scripts converting openEHR FLAT → TakeCare ProfdocHISMessage XML (legacy EHR narrative).
- Execute context: `{ Parameters: {Time, PatientId, …}, Data: {"flat/path|value": "Nej", …} }`.
- Templates use `{{ index .Data "long/path" }}`, `{{ eq … }}`, `{{ if and … }}`, `{{ define "cleanAndQuoteFreeTextInput" }}…{{ end }}`, and Sprig helpers: `replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `substr`, `int`, `ge`.
- Target is XML (free-form), not openEHR.
- No `range`/`with` iteration — single-event questionnaire at fixed `:0` positions.

❓ **Q1** - **Chunk 7 boundary**: One chunk or split?

➡️ **Adopted: one chunk.** Split PRs/commits inside.

---

❓ **Q2** - **Go template surfaces**: Tab + codegen, snippet block only, or both?

➡️ **Adopted: codegen-only.** Go template has **no Authored Template tab** — it is purely a Conversion script language with Blockly codegen (like TypeScript). Handlebars keeps its Template tab (Kintegrate compatibility).

---

❓ **Q3** - **Execute envelope**: Where does `Parameters` come from in Test Run?

➡️ **Adopted: Defaults Map → Parameters.** Execute builds `{ Parameters: defaults, Data: flatInstance }`. The Go service pipeline injects Parameters externally.

---

❓ **Q4** - **FuncMap / Sprig subset**: Full Sprig or curated?

➡️ **Adopted: curated 8 + seam.** `replace`, `regexReplaceAll`, `trim`, `quote`, `lower`, `substr`, `int`, `ge`. FuncMap as adapter for future full Sprig.

---

❓ **Q5** - **Bundle persistence**: New field or reuse existing?

➡️ **Adopted: no new field.** Add `go-template` to `ConversionScriptLanguage`. Blockly mapping is already persisted as `blocklyState`. Generated Go template is derived (not stored).

---

❓ **Q6** - **Handlebars Authored Template: execute in Conversion Test Run?**

➡️ **Adopted: yes.** Execute Authored Handlebars Template in Conversion Test Run when Handlebars is the selected Output mode. Extends ADR 0003.

---

❓ **Q7** - **Handlebars Blockly→codegen (parallel to Go template codegen)?**

➡️ **Adopted: defer.** Harden Handlebars Authored Template path in this chunk. Blockly→Handlebars codegen is a future chunk.

---

❓ **Q8** - **Example Set**: The reverse-engineered Blockly mapping uses XML blocks for the ProfdocHISMessage structure. The hand-authored PROD Go template lives alongside as reference.

➡️ **Adopted: register in `example-sets.json`.** A future roadmap item adds a similar reverse-engineered Handlebars example set plus non-Blockly editing support so the Handlebars test harness works with example files and expected output.

---

❓ **Q9** - **In-app Go runtime**: WASM for Web Shell + desktop.

➡️ **Adopted: WASM.** Vendor prebuilt `.wasm` + `wasm_exec.js` with curated FuncMap. TinyGo if size is an issue.

---

❓ **Q10** - **Go template codegen**: `generate(model, "go-template")` walks Mapping Model + Blockly state, emits Go template syntax.

➡️ **Adopted.** Source queries → `{{ index .Data "path" }}`; conditionals → `{{ if eq … }}`; XML blocks → literal XML; Defaults Map → `{{ .Parameters.Key }}`.

---

❓ **Q11** - **Click-to-Map for Go template**: Output-mode-agnostic. Inserts Blockly blocks; codegen handles the rest.

➡️ **Adopted.**

---

❓ **Q12** - **`source_query_node` Listening Mode**: Treat like other source query blocks.

➡️ **Adopted.**

---

❓ **Q13** - **Harden Handlebars preview**: Fixture-first, independent of Go.

➡️ **Adopted.**

---

### Chunk 7 implementation notes (from adoption)

- **Go template is codegen-only** — no Authored Template tab. Handlebars keeps its tab.
- **Execute envelope** `{ Parameters: defaults, Data: source }` for Go Test Run.
- **WASM runtime** with curated Sprig-subset FuncMap baked in.
- **Reverse-engineered Blockly example** uses `xml_element`/`xml_text` blocks for ProfdocHISMessage structure, `controls_if` for conditional symptom emission, `source_query` for FLAT paths, `maps_get` for Parameters.
- **Future:** reverse-engineered Handlebars example set + non-Blockly editing for Handlebars test harness (added to roadmap).

### Relevant files (Chunk 7 — adopted scope)

- `src/types/mod.ts` — `ConversionScriptLanguage` type: add `go-template`
- `src/core/codegen/mod.ts` — codegen adapter registry: add Go template adapter
- `src/core/codegen/go_template.ts` — new: Go template codegen from Mapping Model + Blockly
- `src/core/test_runner/mod.ts` — execute Go template + Handlebars in Conversion Test Run
- `src/core/output/go_template_runtime.ts` — new: WASM runtime + FuncMap
- `web/main.ts` — Output mode UI: add Go template option
- `examples/patient-reported-chemotherapy-symptoms/` — Example Set + Blockly mapping
- `examples/example-sets.json` — register chemo example
- `test/go_template_codegen_test.ts` — new: codegen golden tests
- `docs/ROADMAP.md` §G — Go template + future Handlebars example note
- `docs/adr/0004-go-template-codegen-only.md` — new ADR
- `docs/adr/0003-mapping-preview-vs-generated-script.md` — amend for Handlebars Test Run

  - [x] 7.1 Add `go-template` to `ConversionScriptLanguage` + Output mode UI
  - [x] 7.2 Go template codegen adapter (Mapping Model + Blockly → Go template syntax)
  - [x] 7.3 Go WASM runtime + curated Sprig-subset FuncMap; vendor artifact (`web/wasm/`, `deno task wasm:go-template`)
  - [x] 7.4 Execute Go template in Conversion Test Run (generated script via WASM)
  - [x] 7.5 Execute Handlebars Authored Template in Conversion Test Run; extend ADR 0003
  - [ ] 7.6 Harden Handlebars Mapping preview (Kintegrate fixtures, nested #with/#each, FLAT keys, slot/json)
  - [x] 7.7 Execute envelope: `{ Parameters: defaults, Data: source }` for Go Test Run
  - [x] 7.8 Reverse-engineer PROD Go template → Blockly mapping (`mapping/mapping.blockly.json`) using XML blocks
  - [x] 7.9 Example Set `examples/patient-reported-chemotherapy-symptoms/` registered (schema/target now optional)
  - [x] 7.10 `source_query_node` Listening Mode + UI test
  - [x] 7.11 Path-inventory tokenizer fix (`{{~#with` / `{{~#each`); regenerated goldens
  - [x] 7.12 Docs: ROADMAP G, ADR 0004 (Go template codegen-only)

- [ ] 7.1 Chunk 7.1 — Handlebars Mapping preview hardening (7.6 carry-over, patch before Chunk 8)

Chunk 7 merged in PR #22 with **7.6** left open. Grill Q13 already adopted fixture-first hardening independent of Go. No new grill round — implement directly.

### Chunk 7.1 implementation notes (from Q13 + post-merge audit)

- Kintegrate fixtures (`intro`, `mdk_rek_demo`, `air-oxygenation`, `handlebars-script1`) already pass via direct `renderHandlebars`; **Mapping preview** path (`runTest` with `outputMode: "preview"` + free-form target) lacks parity tests.
- `handlebars()` builtin in `query_runtime.ts` does not pass `_slots` — breaks `{{slot}}` inside `text_handlebars` slot expressions.
- ADR 0003 / `CONTEXT.md` still say Handlebars Conversion mode does not execute (stale after 7.5).

### Relevant files (Chunk 7.1)

- `test/kintegrate_migration_test.ts` — route golden assertions through `runTest` preview path; add preview ↔ `handlebars` mode parity
- `src/core/test_runner/mod.ts` — reference implementation (both modes call `renderHandlebars`)
- `src/core/source/query_runtime.ts` — thread slots into `handlebars()` builtin
- `docs/adr/0003-mapping-preview-vs-generated-script.md`, `CONTEXT.md`, `docs/ROADMAP.md` §G

  - [ ] 7.1.1 Refactor Kintegrate tests: assert via `runTest` Mapping preview (not only direct `renderHandlebars`)
  - [ ] 7.1.2 Parity test: same fixture under `outputMode: "preview"` and `outputMode: "handlebars"`
  - [ ] 7.1.3 Slot/json interop in Mapping preview (`{{slot}}`, `{{{json (slot …)}}}`) via `runTest`
  - [ ] 7.1.4 `runTest` coverage for full `handlebars-script1.hbs` (intro + MDK halves)
  - [ ] 7.1.5 Optional: golden `.expected.txt` for MDK + emergency-ward (whitespace / `~` trim)
  - [ ] 7.1.6 Fix `handlebars()` builtin to pass slot bag from context
  - [ ] 7.1.7 Docs: amend ADR 0003; tick ROADMAP Handlebars Test Run item; narrow 7.6 wording

  - [x] 8.0 Chunk 8 — Spreadsheet / matrix widget, then Blockly accessors (roadmap C)

## Grill round 1 (Chunk 8 frontier — spreadsheet/matrix)

Asked after the user rejected a “paste into 1D maps” MVP. **Adopted 2026-09-04.** Library comparison: [`spreadsheet-matrix-libraries.md`](../future/spreadsheet-matrix-libraries.md). Maps second-step options: [`DESIGN-sheets-vs-maps.md`](../design/DESIGN-sheets-vs-maps.md).

**Settled (user 2026-09-04):** proper spreadsheet/matrix support **first**; initial Blockly accessor/mutator set is derived from the **selected library’s API**; **FHIR is deferred**.

Context: 1D **Map** blocks exist. ROADMAP still wants named columns, optional row names, typed columns, Excel/Sheets paste, and later code+label lookup into `DV_CODED_TEXT`. That is a **Sheet**, not `maps_create_with`.

---

❓ **Q1** - **Which spreadsheet library?**

**A** — **jspreadsheet-ce** (MIT, vanilla, 2 deps: `jsuites` + `@jspreadsheet/formula`). Docs: https://github.com/jspreadsheet/ce · https://bossanova.uk/jspreadsheet/v4/docs/quick-reference · npm https://www.npmjs.com/package/jspreadsheet-ce
**B** — **x-data-spreadsheet** (MIT, ~zero deps, canvas). https://github.com/myliang/x-spreadsheet — stale; successor `@wolf-table/table` is 0.0.3.
**C** — **Univer** sheets preset (Apache-2.0, Excel-complete). https://github.com/dream-num/univer · https://univer.ai/ — React + large plugin graph.
**D** — **fortune-sheet** (MIT Luckysheet fork). https://github.com/ruilisi/fortune-sheet — React + lodash/immer.
**E** — **canvas-datagrid** (BSD-3). https://github.com/TonyGermaneri/canvas-datagrid — data grid, not A1 sheet.
**F** — No embed: own HTML `<table>` + **PapaParse** only. https://www.papaparse.com/

➡️ **Adopted: A**, and **use jspreadsheet-ce’s own features as much as possible**: file import/export, optional fullscreen, `setDictionary` i18n for the app’s UI languages (`en` / `sv` / `de` / `es` / `ca` / `fr`), native Excel/Sheets cut-and-paste, and **host undo/redo** (Blockly Mapping Editors stack via a custom event — do not leave the grid on a private undo island). Reject C/D (React), Luckysheet (archived), Handsontable/HyperFormula (proprietary / GPLv3).

---

❓ **Q2** - **Source of truth**: library instance vs project-owned sheet JSON?

**A** — Persist a thin **Sheet** document (name, column titles, optional row names, 2D values, optional column types). Widget binds to it; Test Run/codegen read the JSON.
**B** — Persist the library’s native workbook JSON (jspreadsheet `getData`/`getConfig`, Univer snapshot, …).
**C** — DOM-only until Blockly blocks exist; no persistence in v1.

➡️ **Adopted: A.** Widget is a view. Blockly and Conversion scripts must not require the grid in the DOM.

---

❓ **Q3** - **Where does the sheet UI live?**

**A** — New **Sheets** section in Mapping Editors (split under Blockly, sibling to Mapping Spec / Handlebars Template).
**B** — Modal / drawer opened from a named `sheet` Blockly block (like Defaults Map folder).
**C** — Replace part of the Source Pane.

➡️ **Adopted: A**, with **limited space**: scrollbars on the grid and the existing Mapping Editors **adjustable split** (Blockly vs bottom). Switch to **modal / fullscreen** (library fullscreen + overlay) when the docked slice is too small. Named `sheet` block still *focuses* that tab (B as navigation, not the only editor).

---

❓ **Q4** - **Chunk 8 sequence inside the chunk**

**A** — Widget + persist + paste **then** Blockly accessors/mutators in the **same** chunk (two PRs OK).
**B** — Chunk 8 = widget only; Chunk 8.1 = Blockly blocks.
**C** — Blockly blocks first against a fake 2D array; widget later.

➡️ **Adopted: A.** Same chunk, ordered: embed → model → paste → blocks.

---

❓ **Q5** - **Initial Blockly set** (names follow jspreadsheet CE if Q1=A)

Include in Chunk 8:

- Named declaration: `sheet` (NAME, like Defaults Map)
- Accessors: `sheet_get_cell` (A1), `sheet_get_xy`, `sheet_get_row`, `sheet_get_column`, `sheet_get_header`, `sheet_get_data`
- Mutators: `sheet_set_cell` / `sheet_set_xy`, `sheet_set_row` / `sheet_set_column`, `sheet_set_header`, `sheet_insert_row` / `sheet_delete_row`, `sheet_insert_column` / `sheet_delete_column`
- Content lookup: `sheet_lookup` (find first row where header/column equals value → row or cell)

**A** — That set.
**B** — Accessors only in Chunk 8; mutators later.
**C** — Also wrap formulas, merge, style, undo (`parseFormulas`, `setMerge`, …).

➡️ **Adopted: A.** Mutators are required for “matrix support”. Formulas/merge/style → later.

---

❓ **Q6** - **Row names and column types** (ROADMAP)

**A** — Column titles via widget headers (`setHeader`). Optional **row-name column** (leftmost, unique). Column `type` from the library (text / numeric / dropdown) where it exists.
**B** — Free-form per-cell Blockly values (nested blocks in cells) in Chunk 8.
**C** — Headers only; no row names or types yet.

➡️ **Adopted: A.** Per-cell nested Blockly (B) fights a spreadsheet widget; keep cells as JSON primitives in v1. Nested Blockly values stay on **Map** (see Q9).

---

❓ **Q7** - **Paste / file ingest**

**A** — Native widget clipboard (Excel/Sheets TSV) + `csv` / file open into `setData`. PapaParse only if CE v5 helpers are insufficient.
**B** — Always PapaParse, then `setData`.
**C** — File only, no clipboard.

➡️ **Adopted: A.** Native widget clipboard + CSV/file. PapaParse only if CE v5 helpers fail.

---

❓ **Q8** - **Test Run / codegen**

**A** — Named sheets on a convert-time bag (`ctx.sheets` / script argument), parallel to Defaults Map (ADR 0002). Accessors evaluate against that JSON.
**B** — Bake the grid as literals into generated scripts.
**C** — Mapping preview only; Conversion scripts ignore sheets until Chunk 9.

➡️ **Adopted: A.** Named sheets on a convert-time `ctx.sheets` bag (ADR 0002-style).

---

❓ **Q9** - **Relationship to 1D maps**

**A** — Keep `maps_*` unchanged. Sheets are a new Maps/Sheets toolbox group. Optional later: `sheet_to_map` (two columns → Map).
**B** — Replace terminology `maps_get` with sheets immediately.
**C** — Auto-project every 2-column sheet into a named Map.

➡️ **Adopted: mostly B, then step 2 = A.** If maps are used in **code or example sets** as 2-column terminology lookups, **replace with sheets**. **Do not delete `maps_*`.** Defaults Map and map **values** can be entire Blockly structures — that stays.

**Step 2 (2026-09-04):** keep maps; join Lists + Maps toolbox drawers into **Lists & maps**; Sheets remain a separate category. Recorded in [`DESIGN-sheets-vs-maps.md`](../design/DESIGN-sheets-vs-maps.md) and `docs/ROADMAP.md` §C.

---

❓ **Q10** - **FHIR ConceptMap / ValueSet**

**A** — Not in Chunk 8 (deferred).
**B** — Parse FHIR JSON into the sheet in this chunk.

➡️ **Adopted: A.** Not in Chunk 8. Reopen after accessors exist.

---

❓ **Q11** - **Tests**

**A** — Headless sheet-model tests + Blockly serialize + `runTest` lookup; one small terminology-grid fixture (not necessarily an example set).
**B** — Example set in `example-sets.json` required.
**C** — Widget screenshot-only.

➡️ **Adopted: A.** Headless sheet-model tests + Blockly serialize + `runTest` lookup; small fixture. Example set optional.

---

### Chunk 8 implementation notes (adopted 2026-09-04)

- **Order:** jspreadsheet-ce (Q1, including native import/export/fullscreen/i18n/Excel paste + host undo) → persist Sheet JSON (Q2) → embed widget in Mapping Editors with scrollbars, adjustable split, modal/fullscreen (Q3, Q7) → Blockly accessors/mutators (Q5) → Test Run/codegen bag (Q8).
- **Maps:** keep `maps_*`; replace terminology-style usage in code/prompts; Defaults + nested Blockly map values stay. Step 2 adopted: option A + joint **Lists & maps** toolbox category ([`DESIGN-sheets-vs-maps.md`](../design/DESIGN-sheets-vs-maps.md)).
- **Defer:** FHIR; Excel formulas/merge/style; per-cell nested Blockly; `DV_CODED_TEXT` composite helper; deleting `maps_*`.
- **Do not** paste into `maps_create_with` as the 2D representation.

### Relevant files (Chunk 8)

- `docs/future/spreadsheet-matrix-libraries.md` — library comparison
- `src/core/sheets/` — Sheet JSON model + lookup (new)
- `web/` — widget host + paste
- `src/blockly/blocks/` — `sheet_*` blocks (new); Lists & maps toolbox (`maps_*` kept)
- `src/core/source/query_runtime.ts`, `src/core/expression/mod.ts` — evaluate accessors
- `src/core/codegen/` — emit sheet lookups
- `src/core/test_runner/mod.ts` — `ctx.sheets`
- `CONTEXT.md`, `docs/ROADMAP.md` §C

  - [x] 8.1 Adopt library; add Deno import + vendored CSS/assets as needed
  - [x] 8.2 Sheet JSON model (name, headers, optional row names, values, types)
  - [x] 8.3 Embed widget; bind to model; Excel/Sheets paste + CSV/file
  - [x] 8.4 Blockly `sheet` declaration + accessor/mutator/lookup blocks
  - [x] 8.5 Test Run + codegen: named sheets bag
  - [x] 8.6 Tests: model, paste, Blockly round-trip, lookup in `runTest`
  - [x] 8.7 Docs: ROADMAP §C, CONTEXT Sheet vs Map
  - [x] 8.8 Q9 step 2: keep `maps_*`; join Lists + Maps into **Lists & maps**; Sheets stay separate
  - [ ] (later) FHIR ConceptMap → sheet
  - [ ] (later) formulas / `DV_CODED_TEXT` helper / `sheet_to_map`
  - [ ] (later) multi-column equality `sheet_lookup` — first slice of [`docs/future/decision-tables-for-mapping.md`](../docs/future/decision-tables-for-mapping.md)
  - [ ] (later) Decision tables (`kind: decision-table`) + sibling Example Set `examples/lung-MDT-form-decision-tables/`
  - [ ] (later) **DMN import/export** of simple tables (equality/range, FIRST/UNIQUE/COLLECT) — after internal table JSON is stable; no FEEL. [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5). Roadmap §C.

- [ ] 9.0 Chunk 9 — Conversion script goldens + XQuery Model A/C (roadmap J/K)
- [ ] 10.0 Chunk 10 — GitHub save, UI i18n, dependency hashes (roadmap B/L)
- [ ] 11.0 Chunk 11 — Better Form parity (roadmap G)
- [ ] 12.0 Chunk 12 — Java Export UI / VS Code host / Autoplay E2E
- [ ] 13.0 Chunk 13 — Colourblind language + sync highlight (roadmap B)
- [ ] 14.0 Chunk 14 — Human multi-user collaboration (architecture in [`ARCHITECTURE-multi-user-collab-prep.md`](./ARCHITECTURE-multi-user-collab-prep.md); CRDT/sync spike)