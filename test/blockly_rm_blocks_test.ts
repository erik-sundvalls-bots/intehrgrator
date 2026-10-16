import { assertEquals, assert } from "@std/assert";
import { join } from "@std/path";
import { generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import {
  blocklyCheckForDv,
  blocklyCheckForReturnType,
  blocklyOutputForDv,
} from "@intehrgrator/blockly/block_checks.ts";
import {
  applyFixedFieldsToDataValueShell,
  configureElementValueSlot,
  dvFieldInputName,
  ensureElementDataValueShell,
  isDataValueBlock,
  orderedRmAttributes,
  presentFixedAttributeNames,
  ENTRY_BOILERPLATE_ATTRS,
  sortEntryBoilerplateExtras,
  registerRmBlocks,
  RM_SPECIALIZATION_INPUT,
  rmAttributeInputName,
  optionalRmInputName,
  applyMutatorItemLabel,
  buildOptionalRmFlyoutContents,
  OPTIONAL_RM_MUTATOR_CONTAINER,
  OPTIONAL_RM_MUTATOR_ITEM,
  DV_FIELDS_MUTATOR_ITEM,
  syncRmAttributeInputs,
  applyEventRmType,
  applyItemStructureRmType,
  enforceOpenEhrBlockLayout,
  isEntryRmType,
  rmTypeOfBlock,
} from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { registerExpressionBlocks } from "@intehrgrator/blockly/blocks/expression_blocks.ts";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { findInstanceRootUnderStart } from "@intehrgrator/blockly/instance_root.ts";
import { zipehrEmojiForRmType } from "@intehrgrator/core/rm_emoji.ts";
import {
  ABSTRACT_SLOT_GLYPH,
  BLOCK_OUT_EMOJI_FIELD,
  isRmTypeEmojiField,
  RM_EMOJI_FONT_PX,
  RM_EMOJI_LARGE_FONT_PX,
  rmTypeConnectionTooltip,
} from "@intehrgrator/blockly/rm_type_emoji.ts";
import { isSlotLabelField } from "@intehrgrator/blockly/slot_label.ts";
import { isSkeletonTitleField, humanizeRmType } from "@intehrgrator/blockly/field_skeleton_title.ts";
import { loadSkeletonIntoWorkspace, setAllBlocksCollapsed, attachOptionalRmChild } from "@intehrgrator/blockly/skeleton_loader.ts";
import {
  ABSTRACT_EVENT_WARNING,
  ABSTRACT_ITEM_STRUCTURE_WARNING,
  blockConstraintMessages,
  refreshWorkspaceConstraints,
  warningTextOf,
} from "@intehrgrator/blockly/block_constraints.ts";
import {
  formatSlotCardinality,
  isSlotCardinalityField,
} from "@intehrgrator/blockly/slot_cardinality.ts";
import { createTermPickBlock } from "@intehrgrator/blockly/blocks/term_pick.ts";
import { TERM_PICK_NONE, termSetById, termSetForMandatedCode, termSetForRmAttribute } from "@intehrgrator/core/openehr_term_catalog.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";
import {
  attributesFor,
  dataValueLeafTypes,
  isDataValueType,
  primaryMappingAttribute,
} from "@intehrgrator/core/rm_meta.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";

function compositionRoot(workspace: Blockly.Workspace): Blockly.Block | undefined {
  return findInstanceRootUnderStart(workspace) ??
    workspace.getTopBlocks(false).find((block) => block.type === "composition");
}

function isBoilerplateDescendant(block: Blockly.Block, ids: Set<string>): boolean {
  let current: Blockly.Block | null = block.getParent();
  while (current) {
    if (ids.has(current.id)) return true;
    current = current.getParent();
  }
  return false;
}

const fixture = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);

let blocksReady = false;
function ensureBlocks(): void {
  if (blocksReady) return;
  registerRmBlocks();
  registerExpressionBlocks();
  blocksReady = true;
}

Deno.test("ehrtslib meta exposes DATA_VALUE leaves and DV_QUANTITY fields", () => {
  assert(dataValueLeafTypes().includes("DV_QUANTITY"));
  assert(isDataValueType("DV_CODED_TEXT"));
  const qty = attributesFor("DV_QUANTITY");
  assert(qty.some((a) => a.name === "magnitude" && a.mandatory));
  assert(qty.some((a) => a.name === "units" && a.mandatory));
  assertEquals(primaryMappingAttribute("DV_QUANTITY")?.name, "magnitude");
});

Deno.test("skeleton children carry rmAttribute from OPT walk", () => {
  const { skeleton } = generateSkeleton(fixture);
  const observation = skeleton.flatMap(function walk(n): SkeletonNode[] {
    const self = n.rmType === "OBSERVATION" ? [n] : [];
    return [...self, ...n.children.flatMap((c) => walk(c))];
  })[0];
  assert(observation, "expected OBSERVATION node");
  const attrs = new Set(observation.children.map((c) => c.rmAttribute));
  assert(attrs.has("data"), `expected data attribute, got ${[...attrs].join(", ")}`);
});

Deno.test("blocklyCheckForDv maps DV types to typed shell checks", () => {
  assertEquals(blocklyCheckForDv("DV_TEXT"), ["DV_TEXT", "DV_CODED_TEXT"]);
  assertEquals(blocklyCheckForDv("DV_QUANTITY"), ["DV_QUANTITY"]);
  assertEquals(blocklyCheckForDv("DV_BOOLEAN"), ["DV_BOOLEAN"]);
  assertEquals(blocklyCheckForReturnType("string"), "String");
});

Deno.test("blocklyOutputForDv widens DV shells with DATA_VALUE for reconnect", () => {
  assertEquals(blocklyOutputForDv("DV_QUANTITY"), ["DV_QUANTITY", "DATA_VALUE"]);
  assertEquals(blocklyOutputForDv("DV_BOOLEAN"), ["DV_BOOLEAN", "DATA_VALUE"]);
  assertEquals(blocklyOutputForDv("DV_TEXT"), ["DV_TEXT", "DV_CODED_TEXT", "DATA_VALUE"]);
});

Deno.test("orderedRmAttributes puts mandatory RM attrs first", () => {
  assertEquals(
    orderedRmAttributes("OBSERVATION", ["protocol", "data"]),
    ["data", "protocol"],
  );
});

Deno.test("orderedRmAttributes trails ENTRY subject language encoding", () => {
  assertEquals(
    orderedRmAttributes("OBSERVATION", [
      "encoding",
      "data",
      "subject",
      "protocol",
      "language",
    ]),
    ["data", "protocol", "subject", "language", "encoding"],
  );
});

Deno.test("orderedRmAttributes does not trail COMPOSITION language", () => {
  const ordered = orderedRmAttributes("COMPOSITION", [
    "content",
    "language",
    "territory",
    "category",
    "composer",
    "context",
  ]);
  assertEquals(ordered.includes("language"), true);
  assertEquals(ordered.indexOf("language") < ordered.indexOf("content"), true);
  assertEquals(ordered.at(-1) === "language", false);
});

Deno.test("optional RM extras on ENTRY trail subject language encoding", () => {
  assertEquals(
    sortEntryBoilerplateExtras("OBSERVATION", ["protocol", "encoding", "subject", "language"]),
    ["protocol", "subject", "language", "encoding"],
  );
  assertEquals(
    sortEntryBoilerplateExtras("COMPOSITION", ["content", "language", "context"]),
    ["content", "language", "context"],
  );
});

/** Dummy inputs with no connection sit as empty rows in Thrasos. */
function dummyRowsAfterHeader(block: Blockly.Block): number {
  const inputs = block.inputList;
  const headerIdx = inputs.findIndex((input) => input.name === "HEADER");
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  let n = 0;
  for (let i = start; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.connection) break;
    n++;
  }
  return n;
}

function inputNames(block: Blockly.Block): string {
  return block.inputList.map((input) => input.name || "(dummy)").join(",");
}

