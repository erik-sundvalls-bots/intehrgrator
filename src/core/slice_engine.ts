/**
 * Canonical Blockly JSON indexing, adaptive slicing (3B), and lossless
 * extract/graft (Invariant A) for large openEHR templates.
 *
 * Pure TypeScript with zero DOM dependencies: operates directly on Blockly
 * serialization JSON (`ProjectBundle.mapping.blocklyState`).
 */

export const SLICE_NODE_THRESHOLD = 70;
export const TREEMAP_AUTO_THRESHOLD = 400;

export type TileStatus =
  | "unmapped"
  | "mandatory-missing"
  | "ai-draft"
  | "mapped"
  | "validation-error"
  | "unscaffolded-optional";

export interface BlocklyBlockJson {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  collapsed?: boolean;
  inline?: boolean;
  data?: string;
  extraState?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }>;
  next?: { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson };
  [key: string]: unknown;
}

export interface BlocklyVariableJson {
  name: string;
  id: string;
  type?: string;
}

export interface BlocklyWorkspaceJson {
  blocks?: {
    languageVersion?: number;
    blocks?: BlocklyBlockJson[];
  };
  variables?: BlocklyVariableJson[];
  [key: string]: unknown;
}

export type JsonBlockPathStep =
  | { kind: "top"; index: number }
  | { kind: "input"; inputName: string; slot: "block" | "shadow" }
  | { kind: "next"; slot: "block" | "shadow" };

export interface StatusCounts {
  totalLeaves: number;
  mappedLeaves: number;
  mandatoryMissingLeaves: number;
  aiDraftLeaves: number;
  unmappedLeaves: number;
  validationErrorLeaves: number;
}

export interface IndexedBlockNode {
  id: string;
  type: string;
  rmType: string;
  label: string;
  slotId: string;
  archetypeNodeId: string;
  mandatory: boolean;
  valueRmType: string;
  parentId: string | null;
  parentInput: string | null;
  children: string[];
  /** Total Blockly blocks inside this node's subtree (excluding its outer `.next` siblings). */
  subtreeBlockCount: number;
  status: TileStatus;
  counts: StatusCounts;
  mappingSummary: string;
  hasAiDraft: boolean;
  aiConfidence?: number;
  aiNote?: string;
  collapsed: boolean;
  path: JsonBlockPathStep[];
}

export interface DocumentIndex {
  nodes: Map<string, IndexedBlockNode>;
  roots: string[];
  totalBlocks: number;
  compositionId: string | null;
  /** Primary root for Treemap / Scoped Blockly (COMPOSITION, schema instanceRoot, or first root). */
  primaryRootId: string | null;
}

export const SYNTHETIC_FIELD_SEP = "::";

/** Parse a synthetic inlined schema-field id (`${parentBlockId}::${inputName}`). */
export function parseSyntheticFieldId(
  id: string,
): { parentId: string; inputName: string } | null {
  const sep = id.indexOf(SYNTHETIC_FIELD_SEP);
  if (sep <= 0 || sep + SYNTHETIC_FIELD_SEP.length >= id.length) return null;
  return {
    parentId: id.slice(0, sep),
    inputName: id.slice(sep + SYNTHETIC_FIELD_SEP.length),
  };
}

export const LEAF_NODE_TYPES = new Set([
  "element",
  "schema_field",
  "target_value",
  "json_value",
  "json_boolean",
  "json_null",
  "xml_attribute",
  "xml_text",
]);

export function isLeafNodeType(type: string): boolean {
  return LEAF_NODE_TYPES.has(type);
}

export interface SliceHandle {
  targetBlockId: string;
  path: JsonBlockPathStep[];
  severedNext?: { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson };
  originalCoords: { x?: number; y?: number };
  autoCollapsedIds: string[];
}

export interface ExtractSliceOptions {
  /** Auto-collapse unmapped optional CLUSTER blocks inside the slice (4B). */
  collapseUnmappedOptionalClusters?: boolean;
}

export interface ExtractedSlice {
  sliceJson: BlocklyWorkspaceJson;
  handle: SliceHandle;
}

const ENTRY_RM_TYPES = new Set([
  "OBSERVATION",
  "EVALUATION",
  "INSTRUCTION",
  "ACTION",
  "ADMIN_ENTRY",
  "ENTRY",
  "EVENT_CONTEXT",
]);

const STRUCTURAL_CONTAINER_TYPES = new Set([
  "composition",
  "section",
  "observation",
  "evaluation",
  "instruction",
  "action",
  "admin_entry",
  "entry",
  "event_context",
  "history",
  "point_event",
  "interval_event",
  "event",
  "item_tree",
  "item_list",
  "item_single",
  "item_table",
  "cluster",
  "activity",
  "ism_transition",
  "careflow_step",
  "include_when",
  "for_each_list",
]);

const GENERIC_VALUE_LEAF_TYPES = new Set([
  "target_value",
  "json_value",
  "json_boolean",
  "json_null",
  "xml_attribute",
]);

function isSchemaContainerBlock(block: BlocklyBlockJson): boolean {
  const t = block.type;
  return (
    t === "target_structure" ||
    t.startsWith("schema_") ||
    t === "json_object" ||
    t === "json_array" ||
    t === "xml_element" ||
    t === "xml_document"
  );
}

function isGenericValueLeafBlock(block: BlocklyBlockJson): boolean {
  return GENERIC_VALUE_LEAF_TYPES.has(block.type);
}

const SOURCE_QUERY_TYPES = new Set([
  "source_query",
  "source_query_number",
  "source_query_boolean",
  "source_query_node",
]);

const PLACEHOLDER_PATHS = new Set(["", "/path"]);

