import {
  asArray,
  parseLegacyTemplateXml,
  textValue,
} from "ehrtslib/parser/legacy/xml_aom_mapper.ts";
import {
  availableTemplateLanguages,
  resolveTemplateLanguage,
} from "ehrtslib/generation/term_codes.ts";
import {
  archetypeTermBagsForLanguage,
  lookupTermInBag,
  resolveLocatableLabel,
  TERM_ARCHETYPE_SCOPE_KEY,
  TERM_NAME_FALLBACK_NODE_ID_KEY,
  type OperationalTemplateWithTermScopes,
  type TermScopeMeta,
} from "ehrtslib/generation/term_scope.ts";
import type { WebTemplate, WebTemplateNode } from "ehrtslib/serialization/simplified/types.ts";

export type TermBag = Record<string, { text?: string; description?: string }>;

/** Human-readable archetype name segment for at-code disambiguation. */
export function archetypeShortName(archetypeRef: string): string {
  const match = /openEHR-EHR-[^.]+\.([^.]+)/.exec(archetypeRef);
  if (match) return match[1];
  const parts = archetypeRef.split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : archetypeRef;
}

/** Better overlay id `openEHR-EHR-OBSERVATION.ovl-blood_pressure-001.v2`. */
const OVERLAY_ARCHETYPE_RE =
  /^(openEHR-EHR-[A-Z0-9_]+)\.ovl-([A-Za-z0-9_]+)-\d+\.(v[\w.]+)$/i;

export function isOverlayArchetypeRef(scope?: string): boolean {
  return Boolean(scope && OVERLAY_ARCHETYPE_RE.test(scope));
}

