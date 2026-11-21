import type { SchemaTreeNode, SourceFormatId } from "../../types/mod.ts";
import { generateSkeleton } from "../skeleton/generate_skeleton.ts";
import {
  parseWebTemplate,
  validateFlatPayload,
  type FlatPayload,
  type WebTemplate,
} from "ehrtslib/serialization/simplified/mod.ts";
import { isWebTemplateJson } from "ehrtslib/serialization/simplified/web_template_parser.ts";
import {
  appendJsonPath,
  canonicalSyncPath,
  isJsonSchemaDocument,
} from "./schema_loader.ts";
import { getSourceFormatHandler } from "./format_handler.ts";
import { parseJsonDocument, unwrapExecuteEnvelope } from "./json_document.ts";
import { validateJsonAgainstJsonSchema } from "./json_schema_validate.ts";

export interface InstanceValidationIssue {
  path: string;
  message: string;
  /** 1-based line number in the example source text when available. */
  line?: number;
  /** True when `line` points to the nearest existing ancestor container. */
  sourceIsAncestor?: boolean;
  /** Concise example snippet showing approximately what missing content should look like. */
  expectedExample?: string;
}

export function validateInstanceAgainstSchema(
  content: string,
  format: SourceFormatId,
  schema: SchemaTreeNode,
  schemaDocument?: string,
): InstanceValidationIssue[] {
  const jsonSchemaIssues = validateAgainstJsonSchemaDocument(content, format, schemaDocument);
  if (jsonSchemaIssues) return jsonSchemaIssues;

  const openEhrIssues = validateOpenEhrExample(content, format, schemaDocument);
  if (openEhrIssues !== null) return openEhrIssues;

  let instanceTree: SchemaTreeNode;
  try {
    instanceTree = getSourceFormatHandler(format).loadInstance(content, schema.name);
  } catch (err) {
    return [{
      path: "$",
      message: err instanceof Error ? err.message : String(err),
    }];
  }
  return collectInstanceValidationIssues(instanceTree, schemaWithoutRmDisclosure(schema));
}

/** RM disclosure nodes are not template fields. They must not become mismatches. */
function schemaWithoutRmDisclosure(node: SchemaTreeNode): SchemaTreeNode {
  if (!treeHasRmOrigin(node)) return node;
  return {
    ...node,
    children: node.children.filter((child) => !child.rmOrigin).map(schemaWithoutRmDisclosure),
  };
}

function treeHasRmOrigin(node: SchemaTreeNode): boolean {
  return node.children.some((child) => Boolean(child.rmOrigin) || treeHasRmOrigin(child));
}

function validateAgainstJsonSchemaDocument(
  content: string,
  format: SourceFormatId,
  schemaDocument?: string,
): InstanceValidationIssue[] | null {
  if (!schemaDocument || format === "xml" || format.startsWith("openehr-")) return null;
  let schema: unknown;
  try {
    schema = JSON.parse(schemaDocument);
  } catch {
    return null;
  }
  if (!isJsonSchemaDocument(schema)) return null;
  let instance: unknown;
  try {
    instance = JSON.parse(content);
  } catch (err) {
    return [{
      path: "$",
      message: err instanceof Error ? err.message : String(err),
    }];
  }
  return validateJsonAgainstJsonSchema(instance, schema as Record<string, unknown>);
}

/**
 * FLAT keys and canonical RM JSON are not the Web Template tree.
 * Comparing them as generic JSON reports every field as missing from the schema.
 */
const webTemplateCache = new Map<string, WebTemplate | null>();

function validateOpenEhrExample(
  content: string,
  format: SourceFormatId,
  schemaDocument?: string,
): InstanceValidationIssue[] | null {
  if (
    format !== "openehr-flat-json" &&
    format !== "openehr-canonical-json" &&
    format !== "openehr-composition"
  ) {
    return null;
  }
  const webTemplate = webTemplateFromSchemaDocument(schemaDocument);
  if (!webTemplate) return null;
  if (format === "openehr-flat-json") return validateFlatExample(content, webTemplate);
  return validateCanonicalExample(content, webTemplate);
}

function validateFlatExample(
  content: string,
  webTemplate: WebTemplate,
): InstanceValidationIssue[] {
  let parsed: unknown;
  let payload: unknown;
  try {
    parsed = parseJsonDocument(content);
    payload = unwrapExecuteEnvelope(parsed);
  } catch (err) {
    return [{
      path: "$",
      message: err instanceof Error ? err.message : String(err),
    }];
  }
  if (!isRecord(payload)) {
    return [{ path: "$", message: "FLAT example must be a JSON object of template paths" }];
  }
  const jsonSource = payload === parsed && content.trim().startsWith("{")
    ? content
    : JSON.stringify(payload, null, 2);
  return validateFlatPayload(payload as FlatPayload, webTemplate, {
    jsonSource,
  }).errors.map((error) => ({
    path: appendJsonPath("$", error.path),
    message: error.message.startsWith("Unknown flat key")
      ? `Not in schema: ${error.path}`
      : error.message,
    ...(error.sourceLine !== undefined ? { line: error.sourceLine } : {}),
    ...(error.sourceIsAncestor ? { sourceIsAncestor: true } : {}),
    ...(error.expectedExample ? { expectedExample: error.expectedExample } : {}),
  }));
}