Deno.test("hidden metadata is not extra dummy rows under HEADER", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();

  const phrase = workspace.newBlock("code_phrase");
  assertEquals(
    dummyRowsAfterHeader(phrase),
    0,
    `code_phrase extra dummy rows, inputs=${inputNames(phrase)}`,
  );
  assert(phrase.getField("SLOT_ID"), "code_phrase keeps SLOT_ID");
  assertEquals(phrase.getFieldValue("RM_TYPE"), "CODE_PHRASE");
  phrase.setFieldValue("slot/encoding", "SLOT_ID");
  const saved = Blockly.serialization.blocks.save(phrase) as {
    fields?: Record<string, string>;
  };
  assertEquals(saved.fields?.SLOT_ID, "slot/encoding");

  const qty = workspace.newBlock("dv_quantity");
  assertEquals(
    dummyRowsAfterHeader(qty),
    0,
    `dv_quantity extra dummy rows, inputs=${inputNames(qty)}`,
  );

  const obs = workspace.newBlock("observation");
  syncRmAttributeInputs(obs, "OBSERVATION", ["data", "encoding", "language"]);
  assertEquals(
    dummyRowsAfterHeader(obs),
    0,
    `observation extra dummy rows after sync, inputs=${inputNames(obs)}`,
  );
  const header = obs.getInput("HEADER");
  const headerNames = header?.fieldRow.map((f) => f.name) ?? [];
  assertEquals(headerNames[0], BLOCK_OUT_EMOJI_FIELD);
  assertEquals(headerNames.at(-1), "MUTATOR_COG");
  assert(headerNames.includes("MUTATOR_COG"), "observation header cog");
  assert(
    headerNames.indexOf(BLOCK_OUT_EMOJI_FIELD) < headerNames.indexOf("MUTATOR_COG"),
    "output glyph sits left of the cog",
  );

  const element = workspace.newBlock("element");
  assertEquals(
    dummyRowsAfterHeader(element),
    0,
    `element extra dummy rows, inputs=${inputNames(element)}`,
  );

  const pick = workspace.newBlock("term_pick");
  assertEquals(
    dummyRowsAfterHeader(pick),
    0,
    `term_pick extra dummy rows, inputs=${inputNames(pick)}`,
  );

  workspace.dispose();
});

Deno.test("ENTRY observation mouths trail subject language encoding", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  const attrs = presentFixedAttributeNames(observation);
  assertEquals(attrs.slice(-3), [...ENTRY_BOILERPLATE_ATTRS]);
  assert(attrs.indexOf("data") >= 0);
  assert(attrs.indexOf("data") < attrs.indexOf("subject"));
  workspace.dispose();
});

Deno.test("syncRmAttributeInputs labels statement mouths with RM attribute names", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("observation");
  syncRmAttributeInputs(block, "OBSERVATION", ["protocol", "data"]);
  const labels = block.inputList
    .filter((input) => input.name.startsWith("ATTR_"))
    .map((input) => {
      const field = input.fieldRow[0];
      return isSlotLabelField(field) ? field.attrLabel : (field?.getText?.() ?? "");
    });
  assertEquals(labels, ["data", "protocol"]);
  assert(block.getInput(rmAttributeInputName("data")));
  workspace.dispose();
});

Deno.test("ELEMENT stays ELEMENT and offers null_flavour even when RM_TYPE is a DV", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const element = workspace.newBlock("element");
  element.setFieldValue("DV_TEXT", "RM_TYPE");
  assertEquals(rmTypeOfBlock(element), "ELEMENT");
  const names = buildOptionalRmFlyoutContents(element, []).map((item) => {
    const state = item.extraState as { attr?: string };
    return state.attr;
  });
  assert(names.includes("null_flavour"), names.join(","));
  assert(names.includes("null_reason"), names.join(","));
  assertEquals(names.includes("value"), false);
  assertEquals(names.includes("encoding"), false);
  assertEquals(names.includes("language"), false);
  workspace.dispose();
});

Deno.test("configureElementValueSlot applies typed DATA_VALUE checks", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("element");
  configureElementValueSlot(block, "DV_QUANTITY");
  assertEquals(block.getInput("VALUE")?.connection?.getCheck(), ["DV_QUANTITY"]);
  configureElementValueSlot(block, "DV_CODED_TEXT");
  assertEquals(block.getInput("VALUE")?.connection?.getCheck(), ["DV_CODED_TEXT"]);
  workspace.dispose();
});

Deno.test("DATA_VALUE shell exposes mandatory fields from meta", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const shell = workspace.newBlock("dv_quantity");
  assert(shell.getInput(dvFieldInputName("magnitude")));
  assert(shell.getInput(dvFieldInputName("units")));
  assertEquals(shell.outputConnection?.getCheck(), ["DV_QUANTITY", "DATA_VALUE"]);
  workspace.dispose();
});

Deno.test("loadSkeletonIntoWorkspace auto-attaches mandatory DV shells", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const observation = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("RM_TYPE") === "OBSERVATION",
  );
  assert(observation, "expected observation block");
  assertEquals(observation.type, "observation");
  const root = compositionRoot(workspace);
  assertEquals(root?.type, "composition");
  assertEquals(
    workspace.getAllBlocks(false).some((b) => b.type === "rm_structure"),
    false,
  );
  assert(observation.getInput(rmAttributeInputName("data")), "expected data statement input");
  assert(!observation.getInput("BODY"), "generic children input should not be used");

  const systolic = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("SLOT_ID")?.includes("at0004") && b.type === "element",
  );
  assert(systolic, "expected systolic element block");
  assertEquals(systolic.getInput("VALUE")?.connection?.getCheck(), ["DV_QUANTITY"]);

  const shell = systolic.getInputTargetBlock("VALUE");
  assert(shell && isDataValueBlock(shell), "expected auto-attached DV shell");
  assertEquals(shell.getFieldValue("RM_TYPE"), "DV_QUANTITY");
  assert(shell.getInput(dvFieldInputName("magnitude")));

  workspace.dispose();
});

Deno.test("imported skeleton starts expanded; collapse-all skips the root", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const root = compositionRoot(workspace);
  assert(root, "expected composition instance root");
  assertEquals(root.isCollapsed(), false);

  const nested = workspace.getAllBlocks(false).filter((block) => {
    if (block === root) return false;
    return typeof block.isShadow !== "function" || !block.isShadow();
  });
  assert(nested.length > 0, "expected nested blocks under the root");

  const boilerplate = new Set<string>();
  for (const block of workspace.getAllBlocks(false)) {
    if (!isEntryRmType(rmTypeOfBlock(block))) continue;
    for (const attr of ENTRY_BOILERPLATE_ATTRS) {
      const child = block.getInputTargetBlock(rmAttributeInputName(attr)) ??
        block.getInputTargetBlock(optionalRmInputName(attr));
      if (child && !child.isShadow?.()) boilerplate.add(child.id);
    }
  }
  assert(boilerplate.size > 0, "ENTRY boilerplate children are present");
  for (const block of nested) {
    if (boilerplate.has(block.id)) {
      assertEquals(
        block.isCollapsed(),
        true,
        `${block.type} (${rmTypeOfBlock(block)}) boilerplate child starts collapsed`,
      );
      continue;
    }
    if (isBoilerplateDescendant(block, boilerplate)) continue;
    assertEquals(
      block.isCollapsed(),
      false,
      `${block.type} (${rmTypeOfBlock(block)}) starts expanded`,
    );
  }

  for (const id of boilerplate) {
    const block = workspace.getBlockById(id);
    assert(block, "boilerplate child exists");
    assertEquals(block.isCollapsed(), true, `${block.type} starts collapsed`);
  }

  setAllBlocksCollapsed(workspace, true);
  assertEquals(root.isCollapsed(), false, "root must stay expanded after collapse-all");
  assert(
    nested.some((block) => block.isCollapsed()),
    "collapse-all should collapse at least one nested block",
  );

  root.setCollapsed(true);
  assertEquals(root.isCollapsed(), false, "root must not be collapsible");

  setAllBlocksCollapsed(workspace, false);
  assert(
    nested.every((block) => !block.isCollapsed()),
    "expand-all should expand nested blocks",
  );

  workspace.dispose();
});

