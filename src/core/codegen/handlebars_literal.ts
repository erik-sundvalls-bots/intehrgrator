/**
 * Lower a literal VMS-Hbs template into a parent Handlebars expression
 * (issue #394: splice a Handlebars value into the generated product at
 * generation time, with no runtime `handlebars` helper).
 */
import Handlebars from "handlebars";
import { goUnsupported } from "./go_expr_common.ts";

const HBS = "Handlebars scripts";

type HbNode = {
  type?: string;
  value?: string;
  original?: string;
  path?: { original?: string; parts?: string[] };
  params?: HbNode[];
  hash?: { pairs?: Array<{ key?: string; value?: HbNode }> };
  program?: { body?: HbNode[] };
  inverse?: { body?: HbNode[] };
  body?: HbNode[];
};

function hbsStr(s: string): string {
  return JSON.stringify(s);
}

function pathOriginal(node: HbNode | undefined): string {
  if (!node) return "";
  if (node.original) return node.original;
  if (node.path?.original) return node.path.original;
  if (node.path?.parts?.length) return node.path.parts.join(".");
  return "";
}

function jget(contextExpr: string, path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "." || trimmed === "this") return contextExpr;
  const parts = trimmed.split(".").filter(Boolean);
  if (!parts.length) return contextExpr;
  return `(jget ${contextExpr} ${parts.map(hbsStr).join(" ")})`;
}

function lowerExpr(node: HbNode, contextExpr: string): string {
  const type = node.type ?? "";
  if (type === "PathExpression" || type === "Id") return jget(contextExpr, pathOriginal(node));
  if (type === "StringLiteral") return hbsStr(String(node.value ?? ""));
  if (type === "NumberLiteral") return String(node.value ?? 0);
  if (type === "BooleanLiteral") return node.value ? "true" : "false";
  if (type === "NullLiteral" || type === "UndefinedLiteral") return "null";
  if (type === "SubExpression") return lowerMustache(node, contextExpr);
  throw goUnsupported(
    `a Handlebars ${type || "construct"} inside a value (only a literal VMS-Hbs template can be inlined)`,
    HBS,
  );
}

function lowerMustache(node: HbNode, contextExpr: string): string {
  const name = pathOriginal(node);
  const params = (node.params ?? []).map((p) => lowerExpr(p, contextExpr));
  if (!name) return "null";
  // A bare path: {{patientId}} or {{a.b}}.
  if (!params.length && !node.hash?.pairs?.length) {
    return jget(contextExpr, name);
  }
  const args = params.join(" ");
  switch (name) {
    case "toUpperCase":
    case "toLowerCase":
    case "trim":
    case "title":
    case "toNum":
    case "not":
    case "nonEmpty":
    case "inc":
    case "dec":
    case "count":
      return `(${name} ${args || '""'})`;
    case "eq":
      return `(same ${params[0] ?? "null"} ${params[1] ?? "null"})`;
    case "ne":
      return `(ifElse (same ${params[0] ?? "null"} ${params[1] ?? "null"}) false true)`;
    case "concat":
    case "coalesce":
    case "replace":
    case "regexReplace":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "and":
    case "or":
    case "ifElse":
    case "cmpNum":
    case "round":
    case "mod":
    case "clamp":
    case "listAt":
    case "jget":
    case "blk":
      return `(${name}${args ? " " + args : ""})`;
    default:
      throw goUnsupported(
        `the Handlebars helper ${name} inside a value (inline only VMS-Hbs helpers that lower to an expression)`,
        HBS,
      );
  }
}

function lowerBody(nodes: HbNode[] | undefined, contextExpr: string): string {
  const parts: string[] = [];
  for (const node of nodes ?? []) {
    const type = node.type ?? "";
    if (type === "ContentStatement") {
      const text = String(node.value ?? "");
      if (text) parts.push(hbsStr(text));
      continue;
    }
    if (type === "CommentStatement") continue;
    if (type === "MustacheStatement") {
      parts.push(lowerMustache(node, contextExpr));
      continue;
    }
    if (type === "BlockStatement") {
      const name = pathOriginal(node);
      if (name === "if" || name === "unless") {
        const cond = node.params?.[0] ? lowerExpr(node.params[0], contextExpr) : "false";
        const thenExpr = lowerBody(node.program?.body, contextExpr);
        const elseExpr = node.inverse?.body?.length
          ? lowerBody(node.inverse.body, contextExpr)
          : '""';
        const pred = name === "unless" ? `(ifElse ${cond} false true)` : cond;
        parts.push(`(ifElse ${pred} ${thenExpr} ${elseExpr})`);
        continue;
      }
      throw goUnsupported(
        `a Handlebars {{#${name}}} block inside a value (only {{#if}} / {{#unless}} and interpolations are inlined)`,
        HBS,
      );
    }
    if (type === "Program") {
      parts.push(lowerBody(node.body, contextExpr));
      continue;
    }
    throw goUnsupported(
      `a Handlebars ${type || "construct"} inside a value (only a literal VMS-Hbs template can be inlined)`,
      HBS,
    );
  }
  if (!parts.length) return '""';
  if (parts.length === 1) return parts[0]!;
  return `(concat ${parts.join(" ")})`;
}

/** Turn a literal VMS-Hbs template into a parent helper expression against `contextExpr`. */
export function lowerLiteralHandlebarsToExpr(script: string, contextExpr: string): string {
  let ast: HbNode;
  try {
    ast = Handlebars.parse(script) as HbNode;
  } catch (err) {
    throw goUnsupported(
      `an invalid Handlebars template inside a value (${err instanceof Error ? err.message : String(err)})`,
      HBS,
    );
  }
  return lowerBody(ast.body, contextExpr || "@root._data");
}
