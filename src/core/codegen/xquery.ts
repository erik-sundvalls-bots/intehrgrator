/**
 * XQuery conversion script language — Mapping Model → self-contained `.xq`.
 *
 * Default emit is Model B (`<mapping-result>` slot manifest). When a Template
 * Skeleton is passed, emit Model A/C: nested COMPOSITION RM XML (or JSON maps
 * when `instanceShape` is `"json"`). Sheet accessors bind `external $sheets`.
 *
 * See docs/future/xquery-export-investigation.md.
 */
import type {
  MappingLoop,
  MappingModel,
  MappingSlot,
  OpenEhrInstanceShape,
  SkeletonNode,
  TargetSignatureNode,
} from "../../types/mod.ts";
import { expressionUsesRelativeSourcePath } from "../mapping_model/loops.ts";
import { parseExpression, type ExprAst, isQuantifyCall } from "../expression/mod.ts";
import {
  functionIdentMap,
  valueFunctions,
  xqueryLocalName,
} from "./user_functions.ts";
import { isAutoFixedValueSlot, LOCATABLE_TYPES } from "../rm_mandatory.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";
import {
  propsLackClinicalContent,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { isListAttribute } from "./typescript.ts";
import { emitSheetHelpers } from "./xquery_sheets.ts";
import {
  instanceShapeForEncoding,
  preferredInstanceEncoding,
} from "../output/instance_encoding.ts";
import { usesOpenEhrProduct } from "./product.ts";
import { canvasHandlebarsExpression } from "../output/canvas_handlebars.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";

/** Host-bound VMS-Hbs render (`run_xquery.ts` / BaseX external). */
export const INTEHRGRATOR_XQUERY_NS = "http://intehrgrator.local/xquery";

export class XQueryExportError extends Error {
  override name = "XQueryExportError";
}

export interface XQueryEmitEnv {
  bind?: Record<string, string>;
  /** Context node for xpath* — defaults to `$source`; loop bodies use the loop var. */
  sourceVar?: string;
  fnIdents?: Map<string, string>;
}

function userFunctionXqEnv(model: MappingModel, base: XQueryEmitEnv = {}): XQueryEmitEnv {
  return {
    ...base,
    fnIdents: functionIdentMap(valueFunctions(model.functions), xqueryLocalName),
  };
}

function emitXQueryUserFunctions(model: MappingModel, env: XQueryEmitEnv): string[] {
  const fns = valueFunctions(model.functions);
  if (!fns.length) return [];
  const idents = env.fnIdents ?? functionIdentMap(fns, xqueryLocalName);
  const lines: string[] = [];
  for (const fn of fns) {
    const ident = idents.get(fn.name) ?? xqueryLocalName(fn.name);
    const params = fn.params.map((p) => `$${xqueryLocalName(p)} as item()*`).join(", ");
    const bind = Object.fromEntries(fn.params.map((p) => [p, xqueryLocalName(p)]));
    const inner: XQueryEmitEnv = { ...env, bind: { ...env.bind, ...bind }, fnIdents: idents };
    const body = emitXQueryExpr(parseExpression(fn.body!), inner);
    lines.push(`declare function local:${ident}(${params}) as item()* {`);
    lines.push(`  ${body}`);
    lines.push("};");
    lines.push("");
  }
  return lines;
}

export interface XQueryGenerationOptions {
  skeleton?: SkeletonNode[];
  /** Desired openEHR instance serialization. Default `xml` when a skeleton is present. */
  instanceShape?: OpenEhrInstanceShape;
  /** Canonical Blockly workspace JSON — canvas product wins over a leftover skeleton. */
  blocklyState?: unknown;
}

export function generateXQuery(
  model: MappingModel,
  options: XQueryGenerationOptions = {},
): string {
  const env = userFunctionXqEnv(model);
  validateExportModel(model);

  const skeleton = options.skeleton ?? [];
  const fromEncoding = model.instanceEncodings?.length
    ? instanceShapeForEncoding(preferredInstanceEncoding(model))
    : undefined;
  const shape: OpenEhrInstanceShape = fromEncoding ?? options.instanceShape ??
    (skeleton.length && (model.targetFormat ?? "openehr-template") === "openehr-template"
      ? "xml"
      : "json");
  const openEhr = usesOpenEhrProduct(model, options);
  const openEhrTree = openEhr && skeleton.length > 0;

  if (openEhrTree) {
    return wrapXQueryModule({
      model,
      shape,
      needsRm: true,
      productComment: shape === "xml"
        ? "Output: COMPOSITION RM XML (Model A/C). Validate with Archie / a CDR."
        : "Output: COMPOSITION as XPath 3.1 maps (JSON instance shape).",
      convertType: shape === "xml" ? "element()" : "item()*",
      body: emitCompositionProduct(model, skeleton, shape, env),
    });
  }

  const canvas = canvasHandlebarsExpression(options.blocklyState);
  if (canvas) {
    return wrapXQueryModule({
      model,
      shape: "json",
      needsRm: false,
      needsHandlebars: true,
      productComment:
        "Output: VMS-Hbs string via intehrgrator:handlebars (Test Run host). BaseX/Saxon need the same external function.",
      convertType: "xs:string",
      body: `  ${emitXQueryExpr(parseExpression(canvas), env)}`,
    });
  }

  const loops = model.loops ?? [];
  const { loopSlots, topLevelSlots } = partitionSlots(model.slots, loops, model.targetSignature);

  const loopBlocks = loops.map((loop) =>
    emitLoop(loop, loopSlots.get(loop.attachSlotId) ?? [], openEhr, env).map((line) => `    ${line}`).join("\n")
  );
  const slotBlocks = topLevelSlots.map((slot) =>
    emitSlot(slot, env, openEhr).map((line) => `    ${line}`).join("\n")
  );

  const inner: string[] = [
    "  element mapping-result {",
    `    attribute template { ${xqString(model.templateId)} }${
      loopBlocks.length || slotBlocks.length ? "," : ""
    }`,
  ];

  if (loopBlocks.length) {
    inner.push("    element loops {");
    for (let i = 0; i < loopBlocks.length; i++) {
      const block = loopBlocks[i]!;
      const comma = i < loopBlocks.length - 1 ? "," : slotBlocks.length ? "," : "";
      inner.push(block + comma);
    }
    inner.push("    }" + (slotBlocks.length ? "," : ""));
  }

  if (!slotBlocks.length && !loopBlocks.length) {
    inner.push(
      "    (: no mapped slots — map Target value slots in Blockly, then re-export :)",
    );
  } else if (slotBlocks.length) {
    inner.push("    element slots {");
    for (let i = 0; i < slotBlocks.length; i++) {
      const block = slotBlocks[i]!;
      const comma = i < slotBlocks.length - 1 ? "," : "";
      inner.push(block + comma);
    }
    inner.push("    }");
  }

  inner.push(
    "  }",
  );

  return wrapXQueryModule({
    model,
    shape: "xml",
    needsRm: openEhr,
    productComment: openEhr
      ? "Output: mapping-result slot manifest (Model B). Validate assembled Composition with Archie OPT."
      : "Output: mapping-result slot manifest (Model B).",
    convertType: "element(mapping-result)",
    body: inner.join("\n"),
  });
}

function wrapXQueryModule(args: {
  model: MappingModel;
  shape: OpenEhrInstanceShape;
  needsRm: boolean;
  needsHandlebars?: boolean;
  productComment: string;
  convertType: string;
  body: string;
}): string {
  const method = args.shape === "json" ? "json" : "xml";
  const lines: string[] = [
    'xquery version "3.1";',
    "",
    "(: Generated by intEHRgrator — Conversion Script (XQuery) :)",
    `(: Target: ${xqComment(args.model.templateId)} :)`,
    `(: Target instance format: ${xqComment(args.model.targetFormat ?? "openehr-template")} :)`,
    "(: Runtime: Saxon / BaseX / eXist, or in-app Test Run via lazy-loaded fontoxpath :)",
    `(: ${xqComment(args.productComment)} :)`,
    "(: Bind $source (XML node or XPath 3.1 map), $defaults, and $sheets (see docs/agents/xquery-engine.md). :)",
    "",
    'declare namespace output = "http://www.w3.org/2010/xslt-xquery-serialization";',
    ...(args.needsRm
      ? [
        'declare namespace rm = "http://schemas.openehr.org/v1";',
        'declare namespace xsi = "http://www.w3.org/2001/XMLSchema-instance";',
      ]
      : []),
    ...(args.needsHandlebars
      ? [
        `declare namespace intehrgrator = "${INTEHRGRATOR_XQUERY_NS}";`,
        `declare function intehrgrator:handlebars($template as xs:string, $context as item()*) as xs:string external;`,
        "(: Bound by the intEHRgrator Test Run host. BaseX/Saxon must provide the same external or the query fails. :)",
      ]
      : []),
    'declare namespace map = "http://www.w3.org/2005/xpath-functions/map";',
    'declare namespace array = "http://www.w3.org/2005/xpath-functions/array";',
    "",
    `declare option output:method "${method}";`,
    'declare option output:indent "yes";',
    "",
    "declare variable $source external;",
    "declare variable $defaults as map(*) external := map {};",
    "declare variable $sheets as map(*) external := map {};",
    "",
    ...emitHelpers(args.needsRm),
    "",
    ...emitXQueryUserFunctions(args.model, userFunctionXqEnv(args.model)),
    `declare function local:convert($source as item()*) as ${args.convertType} {`,
    args.body,
    "};",
    "",
    "local:convert($source)",
    "",
  ];
  return lines.join("\n");
}

function validateExportModel(model: MappingModel): void {
  for (const block of model.unsupported ?? []) {
    if (block.reason === "removed") {
      throw new XQueryExportError(
        `Cannot export XQuery: Blockly block type "${block.blockType}" was removed from the ` +
          "verifiable mapping subset (#35). Remove it from the canvas before exporting.",
      );
    }
  }

}

function partitionSlots(
  slots: MappingSlot[],
  loops: MappingLoop[],
  signature?: TargetSignatureNode[],
): { loopSlots: Map<string, MappingSlot[]>; topLevelSlots: MappingSlot[] } {
  const loopSlots = new Map<string, MappingSlot[]>();
  for (const loop of loops) {
    loopSlots.set(loop.attachSlotId, []);
  }

  const topLevelSlots: MappingSlot[] = [];
  for (const slot of slots) {
    if (!expressionUsesRelativeSourcePath(slot.expression)) {
      topLevelSlots.push(slot);
      continue;
    }
    const loop = resolveLoopForSlot(slot, loops, signature);
    if (!loop) {
      topLevelSlots.push(slot);
      continue;
    }
    const bucket = loopSlots.get(loop.attachSlotId) ?? [];
    bucket.push(slot);
    loopSlots.set(loop.attachSlotId, bucket);
  }

  return { loopSlots, topLevelSlots };
}

function resolveLoopForSlot(
  slot: MappingSlot,
  loops: MappingLoop[],
  signature?: TargetSignatureNode[],
): MappingLoop | undefined {
  const relativeLoops = loops.filter((loop) => slotMatchesLoop(slot.slotId, loop, signature));
  if (relativeLoops.length === 1) return relativeLoops[0];
  if (relativeLoops.length > 1) {
    return relativeLoops.find((loop) => {
      const ids = signatureSlotIds(loop.attachSlotId, signature);
      return ids?.has(slot.slotId);
    }) ?? relativeLoops[0];
  }
  return loops.length === 1 ? loops[0] : undefined;
}

function slotMatchesLoop(
  slotId: string,
  loop: MappingLoop,
  signature?: TargetSignatureNode[],
): boolean {
  const ids = signatureSlotIds(loop.attachSlotId, signature);
  if (ids) return ids.has(slotId);
  return slotId === loop.attachSlotId ||
    slotId.startsWith(`${loop.attachSlotId}/`) ||
    slotId.startsWith(`${loop.attachSlotId}//`);
}

function signatureSlotIds(
  attachSlotId: string,
  signature?: TargetSignatureNode[],
): Set<string> | undefined {
  if (!signature?.length) return undefined;
  const node = findSignatureNode(signature, attachSlotId);
  if (!node) return undefined;
  return new Set(collectSignatureSlotIds(node));
}

function findSignatureNode(
  nodes: TargetSignatureNode[],
  slotId: string,
): TargetSignatureNode | undefined {
  for (const node of nodes) {
    if (node.slotId === slotId) return node;
    const nested = findSignatureNode(node.children, slotId);
    if (nested) return nested;
  }
  return undefined;
}

function collectSignatureSlotIds(node: TargetSignatureNode): string[] {
  const ids = [node.slotId];
  for (const child of node.children) {
    ids.push(...collectSignatureSlotIds(child));
  }
  return ids;
}

function emitLoop(
  loop: MappingLoop,
  slots: MappingSlot[],
  needsRm = true,
  baseEnv: XQueryEmitEnv = {},
): string[] {
  const ident = loopVarIdent(loop.varName);
  const sequence = compileLoopSequence(loop);
  const env: XQueryEmitEnv = {
    ...baseEnv,
    sourceVar: `$${ident}`,
    bind: {
      ...baseEnv.bind,
      [loop.varName]: ident,
      [loopIndexBinderName(loop.varName)]: `${ident}_index`,
      [loopLengthBinderName(loop.varName)]: `${ident}_length`,
    },
  };

  const attrs = [
    `attribute attach-slot-id { ${xqString(loop.attachSlotId)} }`,
    `attribute var-name { ${xqString(loop.varName)} }`,
    `attribute kind { ${xqString(loop.kind ?? "source")} }`,
  ];
  if (loop.path) attrs.push(`attribute path { ${xqString(loop.path)} }`);
  if (loop.collection) attrs.push(`attribute collection { ${xqString(loop.collection)} }`);

  const slotLines: string[] = [];
  if (slots.length) {
    slotLines.push("  element slots {");
    for (let i = 0; i < slots.length; i++) {
      const block = emitSlot(slots[i]!, env, needsRm).map((line) => `    ${line}`).join("\n");
      const comma = i < slots.length - 1 ? "," : "";
      slotLines.push(block + comma);
    }
    slotLines.push("  }");
  }

  const body = [
    "element loop {",
    ...attrs.map((line, index) => `  ${line}${index < attrs.length - 1 || slotLines.length ? "," : ""}`),
    ...slotLines,
    "}",
  ];

  return [
    `let $${ident}_col := ${sequence}`,
    `for $${ident} at $${ident}_pos in $${ident}_col`,
    `let $${ident}_index := $${ident}_pos - 1`,
    `let $${ident}_length := count($${ident}_col)`,
    "return",
    ...body.map((line) => `  ${line}`),
  ];
}

function loopVarIdent(varName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName) ? varName : "item";
}

