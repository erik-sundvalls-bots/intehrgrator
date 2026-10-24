/**
 * Format-neutral reading of a W3C XML Schema (XSD): elements, attributes,
 * occurrences, `xs:documentation` per `xml:lang`, and restriction facets.
 *
 * One reader for both sides: an XSD **Source Schema** becomes a source tree
 * (#278) and an XSD **target** becomes a Template Skeleton (#277). Named
 * types, `ref`, groups, attribute groups and complex/simple content
 * extensions are resolved within the one file; recursion stops at a named
 * type that is already being expanded.
 */
import { childElements, parseXmlDocument, XmlParseError } from "../xml/xml_dom.ts";

export const XSD_NS = "http://www.w3.org/2001/XMLSchema";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** One `xs:documentation`; `lang` is the `xml:lang` value ("" when absent). */
export interface XsdDoc {
  lang: string;
  text: string;
}

export interface XsdEnumValue {
  value: string;
  docs: XsdDoc[];
}

/** Restriction facets of a simple type (merged along the base-type chain). */
export interface XsdFacets {
  enumeration?: XsdEnumValue[];
  pattern?: string[];
  minInclusive?: string;
  maxInclusive?: string;
  minExclusive?: string;
  maxExclusive?: string;
  length?: number;
  minLength?: number;
  maxLength?: number;
  totalDigits?: number;
  fractionDigits?: number;
}

export interface XsdNode {
  name: string;
  /** `/Root/Child`, attributes as `/Root/Child/@attr`. */
  path: string;
  xmlKind: "element" | "attribute";
  /** Built-in or named simple type local name (`string`, `integer`, …); `complexType` for containers. */
  type: string;
  min: number;
  /** `null` = unbounded. */
  max: number | null;
  /** Compact cardinality: `1`, `0..1`, `0..*`, `1..*`. */
  multiplicity: string;
  docs: XsdDoc[];
  facets?: XsdFacets;
  fixed?: string;
  default?: string;
  /** Element with child elements or attributes (not a plain value). */
  complex: boolean;
  /** `xs:simpleContent`: the element carries a text value **and** attributes. */
  simpleContent?: boolean;
  /** Expansion stopped here: the named type is already open higher up. */
  recursive?: boolean;
  children: XsdNode[];
}

export interface XsdModel {
  root: XsdNode;
  rootName: string;
  targetNamespace?: string;
  version?: string;
  /** Every `xml:lang` used in documentation, in order of first appearance. */
  languages: string[];
}

interface Globals {
  elements: Map<string, Element>;
  complexTypes: Map<string, Element>;
  simpleTypes: Map<string, Element>;
  groups: Map<string, Element>;
  attributeGroups: Map<string, Element>;
  attributes: Map<string, Element>;
}

const MAX_DEPTH = 40;

/** Parse an XSD document. Throws `XmlParseError` for non-XML and a plain `Error` for non-XSD. */
export function parseXsd(content: string): XsdModel {
  const doc = parseXmlDocument(content);
  const schema = doc.documentElement;
  if (!schema || schema.localName !== "schema" || schema.namespaceURI !== XSD_NS) {
    throw new XmlParseError("Invalid XML Schema: root is not xs:schema");
  }
  const globals: Globals = {
    elements: new Map(),
    complexTypes: new Map(),
    simpleTypes: new Map(),
    groups: new Map(),
    attributeGroups: new Map(),
    attributes: new Map(),
  };
  for (const child of xsChildren(schema)) {
    const name = child.getAttribute("name");
    if (!name) continue;
    const bucket = {
      element: globals.elements,
      complexType: globals.complexTypes,
      simpleType: globals.simpleTypes,
      group: globals.groups,
      attributeGroup: globals.attributeGroups,
      attribute: globals.attributes,
    }[child.localName as string];
    bucket?.set(name, child);
  }
  const rootEl = xsChildren(schema, "element")[0];
  if (!rootEl) throw new XmlParseError("Invalid XML Schema: no root xs:element");
  const rootName = rootEl.getAttribute("name") ?? "root";
  const reader = new XsdReader(globals);
  const root = reader.element(rootEl, "", true, new Set(), 0);
  const languages: string[] = [];
  collectLanguages(schema, languages);
  return {
    root,
    rootName,
    ...(schema.getAttribute("targetNamespace") ? { targetNamespace: schema.getAttribute("targetNamespace")! } : {}),
    ...(schema.getAttribute("version") ? { version: schema.getAttribute("version")! } : {}),
    languages,
  };
}

