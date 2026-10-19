/**
 * #218: pure matching logic for find-in-pane (Source Schema / Example
 * Instances / Target Schema trees and the Mapping canvas). Mirrors the
 * CodeMirror find options used by #208/#215: match case, regexp, by word.
 */

export type PaneFindQuery = {
  search: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
};

/** One match: `unit` indexes the searched text list, `[from, to)` is the substring. */
export type PaneFindHit = { unit: number; from: number; to: number };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordBoundary(text: string, from: number, to: number): boolean {
  const before = from > 0 ? text[from - 1] : "";
  const after = to < text.length ? text[to] : "";
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

/**
 * All matches of `query` in `texts`, in document order.
 * Returns `null` for an invalid regular expression (so the UI can say so).
 */
export function findHits(
  texts: readonly string[],
  query: PaneFindQuery,
): PaneFindHit[] | null {
  if (!query.search) return [];
  let re: RegExp;
  try {
    re = new RegExp(
      query.regexp ? query.search : escapeRegExp(query.search),
      query.caseSensitive ? "gu" : "giu",
    );
  } catch {
    return null;
  }
  const hits: PaneFindHit[] = [];
  texts.forEach((text, unit) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const from = m.index;
      const to = from + m[0].length;
      if (!query.wholeWord || isWordBoundary(text, from, to)) hits.push({ unit, from, to });
    }
  });
  return hits;
}

/** Next (`dir` 1) or previous (`dir` -1) hit index, wrapping around. */
export function stepIndex(count: number, current: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/**
 * After the query or the pane content changed: keep the current hit when a
 * hit still starts at the same place, otherwise land on the first hit
 * (auto-select, like the #208 text find).
 */
export function pickCurrentAfterRefresh(
  before: readonly PaneFindHit[],
  beforeIndex: number,
  after: readonly PaneFindHit[],
): number {
  if (after.length === 0) return -1;
  const prev = before[beforeIndex];
  if (prev) {
    const same = after.findIndex((h) => h.unit === prev.unit && h.from === prev.from);
    if (same >= 0) return same;
  }
  return 0;
}

/** "2 of 7" / "No matches" (templates come from the chrome catalog). */
export function formatFindCount(
  current: number,
  total: number,
  template: string,
  none: string,
): string {
  if (total <= 0) return none;
  return template.replace("{current}", String(current + 1)).replace("{total}", String(total));
}
