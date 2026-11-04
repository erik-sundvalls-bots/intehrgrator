/**
 * A source path may name a loop item in lexical scope: `dag.StartTid` reads
 * `StartTid` from the item bound by the enclosing `for each` whose name is
 * `dag`, not from the innermost item. Unqualified paths (`StartTid`,
 * `Substanser`) stay relative to the innermost item. Absolute paths (`$.…`,
 * `/…`) stay on the document.
 *
 * The binding is the same `let` the loop already emits (`dag` in TypeScript
 * and Java, `$dag` in XQuery and Go templates).
 */

export interface NamedLoopRead {
  /** Loop item name, exactly as written on `for each`. */
  name: string;
  /** Path relative to that item. `"."` is the item itself. */
  rest: string;
}

const HEAD = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.(.*))?$/;

/**
 * Split `dag.StartTid` when `dag` is in scope. Innermost name wins when the
 * same name is bound twice. Returns null for absolute paths and for relative
 * paths whose first step is not a loop item.
 */
export function namedLoopRead(
  path: string,
  names: readonly string[],
): NamedLoopRead | null {
  const trimmed = path.trim();
  if (
    !trimmed || trimmed.startsWith("$") || trimmed.startsWith("/") ||
    trimmed.startsWith(".")
  ) {
    return null;
  }
  const match = HEAD.exec(trimmed);
  if (!match) return null;
  const name = match[1]!;
  if (!names.includes(name)) return null;
  const rest = match[2];
  if (rest == null) return { name, rest: "." };
  if (!rest || rest.startsWith(".") || rest.startsWith("[")) return null;
  return { name, rest };
}

/** Look up `path` in a name → emitter ident map. The ident is whatever the caller stored. */
export function namedLoopBinding(
  path: string,
  bindings: Readonly<Record<string, string>> | undefined,
): { ident: string; rest: string } | null {
  if (!bindings) return null;
  const named = namedLoopRead(path, Object.keys(bindings));
  if (!named) return null;
  const ident = bindings[named.name];
  if (!ident) return null;
  return { ident, rest: named.rest };
}
