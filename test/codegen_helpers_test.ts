import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { createEmptyModel, applyExpressionEdit } from "@intehrgrator/core/mapping_model/mod.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import {
  igDecisionTable,
  igSheetLookup,
  jsonQuery,
  listGetIndex,
  partyValue,
  __blankValue,
  __toBool,
} from "@intehrgrator/core/codegen/helpers/typescript.ts";
import { importLinkSpans, resolveImportHref } from "@intehrgrator/core/codegen/import_links.ts";
import { xquerySourceModule, xqueryRmModule } from "@intehrgrator/core/codegen/xquery_modules.ts";
import { xquerySheetsModule } from "@intehrgrator/core/codegen/xquery_sheets.ts";
import { TYPESCRIPT_HELPERS_SPECIFIER } from "@intehrgrator/core/codegen/helpers/locations.ts";

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

Deno.test("typescript helpers look up a sheet row and a decision table", () => {
  const sheets = {
    terms: {
      headers: ["code", "snomed"],
      values: [["I10", "38341003"]],
    },
    findings: {
      headers: ["finding", "term_id"],
      values: [["effusion", "123"]],
      hitPolicy: "FIRST",
      decisionColumns: [
        { role: "condition" },
        { role: "output", outputKind: "value", valueType: "string" },
      ],
    },
  };
  assertEquals(igSheetLookup(sheets, "terms", "code", "I10", "snomed"), "38341003");
  assertEquals(
    igDecisionTable(sheets, "findings", { finding: "effusion" }, "term_id"),
    "123",
  );
  assertThrows(
    () =>
      igDecisionTable(
        {
          only: {
            headers: ["a", "b"],
            values: [["x", "1"], ["x", "2"]],
            hitPolicy: "UNIQUE",
            decisionColumns: [{ role: "condition" }, { role: "output" }],
          },
        },
        "only",
        { a: "x" },
        "b",
      ),
    Error,
    "UNIQUE",
  );
});

Deno.test("typescript helpers keep json paths, list index, party, and blank values", () => {
  assertEquals(jsonQuery("$.vitals.systolic"), "$source?vitals?systolic");
  assertEquals(listGetIndex(["a", "b", "c"], "LAST"), "c");
  assertEquals(partyValue("Ada", "PARTY_SELF"), { _type: "PARTY_IDENTIFIED", name: "Ada" });
  assertEquals(partyValue("PARTY_SELF", "PARTY_SELF"), { _type: "PARTY_SELF" });
  assertEquals(__blankValue("  "), true);
  assertEquals(__toBool("false"), false);
});

Deno.test("generated TypeScript imports only the helpers that mapping calls", () => {
  const withSheet = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const sheetScript = generate(withSheet, "typescript");
  assertStringIncludes(sheetScript, TYPESCRIPT_HELPERS_SPECIFIER);
  assertStringIncludes(sheetScript, "igSheetLookup");
  assertEquals(sheetScript.includes("igDecisionTable"), false);
  assertEquals(sheetScript.includes("rowCatchAll"), false);

  const plain = applyExpressionEdit(createEmptyModel("vitals"), "s1", 'xpathNumber("/a")', {
    rmType: "DV_QUANTITY",
    returnType: "number",
  });
  const xpathScript = generate(plain, "typescript");
  assertStringIncludes(xpathScript, "igXpathNumber");
  assertEquals(xpathScript.includes("igSheetLookup"), false);
  assertEquals(xpathScript.includes("function xpathNumber(path: unknown"), true);
});

Deno.test("generated XQuery imports helper modules instead of pasting them", async () => {
  const model = applyExpressionEdit(
    createEmptyModel("terms"),
    "s1",
    'sheet_lookup("icd10_snomed", "code", "I10", "snomed")',
    { rmType: "DV_TEXT", returnType: "string" },
  );
  const xq = generate(model, "xquery");
  assertStringIncludes(xq, 'import module namespace igsh =');
  assertEquals(xq.includes("declare function igsh:sheet-lookup"), false);
  const root = new URL("../src/core/codegen/helpers/xquery/", import.meta.url);
  assertEquals(normalizeLf(await Deno.readTextFile(new URL("source.xqm", root))), xquerySourceModule());
  assertEquals(normalizeLf(await Deno.readTextFile(new URL("rm.xqm", root))), xqueryRmModule());
  assertEquals(normalizeLf(await Deno.readTextFile(new URL("sheets.xqm", root))), xquerySheetsModule());
});

Deno.test("import specifiers resolve to GitHub source pages", () => {
  assertEquals(
    resolveImportHref(
      "https://raw.githubusercontent.com/regionstockholm/intehrgrator/main/src/core/codegen/helpers/typescript.ts",
    ),
    "https://github.com/regionstockholm/intehrgrator/blob/main/src/core/codegen/helpers/typescript.ts",
  );
  assertEquals(
    resolveImportHref("ehrtslib/openehr_rm.ts"),
    "https://github.com/ErikSundvall/ehrtslib/blob/v0.11/openehr_rm.ts",
  );
  assertEquals(resolveImportHref("fontoxpath"), "https://github.com/FontoXML/fontoxpath");
  assertStringIncludes(
    resolveImportHref("se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime") ?? "",
    "IntehrgratorRuntime.java",
  );
  const src = 'import { COMPOSITION } from "ehrtslib/openehr_rm.ts";\n';
  const spans = importLinkSpans(src);
  assertEquals(spans.length, 1);
  assertEquals(spans[0]?.href, "https://github.com/ErikSundvall/ehrtslib/blob/v0.11/openehr_rm.ts");
});
