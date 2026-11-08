import { Blockly } from "../blockly_core.ts";
import {
  DEFAULTS_MAP_NAME,
  MAPS_CREATE_WITH,
  MAPS_GET,
} from "../../core/defaults/extract.ts";
import { appendHiddenSerializable } from "../hidden_serializable_field.ts";
import {
  appendMutatorCogwheel,
  hideDefaultMutatorIcon,
} from "../dynamic_mutator.ts";
import { appendBlockOutputGlyph, appendInputTypeGlyph } from "../block_type_glyph.ts";
import { enforceMouthCaptionLayout, initMutatorStackMouth } from "../mouth_layout.ts";
import { registerDefaultContextMapBlock } from "./default_context_map.ts";

export {
  setDefaultContextMapApplyHandler,
  setDefaultsMapHardcodeHandler,
  setDefaultsMapInfoHandler,
  setDefaultsMapPickHandler,
} from "./default_context_map.ts";

const MAP_COLOUR = "#7E57C2";
export const MAPS_CREATE_WITH_ITEM = "maps_create_with_item";
export const MAPS_CREATE_WITH_CONTAINER = "maps_create_with_container";

type MapCreateBlock = Blockly.Block & {
  itemCount_: number;
  updateShape_: () => void;
};

function inputAlignRight(): number {
  return (Blockly.inputs?.Align?.RIGHT ?? Blockly.ALIGN_RIGHT ?? 1) as number;
}

function keyField(defaultText = ""): Blockly.FieldTextInput {
  return new Blockly.FieldTextInput(defaultText, undefined, { spellcheck: false });
}

function removePairInputs(block: MapCreateBlock, index: number): void {
  block.removeInput(`VAL${index}`, true);
  block.removeInput(`KEY${index}`, true);
  block.removeInput(`ROW${index}`, true);
}

function hasPairInput(block: MapCreateBlock, index: number): boolean {
  return !!(
    block.getInput(`VAL${index}`) ||
    block.getInput(`KEY${index}`) ||
    block.getInput(`ROW${index}`)
  );
}

/**
 * App Inventor `dictionaries_create_with` stacks value sockets on the right
 * (`setInputsInline` left false, `Align.RIGHT`). Blockly JSON-object members
 * put the key in a `FieldTextInput` on that same row, with `:` before the
 * value connector. Keys stay editable fields in a column; values are ordinary
 * blocks (`text`, `math_number`, source queries, nested maps, …).
 */
function updateMapCreateShape(block: MapCreateBlock): void {
  if (block.getInput("HEADER_END")) block.removeInput("HEADER_END", true);

  if (block.itemCount_ === 0) {
    let i = 0;
    while (hasPairInput(block, i)) {
      removePairInputs(block, i);
      i++;
    }
    if (!block.getInput("EMPTY")) {
      block.appendDummyInput("EMPTY").appendField("empty");
    }
  } else {
    if (block.getInput("EMPTY")) block.removeInput("EMPTY");
    let i = block.itemCount_;
    while (hasPairInput(block, i)) {
      removePairInputs(block, i);
      i++;
    }
    for (let n = 0; n < block.itemCount_; n++) {
      if (block.getInput(`KEY${n}`)) block.removeInput(`KEY${n}`, true);
      if (block.getInput(`ROW${n}`)) block.removeInput(`ROW${n}`, true);
      if (block.getInput(`VAL${n}`)) continue;
      const input = block.appendValueInput(`VAL${n}`)
        .setAlign(inputAlignRight())
        .appendField(keyField(""), `KEY${n}`)
        .appendField(":");
      // Map values accept any typed value (text, number, nested map, …).
      input.setCheck(null);
      if (
        input.connection &&
        typeof input.connection.setShadowState === "function" &&
        Blockly.Blocks["text"]
      ) {
        input.connection.setShadowState({
          type: "text",
          fields: { TEXT: "" },
        });
      }
    }
  }

  const order = ["HEADER"];
  for (let n = 0; n < block.itemCount_; n++) order.push(`VAL${n}`);
  if (block.getInput("EMPTY")) order.push("EMPTY");
  for (const name of order) {
    if (block.getInput(name)) block.moveInputBefore(name, null);
  }
  enforceMouthCaptionLayout(block);
}

