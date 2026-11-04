/**
 * Guarded emit for a target stack. Not statement `controls_if`: the condition
 * is a pure boolean value, and the block stays in the Verifiable Mapping
 * Subset. In SMT the guard is `ite` (the same lowering as expression `if`).
 */
import { Blockly } from "../blockly_core.ts";
import { LOOP_BLOCK_COLOUR } from "../block_colours.ts";
import { appendInputTypeGlyph } from "../block_type_glyph.ts";
import { detectLocale, msg } from "../i18n/locale.ts";
import { enforceMouthCaptionLayout, inputAlignRight } from "../mouth_layout.ts";

export const INCLUDE_WHEN_BLOCK = "include_when";

export function registerIncludeWhenBlock(): void {
  const m = msg(detectLocale());

  Blockly.Blocks[INCLUDE_WHEN_BLOCK] = {
    init: function (this: Blockly.Block) {
      const when = this.appendValueInput("WHEN")
        .setCheck("Boolean")
        .setAlign(inputAlignRight())
        .appendField(m.INCLUDE_WHEN);
      appendInputTypeGlyph(when, "Boolean");
      this.appendStatementInput("DO")
        .setAlign(inputAlignRight())
        .appendField(m.INCLUDE_WHEN_DO);
      this.appendStatementInput("ELSE")
        .setAlign(inputAlignRight())
        .appendField(m.INCLUDE_WHEN_ELSE);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(LOOP_BLOCK_COLOUR);
      this.setTooltip(m.INCLUDE_WHEN_TOOLTIP);
      this.setStyle?.("loop_blocks");
      enforceMouthCaptionLayout(this);
    },
  };
}
