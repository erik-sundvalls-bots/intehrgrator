/**
 * The in-app AI chat's tool list (ADR 0014). The OpenAI `tools` schemas are
 * derived from `AGENT_TOOLS`, and the chat runs them with `callAgentTool` on a
 * `WorkbenchService`, so the chat and an IDE on the MCP server share one tool
 * surface and one write path. The chat only gets the mapping tools; loading
 * files, bundles, history and leases stay with MCP / the Agent API.
 */
import { AGENT_TOOLS } from "../../agent/tools.ts";
import type { OpenAiTool } from "./credentials.ts";

export { GET_EXAMPLE_DEFAULT_CHARS, GET_EXAMPLE_MAX_CHARS } from "../../agent/inspect.ts";

export const CALL_AI_TOOL_NAMES = [
  "get_snapshot",
  "list_slots",
  "get_slot",
  "get_source_tree",
  "get_sheets",
  "get_product_stack",
  "list_optional_rm",
  "list_constraint_warnings",
  "import_suggestions",
  "map_slot",
  "optional_rm_add",
  "optional_rm_remove",
  "replace_sheets",
  "set_active_example",
  "run_test",
  "list_examples",
  "get_example",
] as const;

export type CallAiToolName = typeof CALL_AI_TOOL_NAMES[number];

const MUTATING = new Set<string>([
  "import_suggestions",
  "map_slot",
  "optional_rm_add",
  "optional_rm_remove",
  "replace_sheets",
  "set_active_example",
]);

/** True for chat tools that change the project (attributed to the AI, revertible). */
export function isMutatingCallAiTool(name: string): boolean {
  return MUTATING.has(name);
}

export function isCallAiToolName(name: string): name is CallAiToolName {
  return (CALL_AI_TOOL_NAMES as readonly string[]).includes(name);
}

let cached: OpenAiTool[] | null = null;

/** OpenAI function tools for the chat, from `AGENT_TOOLS` (without the MCP-only `revision`). */
export function mappingAgentOpenAiTools(): OpenAiTool[] {
  if (cached) return cached;
  cached = CALL_AI_TOOL_NAMES.map((name) => {
    const tool = AGENT_TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`AI chat tool ${name} is missing from AGENT_TOOLS`);
    const schema = structuredClone(tool.inputSchema) as {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
    };
    if (schema.properties) delete schema.properties.revision;
    return {
      type: "function" as const,
      function: {
        name,
        description: tool.description,
        parameters: { type: "object", properties: schema.properties ?? {}, ...(schema.required ? { required: schema.required } : {}) },
      },
    };
  });
  return cached;
}
