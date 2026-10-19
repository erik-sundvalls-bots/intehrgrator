import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  blocklyJsonDocument,
  projectBlocklyState,
  slotAttributeFromInputName,
  type SpecProjection,
} from "@intehrgrator/workbench/mapping_spec/mod.ts";

function contentSpecLines(projection: SpecProjection) {
  return projection.lines.filter((line) => line.kind !== "header");
}
import {
  TERM_PICK_NONE,
  termPickDropdownOptions,
  termSetDropdownOptions,
} from "@intehrgrator/core/openehr_term_catalog.ts";

Deno.test("projectBlocklyState compresses nested blocks and omits x/y from text", () => {
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "element",
          id: "el1",
          x: 40,
          y: 80,
          fields: { NAME: "systolic", RM_TYPE: "ELEMENT", SLOT_ID: "bp/items/at0004" },
          inputs: {
            VALUE: {
              block: {
                type: "dv_quantity",
                id: "dv1",
                fields: { RM_TYPE: "DV_QUANTITY" },
                inputs: {
                  MAGNITUDE: {
                    block: {
                      type: "source_query",
                      id: "sq1",
                      fields: { EXPRESSION: "$.systolic", RETURN_TYPE: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  const projection = projectBlocklyState(state);
  assertStringIncludes(projection.text, "element ·");
  assertStringIncludes(projection.text, "source_query ·");
  assertEquals(projection.text.includes('"x"'), false);
  assertEquals(projection.text.includes("40"), false);

  // #246: a single leaf value folds onto the ELEMENT row.
  const source = projection.lines.find((line) => line.inline?.kind === "source_query")?.inline;
  assertEquals(source?.blockId, "sq1");
  assertEquals(source?.attribute, "magnitude");
  assertEquals(source?.shell, "dv_quantity");
  assertEquals(source?.aliasIds?.includes("dv1"), true);
  assertEquals(
    source?.editable?.find((field) => field.field === "EXPRESSION")?.value,
    "$.systolic",
  );
  assertEquals(source?.summary, "number · $.systolic");
  assertEquals(source?.info.x, undefined);
  assertEquals(
    projection.lines.find((line) => line.blockId === "el1")?.info.x,
    40,
  );
  assertEquals(projection.lines.some((line) => line.blockId === "dv1"), false);
  assertStringIncludes(projection.text, "magnitude  source_query");
});

Deno.test("empty workspace projects an empty marker", () => {
  const projection = projectBlocklyState({ blocks: { languageVersion: 0, blocks: [] } });
  assertEquals(projection.lines[0]?.type, "empty");
  assertStringIncludes(projection.text, "no blocks");
});

Deno.test("projectBlocklyState classifies typed source_query_number as source", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "source_query_number",
        id: "n1",
        x: 10,
        y: 10,
        fields: { EXPRESSION: "$.systolic" },
      }],
    },
  });
  const source = projection.lines.find((line) => line.kind === "source_query");
  assertEquals(source?.type, "source_query_number");
  assertEquals(source?.summary, "number · $.systolic");
  assertEquals(source?.editable?.map((f) => f.field), ["EXPRESSION"]);
});

Deno.test("projectBlocklyState labels named ATTR_/FLD_ slot fillers and statement chains", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "composition",
        id: "c1",
        fields: { RM_TYPE: "COMPOSITION" },
        inputs: {
          ATTR_language: {
            block: {
              type: "code_phrase",
              id: "lang",
              fields: { RM_TYPE: "CODE_PHRASE" },
              inputs: {
                FLD_code_string: {
                  block: {
                    type: "source_query",
                    id: "langq",
                    fields: { EXPRESSION: "$.lang", RETURN_TYPE: "string" },
                  },
                },
              },
            },
          },
          ATTR_content: {
            block: {
              type: "observation",
              id: "obs1",
              fields: { NAME: "Blood pressure", RM_TYPE: "OBSERVATION" },
              next: {
                block: {
                  type: "observation",
                  id: "obs2",
                  fields: { NAME: "Pulse", RM_TYPE: "OBSERVATION" },
                },
              },
            },
          },
          OPT_feeder_audit: {
            block: {
              type: "feeder_audit",
              id: "fa1",
              fields: { RM_TYPE: "FEEDER_AUDIT" },
            },
          },
        },
      }],
    },
  });
  assertEquals(projection.lines.find((l) => l.blockId === "c1")?.attribute, undefined);
  assertEquals(projection.lines.find((l) => l.blockId === "lang"), undefined);
  assertEquals(projection.lines.find((l) => l.blockId === "langq")?.attribute, "code_string");
  assertEquals(projection.lines.find((l) => l.blockId === "langq")?.aliasIds?.includes("lang"), true);
  assertEquals(projection.lines.find((l) => l.blockId === "obs1")?.attribute, "content");
  assertEquals(projection.lines.find((l) => l.blockId === "obs2")?.attribute, "content");
  assertEquals(projection.lines.find((l) => l.blockId === "fa1")?.attribute, "feeder_audit");
  assertStringIncludes(projection.text, "code_string  source_query");
  assertStringIncludes(projection.text, "content  observation");
});

