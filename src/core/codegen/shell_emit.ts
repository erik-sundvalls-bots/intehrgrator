/**
 * Turn a DATA_VALUE shell fragment (mappings, ranges, octet payloads, …)
 * into constructor arguments for a conversion-script language.
 * Mapping preview evaluates the same tree at run time.
 */
import type { RmShellFragment } from "../../types/mod.ts";

export interface ShellCodegen {
  expr(expression: string): string;
  object(rmType: string, fields: Array<[string, string]>): string;
  /** `attribute` is the RM name of the list (`mappings`, `data`, …). */
  list(items: string[], attribute: string): string;
  octets(exprCode: string): string;
}

/** Attribute/value pairs for one shell. Empty when nothing was filled in. */
export function emitShellFields(
  fragments: Record<string, RmShellFragment> | undefined,
  gen: ShellCodegen,
): Array<[string, string]> {
  if (!fragments) return [];
  const out: Array<[string, string]> = [];
  for (const [name, fragment] of Object.entries(fragments)) {
    const code = emitShellFragment(fragment, gen, name);
    if (code) out.push([name, code]);
  }
  return out;
}

export function emitShellFragment(
  fragment: RmShellFragment,
  gen: ShellCodegen,
  attribute = "",
): string | null {
  switch (fragment.kind) {
    case "expr":
      return keep(gen.expr(fragment.expression));
    case "octets": {
      const code = keep(gen.expr(fragment.expression));
      return code ? gen.octets(code) : null;
    }
    case "list": {
      const items = fragment.items
        .map((item) => emitShellFragment(item, gen))
        .filter((item): item is string => Boolean(item));
      return items.length ? gen.list(items, attribute) : null;
    }
    case "object": {
      const fields: Array<[string, string]> = [];
      for (const [name, child] of Object.entries(fragment.fields)) {
        const code = emitShellFragment(child, gen, name);
        if (code) fields.push([name, code]);
      }
      return fields.length ? gen.object(fragment.rmType, fields) : null;
    }
  }
}

function keep(code: string | null | undefined): string | null {
  const trimmed = code?.trim() ?? "";
  if (!trimmed || trimmed === "()" || trimmed === "null" || trimmed === "undefined") return null;
  if (trimmed === '""' || trimmed === "''") return null;
  return code ?? null;
}
