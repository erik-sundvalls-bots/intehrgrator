/**
 * Blockly workspace → TypeScript conversion script (ehrtslib constructors).
 *
 * Preferred over the skeleton walker when a canvas snapshot is available so
 * Optional RM Insertion, `for_each_list`, and live block edits show up in
 * Generated conversion script(s).
 */

import type { Block, Workspace } from "blockly/core";
import { Blockly } from "./blockly_core.ts";
import { blockToExpression } from "./expression_serialize.ts";
import {
  isDataValueBlock,
  isRmContainerBlockType,
  rmAttributeInputName,
  OPTIONAL_INPUT_PREFIX,
  RM_ATTR_INPUT_PREFIX,
  RM_SPECIALIZATION_INPUT,
  isEventFamilyType,
  isItemStructureFamilyType,
} from "./blocks/rm_blocks.ts";
import { isGenericValueBlockType, isSchemaStructureBlock } from "./blocks/target_blocks.ts";
import { registerSchemaBlocksFromSkeleton } from "./schema_blocks.ts";
import { ensureStockBlocklyMessages } from "./stock_messages.ts";
import { TERM_PICK_BLOCK_TYPE } from "./blocks/term_pick.ts";
import { TERM_PICK_NONE, termSetById } from "../core/openehr_term_catalog.ts";
import { DEFAULTS_BLOCK_TYPE } from "../core/defaults/extract.ts";
import {
  CONVERSION_START_TYPE,
  findInstanceRootUnderStart,
  inferTargetFormatFromRoot,
  isProductLoopBlockType,
  productStackBlocks,
  TEXT_DOCUMENT_BLOCK_TYPE,
} from "./instance_root.ts";
import { attributesFor, isPrimitiveRmType } from "../core/rm_meta.ts";
import { LOCATABLE_TYPES, NON_LOCATABLE_RM_TYPES } from "../core/rm_mandatory.ts";
import type { InstanceEncoding, MappingModel } from "../types/mod.ts";
import {
  asStringExpr,
  createTsEmitContext,
  emitCodePhraseLiteral,
  codePhraseTerseSafe,
  emitTsExpressionSource,
  emitTsUserFunctions,
  formatObjectLiteral,
  formatRmConstruct,
  generateTypeScriptFromSkeleton,
  generateTypeScriptFromSlots,
  indentTsBlock,
  isBlankGeneratedExpr,
  isListAttribute,
  wrapTypeScriptModule,
  type TsEmitContext,
} from "../core/codegen/typescript.ts";
import { registerExportTargetAdapter } from "../core/codegen/mod.ts";
import {
  archetypeRootIdBySlot,
  outputLocatableName,
  propsLackClinicalContent,
} from "../core/openehr/rm_archetype_node_id.ts";
import { labelSlotId, walkSkeleton } from "./block_labels.ts";
import { runWithoutBlocklyEvents } from "./blockly_events.ts";
import { isLoopBlockType, loopIndexBinderName, loopLengthBinderName, sourcePathFromLoopList } from "./loop_block.ts";
import { migrateForEachSourceState } from "./migrate_for_each_source.ts";
import {
  INSTANCE_ENCODING_FIELD,
  parseInstanceEncoding,
} from "../core/output/instance_encoding.ts";

const STATEMENT_INPUT_TYPE = 3;

export function registerTypeScriptExportAdapter(): void {
  registerExportTargetAdapter({
    id: "typescript",
    extension: "ts",
    mime: "text/typescript",
    generate(model, options) {
      if (options?.blocklyState) {
        const fromCanvas = generateTypeScriptFromBlocklyState(
          options.blocklyState,
          model,
          options.skeleton,
          options.webTemplateJson,
        );
        if (fromCanvas) return fromCanvas;
      }
      if (options?.skeleton?.length) {
        return generateTypeScriptFromSkeleton(model, options.skeleton);
      }
      return generateTypeScriptFromSlots(model);
    },
  });
}

export function generateTypeScriptFromBlocklyState(
  state: unknown,
  model: MappingModel,
  skeleton?: import("../types/mod.ts").SkeletonNode[],
  webTemplateJson?: string,
): string | null {
  if (!state || typeof state !== "object") return null;
  const workspace = new Blockly.Workspace();
  try {
    const snapshot = migrateForEachSourceState(
      JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
    );
    let generated: string | null = null;
    runWithoutBlocklyEvents(() => {
      ensureStockBlocklyMessages();
      if (skeleton?.length) registerSchemaBlocksFromSkeleton(skeleton);
      Blockly.serialization.workspaces.load(snapshot, workspace);
      generated = generateTypeScriptFromWorkspace(workspace, model, webTemplateJson, skeleton);
    });
    return generated;
  } catch (err) {
    console.warn("TypeScript codegen from Blockly failed; falling back to skeleton", err);
    return null;
  } finally {
    workspace.dispose();
  }
}