/** Documentation text in `lang`, else without `xml:lang`, else the first. */
export function docText(docs: readonly XsdDoc[], lang?: string): string | undefined {
  return docEntry(docs, lang)?.text;
}

/** The documentation entry `docText` picks: `lang`, else its base language, else one without `xml:lang`, else the first. */
export function docEntry(docs: readonly XsdDoc[], lang?: string): XsdDoc | undefined {
  if (!docs.length) return undefined;
  if (lang) {
    const exact = docs.find((d) => d.lang.toLowerCase() === lang.toLowerCase());
    if (exact) return exact;
    const base = lang.split("-")[0].toLowerCase();
    const sameBase = docs.find((d) => d.lang.split("-")[0].toLowerCase() === base);
    if (sameBase) return sameBase;
  }
  return docs.find((d) => !d.lang) ?? docs[0];
}

/** Documentation as `{lang: text}` (`""` key for documentation without `xml:lang`). */
export function docsByLang(docs: readonly XsdDoc[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of docs) if (!(d.lang in out)) out[d.lang] = d.text;
  return out;
}

class XsdReader {
  constructor(private readonly globals: Globals) {}

  element(el: Element, parentPath: string, root: boolean, open: Set<string>, depth: number): XsdNode {
    const ref = localName(el.getAttribute("ref"));
    const decl = ref ? this.globals.elements.get(ref) ?? el : el;
    const name = decl.getAttribute("name") ?? ref ?? "element";
    const path = `${parentPath}/${name}`;
    // Occurrences come from the use site (a `ref` carries them), not the global declaration.
    const { min, max, multiplicity } = occurs(el, root);
    const node: XsdNode = {
      name,
      path,
      xmlKind: "element",
      type: "string",
      min,
      max,
      multiplicity,
      docs: documentation(decl),
      complex: false,
      children: [],
    };
    if (!node.docs.length && decl !== el) node.docs = documentation(el);
    const fixed = decl.getAttribute("fixed") ?? el.getAttribute("fixed");
    const dflt = decl.getAttribute("default") ?? el.getAttribute("default");
    if (fixed != null) node.fixed = fixed;
    if (dflt != null) node.default = dflt;
    if (depth > MAX_DEPTH) {
      node.recursive = true;
      return node;
    }
    const inlineComplex = xsChildren(decl, "complexType")[0];
    const inlineSimple = xsChildren(decl, "simpleType")[0];
    const typeName = decl.getAttribute("type");
    if (inlineComplex) {
      this.complexType(inlineComplex, node, open, depth);
    } else if (inlineSimple) {
      this.applySimple(inlineSimple, node, new Set());
    } else if (typeName) {
      const local = localName(typeName)!;
      const complex = !isBuiltin(typeName, decl) ? this.globals.complexTypes.get(local) : undefined;
      const simple = !isBuiltin(typeName, decl) ? this.globals.simpleTypes.get(local) : undefined;
      if (complex) {
        if (open.has(local)) {
          node.complex = true;
          node.type = local;
          node.recursive = true;
        } else {
          const next = new Set(open).add(local);
          this.complexType(complex, node, next, depth);
          if (!node.docs.length) node.docs = documentation(complex);
        }
      } else if (simple) {
        this.applySimple(simple, node, new Set([local]));
        if (!node.docs.length) node.docs = documentation(simple);
      } else {
        node.type = local;
      }
    }
    return node;
  }

