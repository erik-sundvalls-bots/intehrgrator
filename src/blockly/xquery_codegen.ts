/**
 * Blockly workspace → XQuery for XML / XML Schema canvases (lung-MDT → TakeCare).
 *
 * The Mapping Model keeps one slot per Target path, so repeated schema elements
 * (17 `TextKeyWord` under one `TextKeywords`) collapse in the Model B slot
 * manifest and `include_when` guards are lost. This walker builds the Target
 * XML from the canvas instead, as the Go template walker does: element
 * constructors per schema / XML block, `include_when` as `if … then … else ()`,
 * `for_each_list` as a FLWOR, values through the shared Mapping Expression
 * emitter. openEHR and JSON Schema products keep their existing XQuery paths.
 */

import type { Block, Workspace } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { blockToExpression } from "./expression_serialize.ts";
import { registerSchemaBlocksFromSkeleton } from "./schema_blocks.ts";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import { runWithoutBlocklyEvents } from "./blockly_events.ts";
import { migrateForEachSourceState } from "./migrate_for_each_source.ts";
import { findInstanceRootUnderStart } from "./instance_root.ts";
import { sourcePathFromLoopList, loopIndexBinderName, loopLengthBinderName } from "./loop_block.ts";
import { INCLUDE_WHEN_BLOCK } from "./blocks/include_when.ts";
import { extraStateOf, xmlName, xmlTagName } from "./go_template_codegen.ts";
import { registerExportTargetAdapter } from "../core/codegen/mod.ts";
import {
  compileLoopSequence,
  emitXQueryExpr,
  generateXQuery,
  wrapXQueryCanvasXmlModule,
  type XQueryEmitEnv,
} from "../core/codegen/xquery.ts";
import { parseExpression } from "../core/expression/mod.ts";
import { isHandlebarsCodeLang } from "../core/output/code_text.ts";
import { usesOpenEhrProduct } from "../core/codegen/product.ts";
import { XML_ATTRIBUTES_INPUT, XML_CHILDREN_INPUT, XML_ELEMENT_TYPE, XML_TEXT_INPUT } from "../core/xml_shape.ts";
import type { MappingLoop, MappingModel, SkeletonNode } from "../types/mod.ts";

const STATEMENT_INPUT_TYPE = 3;

export function registerXQueryExportAdapter(): void {
  registerExportTargetAdapter({
    id: "xquery",
    extension: "xq",
    mime: "application/xquery",
    generate(model, options) {
      const xmlCanvas = options?.blocklyState &&
        model.targetFormat !== "json-schema" &&
        !usesOpenEhrProduct(model, options);
      if (xmlCanvas) {
        const fromCanvas = generateXQueryFromBlocklyState(options!.blocklyState, model, options?.skeleton);
        if (fromCanvas) return fromCanvas;
      }
      return generateXQuery(model, options);
    },
  });
}

/** XQuery module for an XML / XML Schema canvas, or `null` when the canvas has another product. */
export function generateXQueryFromBlocklyState(
  state: unknown,
  model: MappingModel,
  skeleton?: SkeletonNode[],
): string | null {
  if (!state || typeof state !== "object") return null;
  const workspace = new Blockly.Workspace();
  try {
    const snapshot = migrateForEachSourceState(
      JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
    );
    let generated: string | null = null;
    runWithoutBlocklyEvents(() => {
      ensureStockBlocklyMessages();
      if (skeleton?.length) registerSchemaBlocksFromSkeleton(skeleton);
      Blockly.serialization.workspaces.load(snapshot, workspace);
      generated = generateXQueryFromWorkspace(workspace, model);
    });
    return generated;
  } finally {
    workspace.dispose();
  }
}

export function generateXQueryFromWorkspace(workspace: Workspace, model: MappingModel): string | null {
  const root = findInstanceRootUnderStart(workspace);
  if (!root || !isXmlStructure(root.type)) return null;
  const body = emitChain(root, {});
  return wrapXQueryCanvasXmlModule(model, `  ${body}`);
}

function isXmlStructure(type: string): boolean {
  return type === XML_ELEMENT_TYPE || type.startsWith("schema_");
}

/** A statement chain as one XQuery sequence. */
function emitChain(first: Block | null, env: XQueryEmitEnv): string {
  const parts: string[] = [];
  let current = first;
  while (current) {
    const code = emitNode(current, env);
    if (code) parts.push(code);
    current = current.getNextBlock();
  }
  if (!parts.length) return "()";
  return parts.length === 1 ? parts[0]! : `(${parts.join(", ")})`;
}

function emitNode(block: Block, env: XQueryEmitEnv): string {
  if (block.type === INCLUDE_WHEN_BLOCK) return emitIncludeWhen(block, env);
  if (block.type === "for_each_list") return emitForEachList(block, env);
  if (isXmlStructure(block.type)) return emitElement(block, env);
  if (block.type === "variables_set") return "";
  throw new Error(
    `XQuery cannot build Target XML from a "${block.type}" block on this canvas; ` +
      "use TypeScript, Go template or Handlebars",
  );
}