export function generateTypeScriptFromWorkspace(
  workspace: Workspace,
  model: MappingModel,
  webTemplateJson?: string,
  skeleton?: import("../types/mod.ts").SkeletonNode[],
): string | null {
  const ctx = createTsEmitContext("sourceCtx.data", model.functions);
  if (skeleton?.length) {
    ctx.archetypeRootIds = archetypeRootIdBySlot(skeleton);
    ctx.skeletonNodes = new Map();
    walkSkeleton(skeleton, (node) => ctx.skeletonNodes!.set(node.slotId, node));
  }
  const instanceRoot = findInstanceRootUnderStart(workspace);
  const roots = workspace.getTopBlocks(true).filter((block) =>
    block.type !== DEFAULTS_BLOCK_TYPE &&
    block.type !== "default_context_map" &&
    block.type !== "maps_create_with" &&
    block.type !== CONVERSION_START_TYPE &&
    block.type !== "procedures_defreturn" &&
    block.type !== "procedures_defnoreturn"
  );
  const stack = productStackBlocks(workspace);
  const composition = instanceRoot?.type === "composition" ? instanceRoot
    : roots.find((block) => block.type === "composition") ??
      roots.find((block) => isRmContainerBlockType(block.type));

  const targetFormat = model.targetFormat ??
    (instanceRoot ? inferTargetFormatFromRoot(instanceRoot) : undefined);

  const extraImports = new Set<string>();
  let body: string;
  let rootType: string | undefined;
  const stacked = stack.length > 1 || stack.some((block) => isProductLoopBlockType(block.type));
  const encoding = stack[0]?.type === "composition"
    ? parseInstanceEncoding(stack[0].getFieldValue(INSTANCE_ENCODING_FIELD))
    : parseInstanceEncoding(model.instanceEncodings?.[0]);

  if (stacked && stack.length) {
    body = emitJuxtaposedStack(stack, ctx, extraImports, webTemplateJson);
    rootType = "string";
  } else if (instanceRoot?.type === TEXT_DOCUMENT_BLOCK_TYPE) {
    const value = instanceRoot.getInputTargetBlock("VALUE");
    body = value ? `return ${emitBlock(value, ctx, 0)};` : 'return "";';
  } else if (composition) {
    const code = emitBlock(composition, ctx, 0);
    rootType = rmTypeOf(composition);
    if (rootType === "COMPOSITION" && encoding === "canonical-json") {
      body = `const composition = ${code};\nreturn composition;`;
    } else if (rootType === "COMPOSITION") {
      body = `const composition = ${code};\nreturn ${
        tsSerializeCall("composition", encoding, extraImports, webTemplateJson)
      };`;
      rootType = "string";
    } else {
      body = `return ${code};`;
    }
  } else if (instanceRoot && (
    isSchemaStructureBlock(instanceRoot) ||
    instanceRoot.type === "json_object" ||
    instanceRoot.type === "xml_element" ||
    instanceRoot.type === "xml_document"
  )) {
    body = `return ${emitGeneric(instanceRoot, ctx, 0)};`;
  } else if (targetFormat && targetFormat !== "openehr-template") {
    const generic = instanceRoot ?? roots.find((block) =>
      isSchemaStructureBlock(block) || block.type === "json_object" ||
      block.type === "xml_element" || block.type === "xml_document"
    );
    if (generic) {
      body = `return ${emitGeneric(generic, ctx, 0)};`;
    } else {
      return null;
    }
  } else {
    return null;
  }

  return wrapTypeScriptModule({
    templateId: model.templateId,
    body: `${emitTsUserFunctions(ctx)}${body}`,
    types: ctx.types,
    helpers: ctx.helpers,
    rootType,
    source: "blockly",
    extraImports: [...extraImports],
  });
}

function emitJuxtaposedStack(
  stack: Block[],
  ctx: TsEmitContext,
  extraImports: Set<string>,
  webTemplateJson?: string,
): string {
  const lines = ["const parts: string[] = [];"];
  for (const block of stack) {
    lines.push(emitFragmentPush(block, ctx, extraImports, webTemplateJson));
  }
  lines.push('return parts.join("");');
  return lines.join("\n");
}

