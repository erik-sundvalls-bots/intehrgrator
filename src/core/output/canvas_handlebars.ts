/**
 * Canvas-only VMS-Hbs product: Conversion start → Text document → text_handlebars.
 *
 * JSON walks (no Blockly) so Conversion script adapters can read SCRIPT / the
 * Mapping Expression without importing the canvas walker. Seeding a workspace
 * lives in `canvas_handlebars_seed.ts`.
 */

interface BlocklyNode {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlocklyNode; shadow?: BlocklyNode }>;
  extraState?: { itemCount?: number };
  next?: { block?: BlocklyNode };
}

function inputChild(
  input: { block?: BlocklyNode; shadow?: BlocklyNode } | undefined,
): BlocklyNode | undefined {
  return input?.block ?? input?.shadow;
}

function topBlocks(state: unknown): BlocklyNode[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as { blocks?: { blocks?: BlocklyNode[] } }).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function serializeBlock(block: BlocklyNode | undefined): string | null {
  if (!block?.type) return null;
  switch (block.type) {
    case "text":
    case "text_code":
      return JSON.stringify(String(block.fields?.TEXT ?? ""));
    case "math_number":
      return String(block.fields?.NUM ?? 0);
    case "logic_boolean":
      return block.fields?.BOOL === "TRUE" ? "true" : "false";
    case "source_query":
    case "source_query_number":
      return `xpathString(${JSON.stringify(String(block.fields?.EXPRESSION ?? ""))})`;
    case "source_query_boolean":
      return `xpathBoolean(${JSON.stringify(String(block.fields?.EXPRESSION ?? ""))})`;
    case "source_query_node":
      return `xpathNode(${JSON.stringify(String(block.fields?.EXPRESSION ?? ""))})`;
    case "maps_create_empty":
      return "map()";
    case "maps_create_with": {
      const count = Number(block.extraState?.itemCount ?? 0);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        parts.push(JSON.stringify(String(block.fields?.[`KEY${i}`] ?? "")));
        parts.push(serializeBlock(inputChild(block.inputs?.[`VAL${i}`])) ?? "null");
      }
      return `map(${parts.join(", ")})`;
    }
    case "text_handlebars": {
      const script = serializeBlock(inputChild(block.inputs?.SCRIPT)) ?? '""';
      const context = serializeBlock(inputChild(block.inputs?.CONTEXT)) ?? "map()";
      return `handlebars(${script}, ${context})`;
    }
    default:
      return null;
  }
}

/**
 * The canvas `text_handlebars` product block: the VALUE of the Text document
 * that is the instance root (Conversion start → Text document → Handlebars).
 * A `text_handlebars` used as a value anywhere else (a JSON Schema field, an
 * XML element, inside a text join) is an ordinary value and does not turn the
 * whole canvas into a Handlebars product (issue #394).
 */
function canvasHandlebarsProductBlock(state: unknown): BlocklyNode | null {
  for (const top of topBlocks(state)) {
    const roots: BlocklyNode[] = [];
    if (top.type === "conversion_start") {
      for (let node = top.next?.block; node; node = node.next?.block) roots.push(node);
    } else {
      roots.push(top);
    }
    for (const root of roots) {
      if (root.type !== "text_document") continue;
      const value = inputChild(root.inputs?.VALUE);
      if (value?.type === "text_handlebars") return value;
    }
  }
  return null;
}

/** SCRIPT text of the canvas `text_handlebars` product, if any. */
export function canvasHandlebarsScriptLiteral(state: unknown): string | null {
  const block = canvasHandlebarsProductBlock(state);
  const script = inputChild(block?.inputs?.SCRIPT);
  return script?.fields?.TEXT != null ? String(script.fields.TEXT) : null;
}

/**
 * Mapping Expression `handlebars(script, context)` for the canvas
 * `text_handlebars` product, or `null` when the canvas has none.
 */
export function canvasHandlebarsExpression(state: unknown): string | null {
  const block = canvasHandlebarsProductBlock(state);
  return block ? serializeBlock(block) : null;
}
