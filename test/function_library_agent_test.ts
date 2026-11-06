import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const catalogPath = join(dirname(fromFileUrl(import.meta.url)), "..", "function-library", "catalog.json");

Deno.test("list_function_library reads the bundled catalog", async () => {
  const service = new WorkbenchService();
  const listed = await callAgentTool(service, "list_function_library", { catalogPath }) as {
    functions: Array<{ id: string; name: string }>;
  };
  assertEquals(listed.functions.map((row) => row.id).sort(), ["coded_text_from_sheet", "join_oxford", "join_swedish"]);
});

Deno.test("load_function merges join_swedish without replacing unrelated Blockly", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "put_blockly", {
    blocklyState: {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "text", fields: { TEXT: "keep-me" } }],
      },
    },
  });
  const loaded = await callAgentTool(service, "load_function", {
    functionId: "join_swedish",
    catalogPath,
    clash: "rename",
  }) as { name: string; sheetNames: string[] };
  assertEquals(loaded.name, "join_swedish_words");
  assertEquals(loaded.sheetNames.includes("SweJoinWords"), true);
  const bundle = service.exportBundle();
  const json = JSON.stringify(bundle.mapping.blocklyState);
  assert(json.includes("join_swedish"));
  assert(json.includes("keep-me"));
  assertEquals(new RegExp('"type"\\s*:\\s*"join_list"').test(json), false);
  assertEquals(bundle.mapping.sheets?.some((sheet) => sheet.name === "SweJoinWords"), true);
});
