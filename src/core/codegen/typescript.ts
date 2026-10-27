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

import type { MappingFunction, MappingLoop, MappingModel, MappingSlot, SkeletonNode } from "../../types/mod.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";
import { parseExpression, type ExprAst, isQuantifyCall } from "../expression/mod.ts";
import { isAutoFixedValueSlot, LOCATABLE_TYPES } from "../rm_mandatory.ts";
import {
  propsLackClinicalContent,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";
import { attributesFor } from "../rm_meta.ts";
import { usesOpenEhrProduct } from "./product.ts";
import {
  functionIdentMap,
  jsFunctionIdent,
  valueFunctions,
} from "./user_functions.ts";

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
  types: Set<string>;
  helpers: Set<"string" | "number" | "boolean" | "nodes" | "rm" | "node" | "handlebars" | "sheets" | "logic">;
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
  const innerCtx: TsEmitContext = { ...ctx, loopVar: ident };
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
  helpers: Set<"string" | "number" | "boolean" | "nodes" | "rm" | "node" | "handlebars" | "sheets" | "logic">;
  rootType?: string;
  /** Where the RM tree was walked from. */
  source?: "blockly" | "skeleton" | "slots";
  extraImports?: string[];
}

export function wrapTypeScriptModule(parts: TypeScriptModuleParts): string {
  const types = [...parts.types].sort();
  const usesXpath = [...parts.helpers].some((h) =>
    h === "string" || h === "number" || h === "boolean" || h === "nodes" || h === "node"
  );
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
  if (usesXpath) {
    lines.push(...indentLines(xpathHelpers(parts.helpers), 1));
    lines.push("");
  }
  if (parts.helpers.has("rm")) {
    lines.push(...indentLines(rmHelper(), 1));
    lines.push("");
  }
  if (parts.helpers.has("handlebars")) {
    lines.push(...indentLines(handlebarsHelper(), 1));
    lines.push("");
  }
  if (parts.helpers.has("sheets")) {
    lines.push(...indentLines(sheetHelpers(), 1));
    lines.push("");
  }
  if (parts.helpers.has("logic")) {
    lines.push("  const __vars: Record<string, unknown> = {};");
    lines.push(...indentLines(logicHelpers(), 1));
    lines.push("");
  }
  for (const line of parts.body.split("\n")) {
    lines.push(line.length ? `  ${line}` : "");
  }
  lines.push("}", "");
  return lines.join("\n");
}