function emitFragmentPush(
  block: Block,
  ctx: TsEmitContext,
  extraImports: Set<string>,
  webTemplateJson?: string,
): string {
  if (block.type === "for_each_list") {
    const name = String(block.getFieldValue("VAR") || "item");
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "__item";
    const sourcePath = sourcePathFromLoopList(block);
    const inner: string[] = [];
    ctx.helpers.add("logic");
    if (sourcePath) {
      ctx.helpers.add("nodes");
      const innerCtx: TsEmitContext = { ...ctx, sourceVar: ident, loopVar: ident };
      let body = block.getInputTargetBlock("DO");
      while (body) {
        inner.push(emitFragmentPush(body, innerCtx, extraImports, webTemplateJson));
        body = body.getNextBlock();
      }
      return emitTsIndexedFor(name, ident, `xpathNodes(${JSON.stringify(sourcePath)})`, inner);
    }
    const listBlock = block.getInputTargetBlock("LIST");
    const list = listBlock ? emitBlock(listBlock, ctx, 0) : "[]";
    const innerCtx: TsEmitContext = { ...ctx, loopVar: ident };
    let body = block.getInputTargetBlock("DO");
    while (body) {
      inner.push(emitFragmentPush(body, innerCtx, extraImports, webTemplateJson));
      body = body.getNextBlock();
    }
    return emitTsIndexedFor(name, ident, `(Array.isArray(${list}) ? ${list} : [])`, inner);
  }
  if (block.type === TEXT_DOCUMENT_BLOCK_TYPE) {
    const value = block.getInputTargetBlock("VALUE");
    const expr = value ? emitBlock(value, ctx, 0) : '""';
    return `parts.push(String(${expr} ?? ""));`;
  }
  if (block.type === "composition") {
    const encoding = parseInstanceEncoding(block.getFieldValue(INSTANCE_ENCODING_FIELD));
    const code = emitBlock(block, ctx, 0);
    return `parts.push(${tsSerializeCall(code, encoding, extraImports, webTemplateJson)});`;
  }
  if (
    isSchemaStructureBlock(block) ||
    block.type === "json_object" ||
    block.type === "xml_element" ||
    block.type === "xml_document"
  ) {
    const code = emitGeneric(block, ctx, 0);
    return `parts.push(typeof (${code}) === "string" ? String((${code}) ?? "") : JSON.stringify((${code}) ?? null));`;
  }
  const fallback = emitBlock(block, ctx, 0);
  return `parts.push(typeof (${fallback}) === "string" ? String((${fallback}) ?? "") : JSON.stringify((${fallback}) ?? null));`;
}

function tsSerializeCall(
  valueExpr: string,
  encoding: InstanceEncoding,
  extraImports: Set<string>,
  webTemplateJson?: string,
): string {
  if (encoding === "canonical-xml") {
    extraImports.add('import { XmlSerializer } from "ehrtslib/serialization/xml/mod.ts";');
    return `new XmlSerializer({ prettyPrint: true }).serialize(${valueExpr})`;
  }
  if (encoding === "flat-json" || encoding === "structured-json") {
    extraImports.add(
      'import { parseWebTemplate, serializeToFlatJson, serializeToStructuredJson } from "ehrtslib/serialization/simplified/mod.ts";',
    );
    if (!webTemplateJson?.trim()) {
      return `(() => { throw new Error(${
        JSON.stringify(`${encoding} Instance encoding needs a Web Template on the openEHR target`)
      }); })()`;
    }
    const parsed = JSON.stringify(JSON.parse(webTemplateJson));
    const fn = encoding === "flat-json" ? "serializeToFlatJson" : "serializeToStructuredJson";
    return `${fn}(${valueExpr}, parseWebTemplate(${parsed}), { prettyPrint: true })`;
  }
  extraImports.add('import { JsonCanonicalSerializer } from "ehrtslib/serialization/json/mod.ts";');
  return `new JsonCanonicalSerializer().serialize(${valueExpr})`;
}

/** Test-only export for VMS undefined guard tests. */
export function emitBlockForVmsTest(
  block: Block,
  ctx: TsEmitContext = createTsEmitContext(),
): string {
  return emitBlock(block, ctx, 0);
}

function emitBlock(block: Block, ctx: TsEmitContext, indent: number): string {
  if (block.type === TERM_PICK_BLOCK_TYPE) return emitTermPick(block, ctx);
  const fromExpr = emitExpressionBlock(block, ctx);
  if (fromExpr !== null) return wrapCodePhraseSlotEmit(block, fromExpr);

  if (block.type === "for_each_list") return emitForEachList(block, ctx, indent);
  if (block.type === "code_phrase") return emitCodePhrase(block, ctx, indent);
  if (block.type === "party_ref") return emitPartyRef(block, ctx, indent);
  if (block.type === "party_identified" || block.type === "party_related") {
    return emitRmContainer(block, ctx, indent);
  }
  if (block.type === "party_self") {
    ctx.types.add("PARTY_SELF");
    return "new PARTY_SELF()";
  }
  if (block.type === "party_proxy") {
    const kind = block.getInputTargetBlock(RM_SPECIALIZATION_INPUT);
    if (kind) return emitBlock(kind, ctx, indent);
    ctx.types.add("PARTY_SELF");
    return "new PARTY_SELF()";
  }
  if (block.type === "lists_getIndex") return emitListsGetIndex(block, ctx);
  if (block.type === "lists_create_with") return emitListsCreate(block, ctx);
  if (block.type === "element" || isRmContainerBlockType(block.type)) {
    return emitRmContainer(block, ctx, indent);
  }
  if (isDataValueBlock(block)) return emitDvShell(block, ctx, indent);
  if (isGenericValueBlockType(block.type) || isSchemaStructureBlock(block)) {
    return emitGeneric(block, ctx, indent);
  }
  return "undefined /* unhandled block type: " + block.type + " */";
}

