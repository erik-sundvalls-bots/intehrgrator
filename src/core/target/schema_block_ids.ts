/**
 * Schema-specific Blockly type ids for JSON Schema / XML Schema containers.
 * Assigned on the skeleton so canvas, toolbox, and connection checks share one name.
 */
import type { SkeletonNode } from "../../types/mod.ts";
import { isRepeatingMultiplicity } from "../skeleton/generate_skeleton.ts";

export const SCHEMA_BLOCK_PREFIX = "schema_";

export function isSchemaStructureBlockType(type: string | undefined): boolean {
  if (!type) return false;
  return type === "target_structure" || type.startsWith(SCHEMA_BLOCK_PREFIX);
}

export function sanitizeSchemaTypeId(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const trimmed = safe.slice(0, 48) || "node";
  return `${SCHEMA_BLOCK_PREFIX}${/^[A-Za-z]/.test(trimmed) ? trimmed : `n_${trimmed}`}`;
}

export function schemaFieldName(node: SkeletonNode): string {
  return (node.rmAttribute || node.label || "field").replace(/\[\*\]$/, "");
}

/** Primitive JSON / XSD types that should be parent value slots, not wrapper blocks. */
export function isSchemaPrimitiveType(rmType: string): boolean {
  const t = stripXmlns(rmType).toLowerCase();
  return SCHEMA_PRIMITIVE_TYPES.has(t) || t.startsWith("attribute:");
}

export function schemaPrimitiveKind(
  rmType: string,
): "string" | "number" | "boolean" {
  const t = stripXmlns(rmType).toLowerCase();
  if (t === "boolean") return "boolean";
  if (SCHEMA_NUMBER_TYPES.has(t)) return "number";
  return "string";
}

/** Blockly connection check for an inlined primitive (or Array when repeating). */
export function schemaPrimitiveCheck(
  rmType: string,
  repeating: boolean,
): string | string[] {
  if (repeating) return "Array";
  switch (schemaPrimitiveKind(rmType)) {
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    default:
      return "String";
  }
}

export interface SchemaInputSpec {
  name: string;
  kind: "value" | "statement";
  check: string | string[] | null;
  card?: { min: number; max: number | null };
  documentation?: string;
  slotId: string;
  xmlKind?: "element" | "attribute";
  childBlockType?: string;
}

const STATEMENT_WRAPPERS = ["controls_if", "for_each_list", "include_when"];

export function specForChild(child: SkeletonNode): SchemaInputSpec {
  const name = schemaFieldName(child);
  const kind = schemaChildInputKind(child);
  const card = parseSchemaCardinality(child.slotCardinality ?? child.multiplicity);
  const docs = child.documentation?.trim();
  if (child.kind === "value" || isSchemaPrimitiveType(child.rmType)) {
    return {
      name,
      kind: "value",
      check: schemaPrimitiveCheck(child.rmType, isRepeatingSchemaNode(child)),
      card,
      slotId: child.slotId,
      xmlKind: child.xmlKind,
      ...(docs ? { documentation: docs } : {}),
    };
  }
  const typeCheck = child.blockType;
  return {
    name,
    kind,
    check: kind === "statement" ? [typeCheck, ...STATEMENT_WRAPPERS] : typeCheck,
    card,
    slotId: child.slotId,
    xmlKind: child.xmlKind,
    childBlockType: typeCheck,
    ...(docs ? { documentation: docs } : {}),
  };
}

export function schemaInputSpecs(
  node: SkeletonNode,
  options: { mandatoryOnly?: boolean } = {},
): SchemaInputSpec[] {
  return node.children
    .filter((child) => options.mandatoryOnly ? child.mandatory === true : true)
    .map((child) => specForChild(child));
}

export function parseSchemaCardinality(
  raw?: string | null,
): { min: number; max: number | null } | undefined {
  if (!raw) return undefined;
  const text = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (text === "1") return { min: 1, max: 1 };
  const star = /^(\d+)\.\.\*$/.exec(text);
  if (star) return { min: Number(star[1]), max: null };
  const range = /^(\d+)\.\.(\d+)$/.exec(text);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return undefined;
}

export function isRepeatingSchemaNode(node: SkeletonNode): boolean {
  return isRepeatingMultiplicity(node.multiplicity) ||
    isRepeatingMultiplicity(node.slotCardinality);
}

/** Single-occurrence complex children are puzzle pieces; repeating ones are mouths. */
export function schemaChildInputKind(
  child: SkeletonNode,
): "value" | "statement" {
  if (child.kind === "value" || isSchemaPrimitiveType(child.rmType)) return "value";
  return isRepeatingSchemaNode(child) ? "statement" : "value";
}

export function schemaConnectionMode(
  node: SkeletonNode,
  isRoot: boolean,
): "statement" | "value" {
  if (isRoot) return "statement";
  return isRepeatingSchemaNode(node) ? "statement" : "value";
}

/**
 * Give every container a stable `schema_*` blockType. Reuses the same id when
 * two nodes share a name and the same child-field signature.
 */
export function assignSchemaBlockTypes(root: SkeletonNode): void {
  const used = new Map<string, string>();
  const walk = (node: SkeletonNode) => {
    if (node.kind === "container") {
      node.blockType = uniqueSchemaTypeId(node, used);
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
}

function uniqueSchemaTypeId(
  node: SkeletonNode,
  used: Map<string, string>,
): string {
  const base = sanitizeSchemaTypeId(schemaFieldName(node) || node.label);
  const sig = childSignature(node);
  const existing = used.get(base);
  if (!existing) {
    used.set(base, sig);
    return base;
  }
  if (existing === sig) return base;
  const pathBit = (node.targetPath ?? node.slotId).split("/").filter(Boolean).slice(-2)
    .join("_");
  return sanitizeSchemaTypeId(`${schemaFieldName(node)}_${pathBit}`);
}

function childSignature(node: SkeletonNode): string {
  return node.children
    .map((child) =>
      `${schemaFieldName(child)}:${child.kind}:${child.rmType}:${child.multiplicity ?? ""}`
    )
    .join("|");
}

function stripXmlns(rmType: string): string {
  return rmType.replace(/^attribute:/, "").split(":").pop() ?? rmType;
}

const SCHEMA_NUMBER_TYPES = new Set([
  "number",
  "integer",
  "int",
  "long",
  "short",
  "byte",
  "decimal",
  "float",
  "double",
  "unsignedlong",
  "unsignedint",
  "unsignedshort",
  "unsignedbyte",
  "positiveinteger",
  "negativeinteger",
  "nonnegativeinteger",
  "nonpositiveinteger",
]);

const SCHEMA_PRIMITIVE_TYPES = new Set([
  "string",
  "boolean",
  "null",
  "normalizedstring",
  "token",
  "language",
  "name",
  "ncname",
  "id",
  "idref",
  "idrefs",
  "entity",
  "entities",
  "nmtoken",
  "nmtokens",
  "anyuri",
  "qname",
  "datetime",
  "date",
  "time",
  "gday",
  "gmonth",
  "gyear",
  "gyearmonth",
  "gmonthday",
  "duration",
  "hexbinary",
  "base64binary",
  ...SCHEMA_NUMBER_TYPES,
]);
