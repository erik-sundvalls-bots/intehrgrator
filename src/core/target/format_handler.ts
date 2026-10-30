/**
 * Target Format Handler seam.
 *
 * A Target Format describes the data structure produced by a conversion.
 * Export dialects (TypeScript, Java, Handlebars) are separate adapters.
 */
import { docText, parseXsd, type XsdModel, type XsdNode } from "../xsd/xsd_model.ts";
import type {
  ClinicalModelFileset,
  SchemaTreeNode,
  SkeletonNode,
  TargetFormatId,
} from "../../types/mod.ts";
import {
  generateSkeleton,
  generateSkeletonFromWebTemplate,
  collectAllSlotIds,
  isRepeatingMultiplicity,
  isPartyIdentityRmType,
} from "../skeleton/generate_skeleton.ts";
import {
  isRmBoilerplateAttribute,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { orderLanguages } from "../skeleton/template_terms.ts";
import { loadJsonSchema } from "../source/schema_loader.ts";
import { isWebTemplateJson } from "ehrtslib/serialization/simplified/mod.ts";
import { isTemplateJson } from "ehrtslib/parser/mod.ts";
import { scaffoldClinicalModelFileset } from "../clinical_model/github_template.ts";
import { isAutoFixedValueSlot, NON_LOCATABLE_RM_TYPES } from "../rm_mandatory.ts";
import { assignSchemaBlockTypes } from "./schema_block_ids.ts";

export interface TargetDefinition {
  format: TargetFormatId;
  filename: string;
  targetId: string;
  content: string;
  skeleton: SkeletonNode[];
  /** Fetched GitHub `.t.json` + ADL closure for round-trip restore without GitHub. */
  fileset?: ClinicalModelFileset;
  /** Web Template JSON used for ontology/label language switching when content is OPT XML. */
  webTemplateJson?: string;
  /** Ontology / localized label language currently applied to `skeleton`. */
  language?: string;
  /** Languages available on this target model (when multilingual). */
  languages?: string[];
  /** Id language `webTemplateJson` ids were built in (#289); absent = `"primary"` (lang.1). */
  idLanguage?: string;
}

export interface TargetLoadOptions {
  /** Preferred ontology / documentation language. */
  language?: string;
}

export interface TargetRenderRequest {
  definition: TargetDefinition;
  slotValues: Readonly<Record<string, unknown>>;
}

export interface TargetFormatHandler {
  readonly id: TargetFormatId;
  load(filename: string, content: string, options?: TargetLoadOptions): TargetDefinition;
  render(request: TargetRenderRequest): unknown;
}

const handlers = new Map<TargetFormatId, TargetFormatHandler>();

export function registerTargetFormatHandler(handler: TargetFormatHandler): void {
  handlers.set(handler.id, handler);
}

export function getTargetFormatHandler(format: TargetFormatId): TargetFormatHandler {
  const handler = handlers.get(format);
  if (!handler) throw new Error(`Unsupported target format: ${format}`);
  return handler;
}

export function listTargetFormatIds(): TargetFormatId[] {
  return [...handlers.keys()];
}

export function detectTargetFormat(filename: string, content = ""): TargetFormatId {
  content = stripBom(content);
  const lower = filename.toLowerCase();
  if (/\.(hbs|handlebars|txt|md|html|csv)$/.test(lower)) return "free-form";
  if (lower.endsWith(".xsd")) return "xml-schema";
  if (/\.(opt|opt2|adl|adls|t\.json)$/.test(lower)) return "openehr-template";
  if (lower.endsWith(".xml")) {
    return isXmlSchemaDocument(content) ? "xml-schema" : "openehr-template";
  }
  if (isXmlSchemaDocument(content)) return "xml-schema";
  if (lower.endsWith(".json") || content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (isWebTemplateJson(parsed) || isTemplateJson(content)) return "openehr-template";
    } catch {
      // The chosen handler reports malformed content.
    }
    return "json-schema";
  }
  return "free-form";
}

function isXmlSchemaDocument(content: string): boolean {
  return /<(?:\w+:)?schema\b/.test(content) && /XMLSchema/i.test(content);
}

