/**
 * Skeleton-driven Go text/template codegen for openEHR (canonical JSON & XML)
 * and JSON Schema targets.
 *
 * Uses curated VMS-Go helpers (`jget`, `rmObj`, `list`, `codedText`,
 * `codePhrase`, `partyVal`, `dvVal`, `whenVal`, `toJson`, `rmToXml`,
 * `rmToXmlFrag`, `dict`, `coalesce`, `concat`, `decisionTable`, `sheetLookup`)
 * so normal Blockly mappings produce valid, verifiable Go templates that pass
 * `checkVmsGo`, execute in the Go WASM runtime, and pass strict output validation.
 */
import type {
  MappingInclude,
  MappingLoop,
  MappingModel,
  MappingSlot,
  SkeletonNode,
} from "../../types/mod.ts";
import { type ExprAst, parseExpression } from "../expression/mod.ts";
import { isAutoFixedValueSlot, LOCATABLE_TYPES } from "../rm_mandatory.ts";
import { rmArchetypeNodeId, rmLocatableName } from "../openehr/rm_archetype_node_id.ts";
import { isListAttribute } from "./typescript.ts";
import { codedTextParts } from "../openehr/coded_text.ts";
import { namedLoopBinding } from "../named_loop_path.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";
import { isRelativeAuthoringPath } from "../mapping_model/loops.ts";
import { emitShellFields, type ShellCodegen } from "./shell_emit.ts";
import { octetBytes } from "../rm_shell_fragment.ts";

interface GoSkelCtx {
  slots: Map<string, MappingSlot>;
  loops: MappingLoop[];
  includes?: MappingInclude[];
  /** Current Go expression for the active source context (`.Data` at root, `$item` inside loops). */
  sourceExpr: string;
  /** Loop variable name → Go variable (`$item`). */
  loopBindings: Record<string, string>;
  /** Extra variable bindings (e.g. loop index / length). */
  varBindings: Record<string, string>;
  /** Function parameter names when inside a `define` body. */
  fnParams?: Set<string>;
}

function goStr(s: string): string {
  return JSON.stringify(s);
}

