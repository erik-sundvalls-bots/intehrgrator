import { assert, assertEquals } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { javascriptGenerator } from "blockly/javascript";
import {
  initBlocklyGenerators,
  buildDemoToolbox,
  blockToExpression,
  createSourceQueryBlock,
} from "@intehrgrator/blockly/mod.ts";
import { msg } from "@intehrgrator/blockly/i18n/custom_msg.ts";
import {
  DEFAULT_EDITOR_COLS,
  DEFAULT_EDITOR_ROWS,
  FieldCodeMirror,
} from "@intehrgrator/blockly/field_codemirror.ts";
import { evaluate, createSourceContext } from "@intehrgrator/core/source/query_runtime.ts";
import { parseExpression, serialize } from "@intehrgrator/core/expression/mod.ts";
import { EDITOR_LANGUAGE_OPTIONS } from "@intehrgrator/workbench/codemirror_setup.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  initBlocklyGenerators();
  ready = true;
}

Deno.test("xpathNode returns a JSON subtree without stringifying it", () => {
  const ctx = createSourceContext(
    JSON.stringify({ patient: { name: "Ada", vitals: { systolic: 120 } } }),
    "json",
  );
  assertEquals(evaluate('xpathNode("$.patient")', ctx, "node"), {
    name: "Ada",
    vitals: { systolic: 120 },
  });
  assertEquals(evaluate('xpathNode("$")', ctx, "node"), {
    patient: { name: "Ada", vitals: { systolic: 120 } },
  });
});

Deno.test("handlebars renders prose from a source subtree context", () => {
  const ctx = createSourceContext(
    JSON.stringify({ patient: { name: "Ada", unit: "mmHg" } }),
    "json",
  );
  const out = evaluate(
    'handlebars("{{name}} ({{unit}})", xpathNode("$.patient"))',
    ctx,
    "string",
  );
  assertEquals(out, "Ada (mmHg)");
});

Deno.test("handlebars renders from a map() context", () => {
  const ctx = createSourceContext("{}", "json");
  const out = evaluate(
    'handlebars("Hello {{who}}", map("who", "world"))',
    ctx,
    "string",
  );
  assertEquals(out, "Hello world");
});

Deno.test("handlebars / xpathNode / map expressions round-trip", () => {
  const src = 'handlebars("{{n}}", xpathNode("$.patient"))';
  assertEquals(serialize(parseExpression(src)), src);
  const mapSrc = 'map("a", 1, "b", "x")';
  assertEquals(serialize(parseExpression(mapSrc)), mapSrc);
});

Deno.test("Source toolbox lists the source node block after typed queries", () => {
  ensure();
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ name?: string; contents?: Array<{ type?: string }> }>;
  };
  const source = toolbox.contents.find((cat) => cat.name === msg("en").CAT_SOURCE);
  const types = (source?.contents ?? []).map((block) => block.type);
  assertEquals(types, [
    "source_query",
    "source_query_number",
    "source_query_boolean",
    "source_query_node",
  ]);
});

Deno.test("Text toolbox lists CodeMirror text and Handlebars blocks after stock text", () => {
  ensure();
  const toolbox = buildDemoToolbox("en") as {
    contents: Array<{ name?: string; contents?: Array<{ type?: string }> }>;
  };
  const text = toolbox.contents.find((cat) => cat.name === msg("en").CAT_TEXT);
  const types = (text?.contents ?? []).map((block) => block.type);
  assertEquals(types[0], "conversion_start");
  assertEquals(types[1], "text_document");
  assertEquals(types[2], "text");
  assertEquals(types[3], "text_code");
  assertEquals(types[4], "text_code");
  assertEquals(types[5], "text_handlebars");
});

Deno.test("source_query_node outputs Source and serializes to xpathNode", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const block = createSourceQueryBlock(workspace, "$.patient", "node");
  assertEquals(block.type, "source_query_node");
  assertEquals(block.outputConnection?.getCheck()?.includes("Source"), true);
  assertEquals(blockToExpression(block), 'xpathNode("$.patient")');
  javascriptGenerator.init(workspace);
  const code = javascriptGenerator.blockToCode(block) as [string, number];
  assert(code[0].includes("evaluateXPathToFirstNode"), code[0]);
  workspace.dispose();
});