/** Reload an existing target definition with a different ontology/documentation language. */
export function reloadTargetLanguage(
  definition: TargetDefinition,
  language: string,
): TargetDefinition {
  if (definition.fileset?.files.some((file) => /\.t\.json$/i.test(file.path))) {
    const loaded = scaffoldClinicalModelFileset(definition.fileset, language);
    return {
      ...definition,
      skeleton: loaded.skeleton,
      language: loaded.language,
      languages: loaded.languages.length ? loaded.languages : definition.languages,
      webTemplateJson: loaded.webTemplateJson,
      // Fresh Web Template: primary-language ids again until re-applied.
      idLanguage: undefined,
    };
  }
  // An OPT XML file is re-read itself (#279): target languages keep the OPT's
  // order, and `webTemplateJson` (Simplified FLAT ids) stays the first load's.
  if (definition.webTemplateJson && !definition.content.trimStart().startsWith("<")) {
    const generated = generateSkeletonFromWebTemplate(definition.webTemplateJson, {
      language,
    });
    return {
      ...definition,
      skeleton: generated.skeleton,
      language: generated.language,
      languages: generated.languages,
    };
  }
  const reloaded = getTargetFormatHandler(definition.format).load(
    definition.filename,
    definition.content,
    { language },
  );
  return {
    ...reloaded,
    fileset: definition.fileset,
    webTemplateJson: definition.webTemplateJson,
    idLanguage: definition.idLanguage,
  };
}

registerTargetFormatHandler({
  id: "openehr-template",
  load(filename, content, options) {
    if (content.trimStart().startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }
      if (parsed && isWebTemplateJson(parsed)) {
        const generated = generateSkeletonFromWebTemplate(content, {
          language: options?.language,
        });
        return {
          format: "openehr-template" as const,
          filename,
          targetId: generated.templateId,
          content,
          skeleton: generated.skeleton,
          language: generated.language,
          languages: generated.languages,
        };
      }
      const generated = generateSkeleton(content, { language: options?.language });
      return {
        format: "openehr-template" as const,
        filename,
        targetId: generated.templateId,
        content,
        skeleton: generated.skeleton,
        language: generated.language,
        languages: generated.languages,
        webTemplateJson: generated.webTemplateJson ?? content,
      };
    }
    const generated = generateSkeleton(content, { language: options?.language });
    return {
      format: "openehr-template",
      filename,
      targetId: generated.templateId,
      content,
      skeleton: generated.skeleton,
      language: generated.language,
      languages: generated.languages,
      webTemplateJson: generated.webTemplateJson,
    };
  },
  render({ definition, slotValues }) {
    const roots = definition.skeleton
      .map((node) => renderOpenEhrNode(node, slotValues))
      .filter((value) => value !== undefined);
    return roots.length === 1 ? roots[0] : roots;
  },
});

registerTargetFormatHandler({
  id: "json-schema",
  load(filename, content) {
    content = stripBom(content);
    const document = JSON.parse(content) as Record<string, unknown>;
    const targetId = typeof document.$id === "string"
      ? document.$id
      : typeof document.title === "string"
      ? document.title
      : stripExtension(filename);
    const displayName = typeof document.title === "string" && document.title.trim()
      ? document.title.trim()
      : stripExtension(filename);
    const tree = loadJsonSchema(content, displayName);
    const root = schemaTreeToSkeleton(tree, targetId, "json-schema", true);
    assignSchemaBlockTypes(root);
    return {
      format: "json-schema",
      filename,
      targetId,
      content,
      skeleton: [root],
    };
  },
  render({ definition, slotValues }) {
    const root = definition.skeleton[0];
    return root ? renderGenericNode(root, slotValues) : {};
  },
});

registerTargetFormatHandler({
  id: "xml-schema",
  load(filename, content, options) {
    const parsed = parseXmlSchema(content, stripExtension(filename), options?.language);
    assignSchemaBlockTypes(parsed.root);
    return {
      format: "xml-schema",
      filename,
      targetId: parsed.targetId,
      content,
      skeleton: [parsed.root],
      language: parsed.language,
      languages: parsed.languages,
    };
  },
  render({ definition, slotValues }) {
    const root = definition.skeleton[0];
    return root ? renderXmlNode(root, slotValues) : "";
  },
});

registerTargetFormatHandler({
  id: "free-form",
  load(filename, content) {
    const targetId = stripExtension(filename) || "free-form";
    return {
      format: "free-form",
      filename,
      targetId,
      content,
      skeleton: [],
    };
  },
  render({ definition }) {
    return definition.content;
  },
});

