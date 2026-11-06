/** Keep slot identity when an ordinary value Function replaces an RM value shell. */
import type { Block } from "blockly/core";
import { Blockly } from "../blockly_core.ts";
import { appendHiddenSerializable } from "../hidden_serializable_field.ts";

let registered = false;

export function registerFunctionSlotFields(): void {
  if (registered) return;
  const definition = Blockly.Blocks["procedures_callreturn"];
  const init = definition.init;
  definition.init = function (this: Block) {
    init.call(this);
    appendHiddenSerializable(this, "SLOT_ID", "");
    appendHiddenSerializable(this, "RM_TYPE", "");
  };
  registered = true;
}