/** Compile a loop collection path to an XQuery sequence expression. */
export function compileLoopSequence(loop: MappingLoop): string {
  if (loop.kind === "list") {
    if (!loop.collection) {
      return "(: for_each_list without collection expression :) ()";
    }
    return emitXQueryExpr(parseExpression(loop.collection));
  }

  const path = loop.path.trim();
  if (!path) {
    return "(: for_each_source without PATH :) ()";
  }

  if (path.startsWith("$.")) {
    const base = path.replace(/\[\*\]$/, "");
    const lookup = jsonDollarPathToLookup(base);
    if (lookup) {
      return `local:iterable-sequence(${lookup})`;
    }
    return `local:lookup-sequence($source, ${xqString(path)})`;
  }

  if (path.startsWith("/")) {
    return `$source${path}`;
  }

  return `local:lookup-sequence($source, ${xqString(path)})`;
}

function emitHelpers(needsRm: boolean): string[] {
  return [
    "(: --- Source access (fontoxpath-authored paths → XQuery 3.1) --- :)",
    "",
    "declare function local:iterable-sequence($nodes as item()*) as item()* {",
    "  if ($nodes instance of array(*)) then $nodes?*",
    "  else $nodes",
    "};",
    "",
    "declare function local:lookup-sequence($ctx as item()*, $path as xs:string) as item()* {",
    "  (: Dynamic or non-literal loop paths — prefer compile-time $. / / paths from export :) ",
    "  if (starts-with($path, \"$\"))",
    "  then let $nodes := local:json-lookup($ctx, $path)",
    "       return if ($nodes instance of array(*)) then $nodes?* else $nodes",
    "  else error(",
    '    QName("http://intehrgrator.local/xquery", "DYNAMIC-LOOP-PATH"),',
    '    "Prefer compile-time literal loop PATH from intEHRgrator export; got: " || $path',
    "  )",
    "};",
    "",
    "declare function local:string-at($ctx as item()*, $path as xs:string) as xs:string? {",
    "  let $value := local:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:string($value)",
    "};",
    "",
    "declare function local:number-at($ctx as item()*, $path as xs:string) as xs:decimal? {",
    "  let $value := local:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:decimal($value)",
    "};",
    "",
    "declare function local:boolean-at($ctx as item()*, $path as xs:string) as xs:boolean? {",
    "  let $value := local:lookup($ctx, $path)",
    "  return if (empty($value)) then () else xs:boolean($value)",
    "};",
    "",
    "declare function local:lookup($ctx as item()*, $path as xs:string) as item()* {",
    "  if (starts-with($path, \"$\"))",
    "  then local:json-lookup($ctx, $path)",
    "  else error(",
    '    QName("http://intehrgrator.local/xquery", "DYNAMIC-XML-PATH"),',
    '    "Prefer compile-time literal XML paths from intEHRgrator export; got: " || $path',
    "  )",
    "};",
    "",
    "declare function local:json-lookup($ctx as item()*, $path as xs:string) as item()* {",
    "  let $body := replace(replace(replace($path, \"^\\\\$\\\\.?\", \"\"), \"\\\\[(\\\\d+)\\\\]\", \".$1\"), \"\\\\[\\\\*\\\\]\", \".*\")",
    "  let $segments := tokenize($body, \"\\\\.\")[. ne \"\"]",
    "  return fold-left(",
    "    $segments,",
    "    $ctx,",
    "    function($acc as item()*, $seg as xs:string) as item()* {",
    "      if (empty($acc)) then ()",
    "      else if ($seg eq \"*\") then",
    "        if ($acc instance of array(*)) then $acc?* else $acc",
    "      else if ($seg castable as xs:integer) then",
    "        if ($acc instance of array(*)) then $acc?(xs:integer($seg)) else ($acc)[xs:integer($seg)]",
    "      else if ($acc instance of array(*)) then $acc?*?($seg)",
    "      else $acc?($seg)",
    "    }",
    "  )",
    "};",
    "",
    ...(needsRm ? emitDvHelpers() : []),
    ...emitSheetHelpers(),
  ];
}