function schemaTreeToSkeleton(
  node: SchemaTreeNode,
  targetId: string,
  format: TargetFormatId,
  _root = false,
): SkeletonNode {
  const children = node.children.map((child) =>
    schemaTreeToSkeleton(child, targetId, format)
  );
  const kind = children.length || node.type === "object" || node.type === "array"
    ? "container"
    : "value";
  return {
    slotId: `${targetId}:${node.path}`,
    targetPath: node.path,
    blockType: kind === "container" ? "target_structure" : "target_value",
    rmType: node.type,
    label: node.name,
    rmAttribute: node.name.replace(/\[\*\]$/, ""),
    kind,
    mandatory: node.multiplicity === "1" || node.multiplicity === "1..*",
    multiplicity: node.multiplicity,
    slotCardinality: node.multiplicity,
    ...(node.description ? { documentation: node.description } : {}),
    children,
  };
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseXmlSchema(content: string, fallbackId: string, preferredLang?: string): {
  targetId: string;
  root: SkeletonNode;
  language?: string;
  languages?: string[];
} {
  // One XSD reader for source and target (#278 / #277): named types, refs,
  // groups, attribute groups and extensions resolve into the skeleton.
  let model: XsdModel;
  try {
    model = parseXsd(stripBom(content));
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Invalid XML Schema");
  }
  const languages = orderLanguages(undefined, model.languages.filter(Boolean));
  const language = preferredLang && languages.includes(preferredLang) ? preferredLang : languages[0];
  const rootName = model.rootName || fallbackId;
  return {
    targetId: model.targetNamespace || rootName,
    root: xsdNodeToSkeleton(model.root, true, language),
    language,
    languages: languages.length ? languages : undefined,
  };
}

function xsdNodeToSkeleton(node: XsdNode, root: boolean, language?: string): SkeletonNode {
  const documentation = docText(node.docs, language);
  // xml:lang documentation doubles as the localized block title when present;
  // keep the same prose on `documentation` for the help viewer.
  const label = documentation || node.name;
  const kids = node.children.map((child) => xsdNodeToSkeleton(child, false, language));
  // Attributes first, as before.
  const children = [...kids.filter((k) => k.xmlKind === "attribute"), ...kids.filter((k) => k.xmlKind !== "attribute")];
  const kind = children.length || node.complex ? "container" : "value";
  const multiplicity = root ? "1" : node.multiplicity;
  const out: SkeletonNode = {
    slotId: node.xmlKind === "element" && root ? `${node.name}:${node.path}` : `${node.path}:${node.path}`,
    targetPath: node.path,
    blockType: kind === "container" ? "target_structure" : "target_value",
    rmType: node.complex && !node.simpleContent ? "complexType" : (node.type || "string"),
    label,
    rmAttribute: node.name,
    kind,
    mandatory: root ? true : node.min > 0 || (node.xmlKind === "attribute" && Boolean(node.fixed)),
    multiplicity,
    slotCardinality: multiplicity,
    xmlKind: node.xmlKind,
    ...(documentation ? { documentation } : {}),
    children,
  };
  const fixed = node.fixed ?? node.default;
  if (fixed) out.fixedValue = fixed;
  return out;
}

function renderGenericNode(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
): unknown {
  if (node.kind === "value") return values[node.slotId] ?? fixedValue(node);
  if (node.rmType === "array") {
    const item = node.children[0] ? renderGenericNode(node.children[0], values) : undefined;
    return item === undefined ? [] : [item];
  }
  const result: Record<string, unknown> = {};
  for (const child of node.children) {
    const value = renderGenericNode(child, values);
    if (value !== undefined) result[child.rmAttribute ?? child.label] = value;
  }
  return result;
}

function renderOpenEhrNode(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
  parentArchetypeRef?: string,
): unknown {
  if (
    node.kind === "container" &&
    isRepeatingMultiplicity(node.multiplicity)
  ) {
    const count = repeatingInstanceCount(node, values);
    if (count > 1) {
      const perItemSlots = perItemSlotIds(node, values);
      const copies: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const indexed = indexSlotValues(values, i, node);
        if (!subtreeHasClinicalValue(node, indexed, perItemSlots)) continue;
        const one = renderOpenEhrNodeOnce(node, indexed, parentArchetypeRef);
        if (one !== undefined) copies.push(one);
      }
      return copies.length ? copies : undefined;
    }
  }
  if (node.rmType !== "COMPOSITION" && !subtreeHasClinicalValue(node, values)) {
    return undefined;
  }
  return renderOpenEhrNodeOnce(node, values, parentArchetypeRef);
}