function emitExpressionBlock(block: Block, ctx: TsEmitContext): string | null {
  const serialized = blockToExpression(block);
  if (!serialized) return null;
  return emitTsExpressionSource(serialized, ctx);
}

function emitRmContainer(block: Block, ctx: TsEmitContext, indent: number): string {
  const rmType = rmTypeOf(block);
  const props = collectRmProps(block, ctx, indent);
  if (rmType !== "COMPOSITION" && propsLackClinicalContent(props)) {
    if (rmType === "PARTY_SELF") {
      ctx.types.add("PARTY_SELF");
      return "new PARTY_SELF()";
    }
    return "";
  }
  if (ENTRY_RM_TYPES.has(rmType)) ensureEntrySubject(props, ctx);
  return formatRmConstruct(rmType, props, indent, ctx);
}

/** RM ENTRY subtypes: `subject` is mandatory (RM 1.1 ENTRY). */
const ENTRY_RM_TYPES = new Set(["OBSERVATION", "EVALUATION", "INSTRUCTION", "ACTION", "ADMIN_ENTRY"]);

/**
 * ENTRY.subject is mandatory. Without a mapping the subject is the record's
 * owner (PARTY_SELF), as in the preview output; a Default point that may be
 * missing at run time falls back to PARTY_SELF too (#310).
 */
function ensureEntrySubject(props: Array<[string, string]>, ctx: TsEmitContext): void {
  if (props.some(([key]) => key === "subject")) return;
  ctx.types.add("PARTY_SELF");
  props.push(["subject", "new PARTY_SELF()"]);
}

function collectRmProps(
  block: Block,
  ctx: TsEmitContext,
  indent: number,
): Array<[string, string]> {
  const rmType = rmTypeOf(block);
  const props: Array<[string, string]> = [];
  const slotId = String(block.getFieldValue("SLOT_ID") ?? "").trim();
  const name = outputLocatableName(
    String(block.getFieldValue("NAME") ?? "").trim(),
    ctx.skeletonNodes?.get(labelSlotId(block)),
  );
  const nodeId = ctx.archetypeRootIds?.get(slotId) ||
    String(block.getFieldValue("ARCHETYPE_NODE_ID") ?? "").trim();
  if (name && shouldEmitLocatableName(rmType, name)) {
    props.push([
      "name",
      rmType === "COMPOSITION"
        ? JSON.stringify(name)
        : (ctx.types.add("DV_TEXT"), `new DV_TEXT(${JSON.stringify(name)})`),
    ]);
  }
  if (nodeId && !NON_LOCATABLE_RM_TYPES.has(rmType)) {
    props.push(["archetype_node_id", JSON.stringify(nodeId)]);
  }

  if (block.type === "element") {
    const value = block.getInputTargetBlock("VALUE");
    if (value && !value.isShadow()) {
      const code = emitBlock(value, ctx, indent + 1);
      if (!isBlankGeneratedExpr(code)) props.push(["value", code]);
    }
  }

  const seen = new Set<string>();
  for (const input of block.inputList) {
    const attr = input.name.startsWith(RM_ATTR_INPUT_PREFIX)
      ? input.name.slice(RM_ATTR_INPUT_PREFIX.length)
      : input.name.startsWith(OPTIONAL_INPUT_PREFIX)
      ? input.name.slice(OPTIONAL_INPUT_PREFIX.length)
      : "";
    if (!attr) continue;
    if (seen.has(attr)) continue;
    seen.add(attr);
    const code = emitAttribute(block, input.name, attr, rmType, ctx, indent);
    if (code && !isBlankGeneratedExpr(code)) props.push([attr, code]);
  }
  return props;
}

