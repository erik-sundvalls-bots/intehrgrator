import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  chipDetails,
  chipKey,
  composeUserMessage,
  CONTEXT_ATTACHMENTS_HEADING,
  type ContextChip,
  fillPromptPlaceholders,
} from "@intehrgrator/core/ai/chat_context.ts";

const source: ContextChip = {
  kind: "source-schema",
  label: "systolic",
  filename: "vitals.schema.json",
  path: "$.systolic",
  type: "number",
  exampleValue: "128",
};
const target: ContextChip = {
  kind: "target",
  label: "Systolic",
  filename: "blood_pressure.opt",
  slotId: "bp/items/at0004/value",
  rmType: "DV_QUANTITY",
};
const block: ContextChip = {
  kind: "block",
  label: "for each",
  type: "map_for_each",
  blockId: "b1",
  boundSlot: "bp/events",
  boundSourcePath: "$.readings",
};

Deno.test("chat chips: inline references and a Context attachments block", () => {
  const msg = composeUserMessage([{ text: "Map " }, { chip: source }, { text: " to " }, { chip: target }]);
  assertEquals(msg.displayText, "Map [@Source: systolic] to [@Target: Systolic]");
  assertStringIncludes(msg.text, CONTEXT_ATTACHMENTS_HEADING);
  assertStringIncludes(msg.text, "File: `vitals.schema.json`");
  assertStringIncludes(msg.text, "Path: `$.systolic`");
  assertStringIncludes(msg.text, "Example value: `128`");
  assertStringIncludes(msg.text, "RM type: `DV_QUANTITY`");
  assertEquals(msg.attachedKeys, [chipKey(source), chipKey(target)]);
});

Deno.test("chat chips: already attached chips are only referenced", () => {
  const msg = composeUserMessage([{ chip: source }, { text: " again" }], [chipKey(source)]);
  assertEquals(msg.text, "[@Source: systolic] again");
  assertEquals(msg.attachedKeys, []);
});

Deno.test("chat chips: the same chip twice is attached once", () => {
  const msg = composeUserMessage([{ chip: block }, { text: " and " }, { chip: { ...block } }]);
  assertEquals(msg.attachedKeys.length, 1);
  assertEquals(msg.text.split("[@Block: for each] (BLOCKLY BLOCK)").length, 2);
});

Deno.test("chat chips: hover details per kind", () => {
  assertEquals(chipDetails(source).map(([k]) => k), ["File", "Path", "Type", "Example value"]);
  assertEquals(chipDetails(target).map(([k]) => k), ["Template", "Slot", "RM type"]);
  assertEquals(chipDetails(block).map(([k]) => k), ["Block type", "Block id", "Bound slot", "Source path"]);
});

Deno.test("stored prompt placeholders fill from chips", () => {
  const parts = fillPromptPlaceholders("Loop {source_node} around {target_node}.", [target, source]);
  assertEquals(parts, [{ text: "Loop " }, { chip: source }, { text: " around " }, { chip: target }, { text: "." }]);
});

Deno.test("stored prompt placeholders: target falls back to a block chip", () => {
  const parts = fillPromptPlaceholders("{target_node}", [block]);
  assertEquals(parts, [{ chip: block }]);
});

Deno.test("stored prompt placeholders stay visible without chips", () => {
  const parts = fillPromptPlaceholders("Loop {source_node} around {target_node}", []);
  assertEquals(parts, [{ text: "Loop {source_node} around {target_node}" }]);
});