Deno.test("slotAttributeFromInputName strips Blockly prefixes", () => {
  assertEquals(slotAttributeFromInputName("ATTR_language"), "language");
  assertEquals(slotAttributeFromInputName("OPT_feeder_audit"), "feeder_audit");
  assertEquals(slotAttributeFromInputName("FLD_magnitude"), "magnitude");
  assertEquals(slotAttributeFromInputName("OPTFLD_precision"), "precision");
  assertEquals(slotAttributeFromInputName("TARGET_items"), "items");
  assertEquals(slotAttributeFromInputName("VALUE"), "value");
  assertEquals(slotAttributeFromInputName("KIND"), "kind");
  assertEquals(slotAttributeFromInputName("VAL0"), undefined);
  assertEquals(slotAttributeFromInputName("DO"), undefined);
});

Deno.test("blocklyJsonDocument is a compact projection; coordinates stay in ⓘ info", () => {
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "element",
        id: "el1",
        x: 40,
        y: 80,
        fields: { NAME: "systolic", RM_TYPE: "ELEMENT" },
      }],
    },
  };
  const doc = blocklyJsonDocument(state);
  assertEquals(doc.text.includes('"x": 40'), false);
  assertEquals(doc.text.startsWith("{"), false);
  assertEquals(doc.widgets.some((w) => w.line.blockId === "el1"), true);
  assertEquals(doc.widgets[0]?.line.info.x, 40);
  assertEquals(doc.widgets.length, doc.text.split("\n").length);
});

Deno.test("blocklyJsonDocument keeps extraState and coordinates on the widget info balloon", () => {
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "event",
        id: "ev1",
        x: 24,
        y: 36,
        fields: { RM_TYPE: "EVENT" },
        extraState: { extras: [], attrs: ["time", "data"] },
      }],
    },
  };
  const doc = blocklyJsonDocument(state);
  assertEquals(doc.widgets[0]?.line.info.x, 24);
  assertEquals(
    (doc.widgets[0]?.line.info.extraState as { attrs?: string[] })?.attrs,
    ["time", "data"],
  );
  assertEquals(doc.widgets.length > 0, true);
});

