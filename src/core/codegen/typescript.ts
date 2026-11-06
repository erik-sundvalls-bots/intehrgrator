/**
 * TypeScript conversion-script generation (ehrtslib simplified constructors).
 *
 * Walks the Template Skeleton + Mapping Model expressions into nested
 * `new COMPOSITION({ ... })` / `rm(OBSERVATION, { ... })` trees. Blockly canvas
 * generation (optional RM, loops as they appear on the canvas) lives in
 * `src/blockly/typescript_codegen.ts` and replaces this adapter when a
 * workspace snapshot is available.
 *
 * Conversion Test Run(s) in Mapping preview still evaluate Mapping Model slots
 * through the Target instance format handler (ADR 0001 / ADR 0003). TypeScript
 * Output mode executes this script.
 */

import type {
  MappingFunction,
  MappingInclude,
  MappingLoop,
  MappingModel,
  MappingSlot,
  SkeletonNode,
} from "../../types/mod.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";
import { namedLoopBinding } from "../named_loop_path.ts";
import { parseExpression, type ExprAst, isQuantifyCall } from "../expression/mod.ts";
import { DEFAULT_ACTION_ARCHETYPE_ID, isAutoFixedValueSlot, LOCATABLE_TYPES } from "../rm_mandatory.ts";
import {
  propsLackClinicalContent,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";
import { attributesFor } from "../rm_meta.ts";
import { usesOpenEhrProduct } from "./product.ts";
import { codedTextParts } from "../openehr/coded_text.ts";
import { emitShellFields, type ShellCodegen } from "./shell_emit.ts";
import { octetBytesCall } from "../rm_shell_fragment.ts";
import { terminologyValuesForSlot } from "../ai/slot_tree.ts";
import {
  functionIdentMap,
  jsFunctionIdent,
  valueFunctions,
} from "./user_functions.ts";
import { TYPESCRIPT_HELPERS_SPECIFIER } from "./helpers/locations.ts";

/** RM classes whose constructors actually apply an init bag. */
const NATIVE_INIT_TYPES = new Set([
  "COMPOSITION",
  "CODE_PHRASE",
  "DV_TEXT",
  "DV_CODED_TEXT",
]);

const LIST_ATTRS = new Set([
  "content",
  "items",
  "events",
  "activities",
  "links",
  "participations",
  "other_participations",
]);

export interface TsEmitContext {
  sourceVar: string;
  /** When set, relative source paths evaluate against this loop node. */
  loopVar?: string;
  /** Loop item name → TypeScript ident, outermost first. Inner names shadow. */
  loopBindings?: Readonly<Record<string, string>>;
  /** `include_when` guards, consulted while emitting a skeleton node. */
  includes?: readonly MappingInclude[];
  types: Set<string>;
  helpers: Set<"string" | "number" | "boolean" | "nodes" | "rm" | "node" | "handlebars" | "sheets" | "logic" | "coded" | "party" | "prune">;
  /** Slot id → archetype id for archetype-root blocks whose field is still the at-code. */
  archetypeRootIds?: Map<string, string>;
  /** Skeleton nodes by slot id: output names of blocks not renamed by the user. */
  skeletonNodes?: Map<string, SkeletonNode>;
  mappingFunctions?: MappingFunction[];
  fnParams?: Set<string>;
  fnIdents?: Map<string, string>;
}

export function createTsEmitContext(
  sourceVar = "sourceCtx.data",
  mappingFunctions?: MappingFunction[],
): TsEmitContext {
  return { sourceVar, types: new Set(), helpers: new Set(), mappingFunctions };
}

function emitChangeCaseTs(text: string, mode: ExprAst | undefined): string {
  const value = `String(${text} ?? "")`;
  const which = mode?.kind === "literal" ? String(mode.value) : "LOWERCASE";
  if (which === "UPPERCASE") return `${value}.toUpperCase()`;
  if (which === "TITLECASE") {
    return `${value}.replace(/\\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())`;
  }
  return `${value}.toLowerCase()`;
}

export function emitTsExpression(ast: ExprAst, ctx: TsEmitContext): string {
  switch (ast.kind) {
    case "literal":
      if (typeof ast.value === "string") return JSON.stringify(ast.value);
      return String(ast.value);
    case "binary":
      return `(${emitTsExpression(ast.left, ctx)} ${ast.op} ${emitTsExpression(ast.right, ctx)})`;
    case "call": {
      if (isQuantifyCall(ast.name)) return emitQuantifierTs(ast, ctx);
      const args = ast.args.map((a) => emitTsExpression(a, ctx));
      switch (ast.name) {
        case "trim":
          return `String(${args[0]} ?? "").trim()`;
        case "change_case":
          return emitChangeCaseTs(args[0] ?? '""', ast.args[1]);
        case "concat":
          return `[${args.join(", ")}].join("")`;
        case "round":
          return `Math.round(Number(${args[0]} ?? 0))`;
        case "modulo":
          return `(Number(${args[0]} ?? 0) % Number(${args[1]} ?? 1))`;
        case "constrain":
          return `(Math.min(Number(${args[2]} ?? 0), Math.max(Number(${args[1]} ?? 0), Number(${args[0]} ?? 0))))`;
        case "if":
          return `(${args[0]} ? ${args[1]} : ${args[2]})`;
        case "switch":
          return emitSwitchTs(args);
        case "var": {
          const name = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          if (name && ctx.fnParams?.has(name)) return jsFunctionIdent(name);
          ctx.helpers.add("logic");
          return `__vars[${args[0]}]`;
        }
        case "call": {
          const fname = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          const ident = ensureTsFnIdents(ctx).get(fname) ?? `fn_${jsFunctionIdent(fname)}`;
          return `${ident}(${args.slice(1).join(", ")})`;
        }
        case "eq":
          ctx.helpers.add("logic");
          return `sameItem(${args[0]}, ${args[1]})`;
        case "ne":
          ctx.helpers.add("logic");
          return `!sameItem(${args[0]}, ${args[1]})`;
        case "lt":
          return `(Number(${args[0]}) < Number(${args[1]}))`;
        case "le":
          return `(Number(${args[0]}) <= Number(${args[1]}))`;
        case "gt":
          return `(Number(${args[0]}) > Number(${args[1]}))`;
        case "ge":
          return `(Number(${args[0]}) >= Number(${args[1]}))`;
        case "and":
          return `(${args[0]} && ${args[1]})`;
        case "or":
          return `(${args[0]} || ${args[1]})`;
        case "not":
          return `!(${args[0]})`;
        case "list":
          return `[${args.join(", ")}]`;
        case "lists_getIndex":
          ctx.helpers.add("logic");
          return `listGetIndex(${args[0]}, ${args[1] ?? '"FIRST"'}, ${args[2] ?? "1"})`;
        case "intersection":
          ctx.helpers.add("logic");
          return `setIntersection(asList(${args[0]}), asList(${args[1]}))`;
        case "union":
          ctx.helpers.add("logic");
          return `setUnion(asList(${args[0]}), asList(${args[1]}))`;
        case "difference":
          ctx.helpers.add("logic");
          return `setDifference(asList(${args[0]}), asList(${args[1]}))`;
        case "maps_get":
          return emitMapsGet(ast, args);
        case "sheet_get_cell":
        case "sheet_get_xy":
        case "sheet_get_row":
        case "sheet_get_column":
        case "sheet_get_header":
        case "sheet_get_data":
        case "sheet_coded_text":
        case "sheet_lookup":
        case "decision_table":
          ctx.helpers.add("sheets");
          return emitSheetCall(ast.name, args);
        case "xpathNumber":
          ctx.helpers.add("number");
          return emitXpathCall("xpathNumber", ast.args[0], args[0] ?? '""', ctx);
        case "xpathBoolean":
          ctx.helpers.add("boolean");
          return emitXpathCall("xpathBoolean", ast.args[0], args[0] ?? '""', ctx);
        case "xpathNode":
          ctx.helpers.add("node");
          return emitXpathCall("xpathNode", ast.args[0], args[0] ?? '""', ctx);
        case "handlebars":
          ctx.helpers.add("handlebars");
          return `handlebars(${args[0] ?? '""'}, ${args[1] ?? "{}"})`;
        case "map":
          return emitMapLiteral(ast, args);
        case "xpath":
        case "xpathString":
          ctx.helpers.add("string");
          return emitXpathCall("xpathString", ast.args[0], args[0] ?? '""', ctx);
        default:
          ctx.helpers.add("string");
          return emitXpathCall("xpathString", ast.args[0], args[0] ?? '""', ctx);
      }
    }
  }
}

function ensureTsFnIdents(ctx: TsEmitContext): Map<string, string> {
  if (!ctx.fnIdents) {
    ctx.fnIdents = functionIdentMap(valueFunctions(ctx.mappingFunctions), (name) =>
      `fn_${jsFunctionIdent(name)}`
    );
  }
  return ctx.fnIdents;
}

export function emitTsUserFunctions(ctx: TsEmitContext): string {
  const fns = valueFunctions(ctx.mappingFunctions);
  if (!fns.length) return "";
  const idents = ensureTsFnIdents(ctx);
  const lines: string[] = [];
  for (const fn of fns) {
    const ident = idents.get(fn.name) ?? `fn_${jsFunctionIdent(fn.name)}`;
    const params = fn.params.map((p) => `${jsFunctionIdent(p)}: unknown`).join(", ");
    const inner: TsEmitContext = {
      ...ctx,
      fnParams: new Set(fn.params),
      fnIdents: idents,
    };
    const body = emitTsExpressionSource(fn.body!, inner) ?? "null";
    lines.push(`function ${ident}(${params}): unknown {`);
    lines.push(`  return ${body};`);
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}

function wrapTsWithFunctions(parts: TypeScriptModuleParts, ctx: TsEmitContext): string {
  const fns = emitTsUserFunctions(ctx);
  return wrapTypeScriptModule({
    ...parts,
    body: fns ? `${fns}${parts.body}` : parts.body,
  });
}

function emitMapsGet(ast: Extract<ExprAst, { kind: "call" }>, args: string[]): string {
  const mapArg = ast.args[0];
  const key = args[1] ?? '""';
  if (mapArg?.kind === "literal" && mapArg.value === "defaults") {
    return `defaults[${key}]`;
  }
  return `((${args[0]} === "defaults" ? defaults : {})[${key}])`;
}

function emitSheetCall(name: string, args: string[]): string {
  return `${jsName(name)}(${args.join(", ")})`;
}

function jsName(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function emitMapLiteral(
  ast: Extract<ExprAst, { kind: "call" }>,
  args: string[],
): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    const keyAst = ast.args[i];
    const key = keyAst?.kind === "literal" && typeof keyAst.value === "string"
      ? JSON.stringify(keyAst.value)
      : `[${args[i]}]`;
    parts.push(`${key}: ${args[i + 1]}`);
  }
  return `({ ${parts.join(", ")} })`;
}

function emitXpathCall(
  fn: string,
  pathAst: ExprAst | undefined,
  pathCode: string,
  ctx: TsEmitContext,
): string {
  const path = pathAst?.kind === "literal" ? String(pathAst.value).trim() : "";
  const named = path ? namedLoopBinding(path, ctx.loopBindings) : null;
  if (named) {
    const rest = named.rest === "." ? "." : named.rest;
    const restCode = looksLikeOpenEhrLocator(rest)
      ? JSON.stringify(compileAuthoringPath(rest, "json"))
      : JSON.stringify(rest);
    return `${fn}(${restCode}, ${named.ident})`;
  }
  let code = pathCode;
  if (path && looksLikeOpenEhrLocator(path)) {
    code = JSON.stringify(compileAuthoringPath(path, "json"));
  }
  const relative = Boolean(path) && !path.startsWith("$") && !path.startsWith("/");
  const node = relative && ctx.loopVar ? ctx.loopVar : "sourceCtx.data";
  if (node === "sourceCtx.data") return `${fn}(${code})`;
  return `${fn}(${code}, ${node})`;
}

function emitQuantifierTs(
  ast: Extract<ExprAst, { kind: "call" }>,
  ctx: TsEmitContext,
): string {
  ctx.helpers.add("logic");
  const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
  const listCode = emitTsExpression(ast.args[0]!, ctx);
  const nCode = card ? emitTsExpression(ast.args[1]!, ctx) : "0";
  const varAst = card ? ast.args[2] : ast.args[1];
  const predAst = card ? ast.args[3] : ast.args[2];
  const varName = varAst?.kind === "literal" ? String(varAst.value) : "item";
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName) ? varName : "_item";
  const innerCtx: TsEmitContext = {
    ...ctx,
    loopVar: ident,
    loopBindings: { ...ctx.loopBindings, [varName]: ident },
  };
  const predCode = predAst ? emitTsExpression(predAst, innerCtx) : "true";
  const bind = `(__vars[${JSON.stringify(varName)}] = ${ident}, ${predCode})`;
  const arr = `asList(${listCode})`;
  switch (ast.name) {
    case "all_of":
      return `${arr}.every((${ident}) => ${bind})`;
    case "any_of":
      return `${arr}.some((${ident}) => ${bind})`;
    case "none_of":
      return `${arr}.every((${ident}) => !${bind})`;
    case "at_least":
      return `${arr}.filter((${ident}) => ${bind}).length >= ${nCode}`;
    case "at_most":
      return `${arr}.filter((${ident}) => ${bind}).length <= ${nCode}`;
    case "exactly":
      return `${arr}.filter((${ident}) => ${bind}).length === ${nCode}`;
    default:
      return "false";
  }
}