/** Parse JSONPath `$.a.b[1]['flat/key|value']` or `$[1].Avdelning` into jget args (0-based indices). */
function jsonPathToJgetArgs(path: string): string[] {
  const body = path.trim().replace(/^\$\.?/, "");
  const args: string[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === ".") {
      i++;
      continue;
    }
    if (ch === "[") {
      const close = body.indexOf("]", i);
      if (close < 0) break;
      const inner = body.slice(i + 1, close).trim();
      if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        const unquoted = inner.slice(1, -1).replace(/\\(['"\\])/g, "$1");
        args.push(goStr(unquoted));
      } else if (/^\d+$/.test(inner)) {
        // Authoring paths use 1-based XPath positions; Go slices are 0-based.
        args.push(String(Math.max(0, Number(inner) - 1)));
      } else if (inner !== "*") {
        args.push(goStr(inner));
      }
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < body.length && body[j] !== "." && body[j] !== "[") j++;
    if (j > i) args.push(goStr(body.slice(i, j)));
    i = j;
  }
  return args;
}

function emitGoPathExpr(path: string, ctx: GoSkelCtx): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") return ctx.sourceExpr;
  const named = namedLoopBinding(trimmed, ctx.loopBindings);
  if (named) {
    if (named.rest === "." || !named.rest) return named.ident;
    const args = jsonPathToJgetArgs(named.rest.startsWith("$") ? named.rest : `$.${named.rest}`);
    return args.length ? `(jget ${named.ident} ${args.join(" ")})` : named.ident;
  }
  if (ctx.sourceExpr !== ".Data" && isRelativeAuthoringPath(trimmed)) {
    const clean = trimmed.replace(/^\.\//, "");
    const args = jsonPathToJgetArgs(`$.${clean}`);
    return args.length ? `(jget ${ctx.sourceExpr} ${args.join(" ")})` : ctx.sourceExpr;
  }
  if (trimmed.startsWith("$")) {
    const args = jsonPathToJgetArgs(trimmed);
    if (!args.length) return ctx.sourceExpr;
    const primary = `(jget ${ctx.sourceExpr} ${args.join(" ")})`;
    if (ctx.sourceExpr !== ".Data") {
      return `(coalesce ${primary} (jget .Data ${args.join(" ")}))`;
    }
    return primary;
  }
  if (trimmed.startsWith("/")) {
    const parts = trimmed.split("/").filter(Boolean).map((p) => goStr(p));
    return parts.length ? `(jget ${ctx.sourceExpr} ${parts.join(" ")})` : ctx.sourceExpr;
  }
  return `(jget ${ctx.sourceExpr} ${goStr(trimmed)})`;
}

function emitGoAstExpr(ast: ExprAst, ctx: GoSkelCtx): string {
  if (ast.kind === "literal") {
    if (ast.value === null || ast.value === undefined) return "nil";
    if (typeof ast.value === "boolean") return ast.value ? "true" : "false";
    if (typeof ast.value === "number") return String(ast.value);
    return goStr(String(ast.value));
  }
  if (ast.kind === "var") {
    if (ctx.varBindings[ast.name]) return ctx.varBindings[ast.name]!;
    if (ctx.loopBindings[ast.name]) return ctx.loopBindings[ast.name]!;
    if (ctx.fnParams?.has(ast.name)) return `(jget . ${goStr(ast.name)})`;
    return `(jget .Data ${goStr(ast.name)})`;
  }
  const name = ast.name;
  const args = ast.args;

  if (
    name === "xpathString" || name === "xpathNumber" ||
    name === "xpathBoolean" || name === "xpath" || name === "xpathList"
  ) {
    const p = args[0]?.kind === "literal" ? String(args[0].value) : "";
    const base = emitGoPathExpr(p, ctx);
    if (name === "xpathNumber") return `(toNum ${base})`;
    if (name === "xpathBoolean") return `(nonEmpty ${base})`;
    return base;
  }
  if (name === "maps_get") {
    const mapName = args[0]?.kind === "literal" ? String(args[0].value) : "";
    const keyArg = args[1] ? emitGoAstExpr(args[1], ctx) : '""';
    if (mapName === "defaults") return `(jget .Parameters ${keyArg})`;
    return `(jget .Data ${keyArg})`;
  }
  if (name === "map") {
    const pairs: string[] = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      pairs.push(emitGoAstExpr(args[i]!, ctx), emitGoAstExpr(args[i + 1]!, ctx));
    }
    return pairs.length ? `(dict ${pairs.join(" ")})` : "(dict)";
  }
  if (name === "list") {
    const items = args.map((a) => emitGoAstExpr(a, ctx));
    return items.length ? `(list ${items.join(" ")})` : "(list)";
  }
  if (name === "if") {
    const cond = args[0] ? emitGoAstExpr(args[0], ctx) : "false";
    const t = args[1] ? emitGoAstExpr(args[1], ctx) : "nil";
    const f = args[2] ? emitGoAstExpr(args[2], ctx) : "nil";
    return `(coalesce (whenVal ${cond} ${t}) ${f})`;
  }
  if (name === "and" || name === "or") {
    const items = args.map((a) => `(nonEmpty ${emitGoAstExpr(a, ctx)})`);
    return `(${name} ${items.join(" ")})`;
  }
  if (name === "not") {
    const a = args[0] ? emitGoAstExpr(args[0], ctx) : "false";
    return `(not (nonEmpty ${a}))`;
  }
  if (name === "eq" || name === "ne" || name === "lt" || name === "le" || name === "gt" || name === "ge") {
    const a = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const b = args[1] ? emitGoAstExpr(args[1], ctx) : '""';
    return `(${name} ${a} ${b})`;
  }
  if (name === "concat") {
    const items = args.map((a) => emitGoAstExpr(a, ctx));
    return items.length ? `(concat ${items.join(" ")})` : '""';
  }
  if (name === "coalesce" || name === "fallback") {
    const items = args.map((a) => emitGoAstExpr(a, ctx));
    return items.length ? `(coalesce ${items.join(" ")})` : "nil";
  }
  if (name === "trim") {
    return `(trim ${args[0] ? emitGoAstExpr(args[0], ctx) : '""'})`;
  }
  if (name === "toLowerCase" || name === "lower") {
    return `(lower ${args[0] ? emitGoAstExpr(args[0], ctx) : '""'})`;
  }
  if (name === "toUpperCase" || name === "upper") {
    return `(upper ${args[0] ? emitGoAstExpr(args[0], ctx) : '""'})`;
  }
  if (name === "changeCase") {
    const val = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const mode = args[1]?.kind === "literal" ? String(args[1].value).toUpperCase() : "LOWERCASE";
    return mode === "UPPERCASE" ? `(upper ${val})` : `(lower ${val})`;
  }
  if (name === "regex_replace" || name === "regexReplace") {
    const src = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const pattern = args[1] ? emitGoAstExpr(args[1], ctx) : '""';
    const replacement = args[2] ? emitGoAstExpr(args[2], ctx) : '""';
    return `(regexReplaceAll ${pattern} (concat ${src}) ${replacement})`;
  }
  if (name === "replace") {
    const src = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const oldVal = args[1] ? emitGoAstExpr(args[1], ctx) : '""';
    const newVal = args[2] ? emitGoAstExpr(args[2], ctx) : '""';
    return `(replace ${oldVal} ${newVal} ${src})`;
  }
  if (name === "add" || name === "sub" || name === "mul" || name === "div") {
    const a = args[0] ? emitGoAstExpr(args[0], ctx) : "0";
    const b = args[1] ? emitGoAstExpr(args[1], ctx) : "0";
    return `(${name} ${a} ${b})`;
  }
  if (name === "length" || name === "listLength") {
    return `(len ${args[0] ? emitGoAstExpr(args[0], ctx) : "(list)"})`;
  }
  if (name === "sheet_lookup") {
    const sArgs = args.slice(0, 4).map((a) => emitGoAstExpr(a, ctx));
    return `(sheetLookup ${sArgs.join(" ")})`;
  }
  if (name === "decision_table") {
    const sheetName = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const outCol = args[1] ? emitGoAstExpr(args[1], ctx) : '""';
    const dictPairs: string[] = [];
    for (let i = 2; i + 1 < args.length; i += 2) {
      dictPairs.push(emitGoAstExpr(args[i]!, ctx), emitGoAstExpr(args[i + 1]!, ctx));
    }
    return `(decisionTable ${sheetName} (dict ${dictPairs.join(" ")}) ${outCol})`;
  }
  if (name === "handlebars") {
    const tmpl = args[0] ? emitGoAstExpr(args[0], ctx) : '""';
    const c = args[1] ? emitGoAstExpr(args[1], ctx) : ctx.sourceExpr;
    return `(handlebars ${tmpl} ${c})`;
  }
  if (name === "toNumber" || name === "number") {
    return `(toNum ${args[0] ? emitGoAstExpr(args[0], ctx) : "nil"})`;
  }
  if (name === "toString" || name === "string") {
    return `(concat ${args[0] ? emitGoAstExpr(args[0], ctx) : '""'})`;
  }
  return '""';
}

