import { parseTemplateInput } from "ehrtslib/parser/mod.ts";
import {
  parseWebTemplate,
  webTemplateToOpt,
} from "ehrtslib/serialization/simplified/mod.ts";
import { buildWebTemplate } from "ehrtslib/serialization/simplified/web_template_builder.ts";
import {
  createTemplateLabelResolver,
  fixedNameConstraint,
  type TemplateLabelResolver,
} from "ehrtslib/generation/template_label_resolver.ts";
import { stripNamePredicates } from "ehrtslib/generation/opt_l10n.ts";
import {
  applyOperationalTemplateTermScopes,
  type TermScopeMeta,
} from "ehrtslib/generation/term_scope.ts";
import { readTemplateId } from "ehrtslib/am/util/ontology_merge.ts";
import type {
  AllowedOrdinal,
  AllowedValue,
  AttributeConstraint,
  OptionalRmInsertion,
  SkeletonNode,
} from "../../types/mod.ts";
import {
  blockTypeForRm,
  isAutoFixedValueSlot,
  isDataValueType,
  LOCATABLE_TYPES,
  mandatoryAttributesFor,
  returnTypeForDv,
} from "../rm_mandatory.ts";
import { withRmConstrainedFields } from "../rm_terminology.ts";
import { baseRmTypeName, isAbstractType, isSubtypeOf } from "../rm_meta.ts";
import {
  formatCardinalityCompact,
  intervalFromAmAttribute,
  intervalFromAmBound,
  isProhibitedInterval,
  rmAttributeInterval,
  type CardinalityInterval,
} from "../cardinality.ts";
import {
  archetypeShortName,
  availableOptLanguages,
  availableWebTemplateLanguages,
  buildWebTemplateTermsIndex,
  isGenericRmTypeLabel,
  isOverlayArchetypeRef,
  liveArchetypeTermsIndex,
  locatableNodeLabel,
  lookupTermText,
  mergedOntologyTerms,
  mergeTermMaps,
  nameFallbackOf,
  overlayConceptFallback,
  publicArchetypeRef,
  resolveOptLanguage,
  TEMPLATE_ROOT_TERM_SCOPE,
  termBagsRecord,
  termScopeOf,
  type TermBag,
} from "./template_terms.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AmObject = any;

export interface GenerateSkeletonOptions {
  /** Preferred ontology / localizedNames language (ISO 639-1). */
  language?: string;
  /**
   * The template's primary language (lang.1), when the caller knows it better
   * than the OPT does (a Web Template's `defaultLanguage`). Name constraints
   * are labels in this language only.
   */
  primaryLanguage?: string;
}

/**
 * How a node's own name is labelled while walking. A template that renames an
 * archetype node writes the new name as a name constraint (`name/value matches
 * {"Calculated scales"}`), in the template's primary language. EHRbase's Web
 * Template generator and ehrtslib's `buildWebTemplate` use that name in the
 * primary language and fall back to the archetype term text otherwise; the
 * skeleton does the same. `occurrence` is the Web Template terms scope of a
 * renamed archetype occurrence (`archetypeId,'Calculated scales'`), whose
 * `localizedNames` give the other languages.
 */
interface NameLabels {
  primary: boolean;
  occurrence?: string;
}

export interface GenerateSkeletonResult {
  templateId: string;
  skeleton: SkeletonNode[];
  warnings: string[];
  /** Language used for term/label resolution. */
  language: string;
  /** Languages available on the source model (may be a single entry). */
  languages: string[];
  /** Web Template JSON for Simplified FLAT / structured Test Run serialise. */
  webTemplateJson?: string;
}

export function generateSkeleton(
  optSource: string,
  options?: GenerateSkeletonOptions,
): GenerateSkeletonResult {
  const parsed = parseTemplateInput(optSource);
  const opt = parsed.operationalTemplate as AmObject;
  if (!opt?.definition) {
    if (parsed.format === "template_json") {
      throw new Error(
        "Better .t.json templates need a GitHub blob/raw URL so dependent archetypes can be fetched. Use ▾ → From GitHub template…",
      );
    }
    throw new Error("Could not parse operational template from input");
  }
  const generated = generateSkeletonFromOperational(opt, undefined, options);
  // The template's primary language (lang.1). In OPT 1.4 that is the top-level
  // `<language>` chosen at export, which ehrtslib exposes as `original_language`.
  const primary = resolveOptLanguage(opt);
  if (generated.language !== primary) {
    withPrimaryNames(generated.skeleton, generateSkeletonFromOperational(opt, undefined, { language: primary }).skeleton);
  }
  return {
    ...generated,
    warnings: [...parsed.warnings, ...generated.warnings],
    webTemplateJson: webTemplateJsonFromOperational(opt, generated.language, generated.languages),
  };
}

/**
 * Web Template → OPT. Since ehrtslib v0.9, `webTemplateToOpt` leaves out an
 * EVENT_CONTEXT that has only RM attributes (`start_time`, `setting`, marked
 * `inContext`). Put the bare EVENT_CONTEXT back so its RM-mandatory slots are
 * scaffolded as for an OPT target.
 */
function optFromWebTemplate(webTemplate: ReturnType<typeof parseWebTemplate>): AmObject {
  const opt = webTemplateToOpt(webTemplate) as AmObject;
  const tree = (webTemplate as { tree?: { children?: Array<{ id?: string; rmType?: string; min?: number; max?: number }> } })
    .tree;
  const context = tree?.children?.find((child) => child.rmType === "EVENT_CONTEXT");
  const root = opt.definition as AmObject | undefined;
  if (!context || !root) return opt;
  const attributes = ((root.attributes ?? []) as AmObject[]);
  if (attributes.some((attr) => attr.rm_attribute_name === "context")) return opt;
  const lower = context.min ?? 0;
  attributes.push({
    rm_attribute_name: "context",
    existence: { lower, upper: 1, lower_included: true, upper_included: true },
    children: [{
      rm_type_name: "EVENT_CONTEXT",
      node_id: "",
      occurrences: { lower, upper: 1, lower_included: true, upper_included: true },
      attributes: [],
    }],
  } as AmObject);
  root.attributes = attributes;
  return opt;
}

/** Convert a Web Template JSON document to the same OPERATIONAL_TEMPLATE walker. */
export function generateSkeletonFromWebTemplate(
  source: string | unknown,
  options?: GenerateSkeletonOptions,
): GenerateSkeletonResult {
  const webTemplate = parseWebTemplate(source);
  const opt = optFromWebTemplate(webTemplate);
  const preferred = options?.language;
  const languages = availableWebTemplateLanguages(webTemplate);
  const language = preferred && languages.includes(preferred)
    ? preferred
    : (webTemplate.defaultLanguage || languages[0] || "en");
  const generated = generateSkeletonFromOperational(
    opt,
    buildWebTemplateTermsIndex(webTemplate, language),
    { language, primaryLanguage: webTemplate.defaultLanguage || undefined },
  );
  const wtTree = (webTemplate as { tree?: unknown }).tree;
  applyWebTemplateLabels(wtTree, generated.skeleton, language);
  applyWebTemplateInputConstraints(wtTree, generated.skeleton);
  // A Web Template's `defaultLanguage` is the template's primary language (lang.1).
  const primary = webTemplate.defaultLanguage;
  if (primary && primary !== language && languages.includes(primary)) {
    const primaryGenerated = generateSkeletonFromOperational(
      optFromWebTemplate(webTemplate),
      buildWebTemplateTermsIndex(webTemplate, primary),
      {
        language: primary,
        primaryLanguage: primary,
      },
    );
    applyWebTemplateLabels(wtTree, primaryGenerated.skeleton, primary);
    withPrimaryNames(generated.skeleton, primaryGenerated.skeleton);
  }
  return {
    ...generated,
    templateId: generated.templateId !== "unknown"
      ? generated.templateId
      : webTemplate.templateId,
    language,
    languages: languages.length ? languages : [language],
    webTemplateJson: typeof source === "string" ? source : JSON.stringify(source),
  };
}

/**
 * Web Template with every OPT language, `language` first (#279): labels in
 * `language`, `localizedNames` / `localizedDescriptions` for the rest. Ids
 * (Simplified FLAT paths) from the primary language (lang.1; for OPT 1.4 the
 * top-level `<language>`, which ehrtslib calls `original_language`), whatever
 * 💬 shows. The Ids dropdown on the COMPOSITION root picks another (#289,
 * `core/target/id_language.ts`).
 */