function emitAttribute(
  block: Block,
  inputName: string,
  attr: string,
  parentRmType: string,
  ctx: TsEmitContext,
  indent: number,
): string | null {
  const input = block.getInput(inputName);
  if (!input) return null;
  if (input.type === STATEMENT_INPUT_TYPE) {
    return emitStatementList(
      block.getInputTargetBlock(inputName),
      isListAttribute(parentRmType, attr),
      ctx,
      indent,
    );
  }
  const target = block.getInputTargetBlock(inputName);
  if (!target || target.isShadow()) return null;
  if (target.type === "lists_create_with") {
    return emitListsCreate(target, ctx);
  }
  if (isListAttribute(parentRmType, attr)) {
    const code = emitBlock(target, ctx, indent + 1);
    if (!code || isBlankGeneratedExpr(code)) return null;
    return `[${code}]`;
  }
  const simplified = emitSimplifiedParty(attr, target, ctx, indent);
  if (simplified) return simplified;
  let code = emitBlock(target, ctx, indent + 1);
  code = wrapCodePhraseAttributeEmit(attr, parentRmType, target, code);
  code = wrapPartyDefaultEmit(attr, parentRmType, code, ctx);
  return isBlankGeneratedExpr(code) ? null : code;
}

/**
 * A party Default point (`defaults["composer"]`) may hold a name string, an
 * old `{ rmType }` literal or a canonical `{ _type }` object: normalise it to
 * canonical openEHR JSON at run time (#310).
 */
function wrapPartyDefaultEmit(
  attr: string,
  parentRmType: string,
  code: string,
  ctx: TsEmitContext,
): string {
  if (isBlankGeneratedExpr(code) || !/^defaults\[[^\]]+\]$/.test(code.trim())) return code;
  const attrMeta = attributesFor(parentRmType).find((item) => item.name === attr);
  const attrType = attrMeta?.typeName ? baseRmTypeName(attrMeta.typeName) : "";
  if (!attrType.startsWith("PARTY_")) return code;
  ctx.helpers.add("party");
  const fallback = attr === "subject" ? "PARTY_SELF" : "PARTY_IDENTIFIED";
  return `partyValue(${code}, ${JSON.stringify(fallback)})`;
}

function wrapCodePhraseSlotEmit(block: Block, code: string): string {
  const rmType = String(block.getFieldValue("RM_TYPE") ?? "").toUpperCase();
  if (rmType !== "CODE_PHRASE") return code;
  return wrapCodePhraseValue(code, String(block.getFieldValue("SLOT_ID") ?? ""));
}

function wrapCodePhraseAttributeEmit(
  attr: string,
  parentRmType: string,
  target: Block,
  code: string,
): string {
  if (isBlankGeneratedExpr(code)) return code;
  const attrMeta = attributesFor(parentRmType).find((item) => item.name === attr);
  const attrType = attrMeta?.typeName ? baseRmTypeName(attrMeta.typeName) : "";
  if (attrType !== "CODE_PHRASE" && target.type !== "code_phrase") return code;
  if (code.includes("::") || code.includes("CODE_PHRASE")) return code;
  return wrapCodePhraseValue(code, String(target.getFieldValue("SLOT_ID") ?? ""), attr);
}

function wrapCodePhraseValue(code: string, slotId: string, attrName = ""): string {
  if (code.includes("::") || code.includes("CODE_PHRASE")) return code;
  const term = codePhraseTerminology(slotId, attrName);
  if (!term) return code;
  return "`" + escapeTemplate(term) + "::${String(" + code + ' ?? "")}`';
}

function codePhraseTerminology(slotId: string, attrName: string): string | null {
  if (slotId.includes("//language/") || attrName === "language") return "ISO_639-1";
  if (slotId.includes("//territory/") || attrName === "territory") return "ISO_3166-1";
  if (slotId.includes("//encoding/") || attrName === "encoding") return "IANA_character-sets";
  return null;
}

function baseRmTypeName(typeName: string): string {
  const list = typeName.match(/^List<(.+)>$/);
  if (list) return baseRmTypeName(list[1]!);
  return typeName;
}

function emitSimplifiedParty(
  attr: string,
  block: Block,
  ctx: TsEmitContext,
  indent: number,
): string | null {
  if (attr !== "composer" && attr !== "health_care_facility") return null;
  if (block.type !== "party_identified" && block.type !== "party_related") return null;
  const nameBlock = block.getInputTargetBlock(rmAttributeInputName("name"));
  const name = nameBlock && !nameBlock.isShadow()
    ? emitBlock(nameBlock, ctx, indent + 1)
    : null;
  const identBlock = block.getInputTargetBlock(rmAttributeInputName("identifiers"));
  let identifiers: string | null = null;
  if (identBlock && !identBlock.isShadow()) {
    identifiers = identBlock.type === "lists_create_with"
      ? emitListsCreate(identBlock, ctx)
      : `[${emitBlock(identBlock, ctx, indent + 1)}]`;
    if (isBlankGeneratedExpr(identifiers)) identifiers = null;
  }
  if (!name && !identifiers) return null;
  const parts: string[] = [];
  if (name) parts.push(`name: ${asStringExpr(name)}`);
  if (identifiers) parts.push(`identifiers: ${identifiers}`);
  // Canonical `_type` so ehrtslib builds a PARTY_IDENTIFIED for the abstract PARTY_PROXY slot.
  return `{ _type: "PARTY_IDENTIFIED", ${parts.join(", ")} }`;
}

