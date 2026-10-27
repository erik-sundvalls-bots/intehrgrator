/**
 * Shared Agent API / MCP tool dispatch. HTTP routes and stdio MCP call the same names.
 */

import { applySuggestionReviewDefaults, parseAiConfidence, slotReviewFrom, TOOL_REVIEW_PARAMS } from "../core/ai/mod.ts";
import { isSourceFormatId } from "../core/source/format_handler.ts";
import { filterSlotRows, getExampleInspect, listExamplesInspect } from "./inspect.ts";
import { basename, dirname, resolve, toFileUrl } from "@std/path";
import { ensureDir } from "@std/fs";
import type { MutationContext, WorkbenchService } from "../workbench/service.ts";
import { mcpClientActor } from "./actor.ts";
import type { ConversionScriptLanguage, SourceFormatId } from "../types/mod.ts";
import { isConversionScriptLanguage, isInstanceEncoding, isOutputMode } from "../types/mod.ts";
import { exportBundle } from "../core/persistence/mod.ts";
import type { ProjectBundle } from "../types/mod.ts";
import type { SheetDocument } from "../core/sheets/mod.ts";
import { parseExampleSetCatalog } from "../core/example_sets/mod.ts";
import {
  BUNDLED_FUNCTION_LIBRARY_PATH,
  DEFAULT_GITHUB_FUNCTION_LIBRARY_URL,
  functionBundleFromUnknown,
  loadFunctionLibraryCatalog,
  loadFunctionLibraryEntry,
  parseFunctionBundle,
  type FunctionBundle,
  type FunctionLibraryCatalog,
} from "../core/function_library/mod.ts";
import { toFetchableUrl } from "../host/fetch_url.ts";

