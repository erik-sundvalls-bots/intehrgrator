/**
 * Pedagogical Blockly Functions: grammatical list join via a FIRST Decision table.
 * Shared by the Function library starters and join_list tests (#85 variant F).
 */

import { Blockly } from "./blockly_core.ts";
import {
  LOGIC_CURRENT_ITEM_BLOCK,
  LOGIC_LOOP_INDEX_BLOCK,
  LOGIC_LOOP_LENGTH_BLOCK,
} from "./blocks/logic_blocks.ts";
import { MAPS_CREATE_WITH } from "../core/defaults/extract.ts";
import { normalizeSheet } from "../core/sheets/mod.ts";
import type { SheetDocument } from "../core/sheets/types.ts";
import { extractFunctionBundle } from "./function_bundle.ts";
import type { FunctionBundle } from "../core/function_library/types.ts";

export interface GrammaticalJoinSpec {
  id: string;
  functionName: string;
  tableName: string;
  locale: string;
  lastSnippet: string;
  description: string;
  /** Blockly parameter name. Default `names`. */
  paramName?: string;
  /** Accumulator / return variable. Default `result`. */
  resultName?: string;
  /** `for each` variable. Default `item`. */
  itemName?: string;
  /** Decision-table input key interpolated by the snippet. Default `name`. */
  snippetKey?: string;
}

export const JOIN_SWEDISH_SPEC: GrammaticalJoinSpec = {
  id: "join_swedish",
  functionName: "join_swedish_words",
  tableName: "SweJoinWords",
  locale: "sv",
  paramName: "list_of_words",
  resultName: "joined_words",
  itemName: "word",
  snippetKey: "word",
  lastSnippet: " och {{word}}",
  description:
    'Joins a list of words to a comma separated text string in the way words are enumerated in Swedish with "och" (and) before last word. A decision table is used to select output pattern first → `{{word}}`, middle → `, {{word}}`, last → ` och {{word}}`. Parameter `list_of_words`. Returns `joined_words`.',
};

export const JOIN_OXFORD_SPEC: GrammaticalJoinSpec = {
  id: "join_oxford",
  functionName: "join_oxford",
  tableName: "JoinOxford",
  locale: "en",
  lastSnippet: ", and {{name}}",
  description:
    "Joins a list of strings with an English Oxford / serial comma: A, B, and C. Parameter `names` (list). Returns a string. Decision table JoinOxford (FIRST): first → {{name}}, middle → `, {{name}}`, last → `, and {{name}}`. Not a join_list builtin.",
};

export const GRAMMATICAL_JOIN_SPECS: readonly GrammaticalJoinSpec[] = [
  JOIN_SWEDISH_SPEC,
  JOIN_OXFORD_SPEC,
];

type MapCreateBlock = Blockly.Block & {
  itemCount_: number;
  updateShape_: () => void;
};

function plug(parent: Blockly.Block, input: string, child: Blockly.Block): void {
  const conn = parent.getInput(input)?.connection;
  if (!conn) throw new Error(`missing input ${input} on ${parent.type}`);
  if (child.outputConnection) conn.connect(child.outputConnection);
  else conn.connect(child.previousConnection!);
}

function namedVar(workspace: Blockly.Workspace, name: string, id?: string) {
  return workspace.getVariable(name) ?? workspace.createVariable(name, undefined, id);
}

function varGet(workspace: Blockly.Workspace, name: string, id?: string): Blockly.Block {
  const block = workspace.newBlock("variables_get");
  block.setFieldValue(namedVar(workspace, name, id).getId(), "VAR");
  return block;
}

function varSet(
  workspace: Blockly.Workspace,
  name: string,
  value: Blockly.Block,
  id?: string,
): Blockly.Block {
  const block = workspace.newBlock("variables_set");
  block.setFieldValue(namedVar(workspace, name, id).getId(), "VAR");
  plug(block, "VALUE", value);
  return block;
}

function textAppend(
  workspace: Blockly.Workspace,
  name: string,
  value: Blockly.Block,
  id?: string,
): Blockly.Block {
  const block = workspace.newBlock("text_append");
  block.setFieldValue(namedVar(workspace, name, id).getId(), "VAR");
  plug(block, "TEXT", value);
  return block;
}

function number(workspace: Blockly.Workspace, n: number): Blockly.Block {
  const block = workspace.newBlock("math_number");
  block.setFieldValue(String(n), "NUM");
  return block;
}

function eq(workspace: Blockly.Workspace, a: Blockly.Block, b: Blockly.Block): Blockly.Block {
  const cmp = workspace.newBlock("logic_compare");
  cmp.setFieldValue("EQ", "OP");
  plug(cmp, "A", a);
  plug(cmp, "B", b);
  return cmp;
}