function emitStatementList(
  first: Block | null,
  asList: boolean,
  ctx: TsEmitContext,
  indent: number,
): string | null {
  const blocks: Block[] = [];
  let current = first;
  while (current) {
    blocks.push(current);
    current = current.getNextBlock();
  }
  if (!blocks.length) return null;
  const asArray = asList || blocks.length > 1 ||
    blocks.some((block) => isLoopBlockType(block.type));
  if (!asArray) {
    const code = emitBlock(blocks[0]!, ctx, indent + 1);
    return isBlankGeneratedExpr(code) ? null : code;
  }
  const parts: string[] = [];
  for (const block of blocks) {
    const code = block.type === "for_each_list"
      ? emitForEachList(block, ctx, 0)
      : block.type === "variables_set"
      ? emitVariableSet(block, ctx, indent + 1)
      : emitBlock(block, ctx, 0);
    if (!isBlankGeneratedExpr(code)) parts.push(indentTsBlock(code, indent + 2));
  }
  if (!parts.length) return null;
  return `[\n${parts.join(",\n")},\n${"  ".repeat(indent + 1)}]`;
}

function emitTsLoopBind(name: string, ident: string): string {
  return (
    `__vars[${JSON.stringify(name)}] = ${ident}, ` +
    `__vars[${JSON.stringify(loopIndexBinderName(name))}] = ${ident}_i, ` +
    `__vars[${JSON.stringify(loopLengthBinderName(name))}] = ${ident}_col.length,`
  );
}

function emitTsIndexedFor(
  name: string,
  ident: string,
  collection: string,
  inner: string[],
): string {
  const body = [emitTsLoopBind(name, ident), ...inner].filter(Boolean).join("\n");
  return (
    `{\nconst ${ident}_col = ${collection};\n` +
    `for (let ${ident}_i = 0; ${ident}_i < ${ident}_col.length; ${ident}_i++) {\n` +
    `const ${ident} = ${ident}_col[${ident}_i];\n` +
    `${body}\n}\n}`
  );
}

function emitForEachList(block: Block, ctx: TsEmitContext, indent: number): string {
  const name = String(block.getFieldValue("VAR") || "item");
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "__item";
  ctx.helpers.add("logic");
  const sourcePath = sourcePathFromLoopList(block);
  const innerCtx: TsEmitContext = sourcePath
    ? { ...ctx, sourceVar: ident, loopVar: ident }
    : { ...ctx, loopVar: ident };
  const bodyBlock = block.getInputTargetBlock("DO");
  const body = bodyBlock ? emitBlock(bodyBlock, innerCtx, indent) : "null";
  const bound = `(${emitTsLoopBind(name, ident)} ${body})`;
  if (sourcePath) {
    ctx.helpers.add("nodes");
    return `...xpathNodes(${JSON.stringify(sourcePath)}).map((${ident}, ${ident}_i, ${ident}_col) => ${bound})`;
  }
  const listBlock = block.getInputTargetBlock("LIST");
  const list = listBlock ? emitBlock(listBlock, ctx, indent) : "[]";
  return `...(Array.isArray(${list}) ? ${list} : []).map((${ident}, ${ident}_i, ${ident}_col) => ${bound})`;
}

function emitVariableSet(block: Block, ctx: TsEmitContext, indent: number): string {
  const name = block.getField("VAR")?.getText() ?? "v";
  const valueBlock = block.getInputTargetBlock("VALUE");
  const value = valueBlock ? emitBlock(valueBlock, ctx, indent) : "null";
  ctx.helpers.add("logic");
  return `(__vars[${JSON.stringify(name)}] = ${value}, null)`;
}