  /** Fill `node` from a complexType: content model, attributes, extensions. */
  private complexType(ct: Element, node: XsdNode, open: Set<string>, depth: number): void {
    node.complex = true;
    node.type = "complexType";
    const attrs: XsdNode[] = [];
    const elems: XsdNode[] = [];
    const simpleContent = xsChildren(ct, "simpleContent")[0];
    const complexContent = xsChildren(ct, "complexContent")[0];
    if (simpleContent) {
      const ext = xsChildren(simpleContent, "extension")[0] ?? xsChildren(simpleContent, "restriction")[0];
      node.simpleContent = true;
      if (ext) {
        const base = ext.getAttribute("base") ?? "";
        const local = localName(base) ?? "string";
        const baseSimple = !isBuiltin(base, ext) ? this.globals.simpleTypes.get(local) : undefined;
        const baseComplex = !isBuiltin(base, ext) ? this.globals.complexTypes.get(local) : undefined;
        if (baseSimple) {
          const value: XsdNode = { ...node, children: [] };
          this.applySimple(baseSimple, value, new Set([local]));
          node.type = value.type;
          if (value.facets) node.facets = value.facets;
        } else if (baseComplex && !open.has(local)) {
          this.complexType(baseComplex, node, new Set(open).add(local), depth);
          attrs.push(...node.children.filter((c) => c.xmlKind === "attribute"));
          node.children = [];
        } else {
          node.type = local;
        }
        if (ext.localName === "restriction") {
          const facets = readFacets(ext);
          if (facets) node.facets = { ...node.facets, ...facets };
        }
        attrs.push(...this.attributes(ext, node.path, new Set()));
      }
      node.children = attrs;
      return;
    }
    let body: Element = ct;
    if (complexContent) {
      const ext = xsChildren(complexContent, "extension")[0] ?? xsChildren(complexContent, "restriction")[0];
      if (ext) {
        const base = localName(ext.getAttribute("base"));
        const baseType = base ? this.globals.complexTypes.get(base) : undefined;
        if (baseType && base && !open.has(base) && ext.localName === "extension") {
          const inherited: XsdNode = { ...node, children: [] };
          this.complexType(baseType, inherited, new Set(open).add(base), depth);
          for (const child of inherited.children) (child.xmlKind === "attribute" ? attrs : elems).push(child);
        }
        body = ext;
      }
    }
    attrs.push(...this.attributes(body, node.path, new Set()));
    elems.push(...this.particles(body, node.path, open, depth, false));
    node.children = [...attrs, ...dedupe(elems)];
  }

  /** Elements under sequence / all / choice / group (nested), in document order. */
  private particles(parent: Element, path: string, open: Set<string>, depth: number, optional: boolean): XsdNode[] {
    const out: XsdNode[] = [];
    for (const child of xsChildren(parent)) {
      switch (child.localName) {
        case "element": {
          const node = this.element(child, path, false, open, depth + 1);
          if (optional && node.min > 0) {
            node.min = 0;
            node.multiplicity = node.max === 1 ? "0..1" : "0..*";
          }
          out.push(node);
          break;
        }
        case "sequence":
        case "all":
          out.push(...this.particles(child, path, open, depth, optional || child.getAttribute("minOccurs") === "0"));
          break;
        case "choice":
          out.push(...this.particles(child, path, open, depth, true));
          break;
        case "group": {
          const ref = localName(child.getAttribute("ref"));
          const group = ref ? this.globals.groups.get(ref) : undefined;
          if (group && ref && !open.has(`group:${ref}`)) {
            out.push(...this.particles(group, path, new Set(open).add(`group:${ref}`), depth, optional || child.getAttribute("minOccurs") === "0"));
          }
          break;
        }
      }
    }
    return out;
  }

  private attributes(parent: Element, parentPath: string, seenGroups: Set<string>): XsdNode[] {
    const out: XsdNode[] = [];
    for (const child of xsChildren(parent)) {
      if (child.localName === "attribute") {
        out.push(this.attribute(child, parentPath));
      } else if (child.localName === "attributeGroup") {
        const ref = localName(child.getAttribute("ref"));
        const group = ref ? this.globals.attributeGroups.get(ref) : undefined;
        if (group && ref && !seenGroups.has(ref)) {
          out.push(...this.attributes(group, parentPath, new Set(seenGroups).add(ref)));
        }
      }
    }
    return out;
  }

  private attribute(el: Element, parentPath: string): XsdNode {
    const ref = localName(el.getAttribute("ref"));
    const decl = ref ? this.globals.attributes.get(ref) ?? el : el;
    const name = decl.getAttribute("name") ?? ref ?? "attr";
    const use = el.getAttribute("use") ?? "optional";
    const fixed = el.getAttribute("fixed") ?? decl.getAttribute("fixed");
    const dflt = el.getAttribute("default") ?? decl.getAttribute("default");
    const required = use === "required";
    const node: XsdNode = {
      name,
      path: `${parentPath}/@${name}`,
      xmlKind: "attribute",
      type: "string",
      min: required ? 1 : 0,
      max: 1,
      multiplicity: required ? "1" : "0..1",
      docs: documentation(decl),
      complex: false,
      children: [],
    };
    if (!node.docs.length && decl !== el) node.docs = documentation(el);
    if (fixed != null) node.fixed = fixed;
    if (dflt != null) node.default = dflt;
    const inline = xsChildren(decl, "simpleType")[0];
    const typeName = decl.getAttribute("type");
    if (inline) this.applySimple(inline, node, new Set());
    else if (typeName) {
      const local = localName(typeName)!;
      const simple = !isBuiltin(typeName, decl) ? this.globals.simpleTypes.get(local) : undefined;
      if (simple) this.applySimple(simple, node, new Set([local]));
      else node.type = local;
    }
    return node;
  }

