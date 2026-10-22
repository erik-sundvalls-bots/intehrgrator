/**
 * Desktop bridge between the open UI and the Agent API session (ADR 0014).
 *
 * - Every semantic UI change is committed to the shared history right away
 *   (`commitUiChange`), as the person or as the in-app AI chat, before any
 *   agent change is pulled in. Earlier only Blockly-originated edits were
 *   committed, so a Click-to-Map / AI chat / import change could be lost under
 *   the next MCP sync.
 * - An agent change pulled from the session is handed to `applyRemote`, which
 *   the UI wraps as one undo step.
 */

import type { WorkbenchController } from "../workbench/controller.ts";
import type { ProjectBundle } from "../types/mod.ts";

export interface AgentBridgeOptions {
  controller: WorkbenchController;
  onActivity?: (activity: AgentActivityPayload | null) => void;
  /**
   * Commit any local change the session has not seen yet (called before a
   * sync). Resolves when the commit is done.
   */
  flushLocal: () => Promise<void>;
  /** First poll found the UI and the session as they are: take the UI document as the baseline. */
  onBaseline: () => void;
  /**
   * Apply a bundle an agent wrote. `initial` is the first load into an empty
   * UI. Return false to skip it (a local edit arrived meanwhile; the next poll
   * commits it first and pulls again).
   */
  applyRemote: (bundle: ProjectBundle, initial: boolean) => Promise<boolean> | boolean;
}

export interface AgentActivityPayload {
  agentId: string;
  displayName: string;
  color: string;
  summary: string;
  affectedSlotIds: string[];
}

/** Origin the UI may claim for a commit; a person's edit sends none. */
export interface UiCommitOrigin {
  origin: "ai-chat";
  provider?: string;
  model?: string;
  turnId?: string;
}

export interface UiCommitResult {
  revision: string;
  overwritten: Array<{ seq: number; actor: string; summary: string }>;
}

/** Last session revision the UI has seen (synced or committed). */
let syncedRevision = "";
/** False until the first successful poll: nothing is committed before the UI knows the session. */
let bridgeSynced = false;

export function isAgentBridgeSynced(): boolean {
  return bridgeSynced;
}
let commitChain: Promise<unknown> = Promise.resolve();

/**
 * 404 means this server has no Agent API (stop polling).
 * 503 is the local MCP switch turned off — pause sync and keep polling.
 * Any other non-success also pauses so a blip does not drop the bridge.
 */
export function agentPollDisposition(status: number): "sync" | "pause" | "stop" {
  if (status === 404) return "stop";
  if (status >= 200 && status < 300) return "sync";
  return "pause";
}

export function isDesktopEnvironment(): boolean {
  return Boolean(
    (globalThis as unknown as { __INTEHR_DESKTOP__?: boolean }).__INTEHR_DESKTOP__,
  );
}

/**
 * Push one semantic UI change to the shared history. Commits are serialised;
 * each carries the revision the UI last saw, so the session can report agent
 * changes this commit replaced.
 */
export function commitUiChange(
  bundle: ProjectBundle,
  summary: string,
  options: { kind?: "expression" | "block_graph" | "undo" | "redo" | "revert"; origin?: UiCommitOrigin } = {},
): Promise<UiCommitResult | null> {
  if (!isDesktopEnvironment()) return Promise.resolve(null);
  const run = async (): Promise<UiCommitResult | null> => {
    try {
      const res = await fetch("/api/v1/ui-commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bundle,
          summary,
          kind: options.kind ?? "expression",
          ...(syncedRevision ? { baseRevision: syncedRevision } : {}),
          ...(options.origin ? { origin: options.origin } : {}),
        }),
      });
      if (!res.ok) return null;
      const result = await res.json() as UiCommitResult;
      if (result.revision) syncedRevision = result.revision;
      return { revision: result.revision, overwritten: result.overwritten ?? [] };
    } catch {
      return null;
    }
  };
  const next = commitChain.then(run, run);
  commitChain = next;
  return next;
}

/** Resolves once every commit queued so far has finished. */
export function commitsSettled(): Promise<void> {
  return commitChain.then(() => {}, () => {});
}

export function installAgentBridge(options: AgentBridgeOptions): void {
  if (typeof globalThis.fetch !== "function") return;
  if (!isDesktopEnvironment()) return;

  const { controller, onActivity, flushLocal, applyRemote, onBaseline } = options;
  let polled = false;
  let syncing = false;
  let lastActivityAt = "";
  let pollTimer: number | null = null;

  const poll = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const snapRes = await fetch("/api/v1/snapshot");
      const disposition = agentPollDisposition(snapRes.status);
      if (disposition === "stop") {
        if (pollTimer !== null) {
          globalThis.clearInterval(pollTimer);
          pollTimer = null;
        }
        return;
      }
      if (disposition === "pause") return;
      const snap = await snapRes.json() as { revision: string; templateId?: string };
      const isFirstPoll = !polled;
      polled = true;
      const uiEmpty = !controller.getState().templateId;
      if (isFirstPoll) {
        if (snap.templateId && uiEmpty) {
          await pullBundle(true);
        } else {
          syncedRevision = snap.revision;
          onBaseline();
        }
        bridgeSynced = true;
      } else {
        // Local edits first, so an agent change is applied on top of them.
        await flushLocal();
        await commitsSettled();
        const current = await fetch("/api/v1/snapshot");
        if (current.ok) {
          const now = await current.json() as { revision: string };
          if (now.revision !== syncedRevision) await pullBundle(false);
        }
      }

      const actRes = await fetch("/api/v1/activity");
      if (actRes.ok) {
        const { activity } = await actRes.json() as { activity: AgentActivityPayload & { at?: string } | null };
        if (activity && activity.at !== lastActivityAt) {
          lastActivityAt = activity.at ?? "";
          onActivity?.(activity);
        }
      }
    } catch {
      // Agent API not enabled
    } finally {
      syncing = false;
    }
  };

  async function pullBundle(initial: boolean): Promise<void> {
    const bundleRes = await fetch("/api/v1/bundle");
    if (!bundleRes.ok) return;
    const payload = await bundleRes.json() as { revision: string; bundle: ProjectBundle };
    if (await applyRemote(payload.bundle, initial)) syncedRevision = payload.revision;
  }

  pollTimer = globalThis.setInterval(() => void poll(), 1500);
}
