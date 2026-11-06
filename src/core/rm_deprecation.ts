/**
 * Reference-model attributes whose own specification text marks the field
 * deprecated. A "DEPRECATED usage" note inside an otherwise current attribute
 * (DV_TEXT.formatting) does not count, and a deprecated class (DV_PARAGRAPH)
 * does not strike its attributes.
 */
import { ancestorsOf } from "ehrtslib/meta/mod.ts";
import { attributeSpec, classSpec } from "ehrtslib/spec/mod.ts";

export type DeprecatedRmField = {
  /** Official spec page (with in-page anchor) that states the deprecation. */
  href: string;
};

/**
 * RM Data Types §5.1.7 Formatting and Hyperlinking:
 * "Deprecated: Starting at RM Release 1.0.4, the use of the hyperlink field
 * is deprecated…". The DV_TEXT class table repeats that sentence but has no
 * per-attribute anchor (`#_dv_text_class` only).
 * https://specifications.openehr.org/releases/RM/development/data_types.html#_formatting_and_hyperlinking
 */
export const DV_TEXT_HYPERLINK_DEPRECATION_HREF =
  "https://specifications.openehr.org/releases/RM/development/data_types.html#_formatting_and_hyperlinking";

/** True when BMM/spec prose deprecates the attribute itself. */
export function isDeprecatedFieldDocumentation(documentation: string): boolean {
  return /^DEPRECATED\s*:/i.test(documentation.trim());
}

/**
 * Deprecation for an attribute on this class, including one inherited from
 * an ancestor (DV_CODED_TEXT.hyperlink is DV_TEXT.hyperlink).
 */
export function deprecatedRmField(
  className: string,
  attributeName: string,
): DeprecatedRmField | null {
  const typeName = className.trim();
  const attrName = attributeName.trim();
  if (!typeName || !attrName) return null;

  for (const type of ancestorChain(typeName)) {
    const attr = attributeSpec(type, attrName, { component: "RM" }) ??
      attributeSpec(type, attrName);
    const documentation = attr?.documentation?.trim() ?? "";
    if (!documentation) continue;
    if (!isDeprecatedFieldDocumentation(documentation)) return null;
    const href = deprecationHref(type, attrName);
    return href ? { href } : null;
  }
  return null;
}

function ancestorChain(className: string): string[] {
  try {
    const chain = ancestorsOf(className);
    if (chain.length) return chain;
  } catch {
    // Not an RM class the meta tables know.
  }
  return [className];
}

function deprecationHref(definingClass: string, attributeName: string): string | null {
  if (definingClass === "DV_TEXT" && attributeName === "hyperlink") {
    return DV_TEXT_HYPERLINK_DEPRECATION_HREF;
  }
  const row = classSpec(definingClass, { component: "RM" }) ?? classSpec(definingClass);
  return row?.specHtmlUrl ?? null;
}
