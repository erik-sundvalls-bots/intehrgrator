/**
 * Conversion Test Run Output validation against an openEHR operational template.
 */

import type { OPERATIONAL_TEMPLATE } from "ehrtslib/am/openehr_am.ts";
import { parseTemplateInput } from "ehrtslib/parser/mod.ts";
import {
  buildJsonSourceIndex,
  escapeJsonPointerSegment,
} from "ehrtslib/serialization/common/json_source_index.ts";
import {
  buildWebTemplate,
  CodedTextMismatchError,
  deserializeFromFlatWithIssues,
  deserializeFromStructuredWithIssues,
  enrichSimplifiedMessagesWithSource,
  type FlatPayload,
  type FlatRmDefaultIssue,
  parseWebTemplate,
  type ValidationSourceFormat,
  type WebTemplate,
  type WebTemplateNode,
  webTemplateToOpt,
} from "ehrtslib/serialization/simplified/mod.ts";
import { registerOpenEhrModelTypes } from "ehrtslib/serialization/common/openehr_model_registry.ts";
import { JsonConfigurableDeserializer } from "ehrtslib/serialization/json/mod.ts";
import { XmlDeserializer } from "ehrtslib/serialization/xml/mod.ts";
import {
  formatExpectedExampleForMissingNode,
  TemplateValidator,
  type ValidationMessage,
} from "ehrtslib/validation/mod.ts";
import type {
  OpenEhrJsonDeserializeMode,
  OutputValidation,
  OutputValidationMessage,
} from "../../types/mod.ts";
import type { TargetDefinition } from "../target/mod.ts";
import { jsonDeserializationConfigForMode } from "./json_deserialize_config.ts";
import {
  lineNumberForDeserializeError,
  lineNumberForRmPath,
} from "./json_line_lookup.ts";

let rmTypeRegistryReady = false;

/** JsonConfigurableDeserializer requires RM classes registered on TypeRegistry first. */
function ensureRmTypeRegistry(): void {
  if (rmTypeRegistryReady) return;
  registerOpenEhrModelTypes();
  rmTypeRegistryReady = true;
}

// UCUM unit checks are on since ehrtslib v0.7 (#199): rate units such as
// `/min` and `{beats}/min` pass. `initialize()` loads ucum-lhc (already in
// the bundle) for full checks; it falls back to ehrtslib's syntax check if
// ucum-lhc cannot load.
const validator = new TemplateValidator({
  failFast: false,
  validateUnits: true,
  validateTerminology: true,
  validateRMSpecification: true,
  validateInvariants: true,
  validateIntervals: true,
});

await validator.initialize();

export interface ValidateConvertedOutputOptions {
  deserializeMode?: OpenEhrJsonDeserializeMode;
}

export function notApplicableOutputValidation(): OutputValidation {
  return { applicable: false, valid: true, messages: [] };
}

