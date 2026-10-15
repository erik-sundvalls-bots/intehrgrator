import { Blockly } from "../blockly_core.ts";
import {
  appendBlockOutputGlyph,
  appendInputTypeGlyph,
  setBlockOutputCheck,
} from "../block_type_glyph.ts";
import { inputAlignLeft, inputAlignRight, enforceMouthCaptionLayout } from "../mouth_layout.ts";
import { FieldDropdownHug } from "../field_dropdown_hug.ts";
import { FieldGridName } from "../field_grid_name.ts";
import { workspaceSheet } from "../sheets_bridge.ts";
import {
  blocklyCheckForDecisionOutput,
  DECISION_ALL_OUTPUTS,
  isAllOutputs,
  outputHeaders,
} from "../../core/sheets/decision_table.ts";

const DT_COLOUR = "#00796B";

export const DECISION_TABLE_BLOCK = "decision_table";

export const DECISION_TYPE_SWITCH_MESSAGE =
  "This changes the block’s output type. It may pop out of its socket if the parent does not accept the new type.\n\nUndo/redo on the canvas restores the previous type and connection.\n\nContinue?";

const INFO_SVG = "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="#fff" stroke="#005c53"/><text x="9" y="13" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="12" fill="#005c53">i</text></svg>',
  );

export type GridFocusHandler = (name: string, opts?: { highlight?: boolean }) => void;

let decisionTableFocusHandler: GridFocusHandler | null = null;
let decisionTableInfoHandler: ((anchor: Element | null) => void) | null = null;
let schemaSyncing = false;

/** Workbench shows the Sheets tab and selects this named Decision table. */
export function setDecisionTableFocusHandler(handler: GridFocusHandler | null): void {
  decisionTableFocusHandler = handler;
}

/** Workbench registers the Decision table (i) balloon. */
export function setDecisionTableInfoHandler(
  handler: ((anchor: Element | null) => void) | null,
): void {
  decisionTableInfoHandler = handler;
}

export function runDecisionTableSchemaSync(fn: () => void): void {
  schemaSyncing = true;
  try {
    fn();
  } finally {
    schemaSyncing = false;
  }
}

export function isDecisionTableSchemaSyncing(): boolean {
  return schemaSyncing;
}

type ClickableField = {
  getClickTarget_?: () => Element | null;
  getSvgRoot?: () => SVGElement | null;
  fieldGroup_?: Element | null;
};

function fieldClickAnchor(field: ClickableField): Element | null {
  return field.getClickTarget_?.() ?? field.getSvgRoot?.() ?? field.fieldGroup_ ?? null;
}

function confirmTypeSwitch(): boolean {
  if (schemaSyncing) return true;
  if (typeof globalThis.confirm !== "function") return true;
  return globalThis.confirm(DECISION_TYPE_SWITCH_MESSAGE);
}

function outputMenu(this: { getSourceBlock?: () => Blockly.Block | null; getValue?: () => string }): [string, string][] {
  const block = this.getSourceBlock?.();
  const name = String(block?.getFieldValue("NAME") || "");
  const sheet = workspaceSheet(name);
  const outs = sheet ? outputHeaders(sheet) : ["out"];
  const opts: [string, string][] = (outs.length ? outs : ["out"]).map((h) => [h, h]);
  opts.push(["all outputs", DECISION_ALL_OUTPUTS]);
  const current = String(this.getValue?.() ?? block?.getFieldValue("OUTPUT") ?? "");
  if (current && !opts.some((o) => o[1] === current)) {
    opts.unshift([current, current]);
  }
  return opts;
}

function outputValidator(this: { getSourceBlock?: () => Blockly.Block | null; getValue?: () => string }, newValue: string) {
  const old = String(this.getValue?.() ?? "");
  if (old === newValue || schemaSyncing) return newValue;
  if (isAllOutputs(old) !== isAllOutputs(newValue) && !confirmTypeSwitch()) {
    return old;
  }
  return newValue;
}

