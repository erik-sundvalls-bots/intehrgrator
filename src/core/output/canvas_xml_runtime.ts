import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";
/**
 * Evaluate a Blockly XML / XSD schema canvas to an instance string.
 *
 * Used by Handlebars Output mode and Mapping preview so nested `text_code`
 * LANG=handlebars Notes, `include_when`, and `controls_if` evaluate (issues #168 / #176).
 * Free-form Handlebars (no XML/schema root) does not use this walker.
 * Walks workspace JSON (no live Blockly).
 */

import {
  collectJsonNodes,
  evaluate,
  type SourceContext,
} from "../source/query_runtime.ts";
import { renderHandlebars } from "./handlebars_dialect.ts";
import {
  injectXmlnsOnOpenTag,
  wrapXmlCdata,
  xmlDeclarationLine,
  XML_ATTRIBUTES_INPUT,
  XML_CHILDREN_INPUT,
  XML_DOCUMENT_TYPE,
  XML_ELEMENT_TYPE,
  XML_ROOT_INPUT,
  XML_TEXT_INPUT,
  type XmlNamespaceDecl,
} from "../xml_shape.ts";

interface BlocklyInput {
  block?: BlocklyNode;
  shadow?: BlocklyNode;
}

interface BlocklyNode {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, BlocklyInput>;
  extraState?: {
    name?: string;
    params?: unknown[];
    elseIfCount?: number;
    hasElse?: boolean;
    itemCount?: number;
    xmlAttributes?: string[];
    fields?: Array<{ name: string; xmlKind?: string; kind?: string }>;
    optionalFields?: Array<{ name: string; xmlKind?: string; kind?: string }>;
    declaration?: boolean;
    version?: string;
    encoding?: string;
    standalone?: string;
    namespaces?: XmlNamespaceDecl[];
    extras?: string[];
  };
  next?: { block?: BlocklyNode };
}

function inputChild(input: BlocklyInput | undefined): BlocklyNode | undefined {
  return input?.block ?? input?.shadow;
}

function topBlocks(state: unknown): BlocklyNode[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as { blocks?: { blocks?: BlocklyNode[] } }).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function isXmlProduct(node: BlocklyNode | undefined): boolean {
  const type = node?.type ?? "";
  return type === XML_ELEMENT_TYPE || type === XML_DOCUMENT_TYPE || type.startsWith("schema_");
}

function isStructure(type: string | undefined): boolean {
  return type === XML_ELEMENT_TYPE || type === XML_DOCUMENT_TYPE ||
    (type?.startsWith("schema_") ?? false) ||
    type === "controls_if" || type === "include_when" ||
    type === "for_each_list" || type === "for_each_source";
}

function xmlCanvasRoot(state: unknown): BlocklyNode | null {
  const tops = topBlocks(state);
  for (const top of tops) {
    if (top.type === "conversion_start") {
      const next = top.next?.block;
      if (isXmlProduct(next)) return next!;
    }
  }
  for (const top of tops) {
    if (isXmlProduct(top)) return top;
  }
  return null;
}

/** True when the canvas has an XML / XSD schema product tree. */
export function hasXmlCanvasProduct(state: unknown): boolean {
  return xmlCanvasRoot(state) != null;
}

/**
 * Render the XML product tree against the active Example Instance.
 * Returns `null` when the canvas has no XML/schema instance root.
 */
export function renderXmlCanvasFromBlockly(
  state: unknown,
  ctx: SourceContext,
): string | null {
  const root = xmlCanvasRoot(state);
  if (!root) return null;
  const names = new Map<string, string>();
  const variables = (state as {variables?: Array<{id: string; name: string}>}).variables ?? [];
  for (const variable of variables) names.set(variable.id, variable.name);
  const prepared = structuredClone(root);
  bindExpressionNames(prepared, names);
  const lines = renderBlock(prepared, ctx);
  if (!lines.length) return null;
  return lines.join("\n");
}

/** Resolve saved variable IDs and implicit lexical loop reporters without live Blockly. */
function variableName(value: unknown, names = new Map<string, string>()): string {
  if (value && typeof value === "object") {
    const field = value as {id?: string; name?: string};
    return names.get(field.id ?? "") ?? field.name ?? field.id ?? "";
  }
  const name = String(value ?? "");
  return names.get(name) ?? name;
}