Deno.test("ensureElementDataValueShell is idempotent", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const element = workspace.newBlock("element");
  element.setFieldValue("DV_TEXT", "RM_TYPE");
  configureElementValueSlot(element, "DV_TEXT");
  const a = ensureElementDataValueShell(workspace, element, "DV_TEXT");
  const b = ensureElementDataValueShell(workspace, element, "DV_TEXT");
  assert(a && b);
  assertEquals(a.id, b.id);
  workspace.dispose();
});

Deno.test("COMPOSITION toolbox block has mandatory RM slots", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("composition");
  assertEquals(block.getFieldValue("RM_TYPE"), "COMPOSITION");
  assertEquals(
    block.getInput(rmAttributeInputName("language"))?.connection?.getCheck(),
    ["CODE_PHRASE"],
  );
  assertEquals(
    block.getInput(rmAttributeInputName("territory"))?.connection?.getCheck(),
    ["CODE_PHRASE"],
  );
  assertEquals(
    block.getInput(rmAttributeInputName("category"))?.connection?.getCheck(),
    ["DV_CODED_TEXT"],
  );
  assertEquals(
    block.getInput(rmAttributeInputName("composer"))?.connection?.getCheck(),
    ["PARTY_PROXY"],
  );
  assertEquals(block.getInput(rmAttributeInputName("content"))?.connection?.getCheck(), [
    "CONTENT_ITEM",
  ]);
  assert(block.getInput(rmAttributeInputName("context")), "expected context statement");
  assert(block.previousConnection, "COMPOSITION accepts Conversion start on previous notch");
  const prevCheck = block.previousConnection?.getCheck();
  assertEquals(
    prevCheck === "INSTANCE_ROOT" || (Array.isArray(prevCheck) && prevCheck.includes("INSTANCE_ROOT")),
    true,
  );
  workspace.dispose();
});

Deno.test("SECTION and OBSERVATION nest into COMPOSITION content", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  const section = workspace.newBlock("section");
  const observation = workspace.newBlock("observation");
  const content = composition.getInput(rmAttributeInputName("content"))?.connection;
  assert(content && section.previousConnection);
  content.connect(section.previousConnection);
  assertEquals(section.getParent()?.id, composition.id);
  assert(observation.previousConnection);
  section.nextConnection?.connect(observation.previousConnection);
  assertEquals(observation.getRootBlock().id, composition.id);
  workspace.dispose();
});

Deno.test("ENTRY subclasses EVALUATION INSTRUCTION ACTION ADMIN_ENTRY nest as CONTENT_ITEM", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  const content = composition.getInput(rmAttributeInputName("content"))?.connection;
  assert(content);
  for (const type of ["evaluation", "instruction", "action", "admin_entry"]) {
    const child = workspace.newBlock(type);
    assertEquals(child.getFieldValue("RM_TYPE"), type.toUpperCase());
    assert(child.previousConnection);
    content.connect(child.previousConnection);
    assertEquals(child.getParent()?.id, composition.id);
    child.unplug();
  }
  workspace.dispose();
});

Deno.test("PARTY_PROXY specialization slot accepts PARTY_SELF IDENTIFIED RELATED", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const proxy = workspace.newBlock("party_proxy");
  const kind = proxy.getInput(RM_SPECIALIZATION_INPUT);
  assert(kind?.connection, "expected PARTY_PROXY specialization puzzle");
  assertEquals(kind.connection.getCheck()?.slice().sort(), [
    "PARTY_IDENTIFIED",
    "PARTY_RELATED",
    "PARTY_SELF",
  ]);
  const kindEmoji = kind.fieldRow.at(-1);
  assertEquals(kindEmoji?.getText(), ABSTRACT_SLOT_GLYPH);
  assertEquals(isRmTypeEmojiField(kindEmoji ?? null), true);
  assertEquals(kindEmoji?.getTooltip?.()?.includes("PARTY_PROXY (abstract)"), true);
  assertEquals(kindEmoji?.getTooltip?.()?.includes("PARTY_SELF"), true);
  for (const type of ["party_self", "party_identified", "party_related"]) {
    const child = workspace.newBlock(type);
    assert(child.outputConnection);
    kind.connection.connect(child.outputConnection);
    assertEquals(child.getParent()?.id, proxy.id);
    child.unplug();
  }
  workspace.dispose();
});

Deno.test("PARTY_IDENTIFIED and PARTY_RELATED nest into COMPOSITION composer", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  const composer = composition.getInput(rmAttributeInputName("composer"))?.connection;
  assert(composer);
  assertEquals(composer.getCheck(), ["PARTY_PROXY"]);
  for (const type of ["party_identified", "party_related", "party_self"]) {
    const child = workspace.newBlock(type);
    assert(child.outputConnection);
    composer.connect(child.outputConnection);
    assertEquals(child.getParent()?.id, composition.id);
    child.unplug();
  }
  workspace.dispose();
});

Deno.test("EVENT_CONTEXT health_care_facility accepts PARTY_IDENTIFIED not PARTY_SELF", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const context = workspace.newBlock("event_context");
  syncRmAttributeInputs(context, "EVENT_CONTEXT", ["start_time", "setting", "health_care_facility"]);
  const facility = context.getInput(rmAttributeInputName("health_care_facility"))?.connection;
  assert(facility);
  assertEquals(facility.getCheck(), ["PARTY_IDENTIFIED"]);
  for (const type of ["party_identified", "party_related"]) {
    const child = workspace.newBlock(type);
    assert(child.outputConnection);
    facility.connect(child.outputConnection);
    assertEquals(child.getParent()?.id, context.id);
    child.unplug();
  }
  const self = workspace.newBlock("party_self");
  assertEquals(
    workspace.connectionChecker.canConnect(facility, self.outputConnection!, false),
    false,
  );
  workspace.dispose();
});

Deno.test("PARTY_PROXY subclasses nest into ENTRY subject", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  syncRmAttributeInputs(observation, "OBSERVATION", ["data", "subject"]);
  const subject = observation.getInput(rmAttributeInputName("subject"))?.connection;
  assert(subject);
  assertEquals(subject.getCheck(), ["PARTY_PROXY"]);
  for (const type of ["party_self", "party_identified", "party_related", "party_proxy"]) {
    const child = workspace.newBlock(type);
    assert(child.outputConnection);
    subject.connect(child.outputConnection);
    assertEquals(child.getParent()?.id, observation.id);
    child.unplug();
  }
  workspace.dispose();
});

Deno.test("ELEMENT block is labelled ELEMENT in the header", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const block = workspace.newBlock("element");
  assertEquals(block.getFieldValue("RM_TYPE"), "ELEMENT");
  assertEquals(block.getField(BLOCK_OUT_EMOJI_FIELD)?.getText(), zipehrEmojiForRmType("ELEMENT"));
  const title = block.getField("NAME");
  assert(isSkeletonTitleField(title));
  assertEquals(title.classNameText(), "ELEMENT");
  workspace.dispose();
});