function minus(workspace: Blockly.Workspace, a: Blockly.Block, b: Blockly.Block): Blockly.Block {
  const op = workspace.newBlock("math_arithmetic");
  op.setFieldValue("MINUS", "OP");
  plug(op, "A", a);
  plug(op, "B", b);
  return op;
}

function snippetKeyOf(spec: GrammaticalJoinSpec): string {
  return spec.snippetKey ?? "name";
}

export function grammaticalJoinTable(spec: GrammaticalJoinSpec): SheetDocument {
  const key = snippetKeyOf(spec);
  return normalizeSheet({
    name: spec.tableName,
    kind: "decision-table",
    hitPolicy: "FIRST",
    headers: ["first", "last", "snippet"],
    decisionColumns: [
      { role: "condition" },
      { role: "condition" },
      { role: "output", outputKind: "snippet" },
    ],
    values: [
      [true, "—", `{{${key}}}`],
      [false, false, `, {{${key}}}`],
      [false, true, spec.lastSnippet],
    ],
  });
}

function joinLocals(workspace: Blockly.Workspace, snippetKey: string): Blockly.Block {
  const map = workspace.newBlock(MAPS_CREATE_WITH) as MapCreateBlock;
  map.itemCount_ = 3;
  map.updateShape_();
  map.setFieldValue("first", "KEY0");
  map.setFieldValue("last", "KEY1");
  map.setFieldValue(snippetKey, "KEY2");
  plug(map, "VAL0", eq(workspace, workspace.newBlock(LOGIC_LOOP_INDEX_BLOCK), number(workspace, 0)));
  plug(
    map,
    "VAL1",
    eq(
      workspace,
      workspace.newBlock(LOGIC_LOOP_INDEX_BLOCK),
      minus(workspace, workspace.newBlock(LOGIC_LOOP_LENGTH_BLOCK), number(workspace, 1)),
    ),
  );
  plug(map, "VAL2", workspace.newBlock(LOGIC_CURRENT_ITEM_BLOCK));
  return map;
}

function joinEval(workspace: Blockly.Workspace, spec: GrammaticalJoinSpec): Blockly.Block {
  const table = workspace.newBlock("decision_table");
  table.setFieldValue(spec.tableName, "NAME");
  table.setFieldValue("snippet", "OUTPUT");
  plug(table, "INPUTS", joinLocals(workspace, snippetKeyOf(spec)));
  return table;
}

/** `to join_*(names)` loops and appends FIRST Decision table snippets. */
export function defineGrammaticalJoin(
  workspace: Blockly.Workspace,
  spec: GrammaticalJoinSpec,
): Blockly.Block {
  const paramName = spec.paramName ?? "names";
  const resultName = spec.resultName ?? "result";
  const itemName = spec.itemName ?? "item";
  const paramId = `${spec.functionName}_${paramName}`;
  const resultId = `${spec.functionName}_${resultName}`;
  const def = Blockly.serialization.blocks.append({
    type: "procedures_defreturn",
    fields: { NAME: spec.functionName },
    extraState: {
      params: [{ name: paramName, id: paramId }],
      hasStatements: true,
    },
  }, workspace) as Blockly.Block;
  (def as { setStatements_?: (v: boolean) => void }).setStatements_?.(true);
  def.setCommentText(spec.description);

  const empty = workspace.newBlock("text");
  empty.setFieldValue("", "TEXT");
  const init = varSet(workspace, resultName, empty, resultId);
  const loop = workspace.newBlock("for_each_list");
  loop.setFieldValue(itemName, "VAR");
  plug(loop, "LIST", varGet(workspace, paramName, paramId));
  const append = textAppend(workspace, resultName, joinEval(workspace, spec), resultId);
  loop.getInput("DO")!.connection!.connect(append.previousConnection!);
  init.nextConnection!.connect(loop.previousConnection!);
  const stack = def.getInput("STACK") ?? def.getInput("STACK0");
  if (!stack?.connection) throw new Error(`${spec.functionName} needs a statement stack`);
  stack.connection.connect(init.previousConnection!);
  const ret = def.getInput("RETURN") ?? def.getInput("VALUE");
  if (!ret?.connection) throw new Error(`${spec.functionName} needs a return socket`);
  ret.connection.connect(varGet(workspace, resultName, resultId).outputConnection!);
  return def;
}

export function buildGrammaticalJoinBundle(spec: GrammaticalJoinSpec): FunctionBundle {
  const workspace = new Blockly.Workspace();
  try {
    defineGrammaticalJoin(workspace, spec);
    return extractFunctionBundle(workspace, spec.functionName, [grammaticalJoinTable(spec)], {
      description: spec.description,
      locale: spec.locale,
      returns: "String",
    });
  } finally {
    workspace.dispose();
  }
}

export function defineJoinSwedish(workspace: Blockly.Workspace): Blockly.Block {
  return defineGrammaticalJoin(workspace, JOIN_SWEDISH_SPEC);
}
