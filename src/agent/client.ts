/**
 * Agent tool clients shared by stdio MCP and the in-app AI chat (ADR 0014):
 * one `callTool` surface over a WorkbenchService, in process or over the
 * desktop HTTP Agent API. Browser-safe (no stdio, no server).
 */
import { AGENT_TOOL_HTTP, callAgentTool } from "./tools.ts";
import type { WorkbenchService } from "../workbench/service.ts";
import { type HistoryActor, USER_ACTOR } from "./actor.ts";

/** Fixed agent identity for an MCP process (`INTEHR_AGENT_ID` / `INTEHR_AGENT_NAME`, #312). */
export interface AgentIdentity {
  agentId?: string;
  displayName?: string;
}

export interface AgentClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  registerAgent?(args: Record<string, unknown>): Promise<{ agentId: string; displayName: string; color: string }>;
  /** MCP `initialize` `clientInfo.name` (e.g. "cursor"), recorded as the history origin client. */
  setClientName?(name: string): void;
}

export class LocalAgentClient implements AgentClient {
  private session: { agentId: string; displayName: string; color: string } | null = null;
  private clientName = "";
  /** Fixed actor for every call (the in-app AI chat); overrides the MCP session. */
  private actor: HistoryActor | null = null;

  constructor(private readonly service: WorkbenchService, private readonly identity?: AgentIdentity) {}

  setClientName(name: string): void {
    this.clientName = name.trim().slice(0, 80);
  }

  /** Attribute every following call to `actor` (null: back to the MCP session / the user). */
  setActor(actor: HistoryActor | null): void {
    this.actor = actor;
  }

  async registerAgent(args: Record<string, unknown>) {
    const reg = await callAgentTool(this.service, "register_agent", withIdentity(args, this.identity)) as {
      agentId: string;
      displayName: string;
      color: string;
    };
    this.session = reg;
    this.service.setActor(this.sessionActor(reg));
    return reg;
  }

  private sessionActor(reg: { agentId: string; displayName: string; color: string }) {
    return {
      kind: "agent" as const,
      id: reg.agentId,
      displayName: reg.displayName,
      color: reg.color,
      origin: "mcp" as const,
      ...(this.clientName ? { client: this.clientName } : {}),
    };
  }

  private actorArgs(args: Record<string, unknown>): Record<string, unknown> {
    const client = this.clientName ? { _agentClient: this.clientName } : {};
    if (!this.session) return { ...args, ...client };
    return {
      ...args,
      _agentId: this.session.agentId,
      _agentName: this.session.displayName,
      _agentColor: this.session.color,
      ...client,
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "register_agent") return await this.registerAgent(args);
    if (this.actor) {
      // Pass the actor into the call. Reset the shared field afterwards so a
      // later call with no actor is the person (#317).
      this.service.setActor(this.actor);
      try {
        return await callAgentTool(this.service, name, args, { actor: this.actor });
      } finally {
        this.service.setActor(USER_ACTOR);
      }
    }
    if (!this.session && this.identity?.agentId) {
      await this.registerAgent({ displayName: this.identity.displayName || this.clientName || undefined });
    }
    const actor = this.session ? this.sessionActor(this.session) : undefined;
    if (actor) this.service.setActor(actor);
    return await callAgentTool(this.service, name, this.actorArgs(args), actor ? { actor } : undefined);
  }
}

export class HttpAgentClient implements AgentClient {
  private session: { agentId: string; displayName: string; color: string } | null = null;
  private clientName = "";

  setClientName(name: string): void {
    this.clientName = name.trim().slice(0, 80);
  }

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly identity?: AgentIdentity,
  ) {}

  async registerAgent(args: Record<string, unknown>) {
    // Registering again (after the automatic registration on the first write)
    // renames this agent instead of creating a second one.
    const body = this.session && !args.agentId
      ? { ...args, agentId: this.session.agentId }
      : withIdentity(args, this.identity);
    const json = await this.request("POST", "/api/v1/register-agent", body) as {
      agentId: string;
      displayName: string;
      color: string;
    };
    this.session = json;
    return json;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    revision?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = typeof body === "string" ? "text/plain; charset=utf-8" : "application/json";
    }
    if (revision) headers["If-Match"] = revision;
    if (this.session) {
      headers["X-Agent-Id"] = this.session.agentId;
      headers["X-Agent-Name"] = this.session.displayName;
      headers["X-Agent-Color"] = this.session.color;
    }
    if (this.clientName) headers["X-Agent-Client"] = this.clientName;
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      // The message first (an agent reads it), then the details (holder, revision).
      const { error, ...rest } = json as { error?: string };
      throw new Error(error ? `${error}${Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ""}` : JSON.stringify(json));
    }
    return json;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "register_agent") return await this.registerAgent(args);
    const route = AGENT_TOOL_HTTP[name];
    if (!route) throw new Error(`Unknown tool: ${name}`);
    // Each MCP process (one IDE chat / agent) is its own agent: register on the
    // first write or lease when the agent did not, so two chats from the same
    // IDE get separate leases, names and colours instead of sharing "MCP: cursor".
    if (!this.session && route.method !== "GET") {
      await this.registerAgent({ displayName: this.identity?.displayName || this.clientName || "MCP agent" });
    }
    const revision = args.revision as string | undefined;
    const rest = { ...args };
    delete rest.revision;
    delete rest._agentId;
    delete rest._agentName;
    delete rest._agentColor;
    delete rest._agentClient;

    if (route.method === "GET") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(rest)) {
        if (value == null || value === "") continue;
        params.set(key, String(value));
      }
      const query = params.toString();
      return this.request("GET", `/api/v1${route.path}${query ? `?${query}` : ""}`, undefined, revision);
    }
    if (route.body === "text") {
      return this.request("POST", `/api/v1${route.path}`, String(args.text ?? ""), revision);
    }
    if (route.body === "none") {
      return this.request(route.method, `/api/v1${route.path}`, {}, revision);
    }
    return this.request(route.method, `/api/v1${route.path}`, rest, revision);
  }
}

/**
 * register_agent arguments with the process identity filled in: the fixed
 * agentId (so a new MCP process keeps the same agent, colour and history
 * attribution) and the name when the call gives none.
 */
function withIdentity(args: Record<string, unknown>, identity?: AgentIdentity): Record<string, unknown> {
  if (!identity) return args;
  return {
    ...args,
    ...(identity.agentId && !args.agentId ? { agentId: identity.agentId } : {}),
    ...(identity.displayName && !args.displayName ? { displayName: identity.displayName } : {}),
  };
}
