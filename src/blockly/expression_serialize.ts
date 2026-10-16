import type { Block } from "blockly/core";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import type { ExprAst } from "../core/expression/mod.ts";
import { parseExpression, serialize } from "../core/expression/mod.ts";
import { TERM_PICK_NONE, termSetById } from "../core/openehr_term_catalog.ts";
import {
  loopIndexBinderName,
  loopLengthBinderName,
} from "./loop_block.ts";
import {
  createSourceQueryBlock,
  returnTypeFromSourceBlock,
  xpathEvaluatorForReturnType,
} from "./source_query.ts";
import { createMapsGetBlock, registerMapBlocks } from "./blocks/map_blocks.ts";
import { MAPS_CREATE_WITH } from "../core/defaults/extract.ts";
import {
  DECISION_TABLE_BLOCK,
  registerDecisionTableBlocks,
} from "./blocks/decision_table_blocks.ts";
import { registerSheetBlocks, SHEET_LOOKUP } from "./blocks/sheet_blocks.ts";
import {
  callToRestrictionOp,
  callToSetOp,
  currentItemName,
  currentLoopItemName,
  DEFAULT_ITEM_NAME,
  isRestrictionCall,
  isSetCall,
  LISTS_SET_OPERATION_BLOCK,
  LOGIC_CURRENT_ITEM_BLOCK,
  LOGIC_LIST_RESTRICTION_BLOCK,
  LOGIC_LOOP_INDEX_BLOCK,
  LOGIC_LOOP_LENGTH_BLOCK,
  registerLogicBlocks,
  restrictionCount,
  restrictionItemName,
  restrictionOpHoldsOnEmptyList,
  restrictionOpNeedsCount,
  restrictionOpToCall,
  restrictionRequiresItems,
  setOpToCall,
  setRestrictionItemName,
  setRestrictionRequiresItems,
} from "./blocks/logic_blocks.ts";

type BlockSvg = import("blockly/core").BlockSvg;
type Workspace = import("blockly/core").Workspace;

/**
 * When Import Suggestions cannot plug a `maps_create_with` / Decision table into a
 * typed DV mouth, the Mapping Expression is stored as the source-query path.
 * Detect that so TypeScript export evaluates `map(...)` / `decision_table(...)`
 * instead of sending the script to fontoxpath.
 */
function sourceQueryFieldExpression(expr: string, fn: string): string {
  const trimmed = String(expr ?? "").trim();
  if (!trimmed) return `${fn}(${JSON.stringify(expr)})`;
  try {
    const ast = parseExpression(trimmed);
    if (ast.kind === "call" && !String(ast.name).startsWith("xpath")) {
      return trimmed;
    }
  } catch {
    /* authoring path, not a Mapping Expression */
  }
  return `${fn}(${JSON.stringify(expr)})`;
}

