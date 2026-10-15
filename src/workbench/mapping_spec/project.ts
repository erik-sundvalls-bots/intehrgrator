/**
 * Project Blockly workspace JSON into a dense Mapping Spec: one line per
 * semantic row. Layout chrome stays in ⓘ. Passthrough wrappers and nested
 * same-operator logic trees are elided so mapping meaning stays visible
 * without Blockly JSON scaffolding.
 */

import { isRmContainerBlockType } from "../../blockly/blocks/rm_blocks.ts";
import { migrateForEachSourceState } from "../../blockly/migrate_for_each_source.ts";
import { isSourceQueryBlockType } from "../../blockly/source_query.ts";
import { MAPS_CREATE_WITH, MAPS_GET } from "../../core/defaults/extract.ts";
import {
  termPickDropdownOptions,
  termSetDropdownOptions,
} from "../../core/openehr_term_catalog.ts";

export type SpecLineKind =
  | "header"
  | "container"
  | "value"
  | "source_query"
  | "dv"
  | "map_lookup"
  | "sheet_lookup"
  | "decision_table"
  | "literal"
  | "logic"
  | "text_gen"
  | "term_pick"
  | "other";

export type SpecEditFieldName =
  | "EXPRESSION"
  | "RETURN_TYPE"
  | "TEXT"
  | "NUM"
  | "BOOL"
  | "LANG"
  | "PATH"
  | "VAR"
  | "NAME"
  | "OUTPUT"
  | "OP"
  | "SET"
  | "CODE"
  | `KEY${string}`;

export type SpecEditKind =
  | "source_path"
  | "text"
  | "code"
  | "compare"
  | "map_get"
  | "sheet_lookup"
  | "decision_table"
  | "number"
  | "boolean"
  | "loop"
  | "term_pick"
  | "none";

export interface SpecEditableField {
  field: SpecEditFieldName;
  value: string;
  /** Patch this block when it differs from the row's `blockId`. */
  targetBlockId?: string;
  /** Closed list of valid [label, value] pairs (TERM_PICK and other long picks). */
  options?: Array<[string, string]>;
}

export interface SpecLine {
  kind: SpecLineKind;
  indent: number;
  /** Top-level canvas root this row belongs to (for tabbed Spec view). */
  rootId?: string;
  /** Stable Blockly block id when this line maps to a block. */
  blockId?: string;
  /** Skipped wrapper / nested-logic ids that should scroll/highlight this row. */
  aliasIds?: string[];
  type: string;
  label: string;
  /**
   * Parent named attribute this block fills (`language`, `magnitude`, …).
   * Taken from Blockly input names (`ATTR_`, `FLD_`, `OPT_`, `OPTFLD_`, `VALUE`).
   * Statement-chain siblings keep the same name.
   */
  attribute?: string;
  /** Elided DATA_VALUE / RM shell type, shown as a badge without a wrapper row. */
  shell?: string;
  editKind?: SpecEditKind;
  /** One-line summary shown in the widget chrome. */
  summary: string;
  editable?: SpecEditableField[];
  /**
   * The attribute label is itself a Blockly field (map KEY, xml_attribute NAME).
   * Shown as an input in the attribute column.
   */
  attributeEdit?: SpecEditableField;
  /** Hidden details for the info balloon (x/y, raw fields, etc.). */
  info: Record<string, unknown>;
}

export interface SpecProjection {
  text: string;
  lines: SpecLine[];
}

interface BlocklyBlockJson {
  type?: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }>;
  next?: { block?: BlocklyBlockJson };
  extraState?: unknown;
  icons?: unknown;
}

interface BlocklyWorkspaceJson {
  blocks?: {
    languageVersion?: number;
    blocks?: BlocklyBlockJson[];
  };
  variables?: unknown;
}

let projectingRootId: string | undefined;

const DV_PREFIX = "dv_";
const COMPARE_OP: Record<string, string> = {
  EQ: "=",
  NEQ: "≠",
  LT: "<",
  LTE: "≤",
  GT: ">",
  GTE: "≥",
};