/**
 * A canonical COMPOSITION belongs to this template when `template_id` matches.
 * Its RM fields (`_type`, `code_string`, …) are not Web Template paths, so the
 * JSON walker must not run. An empty object still uses that walker.
 */
function validateCanonicalExample(
  content: string,
  webTemplate: WebTemplate,
): InstanceValidationIssue[] | null {
  let data: unknown;
  try {
    data = parseJsonDocument(content);
  } catch {
    return null;
  }
  if (!isRecord(data) || data._type !== "COMPOSITION") return null;
  const templateId = compositionTemplateId(data);
  const accepted = new Set(
    [webTemplate.templateId, webTemplate.tree?.id].filter((id): id is string => Boolean(id)),
  );
  if (templateId && !accepted.has(templateId)) {
    return [{
      path: "$.archetype_details.template_id.value",
      message: `Template id mismatch: expected ${webTemplate.templateId}, got ${templateId}`,
    }];
  }
  return [];
}

function compositionTemplateId(doc: Record<string, unknown>): string | null {
  const details = doc.archetype_details;
  if (!isRecord(details)) return null;
  const templateId = details.template_id;
  if (typeof templateId === "string") return templateId;
  if (isRecord(templateId) && typeof templateId.value === "string") return templateId.value;
  return null;
}

function webTemplateFromSchemaDocument(schemaDocument: string | undefined): WebTemplate | null {
  if (!schemaDocument) return null;
  const cached = webTemplateCache.get(schemaDocument);
  if (cached !== undefined) return cached;
  const parsed = readSchemaWebTemplate(schemaDocument);
  if (webTemplateCache.size > 8) webTemplateCache.clear();
  webTemplateCache.set(schemaDocument, parsed);
  return parsed;
}

function readSchemaWebTemplate(schemaDocument: string): WebTemplate | null {
  const trimmed = schemaDocument.trim();
  try {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const data = JSON.parse(trimmed) as unknown;
      return isWebTemplateJson(data) ? parseWebTemplate(data) : null;
    }
    if (
      trimmed.startsWith("<") ||
      trimmed.startsWith("operational_template") ||
      trimmed.startsWith("archetype")
    ) {
      const json = generateSkeleton(schemaDocument).webTemplateJson;
      return json ? parseWebTemplate(json) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectInstanceValidationIssues(
  instance: SchemaTreeNode,
  schema: SchemaTreeNode,
): InstanceValidationIssue[] {
  const issues: InstanceValidationIssue[] = [];
  const instanceNodes = collectNodes(instance);
  const schemaByPath = indexBySyncPath(schema);
  const instancePaths = new Set<string>();
  for (const node of instanceNodes) instancePaths.add(canonicalSyncPath(node.path));

  for (const node of instanceNodes) {
    if (node.path === instance.path) continue;
    const schemaNode = schemaByPath.get(canonicalSyncPath(node.path));
    if (!schemaNode) {
      issues.push({
        path: node.path,
        message: `Not in schema: ${node.name}`,
      });
      continue;
    }
    if (!typesCompatible(node.type, schemaNode.type)) {
      issues.push({
        path: node.path,
        message: `Type mismatch: expected ${schemaNode.type}, got ${node.type}`,
      });
    }
  }

  for (const schemaNode of schemaByPath.values()) {
    if (!isRequired(schemaNode.multiplicity)) continue;
    if (!instancePaths.has(canonicalSyncPath(schemaNode.path))) {
      issues.push({
        path: schemaNode.path,
        message: `Required field missing: ${schemaNode.name}`,
      });
    }
  }

  return dedupeIssues(issues);
}

function indexBySyncPath(root: SchemaTreeNode): Map<string, SchemaTreeNode> {
  const out = new Map<string, SchemaTreeNode>();
  const walk = (node: SchemaTreeNode) => {
    const key = canonicalSyncPath(node.path);
    if (!out.has(key)) out.set(key, node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

function collectNodes(root: SchemaTreeNode): SchemaTreeNode[] {
  const nodes: SchemaTreeNode[] = [root];
  for (const child of root.children) {
    nodes.push(...collectNodes(child));
  }
  return nodes;
}

function isRequired(multiplicity?: string): boolean {
  if (!multiplicity) return false;
  return multiplicity === "1" || multiplicity.startsWith("1..");
}

function typesCompatible(instanceType: string, schemaType: string): boolean {
  if (instanceType === schemaType) return true;
  const compatible: Record<string, string[]> = {
    number: ["integer"],
    integer: ["number"],
    object: ["element"],
    element: ["object", "string"],
    string: ["element"],
    array: ["array"],
  };
  return compatible[instanceType]?.includes(schemaType) ?? false;
}

function dedupeIssues(issues: InstanceValidationIssue[]): InstanceValidationIssue[] {
  const seen = new Set<string>();
  const out: InstanceValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
