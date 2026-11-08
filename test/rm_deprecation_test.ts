/**
 * Deprecated RM mouths in Contribution Builder: strikethrough is driven by
 * the attribute's own spec sentence, not by a deprecated class or a
 * deprecated usage note.
 */
import { assert, assertEquals } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import {
  dvFieldInputName,
  dvOptionalFieldNames,
  optionalDvFieldInputName,
} from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { isSlotLabelField } from "@intehrgrator/blockly/slot_label.ts";
import { DEPRECATED_ATTR_CLASS, deprecatedRmField } from "@intehrgrator/core/rm_deprecation.ts";
import { markDeprecatedMutatorLabels } from "@intehrgrator/blockly/dynamic_mutator.ts";
import { renderSchemaTree } from "@intehrgrator/workbench/tree_views.ts";
import type { SchemaTreeNode } from "@intehrgrator/types/mod.ts";
import { dataValueLeafTypes, mandatoryAttributes } from "@intehrgrator/core/rm_meta.ts";

const HYPERLINK_SPEC =
  "https://specifications.openehr.org/releases/RM/development/data_types.html#_formatting_and_hyperlinking";

Deno.test("DV_TEXT.hyperlink is deprecated in the data types specification", () => {
  assertEquals(deprecatedRmField("DV_TEXT", "hyperlink")?.href, HYPERLINK_SPEC);
  assertEquals(deprecatedRmField("DV_CODED_TEXT", "hyperlink")?.href, HYPERLINK_SPEC);
  assertEquals(deprecatedRmField("DV_TEXT", "formatting"), null);
  assertEquals(deprecatedRmField("DV_TEXT", "value"), null);
  assertEquals(deprecatedRmField("DV_TEXT", "mappings"), null);
  assertEquals(deprecatedRmField("DV_PARAGRAPH", "items"), null);
  assertEquals(deprecatedRmField("DV_QUANTITY", "magnitude"), null);
  assertEquals(deprecatedRmField("", "hyperlink"), null);
});

Deno.test("hyperlink is the only deprecated mouth on data-value shells", () => {
  const marked: string[] = [];
  for (const rmType of dataValueLeafTypes()) {
    const names = new Set<string>([
      ...mandatoryAttributes(rmType).map((attr) => attr.name),
      ...dvOptionalFieldNames(rmType),
    ]);
    for (const name of names) {
      const href = deprecatedRmField(rmType, name)?.href;
      if (href) marked.push(`${rmType}.${name} ${href}`);
    }
  }
  assertEquals(marked.sort(), [
    `DV_CODED_TEXT.hyperlink ${HYPERLINK_SPEC}`,
    `DV_TEXT.hyperlink ${HYPERLINK_SPEC}`,
  ]);
});

function slotHref(block: Blockly.Block, inputName: string): string | null {
  const field = block.getInput(inputName)?.fieldRow.find((row) => isSlotLabelField(row));
  assert(field && isSlotLabelField(field), inputName);
  return field.deprecationHref();
}

Deno.test("text and coded text hyperlink mouths carry the spec link", () => {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  const text = workspace.newBlock("dv_text");
  const coded = workspace.newBlock("dv_coded_text");
  const paragraph = workspace.newBlock("dv_paragraph");
  for (const block of [text, coded]) {
    const live = block as Blockly.Block & {
      loadExtraState?: (state: { fields: string[] }) => void;
    };
    live.loadExtraState?.({ fields: ["hyperlink", "formatting", "mappings"] });
    assertEquals(slotHref(block, optionalDvFieldInputName("hyperlink")), HYPERLINK_SPEC);
    assertEquals(slotHref(block, optionalDvFieldInputName("formatting")), null);
    assertEquals(slotHref(block, optionalDvFieldInputName("mappings")), null);
    assertEquals(slotHref(block, dvFieldInputName("value")), null);
  }
  assertEquals(slotHref(paragraph, dvFieldInputName("items")), null);
  workspace.dispose();
});

Deno.test("source tree strikes every deprecated RM attribute, not only hyperlink by name", async () => {
  const { JSDOM } = await import("npm:jsdom@25");
  const dom = new JSDOM("<!doctype html><body></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
  const host = document.createElement("div");
  const node: SchemaTreeNode = {
    path: "$",
    name: "text",
    type: "DV_TEXT",
    children: [
      { path: "$.value", name: "value", type: "STRING", rmAttribute: "value", children: [] },
    ],
  };
  renderSchemaTree(host, node, () => {});
  const toggle = host.querySelector<HTMLButtonElement>(".tree-rm-toggle");
  assert(toggle, "DV_TEXT should offer optional RM");
  toggle.click();
  const named = (name: string) =>
    [...host.querySelectorAll<HTMLElement>(".tree-name")].find((el) => el.textContent === name);
  const hyperlink = named("hyperlink");
  const formatting = named("formatting");
  const value = named("value");
  assert(hyperlink, "hyperlink is an optional DV_TEXT attribute");
  assert(hyperlink.classList.contains(DEPRECATED_ATTR_CLASS));
  assertEquals(hyperlink.getAttribute("aria-label"), "hyperlink, deprecated");
  assertEquals(hyperlink.title, "Deprecated");
  assert(formatting && !formatting.classList.contains(DEPRECATED_ATTR_CLASS));
  assert(value && !value.classList.contains(DEPRECATED_ATTR_CLASS));
  } finally {
    if (previous) globalThis.document = previous;
    else delete (globalThis as { document?: Document }).document;
  }
});

Deno.test("cogwheel option labels reuse the deprecated attribute strike", () => {
  const classes = new Set<string>();
  const struck = { classList: { add: (name: string) => classes.add(name) } };
  let tip = "";
  markDeprecatedMutatorLabels({
    getAllBlocks: () => [
      {
        getFieldValue: (name: string) => name === "ATTR" ? "hyperlink" : "",
        getField: () => ({
          getTextElement: () => struck,
          setTooltip: (next: string) => {
            tip = next;
          },
        }),
      } as unknown as Blockly.Block,
    ],
  }, "DV_CODED_TEXT");
  assert(classes.has(DEPRECATED_ATTR_CLASS));
  assertEquals(tip, "Deprecated");

  const plainClasses = new Set<string>();
  const plain = { classList: { add: (name: string) => plainClasses.add(name) } };
  markDeprecatedMutatorLabels({
    getAllBlocks: () => [
      {
        getFieldValue: () => "formatting",
        getField: () => ({ getTextElement: () => plain, setTooltip: () => {} }),
      } as unknown as Blockly.Block,
    ],
  }, "DV_TEXT");
  assertEquals(plainClasses.has(DEPRECATED_ATTR_CLASS), false);
});