function webTemplateJsonFromOperational(opt: AmObject, language: string, languages: string[]): string | undefined {
  try {
    return JSON.stringify(buildWebTemplate(opt, {
      languages: [language, ...languages.filter((l) => l !== language)],
      idLanguage: "original",
    }));
  } catch {
    return undefined;
  }
}

/**
 * Set `primaryName` on each node of `skeleton` (labels in a display language)
 * from the same node in `primary` (labels in the primary language), so output
 * names do not follow the display language.
 */
function withPrimaryNames(skeleton: SkeletonNode[], primary: SkeletonNode[]): void {
  const names = new Map<string, string>();
  const collect = (nodes: SkeletonNode[]) => {
    for (const n of nodes) {
      if (n.label) names.set(n.slotId, n.label);
      collect(n.children);
    }
  };
  collect(primary);
  const apply = (nodes: SkeletonNode[]) => {
    for (const n of nodes) {
      const name = names.get(n.slotId);
      if (name && name !== n.label) n.primaryName = name;
      apply(n.children);
    }
  };
  apply(skeleton);
}

/** Walk an already-resolved OPERATIONAL_TEMPLATE (OPT XML, flattened .t.json, …). */
export function generateSkeletonFromOperational(
  opt: AmObject,
  extraArchetypeTerms?: Map<string, TermBag>,
  options?: GenerateSkeletonOptions,
): GenerateSkeletonResult {
  if (!opt?.definition) {
    throw new Error("Could not parse operational template from input");
  }

  const templateId = readTemplateId(opt) ?? opt.archetype_id?.value ?? "unknown";
  const languages = availableOptLanguages(opt);
  const preferred = options?.language;
  const lang = preferred && (languages.length === 0 || languages.includes(preferred))
    ? resolveOptLanguage(opt, preferred)
    : resolveOptLanguage(opt);
  const labelResolver = createTemplateLabelResolver(opt, {
    language: lang,
    languages: languages.length ? languages : [lang],
  });
  applyOperationalTemplateTermScopes(opt, lang);
  const names: NameLabels = { primary: lang === (options?.primaryLanguage ?? resolveOptLanguage(opt)) };
  const fallbackTerms = mergedOntologyTerms(opt, lang);
  const archetypeTerms = mergeTermMaps(liveArchetypeTermsIndex(opt, lang), extraArchetypeTerms);
  const archetypeTermRecord = termBagsRecord(archetypeTerms);
  const optArchId = typeof opt.archetype_id?.value === "string"
    ? opt.archetype_id.value
    : typeof opt.archetype_id?._value?.value === "string"
    ? opt.archetype_id._value.value
    : undefined;
  const rootArchetypeRef = (opt.definition?.archetype_ref as string | undefined) ??
    (extraArchetypeTerms?.has(TEMPLATE_ROOT_TERM_SCOPE) ? TEMPLATE_ROOT_TERM_SCOPE : undefined) ??
    (archetypeTerms.has(templateId) ? templateId : undefined) ??
    (optArchId && archetypeTerms.has(optArchId) ? optArchId : undefined) ??
    (archetypeTerms.size === 1 ? [...archetypeTerms.keys()][0] : undefined);

  const root = walkComplex(
    opt.definition,
    templateId,
    rootArchetypeRef,
    "",
    fallbackTerms,
    archetypeTermRecord,
    names,
    {
      resolver: labelResolver,
      aqlPath: "",
      ancestorNames: [],
      useResolverPrimary: !options?.primaryLanguage ||
        options.primaryLanguage === labelResolver.originalLanguage,
    },
  );

  return {
    templateId,
    skeleton: root ? [root] : [],
    warnings: [],
    language: lang,
    languages: languages.length ? languages : [lang],
  };
}

interface LabelWalkCtx {
  resolver: TemplateLabelResolver;
  aqlPath: string;
  ancestorNames: ReadonlyArray<readonly string[] | undefined>;
  useResolverPrimary: boolean;
}

function walkComplex(
  cObj: AmObject,
  templateId: string,
  archetypeRef: string | undefined,
  path: string,
  fallbackTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
  names: NameLabels,
  labelCtx: LabelWalkCtx,
): SkeletonNode | null {
  const rmType = cObj.rm_type_name ?? "ITEM_TREE";
  const { nodeId, nameHint } = splitAqlStyleNodeId(cObj.node_id as string | undefined);
  const slotPath = path || "/";
  const rawScope = termScopeOf(cObj as TermScopeMeta & { archetype_ref?: string }, archetypeRef);
  const nodeArchetypeRef = publicArchetypeRef(rawScope);
  const nameConstraint = nameConstraintOf(cObj);
  const nodeNames = namesForNode(cObj, nodeArchetypeRef, nameConstraint, names, archetypeTerms);
  const termScope = nodeNames.occurrence ?? rawScope ?? nodeArchetypeRef;
  const terms = termsForArchetype(termScope, fallbackTerms, archetypeTerms);
  const { label, candidateNames, alternateLabels } = resolveNodeDisplayLabel(
    cObj,
    nameHint,
    nodeId,
    rmType,
    nameConstraint,
    nodeNames,
    termScope ?? archetypeRef,
    fallbackTerms,
    archetypeTerms,
    templateId,
    labelCtx,
  );
  const blockType = blockTypeForRm(rmType);
  const archetypeCtx = nodeArchetypeRef
    ? { archetypeRef: nodeArchetypeRef, archetypeShortName: archetypeShortName(nodeArchetypeRef) }
    : {};
  const multiplicity = multiplicityOfAm(cObj);
  const mandatory = isMandatory(cObj);

  if (isDataValueType(rmType)) {
    return {
      slotId: `${templateId}${slotPath}/value`,
      blockType: blockTypeForRm(rmType),
      rmType,
      label,
      archetypeNodeId: nodeId,
      archetypeId: templateId,
      ...archetypeCtx,
      ...(nameConstraint ? { nameConstraint } : {}),
      ...(alternateLabels.length ? { alternateLabels } : {}),
      kind: "value",
      mandatory,
      multiplicity,
      children: [],
      ...valueConstraintFields(cObj, terms),
    };
  }

  const children: SkeletonNode[] = [];
  const presentAttrs = new Set<string>();
  const attributeConstraints: AttributeConstraint[] = [];
  const childAncestorNames = labelCtx.aqlPath
    ? [...labelCtx.ancestorNames, candidateNames.length ? candidateNames : undefined]
    : labelCtx.ancestorNames;

  for (const attr of (cObj.attributes ?? []) as AmObject[]) {
    const attrName = attr.rm_attribute_name as string | undefined;
    if (!attrName) continue;
    presentAttrs.add(attrName);
    const rmInterval = rmAttributeInterval(rmType, attrName);
    const effective = intervalFromAmAttribute(attr);
    const constraint = attributeConstraintOf(attrName, rmInterval, effective);
    if (constraint) attributeConstraints.push(constraint);
    if (constraint?.prohibited) continue;

    const slotCard = multiplicityOfAttribute(attr);
    const attrMandatory = (effective?.min ?? 0) >= 1;
    const rmSingleMandatory = (rmInterval?.min ?? 0) >= 1 && rmInterval?.max === 1;
    const childNodes = walkAttribute(
      attr,
      templateId,
      rawScope ?? archetypeRef,
      `${slotPath}/${attrName}`,
      fallbackTerms,
      archetypeTerms,
      nodeNames,
      {
        resolver: labelCtx.resolver,
        aqlPath: labelCtx.aqlPath,
        ancestorNames: childAncestorNames,
        useResolverPrimary: labelCtx.useResolverPrimary,
      },
    );
    for (const child of childNodes) {
      child.rmAttribute = attrName;
      child.slotCardinality = slotCard ?? child.multiplicity;
      if (constraint) {
        child.rmCardinality = constraint.rmCardinality;
        child.effectiveCardinality = constraint.effectiveCardinality;
      }
      if (attrMandatory || rmSingleMandatory) child.mandatory = true;
      applyRmConstrainedFields(child, rmType);
      children.push(child);
    }
  }

  for (const attrName of mandatoryAttributesFor(rmType)) {
    if (presentAttrs.has(attrName)) continue;
    const silent = buildSilentMandatoryNode(
      rmType,
      attrName,
      templateId,
      nodeArchetypeRef,
      `${slotPath}/${attrName}`,
      terms,
    );
    if (silent) {
      silent.rmAttribute = attrName;
      silent.slotCardinality = silent.slotCardinality ?? silent.multiplicity;
      const silentRm = rmAttributeInterval(rmType, attrName);
      if (silentRm) {
        const compact = formatCardinalityCompact(silentRm);
        silent.rmCardinality = silent.rmCardinality ?? compact;
        silent.effectiveCardinality = silent.effectiveCardinality ??
          silent.slotCardinality ?? compact;
      }
      children.push(silent);
    }
  }

  if (rmType === "ELEMENT") {
    if (!children.some((child) => child.rmAttribute === "value")) {
      const valueNode = buildNodeForRmType(
        "DV_TEXT",
        templateId,
        nodeArchetypeRef,
        `${slotPath}/value`,
        label,
        terms,
      );
      valueNode.rmAttribute = "value";
      // ELEMENT.value is RM 0..1; only auto-attach as mandatory when the ELEMENT is.
      valueNode.mandatory = mandatory;
      children.push(valueNode);
    }
    for (const child of children) {
      if (child.kind === "value" && isDataValueType(child.rmType)) {
        if (!child.label || child.label === child.rmType) child.label = label;
        if (!child.archetypeNodeId) child.archetypeNodeId = nodeId;
      }
    }
  }

  return {
    slotId: `${templateId}${slotPath}`,
    blockType,
    rmType,
    label,
    archetypeNodeId: nodeId,
    archetypeId: templateId,
    ...archetypeCtx,
    ...(nameConstraint ? { nameConstraint } : {}),
    ...(alternateLabels.length ? { alternateLabels } : {}),
    kind: "container",
    mandatory,
    multiplicity,
    children,
    attachmentPoint: slotPath,
    ...(attributeConstraints.length ? { attributeConstraints } : {}),
  };
}