function emptyCounts(): StatusCounts {
  return {
    totalLeaves: 0,
    mappedLeaves: 0,
    mandatoryMissingLeaves: 0,
    aiDraftLeaves: 0,
    unmappedLeaves: 0,
    validationErrorLeaves: 0,
  };
}

function addCounts(target: StatusCounts, source: StatusCounts): void {
  target.totalLeaves += source.totalLeaves;
  target.mappedLeaves += source.mappedLeaves;
  target.mandatoryMissingLeaves += source.mandatoryMissingLeaves;
  target.aiDraftLeaves += source.aiDraftLeaves;
  target.unmappedLeaves += source.unmappedLeaves;
  target.validationErrorLeaves += source.validationErrorLeaves;
}

function readAiReviewFromJson(
  block: BlocklyBlockJson,
): { active: boolean; confidence?: number; note?: string } {
  if (!block.data || typeof block.data !== "string") return { active: false };
  try {
    const parsed = JSON.parse(block.data);
    if (!parsed || typeof parsed !== "object") return { active: false };
    const review = (parsed as Record<string, unknown>).aiReview;
    if (!review || typeof review !== "object") return { active: false };
    const r = review as Record<string, unknown>;
    if (r.outcome === "reviewed" || r.outcome === "edited") {
      return { active: false };
    }
    const confidence = typeof r.confidence === "number" ? r.confidence : undefined;
    const note = typeof r.note === "string" && r.note.trim() ? r.note.trim() : undefined;
    if (confidence === undefined && !note) return { active: false };
    return { active: true, confidence, note };
  } catch {
    return { active: false };
  }
}

/** Count all blocks in `block` including its inputs and `.next` chain. */
export function countBlocksWithNext(block: BlocklyBlockJson | undefined): number {
  if (!block) return 0;
  let count = 1;
  if (block.inputs) {
    for (const input of Object.values(block.inputs)) {
      if (input.block) count += countBlocksWithNext(input.block);
      if (input.shadow) count += countBlocksWithNext(input.shadow);
    }
  }
  if (block.next?.block) count += countBlocksWithNext(block.next.block);
  if (block.next?.shadow) count += countBlocksWithNext(block.next.shadow);
  return count;
}

/** Count all blocks inside `block` (its inputs, NOT its outer `.next` siblings). */
export function countSubtreeBlocks(block: BlocklyBlockJson | undefined): number {
  if (!block) return 0;
  let count = 1;
  if (block.inputs) {
    for (const input of Object.values(block.inputs)) {
      if (input.block) count += countBlocksWithNext(input.block);
      if (input.shadow) count += countBlocksWithNext(input.shadow);
    }
  }
  return count;
}

interface LeafAnalysis {
  mapped: boolean;
  summary: string;
  hasAiDraft: boolean;
  aiConfidence?: number;
  aiNote?: string;
}

function analyzeValueSubtree(block: BlocklyBlockJson | undefined): LeafAnalysis {
  if (!block) return { mapped: false, summary: "", hasAiDraft: false };

  const review = readAiReviewFromJson(block);
  let hasAiDraft = review.active;
  let aiConfidence = review.confidence;
  let aiNote = review.note;

  const fields = block.fields ?? {};
  const t = block.type;

  if (SOURCE_QUERY_TYPES.has(t)) {
    const expr = String(fields.EXPRESSION ?? "").trim();
    const mapped = !PLACEHOLDER_PATHS.has(expr);
    return {
      mapped,
      summary: mapped ? expr : "",
      hasAiDraft,
      aiConfidence,
      aiNote,
    };
  }

  if (t === "maps_get") {
    const mapName = String(fields.NAME ?? "defaults").trim();
    const keyBlock = block.inputs?.KEY?.block ?? block.inputs?.KEY?.shadow;
    const keyVal = keyBlock?.fields?.TEXT !== undefined
      ? String(keyBlock.fields.TEXT)
      : String(fields.KEY ?? "");
    const summary = keyVal ? `${mapName}.${keyVal}` : mapName;
    return { mapped: Boolean(keyVal), summary, hasAiDraft, aiConfidence, aiNote };
  }

  if (t === "term_pick") {
    const code = String(fields.CODE ?? fields.VALUE ?? "").trim();
    const mapped = Boolean(code && code !== "__none__");
    return {
      mapped,
      summary: mapped ? code : "",
      hasAiDraft,
      aiConfidence,
      aiNote,
    };
  }

  if (t === "text" || t === "text_code") {
    const text = String(fields.TEXT ?? "").trim();
    const compact = text.replace(/\s+/g, " ");
    const clipped = compact.length > 44 ? `${compact.slice(0, 41)}…` : compact;
    return {
      mapped: text.length > 0,
      summary: text.length > 0 ? (t === "text_code" ? clipped : JSON.stringify(clipped)) : "",
      hasAiDraft,
      aiConfidence,
      aiNote,
    };
  }

  if (t === "math_number") {
    const num = fields.NUM;
    const mapped = num !== undefined && num !== "";
    return {
      mapped,
      summary: mapped ? String(num) : "",
      hasAiDraft,
      aiConfidence,
      aiNote,
    };
  }

  if (t === "logic_boolean") {
    const boolVal = String(fields.BOOL ?? "TRUE").toLowerCase();
    return { mapped: true, summary: boolVal, hasAiDraft, aiConfidence, aiNote };
  }

  if (
    t === "decision_table" ||
    t === "decision_table_eval" ||
    t === "sheet_lookup" ||
    t.startsWith("sheet_get_") ||
    t === "variables_get" ||
    t === "procedures_callreturn" ||
    t === "logic_ternary" ||
    t === "logic_compare" ||
    t === "logic_operation" ||
    t === "math_arithmetic" ||
    t === "text_join" ||
    t === "text_trim" ||
    t === "text_handlebars" ||
    t === "logic_list_restriction" ||
    t === "lists_create_with"
  ) {
    let summary: string;
    if (t === "decision_table") {
      const dtName = String(fields.NAME ?? "").trim();
      const dtOut = String(fields.OUTPUT ?? "").trim();
      summary = dtName && dtOut ? `${dtName}.${dtOut}` : (dtName || "decision_table");
    } else if (t === "variables_get") {
      summary = `$${String(fields.VAR ?? "")}`;
    } else if (t === "procedures_callreturn") {
      summary = `${String(block.extraState?.name ?? "fn")}()`;
    } else {
      summary = t;
    }
    // Still check descendants for AI review markers.
    if (block.inputs) {
      for (const inp of Object.values(block.inputs)) {
        const sub = analyzeValueSubtree(inp.block);
        if (sub.hasAiDraft && !hasAiDraft) {
          hasAiDraft = true;
          aiConfidence = sub.aiConfidence;
          aiNote = sub.aiNote;
        }
      }
    }
    return { mapped: true, summary, hasAiDraft, aiConfidence, aiNote };
  }

  // DV_* shell or wrapper: inspect inputs for any mapped child.
  const summaries: string[] = [];
  let anyMapped = false;
  if (block.inputs) {
    for (const [inputName, inp] of Object.entries(block.inputs)) {
      if (!inp.block) continue;
      const sub = analyzeValueSubtree(inp.block);
      if (sub.hasAiDraft && !hasAiDraft) {
        hasAiDraft = true;
        aiConfidence = sub.aiConfidence;
        aiNote = sub.aiNote;
      }
      // Fixed unit/terminology metadata alone does not make an empty DV_* slot mapped.
      if (inputName === "FLD_units" || inputName === "FLD_terminology_id") continue;
      if (sub.mapped) {
        anyMapped = true;
        if (sub.summary) {
          summaries.push(
            inputName === "VALUE" || inputName === "ATTR_value" || inputName === "FLD_value"
              ? sub.summary
              : `${inputName.replace(/^(ATTR_|FLD_)/, "")}=${sub.summary}`,
          );
        }
      }
    }
  }
  return {
    mapped: anyMapped,
    summary: summaries.slice(0, 2).join(", "),
    hasAiDraft,
    aiConfidence,
    aiNote,
  };
}

