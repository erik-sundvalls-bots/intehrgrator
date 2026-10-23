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

/**
 * stdio framing. MCP clients (Cursor, Claude Desktop, VS Code, the MCP SDK)
 * send one JSON-RPC message per line. Older callers of this server used
 * LSP-style `Content-Length` headers; both are read, and each reply uses the
 * framing of the message it answers.
 */
export type StdioFraming = "line" | "content-length";

export function encodeMessage(msg: unknown, framing: StdioFraming): Uint8Array {
  const body = JSON.stringify(msg);
  const encoder = new TextEncoder();
  if (framing === "line") return encoder.encode(`${body}\n`);
  return encoder.encode(`Content-Length: ${encoder.encode(body).length}\r\n\r\n${body}`);
}

function writeMessage(msg: unknown, framing: StdioFraming): void {
  const payload = encodeMessage(msg, framing);
  let offset = 0;
  while (offset < payload.length) {
    offset += Deno.stdout.writeSync(payload.subarray(offset));
  }
}

/**
 * Take complete messages off the front of `buffer` (bytes). Returns the
 * messages with their framing and the unconsumed rest.
 */
export function takeMessages(buffer: Uint8Array): {
  messages: Array<{ body: string; framing: StdioFraming }>;
  rest: Uint8Array;
} {
  const decoder = new TextDecoder();
  const messages: Array<{ body: string; framing: StdioFraming }> = [];
  let start = 0;
  while (start < buffer.length) {
    // Skip blank lines between messages.
    while (start < buffer.length && (buffer[start] === 0x0a || buffer[start] === 0x0d)) start++;
    if (start >= buffer.length) break;
    const rest = buffer.subarray(start);
    // A JSON message starts with "{"; a header frame with "Content-Length:".
    if (rest[0] === 0x43 || rest[0] === 0x63) {
      const text = decoder.decode(rest);
      const headerEnd = text.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const match = /Content-Length:\s*(\d+)/i.exec(text.slice(0, headerEnd));
      const headerBytes = new TextEncoder().encode(text.slice(0, headerEnd + 4)).length;
      if (!match) {
        start += headerBytes;
        continue;
      }
      const len = Number(match[1]);
      if (rest.length < headerBytes + len) break;
      messages.push({ body: decoder.decode(rest.subarray(headerBytes, headerBytes + len)), framing: "content-length" });
      start += headerBytes + len;
      continue;
    }
    const nl = rest.indexOf(0x0a);
    if (nl < 0) break;
    const line = decoder.decode(rest.subarray(0, nl)).trim();
    if (line) messages.push({ body: line, framing: "line" });
    start += nl + 1;
  }
  return { messages, rest: buffer.slice(start) };
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
    // A failed tool (409 lease holder, revision conflict, bad slot id) is a
    // tool result with isError, so the agent reads why and can react.
    try {
      const result = await client.callTool(name, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  }
  throw new Error(`Method not found: ${req.method}`);
}

async function handleRequest(req: JsonRpcRequest, client: AgentClient, framing: StdioFraming): Promise<void> {
  const id = req.id ?? null;
  const reply = (result: unknown) => writeMessage({ jsonrpc: "2.0", id, result }, framing);
  const replyError = (message: string) =>
    writeMessage({ jsonrpc: "2.0", id, error: { code: -32000, message } }, framing);

  try {
    if (req.method === "notifications/initialized") return;
    const result = await handleMcpRequest(req, client);
    if (req.id === undefined && req.method.startsWith("notifications/")) return;
    reply(result);
  } catch (e) {
    replyError(e instanceof Error ? e.message : String(e));
  }
}

/** Read MCP stdio messages (one JSON per line, or Content-Length frames) until stdin closes. */
export async function runMcpStdio(client: AgentClient): Promise<void> {
  let buffer: Uint8Array = new Uint8Array(0);
  for await (const chunk of Deno.stdin.readable) {
    const joined = new Uint8Array(buffer.length + chunk.length);
    joined.set(buffer);
    joined.set(chunk, buffer.length);
    const { messages, rest } = takeMessages(joined);
    buffer = rest;
    for (const { body, framing } of messages) {
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(body) as JsonRpcRequest;
      } catch {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, framing);
        continue;
      }
      await handleRequest(req, client, framing);
    }
  }
}

if (import.meta.main) {
  await runMcpStdio(createMcpAgentClient());
}