function walkAttribute(
  attr: AmObject,
  templateId: string,
  archetypeRef: string | undefined,
  path: string,
  fallbackTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
  names: NameLabels,
  labelCtx: LabelWalkCtx,
): SkeletonNode[] {
  const attrName = (attr.rm_attribute_name as string | undefined) ?? "";
  const children = (attr.children ?? []) as AmObject[];
  const nodes: SkeletonNode[] = [];
  const visibleChildren = children.filter((child) => !isProhibitedAmObject(child));

  for (const child of visibleChildren) {
    const rawChildScope = termScopeOf(child as TermScopeMeta & { archetype_ref?: string }, archetypeRef);
    const childArchetypeRef = publicArchetypeRef(rawChildScope) ?? publicArchetypeRef(archetypeRef);
    const rmType = child.rm_type_name ?? "DV_TEXT";
    const { nodeId, nameHint } = splitAqlStyleNodeId(child.node_id as string | undefined);
    const childPath = locatorChildPath(path, child, visibleChildren);
    const childAqlPath = attrName
      ? aqlChildPath(labelCtx.aqlPath, attrName, child, visibleChildren)
      : labelCtx.aqlPath;
    const childLabelCtx: LabelWalkCtx = {
      ...labelCtx,
      aqlPath: childAqlPath,
    };
    const nameConstraint = nameConstraintOf(child);
    const isDv = isDataValueType(rmType);
    if (!isDv || child.attributes) {
      const node = walkComplex(
        child,
        templateId,
        rawChildScope ?? archetypeRef,
        childPath,
        fallbackTerms,
        archetypeTerms,
        names,
        childLabelCtx,
      );
      if (node) nodes.push(node);
    } else {
      const archetypeCtx = childArchetypeRef
        ? {
          archetypeRef: childArchetypeRef,
          archetypeShortName: archetypeShortName(childArchetypeRef),
        }
        : {};
      const leafNames = namesForNode(child, childArchetypeRef, nameConstraint, names, archetypeTerms);
      const termScope = leafNames.occurrence ?? rawChildScope ?? childArchetypeRef;
      const terms = termsForArchetype(termScope, fallbackTerms, archetypeTerms);
      const { label } = resolveNodeDisplayLabel(
        child,
        nameHint,
        nodeId,
        rmType,
        nameConstraint,
        leafNames,
        termScope,
        fallbackTerms,
        archetypeTerms,
        templateId,
        childLabelCtx,
      );
      nodes.push({
        // Keep unique-OPT DV leaves on `…/value/value/value` (the attribute is
        // already in `path`). locatorChildPath is for siblings with a node id.
        slotId: `${templateId}${path}/${nodeId ?? "value"}/value`,
        blockType: blockTypeForRm(rmType),
        rmType,
        label,
        archetypeNodeId: nodeId,
        archetypeId: templateId,
        rmAttribute: attr.rm_attribute_name as string | undefined,
        ...archetypeCtx,
        ...(nameConstraint ? { nameConstraint } : {}),
        kind: "value",
        mandatory: isMandatory(child),
        multiplicity: multiplicityOfAm(child),
        children: [],
        ...valueConstraintFields(child, terms),
      });
    }
  }

  return nodes;
}

function buildSilentMandatoryNode(
  parentRmType: string,
  attrName: string,
  templateId: string,
  archetypeRef: string | undefined,
  path: string,
  terms: TermBag,
): SkeletonNode | null {
  const attrRmType = silentMandatoryRmType(parentRmType, attrName);
  if (!attrRmType) return null;
  const node = buildNodeForRmType(
    attrRmType,
    templateId,
    archetypeRef,
    path,
    lookupTermText(terms, attrName) ?? attrName,
    terms,
  );
  node.rmAttribute = attrName;
  node.mandatory = true;
  node.silentMandatory = true;
  node.slotCardinality = node.slotCardinality ?? node.multiplicity;
  applyRmConstrainedFields(node, parentRmType);
  return node;
}

/**
 * Skeleton node for Optional RM Insertion — same typed containers / DV shells
 * as silent-mandatory, but not marked mandatory.
 */
export function skeletonNodeForOptionalRm(
  parent: Pick<SkeletonNode, "slotId" | "archetypeId" | "archetypeRef" | "attachmentPoint">,
  rmType: string,
  attributeName: string,
): SkeletonNode {
  const templateId = parent.archetypeId ?? parent.slotId.split("/")[0] ?? "template";
  const parentPath = parent.attachmentPoint ||
    (parent.slotId.startsWith(templateId) ? parent.slotId.slice(templateId.length) : "");
  const path = `${parentPath.replace(/\/$/, "")}/${attributeName}`;
  const node = buildNodeForRmType(
    rmType,
    templateId,
    parent.archetypeRef,
    path,
    attributeName,
    {},
  );
  node.rmAttribute = attributeName;
  node.mandatory = false;
  node.silentMandatory = false;
  // An abstract slot (uid → UID_BASED_ID, protocol → ITEM_STRUCTURE) stays an
  // empty mouth. Concrete scaffolds keep their mandatory children, except
  // nested abstract classes (HISTORY.events → EVENT) which the author chooses.
  if (isAbstractType(baseRmTypeName(rmType))) {
    node.children = [];
  } else {
    stripAbstractOptionalChildren(node);
  }
  return node;
}

function stripAbstractOptionalChildren(node: SkeletonNode): void {
  node.children = node.children
    .filter((child) => !isAbstractType(baseRmTypeName(child.rmType)))
    .map((child) => {
      stripAbstractOptionalChildren(child);
      return child;
    });
}

/** PARTY_IDENTIFIED / PARTY_RELATED are mappable identity sockets (name + identifiers). */
export function isPartyIdentityRmType(rmType: string): boolean {
  return rmType === "PARTY_IDENTIFIED" || rmType === "PARTY_RELATED";
}

/**
 * Clone `skeleton` and attach Optional RM Insertion children so list_slots / Test Run
 * see the same mouths the canvas gained via `optional_rm_add`.
 */
export function applyOptionalRmToSkeleton(
  skeleton: SkeletonNode[],
  insertions: readonly OptionalRmInsertion[],
): SkeletonNode[] {
  if (!insertions.length) return skeleton;
  const roots = structuredClone(skeleton);
  for (const extra of insertions) {
    const parent = optionalRmAttachmentParent(roots, extra.attachmentSlotId);
    if (!parent || parent.kind !== "container") continue;
    if (parent.children.some((child) => child.rmAttribute === extra.attributeName)) continue;
    parent.children.push(skeletonNodeForOptionalRm(parent, extra.rmType, extra.attributeName));
  }
  return roots;
}

/**
 * Element blocks store the value slot id. Optional RM on that id belongs on
 * the ELEMENT container (null_flavour, null_reason), not the DV leaf.
 */
function optionalRmAttachmentParent(
  roots: SkeletonNode[],
  slotId: string,
): SkeletonNode | undefined {
  const trail = findSkeletonTrail(roots, slotId);
  const node = trail.at(-1);
  if (!node) return undefined;
  if (node.kind === "container") return node;
  for (let i = trail.length - 2; i >= 0; i--) {
    const candidate = trail[i]!;
    if (candidate.kind === "container" && candidate.rmType === "ELEMENT") return candidate;
  }
  return undefined;
}

