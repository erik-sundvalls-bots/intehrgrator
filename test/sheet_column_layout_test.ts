import { assertEquals } from "@std/assert";
import {
  SHEET_COLUMN_MIN_PX,
  sheetColumnContentWidths,
  sheetColumnWidths,
} from "@intehrgrator/ui/sheet_column_layout.ts";

Deno.test("sheet columns keep content width when it is wider than the pane", () => {
  const widths = sheetColumnWidths({
    contentWidths: [400, 400],
    availablePx: 500,
  });
  assertEquals(widths, [400, 400]);
});

Deno.test("sheet columns fill the pane when content is narrower, favouring wider text", () => {
  const widths = sheetColumnWidths({
    contentWidths: [100, 100, 300],
    availablePx: 800,
  });
  assertEquals(widths, [160, 160, 480]);
});

Deno.test("sheet columns honour the minimum width and an empty grid", () => {
  assertEquals(sheetColumnWidths({ contentWidths: [10], availablePx: 40 }), [SHEET_COLUMN_MIN_PX]);
  assertEquals(sheetColumnWidths({ contentWidths: [], availablePx: 800 }), []);
});

Deno.test("decision-table content width follows the longest cell, not a fixed 120", () => {
  const widths = sheetColumnContentWidths(
    ["has_fraktion", "snippet"],
    [["true", "Fraktionsdos: {{fraktionsdos}} mg"]],
    { headerPad: 48 },
  );
  // "has_fraktion" is 12 characters at 8px plus the 48px header pad.
  // The snippet cell is 33 characters at 8px plus the 28px cell pad.
  assertEquals(widths, [144, 292]);
});
