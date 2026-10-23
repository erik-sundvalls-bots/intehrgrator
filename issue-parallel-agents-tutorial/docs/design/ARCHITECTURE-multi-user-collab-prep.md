# Architecture prep: human multi-user collaboration (post-v1)

**Status:** architecture-only · linked from Chunk 5.1 grill round 2 · **not implemented**

Chunk 5.1 ships **joint attributed history**, multi-agent MCP presence, and session unification for **single desktop session + parallel IDE agents**. This document records how that work **prepares** for later **human multi-user** editing without committing to CRDT/sync in 5.1.

**Related:**

- [`DESIGN-multi-agent-undo-crdt.md`](./DESIGN-multi-agent-undo-crdt.md) — undo/history feasibility, library evaluation
- [`TASKS-roadmap-chunks.md`](../historical-archive/TASKS-roadmap-chunks.md) — Chunk 14 (archived; track via GitHub Issues)

---

## Product placement

Human multi-user is a **late roadmap chunk** (after conversion scripts, persistence/i18n, and most mapping semantics). Chunk 5.1 only lays **seams** so Phase 2 does not require rewriting history or agent identity.

| Milestone | Scope |
|-----------|--------|
| **5.1 (now)** | Single session; multiple **agents**; semantic history; timeline UI; disk-backed history on desktop |
| **14 (future)** | Multiple **humans** (+ agents) on same project; CRDT/sync evaluation spike → production |

---

## Seams to implement in 5.1 (prep only)

### 1. History log as append-only event stream

- Each entry: `{ seq, revision, actor, summary, kind, beforeBundleRef, affectedSlotIds, blockGraphDelta? }`
- **Semantic kinds** only (see DESIGN doc): attach/detach/add/remove/expression/loop/optionalRm/import — not x/y drags
- Storage: in-memory + **desktop disk append** (SQLite or JSONL sidecar next to project); web warns before purge if memory-bound

### 2. Actor model

- `actor: { kind: "user" | "agent", id, displayName, color? }`
- Stable across MCP session; maps 1:1 to future **human peer id** when collab lands

### 3. Timeline API (MCP + HTTP)

- `GET /api/v1/history` — full timeline for scrubbing (read-only playback)
- `POST /api/v1/restore-at { seq, mode: "view" | "destructive" }` — view = temporary preview; destructive = confirm + rollback
- MCP tools mirror history list + restore-at for AI-assisted patch flows

### 4. Single document owner

- Unify UI `WorkbenchController` and `WorkbenchService` so revision/history is **one stream** — required before any sync provider attaches

### 5. Mapping Model as CRDT-ready boundary

- Keep authoritative mapping state in **`MappingModel.slots` / `loops` / `optionalRm`**
- `blocklyState` derived or synced after merge — do not CRDT the whole bundle in Phase 2

---

## Phase 2 evaluation criteria (when Chunk 14 starts)

Trigger **CRDT/sync spike** when any of:

- Two humans must edit the **same open project** concurrently (not just file handoff)
- Conflict rate on same `slotId` exceeds practical retry tolerance
- Offline edits on two devices must merge without manual bundle pick

**Library short-list** (do not reinvent): Automerge, Yjs (`Y.Map` for slots), Loro (movable tree for Blockly layout). See DESIGN doc comparison table.

**Provider options:** in-memory doc on desktop first; `y-websocket` / Automerge sync server only when second human peer joins.

---

## Explicitly out of scope for 5.1

- WebSocket room / presence server
- CRDT library dependency in production build
- Real-time cursor sharing between humans
- GitHub live co-editing

---

## Open decisions (for Chunk 14 grill)

1. Web app vs desktop-only for human collab?
2. Room per `projectId` vs per `.intehrgrator` file path?
3. Sidecar history file vs embedded in `.intehrgrator` zip?
4. Conflict UX: auto-merge slots vs always show merge report?
