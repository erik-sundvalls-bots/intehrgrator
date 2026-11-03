/**
 * Lazy in-app XQuery runtime for Conversion Test Run (issue #78).
 *
 * fontoxpath (XQuery 3.1) + slimdom node factory load on first use via
 * dynamic `import()` — Mapping preview / TypeScript paths do not pay that cost.
 */
import type { SheetBag } from "../sheets/types.ts";
import { renderHandlebars } from "../output/handlebars_dialect.ts";
import { INTEHRGRATOR_XQUERY_NS } from "./xquery.ts";
import { xqueryHelperModules } from "./xquery_modules.ts";

type FontoxpathApi = typeof import("fontoxpath");
type SlimdomApi = typeof import("slimdom");

let fx: FontoxpathApi | null = null;
let slim: SlimdomApi | null = null;
let loading: Promise<void> | null = null;

const XQUERY_ENGINE_DOCS = "docs/agents/xquery-engine.md";

export function isXQueryRuntimeLoaded(): boolean {
  return fx !== null && slim !== null;
}

export function xqueryRuntimeUnavailableMessage(): string {
  return (
    `// XQuery runtime is not loaded yet.\n` +
    `// Select XQuery Output mode to lazy-load fontoxpath + slimdom, or run the generated .xq with BaseX.\n` +
    `// Server-side golden path: ${XQUERY_ENGINE_DOCS}\n`
  );
}

/** Load the XQuery engine. Idempotent; first call pays for dynamic imports. */
export function ensureXQueryRuntime(): Promise<void> {
  if (isXQueryRuntimeLoaded()) return Promise.resolve();
  if (!loading) loading = loadRuntime();
  return loading;
}

async function loadRuntime(): Promise<void> {
  const [fonto, slimdom] = await Promise.all([
    import("fontoxpath"),
    import("slimdom"),
  ]);
  fx = fonto;
  slim = slimdom;
  registerHandlebarsFunction(fonto);
}

function registerHandlebarsFunction(fonto: FontoxpathApi): void {
  try {
    fonto.registerCustomXPathFunction(
      { namespaceURI: INTEHRGRATOR_XQUERY_NS, localName: "handlebars" },
      ["xs:string", "item()*"],
      "xs:string",
      (_ctx, template: unknown, context: unknown) =>
        renderHandlebars(String(template ?? ""), coerceHandlebarsContext(context)),
    );
  } catch {
    // Already registered in this runtime (HMR / repeated ensureXQueryRuntime).
  }
}

function coerceHandlebarsContext(value: unknown): unknown {
  if (value == null) return {};
  if (Array.isArray(value)) {
    return value.length === 1 ? coerceHandlebarsContext(value[0]) : value.map(coerceHandlebarsContext);
  }
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === "object") {
    const rec = value as { get?: (k: unknown) => unknown; keys?: () => Iterable<unknown> };
    if (typeof rec.get === "function" && typeof rec.keys === "function") {
      const out: Record<string, unknown> = {};
      for (const key of rec.keys()) out[String(key)] = rec.get(key);
      return out;
    }
    return value;
  }
  return { value };
}

export function sheetsBagToXQueryMap(bag: SheetBag): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, sheet] of Object.entries(bag)) {
    const rows = sheet.values.map((row, y) => {
      const rec: Record<string, unknown> = {};
      if (sheet.rowNames) rec.__row = sheet.rowNames[y] ?? "";
      sheet.headers.forEach((header, x) => {
        rec[header || String(x)] = row[x] ?? null;
      });
      return rec;
    });
    out[name] = {
      name: sheet.name,
      kind: sheet.kind ?? "sheet",
      headers: [...sheet.headers],
      values: sheet.values.map((row) => [...row]),
      rows,
      rowNames: sheet.rowNames ? [...sheet.rowNames] : [],
      hitPolicy: sheet.hitPolicy ?? "FIRST",
      collectJoin: sheet.collectJoin ?? "; ",
      collectDedupe: Boolean(sheet.collectDedupe),
      decisionColumns: (sheet.decisionColumns ?? []).map((col) => ({ ...col })),
      rowCatchAll: sheet.rowCatchAll ? [...sheet.rowCatchAll] : [],
    };
  }
  return out;
}

export interface RunXQueryBindings {
  source: unknown;
  defaults?: Record<string, unknown>;
  sheets?: SheetBag | Record<string, unknown>;
}