function buildNodeForRmType(
  rmType: string,
  templateId: string,
  archetypeRef: string | undefined,
  path: string,
  label: string,
  terms: TermBag,
): SkeletonNode {
  const archetypeCtx = archetypeRef
    ? { archetypeRef, archetypeShortName: archetypeShortName(archetypeRef) }
    : {};

  if (isDataValueType(rmType) || rmType.startsWith("DV_")) {
    return {
      slotId: `${templateId}${path}/value`,
      blockType: blockTypeForRm(rmType),
      rmType,
      label,
      archetypeId: templateId,
      ...archetypeCtx,
      kind: "value",
      mandatory: false,
      children: [],
    };
  }

  const childSlots: SkeletonNode[] = [];
  for (const nested of mandatoryAttributesFor(rmType)) {
    const nestedNode = buildSilentMandatoryNode(
      rmType,
      nested,
      templateId,
      archetypeRef,
      `${path}/${nested}`,
      terms,
    );
    if (nestedNode) childSlots.push(nestedNode);
  }

  return {
    slotId: `${templateId}${path}`,
    blockType: blockTypeForRm(rmType),
    rmType,
    label,
    archetypeId: templateId,
    ...archetypeCtx,
    kind: "container",
    mandatory: false,
    children: childSlots,
    attachmentPoint: path,
  };
}

function termsForArchetype(
  archetypeRef: string | undefined,
  fallbackTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
): TermBag {
  if (archetypeRef && archetypeTerms[archetypeRef]) {
    return archetypeTerms[archetypeRef]!;
  }
  return fallbackTerms;
}

function silentMandatoryRmType(parentType: string, attrName: string): string | null {
  const map: Record<string, Record<string, string>> = {
    COMPOSITION: {
      language: "CODE_PHRASE",
      territory: "CODE_PHRASE",
      category: "DV_CODED_TEXT",
      composer: "PARTY_IDENTIFIED",
      context: "EVENT_CONTEXT",
    },
    EVENT_CONTEXT: {
      start_time: "DV_DATE_TIME",
      setting: "DV_CODED_TEXT",
    },
    ENTRY: {
      language: "CODE_PHRASE",
      encoding: "CODE_PHRASE",
      subject: "PARTY_PROXY",
    },
    OBSERVATION: { data: "HISTORY" },
    EVALUATION: { data: "ITEM_TREE" },
    ADMIN_ENTRY: { data: "ITEM_TREE" },
    INSTRUCTION: { narrative: "DV_TEXT" },
    ACTION: {
      time: "DV_DATE_TIME",
      ism_transition: "ISM_TRANSITION",
      description: "ITEM_TREE",
    },
    HISTORY: { origin: "DV_DATE_TIME", events: "EVENT" },
    EVENT: { time: "DV_DATE_TIME", data: "ITEM_TREE" },
    CLUSTER: { items: "ELEMENT" },
    LOCATABLE: {
      archetype_node_id: "DV_TEXT",
      name: "DV_TEXT",
    },
  };

  if (map[parentType]?.[attrName]) return map[parentType][attrName];
  for (const [type, attrs] of Object.entries(map)) {
    if (type === parentType) continue;
    if (isSubtypeOf(parentType, type) && attrs[attrName]) return attrs[attrName];
  }

  if (LOCATABLE_TYPES.has(parentType) && (attrName === "archetype_node_id" || attrName === "name")) {
    return "DV_TEXT";
  }

  return null;
}

function isMandatory(cObj: AmObject): boolean {
  const occ = intervalFromAmBound(cObj.occurrences ?? cObj.existence);
  return (occ?.min ?? 0) > 0;
}

function isProhibitedAmObject(cObj: AmObject): boolean {
  const occ = intervalFromAmBound(cObj.occurrences ?? cObj.existence);
  return Boolean(occ && isProhibitedInterval(occ));
}

const AQL_NAME_PRED = /^(.*),'([^']+)'$/;

/** Split Better/AQL-style node ids such as `at0002,'Injury'` or `openEHR-EHR-SECTION.adhoc.v1,'Vital signs'`. */
export function splitAqlStyleNodeId(nodeId?: string): { nodeId?: string; nameHint?: string } {
  if (!nodeId) return {};
  const match = AQL_NAME_PRED.exec(nodeId);
  if (match) return { nodeId: match[1], nameHint: match[2] };
  return { nodeId };
}

function cObjAqlNodeId(cObj: AmObject): string | undefined {
  const archRef = typeof cObj.archetype_ref === "string" && cObj.archetype_ref
    ? cObj.archetype_ref
    : undefined;
  if (archRef) return archRef;
  const nid = splitAqlStyleNodeId(cObj.node_id as string | undefined).nodeId;
  return nid || undefined;
}

function aqlChildPath(
  parentAqlPath: string,
  attrName: string,
  child: AmObject,
  siblings: AmObject[],
): string {
  const nid = cObjAqlNodeId(child);
  if (!nid) return `${parentAqlPath}/${attrName}`;
  const fixed = nameConstraintOf(child);
  if (fixed) {
    const same = siblings.filter((s) => cObjAqlNodeId(s) === nid).length;
    if (same > 1) {
      return `${parentAqlPath}/${attrName}[${nid} and name/value='${fixed}']`;
    }
  }
  return `${parentAqlPath}/${attrName}[${nid}]`;
}

function isResolvedClinicalLabel(
  label: string | undefined,
  nodeId: string | undefined,
  rmType: string,
  templateId: string,
): label is string {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return false;
  if (trimmed === nodeId || trimmed === rmType || trimmed === templateId) return false;
  if (isGenericRmTypeLabel(trimmed, rmType)) return false;
  return true;
}

/**
 * Resolve a node's display label via ehrtslib's unified `TemplateLabelResolver`
 * (`L10n.{lang}` path annotations → `fixedNameConstraint` in `original_language`
 * → occurrence/archetype/overlay/WT scopes → ontology terms), falling back to
 * caller-supplied extra term bags / AQL name hints / overlay concept fallbacks.
 */
