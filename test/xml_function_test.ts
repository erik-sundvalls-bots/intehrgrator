import { assertEquals, assertStringIncludes } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import {
  initBlocklyGenerators,
  workspaceToModelJson,
} from "@intehrgrator/blockly/mod.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";

Deno.test("XML schema Notes execute ordinary Function statements, locals and loop reporters in both preview modes", () => {
  initBlocklyGenerators();
  const workspace = new Blockly.Workspace();
  const variable = (name: string) => ({
    type: "variables_get",
    fields: { VAR: { id: name, name } },
  });
  const input = (block: unknown) => ({ block });
  try {
    Blockly.serialization.workspaces.load({
      variables: ["label", "index", "length", "formatted"].map((name) => ({
        id: name,
        name,
      })),
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: "procedures_defreturn",
          fields: { NAME: "format_line" },
          extraState: {
            params: ["label", "index", "length"].map((name) => ({
              name,
              id: name,
            })),
          },
          inputs: {
            STACK: input({
              type: "variables_set",
              fields: { VAR: { id: "formatted", name: "formatted" } },
              inputs: {
                VALUE: input({
                  type: "text_join",
                  extraState: { itemCount: 5 },
                  inputs: {
                    ADD0: input({
                      type: "math_arithmetic",
                      fields: { OP: "ADD" },
                      inputs: {
                        A: input(variable("index")),
                        B: input({ type: "math_number", fields: { NUM: 1 } }),
                      },
                    }),
                    ADD1: input({ type: "text", fields: { TEXT: "/" } }),
                    ADD2: input(variable("length")),
                    ADD3: input({ type: "text", fields: { TEXT: ": " } }),
                    ADD4: input(variable("label")),
                  },
                }),
              },
            }),
            RETURN: input(variable("formatted")),
          },
        }],
      },
    }, workspace);
    const model = createEmptyModel("report");
    model.targetFormat = "xml-schema";
    model.functions = workspaceToModelJson(workspace).functions;
    const state = {
      blocks: {
        blocks: [{
          type: "xml_element",
          fields: { NAME: "Report" },
          inputs: {
            TARGET_children: input({
              type: "for_each_list",
              fields: { VAR: "row" },
              inputs: {
                LIST: input({
                  type: "lists_create_with",
                  extraState: { itemCount: 2 },
                  inputs: {
                    ADD0: input({ type: "text", fields: { TEXT: "A & B" } }),
                    ADD1: input({ type: "text", fields: { TEXT: "C" } }),
                  },
                }),
                DO: input({
                  type: "schema_record",
                  fields: { SLOT_ID: "Record" },
                  inputs: {
                    TARGET_Note: input({
                      type: "procedures_callreturn",
                      extraState: {
                        name: "format_line",
                        params: ["label", "index", "length"],
                      },
                      inputs: {
                        ARG0: input({
                          type: "logic_current_item",
                          fields: { VAR: "" },
                        }),
                        ARG1: input({
                          type: "logic_loop_index",
                          fields: { VAR: "" },
                        }),
                        ARG2: input({
                          type: "logic_loop_length",
                          fields: { VAR: "" },
                        }),
                      },
                    }),
                    TARGET_BlankNote: input({
                      type: "procedures_callreturn",
                      extraState: {
                        name: "format_line",
                        params: ["label", "index", "length"],
                      },
                      inputs: {
                        ARG1: input({
                          type: "logic_loop_index",
                          fields: { VAR: "" },
                        }),
                        ARG2: input({
                          type: "logic_loop_length",
                          fields: { VAR: "" },
                        }),
                      },
                    }),
                  },
                }),
              },
            }),
          },
        }],
      },
    };
    const target = getTargetFormatHandler("xml-schema").load(
      "report.xsd",
      `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Report"><xs:complexType><xs:sequence><xs:element name="Record" maxOccurs="unbounded"><xs:complexType><xs:sequence><xs:element name="Note" type="xs:string"/><xs:element name="BlankNote" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:sequence></xs:complexType></xs:element></xs:schema>`,
    );
    for (const outputMode of ["preview", "handlebars"] as const) {
      const result = runTest(model, "{}", "json", {
        target,
        outputMode,
        blocklyState: state,
      });
      assertEquals(result.error, undefined, outputMode);
      assertStringIncludes(
        String(result.output),
        "<Note>1/2: A &amp; B</Note>",
        outputMode,
      );
      assertStringIncludes(
        String(result.output),
        "<Note>2/2: C</Note>",
        outputMode,
      );
      assertStringIncludes(
        String(result.output),
        "<BlankNote>1/2: </BlankNote>",
        outputMode,
      );
    }
  } finally {
    workspace.dispose();
  }
});