function emitDvHelpers(): string[] {
  return [
    "(: --- DV_* constructors (RM XML) --- :)",
    "",
    "declare function local:dv-text($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_TEXT" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function local:dv-coded-text($value as xs:string?, $code as xs:string?, $terminology as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_CODED_TEXT" },',
    "    element rm:value { $value },",
    "    element rm:defining_code {",
    "      element rm:terminology_id { element rm:value { $terminology } },",
    "      element rm:code_string { $code }",
    "    }",
    "  }",
    "};",
    "",
    "declare function local:dv-quantity($magnitude as xs:decimal?, $units as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_QUANTITY" },',
    "    element rm:magnitude { $magnitude },",
    "    element rm:units { $units }",
    "  }",
    "};",
    "",
    "declare function local:dv-count($magnitude as xs:integer?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_COUNT" },',
    "    element rm:magnitude { $magnitude }",
    "  }",
    "};",
    "",
    "declare function local:dv-boolean($value as xs:boolean?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_BOOLEAN" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function local:dv-date-time($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_DATE_TIME" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function local:dv-uri($value as xs:string?) as element(rm:value) {",
    "  element rm:value {",
    '    attribute xsi:type { "DV_URI" },',
    "    element rm:value { $value }",
    "  }",
    "};",
    "",
    "declare function local:as-value($rm-type as xs:string, $value as item()*) as element()* {",
    "  switch ($rm-type)",
    '    case "DV_QUANTITY" return local:dv-quantity(($value)[1] ! xs:decimal(.), ())',
    '    case "DV_COUNT" return local:dv-count(($value)[1] ! xs:integer(.))',
    '    case "DV_INTEGER" return local:dv-count(($value)[1] ! xs:integer(.))',
    '    case "DV_BOOLEAN" return local:dv-boolean(($value)[1] ! xs:boolean(.))',
    '    case "DV_DATE_TIME" return local:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_DATE" return local:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_TIME" return local:dv-date-time(($value)[1] ! xs:string(.))',
    '    case "DV_URI" return local:dv-uri(($value)[1] ! xs:string(.))',
    '    case "DV_EHR_URI" return local:dv-uri(($value)[1] ! xs:string(.))',
    '    case "DV_CODED_TEXT" return local:dv-coded-text(($value)[1] ! xs:string(.), (), ())',
    "    default return local:dv-text(($value)[1] ! xs:string(.))",
    "};",
    "",
  ];
}

