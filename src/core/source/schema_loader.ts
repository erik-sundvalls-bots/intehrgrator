import type { SchemaTreeNode, SourceFormatId } from "../../types/mod.ts";
import { parseJsonDocument, unwrapExecuteEnvelope } from "./json_document.ts";
import { resolveJsonPointer } from "./json_pointer.ts";
import { childElements, isXmlSchemaRoot, parseXmlDocument } from "../xml/xml_dom.ts";
import { docText, parseXsd, type XsdNode } from "../xsd/xsd_model.ts";

type JsonSchemaObject = Record<string, unknown>;

export function loadJsonSchema(content: string, rootName = "root"): SchemaTreeNode {
  const data = parseJsonDocument(content);
  if (isAvroSchemaDocument(data)) {
    return avroSchemaToTree(data, rootName, "$");
  }
  if (isJsonSchemaDocument(data)) {
    return jsonSchemaToTree(data, rootName, "$");
  }
  return inferSchemaTree(data, rootName, "$");
}

export function inferSchemaFromInstance(content: string, rootName = "root"): SchemaTreeNode {
  const data = unwrapExecuteEnvelope(parseJsonDocument(content));
  return instanceToSchemaTree(data, rootName, "$");
}

export function loadXmlSchemaFromInstance(xml: string, rootName = "root"): SchemaTreeNode {
  const doc = parseXmlDocument(xml);
  return xmlNodeToSchema(doc.documentElement, rootName, `/${doc.documentElement.tagName}`);
}

/**
 * XML Source Schema: an XSD (`xs:schema` root) is read as a schema — element
 * and attribute paths, types, multiplicity and `xs:documentation` — and any
 * other XML document as an instance whose structure is inferred (#278).
 */
export function loadXmlSourceSchema(content: string, rootName = "root", lang?: string): SchemaTreeNode {
  const doc = parseXmlDocument(content);
  if (isXmlSchemaRoot(doc)) return loadXsdSchemaTree(content, lang);
  return xmlNodeToSchema(doc.documentElement, rootName, `/${doc.documentElement.tagName}`);
}

/** Source tree for an XSD; `description` is the documentation in `lang` (else the first). */
export function loadXsdSchemaTree(content: string, lang?: string): SchemaTreeNode {
  return xsdNodeToSchemaTree(parseXsd(content).root, lang);
}

function xsdNodeToSchemaTree(node: XsdNode, lang?: string): SchemaTreeNode {
  const description = docText(node.docs, lang);
  return {
    path: node.path,
    name: node.xmlKind === "attribute" ? `@${node.name}` : node.name,
    type: node.complex && !node.simpleContent ? "element" : node.type,
    multiplicity: node.multiplicity,
    ...(description ? { description } : {}),
    children: node.children.map((child) => xsdNodeToSchemaTree(child, lang)),
  };
}