function emitDvShell(block: Block, ctx: TsEmitContext, indent: number): string {
  const rmType = String(block.getFieldValue("RM_TYPE") || block.type.replace(/-/g, "_"))
    .toUpperCase();
  if (rmType === "CODE_PHRASE" || block.type === "code_phrase") {
    return emitCodePhrase(block, ctx, indent);
  }
  const props: Array<[string, string]> = [];
  for (const attr of attributesFor(rmType)) {
    if (!isPrimitiveRmType(attr.typeName) && attr.typeName !== "CODE_PHRASE") continue;
    const inputName = block.getInput(`FLD_${attr.name}`)
      ? `FLD_${attr.name}`
      : block.getInput(`OPTFLD_${attr.name}`)
      ? `OPTFLD_${attr.name}`
      : null;
    if (!inputName) continue;
    const child = block.getInputTargetBlock(inputName);
    if (!child) continue;
    // Scaffolded C_QUANTITY / C_CODED unit-or-value pickers are not mappings.
    if (
      (child.type === "lists_getIndex" || child.type === "lists_create_with") &&
      (attr.name === "units" || attr.name === "units_display_name")
    ) {
      continue;
    }
    if (child.isShadow()) {
      if (child.type === "math_number" || isEmptyShadow(child)) continue;
      const shadow = emitBlock(child, ctx, indent + 1);
      if (isEmptyLiteral(shadow)) continue;
      props.push([attr.name, shadow]);
      continue;
    }
    const code = emitBlock(child, ctx, indent + 1);
    if (isBlankGeneratedExpr(code)) continue;
    const wrapped = attr.name === "magnitude"
      ? code
      : (attr.typeName === "String" || attr.name === "value" || attr.name === "code_string" ||
          attr.name === "units" || attr.name === "terminology_id")
      ? asStringExpr(code)
      : code;
    props.push([attr.name, wrapped]);
  }
  if (rmType === "DV_QUANTITY" && !props.some((p) => p[0] === "magnitude")) {
    const mag = block.getInputTargetBlock("MAGNITUDE");
    if (mag && !mag.isShadow()) {
      props.push(["magnitude", emitBlock(mag, ctx, indent + 1)]);
    }
    const units = block.getFieldValue("UNITS");
    if (units && props.some((prop) => prop[0] === "magnitude")) {
      props.push(["units", JSON.stringify(units)]);
    }
  }
  // A quantity without a magnitude is only scaffolding (e.g. fixed units): prune it like the preview does.
  if (rmType === "DV_QUANTITY" && !props.some((p) => p[0] === "magnitude")) return "";
  if (rmType === "DV_TEXT" && props.length === 1 && props[0]![0] === "value") {
    ctx.types.add("DV_TEXT");
    return `new DV_TEXT(${props[0]![1]})`;
  }
  if (!props.length) return "";
  return formatRmConstruct(rmType, props, indent, ctx);
}

function emitCodePhrase(block: Block, ctx: TsEmitContext, indent: number): string {
  const codeBlock = block.getInputTargetBlock("FLD_code_string");
  const termBlock = block.getInputTargetBlock("FLD_terminology_id");
  const code = codeBlock ? emitBlock(codeBlock, ctx, indent + 1) : '""';
  const term = termBlock ? emitBlock(termBlock, ctx, indent + 1) : '""';
  const termLit = stringLiteralValue(term);
  const codeLit = stringLiteralValue(code);
  if (termLit !== null && codeLit !== null) {
    if (!codeLit) return "";
    return emitCodePhraseLiteral(termLit, codeLit);
  }
  if (termLit !== null) {
    if (isBlankGeneratedExpr(code) || isEmptyLiteral(code)) return "";
    if (!codePhraseTerseSafe(termLit)) {
      return `({ terminology_id: ${JSON.stringify(termLit)}, code_string: String(${code} ?? "") })`;
    }
    return "((c) => { const s = String(c ?? \"\").trim(); return s ? `" +
      escapeTemplate(termLit) +
      "::${s}` : undefined; })(" + code + ")";
  }
  if (isBlankGeneratedExpr(code) && isBlankGeneratedExpr(term)) return "";
  ctx.types.add("CODE_PHRASE");
  return `new CODE_PHRASE(${formatObjectLiteral([
    ["terminology_id", term],
    ["code_string", asStringExpr(code)],
  ], indent)})`;
}

function emitTermPick(block: Block, ctx: TsEmitContext): string {
  const set = termSetById(block.getFieldValue("SET"));
  const rawCode = String(block.getFieldValue("CODE") ?? "");
  const code = rawCode === TERM_PICK_NONE ? "" : rawCode;
  if (!code) return "";
  const terminology = set?.terminologyId ?? "openehr";
  const rubric = set?.codes.find((item) => item.code === code)?.rubric ?? code;
  if (set?.valueRmType === "DV_CODED_TEXT") {
    ctx.types.add("DV_CODED_TEXT");
    return `new DV_CODED_TEXT(${JSON.stringify(`${terminology}::${code}|${rubric}|`)})`;
  }
  return emitCodePhraseLiteral(terminology, code);
}

/** LOCATABLE.name is mandatory, also when it repeats the RM type (e.g. HISTORY "history"). */
function shouldEmitLocatableName(rmType: string, _name: string): boolean {
  return rmType === "COMPOSITION" || LOCATABLE_TYPES.has(rmType);
}