function emitSlot(slot: MappingSlot, env: XQueryEmitEnv = {}, needsRm = true): string[] {
  let exprXq: string;
  try {
    exprXq = emitXQueryExpr(parseExpression(slot.expression), env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    exprXq = `(: unparseable expression: ${xqComment(msg)} :) ()`;
  }
  const label = slot.label ?? slot.slotId;
  const valueLine = needsRm
    ? `  local:as-value(${xqString(slot.rmType)}, ${exprXq})`
    : `  ${exprXq}`;
  return [
    `(: ${xqComment(label)} — ${xqComment(slot.expression)} :)`,
    "element slot {",
    `  attribute id { ${xqString(slot.slotId)} },`,
    `  attribute rm-type { ${xqString(slot.rmType)} },`,
    ...(slot.mandatory ? ['  attribute mandatory { "true" },'] : []),
    valueLine,
    "}",
  ];
}

function emitChangeCaseXq(text: string, mode: string): string {
  return `(let $t := string(${text}) return if (${mode} eq "UPPERCASE") then upper-case($t) else if (${mode} eq "TITLECASE") then string-join(for $w in tokenize($t, "\\s+") return concat(upper-case(substring($w, 1, 1)), lower-case(substring($w, 2))), " ") else lower-case($t))`;
}

/** Map Mapping Expression AST → XQuery 3.1 fragment (context variable `$source`). */
export function emitXQueryExpr(ast: ExprAst, env: XQueryEmitEnv = {}): string {
  const sourceVar = env.sourceVar ?? "$source";
  switch (ast.kind) {
    case "literal":
      if (typeof ast.value === "string") return xqString(ast.value);
      if (typeof ast.value === "boolean") return ast.value ? "true()" : "false()";
      return String(ast.value);
    case "binary":
      return `(${emitXQueryExpr(ast.left, env)} ${ast.op} ${emitXQueryExpr(ast.right, env)})`;
    case "call": {
      if (isQuantifyCall(ast.name)) return emitQuantifierXq(ast, env);
      const args = ast.args.map((a) => emitXQueryExpr(a, env));
      switch (ast.name) {
        case "trim":
          return `normalize-space(${args[0]})`;
        case "change_case":
          return emitChangeCaseXq(args[0] ?? '""', args[1] ?? '"LOWERCASE"');
        case "concat":
          return `concat(${args.join(", ")})`;
        case "round":
          return `round(${args[0]})`;
        case "modulo":
          return `(${args[0]} mod ${args[1]})`;
        case "constrain":
          return `(if (${args[0]} lt ${args[1]}) then ${args[1]} else if (${args[0]} gt ${args[2]}) then ${args[2]} else ${args[0]})`;
        case "if":
          return `(if (${args[0]}) then ${args[1]} else ${args[2]})`;
        case "switch":
          return emitSwitchXq(args);
        case "var": {
          const name = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          if (name && env.bind?.[name]) return `$${env.bind[name]}`;
          return `$vars(${args[0]})`;
        }
        case "eq":
          return `deep-equal(${args[0]}, ${args[1]})`;
        case "ne":
          return `not(deep-equal(${args[0]}, ${args[1]}))`;
        case "lt":
          return `(${args[0]} lt ${args[1]})`;
        case "le":
          return `(${args[0]} le ${args[1]})`;
        case "gt":
          return `(${args[0]} gt ${args[1]})`;
        case "ge":
          return `(${args[0]} ge ${args[1]})`;
        case "and":
          return `(${args[0]} and ${args[1]})`;
        case "or":
          return `(${args[0]} or ${args[1]})`;
        case "not":
          return `not(${args[0]})`;
        case "list":
          return `(${args.join(", ")})`;
        case "intersection":
          return `(${args[0]}[some $b in ${args[1]} satisfies deep-equal(., $b)])`;
        case "union":
          return `(${args[0]}, ${args[1]}[not(some $a in ${args[0]} satisfies deep-equal(., $a))])`;
        case "difference":
          return `(${args[0]}[not(some $b in ${args[1]} satisfies deep-equal(., $b))])`;
        case "maps_get":
          return `(if (${args[0]} eq "defaults") then map:get($defaults, ${args[1]}) else ())`;
        case "sheet_get_cell":
          return `local:sheet-get-cell(${args[0]}, ${args[1]})`;
        case "sheet_get_xy":
          return `local:sheet-get-xy(${args[0]}, ${args[1]}, ${args[2]})`;
        case "sheet_get_row":
          return `local:sheet-get-row(${args[0]}, ${args[1]})`;
        case "sheet_get_column":
          return `local:sheet-get-column(${args[0]}, ${args[1]})`;
        case "sheet_get_header":
          return `local:sheet-get-header(${args[0]}, ${args[1]})`;
        case "sheet_get_data":
          return `local:sheet-get-data(${args[0]})`;
        case "sheet_lookup":
          return args.length >= 4
            ? `local:sheet-lookup(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`
            : `local:sheet-lookup(${args[0]}, ${args[1]}, ${args[2]})`;
        case "decision_table":
          return args.length >= 3
            ? `local:decision-table(${args[0]}, ${args[1] ?? "map {}"}, ${args[2]})`
            : `local:decision-table(${args[0]}, ${args[1] ?? "map {}"})`;
        case "map":
          return emitMapLiteralXq(args);
        case "xpathString":
        case "xpath":
          return emitXPathCall("string-at", ast.args[0], env);
        case "xpathNumber":
          return emitXPathCall("number-at", ast.args[0], env);
        case "xpathBoolean":
          return emitXPathCall("boolean-at", ast.args[0], env);
        case "xpathNode":
          if (ast.args[0]?.kind === "literal" && typeof ast.args[0].value === "string") {
            const path = ast.args[0].value.trim();
            if (path.startsWith("/")) return `(${sourceVar}${path})[1]`;
            const lookup = compileRelativeLookup(path, sourceVar);
            if (lookup) return `(${lookup})[1]`;
          }
          return sourceVar;
        case "handlebars":
          return `intehrgrator:handlebars(${args[0] ?? '""'}, ${args[1] ?? "map {}"})`;
        case "call": {
          const fname = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          const ident = env.fnIdents?.get(fname) ?? xqueryLocalName(fname);
          return `local:${ident}(${args.slice(1).join(", ")})`;
        }
        default:
          return emitXPathCall("string-at", ast.args[0], env);
      }
    }
  }
}

function emitQuantifierXq(
  ast: Extract<ExprAst, { kind: "call" }>,
  env: XQueryEmitEnv,
): string {
  const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
  const list = emitXQueryExpr(ast.args[0]!, env);
  const n = card ? emitXQueryExpr(ast.args[1]!, env) : "0";
  const varAst = card ? ast.args[2] : ast.args[1];
  const predAst = card ? ast.args[3] : ast.args[2];
  const varName = varAst?.kind === "literal" ? String(varAst.value) : "item";
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName) ? varName : "item";
  const inner = { ...env, bind: { ...env.bind, [varName]: ident } };
  const pred = predAst ? emitXQueryExpr(predAst, inner) : "true()";
  const counted = `count(for $${ident} in ${list} where ${pred} return $${ident})`;
  switch (ast.name) {
    case "all_of":
      return `(every $${ident} in ${list} satisfies ${pred})`;
    case "any_of":
      return `(some $${ident} in ${list} satisfies ${pred})`;
    case "none_of":
      return `(every $${ident} in ${list} satisfies not(${pred}))`;
    case "at_least":
      return `(${counted} ge ${n})`;
    case "at_most":
      return `(${counted} le ${n})`;
    case "exactly":
      return `(${counted} eq ${n})`;
    default:
      return "false()";
  }
}

