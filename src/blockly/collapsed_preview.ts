/**
 * ZipEHR-style HTML for a collapsed Blockly block (#101).
 *
 * openEHR nodes reuse ehrtslib emoji tags (`o-👀`, `o-🔹`, …). Mapping
 * expressions become colour chips. Identifier bloat stays on data attributes
 * for hover, not in the visible line.
 */
import type { Block } from "blockly/core";
import { SYMBOL_TABLE_EMOJI_SYMBOLS } from "ehrtslib/serialization/zipehr/symbol_table.ts";
import { zipehrEmojiForRmType } from "../core/rm_emoji.ts";
import { blockConstraintMessages, warningTextOf } from "./block_constraints.ts";
import {
  isDataValueBlock,
  isRmContainerBlockType,
  rmTypeOfBlock,
} from "./blocks/rm_blocks.ts";
import { humanizeRmType } from "./field_skeleton_title.ts";
import {
  isGenericValueBlockType,
  isSchemaStructureBlock,
  JSON_BLOCK_TYPES,
  XML_BLOCK_TYPES,
} from "./blocks/target_blocks.ts";
import { isTermPickBlock } from "./blocks/term_pick.ts";
import { MAPS_CREATE_WITH } from "../core/defaults/extract.ts";
import { termPickDropdownOptions } from "../core/openehr_term_catalog.ts";
import { labelForPickValue } from "../ui/searchable_pick.ts";
import { XML_ELEMENT_TYPE, XML_ATTRIBUTE_TYPE, XML_DOCUMENT_TYPE } from "../core/xml_shape.ts";
import { isSourceQueryBlockType } from "./source_query.ts";
import { isLoopBlockType } from "./loop_block.ts";

const EMOJI = SYMBOL_TABLE_EMOJI_SYMBOLS as Record<string, string>;

const HIDDEN_FIELDS = new Set([
  "SLOT_ID",
  "RM_TYPE",
  "MANDATORY",
  "ARCHETYPE_NODE_ID",
  "ARCHETYPE_CTX",
  "TARGET_TYPE",
  "RETURN_TYPE",
  "INSTANCE_ENCODING",
  "LANG",
]);

const SKIP_INPUTS = new Set([
  "HEADER",
  "ENCODING",
  "EDITOR",
  "GRID_PREVIEW",
  "_TEMP_COLLAPSED_INPUT",
]);

const LITERAL_BLOCK_TYPES = new Set([
  "math_number",
  "text",
  "text_code",
  "logic_boolean",
  "json_null",
]);

export function shortArchetypeLabel(block: Block): string {
  const nodeId = String(block.getFieldValue("ARCHETYPE_NODE_ID") || "").trim();
  if (/^openEHR-EHR-[A-Z0-9_]+\./i.test(nodeId)) {
    const parts = nodeId.split(".");
    if (parts.length >= 2) return parts.slice(1).join(".");
  }
  return String(block.getFieldValue("ARCHETYPE_CTX") || "").trim();
}

const MAX_COLLAPSED_NODES = 32;
let collapsedBudget = MAX_COLLAPSED_NODES;

export function collapsedHtmlForBlock(block: Block): string {
  const prevBudget = collapsedBudget;
  collapsedBudget = MAX_COLLAPSED_NODES;
  try {
    return `<span class="collapsed-preview">${renderBlock(block)}</span>`;
  } finally {
    collapsedBudget = prevBudget;
  }
}

function renderBlock(block: Block): string {
  if (collapsedBudget <= 0) {
    return `<span class="collapsed-ellipsis">…</span>`;
  }
  collapsedBudget -= 1;
  if (isTermPickBlock(block)) return renderTermPick(block);
  if (block.type === MAPS_CREATE_WITH) return renderMapBlock(block);
  if (isOpenEhrBlock(block)) return renderRmBlock(block);
  if (isValueExpression(block)) return renderValue(block);
  return renderGenericBlock(block);
}

function isOpenEhrBlock(block: Block): boolean {
  return isRmContainerBlockType(block.type) || isCollapsedDataValue(block);
}

/**
 * Collapsed preview treats `element` as ELEMENT even when an older canvas
 * stored the value DV_* in `RM_TYPE` (#162, #187).
 */
function isCollapsedDataValue(block: Block): boolean {
  if (block.type === "element" || isRmContainerBlockType(block.type)) return false;
  return isDataValueBlock(block);
}

