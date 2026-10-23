/**
 * HTTP Agent API — JSON over localhost for IDE agents and MCP bridge.
 * Agent operations are 1:1 with MCP tools (`callAgentTool` / `AGENT_TOOL_HTTP`).
 */

import { exportBundle } from "../core/persistence/mod.ts";
import type { ProjectBundle } from "../types/mod.ts";
import type { HistoryKind } from "../workbench/history.ts";
import { aiChatActor, type HistoryActor, USER_ACTOR } from "./actor.ts";
import {
  AgentRevisionConflictError,
  AgentSlotLeasedError,
  HumanEditedSlotError,
  WorkbenchService,
} from "../workbench/service.ts";
import { agentApiUnauthorized } from "./auth.ts";
import {
  createLocalMcpControl,
  LOCAL_MCP_STOPPED,
  localMcpStatusBody,
  localMcpStaysUp,
  type LocalMcpControl,
} from "./local_mcp.ts";
import {
  callAgentTool,
  findAgentToolForHttp,
  AGENT_TOOL_HTTP,
} from "./tools.ts";
import { forwardChatCompletionsProxy } from "../core/ai/credentials.ts";
import { forwardModelsProxy } from "../core/ai/models.ts";

export function createAgentApiHandler(
  service: WorkbenchService,
  options?: { token?: string; localMcp?: LocalMcpControl; execPath?: string },
): (req: Request) => Promise<Response> {
  const localMcp = options?.localMcp ?? createLocalMcpControl(true);
  const execPath = () => options?.execPath ?? Deno.execPath();
  return async (req) => {
    const denied = agentApiUnauthorized(req, options?.token);
    if (denied) return denied;

    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/v1/")) {
      return json({ error: "Not found" }, 404);
    }

    const path = url.pathname.slice("/api/v1".length) || "/";
    const revisionHeader = req.headers.get("If-Match") ?? undefined;

    try {
      if (path === "/local-mcp" && (req.method === "GET" || req.method === "POST")) {
        if (req.method === "POST") {
          const body = await req.json().catch(() => null) as { enabled?: unknown } | null;
          if (typeof body?.enabled !== "boolean") {
            return json({ error: "enabled must be a boolean" }, 400);
          }
          localMcp.enabled = body.enabled;
        }
        return json(localMcpStatusBody({
          enabled: localMcp.enabled,
          origin: url.origin,
          token: options?.token,
          execPath: execPath(),
        }));
      }

      if (!localMcp.enabled && !localMcpStaysUp(req.method, path)) {
        return json({ error: LOCAL_MCP_STOPPED }, 503);
      }

      if (req.method === "GET" && path === "/health") {
        return json({ ok: true, agent: "intehrgrator", version: 2 });
      }

      if (req.method === "GET" && path.startsWith("/history/") && path.endsWith("/preview")) {
        const seq = Number(path.split("/")[2]);
        const preview = service.history.previewAt(seq);
        if (!preview) return json({ error: "Unknown seq" }, 404);
        return json({ seq, bundle: preview });
      }

      if (req.method === "POST" && path === "/ai-chat-completions") {
        const body = await req.json().catch(() => null);
        return await forwardChatCompletionsProxy(body);
      }

      if (req.method === "POST" && path === "/ai-models") {
        const body = await req.json().catch(() => null);
        return await forwardModelsProxy(body);
      }

      if (req.method === "POST" && path === "/ui-commit") {
        const body = await req.json() as UiCommitBody;
        const result = service.commitFromUi(body.bundle, body.summary, body.kind ?? "expression", {
          actor: uiCommitActor(body.origin),
          baseRevision: typeof body.baseRevision === "string" ? body.baseRevision : undefined,
        });
        return json(result);
      }

      if (req.method === "POST" && path === "/export-discarded") {
        const body = await req.json() as { entries: Array<{ afterBundle: ProjectBundle }> };
        const bundles = body.entries?.map((e) => e.afterBundle) ?? [];
        if (!bundles.length) return json({ error: "No entries" }, 400);
        const last = bundles[bundles.length - 1]!;
        const bytes = exportBundle(last);
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="discarded-branch.intehrgrator"',
          },
        });
      }

      const tool = findAgentToolForHttp(req.method, path);
      if (!tool) return json({ error: "Not found" }, 404);

      const args = await argsFromHttpRequest(req, tool, url, revisionHeader);
      // Set the actor after the body is read, right before the call: two
      // agents' requests can interleave at that await.
      service.setActorFromHeaders(req.headers);
      const result = await callAgentTool(service, tool, args);
      return json(result);
    } catch (err) {
      if (err instanceof AgentRevisionConflictError) {
        return json({
          error: err.message,
          revision: err.currentRevision,
          expectedRevision: err.expectedRevision,
        }, 409);
      }
      if (err instanceof HumanEditedSlotError) {
        return json({ error: err.message, humanWins: true, slotIds: err.slotIds }, 409);
      }
      if (err instanceof AgentSlotLeasedError) {
        return json({
          error: err.message,
          holder: err.holder,
          ...(err.slotIds.length ? { slotIds: err.slotIds } : {}),
        }, 409);
      }
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 400);
    }
  };
}

async function argsFromHttpRequest(
  req: Request,
  tool: string,
  url: URL,
  revisionHeader: string | undefined,
): Promise<Record<string, unknown>> {
  const route = AGENT_TOOL_HTTP[tool];
  if (!route) return {};
  if (route.body === "text") {
    return { text: await req.text(), ...(revisionHeader ? { revision: revisionHeader } : {}) };
  }
  if (route.body === "none") {
    const args: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) args[key] = value;
    return args;
  }
  const parsed = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (revisionHeader && parsed.revision == null) parsed.revision = revisionHeader;
  return parsed;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

let sharedService: WorkbenchService | null = null;

export function getSharedWorkbenchService(): WorkbenchService {
  if (!sharedService) {
    const historyPath = Deno.env.get("INTEHR_HISTORY_PATH");
    sharedService = new WorkbenchService({ historyPath: historyPath ?? undefined });
  }
  return sharedService;
}

export function composeWorkbenchHandler(
  staticHandler: (req: Request) => Promise<Response>,
  enableAgentApi: boolean,
  options?: { token?: string; service?: WorkbenchService },
): (req: Request) => Promise<Response> {
  const token = options?.token ?? (Deno.env.get("INTEHR_AGENT_TOKEN")?.trim() || undefined);
  const service = options?.service ?? getSharedWorkbenchService();
  const agentHandler = createAgentApiHandler(service, { token });
  return async (req) => {
    if (enableAgentApi && new URL(req.url).pathname.startsWith("/api/v1/")) {
      return await agentHandler(req);
    }
    return await staticHandler(req);
  };
}

/** Body of `POST /ui-commit` (the open UI, never an MCP client). */
export interface UiCommitBody {
  bundle: ProjectBundle;
  summary: string;
  kind?: HistoryKind;
  /** Revision the UI last synced; see `WorkbenchService.commitFromUi`. */
  baseRevision?: string;
  /** Set for an AI chat turn; omitted for a person's edit. */
  origin?: { origin: "ai-chat"; provider?: string; model?: string; turnId?: string };
}

/** The UI can commit as the person or as its own AI chat, not as an MCP agent. */
export function uiCommitActor(origin: UiCommitBody["origin"]): HistoryActor {
  if (origin?.origin !== "ai-chat") return USER_ACTOR;
  const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined;
  return aiChatActor({ provider: str(origin.provider), model: str(origin.model), turnId: str(origin.turnId) });
}