Deno.test("ZipEHR emojis sit on block output and slot connections", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();

  const qty = workspace.newBlock("dv_quantity");
  const qtyOut = qty.getField(BLOCK_OUT_EMOJI_FIELD);
  assertEquals(qtyOut?.getText(), zipehrEmojiForRmType("DV_QUANTITY"));
  assertEquals(qtyOut?.getTooltip?.(), "DV_QUANTITY");
  assertEquals(isRmTypeEmojiField(qtyOut), true);
  qtyOut?.updateSize_?.();
  assertEquals(qtyOut?.getSize()?.height, RM_EMOJI_FONT_PX);
  const magnitude = qty.getInput(dvFieldInputName("magnitude"));
  const magnitudeLabel = magnitude?.fieldRow[0];
  assert(isSlotLabelField(magnitudeLabel), "DV field captions reuse FieldSlotLabel");
  assertEquals(magnitudeLabel.attrLabel, "magnitude");
  assertEquals(magnitudeLabel.rmType(), "Real");
  assertEquals(
    magnitudeLabel.getText().includes(zipehrEmojiForRmType("Real") ?? ""),
    true,
  );

  const dvText = workspace.newBlock("dv_text");
  const textOut = dvText.getField(BLOCK_OUT_EMOJI_FIELD);
  textOut?.updateSize_?.();
  assertEquals(textOut?.getSize()?.height, RM_EMOJI_LARGE_FONT_PX);

  const observation = workspace.newBlock("observation");
  assertEquals(
    observation.getField(BLOCK_OUT_EMOJI_FIELD)?.getText(),
    zipehrEmojiForRmType("OBSERVATION"),
  );
  const data = observation.getInput(rmAttributeInputName("data"));
  const dataLabel = data?.fieldRow[0];
  assert(isSlotLabelField(dataLabel));
  assertEquals(dataLabel.attrLabel, "data");
  assertEquals(dataLabel.getText(), `data [1..1] ${zipehrEmojiForRmType("HISTORY")}`);

  const element = workspace.newBlock("element");
  const value = element.getInput("VALUE");
  const valueLabel = value?.fieldRow[0];
  assert(isSlotLabelField(valueLabel));
  // Abstract ⁇ is drawn as an underlined tspan, not part of Field.getText().
  // ELEMENT.value is RM 0..1 DATA_VALUE even after the mouth is narrowed to a leaf.
  assertEquals(valueLabel.getText(), "value [0..1]");
  assertEquals(valueLabel.rmType(), "DATA_VALUE");
  configureElementValueSlot(element, "DV_QUANTITY");
  assertEquals(valueLabel.getText(), "value [0..1]");
  assertEquals(valueLabel.rmType(), "DATA_VALUE");
  configureElementValueSlot(element, "DV_CODED_TEXT");
  assertEquals(valueLabel.getText(), "value [0..1]");
  assertEquals(valueLabel.rmType(), "DATA_VALUE");

  const composition = workspace.newBlock("composition");
  const content = composition.getInput(rmAttributeInputName("content"));
  const contentLabel = content?.fieldRow[0];
  assert(isSlotLabelField(contentLabel));
  assertEquals(contentLabel.getText().includes(ABSTRACT_SLOT_GLYPH), false);
  assertEquals(contentLabel.rmType(), "CONTENT_ITEM");

  const composer = composition.getInput(rmAttributeInputName("composer"));
  const composerLabel = composer?.fieldRow[0];
  assert(isSlotLabelField(composerLabel));
  assertEquals(composerLabel.getText().includes(ABSTRACT_SLOT_GLYPH), false);
  assertEquals(composerLabel.rmType(), "PARTY_PROXY");
  assertEquals(rmTypeConnectionTooltip(composerLabel.rmType()).includes("PARTY_SELF"), true);

  const history = workspace.newBlock("history");
  assert(history.getInput(rmAttributeInputName("events")), "HISTORY.events is a fixed mouth");
  assert(history.getInput(rmAttributeInputName("origin")), "HISTORY.origin stays visible");
  const eventsLabel = history.getInput(rmAttributeInputName("events"))?.fieldRow[0];
  assert(isSlotLabelField(eventsLabel));
  assertEquals(eventsLabel.attrLabel, "events");

  workspace.dispose();
});

Deno.test("openEHR class chrome stays left; slot captions hug mouths", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  assertEquals(observation.getInputsInline(), false);
  assertEquals(observation.getInput("HEADER")?.align, Blockly.inputs.Align.LEFT);
  const data = observation.getInput(rmAttributeInputName("data"));
  assertEquals(data?.align, Blockly.inputs.Align.RIGHT);

  const element = workspace.newBlock("element");
  assertEquals(element.getInputsInline(), false);
  assertEquals(element.getInput("HEADER")?.align, Blockly.inputs.Align.LEFT);
  assertEquals(element.getInput("VALUE")?.align, Blockly.inputs.Align.RIGHT);

  // Saved inline state must not stick after layout enforcement.
  element.setInputsInline(true);
  element.getInput("HEADER")?.setAlign(Blockly.inputs.Align.RIGHT);
  enforceOpenEhrBlockLayout(element);
  assertEquals(element.getInputsInline(), false);
  assertEquals(element.getInput("HEADER")?.align, Blockly.inputs.Align.LEFT);
  assertEquals(element.getInput("VALUE")?.align, Blockly.inputs.Align.RIGHT);
  workspace.dispose();
});
Deno.test("Optional RM Insertion attaches a typed child without clearing the canvas", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);
  const root = compositionRoot(workspace);
  assert(root);
  const beforeIds = new Set(workspace.getAllBlocks(false).map((b) => b.id));
  const child = attachOptionalRmChild(workspace as unknown as Blockly.WorkspaceSvg, root, {
    rmType: "FEEDER_AUDIT",
    attributeName: "feeder_audit",
    label: "Feeder Audit",
  });
  assert(child, "expected feeder_audit child block");
  assertEquals(child.type, "feeder_audit");
  assertEquals(child.getParent()?.id, root.id);
  assertEquals(root.type, "composition");
  for (const id of beforeIds) {
    assert(workspace.getBlockById(id), `existing block ${id} should stay on the canvas`);
  }
  workspace.dispose();
});

Deno.test("optional code-set attribute scaffolds a built-in term pick with no flavour chosen", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const element = workspace.newBlock("element");
  element.setFieldValue("ELEMENT", "RM_TYPE");
  element.setFieldValue("el/value", "SLOT_ID");
  const child = attachOptionalRmChild(workspace as unknown as Blockly.WorkspaceSvg, element, {
    rmType: "DV_CODED_TEXT",
    attributeName: "null_flavour",
  });
  assert(child, "expected built-in null_flavour block");
  assertEquals(child.type, "term_pick");
  assertEquals(child.getFieldValue("SET"), "openehr:null_flavours");
  assertEquals(child.getFieldValue("CODE"), TERM_PICK_NONE);
  const title = child.getField("NAME");
  assert(isSkeletonTitleField(title));
  assertEquals(title.getValue(), "built-in");
  assertEquals(child.getParent()?.id, element.id);
  workspace.dispose();
});

Deno.test("optional abstract RM attribute opens an empty mouth", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  composition.setFieldValue("COMPOSITION", "RM_TYPE");
  composition.setFieldValue("comp", "SLOT_ID");
  const child = attachOptionalRmChild(workspace as unknown as Blockly.WorkspaceSvg, composition, {
    rmType: "UID_BASED_ID",
    attributeName: "uid",
    label: "Uid",
  });
  assertEquals(child, null);
  const mouth = composition.getInput(optionalRmInputName("uid")) ??
    composition.getInput(rmAttributeInputName("uid"));
  assert(mouth, "expected uid mouth");
  assertEquals(mouth.connection?.targetBlock() ?? null, null);
  assertEquals(
    workspace.getAllBlocks(false).some((block) => block.type === "uid_based_id"),
    false,
  );
  workspace.dispose();
});

Deno.test("optional concrete RM still scaffolds, without an abstract descendant", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  observation.setFieldValue("OBSERVATION", "RM_TYPE");
  observation.setFieldValue("obs", "SLOT_ID");
  const child = attachOptionalRmChild(workspace as unknown as Blockly.WorkspaceSvg, observation, {
    rmType: "HISTORY",
    attributeName: "state",
    label: "State",
  });
  assert(child, "expected HISTORY scaffold for state");
  assertEquals(child.getFieldValue("RM_TYPE"), "HISTORY");
  const descendants = child.getDescendants(false);
  assertEquals(
    descendants.some((block) => String(block.getFieldValue("RM_TYPE") || "").toUpperCase() === "EVENT"),
    false,
  );
  assert(
    descendants.some((block) => String(block.getFieldValue("RM_TYPE") || "").toUpperCase() === "DV_DATE_TIME"),
    "origin stays on the concrete HISTORY scaffold",
  );
  workspace.dispose();
});

