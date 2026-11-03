import { dirname, fromFileUrl, join } from "@std/path";
import { assertEquals } from "@std/assert";
import { loadJsonSchema } from "@intehrgrator/core/source/schema_loader.ts";
import { detectSourceFormat, getSourceFormatHandler } from "@intehrgrator/core/source/format_handler.ts";
import { validateInstanceAgainstSchema } from "@intehrgrator/core/source/instance_validation.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const catalogPath = join(root, "examples", "example-sets.json");

const NAME_BROKEN = /invalid|broken|fail|bad/i;

function stripPreamble(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const obj = text.indexOf("\n{");
  const arr = text.indexOf("\n[");
  const idx = [obj, arr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (idx == null) return text;
  return text.slice(idx + 1).trim();
}

Deno.test("catalog Example Instances validate against their Source Schema (except named-broken)", async () => {
  const raw = JSON.parse(await Deno.readTextFile(catalogPath)) as {
    sets: Array<{
      id: string;
      source?: { schema?: string; instances?: string[] };
    }>;
  };
  const failures: string[] = [];
  for (const set of raw.sets) {
    const schemaRel = set.source?.schema;
    if (!schemaRel) continue;
    const schemaPath = join(dirname(catalogPath), schemaRel);
    const schemaText = await Deno.readTextFile(schemaPath);
    const schemaFormat = detectSourceFormat(schemaPath, schemaText);
    if (
      schemaFormat === "openehr-operational-template" ||
      schemaFormat === "openehr-web-template"
    ) {
      // These are openEHR templates, not JSON Schema. FLAT keys do not line up
      // with the Web Template tree, so the JSON Schema walker does not apply.
      try {
        getSourceFormatHandler(schemaFormat).loadSchema(schemaText);
      } catch (err) {
        failures.push(
          `${set.id} schema: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      for (const instRel of set.source?.instances ?? []) {
        const name = instRel.split("/").pop() ?? instRel;
        if (NAME_BROKEN.test(name)) continue;
        const instPath = join(dirname(catalogPath), instRel);
        const content = await Deno.readTextFile(instPath);
        const format = detectSourceFormat(instPath, content);
        if (
          format !== "openehr-flat-json" &&
          format !== "openehr-structured-json" &&
          format !== "openehr-canonical-json" &&
          format !== "openehr-composition"
        ) {
          failures.push(
            `${set.id} ${name}: expected an openEHR composition instance, got ${format}`,
          );
        }
      }
      continue;
    }
    const schema = loadJsonSchema(schemaText, "root");
    for (const instRel of set.source?.instances ?? []) {
      const name = instRel.split("/").pop() ?? instRel;
      if (NAME_BROKEN.test(name)) continue;
      const instPath = join(dirname(catalogPath), instRel);
      const content = await Deno.readTextFile(instPath);
      const format = detectSourceFormat(instPath, content);
      const payload = format === "json" ? stripPreamble(content) : content;
      const issues = validateInstanceAgainstSchema(payload, format, schema, schemaText);
      if (issues.length) {
        failures.push(
          `${set.id} ${name}: ${issues.slice(0, 4).map((i) => `${i.path} ${i.message}`).join("; ")}`,
        );
      }
    }
  }
  assertEquals(failures, [], failures.join("\n"));
});