export function runGeneratedXQuery(
  source: string,
  bindings: RunXQueryBindings,
): unknown {
  if (!fx || !slim) {
    throw new Error(
      "XQuery runtime is not loaded. Call ensureXQueryRuntime() first, " +
        `or run the .xq with BaseX (${XQUERY_ENGINE_DOCS}).`,
    );
  }
  const doc = new slim.Document();
  const factory = {
    createDocument: () => new slim!.Document(),
    createElementNS: (ns: string, name: string) => doc.createElementNS(ns, name),
    createTextNode: (data: string) => doc.createTextNode(data),
    createComment: (data: string) => doc.createComment(data),
    createCDATASection: (data: string) => doc.createCDATASection(data),
    createProcessingInstruction: (target: string, data: string) =>
      doc.createProcessingInstruction(target, data),
    createAttributeNS: (ns: string, name: string) => doc.createAttributeNS(ns, name),
  };
  const sheets = isSheetBag(bindings.sheets)
    ? sheetsBagToXQueryMap(bindings.sheets)
    : (bindings.sheets ?? {});
  const prepared = stripEngineOnlyOptions(inlineXQueryHelperModules(source));
  const raw = fx.evaluateXPath(
    prepared,
    doc,
    null,
    {
      source: bindings.source ?? {},
      defaults: bindings.defaults ?? {},
      sheets,
    },
    undefined,
    {
      language: fx.evaluateXPath.XQUERY_3_1_LANGUAGE,
      nodesFactory: factory,
      namespaceResolver: xqueryNamespaceResolver,
      xmlSerializer: {
        serializeToString: (node: unknown) => slim!.serializeToWellFormedString(node as never),
      },
    },
  );
  return serializeXQueryValue(raw);
}

function isSheetBag(value: unknown): value is SheetBag {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some((item) =>
    Boolean(item && typeof item === "object" && "headers" in item && "values" in item)
  );
}

/**
 * fontoxpath evaluates one main module. Generated scripts import helper
 * library modules; this copies those functions into the main module as
 * `local:{prefix}-*` so Test Run matches the imported behaviour.
 */
export function inlineXQueryHelperModules(source: string): string {
  let out = source;
  for (const mod of xqueryHelperModules()) {
    const importRe = new RegExp(
      `import module namespace ${mod.prefix} = "[^"]*" at "[^"]*";\\n?`,
    );
    if (!importRe.test(out)) continue;
    out = out.replace(importRe, "");
    let body = mod.text.replace(/^module namespace \w+ = "[^"]+";\n?/, "");
    body = body
      .replace(/^declare namespace map = [^\n]+\n?/m, "")
      .replace(/^declare namespace array = [^\n]+\n?/m, "")
      .replace(/^declare namespace rm = [^\n]+\n?/m, "")
      .replace(/^declare namespace xsi = [^\n]+\n?/m, "");
    const localName = `local:${mod.prefix}-`;
    body = body.replaceAll(`${mod.prefix}:`, localName);
    out = out.replaceAll(`${mod.prefix}:`, localName);
    // Namespace declarations must stay above function declarations.
    const at = out.search(/\ndeclare function\b/);
    if (at >= 0) {
      out = `${out.slice(0, at + 1)}${body}\n${out.slice(at + 1)}`;
    } else {
      out = `${body}\n${out}`;
    }
  }
  return out;
}

/** Prolog bits for BaseX/Saxon that fontoxpath rejects (reserved NS / serialization). */
function stripEngineOnlyOptions(source: string): string {
  return source
    .replace(/^declare namespace output = [^\n]+\n?/gm, "")
    .replace(/^declare namespace map = [^\n]+\n?/gm, "")
    .replace(/^declare namespace array = [^\n]+\n?/gm, "")
    .replace(/^declare option output:[^\n]+\n?/gm, "");
}

function xqueryNamespaceResolver(prefix: string): string | null {
  // Never bind the empty prefix to the functions NS: fontoxpath then treats
  // `declare variable $source` as landing in a reserved URI (XQST0045).
  if (prefix === "") return null;
  if (prefix === "local") return "http://www.w3.org/2005/xquery-local-functions";
  if (prefix === "xs") return "http://www.w3.org/2001/XMLSchema";
  if (prefix === "fn") return "http://www.w3.org/2005/xpath-functions";
  if (prefix === "rm") return "http://schemas.openehr.org/v1";
  if (prefix === "xsi") return "http://www.w3.org/2001/XMLSchema-instance";
  if (prefix === "map") return "http://www.w3.org/2005/xpath-functions/map";
  if (prefix === "array") return "http://www.w3.org/2005/xpath-functions/array";
  if (prefix === "output") return "http://www.w3.org/2010/xslt-xquery-serialization";
  if (prefix === "intehrgrator") return INTEHRGRATOR_XQUERY_NS;
  return null;
}

function serializeXQueryValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(serializeXQueryValue);
  if (isDomNode(value)) {
    return slim!.serializeToWellFormedString(value as never);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(rec)) {
      out[key] = serializeXQueryValue(item);
    }
    return out;
  }
  return String(value);
}

function isDomNode(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "nodeType" in value &&
      typeof (value as { nodeType: unknown }).nodeType === "number",
  );
}
