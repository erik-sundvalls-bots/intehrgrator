/**
 * DV_CODED_TEXT on a DV_TEXT node (#274). In openEHR a node constrained to
 * DV_TEXT accepts its subclass DV_CODED_TEXT in data: an OPT 1.4 / ADL2
 * object constraint matches instances of the constrained RM type and its
 * subtypes, and neither has a way to exclude one subtype. So every DV_TEXT
 * value node may carry a code and a terminology; a C_STRING on `value` still
 * applies to the text.
 */
import type { MappingSlot, SkeletonNode } from "../../types/mod.ts";
import { type ExprAst, parseExpression } from "../expression/mod.ts";

export const CODED_TEXT = "DV_CODED_TEXT";

/** True for a DV_TEXT value node, which may be mapped as DV_CODED_TEXT. */
export function allowsCodedText(
  node: Pick<SkeletonNode, "kind" | "rmType"> | undefined,
): boolean {
  return node?.kind === "value" && node.rmType === "DV_TEXT";
}

/** Map keys that carry a code: an expression with these on a DV_TEXT slot is a DV_CODED_TEXT. */
const CODE_KEYS = /"(code_string|defining_code|terminology_id)"/;

/** `map("value", …, "code_string", …)` and the like: the expression has a code. */
export function expressionHasCode(expression: string): boolean {
  return /^\s*map\(/.test(expression) && CODE_KEYS.test(expression);
}

/** The template's RM type, or DV_CODED_TEXT when the canvas maps a DV_TEXT node as that subclass. */
export function textSubtype(
  target: { rmType: string },
  mapped: string,
): string {
  return target.rmType === "DV_TEXT" && mapped === CODED_TEXT
    ? CODED_TEXT
    : target.rmType;
}

/**
 * The RM type a mapping of a DV_TEXT node gets: `requested` when it is
 * DV_TEXT or DV_CODED_TEXT, else DV_CODED_TEXT when the expression carries a
 * code (so the code is never dropped), else DV_TEXT.
 */
export function codedTextRmType(
  expression: string,
  requested?: string,
): "DV_TEXT" | "DV_CODED_TEXT" {
  if (requested === "DV_TEXT" || requested === CODED_TEXT) return requested;
  return expressionHasCode(expression) ? CODED_TEXT : "DV_TEXT";
}

/**
 * Skeleton with each DV_TEXT node whose mapping is DV_CODED_TEXT switched to
 * that subclass, so code generation and validation see the real type.
 */
export function applyCodedTextSlots(
  skeleton: SkeletonNode[],
  slots: readonly MappingSlot[],
): SkeletonNode[] {
  const coded = new Set(
    slots.filter((s) => s.rmType === CODED_TEXT).map((s) => s.slotId),
  );
  if (!coded.size) return skeleton;
  let changed = false;
  const walk = (nodes: SkeletonNode[]): SkeletonNode[] =>
    nodes.map((node) => {
      if (allowsCodedText(node) && coded.has(node.slotId)) {
        changed = true;
        return {
          ...node,
          rmType: CODED_TEXT,
          blockType: "dv_coded_text",
        };
      }
      if (!node.children.length) return node;
      const children = walk(node.children);
      return children.every((c, i) => c === node.children[i])
        ? node
        : { ...node, children };
    });
  const next = walk(skeleton);
  return changed ? next : skeleton;
}

/** Parts of a DV_CODED_TEXT mapping: the `value`, `code_string` (or `defining_code`) and `terminology_id` of a `map(…)`. */
export type CodedTextParts = {
  value?: ExprAst;
  code?: ExprAst;
  terminology?: ExprAst;
};

/** The parts of a `map("value", …, "code_string", …, "terminology_id", …)` expression; null for any other expression. */
export function codedTextParts(
  expression: string | undefined,
): CodedTextParts | null {
  if (!expression || !expressionHasCode(expression)) return null;
  let ast: ExprAst;
  try {
    ast = parseExpression(expression);
  } catch {
    return null;
  }
  return collectParts(ast, {});
}

/** `defining_code` may itself be a `map("terminology_id", …, "code_string", …)`. */
function collectParts(
  ast: ExprAst,
  parts: CodedTextParts,
): CodedTextParts | null {
  if (ast.kind !== "call" || ast.name !== "map" || ast.args.length % 2) {
    return null;
  }
  for (let i = 0; i < ast.args.length; i += 2) {
    const key = ast.args[i]!;
    const arg = ast.args[i + 1]!;
    if (key.kind !== "literal") return null;
    if (key.value === "value") parts.value = arg;
    else if (key.value === "code_string") parts.code = arg;
    else if (key.value === "terminology_id") parts.terminology = arg;
    else if (key.value === "defining_code" && !collectParts(arg, parts)) {
      parts.code = arg;
    }
  }
  return parts;
}
