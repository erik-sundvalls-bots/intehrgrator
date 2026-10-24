import fontoxpath from "fontoxpath";
import { parseXmlDocument } from "../xml/xml_dom.ts";
import type { SourceFormatId } from "../../types/mod.ts";
import type { MappingFunction } from "../../types/mod.ts";
import type { ExprAst } from "../expression/mod.ts";
import {
  isQuantifyCall,
  parseExpression,
} from "../expression/mod.ts";
import { renderHandlebars } from "../output/handlebars_dialect.ts";
import { DEFAULTS_MAP_NAME } from "../defaults/factory.ts";
import { evalSheetCall, isSheetAccessor } from "../sheets/evaluate.ts";
import type { SheetBag } from "../sheets/types.ts";
import {
  executeEnvelopeParameters,
  parseJsonDocument,
  unwrapExecuteEnvelope,
} from "./json_document.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";

export interface SourceContext {
  format: SourceFormatId;
  /** Runtime representation used by evaluators; adapter ids need not equal it. */
  kind: "json" | "xml";
  data: unknown;
  json?: unknown;
  xmlDocument?: Document;
  /** Loop variables (`for_each_list` VAR → current source node or list item). */
  vars?: Record<string, unknown>;
  /**
   * When set, relative source paths walk this node instead of `json`.
   * Used while evaluating a DL restriction predicate against a list item.
   */
  relativeRoot?: unknown;
  /** Named Maps (Defaults Map and others) for `maps_get`. */
  namedMaps?: Record<string, Record<string, unknown>>;
  /** Named Sheets for `sheet_*` accessors (ADR 0005). */
  sheets?: SheetBag;
  /** Blockly Functions for Mapping Expression `call("name", …)`. */
  functions?: MappingFunction[];
  /** Internal recursion guard for `call`. */
  callDepth?: number;
}

