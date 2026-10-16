/**
 * Turn a Kintegrate Handlebars presence test `(or path path …)` into JSON
 * authoring paths for `any_of`.
 *
 * Handlebars indexes are zero-based (`[0]` first, `[1]` second). The JSON
 * walker treats `[1]` as the first element (one-based) and `[0]` as a
 * zero-based exception, so a second Handlebars item is `[2]` on that walker.
 */

/** Paths inside the first `(or …)` group, rewritten for the JSON walker. */
export function extractOrPaths(expr: string): string[] | null {
  const start = expr.indexOf("(or");
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const inner = expr.slice(start + "(or".length, end);
  const tokens = inner.replace(/[()]/g, " ").split(/\s+/).filter((token) => token.includes("."));
  if (!tokens.length) return null;
  return tokens.map(handlebarsPathToJson);
}

/** Rewrite zero-based Handlebars indexes onto the JSON authoring walker. */
export function handlebarsPathToJson(path: string): string {
  return path.trim().replace(/\[(\d+)\]/g, (_match, raw: string) => {
    const index = Number(raw);
    if (!Number.isFinite(index) || index <= 0) return "[0]";
    return `[${index + 1}]`;
  });
}
