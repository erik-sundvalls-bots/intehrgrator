/**
 * Execute a generated TypeScript Conversion Script in-process.
 *
 * The downloadable script keeps `import` lines for pipeline use. The workbench
 * binds those names to bundled ehrtslib / fontoxpath and runs
 * `convertSourceToComposition` — the same function body shown in Generated
 * conversion script(s).
 */

import * as rm from "ehrtslib/openehr_rm.ts";
import {
  evaluateXPathToBoolean,
  evaluateXPathToNodes,
  evaluateXPathToNumber,
  evaluateXPathToString,
} from "fontoxpath";
import Handlebars from "handlebars";
import { JsonCanonicalSerializer } from "ehrtslib/serialization/json/mod.ts";
import { XmlSerializer } from "ehrtslib/serialization/xml/mod.ts";
import {
  parseWebTemplate,
  serializeToFlatJson,
  serializeToStructuredJson,
} from "ehrtslib/serialization/simplified/mod.ts";
import * as scriptHelpers from "./helpers/typescript.ts";

export interface GeneratedScriptRuntime {
  [name: string]: unknown;
}

export function generatedScriptRuntime(): GeneratedScriptRuntime {
  return {
    ...(rm as unknown as GeneratedScriptRuntime),
    ...scriptHelpers,
    evaluateXPathToString,
    evaluateXPathToNumber,
    evaluateXPathToBoolean,
    evaluateXPathToNodes,
    JsonCanonicalSerializer,
    XmlSerializer,
    parseWebTemplate,
    serializeToFlatJson,
    serializeToStructuredJson,
    Handlebars,
  };
}

export function stripGeneratedTypeScript(source: string): { names: string[]; body: string } {
  const names: string[] = [];
  let body = source.replace(
    /import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']\s*;?/g,
    (_all, inner: string) => {
      for (const raw of inner.split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.push(name);
      }
      return "";
    },
  );
  body = body.replace(
    /import\s+(\w+)\s+from\s*["'][^"']+["']\s*;?/g,
    (_all, name: string) => {
      names.push(name);
      return "";
    },
  );
  body = body.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']+["']\s*;?/g,
    (_all, name: string) => {
      names.push(name);
      return "";
    },
  );
  body = body.replace(
    /export\s+type[\s\S]*?(?=export\s+function\s+convertSourceToComposition)/,
    "",
  );
  body = body.replace(/\bexport\s+function\b/g, "function");
  body = body.replace(/(\]|[\w$])!/g, "$1");
  body = body.replace(/\s+as\s+[A-Za-z_$][\w$]*(?:<[^>]+>)?(?:\[\])?/g, "");
  body = body.replace(/\bnew\s+(Set|Map|WeakSet|WeakMap|Array)<[^>]+>/g, "new $1");
  const typeName =
    String.raw`(?:string|number|boolean|unknown|void|never|any|object|SourceContext|Record<[^>]+>|Array<[^>]+>|[A-Z][A-Za-z0-9_]*)(?:\[\])?`;
  const typeUnion = `${typeName}(?:\\s*\\|\\s*${typeName})*`;
  // Object *types* only (`{ op: string; a: number }`), not value literals (`{ name: xpathString(...) }`).
  const typeObj = String.raw`\{(?:\s*[A-Za-z_$][\w$]*\s*\??\s*:\s*${typeName}\s*;?)*\s*\}`;
  const typeOrObj = `(?:${typeUnion}|${typeObj})`;
  body = body.replace(new RegExp(`\\)\\s*:\\s*${typeOrObj}(\\s*(?:\\{|=>))`, "g"), ")$1");
  body = body.replace(
    new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*${typeOrObj}(\\s*[=,)])`, "g"),
    "$1$2",
  );
  return { names: [...new Set(names)], body };
}

export function runGeneratedTypeScript(
  source: string,
  sourceCtx: { format: string; data: unknown },
  defaults: Record<string, unknown> = {},
  runtime: GeneratedScriptRuntime = generatedScriptRuntime(),
  sheets: Record<string, unknown> = {},
): unknown {
  const { names, body } = stripGeneratedTypeScript(source);
  const missing = names.filter((name) => !(name in runtime));
  if (missing.length) {
    throw new Error(`Generated script imports unknown symbols: ${missing.join(", ")}`);
  }
  let convert: (
    ctx: { format: string; data: unknown },
    defaults?: Record<string, unknown>,
    sheets?: Record<string, unknown>,
  ) => unknown;
  try {
    convert = new Function(
      ...names,
      `${body}\nif (typeof convertSourceToComposition !== "function") {\n` +
        `  throw new Error("Generated script has no convertSourceToComposition");\n` +
        `}\nreturn convertSourceToComposition;`,
    )(...names.map((name) => runtime[name])) as typeof convert;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Generated TypeScript could not be executed (${detail}):\n${body}`);
  }
  return convert(sourceCtx, defaults, sheets);
}

/** Canonical JSON when the result is an ehrtslib RM tree; otherwise the value as-is. */
export function serializedConversionOutput(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  try {
    const json = new JsonCanonicalSerializer().serialize(value);
    return JSON.parse(json) as unknown;
  } catch {
    return value;
  }
}