export function blockToExpression(block: Block | null): string | null {
  if (!block) return null;

  switch (block.type) {
    case "source_query":
    case "source_query_number":
    case "source_query_boolean":
    case "source_query_node": {
      const expr = block.getFieldValue("EXPRESSION");
      const fn = xpathEvaluatorForReturnType(returnTypeFromSourceBlock(block));
      return sourceQueryFieldExpression(String(expr ?? ""), fn);
    }
    // Stock Blockly literals / ops
    case "text":
    case "text_code":
      return JSON.stringify(block.getFieldValue("TEXT") ?? "");
    case "math_number":
      return String(block.getFieldValue("NUM") ?? 0);
    case "logic_boolean":
      return block.getFieldValue("BOOL") === "TRUE" ? "true" : "false";
    case "text_trim": {
      const inner = blockToExpression(block.getInputTargetBlock("TEXT"));
      return inner ? `trim(${inner})` : 'trim("")';
    }
    case "text_join": {
      const parts: string[] = [];
      for (let i = 0; i < (block.itemCount_ ?? 2); i++) {
        parts.push(blockToExpression(block.getInputTargetBlock(`ADD${i}`)) ?? '""');
      }
      if (parts.length === 0) return '""';
      if (parts.length === 1) return parts[0]!;
      return `concat(${parts.join(", ")})`;
    }
    case "logic_ternary": {
      const cond = blockToExpression(block.getInputTargetBlock("IF"));
      const thenV = blockToExpression(block.getInputTargetBlock("THEN"));
      const elseV = blockToExpression(block.getInputTargetBlock("ELSE"));
      return `if(${cond ?? "false"}, ${thenV ?? "null"}, ${elseV ?? "null"})`;
    }
    case "math_arithmetic": {
      const a = blockToExpression(block.getInputTargetBlock("A"));
      const b = blockToExpression(block.getInputTargetBlock("B"));
      const opMap: Record<string, "+" | "-" | "*" | "/"> = {
        ADD: "+",
        MINUS: "-",
        MULTIPLY: "*",
        DIVIDE: "/",
      };
      const op = opMap[block.getFieldValue("OP")] ?? "+";
      return `(${a ?? "0"} ${op} ${b ?? "0"})`;
    }
    case "math_round": {
      const num = blockToExpression(block.getInputTargetBlock("NUM")) ?? "0";
      return `round(${num})`;
    }
    case "math_modulo": {
      const a = blockToExpression(block.getInputTargetBlock("DIVIDEND")) ?? "0";
      const b = blockToExpression(block.getInputTargetBlock("DIVISOR")) ?? "1";
      return `modulo(${a}, ${b})`;
    }
    case "math_constrain": {
      const value = blockToExpression(block.getInputTargetBlock("VALUE")) ?? "0";
      const low = blockToExpression(block.getInputTargetBlock("LOW")) ?? "0";
      const high = blockToExpression(block.getInputTargetBlock("HIGH")) ?? "0";
      return `constrain(${value}, ${low}, ${high})`;
    }
    case "variables_get": {
      const name = block.getField("VAR")?.getText() ?? "v";
      return `var(${JSON.stringify(name)})`;
    }
    case "maps_get": {
      const name = String(block.getFieldValue("NAME") || "defaults");
      const key = blockToExpression(block.getInputTargetBlock("KEY")) ?? '""';
      return `maps_get(${JSON.stringify(name)}, ${key})`;
    }
    case "term_pick": {
      const set = termSetById(block.getFieldValue("SET"));
      const rawCode = String(block.getFieldValue("CODE") ?? "");
      if (!rawCode || rawCode === TERM_PICK_NONE) return null;
      const terminology = set?.terminologyId ?? "openehr";
      const rubric = set?.codes.find((item) => item.code === rawCode)?.rubric ?? rawCode;
      const rmType = set?.valueRmType ?? String(block.getFieldValue("RM_TYPE") || "CODE_PHRASE");
      if (rmType === "DV_CODED_TEXT") {
        return `map("value", ${JSON.stringify(rubric)}, "defining_code", map("terminology_id", ${
          JSON.stringify(terminology)
        }, "code_string", ${JSON.stringify(rawCode)}))`;
      }
      return `map("terminology_id", ${JSON.stringify(terminology)}, "code_string", ${
        JSON.stringify(rawCode)
      })`;
    }
    case "sheet_get_cell": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const a1 = blockToExpression(block.getInputTargetBlock("A1")) ?? '"A1"';
      return `sheet_get_cell(${JSON.stringify(name)}, ${a1})`;
    }
    case "sheet_get_xy": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const x = blockToExpression(block.getInputTargetBlock("X")) ?? "0";
      const y = blockToExpression(block.getInputTargetBlock("Y")) ?? "0";
      return `sheet_get_xy(${JSON.stringify(name)}, ${x}, ${y})`;
    }
    case "sheet_get_row": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const y = blockToExpression(block.getInputTargetBlock("Y")) ?? "0";
      return `sheet_get_row(${JSON.stringify(name)}, ${y})`;
    }
    case "sheet_get_column": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const x = blockToExpression(block.getInputTargetBlock("X")) ?? "0";
      return `sheet_get_column(${JSON.stringify(name)}, ${x})`;
    }
    case "sheet_get_header": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const x = blockToExpression(block.getInputTargetBlock("X")) ?? "0";
      return `sheet_get_header(${JSON.stringify(name)}, ${x})`;
    }
    case "sheet_get_data": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      return `sheet_get_data(${JSON.stringify(name)})`;
    }
    case "sheet_lookup": {
      const name = String(block.getFieldValue("NAME") || "Sheet1");
      const col = blockToExpression(block.getInputTargetBlock("MATCH_COL")) ?? '""';
      const val = blockToExpression(block.getInputTargetBlock("MATCH_VAL")) ?? '""';
      const ret = blockToExpression(block.getInputTargetBlock("RETURN_COL"));
      return ret
        ? `sheet_lookup(${JSON.stringify(name)}, ${col}, ${val}, ${ret})`
        : `sheet_lookup(${JSON.stringify(name)}, ${col}, ${val})`;
    }
    case "decision_table": {
      const name = String(block.getFieldValue("NAME") || "Decision1");
      const inputs = blockToExpression(block.getInputTargetBlock("INPUTS")) ?? "map()";
      const output = String(block.getFieldValue("OUTPUT") || "out");
      return `decision_table(${JSON.stringify(name)}, ${inputs}, ${JSON.stringify(output)})`;
    }
    case "maps_create_empty":
      return "map()";
    case "maps_create_with": {
      const count = Number((block as Block & { itemCount_?: number }).itemCount_ ?? 0);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        parts.push(JSON.stringify(block.getFieldValue(`KEY${i}`) ?? ""));
        parts.push(blockToExpression(block.getInputTargetBlock(`VAL${i}`)) ?? "null");
      }
      return `map(${parts.join(", ")})`;
    }
    case "text_handlebars": {
      const script = blockToExpression(block.getInputTargetBlock("SCRIPT")) ?? '""';
      const context = blockToExpression(block.getInputTargetBlock("CONTEXT")) ?? "map()";
      return `handlebars(${script}, ${context})`;
    }
    case "logic_compare": {
      const a = blockToExpression(block.getInputTargetBlock("A")) ?? "false";
      const b = blockToExpression(block.getInputTargetBlock("B")) ?? "false";
      const opMap: Record<string, string> = {
        EQ: "eq",
        NEQ: "ne",
        LT: "lt",
        LTE: "le",
        GT: "gt",
        GTE: "ge",
      };
      const fn = opMap[String(block.getFieldValue("OP") ?? "EQ")] ?? "eq";
      return `${fn}(${a}, ${b})`;
    }
    case "logic_operation": {
      const a = blockToExpression(block.getInputTargetBlock("A")) ?? "false";
      const b = blockToExpression(block.getInputTargetBlock("B")) ?? "false";
      const fn = String(block.getFieldValue("OP") ?? "AND") === "OR" ? "or" : "and";
      return `${fn}(${a}, ${b})`;
    }
    case "logic_negate": {
      const inner = blockToExpression(block.getInputTargetBlock("BOOL")) ?? "false";
      return `not(${inner})`;
    }
    case "lists_getIndex": {
      if (String(block.getFieldValue("MODE") || "GET") !== "GET") return null;
      // DV_* value-set lists are not Mapping Expressions — return null so
      // TypeScript canvas codegen can emit `new DV_CODED_TEXT` / … instead.
      const list = blockToExpression(block.getInputTargetBlock("VALUE"));
      if (list === null) return null;
      const where = String(block.getFieldValue("WHERE") || "FIRST");
      if (where === "FROM_START" || where === "FROM_END") {
        const at = blockToExpression(block.getInputTargetBlock("AT")) ?? "1";
        return `lists_getIndex(${list}, ${JSON.stringify(where)}, ${at})`;
      }
      return `lists_getIndex(${list}, ${JSON.stringify(where)})`;
    }
    case "lists_create_with": {
      // Expression-path lists (DL quantifiers) need every item serializable.
      // Scaffolded coded-text / ordinal value-set lists hold DV_* shells that
      // are not Mapping Expressions — return null so TypeScript canvas codegen
      // falls through to emitListsCreate (new DV_CODED_TEXT / …).
      const count = Number((block as Block & { itemCount_?: number }).itemCount_ ?? 0);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const child = block.getInputTargetBlock(`ADD${i}`);
        if (!child) {
          parts.push("null");
          continue;
        }
        const part = blockToExpression(child);
        if (part === null) return null;
        parts.push(part);
      }
      return `list(${parts.join(", ")})`;
    }
    case LOGIC_LIST_RESTRICTION_BLOCK: {
      const list = blockToExpression(block.getInputTargetBlock("LIST")) ?? "list()";
      const pred = blockToExpression(block.getInputTargetBlock("PRED")) ?? "true";
      const name = JSON.stringify(restrictionItemName(block));
      const op = String(block.getFieldValue("OP") ?? "ALL");
      const fn = restrictionOpToCall(op);
      const call = restrictionOpNeedsCount(op)
        ? `${fn}(${list}, ${restrictionCount(block)}, ${name}, ${pred})`
        : `${fn}(${list}, ${name}, ${pred})`;
      // `any_of(list, v, true)` is "the list has an item" — no new builtin needed.
      if (!restrictionRequiresItems(block)) return call;
      return `and(any_of(${list}, ${name}, true), ${call})`;
    }
    case LOGIC_CURRENT_ITEM_BLOCK:
      return `var(${JSON.stringify(currentItemName(block))})`;
    case LOGIC_LOOP_INDEX_BLOCK:
      return `var(${JSON.stringify(loopIndexBinderName(currentLoopItemName(block)))})`;
    case LOGIC_LOOP_LENGTH_BLOCK:
      return `var(${JSON.stringify(loopLengthBinderName(currentLoopItemName(block)))})`;
    case LISTS_SET_OPERATION_BLOCK: {
      const a = blockToExpression(block.getInputTargetBlock("A")) ?? "list()";
      const b = blockToExpression(block.getInputTargetBlock("B")) ?? "list()";
      return `${setOpToCall(String(block.getFieldValue("OP") ?? "BOTH"))}(${a}, ${b})`;
    }
    case "procedures_callreturn": {
      const name = String(block.getFieldValue("NAME") || "").trim();
      if (!name) return null;
      const args: string[] = [];
      for (let i = 0; ; i++) {
        const input = block.getInput(`ARG${i}`);
        if (!input) break;
        args.push(blockToExpression(block.getInputTargetBlock(`ARG${i}`)) ?? "null");
      }
      return `call(${JSON.stringify(name)}${args.length ? `, ${args.join(", ")}` : ""})`;
    }
    default:
      return null;
  }
}