Deno.test("term_pick can be configured to a composition category code", () => {
  ensureBlocks();
  const set = termSetById("openehr:composition_category");
  assert(set, "expected composition_category term set");
  const workspace = new Blockly.Workspace();
  const block = createTermPickBlock(workspace, set, "433", "slot/category");
  assertEquals(block.getFieldValue("SET"), "openehr:composition_category");
  assertEquals(block.getFieldValue("CODE"), "433");
  assertEquals(block.getFieldValue("SLOT_ID"), "slot/category");
  const title = block.getField("NAME");
  assert(isSkeletonTitleField(title), "expected two-line built-in title");
  assertEquals(title.getValue(), "built-in");
  assertEquals(title.classNameText(), "DV_CODED_TEXT");
  workspace.dispose();
});

Deno.test("DATA_VALUE shells use two-line titles with the real RM class name", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const qty = workspace.newBlock("dv_quantity");
  const title = qty.getField("NAME");
  assert(isSkeletonTitleField(title));
  assertEquals(title.classNameText(), "DV_QUANTITY");
  assertEquals(title.getValue(), humanizeRmType("DV_QUANTITY"));
  assertEquals(humanizeRmType("DV_QUANTITY"), "Quantity");
  assertEquals(humanizeRmType("DV_CODED_TEXT"), "Coded Text");

  const phrase = workspace.newBlock("code_phrase");
  const phraseTitle = phrase.getField("NAME");
  assert(isSkeletonTitleField(phraseTitle));
  assertEquals(phraseTitle.classNameText(), "CODE_PHRASE");
  assertEquals(phraseTitle.getValue(), "Code Phrase");
  workspace.dispose();
});

Deno.test("termSetForMandatedCode finds built-in composition category and not local codes", () => {
  const category = termSetForMandatedCode("openehr", "433");
  assertEquals(category?.id, "openehr:composition_category");
  assertEquals(termSetForMandatedCode("local", "at1000"), undefined);
});

Deno.test("skeleton canvas plugs language and territory Defaults lookups into CODE_PHRASE mouths", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const composition = compositionRoot(workspace);
  assertEquals(composition?.type, "composition");
  const languageInput = composition.getInput(rmAttributeInputName("language"));
  assertEquals(languageInput?.connection?.getCheck(), ["CODE_PHRASE"]);
  const language = composition.getInputTargetBlock(rmAttributeInputName("language"));
  assert(language, "expected maps_get on COMPOSITION.language");
  assertEquals(language.type, "maps_get");
  assertEquals(language.getInputTargetBlock("KEY")?.getFieldValue("TEXT"), "language");
  assertEquals(language.type === "element", false);

  const territory = composition.getInputTargetBlock(rmAttributeInputName("territory"));
  assertEquals(territory?.type, "maps_get");
  assertEquals(territory?.getInputTargetBlock("KEY")?.getFieldValue("TEXT"), "territory");

  const category = composition.getInputTargetBlock(rmAttributeInputName("category"));
  assertEquals(category?.type, "term_pick");
  assertEquals(category?.getFieldValue("SET"), "openehr:composition_category");
  assertEquals(category?.getFieldValue("CODE"), "433");
  const categoryTitle = category?.getField("NAME");
  assert(isSkeletonTitleField(categoryTitle));
  assertEquals(categoryTitle.getValue(), "built-in");
  assertEquals(categoryTitle.classNameText(), "DV_CODED_TEXT");

  const observation = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("RM_TYPE") === "OBSERVATION",
  );
  assert(observation, "expected observation");
  const encoding = observation.getInputTargetBlock(rmAttributeInputName("encoding"));
  assertEquals(encoding?.type, "maps_get");
  assertEquals(encoding?.getInputTargetBlock("KEY")?.getFieldValue("TEXT"), "encoding");

  workspace.dispose();
});

Deno.test("skeleton canvas pre-fills COMPOSITION.category from the template", () => {
  ensureBlocks();
  const persistent = fixture.replace(
    "<code_list>433</code_list>",
    "<code_list>431</code_list>",
  );
  const { skeleton } = generateSkeleton(persistent);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);
  const composition = compositionRoot(workspace);
  const category = composition.getInputTargetBlock(rmAttributeInputName("category"));
  assertEquals(category?.type, "term_pick");
  assertEquals(category?.getFieldValue("CODE"), "431");
  workspace.dispose();
});

Deno.test("optional content observations still scaffold on the canvas", () => {
  ensureBlocks();
  const skeleton: SkeletonNode[] = [{
    slotId: "t",
    blockType: "composition",
    rmType: "COMPOSITION",
    label: "Encounter",
    kind: "container",
    mandatory: true,
    children: [{
      slotId: "t/content/bp",
      blockType: "observation",
      rmType: "OBSERVATION",
      label: "Blood pressure",
      rmAttribute: "content",
      kind: "container",
      mandatory: false,
      children: [],
    }],
  }];
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);
  const composition = compositionRoot(workspace);
  const content = composition?.getInputTargetBlock(rmAttributeInputName("content"));
  assertEquals(content?.type, "observation");
  assertEquals(content?.getFieldValue("NAME"), "Blood pressure");
  workspace.dispose();
});

Deno.test("applyFixedFieldsToDataValueShell fills CODE_PHRASE terminology", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const shell = workspace.newBlock("code_phrase");
  applyFixedFieldsToDataValueShell(workspace, shell, { terminology_id: "ISO_639-1" });
  const term = shell.getInputTargetBlock(dvFieldInputName("terminology_id"));
  assertEquals(term?.getFieldValue("TEXT"), "ISO_639-1");
  workspace.dispose();
});

Deno.test("skeleton canvas picks Position from a list of complete DV_CODED_TEXT objects", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const position = workspace.getAllBlocks(false).find(
    (b) => b.type === "element" && b.getFieldValue("NAME") === "Position",
  );
  assert(position, "expected Position ELEMENT on the canvas");
  const selector = position.getInputTargetBlock("VALUE");
  assertEquals(selector?.type, "lists_getIndex");
  assertEquals(selector?.getFieldValue("MODE"), "GET");
  // Template assumed_value is Sitting (at1001), the second list item (1-based index 2).
  assertEquals(selector?.getFieldValue("WHERE"), "FROM_START");
  assertEquals(selector?.getInputTargetBlock("AT")?.getFieldValue("NUM"), 2);

  const list = selector?.getInputTargetBlock("VALUE");
  assertEquals(list?.type, "lists_create_with");
  assertEquals((list as { itemCount_?: number } | null)?.itemCount_, 6);

  const standing = list?.getInputTargetBlock("ADD0");
  assert(standing && isDataValueBlock(standing), "expected a DV_CODED_TEXT list item");
  assertEquals(standing.getFieldValue("RM_TYPE"), "DV_CODED_TEXT");
  assertEquals(
    standing.getInputTargetBlock(dvFieldInputName("value"))?.getFieldValue("TEXT"),
    "Standing",
  );
  const standingCode = standing.getInputTargetBlock(dvFieldInputName("defining_code"));
  assertEquals(standingCode?.type, "code_phrase");
  assertEquals(
    standingCode?.getInputTargetBlock(dvFieldInputName("code_string"))?.getFieldValue("TEXT"),
    "at1000",
  );
  assertEquals(
    standingCode?.getInputTargetBlock(dvFieldInputName("terminology_id"))?.getFieldValue("TEXT"),
    "local",
  );

  const sitting = list?.getInputTargetBlock("ADD1");
  assertEquals(
    sitting?.getInputTargetBlock(dvFieldInputName("value"))?.getFieldValue("TEXT"),
    "Sitting",
  );
  assertEquals(
    sitting?.getInputTargetBlock(dvFieldInputName("defining_code"))
      ?.getInputTargetBlock(dvFieldInputName("code_string"))
      ?.getFieldValue("TEXT"),
    "at1001",
  );

  workspace.dispose();
});