// Allow headers that are not yet in the menu (document lag / tests / bundle load).
// deno-lint-ignore no-explicit-any
const FieldDropdownHugBase = FieldDropdownHug as any;

/**
 * Output-column picker. Blockly keeps the closed label on the first menu
 * entry (`out`) when `selectedOption` was cached before the chosen header
 * existed. The label follows the field value: the column name, or "all outputs".
 */
class FieldDecisionOutput extends FieldDropdownHugBase {
  constructor(menuGenerator?: unknown, optValidator?: unknown) {
    super(menuGenerator, optValidator);
  }

  doClassValidation_(newValue: unknown) {
    if (newValue == null || newValue === "") return null;
    return String(newValue);
  }

  doValueUpdate_(newValue: string): void {
    this.getOptions(false);
    super.doValueUpdate_(newValue);
    const value = String(this.getValue?.() ?? newValue ?? "");
    if (isAllOutputs(value)) {
      this.selectedOption = ["all outputs", value];
      return;
    }
    if (value && (!this.selectedOption || this.selectedOption[1] !== value)) {
      this.selectedOption = [value, value];
    }
  }

  getText_(): string | null {
    const value = String(this.getValue?.() ?? "");
    if (isAllOutputs(value)) return "all outputs";
    if (!value) return null;
    return value;
  }
}

export function applyDecisionTableOutputType(block: Blockly.Block): void {
  const name = String(block.getFieldValue("NAME") || "");
  const output = String(block.getFieldValue("OUTPUT") || "out");
  const check = blocklyCheckForDecisionOutput(workspaceSheet(name), output);
  setBlockOutputCheck(block, check);
}

/**
 * Value block: named Decision table + locals Map (condition keys) → one typed output, or all outputs as a Map.
 */
export function registerDecisionTableBlocks(): void {
  if (Blockly.Blocks[DECISION_TABLE_BLOCK]) return;

  Blockly.Blocks[DECISION_TABLE_BLOCK] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER").setAlign(inputAlignLeft());
      appendBlockOutputGlyph(header, "String");
      header
        .appendField("decision")
        .appendField(new FieldGridName("decision-table"), "NAME")
        .appendField("→")
        .appendField(
          new FieldDecisionOutput(outputMenu, outputValidator),
          "OUTPUT",
        );
      const infoField = new Blockly.FieldImage(
        INFO_SVG,
        18,
        18,
        "Decision table: locals Map keys match condition columns. Output dropdown selects one typed column, or all outputs as a Map. Condition cells: equality, don't-care (—), or numeric predicates (90..120, >= 140). Catch-all is a row flag, not per-column *. Undo/redo restores type switches.",
        () => {
          decisionTableInfoHandler?.(fieldClickAnchor(infoField as ClickableField));
        },
      );
      header.appendField(infoField, "INFO");
      const inputs = this.appendValueInput("INPUTS")
        .setCheck("Map")
        .setAlign(inputAlignRight())
        .appendField("locals");
      appendInputTypeGlyph(inputs, "Map");
      this.setOutput(true, "String");
      this.setColour(DT_COLOUR);
      this.setInputsInline(false);
      this.setTooltip(
        "Evaluate a Decision table. Locals Map keys match condition columns. Choose an output column or all outputs.",
      );
      enforceMouthCaptionLayout(this);
    },
    onchange: function (this: Blockly.Block, event: { type?: string; name?: string; newElementId?: string }) {
      if (this.isInFlyout) return;
      if (event?.type === "selected" && event.newElementId === this.id) {
        const name = String(this.getFieldValue("NAME") || "").trim();
        if (name) decisionTableFocusHandler?.(name, { highlight: true });
      }
      if (event?.type === "change" && (event.name === "OUTPUT" || event.name === "NAME")) {
        applyDecisionTableOutputType(this);
      }
    },
  };
}
