import { colorFromAgentId } from "./actor.ts";

export interface RegisteredAgent {
  agentId: string;
  displayName: string;
  color: string;
  registeredAt: string;
}

/**
 * Distinct colours for agents in registration order (white text on them is
 * readable), so two or three parallel agents never look alike on the canvas.
 * Hashing the id could give two agents nearly the same hue.
 */
export const AGENT_PALETTE = ["#1f6fb4", "#c62828", "#2e7d32", "#8e44ad", "#c75c00", "#00838f", "#6d4c41", "#ad1457"];

export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();
  private seq = 0;

  register(options?: { agentId?: string; displayName?: string; color?: string }): RegisteredAgent {
    const agentId = options?.agentId?.trim() || `agent-${++this.seq}-${crypto.randomUUID().slice(0, 8)}`;
    const displayName = this.uniqueName(options?.displayName?.trim() || agentId, agentId);
    const color = options?.color?.trim() || this.existingColor(agentId) || this.nextColor(agentId);
    const entry: RegisteredAgent = {
      agentId,
      displayName,
      color,
      registeredAt: new Date().toISOString(),
    };
    this.agents.set(agentId, entry);
    return entry;
  }

  /** Two agents never share a name (two chats in one IDE both say "cursor"): "cursor", "cursor 2", … */
  private uniqueName(name: string, agentId: string): string {
    const taken = new Set([...this.agents.values()].filter((a) => a.agentId !== agentId).map((a) => a.displayName));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`)) n++;
    return `${name} ${n}`;
  }

  private existingColor(agentId: string): string | undefined {
    return this.agents.get(agentId)?.color;
  }

  private nextColor(agentId: string): string {
    const used = new Set([...this.agents.values()].map((a) => a.color));
    return AGENT_PALETTE.find((c) => !used.has(c)) ?? colorFromAgentId(agentId);
  }

  get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  list(): RegisteredAgent[] {
    return [...this.agents.values()];
  }
}