function goShellGen(ctx: GoSkelCtx): ShellCodegen {
  return {
    expr: (expression) => {
      try {
        return emitGoAstExpr(parseExpression(expression), ctx);
      } catch {
        return "nil";
      }
    },
    object: (rmType, fields) => {
      const normalized = rmType === "CODE_PHRASE"
        ? fields.map(([k, v]) =>
          k === "terminology_id" && !v.includes("TERMINOLOGY_ID")
            ? [k, `(rmObj "_type" "TERMINOLOGY_ID" "value" ${v})`] as [string, string]
            : [k, v] as [string, string]
        )
        : fields;
      const flat = normalized.flatMap(([k, v]) => [goStr(k), v]);
      return `(rmObj "_type" ${goStr(rmType)} ${flat.join(" ")})`;
    },
    list: (items) => items.length ? `(list ${items.join(" ")})` : "(list)",
    octets: (code) => {
      const lit = code.startsWith('"') && code.endsWith('"')
        ? (() => { try { return JSON.parse(code) as string; } catch { return null; } })()
        : null;
      const bytes = lit != null ? octetBytes(lit) : null;
      return bytes ? `(list ${bytes.join(" ")})` : "(list)";
    },
  };
}

/** Generate a Go text/template script for a JSON Schema target (`dummy-json-vitals-mapped`, etc.). */
export function emitGoJsonSchemaProduct(
  model: MappingModel,
  skeleton: SkeletonNode[],
): string {
  const ctx: GoSkelCtx = {
    slots: new Map(model.slots.map((s) => [s.slotId, s])),
    loops: model.loops ?? [],
    includes: model.includes,
    sourceExpr: ".Data",
    loopBindings: {},
    varBindings: {},
  };

  const emitNode = (node: SkeletonNode): string | null => {
    if (node.kind === "value") {
      const slot = ctx.slots.get(node.slotId);
      if (!slot?.expression) return null;
      try {
        return emitGoAstExpr(parseExpression(slot.expression), ctx);
      } catch {
        return "nil";
      }
    }
    const pairs: string[] = [];
    for (const child of node.children) {
      const val = emitNode(child);
      if (!val) continue;
      const key = child.rmAttribute ?? child.label;
      pairs.push(`${goStr(key)} ${val}`);
    }
    if (!pairs.length) return null;
    if (node.rmType === "array") {
      return `(list ${pairs.map((p) => p.split(" ").slice(1).join(" ")).join(" ")})`;
    }
    return `(dict ${pairs.join(" ")})`;
  };

  const roots = skeleton.map(emitNode).filter((x): x is string => Boolean(x));
  const rootExpr = !roots.length
    ? "(dict)"
    : roots.length === 1
    ? roots[0]!
    : `(list ${roots.join(" ")})`;
  return `{{- toJson ${rootExpr} -}}`;
}