function resolveNodeDisplayLabel(
  cObj: AmObject,
  nameHint: string | undefined,
  nodeId: string | undefined,
  rmType: string,
  nameConstraint: string | undefined,
  nodeNames: NameLabels,
  termScope: string | undefined,
  fallbackTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
  templateId: string,
  labelCtx: LabelWalkCtx,
): { label: string; candidateNames: string[]; alternateLabels: string[] } {
  const resolved = labelCtx.resolver.resolveNode(
    cObj,
    labelCtx.aqlPath || undefined,
    {
      ancestorNames: labelCtx.ancestorNames.length ? [...labelCtx.ancestorNames] : undefined,
      candidateNames: nameHint ? [nameHint] : undefined,
    },
  );
  const baseLangTerm = labelCtx.resolver.resolveNodeTermInLanguage(
    cObj,
    labelCtx.resolver.primaryLanguage,
  ).text?.trim();
  const baseOrigTerm = labelCtx.resolver.resolveNodeTermInLanguage(
    cObj,
    labelCtx.resolver.originalLanguage,
  ).text?.trim();
  const isWtScope = Boolean(termScope?.startsWith("wt:"));
  const baseEnTerm = labelCtx.resolver.primaryLanguage === "en"
    ? baseLangTerm
    : labelCtx.resolver.originalLanguage === "en"
    ? baseOrigTerm
    : labelCtx.resolver.resolveNodeTermInLanguage(cObj, "en").text?.trim();
  // Guard against ehrtslib#338: when an isolated wt:* scope lacks a term
  // (e.g. elided ITEM_TREE/HISTORY in Web Templates), ehrtslib's fallback language
  // loop can escape into the flat root ontology in an unrelated language (e.g. zh).
  const hasRelevantLangTerm = !isWtScope || Boolean(
    baseLangTerm ||
      baseOrigTerm ||
      baseEnTerm ||
      resolved.localizedNames?.[labelCtx.resolver.primaryLanguage] ||
      resolved.localizedNames?.[labelCtx.resolver.originalLanguage] ||
      resolved.localizedNames?.["en"],
  );
  const trustedResolverPrimary = hasRelevantLangTerm
    ? resolved.primaryName?.trim()
    : undefined;
  const candidateNames = [
    nameConstraint,
    nameHint,
    trustedResolverPrimary,
    baseLangTerm,
    ...(hasRelevantLangTerm ? Object.values(resolved.localizedNames ?? {}) : []),
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  let label: string;
  if (
    labelCtx.useResolverPrimary &&
    isResolvedClinicalLabel(trustedResolverPrimary, nodeId, rmType, templateId)
  ) {
    label = trustedResolverPrimary!;
  } else {
    const fallback = nameLabel(nameConstraint, nodeNames) ?? resolvedNodeLabel(
      nameHint,
      nodeId,
      rmType,
      termScope,
      nameFallbackOf(cObj as TermScopeMeta & { node_id?: string; archetype_ref?: string }),
      fallbackTerms,
      archetypeTerms,
      templateId,
    );
    label = isResolvedClinicalLabel(fallback, nodeId, rmType, templateId)
      ? fallback
      : (trustedResolverPrimary || fallback);
  }
  if (isWtScope && !hasRelevantLangTerm && (!label || label === nodeId || /^at\d|^id\d/i.test(label))) {
    const rmFallback: Record<string, string> = {
      ITEM_TREE: "Item tree",
      HISTORY: "History",
      ITEM_LIST: "Item list",
      ITEM_SINGLE: "Item single",
      ITEM_TABLE: "Item table",
    };
    if (rmFallback[rmType]) label = rmFallback[rmType];
  }

  const labelLower = label.trim().toLowerCase();
  const altSet = new Set<string>();
  for (
    const raw of [
      baseLangTerm,
      baseOrigTerm,
      ...Object.values(resolved.localizedNames ?? {}),
    ]
  ) {
    const t = raw?.trim();
    if (!t) continue;
    if (t.toLowerCase() === labelLower) continue;
    if (nameConstraint && t.toLowerCase() === nameConstraint.trim().toLowerCase()) continue;
    altSet.add(t);
  }
  return { label, candidateNames, alternateLabels: [...altSet] };
}

/**
 * Fallback ontology / extra-terms lookup when `TemplateLabelResolver` does not
 * yield a clinical label (e.g. AQL name predicates baked into `node_id`,
 * caller-supplied extra term maps, or Better `ovl-*` overlays without a parent
 * term bag in the template).
 */
function resolvedNodeLabel(
  nameHint: string | undefined,
  nodeId: string | undefined,
  rmType: string,
  scope: string | undefined,
  nameFallback: string | undefined,
  templateTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
  templateId?: string,
): string {
  const fromTerms = locatableNodeLabel(
    nodeId,
    rmType,
    scope,
    nameFallback,
    isOverlayArchetypeRef(scope) ? {} : templateTerms,
    archetypeTerms,
  );
  if (
    fromTerms &&
    fromTerms !== nodeId &&
    fromTerms !== rmType &&
    fromTerms !== templateId
  ) return fromTerms;
  if (isOverlayArchetypeRef(scope)) {
    const overlayRoot = !nodeId || nodeId === "at0000" || nameFallback === "at0000" ||
      /^at0\.\d/i.test(nodeId);
    if (overlayRoot) {
      return nameHint || overlayConceptFallback(scope) || fromTerms;
    }
  }
  return nameHint || fromTerms;
}

/** Archetype id without a name predicate: `openEHR-EHR-SECTION.adhoc.v1,'X'` → the id. */
function bareArchetypeRef(ref: string | undefined): string | undefined {
  return ref?.replace(/\s*,\s*'(?:[^']|'')*'\s*$/, "");
}

/**
 * Name labelling for one node. A renamed archetype root (own `archetype_ref`
 * and a name constraint) opens its Web Template occurrence scope when there is
 * one; nodes inside the same archetype keep it, other archetypes drop it.
 */
function namesForNode(
  cObj: AmObject,
  termScope: string | undefined,
  nameConstraint: string | undefined,
  names: NameLabels,
  archetypeTerms: Record<string, TermBag>,
): NameLabels {
  const ownRef = bareArchetypeRef(ownArchetypeRefOf(cObj));
  if (ownRef && nameConstraint) {
    const occurrence = `${ownRef},'${nameConstraint}'`;
    return { primary: names.primary, ...(archetypeTerms[occurrence] ? { occurrence } : {}) };
  }
  const inherited = names.occurrence;
  if (inherited && bareArchetypeRef(inherited) === bareArchetypeRef(termScope)) return names;
  return { primary: names.primary };
}

/** A name constraint is the label in the primary language (as EHRbase and ehrtslib Web Templates). */
function nameLabel(nameConstraint: string | undefined, names: NameLabels): string | undefined {
  return names.primary ? nameConstraint?.trim() || undefined : undefined;
}

function pathNodeSegment(nodeId: string | undefined, rmType: string): string {
  return nodeId || rmType;
}

/**
 * Sibling C_ARCHETYPE_ROOT nodes often share `at0000`. Unique children keep
 * `attr/atNNNN` (no predicate). Colliding siblings use BASE locator brackets:
 * `[openEHR-EHR-ACTION.medication.v1]` at chaining points, then
 * `[at0003, 'Organisationsnummer']` when the node id is reused.
 *
 * @see https://specifications.openehr.org/releases/BASE/development/architecture_overview.html#_paths_and_locators
 */
function locatorChildPath(attrPath: string, child: AmObject, siblings: AmObject[]): string {
  const { nodeId } = splitAqlStyleNodeId(child.node_id as string | undefined);
  const rmType = (child.rm_type_name as string | undefined) ?? "ITEM_TREE";
  const base = pathNodeSegment(nodeId, rmType);
  const same = siblings.filter((sibling) => {
    const id = splitAqlStyleNodeId(sibling.node_id as string | undefined).nodeId ??
      sibling.rm_type_name;
    return id === base;
  });
  if (same.length <= 1) return `${attrPath}/${base}`;

  const ownRef = ownArchetypeRefOf(child);
  const name = nameConstraintOf(child);
  const sameRef = ownRef
    ? same.filter((sibling) => ownArchetypeRefOf(sibling) === ownRef)
    : same;
  if (ownRef && sameRef.length === 1) {
    return `${attrPath}[${ownRef}]`;
  }

  const predHead = ownRef ?? base;
  if (name) {
    const sameName = same.filter((sibling) => nameConstraintOf(sibling) === name);
    if (sameName.length === 1) {
      return `${attrPath}[${predHead}, '${name.replace(/'/g, "''")}']`;
    }
  }

  const index = same.indexOf(child) + 1;
  return `${attrPath}[${predHead}][${index}]`;
}

/** Own chaining-point archetype id — not an inherited term-scope parent CLUSTER. */
function ownArchetypeRefOf(child: AmObject): string | undefined {
  const ref = child.archetype_ref as string | undefined;
  return typeof ref === "string" && ref ? publicArchetypeRef(ref) : undefined;
}

function nameConstraintOf(cObj: AmObject): string | undefined {
  return splitAqlStyleNodeId(cObj.node_id as string | undefined).nameHint ??
    (fixedNameConstraint(cObj) || undefined);
}

export function multiplicityOfAm(cObj: AmObject): string | undefined {
  const interval = intervalFromAmBound(cObj?.occurrences ?? cObj?.existence);
  return interval ? formatCardinalityCompact(interval) : undefined;
}

function multiplicityOfAttribute(attr: AmObject): string | undefined {
  const interval = intervalFromAmAttribute(attr);
  return interval ? formatCardinalityCompact(interval) : undefined;
}

function attributeConstraintOf(
  name: string,
  rm: CardinalityInterval | undefined,
  effective: CardinalityInterval | undefined,
): AttributeConstraint | undefined {
  if (!rm && !effective) return undefined;
  const rmCard = rm ?? effective!;
  const effCard = effective ?? rm!;
  return {
    name,
    rmCardinality: formatCardinalityCompact(rmCard),
    effectiveCardinality: formatCardinalityCompact(effCard),
    ...(isProhibitedInterval(effCard) ? { prohibited: true } : {}),
  };
}

export function isRepeatingMultiplicity(multiplicity?: string): boolean {
  return Boolean(multiplicity && multiplicity.includes("*"));
}

export function collectRepeatableContainers(nodes: SkeletonNode[]): SkeletonNode[] {
  const out: SkeletonNode[] = [];
  for (const node of nodes) {
    if (node.kind === "container" && isRepeatingMultiplicity(node.multiplicity)) {
      out.push(node);
    }
    out.push(...collectRepeatableContainers(node.children));
  }
  return out;
}

export function collectAllSlotIds(nodes: SkeletonNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(node.slotId);
    out.push(...collectAllSlotIds(node.children));
  }
  return out;
}