Deno.test("projectBlocklyState flattens xml_text + maps_get + text key into one lookup row", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "xml_element",
        id: "el",
        fields: { NAME: "Time" },
        inputs: {
          VALUE: {
            block: {
              type: "xml_text",
              id: "xt",
              inputs: {
                VALUE: {
                  block: {
                    type: "maps_get",
                    id: "mg",
                    fields: { NAME: "defaults" },
                    inputs: {
                      KEY: {
                        block: {
                          type: "text",
                          id: "k",
                          fields: { TEXT: "Time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }],
    },
  });
  assertEquals(contentSpecLines(projection).map((l) => l.type), ["xml_element", "maps_get"]);
  const lookup = contentSpecLines(projection)[1];
  assertEquals(lookup?.kind, "map_lookup");
  assertEquals(lookup?.summary, 'defaults["Time"]');
  assertEquals(lookup?.aliasIds?.includes("xt"), true);
  assertEquals(lookup?.aliasIds?.includes("k"), true);
  assertEquals(lookup?.editable?.find((f) => f.field === "TEXT")?.targetBlockId, "k");
});

Deno.test("projectBlocklyState flattens nested AND compares into one list", () => {
  const compare = (id: string, path: string, value: string) => ({
    type: "logic_compare",
    id,
    fields: { OP: "NEQ" },
    inputs: {
      A: {
        block: {
          type: "source_query",
          id: `${id}a`,
          fields: { EXPRESSION: path, RETURN_TYPE: "string" },
        },
      },
      B: { block: { type: "text", id: `${id}b`, fields: { TEXT: value } } },
    },
  });
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "controls_if",
        id: "if1",
        extraState: { hasElse: true },
        inputs: {
          IF0: {
            block: {
              type: "logic_operation",
              id: "and1",
              fields: { OP: "AND" },
              inputs: {
                A: {
                  block: {
                    type: "logic_operation",
                    id: "and2",
                    fields: { OP: "AND" },
                    inputs: {
                      A: { block: compare("c1", "fatigue|value", "Nej") },
                      B: { block: compare("c2", "breathing|value", "Nej") },
                    },
                  },
                },
                B: { block: compare("c3", "heart|value", "Nej") },
              },
            },
          },
          DO0: {
            block: {
              type: "text_code",
              id: "note",
              fields: { LANG: "handlebars", TEXT: "{{note}}\nline2" },
            },
          },
          ELSE: {
            block: { type: "text", id: "else1", fields: { TEXT: "skip" } },
          },
        },
      }],
    },
  });
  const types = projection.lines.map((l) => l.type);
  assertEquals(types.filter((t) => t === "logic_operation").length, 1);
  assertEquals(types.filter((t) => t === "logic_compare").length, 3);
  const andRow = projection.lines.find((l) => l.type === "logic_operation");
  assertEquals(andRow?.summary, "all of");
  assertEquals(andRow?.aliasIds?.includes("and2"), true);
  const note = projection.lines.find((l) => l.blockId === "note");
  assertEquals(note?.editKind, "code");
  assertEquals(note?.editable?.find((f) => f.field === "LANG")?.value, "handlebars");
  assertStringIncludes(note?.editable?.find((f) => f.field === "TEXT")?.value ?? "", "{{note}}");
});

Deno.test("projectBlocklyState uses map KEY fields as row attributes", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "default_context_map",
        id: "def",
        extraState: { itemCount: 2, targets: [[], []] },
        fields: { KEY0: "language", KEY1: "territory" },
        inputs: {
          VAL0: { block: { type: "text", id: "v0", fields: { TEXT: "sv" } } },
          VAL1: { block: { type: "text", id: "v1", fields: { TEXT: "SE" } } },
        },
      }],
    },
  });
  assertEquals(projection.lines.find((l) => l.type === "maps_create_with"), undefined);
  assertEquals(projection.lines.find((l) => l.blockId === "v0")?.attribute, "language");
  assertEquals(projection.lines.find((l) => l.blockId === "v1")?.attribute, "territory");
  assertEquals(
    projection.lines.find((l) => l.blockId === "v0")?.attributeEdit,
    { field: "KEY0", value: "language", targetBlockId: "def" },
  );
});

Deno.test("projectBlocklyState flattens xml_attribute to @name on the value", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "xml_attribute",
        id: "a1",
        fields: { NAME: "MsgType" },
        inputs: {
          VALUE: { block: { type: "text", id: "t1", fields: { TEXT: "Request" } } },
        },
      }],
    },
  });
  const lines = contentSpecLines(projection);
  assertEquals(lines.length, 1);
  assertEquals(lines[0]?.attribute, "@MsgType");
  assertEquals(lines[0]?.blockId, "t1");
  assertEquals(lines[0]?.editKind, "text");
  assertEquals(lines[0]?.attributeEdit, {
    field: "NAME",
    value: "MsgType",
    targetBlockId: "a1",
  });
});