function emitIncludeWhen(block: Block, env: XQueryEmitEnv): string {
  const when = block.getInputTargetBlock("WHEN");
  const cond = when ? emitValue(when, env) : "false()";
  const thenPart = emitChain(block.getInputTargetBlock("DO"), env);
  const elsePart = emitChain(block.getInputTargetBlock("ELSE"), env);
  return `(if (${cond}) then ${thenPart} else ${elsePart})`;
}

function emitForEachList(block: Block, env: XQueryEmitEnv): string {
  const varName = String(block.getFieldValue("VAR") || "item");
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName) ? varName : "item";
  const sourcePath = sourcePathFromLoopList(block);
  const listBlock = block.getInputTargetBlock("LIST");
  const collection = !sourcePath && listBlock ? blockToExpression(listBlock) ?? undefined : undefined;
  const loop = {
    attachSlotId: "",
    varName,
    kind: sourcePath ? "source" : "list",
    path: sourcePath ?? "",
    ...(collection ? { collection } : {}),
  } as unknown as MappingLoop;
  const sequence = compileLoopSequence(loop, env.sourceVar);
  const inner: XQueryEmitEnv = {
    ...env,
    sourceVar: `$${ident}`,
    bind: {
      ...env.bind,
      [varName]: ident,
      [loopIndexBinderName(varName)]: `${ident}_index`,
      [loopLengthBinderName(varName)]: `${ident}_length`,
    },
  };
  const body = emitChain(block.getInputTargetBlock("DO"), inner);
  return `(let $${ident}_col := ${sequence} for $${ident} at $${ident}_pos in $${ident}_col ` +
    `let $${ident}_index := $${ident}_pos - 1 let $${ident}_length := count($${ident}_col) return ${body})`;
}

function emitElement(block: Block, env: XQueryEmitEnv): string {
  const tag = xmlName(xmlTagName(block));
  const extra = extraStateOf(block);
  const xmlAttributes = new Set<string>(extra.xmlAttributes ?? []);
  for (const field of extra.fields ?? []) {
    if (field.xmlKind === "attribute") xmlAttributes.add(field.name);
  }
  const content: string[] = [];
  if (block.type === XML_ELEMENT_TYPE) {
    let attr = block.getInputTargetBlock(XML_ATTRIBUTES_INPUT);
    while (attr) {
      const name = String(attr.getFieldValue("NAME") ?? "").trim();
      const val = attr.getInputTargetBlock(XML_TEXT_INPUT) ?? attr.getInputTargetBlock("VALUE");
      if (name) content.push(`attribute ${xmlName(name)} { ${val ? textOf(emitValue(val, env)) : '""'} }`);
      attr = attr.getNextBlock();
    }
    const text = block.getInputTargetBlock(XML_TEXT_INPUT);
    if (text) content.push(textOf(emitValue(text, env)));
    const children = block.getInputTargetBlock(XML_CHILDREN_INPUT);
    if (children) content.push(emitChain(children, env));
  } else {
    for (const input of block.inputList) {
      if (!input.name.startsWith("TARGET_") && !input.name.startsWith("SCHEMA_OPT_")) continue;
      const field = input.name.replace(/^TARGET_|^SCHEMA_OPT_/, "");
      const child = block.getInputTargetBlock(input.name);
      if (!child) continue;
      if (xmlAttributes.has(field)) {
        content.push(`attribute ${xmlName(field)} { ${textOf(emitValue(child, env))} }`);
      } else if (input.type === STATEMENT_INPUT_TYPE || isXmlStructure(child.type) ||
        child.type === INCLUDE_WHEN_BLOCK || child.type === "for_each_list") {
        content.push(emitChain(child, env));
      } else {
        content.push(`element ${xmlName(field)} { ${textOf(emitValue(child, env))} }`);
      }
    }
  }
  return `element ${tag} { ${content.length ? content.join(", ") : "()"} }`;
}

/** Text content: atomized and joined, so an empty sequence is "" as in Mapping preview. */
function textOf(expr: string): string {
  return `string-join(for $v in (${expr}) return string($v), "")`;
}

function emitValue(block: Block, env: XQueryEmitEnv): string {
  if (block.type === "text_code" && !isHandlebarsCodeLang(block.getFieldValue("LANG"))) {
    return emitXQueryExpr({ kind: "literal", value: String(block.getFieldValue("TEXT") ?? "") }, env);
  }
  const serialized = blockToExpression(block);
  if (!serialized) {
    throw new Error(`XQuery cannot express a "${block.type}" value block; use TypeScript or Go template`);
  }
  return emitXQueryExpr(parseExpression(serialized), env);
}