export function astToExpressionBlock(
  workspace: Workspace,
  ast: ExprAst,
  returnType: string,
  finalize: (block: BlockSvg) => BlockSvg,
): BlockSvg {
  if (ast.kind === "literal") {
    if (typeof ast.value === "number") {
      const block = workspace.newBlock("math_number") as BlockSvg;
      block.setFieldValue(ast.value, "NUM");
      return finalize(block);
    }
    if (typeof ast.value === "boolean") {
      const block = workspace.newBlock("logic_boolean") as BlockSvg;
      block.setFieldValue(ast.value ? "TRUE" : "FALSE", "BOOL");
      return finalize(block);
    }
    if (typeof ast.value === "string") {
      const block = workspace.newBlock("text") as BlockSvg;
      block.setFieldValue(ast.value, "TEXT");
      return finalize(block);
    }
    const block = workspace.newBlock("text") as BlockSvg;
    block.setFieldValue(String(ast.value), "TEXT");
    return finalize(block);
  }

  if (ast.kind === "binary") {
    const block = workspace.newBlock("math_arithmetic") as BlockSvg;
    const opMap: Record<string, string> = {
      "+": "ADD",
      "-": "MINUS",
      "*": "MULTIPLY",
      "/": "DIVIDE",
    };
    block.setFieldValue(opMap[ast.op] ?? "ADD", "OP");
    const left = astToExpressionBlock(workspace, ast.left, returnType, finalize);
    const right = astToExpressionBlock(workspace, ast.right, returnType, finalize);
    block.getInput("A")!.connection!.connect(left.outputConnection!);
    block.getInput("B")!.connection!.connect(right.outputConnection!);
    return finalize(block);
  }

  if (ast.kind === "call") {
    if (ast.name.startsWith("xpath")) {
      const xpathArg = ast.args[0];
      const xpath = xpathArg?.kind === "literal" && typeof xpathArg.value === "string"
        ? xpathArg.value
        : "";
      const ret = ast.name === "xpathNumber"
        ? "number"
        : ast.name === "xpathBoolean"
        ? "boolean"
        : ast.name === "xpathNode"
        ? "node"
        : "string";
      return finalize(createSourceQueryBlock(workspace, xpath, ret));
    }
    if (ast.name === "map") {
      registerMapBlocks();
      const block = workspace.newBlock(MAPS_CREATE_WITH) as BlockSvg & {
        itemCount_: number;
        updateShape_: () => void;
      };
      const pairs = Math.floor(ast.args.length / 2);
      block.itemCount_ = pairs;
      block.updateShape_();
      for (let i = 0; i < pairs; i++) {
        const keyAst = ast.args[i * 2];
        const valAst = ast.args[i * 2 + 1];
        if (keyAst?.kind === "literal") {
          block.setFieldValue(String(keyAst.value), `KEY${i}`);
        }
        if (valAst) {
          const child = astToExpressionBlock(workspace, valAst, returnType, finalize);
          block.getInput(`VAL${i}`)?.connection?.connect(child.outputConnection!);
        }
      }
      return finalize(block);
    }
    if (ast.name === "decision_table") {
      registerDecisionTableBlocks();
      const block = workspace.newBlock(DECISION_TABLE_BLOCK) as BlockSvg;
      const nameAst = ast.args[0];
      const outputAst = ast.args[2];
      if (nameAst?.kind === "literal") block.setFieldValue(String(nameAst.value), "NAME");
      if (outputAst?.kind === "literal") block.setFieldValue(String(outputAst.value), "OUTPUT");
      if (ast.args[1]) {
        const inputs = astToExpressionBlock(workspace, ast.args[1], "string", finalize);
        block.getInput("INPUTS")?.connection?.connect(inputs.outputConnection!);
      }
      return finalize(block);
    }
    if (ast.name === "sheet_lookup") {
      registerSheetBlocks();
      const block = workspace.newBlock(SHEET_LOOKUP) as BlockSvg;
      const nameAst = ast.args[0];
      if (nameAst?.kind === "literal") block.setFieldValue(String(nameAst.value), "NAME");
      const plug = (input: string, arg: ExprAst | undefined) => {
        if (!arg) return;
        const child = astToExpressionBlock(workspace, arg, "string", finalize);
        block.getInput(input)?.connection?.connect(child.outputConnection!);
      };
      plug("MATCH_COL", ast.args[1]);
      plug("MATCH_VAL", ast.args[2]);
      plug("RETURN_COL", ast.args[3]);
      return finalize(block);
    }
    if (ast.name === "trim" && ast.args[0]) {
      const block = workspace.newBlock("text_trim") as BlockSvg;
      block.setFieldValue("BOTH", "MODE");
      const inner = astToExpressionBlock(workspace, ast.args[0], "string", finalize);
      block.getInput("TEXT")!.connection!.connect(inner.outputConnection!);
      return finalize(block);
    }
    if (ast.name === "concat" && ast.args.length >= 2) {
      const block = workspace.newBlock("text_join") as BlockSvg;
      // deno-lint-ignore no-explicit-any
      const join = block as any;
      join.itemCount_ = ast.args.length;
      join.updateShape_?.();
      for (let i = 0; i < ast.args.length; i++) {
        const child = astToExpressionBlock(workspace, ast.args[i]!, "string", finalize);
        block.getInput(`ADD${i}`)?.connection?.connect(child.outputConnection!);
      }
      return finalize(block);
    }
    if (ast.name === "if" && ast.args.length >= 3) {
      const block = workspace.newBlock("logic_ternary") as BlockSvg;
      block.getInput("IF")!.connection!.connect(
        astToExpressionBlock(workspace, ast.args[0]!, "boolean", finalize).outputConnection!,
      );
      block.getInput("THEN")!.connection!.connect(
        astToExpressionBlock(workspace, ast.args[1]!, returnType, finalize).outputConnection!,
      );
      block.getInput("ELSE")!.connection!.connect(
        astToExpressionBlock(workspace, ast.args[2]!, returnType, finalize).outputConnection!,
      );
      return finalize(block);
    }
    if (ast.name === "maps_get" && ast.args.length >= 2) {
      registerMapBlocks();
      const mapName = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "defaults";
      const key = ast.args[1]?.kind === "literal" ? String(ast.args[1].value) : "";
      return finalize(createMapsGetBlock(workspace, mapName, key) as BlockSvg);
    }
    if (ast.name === "var" && ast.args[0]?.kind === "literal") {
      const name = String(ast.args[0].value);
      // deno-lint-ignore no-explicit-any
      const ws = workspace as any;
      let variable = ws.getVariable?.(name);
      if (!variable && typeof ws.createVariable === "function") {
        variable = ws.createVariable(name);
      }
      const block = workspace.newBlock("variables_get") as BlockSvg;
      if (variable) {
        block.setFieldValue(variable.getId(), "VAR");
      }
      return finalize(block);
    }
    if (ast.name === "call") {
      const name = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
      const block = workspace.newBlock("procedures_callreturn") as BlockSvg & {
        loadExtraState?: (state: unknown) => void;
      };
      if (name) block.setFieldValue(name, "NAME");
      const argAsts = ast.args.slice(1);
      block.loadExtraState?.({
        name,
        params: argAsts.map((_, i) => `arg${i}`),
      });
      for (let i = 0; i < argAsts.length; i++) {
        const child = astToExpressionBlock(workspace, argAsts[i]!, returnType, finalize);
        block.getInput(`ARG${i}`)?.connection?.connect(child.outputConnection!);
      }
      return finalize(block);
    }
    if (
      ast.name === "eq" || ast.name === "ne" || ast.name === "lt" ||
      ast.name === "le" || ast.name === "gt" || ast.name === "ge"
    ) {
      const block = workspace.newBlock("logic_compare") as BlockSvg;
      const opMap: Record<string, string> = {
        eq: "EQ",
        ne: "NEQ",
        lt: "LT",
        le: "LTE",
        gt: "GT",
        ge: "GTE",
      };
      block.setFieldValue(opMap[ast.name] ?? "EQ", "OP");
      if (ast.args[0]) {
        block.getInput("A")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[0], returnType, finalize).outputConnection!,
        );
      }
      if (ast.args[1]) {
        block.getInput("B")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[1], returnType, finalize).outputConnection!,
        );
      }
      return finalize(block);
    }
    if (ast.name === "and") {
      // `and(any_of(list, v, true), <restriction>(list, …))` is one guarded
      // restriction block, not a Boolean and of two of them.
      const guarded = guardedRestriction(ast);
      if (guarded) {
        const block = restrictionBlockFromAst(workspace, guarded, finalize);
        if (block) {
          setRestrictionRequiresItems(block, true);
          return finalize(block);
        }
      }
    }
    if (ast.name === "and" || ast.name === "or") {
      const block = workspace.newBlock("logic_operation") as BlockSvg;
      block.setFieldValue(ast.name === "or" ? "OR" : "AND", "OP");
      if (ast.args[0]) {
        block.getInput("A")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[0], "boolean", finalize).outputConnection!,
        );
      }
      if (ast.args[1]) {
        block.getInput("B")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[1], "boolean", finalize).outputConnection!,
        );
      }
      return finalize(block);
    }
    if (ast.name === "not" && ast.args[0]) {
      const block = workspace.newBlock("logic_negate") as BlockSvg;
      block.getInput("BOOL")!.connection!.connect(
        astToExpressionBlock(workspace, ast.args[0], "boolean", finalize).outputConnection!,
      );
      return finalize(block);
    }
    if (ast.name === "lists_getIndex" && ast.args[0]) {
      ensureStockListMessages();
      const block = workspace.newBlock("lists_getIndex") as BlockSvg & {
        updateAt_?: (hasAt: boolean) => void;
      };
      block.setFieldValue("GET", "MODE");
      const where = ast.args[1]?.kind === "literal" ? String(ast.args[1].value) : "FIRST";
      block.setFieldValue(where, "WHERE");
      const needsAt = where === "FROM_START" || where === "FROM_END";
      block.updateAt_?.(needsAt);
      const list = astToExpressionBlock(workspace, ast.args[0], returnType, finalize);
      block.getInput("VALUE")?.connection?.connect(list.outputConnection!);
      if (needsAt && ast.args[2]) {
        const at = astToExpressionBlock(workspace, ast.args[2], "number", finalize);
        block.getInput("AT")?.connection?.connect(at.outputConnection!);
      }
      return finalize(block);
    }
    if (ast.name === "list") {
      const block = workspace.newBlock("lists_create_with") as BlockSvg;
      // deno-lint-ignore no-explicit-any
      const list = block as any;
      list.itemCount_ = ast.args.length;
      list.updateShape_?.();
      for (let i = 0; i < ast.args.length; i++) {
        const child = astToExpressionBlock(workspace, ast.args[i]!, returnType, finalize);
        block.getInput(`ADD${i}`)?.connection?.connect(child.outputConnection!);
      }
      return finalize(block);
    }
    if (isRestrictionCall(ast.name)) {
      const block = restrictionBlockFromAst(workspace, ast, finalize);
      if (block) return finalize(block);
    }
    if (isSetCall(ast.name)) {
      registerLogicBlocks();
      const block = workspace.newBlock(LISTS_SET_OPERATION_BLOCK) as BlockSvg;
      block.setFieldValue(callToSetOp(ast.name), "OP");
      if (ast.args[0]) {
        block.getInput("A")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[0], "node", finalize).outputConnection!,
        );
      }
      if (ast.args[1]) {
        block.getInput("B")!.connection!.connect(
          astToExpressionBlock(workspace, ast.args[1], "node", finalize).outputConnection!,
        );
      }
      return finalize(block);
    }
  }

  return finalize(createSourceQueryBlock(workspace, serialize(ast), returnType));
}