Deno.test("skeleton canvas picks Vocalization from a list of complete DV_ORDINAL objects", () => {
  ensureBlocks();
  // Synthetic ELEMENT: constrain_test marks Abbey Vocalization optional, so the
  // full OPT walk would hide it; exercise the ordinal choice-list scaffolder directly.
  const skeleton: SkeletonNode[] = [{
    slotId: "pain/content/vocalization",
    blockType: "element",
    rmType: "ELEMENT",
    label: "Vocalization",
    kind: "container",
    mandatory: true,
    children: [{
      slotId: "pain/content/vocalization/value",
      blockType: "dv_ordinal",
      rmType: "DV_ORDINAL",
      label: "Vocalization",
      rmAttribute: "value",
      kind: "value",
      mandatory: true,
      children: [],
      allowedOrdinals: [
        { value: 0, code: "at0010", label: "Absent", terminologyId: "local" },
        { value: 1, code: "at0011", label: "Occasional", terminologyId: "local" },
        { value: 2, code: "at0012", label: "Frequent", terminologyId: "local" },
        { value: 3, code: "at0013", label: "Constant", terminologyId: "local" },
      ],
    }],
  }];
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const vocalization = workspace.getAllBlocks(false).find(
    (b) => b.type === "element" && b.getFieldValue("NAME") === "Vocalization",
  );
  assert(vocalization, "expected Vocalization ELEMENT on the canvas");
  const selector = vocalization.getInputTargetBlock("VALUE");
  assertEquals(selector?.type, "lists_getIndex");
  const list = selector?.getInputTargetBlock("VALUE");
  assertEquals(list?.type, "lists_create_with");
  assertEquals((list as { itemCount_?: number } | null)?.itemCount_, 4);

  const absent = list?.getInputTargetBlock("ADD0");
  assert(absent && isDataValueBlock(absent), "expected a DV_ORDINAL list item");
  assertEquals(absent.getFieldValue("RM_TYPE"), "DV_ORDINAL");
  assertEquals(
    absent.getInputTargetBlock(dvFieldInputName("value"))?.getFieldValue("NUM"),
    0,
  );
  const absentSymbol = absent.getInputTargetBlock(dvFieldInputName("symbol"));
  assert(absentSymbol && isDataValueBlock(absentSymbol));
  assertEquals(absentSymbol.getFieldValue("RM_TYPE"), "DV_CODED_TEXT");
  assertEquals(
    absentSymbol.getInputTargetBlock(dvFieldInputName("value"))?.getFieldValue("TEXT"),
    "Absent",
  );
  assertEquals(
    absentSymbol.getInputTargetBlock(dvFieldInputName("defining_code"))
      ?.getInputTargetBlock(dvFieldInputName("code_string"))
      ?.getFieldValue("TEXT"),
    "at0010",
  );

  workspace.dispose();
});

Deno.test("skeleton canvas scaffolds DV_SCALE choices as complete objects", () => {
  ensureBlocks();
  const skeleton: SkeletonNode[] = [{
    slotId: "borg/content/breathlessness/value",
    blockType: "dv_scale",
    rmType: "DV_SCALE",
    label: "Breathlessness",
    kind: "value",
    mandatory: true,
    children: [],
    allowedOrdinals: [
      { value: 0, code: "at0001", label: "No breathlessness", terminologyId: "local" },
      { value: 0.5, code: "at0002", label: "Very slight", terminologyId: "local", assumed: true },
      { value: 1, code: "at0003", label: "Slight", terminologyId: "local" },
    ],
  }];
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("borg"), null);

  const selector = workspace.getAllBlocks(false).find((b) => b.type === "lists_getIndex");
  assert(selector, "expected lists_getIndex for DV_SCALE choices");
  assertEquals(selector.getFieldValue("WHERE"), "FROM_START");
  assertEquals(selector.getInputTargetBlock("AT")?.getFieldValue("NUM"), 2);

  const list = selector.getInputTargetBlock("VALUE");
  const slight = list?.getInputTargetBlock("ADD2");
  assert(slight && isDataValueBlock(slight));
  assertEquals(slight.getFieldValue("RM_TYPE"), "DV_SCALE");
  assertEquals(
    slight.getInputTargetBlock(dvFieldInputName("value"))?.getFieldValue("NUM"),
    1,
  );

  workspace.dispose();
});

Deno.test("skeleton canvas fills DV_QUANTITY units from the template", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const systolic = workspace.getAllBlocks(false).find(
    (b) => b.type === "element" && b.getFieldValue("NAME") === "Systolic",
  );
  assert(systolic, "expected Systolic ELEMENT");
  const shell = systolic.getInputTargetBlock("VALUE");
  assert(shell && isDataValueBlock(shell), "expected DV_QUANTITY shell");
  assertEquals(shell.getFieldValue("RM_TYPE"), "DV_QUANTITY");
  assertEquals(
    shell.getInputTargetBlock(dvFieldInputName("units"))?.getFieldValue("TEXT"),
    "mm[Hg]",
  );

  workspace.dispose();
});

Deno.test("simple-diagnose-and-vitals OPT scaffolds unique and alternative quantity units", () => {
  ensureBlocks();
  const diagnose = Deno.readTextFileSync(
    join(import.meta.dirname!, "fixtures", "simple-diagnose-and-vitals.opt"),
  );
  const { skeleton } = generateSkeleton(diagnose);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const systolic = workspace.getAllBlocks(false).find(
    (b) => b.type === "element" && b.getFieldValue("NAME") === "Systolic",
  );
  assert(systolic, "expected Systolic ELEMENT");
  const sysShell = systolic.getInputTargetBlock("VALUE");
  assert(sysShell && isDataValueBlock(sysShell), "expected DV_QUANTITY on Systolic");
  assertEquals(
    sysShell.getInputTargetBlock(dvFieldInputName("units"))?.getFieldValue("TEXT"),
    "mm[Hg]",
  );

  const temperature = workspace.getAllBlocks(false).find(
    (b) => b.type === "element" && b.getFieldValue("NAME") === "Temperature",
  );
  assert(temperature, "expected Temperature ELEMENT");
  const tempShell = temperature.getInputTargetBlock("VALUE");
  assert(tempShell, "expected DV_QUANTITY on Temperature");
  const tempUnits = tempShell.getInputTargetBlock(dvFieldInputName("units"));
  assert(tempUnits, "Temperature units mouth must be scaffolded");
  const unitList = tempUnits.getInputTargetBlock("VALUE");
  const listed = [
    unitList?.getInputTargetBlock("ADD0")?.getFieldValue("TEXT"),
    unitList?.getInputTargetBlock("ADD1")?.getFieldValue("TEXT"),
  ];
  assertEquals(listed.includes("Cel"), true, String(listed));
  assertEquals(listed.includes("[degF]"), true, String(listed));

  workspace.dispose();
});

Deno.test("skeleton header stacks RM class and at-code under the node name", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);

  const observation = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("RM_TYPE") === "OBSERVATION",
  );
  assert(observation, "expected OBSERVATION block");
  const title = observation.getField("NAME");
  assert(isSkeletonTitleField(title), "expected FieldSkeletonTitle on NAME");
  assertEquals(title.classNameText(), "OBSERVATION");
  assert(title.atCode().startsWith("at"), `expected at-code, got ${title.atCode()}`);
  assertEquals(observation.getField("AT_CODE"), null);

  workspace.dispose();
});

Deno.test("mandatory containers do not get a warning triangle just for being mandatory", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);
  const composition = compositionRoot(workspace);
  assert(composition);
  const warning = (warningTextOf(composition) ?? blockConstraintMessages(composition).join("\n"));
  assertEquals(warning.includes("Mandatory"), false);
  const observation = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("RM_TYPE") === "OBSERVATION",
  );
  assert(observation);
  assertEquals(
    (warningTextOf(observation) ?? blockConstraintMessages(observation).join("\n")).includes("Mandatory"),
    false,
  );
  workspace.dispose();
});

Deno.test("slots show combined name, [min..max], and ZipEHR glyph in one caption", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  syncRmAttributeInputs(observation, "OBSERVATION", ["data"]);
  const data = observation.getInput(rmAttributeInputName("data"));
  assert(data);
  const label = data.fieldRow.find((field) => isSlotLabelField(field));
  assert(label);
  assertEquals(label.attrLabel, "data");
  assertEquals(isSlotCardinalityField(label), true);
  assertEquals(label.min, 1);
  assertEquals(label.max, 1);
  assertEquals(
    label.getText(),
    `data ${formatSlotCardinality({ min: 1, max: 1 })} ${zipehrEmojiForRmType("HISTORY")}`,
  );
  workspace.dispose();
});

