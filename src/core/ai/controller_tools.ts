/**
 * Execute Call AI mapping tools against the live WorkbenchController.
 * Tool names match MCP / Agent API (`AGENT_TOOLS`).
 */
import {
  compactSourceTree,
  constraintWarningsInspect,
  listRepeatableInspect,
  listSlotsInspect,
  productStackInspect,
  sheetSummaries,
} from "../../agent/inspect.ts";
import { applySuggestionReviewDefaults, parseAiConfidence, slotReviewFrom, TOOL_REVIEW_PARAMS } from "./mod.ts";
import type { WorkbenchController } from "../../workbench/controller.ts";
import type { OpenAiTool } from "./credentials.ts";
import type { SheetDocument } from "../sheets/mod.ts";
import { isSourceFormatId } from "../source/format_handler.ts";

export const CALL_AI_TOOL_NAMES = [
  "get_snapshot",
  "list_slots",
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
] as const;

export type CallAiToolName = typeof CALL_AI_TOOL_NAMES[number];

const CALL_AI_OPENAI_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "get_snapshot",
      description:
        "Project revision, template id, mapped counts, unmapped mandatory slot ids, sheets, product stack, Constraint warning count, test status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_slots",
      description:
        "Target value slots (id, mapped, valueType, pathLabel, multiplicity, attachSlotId, parentRmType, units/codes, expression) plus repeatable containers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_source_tree",
      description: "Compact Source Schema and Active Example trees (paths for Click-to-Map / source_query).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sheets",
      description: "Named Sheets and Decision tables (summaries plus full grid documents).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_stack",
      description: "Instance roots under Conversion start, with Instance encoding and product-stack loops.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_optional_rm",
      description: "Optional RM Insertion catalog. Pass parentSlotId to inspect one container.",
      parameters: { type: "object", properties: { parentSlotId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "list_constraint_warnings",
      description: "Constraint warnings: unmapped mandatory slots, Decision table lint, abstract EVENT / ITEM_STRUCTURE.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "import_suggestions",
      description:
        "Apply intehrgrator-suggestions JSON envelope. Per-suggestion note/confidence are honoured; call-level note/confidence apply to suggestions without their own.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" }, revision: { type: "string" }, ...TOOL_REVIEW_PARAMS },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "map_slot",
      description: "Map a source path to a target value slotId (same as MCP map_slot / Click-to-Map).",
      parameters: {
        type: "object",
        required: ["slotId", "path"],
        properties: {
          slotId: { type: "string" },
          path: { type: "string" },
          format: { type: "string" },
          ...TOOL_REVIEW_PARAMS,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "optional_rm_add",
      description: "Optional RM Insertion: add an RM-optional attribute mouth on a parent slot.",
      parameters: {
        type: "object",
        required: ["parentSlotId", "rmType", "attributeName"],
        properties: {
          parentSlotId: { type: "string" },
          rmType: { type: "string" },
          attributeName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "optional_rm_remove",
      description: "Remove an Optional RM Insertion from a parent slot.",
      parameters: {
        type: "object",
        required: ["parentSlotId", "attributeName"],
        properties: {
          parentSlotId: { type: "string" },
          attributeName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_sheets",
      description: "Replace project Sheet / Decision table documents (full grid JSON).",
      parameters: {
        type: "object",
        required: ["sheets"],
        properties: { sheets: { type: "array" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_active_example",
      description: "Select the Active Example by id from get_source_tree.examples.",
      parameters: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_test",
      description: "Run Test against the Active Example. Returns full TestResult.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export function mappingAgentOpenAiTools(): OpenAiTool[] {
  return CALL_AI_OPENAI_TOOLS;
}

export function executeMappingAgentTool(
  controller: WorkbenchController,
  name: string,
  args: Record<string, unknown>,
): unknown {
  const s = controller.getState();
  switch (name) {
    case "get_snapshot": {
      const slots = listSlotsInspect(s.skeleton, s.model);
      return {
        revision: "ui",
        templateId: s.templateId,
        appliedSlots: slots.filter((row) => row.mapped).length,
        loops: s.model.loops?.length ?? 0,
        unmappedMandatory: s.unmappedMandatory,
        unmappedMandatorySlotIds: slots.filter((row) => !row.mapped && row.mandatory).map((row) => row.slotId)
          .slice(0, 40),
        sheetNames: s.sheets.map((sheet) => sheet.name),
        productStack: productStackInspect(s.blocklyState),
        exampleCount: s.examples.length,
        activeExample: s.activeExample?.filename ?? null,
        testOk: s.testResult?.ok ?? null,
        constraintWarningCount: constraintWarningsInspect({
          skeleton: s.skeleton,
          model: s.model,
          sheets: s.sheets,
          blocklyState: s.blocklyState,
        }).length,
      };
    }
    case "list_slots":
      return {
        revision: "ui",
        slots: listSlotsInspect(s.skeleton, s.model),
        repeatable: listRepeatableInspect(s.skeleton),
      };
    case "get_source_tree":
      return {
        revision: "ui",
        schema: compactSourceTree(s.schemaTree),
        schemaFormat: s.schemaFormat,
        schemaFilename: s.schemaFilename,
        example: compactSourceTree(s.exampleTree ?? null),
        activeExample: s.activeExample?.filename ?? null,
        examples: s.examples.map((ex) => ({ id: ex.id, filename: ex.filename, format: ex.format })),
      };
    case "get_sheets":
      return { revision: "ui", summaries: sheetSummaries(s.sheets), sheets: s.sheets };
    case "get_product_stack":
      return { revision: "ui", stack: productStackInspect(s.blocklyState) };
    case "list_optional_rm": {
      const parentSlotId = typeof args.parentSlotId === "string" ? args.parentSlotId : undefined;
      if (parentSlotId) {
        return { revision: "ui", parentSlotId, attachments: controller.getOptionalAttachments(parentSlotId) };
      }
      return { revision: "ui", catalog: controller.collectOptionalRmCatalog() };
    }
    case "list_constraint_warnings":
      return {
        revision: "ui",
        warnings: constraintWarningsInspect({
          skeleton: s.skeleton,
          model: s.model,
          sheets: s.sheets,
          blocklyState: s.blocklyState,
        }),
      };
    case "import_suggestions": {
      const text = applySuggestionReviewDefaults(suggestionTextFromArgs(args), args.note, args.confidence);
      const report = controller.importAiSuggestions(text);
      return { report, revision: "ui" };
    }
    case "map_slot": {
      const slotId = String(args.slotId ?? "");
      const path = String(args.path ?? "");
      if (!slotId || !path) throw new Error("map_slot requires slotId and path");
      const formatRaw = String(args.format ?? "json");
      const format = isSourceFormatId(formatRaw) ? formatRaw : "json";
      const before = listSlotsInspect(s.skeleton, s.model).find((row) => row.slotId === slotId);
      if (!before) throw new Error(`Unknown slotId: ${slotId}`);
      controller.mapNodeToSlot(slotId, path, format, slotReviewFrom(args.note, args.confidence));
      const ignored = args.confidence !== undefined && parseAiConfidence(args.confidence) === undefined;
      return {
        revision: "ui",
        slotId,
        mapped: true,
        ...(ignored ? { warning: "confidence must be a number 0–100 (percent); ignored" } : {}),
      };
    }
    case "optional_rm_add": {
      controller.addOptionalRm(
        String(args.parentSlotId),
        String(args.rmType),
        String(args.attributeName),
      );
      return { revision: "ui" };
    }
    case "optional_rm_remove": {
      controller.removeOptionalRm(String(args.parentSlotId), String(args.attributeName));
      return { revision: "ui" };
    }
    case "replace_sheets": {
      const sheets = args.sheets;
      if (!Array.isArray(sheets)) throw new Error("replace_sheets requires sheets[]");
      controller.replaceSheets(sheets as SheetDocument[]);
      const next = controller.getSheets();
      return { revision: "ui", summaries: sheetSummaries(next) };
    }
    case "set_active_example": {
      controller.setActiveExample(String(args.id));
      return { revision: "ui" };
    }
    case "run_test": {
      controller.runTestNow();
      const next = controller.getState();
      return {
        testResult: next.testResult ?? { ok: false, error: "No test result", warnings: [] },
        outputMode: next.settings.exportTarget,
        revision: "ui",
      };
    }
    default:
      throw new Error(`Call AI cannot run ${name}; use MCP / Agent API for that tool`);
  }
}

export function suggestionTextFromArgs(args: Record<string, unknown>): string {
  if (typeof args.text === "string" && args.text.trim()) return args.text;
  if (args.format === "intehrgrator-suggestions") return JSON.stringify(args);
  if (args.envelope && typeof args.envelope === "object") return JSON.stringify(args.envelope);
  throw new Error("import_suggestions requires text (intehrgrator-suggestions JSON)");
}

export function isMutatingCallAiTool(name: string): boolean {
  return name === "import_suggestions" ||
    name === "map_slot" ||
    name === "optional_rm_add" ||
    name === "optional_rm_remove" ||
    name === "replace_sheets" ||
    name === "set_active_example";
}