function bindExpressionNames(block: BlocklyNode, names: Map<string, string>, item = "item", loop = "item"): void {
  const fields = block.fields ??= {};
  if (fields.VAR != null) fields.VAR = variableName(fields.VAR, names);
  if (block.type === "logic_current_item" && !fields.VAR) fields.VAR = item;
  if ((block.type === "logic_loop_index" || block.type === "logic_loop_length") && !fields.VAR) fields.VAR = loop;
  const isLoop = block.type === "for_each_list" || block.type === "for_each_source";
  for (const [input, child] of Object.entries(block.inputs ?? {})) {
    const nestedLoop = isLoop && input === "DO" ? String(fields.VAR || "item") : loop;
    const nestedItem = isLoop && input === "DO" ? nestedLoop
      : block.type === "logic_list_restriction" && input === "PRED" ? String(fields.VAR || "item") : item;
    if (child.block) bindExpressionNames(child.block, names, nestedItem, nestedLoop);
    if (child.shadow) bindExpressionNames(child.shadow, names, nestedItem, nestedLoop);
  }
  if (block.next?.block) bindExpressionNames(block.next.block, names, item, loop);
}

function renderBlock(block: BlocklyNode, ctx: SourceContext): string[] {
  const type = block.type ?? "";
  if (type === "include_when") return renderIncludeWhen(block, ctx);
  if (type === "controls_if") return renderControlsIf(block, ctx);
  if (type === "for_each_list" || type === "for_each_source") return renderForEach(block, ctx);
  if (type === "xml_text" || type === "xml_cdata") {
    const inner = inputChild(block.inputs?.[XML_TEXT_INPUT]) ?? inputChild(block.inputs?.VALUE);
    const text = inner ? renderValue(inner, ctx) : String(block.fields?.TEXT ?? "");
    return type === "xml_cdata" ? [wrapXmlCdata(text)] : text ? [text] : [];
  }
  if (type === XML_DOCUMENT_TYPE) return renderXmlDocument(block, ctx);
  if (type === XML_ELEMENT_TYPE || type.startsWith("schema_")) {
    return renderXmlOrSchema(block, ctx);
  }
  if (type === "text" || type === "text_code" || type === "text_handlebars") {
    const text = renderValue(block, ctx);
    return text ? [text] : [];
  }
  return [];
}

function renderChain(block: BlocklyNode | undefined, ctx: SourceContext): string[] {
  const lines: string[] = [];
  let current = block;
  while (current?.type) {
    lines.push(...renderBlock(current, ctx));
    current = current.next?.block;
  }
  return lines;
}

function renderIncludeWhen(block: BlocklyNode, ctx: SourceContext): string[] {
  const cond = inputChild(block.inputs?.WHEN);
  const ok = isTruthy(cond ? evalSerialized(cond, ctx, "boolean") : false);
  const branch = ok ? inputChild(block.inputs?.DO) : inputChild(block.inputs?.ELSE);
  return renderChain(branch, ctx);
}

function renderControlsIf(block: BlocklyNode, ctx: SourceContext): string[] {
  const extra = block.extraState;
  let ifCount = 0;
  if (extra?.elseIfCount != null) ifCount = extra.elseIfCount + 1;
  else {
    while (block.inputs?.[`IF${ifCount}`] || block.inputs?.[`DO${ifCount}`]) ifCount++;
  }
  ifCount = Math.max(ifCount, 1);
  const hasElse = extra?.hasElse ?? Boolean(block.inputs?.ELSE);

  for (let i = 0; i < ifCount; i++) {
    const cond = inputChild(block.inputs?.[`IF${i}`]);
    if (isTruthy(cond ? evalSerialized(cond, ctx, "boolean") : true)) {
      return renderChain(inputChild(block.inputs?.[`DO${i}`]), ctx);
    }
  }
  if (hasElse) return renderChain(inputChild(block.inputs?.ELSE), ctx);
  return [];
}

function renderForEach(block: BlocklyNode, ctx: SourceContext): string[] {
  const varName = String(block.fields?.VAR ?? "item");
  const list = inputChild(block.inputs?.LIST);
  const path = list && isSourceQuery(list.type)
    ? String(list.fields?.EXPRESSION ?? "")
    : String(block.fields?.PATH ?? "");
  const nodes = path && ctx.json !== undefined
    ? collectJsonNodes(path, ctx.relativeRoot ?? ctx.json)
    : asList(list ? evalSerialized(list, ctx, "list") : []);
  const body = inputChild(block.inputs?.DO);
  if (!body) return [];
  const lines: string[] = [];
  for (const [index, node] of nodes.entries()) {
    const inner: SourceContext = {
      ...ctx,
      vars: { ...(ctx.vars ?? {}), [varName]: node,
        [loopIndexBinderName(varName)]: index, [loopLengthBinderName(varName)]: nodes.length },
      loopNames: [...(ctx.loopNames ?? []), varName],
      relativeRoot: node,
    };
    lines.push(...renderChain(body, inner));
  }
  return lines;
}