type CallAst = Extract<ExprAst, { kind: "call" }>;

/**
 * Build one `logic_list_restriction` from `all_of` / `at_least` / … .
 *
 * Returns null when the call cannot be shown on the block — the threshold is a
 * numeric field, so a computed count has to stay a raw Mapping Expression.
 */
function restrictionBlockFromAst(
  workspace: Workspace,
  ast: CallAst,
  finalize: (block: BlockSvg) => BlockSvg,
): BlockSvg | null {
  const op = callToRestrictionOp(ast.name);
  const counting = restrictionOpNeedsCount(op);
  const countAst = counting ? ast.args[1] : undefined;
  if (counting && !(countAst?.kind === "literal" && typeof countAst.value === "number")) {
    return null;
  }
  registerLogicBlocks();
  const block = workspace.newBlock(LOGIC_LIST_RESTRICTION_BLOCK) as BlockSvg;
  block.setFieldValue(op, "OP");
  if (counting) block.setFieldValue(Number(countAst!.value), "N");
  const nameAst = counting ? ast.args[2] : ast.args[1];
  setRestrictionItemName(
    block,
    nameAst?.kind === "literal" ? String(nameAst.value) : DEFAULT_ITEM_NAME,
  );
  if (ast.args[0]) {
    block.getInput("LIST")!.connection!.connect(
      astToExpressionBlock(workspace, ast.args[0], "node", finalize).outputConnection!,
    );
  }
  const predAst = counting ? ast.args[3] : ast.args[2];
  if (predAst) {
    block.getInput("PRED")!.connection!.connect(
      astToExpressionBlock(workspace, predAst, "boolean", finalize).outputConnection!,
    );
  }
  return block;
}