export function createSourceContext(
  content: string,
  format: SourceFormatId,
  kind: "json" | "xml" = format === "xml" ? "xml" : "json",
): SourceContext {
  if (kind === "json") {
    const parsed = parseJsonDocument(content);
    const json = unwrapExecuteEnvelope(parsed);
    const parameters = executeEnvelopeParameters(parsed);
    return {
      format,
      kind,
      data: json,
      json,
      ...(parameters ? { namedMaps: { [DEFAULTS_MAP_NAME]: parameters } } : {}),
    };
  }
  let doc: Document;
  try {
    doc = parseXmlDocument(content);
  } catch (err) {
    throw new Error(`Invalid XML source: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { format, kind, data: doc, xmlDocument: doc };
}

export function evaluate(
  expression: string,
  ctx: SourceContext,
  returnType: string,
): unknown {
  const ast = parseExpression(expression);
  const value = evalAst(ast, ctx);
  return coerceReturn(value, returnType);
}

function evalAst(ast: ExprAst, ctx: SourceContext): unknown {
  switch (ast.kind) {
    case "literal":
      return ast.value;
    case "binary": {
      const left = Number(evalAst(ast.left, ctx));
      const right = Number(evalAst(ast.right, ctx));
      switch (ast.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? null : left / right;
      }
      break;
    }
    case "call": {
      if (isQuantifyCall(ast.name)) return evalQuantifier(ast, ctx);
      if (ast.name === "and") {
        return ast.args.every((arg) => !!evalAst(arg, ctx));
      }
      if (ast.name === "or") {
        return ast.args.some((arg) => !!evalAst(arg, ctx));
      }
      if (ast.name === "not") {
        return !evalAst(ast.args[0]!, ctx);
      }
      const args = ast.args.map((a) => evalAst(a, ctx));
      switch (ast.name) {
        case "trim":
          return String(args[0] ?? "").trim();
        case "change_case":
          return changeCase(args[0], String(args[1] ?? "LOWERCASE"));
        case "concat":
          return args.map(String).join("");
        case "round":
          return Math.round(Number(args[0] ?? 0));
        case "modulo": {
          const divisor = Number(args[1] ?? 1);
          return divisor === 0 ? null : Number(args[0] ?? 0) % divisor;
        }
        case "constrain": {
          const value = Number(args[0] ?? 0);
          const low = Number(args[1] ?? 0);
          const high = Number(args[2] ?? 0);
          return Math.min(high, Math.max(low, value));
        }
        case "if":
          return args[0] ? args[1] : args[2];
        case "eq":
          return sameItem(args[0], args[1]);
        case "ne":
          return !sameItem(args[0], args[1]);
        case "lt":
          return Number(args[0]) < Number(args[1]);
        case "le":
          return Number(args[0]) <= Number(args[1]);
        case "gt":
          return Number(args[0]) > Number(args[1]);
        case "ge":
          return Number(args[0]) >= Number(args[1]);
        case "list":
          return args;
        case "lists_getIndex": {
          const items = asList(args[0]);
          const where = String(args[1] ?? "FIRST");
          if (where === "FIRST") return items[0] ?? null;
          if (where === "LAST") return items[items.length - 1] ?? null;
          const at = Number(args[2] ?? 1);
          if (where === "FROM_START") return items[at - 1] ?? null;
          if (where === "FROM_END") return items[items.length - at] ?? null;
          return null;
        }
        case "intersection":
          return setIntersection(asList(args[0]), asList(args[1]));
        case "union":
          return setUnion(asList(args[0]), asList(args[1]));
        case "difference":
          return setDifference(asList(args[0]), asList(args[1]));
        case "xpath":
        case "xpathString":
          return xpathEval(String(args[0] ?? ""), ctx, "string");
        case "xpathNumber":
          return xpathEval(String(args[0] ?? ""), ctx, "number");
        case "xpathBoolean":
          return xpathEval(String(args[0] ?? ""), ctx, "boolean");
        case "xpathNode":
          return evalSourceNode(String(args[0] ?? ""), ctx);
        case "handlebars":
          return renderHandlebars(String(args[0] ?? ""), args[1] ?? {});
        case "map": {
          const record: Record<string, unknown> = {};
          for (let i = 0; i + 1 < args.length; i += 2) {
            record[String(args[i] ?? "")] = args[i + 1];
          }
          return record;
        }
        case "var":
          return ctx.vars?.[String(args[0])] ?? null;
        case "maps_get": {
          const mapName = String(args[0] ?? "defaults");
          const key = String(args[1] ?? "");
          const map = ctx.namedMaps?.[mapName];
          if (!map || typeof map !== "object") return null;
          return (map as Record<string, unknown>)[key] ?? null;
        }
        case "call": {
          const name = String(args[0] ?? "");
          const fn = ctx.functions?.find((item) => item.name === name);
          if (!fn?.body) return null;
          const depth = (ctx.callDepth ?? 0) + 1;
          if (depth > 32) return null;
          const paramVars: Record<string, unknown> = { ...(ctx.vars ?? {}) };
          for (let i = 0; i < fn.params.length; i++) {
            paramVars[fn.params[i]!] = args[i + 1];
          }
          return evalAst(parseExpression(fn.body), {
            ...ctx,
            vars: paramVars,
            callDepth: depth,
          });
        }
      }
      if (isSheetAccessor(ast.name)) {
        return evalSheetCall(ast.name, args, ctx.sheets ?? {});
      }
    }
  }
  return null;
}

/** Resolve a JSON authoring path to an array of nodes (`$.measurements`). */
export function collectJsonNodes(path: string, json: unknown): unknown[] {
  if (looksLikeOpenEhrLocator(path)) {
    const query = compileAuthoringPath(path, "json");
    const nodes = fontoxpath.evaluateXPathToNodes(query, null, null, { source: json });
    return Array.isArray(nodes) ? nodes : nodes == null ? [] : [nodes];
  }
  const raw = walkJsonSegments(json, parseJsonAuthoringPath(normalizeJsonAuthoringPath(path)));
  if (Array.isArray(raw)) return raw;
  if (raw === undefined || raw === null) return [];
  return [raw];
}

function normalizeJsonAuthoringPath(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed || trimmed.startsWith("$") || trimmed.startsWith("/")) return trimmed;
  return `$.${trimmed.replace(/^\./, "")}`;
}

function isRelativeJsonPath(expr: string): boolean {
  return expr.length > 0 && !expr.startsWith("$") && !expr.startsWith("/");
}

function xpathEval(expr: string, ctx: SourceContext, type: string): unknown {
  if (ctx.kind === "json") {
    const trimmed = expr.trim();
    const relative = isRelativeJsonPath(trimmed);
    if (looksLikeOpenEhrLocator(trimmed)) {
      const query = compileAuthoringPath(trimmed, "json");
      const walkRoot = relative ? (ctx.relativeRoot ?? ctx.json) : ctx.json;
      const variables = { source: walkRoot };
      switch (type) {
        case "number":
          return fontoxpath.evaluateXPathToNumber(query, null, null, variables);
        case "boolean":
          return fontoxpath.evaluateXPathToBoolean(query, null, null, variables);
        default:
          return fontoxpath.evaluateXPathToString(query, null, null, variables);
      }
    }
    const path = relative
      ? (trimmed === "." ? "$" : `$.${trimmed.replace(/^\./, "")}`)
      : trimmed;
    const walkRoot = relative ? (ctx.relativeRoot ?? ctx.json) : ctx.json;
    if (/\[\*\]/.test(path)) {
      return evalJsonWildcard(path, walkRoot);
    }
    if (relative) {
      return walkJsonSegments(walkRoot, parseJsonAuthoringPath(path));
    }
    // Walk the document so a missing index (empty `per_typ`) is undefined
    // instead of FOAY0001, which would blank a whole Decision table.
    return walkJsonSegments(ctx.json, parseJsonAuthoringPath(path));
  }

  const compiled = looksLikeOpenEhrLocator(expr)
    ? compileAuthoringPath(expr, "xml")
    : expr;
  const node = ctx.xmlDocument!;
  switch (type) {
    case "number":
      return fontoxpath.evaluateXPathToNumber(compiled, node);
    case "boolean":
      return fontoxpath.evaluateXPathToBoolean(compiled, node);
    case "string":
      return fontoxpath.evaluateXPathToString(compiled, node);
    default:
      return fontoxpath.evaluateXPathToString(compiled, node);
  }
}

/**
 * Walk JSON `[*]` paths in document order so missing optional fields stay as
 * holes (`undefined`) instead of being dropped by an XPath sequence.
 */
function evalJsonWildcard(expr: string, json: unknown): unknown[] {
  const result = walkJsonSegments(json, parseJsonAuthoringPath(expr));
  return Array.isArray(result) ? result : result === undefined ? [] : [result];
}

function walkJsonSegments(
  node: unknown,
  segments: Array<string | number>,
): unknown {
  if (segments.length === 0) return node;
  const [head, ...rest] = segments;
  if (head === "*") {
    if (!Array.isArray(node)) return [];
    return node.map((item) => walkJsonSegments(item, rest));
  }
  if (node == null || typeof node !== "object") return undefined;
  if (typeof head === "number") {
    if (!Array.isArray(node)) return undefined;
    const index = head >= 1 ? head - 1 : head;
    return walkJsonSegments(node[index], rest);
  }
  return walkJsonSegments((node as Record<string, unknown>)[head], rest);
}

function parseJsonAuthoringPath(expr: string): Array<string | number> {
  const source = expr.trim().replace(/^\$/, "");
  const segments: Array<string | number> = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "." || ch === "/") {
      i++;
      continue;
    }
    if (ch === "[") {
      const close = source.indexOf("]", i + 1);
      if (close < 0) throw new Error(`Invalid JSON source path: ${expr}`);
      const token = source.slice(i + 1, close).trim();
      if (/^\d+$/.test(token)) {
        segments.push(Number(token));
      } else if (token === "*") {
        segments.push("*");
      } else if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        const normalized = token.startsWith("'")
          ? `"${token.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : token;
        segments.push(JSON.parse(normalized));
      } else {
        segments.push(token);
      }
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < source.length && !".[/".includes(source[end]!)) end++;
    if (end > i) segments.push(source.slice(i, end));
    i = end;
  }
  return segments;
}

