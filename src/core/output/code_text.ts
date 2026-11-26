/**
 * Nested Code text (`text_code`) in a value slot (#363 follow-up, lung-MDT).
 *
 * A Code text block whose LANG is Handlebars is a nested VMS-Hbs template:
 * Mapping preview and Handlebars Output mode render it against the source
 * instance (`canvas_xml_runtime.ts`). Every other Conversion script language
 * must do the same, so the Mapping Expression for such a block is
 * `handlebars("<template>", xpathNode("$"))`, which each language already
 * implements with the shared Kintegrate helper set. Other LANG values stay
 * literal text.
 */

/** LANG values that mean a nested Handlebars template. */
export function isHandlebarsCodeLang(lang: unknown): boolean {
  const value = String(lang ?? "").trim().toLowerCase();
  return value === "handlebars" || value === "hbs";
}

/** Mapping Expression rendering a nested Handlebars Code text against the source root. */
export function nestedHandlebarsExpression(template: string): string {
  return `handlebars(${JSON.stringify(template)}, xpathNode("$"))`;
}

/**
 * Mapping Expression for a `text_code` block: a Handlebars LANG renders,
 * anything else is a string literal.
 */
export function codeTextExpression(text: unknown, lang: unknown): string {
  const template = String(text ?? "");
  // Text without a mustache renders to itself: keep it a plain literal.
  return isHandlebarsCodeLang(lang) && template.includes("{{")
    ? nestedHandlebarsExpression(template)
    : JSON.stringify(template);
}