/** Boilerplate (language, event time) is kept once its parent is already included. */
function renderOpenEhrChild(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
  parentArchetypeRef?: string,
): unknown {
  if (node.rmAttribute && isRmBoilerplateAttribute(node.rmAttribute)) {
    return renderOpenEhrNodeOnce(node, values, parentArchetypeRef);
  }
  return renderOpenEhrNode(node, values, parentArchetypeRef);
}

/**
 * Event `time` / HISTORY `origin` count only when that copy's value came from
 * a per-item array (a source mapping), not a scalar context default.
 */
const PER_ITEM_CONTEXT_ATTRS = new Set(["time", "origin"]);

/**
 * A mapped or fixed value anywhere under this node.
 * LOCATABLE identity and RM boilerplate (language, event time, …) do not count,
 * so an optional observation that only received context defaults is omitted.
 * A repeating copy whose timestamp or origin was mapped per item still counts.
 */
function subtreeHasClinicalValue(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
  perItemSlots?: ReadonlySet<string>,
): boolean {
  if (node.rmAttribute && isRmBoilerplateAttribute(node.rmAttribute)) {
    if (
      perItemSlots &&
      PER_ITEM_CONTEXT_ATTRS.has(node.rmAttribute) &&
      perItemContextIsPresent(node, values, perItemSlots)
    ) {
      return true;
    }
    return node.children.some((child) => subtreeHasClinicalValue(child, values, perItemSlots));
  }
  if (Object.hasOwn(values, node.slotId) && valueIsPresent(values[node.slotId])) return true;
  if (node.kind === "value") {
    const value = Object.hasOwn(values, node.slotId) ? values[node.slotId] : fixedValue(node);
    return valueIsPresent(value);
  }
  return node.children.some((child) => subtreeHasClinicalValue(child, values, perItemSlots));
}

function perItemSlotIds(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
): Set<string> {
  const ids = new Set<string>();
  for (const slotId of collectAllSlotIds([node])) {
    if (Array.isArray(values[slotId])) ids.add(slotId);
  }
  return ids;
}

function perItemContextIsPresent(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
  perItemSlots: ReadonlySet<string>,
): boolean {
  if (perItemSlots.has(node.slotId) && valueIsPresent(values[node.slotId])) return true;
  return node.children.some((child) => perItemContextIsPresent(child, values, perItemSlots));
}

function valueIsPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => valueIsPresent(item));
  if (typeof value === "string") return value.trim() !== "";
  if (isAbsentValue(value)) return false;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => key !== "_type");
    if (!keys.length) return false;
    return keys.some((key) => valueIsPresent(record[key]));
  }
  return true;
}

