# Design investigation: Multi-agent undo, joint history, and CRDT readiness

**intEHRgrator · Chunk 5.1 frontier · 2026-08-31**

This document investigates whether intEHRgrator can deliver **joint undo/redo with actor attribution** and **selective undo** (“Undo my edit” / “Undo last agent change”) without adopting a full CRDT, what breaks when Blockly canvas edits interleave with Agent API mutations, and when CRDT/OT becomes necessary versus revision tokens + merge reports. It informs grill **Q6** (undo attribution) and **Q7** (conflict strategy).

---

## Executive summary

**Joint history with selective undo is logically possible without CRDT.** CRDT solves *concurrent convergence* (two writers editing the same document area at the same time without coordination). intEHRgrator’s Chunk 5.1 goals—actor-attributed timeline, filtered undo affordances, and preparation for future human multi-user sessions—are primarily a **history-model and session-unification problem**, not a CRDT problem.

The blocker today is not missing CRDT machinery; it is **two parallel undo stacks**, **two parallel document instances** (UI `WorkbenchController` vs Agent API `WorkbenchService`), and ** mismatched edit granularity** (Blockly events vs `ProjectBundle` snapshots).

**Recommendation:**

| Question | Phase 1 (Chunk 5.1, ship without CRDT) | Phase 2+ (when human multi-user or live co-editing) |
|----------|----------------------------------------|-----------------------------------------------------|
| **Q6 — Undo attribution** | Single **append-only history log** of `{ actor, summary, beforeBundle, revision }` entries; bridge Blockly debounced commits into the same log; UI filters for “undo mine” / “undo agent X” apply **compensating restore** to the matching entry | Optionally adopt **Yjs UndoManager** or **Automerge change metadata** if history must survive offline peer sync |
| **Q7 — Conflicts** | **Revision + 409** for single-writer retries; extend with **slot-level merge report** (partial apply like `importSuggestions`) for batch agent writes | Add **optional slot leases** for agent coordination; introduce **CRDT on Mapping Model slots** (not whole bundle) only when true simultaneous human editing is a product requirement |

Do **not** reinvent a CRDT. If Phase 2 needs one, prefer **Automerge** or **Loro** for JSON/tree mapping state, or **Yjs `Y.Map`** for slot-keyed expressions—with Blockly layout either derived from the model or synced via a movable-tree CRDT (Loro) in a later sub-phase.

---

## Current state: the two-stacks (and two-session) problem

### Architecture today

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Desktop app                                                             │
│                                                                         │
│  ┌──────────────────────┐         poll /api/v1/snapshot                 │
│  │ UI (web/main.ts)     │◄────────────────────────────────────┐         │
│  │ WorkbenchController  │                                     │         │
│  │ + Blockly Workspace  │     agent_bridge.ts                 │         │
│  │                      │     restoreDocumentSnapshot()       │         │
│  └──────────┬───────────┘                                     │         │
│             │ syncFromBlockly (canvas → model)                │         │
│             │ exportDocumentSnapshot                            │         │
│             ▼                                                 │         │
│  ┌──────────────────────┐         HTTP /api/v1/*              │         │
│  │ WorkbenchService     │◄────────────────────────────────────┘         │
│  │ (separate instance)  │                                               │
│  │ undoStack: Bundle[]  │                                               │
│  └──────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │ MCP / IDE agents                   │ Headless MCP (no desktop)
         └────────────────────────────────────┘
```

Chunk 5 shipped three overlapping persistence/undo mechanisms:

### 1. WorkbenchService snapshot undo (`src/workbench/service.ts`)

- **Mechanism:** Before each mutating API call, `withUndo` captures `exportBundle()` (full `ProjectBundle`), pushes to `undoStack`, clears `redoStack`.
- **Granularity:** One entry per service mutation (`mapNodeToSlot`, `importSuggestions`, `loadBundle`, …).
- **Scope:** Headless Agent API / MCP when proxied to desktop, or embedded headless service.
- **Actor:** None.
- **Revision:** FNV-1a hash over `{ model, blocklyState, handlebarsTemplate }` (`src/agent/revision.ts`).

```201:212:src/workbench/service.ts
  private withUndo(recordOrFn: boolean | (() => void), maybeFn?: () => void): void {
    const record = typeof recordOrFn === "function" ? true : recordOrFn;
    const fn = typeof recordOrFn === "function" ? recordOrFn : maybeFn!;
    const before = record ? this.exportBundle() : null;
    fn();
    if (record && before) {
      const after = this.exportBundle();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        this.undoStack.push(before);
        this.redoStack = [];
      }
    }
  }
```

### 2. Blockly native undo (`src/workbench/document_undo.ts` + workspace events)

- **Mechanism:** Blockly `Events.Abstract` on workspace undo/redo stacks.
- **Micro-edits:** Block create/delete/move, field changes, mutator compose/decompose, connection changes—all `recordUndo: true` by default.
- **Macro-edits:** `DocumentSwapEvent` wraps full-document replacements (Open template, Load Project, Example Set) with before/after `ProjectBundle` snapshots.
- **UI wiring:** Undo/Redo toolbar buttons call `workspaceCanUndo` / `workspaceCanRedo`—**not** `WorkbenchService.undo()`.

```1:5:src/workbench/document_undo.ts
/**
 * One undo step for Open template / Example Sets / Load Project / New project.
 * Canvas field edits stay on Blockly's native stack; this event restores a
 * full Project Bundle so a load can be undone without deleting later saves.
 */
