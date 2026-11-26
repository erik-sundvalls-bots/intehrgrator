/**
 * Bake Handlebars.js whitespace control into a template's text (#388).
 *
 * Handlebars.js removes "standalone" block lines and honours `~`. Other
 * engines differ on the standalone rules (Handlebars.java's prettyPrint strips
 * lines Handlebars.js keeps), so the Java Conversion Script renders a template
 * whose text already has the Handlebars.js stripping applied: parse with
 * Handlebars.js (which runs its WhitespaceControl pass), then print the tree
 * back with the stripped text and no `~` or standalone lines left to strip.
 * Rendering the result without standalone handling gives the same text as
 * rendering the original with Handlebars.js.
 */

import Handlebars from "handlebars";

// deno-lint-ignore no-explicit-any
type Node = any;

/** The template with Handlebars.js whitespace control applied, or `template` when it cannot be printed. */
export function resolveHandlebarsWhitespace(template: string): string {
  if (!template.includes("{{")) return template;
  try {
    return printProgram(Handlebars.parse(template));
  } catch {
    return template;
  }
}

function printProgram(program: Node | undefined): string {
  if (!program) return "";
  return (program.body as Node[]).map(printStatement).join("");
}

function printStatement(node: Node): string {
  switch (node.type) {
    case "ContentStatement":
      // A literal "{{" in text must stay text.
      return String(node.value).replace(/\{\{/g, "\\{{");
    case "CommentStatement":
      return "";
    case "MustacheStatement": {
      const inner = printCall(node);
      return node.escaped === false ? `{{{${inner}}}}` : `{{${inner}}}`;
    }
    case "BlockStatement": {
      const name = printPath(node.path);
      const open = printCall(node);
      if (!node.program && node.inverse) {
        return `{{^${open}}}${printProgram(node.inverse)}{{/${name}}}`;
      }
      const inverse = node.inverse
        ? `{{else}}${printProgram(node.inverse)}`
        : "";
      return `{{#${open}}}${printProgram(node.program)}${inverse}{{/${name}}}`;
    }
    default:
      throw new Error(`unsupported Handlebars node ${node.type}`);
  }
}

function printCall(node: Node): string {
  const parts = [
    printExpr(node.path),
    ...(node.params as Node[] ?? []).map(printExpr),
  ];
  for (const pair of (node.hash?.pairs as Node[] | undefined) ?? []) {
    parts.push(`${pair.key}=${printExpr(pair.value)}`);
  }
  return parts.join(" ");
}

function printExpr(node: Node): string {
  switch (node.type) {
    case "PathExpression":
      return printPath(node);
    case "SubExpression":
      return `(${printCall(node)})`;
    case "StringLiteral":
      return `"${String(node.value).replace(/"/g, '\\"')}"`;
    case "NumberLiteral":
    case "BooleanLiteral":
      return String(node.value);
    case "UndefinedLiteral":
      return "undefined";
    case "NullLiteral":
      return "null";
    default:
      throw new Error(`unsupported Handlebars expression ${node.type}`);
  }
}

const PLAIN_SEGMENT = /^[\p{L}\p{N}_$-]+$/u;

function printPath(node: Node): string {
  const parts = node.parts as string[];
  if (!parts.length) return String(node.original);
  const prefix = (node.data ? "@" : "") + "../".repeat(node.depth ?? 0) +
    (String(node.original).startsWith("this.") ||
        String(node.original).startsWith("./")
      ? "this."
      : "");
  return prefix +
    parts.map((part, i) =>
      PLAIN_SEGMENT.test(part) && !(i === 0 && /^\d/.test(part) && !prefix)
        ? part
        : `[${part}]`
    ).join(".");
}
