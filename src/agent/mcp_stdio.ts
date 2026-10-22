/**
 * MCP stdio server — proxies to desktop Agent API when INTEHR_AGENT_URL is set,
 * otherwise uses an embedded WorkbenchService (file-based workflow).
 */

import { getSharedWorkbenchService } from "./http.ts";
import { APP_VERSION } from "../core/persistence/mod.ts";
import { AGENT_TOOLS } from "./tools.ts";
import { type AgentClient, HttpAgentClient, LocalAgentClient as BaseLocalAgentClient } from "./client.ts";
import type { WorkbenchService } from "../workbench/service.ts";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export { type AgentClient, HttpAgentClient } from "./client.ts";

/** In-process client on the embedded (or shared desktop) WorkbenchService. */
export class LocalAgentClient extends BaseLocalAgentClient {
  constructor(service: WorkbenchService = getSharedWorkbenchService()) {
    super(service);
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
