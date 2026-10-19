/**
 * Desktop "local MCP" switch. The workbench keeps serving the page, Call AI,
 * and UI commits. Agent tool routes answer only while the switch is running.
 */

export interface LocalMcpControl {
  enabled: boolean;
}

export interface McpLaunch {
  command: string;
  args: string[];
}

export const LOCAL_MCP_STOPPED = "Local MCP server is stopped";

export function createLocalMcpControl(enabled = true): LocalMcpControl {
  return { enabled };
}

/** Compiled desktop binary speaks `--mcp`. A Deno checkout uses the stdio script. */
export function mcpClientCommand(execPath: string): McpLaunch {
  const base = execPath.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
  if (base.startsWith("deno")) {
    return { command: execPath, args: ["run", "-A", "src/agent/mcp_stdio.ts"] };
  }
  return { command: execPath, args: ["--mcp"] };
}

export function localMcpStaysUp(method: string, path: string): boolean {
  if (method === "GET" && path === "/health") return true;
  if (method === "POST" && (path === "/ui-commit" || path === "/ai-chat-completions" || path === "/ai-models")) return true;
  if (path === "/local-mcp") return true;
  return false;
}

export function localMcpStatusBody(options: {
  enabled: boolean;
  origin: string;
  token?: string;
  execPath: string;
}): {
  enabled: boolean;
  agentUrl: string;
  token: string;
  command: string;
  args: string[];
  mcpJson: {
    mcpServers: {
      intehrgrator: {
        command: string;
        args: string[];
        env: Record<string, string>;
      };
    };
  };
} {
  const launch = mcpClientCommand(options.execPath);
  const env: Record<string, string> = { INTEHR_AGENT_URL: options.origin };
  if (options.token) env.INTEHR_AGENT_TOKEN = options.token;
  return {
    enabled: options.enabled,
    agentUrl: options.origin,
    token: options.token ?? "",
    command: launch.command,
    args: launch.args,
    mcpJson: {
      mcpServers: {
        intehrgrator: {
          command: launch.command,
          args: launch.args,
          env,
        },
      },
    },
  };
}
