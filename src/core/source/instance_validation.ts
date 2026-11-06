import type { SchemaTreeNode, SourceFormatId } from "../../types/mod.ts";
import {
  canonicalSyncPath,
  findNodeBySyncPath,
  isJsonSchemaDocument,
} from "./schema_loader.ts";
import { getSourceFormatHandler } from "./format_handler.ts";
import { validateJsonAgainstJsonSchema } from "./json_schema_validate.ts";

export interface InstanceValidationIssue {
  path: string;
  message: string;
}

export function validateInstanceAgainstSchema(
  content: string,
  format: SourceFormatId,
  schema: SchemaTreeNode,
  schemaDocument?: string,
): InstanceValidationIssue[] {
  const jsonSchemaIssues = validateAgainstJsonSchemaDocument(content, format, schemaDocument);
  if (jsonSchemaIssues) return jsonSchemaIssues;

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

function collectInstanceValidationIssues(
  instance: SchemaTreeNode,
  schema: SchemaTreeNode,
): InstanceValidationIssue[] {
  const issues: InstanceValidationIssue[] = [];
  const instanceNodes = collectNodes(instance);

  for (const node of instanceNodes) {
    if (node.path === instance.path) continue;
    const schemaNode = findNodeBySyncPath(schema, canonicalSyncPath(node.path));
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

  for (const schemaNode of collectNodes(schema)) {
    if (!isRequired(schemaNode.multiplicity)) continue;
    if (!hasMatchingInstancePath(instance, schemaNode.path)) {
      issues.push({
        path: schemaNode.path,
        message: `Required field missing: ${schemaNode.name}`,
      });
    }
  }

  return dedupeIssues(issues);
}

function collectNodes(root: SchemaTreeNode): SchemaTreeNode[] {
  const nodes: SchemaTreeNode[] = [root];
  for (const child of root.children) {
    nodes.push(...collectNodes(child));
  }
  return nodes;
}

function hasMatchingInstancePath(instance: SchemaTreeNode, schemaPath: string): boolean {
  const target = canonicalSyncPath(schemaPath);
  return collectNodes(instance).some((node) => canonicalSyncPath(node.path) === target);
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
