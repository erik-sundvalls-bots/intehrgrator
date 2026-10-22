/** Run an AI chat tool the way the web app does (ADR 0014): `callAgentTool` on a service around `controller`. */
import { LocalAgentClient } from "@intehrgrator/agent/client.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import type { WorkbenchController } from "@intehrgrator/workbench/controller.ts";

const clients = new WeakMap<WorkbenchController, LocalAgentClient>();

export function chatClientFor(controller: WorkbenchController): LocalAgentClient {
  let client = clients.get(controller);
  if (!client) {
    client = new LocalAgentClient(new WorkbenchService({ controller }));
    clients.set(controller, client);
  }
  return client;
}

export function runChatTool(controller: WorkbenchController, name: string, args: Record<string, unknown>): Promise<unknown> {
  return chatClientFor(controller).callTool(name, args);
}