function renderOpenEhrNodeOnce(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
  parentArchetypeRef?: string,
): unknown {
  if (node.kind === "value") {
    let value = Object.hasOwn(values, node.slotId) ? values[node.slotId] : fixedValue(node);
    if (Array.isArray(value)) {
      value = value.find((item) => !isAbsentValue(item));
    }
    if (isAbsentValue(value)) return undefined;
    if (!node.rmType.startsWith("DV_") && node.rmType !== "CODE_PHRASE") return value;
    const output: Record<string, unknown> = { _type: node.rmType };
    assignDataValueFields(output, node.rmType, value);
    applyFixedDataValueFields(output, node.rmType, node.fixedFields);
    if (node.rmType === "CODE_PHRASE") completeCodePhrase(output, node);
    fillCodedValueFromAllowed(output, node);
    return output;
  }

  const output: Record<string, unknown> = { _type: node.rmType };
  // archetype_node_id and name exist on LOCATABLE only (not EVENT_CONTEXT, ISM_TRANSITION, …).
  const locatable = !NON_LOCATABLE_RM_TYPES.has(node.rmType);
  const nodeId = locatable ? rmArchetypeNodeId(node, parentArchetypeRef) : undefined;
  if (nodeId) output.archetype_node_id = nodeId;
  const childArchetypeRef = node.archetypeRef ?? parentArchetypeRef;
  const locatableName = rmLocatableName(node);
  if (
    locatable && locatableName && node.rmType !== "COMPOSITION" &&
    !isPartyIdentityRmType(node.rmType)
  ) {
    output.name = { _type: "DV_TEXT", value: locatableName };
  }
  if (isPartyIdentityRmType(node.rmType) && Object.hasOwn(values, node.slotId)) {
    assignPartyIdentityFields(output, values[node.slotId]);
  }
  const grouped = new Map<string, unknown[]>();
  for (const child of node.children) {
    // LOCATABLE identity is copied from the skeleton node, not mapped as DV_TEXT.
    if (isAutoFixedValueSlot(child)) continue;
    if (isPartyIdentityRmType(node.rmType) && (child.rmAttribute === "name" || child.rmAttribute === "identifiers")) {
      continue;
    }
    const value = renderOpenEhrChild(child, values, childArchetypeRef);
    if (value === undefined) continue;
    const attribute = child.rmAttribute ?? child.label;
    const list = grouped.get(attribute) ?? [];
    if (Array.isArray(value) && child.kind === "container") {
      list.push(...value);
    } else {
      list.push(value);
    }
    grouped.set(attribute, list);
  }
  if (
    grouped.size === 0 && node.rmType !== "COMPOSITION" && output.identifiers == null &&
    !(isPartyIdentityRmType(node.rmType) && output.name != null)
  ) {
    return undefined;
  }
  for (const [attribute, valuesForAttribute] of grouped) {
    output[attribute] = shouldRenderAsArray(attribute, valuesForAttribute.length)
      ? valuesForAttribute
      : valuesForAttribute[0];
  }
  // COMPOSITION.name is mandatory: a mapped name slot wins, else the template name (as TypeScript mode).
  if (node.rmType === "COMPOSITION" && output.name == null && locatableName) {
    output.name = { _type: "DV_TEXT", value: locatableName };
  }
  // ENTRY.subject is mandatory; unmapped it is the record's owner (#310).
  if (ENTRY_RM_TYPES.has(node.rmType) && output.subject == null) {
    output.subject = { _type: "PARTY_SELF" };
  }
  if (output._type === "PARTY_PROXY") {
    output._type = output.name != null || output.identifiers != null ? "PARTY_IDENTIFIED" : "PARTY_SELF";
  }
  return output;
}

const ENTRY_RM_TYPES = new Set(["OBSERVATION", "EVALUATION", "INSTRUCTION", "ACTION", "ADMIN_ENTRY"]);


/** Default terminology of a CODE_PHRASE RM attribute when the value is only a code. */
const CODE_PHRASE_ATTR_TERMINOLOGY: Record<string, string> = {
  language: "ISO_639-1",
  territory: "ISO_3166-1",
  encoding: "IANA_character-sets",
};

/**
 * A scalar CODE_PHRASE value ("en" or "ISO_639-1::en") becomes canonical
 * `terminology_id` + `code_string` rather than a stray `value` (#310).
 */
function completeCodePhrase(output: Record<string, unknown>, node: SkeletonNode): void {
  if (output.value === undefined) return;
  const raw = String(output.value ?? "").trim();
  delete output.value;
  if (output.code_string == null || String(output.code_string) === "") {
    const sep = raw.lastIndexOf("::");
    if (sep > 0) {
      output.terminology_id ??= { _type: "TERMINOLOGY_ID", value: raw.slice(0, sep) };
      output.code_string = raw.slice(sep + 2);
    } else {
      output.code_string = raw;
    }
  }
  if (output.terminology_id == null) {
    const attr = node.rmAttribute ?? node.label;
    const term = CODE_PHRASE_ATTR_TERMINOLOGY[attr];
    if (term) output.terminology_id = { _type: "TERMINOLOGY_ID", value: term };
  }
}

function repeatingInstanceCount(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
): number {
  let max = 0;
  for (const slotId of collectAllSlotIds([node])) {
    const value = values[slotId];
    if (Array.isArray(value)) max = Math.max(max, value.length);
  }
  return max;
}

function indexSlotValues(
  values: Readonly<Record<string, unknown>>,
  index: number,
  subtree: SkeletonNode,
): Record<string, unknown> {
  const ids = new Set(collectAllSlotIds([subtree]));
  const out: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!ids.has(key)) continue;
    if (Array.isArray(value)) out[key] = value[index];
  }
  return out;
}