export function projectBlocklyState(state: unknown): SpecProjection {
  const lines: SpecLine[] = [];

  if (state == null || typeof state !== "object") {
    lines.push(emptyLine("(empty workspace)", {}));
    return toProjection(lines);
  }

  const workspace = migrateForEachSourceState(state) as BlocklyWorkspaceJson;
  const roots = workspace.blocks?.blocks ?? [];
  if (!roots.length) {
    lines.push(emptyLine("(no blocks)", { languageVersion: workspace.blocks?.languageVersion }));
    return toProjection(lines);
  }

  for (const root of roots) {
    if (root.type === "conversion_start") {
      projectingRootId = idOf(root);
      emit(lines, {
        kind: "header",
        indent: 0,
        rootId: projectingRootId,
        type: "conversion_start",
        label: "Conversion start",
        summary: "product marker",
        editKind: "none",
        info: collectInfo(root),
      });
      const instance = root.next?.block;
      if (instance) {
        projectingRootId = idOf(instance) ?? projectingRootId;
        emit(lines, rootDividerLine(instance, projectingRootId!));
        walkBlock(instance, 0, lines);
      }
      continue;
    }
    projectingRootId = idOf(root) ?? `root-${lines.length}`;
    emit(lines, rootDividerLine(root, projectingRootId));
    walkBlock(root, 0, lines);
  }
  return toProjection(lines);
}

function rootDividerLine(block: BlocklyBlockJson, rootId: string): SpecLine {
  return {
    kind: "header",
    indent: 0,
    rootId,
    blockId: idOf(block),
    type: block.type ?? "root",
    label: rootLabel(block),
    summary: rootLabel(block),
    editKind: "none",
    info: collectInfo(block),
  };
}

function rootLabel(block: BlocklyBlockJson): string {
  const type = block.type ?? "block";
  if (type === "defaults_block" || type === "default_context_map") {
    return "Default context map";
  }
  if (type === "composition") return "COMPOSITION";
  if (type.startsWith("procedures_def")) {
    return stringField(block, "NAME") || "Function";
  }
  const name = stringField(block, "NAME") || stringField(block, "RM_TYPE");
  return name ? `${type} · ${name}` : type;
}

/** Lines grouped by top-level canvas root (for tabbed Mapping Spec view). */
export function projectBlocklyStateByRoot(state: unknown): Map<string, SpecLine[]> {
  const projection = projectBlocklyState(state);
  const groups = new Map<string, SpecLine[]>();
  let currentRoot = "";
  for (const line of projection.lines) {
    if (line.kind === "header" && line.rootId) {
      currentRoot = line.rootId;
      if (!groups.has(currentRoot)) groups.set(currentRoot, []);
      groups.get(currentRoot)!.push(line);
      continue;
    }
    const rootId = line.rootId ?? currentRoot;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId)!.push(line);
  }
  return groups;
}

function emptyLine(label: string, info: Record<string, unknown>): SpecLine {
  return {
    kind: "other",
    indent: 0,
    type: "empty",
    label,
    summary: "",
    editKind: "none",
    info,
  };
}

function emit(
  lines: SpecLine[],
  line: SpecLine,
  attributeEdit?: SpecEditableField,
): void {
  if (projectingRootId && !line.rootId) line.rootId = projectingRootId;
  if (attributeEdit) line.attributeEdit = attributeEdit;
  lines.push(line);
}

function withAlias(aliases: string[], id: string | undefined): string[] {
  return id ? [...aliases, id] : aliases;
}

function pushAlias(aliases: string[], id: string | undefined): void {
  if (id) aliases.push(id);
}