function emitXPathCall(
  helper: "string-at" | "number-at" | "boolean-at",
  pathAst: ExprAst | undefined,
  env: XQueryEmitEnv,
): string {
  const sourceVar = env.sourceVar ?? "$source";
  if (!pathAst) return "()";
  if (pathAst.kind === "literal" && typeof pathAst.value === "string") {
    const compiled = compileLiteralPath(pathAst.value, helper, sourceVar);
    if (compiled) return compiled;
  }
  return `local:${helper}(${sourceVar}, ${emitXQueryExpr(pathAst, env)})`;
}

/**
 * Compile a fontoxpath-authored literal path to inline XQuery when safe.
 * Falls back to local:*-at helpers for dynamic / complex paths.
 */
export function compileLiteralPath(
  path: string,
  helper: "string-at" | "number-at" | "boolean-at",
  sourceVar = "$source",
): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  const cast = helper === "number-at"
    ? "xs:decimal"
    : helper === "boolean-at"
    ? "xs:boolean"
    : "xs:string";

  if (trimmed === "." || trimmed === "./") {
    return `${cast}((${sourceVar})[1])`;
  }
  if (trimmed.startsWith("./")) {
    return `${cast}((${sourceVar}/${trimmed.slice(2)})[1])`;
  }
  if (looksLikeOpenEhrLocator(trimmed)) {
    const lookup = compileAuthoringPath(trimmed, "json", sourceVar);
    return `${cast}((${lookup})[1])`;
  }
  if (trimmed.startsWith("/")) {
    const xml = looksLikeOpenEhrLocator(trimmed)
      ? compileAuthoringPath(trimmed, "xml")
      : trimmed;
    return `${cast}((${sourceVar}${xml})[1])`;
  }

  if (trimmed.startsWith("$")) {
    const lookup = jsonDollarPathToLookup(trimmed, sourceVar);
    if (!lookup) return null;
    return `${cast}((${lookup})[1])`;
  }

  const relative = compileRelativeLookup(trimmed, sourceVar);
  if (relative) return `${cast}((${relative})[1])`;

  return null;
}