/**
 * The restriction inside `and(any_of(list, v, true), <restriction>(list, …, v, …))`,
 * which is how the **require at least one item** guard is written.
 */
function guardedRestriction(ast: CallAst): CallAst | null {
  if (ast.args.length !== 2) return null;
  const [guard, body] = ast.args;
  if (guard?.kind !== "call" || guard.name !== "any_of" || guard.args.length !== 3) return null;
  if (guard.args[2]?.kind !== "literal" || guard.args[2].value !== true) return null;
  if (body?.kind !== "call" || !isRestrictionCall(body.name)) return null;
  const bodyOp = callToRestrictionOp(body.name);
  // Only the vacuously-true operators show the checkbox, so only they can absorb
  // the guard; on the others (`at_least(list, 0, …)`) it would be dropped.
  if (!restrictionOpHoldsOnEmptyList(bodyOp)) return null;
  const bodyName = restrictionOpNeedsCount(bodyOp) ? body.args[2] : body.args[1];
  if (!guard.args[0] || !body.args[0]) return null;
  if (serialize(guard.args[0]) !== serialize(body.args[0])) return null;
  if (!bodyName || serialize(guard.args[1]!) !== serialize(bodyName)) return null;
  return body;
}

function ensureStockListMessages(): void {
  ensureStockBlocklyMessages();
}