export function validateConvertedOutput(
  output: unknown,
  target: TargetDefinition | null | undefined,
  options: ValidateConvertedOutputOptions = {},
): OutputValidation {
  if (!target || target.format !== "openehr-template") {
    return notApplicableOutputValidation();
  }
  if (output == null) {
    return {
      applicable: true,
      valid: false,
      messages: [{
        path: "/",
        message: "Conversion Test Run did not produce an openEHR COMPOSITION object",
        severity: "error",
      }],
    };
  }
  let rawJsonSource: string | undefined;
  let isXmlOutput = false;
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        rawJsonSource = output;
        output = JSON.parse(trimmed) as unknown;
      } catch {
        return notApplicableOutputValidation();
      }
    } else if (trimmed.startsWith("<")) {
      if (trimmed.startsWith("<mapping-result")) {
        return notApplicableOutputValidation();
      }
      try {
        ensureRmTypeRegistry();
        output = new XmlDeserializer().deserialize(trimmed);
        coerceXmlDeserializedRmPrimitives(output);
        isXmlOutput = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          applicable: true,
          valid: false,
          messages: [{
            path: "/",
            message: `Invalid openEHR XML: ${message}`,
            severity: "error",
          }],
        };
      }
    } else {
      return notApplicableOutputValidation();
    }
  }
  if (typeof output !== "object") {
    return {
      applicable: true,
      valid: false,
      messages: [{
        path: "/",
        message: "Conversion Test Run did not produce an openEHR COMPOSITION object",
        severity: "error",
      }],
    };
  }
  const jsonText = rawJsonSource ?? JSON.stringify(output, null, 2);
  const jsonSource = isXmlOutput ? undefined : jsonText;
  const deserializeMode = options.deserializeMode ?? "canonical-strict";
  try {
    const opt = operationalTemplateFromTarget(target);
    if (!opt) {
      return {
        applicable: true,
        valid: false,
        messages: [{
          path: "/",
          message: "Could not parse the loaded target as an operational template",
          severity: "error",
        }],
      };
    }
    const webTemplate = webTemplateFromTarget(target, opt);
    const flat = rmFromFlatDocument(output, webTemplate, jsonSource);
    const rmInstance = flat?.composition ?? asRmInstance(output, jsonText, deserializeMode);
    const sourceFormat: ValidationSourceFormat = flat?.sourceFormat ?? "canonical-json";
    const includeMissingHints = !isXmlOutput;
    const result = validator.validate(rmInstance, opt as OPERATIONAL_TEMPLATE, {
      jsonSource,
      sourceFormat,
      webTemplate,
      includeMissingHints,
    });
    const flatMessages = flat?.messages ?? [];
    const messages = [
      ...flatMessages,
      ...[...result.errors, ...result.warnings].map((msg) =>
        toOutputValidationMessage(msg, {
          jsonSource,
          sourceFormat,
          webTemplate,
          opt,
          includeMissingHints,
        })
      ),
    ];
    return {
      applicable: true,
      valid: result.valid && result.errors.length === 0 &&
        !flatMessages.some((msg) => msg.severity === "error"),
      messages,
    };
  } catch (err) {
    if (err instanceof FlatIssuesError) {
      return { applicable: true, valid: false, messages: err.messages };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      applicable: true,
      valid: false,
      messages: [{
        path: "/",
        message,
        severity: "error",
        line: jsonSource ? lineNumberForDeserializeError(jsonSource, message) : undefined,
      }],
    };
  }
}

function spreadSourceLocationFields(
  source: {
    sourceLine?: number;
    sourceColumn?: number;
    jsonPointer?: string;
    sourceIsAncestor?: boolean;
    targetPath?: string;
    expectedExample?: string;
  },
  lineOverride?: number,
): Partial<OutputValidationMessage> {
  const line = lineOverride ?? source.sourceLine;
  return {
    ...(line !== undefined ? { line } : {}),
    ...(source.sourceColumn !== undefined ? { column: source.sourceColumn } : {}),
    ...(source.jsonPointer !== undefined ? { jsonPointer: source.jsonPointer } : {}),
    ...(source.sourceIsAncestor ? { sourceIsAncestor: true } : {}),
    ...(source.targetPath ? { targetPath: source.targetPath } : {}),
    ...(source.expectedExample ? { expectedExample: source.expectedExample } : {}),
  };
}

function toOutputValidationMessage(
  msg: ValidationMessage,
  ctx: {
    jsonSource?: string;
    sourceFormat: ValidationSourceFormat;
    webTemplate?: WebTemplate;
    opt: OPERATIONAL_TEMPLATE;
    includeMissingHints: boolean;
  },
): OutputValidationMessage {
  const path = msg.path || "/";
  const line = msg.sourceLine ??
    (ctx.sourceFormat === "canonical-json" && ctx.jsonSource
      ? lineNumberForRmPath(ctx.jsonSource, path)
      : undefined);
  const expectedExample = msg.expectedExample ??
    (ctx.includeMissingHints
      ? fallbackExpectedExample(msg, ctx.sourceFormat, ctx.webTemplate, ctx.opt)
      : undefined);
  return {
    path,
    message: msg.message,
    severity: msg.severity,
    ...spreadSourceLocationFields({ ...msg, expectedExample }, line),
  };
}