function collapsedRmType(block: Block): string {
  if (block.type === "element") return "ELEMENT";
  if (isRmContainerBlockType(block.type)) {
    const fromField = String(block.getFieldValue("RM_TYPE") || "").toUpperCase();
    if (fromField && !fromField.startsWith("DV_")) return fromField;
    return block.type.toUpperCase();
  }
  return rmTypeOfBlock(block) || block.type.toUpperCase();
}

/** Ontology NAME when present; archetype short id only on C_ARCHETYPE_ROOT. */
function rmVisibleTitle(block: Block, rmType: string): string {
  // Node names such as "Rate" stay on ELEMENT, not the nested DV_* (#187).
  if (block.type !== "element" && isDataValueBlock(block)) return "";
  const nameField = block.getField("NAME");
  const name = (nameField?.getText?.() ?? String(block.getFieldValue("NAME") || "")).trim();
  const generic = new Set(
    [rmType, humanizeRmType(rmType), block.type, block.type.replace(/_/g, " ")]
      .map((item) => item.toLowerCase()),
  );
  if (name && !generic.has(name.toLowerCase())) return name;
  const nodeId = String(block.getFieldValue("ARCHETYPE_NODE_ID") || "").trim();
  if (/^openEHR-EHR-[A-Z0-9_]+\./i.test(nodeId)) return shortArchetypeLabel(block);
  return "";
}

function isValueExpression(block: Block): boolean {
  if (isSourceQueryBlockType(block.type)) return true;
  if (LITERAL_BLOCK_TYPES.has(block.type)) return true;
  if (block.type === "variables_get" || block.type === "maps_get") return true;
  if (block.outputConnection && !isOpenEhrBlock(block) && !isStructuralGeneric(block)) {
    return !block.previousConnection;
  }
  return false;
}

function isStructuralGeneric(block: Block): boolean {
  if (isSchemaStructureBlock(block) || isGenericValueBlockType(block.type)) return true;
  if ((JSON_BLOCK_TYPES as readonly string[]).includes(block.type)) return true;
  if ((XML_BLOCK_TYPES as readonly string[]).includes(block.type)) return true;
  if (isLoopBlockType(block.type)) return true;
  return false;
}

function renderRmBlock(block: Block): string {
  const rmType = collapsedRmType(block);
  const glyph = zipehrEmojiForRmType(rmType) ?? rmType;
  const tag = rmCustomTag(rmType);
  const atCode = locatableId(block);
  const colour = blockColour(block);
  const attrs = [
    `class="collapsed-node collapsed-rm"`,
    `data-collapsed-node="1"`,
    `data-glyph="${escapeAttr(glyph)}"`,
    `data-rm-type="${escapeAttr(rmType)}"`,
  ];
  if (atCode) attrs.push(`data-at-code="${escapeAttr(atCode)}"`);
  attrs.push(`aria-label="${escapeAttr(hoverText(rmType, atCode))}"`);
  attrs.push(`style="--collapsed-colour:${escapeAttr(colour)}"`);

  const inner: string[] = [];
  inner.push(warningBadge(block));
  const title = rmVisibleTitle(block, rmType);
  if (title) inner.push(escapeHtml(title));
  if (isCollapsedDataValue(block)) {
    inner.push(renderDvContents(block, rmType));
  } else {
    inner.push(renderChildInputs(block));
  }
  return `<${tag} ${attrs.join(" ")}>${inner.join("")}</${tag}>`;
}

function renderTermPick(block: Block): string {
  const rmType = rmTypeOfBlock(block) || "CODE_PHRASE";
  const glyph = zipehrEmojiForRmType(rmType) ?? rmType;
  const tag = rmCustomTag(rmType);
  const setId = String(block.getFieldValue("SET") || "");
  const code = String(block.getFieldValue("CODE") || "");
  const pickLabel = labelForPickValue(termPickDropdownOptions(setId), code);
  const colour = blockColour(block);
  const attrs = [
    `class="collapsed-node collapsed-rm collapsed-term-pick"`,
    `data-collapsed-node="1"`,
    `data-glyph="${escapeAttr(glyph)}"`,
    `data-rm-type="${escapeAttr(rmType)}"`,
    `aria-label="${escapeAttr(pickLabel || rmType)}"`,
    `style="--collapsed-colour:${escapeAttr(colour)}"`,
  ];
  const inner = [warningBadge(block)];
  if (pickLabel && pickLabel !== "choose…") inner.push(escapeHtml(pickLabel));
  return `<${tag} ${attrs.join(" ")}>${inner.join("")}</${tag}>`;
}

