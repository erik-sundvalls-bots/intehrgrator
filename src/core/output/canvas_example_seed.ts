/**
 * Conversion start above a minimal JSON, XML, or text document.
 * Used when Load target starts without a schema file (#198).
 */
import type { Block, Workspace } from "blockly/core";
import { Blockly } from "../../blockly/blockly_core.ts";
import { initBlocklyGenerators } from "../../blockly/mod.ts";
import { attachStartToInstanceRoot } from "../../blockly/conversion_start_canvas.ts";
import { runWithoutBlocklyEvents } from "../../blockly/blockly_events.ts";
import {
  syncTargetChildInputs,
  targetChildInputName,
} from "../../blockly/blocks/target_blocks.ts";
import { TEXT_DOCUMENT_BLOCK_TYPE } from "../../blockly/instance_root.ts";
import {
  XML_DOCUMENT_TYPE,
  XML_ELEMENT_TYPE,
  XML_ROOT_INPUT,
  XML_TEXT_INPUT,
} from "../xml_shape.ts";
import type { TargetFormatId } from "../../types/mod.ts";

export type SchemalessExampleKind = "json" | "xml" | "text";

export interface SchemalessExampleSpec {
  format: TargetFormatId;
  filename: string;
  targetId: string;
  content: string;
}

const SPECS: Record<SchemalessExampleKind, SchemalessExampleSpec> = {
  json: {
    format: "json-schema",
    filename: "example.json",
    targetId: "example-json",
    content: '{\n  "example": "value"\n}\n',
  },
  xml: {
    format: "xml-schema",
    filename: "example.xml",
    targetId: "example-xml",
    content: "<example>value</example>\n",
  },
  text: {
    format: "free-form",
    filename: "example.txt",
    targetId: "example-text",
    content: "Example\n",
  },
};

let generatorsReady = false;

function ensureGenerators(): void {
  if (generatorsReady) return;
  initBlocklyGenerators();
  generatorsReady = true;
}

function connectValue(block: Block, inputName: string, child: Block): void {
  const input = block.getInput(inputName)?.connection;
  const output = child.outputConnection;
  if (input && output) input.connect(output);
}

function connectStatement(block: Block, inputName: string, child: Block): void {
  const input = block.getInput(inputName)?.connection;
  const previous = child.previousConnection;
  if (input && previous) input.connect(previous);
}

function textBlock(workspace: Workspace, value: string): Block {
  const text = workspace.newBlock("text");
  text.setFieldValue(value, "TEXT");
  return text;
}

function seedJson(workspace: Workspace): Block {
  const value = workspace.newBlock("json_value");
  value.setFieldValue("example", "NAME");
  connectValue(value, "VALUE", textBlock(workspace, "value"));
  const object = workspace.newBlock("json_object");
  syncTargetChildInputs(object, ["example"]);
  connectStatement(object, targetChildInputName("example"), value);
  return object;
}

function seedXml(workspace: Workspace): Block {
  const element = workspace.newBlock(XML_ELEMENT_TYPE);
  element.setFieldValue("example", "NAME");
  connectValue(element, XML_TEXT_INPUT, textBlock(workspace, "value"));
  const document = workspace.newBlock(XML_DOCUMENT_TYPE) as Block & {
    xmlDocExtras_?: string[];
    updateXmlDocumentShape_?: () => void;
  };
  // The document block starts with an XML declaration. The stored example does not.
  document.xmlDocExtras_ = [];
  document.updateXmlDocumentShape_?.();
  connectStatement(document, XML_ROOT_INPUT, element);
  return document;
}

function seedText(workspace: Workspace): Block {
  const document = workspace.newBlock(TEXT_DOCUMENT_BLOCK_TYPE);
  connectValue(document, "VALUE", textBlock(workspace, "Example"));
  return document;
}

export function schemalessExampleSpec(
  kind: SchemalessExampleKind,
): SchemalessExampleSpec {
  return SPECS[kind];
}

/** Blockly workspace JSON: Conversion start attached above the minimal document. */
export function seedMinimalExample(kind: SchemalessExampleKind): unknown {
  ensureGenerators();
  const workspace = new Blockly.Workspace();
  try {
    let state: unknown = null;
    runWithoutBlocklyEvents(() => {
      const root = kind === "json"
        ? seedJson(workspace)
        : kind === "xml"
        ? seedXml(workspace)
        : seedText(workspace);
      attachStartToInstanceRoot(workspace, root);
      state = Blockly.serialization.workspaces.save(workspace);
    });
    return state;
  } finally {
    workspace.dispose();
  }
}
