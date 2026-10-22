/**
 * MCP stdio server — proxies to desktop Agent API when INTEHR_AGENT_URL is set,
 * otherwise uses an embedded WorkbenchService (file-based workflow).
 */

import { getSharedWorkbenchService } from "./http.ts";
import { APP_VERSION } from "../core/persistence/mod.ts";
import { AGENT_TOOLS, AGENT_TOOL_HTTP, callAgentTool } from "./tools.ts";
import type { WorkbenchService } from "../workbench/service.ts";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
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

  setClientName(name: string): void {
    this.clientName = name.trim().slice(0, 80);
  }

  constructor(private readonly service: WorkbenchService = getSharedWorkbenchService()) {}

  async registerAgent(args: Record<string, unknown>) {
    const reg = await callAgentTool(this.service, "register_agent", args) as {
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
    if (this.session) this.service.setActor(this.sessionActor(this.session));
    return await callAgentTool(this.service, name, this.actorArgs(args));
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
  ) {}

  async registerAgent(args: Record<string, unknown>) {
    const json = await this.request("POST", "/api/v1/register-agent", args) as {
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
    if (!res.ok) throw new Error(JSON.stringify(json));
    return json;
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "register_agent") return this.registerAgent(args);
    const route = AGENT_TOOL_HTTP[name];
    if (!route) return Promise.reject(new Error(`Unknown tool: ${name}`));
    const revision = args.revision as string | undefined;
    const rest = { ...args };
    delete rest.revision;
    delete rest._agentId;
    delete rest._agentName;
    delete rest._agentColor;

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

export function createMcpAgentClient(): AgentClient {
  const base = Deno.env.get("INTEHR_AGENT_URL");
  if (base) {
    return new HttpAgentClient(
      base.replace(/\/$/, ""),
      Deno.env.get("INTEHR_AGENT_TOKEN")?.trim() || undefined,
    );
  }
  return new LocalAgentClient(getSharedWorkbenchService());
}

function writeMessage(msg: unknown): void {
  const body = JSON.stringify(msg);
  const payload = new TextEncoder().encode(
    `Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`,
  );
  let offset = 0;
  while (offset < payload.length) {
    offset += Deno.stdout.writeSync(payload.subarray(offset));
  }
}

export async function handleMcpRequest(req: JsonRpcRequest, client: AgentClient): Promise<unknown> {
  if (req.method === "initialize") {
    const clientName = (req.params as { clientInfo?: { name?: unknown } } | undefined)?.clientInfo?.name;
    if (typeof clientName === "string" && clientName.trim()) client.setClientName?.(clientName);
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "intehrgrator", version: APP_VERSION },
    };
  }
  if (req.method === "notifications/initialized") return undefined;
  if (req.method === "tools/list") {
    return { tools: AGENT_TOOLS };
  }
  if (req.method === "tools/call") {
    const params = req.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const result = await client.callTool(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Method not found: ${req.method}`);
}

async function handleRequest(req: JsonRpcRequest, client: AgentClient): Promise<void> {
  const id = req.id ?? null;
  const reply = (result: unknown) => writeMessage({ jsonrpc: "2.0", id, result });
  const replyError = (message: string) =>
    writeMessage({ jsonrpc: "2.0", id, error: { code: -32000, message } });

  try {
    if (req.method === "notifications/initialized") return;
    const result = await handleMcpRequest(req, client);
    if (req.id === undefined && req.method.startsWith("notifications/")) return;
    reply(result);
  } catch (e) {
    replyError(e instanceof Error ? e.message : String(e));
  }
}

/** Read MCP stdio frames until stdin closes. */
export async function runMcpStdio(client: AgentClient): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) break;
      const body = buffer.slice(bodyStart, bodyStart + len);
      buffer = buffer.slice(bodyStart + len);
      await handleRequest(JSON.parse(body) as JsonRpcRequest, client);
    }
  }
}

if (import.meta.main) {
  await runMcpStdio(createMcpAgentClient());
}