interface SchemaFieldSpecJson {
  name?: string;
  kind?: string;
  check?: string | string[];
  card?: { min?: number; max?: number | null };
  slotId?: string;
  xmlKind?: string;
  childBlockType?: string;
}

function schemaHasXmlMetadata(block: BlocklyBlockJson): boolean {
  const extra = block.extraState;
  if (!extra || typeof extra !== "object") return false;
  if (Array.isArray(extra.xmlAttributes) && extra.xmlAttributes.length > 0) return true;
  const fields = Array.isArray(extra.fields) ? (extra.fields as SchemaFieldSpecJson[]) : [];
  return fields.some((f) => f?.xmlKind === "element" || f?.xmlKind === "attribute");
}

function deriveRmType(block: BlocklyBlockJson): string {
  const fields = block.fields ?? {};
  const fromField = typeof fields.RM_TYPE === "string" && fields.RM_TYPE.trim()
    ? fields.RM_TYPE.trim().toUpperCase()
    : "";
  if (block.type === "element") return "ELEMENT";
  if (fromField && !fromField.startsWith("DV_")) return fromField;
  if (typeof block.extraState?.rmType === "string" && block.extraState.rmType.trim()) {
    return block.extraState.rmType.trim().toUpperCase();
  }
  if (block.type === "xml_element" || block.type === "xml_document") return "XML_ELEMENT";
  if (block.type === "xml_attribute") return "XML_ATTRIBUTE";
  if (block.type === "json_object") return "JSON_OBJECT";
  if (block.type === "json_array") return "JSON_ARRAY";
  if (isGenericValueLeafBlock(block)) return "SCHEMA_FIELD";
  if (block.type === "target_structure" || block.type.startsWith("schema_")) {
    const targetType = String(fields.TARGET_TYPE ?? "").trim().toLowerCase();
    if (schemaHasXmlMetadata(block)) return "XML_ELEMENT";
    if (targetType === "array") return "JSON_ARRAY";
    if (targetType === "object") return "JSON_OBJECT";
    return "SCHEMA_OBJECT";
  }
  return block.type.toUpperCase();
}

const DISCRIMINATOR_INPUT_KEYS = [
  "TARGET_TermId",
  "TARGET_termId",
  "TARGET_Id",
  "TARGET_id",
  "TARGET_Key",
  "TARGET_key",
  "TARGET_Code",
  "TARGET_code",
];

function schemaDiscriminatorSuffix(block: BlocklyBlockJson): string {
  if (!block.type.startsWith("schema_") || !block.inputs) return "";
  for (const key of DISCRIMINATOR_INPUT_KEYS) {
    const inp = block.inputs[key]?.block;
    if (!inp) continue;
    const analysis = analyzeValueSubtree(inp);
    if (analysis.mapped && analysis.summary) {
      const cleaned = analysis.summary.replace(/^"|"$/g, "").trim();
      if (cleaned && cleaned.length <= 28) return cleaned;
    }
  }
  return "";
}

