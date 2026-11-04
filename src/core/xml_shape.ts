/**
 * Shared XML Blockly shape: input names, connection checks, declaration/CDATA emit.
 * Used by canvas blocks and both Go-template codegen paths.
 */

export const XML_ELEMENT_TYPE = "xml_element";
export const XML_DOCUMENT_TYPE = "xml_document";
export const XML_TEXT_TYPE = "xml_text";
export const XML_CDATA_TYPE = "xml_cdata";
export const XML_ATTRIBUTE_TYPE = "xml_attribute";

export const XML_ATTRIBUTES_INPUT = "TARGET_attributes";
export const XML_CHILDREN_INPUT = "TARGET_children";
export const XML_TEXT_INPUT = "VALUE";
export const XML_ROOT_INPUT = "TARGET_root";

/** Statement check for `xml_attribute` stacks. */
export const XML_ATTRIBUTE_CHECK = "xml_attribute";

/** Nested content under an element: other elements plus mapping control blocks. */
export const XML_NEST_CHECK = [
  "xml_element",
  "controls_if",
  "for_each_list",
  "include_when",
] as const;

export type XmlNamespaceDecl = { prefix: string; uri: string };

export type XmlDocumentExtraState = {
  declaration?: boolean;
  version?: string;
  encoding?: string;
  standalone?: string;
  namespaces?: XmlNamespaceDecl[];
  extras?: string[];
  instanceRoot?: boolean;
};

/** Split `]]>` so the CDATA section stays well-formed. */
export function wrapXmlCdata(inner: string): string {
  return `<![CDATA[${inner.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export function xmlDeclarationLine(opts: {
  version?: string;
  encoding?: string;
  standalone?: string;
}): string {
  const version = (opts.version ?? "1.0").trim() || "1.0";
  const encoding = (opts.encoding ?? "UTF-8").trim() || "UTF-8";
  const parts = [`version="${version}"`, `encoding="${encoding}"`];
  const standalone = (opts.standalone ?? "").trim();
  if (standalone === "yes" || standalone === "no") {
    parts.push(`standalone="${standalone}"`);
  }
  return `<?xml ${parts.join(" ")}?>`;
}

export function xmlnsAttribute(prefix: string, uri: string): string {
  const p = prefix.trim();
  const name = p ? `xmlns:${p}` : "xmlns";
  return ` ${name}="${uri}"`;
}

/** Inject xmlns declarations onto the first start tag of an already-emitted element. */
export function injectXmlnsOnOpenTag(openTag: string, namespaces: XmlNamespaceDecl[]): string {
  if (!namespaces.length) return openTag;
  const attrs = namespaces
    .filter((ns) => ns.uri.trim())
    .map((ns) => xmlnsAttribute(ns.prefix, ns.uri))
    .join("");
  if (!attrs) return openTag;
  if (openTag.startsWith("<?xml")) return openTag;
  const gt = openTag.indexOf(">");
  if (gt < 1) return openTag;
  const before = openTag.slice(0, gt);
  const after = openTag.slice(gt);
  if (before.endsWith("/")) {
    return `${before.slice(0, -1)}${attrs}/${after}`;
  }
  return `${before}${attrs}${after}`;
}