/** Parent archetype id an overlay specialises, when the id follows Better `ovl-*` shape. */
export function parentArchetypeRefFromOverlay(scope?: string): string | undefined {
  if (!scope) return undefined;
  const match = OVERLAY_ARCHETYPE_RE.exec(scope);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/** Term bag for the archetype an overlay specialises, matching exact id or short name. */
export function parentArchetypeTermBag(
  scope: string | undefined,
  bags: Record<string, TermBag>,
): TermBag | undefined {
  const parent = parentArchetypeRefFromOverlay(scope);
  if (parent && bags[parent]) return bags[parent];
  const concept = scope ? /ovl-([A-Za-z0-9_]+)-\d+/i.exec(scope)?.[1] : undefined;
  if (!concept) return undefined;
  for (const [id, bag] of Object.entries(bags)) {
    if (isOverlayArchetypeRef(id)) continue;
    if (archetypeShortName(id) === concept) return bag;
  }
  return undefined;
}

/** Last-resort overlay title from `ovl-blood_pressure-001` → `Blood pressure`. */
export function overlayConceptFallback(scope?: string): string | undefined {
  if (!scope) return undefined;
  const match = /ovl-([A-Za-z0-9_]+)-\d+/i.exec(scope);
  if (!match) return undefined;
  return match[1]
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function resolveOptLanguage(
  opt: {
    original_language?: unknown;
    ontology?: { original_language?: { code_string?: string }; term_definitions?: Record<string, unknown> };
  },
  preferred?: string,
): string {
  return resolveTemplateLanguage(opt, preferred);
}

/** Language codes available for OPT ontology / description details. */
export function availableOptLanguages(
  opt: {
    original_language?: unknown;
    ontology?: {
      original_language?: { code_string?: string };
      term_definitions?: Record<string, unknown>;
    };
    description?: { details?: Record<string, unknown> };
  },
): string[] {
  return availableTemplateLanguages(opt);
}

/**
 * Language codes available on a Web Template (`languages`, `defaultLanguage`,
 * plus any `localizedNames` / coded `localizedLabels` found in the tree).
 */
export function availableWebTemplateLanguages(webTemplate: WebTemplate): string[] {
  const langs = new Set<string>();
  if (webTemplate.defaultLanguage) langs.add(webTemplate.defaultLanguage);
  for (const lang of webTemplate.languages ?? []) {
    if (lang) langs.add(lang);
  }
  walkWebTemplateLanguages(webTemplate.tree, langs);
  return orderLanguages(webTemplate.defaultLanguage || "en", [...langs]);
}

function walkWebTemplateLanguages(node: WebTemplateNode, langs: Set<string>): void {
  for (const lang of Object.keys(node.localizedNames ?? {})) langs.add(lang);
  for (const lang of Object.keys(node.localizedDescriptions ?? {})) langs.add(lang);
  for (const input of node.inputs ?? []) {
    for (const item of input.list ?? []) {
      for (const lang of Object.keys(item.localizedLabels ?? {})) langs.add(lang);
      for (const lang of Object.keys(item.localizedDescriptions ?? {})) langs.add(lang);
    }
  }
  for (const child of node.children ?? []) walkWebTemplateLanguages(child, langs);
}

/** Prefer default language first, then remaining codes sorted. */
export function orderLanguages(preferred: string | undefined, languages: string[]): string[] {
  const unique = [...new Set(languages.filter(Boolean))];
  if (!preferred) return unique.sort((a, b) => a.localeCompare(b));
  return [
    preferred,
    ...unique.filter((lang) => lang !== preferred).sort((a, b) => a.localeCompare(b)),
  ];
}

/** Extract term text from OPT/AOM term entry shapes. */
export function termTextFromEntry(val: unknown): string | undefined {
  if (typeof val === "string" && val && val !== "[object Object]") return val;
  if (val && typeof val === "object") {
    const o = val as Record<string, unknown>;
    return termTextFromEntry(o.value) ?? termTextFromEntry(o.text) ?? termTextFromEntry(o["#text"]);
  }
  return undefined;
}

export function lookupTermText(terms: TermBag, nodeId?: string): string | undefined {
  return lookupTermInBag(terms, nodeId);
}

const ARCHETYPE_ID_RE = /^openEHR-/i;
const TEMPLATE_SLOT_ID_RE = /^at0\.\d/i;
/** Synthetic bag for Web Template composition roots whose nodeId is not an archetype id. */
export const TEMPLATE_ROOT_TERM_SCOPE = "__template_root__";

export function isArchetypeId(value?: string): boolean {
  return !!value && ARCHETYPE_ID_RE.test(value);
}

export function mergeTermMaps(
  ...maps: Array<Map<string, TermBag> | undefined>
): Map<string, TermBag> {
  const out = new Map<string, TermBag>();
  for (const map of maps) {
    if (!map) continue;
    for (const [id, bag] of map) {
      out.set(id, { ...out.get(id), ...bag });
    }
  }
  return out;
}

export function termBagsRecord(map: Map<string, TermBag>): Record<string, TermBag> {
  return Object.fromEntries(map);
}

/** Per-archetype bags from ehrtslib (`flattenToOperationalTemplate` / OPT XML parse). */
export function liveArchetypeTermsIndex(
  opt: OperationalTemplateWithTermScopes,
  lang: string,
): Map<string, TermBag> {
  return new Map(Object.entries(archetypeTermBagsForLanguage(opt, lang)));
}

function webTemplateNodeName(node: WebTemplateNode, lang: string): string | undefined {
  return node.localizedNames?.[lang] ??
    node.localizedName ??
    node.name ??
    Object.values(node.localizedNames ?? {})[0];
}

function putTerm(
  index: Map<string, TermBag>,
  scope: string,
  code: string,
  text: string,
  overwrite = false,
): void {
  const bag = index.get(scope) ?? {};
  if (overwrite || !bag[code]?.text) bag[code] = { text };
  index.set(scope, bag);
}

function occurrenceName(node: WebTemplateNode, defaultLang: string): string | undefined {
  return node.localizedNames?.[defaultLang] ?? node.name ?? node.localizedName;
}

function occurrenceScope(archetypeId: string, name?: string): string {
  return name ? `${archetypeId},'${name}'` : archetypeId;
}

/**
 * Display names from a Web Template tree, keyed by owning archetype id.
 * Repeated archetypes (two `SECTION.adhoc` headings) also get an occurrence
 * key `archetypeId,'Default-language name'` so OPT AQL name predicates resolve.
 */
export function buildWebTemplateTermsIndex(
  webTemplate: WebTemplate,
  preferredLang?: string,
): Map<string, TermBag> {
  const index = new Map<string, TermBag>();
  const available = availableWebTemplateLanguages(webTemplate);
  const defaultLang = webTemplate.defaultLanguage || available[0] || "en";
  const lang = preferredLang && available.includes(preferredLang)
    ? preferredLang
    : defaultLang;

  function record(node: WebTemplateNode, inherited: string | undefined): string | undefined {
    const name = webTemplateNodeName(node, lang);
    if (isArchetypeId(node.nodeId)) {
      const qualified = occurrenceScope(node.nodeId!, occurrenceName(node, defaultLang));
      if (name) {
        putTerm(index, node.nodeId!, node.nodeId!, name);
        putTerm(index, node.nodeId!, "at0000", name);
        putTerm(index, qualified, node.nodeId!, name, true);
        putTerm(index, qualified, "at0000", name, true);
      }
      return qualified;
    }
    if (inherited && node.nodeId && name) {
      putTerm(index, inherited, node.nodeId, name, true);
    }
    return inherited;
  }

  function walk(node: WebTemplateNode, inherited: string | undefined): void {
    const scope = record(node, inherited);
    for (const child of node.children ?? []) walk(child, scope);
  }

  const root = webTemplate.tree;
  const rootName = webTemplateNodeName(root, lang);
  const rootScope = isArchetypeId(root.nodeId)
    ? occurrenceScope(root.nodeId!, occurrenceName(root, defaultLang))
    : TEMPLATE_ROOT_TERM_SCOPE;
  if (rootName) {
    if (root.nodeId) putTerm(index, rootScope, root.nodeId, rootName, true);
    putTerm(index, rootScope, "at0000", rootName, true);
    if (isArchetypeId(root.nodeId)) {
      putTerm(index, root.nodeId!, root.nodeId!, rootName);
      putTerm(index, root.nodeId!, "at0000", rootName);
    }
  }
  walk(root, rootScope);
  return index;
}

export function termScopeOf(
  node: TermScopeMeta & { archetype_ref?: string },
  inherited?: string,
): string | undefined {
  return node[TERM_ARCHETYPE_SCOPE_KEY] ?? node.archetype_ref ?? inherited;
}

export function nameFallbackOf(
  node: TermScopeMeta & { node_id?: string; archetype_ref?: string },
): string | undefined {
  const tagged = node[TERM_NAME_FALLBACK_NODE_ID_KEY];
  if (tagged) return tagged;
  const nodeId = node.node_id;
  if (nodeId && TEMPLATE_SLOT_ID_RE.test(nodeId) && (node.archetype_ref || node[TERM_ARCHETYPE_SCOPE_KEY])) {
    return "at0000";
  }
  return undefined;
}

export function locatableNodeLabel(
  nodeId: string | undefined,
  rmType: string,
  scope: string | undefined,
  nameFallback: string | undefined,
  templateTerms: TermBag,
  archetypeTerms: Record<string, TermBag>,
): string {
  return resolveLocatableLabel(
    nodeId,
    nameFallback,
    templateTerms,
    archetypeTerms,
    scope,
  ) ?? nodeId ?? rmType;
}

export function publicArchetypeRef(scope?: string): string | undefined {
  if (!scope || scope.startsWith("__")) return undefined;
  return scope;
}

function parseTermsOnNode(node: Record<string, unknown>): TermBag {
  const bag: TermBag = {};
  for (const td of asArray(node.term_definitions)) {
    const rec = td as Record<string, unknown>;
    const code = String(rec["@_code"] ?? rec.code ?? "");
    if (!code) continue;
    const entry: { text?: string; description?: string } = {};
    for (const it of asArray(rec.items)) {
      const item = it as Record<string, unknown>;
      const id = String(item["@_id"] ?? item.id ?? "");
      const val = textValue(item);
      if (!val) continue;
      if (id === "text") entry.text = val;
      if (id === "description") entry.description = val;
    }
    bag[code] = entry;
  }
  return bag;
}

/**
 * Per-archetype term tables from OPT XML.
 * ehrtslib `parseOptXml` now attaches the same data; this walk is a fallback overlay.
 */
export function buildArchetypeTermsIndex(optSource: string): Map<string, TermBag> {
  const index = new Map<string, TermBag>();
  try {
    const root = parseLegacyTemplateXml(optSource);
    const def = root.definition;
    if (def && typeof def === "object") walkXmlForArchetypeTerms(def, index);
  } catch {
    // Non-XML templates fall back to merged ontology terms only.
  }
  return index;
}

function walkXmlForArchetypeTerms(
  node: unknown,
  index: Map<string, TermBag>,
): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const archId = textValue(n.archetype_id);
  if (archId) {
    const terms = parseTermsOnNode(n);
    if (Object.keys(terms).length > 0) index.set(archId, terms);
  }
  for (const child of asArray(n.children)) walkXmlForArchetypeTerms(child, index);
  for (const attr of asArray(n.attributes)) {
    for (const c of asArray((attr as Record<string, unknown>).children)) {
      walkXmlForArchetypeTerms(c, index);
    }
  }
}

export function compositionArchetypeRef(optSource: string): string | undefined {
  try {
    const root = parseLegacyTemplateXml(optSource);
    const def = root.definition;
    if (def && typeof def === "object") {
      return textValue((def as Record<string, unknown>).archetype_id);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function mergedOntologyTerms(
  opt: { ontology?: { term_definitions?: Record<string, TermBag> } },
  lang: string,
): TermBag {
  const defs = opt.ontology?.term_definitions ?? {};
  return defs[lang] ?? defs.en ?? Object.values(defs)[0] ?? {};
}