/** Blockly `text_changeCase`. Null stays empty so a missing source path does not print "null". */
function changeCase(value: unknown, mode: string): string {
  if (value == null) return "";
  const text = String(value);
  if (mode === "UPPERCASE") return text.toUpperCase();
  if (mode === "TITLECASE") {
    return text.replace(
      /\S+/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }
  return text.toLowerCase();
}

function coerceReturn(value: unknown, returnType: string): unknown {
  if (returnType === "node" || returnType === "source") return value;
  if (Array.isArray(value)) return value.map((item) => coerceReturn(item, returnType));
  if (value === null || value === undefined) return value;
  // Keep `map(...)` records so DV_QUANTITY / DV_CODED_TEXT shells can unpack fields.
  if (typeof value === "object") return value;
  switch (returnType) {
    case "number":
      return Number(value);
    case "boolean":
      return Boolean(value);
    default:
      return String(value);
  }
}

/** First node / subtree at a fontoxpath-authored path, as a Handlebars-friendly value. */
export function evalSourceNode(expr: string, ctx: SourceContext): unknown {
  const trimmed = expr.trim();
  if (ctx.kind === "json") {
    const relative = isRelativeJsonPath(trimmed);
    const root = relative ? (ctx.relativeRoot ?? ctx.json) : ctx.json;
    if (!trimmed || trimmed === "$" || trimmed === "." || trimmed === "/") {
      return root;
    }
    const nodes = collectJsonNodes(trimmed, root);
    return nodes.length <= 1 ? (nodes[0] ?? null) : nodes;
  }
  const documentNode = ctx.xmlDocument;
  if (!documentNode) return null;
  const path = !trimmed || trimmed === "$" || trimmed === "." ? "/" : trimmed;
  const compiled = looksLikeOpenEhrLocator(path) ? compileAuthoringPath(path, "xml") : path;
  const node = fontoxpath.evaluateXPathToFirstNode(compiled, documentNode);
  return xmlNodeToJson(node as Node | null);
}

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function sameItem(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function evalQuantifier(
  ast: Extract<ExprAst, { kind: "call" }>,
  ctx: SourceContext,
): boolean {
  const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
  const list = asList(evalAst(ast.args[0]!, ctx));
  const n = card ? Number(evalAst(ast.args[1]!, ctx)) : 0;
  const varArg = card ? ast.args[2] : ast.args[1];
  const pred = card ? ast.args[3] : ast.args[2];
  const varName = String(evalAst(varArg ?? { kind: "literal", value: "item" }, ctx) ?? "item");
  const matches = (item: unknown) => {
    if (!pred) return true;
    return !!evalAst(pred, itemContext(ctx, varName, item));
  };
  switch (ast.name) {
    case "all_of":
      return list.every(matches);
    case "any_of":
      return list.some(matches);
    case "none_of":
      return list.every((item) => !matches(item));
    case "at_least":
      return list.filter(matches).length >= n;
    case "at_most":
      return list.filter(matches).length <= n;
    case "exactly":
      return list.filter(matches).length === n;
    default:
      return false;
  }
}

function itemContext(ctx: SourceContext, name: string, item: unknown): SourceContext {
  return {
    ...ctx,
    vars: { ...(ctx.vars ?? {}), [name]: item },
    relativeRoot: item,
    data: item,
  };
}

function setIntersection(a: unknown[], b: unknown[]): unknown[] {
  return a.filter((item) => b.some((other) => sameItem(item, other)));
}

function setUnion(a: unknown[], b: unknown[]): unknown[] {
  const out = [...a];
  for (const item of b) {
    if (!out.some((other) => sameItem(item, other))) out.push(item);
  }
  return out;
}

function setDifference(universe: unknown[], excluded: unknown[]): unknown[] {
  return universe.filter((item) => !excluded.some((other) => sameItem(item, other)));
}

function xmlNodeToJson(node: Node | null): unknown {
  if (!node) return null;
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return xmlNodeToJson((node as Document).documentElement);
  }
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const text = node.textContent?.trim();
    return text || undefined;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const el = node as Element;
  const obj: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    obj[`@${attr.name}`] = attr.value;
  }
  const childElements = Array.from(el.childNodes).filter(
    (child) => child.nodeType === Node.ELEMENT_NODE,
  ) as Element[];
  const text = Array.from(el.childNodes)
    .filter((child) =>
      child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE
    )
    .map((child) => child.textContent ?? "")
    .join("")
    .trim();
  if (!childElements.length) {
    if (!Object.keys(obj).length) return text;
    if (text) obj["#text"] = text;
    return obj;
  }
  const grouped = new Map<string, unknown[]>();
  for (const child of childElements) {
    const list = grouped.get(child.tagName) ?? [];
    list.push(xmlNodeToJson(child));
    grouped.set(child.tagName, list);
  }
  for (const [name, list] of grouped) {
    obj[name] = list.length === 1 ? list[0] : list;
  }
  if (text) obj["#text"] = text;
  return obj;
}