function renderMapBlock(block: Block): string {
  const tag = genericTag(block);
  const glyph = genericGlyph(block);
  const colour = blockColour(block);
  const extras = hiddenExtras(block);
  const attrs = [
    `class="collapsed-node collapsed-generic collapsed-map"`,
    `data-collapsed-node="1"`,
    `data-glyph="${escapeAttr(glyph)}"`,
    `data-tag="${escapeAttr(block.type)}"`,
    `aria-label="${escapeAttr(genericHover(glyph, block.type, extras))}"`,
    `style="--collapsed-colour:${escapeAttr(colour)}"`,
  ];
  if (extras) attrs.push(`data-extra="${escapeAttr(extras)}"`);
  const pairs: string[] = [warningBadge(block)];
  for (const input of block.inputList) {
    if (!input.name.startsWith("VAL")) continue;
    const index = input.name.slice(3);
    const key = String(block.getFieldValue(`KEY${index}`) || "");
    const child = input.connection?.targetBlock();
    const value = child ? renderValueRoot(child) : "";
    pairs.push(
      `<span class="collapsed-map-pair">${escapeHtml(key)}:${value}</span>`,
    );
  }
  return `<${tag} ${attrs.join(" ")}>${pairs.join("")}</${tag}>`;
}

/** First-level value only — not nested map/list contents. */
function renderValueRoot(block: Block): string {
  if (isValueExpression(block) || LITERAL_BLOCK_TYPES.has(block.type)) {
    return renderValue(block);
  }
  if (isTermPickBlock(block)) return renderTermPick(block);
  const glyph = isOpenEhrBlock(block)
    ? (zipehrEmojiForRmType(rmTypeOfBlock(block) || block.type.toUpperCase()) ?? block.type)
    : genericGlyph(block);
  return escapeHtml(glyph);
}

function renderDvContents(block: Block, rmType: string): string {
  if (rmType === "DV_QUANTITY") {
    return [
      renderDvAttrLeaf(block, "magnitude", EMOJI["DV_QUANTITY.magnitude"] ?? "№"),
      renderDvAttrLeaf(block, "units", EMOJI["DV_QUANTITY.units"] ?? "◌"),
    ].join("");
  }
  if (rmType === "DV_PROPORTION") {
    return [
      renderDvAttrLeaf(block, "numerator", "numerator"),
      renderDvAttrLeaf(block, "denominator", "denominator"),
    ].join("");
  }
  if (isTermPickBlock(block)) {
    const code = String(block.getFieldValue("CODE") || "");
    return code ? escapeHtml(code) : "";
  }
  const primary = primaryValueInput(block);
  if (!primary) return renderChildInputs(block);
  const child = block.getInputTargetBlock(primary);
  return child ? renderBlock(child) : "";
}

function renderDvAttrLeaf(block: Block, attr: string, glyph: string): string {
  const child = block.getInputTargetBlock(`FLD_${attr}`) ??
    block.getInputTargetBlock(`OPTFLD_${attr}`);
  if (!child) return "";
  return `<span class="collapsed-leaf" data-collapsed-node="1" data-glyph="${escapeAttr(glyph)}" data-rm-type="${escapeAttr(attr)}" aria-label="${escapeAttr(attr)}">${renderBlock(child)}</span>`;
}

function primaryValueInput(block: Block): string | null {
  for (const name of ["FLD_value", "FLD_magnitude", "FLD_id", "VALUE"]) {
    if (block.getInput(name)) return name;
  }
  for (const input of block.inputList) {
    if (input.connection && input.name.startsWith("FLD_")) return input.name;
  }
  return null;
}

function renderGenericBlock(block: Block): string {
  const tag = genericTag(block);
  const glyph = genericGlyph(block);
  const colour = blockColour(block);
  const extras = hiddenExtras(block);
  const typeLabel = block.type;
  const attrs = [
    `class="collapsed-node collapsed-generic"`,
    `data-collapsed-node="1"`,
    `data-glyph="${escapeAttr(glyph)}"`,
    `data-tag="${escapeAttr(typeLabel)}"`,
    `aria-label="${escapeAttr(genericHover(glyph, typeLabel, extras))}"`,
    `style="--collapsed-colour:${escapeAttr(colour)}"`,
  ];
  if (extras) attrs.push(`data-extra="${escapeAttr(extras)}"`);
  const inner = [warningBadge(block), renderChildInputs(block)];
  return `<${tag} ${attrs.join(" ")}>${inner.join("")}</${tag}>`;
}

