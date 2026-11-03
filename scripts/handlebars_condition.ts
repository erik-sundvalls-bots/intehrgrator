/**
 * Parse a Kintegrate Handlebars `{{#if …}}` condition.
 *
 * The conditions on the lung-MDT script are paths, `(eq path "text")`,
 * `(ne path "text")`, and n-ary `(and …)` / `(or …)`. A path-only `(or …)`
 * is the presence list an any-of block can test without a Handlebars string.
 */

export type HandlebarsCondition =
  | { kind: "path"; path: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "null" }
  | { kind: "call"; name: string; args: HandlebarsCondition[] };

type Token =
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "string"; value: string }
  | { type: "atom"; value: string };

export function parseHandlebarsCondition(source: string): HandlebarsCondition {
  const parser = new Parser(tokenize(source.trim()));
  const expr = parser.parse();
  if (parser.peek()) {
    throw new Error(`Unexpected token after Handlebars condition: ${source.slice(0, 80)}`);
  }
  return expr;
}

/** Paths inside `(or path path …)` when every argument is a path. */
export function pathOnlyOr(expr: HandlebarsCondition): string[] | null {
  if (expr.kind !== "call" || expr.name !== "or") return null;
  const paths: string[] = [];
  for (const arg of expr.args) {
    if (arg.kind !== "path") return null;
    paths.push(arg.path);
  }
  return paths.length ? paths : null;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/u.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === '"') {
      let value = "";
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < source.length) {
          value += source[i + 1];
          i += 2;
          continue;
        }
        value += source[i];
        i++;
      }
      if (source[i] !== '"') throw new Error("Unclosed string in Handlebars condition");
      i++;
      tokens.push({ type: "string", value });
      continue;
    }
    let end = i;
    while (end < source.length && !/[\s()"]/u.test(source[end]!)) end++;
    tokens.push({ type: "atom", value: source.slice(i, end) });
    i = end;
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index++];
    if (!token) throw new Error("Unexpected end of Handlebars condition");
    return token;
  }

  parse(): HandlebarsCondition {
    const token = this.peek();
    if (!token) throw new Error("Empty Handlebars condition");
    if (token.type === "lparen") {
      this.consume();
      const name = this.consume();
      if (name.type !== "atom") throw new Error("Handlebars helper name missing");
      const args: HandlebarsCondition[] = [];
      while (this.peek() && this.peek()!.type !== "rparen") args.push(this.parse());
      if (this.peek()?.type !== "rparen") {
        throw new Error(`Unclosed (${name.value} …)`);
      }
      this.consume();
      return { kind: "call", name: name.value, args };
    }
    this.consume();
    if (token.type === "string") return { kind: "string", value: token.value };
    if (token.type === "atom" && token.value === "null") return { kind: "null" };
    if (token.type === "atom" && /^-?\d+(?:\.\d+)?$/.test(token.value)) {
      return { kind: "number", value: Number(token.value) };
    }
    if (token.type !== "atom") throw new Error("Expected a path in Handlebars condition");
    return { kind: "path", path: token.value };
  }
}
