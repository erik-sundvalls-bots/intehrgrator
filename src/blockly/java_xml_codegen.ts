/**
 * Blockly workspace → Java (StAX) for XML / XML Schema canvases (#388).
 *
 * The Mapping Model keeps one slot per Target path, so repeated schema
 * elements (17 `TextKeyWord` under one `TextKeywords`) collapse in a slot map
 * and `include_when` guards are lost. Like the XQuery and Go template walkers,
 * this one builds the Target XML from the canvas: StAX `writeStartElement` /
 * `writeAttribute` / `writeCharacters` per schema / XML block, `include_when`
 * as `if / else`, `for_each_list` as a `for` loop, values through the shared
 * Java Mapping Expression emitter. openEHR and JSON Schema products keep their
 * existing Java paths.
 */

import type { Block, Workspace } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { blockToExpression } from "./expression_serialize.ts";
import { registerSchemaBlocksFromSkeleton } from "./schema_blocks.ts";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import { runWithoutBlocklyEvents } from "./blockly_events.ts";
import { migrateForEachSourceState } from "./migrate_for_each_source.ts";
import { findInstanceRootUnderStart } from "./instance_root.ts";
import {
  loopIndexBinderName,
  loopLengthBinderName,
  sourcePathFromLoopList,
} from "./loop_block.ts";
import { INCLUDE_WHEN_BLOCK } from "./blocks/include_when.ts";
import { extraStateOf, xmlName, xmlTagName } from "./go_template_codegen.ts";
import { registerExportTargetAdapter } from "../core/codegen/mod.ts";
import {
  createJavaEmitContext,
  emitJavaExpression,
  emitXpathCall,
  generateJava,
  type JavaEmitContext,
  javaIdent,
  wrapJavaXmlCanvasModule,
} from "../core/codegen/java.ts";
import { parseExpression } from "../core/expression/mod.ts";
import { isHandlebarsCodeLang } from "../core/output/code_text.ts";
import { usesOpenEhrProduct } from "../core/codegen/product.ts";
import {
  XML_ATTRIBUTES_INPUT,
  XML_CHILDREN_INPUT,
  XML_ELEMENT_TYPE,
  XML_TEXT_INPUT,
} from "../core/xml_shape.ts";
import type { MappingModel, SkeletonNode } from "../types/mod.ts";

const STATEMENT_INPUT_TYPE = 3;

export function registerJavaExportAdapter(): void {
  registerExportTargetAdapter({
    id: "java",
    extension: "java",
    mime: "text/x-java-source",
    generate(model, options) {
      const xmlCanvas = options?.blocklyState &&
        model.targetFormat !== "json-schema" &&
        !usesOpenEhrProduct(model, options);
      if (xmlCanvas) {
        const fromCanvas = generateJavaFromBlocklyState(
          options!.blocklyState,
          model,
          options?.skeleton,
        );
        if (fromCanvas) return fromCanvas;
      }
      return generateJava(model, options);
    },
  });
}

/** Java module for an XML / XML Schema canvas, or `null` when the canvas has another product. */
export function generateJavaFromBlocklyState(
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
      generated = generateJavaFromWorkspace(workspace, model);
    });
    return generated;
  } finally {
    workspace.dispose();
  }
}

interface WalkEnv {
  ctx: JavaEmitContext;
  /** Loop nesting depth, for unique Java locals. */
  depth: number;
}

export function generateJavaFromWorkspace(
  workspace: Workspace,
  model: MappingModel,
): string | null {
  const root = findInstanceRootUnderStart(workspace);
  if (!root || !isXmlStructure(root.type)) return null;
  const ctx = createJavaEmitContext("sourceRoot", model.functions);
  ctx.helpers.add("string");
  const lines: string[] = [];
  emitChain(root, { ctx, depth: 0 }, lines);
  return wrapJavaXmlCanvasModule(model, lines.join("\n"), ctx);
}

function isXmlStructure(type: string): boolean {
  return type === XML_ELEMENT_TYPE || type.startsWith("schema_");
}

function emitChain(first: Block | null, env: WalkEnv, out: string[]): void {
  let current = first;
  while (current) {
    emitNode(current, env, out);
    current = current.getNextBlock();
  }
}

function emitNode(block: Block, env: WalkEnv, out: string[]): void {
  if (block.type === INCLUDE_WHEN_BLOCK) {
    return emitIncludeWhen(block, env, out);
  }
  if (block.type === "for_each_list") return emitForEachList(block, env, out);
  if (isXmlStructure(block.type)) return emitElement(block, env, out);
  if (block.type === "variables_set") return;
  throw new Error(
    `Java cannot build Target XML from a "${block.type}" block on this canvas; ` +
      "use TypeScript, XQuery or Handlebars",
  );
}

function indented(lines: string[]): string[] {
  return lines.map((line) => (line.length ? `  ${line}` : line));
}

function emitIncludeWhen(block: Block, env: WalkEnv, out: string[]): void {
  const when = block.getInputTargetBlock("WHEN");
  const cond = when ? `asBoolean(${emitValue(when, env)})` : "false";
  const thenLines: string[] = [];
  emitChain(block.getInputTargetBlock("DO"), env, thenLines);
  const elseLines: string[] = [];
  emitChain(block.getInputTargetBlock("ELSE"), env, elseLines);
  out.push(`if (${cond}) {`, ...indented(thenLines));
  if (elseLines.length) out.push("} else {", ...indented(elseLines));
  out.push("}");
}

