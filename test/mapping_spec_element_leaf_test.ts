/**
 * #246 part 2a/2b: an openEHR ELEMENT and its single leaf data value share one
 * Mapping Spec row (canvas clicks on the DV block or the leaf still land on
 * it); a larger subtree keeps its own rows. ELEMENT rows are badged ELEMENT,
 * not "slot".
 */
import { assertEquals } from "@std/assert";
import { blocklyJsonDocument, projectBlocklyState } from "@intehrgrator/workbench/mapping_spec/mod.ts";
import { specBadgeLabel } from "@intehrgrator/workbench/mapping_spec/widgets.ts";

function element(id: string, value?: unknown) {
  return {
    type: "element",
    id,
    fields: { NAME: "Behandlingsavsikt", RM_TYPE: "ELEMENT", SLOT_ID: "med/items/at0148/value/DV_TEXT/value" },
    inputs: value ? { VALUE: { block: value } } : {},
  };
}

function state(...blocks: unknown[]) {
  return { blocks: { languageVersion: 0, blocks } };
}

const content = (lines: ReturnType<typeof projectBlocklyState>["lines"]) =>
  lines.filter((l) => l.kind !== "header");

Deno.test("ELEMENT with one leaf value projects as one row carrying the leaf", () => {
  const projection = projectBlocklyState(state(element("el", {
    type: "dv_text",
    id: "dv",
    fields: { RM_TYPE: "DV_TEXT" },
    inputs: {
      VALUE: { block: { type: "source_query", id: "sq", fields: { EXPRESSION: "$.intent", RETURN_TYPE: "string" } } },
    },
  })));
  const rows = content(projection.lines);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.blockId, "el");
  assertEquals(rows[0]!.inline?.blockId, "sq");
  assertEquals(rows[0]!.inline?.attribute, "value");
  assertEquals(rows[0]!.inline?.editable?.find((f) => f.field === "EXPRESSION")?.value, "$.intent");
  // Clicking the DV block or the source block on the canvas finds this row.
  assertEquals(rows[0]!.aliasIds?.includes("dv"), true);
  assertEquals(rows[0]!.aliasIds?.includes("sq"), true);
});

Deno.test("ELEMENT with an unmapped DV block still owns the DV id", () => {
  const rows = content(projectBlocklyState(state(element("el", {
    type: "dv_text",
    id: "dv",
    fields: { RM_TYPE: "DV_TEXT" },
  }))).lines);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.inline, undefined);
  assertEquals(rows[0]!.aliasIds?.includes("dv"), true);
});

Deno.test("ELEMENT with a list widget below keeps separate rows", () => {
  const rows = content(projectBlocklyState(state(element("el", {
    type: "dv_text",
    id: "dv",
    fields: { RM_TYPE: "DV_TEXT" },
    inputs: {
      VALUE: {
        block: {
          type: "lists_create_with",
          id: "list",
          inputs: {
            ADD0: { block: { type: "text", id: "t0", fields: { TEXT: "a" } } },
            ADD1: { block: { type: "text", id: "t1", fields: { TEXT: "b" } } },
          },
        },
      },
    },
  }))).lines);
  assertEquals(rows.length > 1, true);
  assertEquals(rows[0]!.blockId, "el");
  assertEquals(rows[0]!.inline, undefined);
});

Deno.test("merged ELEMENT row text includes the leaf so find can reach it", () => {
  const doc = blocklyJsonDocument(state(element("el", {
    type: "dv_text",
    id: "dv",
    fields: { RM_TYPE: "DV_TEXT" },
    inputs: {
      VALUE: { block: { type: "source_query", id: "sq", fields: { EXPRESSION: "$.intent", RETURN_TYPE: "string" } } },
    },
  })));
  const row = doc.text.split("\n").find((line) => line.includes("· ELEMENT ·"))!;
  assertEquals(row.includes("$.intent"), true);
});

Deno.test("ELEMENT rows are badged ELEMENT, not slot", () => {
  const rows = content(projectBlocklyState(state(element("el"))).lines);
  assertEquals(specBadgeLabel(rows[0]!), "ELEMENT");
});