  /** Resolve a simpleType's base chain into `node.type` and merged facets. */
  private applySimple(st: Element, node: XsdNode, seen: Set<string>): void {
    const restriction = xsChildren(st, "restriction")[0];
    if (!restriction) {
      // xs:list / xs:union: a whitespace list or a union of simple types — keep as text.
      node.type = xsChildren(st, "list")[0] ? "list" : "string";
      return;
    }
    const base = restriction.getAttribute("base") ?? "";
    const local = localName(base) ?? "string";
    const named = !isBuiltin(base, restriction) ? this.globals.simpleTypes.get(local) : undefined;
    if (named && !seen.has(local)) {
      this.applySimple(named, node, new Set(seen).add(local));
    } else {
      const inline = xsChildren(restriction, "simpleType")[0];
      if (inline) this.applySimple(inline, node, seen);
      else node.type = local;
    }
    const facets = readFacets(restriction);
    if (facets) node.facets = { ...node.facets, ...facets };
  }
}

function readFacets(restriction: Element): XsdFacets | undefined {
  const facets: XsdFacets = {};
  for (const f of xsChildren(restriction)) {
    const value = f.getAttribute("value");
    if (value == null) continue;
    switch (f.localName) {
      case "enumeration":
        (facets.enumeration ??= []).push({ value, docs: documentation(f) });
        break;
      case "pattern":
        (facets.pattern ??= []).push(value);
        break;
      case "minInclusive":
      case "maxInclusive":
      case "minExclusive":
      case "maxExclusive":
        facets[f.localName] = value;
        break;
      case "length":
      case "minLength":
      case "maxLength":
      case "totalDigits":
      case "fractionDigits": {
        const n = Number(value);
        if (Number.isFinite(n)) facets[f.localName] = n;
        break;
      }
    }
  }
  return Object.keys(facets).length ? facets : undefined;
}

function documentation(el: Element): XsdDoc[] {
  const out: XsdDoc[] = [];
  for (const annotation of xsChildren(el, "annotation")) {
    for (const doc of xsChildren(annotation, "documentation")) {
      const text = (doc.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({ lang: xmlLang(doc), text });
    }
  }
  return out;
}

function xmlLang(el: Element): string {
  return el.getAttributeNS(XML_NS, "lang") ?? el.getAttribute("xml:lang") ?? "";
}

function collectLanguages(el: Element, out: string[]): void {
  for (const child of childElements(el)) {
    if (child.localName === "documentation" && child.namespaceURI === XSD_NS) {
      const lang = xmlLang(child);
      if (lang && !out.includes(lang)) out.push(lang);
    }
    collectLanguages(child, out);
  }
}

function occurs(el: Element, root: boolean): { min: number; max: number | null; multiplicity: string } {
  const min = root ? 1 : Number(el.getAttribute("minOccurs") ?? "1");
  const maxToken = root ? "1" : el.getAttribute("maxOccurs") ?? "1";
  const max = maxToken === "unbounded" ? null : Number(maxToken);
  const multiplicity = max === 1 ? (min > 0 ? "1" : "0..1") : (min > 0 ? "1..*" : "0..*");
  return { min: Number.isFinite(min) ? min : 1, max, multiplicity };
}

function xsChildren(el: Element, local?: string): Element[] {
  return childElements(el).filter((c) => c.namespaceURI === XSD_NS && (!local || c.localName === local));
}

function localName(qname: string | null | undefined): string | undefined {
  if (!qname) return undefined;
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

/** `xs:string`, or an unprefixed name when the default namespace is XSD. */
function isBuiltin(qname: string, context: Element): boolean {
  const i = qname.indexOf(":");
  const prefix = i >= 0 ? qname.slice(0, i) : null;
  const ns = context.lookupNamespaceURI(prefix);
  return ns === XSD_NS;
}

/** XSD allows the same element name twice in a content model (choice branches); keep the first. */
function dedupe(nodes: XsdNode[]): XsdNode[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    if (seen.has(n.path)) return false;
    seen.add(n.path);
    return true;
  });
}