Deno.test("chemo TakeCare mapping spec omits Blockly JSON chrome and nested AND rows", async () => {
  const raw = await Deno.readTextFile(
    new URL(
      "./fixtures/patient-reported-chemotherapy-symptoms/mapping/mapping.blockly.json",
      import.meta.url,
    ),
  );
  const state = JSON.parse(raw);
  const typeCount = [...raw.matchAll(/"type":/g)].length;
  const projection = projectBlocklyState(state);
  const andRows = projection.lines.filter((l) => l.type === "logic_operation").length;
  assertEquals(andRows, 4, `expected 4 flattened AND/OR rows, got ${andRows}`);
  assert(
    projection.lines.length / typeCount < 0.6,
    `expected compact rows (${projection.lines.length}) vs Blockly types (${typeCount})`,
  );
  assertEquals(projection.text.includes('"extraState"'), false);
  assertEquals(projection.lines.some((l) => l.editKind === "code"), true);
  assertEquals(projection.lines.some((l) => l.editKind === "map_get"), true);
});

Deno.test("projectBlocklyState flattens sheet_lookup into one editable row", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "sheet_lookup",
        id: "sh1",
        fields: { NAME: "ICD" },
        inputs: {
          MATCH_COL: { shadow: { type: "text", id: "c1", fields: { TEXT: "code" } } },
          MATCH_VAL: {
            block: {
              type: "source_query",
              id: "sv",
              fields: { EXPRESSION: "$.icd", RETURN_TYPE: "string" },
            },
          },
          RETURN_COL: { shadow: { type: "text", id: "r1", fields: { TEXT: "snomed" } } },
        },
      }],
    },
  });
  const lines = contentSpecLines(projection);
  assertEquals(lines.length, 1);
  assertEquals(lines[0]?.kind, "sheet_lookup");
  assertEquals(lines[0]?.editKind, "sheet_lookup");
  assertEquals(lines[0]?.summary, "ICD[code=$.icd → snomed]");
  assertEquals(lines[0]?.aliasIds?.includes("sv"), true);
});

Deno.test("compare rows keep left-to-right field order when the left operand is text", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "logic_compare",
        id: "cmp",
        fields: { OP: "EQ" },
        inputs: {
          A: { block: { type: "text", id: "left", fields: { TEXT: "yes" } } },
          B: {
            block: {
              type: "source_query",
              id: "right",
              fields: { EXPRESSION: "$.flag", RETURN_TYPE: "string" },
            },
          },
        },
      }],
    },
  });
  const row = contentSpecLines(projection)[0];
  const fields = row?.editable?.map((f) => f.field);
  assertEquals(fields, ["TEXT", "OP", "EXPRESSION"]);
  assertEquals(row?.editable?.[0]?.targetBlockId, "left");
  assertEquals(row?.editable?.[2]?.targetBlockId, "right");
});

Deno.test("projectBlocklyState exposes editable TERM_PICK set and code with catalog options", () => {
  const projection = projectBlocklyState({
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: "term_pick",
        id: "lang",
        fields: {
          NAME: "built-in",
          SET: "ISO_639-1",
          CODE: "sv",
          RM_TYPE: "CODE_PHRASE",
        },
      }],
    },
  });
  const row = contentSpecLines(projection).find((line) => line.type === "term_pick");
  assertEquals(row?.editKind, "term_pick");
  assertEquals(row?.editable?.map((field) => field.field), ["SET", "CODE"]);
  assertEquals(row?.editable?.find((field) => field.field === "SET")?.value, "ISO_639-1");
  assertEquals(row?.editable?.find((field) => field.field === "CODE")?.value, "sv");
  const setOptions = row?.editable?.find((field) => field.field === "SET")?.options ?? [];
  const codeOptions = row?.editable?.find((field) => field.field === "CODE")?.options ?? [];
  assertEquals(setOptions, termSetDropdownOptions());
  assertEquals(codeOptions, termPickDropdownOptions("ISO_639-1"));
  assertEquals(codeOptions.some(([, value]) => value === "sv"), true);
  assertEquals(codeOptions.some(([, value]) => value === "not-a-language"), false);
  assertEquals(codeOptions.some(([, value]) => value === TERM_PICK_NONE), true);
});