Deno.test("unmapped mandatory ELEMENT shows a constraint warning", () => {
  ensureBlocks();
  const { skeleton } = generateSkeleton(fixture);
  const workspace = new Blockly.Workspace();
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null);
  const systolic = workspace.getAllBlocks(false).find(
    (b) => b.getFieldValue("NAME") === "Systolic" && b.type === "element",
  );
  assert(systolic, "expected systolic element");
  assertEquals(systolic.getFieldValue("MANDATORY"), "1");
  const text = warningTextOf(systolic) ?? blockConstraintMessages(systolic).join("\n");
  assertEquals(text.includes("Unmapped mandatory value"), true);
  workspace.dispose();
});

Deno.test("EVENT.data slot accepts ITEM_STRUCTURE (generic T bound)", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const event = workspace.newBlock("event");
  syncRmAttributeInputs(event, "EVENT", ["time", "data"]);
  const dataInput = event.getInput(rmAttributeInputName("data"));
  const check = dataInput?.connection?.getCheck() ?? [];
  assertEquals(check.includes("ITEM_STRUCTURE"), true);
  assertEquals(check.includes("ITEM_TREE"), true);
  workspace.dispose();
});

Deno.test("EVENT block warns while abstract and can switch subtype without dropping children", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const event = workspace.newBlock("event");
  event.setFieldValue("EVENT", "RM_TYPE");
  syncRmAttributeInputs(event, "EVENT", ["time", "data"]);
  const data = workspace.newBlock("item_tree");
  const dataInput = event.getInput(rmAttributeInputName("data"));
  assert(dataInput?.connection && data.previousConnection);
  dataInput.connection.connect(data.previousConnection);
  assertEquals(event.getInputTargetBlock(rmAttributeInputName("data"))?.id, data.id);
  refreshWorkspaceConstraints(workspace);
  assertEquals(blockConstraintMessages(event).includes(ABSTRACT_EVENT_WARNING), true);

  applyEventRmType(event, "POINT_EVENT");
  refreshWorkspaceConstraints(workspace);
  assertEquals(event.getFieldValue("RM_TYPE"), "POINT_EVENT");
  assertEquals(event.getInputTargetBlock(rmAttributeInputName("data"))?.id, data.id);
  assertEquals(blockConstraintMessages(event).includes(ABSTRACT_EVENT_WARNING), false);

  applyEventRmType(event, "INTERVAL_EVENT");
  assertEquals(event.getFieldValue("RM_TYPE"), "INTERVAL_EVENT");
  assertEquals(event.getInputTargetBlock(rmAttributeInputName("data"))?.id, data.id);
  assert(event.getInput(rmAttributeInputName("width")), "INTERVAL_EVENT.width should appear");
  assert(event.getInput(rmAttributeInputName("math_function")), "INTERVAL_EVENT.math_function should appear");
  const mathPick = event.getInputTargetBlock(rmAttributeInputName("math_function"));
  assertEquals(mathPick?.type, "term_pick");
  assertEquals(mathPick?.getFieldValue("CODE"), TERM_PICK_NONE);
  workspace.dispose();
});

Deno.test("INTERVAL_EVENT math_function scaffold uses mandated code only when provided", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const set = termSetForRmAttribute("INTERVAL_EVENT", "math_function");
  assert(set && set.codes.length > 0, "event_math_function catalog");
  const mandated = set.codes[0]!.code;
  const event = workspace.newBlock("event");
  applyEventRmType(event, "INTERVAL_EVENT", { mandatedMathFunction: mandated });
  const mathPick = event.getInputTargetBlock(rmAttributeInputName("math_function"));
  assertEquals(mathPick?.type, "term_pick");
  assertEquals(mathPick?.getFieldValue("CODE"), mandated);
  // Re-applying must not replace an already-attached pick.
  applyEventRmType(event, "INTERVAL_EVENT");
  assertEquals(
    event.getInputTargetBlock(rmAttributeInputName("math_function"))?.id,
    mathPick?.id,
  );
  workspace.dispose();
});

Deno.test("Blockly JSON extraState restores dynamic ATTR_ sockets including EVENT extras", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const observation = workspace.newBlock("observation");
  syncRmAttributeInputs(observation, "OBSERVATION", ["data", "encoding"]);
  const event = workspace.newBlock("event");
  applyEventRmType(event, "INTERVAL_EVENT");
  const tree = workspace.newBlock("item_tree");
  event.getInput(rmAttributeInputName("data"))!.connection!.connect(tree.previousConnection!);

  const saved = Blockly.serialization.workspaces.save(workspace);
  workspace.dispose();

  const loaded = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(saved, loaded);
  const obs2 = loaded.getAllBlocks(false).find((b) => b.type === "observation");
  const ev2 = loaded.getAllBlocks(false).find((b) => b.type === "event");
  assert(obs2?.getInput(rmAttributeInputName("encoding")), "ATTR_encoding must round-trip");
  assertEquals(ev2?.getFieldValue("RM_TYPE"), "INTERVAL_EVENT");
  assert(ev2?.getInput(rmAttributeInputName("width")), "INTERVAL width must round-trip");
  assertEquals(ev2?.getInputTargetBlock(rmAttributeInputName("data"))?.type, "item_tree");
  loaded.dispose();
});

Deno.test("optional RM extraState keeps OPT_ mouths distinct from ATTR_", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const context = workspace.newBlock("event_context") as Blockly.Block & {
    addInput_?: (name: string) => void;
  };
  context.addInput_?.("health_care_facility");
  const mouth = context.getInput(optionalRmInputName("health_care_facility"));
  assert(mouth?.connection, "expected OPT_health_care_facility after addInput_");
  const party = workspace.newBlock("party_identified");
  mouth.connection.connect(party.outputConnection!);
  const saved = Blockly.serialization.workspaces.save(workspace) as {
    blocks?: { blocks?: Array<{ extraState?: { extras?: string[]; attrs?: string[] }; inputs?: Record<string, unknown> }> };
  };
  workspace.dispose();
  const ctxSaved = saved.blocks?.blocks?.find((block) =>
    (block as { type?: string }).type === "event_context"
  ) as { extraState?: { extras?: string[]; attrs?: string[] }; inputs?: Record<string, unknown>; type?: string } | undefined
    ?? (saved as { extraState?: { extras?: string[]; attrs?: string[] }; inputs?: Record<string, unknown>; type?: string });
  assertEquals(ctxSaved?.extraState?.extras?.includes("health_care_facility"), true);
  assertEquals(ctxSaved?.extraState?.attrs?.includes("health_care_facility"), false);
  assert(ctxSaved?.inputs && "OPT_health_care_facility" in ctxSaved.inputs);

  const loaded = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(saved, loaded);
  const ctx2 = loaded.getAllBlocks(false).find((block) => block.type === "event_context");
  assert(ctx2?.getInput(optionalRmInputName("health_care_facility")), "OPT_health_care_facility must round-trip");
  assertEquals(
    ctx2?.getInputTargetBlock(optionalRmInputName("health_care_facility"))?.type,
    "party_identified",
  );
  loaded.dispose();
});

Deno.test("PARTY_IDENTIFIED exposes identity slots for compositions", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const party = workspace.newBlock("party_identified");
  assert(party.getInput(rmAttributeInputName("name")), "party_identified should expose name");
  assert(party.getInput(rmAttributeInputName("identifiers")), "party_identified should expose identifiers");
  assert(party.getInput(rmAttributeInputName("external_ref")), "party_identified should expose external_ref");
  const idInput = party.getInput(rmAttributeInputName("identifiers"));
  const idCheck = idInput?.connection?.getCheck() ?? [];
  assert(
    Array.isArray(idCheck) && idCheck.includes("Array"),
    "identifiers accepts Array (lists_create_with output) for List<DV_IDENTIFIER>",
  );
  const refInput = party.getInput(rmAttributeInputName("external_ref"));
  const refCheck = refInput?.connection?.getCheck();
  assert(
    refCheck === "PARTY_REF" || (Array.isArray(refCheck) && refCheck.includes("PARTY_REF")),
    `external_ref should accept PARTY_REF, got ${JSON.stringify(refCheck)}`,
  );
  workspace.dispose();
});