Deno.test("text_code emits a multiline string and stores a language", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("text_code");
  assertEquals(block.outputConnection?.getCheck()?.includes("String"), true);
  assertEquals(block.getFieldValue("LANG"), "handlebars");
  block.setFieldValue("{{name}}\n{{unit}}", "TEXT");
  // A Handlebars Code text is a nested template every language renders (lung-MDT).
  assertEquals(blockToExpression(block), `handlebars(${JSON.stringify("{{name}}\n{{unit}}")}, xpathNode("$"))`);
  block.setFieldValue("go-template", "LANG");
  assertEquals(blockToExpression(block), JSON.stringify("{{name}}\n{{unit}}"));
  block.setFieldValue("handlebars", "LANG");
  const saved = Blockly.serialization.blocks.save(block) as {
    fields?: Record<string, unknown>;
  };
  assertEquals(saved.fields?.LANG, "handlebars");
  assertEquals(saved.fields?.TEXT, "{{name}}\n{{unit}}");
  workspace.dispose();
});

Deno.test("text_handlebars block captions use run-handlebars-script labels", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("text_handlebars");
  assertEquals(block.getInput("SCRIPT")?.fieldRow[0]?.getText?.(), "run handlebars script:");
  assertEquals(block.getInput("CONTEXT")?.fieldRow[0]?.getText?.(), "with input context");
  workspace.dispose();
});

Deno.test("text_handlebars accepts a Map or Source context and serializes handlebars()", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const render = workspace.newBlock("text_handlebars");
  const script = workspace.newBlock("text_code");
  const node = createSourceQueryBlock(workspace, "$.patient", "node");
  const map = workspace.newBlock("maps_create_with");
  script.setFieldValue("{{name}}", "TEXT");

  const ctxCheck = render.getInput("CONTEXT")?.connection?.getCheck() ?? [];
  assertEquals(ctxCheck.includes("Map"), true);
  assertEquals(ctxCheck.includes("Source"), true);
  assertEquals(render.outputConnection?.getCheck()?.includes("String"), true);

  render.getInput("SCRIPT")?.connection?.connect(script.outputConnection!);
  render.getInput("CONTEXT")?.connection?.connect(node.outputConnection!);
  assertEquals(
    blockToExpression(render),
    'handlebars("{{name}}", xpathNode("$.patient"))',
  );

  node.outputConnection!.disconnect();
  render.getInput("CONTEXT")?.connection?.connect(map.outputConnection!);
  const expr = blockToExpression(render);
  assert(expr?.startsWith('handlebars("{{name}}", map('), expr ?? "");
  workspace.dispose();
});

Deno.test("FieldCodeMirror defaults to 3 rows by 40 columns and round-trips text", () => {
  const field = new FieldCodeMirror("");
  assertEquals(field.getEditorCols(), DEFAULT_EDITOR_COLS);
  assertEquals(field.getEditorRows(), DEFAULT_EDITOR_ROWS);
  field.setValue("{{title}}\n{{body}}");
  assertEquals(field.getValue(), "{{title}}\n{{body}}");
  const state = field.saveState();
  const restored = new FieldCodeMirror("");
  restored.loadState(state);
  assertEquals(restored.getValue(), "{{title}}\n{{body}}");
});

Deno.test("CodeMirror language dropdown includes Handlebars and installed highlighters", () => {
  const ids = EDITOR_LANGUAGE_OPTIONS.map(([, id]) => id);
  assertEquals(ids.includes("handlebars"), true);
  assertEquals(ids.includes("go-template"), true);
  assertEquals(ids.includes("json"), true);
  assertEquals(ids.includes("xml"), true);
  assertEquals(ids.includes("html"), true);
  assertEquals(ids.includes("javascript"), false);
  assertEquals(ids.includes("typescript"), false);
  assertEquals(ids.includes("none"), true);
});
