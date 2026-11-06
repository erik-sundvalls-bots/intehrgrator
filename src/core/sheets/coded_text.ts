/** Package-free runtime shared by Mapping preview and generated TypeScript. */
export interface CodedTextSheet {
  headers: string[];
  values: unknown[][];
}

/**
 * First exact key match, preserving code strings (including leading zeroes).
 * All column references are header names. mappingColumns maps terminology IDs
 * to code-column headers. Missing keys/primary fields return null; blank mapping
 * cells are omitted, never replaced by a guessed code.
 */
export function sheetCodedText(
  sheets: Record<string, CodedTextSheet | undefined>,
  sheetName: string,
  keyColumn: string,
  key: unknown,
  valueColumn: string,
  codeColumn: string,
  primaryTerminology: string,
  mappingColumns: unknown,
): Record<string, unknown> | null {
  const sheet = sheets[sheetName];
  if (!sheet || key == null || String(key).trim() === "") return null;
  const keyIndex = sheet.headers.indexOf(keyColumn);
  if (keyIndex < 0) return null;
  const row = sheet.values.find((cells) =>
    String(cells[keyIndex] ?? "") === String(key)
  );
  if (!row) return null;
  const cell = (column: string) =>
    String(row[sheet.headers.indexOf(column)] ?? "").trim();
  const value = cell(valueColumn);
  const code = cell(codeColumn);
  if (!value || !code || !primaryTerminology?.trim()) return null;
  const phrase = (terminology: string, code: string) => ({
    _type: "CODE_PHRASE",
    code_string: code,
    terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
  });
  const mappings: unknown[] = [];
  if (
    mappingColumns && typeof mappingColumns === "object" &&
    !Array.isArray(mappingColumns)
  ) {
    for (const [terminology, column] of Object.entries(mappingColumns)) {
      if (!terminology.trim() || typeof column !== "string") continue;
      const target = cell(column);
      if (target) {
        mappings.push({
          _type: "TERM_MAPPING",
          match: "=",
          target: phrase(terminology, target),
        });
      }
    }
  }
  return {
    _type: "DV_CODED_TEXT",
    value,
    defining_code: phrase(primaryTerminology, code),
    ...(mappings.length ? { mappings } : {}),
  };
}