/** Normalize tree paths so schema (`$.a.b`) and instance (`$.a.b` / `$[1]`) can be matched. */
export function canonicalSyncPath(path: string): string {
  let normalized = path.startsWith("$") ? path : `$.${path.replace(/^\./, "")}`;
  normalized = normalized.replace(/\//g, ".");
  normalized = normalized.replace(/\[\d+\]/g, "[*]");
  normalized = normalized.replace(/\.+/g, ".");
  return normalized;
}

export function findNodeBySyncPath(
  root: SchemaTreeNode,
  syncPath: string,
): SchemaTreeNode | null {
  if (canonicalSyncPath(root.path) === syncPath) return root;
  for (const child of root.children) {
    const found = findNodeBySyncPath(child, syncPath);
    if (found) return found;
  }
  return null;
}

export function isJsonSchemaDocument(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as JsonSchemaObject;
  if (typeof o.$schema === "string") return true;
  if (typeof o.$ref === "string") return true;
  if (o.$defs && typeof o.$defs === "object") return true;
  if (o.definitions && typeof o.definitions === "object") return true;
  if (o.properties && typeof o.properties === "object") return true;
  if (o.type === "object" && o.properties) return true;
  if (o.type === "array" && o.items) return true;
  return false;
}

/** Apache Avro schema (JSON), including Kafka Connect / Schema Registry records. */
export function isAvroSchemaDocument(value: unknown): boolean {
  return isAvroRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAvroRecord(value: unknown): boolean {
  return isRecord(value) && value.type === "record" && Array.isArray(value.fields);
}

function avroSchemaToTree(schema: unknown, name: string, path: string): SchemaTreeNode {
  const optional = avroTypeIsOptional(schema);
  const core = unwrapAvroType(schema);
  if (isAvroRecord(core)) {
    const children = (core.fields as unknown[]).flatMap((field) => {
      if (!isRecord(field) || typeof field.name !== "string") return [];
      return [avroSchemaToTree(field.type, field.name, appendJsonPath(path, field.name))];
    });
    return {
      path,
      name,
      type: "object",
      multiplicity: optional ? "0..1" : "1",
      children,
    };
  }
  if (isRecord(core) && core.type === "array") {
    const item = avroSchemaToTree(core.items, `${name}[*]`, `${path}[*]`);
    return {
      path,
      name,
      type: "array",
      multiplicity: "0..*",
      children: [item],
    };
  }
  if (isRecord(core) && core.type === "map") {
    const item = avroSchemaToTree(core.values, `${name}[*]`, `${path}[*]`);
    return {
      path,
      name,
      type: "object",
      multiplicity: optional ? "0..1" : "1",
      children: [item],
    };
  }
  if (isRecord(core) && core.type === "enum") {
    return {
      path,
      name,
      type: "string",
      multiplicity: optional ? "0..1" : "1",
      children: [],
    };
  }
  const primitive = avroPrimitiveName(core);
  return {
    path,
    name,
    type: primitive,
    multiplicity: optional ? "0..1" : "1",
    children: [],
  };
}

function avroTypeIsOptional(type: unknown): boolean {
  return Array.isArray(type) && type.includes("null");
}

function unwrapAvroType(type: unknown): unknown {
  if (Array.isArray(type)) {
    const nonNull = type.filter((entry) => entry !== "null");
    return unwrapAvroType(nonNull[0] ?? "null");
  }
  return type;
}

function avroPrimitiveName(type: unknown): string {
  const raw = isRecord(type) && typeof type.type === "string" ? type.type : type;
  if (raw === "int" || raw === "long" || raw === "float" || raw === "double") return "number";
  if (raw === "boolean") return "boolean";
  if (raw === "null") return "null";
  return "string";
}

function jsonSchemaToTree(
  schema: JsonSchemaObject,
  name: string,
  path: string,
  root: JsonSchemaObject = schema,
  parentRequired?: Set<string>,
  resolvingRefs: ReadonlySet<string> = new Set(),
): SchemaTreeNode {
  const { schema: resolved, refs } = derefJsonSchema(schema, root, resolvingRefs);
  const type = schemaType(resolved);
  const multiplicity = schemaMultiplicity(resolved, name, parentRequired);

  if (type === "array") {
    const items = resolved.items;
    const itemSchema = Array.isArray(items) ? items[0] : items;
    const children = itemSchema && typeof itemSchema === "object"
      ? [jsonSchemaToTree(
        itemSchema as JsonSchemaObject,
        `${name}[*]`,
        `${path}[*]`,
        root,
        undefined,
        refs,
      )]
      : [];
    return {
      path,
      name,
      type: "array",
      multiplicity,
      ...(schemaDescription(resolved) ? { description: schemaDescription(resolved) } : {}),
      children,
    };
  }

  if (type === "object" || resolved.properties) {
    const props = (resolved.properties ?? {}) as Record<string, JsonSchemaObject>;
    const required = new Set(
      Array.isArray(resolved.required) ? resolved.required.map(String) : [],
    );
    const children = Object.entries(props).map(([key, prop]) =>
      jsonSchemaToTree(prop, key, appendJsonPath(path, key), root, required, refs)
    );
    return {
      path,
      name,
      type: "object",
      multiplicity,
      ...(schemaDescription(resolved) ? { description: schemaDescription(resolved) } : {}),
      children,
    };
  }

  return {
    path,
    name,
    type,
    multiplicity,
    ...(schemaDescription(resolved) ? { description: schemaDescription(resolved) } : {}),
    children: [],
  };
}

function schemaDescription(schema: JsonSchemaObject): string | undefined {
  const raw = schema.description;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/**
 * Inline in-document `$ref` (`#/$defs/…`, `#/definitions/…`).
 * `$defs` / `definitions` stay schema vocabulary — they are not instance properties.
 * Cyclic refs keep the target's type but do not expand properties again (avoids UI blow-up).
 */
function derefJsonSchema(
  schema: JsonSchemaObject,
  root: JsonSchemaObject,
  resolvingRefs: ReadonlySet<string>,
): { schema: JsonSchemaObject; refs: Set<string> } {
  const refs = new Set(resolvingRefs);
  let current: JsonSchemaObject = schema;
  while (typeof current.$ref === "string") {
    const ref = current.$ref;
    const siblings = { ...current };
    delete siblings.$ref;
    if (refs.has(ref)) {
      const target = resolveJsonPointer(root, ref);
      current = {
        ...(isRecord(target) ? schemaTypeHint(target) : {}),
        ...siblings,
      };
      break;
    }
    const target = resolveJsonPointer(root, ref);
    if (!isRecord(target)) {
      const refName = ref.split("/").pop() ?? "ref";
      return { schema: { type: refName, ...siblings }, refs };
    }
    refs.add(ref);
    current = { ...target, ...siblings };
  }
  if (Array.isArray(current.type)) {
    const preferred = current.type.find((t) => t !== "null") ?? current.type[0];
    current = { ...current, type: preferred };
  }
  return { schema: current, refs };
}

/** Type-only view of a schema so a cyclic `$ref` does not re-walk properties/items. */
function schemaTypeHint(schema: JsonSchemaObject): JsonSchemaObject {
  if (typeof schema.type === "string" || Array.isArray(schema.type)) {
    return { type: schema.type };
  }
  if (schema.properties) return { type: "object" };
  if (schema.items) return { type: "array" };
  return {};
}

function schemaType(schema: JsonSchemaObject): string {
  if (typeof schema.type === "string") return schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (Array.isArray(schema.enum) && schema.enum.length) {
    return typeof schema.enum[0] === "number" ? "number" : "string";
  }
  return "unknown";
}

function schemaMultiplicity(
  schema: JsonSchemaObject,
  name: string,
  parentRequired?: Set<string>,
): string {
  if (schema.type === "array" || schema.items) {
    const min = typeof schema.minItems === "number" ? schema.minItems : 0;
    const max = typeof schema.maxItems === "number" ? schema.maxItems : null;
    if (min >= 1 && max === 1) return "1";
    if (min >= 1 && max === null) return "1..*";
    if (min === 0 && max === 1) return "0..1";
    return "0..*";
  }
  if (parentRequired) {
    return parentRequired.has(name) ? "1" : "0..1";
  }
  return "1";
}

function inferSchemaTree(value: unknown, name: string, path: string): SchemaTreeNode {
  if (Array.isArray(value)) {
    const sample = value[0];
    return {
      path,
      name,
      type: "array",
      multiplicity: value.length > 1 ? "1..*" : "0..*",
      children: sample !== undefined
        ? [inferSchemaTree(sample, `${name}[*]`, `${path}[*]`)]
        : [],
    };
  }
  if (value !== null && typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      inferSchemaTree(v, k, appendJsonPath(path, k))
    );
    return { path, name, type: "object", multiplicity: "1", children };
  }
  return {
    path,
    name,
    type: typeof value,
    multiplicity: "1",
    children: [],
  };
}

function instanceToSchemaTree(value: unknown, name: string, path: string): SchemaTreeNode {
  if (Array.isArray(value)) {
    return {
      path,
      name,
      type: "array",
      children: value.map((item, i) =>
        instanceToSchemaTree(item, `[${i}]`, `${path}[${i + 1}]`)
      ),
    };
  }
  if (value !== null && typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      instanceToSchemaTree(v, k, appendJsonPath(path, k))
    );
    return { path, name, type: "object", children };
  }
  return { path, name, type: typeof value, value, children: [] };
}

function xmlNodeToSchema(el: Element, name: string, path: string): SchemaTreeNode {
  const children: SchemaTreeNode[] = [];
  const seen = new Set<string>();
  for (const child of childElements(el)) {
    if (seen.has(child.tagName)) continue;
    seen.add(child.tagName);
    children.push(xmlNodeToSchema(child, child.tagName, `${path}/${child.tagName}`));
  }
  const text = el.textContent?.trim();
  return {
    path,
    name,
    type: children.length ? "element" : "string",
    value: children.length ? undefined : text,
    children,
  };
}

export function pathToFontoxpath(schemaPath: string, format: SourceFormatId): string {
  if (format === "xml") {
    return schemaPath.startsWith("/") ? schemaPath : `/${schemaPath}`;
  }
  if (schemaPath.startsWith("$")) return schemaPath;
  if (schemaPath.startsWith("/")) {
    const parts = schemaPath.split("/").filter(Boolean);
    return parts.reduce((acc, part) => {
      if (part.startsWith("[") && part.endsWith("]")) return `${acc}${part}`;
      return `${acc}/${part}`;
    }, "$");
  }
  return `$.${schemaPath.replace(/^\./, "")}`;
}

/** Append a property to a JSON authoring path without losing punctuation in the key. */
export function appendJsonPath(path: string, key: string): string {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