function deriveLabel(block: BlocklyBlockJson, rmType: string): string {
  const fields = block.fields ?? {};
  const name = typeof fields.NAME === "string" ? fields.NAME.trim() : "";
  if (name) {
    const disc = schemaDiscriminatorSuffix(block);
    if (disc && !name.includes(disc)) return `${name} · ${disc}`;
    return name;
  }
  const arch = typeof fields.ARCHETYPE_NODE_ID === "string" ? fields.ARCHETYPE_NODE_ID.trim() : "";
  if (arch) return arch;
  return rmType.replace(/_/g, " ");
}

function isStructuralNode(block: BlocklyBlockJson): boolean {
  if (block.type === "element") return true;
  if (STRUCTURAL_CONTAINER_TYPES.has(block.type)) return true;
  if (isSchemaContainerBlock(block) || isGenericValueLeafBlock(block)) return true;
  const rm = deriveRmType(block);
  return ENTRY_RM_TYPES.has(rm) || rm === "SECTION" || rm === "CLUSTER" || rm === "COMPOSITION";
}

function applyLeafAnalysisToNode(
  node: IndexedBlockNode,
  analysis: LeafAnalysis,
  ownerReview: { active: boolean; confidence?: number; note?: string },
  validationErrorIds?: ReadonlySet<string>,
): void {
  const hasAiDraft = analysis.hasAiDraft || ownerReview.active;
  const hasError = Boolean(
    validationErrorIds?.has(node.id) || (node.slotId && validationErrorIds?.has(node.slotId)),
  );

  node.mappingSummary = analysis.summary;
  node.hasAiDraft = hasAiDraft;
  node.aiConfidence = analysis.aiConfidence ?? ownerReview.confidence;
  node.aiNote = analysis.aiNote ?? ownerReview.note;

  if (hasError) {
    node.status = "validation-error";
    node.counts = {
      totalLeaves: 1,
      mappedLeaves: analysis.mapped ? 1 : 0,
      mandatoryMissingLeaves: !analysis.mapped && node.mandatory ? 1 : 0,
      aiDraftLeaves: hasAiDraft ? 1 : 0,
      unmappedLeaves: analysis.mapped ? 0 : 1,
      validationErrorLeaves: 1,
    };
  } else if (hasAiDraft) {
    node.status = "ai-draft";
    node.counts = {
      totalLeaves: 1,
      mappedLeaves: 0,
      mandatoryMissingLeaves: 0,
      aiDraftLeaves: 1,
      unmappedLeaves: 0,
      validationErrorLeaves: 0,
    };
  } else if (analysis.mapped) {
    node.status = "mapped";
    node.counts = {
      totalLeaves: 1,
      mappedLeaves: 1,
      mandatoryMissingLeaves: 0,
      aiDraftLeaves: 0,
      unmappedLeaves: 0,
      validationErrorLeaves: 0,
    };
  } else if (node.mandatory) {
    node.status = "mandatory-missing";
    node.counts = {
      totalLeaves: 1,
      mappedLeaves: 0,
      mandatoryMissingLeaves: 1,
      aiDraftLeaves: 0,
      unmappedLeaves: 1,
      validationErrorLeaves: 0,
    };
  } else {
    node.status = "unmapped";
    node.counts = {
      totalLeaves: 1,
      mappedLeaves: 0,
      mandatoryMissingLeaves: 0,
      aiDraftLeaves: 0,
      unmappedLeaves: 1,
      validationErrorLeaves: 0,
    };
  }
}

function collectSchemaFieldEntries(
  block: BlocklyBlockJson,
): Array<{
  inputName: string;
  name: string;
  mandatory: boolean;
  slotId: string;
  valueRmType: string;
  xmlKind?: string;
  isContainerSlot: boolean;
}> {
  const entries: Array<{
    inputName: string;
    name: string;
    mandatory: boolean;
    slotId: string;
    valueRmType: string;
    xmlKind?: string;
    isContainerSlot: boolean;
  }> = [];
  const seenInputs = new Set<string>();
  const extra = block.extraState ?? {};
  const inputs = block.inputs ?? {};

  const pushSpec = (spec: SchemaFieldSpecJson, isOptional: boolean) => {
    const fieldName = typeof spec?.name === "string" ? spec.name.trim() : "";
    if (!fieldName) return;
    const preferredInput = isOptional ? `SCHEMA_OPT_${fieldName}` : `TARGET_${fieldName}`;
    const altInput = isOptional ? `TARGET_${fieldName}` : `SCHEMA_OPT_${fieldName}`;
    const inputName = inputs[preferredInput]
      ? preferredInput
      : (inputs[altInput] ? altInput : preferredInput);
    if (seenInputs.has(inputName)) return;
    seenInputs.add(inputName);
    const connected = inputs[inputName]?.block;
    const isContainerSlot = Boolean(
      spec.childBlockType ||
        spec.kind === "statement" ||
        (connected && isStructuralNode(connected)),
    );
    const checkVal = Array.isArray(spec.check) ? spec.check[0] : spec.check;
    entries.push({
      inputName,
      name: fieldName,
      mandatory: !isOptional && Boolean(spec.card && (spec.card.min ?? 0) >= 1),
      slotId: typeof spec.slotId === "string" ? spec.slotId : "",
      valueRmType: typeof checkVal === "string" && checkVal ? checkVal : "String",
      xmlKind: spec.xmlKind,
      isContainerSlot,
    });
  };

  if (Array.isArray(extra.fields)) {
    for (const spec of extra.fields as SchemaFieldSpecJson[]) {
      pushSpec(spec, false);
    }
  }
  const activeExtras = new Set(
    Array.isArray(extra.extras) ? (extra.extras as unknown[]).map((v) => String(v)) : [],
  );
  if (Array.isArray(extra.optionalFields)) {
    for (const spec of extra.optionalFields as SchemaFieldSpecJson[]) {
      if (spec?.name && activeExtras.has(spec.name)) {
        pushSpec(spec, true);
      }
    }
  }

  // Defensive fallback for any TARGET_* / SCHEMA_OPT_* input not listed in extraState.
  for (const [inputName, inp] of Object.entries(inputs)) {
    if (seenInputs.has(inputName)) continue;
    if (!inputName.startsWith("TARGET_") && !inputName.startsWith("SCHEMA_OPT_")) continue;
    seenInputs.add(inputName);
    const connected = inp?.block;
    const isContainerSlot = Boolean(connected && isStructuralNode(connected));
    const name = inputName.replace(/^(?:TARGET_|SCHEMA_OPT_)/, "");
    entries.push({
      inputName,
      name,
      mandatory: false,
      slotId: "",
      valueRmType: "String",
      isContainerSlot,
    });
  }

  return entries;
}

