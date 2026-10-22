/** Actor identity for attributed history (user or registered MCP agent). */

/**
 * Where a history entry came from (ADR 0014): a person in the UI, the in-app
 * AI chat, or an MCP / Agent API client.
 */
export type ChangeOrigin = "human" | "ai-chat" | "mcp";

export interface HistoryActor {
  kind: "user" | "agent";
  id: string;
  displayName: string;
  color?: string;
  /** Missing on entries written before ADR 0014: read with `actorOrigin`. */
  origin?: ChangeOrigin;
  /** MCP client name (`clientInfo.name` from `initialize`, or `X-Agent-Client`). */
  client?: string;
  /** AI chat provider id and model. */
  provider?: string;
  model?: string;
  /** Groups the entries of one AI chat turn. */
  turnId?: string;
}

export const USER_ACTOR: HistoryActor = {
  kind: "user",
  id: "user",
  displayName: "You",
  origin: "human",
};

export const AI_CHAT_ACTOR_ID = "ai-chat";
export const AI_CHAT_COLOR = "hsl(275 55% 45%)";

export function actorOrigin(actor: Pick<HistoryActor, "kind" | "origin">): ChangeOrigin {
  if (actor.origin) return actor.origin;
  return actor.kind === "user" ? "human" : "mcp";
}

export function aiChatActor(options: { provider?: string; model?: string; turnId?: string } = {}): HistoryActor {
  const model = options.model?.trim() || undefined;
  const displayName = options.provider === "copy-paste"
    ? "AI (pasted answer)"
    : model
    ? `AI chat (${model})`
    : "AI chat";
  return {
    kind: "agent",
    id: AI_CHAT_ACTOR_ID,
    displayName,
    color: AI_CHAT_COLOR,
    origin: "ai-chat",
    ...(options.provider ? { provider: options.provider } : {}),
    ...(model ? { model } : {}),
    ...(options.turnId ? { turnId: options.turnId } : {}),
  };
}

export function actorFromHeaders(headers: Headers): HistoryActor {
  const agentId = headers.get("X-Agent-Id")?.trim();
  const agentName = headers.get("X-Agent-Name")?.trim();
  const client = headers.get("X-Agent-Client")?.trim() || undefined;
  if (agentId) {
    return {
      kind: "agent",
      id: agentId,
      displayName: agentName || agentId,
      color: headers.get("X-Agent-Color")?.trim() || undefined,
      origin: "mcp",
      ...(client ? { client } : {}),
    };
  }
  // An MCP client that never called register_agent is still not the user.
  if (client) return mcpClientActor(client);
  return USER_ACTOR;
}

export function mcpClientActor(client: string): HistoryActor {
  const id = `mcp:${client}`;
  return { kind: "agent", id, displayName: `MCP: ${client}`, color: colorFromAgentId(id), origin: "mcp", client };
}

export function colorFromAgentId(agentId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 65% 45%)`;
}
