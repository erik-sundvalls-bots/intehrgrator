import { GO_TEMPLATE_CODE_TEXT_UNSUPPORTED } from "@intehrgrator/core/output/code_text.ts";
import { assertEquals, assert } from "@std/assert";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import {
  blockHatchMessages,
  HATCH_DYNAMIC_PATH,
  HATCH_JSON_XML,
  HATCH_OUT_OF_DIALECT_HBS,
  HATCH_REMOVED,
  isLiteralSourcePath,
} from "@intehrgrator/blockly/vms_linter.ts";
import { ensureGoTemplateWasm } from "@intehrgrator/core/output/go_template_runtime.ts";
import { blockConstraintMessages } from "@intehrgrator/blockly/block_constraints.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  initBlocklyGenerators();
  ready = true;
}

Deno.test("isLiteralSourcePath accepts FLAT / JSONPath and rejects concat", () => {
  assertEquals(isLiteralSourcePath("$.patient.name"), true);
  assertEquals(isLiteralSourcePath("symptom|value"), true);
  assertEquals(isLiteralSourcePath("granskning.imaging.[0].[|value]"), true);
  assertEquals(isLiteralSourcePath("concat('/a/', $x)"), false);
});

Deno.test("workspace hatch: removed types and json/xml get distinct warnings", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const removed = workspace.newBlock("controls_whileUntil");
  assertEquals(blockHatchMessages(removed), [HATCH_REMOVED]);

  const proc = workspace.newBlock("procedures_defreturn");
  assertEquals(blockHatchMessages(proc), []);

  const json = workspace.newBlock("json_object");
  assertEquals(blockHatchMessages(json), [HATCH_JSON_XML]);

  const xml = workspace.newBlock("xml_element");
  assertEquals(blockHatchMessages(xml), [HATCH_JSON_XML]);
  workspace.dispose();
});

Deno.test("workspace hatch: in-dialect Handlebars does not warn; Go text_code always does (#386)", async () => {
  ensure();
  await ensureGoTemplateWasm();
  const workspace = new Blockly.Workspace();

  const hbs = workspace.newBlock("text_code");
  hbs.setFieldValue("handlebars", "LANG");
  hbs.setFieldValue('{{#if (eq x "MR")}}MR{{/if}}', "TEXT");
  assertEquals(blockHatchMessages(hbs), []);

  const go = workspace.newBlock("text_code");
  go.setFieldValue("go-template", "LANG");
  go.setFieldValue('{{if eq (index .Data "a") "yes"}}ok{{end}}', "TEXT");
  // #386: Go template text is never accepted on the canvas, in dialect or not.
  assertEquals(blockHatchMessages(go), [GO_TEMPLATE_CODE_TEXT_UNSUPPORTED]);

  const badHbs = workspace.newBlock("text_code");
  badHbs.setFieldValue("handlebars", "LANG");
  badHbs.setFieldValue("{{#with patient}}{{name}}{{/with}}", "TEXT");
  assertEquals(blockHatchMessages(badHbs), [HATCH_OUT_OF_DIALECT_HBS]);

  const badGo = workspace.newBlock("text_code");
  badGo.setFieldValue("go-template", "LANG");
  badGo.setFieldValue("{{call .Fn}}", "TEXT");
  assertEquals(blockHatchMessages(badGo), [GO_TEMPLATE_CODE_TEXT_UNSUPPORTED]);

  const dyn = workspace.newBlock("source_query");
  dyn.setFieldValue("concat('/a/', $x)", "EXPRESSION");
  assertEquals(blockHatchMessages(dyn), [HATCH_DYNAMIC_PATH]);

  workspace.dispose();
});

Deno.test("blockConstraintMessages includes hatch warnings", async () => {
  ensure();
  await ensureGoTemplateWasm();
  const workspace = new Blockly.Workspace();
  const bad = workspace.newBlock("text_code");
  bad.setFieldValue("handlebars", "LANG");
  bad.setFieldValue("{{lookup a b}}", "TEXT");
  const messages = blockConstraintMessages(bad);
  assert(messages.includes(HATCH_OUT_OF_DIALECT_HBS), messages.join(" | "));
  workspace.dispose();
});