function emitForEachList(block: Block, env: WalkEnv, out: string[]): void {
  const varName = String(block.getFieldValue("VAR") || "item");
  const depth = env.depth + 1;
  const ident = `${javaIdent(varName, "item")}_${depth}`;
  const sourcePath = sourcePathFromLoopList(block);
  const listBlock = block.getInputTargetBlock("LIST");
  let collection: string;
  if (sourcePath) {
    env.ctx.helpers.add("nodes");
    collection = emitXpathCall(
      "xpathNodes",
      { kind: "literal", value: sourcePath },
      JSON.stringify(sourcePath),
      env.ctx,
    );
  } else if (listBlock) {
    env.ctx.helpers.add("logic");
    collection = `asList(${emitValue(listBlock, env)})`;
  } else {
    collection = "java.util.List.<Object>of()";
  }
  const col = `${ident}_col`;
  const pos = `${ident}_pos`;
  const inner: WalkEnv = {
    depth,
    ctx: {
      ...env.ctx,
      loopVar: ident,
      loopBindings: { ...env.ctx.loopBindings, [varName]: ident },
    },
  };
  const body: string[] = [];
  emitChain(block.getInputTargetBlock("DO"), inner, body);
  env.ctx.helpers.add("logic");
  out.push(
    "{",
    `  java.util.List<Object> ${col} = new java.util.ArrayList<Object>(${collection});`,
    `  for (int ${pos} = 0; ${pos} < ${col}.size(); ${pos}++) {`,
    `    Object ${ident} = ${col}.get(${pos});`,
    `    vars.put(${JSON.stringify(varName)}, ${ident});`,
    `    vars.put(${JSON.stringify(loopIndexBinderName(varName))}, ${pos});`,
    `    vars.put(${
      JSON.stringify(loopLengthBinderName(varName))
    }, ${col}.size());`,
    ...indented(indented(body)),
    "  }",
    "}",
  );
}

function emitElement(block: Block, env: WalkEnv, out: string[]): void {
  const tag = xmlName(xmlTagName(block));
  const extra = extraStateOf(block);
  const xmlAttributes = new Set<string>(extra.xmlAttributes ?? []);
  for (const field of extra.fields ?? []) {
    if (field.xmlKind === "attribute") xmlAttributes.add(field.name);
  }
  const attrs: string[] = [];
  const content: string[] = [];
  if (block.type === XML_ELEMENT_TYPE) {
    let attr = block.getInputTargetBlock(XML_ATTRIBUTES_INPUT);
    while (attr) {
      const name = String(attr.getFieldValue("NAME") ?? "").trim();
      const val = attr.getInputTargetBlock(XML_TEXT_INPUT) ??
        attr.getInputTargetBlock("VALUE");
      if (name) {
        attrs.push(
          `w.writeAttribute(${JSON.stringify(xmlName(name))}, ${
            val ? textOf(emitValue(val, env)) : '""'
          });`,
        );
      }
      attr = attr.getNextBlock();
    }
    const text = block.getInputTargetBlock(XML_TEXT_INPUT);
    if (text) {
      content.push(`w.writeCharacters(${textOf(emitValue(text, env))});`);
    }
    emitChain(block.getInputTargetBlock(XML_CHILDREN_INPUT), env, content);
  } else {
    for (const input of block.inputList) {
      if (
        !input.name.startsWith("TARGET_") &&
        !input.name.startsWith("SCHEMA_OPT_")
      ) continue;
      const field = input.name.replace(/^TARGET_|^SCHEMA_OPT_/, "");
      const child = block.getInputTargetBlock(input.name);
      if (!child) continue;
      if (xmlAttributes.has(field)) {
        attrs.push(
          `w.writeAttribute(${JSON.stringify(xmlName(field))}, ${
            textOf(emitValue(child, env))
          });`,
        );
      } else if (
        input.type === STATEMENT_INPUT_TYPE || isXmlStructure(child.type) ||
        child.type === INCLUDE_WHEN_BLOCK || child.type === "for_each_list"
      ) {
        emitChain(child, env, content);
      } else {
        content.push(
          `w.writeStartElement(${JSON.stringify(xmlName(field))});`,
          `w.writeCharacters(${textOf(emitValue(child, env))});`,
          "w.writeEndElement();",
        );
      }
    }
  }
  // StAX needs attributes before any child content.
  out.push(
    `w.writeStartElement(${JSON.stringify(tag)});`,
    ...attrs,
    ...content,
    "w.writeEndElement();",
  );
}

/** Text content as Mapping preview prints it: null → "", lists joined, whole numbers without ".0". */
function textOf(expr: string): string {
  return `xmlText(${expr})`;
}

function emitValue(block: Block, env: WalkEnv): string {
  if (
    block.type === "text_code" &&
    !isHandlebarsCodeLang(block.getFieldValue("LANG"))
  ) {
    return JSON.stringify(String(block.getFieldValue("TEXT") ?? ""));
  }
  const serialized = blockToExpression(block);
  if (!serialized) {
    throw new Error(
      `Java cannot express a "${block.type}" value block; use TypeScript or XQuery`,
    );
  }
  return emitJavaExpression(parseExpression(serialized), env.ctx);
}
