/**
 * Column widths for the Sheets / Decision tables grid.
 * Columns follow their text. Spare pane width is shared so the grid fills
 * the container; content that is wider than the pane keeps its width and scrolls.
 */

/** Short headers stay clickable, including the decision-table cog. */
export const SHEET_COLUMN_MIN_PX = 72;

export function estimateCellWidthPx(text: string, pxPerChar = 8, pad = 28): number {
  const longest = String(text).split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  return Math.max(SHEET_COLUMN_MIN_PX, Math.ceil(longest * pxPerChar + pad));
}

/** Preferred width of each column from its header and cell text. */
export function sheetColumnContentWidths(
  headers: string[],
  values: unknown[][],
  options?: { headerPad?: number; cellPad?: number },
): number[] {
  const headerPad = options?.headerPad ?? 36;
  const cellPad = options?.cellPad ?? 28;
  return headers.map((header, index) => {
    let width = estimateCellWidthPx(header, 8, headerPad);
    for (const row of values) {
      const cell = row?.[index];
      width = Math.max(width, estimateCellWidthPx(cell == null ? "" : String(cell), 8, cellPad));
    }
    return width;
  });
}

/**
 * Size columns to their content. When the pane is wider than that content,
 * share the spare width in proportion to the content so the grid fills it.
 */
export function sheetColumnWidths(input: {
  contentWidths: number[];
  availablePx: number;
  minPx?: number;
}): number[] {
  const min = input.minPx ?? SHEET_COLUMN_MIN_PX;
  const preferred = input.contentWidths.map((width) => {
    const value = Number.isFinite(width) ? width : min;
    return Math.max(min, Math.ceil(value));
  });
  if (preferred.length === 0) return [];
  const sum = preferred.reduce((total, width) => total + width, 0);
  const available = Math.max(0, Math.floor(input.availablePx));
  if (available <= 0 || sum >= available) return preferred;
  const extra = available - sum;
  const weight = sum;
  let used = 0;
  return preferred.map((width, index) => {
    if (index === preferred.length - 1) return width + (extra - used);
    const share = Math.floor((extra * width) / weight);
    used += share;
    return width + share;
  });
}
