/**
 * `## Models` (#277 §7): each model the project uses, named once with the
 * identifiers copied from the loaded file, so the AI can use what it knows
 * about it or look it up (openEHR assistant MCP, CKM). Unknown values are
 * left out, never guessed.
 */
import type { SkeletonNode } from "../../types/mod.ts";
import { parseXsd } from "../xsd/xsd_model.ts";

export interface ModelFile {
  role: "target" | "source";
  /** Target format id (`openehr-template`, `json-schema`, `xml-schema`) or source format (`json`, `xml`). */
  format: string;
  filename: string;
  content: string;
  /** openEHR: the target skeleton, for the archetypes the template uses. */
  skeleton?: SkeletonNode[];
  /** openEHR: template id when already known. */
  targetId?: string;
}

export interface ModelDescription {
  role: "target" | "source";
  kind: "openEHR template" | "XML Schema" | "JSON Schema" | "XML" | "JSON";
  /** `name value` facts, in display order. */
  facts: Array<[string, string]>;
  /** openEHR archetype ids with version, in template order. */
  archetypes?: string[];
}

const ARCHETYPE_ID = /^openEHR-[A-Z]+-[A-Z_]+\.[A-Za-z0-9_-]+\.v\d+(\.\d+)*$/;

function firstMatch(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1]?.trim() || undefined;
}

function describeOpt(file: ModelFile): ModelDescription {
  const xml = file.content;
  const facts: Array<[string, string]> = [];
  const templateId = file.targetId || firstMatch(xml, /<template_id>\s*<value>([^<]+)<\/value>/);
  const concept = firstMatch(xml, /<concept>([^<]+)<\/concept>/);
  // The template's own <language> comes before <description>.
  const head = xml.slice(0, Math.max(0, xml.indexOf("<description")) || 2000);
  const language = firstMatch(head, /<language>[\s\S]*?<code_string>([^<]+)<\/code_string>/);
  const rmRelease = firstMatch(xml, /rm_release="([^"]+)"/) ?? firstMatch(xml, /<rm_release>([^<]+)<\/rm_release>/);
  if (templateId) facts.push(["template id", templateId]);
  if (concept && concept !== templateId) facts.push(["concept", concept]);
  if (language) facts.push(["original language", language]);
  if (rmRelease) facts.push(["RM release", rmRelease]);
  facts.push(["file", file.filename]);
  const archetypes = new Set<string>();
  for (const m of xml.matchAll(/<archetype_id>\s*<value>([^<]+)<\/value>/g)) {
    if (ARCHETYPE_ID.test(m[1]!.trim())) archetypes.add(m[1]!.trim());
  }
  for (const node of file.skeleton ?? []) {
    if (node.archetypeRef && ARCHETYPE_ID.test(node.archetypeRef)) archetypes.add(node.archetypeRef);
  }
  return { role: file.role, kind: "openEHR template", facts, archetypes: [...archetypes] };
}

function describeXsd(file: ModelFile): ModelDescription {
  const facts: Array<[string, string]> = [];
  try {
    const model = parseXsd(file.content);
    if (model.targetNamespace) facts.push(["targetNamespace", model.targetNamespace]);
    if (model.version) facts.push(["version", model.version]);
    if (model.rootName) facts.push(["root element", model.rootName]);
  } catch {
    // Unreadable XSD: the file name is all we know.
  }
  facts.push(["file", file.filename]);
  return { role: file.role, kind: "XML Schema", facts };
}

function describeJsonSchema(file: ModelFile): ModelDescription {
  const facts: Array<[string, string]> = [];
  try {
    const schema = JSON.parse(file.content) as Record<string, unknown>;
    for (const key of ["$id", "$schema", "title", "version", "x-version"]) {
      const value = schema[key];
      if (typeof value === "string" && value.trim()) facts.push([key, value.trim()]);
    }
  } catch {
    // Not JSON: the file name is all we know.
  }
  facts.push(["file", file.filename]);
  return { role: file.role, kind: "JSON Schema", facts };
}

export function describeModels(file: ModelFile): ModelDescription {
  const f = file.format.toLowerCase();
  if (f === "openehr-template" || f === "openehr") return describeOpt(file);
  if (f === "xml-schema" || f === "xsd" || (f === "xml" && /<(\w+:)?schema[\s>]/.test(file.content.slice(0, 4000)))) {
    return describeXsd(file);
  }
  if (f === "json-schema" || f === "json") return describeJsonSchema(file);
  if (f === "xml") return { role: file.role, kind: "XML", facts: [["file", file.filename]] };
  return { role: file.role, kind: "JSON", facts: [["file", file.filename]] };
}

/** One line per model, archetypes on one line each below the template. */
export function formatModelsBlock(models: ModelDescription[]): string {
  const lines: string[] = [];
  for (const m of models) {
    const facts = m.facts.map(([k, v]) => `${k} \`${v}\``).join(", ");
    lines.push(`- ${m.role} (${m.kind}): ${facts}`);
    if (m.archetypes?.length) {
      lines.push(`  - archetypes: ${m.archetypes.map((id) => `\`${id}\``).join(", ")}`);
    }
  }
  return lines.join("\n");
}