function defineMapsMutatorQuarks(): void {
  if (!Blockly.Blocks[MAPS_CREATE_WITH_CONTAINER]) {
    Blockly.Blocks[MAPS_CREATE_WITH_CONTAINER] = {
      init: function (this: Blockly.Block) {
        initMutatorStackMouth(this, "map entries");
        this.setColour(MAP_COLOUR);
        this.contextMenu = false;
      },
    };
  }
  if (!Blockly.Blocks[MAPS_CREATE_WITH_ITEM]) {
    Blockly.Blocks[MAPS_CREATE_WITH_ITEM] = {
      init: function (this: Blockly.Block) {
        this.appendDummyInput().appendField("entry");
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(MAP_COLOUR);
        this.contextMenu = false;
      },
    };
  }
}

type MutatorItemBlock = Blockly.Block & {
  valueConnection_?: Blockly.Connection | null;
};

const mapsCreateMutator = {
  itemCount_: 0,
  mutationToDom: function (this: MapCreateBlock) {
    const xml = Blockly.utils.xml.createElement("mutation");
    xml.setAttribute("items", String(this.itemCount_));
    return xml;
  },
  domToMutation: function (this: MapCreateBlock, xml: Element) {
    this.itemCount_ = Math.max(0, Number(xml.getAttribute("items") ?? 0));
    this.updateShape_();
  },
  saveExtraState: function (this: MapCreateBlock) {
    return { itemCount: this.itemCount_ };
  },
  loadExtraState: function (this: MapCreateBlock, state: { itemCount?: number } | string | null) {
    if (state == null || state === "") {
      this.itemCount_ = 0;
    } else if (typeof state === "string") {
      this.itemCount_ = Number(JSON.parse(state)?.itemCount ?? 0);
    } else {
      this.itemCount_ = Number(state.itemCount ?? 0);
    }
    this.updateShape_();
  },
  decompose: function (this: MapCreateBlock, workspace: Blockly.Workspace) {
    defineMapsMutatorQuarks();
    const container = workspace.newBlock(MAPS_CREATE_WITH_CONTAINER);
    (container as Blockly.Block & { initSvg?: () => void }).initSvg?.();
    let connection = container.getInput("STACK")?.connection ?? null;
    for (let i = 0; i < this.itemCount_; i++) {
      const item = workspace.newBlock(MAPS_CREATE_WITH_ITEM);
      (item as Blockly.Block & { initSvg?: () => void }).initSvg?.();
      if (connection && item.previousConnection) {
        connection.connect(item.previousConnection);
        connection = item.nextConnection;
      }
    }
    return container;
  },
  compose: function (this: MapCreateBlock, container: Blockly.Block) {
    let item = container.getInputTargetBlock("STACK") as MutatorItemBlock | null;
    const connections: Array<Blockly.Connection | null> = [];
    while (item && !item.isInsertionMarker()) {
      connections.push(item.valueConnection_ ?? null);
      item = item.getNextBlock() as MutatorItemBlock | null;
    }
    for (let i = 0; i < this.itemCount_; i++) {
      const conn = this.getInput(`VAL${i}`)?.connection?.targetConnection ?? null;
      if (conn && !connections.includes(conn)) conn.disconnect();
    }
    this.itemCount_ = connections.length;
    this.updateShape_();
    for (let i = 0; i < this.itemCount_; i++) {
      const saved = connections[i];
      if (saved) this.getInput(`VAL${i}`)?.connection?.connect(saved);
    }
  },
  saveConnections: function (this: MapCreateBlock, container: Blockly.Block) {
    let item = container.getInputTargetBlock("STACK") as MutatorItemBlock | null;
    let i = 0;
    while (item) {
      if (!item.isInsertionMarker()) {
        const input = this.getInput(`VAL${i}`);
        item.valueConnection_ = input?.connection?.targetConnection ?? null;
        i++;
      }
      item = item.getNextBlock() as MutatorItemBlock | null;
    }
  },
};