function isMissingOrEmptyMessage(message: string): boolean {
  if (classifyOpenEhrValidationMessage(message) === "required-missing") return true;
  const m = message.toLowerCase();
  return m.includes("is_empty") || /\/=\s*void/.test(m) || m.includes("below minimum");
}

function fallbackExpectedExample(
  msg: ValidationMessage,
  sourceFormat: ValidationSourceFormat,
  webTemplate: WebTemplate | undefined,
  opt: OPERATIONAL_TEMPLATE,
): string | undefined {
  if (!isMissingOrEmptyMessage(msg.message)) return undefined;
  const wtNode = webTemplate && msg.targetPath
    ? findWebTemplateNodeForTargetPath(webTemplate, msg.targetPath)
    : undefined;
  return formatExpectedExampleForMissingNode({
    format: sourceFormat,
    rmPath: msg.path || "/",
    webTemplateNode: wtNode,
    flatBasePath: msg.targetPath,
    constraintNodeId: msg.constraintNodeId,
    template: opt,
  });
}

function findWebTemplateNodeForTargetPath(
  webTemplate: WebTemplate,
  targetPath: string,
): WebTemplateNode | undefined {
  const pipeIdx = targetPath.indexOf("|");
  const base = pipeIdx === -1 ? targetPath : targetPath.slice(0, pipeIdx);
  const segments = base.split("/").slice(1).map((s) => s.replace(/:\d+$/, ""));
  if (!segments.length) return webTemplate.tree;
  let cur: WebTemplateNode | undefined = webTemplate.tree;
  for (const seg of segments) {
    cur = cur?.children?.find((c) => c.id === seg);
    if (!cur) return undefined;
  }
  return cur;
}

/**
 * Simplified FLAT documents are path maps (`ctx/category`, `.../value`), not
 * canonical RM JSON. Rebuild the composition before OPT validation.
 *
 * ehrtslib's FLAT reader runs with its defaults (since v0.8:
 * `codedTextMismatch: "reject"`, `codedTextDisplayValue: "keep"`). Its issues,
 * such as a coded text whose `|code` or `|value` is not in the template's
 * list, are returned as output validation messages on the FLAT path.
 */
function rmFromFlatDocument(
  output: unknown,
  webTemplate: WebTemplate | undefined,
  jsonSource: string | undefined,
): {
  composition: unknown;
  messages: OutputValidationMessage[];
  sourceFormat: ValidationSourceFormat;
} | null {
  if (!webTemplate) return null;
  const flatPayload = flatCompositionPayload(output);
  const structuredPayload = flatPayload ? null : structuredCompositionPayload(output);
  if (!flatPayload && !structuredPayload) return null;
  const sourceFormat: ValidationSourceFormat = flatPayload ? "flat-json" : "structured-json";
  try {
    ensureRmTypeRegistry();
    const { composition, issues } = flatPayload
      ? deserializeFromFlatWithIssues(flatPayload, webTemplate)
      : deserializeFromStructuredWithIssues(
        structuredPayload as Parameters<typeof deserializeFromStructuredWithIssues>[0],
        webTemplate,
      );
    return {
      composition,
      messages: flatIssueMessages(issues, jsonSource, webTemplate, sourceFormat, flatPayload),
      sourceFormat,
    };
  } catch (err) {
    // deserializeFromFlatWithIssues collects mismatches as issues; if one is
    // thrown anyway, report its issues instead of trying canonical JSON.
    if (err instanceof CodedTextMismatchError) {
      throw new FlatIssuesError(
        flatIssueMessages(err.issues, jsonSource, webTemplate, sourceFormat, flatPayload),
      );
    }
    return null;
  }
}

class FlatIssuesError extends Error {
  constructor(readonly messages: OutputValidationMessage[]) {
    super(messages.map((msg) => `${msg.path}: ${msg.message}`).join("\n"));
    this.name = "FlatIssuesError";
  }
}