function emitSwitchTs(args: string[]): string {
  if (args.length < 2) return "null";
  const discriminant = args[0];
  const defaultV = args[args.length - 1];
  const pairs = args.slice(1, -1);
  let expr = defaultV ?? "null";
  for (let i = pairs.length - 2; i >= 0; i -= 2) {
    expr = `(${discriminant} === ${pairs[i]} ? ${pairs[i + 1]} : ${expr})`;
  }
  return expr;
}

export function emitTsExpressionSource(
  expression: string,
  ctx: TsEmitContext,
): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  try {
    return emitTsExpression(parseExpression(trimmed), ctx);
  } catch {
    ctx.helpers.add("string");
    return emitXpathCall(
      "xpathString",
      { kind: "literal", value: trimmed },
      JSON.stringify(trimmed),
      ctx,
    );
  }
}

export interface TypeScriptModuleParts {
  templateId: string;
  body: string;
  types: Set<string>;
  helpers: Set<"string" | "number" | "boolean" | "nodes" | "rm" | "node" | "handlebars" | "sheets" | "logic" | "coded" | "party" | "prune">;
  rootType?: string;
  /** Where the RM tree was walked from. */
  source?: "blockly" | "skeleton" | "slots";
  extraImports?: string[];
}

export function wrapTypeScriptModule(parts: TypeScriptModuleParts): string {
  const types = [...parts.types].sort();
  const fonto: string[] = [];
  if (parts.helpers.has("string")) fonto.push("evaluateXPathToString");
  if (parts.helpers.has("number")) fonto.push("evaluateXPathToNumber");
  if (parts.helpers.has("boolean")) fonto.push("evaluateXPathToBoolean");
  if (parts.helpers.has("nodes")) fonto.push("evaluateXPathToNodes");
  if (parts.helpers.has("node")) fonto.push("evaluateXPathToFirstNode");

  const root = parts.rootType ?? (types.includes("COMPOSITION") ? "COMPOSITION" : "unknown");
  const dialect = types.length ? "TypeScript / ehrtslib" : "TypeScript";
  const lines: string[] = [
    `// Generated by intEHRgrator — Conversion Script (${dialect})`,
    `// Template: ${parts.templateId || "(none)"}`,
    parts.source === "blockly"
      ? "// Source: Blockly canvas (regenerated when the mapping editor changes)"
      : parts.source === "skeleton"
      ? "// Source: Template Skeleton + Mapping Model expressions"
      : "// Source: Mapping Model slots (no canvas / skeleton available)",
    "// Mapping preview Test Run evaluates Mapping Model slots through the Target",
    "// instance format handler (ADR 0001). TypeScript Output mode executes this script.",
    "",
  ];
  if (types.length) {
    lines.push(`import {`);
    for (const t of types) lines.push(`  ${t},`);
    lines.push(`} from "ehrtslib/openehr_rm.ts";`);
  }
  if (fonto.length) {
    if (types.length) lines.push("");
    lines.push("import {");
    for (const fn of fonto) lines.push(`  ${fn},`);
    lines.push(`} from "fontoxpath";`);
  }
  if (parts.helpers.has("handlebars")) {
    if (types.length || fonto.length) lines.push("");
    lines.push('import Handlebars from "handlebars";');
  }
  if (parts.extraImports?.length) {
    if (types.length || fonto.length || parts.helpers.has("handlebars")) lines.push("");
    for (const line of parts.extraImports) lines.push(line);
  }
  const helperNames = typescriptHelperImportNames(parts.helpers, parts.body);
  if (helperNames.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("import {");
    for (const name of helperNames) lines.push(`  ${name},`);
    lines.push(`} from ${JSON.stringify(TYPESCRIPT_HELPERS_SPECIFIER)};`);
  }
  lines.push(
    "",
    "export type SourceContext = { format: string; data: unknown };",
    "",
    "export function convertSourceToComposition(",
    "  sourceCtx: SourceContext,",
    "  defaults: Record<string, unknown> = {},",
    ...(parts.helpers.has("sheets")
      ? ["  sheets: Record<string, unknown> = {},"]
      : []),
    `)${root !== "unknown" ? `: ${root}` : ""} {`,
  );
  const wrappers = typescriptHelperWrappers(parts.helpers, parts.body);
  if (wrappers.length) {
    lines.push(...indentLines(wrappers, 1));
    lines.push("");
  }
  if (parts.helpers.has("logic")) {
    lines.push("  const __vars: Record<string, unknown> = {};");
    lines.push("");
  }
  for (const line of parts.body.split("\n")) {
    lines.push(line.length ? `  ${line}` : "");
  }
  lines.push("}", "");
  return lines.join("\n");
}