function compileRelativeLookup(path: string, sourceVar: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("$") || trimmed.startsWith("/")) return null;
  if (trimmed === "." || trimmed === "./") return sourceVar;

  const body = trimmed.replace(/^\.\//, "");
  const segments: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === ".") {
      i++;
      continue;
    }
    if (body[i] === "[") {
      const close = body.indexOf("]", i + 1);
      if (close < 0) return null;
      const token = body.slice(i + 1, close);
      if (/^\d+$/.test(token)) segments.push(token);
      else return null;
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < body.length && !".[".includes(body[end]!)) end++;
    segments.push(body.slice(i, end));
    i = end;
  }

  let expr = sourceVar;
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) expr += `[${seg}]`;
    else if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(seg)) expr += `?${seg}`;
    else expr += `?(${xqString(seg)})`;
  }
  return expr;
}

/** `$.patient.vitals[1].systolic` → `$source?patient?vitals?1?systolic` */
export function jsonDollarPathToLookup(path: string, root = "$source"): string | null {
  let body = path.trim();
  if (!body.startsWith("$")) return null;
  body = body.slice(1);
  if (body.startsWith(".")) body = body.slice(1);
  if (!body) return root;

  const segments: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === ".") {
      i++;
      continue;
    }
    if (body[i] === "[") {
      const close = body.indexOf("]", i + 1);
      if (close < 0) return null;
      const token = body.slice(i + 1, close);
      if (/^\d+$/.test(token)) segments.push(token);
      else if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        segments.push(token.slice(1, -1));
      } else {
        segments.push(token);
      }
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < body.length && !".[".includes(body[end]!)) end++;
    segments.push(body.slice(i, end));
    i = end;
  }

  let expr = root;
  for (const seg of segments) {
    if (seg === "*") expr += "?*";
    else if (/^\d+$/.test(seg)) expr += `?${seg}`;
    else if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(seg)) expr += `?${seg}`;
    else expr += `?(${xqString(seg)})`;
  }
  return expr;
}

function emitSwitchXq(args: string[]): string {
  if (args.length < 2) return "()";
  const discriminant = args[0]!;
  const defaultV = args[args.length - 1]!;
  const pairs = args.slice(1, -1);
  let expr = defaultV;
  for (let i = pairs.length - 2; i >= 0; i -= 2) {
    expr = `(if (${discriminant} eq ${pairs[i]}) then ${pairs[i + 1]} else ${expr})`;
  }
  return expr;
}