function isSourceQuery(type: string | undefined): boolean {
  return type === "source_query" || type === "source_query_number" ||
    type === "source_query_boolean" || type === "source_query_node";
}

function renderXmlDocument(block: BlocklyNode, ctx: SourceContext): string[] {
  const extra = block.extraState ?? {};
  const extras = extra.extras ?? [];
  const declaration = extra.declaration !== false &&
    (extras.length === 0 || extras.includes("declaration") || extra.declaration === true ||
      block.fields?.VERSION != null);
  const lines: string[] = [];
  if (declaration) {
    lines.push(xmlDeclarationLine({
      version: String(block.fields?.VERSION || extra.version || "1.0"),
      encoding: String(block.fields?.ENCODING || extra.encoding || "UTF-8"),
      standalone: String(block.fields?.STANDALONE || extra.standalone || ""),
    }));
  }
  const root = inputChild(block.inputs?.[XML_ROOT_INPUT]);
  if (!root) return lines;
  const emitted = renderBlock(root, ctx);
  const namespaces = extra.namespaces ?? [];
  if (namespaces.length && emitted[0]) {
    emitted[0] = injectXmlnsOnOpenTag(emitted[0], namespaces);
  }
  lines.push(...emitted);
  return lines;
}

function renderXmlOrSchema(block: BlocklyNode, ctx: SourceContext): string[] {
  if (block.type === XML_DOCUMENT_TYPE) return renderXmlDocument(block, ctx);
  const tag = xmlTagName(block);
  const extra = block.extraState ?? {};
  const xmlAttributes = new Set<string>([
    ...(extra.xmlAttributes ?? []),
    ...(extra.fields ?? []).filter((field) => field.xmlKind === "attribute").map((field) => field.name),
  ]);
  const fieldSpecs = [...(extra.fields ?? []), ...(extra.optionalFields ?? [])];
  const attrParts: string[] = [];
  const inner: string[] = [];

  if (block.type === XML_ELEMENT_TYPE) {
    let attr = inputChild(block.inputs?.[XML_ATTRIBUTES_INPUT]);
    while (attr) {
      if (attr.type === "xml_attribute") {
        const name = String(attr.fields?.NAME ?? "").trim();
        const val = inputChild(attr.inputs?.[XML_TEXT_INPUT]) ?? inputChild(attr.inputs?.VALUE);
        if (name) attrParts.push(` ${name}="${escapeXml(val ? renderValue(val, ctx) : "")}"`);
      }
      attr = attr.next?.block;
    }
    const text = inputChild(block.inputs?.[XML_TEXT_INPUT]);
    if (text) inner.push(escapeXml(renderValue(text, ctx)));
    inner.push(...renderChain(inputChild(block.inputs?.[XML_CHILDREN_INPUT]), ctx));
  } else {
    for (const [key, value] of Object.entries(block.inputs ?? {})) {
      if (!key.startsWith("TARGET_") && !key.startsWith("SCHEMA_OPT_")) continue;
      const fieldName = key.replace(/^TARGET_|^SCHEMA_OPT_/, "");
      const child = inputChild(value);
      if (!child?.type) continue;
      const spec = fieldSpecs.find((field) => field.name === fieldName);
      if (xmlAttributes.has(fieldName) || child.type === "xml_attribute") {
        attrParts.push(` ${fieldName}="${escapeXml(renderValue(child, ctx))}"`);
        continue;
      }
      if (spec?.kind === "statement" || isStructure(child.type)) {
        inner.push(...renderChain(child, ctx));
        continue;
      }
      inner.push(
        `<${xmlName(fieldName)}>${escapeXml(renderValue(child, ctx))}</${xmlName(fieldName)}>`,
      );
    }
  }

  const attrs = attrParts.join("");
  if (inner.length) return [`<${tag}${attrs}>`, ...inner, `</${tag}>`];
  return [`<${tag}${attrs}></${tag}>`];
}

