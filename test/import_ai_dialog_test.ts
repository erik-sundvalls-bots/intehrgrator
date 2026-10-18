import { assertEquals } from "@std/assert";
import { formatImportReport } from "@intehrgrator/ui/import_ai.ts";
import { locateIssueInText } from "@intehrgrator/core/ai/json_locate.ts";

Deno.test("formatImportReport marks clean apply as ok", () => {
  const { kind, summary } = formatImportReport({
    applied: 2,
    skipped: 0,
    errors: [],
    loopsAccepted: 1,
    schemaIssues: [],
  });
  assertEquals(kind, "ok");
  assertEquals(summary.includes("Imported: 2 mappings applied · 1 loop added"), true);
});

Deno.test("formatImportReport marks parse failure as error", () => {
  const { kind, summary } = formatImportReport({
    applied: 0,
    skipped: 0,
    errors: ["Invalid format field"],
    loopsAccepted: 0,
    schemaIssues: [],
  });
  assertEquals(kind, "error");
  assertEquals(summary, "Nothing imported: 0 mappings applied · 0 loops added · 0 skipped · 1 error · 0 schema issues");
});

Deno.test("formatImportReport is partial when mappings applied with schema issues", () => {
  const { kind, summary } = formatImportReport({
    applied: 1,
    skipped: 0,
    errors: [],
    loopsAccepted: 0,
    schemaIssues: [{ path: "$.format", message: "missing" }],
  });
  assertEquals(kind, "partial");
  assertEquals(summary.includes("1 schema issue"), true);
  assertEquals(summary.includes("valid entries only"), true);
});

Deno.test("locateIssueInText highlights an invalid block type", () => {
  const src = `{
  "block": { "type": "source_query_string", "fields": { "EXPRESSION": "$.a" } }
}`;
  const span = locateIssueInText(src, "$.block.type", 'Invalid type "source_query_string"');
  assertEquals(Boolean(span), true);
  assertEquals(src.slice(span!.start, span!.end), '"source_query_string"');
});