export function findSkeletonTrail(nodes: SkeletonNode[], slotId: string): SkeletonNode[] {
  const hits: SkeletonNode[][] = [];
  function walk(node: SkeletonNode, trail: SkeletonNode[]): void {
    const next = [...trail, node];
    if (node.slotId === slotId) hits.push(next);
    for (const child of node.children) walk(child, next);
  }
  for (const root of nodes) walk(root, []);
  const repeating = hits.find((trail) => {
    const node = trail.at(-1);
    return Boolean(node && node.kind === "container" && isRepeatingMultiplicity(node.multiplicity));
  });
  return repeating ?? hits[0] ?? [];
}

/** Inspect / prompt path: name constraint, then term label, skipping raw RM type names. */
export function pathLabelFromTrail(trail: SkeletonNode[]): string | undefined {
  const parts: string[] = [];
  for (const node of trail) {
    const part = pathLabelPart(node);
    if (!part) continue;
    if (parts[parts.length - 1] === part) continue;
    parts.push(part);
  }
  return parts.length ? parts.join(" › ") : undefined;
}

function pathLabelPart(node: SkeletonNode): string | undefined {
  if (node.kind === "value" && node.rmAttribute === "name") return "name";
  const name = node.nameConstraint?.trim();
  if (name) return name;
  const label = node.label?.trim();
  if (!label || label === node.rmType) {
    return node.archetypeShortName ? `${node.rmType} (${node.archetypeShortName})` : undefined;
  }
  return label;
}

export function nearestRepeatingContainer(trail: SkeletonNode[]): SkeletonNode | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const node = trail[i]!;
    if (node.kind === "container" && isRepeatingMultiplicity(node.multiplicity)) return node;
  }
  return null;
}

/** COMPOSITION, SECTION, or ENTRY ancestor — distinguishes colliding `at0000` content. */
const CONTENT_ANCESTOR_RM = new Set([
  "COMPOSITION",
  "SECTION",
  "OBSERVATION",
  "EVALUATION",
  "INSTRUCTION",
  "ACTION",
  "ADMIN_ENTRY",
  "GENERIC_ENTRY",
]);

export function nearestContentAncestor(trail: SkeletonNode[]): SkeletonNode | null {
  for (let i = trail.length - 2; i >= 0; i--) {
    const node = trail[i]!;
    if (CONTENT_ANCESTOR_RM.has(node.rmType)) return node;
  }
  return null;
}

function applyRmConstrainedFields(node: SkeletonNode, parentRmType: string): void {
  if (!node.rmAttribute) return;
  node.fixedFields = withRmConstrainedFields(
    node.fixedFields,
    parentRmType,
    node.rmAttribute,
  );
}

type WebTemplateInputListItem = { value?: string; label?: string };
type WebTemplateInput = {
  suffix?: string;
  terminology?: string;
  defaultValue?: unknown;
  list?: WebTemplateInputListItem[];
};

/**
 * Normalize both Web Template `aqlPath` (`/content[at0.6]/items[at0.2]`) and
 * `SkeletonNode.attachmentPoint` (`/content/at0.6/items/at0.2` or
 * `/content/[at0003, 'Foo']`) into a single comparable path key.
 */
function canonicalizeWebTemplatePath(rawPath: string, stripNamePredicate = false): string {
  const trimmed = rawPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "/";
  let norm = "/" + trimmed
    // Convert `/attr/[...]` (Skeleton locator style) to `/attr[...]` before uniform parsing.
    .replace(/\/\[/g, "[")
    // Normalize EHRbase `and name/value='X'` predicates to AQL shorthand `,'X'`.
    .replace(/\s+and\s+name\/value\s*=\s*'/gi, ",'")
    // Normalize spaces around `,` inside predicates.
    .replace(/,\s*'/g, ",'");
  if (stripNamePredicate) {
    norm = stripNamePredicates(norm);
  }
  // Flatten simple `[nodeId]` brackets without name predicates to `/nodeId`.
  norm = norm.replace(/\[([^,\]]+)\]/g, "/$1");
  // Skeleton paths insert `/EVENT_CONTEXT` after `/context` when EVENT_CONTEXT has no node_id; AQL omits it.
  norm = norm.replace(/\/context\/EVENT_CONTEXT(?=\/|$)/, "/context");
  return norm.replace(/\/+/g, "/");
}

function webTemplateNodeDisplayName(
  rec: { name?: string; localizedName?: string; localizedNames?: Record<string, string> },
  language: string,
): string | undefined {
  const raw = rec.localizedNames?.[language] ??
    rec.localizedName ??
    rec.name ??
    Object.values(rec.localizedNames ?? {})[0];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || undefined;
}

/**
 * Apply exact per-path labels from a Web Template tree onto `roots`.
 *
 * OPT2-derived Web Templates often use bare `at`-codes (`at0.2`, `at0004.1`)
 * instead of `openEHR-...` archetype IDs on nested nodes, so flat term bags
 * suffer cross-archetype collisions (e.g. every `at0.2` overwritten by the last
 * one in DFS order). Matching by canonicalized AQL/slot path restores each
 * node's own clinical name from `webTemplate.tree`.
 */
function applyWebTemplateLabels(
  tree: unknown,
  roots: SkeletonNode[],
  language: string,
): void {
  if (!tree || typeof tree !== "object" || roots.length === 0) return;

  type WtEntry = { label: string; rmType?: string; prohibited: boolean };
  const exactMap = new Map<string, WtEntry>();
  const looseMap = new Map<string, WtEntry>();
  const looseCollisions = new Set<string>();

  const recordEntry = (
    map: Map<string, WtEntry>,
    key: string,
    entry: WtEntry,
    trackCollisions?: Set<string>,
  ) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, entry);
      return;
    }
    // Prefer active (non-prohibited) nodes over prohibited `max === 0` ones.
    if (prev.prohibited && !entry.prohibited) {
      map.set(key, entry);
      return;
    }
    if (!prev.prohibited && entry.prohibited) return;
    // Never overwrite a real clinical name with a generic RM-type placeholder (e.g. choice sub-nodes named "element").
    const prevGeneric = isGenericRmTypeLabel(prev.label, prev.rmType);
    const nextGeneric = isGenericRmTypeLabel(entry.label, entry.rmType);
    if (!prevGeneric && nextGeneric) return;
    if (prevGeneric && !nextGeneric) {
      map.set(key, entry);
      return;
    }
    if (trackCollisions && prev.label !== entry.label) {
      trackCollisions.add(key);
    }
  };

  const walkWt = (node: unknown, isRoot: boolean): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as {
      aqlPath?: string;
      rmType?: string;
      name?: string;
      localizedName?: string;
      localizedNames?: Record<string, string>;
      max?: number;
      children?: unknown[];
    };
    const prohibited = rec.max === 0;
    const label = webTemplateNodeDisplayName(rec, language);
    if (label && (isRoot || rec.aqlPath)) {
      const aql = isRoot ? (rec.aqlPath ?? "/") : (rec.aqlPath ?? "");
      const exactKey = canonicalizeWebTemplatePath(aql, false);
      const looseKey = canonicalizeWebTemplatePath(aql, true);
      const entry: WtEntry = { label, rmType: rec.rmType, prohibited };
      recordEntry(exactMap, exactKey, entry);
      recordEntry(looseMap, looseKey, entry, looseCollisions);
    }
    for (const child of rec.children ?? []) walkWt(child, false);
  };
  walkWt(tree, true);

  const walkSkeleton = (sk: SkeletonNode, isRoot: boolean): void => {
    const rawPath = isRoot
      ? "/"
      : (sk.attachmentPoint ||
        (sk.archetypeId && sk.slotId.startsWith(sk.archetypeId)
          ? sk.slotId.slice(sk.archetypeId.length)
          : ""));
    if (rawPath) {
      const exactKey = canonicalizeWebTemplatePath(rawPath, false);
      const looseKey = canonicalizeWebTemplatePath(rawPath, true);
      const hit = exactMap.get(exactKey) ??
        (!looseCollisions.has(looseKey) ? looseMap.get(looseKey) : undefined);
      if (hit && !hit.prohibited) {
        const hitIsGeneric = isGenericRmTypeLabel(hit.label, sk.rmType);
        const curIsUnresolved = isGenericRmTypeLabel(sk.label, sk.rmType) ||
          /^(?:at|id)\d+(?:\.\d+)*$/i.test((sk.label ?? "").trim());
        if (!hitIsGeneric || curIsUnresolved) {
          const prevLabel = sk.label;
          sk.label = hit.label;
          if (sk.rmType === "ELEMENT") {
            for (const child of sk.children) {
              if (
                child.kind === "value" &&
                (child.label === prevLabel || isGenericRmTypeLabel(child.label, child.rmType))
              ) {
                child.label = hit.label;
              }
            }
          }
        }
      } else if (!hit && sk.rmAttribute === "other_context") {
        // Web Templates flatten `context/other_context[at0001]` without a node entry,
        // so `at0001` otherwise collides with unrelated archetype terms (e.g. "Follow up").
        sk.label = "Other context";
      }
    }
    for (const child of sk.children) walkSkeleton(child, false);
  };

  for (const root of roots) walkSkeleton(root, true);
}