function renderValue(block: BlocklyNode, ctx: SourceContext): string {
  const type = block.type ?? "";
  if (type === "text") return String(block.fields?.TEXT ?? "");
  if (type === "math_number") return String(block.fields?.NUM ?? "0");
  if (type === "logic_boolean") return block.fields?.BOOL === "TRUE" ? "true" : "false";
  if (type === "text_code") {
    const lang = String(block.fields?.LANG ?? "");
    const text = String(block.fields?.TEXT ?? "");
    if (lang === "handlebars" || lang === "hbs") {
      try {
        return renderHandlebars(text, ctx.data);
      } catch {
        return text;
      }
    }
    return text;
  }
  if (type === "text_handlebars") {
    const serialized = serializeBlock(block);
    if (!serialized) return "";
    return stringify(evalSerializedExpr(serialized, ctx, "string"));
  }
  if (type === "xml_text" || type === "xml_cdata") {
    const inner = inputChild(block.inputs?.[XML_TEXT_INPUT]) ?? inputChild(block.inputs?.VALUE);
    return inner ? renderValue(inner, ctx) : String(block.fields?.TEXT ?? "");
  }
  const serialized = serializeBlock(block);
  if (!serialized) return "";
  return stringify(evalSerializedExpr(serialized, ctx, "string"));
}

function evalSerialized(
  block: BlocklyNode,
  ctx: SourceContext,
  returnType: string,
): unknown {
  const serialized = serializeBlock(block);
  if (!serialized) return null;
  return evalSerializedExpr(serialized, ctx, returnType);
}