function emitMapLiteralXq(args: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    parts.push(`${args[i]}: ${args[i + 1]}`);
  }
  return parts.length ? `map { ${parts.join(", ")} }` : "map {}";
}

interface XqSkelCtx {
  slots: Map<string, MappingSlot>;
  loops: MappingLoop[];
  env: XQueryEmitEnv;
  shape: OpenEhrInstanceShape;
}

function emitCompositionProduct(
  model: MappingModel,
  skeleton: SkeletonNode[],
  shape: OpenEhrInstanceShape,
  env: XQueryEmitEnv = {},
): string {
  const ctx: XqSkelCtx = {
    slots: new Map(model.slots.map((slot) => [slot.slotId, slot])),
    loops: model.loops ?? [],
    env,
    shape,
  };
  const roots = skeleton
    .map((node) => emitSkelNode(node, ctx, true))
    .filter((code): code is string => Boolean(code));
  if (!roots.length) {
    return shape === "xml"
      ? '  element rm:composition { attribute xsi:type { "COMPOSITION" } }'
      : '  map { "_type": "COMPOSITION" }';
  }
  if (roots.length === 1) return `  ${roots[0]}`;
  return shape === "xml"
    ? `  (${roots.join(",\n   ")})`
    : `  array { ${roots.join(", ")} }`;
}

function emitSkelNode(
  node: SkeletonNode,
  ctx: XqSkelCtx,
  isRoot = false,
  parentArchetypeRef?: string,
): string | null {
  if (node.kind === "value") return emitSkelValue(node, ctx);
  if (isAutoFixedValueSlot(node)) return null;

  const loop = ctx.loops.find((item) => item.attachSlotId === node.slotId);
  if (loop) return emitSkelLoop(node, loop, ctx, parentArchetypeRef);

  const props = skelProps(node, ctx, parentArchetypeRef);
  if (node.rmType !== "COMPOSITION" && propsLackClinicalContent(props)) return null;
  return formatSkelConstruct(node, props, ctx, isRoot);
}

function emitSkelLoop(
  node: SkeletonNode,
  loop: MappingLoop,
  ctx: XqSkelCtx,
  parentArchetypeRef?: string,
): string {
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(loop.varName) ? loop.varName : "item";
  const inner: XqSkelCtx = {
    ...ctx,
    loops: ctx.loops.filter((item) => item !== loop),
    env: {
      ...ctx.env,
      sourceVar: `$${ident}`,
      bind: {
        ...ctx.env.bind,
        [loop.varName]: ident,
        [loopIndexBinderName(loop.varName)]: `${ident}_index`,
        [loopLengthBinderName(loop.varName)]: `${ident}_length`,
      },
    },
  };
  const props = skelProps(node, inner, parentArchetypeRef);
  const constructed = formatSkelConstruct(node, props, inner, false);
  const sequence = compileLoopSequence(loop);
  const flwor =
    `let $${ident}_col := ${sequence} ` +
    `for $${ident} at $${ident}_pos in $${ident}_col ` +
    `let $${ident}_index := $${ident}_pos - 1 ` +
    `let $${ident}_length := count($${ident}_col) ` +
    `return ${constructed}`;
  if (ctx.shape === "json") {
    return `array { ${flwor} }`;
  }
  return `(${flwor})`;
}

function skelProps(
  node: SkeletonNode,
  ctx: XqSkelCtx,
  parentArchetypeRef?: string,
): Array<[string, string]> {
  const props: Array<[string, string]> = [];
  const locatableName = rmLocatableName(node);
  if (locatableName && shouldEmitSkelName(node)) {
    props.push([
      "name",
      ctx.shape === "xml"
        ? `element rm:value { ${xqString(locatableName)} }`
        : `map { "_type": "DV_TEXT", "value": ${xqString(locatableName)} }`,
    ]);
  }
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  if (nodeId) {
    props.push(["archetype_node_id", xqString(nodeId)]);
  }
  const childArchetypeRef = node.archetypeRef ?? parentArchetypeRef;

  const grouped = new Map<string, SkeletonNode[]>();
  for (const child of node.children) {
    if (isAutoFixedValueSlot(child)) continue;
    const attr = child.rmAttribute ?? child.label;
    const list = grouped.get(attr) ?? [];
    list.push(child);
    grouped.set(attr, list);
  }

  for (const [attr, children] of grouped) {
    const listAttr = isListAttribute(node.rmType, attr);
    const codes = children
      .map((child) => emitSkelNode(child, ctx, false, childArchetypeRef))
      .filter((code): code is string => Boolean(code));
    if (!codes.length) continue;
    const asList = listAttr || codes.some((c) => c.includes("for $"));
    if (asList) {
      if (ctx.shape === "json") {
        const items = codes.map((c) =>
          c.trimStart().startsWith("array") ? `${c}?*` : c
        );
        props.push([attr, `array { ${items.join(", ")} }`]);
      } else {
        const wrapped = codes.map((c) => {
          if (c.trimStart().startsWith("element ") || c.trimStart().startsWith("(for $")) {
            return c;
          }
          return `element rm:${xmlLocalName(attr)} { ${c} }`;
        });
        props.push([attr, wrapped.length === 1 ? wrapped[0]! : `(${wrapped.join(", ")})`]);
      }
    } else {
      props.push([attr, codes[0]!]);
    }
  }
  return props;
}