/**
 * Build a fast structural index over canonical Blockly workspace JSON.
 *
 * Indexes openEHR structural nodes (`COMPOSITION`, `SECTION`, `ENTRY`
 * subclasses, `CLUSTER`, `ELEMENT`, `EVENT_CONTEXT`, `HISTORY`, `EVENT`,
 * `ITEM_TREE`, `include_when`, `for_each_list`) as well as JSON Schema and
 * XML Schema container/leaf blocks (`schema_*`, `target_structure`,
 * `json_*`, `xml_*`, `target_value`) with O(N) single-pass traversal.
 */
export function indexDocument(
  docJson: BlocklyWorkspaceJson | null | undefined,
  validationErrorIds?: ReadonlySet<string>,
): DocumentIndex {
  const nodes = new Map<string, IndexedBlockNode>();
  const roots: string[] = [];
  let compositionId: string | null = null;
  let instanceRootId: string | null = null;
  let totalBlocks = 0;
  let syntheticCounter = 0;

  const topBlocks = docJson?.blocks?.blocks ?? [];

  function walkBlock(
    block: BlocklyBlockJson,
    path: JsonBlockPathStep[],
    parentId: string | null,
    parentInput: string | null,
  ): void {
    const id = block.id || `__anon_${++syntheticCounter}`;
    const structural = isStructuralNode(block);

    let activeParentId = parentId;
    let handledPrimitiveInputs: Set<string> | null = null;
    let isLeafBlock = false;

    if (structural) {
      const rmType = deriveRmType(block);
      const fields = block.fields ?? {};
      const slotId = String(fields.ELEMENT_SLOT_ID ?? fields.SLOT_ID ?? "");
      const archetypeNodeId = String(fields.ARCHETYPE_NODE_ID ?? "");
      const mandatory = String(fields.MANDATORY ?? "") === "1";
      const valueRmType = String(fields.VALUE_RM_TYPE ?? "");
      const label = deriveLabel(block, rmType);
      const subtreeBlockCount = countSubtreeBlocks(block);

      const node: IndexedBlockNode = {
        id,
        type: block.type,
        rmType,
        label,
        slotId,
        archetypeNodeId,
        mandatory,
        valueRmType,
        parentId,
        parentInput,
        children: [],
        subtreeBlockCount,
        status: "unmapped",
        counts: emptyCounts(),
        mappingSummary: "",
        hasAiDraft: false,
        collapsed: Boolean(block.collapsed),
        path: [...path],
      };

      if (rmType === "COMPOSITION" && !compositionId) {
        compositionId = id;
      }
      if (
        !instanceRootId &&
        parentId === null &&
        (block.extraState?.instanceRoot === true || isSchemaContainerBlock(block))
      ) {
        instanceRootId = id;
      }

      if (block.type === "element") {
        isLeafBlock = true;
        const analysis = analyzeValueSubtree(block.inputs?.VALUE?.block);
        applyLeafAnalysisToNode(node, analysis, readAiReviewFromJson(block), validationErrorIds);
      } else if (isGenericValueLeafBlock(block)) {
        isLeafBlock = true;
        const analysis: LeafAnalysis = block.type === "json_null"
          ? { mapped: true, summary: "null", hasAiDraft: false }
          : analyzeValueSubtree(block.inputs?.VALUE?.block);
        applyLeafAnalysisToNode(node, analysis, readAiReviewFromJson(block), validationErrorIds);
      }

      nodes.set(id, node);
      if (parentId && nodes.has(parentId)) {
        nodes.get(parentId)!.children.push(id);
      } else {
        roots.push(id);
      }
      activeParentId = id;

      // For schema_* / target_structure blocks, synthesize leaf nodes for
      // inlined primitive TARGET_* / SCHEMA_OPT_* inputs.
      if (block.type === "target_structure" || block.type.startsWith("schema_")) {
        handledPrimitiveInputs = new Set<string>();
        const ownerReview = readAiReviewFromJson(block);
        for (const entry of collectSchemaFieldEntries(block)) {
          if (entry.isContainerSlot) continue;
          handledPrimitiveInputs.add(entry.inputName);
          const connected = block.inputs?.[entry.inputName]?.block;
          const fieldId = `${id}${SYNTHETIC_FIELD_SEP}${entry.inputName}`;
          const fieldNode: IndexedBlockNode = {
            id: fieldId,
            type: "schema_field",
            rmType: entry.xmlKind === "attribute" ? "XML_ATTRIBUTE" : "SCHEMA_FIELD",
            label: entry.name,
            slotId: entry.slotId,
            archetypeNodeId: "",
            mandatory: entry.mandatory,
            valueRmType: entry.valueRmType,
            parentId: id,
            parentInput: entry.inputName,
            children: [],
            subtreeBlockCount: connected ? countBlocksWithNext(connected) : 0,
            status: "unmapped",
            counts: emptyCounts(),
            mappingSummary: "",
            hasAiDraft: false,
            collapsed: false,
            path: [...path, { kind: "input", inputName: entry.inputName, slot: "block" }],
          };
          const analysis = analyzeValueSubtree(connected);
          applyLeafAnalysisToNode(fieldNode, analysis, ownerReview, validationErrorIds);
          nodes.set(fieldId, fieldNode);
          node.children.push(fieldId);
        }
      } else if (block.type === "xml_element" && block.inputs?.VALUE?.block) {
        const hasChildContainers = Boolean(
          block.inputs.TARGET_children?.block || block.inputs.TARGET_attributes?.block,
        );
        if (!hasChildContainers) {
          // Leaf xml_element with inline VALUE expression.
          isLeafBlock = true;
          const analysis = analyzeValueSubtree(block.inputs.VALUE.block);
          applyLeafAnalysisToNode(node, analysis, readAiReviewFromJson(block), validationErrorIds);
        } else {
          handledPrimitiveInputs = new Set(["VALUE"]);
          const fieldId = `${id}${SYNTHETIC_FIELD_SEP}VALUE`;
          const fieldNode: IndexedBlockNode = {
            id: fieldId,
            type: "schema_field",
            rmType: "SCHEMA_FIELD",
            label: "#text",
            slotId: slotId ? `${slotId}/#text` : "",
            archetypeNodeId: "",
            mandatory: false,
            valueRmType: "String",
            parentId: id,
            parentInput: "VALUE",
            children: [],
            subtreeBlockCount: countBlocksWithNext(block.inputs.VALUE.block),
            status: "unmapped",
            counts: emptyCounts(),
            mappingSummary: "",
            hasAiDraft: false,
            collapsed: false,
            path: [...path, { kind: "input", inputName: "VALUE", slot: "block" }],
          };
          applyLeafAnalysisToNode(
            fieldNode,
            analyzeValueSubtree(block.inputs.VALUE.block),
            readAiReviewFromJson(block),
            validationErrorIds,
          );
          nodes.set(fieldId, fieldNode);
          node.children.push(fieldId);
        }
      }
    }

    // Recurse into inputs (skip leaf blocks and already-synthesized primitive schema inputs).
    if (block.inputs && !isLeafBlock) {
      for (const [inputName, inp] of Object.entries(block.inputs)) {
        if (handledPrimitiveInputs?.has(inputName)) continue;
        if (inp.block) {
          walkBlock(
            inp.block,
            [...path, { kind: "input", inputName, slot: "block" }],
            activeParentId,
            inputName,
          );
        }
      }
    }

    // Recurse into `.next` sibling chain at the SAME parent level.
    if (block.next?.block) {
      walkBlock(
        block.next.block,
        [...path, { kind: "next", slot: "block" }],
        parentId,
        parentInput,
      );
    }
  }

  for (let i = 0; i < topBlocks.length; i++) {
    const top = topBlocks[i];
    totalBlocks += countBlocksWithNext(top);
    walkBlock(top, [{ kind: "top", index: i }], null, null);
  }

  // Bottom-up status rollup for container nodes.
  function rollup(nodeId: string): StatusCounts {
    const node = nodes.get(nodeId)!;
    if (isLeafNodeType(node.type) || (node.type === "xml_element" && node.children.length === 0)) {
      return node.counts;
    }
    const agg = emptyCounts();
    for (const childId of node.children) {
      addCounts(agg, rollup(childId));
    }
    node.counts = agg;
    const hasError = Boolean(
      validationErrorIds?.has(node.id) ||
        (node.slotId && validationErrorIds?.has(node.slotId)) ||
        agg.validationErrorLeaves > 0,
    );
    if (hasError) {
      node.status = "validation-error";
    } else if (agg.mandatoryMissingLeaves > 0) {
      node.status = "mandatory-missing";
    } else if (agg.aiDraftLeaves > 0) {
      node.status = "ai-draft";
    } else if (agg.mappedLeaves > 0) {
      node.status = "mapped";
    } else {
      node.status = "unmapped";
    }
    node.hasAiDraft = agg.aiDraftLeaves > 0;
    return agg;
  }

  for (const rootId of roots) {
    rollup(rootId);
  }

  const primaryRootId = compositionId ?? instanceRootId ?? roots[0] ?? null;
  return { nodes, roots, totalBlocks, compositionId, primaryRootId };
}

