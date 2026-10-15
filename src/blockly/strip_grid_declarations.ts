/**
 * Saved workspaces may still contain `sheet` and `decision_table_decl` chips.
 * Those blocks are not part of the canvas anymore. Drop them on load.
 * Grid JSON is a separate document and is not touched here.
 */

const GRID_DECLARATION_TYPES = new Set(["sheet", "decision_table_decl"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDeclaration(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && GRID_DECLARATION_TYPES.has(String(value.type ?? ""));
}

/** Remove declaration chips, keeping any block that was chained after one. */
export function stripGridDeclarationBlocks<T>(state: T): T {
  return strip(state) as T;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      if (isDeclaration(item)) {
        const next = isRecord(item.next) ? item.next.block : undefined;
        if (next !== undefined) out.push(strip(next));
        continue;
      }
      out.push(strip(item));
    }
    return out;
  }
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === "block" || key === "shadow") && isDeclaration(value)) {
      const next = isRecord(value.next) ? value.next.block : undefined;
      if (next !== undefined) out[key] = strip(next);
      continue;
    }
    out[key] = strip(value);
  }
  return out;
}
