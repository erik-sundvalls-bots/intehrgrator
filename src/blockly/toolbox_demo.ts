/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted from Blockly DevSite landing demo toolbox:
 * https://github.com/RaspberryPiFoundation/blockly-samples/blob/main/examples/devsite-landing-demo/toolbox.js
 *
 * intEHRgrator additions: Source + openEHR types (COMPOSITION / DATA_VALUE) categories,
 * `for_each_list` in Loops & Logic (stock while/for/forEach and `for_each_source` removed).
 */

import type { BlocklyOptions } from "blockly/core";
import { dataValueLeafTypes, blockTypeForRm } from "../core/rm_meta.ts";
import type { SkeletonNode, TargetFormatId } from "../types/mod.ts";
import { msg } from "./i18n/custom_msg.ts";
import { sheetsChrome } from "../ui/sheets_i18n.ts";
import { ADD_DECISION_TABLE_CALLBACK, ADD_SHEET_CALLBACK } from "./grid_flyout.ts";
import { uniqueSchemaContainerNodes } from "./schema_blocks.ts";
import {
  isSchemaStructureBlockType,
  schemaInputSpecs,
  schemaConnectionMode,
} from "../core/target/schema_block_ids.ts";

export type ToolboxJson = NonNullable<BlocklyOptions["toolbox"]>;

export interface ToolboxContext {
  targetFormat?: TargetFormatId;
  skeleton?: SkeletonNode[];
}

function dataValueToolboxContents(): Array<{ kind: string; type: string }> {
  return dataValueLeafTypes().map((rmType) => ({
    kind: "block",
    type: blockTypeForRm(rmType),
  }));
}

function termPickShadow(setId: string, code?: string) {
  const fields: Record<string, string> = { SET: setId };
  if (code) fields.CODE = code;
  return { shadow: { type: "term_pick", fields } };
}

function mapsCreateWithToolboxBlock(itemCount: number): Record<string, unknown> {
  const fields: Record<string, string> = {};
  const inputs: Record<string, unknown> = {};
  for (let i = 0; i < itemCount; i++) {
    fields[`KEY${i}`] = "";
    inputs[`VAL${i}`] = { shadow: { type: "text", fields: { TEXT: "" } } };
  }
  return {
    kind: "block",
    type: "maps_create_with",
    extraState: { itemCount },
    fields,
    inputs,
  };
}

function conversionStartToolboxBlock(): Record<string, unknown> {
  return { kind: "block", type: "conversion_start", gap: 8 };
}

function compositionToolboxBlock(): Record<string, unknown> {
  return {
    kind: "block",
    type: "composition",
    gap: 8,
    inputs: {
      ATTR_language: termPickShadow("ISO_639-1"),
      ATTR_territory: termPickShadow("ISO_3166-1"),
      ATTR_category: termPickShadow("openehr:composition_category", "433"),
      ATTR_composer: { block: { type: "party_identified" } },
    },
  };
}