Deno.test("party_ref and dv_identifier blocks are registered", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const ref = workspace.newBlock("party_ref");
  assert(ref.getInput(rmAttributeInputName("id")));
  assert(ref.getInput(rmAttributeInputName("namespace")));
  assert(ref.getInput(rmAttributeInputName("type")));
  const ident = workspace.newBlock("dv_identifier");
  assert(ident.getInput(dvFieldInputName("id")));
  workspace.dispose();
});

Deno.test("ITEM_STRUCTURE block warns while abstract and morphs without dropping children", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const structure = workspace.newBlock("item_structure");
  structure.setFieldValue("ITEM_STRUCTURE", "RM_TYPE");
  syncRmAttributeInputs(structure, "ITEM_STRUCTURE", ["name", "items"]);
  const tree = workspace.newBlock("cluster");
  const itemsInput = structure.getInput(rmAttributeInputName("items"));
  assert(itemsInput?.connection && tree.previousConnection);
  itemsInput.connection.connect(tree.previousConnection);
  refreshWorkspaceConstraints(workspace);
  assertEquals(blockConstraintMessages(structure).includes(ABSTRACT_ITEM_STRUCTURE_WARNING), true);

  applyItemStructureRmType(structure, "ITEM_TREE");
  refreshWorkspaceConstraints(workspace);
  assertEquals(structure.getFieldValue("RM_TYPE"), "ITEM_TREE");
  assertEquals(structure.getInputTargetBlock(rmAttributeInputName("items"))?.id, tree.id);
  assertEquals(blockConstraintMessages(structure).includes(ABSTRACT_ITEM_STRUCTURE_WARNING), false);

  applyItemStructureRmType(structure, "ITEM_TABLE");
  assertEquals(structure.getFieldValue("RM_TYPE"), "ITEM_TABLE");
  assertEquals(structure.getInputTargetBlock(rmAttributeInputName("items"))?.id, tree.id);
  assert(structure.getInput(rmAttributeInputName("rows")), "ITEM_TABLE.rows should appear");
  workspace.dispose();
});

Deno.test("optional RM mutator flyout lists one labeled block per option", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  assert(composition.getField("MUTATOR_COG"), "cogwheel belongs after skeleton title");
  const flyout = buildOptionalRmFlyoutContents(composition, []);
  assert(flyout.length > 1, `expected multiple flyout options, got ${flyout.length}`);
  assert(
    flyout.every((entry) => entry.extraState?.attr && entry.extraState?.label),
    "each flyout block carries attr + human label",
  );
  const withoutFeeder = buildOptionalRmFlyoutContents(composition, ["feeder_audit"]);
  assertEquals(
    withoutFeeder.some((entry) => entry.extraState?.attr === "feeder_audit"),
    false,
    "already-added options disappear from the flyout",
  );

  const bubble = new Blockly.Workspace();
  const item = bubble.newBlock(OPTIONAL_RM_MUTATOR_ITEM);
  applyMutatorItemLabel(item, "feeder_audit", "Feeder audit (feeder_audit)");
  assertEquals(item.getFieldValue("ATTR"), "feeder_audit");
  assertEquals(item.getFieldValue("LABEL"), "Feeder audit (feeder_audit)");
  workspace.dispose();
  bubble.dispose();
});

Deno.test("optional RM mutator cogwheel adds extras and orphans on remove", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  assertEquals(composition.getInput("PLUS"), null);
  assertEquals(typeof composition.decompose, "function");
  assertEquals(typeof composition.compose, "function");

  const bubble = new Blockly.Workspace();
  const container = composition.decompose!(bubble);
  const item = bubble.newBlock(OPTIONAL_RM_MUTATOR_ITEM);
  applyMutatorItemLabel(item, "feeder_audit", "Feeder audit (feeder_audit)");
  container.getInput("STACK")!.connection!.connect(item.previousConnection!);
  composition.compose!(container);
  assert(composition.getInput(optionalRmInputName("feeder_audit")));

  const audit = workspace.newBlock("feeder_audit");
  composition.getInput(optionalRmInputName("feeder_audit"))!.connection!
    .connect(audit.previousConnection!);
  const auditId = audit.id;

  composition.saveConnections?.(container);
  composition.compose!(container);
  assertEquals(
    composition.getInput(optionalRmInputName("feeder_audit"))?.connection
      ?.targetBlock()?.id,
    auditId,
  );

  const emptyWs = new Blockly.Workspace();
  const empty = emptyWs.newBlock(OPTIONAL_RM_MUTATOR_CONTAINER);
  composition.compose!(empty);
  assertEquals(composition.getInput(optionalRmInputName("feeder_audit")), null);
  assertEquals(workspace.getBlockById(auditId)?.id, auditId);

  workspace.dispose();
  bubble.dispose();
  emptyWs.dispose();
});

Deno.test("DATA_VALUE mutator adds optional fields and has no plus-fields button", () => {
  ensureBlocks();
  const workspace = new Blockly.Workspace();
  const qty = workspace.newBlock("dv_quantity");
  assertEquals(qty.getInput("PLUS_FIELDS"), null);
  assertEquals(typeof qty.decompose, "function");

  const bubble = new Blockly.Workspace();
  const container = qty.decompose!(bubble);
  const item = bubble.newBlock(DV_FIELDS_MUTATOR_ITEM);
  const fieldName = item.getFieldValue("ATTR") || "normal_status";
  applyMutatorItemLabel(item, fieldName, fieldName);
  container.getInput("STACK")!.connection!.connect(item.previousConnection!);
  qty.compose!(container);
  assert(
    qty.inputList.some((input) => input.name.startsWith("OPTFLD_")),
    `expected optional DV field, inputs=${qty.inputList.map((i) => i.name).join(",")}`,
  );
  workspace.dispose();
  bubble.dispose();
});

Deno.test("mutator cogwheel anchor is positioned on MUTATOR_COG field and toggles", async () => {
  ensureBlocks();
  const { openBlockMutator, getCogwheelAnchorLocation } = await import(
    "@intehrgrator/blockly/dynamic_mutator.ts"
  );
  const workspace = new Blockly.Workspace();
  const composition = workspace.newBlock("composition");
  const field = composition.getField("MUTATOR_COG");
  assert(field, "MUTATOR_COG field exists");

  const anchor = getCogwheelAnchorLocation(composition as unknown as import("blockly/core").BlockSvg);
  assert(anchor, "anchor coordinate returned");

  let visible = false;
  const fakeIcon = {
    bubbleIsVisible: () => visible,
    setBubbleVisible: (v: boolean) => {
      visible = v;
      return Promise.resolve();
    },
  };
  (composition as unknown as { getIcons: () => unknown[] }).getIcons = () => [fakeIcon];

  openBlockMutator(composition);
  assertEquals(visible, true, "openBlockMutator opens when closed");
  openBlockMutator(composition);
  assertEquals(visible, false, "openBlockMutator closes when already open");

  workspace.dispose();
});

Deno.test("autoSizeMutatorBubble calculates content bounds and enlarges bubble", async () => {
  ensureBlocks();
  const { autoSizeMutatorBubble } = await import(
    "@intehrgrator/blockly/dynamic_mutator.ts"
  );
  const miniWs = new Blockly.Workspace();
  let appliedSize: { width: number; height: number } | null = null;
  const fakeBubble = {
    getWorkspace: () => miniWs as unknown as import("blockly/core").WorkspaceSvg,
    setSize: (size: { width: number; height: number }) => {
      appliedSize = size;
    },
    getSize: () => appliedSize ?? { width: 300, height: 200 },
  };

  autoSizeMutatorBubble(fakeBubble);
  assert(appliedSize, "applied size to bubble");
  assert((appliedSize as { width: number }).width >= 280, "width at least 280");
  assert((appliedSize as { height: number }).height >= 140, "height at least 140");
  miniWs.dispose();
});
