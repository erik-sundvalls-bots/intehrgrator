/**
 * #388: the Java Conversion Script renders Handlebars Notes with Handlebars.java,
 * whose standalone-line rules differ from Handlebars.js. Java therefore gets the
 * template with Handlebars.js whitespace control already applied; rendering that
 * text without standalone handling must equal rendering the original.
 */
import { assertEquals } from "@std/assert";
import Handlebars from "handlebars";
import { resolveHandlebarsWhitespace } from "@intehrgrator/core/output/handlebars_whitespace.ts";
import { registerKintegrateHandlebarsHelpers } from "@intehrgrator/core/codegen/helpers/handlebars.ts";

function render(
  template: string,
  data: unknown,
  ignoreStandalone = false,
): string {
  const engine = Handlebars.create();
  registerKintegrateHandlebarsHelpers(engine);
  return engine.compile(template, { noEscape: true, ignoreStandalone })(data);
}

const CASES: Array<[string, unknown]> = [
  [
    "\n{{~#each a}}\n\n{{~#if (eq x 1)}}\n  <!-- one -->\n{{/if}}\n{{/each}}\n",
    { a: [{ x: 1 }, { x: 2 }] },
  ],
  ["{{#if a}}A{{else}}{{#if b}}\n  B\n{{/if}}{{/if}}\n", { b: true }],
  [
    "  {{#each list}}\n  - {{this}} {{@index}}\n  {{/each}}\nend {{! note }}\n",
    { list: ["p", "q"] },
  ],
  ["{{#with o}}\n{{o2.[|value]}} {{[0]}} {{../top}}\n{{/with}}", {
    o: { o2: { "|value": "v" }, 0: "z" },
    top: "t",
  }],
  ["{{^missing}}\nnone\n{{/missing}}\n{{{raw}}} \\{{literal}}", { raw: "<b>" }],
  ["{{#if a}}\n  x\n{{else if b}}\n  y\n{{else}}\n  z\n{{/if}}", { b: 1 }],
];

Deno.test("#388 resolveHandlebarsWhitespace keeps Handlebars.js output", () => {
  for (const [template, data] of CASES) {
    assertEquals(
      render(resolveHandlebarsWhitespace(template), data, true),
      render(template, data),
      template,
    );
  }
});

Deno.test("#388 resolveHandlebarsWhitespace on the lung MDT Notes", async () => {
  const state = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "./fixtures/lung-MDT-form/mapping/mapping.blockly.json",
        import.meta.url,
      ),
    ),
  );
  const templates: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const block = node as { type?: string; fields?: { TEXT?: unknown } };
    if (
      block.type === "text_code" &&
      String(block.fields?.TEXT ?? "").includes("{{")
    ) {
      templates.push(String(block.fields!.TEXT));
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(state);
  assertEquals(templates.length > 5, true);
  const dir = new URL(
    "./fixtures/lung-MDT-form/source-instance/",
    import.meta.url,
  );
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.name.endsWith(".json")) continue;
    const source = JSON.parse(
      await Deno.readTextFile(new URL(entry.name, dir)),
    );
    for (const template of templates) {
      assertEquals(
        render(resolveHandlebarsWhitespace(template), source, true),
        render(template, source),
      );
    }
  }
});