/**
 * Adaptive Scoped Blockly slice selector (Decision 3B):
 *
 * - For openEHR: default to the owning `ENTRY` (`OBSERVATION`, `EVALUATION`,
 *   `INSTRUCTION`, `ACTION`, `ADMIN_ENTRY`, `ENTRY`) or `EVENT_CONTEXT`.
 *   If that `ENTRY` exceeds `threshold` blocks (default 70), scope down to the
 *   containing `CLUSTER` (or structural container) along the path to `nodeId`
 *   that fits within `threshold`.
 * - For JSON/XML Schema: synthetic `schema_field` leaves resolve to their
 *   owning `schema_*` block; oversized containers adaptively descend to the
 *   first structural sub-container within `threshold`.
 */
export function computeAdaptiveSliceTarget(
  index: DocumentIndex,
  nodeId: string,
  threshold = SLICE_NODE_THRESHOLD,
): string {
  // Synthetic inlined schema fields (`parentId::inputName`) belong to their owning block.
  const synth = parseSyntheticFieldId(nodeId);
  const resolvedId = synth ? synth.parentId : nodeId;
  const start = index.nodes.get(resolvedId);
  if (!start) return resolvedId;

  // Build ancestor chain from root down to `start`.
  const chain: IndexedBlockNode[] = [];
  let cur: IndexedBlockNode | undefined = start;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? index.nodes.get(cur.parentId) : undefined;
  }

  // Find owning ENTRY / EVENT_CONTEXT in the ancestor chain.
  const entryIdx = chain.findIndex((n) => ENTRY_RM_TYPES.has(n.rmType));

  if (entryIdx >= 0) {
    const entry = chain[entryIdx];
    if (entry.subtreeBlockCount <= threshold) {
      return entry.id;
    }
    // Entry exceeds threshold: look for a containing CLUSTER on the path from
    // entry down to `start` that fits within `threshold`.
    const clustersOnPath = chain
      .slice(entryIdx + 1)
      .filter((n) => n.rmType === "CLUSTER" || n.type === "cluster");
    const fittingCluster = clustersOnPath.find((c) => c.subtreeBlockCount <= threshold);
    if (fittingCluster) return fittingCluster.id;
    if (clustersOnPath.length > 0) {
      return clustersOnPath[clustersOnPath.length - 1].id;
    }
    // If no CLUSTER is on the path (e.g. user clicked the oversized ENTRY itself),
    // check if any structural sub-container on the path fits.
    const fittingContainer = chain
      .slice(entryIdx + 1)
      .find((n) => !isLeafNodeType(n.type) && n.subtreeBlockCount <= threshold);
    if (fittingContainer) return fittingContainer.id;
    return entry.id;
  }

  // Node is above ENTRY (e.g. SECTION, COMPOSITION) or in a non-openEHR schema tree.
  if (start.subtreeBlockCount <= threshold) {
    return start.id;
  }

  // First prefer a descendant openEHR ENTRY (BFS).
  const queue = [...start.children];
  let firstFittingSchemaContainer: string | null = null;
  while (queue.length > 0) {
    const cid = queue.shift()!;
    const child = index.nodes.get(cid);
    if (!child) continue;
    if (ENTRY_RM_TYPES.has(child.rmType)) {
      return computeAdaptiveSliceTarget(index, child.id, threshold);
    }
    if (
      !firstFittingSchemaContainer &&
      !isLeafNodeType(child.type) &&
      child.type !== "include_when" &&
      child.type !== "for_each_list" &&
      child.subtreeBlockCount <= threshold
    ) {
      firstFittingSchemaContainer = child.id;
    }
    queue.push(...child.children);
  }

  return firstFittingSchemaContainer ?? start.id;
}

