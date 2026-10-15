import { assert, assertEquals } from "@std/assert";
import { buildDemoToolbox, toolboxBlockTypes } from "@intehrgrator/blockly/toolbox_demo.ts";
import { msg } from "@intehrgrator/blockly/i18n/custom_msg.ts";
import {
  ADD_DECISION_TABLE_CALLBACK,
  ADD_SHEET_CALLBACK,
} from "@intehrgrator/blockly/grid_flyout.ts";
import { sheetsChrome } from "@intehrgrator/ui/sheets_i18n.ts";

Deno.test("toolbox contains a search category above the minimap covering custom drawers", () => {
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ kind?: string; name?: string }>;
  };
  const searchItem = toolbox.contents.find((c) => c.kind === "search");
  assert(searchItem, "search item exists in toolbox");
  assertEquals(searchItem?.name, msg("en").CAT_SEARCH);
  assertEquals(toolbox.contents.at(-1)?.kind, "search");
  const types = toolboxBlockTypes(toolbox);
  for (const type of [
    "source_query",
    "source_query_number",
    "observation",
    "maps_create_with",
    "for_each_list",
    "logic_loop_index",
    "logic_loop_length",
    "text_handlebars",
  ]) {
    assert(types.includes(type), `toolbox-search index should include ${type}`);
  }
});

Deno.test("Lists and Maps share one toolbox drawer; grid drawers sit with Variables", () => {
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{
      kind?: string;
      name?: string;
      contents?: Array<{ kind?: string; type?: string; text?: string; callbackKey?: string }>;
    }>;
  };
  const names = toolbox.contents.map((c) => c.name);
  assertEquals(names.filter((n) => n === msg("en").CAT_LISTS_AND_MAPS).length, 1);
  assertEquals(names.includes("Lists"), false);
  assertEquals(names.includes("Maps"), false);
  const joint = toolbox.contents.find((c) => c.name === msg("en").CAT_LISTS_AND_MAPS);
  const types = (joint?.contents ?? []).map((block) => block.type);
  assert(types.includes("lists_create_with"), "joint drawer includes list blocks");
  assert(types.includes("maps_get"), "joint drawer includes map blocks");
  assert(types.includes("maps_create_with"), "joint drawer includes maps_create_with");

  const sep = toolbox.contents.findIndex((item) => item.kind === "sep");
  const decision = toolbox.contents.findIndex((item) => item.name === msg("en").CAT_DECISION_TABLES);
  const sheets = toolbox.contents.findIndex((item) => item.name === msg("en").CAT_SHEETS);
  const variables = toolbox.contents.findIndex((item) => item.name === msg("en").CAT_VARIABLES);
  const functions = toolbox.contents.findIndex((item) => item.name === msg("en").CAT_PROCEDURES);
  assert(sep >= 0 && decision > sep && sheets > decision && variables > sheets && functions > variables);

  const decisionDrawer = toolbox.contents[decision]!;
  const decisionTypes = (decisionDrawer.contents ?? []).map((block) => block.type);
  assertEquals(decisionTypes.includes("decision_table"), true);
  assertEquals(decisionTypes.includes("decision_table_decl"), false);
  assertEquals(decisionTypes.includes("sheet"), false);
  const addDecision = decisionDrawer.contents?.find((item) => item.kind === "button");
  assertEquals(addDecision?.text, sheetsChrome("en").addDecision);
  assertEquals(addDecision?.callbackKey, ADD_DECISION_TABLE_CALLBACK);

  const sheetsDrawer = toolbox.contents[sheets]!;
  const sheetTypes = (sheetsDrawer.contents ?? []).map((block) => block.type);
  assert(sheetTypes.includes("sheet_lookup"));
  assert(sheetTypes.includes("sheet_get_cell"));
  assertEquals(sheetTypes.includes("sheet"), false);
  assertEquals(sheetTypes.includes("decision_table"), false);
  const addSheet = sheetsDrawer.contents?.find((item) => item.kind === "button");
  assertEquals(addSheet?.text, sheetsChrome("en").add);
  assertEquals(addSheet?.callbackKey, ADD_SHEET_CALLBACK);

  const allTypes = toolboxBlockTypes(toolbox);
  assertEquals(allTypes.includes("sheet"), false);
  assertEquals(allTypes.includes("decision_table_decl"), false);
});