function typescriptHelperImportNames(helpers: Set<string>, body: string): string[] {
  const names: string[] = [];
  const uses = (needle: string) => body.includes(needle);
  if (helpers.has("string") || uses("xpathString(")) names.push("igXpathString");
  if (helpers.has("number") || uses("xpathNumber(")) names.push("igXpathNumber");
  if (helpers.has("boolean") || uses("xpathBoolean(")) names.push("igXpathBoolean");
  if (helpers.has("nodes") || uses("xpathNodes(")) names.push("igXpathNodes");
  if (helpers.has("node") || uses("xpathNode(")) names.push("igXpathNode");
  if (uses("asList(")) names.push("asList");
  if (uses("listGetIndex(")) names.push("listGetIndex");
  if (uses("sameItem(")) names.push("sameItem");
  if (uses("setDifference(")) names.push("setDifference");
  if (uses("setIntersection(")) names.push("setIntersection");
  if (uses("setUnion(")) names.push("setUnion");
  if (helpers.has("rm") || uses("rm(")) names.push("rm");
  if (helpers.has("party") || uses("partyValue(")) names.push("partyValue");
  if (helpers.has("coded") || uses("codedText(")) names.push("igCodedText");
  for (const name of ["__blankValue", "__el", "__filled", "__keep", "__num", "__toBool", "__toNum", "__tree"]) {
    if (uses(`${name}(`)) names.push(name);
  }
  if (helpers.has("handlebars") || uses("handlebars(")) names.push("igHandlebars");
  if (uses("decisionTable(")) names.push("igDecisionTable");
  if (uses("sheetGetCell(")) names.push("igSheetGetCell");
  if (uses("sheetGetColumn(")) names.push("igSheetGetColumn");
  if (uses("sheetGetData(")) names.push("igSheetGetData");
  if (uses("sheetGetHeader(")) names.push("igSheetGetHeader");
  if (uses("sheetGetRow(")) names.push("igSheetGetRow");
  if (uses("sheetGetXy(")) names.push("igSheetGetXy");
  if (uses("sheetLookup(")) names.push("igSheetLookup");
  if (uses("sheetCodedText(")) names.push("igSheetCodedText");
  return [...new Set(names)].sort();
}