/** Locate a block and its exact path inside `docJson` by `targetBlockId`. */
export function findBlockPathById(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
): { block: BlocklyBlockJson; path: JsonBlockPathStep[] } | null {
  const topBlocks = docJson.blocks?.blocks ?? [];

  function search(
    block: BlocklyBlockJson | undefined,
    path: JsonBlockPathStep[],
  ): { block: BlocklyBlockJson; path: JsonBlockPathStep[] } | null {
    if (!block) return null;
    if (block.id === targetBlockId) return { block, path };
    if (block.inputs) {
      for (const [inputName, inp] of Object.entries(block.inputs)) {
        if (inp.block) {
          const hit = search(inp.block, [...path, { kind: "input", inputName, slot: "block" }]);
          if (hit) return hit;
        }
        if (inp.shadow) {
          const hit = search(inp.shadow, [...path, { kind: "input", inputName, slot: "shadow" }]);
          if (hit) return hit;
        }
      }
    }
    if (block.next?.block) {
      const hit = search(block.next.block, [...path, { kind: "next", slot: "block" }]);
      if (hit) return hit;
    }
    if (block.next?.shadow) {
      const hit = search(block.next.shadow, [...path, { kind: "next", slot: "shadow" }]);
      if (hit) return hit;
    }
    return null;
  }

  for (let i = 0; i < topBlocks.length; i++) {
    const hit = search(topBlocks[i], [{ kind: "top", index: i }]);
    if (hit) return hit;
  }
  return null;
}

function hasMappedDescendant(block: BlocklyBlockJson): boolean {
  if (block.type === "element") {
    return analyzeValueSubtree(block.inputs?.VALUE?.block).mapped;
  }
  if (block.inputs) {
    for (const inp of Object.values(block.inputs)) {
      let cur = inp.block;
      while (cur) {
        if (hasMappedDescendant(cur)) return true;
        cur = cur.next?.block;
      }
    }
  }
  return false;
}

function applyAutoCollapseUnmappedOptionalClusters(
  root: BlocklyBlockJson,
  autoCollapsedIds: string[],
): void {
  function walk(block: BlocklyBlockJson, isRoot: boolean): void {
    if (!isRoot && (block.type === "cluster" || deriveRmType(block) === "CLUSTER")) {
      const mandatory = String(block.fields?.MANDATORY ?? "") === "1";
      const explicitlyExpanded = block.collapsed === false;
      if (!mandatory && !explicitlyExpanded && !hasMappedDescendant(block)) {
        if (!block.collapsed && block.id) {
          block.collapsed = true;
          autoCollapsedIds.push(block.id);
        }
      }
    }
    if (block.inputs) {
      for (const inp of Object.values(block.inputs)) {
        let cur = inp.block;
        while (cur) {
          walk(cur, false);
          cur = cur.next?.block;
        }
      }
    }
  }
  walk(root, true);
}

/**
 * Invariant A — Extract a standalone slice workspace JSON rooted at `targetBlockId`.
 *
 * Severs the outer `.next` sibling chain (storing it on `SliceHandle`) and
 * copies top-level `variables` so variable references resolve identically.
 */