/**
 * Better/EHRbase Web Template `inputs[]` are dropped by `webTemplateToOpt`.
 * Copy suffix-aware constraints onto matching skeleton leaves:
 * - `code` → defining_code / allowedValues (COMPOSITION.category → 433)
 * - `unit`/`units` → DV_QUANTITY.units / allowedUnits (`mm[Hg]`)
 *
 * @see openehr://guides/templates/web-template
 * @see openehr://guides/simplified_formats/idioms-cheatsheet
 */
function applyWebTemplateInputConstraints(
  tree: unknown,
  roots: SkeletonNode[],
): void {
  const nodes = flattenSkeletonNodes(roots);
  const byType = new Map<string, SkeletonNode[]>();
  for (const node of nodes) {
    const list = byType.get(node.rmType);
    if (list) list.push(node);
    else byType.set(node.rmType, [node]);
  }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as {
      aqlPath?: string;
      id?: string;
      nodeId?: string;
      rmType?: string;
      inputs?: WebTemplateInput[];
      children?: unknown[];
    };
    const matches = skeletonNodesForWebTemplateNode(nodes, byType, rec);
    for (const input of rec.inputs ?? []) {
      const suffix = (input.suffix ?? "").toLowerCase();
      const items = (input.list ?? []).filter((item): item is WebTemplateInputListItem & { value: string } =>
        Boolean(item.value)
      );
      if (!items.length) continue;
      const values = items.map((item) => item.value);
      if (suffix === "unit" || suffix === "units") {
        applyWebTemplateUnits(matches, values);
        continue;
      }
      if (NON_CODE_INPUT_SUFFIXES.has(suffix)) continue;
      if (suffix === "code" || suffix === "defining_code" || suffix === "") {
        applyWebTemplateCodes(matches, items, input.terminology);
      }
    }
    for (const child of rec.children ?? []) walk(child);
  };
  walk(tree);
}

const NON_CODE_INPUT_SUFFIXES = new Set([
  "magnitude",
  "precision",
  "numerator",
  "denominator",
  "type",
  "value",
  "ordinal",
  "normal_status",
]);

function skeletonNodesForWebTemplateNode(
  nodes: SkeletonNode[],
  byType: ReadonlyMap<string, SkeletonNode[]>,
  rec: { aqlPath?: string; id?: string; nodeId?: string; rmType?: string },
): SkeletonNode[] {
  const nodeId = rec.nodeId;
  const rmType = rec.rmType;
  const attr = (rec.aqlPath ?? rec.id ?? "").split("/").filter(Boolean).pop();
  // Same matches as a full scan: a node id is only compared within its RM type.
  const typed = rmType ? byType.get(rmType) ?? [] : nodes;

  if (nodeId) {
    const byId = typed.filter((sk) => {
      if (rmType && sk.rmType !== rmType) return false;
      return sk.archetypeNodeId === nodeId ||
        sk.slotId.includes(`/${nodeId}/`) ||
        sk.slotId.includes(`[${nodeId}]`) ||
        sk.slotId.includes(`[${nodeId},`) ||
        sk.slotId.endsWith(`/${nodeId}`) ||
        sk.slotId.endsWith(`/${nodeId}/value`);
    });
    if (byId.length) return byId;
  }

  if (rmType && attr) {
    const byTypeAttr = typed.filter((sk) =>
      sk.rmAttribute === attr ||
      sk.slotId.endsWith(`/${attr}`) ||
      sk.slotId.endsWith(`/${attr}/value`)
    );
    if (byTypeAttr.length) return byTypeAttr;
  }

  if (!attr) return [];
  return nodes.filter((sk) =>
    sk.rmAttribute === attr ||
    sk.slotId.endsWith(`/${attr}`) ||
    sk.slotId.endsWith(`/${attr}/value`)
  );
}

function applyWebTemplateUnits(matches: SkeletonNode[], units: string[]): void {
  const unique = [...new Set(units.filter(Boolean))];
  if (!unique.length) return;
  for (const sk of matches) {
    if (sk.rmType !== "DV_QUANTITY") continue;
    if (unique.length === 1) {
      if (!sk.fixedFields?.units) {
        sk.fixedFields = { ...sk.fixedFields, units: unique[0]! };
      }
    } else if (!sk.allowedUnits?.length) {
      sk.allowedUnits = unique;
    }
  }
}

function applyWebTemplateCodes(
  matches: SkeletonNode[],
  items: Array<{ value: string; label?: string }>,
  terminology: string | undefined,
): void {
  const codes = items.map((item) => item.value);
  if (!codes.length) return;
  for (const sk of matches) {
    if (sk.rmType === "DV_QUANTITY") continue;
    if (codes.length === 1) {
      const code = codes[0]!;
      const label = items[0]?.label?.trim();
      if (!sk.fixedFields?.code_string) {
        sk.fixedFields = {
          ...sk.fixedFields,
          ...(terminology ? { terminology_id: terminology } : {}),
          ...(sk.rmType === "DV_CODED_TEXT" && label && !sk.fixedFields?.value ? { value: label } : {}),
          defining_code: code,
          code_string: code,
        };
      }
    } else if (!sk.allowedValues?.length) {
      sk.allowedValues = items.map((item) => ({
        code: item.value,
        label: item.label || item.value,
        terminologyId: terminology,
      }));
    }
  }
}

function flattenSkeletonNodes(nodes: SkeletonNode[]): SkeletonNode[] {
  return nodes.flatMap((node) => [node, ...flattenSkeletonNodes(node.children)]);
}

function valueConstraintFields(
  cObj: AmObject,
  terms: TermBag,
): Pick<SkeletonNode, "fixedFields" | "allowedValues" | "allowedUnits" | "allowedOrdinals"> {
  const rmType = String(cObj.rm_type_name ?? "");
  const allowedValues = extractAllowedValues(cObj, terms);
  const allowedUnits = extractAllowedUnits(cObj);
  const allowedOrdinals = isOrdinalRmType(rmType)
    ? extractAllowedOrdinals(cObj, terms)
    : [];
  const fixedFields = extractFixedFields(cObj, terms);
  return {
    ...(fixedFields ? { fixedFields } : {}),
    ...(allowedValues.length ? { allowedValues } : {}),
    ...(allowedUnits.length > 1 ? { allowedUnits } : {}),
    ...(allowedOrdinals.length > 1 ? { allowedOrdinals } : {}),
  };
}

function isOrdinalRmType(rmType: string): boolean {
  return rmType === "DV_ORDINAL" || rmType === "DV_SCALE";
}

function extractFixedFields(
  cObj: AmObject,
  terms: TermBag = {},
): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  const terminology = terminologyIdFromAm(cObj);
  if (terminology) fields.terminology_id = terminology;

  const codes = codeListFromAm(cObj);
  // A multi-value `code_list` is scaffolded as a Blockly list; only a single
  // constrained code (or assumed_value when the list is empty) is a fixed field.
  const specified = codes.length === 1 ? codes[0] : (codes.length === 0 ? assumedCodeFromAm(cObj) : undefined);
  if (specified) {
    fields.defining_code = specified;
    fields.code_string = specified;
  }

  const list = cObj.list as unknown[] | undefined;
  if (
    Array.isArray(list) &&
    list.length === 1 &&
    (typeof list[0] === "string" || typeof list[0] === "number")
  ) {
    fields.value = String(list[0]);
  }

  const units = extractAllowedUnits(cObj);
  if (units.length === 1) fields.units = units[0]!;

  const ordinals = extractAllowedOrdinals(cObj, terms);
  if (ordinals.length === 1) {
    const only = ordinals[0]!;
    fields.value = String(only.value);
    fields.defining_code = only.code;
    fields.code_string = only.code;
    if (only.label) fields.symbol_value = only.label;
    if (only.terminologyId) fields.terminology_id = only.terminologyId;
  }

  for (const attr of (cObj.attributes ?? []) as AmObject[]) {
    const attrName = attr.rm_attribute_name as string | undefined;
    const nestedChild = (attr.children ?? [])[0] as AmObject | undefined;
    if (!nestedChild) continue;
    const nested = extractFixedFields(nestedChild, terms);
    if (!nested) continue;
    if (attrName === "defining_code") Object.assign(fields, nested);
    else if (attrName === "value" && nested.value) fields.value = nested.value;
    else if (attrName === "units" && nested.value) fields.units = nested.value;
    else if (attrName === "terminology_id" && nested.value) {
      fields.terminology_id = nested.value;
    }
  }

  return Object.keys(fields).length ? fields : undefined;
}

