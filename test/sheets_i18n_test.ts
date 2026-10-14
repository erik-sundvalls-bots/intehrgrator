import { assertEquals } from "@std/assert";
import { jspreadsheetDictionary, sheetsChrome } from "@intehrgrator/ui/sheets_i18n.ts";

Deno.test("jspreadsheet dictionary covers app locales with Search/Cut/Copy/Paste", () => {
  for (const loc of ["sv", "de", "es", "ca", "fr"] as const) {
    const d = jspreadsheetDictionary(loc);
    assertEquals(typeof d.Search, "string");
    assertEquals(typeof d.Cut, "string");
    assertEquals(typeof d.Copy, "string");
    assertEquals(typeof d.Paste, "string");
    assertEquals(d.Search.length > 0, true);
  }
  assertEquals(jspreadsheetDictionary("en"), {});
});

Deno.test("sheets chrome includes Add default row and COLLECT dedupe labels", () => {
  for (const loc of ["en", "sv", "de", "es", "ca", "fr"] as const) {
    const t = sheetsChrome(loc);
    assertEquals(t.addDefaultRow.length > 0, true);
    assertEquals(t.collectDedupe.length > 0, true);
  }
  assertEquals(sheetsChrome("en").addDefaultRow, "Add default row");
  assertEquals(sheetsChrome("en").addInput, "Add input/condition");
  assertEquals(sheetsChrome("en").kindStringPattern, "string pattern");
  assertEquals(sheetsChrome("en").deleteColumn, "Delete {name}");
  assertEquals(sheetsChrome("en").tab, "Tables & Sheets");
  assertEquals(sheetsChrome("sv").tab, "Tabeller & kalkylblad");
  assertEquals(sheetsChrome("de").tab, "Tabellen & Blätter");
  assertEquals(sheetsChrome("es").tab, "Tablas y hojas");
  assertEquals(sheetsChrome("ca").tab, "Taules i fulls");
  assertEquals(sheetsChrome("fr").tab, "Tableaux et feuilles");
});