function openEhrTypeToolboxContents(m: ReturnType<typeof msg>): Array<Record<string, unknown>> {
  return [
    conversionStartToolboxBlock(),
    { kind: "label", text: m.CAT_OPENEHR_ENTRIES },
    compositionToolboxBlock(),
    { kind: "block", type: "section", gap: 8 },
    { kind: "block", type: "observation", gap: 8 },
    { kind: "block", type: "evaluation", gap: 8 },
    { kind: "block", type: "instruction", gap: 8 },
    { kind: "block", type: "action", gap: 8 },
    { kind: "block", type: "admin_entry", gap: 8 },
    { kind: "block", type: "generic_entry", gap: 8 },
    { kind: "block", type: "history", gap: 8 },
    { kind: "block", type: "event_context", gap: 8 },
    { kind: "block", type: "activity", gap: 8 },
    { kind: "block", type: "participation", gap: 8 },
    { kind: "block", type: "feeder_audit", gap: 8 },
    { kind: "block", type: "feeder_audit_details", gap: 8 },
    { kind: "block", type: "link", gap: 8 },
    { kind: "block", type: "ism_transition", gap: 8 },
    { kind: "block", type: "archetyped", gap: 16 },

    { kind: "label", text: m.CAT_OPENEHR_ITEMS },
    { kind: "block", type: "cluster", gap: 8 },
    { kind: "block", type: "element", gap: 8 },
    { kind: "block", type: "event", gap: 8 },
    { kind: "block", type: "point_event", gap: 8 },
    { kind: "block", type: "interval_event", gap: 8 },
    { kind: "block", type: "item_structure", gap: 8 },
    { kind: "block", type: "item_tree", gap: 8 },
    { kind: "block", type: "item_list", gap: 8 },
    { kind: "block", type: "item_table", gap: 8 },
    { kind: "block", type: "item_single", gap: 16 },

    { kind: "label", text: m.CAT_OPENEHR_PARTY },
    { kind: "block", type: "party_proxy", gap: 8 },
    { kind: "block", type: "party_self", gap: 8 },
    { kind: "block", type: "party_identified", gap: 8 },
    { kind: "block", type: "party_related", gap: 8 },
    { kind: "block", type: "party_ref", gap: 8 },
    { kind: "block", type: "dv_identifier", gap: 16 },

    { kind: "label", text: m.CAT_OPENEHR_DV },
    ...dataValueToolboxContents(),

    { kind: "label", text: m.CAT_OPENEHR_TERMS },
    { kind: "block", type: "term_pick", gap: 8 },
    { kind: "block", type: "code_phrase", gap: 8 },
  ];
}

function schemaToolboxBlock(node: SkeletonNode, isRoot: boolean): Record<string, unknown> {
  const fields = schemaInputSpecs(node, { mandatoryOnly: true });
  return {
    kind: "block",
    type: isSchemaStructureBlockType(node.blockType) ? node.blockType : "target_structure",
    gap: 4,
    extraState: {
      connection: schemaConnectionMode(node, isRoot),
      typeCheck: node.blockType,
      fields,
    },
    fields: {
      NAME: node.label,
      TARGET_TYPE: node.rmType,
      SLOT_ID: node.slotId,
    },
  };
}

/**
 * One flyout level per loaded schema: unique complex types, no nested tree.
 * Multiple skeleton roots (rare) each get a single named category.
 */
function schemaToolboxContents(skeleton: SkeletonNode[]): Array<Record<string, unknown>> {
  const rootSlotIds = new Set(skeleton.map((node) => node.slotId));
  if (skeleton.length <= 1) {
    return uniqueSchemaContainerNodes(skeleton).map((node) =>
      schemaToolboxBlock(node, rootSlotIds.has(node.slotId))
    );
  }
  return skeleton.map((root) => ({
    kind: "category",
    name: root.label || root.rmAttribute || root.blockType,
    colour: 0,
    contents: uniqueSchemaContainerNodes([root]).map((node) =>
      schemaToolboxBlock(node, node.slotId === root.slotId)
    ),
  }));
}