export function extractSlice(
  docJson: BlocklyWorkspaceJson,
  targetBlockId: string,
  options?: ExtractSliceOptions,
): ExtractedSlice {
  const found = findBlockPathById(docJson, targetBlockId);
  if (!found) {
    throw new Error(`extractSlice: block "${targetBlockId}" not found in canonical Blockly JSON`);
  }

  const clone = structuredClone(found.block);
  const severedNext = clone.next ? structuredClone(clone.next) : undefined;
  delete clone.next;

  const originalCoords: { x?: number; y?: number } = {
    x: clone.x,
    y: clone.y,
  };

  const autoCollapsedIds: string[] = [];
  if (options?.collapseUnmappedOptionalClusters) {
    applyAutoCollapseUnmappedOptionalClusters(clone, autoCollapsedIds);
  }

  clone.x = 20;
  clone.y = 20;

  const sliceJson: BlocklyWorkspaceJson = {
    blocks: {
      languageVersion: docJson.blocks?.languageVersion ?? 0,
      blocks: [clone],
    },
    ...(docJson.variables ? { variables: structuredClone(docJson.variables) } : {}),
  };

  return {
    sliceJson,
    handle: {
      targetBlockId,
      path: found.path,
      ...(severedNext ? { severedNext } : {}),
      originalCoords,
      autoCollapsedIds,
    },
  };
}

function setBlockAtPath(
  docJson: BlocklyWorkspaceJson,
  path: JsonBlockPathStep[],
  replacement: BlocklyBlockJson,
): void {
  if (path.length === 0 || path[0].kind !== "top") {
    throw new Error("graftSlice: invalid block path (must start with top-level index)");
  }
  const topBlocks = docJson.blocks?.blocks;
  if (!topBlocks || path[0].index < 0 || path[0].index >= topBlocks.length) {
    throw new Error(`graftSlice: top-level block index ${path[0].index} out of bounds`);
  }
  if (path.length === 1) {
    topBlocks[path[0].index] = replacement;
    return;
  }

  let cur: BlocklyBlockJson = topBlocks[path[0].index];
  for (let i = 1; i < path.length - 1; i++) {
    const step = path[i];
    if (step.kind === "input") {
      const next = cur.inputs?.[step.inputName]?.[step.slot];
      if (!next) throw new Error(`graftSlice: broken input path at ${step.inputName}`);
      cur = next;
    } else if (step.kind === "next") {
      const next = cur.next?.[step.slot];
      if (!next) throw new Error("graftSlice: broken next path");
      cur = next;
    } else {
      throw new Error("graftSlice: unexpected top step inside path");
    }
  }

  const last = path[path.length - 1];
  if (last.kind === "input") {
    if (!cur.inputs) cur.inputs = {};
    if (!cur.inputs[last.inputName]) cur.inputs[last.inputName] = {};
    cur.inputs[last.inputName][last.slot] = replacement;
  } else if (last.kind === "next") {
    if (!cur.next) cur.next = {};
    cur.next[last.slot] = replacement;
  } else {
    throw new Error("graftSlice: unexpected top step at end of path");
  }
}

function mergeVariables(
  canonicalVars: BlocklyVariableJson[] | undefined,
  sliceVars: BlocklyVariableJson[] | undefined,
): BlocklyVariableJson[] | undefined {
  if (!canonicalVars && !sliceVars) return undefined;
  const byId = new Map<string, BlocklyVariableJson>();
  for (const v of canonicalVars ?? []) {
    byId.set(v.id, structuredClone(v));
  }
  for (const v of sliceVars ?? []) {
    const existing = byId.get(v.id);
    if (existing) {
      // Preserve ID, apply explicit renames/type updates.
      existing.name = v.name;
      if (v.type !== undefined) existing.type = v.type;
    } else {
      byId.set(v.id, structuredClone(v));
    }
  }
  return Array.from(byId.values());
}

/**
 * Invariant A — Losslessly graft an edited slice workspace JSON back into an
 * immutable copy of canonical `docJson`.
 *
 * - Re-attaches the preserved outer `.next` chain to the tail of the edited root.
 * - Restores original coordinate presence (no spurious `x`/`y` on nested blocks).
 * - Unions/reconciles top-level `variables` without deleting variables used by
 *   other slices.
 */
export function graftSlice(
  docJson: BlocklyWorkspaceJson,
  handle: SliceHandle,
  editedSliceJson: BlocklyWorkspaceJson,
): BlocklyWorkspaceJson {
  const nextDoc = structuredClone(docJson);
  const sliceTops = editedSliceJson.blocks?.blocks ?? [];
  const rawRoot =
    sliceTops.find((b) => b.id === handle.targetBlockId) ?? sliceTops[0];
  if (!rawRoot) {
    throw new Error("graftSlice: edited slice JSON contains no root block");
  }

  const editedRoot = structuredClone(rawRoot);

  // Restore original coordinate presence so nested blocks don't acquire stray x/y.
  if (handle.originalCoords.x === undefined) delete editedRoot.x;
  else editedRoot.x = handle.originalCoords.x;
  if (handle.originalCoords.y === undefined) delete editedRoot.y;
  else editedRoot.y = handle.originalCoords.y;

  // Re-attach severed outer `.next` chain onto the tail of the edited root chain.
  if (handle.severedNext) {
    let tail: BlocklyBlockJson = editedRoot;
    while (tail.next?.block) {
      tail = tail.next.block;
    }
    tail.next = structuredClone(handle.severedNext);
  }

  setBlockAtPath(nextDoc, handle.path, editedRoot);

  const mergedVars = mergeVariables(nextDoc.variables, editedSliceJson.variables);
  if (mergedVars !== undefined) {
    nextDoc.variables = mergedVars;
  }

  return nextDoc;
}