function flatIssueMessages(
  issues: FlatRmDefaultIssue[],
  jsonSource: string | undefined,
  webTemplate: WebTemplate,
  sourceFormat: ValidationSourceFormat,
  flatPayload: FlatPayload | null,
): OutputValidationMessage[] {
  if (!issues.length) return [];
  const enriched: FlatRmDefaultIssue[] = issues.map((issue) => ({ ...issue }));
  if (jsonSource) {
    enrichSimplifiedMessagesWithSource(enriched, jsonSource, {
      webTemplate,
      sourceFormat,
      includeMissingHints: true,
    });
    if (sourceFormat === "flat-json" && flatPayload) {
      refineFlatOccurrenceLocations(enriched, flatPayload, jsonSource);
    }
  }
  return enriched.map((issue) => ({
    path: issue.path || "/",
    message: issue.message,
    severity: issue.severity,
    ...spreadSourceLocationFields(issue),
  }));
}

/**
 * `FlatDeserializer` issues carry an AQL path without occurrence indices
 * (`:0`, `:1`). Resolve to the specific `:N` key in `flatPayload` (preferring
 * the occurrence whose value appears quoted in the issue message when both `:0`
 * and `:1` exist).
 */
function refineFlatOccurrenceLocations(
  issues: FlatRmDefaultIssue[],
  flatPayload: FlatPayload,
  jsonSource: string,
): void {
  const needsRefine = issues.some((i) => Boolean(i.targetPath && i.path.startsWith("/")));
  if (!needsRefine) return;
  let index: ReturnType<typeof buildJsonSourceIndex> | undefined;
  try {
    index = buildJsonSourceIndex(jsonSource);
  } catch {
    return;
  }
  const stripOccurrences = (key: string) =>
    key.replace(/:\d+(?=\/|\||$)/g, "");
  const stripSuffix = (key: string) => {
    const idx = key.indexOf("|");
    return idx === -1 ? key : key.slice(0, idx);
  };
  const payloadKeys = Object.keys(flatPayload);
  for (const issue of issues) {
    if (!issue.targetPath || !issue.path.startsWith("/")) continue;
    const wantNorm = stripOccurrences(issue.targetPath);
    const wantBaseNorm = stripSuffix(wantNorm);
    const quoted = [...issue.message.matchAll(/"([^"]+)"|'([^']+)'/g)]
      .map((m) => m[1] ?? m[2] ?? "")
      .filter(Boolean);
    let byValue: string | undefined;
    for (const q of quoted) {
      byValue =
        payloadKeys.find((k) => stripOccurrences(k) === wantNorm && String(flatPayload[k]) === q) ??
        payloadKeys.find(
          (k) =>
            stripSuffix(stripOccurrences(k)) === wantBaseNorm && String(flatPayload[k]) === q,
        );
      if (byValue) break;
    }
    const byNorm = issue.sourceIsAncestor
      ? payloadKeys.find((k) => stripOccurrences(k) === wantNorm)
      : undefined;
    const matchingKey = byValue ?? byNorm;
    if (!matchingKey) continue;
    const loc = index.get(`/${escapeJsonPointerSegment(matchingKey)}`);
    if (!loc) continue;
    issue.targetPath = matchingKey;
    issue.jsonPointer = loc.jsonPointer;
    issue.sourceLine = loc.sourceLine;
    issue.sourceColumn = loc.sourceColumn;
    issue.sourceIsAncestor = undefined;
  }
}

function flatCompositionPayload(output: unknown): FlatPayload | null {
  const record = asJsonObjectRecord(output);
  if (!record) return null;
  if ("_type" in record || "archetype_node_id" in record) return null;
  const keys = Object.keys(record);
  if (!keys.some((key) => key.startsWith("ctx/") || key.includes("/"))) return null;
  return record as FlatPayload;
}

/**
 * Simplified STRUCTURED: one root template key (plus optional `ctx`) holding
 * the nested tree. ehrtslib reads it back through FLAT.
 */