/** Build the workspace toolbox (Blockly demo + Source / openEHR types / JSON / XML). */
export function buildDemoToolbox(locale: string, context: ToolboxContext = {}): ToolboxJson {
  const m = msg(locale);
  const extraTargetCategories: Array<Record<string, unknown>> = [
    {
      kind: "category",
      name: m.CAT_JSON,
      colour: 40,
      cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryJson" },
      contents: [
        conversionStartToolboxBlock(),
        { kind: "block", type: "json_object", gap: 8 },
        { kind: "block", type: "json_array", gap: 8 },
        { kind: "block", type: "json_value", gap: 8 },
        { kind: "block", type: "json_boolean", gap: 8 },
        { kind: "block", type: "json_null", gap: 8 },
      ],
    },
    {
      kind: "category",
      name: m.CAT_XML,
      colour: 200,
      cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryXml" },
      contents: [
        conversionStartToolboxBlock(),
        { kind: "block", type: "xml_document", gap: 8 },
        {
          kind: "block",
          type: "xml_element",
          gap: 8,
          fields: { NAME: "element" },
          inputs: {
            VALUE: { shadow: { type: "text", fields: { TEXT: "" } } },
          },
        },
        { kind: "block", type: "xml_text", gap: 8 },
        { kind: "block", type: "xml_cdata", gap: 8 },
        {
          kind: "block",
          type: "xml_attribute",
          gap: 8,
          fields: { NAME: "attr" },
          inputs: {
            VALUE: { shadow: { type: "text", fields: { TEXT: "" } } },
          },
        },
      ],
    },
  ];
  if (
    (context.targetFormat === "json-schema" || context.targetFormat === "xml-schema") &&
    context.skeleton?.length
  ) {
    extraTargetCategories.push({
      kind: "category",
      name: m.CAT_TARGET_SCHEMA,
      colour: 0,
      cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryTargetSchema" },
      contents: schemaToolboxContents(context.skeleton),
    });
  }
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: m.CAT_SOURCE,
        colour: 28,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategorySource" },
        contents: [
          { kind: "block", type: "source_query", gap: 8 },
          { kind: "block", type: "source_query_number", gap: 8 },
          { kind: "block", type: "source_query_boolean", gap: 8 },
          { kind: "block", type: "source_query_node", gap: 8 },
        ],
      },
      {
        kind: "category",
        name: m.CAT_OPENEHR_TYPES,
        colour: 230,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryOpenEhrTypes" },
        contents: openEhrTypeToolboxContents(m),
      },
      ...extraTargetCategories,
      {
        kind: "category",
        name: m.CAT_LOGIC,
        colour: 262,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryLogic" },
        contents: [
          {
            kind: "block",
            type: "for_each_list",
            inputs: {
              LIST: { shadow: { type: "lists_create_with", extraState: { itemCount: 0 } } },
            },
          },
          { kind: "block", type: "logic_current_item" },
          { kind: "block", type: "logic_loop_index" },
          { kind: "block", type: "logic_loop_length" },
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
          { kind: "block", type: "logic_ternary" },
          {
            kind: "block",
            type: "logic_list_restriction",
            extraState: { guard: true },
            fields: { OP: "ALL" },
          },
          { kind: "block", type: "logic_list_restriction", fields: { OP: "ANY" } },
          {
            kind: "block",
            type: "logic_list_restriction",
            extraState: { guard: true },
            fields: { OP: "NONE" },
          },
          {
            kind: "block",
            type: "logic_list_restriction",
            extraState: { count: true },
            fields: { OP: "AT_LEAST", N: 1 },
          },
        ],
      },
      {
        kind: "category",
        name: m.CAT_MATH,
        colour: 206,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryMath" },
        contents: [
          { kind: "block", type: "math_number", fields: { NUM: 123 } },
          {
            kind: "block",
            type: "math_arithmetic",
            inputs: {
              A: { shadow: { type: "math_number", fields: { NUM: 1 } } },
              B: { shadow: { type: "math_number", fields: { NUM: 1 } } },
            },
          },
          {
            kind: "block",
            type: "math_single",
            inputs: {
              NUM: { shadow: { type: "math_number", fields: { NUM: 9 } } },
            },
          },
          {
            kind: "block",
            type: "math_number_property",
            inputs: {
              NUMBER_TO_CHECK: { shadow: { type: "math_number", fields: { NUM: 0 } } },
            },
          },
          {
            kind: "block",
            type: "math_round",
            inputs: {
              NUM: { shadow: { type: "math_number", fields: { NUM: 3.1 } } },
            },
          },
          { kind: "block", type: "math_on_list" },
          {
            kind: "block",
            type: "math_modulo",
            inputs: {
              DIVIDEND: { shadow: { type: "math_number", fields: { NUM: 64 } } },
              DIVISOR: { shadow: { type: "math_number", fields: { NUM: 10 } } },
            },
          },
          {
            kind: "block",
            type: "math_constrain",
            inputs: {
              VALUE: { shadow: { type: "math_number", fields: { NUM: 50 } } },
              LOW: { shadow: { type: "math_number", fields: { NUM: 1 } } },
              HIGH: { shadow: { type: "math_number", fields: { NUM: 100 } } },
            },
          },
        ],
      },
      {
        kind: "category",
        name: m.CAT_TEXT,
        colour: 46,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryText" },
        contents: [
          conversionStartToolboxBlock(),
          { kind: "block", type: "text_document" },
          { kind: "block", type: "text" },
          {
            kind: "block",
            type: "text_code",
            fields: { LANG: "handlebars", TEXT: "" },
          },
          {
            kind: "block",
            type: "text_code",
            fields: { LANG: "go-template", TEXT: "{{ index .Data \"path\" }}" },
          },
          {
            kind: "block",
            type: "text_handlebars",
            inputs: {
              SCRIPT: {
                shadow: {
                  type: "text_code",
                  fields: { LANG: "handlebars", TEXT: "{{name}}" },
                },
              },
            },
          },
          { kind: "block", type: "text_join", extraState: { itemCount: 2 } },
          {
            kind: "block",
            type: "text_append",
            inputs: { TEXT: { shadow: { type: "text" } } },
          },
          {
            kind: "block",
            type: "text_length",
            inputs: {
              VALUE: {
                shadow: { type: "text", fields: { TEXT: "abc" } },
              },
            },
          },
          {
            kind: "block",
            type: "text_isEmpty",
            inputs: { VALUE: { shadow: { type: "text" } } },
          },
          {
            kind: "block",
            type: "text_indexOf",
            inputs: {
              VALUE: { shadow: { type: "text", fields: { TEXT: "abc" } } },
              FIND: { shadow: { type: "text", fields: { TEXT: "b" } } },
            },
          },
          {
            kind: "block",
            type: "text_charAt",
            inputs: {
              VALUE: { shadow: { type: "text", fields: { TEXT: "abc" } } },
            },
          },
          {
            kind: "block",
            type: "text_getSubstring",
            inputs: {
              STRING: { shadow: { type: "text", fields: { TEXT: "abc" } } },
            },
          },
          {
            kind: "block",
            type: "text_changeCase",
            inputs: {
              TEXT: { shadow: { type: "text", fields: { TEXT: "abc" } } },
            },
          },
          {
            kind: "block",
            type: "text_trim",
            inputs: {
              TEXT: { shadow: { type: "text", fields: { TEXT: " abc " } } },
            },
          },
        ],
      },
      {
        kind: "category",
        name: m.CAT_LISTS_AND_MAPS,
        colour: 172,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryListsMaps" },
        contents: [
          { kind: "block", type: "lists_create_with", extraState: { itemCount: 0 } },
          { kind: "block", type: "lists_create_with", extraState: { itemCount: 3 } },
          { kind: "block", type: "lists_length" },
          { kind: "block", type: "lists_isEmpty" },
          { kind: "block", type: "lists_indexOf" },
          { kind: "block", type: "lists_getIndex" },
          { kind: "block", type: "lists_getSublist" },
          {
            kind: "block",
            type: "lists_split",
            inputs: {
              DELIM: { shadow: { type: "text", fields: { TEXT: "," } } },
            },
          },
          { kind: "block", type: "lists_sort" },
          { kind: "block", type: "lists_reverse" },
          { kind: "block", type: "lists_set_operation", fields: { OP: "BOTH" } },
          { kind: "block", type: "lists_set_operation", fields: { OP: "NOT_IN" } },
          { kind: "block", type: "maps_create_with", extraState: { itemCount: 0 } },
          mapsCreateWithToolboxBlock(3),
          { kind: "block", type: "maps_create_empty" },
          {
            kind: "block",
            type: "maps_get",
            fields: { NAME: "defaults" },
            inputs: {
              KEY: { shadow: { type: "text", fields: { TEXT: "language" } } },
            },
          },
          { kind: "block", type: "maps_keys" },
          { kind: "block", type: "maps_length" },
          { kind: "block", type: "maps_isEmpty" },
        ],
      },
      { kind: "sep" },
      {
        kind: "category",
        name: m.CAT_DECISION_TABLES,
        colour: 160,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryDecisionTables" },
        contents: [
          { kind: "button", text: sheetsChrome(locale).addDecision, callbackKey: ADD_DECISION_TABLE_CALLBACK },
          {
            kind: "block",
            type: "decision_table",
            fields: { OUTPUT: "out" },
            inputs: {
              INPUTS: {
                block: {
                  type: "maps_create_with",
                  extraState: { itemCount: 2 },
                  fields: { KEY0: "in1", KEY1: "in2" },
                  inputs: {
                    VAL0: { shadow: { type: "text", fields: { TEXT: "" } } },
                    VAL1: { shadow: { type: "text", fields: { TEXT: "" } } },
                  },
                },
              },
            },
          },
        ],
      },
      {
        kind: "category",
        name: m.CAT_SHEETS,
        colour: 165,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategorySheets" },
        contents: [
          { kind: "button", text: sheetsChrome(locale).add, callbackKey: ADD_SHEET_CALLBACK },
          {
            kind: "block",
            type: "sheet_lookup",
            inputs: {
              MATCH_COL: { shadow: { type: "text", fields: { TEXT: "code" } } },
              MATCH_VAL: { shadow: { type: "text", fields: { TEXT: "" } } },
              RETURN_COL: { shadow: { type: "text", fields: { TEXT: "snomed" } } },
            },
          },
          {
            kind: "block",
            type: "sheet_get_cell",
            inputs: {
              A1: { shadow: { type: "text", fields: { TEXT: "A1" } } },
            },
          },
          {
            kind: "block",
            type: "sheet_get_xy",
            inputs: {
              X: { shadow: { type: "math_number", fields: { NUM: 0 } } },
              Y: { shadow: { type: "math_number", fields: { NUM: 0 } } },
            },
          },
          {
            kind: "block",
            type: "sheet_get_row",
            inputs: { Y: { shadow: { type: "math_number", fields: { NUM: 0 } } } },
          },
          {
            kind: "block",
            type: "sheet_get_column",
            inputs: { X: { shadow: { type: "math_number", fields: { NUM: 0 } } } },
          },
          {
            kind: "block",
            type: "sheet_get_header",
            inputs: { X: { shadow: { type: "math_number", fields: { NUM: 0 } } } },
          },
          { kind: "block", type: "sheet_get_data" },
        ],
      },
      {
        kind: "category",
        custom: "VARIABLE",
        name: m.CAT_VARIABLES,
        colour: 4,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryVariables" },
      },
      {
        kind: "category",
        custom: "PROCEDURE",
        name: m.CAT_PROCEDURES,
        colour: 16,
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategoryProcedures" },
      },
      { kind: "sep" },
      {
        kind: "search",
        name: m.CAT_SEARCH,
        contents: [],
        cssconfig: { row: "blocklyToolboxCategory blocklyToolboxCategorySearch" },
      },
    ],
  };
}

/** Flatten `kind: "block"` types so toolbox-search can index custom drawers. */
export function toolboxBlockTypes(toolbox: ToolboxJson): string[] {
  const types: string[] = [];
  const walk = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const rec = item as { kind?: string; type?: string; contents?: unknown[] };
    if (String(rec.kind ?? "").toLowerCase() === "block" && rec.type) {
      types.push(rec.type);
    }
    if (Array.isArray(rec.contents)) {
      for (const child of rec.contents) walk(child);
    }
  };
  walk(toolbox);
  return types;
}