function renderXmlNode(
  node: SkeletonNode,
  values: Readonly<Record<string, unknown>>,
): string {
  if (node.xmlKind === "attribute") return "";
  const name = xmlName(xmlTagName(node));
  if (node.kind === "value") {
    const value = values[node.slotId] ?? fixedValue(node);
    return value === undefined ? "" : `<${name}>${escapeXml(String(value))}</${name}>`;
  }
  const attrParts: string[] = [];
  const bodyParts: string[] = [];
  for (const child of node.children) {
    if (child.xmlKind === "attribute") {
      const value = values[child.slotId] ?? fixedValue(child);
      if (value === undefined) continue;
      attrParts.push(` ${xmlName(child.rmAttribute ?? child.label)}="${escapeXml(String(value))}"`);
      continue;
    }
    bodyParts.push(renderXmlNode(child, values));
  }
  const body = bodyParts.join("");
  return `<${name}${attrParts.join("")}>${body}</${name}>`;
}

function xmlTagName(node: SkeletonNode): string {
  if (node.rmAttribute) return node.rmAttribute;
  const fromPath = node.targetPath?.split("/").filter(Boolean).pop();
  return fromPath || node.label;
}

function assignDataValueFields(
  output: Record<string, unknown>,
  rmType: string,
  value: unknown,
): void {
  const record = asStringKeyedRecord(value);
  if (rmType === "DV_QUANTITY") {
    if (record) {
      if (record.magnitude !== undefined) output.magnitude = record.magnitude;
      if (record.units !== undefined) output.units = record.units;
    } else {
      output.magnitude = value;
    }
    return;
  }
  if (rmType === "DV_BOOLEAN") {
    output.value = record && "value" in record ? Boolean(record.value) : Boolean(value);
    return;
  }
  if (rmType === "DV_COUNT") {
    output.magnitude = record && "magnitude" in record ? Number(record.magnitude) : Number(value);
    return;
  }
  if (rmType === "DV_IDENTIFIER") {
    if (record) {
      if (record.id !== undefined) output.id = record.id;
      else if (record.value !== undefined) output.id = record.value;
      if (record.type !== undefined) output.type = record.type;
      if (record.issuer !== undefined) output.issuer = record.issuer;
    } else {
      output.id = value;
    }
    return;
  }
  if (rmType === "DV_CODED_TEXT") {
    if (record) {
      if (record.value !== undefined) output.value = record.value;
      const phrase = codedPhraseFromRecord(record);
      if (phrase) output.defining_code = phrase;
    } else {
      output.value = value;
    }
    return;
  }
  if (rmType === "CODE_PHRASE") {
    if (record) {
      const phrase = codedPhraseFromRecord(record);
      if (phrase) {
        Object.assign(output, phrase);
        return;
      }
    }
    output.value = value;
    return;
  }
  if (record && record.value !== undefined) {
    output.value = record.value;
    return;
  }
  output.value = value;
}

/** A mapped rubric ("Sitting") fills the template code when exactly one choice matches. */
function fillCodedValueFromAllowed(
  output: Record<string, unknown>,
  node: SkeletonNode,
): void {
  const choices = node.allowedValues;
  if (!choices?.length) return;
  if (node.rmType !== "DV_CODED_TEXT" && node.rmType !== "CODE_PHRASE") return;
  const phrase = asStringKeyedRecord(output.defining_code);
  const existing = node.rmType === "CODE_PHRASE"
    ? output.code_string
    : phrase?.code_string;
  if (existing != null && String(existing).trim() !== "") return;
  const rubric = String(output.value ?? "").trim().toLowerCase();
  if (!rubric) return;
  const matches = choices.filter((choice) => {
    const label = choice.label.trim().toLowerCase();
    const code = choice.code.trim().toLowerCase();
    return label === rubric || code === rubric;
  });
  if (matches.length !== 1) return;
  const chosen = matches[0]!;
  const terminology = chosen.terminologyId ||
    (typeof phrase?.terminology_id === "object"
      ? stringAttr(asStringKeyedRecord(phrase.terminology_id), "value")
      : "") ||
    "local";
  const codePhrase: Record<string, unknown> = {
    _type: "CODE_PHRASE",
    terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
    code_string: chosen.code,
  };
  if (node.rmType === "CODE_PHRASE") {
    Object.assign(output, codePhrase);
    return;
  }
  if (output.value == null || String(output.value).trim() === "") output.value = chosen.label;
  output.defining_code = codePhrase;
}

