/**
 * Workspace VMS hatch warnings (#40 / ADR 0009).
 * Distinct messages for removed types, ad-hoc trees, non-literal source
 * paths, and out-of-dialect templates.
 */
import type { Block } from "blockly/core";
import { isVmsEscapeBlockType, isVmsRemovedBlockType } from "./vms.ts";
import { INCLUDE_WHEN_BLOCK } from "./blocks/include_when.ts";
import { isSourceQueryBlockType } from "./source_query.ts";
import { isPlaceholderSourcePath } from "./listening.ts";
import { checkVmsHbs } from "../core/output/vms_hbs.ts";
import { checkVmsGoSync } from "../core/output/vms_go.ts";
import { compileLiteralPath, jsonDollarPathToLookup } from "../core/codegen/xquery.ts";

export const HATCH_REMOVED =
  "Removed from Verifiable Mapping Subset — unverified / not in declarative export";
export const HATCH_JSON_XML =
  "Ad-hoc JSON/XML tree — unverified / not in declarative export";
export const HATCH_DYNAMIC_PATH =
  "Non-literal source path — unverified / not in declarative export";
export const HATCH_OUT_OF_DIALECT_HBS =
  "Handlebars outside VMS-Hbs — unverified / not in declarative export";
export const HATCH_OUT_OF_DIALECT_GO =
  "Go template outside VMS-Go — unverified / not in declarative export";
export const HATCH_EXECUTABLE_LANG =
  "Executable Code text language — unverified / not in declarative export";

const AD_HOC_TREE_TYPES = new Set(["json_object", "xml_element", "xml_document"]);

/** True when EXPRESSION is a static path (JSONPath, XPath, FLAT key, relative). */
export function isLiteralSourcePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return true;
  if (isPlaceholderSourcePath(trimmed)) return true;
  // Dynamic / computed forms authors may type into the free-text field.
  if (/\b(concat|string-join|substring|replace|encode-for-uri)\s*\(/i.test(trimmed)) {
    return false;
  }
  if (trimmed.includes("`")) return false;
  if (compileLiteralPath(trimmed, "string-at")) return true;
  if (trimmed.startsWith("$") && jsonDollarPathToLookup(trimmed)) return true;
  if (trimmed === "." || trimmed.startsWith("./") || trimmed.startsWith("/")) return true;
  // FLAT / dotted keys without function-call syntax (chemo / lung paths).
  if (/^[\w.|\[\]/"'µà-üÀ-Ü\s-]+$/u.test(trimmed) && !trimmed.includes("(")) {
    return true;
  }
  return false;
}

/**
 * Hatch / dialect warning lines for one block (Constraint warning family).
 * Empty when the block is VMS-clean (including in-dialect Handlebars / Go).
 */
export function blockHatchMessages(block: Block): string[] {
  const messages: string[] = [];

  if (isVmsRemovedBlockType(block.type)) {
    messages.push(HATCH_REMOVED);
    return messages;
  }

  if (block.type === INCLUDE_WHEN_BLOCK) {
    const when = block.getInputTargetBlock("WHEN");
    if (when && conditionHasEscape(when)) {
      messages.push("Include when condition uses an escape block — unverified / not in declarative export");
    }
  }

  if (AD_HOC_TREE_TYPES.has(block.type)) {
    messages.push(HATCH_JSON_XML);
    return messages;
  }

  if (isSourceQueryBlockType(block.type)) {
    const expr = String(block.getFieldValue("EXPRESSION") || "");
    if (!isPlaceholderSourcePath(expr) && !isLiteralSourcePath(expr)) {
      messages.push(HATCH_DYNAMIC_PATH);
    }
    return messages;
  }

  if (block.type === "text_handlebars") {
    const script = scriptTextFromHandlebarsBlock(block);
    if (script != null && script.trim() && !checkVmsHbs(script).ok) {
      messages.push(HATCH_OUT_OF_DIALECT_HBS);
    }
    return messages;
  }

  if (block.type === "text_code") {
    const lang = String(block.getFieldValue("LANG") || "");
    const text = String(block.getFieldValue("TEXT") || "");
    if (lang === "javascript" || lang === "typescript") {
      messages.push(HATCH_EXECUTABLE_LANG);
      return messages;
    }
    if (lang === "handlebars" && text.trim() && !checkVmsHbs(text).ok) {
      messages.push(HATCH_OUT_OF_DIALECT_HBS);
      return messages;
    }
    if (lang === "go-template" && text.trim()) {
      const result = checkVmsGoSync(text);
      if (!result.ok) messages.push(HATCH_OUT_OF_DIALECT_GO);
      return messages;
    }
    // plain / json / xml / html: data literals, not executable hatches
    return messages;
  }

  return messages;
}

function conditionHasEscape(block: Block | null): boolean {
  if (!block) return false;
  if (isVmsEscapeBlockType(block.type) || isVmsRemovedBlockType(block.type)) return true;
  for (const input of block.inputList) {
    if (conditionHasEscape(block.getInputTargetBlock(input.name))) return true;
  }
  return conditionHasEscape(block.getNextBlock());
}

function scriptTextFromHandlebarsBlock(block: Block): string | null {
  const scriptBlock = block.getInputTargetBlock("SCRIPT");
  if (!scriptBlock) return null;
  if (scriptBlock.type === "text_code" || scriptBlock.type === "text") {
    return String(scriptBlock.getFieldValue("TEXT") || "");
  }
  return null;
}

/** Whether a text_code / text_handlebars should be recorded as Mapping Model hatch. */
export function isTemplateEscapeHatch(
  kind: "text_code" | "text_handlebars",
  lang: string | undefined,
  text: string,
): boolean {
  if (kind === "text_handlebars") {
    return Boolean(text.trim()) && !checkVmsHbs(text).ok;
  }
  if (lang === "javascript" || lang === "typescript") return true;
  if (lang === "handlebars") {
    return Boolean(text.trim()) && !checkVmsHbs(text).ok;
  }
  if (lang === "go-template") {
    if (!text.trim()) return false;
    return !checkVmsGoSync(text).ok;
  }
  return false;
}
