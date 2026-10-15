import { Blockly } from "../blockly_core.ts";
import {
  appendBlockOutputGlyph,
  appendInputTypeGlyph,
  inputAlignLeft,
  inputAlignRight,
} from "../block_type_glyph.ts";
import { FieldGridName } from "../field_grid_name.ts";

/** Sheet table / row / column values (Blockly check stays `Array`). */
const SHEET_TABLE_GLYPH = "Sheet";

const SHEET_COLOUR = "#00897B";

export const SHEET_GET_CELL = "sheet_get_cell";
export const SHEET_GET_XY = "sheet_get_xy";
export const SHEET_GET_ROW = "sheet_get_row";
export const SHEET_GET_COLUMN = "sheet_get_column";
export const SHEET_GET_HEADER = "sheet_get_header";
export const SHEET_GET_DATA = "sheet_get_data";
export const SHEET_LOOKUP = "sheet_lookup";
export const SHEET_SET_CELL = "sheet_set_cell";
export const SHEET_SET_XY = "sheet_set_xy";
export const SHEET_SET_ROW = "sheet_set_row";
export const SHEET_SET_COLUMN = "sheet_set_column";
export const SHEET_SET_HEADER = "sheet_set_header";
export const SHEET_INSERT_ROW = "sheet_insert_row";
export const SHEET_DELETE_ROW = "sheet_delete_row";
export const SHEET_INSERT_COLUMN = "sheet_insert_column";
export const SHEET_DELETE_COLUMN = "sheet_delete_column";

export const SHEET_ACCESSOR_TYPES = [
  SHEET_GET_CELL,
  SHEET_GET_XY,
  SHEET_GET_ROW,
  SHEET_GET_COLUMN,
  SHEET_GET_HEADER,
  SHEET_GET_DATA,
  SHEET_LOOKUP,
] as const;

export const SHEET_MUTATOR_TYPES = [
  SHEET_SET_CELL,
  SHEET_SET_XY,
  SHEET_SET_ROW,
  SHEET_SET_COLUMN,
  SHEET_SET_HEADER,
  SHEET_INSERT_ROW,
  SHEET_DELETE_ROW,
  SHEET_INSERT_COLUMN,
  SHEET_DELETE_COLUMN,
] as const;

let sheetFocusHandler: ((name: string, opts?: { highlight?: boolean }) => void) | null = null;

/** Workbench shows the Sheets tab and selects this named Sheet. */
export function setSheetFocusHandler(
  handler: ((name: string, opts?: { highlight?: boolean }) => void) | null,
): void {
  sheetFocusHandler = handler;
}

function nameField(): Blockly.FieldTextInput {
  return new Blockly.FieldTextInput("Sheet1", undefined, { spellcheck: false });
}

function sheetNameField(): FieldGridName {
  return new FieldGridName("sheet");
}

function focusSheetOnSelect(
  this: Blockly.Block,
  event: { type?: string; newElementId?: string },
): void {
  if (this.isInFlyout) return;
  if (event?.type !== "selected" || event.newElementId !== this.id) return;
  const name = String(this.getFieldValue("NAME") || "").trim();
  if (!name) return;
  sheetFocusHandler?.(name, { highlight: true });
}

function initAndRender(block: Blockly.Block): void {
  if (typeof document === "undefined") return;
  const svg = block as Blockly.Block & { initSvg?: () => void; render?: () => void };
  svg.initSvg?.();
  svg.render?.();
}

