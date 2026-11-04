/**
 * Mapping preview for a schema-less JSON or plain text document (#198).
 * Walks workspace JSON (no live Blockly). XML documents stay on the XML walker.
 */
import { evaluate, type SourceContext } from "../source/query_runtime.ts";
import { TEXT_DOCUMENT_BLOCK_TYPE } from "../../blockly/instance_root.ts";

interface BlocklyInput {
  block?: BlocklyNode;
  shadow?: BlocklyNode;
}

interface BlocklyNode {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, BlocklyInput>;
  next?: { block?: BlocklyNode };
}

function inputChild(input: BlocklyInput | undefined): BlocklyNode | undefined {
  return input?.block ?? input?.shadow;
}

function topBlocks(state: unknown): BlocklyNode[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as { blocks?: { blocks?: BlocklyNode[] } }).blocks
    ?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function productRoot(
  state: unknown,
  accept: (type: string) => boolean,
): BlocklyNode | null {
  for (const top of topBlocks(state)) {
    if (top.type === "conversion_start") {
      let current = top.next?.block;
      while (current) {
        if (accept(current.type ?? "")) return current;
        current = current.next?.block;
      }
      continue;
    }
    if (accept(top.type ?? "")) return top;
  }
  return null;
}

function queryValue(block: BlocklyNode, ctx: SourceContext): unknown {
  const expr = String(block.fields?.EXPRESSION ?? "");
  const call = block.type === "source_query_number"
    ? ["xpathNumber", "number"]
    : block.type === "source_query_boolean"
    ? ["xpathBoolean", "boolean"]
    : block.type === "source_query_node"
    ? ["xpathNode", "any"]
    : ["xpathString", "string"];
  try {
    return evaluate(`${call[0]}(${JSON.stringify(expr)})`, ctx, call[1]!);
  } catch {
    return null;
  }
}

function isSourceQuery(type: string | undefined): boolean {
  return type === "source_query" || type === "source_query_number" ||
    type === "source_query_boolean" || type === "source_query_node";
}

function isJsonItem(type: string | undefined): boolean {
  return type === "json_value" || type === "json_boolean" ||
    type === "json_null" ||
    type === "json_object" || type === "json_array";
}

function valueOf(block: BlocklyNode | undefined, ctx: SourceContext): unknown {
  const type = block?.type ?? "";
  if (!block || !type) return null;
  if (type === "text" || type === "text_code") {
    return String(block.fields?.TEXT ?? "");
  }
  if (type === "math_number") return Number(block.fields?.NUM ?? 0);
  if (type === "logic_boolean") return block.fields?.BOOL === "TRUE";
  if (type === "json_null") return null;
  if (type === "json_boolean") {
    return Boolean(valueOf(inputChild(block.inputs?.VALUE), ctx));
  }
  if (type === "json_value") {
    return valueOf(inputChild(block.inputs?.VALUE), ctx);
  }
  if (type === "json_object") return objectOf(block, ctx);
  if (type === "json_array") return arrayOf(block, ctx);
  if (isSourceQuery(type)) return queryValue(block, ctx);
  return null;
}

function chainValues(
  block: BlocklyNode | undefined,
  ctx: SourceContext,
): unknown[] {
  const values: unknown[] = [];
  let current = block;
  while (current?.type) {
    if (isJsonItem(current.type)) values.push(valueOf(current, ctx));
    current = current.next?.block;
  }
  return values;
}

function objectOf(
  block: BlocklyNode,
  ctx: SourceContext,
): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    if (!name.startsWith("TARGET_")) continue;
    const values = chainValues(inputChild(input), ctx);
    if (!values.length) continue;
    const key = name.slice("TARGET_".length);
    object[key] = values.length === 1 ? values[0] : values;
  }
  return object;
}

function arrayOf(block: BlocklyNode, ctx: SourceContext): unknown[] {
  const items: unknown[] = [];
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    if (!name.startsWith("TARGET_") && !/^ADD\d+$/.test(name)) continue;
    items.push(...chainValues(inputChild(input), ctx));
  }
  return items;
}

/**
 * Pretty JSON for a schema-less `json_object` / `json_array` product.
 * Returns null when the canvas has no such root.
 */
export function renderJsonCanvasFromBlockly(
  state: unknown,
  ctx: SourceContext,
): string | null {
  const root = productRoot(
    state,
    (type) => type === "json_object" || type === "json_array",
  );
  if (!root) return null;
  return `${JSON.stringify(valueOf(root, ctx), null, 2)}\n`;
}

/**
 * Plain text for a `text_document` whose content is a literal or a source query.
 * Returns null for Handlebars / code text so the conversion-script preview still runs.
 */
export function renderTextDocumentFromBlockly(
  state: unknown,
  ctx: SourceContext,
): string | null {
  const root = productRoot(state, (type) => type === TEXT_DOCUMENT_BLOCK_TYPE);
  if (!root) return null;
  const value = inputChild(root.inputs?.VALUE);
  const type = value?.type ?? "";
  if (type === "text_handlebars" || type === "text_code") return null;
  if (
    type && type !== "text" && type !== "math_number" &&
    type !== "logic_boolean" && !isSourceQuery(type)
  ) {
    return null;
  }
  let text = "";
  if (!value) text = "";
  else if (type === "text") text = String(value.fields?.TEXT ?? "");
  else if (type === "math_number") text = String(value.fields?.NUM ?? "0");
  else if (type === "logic_boolean") {
    text = value.fields?.BOOL === "TRUE" ? "true" : "false";
  } else if (isSourceQuery(type)) {
    const queried = queryValue(value, ctx);
    text = queried == null ? "" : String(queried);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}
