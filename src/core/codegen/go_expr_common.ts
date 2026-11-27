/**
 * Shared pieces of the two Go text/template emitters (`go_template.ts` for the
 * canvas / XML path, `go_template_skeleton.ts` for openEHR and JSON Schema).
 *
 * Go templates have no user functions with return values and no lambdas, so an
 * expression-bodied Function call is inlined: its body with the parameters
 * replaced by the call's argument expressions. A statement-bodied Function (a
 * STACK of local variables) cannot be expressed and fails loudly.
 */
import type { MappingFunction } from "../../types/mod.ts";
import { type ExprAst, isQuantifyCall, parseExpression } from "../expression/mod.ts";

/** A construct Go text/template cannot express: fail generation with a readable message. */
export function goUnsupported(what: string, language = "Go templates"): Error {
  return new Error(`${language} do not support ${what}; use TypeScript, Java or XQuery`);
}

const MAX_INLINE_DEPTH = 16;

/** `call("name", args…)` → the Function body with its parameters bound to `args`. */
export function inlineGoFunctionCall(
  ast: Extract<ExprAst, { kind: "call" }>,
  functions: MappingFunction[] | undefined,
  depth = 0,
  language = "Go templates",
): ExprAst {
  const one = language.replace(/s$/, "");
  const name = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
  const fn = (functions ?? []).find((item) => item.name === name);
  if (!fn) throw new Error(`${one}: unknown Function ${name || "(unnamed)"}`);
  if (fn.stack?.length) {
    throw new Error(
      `${language} cannot return values from statement-bodied Function ${fn.name}; use TypeScript, Java or XQuery`,
    );
  }
  if (!fn.body) throw new Error(`${one}: Function ${fn.name} has no return value`);
  if (depth >= MAX_INLINE_DEPTH) {
    throw goUnsupported(`recursive Function ${fn.name}`, language);
  }
  const bindings = new Map<string, ExprAst>();
  fn.params.forEach((param, i) => {
    bindings.set(param, ast.args[i + 1] ?? { kind: "literal", value: null });
  });
  const body = substituteVars(parseExpression(fn.body), bindings);
  return expandCalls(body, functions, depth + 1, language);
}

/** Inline every nested `call(...)` in `ast`. */
function expandCalls(
  ast: ExprAst,
  functions: MappingFunction[] | undefined,
  depth: number,
  language: string,
): ExprAst {
  if (ast.kind === "literal") return ast;
  if (ast.kind === "binary") {
    return {
      ...ast,
      left: expandCalls(ast.left, functions, depth, language),
      right: expandCalls(ast.right, functions, depth, language),
    };
  }
  const args = ast.args.map((arg) => expandCalls(arg, functions, depth, language));
  const next = { ...ast, args };
  return ast.name === "call" ? inlineGoFunctionCall(next, functions, depth, language) : next;
}

/** `ast` with `var(name)` replaced per `bindings`; a quantifier rebinding a name shadows it. */
export function substituteVars(ast: ExprAst, bindings: Map<string, ExprAst>): ExprAst {
  if (!bindings.size || ast.kind === "literal") return ast;
  if (ast.kind === "binary") {
    return { ...ast, left: substituteVars(ast.left, bindings), right: substituteVars(ast.right, bindings) };
  }
  if (ast.name === "var" && ast.args[0]?.kind === "literal") {
    const bound = bindings.get(String(ast.args[0].value));
    if (bound) return bound;
  }
  if (isQuantifyCall(ast.name)) {
    const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
    const inner = card ? ast.args[2] : ast.args[1];
    if (inner?.kind === "literal" && bindings.has(String(inner.value))) {
      const shadowed = new Map(bindings);
      shadowed.delete(String(inner.value));
      return {
        ...ast,
        args: ast.args.map((arg, i) => substituteVars(arg, i === 0 ? bindings : shadowed)),
      };
    }
  }
  return { ...ast, args: ast.args.map((arg) => substituteVars(arg, bindings)) };
}

/**
 * any/all/none/at-least/at-most/exactly over a literal `list(a, b, …)`: Go
 * templates have no lambdas, so the predicate is instantiated per item. A
 * computed list cannot be unrolled and fails loudly.
 */
export function unrollGoQuantifier(
  ast: Extract<ExprAst, { kind: "call" }>,
  emit: (item: ExprAst) => string,
  options: { language?: string; negate?: (expr: string) => string } = {},
): string {
  const negate = options.negate ?? ((expr: string) => `(not ${expr})`);
  const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
  const list = ast.args[0];
  if (!list || list.kind !== "call" || list.name !== "list") {
    throw goUnsupported(`${ast.name} over a computed list; use a literal list of values`, options.language);
  }
  const varAst = card ? ast.args[2] : ast.args[1];
  const predAst = card ? ast.args[3] : ast.args[2];
  const varName = varAst?.kind === "literal" ? String(varAst.value) : "item";
  const items = list.args.map((item) =>
    predAst ? emit(substituteVars(predAst, new Map([[varName, item]]))) : "true"
  );
  if (card) {
    const countArg = ast.args[1] ? emit(ast.args[1]) : "0";
    const hits = items.map((item) => `(ifElse ${item} 1 0)`);
    const total = hits.length ? hits.reduce((acc, hit) => `(add ${acc} ${hit})`, "0") : "0";
    const op = ast.name === "at_least" ? "ge" : ast.name === "at_most" ? "le" : "";
    return op ? `(cmpNum "${op}" ${total} ${countArg})` : `(same ${total} (toNum ${countArg}))`;
  }
  if (!items.length) return ast.name === "any_of" ? "false" : "true";
  const truthy = items.map((item) => `(ifElse ${item} true false)`);
  const joined = truthy.length === 1 ? truthy[0]! : `(${ast.name === "all_of" ? "and" : "or"} ${truthy.join(" ")})`;
  return ast.name === "none_of" ? negate(joined) : joined;
}