```

### 3. Canvas → model sync (`src/workbench/controller.ts`)

- **Source of truth for mapping semantics:** Blockly canvas drives `MappingModel` via `syncFromBlockly`.
- **Derived fields:** `model.slots[]` expressions, `model.loops[]`, `model.optionalRm[]` are rebuilt from canvas extraction on every non-UI workspace change.
- **Agent reverse path:** `syncModelToBlocklyState` applies model expressions onto existing `blocklyState` (preserves block IDs and x/y when possible).

```674:704:src/workbench/controller.ts
  syncFromBlockly(
    blocklyState: unknown,
    slots: Array<{ slotId: string; rmType: string; expression: string }>,
    loops: MappingLoop[] = [],
    optionalRm?: MappingModel["optionalRm"],
    options?: { notify?: boolean },
  ): void {
    // ...
    // Canvas is source of truth: empty `loops` means the loops were undone, not "keep previous".
    next.loops = [...loops];
    // ...
    this.blocklyState = blocklyState;
    this.model = next;
```

### Critical gap: split session

`getSharedWorkbenchService()` constructs a **second** `WorkbenchController` inside `WorkbenchService`. The open UI uses its **own** controller. `agent_bridge.ts` polls the service revision and calls `controller.restoreDocumentSnapshot(payload.bundle)` on the UI side—**bypassing both undo stacks**.

User Blockly edits update the UI controller only until the next agent mutation triggers a bundle reload from the service. The service revision token does not reflect user canvas edits.

---

## Requirements from grill (Chunk 5.1 adopted direction)

From the Chunk 5 follow-up grill and product direction:

| ID | Requirement |
|----|-------------|
| R1 | **Joint undo/redo history** with **actor attribution** (`user` vs named `agentId` / `displayName`) |
| R2 | **UI affordances on top of unified timeline:** global Undo/Redo plus “Undo my edit” / “Undo last **AgentName** change” |
| R3 | **No main-canvas viewport hijacking** on agent edits (observer window for PEN-style presence—orthogonal to this doc) |
| R4 | **Prepare for future human multi-user sessions** without over-building now |
| R5 | **Do not reinvent CRDT**—evaluate mature libraries |
| R6 | Inform **Q7 conflict strategy:** revision+409 vs leases vs queue vs merge |

---

## intEHRgrator data model (concrete scope)

Understanding what must merge vs what is load-once informs CRDT placement.

### `ProjectBundle` (persistence unit)

| Section | Mutability during mapping | Conflict likelihood |
|---------|---------------------------|---------------------|
| `target` / `template`, `skeleton` | Load-once per session | Low (agent rarely reloads target mid-session) |
| `sourceSchema`, `examples` | Occasional add | Low–medium |
| `mapping.model` | **High** — core co-editing surface | **High** |
| `mapping.blocklyState` | **High** — layout + block graph | **High** |
| `mapping.handlebarsTemplate` | Medium (free-form targets) | Medium |
| `settings` | Per-user preference | Low (usually not shared) |

### `MappingModel` (semantic layer)

```typescript
interface MappingModel {
  modelVersion: number;
  templateId: string;
  targetFormat?: TargetFormatId;
  slots: MappingSlot[];           // slotId → expression (primary agent target)
  optionalRm: OptionalRmInsertion[]; // structural extras on RM containers
  loops?: MappingLoop[];          // for_each_source / [*] iteration
}

interface MappingSlot {
  slotId: string;       // stable key from skeleton
  rmType: string;
  expression: string; // canonical mapping value
  returnType: string;
  label?: string;
  mandatory?: boolean;
}
```

**Properties useful for merge without CRDT:**

- `slots` is naturally **keyed by `slotId`** — disjoint slot updates commute.
- `loops` keyed by `(attachSlotId, varName)` or path — small cardinality.
- `optionalRm` keyed by `(attachmentSlotId, attributeName)`.

**Non-commuting edits:** two writers changing the **same** `slotId.expression`, or agent import replacing many slots while user edits one of them.

### `blocklyState` (canvas layer)

- Blockly serialization JSON: blocks, connections, coordinates, mutator state.
- Block IDs are stable within a session but **not** semantically equal to `slotId` (one slot ↔ one or more blocks).
- Canvas edits include **non-semantically-critical** changes (x/y drag) and **semantic** changes (expression fields, mutator structure).
- `syncFromBlockly` re-derives `model` from canvas; agent `syncModelToBlocklyState` pushes model → canvas.

This **bidirectional sync** is the main interleaving hazard—not solvable by snapshot undo alone without session unification.

---

## Logical analysis: joint history + selective undo without CRDT

### What “joint history + selective undo” actually requires

| Capability | Requires CRDT? | Mechanism |
|------------|----------------|-----------|
| Append-only timeline with actor labels | **No** | History log entries with metadata |
| Global Undo / Redo (linear) | **No** | Snapshot or inverse-op stack (current pattern) |
| “Undo last change by actor X” | **No** | Scan log backwards for last entry where `actor.id === X`; restore `beforeBundle` from that entry; mark intervening entries **invalidated** or fork timeline |
| “Undo my edit” (local user) | **No** | Same scan with `actor.type === 'user'` |
| Redo after selective undo | **Hard without CRDT** | Must either (a) invalidate redo branch, or (b) replay log—standard selective-undo semantics |
| Two writers edit **same slot** simultaneously | **Yes for live merge; No for 409+retry** | Optimistic concurrency rejects one writer |
| Two writers edit **different slots** simultaneously | **No** | Slot-level LWW or merge-report |
| Offline peer sync with automatic convergence | **Yes** | CRDT or OT with persistent op log |

**Conclusion:** Selective undo is a **history indexing** feature. CRDT is a **concurrent write convergence** feature. They are orthogonal.

### Feasible Phase 1 history model (no CRDT)

Replace `undoStack: ProjectBundle[]` with:

```typescript
interface HistoryEntry {
  id: string;                    // uuid
  seq: number;                   // monotonic
  timestamp: string;
  actor: {
    type: "user" | "agent";
    id: string;                  // "local-user" or agentId
    displayName: string;
  };
  summary: string;               // "map-slot vitals.bp → $.observations[0].value"
  revisionBefore: string;
  revisionAfter: string;
  beforeBundle: ProjectBundle;   // compensating state
  // optional: affectedSlotIds[], affectedBlockIds[] for UI highlight
}

interface HistoryState {
  entries: HistoryEntry[];
  cursor: number;                // for linear undo/redo (-1 = tip)
  invalidatedAfter?: number;     // seq cutoff after selective undo
}
```

**Operations:**

| UI action | Algorithm |
|-----------|-----------|
| Undo (global) | Decrement cursor; `restoreDocumentSnapshot(entries[cursor].beforeBundle)` |
| Redo | Increment cursor; apply forward bundle at cursor+1 |
| Undo last agent change | Find max `seq` where `actor.type === 'agent'` and `seq <= cursor`; restore its `beforeBundle`; set `cursor = that seq - 1`; truncate redo |
| Undo my edit | Same with `actor.type === 'user'` |

**Selective undo invalidates linear redo** for entries after the undone point—this matches Google Docs “undo my typing” semantics and does **not** require CRDT.

### Bridging Blockly micro-edits into the joint timeline

Blockly’s native stack is **too fine-grained** (every drag step) and **actor-less**. Options:

| Strategy | Pros | Cons |
|----------|------|------|
| **A. Keep Blockly stack for micro-edits; service log for agent + document swaps only** | Minimal change; matches grill “A first” | Not truly “joint”; user sees two undo systems |
| **B. Debounced commit points** — coalesce Blockly changes every N ms or on blur/group into one history entry | Single timeline; reasonable granularity | Loses per-keystroke Blockly undo unless kept as sub-stack |
| **C. Custom Blockly events with actor** — extend `DocumentSwapEvent` pattern; disable native stack | One stack, full attribution | Large refactor; Blockly issue #1266 notes undo stack is not designed for multi-user persistence |
| **D. Elevate on semantic boundary** — record history when `syncFromBlockly` changes `slotSignature` | Aligns log with mapping semantics | Misses pure layout moves (may be acceptable) |

**Recommended for 5.1:** **B + D hybrid**

1. User canvas edits: debounce (e.g. 500–1500 ms idle or `eventUtils.setGroup` completion) → append `HistoryEntry` with `actor: user`.
2. Agent API mutations: one entry per API call (already coarse).
3. Document loads (`DocumentSwapEvent`): one entry each (already implemented pattern).
4. **Retire Blockly undo buttons as primary** for mapping session—or mirror: toolbar Undo pops joint history, which internally may replay bundle restore (Blockly stack cleared/reloaded).

### What breaks when user Blockly-edits and agent API-edits interleave

| Scenario | Current behaviour | Risk |
|----------|-------------------|------|
| User drags block; agent maps slot via API | Service revision unchanged; bridge may not sync until agent acts again | User edit invisible to agents using stale revision |
| Agent maps slot; bridge reloads bundle | `restoreDocumentSnapshot` resets canvas; **Blockly undo stack wiped** | User loses undo history |
| User editing expression field; agent `importSuggestions` | Last writer wins on full bundle restore | User’s in-progress edit lost silently |
| User undo (Blockly); agent had changed model | Stacks independent | User undo reverts canvas but not agent’s semantic slot change in service |
| Agent undo (service); UI not connected to service stack | No effect on visible canvas | Confusing—API undo doesn’t match UI |
| Concurrent map to **same** `slotId` | Second agent gets 409 if `If-Match` correct | Good—but UI user isn’t in that protocol |
| Concurrent map to **different** slots | Both succeed if sequential | Good |
| Agent `syncModelToBlocklyState` after user moved blocks | Expressions update; positions preserved | OK |
| User mutator removes optional RM; agent adds slot mapping | Model rebuild may drop optionalRm inconsistently | Needs integration test |

**Root fix (Phase 1 prerequisite):** **Unify session state**—single `WorkbenchService` instance backing both UI and Agent API, or bidirectional sync of every user edit to the service with revision bump. Without this, joint history is cosmetic.

---

## Snapshot-based undo vs event-based undo

| Layer | Best representation | Rationale |
|-------|---------------------|-----------|
| Agent API mutations | **Snapshot** (`ProjectBundle` before) | Coarse, idempotent, matches revision token; import may touch 50 slots |
| Document load/replace | **Snapshot** (`DocumentSwapEvent`) | Already shipped |
| Blockly micro-edits | **Events** internally; **snapshot commits** in joint log | Events efficient for canvas; snapshots safe for cross-actor undo |
| Future slot-level CRDT | **Op log per slot** | Commute across slots |

**Snapshot cost:** Typical mapping bundle (template + schema + blockly JSON) may be 100 KB–2 MB JSON. Memory for 50 undo steps ≈ 5–100 MB—acceptable for desktop; consider **structural sharing** or **mapping-only snapshots** (store `mapping` subsection + revision of load-once parts) if profiling demands.

**Event cost:** Blockly workspace with 200 blocks generates many events per gesture. Replaying for selective undo across actors is fragile (Google’s stated intent: editor B should not undo editor A’s work via events alone).

**Verdict:** Keep **snapshots for joint history**; use Blockly events only as **ephemeral local buffer** until debounced commit.

---

## When CRDT/OT is required vs alternatives enough

| Scenario | Revision + 409 | Merge report (slot) | Slot leases | Serial queue | CRDT |
|----------|----------------|---------------------|-------------|--------------|------|
| Single agent + observing human | ✓ | optional | — | — | overkill |
| Two agents, different slots | ✓ | ✓ | optional | ✓ | optional |
| Two agents, same slot | ✓ (retry) | partial + conflict list | ✓ | ✓ | ✓ for live |
| Human + agent simultaneous edit | ✗ (UI not in protocol) | ✓ after unify session | ✓ | ✓ | ✓ for live |
| Two humans live co-editing canvas | ✗ | ✗ for layout | ✗ | poor UX | **✓** |
| Offline multi-peer sync | ✗ | ✗ | ✗ | ✗ | **✓** |

**Alternatives enough for Chunk 5.1–6:** sequential agent writes, revision checks, slot-keyed merge for batch imports, session unification.

**CRDT required when:** product commits to **Google Docs-style simultaneous human editing** of the same mapping project with automatic convergence on block graph and/or slot expressions without manual conflict resolution.

---

## CRDT vs alternatives comparison

| Approach | Concurrent merge | Selective undo | Actor attribution | Blockly fit | Deno/desktop |
|----------|------------------|----------------|-------------------|-------------|--------------|
| **Snapshot log + actor metadata** | ✗ (single writer) | ✓ | ✓ | ✓ (bundle restore) | ✓ native |
| **Revision + 409** | retry only | N/A | N/A | ✓ | ✓ native |
| **Slot merge report** | partial ✓ | N/A | per-op ✓ | ✓ (model layer) | ✓ native |
| **Slot leases** | prevention | N/A | holder id | ✓ | ✓ native |
| **Serial mutation queue** | ✓ (ordered) | ✓ | ✓ | ✓ | ✓ native |
| **OT (ShareDB)** | ✓ | custom | custom | custom | server needed |
| **CRDT (Yjs/Automerge/Loro)** | ✓ | UndoManager | awareness | custom binding | Yjs ✓; others WASM |

---

## Library evaluation (TypeScript / Deno)

Do **not** implement a custom CRDT. Evaluation for intEHRgrator’s **JSON mapping document + Blockly graph**.

### Yjs

| Aspect | Assessment |
|--------|------------|
| **Model** | `Y.Map`, `Y.Array`, `Y.Text` shared types |
| **JSON document** | Model `slots` as `Y.Map<slotId, Y.Map>` works; whole `blocklyState` as nested `Y.Map` possible but verbose |
| **Undo** | [`UndoManager`](https://docs.yjs.dev/api/undo-manager) scopes undo to local client—matches “undo my edit” |
| **Blockly** | **No official binding.** Community pattern: sync workspace JSON blob as encoded update, or map block IDs → Y.Map entries |
| **Deno** | Pure JS, `npm:yjs` works in Deno 2 |
| **Bundle** | ~18 KB min+gz |
| **Prior art** | ProseMirror/Tiptap/Monaco; OpenBlock uses Yjs for ProseMirror-like editor, not Blockly workspace |

**Pros:** Best ecosystem, no WASM, production-proven selective undo.  
**Cons:** Blockly integration is DIY; block tree moves need careful Y.Map schema design.

### Automerge 3

| Aspect | Assessment |
|--------|------------|
| **Model** | Arbitrary JSON as CRDT document |
| **JSON document** | **Excellent fit** for `MappingModel` — nested objects merge natively |
| **Undo** | Change graph with actor metadata; time-travel |
| **Blockly** | `blocklyState` as nested JSON works but **large doc cost**; block moves merge semantically at JSON level (may produce invalid Blockly graph) |
| **Deno** | WASM (`@automerge/automerge`); init cost on large docs |
| **Bundle** | ~320 KB+ WASM |

**Pros:** Best “whole JSON document” story; strong history/attribution.  
**Cons:** WASM weight; Blockly validity after merge needs validation pass; fewer editor bindings.

### Loro

| Aspect | Assessment |
|--------|------------|
| **Model** | Movable Tree CRDT, rich text, JSON-like Map |
| **JSON document** | Good for hierarchical block trees |
| **Blockly** | **Theoretically strongest** for block parent/child moves (`MovableTree`) |
| **Deno** | WASM (`loro-crdt`) |
| **Maturity** | 1.0+ but smaller ecosystem than Yjs |

**Pros:** Tree CRDT aligns with Blockly block hierarchy.  
**Cons:** Younger; custom integration; WASM.

### Diamond Types

Text-only CRDT (RGA/Fugue). **Not suitable** for JSON mapping model or Blockly graph. Skip.

### ShareDB / OT

JSON OT with central server. Viable for hosted multi-user but **not local-first** and not aligned with current desktop-first Agent API. Defer unless cloud collaboration becomes core.

### Managed platforms (Liveblocks, PartyKit)

Built on Yjs. Useful if intEHRgrator later offers hosted rooms; unnecessary for localhost agent workflow.

### Summary recommendation table

| Library | MappingModel.slots | blocklyState | Selective undo | Phase 2 pick |
|---------|-------------------|--------------|----------------|--------------|
| **Yjs** | Good (`Y.Map`) | DIY | Built-in UndoManager | **Default if CRDT needed** |
| **Automerge** | Excellent | Risky (invalid graphs) | Built-in | **Best if model-only CRDT** |
| **Loro** | Good | Best tree semantics | Built-in | **If canvas co-editing is primary** |
| **Diamond Types** | ✗ | ✗ | N/A | Skip |

---

## Blockly collaboration prior art

| Source | Finding |
|--------|---------|
| [google/blockly#1266](https://github.com/google/blockly/issues/1266) | Blockly maintainers assume **each editor keeps its own undo stack**; serialized events are minimal for wire transfer; **editor B should not undo editor A’s work** via events. Multi-user undo requires session/user scoping externally. |
| [Labbs/openblock](https://github.com/Labbs/openblock) (Yjs + history) | Real-time collab disables native history; uses **y-prosemirror `yUndoPlugin`** for scoped undo—pattern applies conceptually, not drop-in for Blockly. |
| Blockly event system docs | Events provide **foundation** for collaboration but **no shipped collab module**. |
| intEHRgrator Chunk 2 | **Canvas is source of truth**; `syncFromBlockly` derives model—any collab design must pick **one authoritative layer** or sync both ways with validation. |

**Implication:** Do not expect Blockly to solve multi-agent undo. Either:

1. **Model-authoritative:** Agents and users ultimately mutate `MappingModel`; canvas is projection (`syncModelToBlocklyState` / `applyModelExpressions`). Joint history at model+bundle level. Layout conflicts resolved by LWW on coordinates.

2. **Canvas-authoritative:** All agents call `loadBlocklyState` or granular block ops; model always derived. CRDT on blockly JSON required for live multi-user canvas.

intEHRgrator already leans **model-authoritative for agents** (`map-slot`, `importSuggestions`) with canvas sync—extend that for Phase 1.

---

## Recommended phased approach

### Phase 1 — Chunk 5.1 (ship without full CRDT)

**Goal:** Joint attributed history, selective undo affordances, session unification, Q7 baseline.

1. **Unify session**
   - Single document owner: route UI mutations through shared `WorkbenchService` (or sync UI → service on every `persistBlocklyCanvas` with revision bump).
   - Agent bridge becomes event-driven (revision push) rather than blind poll+replace.

2. **History log with actors (semantic commits)**
   - Extend `withUndo` → `recordHistory({ actor, summary, kind, beforeBundle })`.
   - **Semantic kinds** (grill round 2): record on attach/detach/add/remove, expression/loop/optionalRm/import changes — **not** pure x/y block moves.
   - Coalesce events from one gesture (e.g. mutator compose) into one entry.
   - Accept `X-Agent-Id`, `X-Agent-Name` headers (grill Q4 option B) on mutating API calls.
   - User canvas edits: commit to history on semantic Blockly events (filter move-only).

3. **API surface**
   - `GET /api/v1/history` — list entries (seq, actor, summary, kind, revisionAfter, affectedSlotIds).
   - `GET /api/v1/history/{seq}/preview` — optional bundle at point (timeline scrub).
   - `POST /api/v1/restore-at { seq, mode: "view" | "destructive" }` — view = temporary; destructive = confirm + rollback.
   - `POST /api/v1/undo` — optional `{ scope: "global" | "actor" | "entry", actorId?, seq? }`.
   - `POST /api/v1/patch-undo { targetSeq }` — best-effort compensating patch; may return conflicts; AI-assisted variant via MCP prompt metadata.
   - Keep `POST /undo` / `POST /redo` as global linear shortcuts.

4. **UI**
   - **Timeline panel**: scrub forward/back; destructive rollback to seq (with confirmation).
   - Undo menu: “Undo **{displayName}**: {summary}”; “Undo my last edit”; “Undo last agent change”.
   - Optional: “Remove effects of this step…” → best-effort patch or copy AI prompt for MCP agent.
   - Disable or subordinate Blockly native undo when joint history is active (config flag during transition).

5. **Q7 conflict handling (Phase 1)**
   - Keep **revision + 409** on all mutating endpoints.
   - Add **merge report** mode for `importSuggestions` and optional batch endpoint: `{ applied, conflicts: [{ slotId, agentValue, currentValue }] }`.
   - Document agent retry: refresh `/bundle`, merge, retry failed slots.

6. **Observer / highlight** (grill Q2–Q5): orthogonal; use `affectedSlotIds` / block IDs from history for pulse highlights.

**Explicitly defer:** CRDT library integration, slot leases, human multi-user WebSocket room. **Prep only:** see [`ARCHITECTURE-multi-user-collab-prep.md`](./ARCHITECTURE-multi-user-collab-prep.md).

### History retention (grill round 2)

- **Desktop:** append history to disk (sidecar / SQLite); no arbitrary entry cap.
- **Web:** unbounded until memory pressure; then **warn** and let user approve purge of oldest entries.
- Store full `ProjectBundle` snapshot per semantic entry (macro) or slot-diff metadata where possible to save space later.

### Phase 2 — CRDT introduction (Chunk 14 — human multi-user)

**Entry criteria (any one triggers evaluation spike):**

- Two humans editing same project concurrently in desktop or web.
- >N weekly conflict 409s on same slot despite retry.
- Offline edit on two devices + merge on sync.

**Recommended stack placement:**

```
ProjectBundle
├── target, schema, examples     → load-once, revision locked (no CRDT)
└── mapping
    ├── model (MappingModel)     → **CRDT layer here first** (slots, loops, optionalRm)
    ├── blocklyState             → derived from model OR Loro MovableTree (Phase 2b)
    └── handlebarsTemplate       → Y.Text or Automerge.Text (if free-form collab)
```

**Why model-first CRDT:** Agents already speak slot/loop/import semantics; `slotId` keys commute; validation is easier than merging arbitrary Blockly graphs.

**Phase 2b — canvas CRDT (optional):** Only if block **layout** co-editing is required. Spike **Loro MovableTree** mapping blockId → node; validate with Blockly load after merge.

**Provider:** localhost: start with **in-memory Y.Doc / Automerge.Doc** on desktop; **y-websocket** or **Automerge sync server** only when second human peer joins.

### Phase 3 — Multi-user production

- Room per `projectId`.
- Persistence: append CRDT updates to `.intehrgrator` sidecar or SQLite.
- Optional slot leases for agent “thinking” periods on hot slots.
- GitHub save remains explicit export—not live CRDT transport.

---

## Q7 recommendation (after analysis)

| Phase | Strategy | Notes |
|-------|----------|-------|
| **5.1 (now)** | **A + D** | Revision + 409 for all writes; slot-level **merge report** for batch/agent imports (reuse partial-import pattern). |
| **5.2 (optional)** | **+ B** | `POST /api/v1/lease-slot { slotId, agentId, ttlSec }` — advisory locks for agents targeting same terminology/map blocks. |
| **6+ (multi-user humans)** | **+ CRDT on model** | Yjs or Automerge for `MappingModel`; leases as UX hint not correctness gate. |
| **Avoid for v1** | **C (global serial queue)** | Adds latency for parallel agents with no UX benefit over 409+retry on disjoint slots. |

---

## Open questions for grill round 3

1. **Destructive rollback vs timeline fork:** After rollback to seq *N*, discard entries *N+1…* or keep them in a “discarded branch” for recovery?

2. **AI patch prompt schema:** Fixed MCP tool that returns `intehrgrator-suggestions` diff, or free-form agent reasoning?

3. **View mode during scrub:** Temporary overlay on canvas vs split observer window only?

4. **Semantic coalescing window:** Max events merged per gesture (mutator compose = 1 entry always)?

---

## Grill round 2 — adopted summary (2026-08-31)

| Topic | Decision |
|-------|----------|
| History commits | **Semantic** (attach/detach/add/remove, mapping fields) — not time debounce, not x/y |
| Undo modes | Timeline scrub + **destructive rollback** (confirm) + **best-effort patch** (+ optional AI via MCP) |
| Retention | No cap; disk on desktop; web warns before purge |
| Human multi-user | **Chunk 14**; prep in [`ARCHITECTURE-multi-user-collab-prep.md`](./ARCHITECTURE-multi-user-collab-prep.md) |

---

## References and links

### intEHRgrator codebase

- `src/workbench/service.ts` — service undo stack, `withUndo`, revision bump
- `src/workbench/document_undo.ts` — `DocumentSwapEvent` for macro undo
- `src/workbench/controller.ts` — `syncFromBlockly`, `exportDocumentSnapshot`, `restoreDocumentSnapshot`
- `src/workbench/blockly_sync.ts` — headless model → blockly sync
- `src/agent/http.ts` — Agent API, 409 on revision conflict
- `src/agent/revision.ts` — FNV revision over mapping payload
- `src/web/agent_bridge.ts` — UI poll sync from service
- `web/main.ts` — Blockly change listener, undo buttons wired to workspace stack
- `docs/historical-archive/TASKS-roadmap-chunks.md` — Chunk 5 follow-up grill Q6/Q7 (archived)
- `docs/design/ARCHITECTURE-multi-user-collab-prep.md` — Chunk 14 architecture prep

### External

- [Yjs documentation](https://docs.yjs.dev/) — shared types, UndoManager, providers
- [Yjs GitHub](https://github.com/yjs/yjs)
- [Automerge](https://automerge.org/)
- [Loro CRDT](https://loro.dev/)
- [Blockly issue #1266 — event serialization & multi-user undo assumption](https://github.com/google/blockly/issues/1266)
- [Labbs/openblock — Yjs collab + history disable pattern](https://github.com/Labbs/openblock)
- [PkgPulse: Yjs vs Automerge vs Loro (2026)](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)
- [google/blockly DeepWiki — Event System](https://deepwiki.com/google/blockly)

---

## Appendix: selective undo walk-through (no CRDT)

**Timeline:**

| seq | actor | summary |
|-----|-------|---------|
| 1 | user | drag block A |
| 2 | agent:TerminologyAgent | map slot `vitals.icd` |
| 3 | user | edit expression on slot `vitals.bp` |
| 4 | agent:MappingAgent | import 3 suggestions |

**Action: “Undo last agent change” (MappingAgent):**

1. Scan backwards from cursor=4 → find seq=4.
2. Restore `beforeBundle` from entry 4.
3. Set cursor=3.
4. Redo entries 5+ invalidated.

User’s seq=3 edit is preserved **if** its changes are still in the restored bundle at seq=3 state. If seq=4’s import overwrote slot `vitals.bp`, restoring to pre-import state **necessarily** reverts that slot to seq=3 content—not seq=4 partial. This is standard snapshot semantics; CRDT would enable finer-grained merge but is not required for correctness.

**Action: “Undo my edit”:**

1. Scan backwards → seq=3 (user).
2. Restore entry 3’s `beforeBundle`.
3. Agent changes at seq=2 and 4 remain undone in the sense of cursor position; **note:** snapshot restore replaces entire mapping—agent edits after seq=3 are logically “undone” visually unless history algorithm replays them (advanced **selective revert** vs **branch cut**—product choice in grill round 2).

This appendix illustrates why **grill round 2 question 2** (preserve vs destructive) matters more than CRDT choice for 5.1.