function typescriptHelperWrappers(helpers: Set<string>, body: string): string[] {
  const uses = (needle: string) => helpers.size >= 0 && body.includes(needle);
  const lines: string[] = [];
  const add = (...rows: string[]) => {
    if (lines.length) lines.push("");
    lines.push(...rows);
  };
  if (helpers.has("string") || uses("xpathString(")) {
    add(
      "function xpathString(path: string, node: unknown = sourceCtx.data): string {",
      "  return igXpathString(evaluateXPathToString, path, node);",
      "}",
    );
  }
  if (helpers.has("number") || uses("xpathNumber(")) {
    add(
      "function xpathNumber(path: unknown, node: unknown = sourceCtx.data): number {",
      "  return igXpathNumber(evaluateXPathToNumber, path, node);",
      "}",
    );
  }
  if (helpers.has("boolean") || uses("xpathBoolean(")) {
    add(
      "function xpathBoolean(path: unknown, node: unknown = sourceCtx.data): boolean {",
      "  return igXpathBoolean(evaluateXPathToBoolean, path, node);",
      "}",
    );
  }
  if (helpers.has("nodes") || uses("xpathNodes(")) {
    add(
      "function xpathNodes(path: string, node: unknown = sourceCtx.data): unknown[] {",
      "  return igXpathNodes(evaluateXPathToNodes, path, node);",
      "}",
    );
  }
  if (helpers.has("node") || uses("xpathNode(")) {
    add(
      "function xpathNode(path: string, node: unknown = sourceCtx.data): unknown {",
      "  return igXpathNode(evaluateXPathToFirstNode, path, node);",
      "}",
    );
  }
  if (helpers.has("coded") || uses("codedText(")) {
    add(
      "function codedText(text: unknown, choices: Array<[string, string, string]>) {",
      "  return igCodedText(DV_CODED_TEXT, text, choices);",
      "}",
    );
  }
  if (helpers.has("handlebars") || uses("handlebars(")) {
    add(
      "function handlebars(template: string, context: unknown): string {",
      "  return igHandlebars(Handlebars, template, context);",
      "}",
    );
  }
  if (uses("sheetGetCell(")) {
    add("function sheetGetCell(name: string, a1: string) { return igSheetGetCell(sheets, name, a1); }");
  }
  if (uses("sheetGetXy(")) {
    add("function sheetGetXy(name: string, x: number, y: number) { return igSheetGetXy(sheets, name, x, y); }");
  }
  if (uses("sheetGetRow(")) {
    add("function sheetGetRow(name: string, y: number) { return igSheetGetRow(sheets, name, y); }");
  }
  if (uses("sheetGetColumn(")) {
    add("function sheetGetColumn(name: string, x: number) { return igSheetGetColumn(sheets, name, x); }");
  }
  if (uses("sheetGetHeader(")) {
    add("function sheetGetHeader(name: string, x: number) { return igSheetGetHeader(sheets, name, x); }");
  }
  if (uses("sheetGetData(")) {
    add("function sheetGetData(name: string) { return igSheetGetData(sheets, name); }");
  }
  if (uses("sheetLookup(")) {
    add(
      "function sheetLookup(name: string, matchCol: string | number, matchValue: unknown, returnCol?: string | number) {",
      "  return igSheetLookup(sheets, name, matchCol, matchValue, returnCol);",
      "}",
    );
  }
  if (uses("sheetCodedText(")) {
    add(
      "function sheetCodedText(name: string, keyColumn: string, key: unknown, valueColumn: string, codeColumn: string, terminology: string, mappingColumns: unknown) {",
      "  return igSheetCodedText(sheets, name, keyColumn, key, valueColumn, codeColumn, terminology, mappingColumns);",
      "}",
    );
  }
  if (uses("decisionTable(")) {
    add(
      "function decisionTable(name: string, inputs: Record<string, unknown> = {}, outputCol?: string) {",
      "  return igDecisionTable(sheets, name, inputs, outputCol);",
      "}",
    );
  }
  return lines;
}