function xpathHelpers(helpers: Set<string>): string[] {
  const lines = [
    "function jsonQuery(path: unknown): string {",
    '  const trimmed = String(path ?? "").trim();',
    '  if (!trimmed || trimmed.startsWith("/")) return trimmed;',
    '  const asJson = trimmed.startsWith("$") ? trimmed : `$.${trimmed.replace(/^\\./, "")}`;',
    "  let body = asJson.slice(1);",
    '  if (body.startsWith(".")) body = body.slice(1);',
    '  if (!body || body === ".") return "$source";',
    "  const segments: string[] = [];",
    "  let i = 0;",
    "  while (i < body.length) {",
    '    if (body[i] === ".") { i++; continue; }',
    '    if (body[i] === "[") {',
    '      const close = body.indexOf("]", i + 1);',
    "      if (close < 0) break;",
    "      segments.push(body.slice(i + 1, close));",
    "      i = close + 1;",
    "      continue;",
    "    }",
    "    let end = i;",
    "    while (end < body.length && !\".[\".includes(body[end] ?? \"\")) end++;",
    "    segments.push(body.slice(i, end));",
    "    i = end;",
    "  }",
    '  return segments.reduce((q, seg) => {',
    '    if (seg === "*") return `${q}?*`;',
    '    if (/^\\d+$/.test(seg) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) return `${q}?${seg}`;',
    "    return `${q}?(${JSON.stringify(seg)})`;",
    '  }, "$source");',
    "}",
    "",
  ];
  if (helpers.has("string")) {
    lines.push(
      "function xpathString(path: string, node: unknown = sourceCtx.data): string {",
      '  const p = typeof path === "string" ? path : String(path ?? "");',
      '  if (p.trim().startsWith("$source") || p.includes("?*[")) {',
      "    return evaluateXPathToString(p, null, null, { source: node });",
      "  }",
      '  if (p.trim().startsWith("/")) return evaluateXPathToString(p, node);',
      "  return evaluateXPathToString(jsonQuery(p), null, null, { source: node });",
      "}",
      "",
    );
  }
  if (helpers.has("number")) {
    lines.push(
      "function xpathNumber(path: unknown, node: unknown = sourceCtx.data): number {",
      '  const p = typeof path === "string" ? path : String(path ?? "");',
      '  if (p.trim().startsWith("$source") || p.includes("?*[")) {',
      "    return evaluateXPathToNumber(p, null, null, { source: node });",
      "  }",
      '  if (p.trim().startsWith("/")) return evaluateXPathToNumber(p, node);',
      "  return evaluateXPathToNumber(jsonQuery(p), null, null, { source: node });",
      "}",
      "",
    );
  }
  if (helpers.has("boolean")) {
    lines.push(
      "function xpathBoolean(path: unknown, node: unknown = sourceCtx.data): boolean {",
      '  const p = typeof path === "string" ? path : String(path ?? "");',
      '  if (p.trim().startsWith("$source") || p.includes("?*[")) {',
      "    return evaluateXPathToBoolean(p, null, null, { source: node });",
      "  }",
      '  if (p.trim().startsWith("/")) return evaluateXPathToBoolean(p, node);',
      "  return evaluateXPathToBoolean(jsonQuery(p), null, null, { source: node });",
      "}",
      "",
    );
  }
  if (helpers.has("nodes")) {
    lines.push(
      "function jsonWalk(path: string, node: unknown): unknown {",
      "  const trimmed = path.trim();",
      '  if (!trimmed || trimmed === "$" || trimmed === "." || trimmed === "$source") return node;',
      "  let body = trimmed;",
      '  if (body.startsWith("$source")) body = body.slice(7);',
      '  else if (body.startsWith("$")) body = body.slice(1);',
      '  if (body.startsWith(".") || body.startsWith("?")) body = body.slice(1);',
      "  const segs = [];",
      "  let i = 0;",
      "  while (i < body.length) {",
      "    const ch = body[i];",
      '    if (ch === "." || ch === "?") { i++; continue; }',
      '    if (ch === "*") { segs.push("*"); i++; continue; }',
      '    if (ch === "[") {',
      '      const close = body.indexOf("]", i + 1);',
      "      if (close < 0) break;",
      "      const tok = body.slice(i + 1, close).trim();",
      '      segs.push(tok === "*" ? "*" : tok.replace(/^["\']|["\']$/g, ""));',
      "      i = close + 1;",
      "      continue;",
      "    }",
      "    let end = i;",
      '    while (end < body.length && !".?[*".includes(body[end] ?? "")) end++;',
      "    if (end > i) segs.push(body.slice(i, end));",
      "    i = end > i ? end : i + 1;",
      "  }",
      "  function walk(cur, rest) {",
      "    if (rest.length === 0) return cur;",
      "    const head = rest[0];",
      "    const tail = rest.slice(1);",
      '    if (head === "*") {',
      "      if (!Array.isArray(cur)) return [];",
      "      if (tail.length === 0) return cur;",
      "      const out = [];",
      "      for (const item of cur) {",
      "        const v = walk(item, tail);",
      "        if (Array.isArray(v)) out.push(...v);",
      "        else if (v != null) out.push(v);",
      "      }",
      "      return out;",
      "    }",
      '    if (head && /^\\d+$/.test(head)) {',
      "      if (!Array.isArray(cur)) return undefined;",
      "      const n = Number(head);",
      "      return walk(cur[n >= 1 ? n - 1 : n], tail);",
      "    }",
      '    if (cur == null || typeof cur !== "object") return undefined;',
      "    return walk(cur[head], tail);",
      "  }",
      "  return walk(node, segs);",
      "}",
      "function xpathNodes(path: string, node: unknown = sourceCtx.data): unknown[] {",
      '  if (path.trim().startsWith("/")) return evaluateXPathToNodes(path, node);',
      "  const found = jsonWalk(path, node);",
      "  if (Array.isArray(found)) return found;",
      "  if (found == null) return [];",
      "  return [found];",
      "}",
      "",
    );
  }
  if (helpers.has("node")) {
    lines.push(
      "function xpathNode(path: string, node: unknown = sourceCtx.data): unknown {",
      '  if (path.trim().startsWith("/")) return evaluateXPathToFirstNode(path, node);',
      '  const trimmed = path.trim();',
      '  if (!trimmed || trimmed === "$" || trimmed === ".") return node;',
      '  if (trimmed.startsWith("$source") || trimmed.includes("?*[")) {',
      "    return evaluateXPathToFirstNode(trimmed, null, null, { source: node });",
      "  }",
      "  return evaluateXPathToFirstNode(jsonQuery(path), null, null, { source: node });",
      "}",
      "",
    );
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function logicHelpers(): string[] {
  return [
    "function asList(value: unknown): unknown[] {",
    "  if (Array.isArray(value)) return value;",
    "  if (value == null) return [];",
    "  return [value];",
    "}",
    "function listGetIndex(items: unknown, where: string, at: unknown = 1): unknown {",
    "  const list = asList(items);",
    '  if (where === "FIRST") return list[0] ?? null;',
    '  if (where === "LAST") return list[list.length - 1] ?? null;',
    "  const n = Number(at);",
    '  if (where === "FROM_END") return list[list.length - n] ?? null;',
    "  return list[n - 1] ?? null;",
    "}",
    "function sameItem(a: unknown, b: unknown): boolean {",
    "  if (Object.is(a, b)) return true;",
    "  if (a && b && typeof a === \"object\" && typeof b === \"object\") {",
    "    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }",
    "  }",
    "  return false;",
    "}",
    "function setIntersection(a: unknown[], b: unknown[]): unknown[] {",
    "  return a.filter((item) => b.some((other) => sameItem(item, other)));",
    "}",
    "function setUnion(a: unknown[], b: unknown[]): unknown[] {",
    "  const out = [...a];",
    "  for (const item of b) {",
    "    if (!out.some((other) => sameItem(item, other))) out.push(item);",
    "  }",
    "  return out;",
    "}",
    "function setDifference(universe: unknown[], excluded: unknown[]): unknown[] {",
    "  return universe.filter((item) => !excluded.some((other) => sameItem(item, other)));",
    "}",
  ];
}

function sheetHelpers(): string[] {
  return [
    "function sheetOf(name: string) { return sheets[name]; }",
    "function sheetGetCell(name: string, a1: string) {",
    "  const s = sheetOf(name); if (!s) return null;",
    "  const m = /^([A-Za-z]+)(\\d+)$/.exec(String(a1).trim()); if (!m) return null;",
    "  let x = 0; for (const ch of m[1].toUpperCase()) x = x * 26 + (ch.charCodeAt(0) - 64);",
    "  const row = s.values[Number(m[2]) - 1]; return row ? row[x - 1] ?? null : null;",
    "}",
    "function sheetGetXy(name: string, x: number, y: number) {",
    "  const row = sheetOf(name)?.values[y]; return row ? row[x] ?? null : null;",
    "}",
    "function sheetGetRow(name: string, y: number) { return [...(sheetOf(name)?.values[y] ?? [])]; }",
    "function sheetGetColumn(name: string, x: number) {",
    "  return (sheetOf(name)?.values ?? []).map((row: unknown[]) => row?.[x] ?? null);",
    "}",
    "function sheetGetHeader(name: string, x: number) { return sheetOf(name)?.headers[x] ?? \"\"; }",
    "function sheetGetData(name: string) { return (sheetOf(name)?.values ?? []).map((row: unknown[]) => [...row]); }",
    "function sheetLookup(name: string, matchCol: string | number, matchValue: unknown, returnCol?: string | number) {",
    "  const s = sheetOf(name); if (!s) return null;",
    "  const idx = (ref: string | number) => {",
    "    if (typeof ref === \"number\") return ref;",
    "    const t = String(ref);",
    "    const hi = s.headers.indexOf(t); if (hi >= 0) return hi;",
    "    if (/^[A-Za-z]+$/.test(t)) { let n = 0; for (const ch of t.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }",
    "    if (/^\\d+$/.test(t)) return Number(t);",
    "    return -1;",
    "  };",
    "  const mi = idx(matchCol);",
    "  const y = s.values.findIndex((row: unknown[]) => String(row?.[mi] ?? \"\") === String(matchValue ?? \"\"));",
    "  if (y < 0) return null;",
    "  if (returnCol === undefined || returnCol === null || returnCol === \"\") {",
    "    const rec: Record<string, unknown> = {};",
    "    s.headers.forEach((h: string, x: number) => { rec[h || String(x)] = s.values[y][x]; });",
    "    return rec;",
    "  }",
    "  return s.values[y][idx(returnCol)] ?? null;",
    "}",
    "function decisionTable(name: string, inputs: Record<string, unknown> = {}, outputCol?: string) {",
    "  const s = sheetOf(name); if (!s) return null;",
    "  const dontCare = (c: unknown) => c == null || (typeof c === \"string\" && [\"\", \"—\", \"–\", \"-\", \"*\"].includes(c.trim()));",
    "  const width = s.headers.length;",
    "  const meta = (s.decisionColumns ?? []).slice(0, width);",
    "  while (meta.length < width) meta.push({ role: meta.length === width - 1 && !(s.decisionColumns?.length) ? \"output\" : \"condition\" });",
    "  if (!(s.decisionColumns?.length) && width > 0) { for (let i = 0; i < width - 1; i++) meta[i] = { role: \"condition\" }; meta[width - 1] = { role: \"output\", outputKind: \"value\", valueType: \"string\" }; }",
    "  const coerce = (v: unknown, t: string) => {",
    "    if (v == null || v === \"\") return v;",
    "    if (t === \"number\") { const n = typeof v === \"number\" ? v : Number(v); return Number.isFinite(n) ? n : v; }",
    "    if (t === \"boolean\") { if (typeof v === \"boolean\") return v; const x = String(v).trim().toLowerCase(); if (x === \"true\") return true; if (x === \"false\") return false; return v; }",
    "    return typeof v === \"string\" ? v : String(v);",
    "  };",
    "  const toNum = (v: unknown) => {",
    "    if (typeof v === \"number\") return Number.isFinite(v) ? v : null;",
    "    if (typeof v === \"string\" && v.trim() !== \"\") { const n = Number(v); return Number.isFinite(n) ? n : null; }",
    "    return null;",
    "  };",
    "  const pred = (cell: unknown) => {",
    "    if (cell == null || typeof cell === \"boolean\" || dontCare(cell)) return null;",
    "    const str = typeof cell === \"number\" ? String(cell) : String(cell).trim();",
    "    const range = /^(-?\\d+(?:\\.\\d+)?)\\s*\\.\\.\\s*(-?\\d+(?:\\.\\d+)?)$/.exec(str);",
    "    if (range) { const a = Number(range[1]), b = Number(range[2]); return { op: \"range\", a: Math.min(a, b), b: Math.max(a, b) }; }",
    "    const cmp = /^(>=|<=|>|<|=)\\s*(-?\\d+(?:\\.\\d+)?)$/.exec(str);",
    "    if (cmp) return { op: cmp[1] as string, a: Number(cmp[2]) };",
    "    return null;",
    "  };",
    "  const holds = (p: { op: string; a: number; b?: number }, n: number) => {",
    "    if (p.op === \"range\") return n >= p.a && n <= (p.b as number);",
    "    if (p.op === \">=\") return n >= p.a; if (p.op === \">\") return n > p.a;",
    "    if (p.op === \"<=\") return n <= p.a; if (p.op === \"<\") return n < p.a;",
    "    return n === p.a;",
    "  };",
    "  const cellMatch = (cell: unknown, input: unknown) => {",
    "    if (dontCare(cell)) return true;",
    "    const p = pred(cell);",
    "    if (p) { const n = toNum(input); return n != null && holds(p, n); }",
    "    return String(cell ?? \"\") === String(input ?? \"\");",
    "  };",
    "  const cellOut = (y: number, oi: number) => {",
    "    const cell = s.values[y]?.[oi];",
    "    const kind = meta[oi]?.outputKind ?? \"value\";",
    "    if (kind === \"snippet\") {",
    "      const tpl = String(cell ?? \"\");",
    "      return tpl.replace(/\\{\\{\\s*([\\w.$]+)\\s*\\}\\}/g, (_: string, key: string) => {",
    "        const parts = key.split(\".\"); let cur: unknown = inputs;",
    "        for (const p of parts) { if (cur == null || typeof cur !== \"object\") return \"\"; cur = (cur as Record<string, unknown>)[p]; }",
    "        return cur == null ? \"\" : String(cur);",
    "      });",
    "    }",
    "    const t = meta[oi]?.valueType === \"number\" || meta[oi]?.valueType === \"boolean\" ? meta[oi].valueType : \"string\";",
    "    return coerce(cell ?? null, t);",
    "  };",
    "  const outIdx = outputCol && outputCol !== \"*\" ? s.headers.indexOf(outputCol) : meta.findIndex((m) => m.role === \"output\");",
    "  const oi = outIdx >= 0 ? outIdx : Math.max(0, width - 1);",
    "  const matches: number[] = [];",
    "  for (let y = 0; y < s.values.length; y++) {",
    "    if (s.rowCatchAll?.[y]) { if (matches.length === 0) matches.push(y); continue; }",
    "    let ok = true;",
    "    for (let x = 0; x < width; x++) {",
    "      if (meta[x]?.role !== \"condition\") continue;",
    "      if (!cellMatch(s.values[y]?.[x], inputs[s.headers[x]])) { ok = false; break; }",
    "    }",
    "    if (ok) matches.push(y);",
    "  }",
    "  if (!matches.length) return null;",
    "  const policy = s.hitPolicy ?? \"FIRST\";",
    "  const all = outputCol === \"*\";",
    "  const rowMap = (y: number) => {",
    "    const rec: Record<string, unknown> = {};",
    "    for (let x = 0; x < width; x++) { if (meta[x]?.role === \"output\") rec[s.headers[x] || String(x)] = cellOut(y, x); }",
    "    return rec;",
    "  };",
    "  if (policy === \"UNIQUE\") {",
    "    if (matches.length > 1) throw new Error(`UNIQUE decision table \"${name}\" matched ${matches.length} rows`);",
    "    return all ? rowMap(matches[0]!) : cellOut(matches[0]!, oi);",
    "  }",
    "  if (policy === \"COLLECT\") {",
    "    const join = s.collectJoin ?? \"; \";",
    "    const joinParts = (vals: unknown[]) => {",
    "      const out = []; const seen = new Set();",
    "      for (const p of vals) {",
    "        if (p == null || (typeof p === \"string\" && p.trim() === \"\")) continue;",
    "        const t = String(p);",
    "        if (s.collectDedupe) { if (seen.has(t)) continue; seen.add(t); }",
    "        out.push(t);",
    "      }",
    "      return out.join(join);",
    "    };",
    "    if (!all) return joinParts(matches.map((y) => cellOut(y, oi)));",
    "    const rec: Record<string, unknown> = {};",
    "    for (let x = 0; x < width; x++) {",
    "      if (meta[x]?.role !== \"output\") continue;",
    "      rec[s.headers[x] || String(x)] = joinParts(matches.map((y) => cellOut(y, x)));",
    "    }",
    "    return rec;",
    "  }",
    "  return all ? rowMap(matches[0]!) : cellOut(matches[0]!, oi);",
    "}",
  ];
}

function handlebarsHelper(): string[] {
  return [
    "function handlebars(template: string, context: unknown): string {",
    "  const engine = Handlebars.create();",
    "  engine.registerHelper({",
    "    eq: (a: unknown, b: unknown) => a === b,",
    "    ne: (a: unknown, b: unknown) => a !== b,",
    "    toLowerCase: (v: unknown) => v == null ? v : String(v).toLowerCase(),",
    "    toUpperCase: (v: unknown) => v == null ? v : String(v).toUpperCase(),",
    "  });",
    "  return engine.compile(template, { noEscape: true })(context ?? {});",
    "}",
  ];
}

function rmHelper(): string[] {
  return [
    "/** Apply an init bag on RM classes that still use a zero-arg constructor. */",
    "function rm(Type: any, init: any) {",
    "  return Object.assign(new Type(), init);",
    "}",
  ];
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
  return formatRmConstruct(node.rmType, props, indent, ctx);
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
  const constructed = formatRmConstruct(node.rmType, props, indent + 1, innerCtx);
  const bound =
    `(__vars[${JSON.stringify(loop.varName)}] = ${ident}, ` +
    `__vars[${JSON.stringify(loopIndexBinderName(loop.varName))}] = ${ident}_i, ` +
    `__vars[${JSON.stringify(loopLengthBinderName(loop.varName))}] = ${ident}_col.length, ` +
    `${constructed})`;
  return (
    `...xpathNodes(${JSON.stringify(loop.path)}).map((${ident}, ${ident}_i, ${ident}_col) => ${bound})`
  );
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
      props.push([attr, `[\n${inner},\n${"  ".repeat(indent + 1)}]`]);
    } else {
      props.push([attr, codes[0]!]);
    }
  }
  return props;
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
    if (code) {
      if (codePhraseTerseSafe(term) && !code.includes("::")) {
        return JSON.stringify(`${term}::${code}|${rubric}|`);
      }
      ctx.types.add("DV_CODED_TEXT");
      return `new DV_CODED_TEXT({ value: ${JSON.stringify(rubric)}, defining_code: ${
        emitCodePhraseLiteral(term, code)
      } })`;
    }
    if (expr) {
      ctx.types.add("DV_CODED_TEXT");
      return `new DV_CODED_TEXT({ value: String(${expr} ?? "") })`;
    }
    return null;
  }

  if (rmType === "DV_QUANTITY") {
    if (!expr) return null;
    const props: Array<[string, string]> = [["magnitude", asNumberExpr(expr)]];
    if (fields.units) props.push(["units", JSON.stringify(fields.units)]);
    return formatRmConstruct("DV_QUANTITY", props, indent, ctx);
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    return formatRmConstruct(rmType, [["magnitude", asNumberExpr(expr)]], indent, ctx);
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    return formatRmConstruct("DV_BOOLEAN", [["value", asBooleanExpr(expr)]], indent, ctx);
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
      return `new DV_TEXT(${value})`;
    }
    return formatRmConstruct(rmType, [["value", value]], indent, ctx);
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