function formatSkelConstruct(
  node: SkeletonNode,
  props: Array<[string, string]>,
  ctx: XqSkelCtx,
  isRoot: boolean,
): string {
  if (ctx.shape === "json") {
    const fields = [
      `"_type": ${xqString(node.rmType)}`,
      ...props.map(([key, value]) => `${xqString(key)}: ${value}`),
    ];
    return `map { ${fields.join(", ")} }`;
  }
  const elName = xmlLocalName(isRoot ? node.rmType : (node.rmAttribute ?? node.rmType));
  const members = [
    `attribute xsi:type { ${xqString(node.rmType)} }`,
    ...props.map(([key, value]) => xmlChild(key, value)),
  ];
  return `element rm:${elName} { ${members.join(", ")} }`;
}

function xmlChild(key: string, value: string): string {
  const trimmed = value.trimStart();
  if (
    trimmed.startsWith("element ") ||
    trimmed.startsWith("(for $") ||
    trimmed.startsWith("(") ||
    trimmed.startsWith("array ")
  ) {
    return value;
  }
  return `element rm:${xmlLocalName(key)} { ${value} }`;
}

function emitSkelValue(node: SkeletonNode, ctx: XqSkelCtx): string | null {
  const slot = ctx.slots.get(node.slotId);
  let expr: string | null = null;
  if (slot?.expression) {
    try {
      expr = emitXQueryExpr(parseExpression(slot.expression), ctx.env);
    } catch {
      expr = "()";
    }
  }
  const fields = node.fixedFields ?? {};
  const rmType = node.rmType;

  if (rmType === "CODE_PHRASE") {
    const term = fields.terminology_id;
    const code = fields.code_string ?? fields.defining_code;
    const codeExpr = expr ?? (code ? xqString(code) : null);
    if (!term && !codeExpr) return null;
    if (ctx.shape === "json") {
      return `map { "_type": "CODE_PHRASE", "terminology_id": ${
        xqString(term ?? "")
      }, "code_string": ${codeExpr ?? '""'} }`;
    }
    return [
      "element rm:terminology_id { element rm:value { " + xqString(term ?? "") + " } }",
      "element rm:code_string { " + (codeExpr ?? '""') + " }",
    ].join(", ");
  }

  if (rmType === "DV_QUANTITY") {
    if (!expr && !fields.units) return null;
    const mag = expr ?? "()";
    const units = fields.units ? xqString(fields.units) : "()";
    if (ctx.shape === "json") {
      return `map { "_type": "DV_QUANTITY", "magnitude": ${mag}, "units": ${units} }`;
    }
    return `attribute xsi:type { "DV_QUANTITY" }, element rm:magnitude { ${mag} }, element rm:units { ${units} }`;
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    if (ctx.shape === "json") return `map { "_type": ${xqString(rmType)}, "magnitude": ${expr} }`;
    return `attribute xsi:type { ${xqString(rmType)} }, element rm:magnitude { ${expr} }`;
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    if (ctx.shape === "json") return `map { "_type": "DV_BOOLEAN", "value": ${expr} }`;
    return `attribute xsi:type { "DV_BOOLEAN" }, element rm:value { ${expr} }`;
  }

  if (
    rmType === "DV_DATE_TIME" || rmType === "DV_DATE" || rmType === "DV_TIME" ||
    rmType === "DV_DURATION" || rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
    rmType === "DV_TEXT" || rmType === "DV_IDENTIFIER" || rmType === "DV_CODED_TEXT"
  ) {
    const value = expr ?? (fields.value ? xqString(fields.value) : null);
    const code = fields.defining_code ?? fields.code_string;
    if (rmType === "DV_CODED_TEXT") {
      const term = fields.terminology_id ?? "openehr";
      if (!code && !value) return null;
      if (ctx.shape === "json") {
        return `map { "_type": "DV_CODED_TEXT", "value": ${value ?? '""'}, "defining_code": map { "_type": "CODE_PHRASE", "terminology_id": ${xqString(term)}, "code_string": ${code ? xqString(code) : '""'} } }`;
      }
      return `attribute xsi:type { "DV_CODED_TEXT" }, element rm:value { ${
        value ?? '""'
      } }, element rm:defining_code { element rm:terminology_id { element rm:value { ${xqString(term)} } }, element rm:code_string { ${
        code ? xqString(code) : '""'
      } } }`;
    }
    if (!value) return null;
    if (ctx.shape === "json") return `map { "_type": ${xqString(rmType)}, "value": ${value} }`;
    return `attribute xsi:type { ${xqString(rmType)} }, element rm:value { ${value} }`;
  }

  if (rmType === "PARTY_SELF") {
    if (ctx.shape === "json") return `map { "_type": "PARTY_SELF" }`;
    return `attribute xsi:type { "PARTY_SELF" }`;
  }

  if (rmType === "PARTY_IDENTIFIED") {
    if (!expr) return null;
    if (ctx.shape === "json") return `map { "_type": "PARTY_IDENTIFIED", "name": ${expr} }`;
    return `attribute xsi:type { "PARTY_IDENTIFIED" }, element rm:name { ${expr} }`;
  }

  if (expr) {
    if (ctx.shape === "json") return `map { "_type": ${xqString(rmType)}, "value": ${expr} }`;
    return `attribute xsi:type { ${xqString(rmType)} }, element rm:value { ${expr} }`;
  }
  return null;
}

function shouldEmitSkelName(node: SkeletonNode): boolean {
  if (node.rmType === "COMPOSITION") return true;
  if (node.rmType === "EVENT_CONTEXT" || node.rmType.startsWith("PARTY_")) return false;
  return LOCATABLE_TYPES.has(node.rmType);
}

function xmlLocalName(rmType: string): string {
  return rmType.trim().toLowerCase();
}

function xqString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function xqComment(value: string): string {
  return value.replace(/:\)/g, ": )");
}