function nodeHasLoop(node: SkeletonNode, loops: MappingLoop[]): boolean {
  if (loops.some((l) => l.attachSlotId === node.slotId)) return true;
  return node.children.some((c) => nodeHasLoop(c, loops));
}

function shouldEmitGoSkelName(node: SkeletonNode): boolean {
  if (node.rmType === "COMPOSITION") return true;
  if (node.rmType === "EVENT_CONTEXT" || node.rmType.startsWith("PARTY_")) return false;
  return LOCATABLE_TYPES.has(node.rmType);
}

function emitGoSkelValue(node: SkeletonNode, ctx: GoSkelCtx): string | null {
  const slot = ctx.slots.get(node.slotId);
  const coded = node.rmType === "DV_CODED_TEXT" ? codedTextParts(slot?.expression) : null;
  let expr: string | null = null;
  if (slot?.expression) {
    try {
      expr = coded
        ? (coded.value ? emitGoAstExpr(coded.value, ctx) : null)
        : emitGoAstExpr(parseExpression(slot.expression), ctx);
    } catch {
      expr = "nil";
    }
  }
  const fields = node.fixedFields ?? {};
  const rmType = node.rmType;
  const isClinicalElementValue = node.rmAttribute === "value";
  const shellFields = emitShellFields(slot?.shellFragments, goShellGen(ctx));
  const shellFlat = shellFields.flatMap(([k, v]) => [goStr(k), v]);

  if (rmType === "CODE_PHRASE") {
    const term = fields.terminology_id ?? "";
    const code = fields.code_string ?? fields.defining_code;
    const codeExpr = expr ?? (code ? goStr(code) : null);
    if (!term && !codeExpr) return null;
    return `(codePhrase ${codeExpr ?? '""'} ${goStr(term)})`;
  }

  if (rmType === "DV_QUANTITY") {
    if (!expr) return null;
    const hasShellUnits = Boolean(slot?.shellFragments && "units" in slot.shellFragments);
    const extras = [
      ...(hasShellUnits ? [] : [goStr("units"), goStr(fields.units ?? "")]),
      ...shellFlat,
    ];
    return `(dvVal "DV_QUANTITY" ${expr} "magnitude"${extras.length ? " " + extras.join(" ") : ""})`;
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    const prop = rmType === "DV_ORDINAL" ? "value" : "magnitude";
    return `(dvVal ${goStr(rmType)} ${expr} ${goStr(prop)}${shellFlat.length ? " " + shellFlat.join(" ") : ""})`;
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    return `(dvVal "DV_BOOLEAN" ${expr} "value"${shellFlat.length ? " " + shellFlat.join(" ") : ""})`;
  }

  if (rmType === "DV_CODED_TEXT") {
    if (!expr && !coded && isClinicalElementValue) return null;
    const value = expr ?? (fields.value ? goStr(fields.value) : null);
    const fixedCode = fields.defining_code ?? fields.code_string;
    const term = coded?.terminology ? emitGoAstExpr(coded.terminology, ctx) : goStr(fields.terminology_id ?? "openehr");
    const code = coded?.code ? emitGoAstExpr(coded.code, ctx) : (fixedCode ? goStr(fixedCode) : null);
    if (!code && !value) return null;
    const hasShellDef = Boolean(slot?.shellFragments && "defining_code" in slot.shellFragments);
    if (value && !coded && !hasShellDef && node.allowedValues?.length) {
      const pairs = node.allowedValues.map((av) => goStr(`${av.code}=${av.label}`)).join(" ");
      const avTerm = goStr(node.allowedValues[0]?.terminologyId ?? fields.terminology_id ?? "local");
      return `(codedText ${value} ${avTerm} ${pairs})`;
    }
    if (value && !coded && !code && !hasShellDef && node.rmAttribute === "category") {
      return `(codedText ${value} "openehr" "433=event" "431=persistent" "435=episodic")`;
    }
    const defPart = hasShellDef
      ? []
      : [
        goStr("defining_code"),
        `(rmObj "_type" "CODE_PHRASE" "terminology_id" (rmObj "_type" "TERMINOLOGY_ID" "value" ${term}) "code_string" ${code ?? '""'})`,
      ];
    const objExpr = `(rmObj "_type" "DV_CODED_TEXT" "value" ${value ?? '""'} ${[...defPart, ...shellFlat].join(" ")})`;
    if (value && !coded && isClinicalElementValue) {
      return `(whenVal ${value} ${objExpr})`;
    }
    return objExpr;
  }

  if (
    rmType === "DV_DATE_TIME" || rmType === "DV_DATE" || rmType === "DV_TIME" ||
    rmType === "DV_DURATION" || rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
    rmType === "DV_TEXT" || rmType === "DV_IDENTIFIER"
  ) {
    const value = expr ?? (isClinicalElementValue ? null : (fields.value ? goStr(fields.value) : null));
    if (!value) return null;
    const prop = rmType === "DV_IDENTIFIER" ? "id" : "value";
    return `(dvVal ${goStr(rmType)} ${value} ${goStr(prop)}${shellFlat.length ? " " + shellFlat.join(" ") : ""})`;
  }

  if (rmType === "PARTY_PROXY" || rmType === "PARTY_IDENTIFIED" || rmType === "PARTY_SELF") {
    const fallback = rmType === "PARTY_SELF" || node.rmAttribute === "subject"
      ? "PARTY_SELF"
      : "PARTY_IDENTIFIED";
    if (expr) return `(partyVal ${expr} ${goStr(fallback)})`;
    if (fallback === "PARTY_SELF") return `(rmObj "_type" "PARTY_SELF")`;
    return null;
  }

  if (expr) {
    return `(dvVal ${goStr(rmType)} ${expr} "value")`;
  }
  return null;
}