const PRUNE_TREE_TYPES = new Set(["ITEM_TREE", "ITEM_LIST", "CLUSTER"]);

/** Value set of a coded node: the template list, else the openEHR RM terminology group. */
export function codedChoicesForNode(node: SkeletonNode): Array<[string, string, string]> {
  const allowed = (node.allowedValues ?? []).filter((row) => row.code);
  if (allowed.length) return allowed.map((row) => [row.code, row.label || row.code, row.terminologyId || "local"]);
  const rm = terminologyValuesForSlot(node.slotId);
  return rm ? rm.values.map((row) => [row.code, row.text || row.code, rm.terminologyId]) : [];
}

/** Wrap a constructed RM node so it drops out at run time when it ends up empty. */
export function wrapPruneNode(rmType: string, code: string, ctx: TsEmitContext): string {
  if (rmType === "ELEMENT") return (ctx.helpers.add("prune"), `__el(${code})`);
  if (PRUNE_TREE_TYPES.has(rmType)) return (ctx.helpers.add("prune"), `__tree(${code})`);
  return code;
}

/** An ELEMENT value that is empty at run time is left out. */
export function wrapPruneValue(code: string, ctx: TsEmitContext): string {
  ctx.helpers.add("prune");
  return `__filled(${code})`;
}

/** DV_BOOLEAN.value: a real boolean ("false" is false), not a string (F-M11). */
export function wrapBooleanValue(code: string, ctx: TsEmitContext): string {
  ctx.helpers.add("prune");
  return `__toBool(${code})`;
}

/** A list attribute: drop entries that were pruned. */
export function wrapPruneList(code: string, ctx: TsEmitContext): string {
  ctx.helpers.add("prune");
  return `__keep(${code})`;
}

/**
 * Numeric data values (DV_COUNT throws on NaN): construct only when the
 * magnitude is a finite number, else leave the value out.
 */
export function guardNumericConstruct(
  magnitudeExpr: string,
  build: (magnitudeIdent: string) => string,
  ctx: TsEmitContext,
): string {
  if (/^-?\d+(\.\d+)?$/.test(magnitudeExpr.trim())) return build(magnitudeExpr.trim());
  ctx.helpers.add("prune");
  return `__num(${magnitudeExpr}, (__m) => ${build("__m")})`;
}

function indentLines(lines: string[], n: number): string[] {
  const pad = "  ".repeat(n);
  return lines.map((line) => (line.length ? pad + line : line));
}

export function formatObjectLiteral(
  props: Array<[string, string]>,
  indent: number,
): string {
  if (!props.length) return "{}";
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  const body = props
    .map(([key, value]) => `${inner}${key}: ${value}`)
    .join(",\n");
  return `{\n${body},\n${pad}}`;
}

export function formatRmConstruct(
  rmType: string,
  props: Array<[string, string]>,
  indent: number,
  ctx: TsEmitContext,
): string {
  ctx.types.add(rmType);
  const obj = formatObjectLiteral(props, indent);
  if (NATIVE_INIT_TYPES.has(rmType)) {
    return `new ${rmType}(${obj})`;
  }
  ctx.helpers.add("rm");
  return `rm(${rmType}, ${obj})`;
}

