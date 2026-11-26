/**
 * Shared pure Blockly-JSON patch helpers (Invariant D).
 *
 * Single mutation path shared by D3 Treemap inline popovers (2C) and the
 * bottom Mapping Specification editor. Every function is immutable and emits
 * strictly valid Blockly serialization JSON matching registered block types.
 */
import {
  type BlocklyBlockJson,
  type BlocklyWorkspaceJson,
  findBlockPathById,
  parseSyntheticFieldId,
} from "./slice_engine.ts";

let patchIdSeq = 0;

function nextId(prefix = "p"): string {
  patchIdSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${patchIdSeq.toString(36)}`;
}

export type SimpleExpressionSpec =
  | {
    kind: "scale_offset";
    sourcePath: string;
    multiplier?: number;
    offset?: number;
  }
  | {
    kind: "trim";
    sourcePath: string;
  }
  | {
    kind: "concat";
    parts: Array<
      | { kind: "source"; path: string }
      | { kind: "literal"; text: string }
    >;
  }
  | {
    kind: "fallback";
    sourcePath: string;
    fallbackValue: string;
    returnType?: "string" | "number";
  };

const COMPLEX_BLOCK_TYPES = new Set([
  "procedures_callreturn",
  "procedures_callnoreturn",
  "decision_table",
  "decision_table_eval",
  "sheet_lookup",
  "sheet_get_cell",
  "sheet_get_row",
  "sheet_get_column",
  "logic_list_restriction",
  "lists_create_with",
  "lists_getIndex",
  "lists_set_operation",
  "maps_create_with",
  "text_handlebars",
  "for_each_list",
  "include_when",
]);

function primaryFieldInputForDv(rmDatatype: string): {
  shellType: string;
  inputName: string;
  returnType: "string" | "number" | "boolean";
} {
  const rm = (rmDatatype || "DV_TEXT").toUpperCase();
  if (rm === "DV_QUANTITY") {
    return { shellType: "dv_quantity", inputName: "FLD_magnitude", returnType: "number" };
  }
  if (rm === "DV_COUNT") {
    return { shellType: "dv_count", inputName: "FLD_magnitude", returnType: "number" };
  }
  if (rm === "DV_PROPORTION") {
    return { shellType: "dv_proportion", inputName: "FLD_numerator", returnType: "number" };
  }
  if (rm === "DV_BOOLEAN") {
    return { shellType: "dv_boolean", inputName: "FLD_value", returnType: "boolean" };
  }
  if (rm === "DV_DATE_TIME") {
    return { shellType: "dv_date_time", inputName: "FLD_value", returnType: "string" };
  }
  if (rm === "DV_DATE") {
    return { shellType: "dv_date", inputName: "FLD_value", returnType: "string" };
  }
  if (rm === "DV_TIME") {
    return { shellType: "dv_time", inputName: "FLD_value", returnType: "string" };
  }
  if (rm === "DV_DURATION") {
    return { shellType: "dv_duration", inputName: "FLD_value", returnType: "string" };
  }
  if (rm === "DV_URI" || rm === "DV_EHR_URI") {
    return { shellType: "dv_uri", inputName: "FLD_value", returnType: "string" };
  }
  if (rm === "DV_IDENTIFIER") {
    return { shellType: "dv_identifier", inputName: "FLD_id", returnType: "string" };
  }
  if (rm === "DV_CODED_TEXT") {
    return { shellType: "dv_coded_text", inputName: "FLD_value", returnType: "string" };
  }
  return { shellType: "dv_text", inputName: "FLD_value", returnType: "string" };
}

function sourceQueryBlockJson(
  sourcePath: string,
  returnType: "string" | "number" | "boolean",
): BlocklyBlockJson {
  const type = returnType === "number"
    ? "source_query_number"
    : returnType === "boolean"
    ? "source_query_boolean"
    : "source_query";
  return {
    type,
    id: nextId("sq"),
    fields: type === "source_query"
      ? { EXPRESSION: sourcePath, RETURN_TYPE: returnType }
      : { EXPRESSION: sourcePath },
  };
}

function ensureElementShell(
  element: BlocklyBlockJson,
  rmDatatypeOverride?: string,
): { shell: BlocklyBlockJson; inputName: string; returnType: "string" | "number" | "boolean" } {
  const rm = rmDatatypeOverride || String(element.fields?.VALUE_RM_TYPE ?? "DV_TEXT");
  const spec = primaryFieldInputForDv(rm);
  if (!element.inputs) element.inputs = {};

  const existing = element.inputs.VALUE?.block;
  if (existing && existing.type === spec.shellType) {
    if (!existing.inputs) existing.inputs = {};
    return { shell: existing, inputName: spec.inputName, returnType: spec.returnType };
  }

  // Create fresh valid DV_* shell matching registered RM block definitions.
  const shell: BlocklyBlockJson = {
    type: spec.shellType,
    id: nextId("dv"),
    extraState: { fields: [] },
    fields: {
      NAME: rm.replace(/^DV_/, "").replace(/_/g, " "),
      RM_TYPE: rm,
    },
    inputs: {},
  };
  element.inputs.VALUE = { block: shell };
  return { shell, inputName: spec.inputName, returnType: spec.returnType };
}

function cloneAndFind(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
): { doc: BlocklyWorkspaceJson; block: BlocklyBlockJson } {
  const doc = structuredClone(docJson);
  const found = findBlockPathById(doc, targetBlockId);
  if (!found) {
    throw new Error(`json_patch_helpers: block "${targetBlockId}" not found`);
  }
  return { doc, block: found.block };
}

/**
 * Shared single-field update helper (used by both Mapping Spec editor and D3 popovers).
 */
export function setFieldInBlocklyJson(
  docJson: BlocklyWorkspaceJson,
  blockId: string,
  field: string,
  value: string,
): BlocklyWorkspaceJson {
  const { doc, block } = cloneAndFind(docJson, blockId);
  if (!block.fields) block.fields = {};
  block.fields[field] = value;
  return doc;
}

function inferSchemaReturnType(
  block: BlocklyBlockJson,
  inputName: string,
  rmDatatypeOverride?: string,
): "string" | "number" | "boolean" {
  const hint = (rmDatatypeOverride ?? "").trim().toLowerCase();
  if (hint === "number" || hint === "integer" || hint === "dv_quantity" || hint === "dv_count") {
    return "number";
  }
  if (hint === "boolean" || hint === "dv_boolean") return "boolean";
  const fieldName = inputName.replace(/^(?:TARGET_|SCHEMA_OPT_)/, "");
  const lists = [
    ...(Array.isArray(block.extraState?.fields) ? block.extraState!.fields as Array<{ name?: string; check?: string | string[] }> : []),
    ...(Array.isArray(block.extraState?.optionalFields) ? block.extraState!.optionalFields as Array<{ name?: string; check?: string | string[] }> : []),
  ];
  const spec = lists.find((s) => s?.name === fieldName);
  const check = (Array.isArray(spec?.check) ? spec?.check[0] : spec?.check ?? "").toLowerCase();
  if (check === "number") return "number";
  if (check === "boolean") return "boolean";
  return "string";
}

function resolveWritableSlot(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  rmDatatypeOverride?: string,
): {
  doc: BlocklyWorkspaceJson;
  ownerBlock: BlocklyBlockJson;
  shell: BlocklyBlockJson;
  inputName: string;
  returnType: "string" | "number" | "boolean";
} {
  const synth = parseSyntheticFieldId(targetBlockId);
  if (synth) {
    const { doc, block } = cloneAndFind(docJson, synth.parentId);
    if (!block.inputs) block.inputs = {};
    return {
      doc,
      ownerBlock: block,
      shell: block,
      inputName: synth.inputName,
      returnType: inferSchemaReturnType(block, synth.inputName, rmDatatypeOverride),
    };
  }
  const { doc, block } = cloneAndFind(docJson, targetBlockId);
  if (
    block.type === "target_value" ||
    block.type === "json_value" ||
    block.type === "json_boolean" ||
    block.type === "xml_attribute"
  ) {
    if (!block.inputs) block.inputs = {};
    const returnType = block.type === "json_boolean"
      ? "boolean"
      : inferSchemaReturnType(block, "VALUE", rmDatatypeOverride);
    return { doc, ownerBlock: block, shell: block, inputName: "VALUE", returnType };
  }
  const { shell, inputName, returnType } = ensureElementShell(block, rmDatatypeOverride);
  return { doc, ownerBlock: block, shell, inputName, returnType };
}

/**
 * Guardrail detector: returns `{ complex: true, reason }` when a target element
 * contains complex Blockly logic (multi-branch conditionals, functions, decision
 * tables, loops, deeply nested logic) so D3 inline popovers never silently
 * clobber complex block trees.
 */
export function isComplexMapping(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
): { complex: boolean; reason?: string } {
  const synth = parseSyntheticFieldId(targetBlockId);
  const found = findBlockPathById(docJson, synth ? synth.parentId : targetBlockId);
  if (!found) return { complex: false };
  const root = found.block;
  const valueBlock = synth
    ? root.inputs?.[synth.inputName]?.block
    : (root.type === "element" || root.type === "target_value" || root.type === "json_value" || root.type === "xml_attribute"
      ? root.inputs?.VALUE?.block
      : root);
  if (!valueBlock) return { complex: false };

  function inspect(b: BlocklyBlockJson | undefined, depth: number): { complex: boolean; reason?: string } {
    if (!b) return { complex: false };
    if (COMPLEX_BLOCK_TYPES.has(b.type)) {
      return { complex: true, reason: `Contains complex block "${b.type}"` };
    }
    if (b.type === "logic_operation" || b.type === "controls_if") {
      return { complex: true, reason: `Contains branching logic "${b.type}"` };
    }
    if (b.type === "logic_ternary") {
      // Allow simple fallback-default pattern; flag nested or compound ternaries.
      const ifBlock = b.inputs?.IF?.block;
      const thenBlock = b.inputs?.THEN?.block;
      const elseBlock = b.inputs?.ELSE?.block;
      const isSimpleFallback =
        ifBlock?.type === "logic_compare" &&
        (thenBlock?.type === "source_query" || thenBlock?.type === "source_query_number") &&
        (elseBlock?.type === "text" || elseBlock?.type === "math_number");
      if (!isSimpleFallback) {
        return { complex: true, reason: "Contains custom conditional (if/else)" };
      }
    }
    if (depth > 5) {
      return { complex: true, reason: "Contains deeply nested expression tree" };
    }
    if (b.inputs) {
      for (const inp of Object.values(b.inputs)) {
        const res = inspect(inp.block, depth + 1);
        if (res.complex) return res;
      }
    }
    if (b.next?.block) {
      const res = inspect(b.next.block, depth + 1);
      if (res.complex) return res;
    }
    return { complex: false };
  }

  return inspect(valueBlock, 0);
}

/**
 * Bind a 1:1 Source Path (`source_query*`) into `targetBlockId`.
 */
export function setSourceBinding(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  sourcePath: string,
  rmDatatypeOverride?: string,
): BlocklyWorkspaceJson {
  const { doc, shell, inputName, returnType } = resolveWritableSlot(
    docJson,
    targetBlockId,
    rmDatatypeOverride,
  );
  shell.inputs![inputName] = {
    block: sourceQueryBlockJson(sourcePath.trim(), returnType),
  };
  return doc;
}

/**
 * Set a datatype-aware literal/constant value (`text`, `math_number`, `logic_boolean`)
 * inside `targetBlockId`.
 */
export function setLiteralValue(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  rmDatatype: string,
  value: string | number | boolean,
): BlocklyWorkspaceJson {
  const { doc, shell, inputName, returnType } = resolveWritableSlot(
    docJson,
    targetBlockId,
    rmDatatype,
  );

  let literalBlock: BlocklyBlockJson;
  if (returnType === "number") {
    const n = typeof value === "number" ? value : Number(value);
    literalBlock = {
      type: "math_number",
      id: nextId("num"),
      fields: { NUM: Number.isFinite(n) ? n : 0 },
    };
  } else if (returnType === "boolean") {
    const b = typeof value === "boolean"
      ? value
      : String(value).trim().toLowerCase() === "true";
    literalBlock = {
      type: "logic_boolean",
      id: nextId("bool"),
      fields: { BOOL: b ? "TRUE" : "FALSE" },
    };
  } else {
    literalBlock = {
      type: "text",
      id: nextId("txt"),
      fields: { TEXT: String(value) },
    };
  }

  shell.inputs![inputName] = { block: literalBlock };
  return doc;
}

/**
 * Set a `DV_CODED_TEXT` terminology binding (code system, code, display) on `targetBlockId`.
 */
export function setTerminologyBinding(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  codeSystem: string,
  code: string,
  display: string,
): BlocklyWorkspaceJson {
  const { doc, block } = cloneAndFind(docJson, targetBlockId);
  if (!block.inputs) block.inputs = {};

  const codedShell: BlocklyBlockJson = {
    type: "dv_coded_text",
    id: nextId("dvct"),
    extraState: { fields: [] },
    fields: {
      NAME: "Coded text",
      RM_TYPE: "DV_CODED_TEXT",
    },
    inputs: {
      FLD_value: {
        block: {
          type: "text",
          id: nextId("txt"),
          fields: { TEXT: display },
        },
      },
      FLD_defining_code: {
        block: {
          type: "code_phrase",
          id: nextId("cp"),
          extraState: { fields: [] },
          fields: {
            NAME: "Code phrase",
            RM_TYPE: "CODE_PHRASE",
          },
          inputs: {
            FLD_terminology_id: {
              block: {
                type: "text",
                id: nextId("tid"),
                fields: { TEXT: codeSystem },
              },
            },
            FLD_code_string: {
              block: {
                type: "text",
                id: nextId("cs"),
                fields: { TEXT: code },
              },
            },
          },
        },
      },
    },
  };

  block.inputs.VALUE = { block: codedShell };
  return doc;
}

/**
 * Emit a constrained, strictly verifiable Blockly expression block tree
 * (scale/offset, trim, concat, or fallback default) — never raw unverified JS.
 */
export function setSimpleExpression(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  exprSpec: SimpleExpressionSpec,
  rmDatatypeOverride?: string,
): BlocklyWorkspaceJson {
  const { doc, shell, inputName } = resolveWritableSlot(
    docJson,
    targetBlockId,
    rmDatatypeOverride,
  );

  let exprBlock: BlocklyBlockJson;

  if (exprSpec.kind === "scale_offset") {
    let inner: BlocklyBlockJson = sourceQueryBlockJson(exprSpec.sourcePath.trim(), "number");
    if (exprSpec.multiplier !== undefined && exprSpec.multiplier !== 1) {
      inner = {
        type: "math_arithmetic",
        id: nextId("mul"),
        fields: { OP: "MULTIPLY" },
        inputs: {
          A: { block: inner },
          B: {
            block: {
              type: "math_number",
              id: nextId("num"),
              fields: { NUM: exprSpec.multiplier },
            },
          },
        },
      };
    }
    if (exprSpec.offset !== undefined && exprSpec.offset !== 0) {
      inner = {
        type: "math_arithmetic",
        id: nextId("add"),
        fields: { OP: "ADD" },
        inputs: {
          A: { block: inner },
          B: {
            block: {
              type: "math_number",
              id: nextId("num"),
              fields: { NUM: exprSpec.offset },
            },
          },
        },
      };
    }
    exprBlock = inner;
  } else if (exprSpec.kind === "trim") {
    exprBlock = {
      type: "text_trim",
      id: nextId("trim"),
      fields: { MODE: "BOTH" },
      inputs: {
        TEXT: { block: sourceQueryBlockJson(exprSpec.sourcePath.trim(), "string") },
      },
    };
  } else if (exprSpec.kind === "concat") {
    const inputs: Record<string, { block: BlocklyBlockJson }> = {};
    exprSpec.parts.forEach((part, idx) => {
      inputs[`ADD${idx}`] = {
        block: part.kind === "source"
          ? sourceQueryBlockJson(part.path.trim(), "string")
          : { type: "text", id: nextId("txt"), fields: { TEXT: part.text } },
      };
    });
    exprBlock = {
      type: "text_join",
      id: nextId("join"),
      extraState: { itemCount: exprSpec.parts.length },
      inputs,
    };
  } else {
    // Fallback default: if (source != "") then source else fallback
    const ret = exprSpec.returnType ?? "string";
    const fallbackBlock: BlocklyBlockJson = ret === "number"
      ? { type: "math_number", id: nextId("num"), fields: { NUM: Number(exprSpec.fallbackValue) || 0 } }
      : { type: "text", id: nextId("txt"), fields: { TEXT: exprSpec.fallbackValue } };
    exprBlock = {
      type: "logic_ternary",
      id: nextId("fb"),
      inputs: {
        IF: {
          block: {
            type: "logic_compare",
            id: nextId("cmp"),
            fields: { OP: "NEQ" },
            inputs: {
              A: { block: sourceQueryBlockJson(exprSpec.sourcePath.trim(), "string") },
              B: { block: { type: "text", id: nextId("empty"), fields: { TEXT: "" } } },
            },
          },
        },
        THEN: { block: sourceQueryBlockJson(exprSpec.sourcePath.trim(), ret) },
        ELSE: { block: fallbackBlock },
      },
    };
  }

  shell.inputs![inputName] = { block: exprBlock };
  return doc;
}

/**
 * Clear the mapped expression on `targetBlockId` while preserving its structural shell.
 */
export function clearMapping(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
): BlocklyWorkspaceJson {
  const synth = parseSyntheticFieldId(targetBlockId);
  if (synth) {
    const { doc, block } = cloneAndFind(docJson, synth.parentId);
    if (block.inputs && synth.inputName in block.inputs) {
      delete block.inputs[synth.inputName];
    }
    return doc;
  }
  const { doc, block } = cloneAndFind(docJson, targetBlockId);
  if (block.type === "element") {
    const shell = block.inputs?.VALUE?.block;
    if (shell?.inputs) {
      for (const key of Object.keys(shell.inputs)) {
        if (
          key === "FLD_value" ||
          key === "FLD_magnitude" ||
          key === "FLD_numerator" ||
          key === "FLD_id" ||
          key === "FLD_defining_code"
        ) {
          delete shell.inputs[key];
        }
      }
    }
    clearAiReviewData(block);
  } else if (
    block.type === "target_value" ||
    block.type === "json_value" ||
    block.type === "json_boolean" ||
    block.type === "xml_attribute"
  ) {
    if (block.inputs?.VALUE) delete block.inputs.VALUE;
    clearAiReviewData(block);
  }
  return doc;
}

function markAiReviewedOnBlock(block: BlocklyBlockJson, nowIso: string): boolean {
  if (!block.data || typeof block.data !== "string") return false;
  try {
    const parsed = JSON.parse(block.data);
    if (!parsed || typeof parsed !== "object" || !parsed.aiReview) return false;
    const review = parsed.aiReview as Record<string, unknown>;
    if (review.outcome) return false;
    review.outcome = "reviewed";
    review.outcomeAt = nowIso;
    block.data = JSON.stringify(parsed);
    return true;
  } catch {
    return false;
  }
}

function clearAiReviewData(block: BlocklyBlockJson): boolean {
  if (!block.data || typeof block.data !== "string") return false;
  try {
    const parsed = JSON.parse(block.data);
    if (!parsed || typeof parsed !== "object" || !parsed.aiReview) return false;
    delete parsed.aiReview;
    if (Object.keys(parsed).length === 0) delete block.data;
    else block.data = JSON.stringify(parsed);
    return true;
  } catch {
    return false;
  }
}

function blockHasActiveAiReview(block: BlocklyBlockJson | undefined): boolean {
  if (!block) return false;
  if (block.data && typeof block.data === "string") {
    try {
      const parsed = JSON.parse(block.data);
      if (parsed?.aiReview && !parsed.aiReview.outcome) return true;
    } catch {
      // ignore
    }
  }
  if (block.inputs) {
    for (const inp of Object.values(block.inputs)) {
      if (blockHasActiveAiReview(inp.block)) return true;
    }
  }
  return false;
}

/**
 * Accept AI suggestion(s) on `targetBlockId` (or recursively across a container subtree).
 * Marks `aiReview.outcome = "reviewed"` in `block.data` so it transitions from
 * `ai-draft` to `mapped` while retaining provenance.
 */
export function acceptAiSuggestion(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  options?: { recursive?: boolean },
): BlocklyWorkspaceJson {
  const { doc, block } = cloneAndFind(docJson, targetBlockId);
  const nowIso = new Date().toISOString();
  const recursive = options?.recursive ?? (block.type !== "element");

  function walk(b: BlocklyBlockJson | undefined, followNext: boolean): void {
    if (!b) return;
    markAiReviewedOnBlock(b, nowIso);
    if (b.inputs) {
      for (const inp of Object.values(b.inputs)) {
        if (recursive || b.type === "element" || b.type.startsWith("dv_")) {
          walk(inp.block, true);
        }
      }
    }
    if (followNext && b.next?.block) {
      walk(b.next.block, true);
    }
  }

  walk(block, false);
  return doc;
}

/**
 * Reject AI suggestion(s) on `targetBlockId` (or recursively across a container subtree).
 * Clears the AI-suggested expression(s) and removes the `aiReview` marker.
 */
export function rejectAiSuggestion(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  options?: { recursive?: boolean },
): BlocklyWorkspaceJson {
  const { doc, block } = cloneAndFind(docJson, targetBlockId);
  const recursive = options?.recursive ?? (block.type !== "element");

  function clearElementIfAi(el: BlocklyBlockJson): void {
    if (!blockHasActiveAiReview(el)) return;
    clearAiReviewData(el);
    const shell = el.inputs?.VALUE?.block;
    if (shell?.inputs) {
      for (const [k, inp] of Object.entries(shell.inputs)) {
        if (blockHasActiveAiReview(inp.block)) {
          delete shell.inputs[k];
        }
      }
    }
  }

  function walk(b: BlocklyBlockJson | undefined, followNext: boolean): void {
    if (!b) return;
    if (b.type === "element") {
      clearElementIfAi(b);
    } else if (recursive && b.inputs) {
      for (const inp of Object.values(b.inputs)) {
        walk(inp.block, true);
      }
    }
    if (followNext && b.next?.block) {
      walk(b.next.block, true);
    }
  }

  walk(block, false);
  return doc;
}
