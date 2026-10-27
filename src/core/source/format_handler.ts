/**
 * Source Format Handler seam — adapters for JSON, XML, and (later) openEHR
 * Composition / FLAT / STRUCTURED as Source Schema.
 *
 * Callers (Click-to-Map, Test Run, codegen) go through this interface so new
 * formats do not fork schema_loader / query_runtime / controller unions.
 *
 * See docs/SOURCE_FORMATS.md and architecture review candidate 1.
 */

import type { SchemaTreeNode, SourceFormatId } from "../../types/mod.ts";
import {
  appendJsonPath,
  inferSchemaFromInstance,
  loadJsonSchema,
  loadXmlSchemaFromInstance,
  loadXmlSourceSchema,
  pathToFontoxpath,
} from "./schema_loader.ts";
import { parseJsonDocument, unwrapExecuteEnvelope } from "./json_document.ts";
import {
  createSourceContext,
  evaluate,
  type SourceContext,
} from "./query_runtime.ts";

export type { SourceFormatId };

export interface SourceFormatHandler {
  /** Format id (`json`, `xml`, or a registered extension such as `openehr-composition`). */
  readonly id: string;

  /** Parse schema content (or infer structure from a document-shaped payload). */
  loadSchema(content: string, rootName?: string): SchemaTreeNode;

  /** Parse an example instance into a tree for the Source Pane. */
  loadInstance(content: string, rootName?: string): SchemaTreeNode;

  /** Convert a tree node path into a Mapping Expression path (fontoxpath). */
  pathToExpression(schemaPath: string): string;

  /** Build a runtime context for evaluating mapping expressions. */
  createContext(content: string): SourceContext;

  /** Evaluate a mapping expression against a context. */
  evaluate(expression: string, ctx: SourceContext, returnType: string): unknown;
}

function createJsonHandler(
  id: string,
  loadSchema: (content: string, rootName?: string) => SchemaTreeNode = loadJsonSchema,
): SourceFormatHandler {
  const handler: SourceFormatHandler = {
    id,
    loadSchema,
    loadInstance(content, rootName = "root") {
      return inferSchemaFromInstance(content, rootName);
    },
    pathToExpression(schemaPath) {
      return pathToFontoxpath(schemaPath, "json");
    },
    createContext(content) {
      return createSourceContext(content, handler.id, "json");
    },
    evaluate(expression, ctx, returnType) {
      return evaluate(expression, ctx, returnType);
    },
  };
  return handler;
}

const jsonHandler = createJsonHandler("json");

const xmlHandler: SourceFormatHandler = {
  id: "xml",
  loadSchema(content, rootName = "root") {
    // An XSD is read as a schema; any other XML document as a sample instance (#278).
    return loadXmlSourceSchema(content, rootName);
  },
  loadInstance(content, rootName = "root") {
    return loadXmlSchemaFromInstance(content, rootName);
  },
  pathToExpression(schemaPath) {
    return pathToFontoxpath(schemaPath, "xml");
  },
  createContext(content) {
    return createSourceContext(content, "xml", "xml");
  },
  evaluate(expression, ctx, returnType) {
    return evaluate(expression, ctx, returnType);
  },
};

/** Canonical Composition JSON — also registered as `openehr-composition`. */
const openEhrCanonical = createJsonHandler("openehr-canonical-json");
const openEhrHandlers: SourceFormatHandler[] = [
  openEhrCanonical,
  createJsonHandler("openehr-flat-json"),
  createJsonHandler("openehr-structured-json"),
  createJsonHandler("openehr-web-template", loadOpenEhrWebTemplateSchema),
  createJsonHandler("openehr-composition"),
];

const handlers = new Map<string, SourceFormatHandler>([
  [jsonHandler.id, jsonHandler],
  [xmlHandler.id, xmlHandler],
  ...openEhrHandlers.map((handler) => [handler.id, handler] as const),
]);

/** Register or replace a format adapter. */
export function registerSourceFormatHandler(handler: SourceFormatHandler): void {
  handlers.set(handler.id, handler);
}

export function getSourceFormatHandler(format: SourceFormatId | string): SourceFormatHandler {
  const handler = handlers.get(format);
  if (!handler) {
    throw new Error(`Unsupported source format: ${format}`);
  }
  return handler;
}

export function listSourceFormatIds(): string[] {
  return [...handlers.keys()];
}

export function isSourceFormatId(value: string): value is SourceFormatId {
  return handlers.has(value);
}

/** Infer format from filename extension; defaults to JSON. */
export function detectSourceFormat(filename: string, content?: string): SourceFormatId {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xml") || lower.endsWith(".xsd")) return "xml";
  if (content) {
    try {
      const data = unwrapExecuteEnvelope(parseJsonDocument(content)) as unknown;
      if (isRecord(data)) {
        if (typeof data.templateId === "string" && isRecord(data.tree)) {
          return "openehr-web-template";
        }
        if (data._type === "COMPOSITION") return "openehr-composition";
        const keys = Object.keys(data);
        if (keys.some((key) => key.startsWith("ctx/") || key.includes("|"))) {
          return "openehr-flat-json";
        }
        if (containsSimplifiedFormatLeaf(data)) return "openehr-structured-json";
      }
    } catch {
      // The selected JSON handler will report malformed content with context.
    }
  }
  return "json";
}

export type { SourceContext };

function loadOpenEhrWebTemplateSchema(content: string, rootName = "root"): SchemaTreeNode {
  const document = JSON.parse(content) as unknown;
  if (!isRecord(document) || !isRecord(document.tree)) {
    throw new Error("Invalid openEHR Web Template: missing tree");
  }
  return webTemplateNodeToTree(document.tree, rootName, "$", true);
}

function webTemplateNodeToTree(
  node: Record<string, unknown>,
  fallbackName: string,
  parentPath: string,
  root = false,
): SchemaTreeNode {
  const name = typeof node.id === "string" ? node.id : fallbackName;
  const path = root ? parentPath : appendJsonPath(parentPath, name);
  const max = typeof node.max === "number" ? node.max : 1;
  const min = typeof node.min === "number" ? node.min : 0;
  const multiplicity = max === 1 ? (min > 0 ? "1" : "0..1") : (min > 0 ? "1..*" : "0..*");
  const children = Array.isArray(node.children)
    ? node.children.filter(isRecord).map((child) =>
      webTemplateNodeToTree(child, "node", max === 1 ? path : `${path}[*]`)
    )
    : [];
  if (Array.isArray(node.inputs)) {
    for (const input of node.inputs.filter(isRecord)) {
      const suffix = typeof input.suffix === "string" ? input.suffix : "";
      if (!suffix) continue;
      const leafName = `|${suffix}`;
      children.push({
        path: appendJsonPath(path, leafName),
        name: leafName,
        type: typeof input.type === "string" ? input.type.toLowerCase() : "string",
        multiplicity,
        children: [],
      });
    }
  }
  return {
    path,
    name,
    type: typeof node.rmType === "string" ? node.rmType : children.length ? "object" : "string",
    multiplicity,
    children,
  };
}

function containsSimplifiedFormatLeaf(value: unknown, depth = 0): boolean {
  if (depth > 8 || !isRecord(value)) return false;
  if (Object.keys(value).some((key) => key.startsWith("|"))) return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some((item) => containsSimplifiedFormatLeaf(item, depth + 1))
      : containsSimplifiedFormatLeaf(child, depth + 1)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