function guardGoExpr(node: SkeletonNode, expr: string, ctx: GoSkelCtx): string {
  const inc = ctx.includes?.find((item) => item.slotId === node.slotId);
  if (!inc?.when || inc.elseEmits) return expr;
  try {
    const cond = emitGoAstExpr(parseExpression(inc.when), ctx);
    return `(whenVal ${cond} ${expr})`;
  } catch {
    return expr;
  }
}

function emitGoPureNode(
  node: SkeletonNode,
  ctx: GoSkelCtx,
  parentArchetypeRef?: string,
): string | null {
  if (node.kind === "value") return emitGoSkelValue(node, ctx);
  if (isAutoFixedValueSlot(node)) return null;

  if (
    node.rmType === "PARTY_PROXY" ||
    node.rmType === "PARTY_IDENTIFIED" ||
    node.rmType === "PARTY_SELF"
  ) {
    const directSlot = ctx.slots.get(node.slotId);
    if (directSlot?.expression) return emitGoSkelValue(node, ctx);
    for (const child of node.children) {
      const c = emitGoPureNode(child, ctx, parentArchetypeRef);
      if (c) return c;
    }
    if (node.rmType === "PARTY_PROXY" && node.rmAttribute === "subject") {
      return `(rmObj "_type" "PARTY_SELF")`;
    }
    if (node.rmType === "PARTY_SELF") return `(rmObj "_type" "PARTY_SELF")`;
    return null;
  }

  const pairs: Array<[string, string]> = [];
  pairs.push(["_type", goStr(node.rmType)]);
  const locatableName = rmLocatableName(node);
  if (locatableName && shouldEmitGoSkelName(node)) {
    pairs.push(["name", `(rmObj "_type" "DV_TEXT" "value" ${goStr(locatableName)})`]);
  }
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  if (nodeId) pairs.push(["archetype_node_id", goStr(nodeId)]);
  if (node.rmType === "ACTIVITY") {
    pairs.push(["action_archetype_id", goStr(node.fixedFields?.action_archetype_id ?? "/.*/")]);
  }

  const childRef = node.archetypeRef ?? parentArchetypeRef;
  const grouped = new Map<string, SkeletonNode[]>();
  for (const child of node.children) {
    if (isAutoFixedValueSlot(child)) continue;
    const attr = child.rmAttribute ?? child.label;
    const list = grouped.get(attr) ?? [];
    list.push(child);
    grouped.set(attr, list);
  }

  let hasNonMeta = false;
  for (const [attr, children] of grouped) {
    const listAttr = isListAttribute(node.rmType, attr);
    const codes = children
      .map((c) => emitGoPureNode(c, ctx, childRef))
      .filter((x): x is string => Boolean(x));
    if (!codes.length) continue;
    if (
      attr !== "language" && attr !== "encoding" && attr !== "subject" &&
      attr !== "name" && attr !== "archetype_node_id"
    ) {
      hasNonMeta = true;
    }
    if (listAttr) {
      pairs.push([attr, `(list ${codes.join(" ")})`]);
    } else {
      const idx = pairs.findIndex(([k]) => k === attr);
      if (idx >= 0) pairs[idx] = [attr, codes[0]!];
      else pairs.push([attr, codes[0]!]);
    }
  }

  if (node.rmType !== "COMPOSITION" && !hasNonMeta) return null;
  const keys = new Set(pairs.map(([k]) => k));
  if (node.rmType === "ELEMENT" && !keys.has("value")) return null;
  if ((node.rmType === "ITEM_TREE" || node.rmType === "SECTION" || node.rmType === "CLUSTER") && !keys.has("items")) return null;
  if ((node.rmType === "EVENT" || node.rmType === "POINT_EVENT" || node.rmType === "INTERVAL_EVENT" || node.rmType === "OBSERVATION" || node.rmType === "EVALUATION") && !keys.has("data")) return null;
  if ((node.rmType === "ACTIVITY" || node.rmType === "ACTION") && !keys.has("description")) return null;
  if (node.rmType === "HISTORY" && !keys.has("events")) return null;
  if (node.rmType === "INSTRUCTION" && !keys.has("activities")) return null;
  const flat = pairs.flatMap(([k, v]) => [goStr(k), v]);
  return guardGoExpr(node, `(rmObj ${flat.join(" ")})`, ctx);
}

