/**
 * Schema-less JSON / XML / text targets (#198).
 * The joint-load radio that starts one lives in test/ui/joint_load_ai_test.ts.
 */
import { assert, assertEquals } from "@std/assert";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import { getSourceFormatHandler } from "@intehrgrator/core/source/mod.ts";
import { renderJsonCanvasFromBlockly } from "@intehrgrator/core/output/canvas_example_runtime.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";

function stubHost(): HostAdapter {
  return {
    pickTextFile: () => Promise.resolve(null),
    pickTextFilesFromDirectory: () => Promise.resolve(null),
    pickBinaryFile: () => Promise.resolve(null),
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: () => Promise.resolve(),
    readClipboard: () => Promise.resolve(""),
    saveAutosave: () => Promise.resolve(),
    saveManualSave: () => Promise.resolve(),
    loadStoredProjectRecord: () => Promise.resolve(null),
    listLoadableProjects: () => Promise.resolve([]),
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
  };
}

function blockTypes(state: unknown): string[] {
  const types: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as {
      type?: unknown;
      inputs?: Record<string, { block?: unknown }>;
      next?: { block?: unknown };
      blocks?: unknown;
    };
    if (typeof record.type === "string") types.push(record.type);
    if (record.inputs) {
      for (const input of Object.values(record.inputs)) walk(input?.block);
    }
    if (record.next?.block) walk(record.next.block);
    if (Array.isArray(record.blocks)) {
      for (const child of record.blocks) walk(child);
    } else if (record.blocks && typeof record.blocks === "object") {
      walk(record.blocks);
    }
  };
  walk(state);
  return types;
}

Deno.test("schema-less JSON target previews the minimal document and keeps a queued map", () => {
  const controller = new WorkbenchController(stubHost());
  const queued = {
    type: "default_context_map",
    extraState: { itemCount: 0, targets: [] },
  };
  controller.queuePendingDefaultsMap(queued);
  controller.startSchemalessTarget("json");
  assertEquals(controller.consumePendingDefaultsMap(), queued);

  const state = controller.getState();
  assertEquals(state.templateId, "example-json");
  assertEquals(state.templateFilename, "example.json");
  assertEquals(state.target?.format, "json-schema");
  assertEquals(state.skeleton, []);
  assertEquals(state.target?.content, '{\n  "example": "value"\n}\n');
  const types = blockTypes(state.blocklyState);
  assert(types.includes("conversion_start"));
  assert(types.includes("json_object"));
  assert(types.includes("json_value"));
  assert(types.includes("text"));

  controller.addExampleContent("empty.json", "{}\n");
  controller.runTestNow();
  assertEquals(
    controller.getState().testResult?.output,
    '{\n  "example": "value"\n}\n',
  );

  const snap = controller.exportDocumentSnapshot();
  controller.startSchemalessTarget("text");
  controller.restoreDocumentSnapshot(snap);
  assertEquals(
    controller.getState().target?.content,
    '{\n  "example": "value"\n}\n',
  );
  assertEquals(controller.getState().skeleton, []);
  assertEquals(
    blockTypes(controller.getState().blocklyState).includes("json_object"),
    true,
  );
});

Deno.test("schema-less XML target stores a document without a declaration", () => {
  const controller = new WorkbenchController(stubHost());
  controller.startSchemalessTarget("xml");
  const state = controller.getState();
  assertEquals(state.templateId, "example-xml");
  assertEquals(state.target?.content, "<example>value</example>\n");
  assertEquals(state.target?.format, "xml-schema");
  assertEquals(state.skeleton, []);
  const types = blockTypes(state.blocklyState);
  assert(types.includes("conversion_start"));
  assert(types.includes("xml_document"));
  assert(types.includes("xml_element"));

  controller.addExampleContent("empty.xml", "<root/>");
  controller.runTestNow();
  const preview = String(controller.getState().testResult?.output ?? "");
  assertEquals(preview.includes("<?xml"), false);
  assertEquals(preview.trim(), "<example>\nvalue\n</example>");
});

Deno.test("schema-less text target previews the text document", () => {
  const controller = new WorkbenchController(stubHost());
  controller.startSchemalessTarget("text");
  const state = controller.getState();
  assertEquals(state.templateId, "example-text");
  assertEquals(state.templateFilename, "example.txt");
  assertEquals(state.target?.format, "free-form");
  assertEquals(state.target?.content, "Example\n");
  const types = blockTypes(state.blocklyState);
  assert(types.includes("conversion_start"));
  assert(types.includes("text_document"));
  assert(types.includes("text"));

  controller.addExampleContent("empty.json", "{}\n");
  controller.runTestNow();
  assertEquals(controller.getState().testResult?.output, "Example\n");
});

Deno.test("schema-less JSON preview reads source queries, arrays, and literals", () => {
  const ctx = getSourceFormatHandler("json").createContext(
    '{"n":3,"ok":true,"name":"Ada"}\n',
  );
  const state = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "json_object",
          inputs: {
            TARGET_n: {
              block: {
                type: "json_value",
                fields: { NAME: "n" },
                inputs: {
                  VALUE: {
                    block: {
                      type: "source_query_number",
                      fields: { EXPRESSION: "$.n" },
                    },
                  },
                },
              },
            },
            TARGET_ok: {
              block: {
                type: "json_boolean",
                inputs: {
                  VALUE: {
                    block: {
                      type: "source_query_boolean",
                      fields: { EXPRESSION: "$.ok" },
                    },
                  },
                },
              },
            },
            TARGET_name: {
              block: {
                type: "json_value",
                inputs: {
                  VALUE: {
                    block: {
                      type: "source_query",
                      fields: { EXPRESSION: "$.name" },
                    },
                  },
                },
              },
            },
            TARGET_items: {
              block: {
                type: "json_array",
                inputs: {
                  TARGET_0: {
                    block: {
                      type: "json_value",
                      inputs: {
                        VALUE: {
                          block: { type: "math_number", fields: { NUM: 1 } },
                        },
                      },
                      next: { block: { type: "json_null" } },
                    },
                  },
                },
              },
            },
            TARGET_flag: {
              block: {
                type: "json_boolean",
                inputs: {
                  VALUE: {
                    block: { type: "logic_boolean", fields: { BOOL: "TRUE" } },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  assertEquals(
    renderJsonCanvasFromBlockly(state, ctx),
    '{\n  "n": 3,\n  "ok": true,\n  "name": "Ada",\n  "items": [\n    1,\n    null\n  ],\n  "flag": true\n}\n',
  );
});