function walkBlock(
  block: BlocklyBlockJson,
  indent: number,
  lines: SpecLine[],
  attribute?: string,
  extraAliases: string[] = [],
  shell?: string,
  attributeEdit?: SpecEditableField,
): void {
  const type = block.type ?? "unknown";

  if (type === "conversion_start") {
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell, attributeEdit);
    return;
  }

  if (type === "xml_text" || type === "xml_cdata" || type === "json_value" || type === "target_value") {
    walkInputs(block, indent, lines, attribute, withAlias(extraAliases, idOf(block)), shell, attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "xml_attribute") {
    const name = stringField(block, "NAME");
    const attr = name ? `@${name}` : attribute;
    const value = inputBlock(block, "VALUE");
    const nameEdit: SpecEditableField | undefined = name
      ? { field: "NAME", value: name, targetBlockId: idOf(block) }
      : attributeEdit;
    if (value) {
      walkBlock(value, indent, lines, attr, withAlias(extraAliases, idOf(block)), shell, nameEdit);
    }
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (isDvShell(type) || type === "code_phrase") {
    walkInputs(block, indent, lines, attribute, withAlias(extraAliases, idOf(block)), shell ?? type, attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === MAPS_CREATE_WITH && !stringField(block, "NAME")) {
    walkMapEntries(block, indent, lines, withAlias(extraAliases, idOf(block)));
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "logic_operation") {
    emitLogicOperation(block, indent, lines, attribute, extraAliases, attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "logic_compare") {
    emit(lines, compareLine(block, indent, attribute, extraAliases), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === MAPS_GET) {
    emit(lines, mapsGetLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "term_pick") {
    emit(lines, termPickLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "sheet_lookup") {
    emit(lines, sheetLookupLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "decision_table") {
    emit(lines, decisionTableLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (isSourceQuery(type)) {
    emit(lines, sourceQueryLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "text") {
    emit(lines, textLine(block, indent, attribute, extraAliases, shell, "text"), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "text_code") {
    emit(lines, textLine(block, indent, attribute, extraAliases, shell, "code"), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "math_number") {
    emit(lines, numberLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "logic_boolean") {
    emit(lines, booleanLine(block, indent, attribute, extraAliases, shell), attributeEdit);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "for_each_list") {
    emit(lines, loopLine(block, indent, attribute, extraAliases), attributeEdit);
    walkNamedInputs(block, indent + 1, lines, ["LIST", "DO"]);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === "controls_if") {
    emit(lines, containerLine(block, indent, attribute, extraAliases, "if"), attributeEdit);
    walkIfInputs(block, indent + 1, lines);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  if (type === MAPS_CREATE_WITH) {
    emit(
      lines,
      containerLine(block, indent, attribute, extraAliases, stringField(block, "NAME") || "map"),
      attributeEdit,
    );
    walkMapEntries(block, indent + 1, lines, extraAliases);
    if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
    return;
  }

  emit(lines, genericLine(block, indent, attribute, extraAliases, shell), attributeEdit);
  walkInputs(block, indent + 1, lines);
  if (block.next?.block) walkBlock(block.next.block, indent, lines, attribute, extraAliases, shell);
}

function walkInputs(
  block: BlocklyBlockJson,
  indent: number,
  lines: SpecLine[],
  inheritAttr?: string,
  extraAliases: string[] = [],
  shell?: string,
  attributeEdit?: SpecEditableField,
): void {
  if (!block.inputs) return;
  if (block.type === MAPS_CREATE_WITH || block.type === "default_context_map") {
    walkMapEntries(block, indent, lines, extraAliases);
    return;
  }
  for (const [inputName, input] of Object.entries(block.inputs)) {
    const child = input?.block ?? input?.shadow;
    if (!child) continue;
    const attr = slotAttributeFromInputName(inputName) ?? inheritAttr;
    walkBlock(child, indent, lines, attr, extraAliases, shell, attributeEdit);
  }
}

function walkNamedInputs(
  block: BlocklyBlockJson,
  indent: number,
  lines: SpecLine[],
  names: string[],
): void {
  for (const name of names) {
    const child = inputBlock(block, name);
    if (!child) continue;
    walkBlock(child, indent, lines, slotAttributeFromInputName(name) ?? name.toLowerCase());
  }
}

function walkMapEntries(
  block: BlocklyBlockJson,
  indent: number,
  lines: SpecLine[],
  extraAliases: string[],
): void {
  const count = mapItemCount(block);
  for (let i = 0; i < count; i++) {
    const key = stringField(block, `KEY${i}`) || `key${i}`;
    const child = inputBlock(block, `VAL${i}`) ?? inputShadow(block, `VAL${i}`);
    if (!child) continue;
    const keyEdit: SpecEditableField | undefined = idOf(block)
      ? { field: `KEY${i}`, value: key, targetBlockId: idOf(block) }
      : undefined;
    walkBlock(child, indent, lines, key, extraAliases, undefined, keyEdit);
  }
}

function walkIfInputs(block: BlocklyBlockJson, indent: number, lines: SpecLine[]): void {
  if (!block.inputs) return;
  const ifKeys = Object.keys(block.inputs)
    .filter((name) => /^IF\d+$/.test(name))
    .sort();
  for (const ifKey of ifKeys) {
    const n = ifKey.slice(2);
    const cond = inputBlock(block, ifKey);
    const body = inputBlock(block, `DO${n}`);
    const attr = n === "0" ? "when" : `else when ${n}`;
    if (cond) walkBlock(cond, indent, lines, attr);
    if (body) walkBlock(body, indent, lines, n === "0" ? "then" : `then ${n}`);
  }
  const elseBody = inputBlock(block, "ELSE");
  if (elseBody) walkBlock(elseBody, indent, lines, "else");
}

function emitLogicOperation(
  block: BlocklyBlockJson,
  indent: number,
  lines: SpecLine[],
  attribute: string | undefined,
  extraAliases: string[],
  attributeEdit?: SpecEditableField,
): void {
  const op = stringField(block, "OP") || "AND";
  const leaves = flattenSameOp(block, op);
  const nestedOps = collectSameOpIds(block, op).filter((id) => id !== idOf(block));
  const aliases = [...extraAliases, ...nestedOps];
  if (leaves && leaves.length > 1) {
    emit(lines, {
      kind: "logic",
      indent,
      blockId: idOf(block),
      aliasIds: aliases.length ? aliases : undefined,
      type: "logic_operation",
      label: op.toLowerCase(),
      attribute,
      editKind: "none",
      summary: op === "AND" ? "all of" : op === "OR" ? "any of" : op,
      info: collectInfo(block),
    }, attributeEdit);
    for (const leaf of leaves) {
      walkBlock(leaf, indent + 1, lines);
    }
    return;
  }
  emit(lines, genericLine(block, indent, attribute, extraAliases), attributeEdit);
  walkInputs(block, indent + 1, lines);
}

function flattenSameOp(block: BlocklyBlockJson, op: string): BlocklyBlockJson[] | null {
  if (block.type !== "logic_operation") return null;
  if (stringField(block, "OP") !== op) return null;
  const a = inputBlock(block, "A");
  const b = inputBlock(block, "B");
  if (!a || !b) return null;
  const left = a.type === "logic_operation" && stringField(a, "OP") === op
    ? flattenSameOp(a, op) ?? [a]
    : [a];
  const right = b.type === "logic_operation" && stringField(b, "OP") === op
    ? flattenSameOp(b, op) ?? [b]
    : [b];
  return [...left, ...right];
}

function compareLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
): SpecLine {
  const op = stringField(block, "OP") || "EQ";
  const a = inputBlock(block, "A");
  const b = inputBlock(block, "B");
  const editable: SpecEditableField[] = [
    { field: "OP", value: op },
  ];
  const aliases = [...extraAliases];
  let left = "?";
  let right = "?";
  if (a && isSourceQuery(a.type ?? "")) {
    const expr = stringField(a, "EXPRESSION");
    left = expr;
    editable.unshift({
      field: "EXPRESSION",
      value: expr,
      targetBlockId: idOf(a),
    });
    pushAlias(aliases, idOf(a));
  } else if (a && a.type === "text") {
    left = JSON.stringify(stringField(a, "TEXT"));
    editable.unshift({ field: "TEXT", value: stringField(a, "TEXT"), targetBlockId: idOf(a) });
    pushAlias(aliases, idOf(a));
  } else if (a) {
    left = a.type ?? "?";
    pushAlias(aliases, idOf(a));
  }
  if (b && b.type === "text") {
    right = JSON.stringify(stringField(b, "TEXT"));
    editable.push({ field: "TEXT", value: stringField(b, "TEXT"), targetBlockId: idOf(b) });
    pushAlias(aliases, idOf(b));
  } else if (b && isSourceQuery(b.type ?? "")) {
    right = stringField(b, "EXPRESSION");
    editable.push({
      field: "EXPRESSION",
      value: stringField(b, "EXPRESSION"),
      targetBlockId: idOf(b),
    });
    pushAlias(aliases, idOf(b));
  } else if (b && b.type === "math_number") {
    right = stringField(b, "NUM") || "0";
    editable.push({ field: "NUM", value: right, targetBlockId: idOf(b) });
    pushAlias(aliases, idOf(b));
  } else if (b) {
    right = b.type ?? "?";
    pushAlias(aliases, idOf(b));
  }
  const symbol = COMPARE_OP[op] ?? op;
  return {
    kind: "logic",
    indent,
    blockId: idOf(block),
    aliasIds: aliases.length ? aliases : undefined,
    type: "logic_compare",
    label: symbol,
    attribute,
    editKind: "compare",
    summary: `${left} ${symbol} ${right}`,
    editable,
    info: collectInfo(block),
  };
}

function termPickLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const setId = stringField(block, "SET");
  const code = stringField(block, "CODE");
  const setOptions = termSetDropdownOptions();
  const codeOptions = termPickDropdownOptions(setId);
  const setLabel = setOptions.find(([, value]) => value === setId)?.[0] ?? setId;
  const codeLabel = codeOptions.find(([, value]) => value === code)?.[0] ?? code;
  return {
    kind: "term_pick",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: "term_pick",
    label: stringField(block, "NAME") || "built-in",
    attribute,
    shell,
    editKind: "term_pick",
    summary: [setLabel, codeLabel].filter(Boolean).join(" · "),
    editable: [
      { field: "SET", value: setId, options: setOptions },
      { field: "CODE", value: code, options: codeOptions },
    ],
    info: collectInfo(block),
  };
}

function mapsGetLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const name = stringField(block, "NAME") || "defaults";
  const keyNode = inputBlock(block, "KEY") ?? inputShadow(block, "KEY");
  const editable: SpecEditableField[] = [{ field: "NAME", value: name }];
  const aliases = [...extraAliases];
  let keyLabel = "?";
  if (keyNode && keyNode.type === "text") {
    keyLabel = stringField(keyNode, "TEXT");
    editable.push({
      field: "TEXT",
      value: keyLabel,
      targetBlockId: idOf(keyNode),
    });
    pushAlias(aliases, idOf(keyNode));
  } else if (keyNode && isSourceQuery(keyNode.type ?? "")) {
    keyLabel = stringField(keyNode, "EXPRESSION");
    editable.push({
      field: "EXPRESSION",
      value: keyLabel,
      targetBlockId: idOf(keyNode),
    });
    pushAlias(aliases, idOf(keyNode));
  } else if (keyNode) {
    keyLabel = keyNode.type ?? "?";
    pushAlias(aliases, idOf(keyNode));
  }
  return {
    kind: "map_lookup",
    indent,
    blockId: idOf(block),
    aliasIds: aliases.length ? aliases : undefined,
    type: MAPS_GET,
    label: name,
    attribute,
    shell,
    editKind: "map_get",
    summary: `${name}[${JSON.stringify(keyLabel)}]`,
    editable,
    info: collectInfo(block),
  };
}

function bindValueInput(
  node: BlocklyBlockJson | undefined,
  aliases: string[],
  editable: SpecEditableField[],
): string {
  if (!node) return "?";
  const id = idOf(node);
  if (id) aliases.push(id);
  if (node.type === "text") {
    const text = stringField(node, "TEXT");
    editable.push({ field: "TEXT", value: text, targetBlockId: id });
    return text;
  }
  if (isSourceQuery(node.type ?? "")) {
    const expr = stringField(node, "EXPRESSION");
    editable.push({ field: "EXPRESSION", value: expr, targetBlockId: id });
    return expr;
  }
  if (node.type === "math_number") {
    const num = stringField(node, "NUM") || "0";
    editable.push({ field: "NUM", value: num, targetBlockId: id });
    return num;
  }
  return node.type ?? "?";
}

function sheetLookupLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const name = stringField(block, "NAME") || "Sheet1";
  const aliases = [...extraAliases];
  const editable: SpecEditableField[] = [{ field: "NAME", value: name }];
  const matchCol = bindValueInput(
    inputBlock(block, "MATCH_COL") ?? inputShadow(block, "MATCH_COL"),
    aliases,
    editable,
  );
  const matchVal = bindValueInput(
    inputBlock(block, "MATCH_VAL") ?? inputShadow(block, "MATCH_VAL"),
    aliases,
    editable,
  );
  const returnCol = bindValueInput(
    inputBlock(block, "RETURN_COL") ?? inputShadow(block, "RETURN_COL"),
    aliases,
    editable,
  );
  return {
    kind: "sheet_lookup",
    indent,
    blockId: idOf(block),
    aliasIds: aliases.length ? aliases : undefined,
    type: "sheet_lookup",
    label: name,
    attribute,
    shell,
    editKind: "sheet_lookup",
    summary: `${name}[${matchCol}=${matchVal} → ${returnCol}]`,
    editable,
    info: collectInfo(block),
  };
}

function decisionTableLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const name = stringField(block, "NAME") || "Decision1";
  const output = stringField(block, "OUTPUT") || "out";
  const aliases = [...extraAliases];
  const editable: SpecEditableField[] = [
    { field: "NAME", value: name },
    { field: "OUTPUT", value: output },
  ];
  return {
    kind: "decision_table",
    indent,
    blockId: idOf(block),
    aliasIds: aliases.length ? aliases : undefined,
    type: "decision_table",
    label: name,
    attribute,
    shell,
    editKind: "decision_table",
    summary: `${name}(inputs → ${output === "*" ? "all outputs" : output})`,
    editable,
    info: collectInfo(block),
  };
}

function sourceQueryLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const type = block.type ?? "source_query";
  const expr = stringField(block, "EXPRESSION");
  const ret = sourceReturnType(type, block.fields ?? {});
  const editable: SpecEditableField[] = [];
  if (type === "source_query") {
    editable.push({ field: "RETURN_TYPE", value: ret });
  }
  editable.push({ field: "EXPRESSION", value: expr });
  return {
    kind: "source_query",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type,
    label: expr || type,
    attribute,
    shell,
    editKind: "source_path",
    summary: `${ret} · ${expr}`,
    editable,
    info: collectInfo(block),
  };
}

function textLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell: string | undefined,
  mode: "text" | "code",
): SpecLine {
  const text = stringField(block, "TEXT");
  const lang = stringField(block, "LANG");
  const editable: SpecEditableField[] = [];
  if (mode === "code") {
    editable.push({ field: "LANG", value: lang || "handlebars" });
  }
  editable.push({ field: "TEXT", value: text });
  const firstLine = text.split("\n")[0] ?? "";
  return {
    kind: mode === "code" ? "text_gen" : "literal",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: block.type ?? "text",
    label: firstLine || (mode === "code" ? "code" : "text"),
    attribute,
    shell,
    editKind: mode === "code" ? "code" : "text",
    summary: mode === "code"
      ? `${lang || "handlebars"} · ${firstLine}${text.includes("\n") ? "…" : ""}`
      : JSON.stringify(text),
    editable,
    info: collectInfo(block),
  };
}

function numberLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const num = stringField(block, "NUM") || "0";
  return {
    kind: "literal",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: block.type ?? "math_number",
    label: num,
    attribute,
    shell,
    editKind: "number",
    summary: num,
    editable: [{ field: "NUM", value: num }],
    info: collectInfo(block),
  };
}

function booleanLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const bool = stringField(block, "BOOL") || "FALSE";
  return {
    kind: "literal",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: block.type ?? "logic_boolean",
    label: bool,
    attribute,
    shell,
    editKind: "boolean",
    summary: bool === "TRUE" ? "true" : "false",
    editable: [{ field: "BOOL", value: bool }],
    info: collectInfo(block),
  };
}

function loopLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
): SpecLine {
  const name = stringField(block, "VAR") || "item";
  const list = inputBlock(block, "LIST");
  const path = list && isSourceQueryBlockType(list.type ?? "")
    ? stringField(list, "EXPRESSION")
    : "";
  const collection = path || (list?.type ?? "list");
  return {
    kind: "container",
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: "for_each_list",
    label: name,
    attribute,
    editKind: "loop",
    summary: `${name} in ${collection}`,
    editable: [
      { field: "VAR", value: name },
    ],
    info: collectInfo(block),
  };
}

function containerLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  label: string,
): SpecLine {
  const kind = classify(block.type ?? "");
  return {
    kind,
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type: block.type ?? "unknown",
    label,
    attribute,
    editKind: "none",
    summary: buildContainerSummary(block, label),
    info: collectInfo(block),
  };
}

function genericLine(
  block: BlocklyBlockJson,
  indent: number,
  attribute: string | undefined,
  extraAliases: string[],
  shell?: string,
): SpecLine {
  const type = block.type ?? "unknown";
  const fields = block.fields ?? {};
  const label = pickLabel(type, fields);
  const kind = classify(type);
  return {
    kind,
    indent,
    blockId: idOf(block),
    aliasIds: extraAliases.length ? extraAliases : undefined,
    type,
    label,
    attribute,
    shell,
    editKind: "none",
    summary: buildSummary(kind, type, fields, label),
    info: collectInfo(block),
  };
}

/**
 * Blockly input name → RM / DV attribute shown on the filling Spec widget.
 * Prefix order matters: `OPTFLD_` before `OPT_`.
 */
export function slotAttributeFromInputName(inputName: string): string | undefined {
  const prefixed = inputName.match(/^(?:ATTR_|OPTFLD_|SCHEMA_OPT_|OPT_|FLD_|TARGET_)(.+)$/);
  if (prefixed?.[1]) return prefixed[1];
  if (inputName === "VALUE" || inputName === "MAGNITUDE" || inputName === "KIND") {
    return inputName.toLowerCase();
  }
  if (/^DO\d*$/.test(inputName) || inputName === "ELSE") return undefined;
  if (/^IF\d+$/.test(inputName)) return undefined;
  if (/^VAL\d+$/.test(inputName)) return undefined;
  return undefined;
}

function classify(type: string): SpecLineKind {
  if (isSourceQuery(type)) return "source_query";
  if (type === "element" || type === "target_value" || type === "json_value" || type === "xml_text" ||
    type === "xml_cdata") {
    return "value";
  }
  if (
    type === "target_structure" ||
    type.startsWith("schema_") ||
    type === "json_object" ||
    type === "json_array" ||
    type === "xml_element" ||
    type === "xml_document" ||
    type === "defaults_block" ||
    type === "default_context_map" ||
    type === "for_each_list" ||
    type === "controls_if" ||
    type === MAPS_CREATE_WITH ||
    isRmContainerBlockType(type)
  ) {
    return "container";
  }
  if (isDvShell(type)) return "dv";
  if (type === MAPS_GET) return "map_lookup";
  if (type === "term_pick") return "term_pick";
  if (type === "sheet_lookup") return "sheet_lookup";
  if (type === "decision_table") return "decision_table";
  if (type === "text_code" || type === "text_handlebars") return "text_gen";
  if (type === "logic_compare" || type === "logic_operation") return "logic";
  if (type === "text" || type === "math_number" || type === "logic_boolean") return "literal";
  return "other";
}

function pickLabel(type: string, fields: Record<string, unknown>): string {
  for (const key of ["NAME", "LABEL", "VAR", "TEXT", "TAG"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const rm = fields["RM_TYPE"] ?? fields["TARGET_TYPE"];
  if (typeof rm === "string" && rm) return rm;
  return type;
}

function buildContainerSummary(block: BlocklyBlockJson, label: string): string {
  const type = block.type ?? "";
  const rm = stringField(block, "RM_TYPE") || stringField(block, "TARGET_TYPE");
  const slot = stringField(block, "SLOT_ID");
  return [label !== type ? label : "", rm && rm !== label ? rm : "", slot ? `slot ${shortSlot(slot)}` : ""]
    .filter(Boolean)
    .join(" · ");
}

function buildSummary(
  kind: SpecLineKind,
  type: string,
  fields: Record<string, unknown>,
  label: string,
): string {
  const rm = typeof fields["RM_TYPE"] === "string"
    ? fields["RM_TYPE"]
    : typeof fields["TARGET_TYPE"] === "string"
    ? fields["TARGET_TYPE"]
    : "";
  const slot = typeof fields["SLOT_ID"] === "string" ? fields["SLOT_ID"] : "";
  if (kind === "source_query") {
    const expr = typeof fields["EXPRESSION"] === "string" ? fields["EXPRESSION"] : "";
    const ret = sourceReturnType(type, fields);
    return `${ret} · ${expr}`;
  }
  if (kind === "value" || kind === "container" || kind === "dv") {
    return [label !== type ? label : "", rm && rm !== label ? rm : "", slot ? `slot ${shortSlot(slot)}` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  return label !== type ? label : "";
}

function sourceReturnType(type: string, fields: Record<string, unknown>): string {
  if (type === "source_query_number") return "number";
  if (type === "source_query_boolean") return "boolean";
  if (type === "source_query_node") return "node";
  return typeof fields["RETURN_TYPE"] === "string" ? fields["RETURN_TYPE"] : "string";
}

function shortSlot(slotId: string): string {
  const parts = slotId.split("/");
  return parts.length <= 2 ? slotId : `…/${parts.slice(-2).join("/")}`;
}

function collectInfo(block: BlocklyBlockJson): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  if (block.id) info.id = block.id;
  if (block.type) info.type = block.type;
  if (typeof block.x === "number") info.x = block.x;
  if (typeof block.y === "number") info.y = block.y;
  if (block.fields && Object.keys(block.fields).length) info.fields = block.fields;
  if (block.extraState !== undefined) info.extraState = block.extraState;
  if (block.inputs) info.inputNames = Object.keys(block.inputs);
  return info;
}

export interface BlocklyJsonDocument {
  text: string;
  widgets: Array<{ from: number; to: number; line: SpecLine }>;
}

/** Spec document filtered to one canvas root (tabbed view). */
export function blocklyJsonDocumentForRoot(
  state: unknown,
  rootId: string,
): BlocklyJsonDocument {
  const projection = projectBlocklyState(state);
  const lines = projection.lines.filter((line) => line.rootId === rootId);
  return toBlocklyJsonDocument(lines);
}

function toBlocklyJsonDocument(lines: SpecLine[]): BlocklyJsonDocument {
  const text = lines
    .map((line) => {
      const pad = "  ".repeat(line.indent);
      const parts = [line.type];
      if (line.summary) parts.push(line.summary);
      else if (line.label && line.label !== line.type) parts.push(line.label);
      const body = parts.join(" · ");
      return line.attribute ? `${pad}${line.attribute}  ${body}` : `${pad}${body}`;
    })
    .join("\n");
  const widgets: BlocklyJsonDocument["widgets"] = [];
  let offset = 0;
  const rows = text.length ? text.split("\n") : [""];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const from = offset;
    const to = from + row.length;
    offset = to + (i < rows.length - 1 ? 1 : 0);
    const line = lines[i];
    if (line) widgets.push({ from, to, line });
  }
  return { text, widgets };
}

/** Compact Spec text plus widget ranges, one range per projected line. */
export function blocklyJsonDocument(state: unknown): BlocklyJsonDocument {
  const projection = projectBlocklyState(state);
  return toBlocklyJsonDocument(projection.lines);
}

function toProjection(lines: SpecLine[]): SpecProjection {
  const text = lines
    .map((line) => {
      const pad = "  ".repeat(line.indent);
      const parts = [line.type];
      if (line.summary) parts.push(line.summary);
      else if (line.label && line.label !== line.type) parts.push(line.label);
      const body = parts.join(" · ");
      return line.attribute ? `${pad}${line.attribute}  ${body}` : `${pad}${body}`;
    })
    .join("\n");
  return { text, lines };
}

function isSourceQuery(type: string): boolean {
  return (
    type === "source_query" ||
    type === "source_query_number" ||
    type === "source_query_boolean" ||
    type === "source_query_node"
  );
}

function isDvShell(type: string): boolean {
  return type.startsWith(DV_PREFIX) || type.startsWith("DV_");
}

function stringField(block: BlocklyBlockJson, name: string): string {
  const value = block.fields?.[name];
  return typeof value === "string" ? value : "";
}

function inputBlock(block: BlocklyBlockJson, name: string): BlocklyBlockJson | undefined {
  return block.inputs?.[name]?.block;
}

function inputShadow(block: BlocklyBlockJson, name: string): BlocklyBlockJson | undefined {
  return block.inputs?.[name]?.shadow;
}

function idOf(block: BlocklyBlockJson): string | undefined {
  return typeof block.id === "string" ? block.id : undefined;
}

function collectSameOpIds(block: BlocklyBlockJson, op: string): string[] {
  const ids: string[] = [];
  const walk = (node: BlocklyBlockJson | undefined) => {
    if (!node || node.type !== "logic_operation") return;
    if (stringField(node, "OP") !== op) return;
    const id = idOf(node);
    if (id) ids.push(id);
    walk(inputBlock(node, "A"));
    walk(inputBlock(node, "B"));
  };
  walk(block);
  return ids;
}

function mapItemCount(block: BlocklyBlockJson): number {
  const extra = block.extraState;
  if (extra && typeof extra === "object" && extra !== null && "itemCount" in extra) {
    const n = (extra as { itemCount?: unknown }).itemCount;
    if (typeof n === "number") return n;
  }
  let count = 0;
  while (block.fields?.[`KEY${count}`] !== undefined || block.inputs?.[`VAL${count}`]) {
    count++;
  }
  return count;
}