/**
 * Emit a Go text/template fragment for a node that contains one or more
 * `for_each_list` loops, rendering either canonical JSON or canonical openEHR XML.
 */
function emitGoLoopedNode(
  node: SkeletonNode,
  ctx: GoSkelCtx,
  isXml: boolean,
  isRoot: boolean,
  parentArchetypeRef?: string,
  tagOverride?: string,
): string {
  const tag = tagOverride ?? (isRoot ? "composition" : (node.rmAttribute ?? node.rmType.toLowerCase()));
  const loop = ctx.loops.find((l) => l.attachSlotId === node.slotId);
  if (loop) {
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(loop.varName) ? loop.varName : "item";
    const goVar = `$${ident}`;
    const idxVar = `$${ident}_i`;
    const colExpr = loop.collection
      ? emitGoAstExpr(parseExpression(loop.collection), ctx)
      : emitGoPathExpr(loop.path ?? "", ctx);
    const innerCtx: GoSkelCtx = {
      ...ctx,
      loops: ctx.loops.filter((l) => l !== loop),
      sourceExpr: goVar,
      loopBindings: { ...ctx.loopBindings, [loop.varName]: goVar },
      varBindings: {
        ...ctx.varBindings,
        [loopIndexBinderName(loop.varName)]: idxVar,
        [loopLengthBinderName(loop.varName)]: `(len ${colExpr})`,
      },
    };
    const innerHasLoop = nodeHasLoop(node, innerCtx.loops);
    if (innerHasLoop) {
      const body = emitGoLoopedNode(node, innerCtx, isXml, false, parentArchetypeRef, tag);
      if (isXml) {
        return `{{- range ${idxVar}, ${goVar} := ${colExpr} }}${body}{{- end }}`;
      }
      return `{{- range ${idxVar}, ${goVar} := ${colExpr} }}{{- if ${idxVar} }},{{ end }}${body}{{- end }}`;
    }
    const pure = emitGoPureNode(node, innerCtx, parentArchetypeRef);
    if (!pure) return "";
    if (isXml) {
      return `{{- range ${idxVar}, ${goVar} := ${colExpr} }}{{- rmToXmlFrag ${goStr(tag)} ${pure} -}}{{- end }}`;
    }
    return `{{- range ${idxVar}, ${goVar} := ${colExpr} }}{{- $el := ${pure} }}{{- if $el }}{{- if ${idxVar} }},{{ end }}{{- toJson $el -}}{{- end }}{{- end }}`;
  }

  const locatableName = rmLocatableName(node);
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  const childRef = node.archetypeRef ?? parentArchetypeRef;
  const grouped = new Map<string, SkeletonNode[]>();
  for (const child of node.children) {
    if (isAutoFixedValueSlot(child)) continue;
    const attr = child.rmAttribute ?? child.label;
    const list = grouped.get(attr) ?? [];
    list.push(child);
    grouped.set(attr, list);
  }

  if (isXml) {
    const attrs: string[] = [];
    if (isRoot) {
      attrs.push('xmlns="http://schemas.openehr.org/v1"', 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    }
    attrs.push(`xsi:type="${node.rmType}"`);
    if (nodeId) attrs.push(`archetype_node_id="${nodeId}"`);
    const parts: string[] = [];
    if (isRoot) parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
    parts.push(`<${tag} ${attrs.join(" ")}>`);
    const hasExplicitName = grouped.has("name");
    if (locatableName && shouldEmitGoSkelName(node) && !hasExplicitName) {
      parts.push(`<name xsi:type="DV_TEXT"><value>${escapeXmlStatic(locatableName)}</value></name>`);
    }
    if (node.rmType === "ACTIVITY") {
      parts.push(`<action_archetype_id>${escapeXmlStatic(node.fixedFields?.action_archetype_id ?? "/.*/")}</action_archetype_id>`);
    }
    for (const [attr, children] of grouped) {
      for (const child of children) {
        if (nodeHasLoop(child, ctx.loops)) {
          parts.push(emitGoLoopedNode(child, ctx, true, false, childRef, attr));
        } else {
          const pure = emitGoPureNode(child, ctx, childRef);
          if (pure) parts.push(`{{- rmToXmlFrag ${goStr(attr)} ${pure} -}}`);
        }
      }
    }
    parts.push(`</${tag}>`);
    return parts.join("");
  }

  // JSON mode for a container holding at least one loop descendant.
  const fields: string[] = [`"_type": ${goStr(node.rmType)}`];
  const hasExplicitName = grouped.has("name");
  if (locatableName && shouldEmitGoSkelName(node) && !hasExplicitName) {
    fields.push(`"name": {"_type": "DV_TEXT", "value": ${goStr(locatableName)}}`);
  }
  if (nodeId) fields.push(`"archetype_node_id": ${goStr(nodeId)}`);
  if (node.rmType === "ACTIVITY") {
    fields.push(`"action_archetype_id": ${goStr(node.fixedFields?.action_archetype_id ?? "/.*/")}`);
  }
  for (const [attr, children] of grouped) {
    const listAttr = isListAttribute(node.rmType, attr);
    const hasChildLoop = children.some((c) => nodeHasLoop(c, ctx.loops));
    if (hasChildLoop) {
      const rendered = children.map((c) => {
        if (nodeHasLoop(c, ctx.loops)) {
          return emitGoLoopedNode(c, ctx, false, false, childRef, attr);
        }
        const pure = emitGoPureNode(c, ctx, childRef);
        return pure ? `{{- toJson ${pure} -}}` : "";
      }).filter(Boolean);
      if (!rendered.length) continue;
      fields.push(listAttr ? `${goStr(attr)}: [${rendered.join(",")}]` : `${goStr(attr)}: ${rendered[0]!}`);
    } else if (listAttr) {
      const pureItems = children
        .map((c) => emitGoPureNode(c, ctx, childRef))
        .filter((x): x is string => Boolean(x));
      if (!pureItems.length) continue;
      fields.push(`${goStr(attr)}: {{- toJson (list ${pureItems.join(" ")}) -}}`);
    } else {
      const pure = emitGoPureNode(children[0]!, ctx, childRef);
      if (!pure) continue;
      fields.push(`${goStr(attr)}: {{- toJson ${pure} -}}`);
    }
  }
  return `{${fields.join(", ")}}`;
}

function escapeXmlStatic(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generate a Go text/template script for an openEHR template (canonical JSON or canonical XML). */
export function emitGoOpenEhrProduct(
  model: MappingModel,
  skeleton: SkeletonNode[],
  isXml: boolean,
): string {
  const ctx: GoSkelCtx = {
    slots: new Map(model.slots.map((s) => [s.slotId, s])),
    loops: model.loops ?? [],
    includes: model.includes,
    sourceExpr: ".Data",
    loopBindings: {},
    varBindings: {},
  };

  const root = skeleton[0];
  if (!root) {
    return isXml
      ? `{{- rmToXml "composition" (rmObj "_type" "COMPOSITION") -}}`
      : `{{- toJson (rmObj "_type" "COMPOSITION") -}}`;
  }

  if (nodeHasLoop(root, ctx.loops)) {
    return emitGoLoopedNode(root, ctx, isXml, true);
  }
  const pure = emitGoPureNode(root, ctx);
  if (!pure) {
    return isXml
      ? `{{- rmToXml "composition" (rmObj "_type" "COMPOSITION") -}}`
      : `{{- toJson (rmObj "_type" "COMPOSITION") -}}`;
  }
  return isXml
    ? `{{- rmToXml "composition" ${pure} -}}`
    : `{{- toJson ${pure} -}}`;
}
