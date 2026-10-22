import type { ProjectBundle } from "../types/mod.ts";

/** Stable revision token for optimistic concurrency on agent mutations. */
export function bundleRevision(bundle: ProjectBundle): string {
  const mapping = bundle.mapping;
  const payload = JSON.stringify({
    model: mapping.model,
    blocklyState: mapping.blocklyState,
    handlebarsTemplate: mapping.handlebarsTemplate ?? "",
    sheets: mapping.sheets ?? [],
  }, ignoreAuthorMarks);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
}

/**
 * The AI author marker (`block.data.aiAuthor`, ADR 0014) is display only: a
 * marker update must not invalidate a revision an agent is about to send.
 */
function ignoreAuthorMarks(key: string, value: unknown): unknown {
  if (key !== "data" || typeof value !== "string" || !value.includes('"aiAuthor"')) return value;
  try {
    const { aiAuthor: _mark, ...rest } = JSON.parse(value) as Record<string, unknown>;
    return Object.keys(rest).length ? JSON.stringify(rest) : undefined;
  } catch {
    return value;
  }
}