function applyFixedDataValueFields(
  output: Record<string, unknown>,
  rmType: string,
  fields: Record<string, string> | undefined,
): void {
  if (!fields) return;
  if (rmType === "DV_CODED_TEXT") {
    if (fields.value && output.value === undefined) output.value = fields.value;
    const phrase = codedPhraseFromRecord(fields);
    if (phrase && output.defining_code == null) output.defining_code = phrase;
    return;
  }
  if (rmType === "CODE_PHRASE") {
    const phrase = codedPhraseFromRecord(fields);
    if (phrase) Object.assign(output, phrase);
    return;
  }
  if (rmType === "DV_IDENTIFIER") {
    if (fields.id && output.id === undefined) output.id = fields.id;
    if (fields.type) output.type = fields.type;
    if (fields.issuer) output.issuer = fields.issuer;
    return;
  }
  Object.assign(output, fields);
}

function asStringKeyedRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function assignPartyIdentityFields(output: Record<string, unknown>, value: unknown): void {
  const record = asStringKeyedRecord(value);
  if (!record) {
    // "PARTY_SELF" is the factory subject sentinel, not a name.
    if (value === "PARTY_SELF") output._type = "PARTY_SELF";
    else if (value != null && String(value) !== "") output.name = String(value);
    return;
  }
  if (typeof record._type === "string" && record._type.startsWith("PARTY_")) {
    output._type = record._type;
  }
  const name = record.name ?? record.value;
  if (name != null && String(name) !== "") output.name = String(name);
  const id = record.id ?? record.identifier;
  const type = record.type;
  if (Array.isArray(record.identifiers)) {
    const rows = record.identifiers
      .map((row) => dvIdentifierFromUnknown(row))
      .filter((row): row is Record<string, unknown> => row != null);
    if (rows.length) output.identifiers = rows;
  } else if (id != null && String(id) !== "") {
    output.identifiers = [dvIdentifierFromParts(id, type, record)];
  }
}

function dvIdentifierFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const record = asStringKeyedRecord(value);
  if (!record) return dvIdentifierFromParts(value, undefined);
  const id = record.id ?? record.value;
  if (id == null) return null;
  return dvIdentifierFromParts(id, record.type, record);
}

function dvIdentifierFromParts(
  id: unknown,
  type: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const identifier: Record<string, unknown> = { _type: "DV_IDENTIFIER", id: String(id) };
  if (type != null && String(type) !== "") identifier.type = String(type);
  const issuer = extra?.issuer;
  const assigner = extra?.assigner;
  if (issuer != null && String(issuer) !== "") identifier.issuer = String(issuer);
  if (assigner != null && String(assigner) !== "") identifier.assigner = String(assigner);
  return identifier;
}

function codedPhraseFromRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const nested = record.defining_code;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const phrase: Record<string, unknown> = {
      _type: "CODE_PHRASE",
      ...(nested as Record<string, unknown>),
    };
    const term = phrase.terminology_id;
    if (typeof term === "string" || typeof term === "number") {
      phrase.terminology_id = { _type: "TERMINOLOGY_ID", value: String(term) };
    }
    return phrase;
  }
  const code = record.code_string ?? record.code ??
    (typeof nested === "string" || typeof nested === "number" ? nested : undefined);
  const term = record.terminology_id ?? record.terminology;
  if (code == null && term == null) return null;
  const phrase: Record<string, unknown> = { _type: "CODE_PHRASE" };
  if (term != null) {
    phrase.terminology_id = typeof term === "object"
      ? term
      : { _type: "TERMINOLOGY_ID", value: String(term) };
  }
  if (code != null) phrase.code_string = String(code);
  return phrase;
}

function isAbsentValue(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "number" && Number.isNaN(value));
}

function fixedValue(node: SkeletonNode): unknown {
  return node.fixedValue ?? node.fixedFields?.value ?? node.fixedFields?.defining_code;
}

function shouldRenderAsArray(attribute: string, count: number): boolean {
  return count > 1 ||
    new Set(["content", "items", "events", "activities", "participations", "links"]).has(attribute);
}




function stringAttr(value: Record<string, unknown> | null | undefined, key: string): string {
  const item = value?.[key];
  return typeof item === "string" || typeof item === "number" ? String(item) : "";
}


function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
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