/** Wrap a source expression as a number unless it already yields one. */
export function asNumberExpr(expr: string): string {
  if (/^(xpathNumber|Number)\(/.test(expr)) return expr;
  return `Number(${expr})`;
}

export function asStringExpr(expr: string): string {
  if (/^(xpathString|String)\(/.test(expr)) return expr;
  return `String(${expr} ?? "")`;
}

/** Terse `terminology::code` is unsafe when terminology_id contains `:` (SNOMED URLs). */
export function codePhraseTerseSafe(terminology: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(terminology);
}

/** CODE_PHRASE init: terse when safe, otherwise `{ terminology_id, code_string }`. */
export function emitCodePhraseLiteral(terminology: string, code: string): string {
  if (codePhraseTerseSafe(terminology) && !code.includes("::")) {
    return JSON.stringify(`${terminology}::${code}`);
  }
  return `{ terminology_id: ${JSON.stringify(terminology)}, code_string: ${JSON.stringify(code)} }`;
}

export function asBooleanExpr(expr: string): string {
  if (/^(xpathBoolean|Boolean)\(/.test(expr)) return expr;
  return `Boolean(${expr})`;
}

export function isBlankGeneratedExpr(code: string): boolean {
  const trimmed = code.trim();
  return !trimmed || trimmed === "undefined" || trimmed === "null" ||
    trimmed === '""' || trimmed === "''";
}

export function indentTsBlock(code: string, indent: number): string {
  if (indent <= 0) return code;
  const pad = "  ".repeat(indent);
  return code.split("\n").map((line) => (line.length ? pad + line : line)).join("\n");
}

export function isListAttribute(rmType: string, attr: string): boolean {
  if (LIST_ATTRS.has(attr)) return true;
  try {
    const meta = attributesFor(rmType).find((a) => a.name === attr);
    return Boolean(meta?.typeName.startsWith("List<"));
  } catch {
    return false;
  }
}

export function generateTypeScriptFromSkeleton(
  model: MappingModel,
  skeleton: SkeletonNode[],
): string {
  if (!usesOpenEhrProduct(model, { skeleton })) {
    return generateTypeScriptFromSlots(model);
  }
  const ctx = createTsEmitContext("sourceCtx.data", model.functions);
  ctx.includes = model.includes;
  const slotMap = new Map(model.slots.map((s) => [s.slotId, s]));
  const loops = model.loops ?? [];
  const roots = skeleton
    .map((node) => emitSkeletonNode(node, slotMap, loops, ctx, 0))
    .filter((code): code is string => Boolean(code));

  const rootType = skeleton[0]?.rmType === "COMPOSITION" ? "COMPOSITION" : undefined;
  let body: string;
  if (roots.length === 1 && skeleton[0]?.rmType === "COMPOSITION") {
    body = `const composition = ${roots[0]};\nreturn composition;`;
    ctx.types.add("COMPOSITION");
  } else if (roots.length === 1) {
    body = `return ${roots[0]};`;
  } else if (roots.length > 1) {
    body = `return [\n${roots.map((r) => `  ${r}`).join(",\n")},\n];`;
  } else {
    ctx.types.add("COMPOSITION");
    body = "const composition = new COMPOSITION({});\nreturn composition;";
  }

  return wrapTsWithFunctions({
    templateId: model.templateId,
    body,
    types: ctx.types,
    helpers: ctx.helpers,
    rootType,
    source: "skeleton",
  }, ctx);
}

function emitSkeletonNode(
  node: SkeletonNode,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: TsEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): string | null {
  if (node.kind === "value") {
    return emitSkeletonValue(node, slots.get(node.slotId), ctx, indent);
  }
  if (isAutoFixedValueSlot(node)) return null;

  const loop = loops.find((item) => item.attachSlotId === node.slotId);
  if (loop) {
    return emitSkeletonLoop(node, loop, slots, loops, ctx, indent, parentArchetypeRef);
  }

  const props = skeletonContainerProps(node, slots, loops, ctx, indent, parentArchetypeRef);
  // Name and archetype id alone are not a mapping. Drop the shell, including
  // mandatory children of an optional subtree that has no clinical value.
  if (node.rmType !== "COMPOSITION" && propsLackClinicalContent(props)) return null;
  return guardSkeletonNode(
    node,
    wrapPruneNode(node.rmType, formatRmConstruct(node.rmType, props, indent, ctx), ctx),
    ctx,
  );
}

/** `include_when` around a skeleton node: `cond ? node : null` (SMT `ite`). */
function guardSkeletonNode(node: SkeletonNode, code: string, ctx: TsEmitContext): string {
  const inc = ctx.includes?.find((item) => item.slotId === node.slotId);
  if (!inc?.when || inc.elseEmits) return code;
  const cond = emitTsExpressionSource(inc.when, ctx) ?? "false";
  return `(${cond} ? ${code} : null)`;
}

function emitSkeletonLoop(
  node: SkeletonNode,
  loop: MappingLoop,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: TsEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): string {
  ctx.helpers.add("nodes");
  ctx.helpers.add("logic");
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(loop.varName) ? loop.varName : "item";
  const innerCtx: TsEmitContext = {
    ...ctx,
    sourceVar: ident,
    loopVar: ident,
    loopBindings: { ...ctx.loopBindings, [loop.varName]: ident },
    types: ctx.types,
    helpers: ctx.helpers,
  };
  const nestedLoops = loops.filter((item) => item !== loop);
  const props = skeletonContainerProps(
    node,
    slots,
    nestedLoops,
    innerCtx,
    indent + 1,
    parentArchetypeRef,
  );
  const constructed = guardSkeletonNode(
    node,
    wrapPruneNode(
      node.rmType,
      formatRmConstruct(node.rmType, props, indent + 1, innerCtx),
      innerCtx,
    ),
    innerCtx,
  );
  const bound =
    `(__vars[${JSON.stringify(loop.varName)}] = ${ident}, ` +
    `__vars[${JSON.stringify(loopIndexBinderName(loop.varName))}] = ${ident}_i, ` +
    `__vars[${JSON.stringify(loopLengthBinderName(loop.varName))}] = ${ident}_col.length, ` +
    `${constructed})`;
  return (
    `...xpathNodes(${JSON.stringify(loop.path)}${relativeLoopScope(loop.path, ctx)}).map((${ident}, ${ident}_i, ${ident}_col) => ${bound})`
  );
}

/** A relative loop path inside an outer loop walks from the outer item (F-M7). */
function relativeLoopScope(path: string, ctx: TsEmitContext): string {
  const trimmed = path.trim();
  const relative = trimmed.length > 0 && !trimmed.startsWith("$") && !trimmed.startsWith("/");
  return relative && ctx.loopVar ? `, ${ctx.loopVar}` : "";
}

function skeletonContainerProps(
  node: SkeletonNode,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: TsEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): Array<[string, string]> {
  const props: Array<[string, string]> = [];
  const locatableName = rmLocatableName(node);
  if (locatableName && shouldEmitSkeletonName(node)) {
    props.push([
      "name",
      node.rmType === "COMPOSITION"
        ? JSON.stringify(locatableName)
        : (ctx.types.add("DV_TEXT"), `new DV_TEXT(${JSON.stringify(locatableName)})`),
    ]);
  }
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  if (nodeId) {
    props.push(["archetype_node_id", JSON.stringify(nodeId)]);
  }
  const childArchetypeRef = node.archetypeRef ?? parentArchetypeRef;

  const grouped = new Map<string, SkeletonNode[]>();
  for (const child of node.children) {
    if (isAutoFixedValueSlot(child)) continue;
    const attr = child.rmAttribute ?? child.label;
    const list = grouped.get(attr) ?? [];
    list.push(child);
    grouped.set(attr, list);
  }

  for (const [attr, children] of grouped) {
    const listAttr = isListAttribute(node.rmType, attr);
    const codes = children
      .map((child) =>
        emitSkeletonNode(child, slots, loops, ctx, listAttr ? 0 : indent + 1, childArchetypeRef)
      )
      .filter((code): code is string => Boolean(code) && !isBlankGeneratedExpr(code));
    if (!codes.length) continue;
    const asList = listAttr || codes.some((c) => c.trimStart().startsWith("..."));
    if (asList) {
      const inner = codes.map((c) => indentTsBlock(c, indent + 2)).join(",\n");
      props.push([attr, wrapPruneList(`[\n${inner},\n${"  ".repeat(indent + 1)}]`, ctx)]);
    } else if (node.rmType === "ELEMENT" && attr === "value") {
      props.push([attr, wrapPruneValue(codes[0]!, ctx)]);
    } else {
      props.push([attr, codes[0]!]);
    }
  }
  if (node.rmType === "ACTIVITY" && !props.some(([attr]) => attr === "action_archetype_id")) {
    props.push(["action_archetype_id", JSON.stringify(DEFAULT_ACTION_ARCHETYPE_ID)]);
  }
  return props;
}

function tsShellGen(ctx: TsEmitContext, indent: number): ShellCodegen {
  return {
    expr: (expression) => emitTsExpressionSource(expression, ctx),
    object: (rmType, fields) => formatRmConstruct(rmType, fields, indent, ctx),
    list: (items) => `[${items.join(", ")}]`,
    octets: (code) => octetBytesCall(code),
  };
}

/** Optional shell mouths (mappings, ranges, …) on a value that already has its primary field. */
function assignTsShell(
  base: string,
  slot: MappingSlot | undefined,
  ctx: TsEmitContext,
  indent: number,
): string {
  const extra = emitShellFields(slot?.shellFragments, tsShellGen(ctx, indent));
  if (!extra.length) return base;
  const body = extra.map(([key, value]) => `${key}: ${value}`).join(", ");
  return `Object.assign(${base}, { ${body} })`;
}

function emitSkeletonValue(
  node: SkeletonNode,
  slot: MappingSlot | undefined,
  ctx: TsEmitContext,
  indent: number,
): string | null {
  const expr = slot?.expression
    ? emitTsExpressionSource(slot.expression, ctx)
    : null;
  const fields = node.fixedFields ?? {};
  const rmType = node.rmType;

  if (rmType === "CODE_PHRASE") {
    const term = fields.terminology_id;
    const code = fields.code_string ?? fields.defining_code;
    if (term && expr) {
      if (codePhraseTerseSafe(term)) {
        return "`" + escapeTemplate(term) + "::${String(" + expr + ' ?? "")}`';
      }
      ctx.types.add("CODE_PHRASE");
      return `new CODE_PHRASE({ terminology_id: ${JSON.stringify(term)}, code_string: ${asStringExpr(expr)} })`;
    }
    if (term && code) return emitCodePhraseLiteral(term, code);
    if (expr) {
      ctx.types.add("CODE_PHRASE");
      return `new CODE_PHRASE({ code_string: ${asStringExpr(expr)} })`;
    }
    return null;
  }

  if (rmType === "DV_CODED_TEXT") {
    const term = fields.terminology_id ?? "openehr";
    const code = fields.defining_code ?? fields.code_string;
    const rubric = fields.value ??
      (node.label && node.label !== rmType ? node.label : "");
    const coded = codedTextParts(slot?.expression);
    if (coded) {
      const part = (ast: ExprAst | undefined, lit: string) => ast ? asStringExpr(emitTsExpression(ast, ctx)) : JSON.stringify(lit);
      ctx.types.add("DV_CODED_TEXT");
      ctx.types.add("CODE_PHRASE");
      return assignTsShell(
        `new DV_CODED_TEXT({ value: ${part(coded.value, rubric)}, defining_code: new CODE_PHRASE({ terminology_id: ${
          part(coded.terminology, term)
        }, code_string: ${part(coded.code, code ?? "")} }) })`,
        slot,
        ctx,
        indent,
      );
    }
    if (code) {
      if (codePhraseTerseSafe(term) && !code.includes("::")) {
        return assignTsShell(JSON.stringify(`${term}::${code}|${rubric}|`), slot, ctx, indent);
      }
      ctx.types.add("DV_CODED_TEXT");
      return assignTsShell(
        `new DV_CODED_TEXT({ value: ${JSON.stringify(rubric)}, defining_code: ${
          emitCodePhraseLiteral(term, code)
        } })`,
        slot,
        ctx,
        indent,
      );
    }
    if (expr) {
      ctx.types.add("DV_CODED_TEXT");
      const choices = codedChoicesForNode(node);
      ctx.helpers.add("coded");
      return assignTsShell(`codedText(${expr}, ${JSON.stringify(choices)})`, slot, ctx, indent);
    }
    return null;
  }

  if (rmType === "DV_QUANTITY") {
    // No magnitude: scaffolding only (fixed units, or a range with nothing to attach it to).
    if (!expr) return null;
    return guardNumericConstruct(expr, (m) => {
      const props: Array<[string, string]> = [["magnitude", m]];
      if (fields.units) props.push(["units", JSON.stringify(fields.units)]);
      return assignTsShell(formatRmConstruct("DV_QUANTITY", props, indent, ctx), slot, ctx, indent);
    }, ctx);
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    return guardNumericConstruct(
      expr,
      (m) => assignTsShell(formatRmConstruct(rmType, [["magnitude", m]], indent, ctx), slot, ctx, indent),
      ctx,
    );
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    const value = /^xpathBoolean\(/.test(expr) ? expr : wrapBooleanValue(expr, ctx);
    return assignTsShell(formatRmConstruct("DV_BOOLEAN", [["value", value]], indent, ctx), slot, ctx, indent);
  }

  if (
    rmType === "DV_DATE_TIME" || rmType === "DV_DATE" || rmType === "DV_TIME" ||
    rmType === "DV_DURATION" || rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
    rmType === "DV_TEXT" || rmType === "DV_IDENTIFIER"
  ) {
    const value = expr
      ? asStringExpr(expr)
      : fields.value
      ? JSON.stringify(fields.value)
      : null;
    if (!value) return null;
    if (rmType === "DV_TEXT") {
      ctx.types.add("DV_TEXT");
      return assignTsShell(`new DV_TEXT(${value})`, slot, ctx, indent);
    }
    return assignTsShell(formatRmConstruct(rmType, [["value", value]], indent, ctx), slot, ctx, indent);
  }

  if (rmType === "PARTY_IDENTIFIED") {
    if (!expr) return null;
    return `{ name: ${asStringExpr(expr)} }`;
  }

  if (rmType === "PARTY_SELF") {
    ctx.types.add("PARTY_SELF");
    return "new PARTY_SELF()";
  }

  if (expr) {
    if (rmType && rmType !== "string" && rmType !== "number" && rmType !== "boolean") {
      return formatRmConstruct(rmType, [["value", expr]], indent, ctx);
    }
    return expr;
  }
  return null;
}

function shouldEmitSkeletonName(node: SkeletonNode): boolean {
  if (node.rmType === "COMPOSITION") return true;
  if (node.rmType === "EVENT_CONTEXT" || node.rmType.startsWith("PARTY_")) return false;
  return LOCATABLE_TYPES.has(node.rmType);
}

function escapeTemplate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** Canvas `text_handlebars` product → `handlebars(script, context)` conversion script. */
export function generateTypeScriptFromCanvasExpression(
  model: MappingModel,
  expression: string,
): string {
  const ctx = createTsEmitContext("sourceCtx.data", model.functions);
  const tsExpr = emitTsExpressionSource(expression, ctx) ?? '""';
  return wrapTsWithFunctions({
    templateId: model.templateId,
    body: `return ${tsExpr};`,
    types: ctx.types,
    helpers: ctx.helpers,
    rootType: "string",
    source: "blockly",
  }, ctx);
}

/** Fallback when no skeleton is available (slot list only). */
export function generateTypeScriptFromSlots(model: MappingModel): string {
  const ctx = createTsEmitContext("sourceCtx.data", model.functions);
  const openEhr = usesOpenEhrProduct(model);
  if (openEhr) ctx.types.add("COMPOSITION");
  const lines: string[] = [];
  if (openEhr) {
    lines.push("const composition = new COMPOSITION({});");
  }
  lines.push("const values: Record<string, unknown> = {};", "");
  for (const slot of model.slots) {
    const expr = emitTsExpressionSource(slot.expression, ctx);
    if (!expr) continue;
    lines.push(`// ${slot.label ?? slot.slotId}`);
    lines.push(`values[${JSON.stringify(slot.slotId)}] = ${expr};`);
    lines.push("");
  }
  if (openEhr) {
    lines.push("void values;");
    lines.push("return composition;");
  } else {
    lines.push("return values;");
  }
  return wrapTsWithFunctions({
    templateId: model.templateId,
    body: lines.join("\n"),
    types: ctx.types,
    helpers: ctx.helpers,
    rootType: openEhr ? "COMPOSITION" : undefined,
    source: "slots",
  }, ctx);
}