export function registerSheetBlocks(): void {
  if (Blockly.Blocks[SHEET_GET_CELL]) return;

  Blockly.Blocks[SHEET_GET_CELL] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, ["String", "Number", "Boolean"]);
      header.appendField("get").appendField(sheetNameField(), "NAME").appendField("cell");
      const a1 = this.appendValueInput("A1").setAlign(inputAlignRight()).setCheck("String");
      appendInputTypeGlyph(a1, "String");
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
      this.setTooltip("Get a Sheet cell by A1 reference (e.g. B2).");
    },
  };

  Blockly.Blocks[SHEET_GET_XY] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, ["String", "Number", "Boolean"]);
      header.appendField("get").appendField(sheetNameField(), "NAME");
      const xIn = this.appendValueInput("X").setAlign(inputAlignRight()).setCheck("Number").appendField("x");
      appendInputTypeGlyph(xIn, "Number");
      const yIn = this.appendValueInput("Y").setAlign(inputAlignRight()).setCheck("Number").appendField("y");
      appendInputTypeGlyph(yIn, "Number");
      this.setOutput(true, ["String", "Number", "Boolean"]);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
      this.setTooltip("Get a Sheet cell by 0-based column x and row y.");
    },
  };

  Blockly.Blocks[SHEET_GET_ROW] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, SHEET_TABLE_GLYPH);
      header.appendField("get row of").appendField(sheetNameField(), "NAME");
      const yIn = this.appendValueInput("Y").setAlign(inputAlignRight()).setCheck("Number").appendField("y");
      appendInputTypeGlyph(yIn, "Number");
      this.setOutput(true, "Array");
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_GET_COLUMN] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, SHEET_TABLE_GLYPH);
      header.appendField("get column of").appendField(sheetNameField(), "NAME");
      const xIn = this.appendValueInput("X").setAlign(inputAlignRight()).setCheck("Number").appendField("x");
      appendInputTypeGlyph(xIn, "Number");
      this.setOutput(true, "Array");
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_GET_HEADER] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, "String");
      header.appendField("header of").appendField(sheetNameField(), "NAME");
      const xIn = this.appendValueInput("X").setAlign(inputAlignRight()).setCheck("Number").appendField("x");
      appendInputTypeGlyph(xIn, "Number");
      this.setOutput(true, "String");
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_GET_DATA] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, SHEET_TABLE_GLYPH);
      header.appendField("data of").appendField(sheetNameField(), "NAME");
      this.setOutput(true, "Array");
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_LOOKUP] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, ["String", "Number", "Boolean"]);
      header.appendField("lookup").appendField(sheetNameField(), "NAME");
      const matchCol = this.appendValueInput("MATCH_COL").setAlign(inputAlignRight()).setCheck(["String", "Number"]).appendField("where");
      appendInputTypeGlyph(matchCol, ["String", "Number"]);
      const matchVal = this.appendValueInput("MATCH_VAL").setAlign(inputAlignRight()).appendField("=");
      appendInputTypeGlyph(matchVal, null);
      const returnCol = this.appendValueInput("RETURN_COL").setAlign(inputAlignRight()).setCheck(["String", "Number"]).appendField("return");
      appendInputTypeGlyph(returnCol, ["String", "Number"]);
      this.setOutput(true, ["String", "Number", "Boolean"]);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
      this.setTooltip("First row where a header/column equals a value; return that row or a column.");
    },
  };

  Blockly.Blocks[SHEET_SET_CELL] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("set").appendField(nameField(), "NAME").appendField("cell");
      this.appendValueInput("A1").setCheck("String");
      this.appendValueInput("VALUE").appendField("to");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_SET_XY] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("set").appendField(nameField(), "NAME");
      this.appendValueInput("X").setCheck("Number").appendField("x");
      this.appendValueInput("Y").setCheck("Number").appendField("y");
      this.appendValueInput("VALUE").appendField("to");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_SET_ROW] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("set row of").appendField(nameField(), "NAME");
      const yIn = this.appendValueInput("Y").setAlign(inputAlignRight()).setCheck("Number").appendField("y");
      appendInputTypeGlyph(yIn, "Number");
      const valueIn = this.appendValueInput("VALUE").setAlign(inputAlignRight()).setCheck("Array").appendField("to");
      appendInputTypeGlyph(valueIn, SHEET_TABLE_GLYPH);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_SET_COLUMN] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("set column of").appendField(nameField(), "NAME");
      const xIn = this.appendValueInput("X").setAlign(inputAlignRight()).setCheck("Number").appendField("x");
      appendInputTypeGlyph(xIn, "Number");
      const valueIn = this.appendValueInput("VALUE").setAlign(inputAlignRight()).setCheck("Array").appendField("to");
      appendInputTypeGlyph(valueIn, SHEET_TABLE_GLYPH);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_SET_HEADER] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("set header of").appendField(nameField(), "NAME");
      this.appendValueInput("X").setCheck("Number").appendField("x");
      this.appendValueInput("VALUE").setCheck("String").appendField("to");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_INSERT_ROW] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("insert row in").appendField(nameField(), "NAME");
      this.appendValueInput("Y").setCheck("Number").appendField("at");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_DELETE_ROW] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("delete row in").appendField(nameField(), "NAME");
      this.appendValueInput("Y").setCheck("Number").appendField("at");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_INSERT_COLUMN] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("insert column in").appendField(nameField(), "NAME");
      this.appendValueInput("X").setCheck("Number").appendField("at");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks[SHEET_DELETE_COLUMN] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("delete column in").appendField(nameField(), "NAME");
      this.appendValueInput("X").setCheck("Number").appendField("at");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(SHEET_COLOUR);
      this.setInputsInline(true);
    },
  };

  for (const type of SHEET_ACCESSOR_TYPES) {
    (Blockly.Blocks[type] as { onchange?: typeof focusSheetOnSelect }).onchange = focusSheetOnSelect;
  }
}

export function createSheetLookupBlock(
  workspace: Blockly.Workspace,
  sheetName: string,
  matchCol: string,
  returnCol: string,
): Blockly.Block {
  const block = workspace.newBlock(SHEET_LOOKUP);
  block.setFieldValue(sheetName, "NAME");
  shadowText(block, "MATCH_COL", matchCol);
  shadowText(block, "RETURN_COL", returnCol);
  initAndRender(block);
  return block;
}

function shadowText(block: Blockly.Block, inputName: string, text: string): void {
  const input = block.getInput(inputName);
  if (!input?.connection || typeof input.connection.setShadowState !== "function") return;
  input.connection.setShadowState({ type: "text", fields: { TEXT: text } });
}