export function registerMapBlocks(): void {
  registerDefaultContextMapBlock();
  defineMapsMutatorQuarks();
  if (Blockly.Blocks[MAPS_CREATE_WITH] && Blockly.Blocks[MAPS_GET]) return;

  Blockly.Blocks[MAPS_CREATE_WITH] = {
    ...mapsCreateMutator,
    init: function (this: MapCreateBlock) {
      this.itemCount_ = 2;
      const header = this.appendDummyInput("HEADER").setAlign(
        (Blockly.inputs?.Align?.LEFT ?? Blockly.ALIGN_LEFT ?? 0) as number,
      );
      appendBlockOutputGlyph(header, "Map");
      header.appendField("map");
      appendMutatorCogwheel(header);
      this.setOutput(true, "Map");
      this.setColour(MAP_COLOUR);
      this.setTooltip("Create a Map of key/value pairs");
      this.setInputsInline(false);
      this.updateShape_();
      this.setMutator(
        new Blockly.icons.MutatorIcon([MAPS_CREATE_WITH_ITEM], this as unknown as import("blockly/core").BlockSvg),
      );
      hideDefaultMutatorIcon(this);
    },
    updateShape_: function (this: MapCreateBlock) {
      updateMapCreateShape(this);
    },
  };

  if (Blockly.Blocks[MAPS_GET]) return;

  Blockly.Blocks["maps_create_empty"] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput().appendField("empty map");
      this.setOutput(true, "Map");
      this.setColour(MAP_COLOUR);
      this.setTooltip("An empty Map");
    },
  };

  Blockly.Blocks[MAPS_GET] = {
    init: function (this: Blockly.Block) {
      const header = this.appendDummyInput("HEADER");
      appendBlockOutputGlyph(header, null);
      header.appendField("get").appendField(new Blockly.FieldTextInput(DEFAULTS_MAP_NAME), "NAME");
      const keyIn = this.appendValueInput("KEY").setCheck("String");
      appendInputTypeGlyph(keyIn, "String");
      keyIn.appendField("key");
      appendHiddenSerializable(this, "SLOT_ID", "");
      appendHiddenSerializable(this, "RM_TYPE", "");
      this.setOutput(true, null);
      this.setColour(MAP_COLOUR);
      this.appendValueInput("MAP").setCheck("Map").appendField("Map value (optional)");
      this.setTooltip("Look up a key in a connected Map value, or in the named Map when the socket is empty. Missing keys return null.");
      enforceMouthCaptionLayout(this);
    },
  };

  Blockly.Blocks["maps_entries"] = {
    init: function (this: import("blockly/core").Block) {
      this.appendValueInput("MAP").setCheck("Map").appendField("entries of map");
      this.setOutput(true, "Array");
      this.setColour(MAP_COLOUR);
      this.setTooltip("A list of [key, value] pairs from a Map value, including a Function parameter.");
    },
  };

  Blockly.Blocks["maps_keys"] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("keys of")
        .appendField(new Blockly.FieldTextInput(DEFAULTS_MAP_NAME), "NAME");
      this.setOutput(true, "Array");
      this.setColour(MAP_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks["maps_length"] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("size of")
        .appendField(new Blockly.FieldTextInput(DEFAULTS_MAP_NAME), "NAME");
      this.setOutput(true, "Number");
      this.setColour(MAP_COLOUR);
      this.setInputsInline(true);
    },
  };

  Blockly.Blocks["maps_isEmpty"] = {
    init: function (this: Blockly.Block) {
      this.appendDummyInput()
        .appendField("is empty")
        .appendField(new Blockly.FieldTextInput(DEFAULTS_MAP_NAME), "NAME");
      this.setOutput(true, "Boolean");
      this.setColour(MAP_COLOUR);
      this.setInputsInline(true);
    },
  };
}

export function createMapsGetBlock(
  workspace: Blockly.Workspace,
  mapName: string,
  key: string,
  meta?: { slotId?: string; rmType?: string },
): Blockly.Block {
  const block = workspace.newBlock(MAPS_GET);
  block.setFieldValue(mapName, "NAME");
  if (meta?.slotId && block.getField("SLOT_ID")) block.setFieldValue(meta.slotId, "SLOT_ID");
  if (meta?.rmType && block.getField("RM_TYPE")) block.setFieldValue(meta.rmType, "RM_TYPE");
  const keyInput = block.getInput("KEY");
  if (keyInput?.connection) {
    const existing = keyInput.connection.targetBlock();
    if (existing) existing.dispose(false);
    if (typeof keyInput.connection.setShadowState === "function" && Blockly.Blocks["text"]) {
      keyInput.connection.setShadowState({
        type: "text",
        fields: { TEXT: key },
      });
    } else {
      const text = workspace.newBlock("text");
      text.setFieldValue(key, "TEXT");
      if (text.outputConnection) {
        keyInput.connection.connect(text.outputConnection);
      }
      initAndRender(text);
    }
  }
  initAndRender(block);
  if (mapName === DEFAULTS_MAP_NAME && typeof block.setCollapsed === "function") {
    block.setCollapsed(true);
  }
  return block;
}

function initAndRender(block: Blockly.Block): void {
  if (typeof document === "undefined") return;
  const svg = block as Blockly.Block & { initSvg?: () => void; render?: () => void };
  svg.initSvg?.();
  svg.render?.();
}