function emitPartyRef(block: Block, ctx: TsEmitContext, indent: number): string {
  ctx.types.add("PARTY_REF");
  ctx.types.add("OBJECT_ID");
  const props: Array<[string, string]> = [];
  const idBlock = block.getInputTargetBlock(rmAttributeInputName("id"));
  const nsBlock = block.getInputTargetBlock(rmAttributeInputName("namespace"));
  const typeBlock = block.getInputTargetBlock(rmAttributeInputName("type"));
  const id = idBlock && !idBlock.isShadow() ? emitBlock(idBlock, ctx, indent + 1) : "";
  const namespace = nsBlock && !nsBlock.isShadow() ? emitBlock(nsBlock, ctx, indent + 1) : "";
  const refType = typeBlock && !typeBlock.isShadow() ? emitBlock(typeBlock, ctx, indent + 1) : "";
  if (id && !isBlankGeneratedExpr(id)) {
    props.push(["id", formatRmConstruct("OBJECT_ID", [["value", asStringExpr(id)]], indent + 1, ctx)]);
  }
  if (namespace && !isBlankGeneratedExpr(namespace)) {
    props.push(["namespace", asStringExpr(namespace)]);
  }
  if (refType && !isBlankGeneratedExpr(refType)) {
    props.push(["type", asStringExpr(refType)]);
  }
  if (!props.length) return "";
  return formatRmConstruct("PARTY_REF", props, indent, ctx);
}

function emitListsGetIndex(block: Block, ctx: TsEmitContext): string {
  const list = block.getInputTargetBlock("VALUE");
  const listCode = list ? emitBlock(list, ctx, 1) : "[]";
  const where = String(block.getFieldValue("WHERE") || "FIRST");
  if (where === "FIRST") return `(${listCode})[0]`;
  if (where === "LAST") return `(${listCode})[(${listCode}).length - 1]`;
  const at = block.getInputTargetBlock("AT");
  const index = at ? emitBlock(at, ctx, 1) : "1";
  return `(${listCode})[Number(${index}) - 1]`;
}

function emitListsCreate(block: Block, ctx: TsEmitContext): string {
  const count = Number((block as Block & { itemCount_?: number }).itemCount_ ?? 0);
  const items: string[] = [];
  for (let i = 0; i < count; i++) {
    const child = block.getInputTargetBlock(`ADD${i}`);
    items.push(child ? emitBlock(child, ctx, 1) : "undefined");
  }
  return `[${items.join(", ")}]`;
}

function emitGeneric(block: Block, ctx: TsEmitContext, indent: number): string {
  if (block.type === "json_null") return "null";
  if (block.type === "json_boolean") {
    const value = block.getInputTargetBlock("VALUE");
    return value ? emitBlock(value, ctx, indent) : "false";
  }
  if (isGenericValueBlockType(block.type)) {
    const value = block.getInputTargetBlock("VALUE");
    return value ? emitBlock(value, ctx, indent) : "undefined";
  }
  const props: Array<[string, string]> = [];
  for (const input of block.inputList) {
    if (!input.name.startsWith("TARGET_") && !input.name.startsWith("SCHEMA_OPT_")) continue;
    const attr = input.name.replace(/^TARGET_|^SCHEMA_OPT_/, "");
    if (input.type === STATEMENT_INPUT_TYPE) {
      const code = emitStatementList(block.getInputTargetBlock(input.name), true, ctx, indent);
      if (code) props.push([attr, code]);
      continue;
    }
    const child = block.getInputTargetBlock(input.name);
    if (!child) continue;
    const code = emitBlock(child, ctx, indent + 1);
    if (!isBlankGeneratedExpr(code)) props.push([attr, code]);
  }
  const name = String(block.getFieldValue("NAME") ?? "").trim();
  if (name && !props.length) return JSON.stringify(name);
  return formatObjectLiteral(props, indent);
}

function rmTypeOf(block: Block): string {
  if (block.type === "element") return "ELEMENT";
  const fromType = block.type.replace(/-/g, "_").toUpperCase();
  if (isRmContainerBlockType(block.type)) {
    const field = String(block.getFieldValue("RM_TYPE") ?? "").trim();
    if (field && (isEventFamilyType(field) || isEventFamilyType(fromType))) {
      return field.toUpperCase();
    }
    if (field && (isItemStructureFamilyType(field) || isItemStructureFamilyType(fromType))) {
      return field.toUpperCase();
    }
    return fromType;
  }
  const field = String(block.getFieldValue("RM_TYPE") ?? "").trim();
  if (field) return field.toUpperCase();
  return fromType;
}

function isEmptyShadow(block: Block): boolean {
  if (block.type === "text") return String(block.getFieldValue("TEXT") ?? "") === "";
  if (block.type === "math_number") return false;
  return false;
}

function isEmptyLiteral(code: string): boolean {
  return code === '""' || code === "''" || code === "undefined" || code === "null";
}

function stringLiteralValue(code: string): string | null {
  if (code.length >= 2 && code.startsWith('"') && code.endsWith('"')) {
    try {
      return JSON.parse(code) as string;
    } catch {
      return null;
    }
  }
  return null;
}

function escapeTemplate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