function evalSerializedExpr(
  expression: string,
  ctx: SourceContext,
  returnType: string,
): unknown {
  try {
    return evaluate(expression, ctx, returnType);
  } catch {
    return null;
  }
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
    case "source_query_boolean":
    case "source_query_node": {
      const expr = String(block.fields?.EXPRESSION ?? "");
      const fn = block.type === "source_query_number" ? "xpathNumber"
        : block.type === "source_query_boolean" ? "xpathBoolean"
        : block.type === "source_query_node" ? "xpathNode"
        : "xpathString";
      return `${fn}(${JSON.stringify(expr)})`;
    }
    case "logic_null": return "null";
    case "variables_get": return `var(${JSON.stringify(variableName(block.fields?.VAR))})`;
    case "logic_loop_index": return `var(${JSON.stringify(loopIndexBinderName(String(block.fields?.VAR || "item")))})`;
    case "logic_loop_length": return `var(${JSON.stringify(loopLengthBinderName(String(block.fields?.VAR || "item")))})`;
    case "procedures_callreturn": {
      const name = String(block.fields?.NAME || block.extraState?.name || "");
      const args: string[] = [];
      // Disconnected inputs are absent from saved JSON; preserve their argument positions.
      const connected = Object.keys(block.inputs ?? {}).filter(key => /^ARG\d+$/.test(key)).map(key => Number(key.slice(3)) + 1);
      const count = Math.max(block.extraState?.params?.length ?? 0, ...connected);
      for (let i = 0; i < count; i++) args.push(serializeBlock(inputChild(block.inputs?.[`ARG${i}`])) ?? "null");
      return `call(${[JSON.stringify(name), ...args].join(", ")})`;
    }
    case "text_trim": return `trim(${serializeBlock(inputChild(block.inputs?.TEXT)) ?? '""'})`;
    case "maps_entries": return `maps_entries(${serializeBlock(inputChild(block.inputs?.MAP)) ?? "map()"})`;
    case "lists_length": return `lists_length(${serializeBlock(inputChild(block.inputs?.VALUE)) ?? "list()"})`;
    case "lists_getIndex": {
      const list = serializeBlock(inputChild(block.inputs?.VALUE)) ?? "list()";
      const where = JSON.stringify(String(block.fields?.WHERE || "FIRST"));
      const at = serializeBlock(inputChild(block.inputs?.AT)) ?? "1";
      return `lists_getIndex(${list}, ${where}, ${at})`;
    }
    case "math_arithmetic": {
      const op = {ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/"}[String(block.fields?.OP)] ?? "+";
      return `(${serializeBlock(inputChild(block.inputs?.A)) ?? "0"} ${op} ${serializeBlock(inputChild(block.inputs?.B)) ?? "0"})`;
    }
    case "maps_get": {
      const name = String(block.fields?.NAME ?? "defaults");
      const key = serializeBlock(inputChild(block.inputs?.KEY)) ?? '""';
      const map = serializeBlock(inputChild(block.inputs?.MAP)) ?? JSON.stringify(name);
      return `maps_get(${map}, ${key})`;
    }
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
    case "decision_table": {
      const name = String(block.fields?.NAME ?? "Decision1");
      const inputs = serializeBlock(inputChild(block.inputs?.INPUTS)) ?? "map()";
      const output = String(block.fields?.OUTPUT ?? "out");
      return `decision_table(${JSON.stringify(name)}, ${inputs}, ${JSON.stringify(output)})`;
    }
    case "sheet_lookup": {
      const name = serializeBlock(inputChild(block.inputs?.SHEET)) ?? JSON.stringify(String(block.fields?.NAME ?? "Sheet1"));
      const col = serializeBlock(inputChild(block.inputs?.MATCH_COL)) ?? '""';
      const val = serializeBlock(inputChild(block.inputs?.MATCH_VAL)) ?? '""';
      const ret = serializeBlock(inputChild(block.inputs?.RETURN_COL));
      return ret
        ? `sheet_lookup(${name}, ${col}, ${val}, ${ret})`
        : `sheet_lookup(${name}, ${col}, ${val})`;
    }
    case "logic_compare": {
      const op = String(block.fields?.OP ?? "EQ");
      const a = serializeBlock(inputChild(block.inputs?.A)) ?? "null";
      const b = serializeBlock(inputChild(block.inputs?.B)) ?? "null";
      const fn = { EQ: "eq", NEQ: "ne", LT: "lt", LTE: "le", GT: "gt", GTE: "ge" }[op] ?? "eq";
      return `${fn}(${a}, ${b})`;
    }
    case "logic_operation": {
      const op = String(block.fields?.OP ?? "AND");
      const a = serializeBlock(inputChild(block.inputs?.A)) ?? "false";
      const b = serializeBlock(inputChild(block.inputs?.B)) ?? "false";
      return `${op === "OR" ? "or" : "and"}(${a}, ${b})`;
    }
    case "logic_negate": {
      const inner = serializeBlock(inputChild(block.inputs?.BOOL)) ?? "false";
      return `not(${inner})`;
    }
    case "logic_ternary": {
      const cond = serializeBlock(inputChild(block.inputs?.IF)) ?? "false";
      const thenV = serializeBlock(inputChild(block.inputs?.THEN)) ?? "null";
      const elseV = serializeBlock(inputChild(block.inputs?.ELSE)) ?? "null";
      return `if(${cond}, ${thenV}, ${elseV})`;
    }
    case "text_changeCase": {
      const inner = serializeBlock(inputChild(block.inputs?.TEXT)) ?? '""';
      const mode = String(block.fields?.CASE ?? "LOWERCASE");
      return `change_case(${inner}, ${JSON.stringify(mode)})`;
    }
    case "text_join": {
      const count = Number(block.extraState?.itemCount ?? 0);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        parts.push(serializeBlock(inputChild(block.inputs?.[`ADD${i}`])) ?? '""');
      }
      if (parts.length === 0) return '""';
      if (parts.length === 1) return parts[0]!;
      return `concat(${parts.join(", ")})`;
    }
    case "lists_create_with": {
      const count = Number(block.extraState?.itemCount ?? 0);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        parts.push(serializeBlock(inputChild(block.inputs?.[`ADD${i}`])) ?? "null");
      }
      return `list(${parts.join(", ")})`;
    }
    case "logic_current_item": {
      const name = String(block.fields?.VAR ?? "") || "item";
      return `var(${JSON.stringify(name)})`;
    }
    case "logic_list_restriction": {
      const op = String(block.fields?.OP ?? "ALL");
      const fn = {
        ALL: "all_of",
        ANY: "any_of",
        NONE: "none_of",
        AT_LEAST: "at_least",
        AT_MOST: "at_most",
        EXACTLY: "exactly",
      }[op] ?? "all_of";
      const list = serializeBlock(inputChild(block.inputs?.LIST)) ?? "list()";
      const pred = serializeBlock(inputChild(block.inputs?.PRED)) ?? "true";
      const name = JSON.stringify(String(block.fields?.VAR || "item"));
      const needsCount = op === "AT_LEAST" || op === "AT_MOST" || op === "EXACTLY";
      const call = needsCount
        ? `${fn}(${list}, ${Number(block.fields?.N ?? 1)}, ${name}, ${pred})`
        : `${fn}(${list}, ${name}, ${pred})`;
      return call;
    }
    default:
      return null;
  }
}

function xmlTagName(block: BlocklyNode): string {
  const slot = String(block.fields?.SLOT_ID ?? "");
  const path = slot.includes(":") ? slot.slice(slot.indexOf(":") + 1) : slot;
  const fromPath = path.split("/").filter((part) => part && !part.startsWith("@")).pop();
  if (fromPath) return fromPath;
  return String(block.fields?.NAME ?? "element").trim() || "element";
}

function xmlName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isTruthy(value: unknown): boolean {
  if (value == null || value === false || value === "" || value === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return Boolean(value);
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}