function terminologyIdFromAm(cObj: AmObject): string | undefined {
  return coerceTerminologyId(cObj.terminology_id ?? cObj.terminology);
}

/** ehrtslib may yield a plain string or a TERMINOLOGY_ID / String wrapper. */
function coerceTerminologyId(tid: unknown): string | undefined {
  if (typeof tid === "string" && tid) return tid;
  if (!tid || typeof tid !== "object") return undefined;
  const rec = tid as { value?: unknown; _value?: unknown };
  const nested = rec.value ?? rec._value;
  if (typeof nested === "string" && nested) return nested;
  if (nested && typeof nested === "object") {
    const inner = (nested as { value?: unknown }).value;
    if (typeof inner === "string" && inner) return inner;
  }
  return undefined;
}

function codeListFromAm(cObj: AmObject): string[] {
  const list = cObj.code_list ?? cObj.constraint;
  if (list == null) return [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.map(amCodeString).filter(Boolean);
}

/**
 * Constrained coded/string choices from C_CODE_PHRASE `code_list` (including
 * nested `defining_code`) or a C_STRING `list` of more than one value.
 * OPT `code_list` / `assumed_value` come from ehrtslib (upstream since #73).
 *
 * @see openehr://guides/archetypes/terminology — value sets on DV_CODED_TEXT
 * @see openehr://guides/archetypes/adl-idioms-cheatsheet — coded leaf
 */
function extractAllowedValues(cObj: AmObject, terms: TermBag): AllowedValue[] {
  const terminology = terminologyIdFromAm(cObj);
  const codes = codeListFromAm(cObj);
  const assumedCode = assumedCodeFromAm(cObj);
  if (codes.length > 1) {
    return codes.map((code) => ({
      code,
      label: lookupTermText(terms, code) ?? code,
      terminologyId: terminology,
      ...(assumedCode === code ? { assumed: true as const } : {}),
    }));
  }

  for (const attr of (cObj.attributes ?? []) as AmObject[]) {
    const nestedChild = (attr.children ?? [])[0] as AmObject | undefined;
    if (!nestedChild) continue;
    const nested = extractAllowedValues(nestedChild, terms);
    if (!nested.length) continue;
    return nested.map((item) => ({
      ...item,
      terminologyId: item.terminologyId ?? terminology,
      ...(item.assumed || assumedCode === item.code ? { assumed: true as const } : {}),
    }));
  }

  const strings = stringListFromAm(cObj);
  if (strings.length > 1) {
    return strings.map((value) => ({
      code: value,
      label: value,
      terminologyId: terminology,
    }));
  }

  return [];
}

/**
 * Unique UCUM units from AM 1.4 `C_QUANTITY` / `C_DV_QUANTITY` `list[].units`
 * (and nested `units` C_STRING lists). A single unit is copied to
 * `fixedFields.units`; several become `allowedUnits`.
 *
 * @see openehr://spec/type/AM/C_QUANTITY
 * @see openehr://spec/type/RM/DV_QUANTITY
 */
function extractAllowedUnits(cObj: AmObject): string[] {
  const seen = new Set<string>();
  const units: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const unit = value.trim();
    if (!unit || unit === "[object Object]" || seen.has(unit)) return;
    seen.add(unit);
    units.push(unit);
  };

  if (Array.isArray(cObj.list)) {
    for (const item of cObj.list) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        add((item as { units?: unknown }).units);
      }
    }
  }

  for (const attr of (cObj.attributes ?? []) as AmObject[]) {
    if (attr.rm_attribute_name !== "units") continue;
    const nested = (attr.children ?? [])[0] as AmObject | undefined;
    if (!nested) continue;
    if (Array.isArray(nested.list)) {
      for (const item of nested.list) add(item);
    }
    for (const unit of extractAllowedUnits(nested)) add(unit);
  }

  if (units.length === 0) {
    const assumed = cObj.assumed_value as { units?: unknown } | undefined;
    if (assumed && typeof assumed === "object") add(assumed.units);
  }

  return units;
}

type OrdinalListItem = {
  value?: number | string;
  symbol?: {
    code_string?: string;
    terminology_id?: string;
    defining_code?: { code_string?: string; terminology_id?: string };
  };
};

/**
 * Allowed ordinal/scale values from AM `C_ORDINAL` / `C_DV_ORDINAL` `list[]`
 * (`value` + `symbol.defining_code`). A single choice is copied to
 * `fixedFields`; several become `allowedOrdinals`.
 *
 * @see openehr://spec/type/AM/C_ORDINAL
 * @see openehr://spec/type/RM/DV_ORDINAL
 * @see openehr://spec/type/RM/DV_SCALE
 */
function extractAllowedOrdinals(cObj: AmObject, terms: TermBag): AllowedOrdinal[] {
  const list = cObj.list as unknown[] | undefined;
  if (!Array.isArray(list) || list.length < 2) return [];

  const assumed = ordinalAssumedFromAm(cObj);
  const items: AllowedOrdinal[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as OrdinalListItem;
    const value = Number(rec.value);
    if (!Number.isFinite(value)) continue;
    const sym = rec.symbol ?? {};
    const code = sym.code_string ??
      sym.defining_code?.code_string ??
      amCodeString(sym);
    if (!code) continue;
    const terminologyId = coerceTerminologyId(
      sym.terminology_id ??
        sym.defining_code?.terminology_id ??
        terminologyIdFromAm(sym),
    );
    const label = lookupTermText(terms, code) ?? code;
    items.push({
      value,
      code,
      label,
      ...(terminologyId ? { terminologyId } : {}),
      ...(assumed && (assumed.value === value || assumed.code === code)
        ? { assumed: true as const }
        : {}),
    });
  }
  return items;
}

function ordinalAssumedFromAm(
  cObj: AmObject,
): { value?: number; code?: string } | undefined {
  const assumed = cObj.assumed_value as OrdinalListItem | undefined;
  if (!assumed || typeof assumed !== "object") return undefined;
  const value = assumed.value === undefined || assumed.value === null
    ? undefined
    : Number(assumed.value);
  const code = assumed.symbol?.code_string ??
    assumed.symbol?.defining_code?.code_string;
  if (value === undefined && !code) return undefined;
  return { value: Number.isFinite(value) ? value : undefined, code };
}

function stringListFromAm(cObj: AmObject): string[] {
  const list = cObj.list;
  if (!Array.isArray(list) || list.length < 2) return [];
  if (!list.every((item) => typeof item === "string" || typeof item === "number")) {
    return [];
  }
  return list.map((item) => String(item)).filter(Boolean);
}

/** Single constrained code, or AOM assumed_value when the template leaves a choice. */
function assumedCodeFromAm(cObj: AmObject): string | undefined {
  return amCodeString(cObj.assumed_value) || undefined;
}

function amCodeString(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (typeof item !== "object") return "";
  const rec = item as {
    code?: unknown;
    code_string?: unknown;
    value?: unknown;
  };
  return amCodeString(rec.code_string) || amCodeString(rec.code) ||
    (typeof rec.value === "string" || typeof rec.value === "number"
      ? String(rec.value)
      : "");
}

export function collectValueSlots(nodes: SkeletonNode[]): SkeletonNode[] {
  const out: SkeletonNode[] = [];
  for (const node of nodes) {
    if (node.kind === "value" && !isAutoFixedValueSlot(node)) out.push(node);
    else if (isPartyIdentityRmType(node.rmType)) out.push(node);
    out.push(...collectValueSlots(node.children));
  }
  return out;
}

export function slotReturnType(node: Pick<SkeletonNode, "rmType">): string {
  return returnTypeForDv(node.rmType);
}

/**
 * Filter a Template Skeleton to only mandatory (`min >= 1`) paths from the
 * root, preserving the required root/ancestor spine. Optional branches
 * (`mandatory === false`) are omitted so the user can pull them in later from
 * the Target schema tab (Sparse pre-scaffolding mode).
 */
export function filterSkeletonMandatoryOnly(nodes: SkeletonNode[]): SkeletonNode[] {
  const filterLevel = (list: SkeletonNode[], depth: number): SkeletonNode[] => {
    const kept: SkeletonNode[] = [];
    for (const node of list) {
      if (depth > 0 && !node.mandatory) continue;
      kept.push({
        ...node,
        children: filterLevel(node.children, depth + 1),
      });
    }
    return kept;
  };
  return filterLevel(nodes, 0);
}