function structuredCompositionPayload(output: unknown): Record<string, unknown> | null {
  const record = asJsonObjectRecord(output);
  if (!record) return null;
  if ("_type" in record || "archetype_node_id" in record) return null;
  const keys = Object.keys(record);
  if (keys.some((k) => k.includes("/"))) return null;
  const nonCtx = keys.filter((k) => k !== "ctx");
  if (nonCtx.length !== 1 || nonCtx[0]!.startsWith("_")) return null;
  const tree = record[nonCtx[0]!];
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
  return record;
}

function asJsonObjectRecord(output: unknown): Record<string, unknown> | null {
  let value: unknown = output;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const webTemplateCache = new Map<string, WebTemplate>();

function webTemplateFromTarget(
  target: TargetDefinition,
  opt: OPERATIONAL_TEMPLATE,
): WebTemplate | undefined {
  const wtJson = target.webTemplateJson?.trim() ||
    (target.content?.trim().startsWith("{") ? target.content.trim() : "");
  const cacheKey = wtJson || target.content?.trim() || "";
  if (cacheKey) {
    const cached = webTemplateCache.get(cacheKey);
    if (cached) return cached;
  }
  try {
    const wt = wtJson ? parseWebTemplate(wtJson) : buildWebTemplate(opt);
    if (cacheKey) {
      if (webTemplateCache.size > 16) webTemplateCache.clear();
      webTemplateCache.set(cacheKey, wt);
    }
    return wt;
  } catch {
    return undefined;
  }
}

function operationalTemplateFromTarget(target: TargetDefinition): OPERATIONAL_TEMPLATE | null {
  const content = target.content?.trim() ?? "";
  if (!content) return null;
  if (content.startsWith("{")) {
    return webTemplateToOpt(parseWebTemplate(content));
  }
  return (parseTemplateInput(content).operationalTemplate ?? null) as OPERATIONAL_TEMPLATE | null;
}

function asRmInstance(
  output: unknown,
  jsonText: string,
  mode: OpenEhrJsonDeserializeMode,
): unknown {
  if (looksLikeRmInstance(output)) return output;
  ensureRmTypeRegistry();
  const config = jsonDeserializationConfigForMode(mode);
  return new JsonConfigurableDeserializer(config).deserialize(jsonText);
}

function looksLikeRmInstance(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  return typeof ctor === "string" && ctor !== "Object" && ctor !== "Array";
}

const XML_NUMERIC_RM_FIELDS: Record<string, readonly string[]> = {
  DV_QUANTITY: ["magnitude", "precision", "accuracy"],
  DV_COUNT: ["magnitude", "accuracy"],
  DV_ORDINAL: ["value"],
  DV_SCALE: ["value"],
  DV_PROPORTION: ["numerator", "denominator", "type", "precision", "accuracy"],
  DV_DURATION: ["accuracy"],
  DV_AMOUNT: ["accuracy"],
  DV_MULTIMEDIA: ["size"],
};

const XML_BOOLEAN_RM_FIELDS: Record<string, readonly string[]> = {
  DV_BOOLEAN: ["value"],
  DV_QUANTITY: ["accuracy_is_percent"],
  DV_COUNT: ["accuracy_is_percent"],
  DV_PROPORTION: ["accuracy_is_percent"],
  DV_DURATION: ["accuracy_is_percent"],
  DV_AMOUNT: ["accuracy_is_percent"],
  DV_INTERVAL: ["lower_included", "upper_included", "lower_unbounded", "upper_unbounded"],
};

function parseXmlNumber(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseXmlBoolean(raw: unknown): boolean | undefined {
  if (typeof raw !== "string") return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return undefined;
}

/**
 * Workaround for upstream ehrtslib#336: `XmlDeserializer` parses XML leaf text
 * with `parseTagValue: false` and assigns raw strings onto RM instances without
 * numeric coercion (leaving `DV_QUANTITY.magnitude` as `"120"` and
 * `DV_COUNT._magnitude` as `"5"` so `get magnitude()` returns `undefined`).
 */
function coerceXmlDeserializedRmPrimitives(
  root: unknown,
  seen = new WeakSet<object>(),
): void {
  if (root == null || typeof root !== "object") return;
  if (seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) {
    for (const item of root) coerceXmlDeserializedRmPrimitives(item, seen);
    return;
  }
  const rec = root as Record<string, unknown>;
  const ctorName = (root as { constructor?: { name?: string } }).constructor?.name ?? "";

  const numFields = XML_NUMERIC_RM_FIELDS[ctorName];
  if (numFields) {
    for (const key of numFields) {
      // DV_COUNT stores the raw assigned string on `_magnitude` because its setter
      // only wraps `typeof val === "number"` in `Integer64.from(val)`.
      const backingKey = `_${key}`;
      const raw = typeof rec[key] === "string"
        ? rec[key]
        : (typeof rec[backingKey] === "string" ? rec[backingKey] : undefined);
      const num = parseXmlNumber(raw);
      if (num !== undefined) {
        rec[key] = num;
      }
    }
  }

  const boolFields = XML_BOOLEAN_RM_FIELDS[ctorName];
  if (boolFields) {
    for (const key of boolFields) {
      const backingKey = `_${key}`;
      const raw = typeof rec[key] === "string"
        ? rec[key]
        : (typeof rec[backingKey] === "string" ? rec[backingKey] : undefined);
      const bool = parseXmlBoolean(raw);
      if (bool !== undefined) {
        rec[key] = bool;
      }
    }
  }

  for (const val of Object.values(rec)) {
    if (val != null && typeof val === "object") {
      coerceXmlDeserializedRmPrimitives(val, seen);
    }
  }
}

/** Kinds used to split Simple-vitals ⚠ from a real mapping miss (#171). */
export type OpenEhrValidationKind =
  | "required-missing"
  | "unit-list"
  | "type-mismatch"
  | "code-phrase"
  | "archetype-sibling"
  | "other";

export function classifyOpenEhrValidationMessage(message: string): OpenEhrValidationKind {
  const m = message.toLowerCase();
  if (
    m.includes("required attribute missing") ||
    /\(min:\s*1\)/.test(m) ||
    (m.includes("mandatory") && m.includes("missing"))
  ) {
    return "required-missing";
  }
  if (
    m.includes("c_dv_quantity") ||
    (m.includes("unit") &&
      (m.includes("list") || m.includes("not in") || m.includes("not allowed") ||
        m.includes("constraint")))
  ) {
    return "unit-list";
  }
  if (m.includes("type mismatch") || (m.includes("cluster") && m.includes("element"))) {
    return "type-mismatch";
  }
  if (
    m.includes("code_phrase") ||
    m.includes("code phrase") ||
    m.includes("terminology") ||
    m.includes("defining_code")
  ) {
    return "code-phrase";
  }
  // Kept for messages produced before the sibling-constraint patch.
  if (m.includes("does not match template archetype")) return "archetype-sibling";
  return "other";
}

/**
 * Format an output validation message for human display (#373):
 * - Includes line number (`line N` for an exact hit, `near line N` when the
 *   location is the nearest existing ancestor of a missing field).
 * - Includes `targetPath` alongside `path` when they differ (e.g. FLAT keys).
 * - Appends missing-content placement and `expectedExample` when available.
 */
export function formatOutputValidationMessage(msg: OutputValidationMessage): string {
  const linePrefix = msg.line
    ? msg.sourceIsAncestor ? `near line ${msg.line}: ` : `line ${msg.line}: `
    : "";
  const locationPath = msg.targetPath && msg.targetPath !== msg.path
    ? `${msg.targetPath} (${msg.path})`
    : msg.path;
  let text = `${linePrefix}${locationPath}: ${msg.message}`;
  if (msg.expectedExample) {
    const whereHint = msg.targetPath
      ? `at ${msg.targetPath}${msg.line ? ` (near line ${msg.line})` : ""}`
      : msg.jsonPointer
      ? `inside ${msg.jsonPointer}${msg.line ? ` (near line ${msg.line})` : ""}`
      : `in root object${msg.line ? ` (near line ${msg.line})` : ""}`;
    const compactExample = msg.expectedExample.replace(/\s*\n\s*/g, " ");
    text += ` — expected ${whereHint}, e.g. ${compactExample}`;
  }
  return text;
}

