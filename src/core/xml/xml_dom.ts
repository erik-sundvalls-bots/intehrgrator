/**
 * Parse XML into a DOM `Document` in the browser **and** in the headless
 * Deno service (MCP stdio, scripts, tests), which has no `DOMParser` (#278).
 *
 * The browser keeps its native `DOMParser`; elsewhere slimdom (already in the
 * bundle for XQuery) builds a DOM that fontoxpath can query.
 */
import * as slimdom from "slimdom";

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

/** Parse well-formed XML or throw `XmlParseError` with the parser's reason. */
export function parseXmlDocument(xml: string): Document {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const Native = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (Native) {
    const doc = new Native().parseFromString(text, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error) {
      const reason = (error.textContent ?? "").trim().split("\n")[0];
      throw new XmlParseError(`Invalid XML${reason ? `: ${reason}` : ""}`);
    }
    return doc;
  }
  try {
    return slimdom.parseXmlDocument(text) as unknown as Document;
  } catch (err) {
    throw new XmlParseError(`Invalid XML: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Child elements of `node` (DOM `children` or slimdom's array). */
export function childElements(node: Element): Element[] {
  return Array.from(node.children ?? []) as Element[];
}

/** True when the document root is `xs:schema` (W3C XML Schema). */
export function isXmlSchemaRoot(doc: Document): boolean {
  const root = doc.documentElement;
  return Boolean(root) && root.localName === "schema" &&
    root.namespaceURI === "http://www.w3.org/2001/XMLSchema";
}