export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "register_agent",
    description: "Register MCP session; returns agentId, displayName, color for this agent.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        displayName: { type: "string" },
        color: { type: "string" },
      },
    },
  },
  {
    name: "get_snapshot",
    description: "Project revision, template id, mapped counts, unmapped mandatory slot ids, sheets, product stack, leases, Constraint warning count, test status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_slots",
    description:
      "Target value slots as the compact slot tree: groups (repeating container with loop: true, or archetype / parent node) with rows {id, type, label, mult, mandatory, fixed, units, values, expr when mapped}. A slot id is group + row id; full ids work too. Filter with unmappedOnly and/or query (substring of slot id, label or path label). view: \"rows\" returns the older flat rows with full slotId, pathLabel, attachSlotId plus repeatable containers. get_slot gives one slot in full.",
    inputSchema: {
      type: "object",
      properties: {
        unmappedOnly: { type: "boolean" },
        query: { type: "string" },
        view: { type: "string", enum: ["tree", "rows"] },
      },
    },
  },
  {
    name: "get_slot",
    description:
      "One Target slot in full: id (any form from list_slots / the slot tree), documentation, all value set entries and ordinals, fixed values, the constraint from the target file (JSON Schema subschema, XSD element/attribute, template node), current mapping and lease.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "list_examples",
    description: "Example instances (id, filename, format, size, active) without bodies.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_example",
    description:
      "Read an example instance: id (default: Active Example), optional path (source path; returns that subtree with values, Active Example only), maxChars (default 8000, max 40000).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, path: { type: "string" }, maxChars: { type: "number" } },
    },
  },
  {
    name: "get_source_tree",
    description:
      "Compact Source Schema and Active Example trees (paths for Click-to-Map / source_query), with each node's full description. descriptionLanguage is the language of the descriptions (source.lang.1 when the schema has it); a node has lang only when its text is in another language. sourceLanguages / schemaLanguages list the source's languages; pass language (e.g. \"en\") for the descriptions in another schema language.",
    inputSchema: {
      type: "object",
      properties: { language: { type: "string", description: "ISO 639-1 code of one of schemaLanguages" } },
    },
  },
  {
    name: "get_sheets",
    description: "Named Sheets and Decision tables (summaries plus full grid documents).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_product_stack",
    description: "Instance roots under Conversion start, with Instance encoding and product-stack loops.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_optional_rm",
    description: "Optional RM Insertion catalog. Pass parentSlotId to inspect one container.",
    inputSchema: { type: "object", properties: { parentSlotId: { type: "string" } } },
  },
  {
    name: "list_constraint_warnings",
    description: "Constraint warnings: unmapped mandatory slots, Decision table lint, abstract EVENT / ITEM_STRUCTURE.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_history",
    description: "Attributed semantic history timeline.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_activity",
    description: "Latest agent activity highlight + registered agents.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_bundle",
    description: "Full Project Bundle JSON plus revision.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "load_bundle",
    description: "Load a Project Bundle from JSON, zip path, bytesBase64, or an unwrapped bundle object.",
    inputSchema: {
      type: "object",
      properties: {
        bundle: { type: "object" },
        path: { type: "string" },
        bytesBase64: { type: "string" },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "load_target",
    description: "Load a Target instance format (OPT, Web Template, JSON/XML Schema, free-form) from content, path, or url.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" },
        path: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "load_source_schema",
    description: "Load Source Schema from content, path, or url.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" },
        path: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "add_example",
    description: "Add an Example Instance from content, path, or url.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" },
        path: { type: "string" },
        url: { type: "string" },
      },
    },
  },
  {
    name: "load_example_set",
    description:
      "Load a catalogued Example Set (target, Source Schema, instances, optional mapping/defaults) from a local catalogPath or catalogUrl.",
    inputSchema: {
      type: "object",
      required: ["setId"],
      properties: {
        setId: { type: "string" },
        catalogPath: { type: "string" },
        catalogUrl: { type: "string" },
        includeMapping: { type: "boolean" },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "list_function_library",
    description:
      "List curated Blockly Functions from the Function library catalog (id, title, description, parameters, Decision tables). Default catalog is the in-repo function-library/ when present.",
    inputSchema: {
      type: "object",
      properties: {
        catalogPath: { type: "string" },
        catalogUrl: { type: "string" },
      },
    },
  },
  {
    name: "load_function",
    description:
      "Merge a Blockly Function onto the current canvas (definition + Decision tables) without replacing unrelated blocks. Prefer this over put_blockly. clash defaults to rename.",
    inputSchema: {
      type: "object",
      properties: {
        functionId: { type: "string" },
        catalogPath: { type: "string" },
        catalogUrl: { type: "string" },
        path: { type: "string" },
        bundle: { type: "object" },
        clash: { enum: ["rename", "replace"] },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "set_active_example",
    description: "Select the Active Example by id from get_source_tree.examples.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "replace_sheets",
    description: "Replace project Sheet / Decision table documents (full grid JSON).",
    inputSchema: {
      type: "object",
      required: ["sheets"],
      properties: { sheets: { type: "array" }, revision: { type: "string" } },
    },
  },
  {
    name: "build_prompt",
    description: "Build Copy AI Prompt markdown (intehrgrator-suggestions response format).",
    inputSchema: {
      type: "object",
      properties: {
        delivery: { enum: ["inline", "attach", "uri"] },
        scope: { enum: ["full", "slot"] },
        slotId: { type: "string" },
      },
    },
  },
  {
    name: "build_patch_prompt",
    description: "Prompt to produce intehrgrator-suggestions patch undo for history seq.",
    inputSchema: {
      type: "object",
      required: ["targetSeq"],
      properties: { targetSeq: { type: "number" } },
    },
  },
  {
    name: "import_suggestions",
    description:
      "Apply intehrgrator-suggestions JSON envelope. Per-suggestion note/confidence are honoured; call-level note/confidence apply to suggestions without their own.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" }, revision: { type: "string" }, ...TOOL_REVIEW_PARAMS },
    },
  },
  {
    name: "map_slot",
    description: "Map a source path to a target value slotId. Optional note (risks only) and confidence (0–100 %).",
    inputSchema: {
      type: "object",
      required: ["slotId", "path"],
      properties: {
        slotId: { type: "string" },
        path: { type: "string" },
        format: { type: "string" },
        revision: { type: "string" },
        ...TOOL_REVIEW_PARAMS,
      },
    },
  },
  {
    name: "optional_rm_add",
    description: "Optional RM Insertion: add an RM-optional attribute mouth on a parent slot.",
    inputSchema: {
      type: "object",
      required: ["parentSlotId", "rmType", "attributeName"],
      properties: {
        parentSlotId: { type: "string" },
        rmType: { type: "string" },
        attributeName: { type: "string" },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "optional_rm_remove",
    description: "Remove an Optional RM Insertion from a parent slot.",
    inputSchema: {
      type: "object",
      required: ["parentSlotId", "attributeName"],
      properties: {
        parentSlotId: { type: "string" },
        attributeName: { type: "string" },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "set_instance_encoding",
    description: "Set Instance encoding on a Product stack Instance root (0-based index among encoding-capable roots).",
    inputSchema: {
      type: "object",
      required: ["encoding"],
      properties: {
        encoding: { type: "string" },
        rootIndex: { type: "number" },
        revision: { type: "string" },
      },
    },
  },
  {
    name: "lease_slot",
    description:
      "Advisory lease while this agent works (S-15): on one Target value slotId, or with subtree: true on a node path (a slotId prefix from list_slots, e.g. …//context/EVENT_CONTEXT) covering every slot below it. Other MCP agents then cannot change what it covers (their writes, undo and revert there fail with the holder); the person in the UI sees the lease on the canvas and is asked before changing what it covers, but may go ahead; if they do, your next write to such a slot fails once (the person wins), so read it again. Fails when it overlaps another agent's lease. Renew by calling again before ttlSec (default 120, max 3600) runs out. Call register_agent first so the lease shows your name and colour.",
    inputSchema: {
      type: "object",
      required: ["slotId"],
      properties: {
        slotId: { type: "string", description: "Value slot id, or a node path with subtree: true" },
        subtree: { type: "boolean" },
        ttlSec: { type: "number" },
      },
    },
  },
  {
    name: "release_slot",
    description: "Release a lease this agent holds (slotId, as leased), or all: true for every lease this agent holds. Release when done.",
    inputSchema: {
      type: "object",
      properties: { slotId: { type: "string" }, subtree: { type: "boolean" }, all: { type: "boolean" } },
    },
  },
  {
    name: "list_leases",
    description: "List active leases: slotId (or node path when subtree), holder name, colour and expiry.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_test",
    description:
      "Run Conversion Test against the Active Example. Returns full TestResult including output and Output validation. Pass outputMode typescript to execute the Generated TypeScript Conversion Script (not Mapping preview).",
    inputSchema: {
      type: "object",
      properties: {
        revision: { type: "string" },
        outputMode: {
          type: "string",
          description: "preview | typescript | handlebars | xquery | go-template | java",
        },
      },
    },
  },
  {
    name: "generate_script",
    description: "Generate a Conversion Script (typescript|java|handlebars|xquery|go-template). Optionally write to path.",
    inputSchema: {
      type: "object",
      required: ["language"],
      properties: { language: { type: "string" }, path: { type: "string" } },
    },
  },
  {
    name: "export_bundle",
    description: "Export the Project Bundle as json or .intehrgrator zip. Optionally write to path.",
    inputSchema: {
      type: "object",
      properties: {
        format: { enum: ["json", "zip"] },
        path: { type: "string" },
      },
    },
  },
  {
    name: "restore_at",
    description:
      "View the project at history seq (mode view), or go back to it (mode destructive: appends an Undo entry; the history is never rewritten).",
    inputSchema: {
      type: "object",
      required: ["seq"],
      properties: { seq: { type: "number" }, mode: { enum: ["view", "destructive"] } },
    },
  },
  {
    name: "undo",
    description:
      "Undo the newest change in effect, whoever made it (or every change after toSeq). Appends an undo entry; returns who made the undone change.",
    inputSchema: { type: "object", properties: { toSeq: { type: "number" } } },
  },
  {
    name: "revert",
    description:
      "Revert one history entry (seq) as a new change at the end: its slots go back to how they were before it; slots changed again later are skipped and listed.",
    inputSchema: {
      type: "object",
      required: ["seq"],
      properties: { seq: { type: "number" }, revision: { type: "string" } },
    },
  },
  {
    name: "redo",
    description: "Redo.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "put_blockly",
    description: "Replace Blockly workspace JSON (escape hatch; prefer import_suggestions).",
    inputSchema: {
      type: "object",
      required: ["blocklyState"],
      properties: {
        blocklyState: { type: "object" },
        revision: { type: "string" },
      },
    },
  },
];

/** HTTP path after `/api/v1` for each MCP tool name (1:1). */
export type AgentHttpBody = "json" | "text" | "none";

export interface AgentToolHttp {
  method: "GET" | "POST" | "PUT";
  path: string;
  body: AgentHttpBody;
}

export const AGENT_TOOL_HTTP: Record<string, AgentToolHttp> = {
  register_agent: { method: "POST", path: "/register-agent", body: "json" },
  get_snapshot: { method: "GET", path: "/snapshot", body: "none" },
  list_slots: { method: "GET", path: "/slots", body: "none" },
  get_slot: { method: "GET", path: "/slot", body: "none" },
  list_examples: { method: "GET", path: "/examples", body: "none" },
  get_example: { method: "GET", path: "/example", body: "none" },
  get_source_tree: { method: "GET", path: "/source-tree", body: "none" },
  get_sheets: { method: "GET", path: "/sheets", body: "none" },
  get_product_stack: { method: "GET", path: "/product-stack", body: "none" },
  list_optional_rm: { method: "GET", path: "/optional-rm", body: "none" },
  list_constraint_warnings: { method: "GET", path: "/constraint-warnings", body: "none" },
  get_history: { method: "GET", path: "/history", body: "none" },
  get_activity: { method: "GET", path: "/activity", body: "none" },
  get_bundle: { method: "GET", path: "/bundle", body: "none" },
  load_bundle: { method: "PUT", path: "/bundle", body: "json" },
  load_target: { method: "POST", path: "/load-target", body: "json" },
  load_source_schema: { method: "POST", path: "/load-source-schema", body: "json" },
  add_example: { method: "POST", path: "/add-example", body: "json" },
  load_example_set: { method: "POST", path: "/load-example-set", body: "json" },
  list_function_library: { method: "GET", path: "/function-library", body: "none" },
  load_function: { method: "POST", path: "/load-function", body: "json" },
  set_active_example: { method: "POST", path: "/set-active-example", body: "json" },
  replace_sheets: { method: "PUT", path: "/sheets", body: "json" },
  build_prompt: { method: "POST", path: "/build-prompt", body: "json" },
  build_patch_prompt: { method: "POST", path: "/patch-prompt", body: "json" },
  import_suggestions: { method: "POST", path: "/import-suggestions", body: "text" },
  map_slot: { method: "POST", path: "/map-slot", body: "json" },
  optional_rm_add: { method: "POST", path: "/optional-rm/add", body: "json" },
  optional_rm_remove: { method: "POST", path: "/optional-rm/remove", body: "json" },
  set_instance_encoding: { method: "POST", path: "/set-instance-encoding", body: "json" },
  lease_slot: { method: "POST", path: "/lease-slot", body: "json" },
  release_slot: { method: "POST", path: "/release-slot", body: "json" },
  list_leases: { method: "GET", path: "/leases", body: "none" },
  run_test: { method: "POST", path: "/run-test", body: "json" },
  generate_script: { method: "POST", path: "/generate-script", body: "json" },
  export_bundle: { method: "POST", path: "/export-bundle", body: "json" },
  restore_at: { method: "POST", path: "/restore-at", body: "json" },
  undo: { method: "POST", path: "/undo", body: "json" },
  revert: { method: "POST", path: "/revert", body: "json" },
  redo: { method: "POST", path: "/redo", body: "json" },
  put_blockly: { method: "PUT", path: "/blockly", body: "json" },
};

export function findAgentToolForHttp(method: string, path: string): string | undefined {
  const m = method.toUpperCase();
  for (const [name, route] of Object.entries(AGENT_TOOL_HTTP)) {
    if (route.method === m && route.path === path) return name;
  }
  return undefined;
}

/**
 * Slot ids in tool arguments may be the compact slot-tree form (#277): turn
 * them into skeleton ids before the tool runs. A lease subtree is a prefix.
 */
function withResolvedSlotRefs(
  service: WorkbenchService,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const subtree = args.subtree === true || args.subtree === "true";
  const out = { ...args };
  if (typeof args.slotId === "string" && args.slotId) {
    out.slotId = subtree && (name === "lease_slot" || name === "release_slot")
      ? service.resolveSlotPrefix(args.slotId)
      : service.resolveSlotRef(args.slotId);
  }
  if (typeof args.parentSlotId === "string" && args.parentSlotId) {
    out.parentSlotId = service.resolveSlotRef(args.parentSlotId);
  }
  return out;
}

export async function callAgentTool(
  service: WorkbenchService,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  args = withResolvedSlotRefs(service, name, args);
  const revision = args.revision as string | undefined;
  const ctx = mutationContextFromArgs(args);
  if (ctx?.actor) service.setActor(ctx.actor);
  switch (name) {
    case "register_agent": {
      const reg = service.registerAgent({
        agentId: args.agentId as string | undefined,
        displayName: args.displayName as string | undefined,
        color: args.color as string | undefined,
      });
      return {
        ...reg,
        message: `Registered as ${reg.displayName}. Pass X-Agent-Id and X-Agent-Name on mutations.`,
      };
    }
    case "get_snapshot":
      return service.getSnapshot();
    case "list_slots":
      if (args.view === "rows") {
        return {
          revision: service.getRevision(),
          slots: filterSlotRows(service.listSlots(), args),
          repeatable: service.listRepeatable(),
        };
      }
      return { revision: service.getRevision(), groups: service.listSlotTree(args) };
    case "get_slot":
      return { revision: service.getRevision(), slot: service.getSlot(String(args.id ?? args.slotId ?? "")) };
    case "list_examples":
      return { revision: service.getRevision(), examples: listExamplesInspect(service.getExampleState()) };
    case "get_example":
      return { revision: service.getRevision(), ...getExampleInspect(service.getExampleState(), args) };
    case "get_source_tree":
      return { revision: service.getRevision(), ...service.getSourceTree(args) };
    case "get_sheets":
      return { revision: service.getRevision(), ...service.getSheets() };
    case "get_product_stack":
      return { revision: service.getRevision(), stack: service.getProductStack() };
    case "list_optional_rm":
      return { revision: service.getRevision(), ...service.listOptionalRm(args.parentSlotId as string | undefined) };
    case "list_constraint_warnings":
      return { revision: service.getRevision(), warnings: service.listConstraintWarnings() };
    case "get_history":
      return { revision: service.getRevision(), entries: service.listHistory() };
    case "get_activity":
      return { activity: service.getActivity(), agents: service.registry.list() };
    case "get_bundle":
      return { revision: service.getRevision(), bundle: service.exportBundle() };
    case "load_bundle":
      if (args.bundle && typeof args.bundle === "object") {
        service.loadBundle(args.bundle as ProjectBundle, { expectedRevision: revision });
      } else if (typeof args.path === "string") {
        const bytes = await Deno.readFile(args.path);
        service.loadBundleFile(bytes, { expectedRevision: revision });
      } else if (typeof args.bytesBase64 === "string") {
        service.loadBundleFile(base64ToUint8(args.bytesBase64), { expectedRevision: revision });
      } else if (isProjectBundleArg(args)) {
        service.loadBundle(projectBundleFromArgs(args), { expectedRevision: revision });
      } else {
        throw new Error("load_bundle requires bundle JSON, path, or bytesBase64");
      }
      return { revision: service.getRevision() };
    case "load_target":
      if (typeof args.url === "string") {
        await service.loadTargetFromUrl(args.url);
      } else {
        const file = await readTextInput(args, "target");
        service.loadTemplateContent(file.filename, file.content);
      }
      return { revision: service.getRevision(), snapshot: service.getSnapshot() };
    case "load_source_schema":
      if (typeof args.url === "string") {
        await service.loadSchemaFromUrl(args.url);
      } else {
        const file = await readTextInput(args, "schema");
        service.loadSchemaContent(file.filename, file.content);
      }
      return { revision: service.getRevision() };
    case "add_example":
      if (typeof args.url === "string") {
        await service.addExampleFromUrl(args.url);
      } else {
        const file = await readTextInput(args, "example");
        service.addExampleContent(file.filename, file.content);
      }
      return { revision: service.getRevision(), ...service.getSourceTree() };
    case "load_example_set": {
      const loaded = await loadExampleSetFromArgs(service, args);
      return { ...loaded, revision: service.getRevision(), snapshot: service.getSnapshot() };
    }
    case "list_function_library": {
      const catalog = await loadFunctionLibraryCatalogFromArgs(args);
      return {
        revision: service.getRevision(),
        catalogUrl: catalog.catalogUrl,
        functions: catalog.functions,
      };
    }
    case "load_function": {
      const bundle = await loadFunctionBundleFromArgs(args);
      const clash = args.clash === "replace" ? "replace" : "rename";
      const result = service.applyFunctionBundle(bundle, clash, revision, ctx);
      return {
        revision: service.getRevision(),
        name: result.name,
        renamedFrom: result.renamedFrom,
        warnings: result.warnings,
        clashes: result.clashes,
        sheetNames: result.sheets.map((sheet) => sheet.name),
      };
    }
    case "set_active_example":
      service.setActiveExample(String(args.id));
      return { revision: service.getRevision() };
    case "replace_sheets":
      if (!Array.isArray(args.sheets)) throw new Error("replace_sheets requires sheets[]");
      service.replaceSheets(args.sheets as SheetDocument[], {
        ...ctx,
        expectedRevision: revision,
      });
      return { revision: service.getRevision(), ...service.getSheets() };
    case "build_prompt":
      return {
        prompt: service.buildAgentPrompt(
          (args.delivery as "inline") ?? "inline",
          (args.scope as "full") ?? "full",
          args.slotId as string | undefined,
        ),
        revision: service.getRevision(),
      };
    case "build_patch_prompt":
      return {
        prompt: service.buildPatchPrompt(Number(args.targetSeq)),
        format: "intehrgrator-suggestions-v2",
      };
    case "import_suggestions":
      return {
        report: service.importSuggestions(
          applySuggestionReviewDefaults(suggestionTextFromArgs(args), args.note, args.confidence),
          revision,
          ctx,
        ),
        revision: service.getRevision(),
      };
    case "map_slot": {
      const slotId = String(args.slotId ?? "");
      const path = String(args.path ?? "");
      if (!slotId || !path) throw new Error("map_slot requires slotId and path");
      const formatRaw = String(args.format ?? "json");
      const format: SourceFormatId = isSourceFormatId(formatRaw) ? formatRaw : "json";
      const row = service.listSlots().find((r) => r.slotId === slotId);
      if (!row) throw new Error(`Unknown slotId: ${slotId}`);
      service.mapNodeToSlot(slotId, path, format, revision, ctx, slotReviewFrom(args.note, args.confidence));
      const ignored = args.confidence !== undefined && parseAiConfidence(args.confidence) === undefined;
      return {
        revision: service.getRevision(),
        slotId,
        ...(row.label ? { label: row.label } : {}),
        mapped: true,
        ...(ignored ? { warning: "confidence must be a number 0–100 (percent); ignored" } : {}),
      };
    }
    case "optional_rm_add":
      service.addOptionalRm(
        String(args.parentSlotId),
        String(args.rmType),
        String(args.attributeName),
        revision,
        ctx,
      );
      return { revision: service.getRevision() };
    case "optional_rm_remove":
      service.removeOptionalRm(
        String(args.parentSlotId),
        String(args.attributeName),
        revision,
        ctx,
      );
      return { revision: service.getRevision() };
    case "set_instance_encoding": {
      const encoding = String(args.encoding);
      if (!isInstanceEncoding(encoding)) throw new Error(`Invalid instance encoding: ${encoding}`);
      service.setInstanceEncoding(encoding, Number(args.rootIndex ?? 0), revision, ctx);
      return { revision: service.getRevision(), stack: service.getProductStack() };
    }
    case "lease_slot": {
      const slotId = String(args.slotId ?? "").trim();
      if (!slotId) throw new Error("lease_slot requires slotId");
      return {
        lease: service.leaseSlot(slotId, Number(args.ttlSec ?? 120), ctx, args.subtree === true || args.subtree === "true"),
        revision: service.getRevision(),
      };
    }
    case "release_slot": {
      const released = service.releaseSlot(
        typeof args.slotId === "string" ? args.slotId : undefined,
        ctx,
        {
          subtree: args.subtree === undefined ? undefined : args.subtree === true || args.subtree === "true",
          all: args.all === true || args.all === "true",
        },
      );
      return { ok: released > 0, released, revision: service.getRevision() };
    }
    case "list_leases":
      return { leases: service.leases.list(), revision: service.getRevision() };
    case "run_test": {
      if (typeof args.outputMode === "string") {
        if (!isOutputMode(args.outputMode)) {
          throw new Error(`Unsupported outputMode: ${args.outputMode}`);
        }
        service.setOutputMode(args.outputMode);
      }
      return {
        testResult: service.runTest(),
        outputMode: service.getOutputMode(),
        revision: service.getRevision(),
      };
    }
    case "generate_script": {
      const language = String(args.language) as ConversionScriptLanguage;
      if (!isConversionScriptLanguage(language)) {
        throw new Error(`Unsupported conversion script language: ${language}`);
      }
      const generated = service.generateScript(language);
      if (typeof args.path === "string") {
        await writeTextPath(args.path, generated.code);
      }
      return { ...generated, path: args.path };
    }
    case "export_bundle": {
      const format = args.format === "zip" ? "zip" : "json";
      if (format === "json") {
        const bundle = service.exportBundle();
        if (typeof args.path === "string") {
          await writeTextPath(args.path, JSON.stringify(bundle, null, 2));
        }
        return { format, revision: service.getRevision(), bundle, path: args.path };
      }
      const bytes = exportBundle(service.exportBundle());
      if (typeof args.path === "string") {
        await writeBytesPath(args.path, bytes);
      }
      return {
        format: "zip",
        revision: service.getRevision(),
        bytesBase64: uint8ToBase64(bytes),
        path: args.path,
      };
    }
    case "put_blockly":
      service.loadBlocklyState(args.blocklyState, revision, ctx);
      return { revision: service.getRevision() };
    case "undo": {
      if (args.scope !== undefined && args.scope !== "global") {
        throw new Error("undo always rewinds the newest change; use revert {seq} for one author's change");
      }
      const undone = typeof args.toSeq === "number" || typeof args.toSeq === "string"
        ? service.undoTo(Number(args.toSeq), ctx)
        : service.undo(ctx);
      return { ok: Boolean(undone), ...(undone ?? {}), revision: service.getRevision() };
    }
    case "redo":
      return { ok: service.redo(ctx), revision: service.getRevision() };
    case "revert":
      return service.revert(Number(args.seq), { ...ctx, expectedRevision: revision });
    case "restore_at":
      return {
        ...service.restoreAt(Number(args.seq), (args.mode as "view") ?? "view"),
        revision: service.getRevision(),
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** `import_suggestions` text: a JSON string, an inline envelope, or `envelope`. */
export function suggestionTextFromArgs(args: Record<string, unknown>): string {
  if (typeof args.text === "string" && args.text.trim()) return args.text;
  if (args.format === "intehrgrator-suggestions") return JSON.stringify(args);
  if (args.envelope && typeof args.envelope === "object") return JSON.stringify(args.envelope);
  throw new Error("import_suggestions requires text (intehrgrator-suggestions JSON)");
}

function mutationContextFromArgs(args: Record<string, unknown>): MutationContext | undefined {
  const client = typeof args._agentClient === "string" && args._agentClient ? args._agentClient : undefined;
  if (typeof args._agentId !== "string" || !args._agentId) {
    return client ? { actor: mcpClientActor(client) } : undefined;
  }
  return {
    actor: {
      kind: "agent",
      id: args._agentId,
      displayName: String(args._agentName ?? args._agentId),
      color: typeof args._agentColor === "string" ? args._agentColor : undefined,
      origin: "mcp",
      ...(client ? { client } : {}),
    },
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function writeTextPath(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, content);
}

async function writeBytesPath(path: string, bytes: Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeFile(path, bytes);
}

async function readTextInput(
  args: Record<string, unknown>,
  fallbackName: string,
): Promise<{ filename: string; content: string }> {
  if (typeof args.content === "string") {
    return {
      filename: String(args.filename ?? `${fallbackName}.txt`),
      content: args.content,
    };
  }
  if (typeof args.path === "string") {
    const path = args.path;
    return { filename: basename(path), content: await Deno.readTextFile(path) };
  }
  throw new Error(`Provide content (+ optional filename), path, or url`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProjectBundleArg(args: Record<string, unknown>): boolean {
  return typeof args.version === "number" && isRecord(args.mapping);
}

function projectBundleFromArgs(args: Record<string, unknown>): ProjectBundle {
  const rest = { ...args };
  delete rest.revision;
  delete rest._agentId;
  delete rest._agentName;
  delete rest._agentClient;
  delete rest._agentColor;
  delete rest.path;
  delete rest.bundle;
  delete rest.bytesBase64;
  return rest as unknown as ProjectBundle;
}

async function loadExampleSetFromArgs(
  service: WorkbenchService,
  args: Record<string, unknown>,
): Promise<{ setId: string; title: string; catalogUrl: string }> {
  const setId = String(args.setId ?? "").trim();
  if (!setId) throw new Error("load_example_set requires setId");
  const catalogUrl = resolveCatalogUrl(args);
  const text = catalogUrl.startsWith("file:")
    ? await Deno.readTextFile(new URL(catalogUrl))
    : await (await fetch(toFetchableUrl(catalogUrl))).then(async (res) => {
      if (!res.ok) throw new Error(`Could not load catalog ${catalogUrl} (${res.status})`);
      return await res.text();
    });
  const catalog = parseExampleSetCatalog(text, catalogUrl);
  const set = catalog.sets.find((row) => row.id === setId);
  if (!set) {
    throw new Error(
      `Unknown example set "${setId}". Known: ${catalog.sets.map((row) => row.id).join(", ")}`,
    );
  }
  const includeMapping = args.includeMapping !== false;
  await service.loadExampleSet(
    includeMapping ? set : { ...set, mapping: undefined, sheets: undefined },
  );
  return { setId: set.id, title: set.title, catalogUrl: catalog.catalogUrl };
}

function resolveCatalogUrl(args: Record<string, unknown>): string {
  if (typeof args.catalogPath === "string" && args.catalogPath.trim()) {
    return toFileUrl(resolve(args.catalogPath.trim())).href;
  }
  if (typeof args.catalogUrl === "string" && args.catalogUrl.trim()) {
    return toFetchableUrl(args.catalogUrl.trim());
  }
  throw new Error("load_example_set requires catalogPath or catalogUrl");
}

async function loadFunctionLibraryCatalogFromArgs(
  args: Record<string, unknown>,
): Promise<FunctionLibraryCatalog> {
  const catalogUrl = resolveFunctionLibraryCatalogUrl(args);
  return await loadFunctionLibraryCatalog(catalogUrl);
}

async function loadFunctionBundleFromArgs(args: Record<string, unknown>): Promise<FunctionBundle> {
  if (args.bundle && typeof args.bundle === "object") {
    return functionBundleFromUnknown(args.bundle);
  }
  if (typeof args.path === "string" && args.path.trim()) {
    return parseFunctionBundle(await Deno.readTextFile(resolve(args.path.trim())));
  }
  const functionId = String(args.functionId ?? "").trim();
  if (!functionId) {
    throw new Error("load_function requires functionId, bundle, or path");
  }
  const catalog = await loadFunctionLibraryCatalogFromArgs(args);
  return await loadFunctionLibraryEntry(catalog, functionId);
}

function resolveFunctionLibraryCatalogUrl(args: Record<string, unknown>): string {
  if (typeof args.catalogPath === "string" && args.catalogPath.trim()) {
    return toFileUrl(resolve(args.catalogPath.trim())).href;
  }
  if (typeof args.catalogUrl === "string" && args.catalogUrl.trim()) {
    return toFetchableUrl(args.catalogUrl.trim());
  }
  const bundled = resolve(BUNDLED_FUNCTION_LIBRARY_PATH);
  try {
    Deno.statSync(bundled);
    return toFileUrl(bundled).href;
  } catch {
    return DEFAULT_GITHUB_FUNCTION_LIBRARY_URL;
  }
}
