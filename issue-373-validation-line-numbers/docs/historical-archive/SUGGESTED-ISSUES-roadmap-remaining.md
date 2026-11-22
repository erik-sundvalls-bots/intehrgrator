# Suggested GitHub issues — remaining roadmap work

> **⚠️ ARCHIVED** — This was a staging list for filing GitHub issues. **Live planning is now [GitHub Issues](https://github.com/regionstockholm/intehrgrator/issues)** — see [docs/agents/issue-tracker.md](../agents/issue-tracker.md).

**Date:** 2026-09-09 (status refresh 2026-09-14)  
**Sources:** [ROADMAP.md](./ROADMAP.md), [TASKS-roadmap-chunks.md](./TASKS-roadmap-chunks.md), open GitHub issues (cross-checked).  
**Purpose:** Inspect and edit this list before filing real issues. Do **not** treat unchecked boxes here as tracker state.

## Snapshot

| Area | Status |
| ---- | ------ |
| Chunks **1–8** + **5.1** | Done (merged) |
| Chunk **7.1** (Handlebars Mapping preview) | Still open (S-01 not filed yet) |
| VMS frontier **#35–#40** | Done; **#41** still open |
| Decision tables core (**#69** / S-03) | Done; sibling Example Set reauthor is **#70** |
| Constraint Overlay Phase 1 | Done (**#46** closed / PR #48) |
| Section A issues closed since draft | **8** of **10** (`#21`, `#35`, `#37`–`#40`, `#49`, `#51`, `#52`); **2** remain open (`#41`, and none else from the original Keep list) |

**Suggested-new backlog (section B):** S-03 done via **#69**; S-01–S-02 / S-04–S-16 still unfiled or open as follow-ups (`#70`, `#82`, `#84`, …).

---

## A. Existing issues from 2026-09-09 draft — status

Bodies were updated on GitHub for #35, #37, #38, #39, #49, #51, #52. Triage labels `ready-for-agent` / `needs-triage` / `needs-info` / `ready-for-human` exist on the repo.

| Issue | Verdict |
| ----- | ------- |
| **[#35](https://github.com/regionstockholm/intehrgrator/issues/35)** Decide: remove verification-hostile Blockly from the toolbox | **Done** (PR #58). |
| **[#37](https://github.com/regionstockholm/intehrgrator/issues/37)** Extend Mapping Model IR beyond flat `slots[]` | **Done** (PR #58). |
| **[#38](https://github.com/regionstockholm/intehrgrator/issues/38)** Unify Mapping preview vs TypeScript vs XQuery on VMS | **Done**. |
| **[#39](https://github.com/regionstockholm/intehrgrator/issues/39)** XQuery: `for_each_source` + nested structure | **Done**. |
| **[#40](https://github.com/regionstockholm/intehrgrator/issues/40)** Workspace linter for VMS escape hatches | **Done**. |
| **[#41](https://github.com/regionstockholm/intehrgrator/issues/41)** Property-based / metamorphic checks | **Keep; last VMS frontier item.** Separate from S-07 dependency hashes. |
| **[#21](https://github.com/regionstockholm/intehrgrator/issues/21)** Remove ehrtslib vendor `code_list` patch | **Done**. |
| **[#49](https://github.com/regionstockholm/intehrgrator/issues/49)** Scaffolding rule updates + defaults / TERM_PICK UX | **Done**. |
| **[#51](https://github.com/regionstockholm/intehrgrator/issues/51)** Mapping Spec / Sheets editor chrome (tabs, dividers, button order) | **Done**. |
| **[#52](https://github.com/regionstockholm/intehrgrator/issues/52)** Discoverability of non-openEHR blocks (glyphs + mutator placement) | **Done**. |

**Closed / do not re-open:** #46 Constraint Overlay Phase 1. Phase 2+ (value-domain overlay) is out of ROADMAP for now — only file if you want it tracked.

---

## B. Suggested **new** issues (implementation-sized)

Edit titles/bodies freely. Proposed order is “good next agents,” not a hard priority lock.

### S-01 — Harden Handlebars Mapping preview (Chunk 7.1)

**Combines:** ROADMAP G (preview Test Run hardening); TASKS 7.1.1–7.1.7 / 7.6 carry-over.

**Why one issue:** Small, fixture-first, unblocks later Handlebars codegen/example work; independent of the VMS chain (#38+).

**Acceptance sketch:**
- Kintegrate fixtures assert via `runTest` Mapping preview, not only direct `renderHandlebars`
- Parity: same fixture under `outputMode: "preview"` and `"handlebars"`
- Slot/json interop (`{{slot}}`, `{{{json (slot …)}}}`)
- Fix `handlebars()` builtin to pass slot bag
- Docs: ADR 0003 / ROADMAP wording

**Out of scope:** Blockly→Handlebars codegen (S-10); Better Form parity (S-09).

---

### S-02 — Multi-column equality `sheet_lookup`

**Combines:** ROADMAP C multi-column lookup; TASKS Chunk 8 “(later) multi-column equality”; first slice of [`docs/future/decision-tables-for-mapping.md`](../future/decision-tables-for-mapping.md).

**Why separate from decision tables:** Still a Sheet (data grid), not predicates/hit policies. Small Blockly + model + codegen change.

**Acceptance sketch:**
- AND of several `header = value` pairs; first matching row
- Mapping Spec widget + TS/XQuery/Go emit or clear “unsupported”
- Tests in sheet evaluate + one fixture

**Blocked by:** none (Chunk 8 done).  
**Blocks:** S-03 refinements (nice-to-have precursor).  
**Note:** Core decision tables shipped as **#69**; this remains useful for data Sheets.

---

### S-03 — Decision tables (`kind: decision-table`) + lung-MDT sibling Example Set — **Done (core)**

**Filed as:** [#69](https://github.com/regionstockholm/intehrgrator/issues/69) (closed). Sibling Example Set reauthor: [#70](https://github.com/regionstockholm/intehrgrator/issues/70). Follow-ups: [#82](https://github.com/regionstockholm/intehrgrator/issues/82), [#84](https://github.com/regionstockholm/intehrgrator/issues/84).

**Original acceptance (core shipped in #69):**
- Sheets-adjacent `kind`; predicate cells, don't-care; hit policy FIRST then UNIQUE/COLLECT
- Mixed **value** and **snippet** output columns
- No FEEL; no DMN yet

**Still open from original sketch:** Sibling Example Set `test/fixtures/lung-MDT-form-decision-tables/` (catalog id `lung-mdt-form-to-tc-xml-decision-tables`) — tracked by **#70**; do **not** replace the existing lung-MDT set.

---

### S-04 — DMN import/export for simple decision tables

**Combines:** ROADMAP C DMN; TASKS later DMN.

**Why separate:** Only after internal decision-table JSON is stable.

**Acceptance sketch:** Equality/range + FIRST/UNIQUE/COLLECT only; no FEEL as Mapping Expression language.

**Blocked by:** S-03 / #69 (done).

---

### S-05 — FHIR ConceptMap / ValueSet → Sheet import

**Combines:** ROADMAP C FHIR deferred item.

**Why separate:** Independent of decision tables; feeds terminology Sheets.

**Acceptance sketch:** Parse FHIR JSON into project Sheet model; optional Example/fixture; no runtime FHIR server required for v1.

**Blocked by:** none (accessors exist). Soft-after S-02 if multi-key lookups help.

---

### S-06 — GitHub-backed project save (when logged in)

**Combines:** ROADMAP B “Integrate save functions with github repo”.

**Why split from i18n/hashes:** Auth + repo I/O is a different stack from chrome strings or content hashing.

**Acceptance sketch:** Save/load `.intehrgrator` (or project folder) to a user repo when authenticated; Web Shell path clear; desktop may keep local-first.

**Related open UX:** none. Independent of #51.

---

### S-07 — Source/target dependency version hashes before convert

**Combines:** ROADMAP L.

**Why separate:** Correctness guardrail; small core change; pairs well with Test Run, not with GitHub OAuth.

**Acceptance sketch:** Detect OPT/schema/source identity change since last successful load (hash or version); warn or fail convert when stale; document behaviour.

**Related:** #41 is generative robustness; this is dependency drift. Keep both.

---

### S-08 — Full application UI i18n

**Combines:** ROADMAP B full UI i18n (toolbar language already switches Blockly/stock).

**Why separate:** Large string inventory; keep model/ontology language (Target pane) separate as already specified.

**Acceptance sketch:** Pane titles, buttons, tips, status from same UI-language setting; `en`/`sv`/… parity for chrome; jspreadsheet `setDictionary` already noted in Chunk 8 grill.

**Soft-link:** #52 / S-11 — translated strings must not rely on colour alone.

---

### S-09 — Better Form Bridge: ScriptApi / formTestApi / Cypress parity

**Combines:** ROADMAP G Better Form parity; Chunk 11.

**Why one issue:** Licensed optional path; natural single epic with phased checklist.

**Acceptance sketch:** Documented parity matrix vs Better form-viewer APIs; Cypress generator port or explicit deferrals.

**Blocked by:** S-01 useful if forms lean on Handlebars preview.

---

### S-10 — Blockly → Handlebars codegen + reverse-engineered Handlebars Example Set

**Combines:** ROADMAP G Blockly→Handlebars codegen + Handlebars example set / non-Blockly harness.

**Why combine:** Same language family; example set validates codegen. Split into two issues if you prefer smaller PRs (codegen first, then example).

**Acceptance sketch:**
- `generate(model, "handlebars")` (or agreed surface) for VMS-ish mappings
- Example Set + expected output harness for Handlebars files (after chemo Go example pattern)
- Non-Blockly editing support only as needed for the harness

**Blocked by:** S-01. Soft-align with #38 if codegen should stay on VMS.

---

### S-11 — Colourblind-safe in→conv→out language + sync highlight

**Combines:** ROADMAP B colourblind patterns + sync highlight mapping ↔ Conversion Test Run; Chunk 13.

**Why combine:** One visual language across panes; sync highlight is the same design system.

**Acceptance sketch:**
- Consistent colour **and** pattern for source → conversion → target (syntax highlight, block colours, Test Run)
- Sync highlight between mapping selection and Test Run (and optionally generated script)
- Works with #52 glyphs (icons + patterns, not colour-only)

**Blocked by:** none hard; nicer after #51/#52 so chrome is not mid-refactor.

---

### S-12 — TakeCare schema golden + term-id systems (test vs prod)

**Combines:** ROADMAP H remaining TakeCare items.

**Why one issue:** Vendor-specific; Chunk 6 deliberately deferred both.

**Acceptance sketch:** Decide design-time vs runtime plugin story; golden load of TakeCare XSD; term-id blocks / system switch for test vs prod.

**Note:** Chemo Example Set already exercises TakeCare **schema blocks** at runtime — this issue is the productized/vendor extras, not “can we load an XSD.”

---

### S-13 — Later hosts epic (checklist) — Java Export UI / VS Code / Autoplay E2E

**Combines:** ROADMAP / Chunk 12.

**Why one epic with three child issues (recommended):** Different stacks; filing three separate issues is fine — use this as parent text if you want a single tracking issue:

1. Java Export UI  
2. VS Code extension host  
3. Autoplay E2E  

Mark post-v1 explicitly.

---

### S-14 — Human multi-user collaboration (Chunk 14)

**Combines:** ROADMAP B/D multi-user; Chunk 14; [`ARCHITECTURE-multi-user-collab-prep.md`](../design/ARCHITECTURE-multi-user-collab-prep.md).

**Why one late epic:** CRDT/sync spike + rooms; 5.1 already laid actor/history seams. Do not start until single-user VMS/platform work is calm.

**Acceptance sketch:** Spike choice (Automerge/Yjs/Loro per design docs); shared room prototype; no requirement to finish full product in one issue.

---

### S-15 (optional) — Agent API slot leases (Chunk 5.2 leftover)

**Combines:** TASKS 5.1 grill Q7 Phase 5.2 optional leases.

**Why optional/small:** Revision+409 + merge report already shipped; leases only if multi-agent contention hurts in practice.

---

### S-16 (optional / docs-light) — Prefer STRUCTURED over FLAT as openEHR source

**Combines:** ROADMAP G note on FLAT vs STRUCTURED.

**Why optional:** Mostly product guidance + loader UX; FLAT must remain supported. Could be a short enhancement or docs-only issue.

---

## C. Do **not** file as new issues (covered elsewhere)

| Roadmap / task item | Covered by |
| ------------------- | ---------- |
| Chunk 9 “golden TS/Java/XQuery” (core of J) | **#38** done; remaining Java/Handlebars compare still open in ROADMAP J |
| XQuery loops / nested emit | **#39** done |
| Escape-hatch warnings | **#40** done |
| Metamorphic / PBT robustness | **#41** (still open) |
| Decision tables core | **#69** done; Example Set reauthor **#70**; refinements **#82** / **#84** |
| MCP scroll/highlight / multi-agent observer | Done in Chunk 5.1 (ROADMAP updated) |
| Schema JSON/XSD dynamic toolboxes + generic drawers | Done in Chunk 6 (ROADMAP updated) |
| Sheets widget + `sheet_*` | Done in Chunk 8 |
| `source_query_node` click-to-map | Done (Chunk 7.10; ROADMAP updated) |
| RM “missing classes” flyout pass | Done in Chunk 3 (ROADMAP updated) |
| Constraint Overlay Phase 1 | **#46** closed |

Full COMPOSITION XML + Saxon/BaseX CI: prefer a child of closed **#39** (or extend open XQuery issues **#75**/#**78**) rather than a fresh “Chunk 9” issue.

---

## D. Suggested filing / work order (for agents)

1. **#41** last VMS frontier item  
2. **S-01** Handlebars preview (parallel is OK)  
3. **#70** lung-MDT / chemo Example Set reauthor onto decision tables  
4. **S-02** multi-column `sheet_lookup` when data-Sheet workflows need it  
5. **S-04** DMN after table JSON stays stable  
6. **S-05** FHIR import when terminology workflows need it  
7. **S-06 / S-07 / S-08** platform (order flexible)  
8. **S-09 / S-10** Better Forms + Handlebars codegen  
9. **S-11** a11y visual language  
10. **S-12** TakeCare vendor extras  
11. **S-13 / S-14** late hosts + multi-user  

---

## E. Edit log

- 2026-09-09: Initial draft after ROADMAP/TASKS tick-off for Chunks 5.1–8 and open-issue cross-check.
- 2026-09-09: Applied section A suggested edits via `gh issue edit` (#35, #37–#39, #49, #51, #52); created triage labels; removed Suggested edit column.
- 2026-09-10: Marked **#35/#37** done (PR #58); VMS frontier reordered to **#38 → #39 → #40 → #41**.
- 2026-09-14: Marked **#21, #38–#40, #49, #51, #52** done; **S-03** done via **#69** (sibling Example Set → **#70**); snapshot totals refreshed.