function genericGlyph(block: Block): string {
  if (block.type === XML_ELEMENT_TYPE || block.type === XML_ATTRIBUTE_TYPE) {
    return String(block.getFieldValue("NAME") || block.type);
  }
  if (block.type === XML_DOCUMENT_TYPE) return "xml";
  if (isLoopBlockType(block.type)) {
    const name = String(block.getFieldValue("VAR") || "item");
    return `↻ ${name}`;
  }
  const nameField = block.getField("NAME");
  if (nameField) {
    const text = nameField.getText?.() ?? String(block.getFieldValue("NAME") || "");
    if (text) return text;
  }
  return block.type.replace(/_/g, " ");
}

function genericTag(block: Block): string {
  const raw = String(block.getFieldValue("NAME") || block.type)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "node";
  return `g-${raw}`;
}

function genericHover(glyph: string, type: string, extras: string): string {
  const lines = [glyph, type];
  if (extras) {
    for (const part of extras.split("; ")) lines.push(part);
  }
  return lines.filter(Boolean).join("\n");
}

function hiddenExtras(block: Block): string {
  const parts: string[] = [];
  for (const name of HIDDEN_FIELDS) {
    const value = String(block.getFieldValue(name) || "").trim();
    if (!value) continue;
    parts.push(`${name.toLowerCase()}=${value}`);
  }
  return parts.join("; ");
}

function renderChildInputs(block: Block): string {
  const chunks: string[] = [];
  for (const input of block.inputList) {
    if (!input.connection) continue;
    if (SKIP_INPUTS.has(input.name)) continue;
    if (input.name.startsWith("PROHIBITED_")) continue;
    const attr = input.name.replace(/^(ATTR_|OPT_|FLD_|OPTFLD_|TARGET_)/, "");
    if (attr === "name" || attr === "uid" || attr === "archetype_details") continue;
    const first = input.connection.targetBlock();
    if (!first) continue;
    let current: Block | null = first;
    while (current) {
      chunks.push(renderBlock(current));
      current = current.getNextBlock();
    }
  }
  return chunks.join("");
}

function renderValue(block: Block): string {
  if (isSourceQueryBlockType(block.type)) {
    const path = String(block.getFieldValue("EXPRESSION") || "");
    return mappingChip(path, blockColour(block));
  }
  if (block.type === "math_number") {
    return escapeHtml(String(block.getFieldValue("NUM") ?? ""));
  }
  if (block.type === "text" || block.type === "text_code") {
    return escapeHtml(String(block.getFieldValue("TEXT") ?? ""));
  }
  if (block.type === "logic_boolean") {
    return block.getFieldValue("BOOL") === "TRUE" ? "true" : "false";
  }
  if (block.type === "json_null") return "null";
  if (block.type === "variables_get") {
    const name = block.getField("VAR")?.getText() ?? "v";
    return mappingChip(name, blockColour(block));
  }
  if (block.type === "maps_get") {
    const name = String(block.getFieldValue("NAME") || "defaults");
    const keyBlock = block.getInputTargetBlock("KEY");
    const key = keyBlock ? visibleValueText(keyBlock) : "";
    return mappingChip(`${name}[${key}]`, blockColour(block));
  }
  return mappingChip(visibleValueText(block), blockColour(block));
}

function visibleValueText(block: Block): string {
  if (isSourceQueryBlockType(block.type)) {
    return String(block.getFieldValue("EXPRESSION") || "");
  }
  if (block.type === "math_number") return String(block.getFieldValue("NUM") ?? "");
  if (block.type === "text" || block.type === "text_code") {
    return String(block.getFieldValue("TEXT") ?? "");
  }
  const name = block.getField("NAME")?.getText?.();
  if (name) return name;
  return block.type;
}

function mappingChip(text: string, colour: string): string {
  return `<span class="collapsed-mapping" style="--collapsed-colour:${escapeAttr(colour)}">${escapeHtml(text)}</span>`;
}

function warningBadge(block: Block): string {
  const text = warningTextOf(block) || blockConstraintMessages(block).join("\n");
  if (!text) return "";
  return `<span class="collapsed-warning" title="${escapeAttr(text)}" aria-label="${escapeAttr(text)}">!</span>`;
}

function locatableId(block: Block): string {
  return String(block.getFieldValue("ARCHETYPE_NODE_ID") || "").trim();
}

function hoverText(rmType: string, atCode: string): string {
  return [atCode, rmType].filter(Boolean).join(" · ");
}

function rmCustomTag(rmType: string): string {
  const emoji = zipehrEmojiForRmType(rmType);
  if (emoji) return `o-${emoji}`;
  return `o-${rmType.toLowerCase().replace(/_/g, "-")}`;
}

function blockColour(block: Block): string {
  const raw = String(block.getColour?.() ?? "").trim();
  return raw || "#9aa0a6";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
