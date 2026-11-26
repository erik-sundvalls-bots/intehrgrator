/**
 * Skeleton-driven Handlebars (VMS-Hbs) codegen for openEHR (canonical JSON &
 * XML) and JSON Schema targets.
 *
 * Emits double-stache VMS-Hbs (`{{toJson ...}}`, `{{rmToXml ...}}`,
 * `{{#each ...}}`, `(rmObj ...)`, `(jget ...)`, `(codedText ...)`, etc.) that
 * passes `checkVmsHbs` (ADR 0009), runs in the real Handlebars engine via
 * `renderHandlebars`, and passes strict openEHR / JSON Schema output validation.
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

interface HbsSkelCtx {
  slots: Map<string, MappingSlot>;
  loops: MappingLoop[];
  includes?: MappingInclude[];
  /** Current Handlebars context expression (`@root._data` at root, `this` inside `#each`). */
  sourceExpr: string;
  /** Loop variable name → Handlebars context path (`this` or `../`). */
  loopBindings: Record<string, string>;
  varBindings: Record<string, string>;
}

function hbsStr(s: string): string {
  return JSON.stringify(s);
}

/** Valid Handlebars hash key (`foo` or quoted if needed; RM keys are snake_case identifiers). */
function hbsHashKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : hbsStr(k);
}

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
        args.push(hbsStr(unquoted));
      } else if (/^\d+$/.test(inner)) {
        args.push(String(Math.max(0, Number(inner) - 1)));
      } else if (inner !== "*") {
        args.push(hbsStr(inner));
      }
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < body.length && body[j] !== "." && body[j] !== "[") j++;
    if (j > i) args.push(hbsStr(body.slice(i, j)));
    i = j;
  }
  return args;
}

function emitHbsPathExpr(path: string, ctx: HbsSkelCtx): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") return ctx.sourceExpr;
  const named = namedLoopBinding(trimmed, ctx.loopBindings);
  if (named) {
    if (named.rest === "." || !named.rest) return named.ident;
    const args = jsonPathToJgetArgs(named.rest.startsWith("$") ? named.rest : `$.${named.rest}`);
    return args.length ? `(jget ${named.ident} ${args.join(" ")})` : named.ident;
  }
  if (ctx.sourceExpr !== "@root._data" && isRelativeAuthoringPath(trimmed)) {
    const clean = trimmed.replace(/^\.\//, "");
    const args = jsonPathToJgetArgs(`$.${clean}`);
    return args.length ? `(jget ${ctx.sourceExpr} ${args.join(" ")})` : ctx.sourceExpr;
  }
  if (trimmed.startsWith("$")) {
    const args = jsonPathToJgetArgs(trimmed);
    if (!args.length) return ctx.sourceExpr;
    const primary = `(jget ${ctx.sourceExpr} ${args.join(" ")})`;
    if (ctx.sourceExpr !== "@root._data") {
      return `(coalesce ${primary} (jget @root._data ${args.join(" ")}))`;
    }
    return primary;
  }
  if (trimmed.startsWith("/")) {
    const parts = trimmed.split("/").filter(Boolean).map((p) => hbsStr(p));
    return parts.length ? `(jget ${ctx.sourceExpr} ${parts.join(" ")})` : ctx.sourceExpr;
  }
  return `(jget ${ctx.sourceExpr} ${hbsStr(trimmed)})`;
}

function emitHbsAstExpr(ast: ExprAst, ctx: HbsSkelCtx): string {
  if (ast.kind === "literal") {
    if (ast.value === null || ast.value === undefined) return "null";
    if (typeof ast.value === "boolean") return ast.value ? "true" : "false";
    if (typeof ast.value === "number") return String(ast.value);
    return hbsStr(String(ast.value));
  }
  if (ast.kind === "var") {
    if (ctx.varBindings[ast.name]) return ctx.varBindings[ast.name]!;
    if (ctx.loopBindings[ast.name]) return ctx.loopBindings[ast.name]!;
    return `(jget @root._data ${hbsStr(ast.name)})`;
  }
  const name = ast.name;
  const args = ast.args;

  if (
    name === "xpathString" || name === "xpathNumber" ||
    name === "xpathBoolean" || name === "xpath" || name === "xpathList"
  ) {
    const p = args[0]?.kind === "literal" ? String(args[0].value) : "";
    const base = emitHbsPathExpr(p, ctx);
    if (name === "xpathNumber") return `(toNum ${base})`;
    if (name === "xpathBoolean") return `(nonEmpty ${base})`;
    return base;
  }
  if (name === "maps_get") {
    const mapName = args[0]?.kind === "literal" ? String(args[0].value) : "";
    const keyArg = args[1] ? emitHbsAstExpr(args[1], ctx) : '""';
    if (mapName === "defaults") return `(defaultVal ${keyArg})`;
    return `(jget @root._data ${keyArg})`;
  }
  if (name === "map") {
    const pairs: string[] = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (args[i]?.kind === "literal") {
        pairs.push(`${hbsHashKey(String(args[i]!.value))}=${emitHbsAstExpr(args[i + 1]!, ctx)}`);
      }
    }
    return pairs.length ? `(dict ${pairs.join(" ")})` : "(dict)";
  }
  if (name === "list") {
    const items = args.map((a) => emitHbsAstExpr(a, ctx));
    return items.length ? `(list ${items.join(" ")})` : "(list)";
  }
  if (name === "if") {
    const cond = args[0] ? emitHbsAstExpr(args[0], ctx) : "false";
    const t = args[1] ? emitHbsAstExpr(args[1], ctx) : "null";
    const f = args[2] ? emitHbsAstExpr(args[2], ctx) : "null";
    return `(coalesce (whenVal ${cond} ${t}) ${f})`;
  }
  if (name === "and" || name === "or") {
    const items = args.map((a) => `(nonEmpty ${emitHbsAstExpr(a, ctx)})`);
    return `(${name} ${items.join(" ")})`;
  }
  if (name === "not") {
    return `(not ${args[0] ? emitHbsAstExpr(args[0], ctx) : "false"})`;
  }
  if (name === "eq" || name === "ne" || name === "lt" || name === "gt") {
    const a = args[0] ? emitHbsAstExpr(args[0], ctx) : '""';
    const b = args[1] ? emitHbsAstExpr(args[1], ctx) : '""';
    return `(${name} ${a} ${b})`;
  }
  if (name === "le" || name === "lte") {
    const a = args[0] ? emitHbsAstExpr(args[0], ctx) : "0";
    const b = args[1] ? emitHbsAstExpr(args[1], ctx) : "0";
    return `(lte ${a} ${b})`;
  }
  if (name === "ge" || name === "gte") {
    const a = args[0] ? emitHbsAstExpr(args[0], ctx) : "0";
    const b = args[1] ? emitHbsAstExpr(args[1], ctx) : "0";
    return `(gte ${a} ${b})`;
  }
  if (name === "concat") {
    const items = args.map((a) => emitHbsAstExpr(a, ctx));
    return items.length ? `(concat ${items.join(" ")})` : '""';
  }
  if (name === "coalesce" || name === "fallback") {
    const items = args.map((a) => emitHbsAstExpr(a, ctx));
    return items.length ? `(coalesce ${items.join(" ")})` : "null";
  }
  if (name === "trim") return `(trim ${args[0] ? emitHbsAstExpr(args[0], ctx) : '""'})`;
  if (name === "regex_replace") {
    const items = [0, 1, 2].map((i) => args[i] ? emitHbsAstExpr(args[i]!, ctx) : '""');
    return `(regexReplace ${items.join(" ")})`;
  }
  if (name === "toLowerCase" || name === "lower") {
    return `(toLowerCase ${args[0] ? emitHbsAstExpr(args[0], ctx) : '""'})`;
  }
  if (name === "toUpperCase" || name === "upper") {
    return `(toUpperCase ${args[0] ? emitHbsAstExpr(args[0], ctx) : '""'})`;
  }
  if (name === "changeCase") {
    const val = args[0] ? emitHbsAstExpr(args[0], ctx) : '""';
    const mode = args[1]?.kind === "literal" ? String(args[1].value).toUpperCase() : "LOWERCASE";
    return mode === "UPPERCASE" ? `(toUpperCase ${val})` : `(toLowerCase ${val})`;
  }
  if (name === "replace") {
    const src = args[0] ? emitHbsAstExpr(args[0], ctx) : '""';
    const oldVal = args[1] ? emitHbsAstExpr(args[1], ctx) : '""';
    const newVal = args[2] ? emitHbsAstExpr(args[2], ctx) : '""';
    return `(replace ${src} ${oldVal} ${newVal})`;
  }
  if (name === "add" || name === "sub" || name === "mul" || name === "div") {
    const a = args[0] ? emitHbsAstExpr(args[0], ctx) : "0";
    const b = args[1] ? emitHbsAstExpr(args[1], ctx) : "0";
    return `(${name} ${a} ${b})`;
  }
  if (name === "toNumber" || name === "number") {
    return `(toNum ${args[0] ? emitHbsAstExpr(args[0], ctx) : "null"})`;
  }
  if (name === "toString" || name === "string") {
    return `(concat ${args[0] ? emitHbsAstExpr(args[0], ctx) : '""'})`;
  }
  return '""';
}

function hbsShellGen(ctx: HbsSkelCtx): ShellCodegen {
  return {
    expr: (expression) => {
      try {
        return emitHbsAstExpr(parseExpression(expression), ctx);
      } catch {
        return "null";
      }
    },
    object: (rmType, fields) => {
      const normalized = rmType === "CODE_PHRASE"
        ? fields.map(([k, v]) =>
          k === "terminology_id" && !v.includes("TERMINOLOGY_ID")
            ? [k, `(rmObj _type="TERMINOLOGY_ID" value=${v})`] as [string, string]
            : [k, v] as [string, string]
        )
        : fields;
      const hashParts = normalized.map(([k, v]) => `${hbsHashKey(k)}=${v}`);
      return `(rmObj _type=${hbsStr(rmType)}${hashParts.length ? " " + hashParts.join(" ") : ""})`;
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

/** Generate a VMS-Hbs Handlebars template for a JSON Schema target. */
export function emitHandlebarsJsonSchemaProduct(
  model: MappingModel,
  skeleton: SkeletonNode[],
): string {
  const ctx: HbsSkelCtx = {
    slots: new Map(model.slots.map((s) => [s.slotId, s])),
    loops: model.loops ?? [],
    includes: model.includes,
    sourceExpr: "@root._data",
    loopBindings: {},
    varBindings: {},
  };

  const emitNode = (node: SkeletonNode): string | null => {
    if (node.kind === "value") {
      const slot = ctx.slots.get(node.slotId);
      if (!slot?.expression) return null;
      try {
        return emitHbsAstExpr(parseExpression(slot.expression), ctx);
      } catch {
        return "null";
      }
    }
    const entries: Array<[string, string]> = [];
    for (const child of node.children) {
      const val = emitNode(child);
      if (!val) continue;
      entries.push([child.rmAttribute ?? child.label, val]);
    }
    if (!entries.length) return null;
    if (node.rmType === "array") {
      return `(list ${entries.map(([, v]) => v).join(" ")})`;
    }
    return `(dict ${entries.map(([k, v]) => `${hbsHashKey(k)}=${v}`).join(" ")})`;
  };

  const roots = skeleton.map(emitNode).filter((x): x is string => Boolean(x));
  const rootExpr = !roots.length
    ? "(dict)"
    : roots.length === 1
    ? roots[0]!
    : `(list ${roots.join(" ")})`;
  return [
    `{{!-- Generated by intEHRgrator — Handlebars Conversion Script (JSON Schema) --}}`,
    `{{!-- Target: ${model.templateId} --}}`,
    `{{toJson ${rootExpr}}}`,
  ].join("\n");
}

function nodeHasLoop(node: SkeletonNode, loops: MappingLoop[]): boolean {
  if (loops.some((l) => l.attachSlotId === node.slotId)) return true;
  return node.children.some((c) => nodeHasLoop(c, loops));
}

function shouldEmitHbsSkelName(node: SkeletonNode): boolean {
  if (node.rmType === "COMPOSITION") return true;
  if (node.rmType === "EVENT_CONTEXT" || node.rmType.startsWith("PARTY_")) return false;
  return LOCATABLE_TYPES.has(node.rmType);
}

function emitHbsSkelValue(node: SkeletonNode, ctx: HbsSkelCtx): string | null {
  const slot = ctx.slots.get(node.slotId);
  const coded = node.rmType === "DV_CODED_TEXT" ? codedTextParts(slot?.expression) : null;
  let expr: string | null = null;
  if (slot?.expression) {
    try {
      expr = coded
        ? (coded.value ? emitHbsAstExpr(coded.value, ctx) : null)
        : emitHbsAstExpr(parseExpression(slot.expression), ctx);
    } catch {
      expr = "null";
    }
  }
  const fields = node.fixedFields ?? {};
  const rmType = node.rmType;
  const isClinicalElementValue = node.rmAttribute === "value";
  const shellFields = emitShellFields(slot?.shellFragments, hbsShellGen(ctx));
  const shellHash = shellFields.map(([k, v]) => `${hbsHashKey(k)}=${v}`);

  if (rmType === "CODE_PHRASE") {
    const term = fields.terminology_id ?? "";
    const code = fields.code_string ?? fields.defining_code;
    const codeExpr = expr ?? (code ? hbsStr(code) : null);
    if (!term && !codeExpr) return null;
    return `(codePhrase ${codeExpr ?? '""'} ${hbsStr(term)})`;
  }

  if (rmType === "DV_QUANTITY") {
    if (!expr) return null;
    const hasShellUnits = Boolean(slot?.shellFragments && "units" in slot.shellFragments);
    const extras = [
      ...(hasShellUnits ? [] : [`units=${hbsStr(fields.units ?? "")}`]),
      ...shellHash,
    ];
    return `(dvVal "DV_QUANTITY" ${expr} "magnitude"${extras.length ? " " + extras.join(" ") : ""})`;
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    const prop = rmType === "DV_ORDINAL" ? "value" : "magnitude";
    return `(dvVal ${hbsStr(rmType)} ${expr} ${hbsStr(prop)}${shellHash.length ? " " + shellHash.join(" ") : ""})`;
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    return `(dvVal "DV_BOOLEAN" ${expr} "value"${shellHash.length ? " " + shellHash.join(" ") : ""})`;
  }

  if (rmType === "DV_CODED_TEXT") {
    if (!expr && !coded && isClinicalElementValue) return null;
    const value = expr ?? (fields.value ? hbsStr(fields.value) : null);
    const fixedCode = fields.defining_code ?? fields.code_string;
    const term = coded?.terminology ? emitHbsAstExpr(coded.terminology, ctx) : hbsStr(fields.terminology_id ?? "openehr");
    const code = coded?.code ? emitHbsAstExpr(coded.code, ctx) : (fixedCode ? hbsStr(fixedCode) : null);
    if (!code && !value) return null;
    const hasShellDef = Boolean(slot?.shellFragments && "defining_code" in slot.shellFragments);
    if (value && !coded && !hasShellDef && node.allowedValues?.length) {
      const pairs = node.allowedValues.map((av) => hbsStr(`${av.code}=${av.label}`)).join(" ");
      const avTerm = hbsStr(node.allowedValues[0]?.terminologyId ?? fields.terminology_id ?? "local");
      return `(codedText ${value} ${avTerm} ${pairs})`;
    }
    if (value && !coded && !code && !hasShellDef && node.rmAttribute === "category") {
      return `(codedText ${value} "openehr" "433=event" "431=persistent" "435=episodic")`;
    }
    const defPart = hasShellDef
      ? []
      : [
        `defining_code=(rmObj _type="CODE_PHRASE" terminology_id=(rmObj _type="TERMINOLOGY_ID" value=${term}) code_string=${code ?? '""'})`,
      ];
    const objExpr = `(rmObj _type="DV_CODED_TEXT" value=${value ?? '""'} ${[...defPart, ...shellHash].join(" ")})`;
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
    const value = expr ?? (isClinicalElementValue ? null : (fields.value ? hbsStr(fields.value) : null));
    if (!value) return null;
    const prop = rmType === "DV_IDENTIFIER" ? "id" : "value";
    return `(dvVal ${hbsStr(rmType)} ${value} ${hbsStr(prop)}${shellHash.length ? " " + shellHash.join(" ") : ""})`;
  }

  if (rmType === "PARTY_PROXY" || rmType === "PARTY_IDENTIFIED" || rmType === "PARTY_SELF") {
    const fallback = rmType === "PARTY_SELF" || node.rmAttribute === "subject"
      ? "PARTY_SELF"
      : "PARTY_IDENTIFIED";
    if (expr) return `(partyVal ${expr} ${hbsStr(fallback)})`;
    if (fallback === "PARTY_SELF") return `(rmObj _type="PARTY_SELF")`;
    return null;
  }

  if (expr) return `(dvVal ${hbsStr(rmType)} ${expr} "value")`;
  return null;
}

function guardHbsExpr(node: SkeletonNode, expr: string, ctx: HbsSkelCtx): string {
  const inc = ctx.includes?.find((item) => item.slotId === node.slotId);
  if (!inc?.when || inc.elseEmits) return expr;
  try {
    const cond = emitHbsAstExpr(parseExpression(inc.when), ctx);
    return `(whenVal ${cond} ${expr})`;
  } catch {
    return expr;
  }
}

function emitHbsPureNode(
  node: SkeletonNode,
  ctx: HbsSkelCtx,
  parentArchetypeRef?: string,
): string | null {
  if (node.kind === "value") return emitHbsSkelValue(node, ctx);
  if (isAutoFixedValueSlot(node)) return null;

  if (
    node.rmType === "PARTY_PROXY" ||
    node.rmType === "PARTY_IDENTIFIED" ||
    node.rmType === "PARTY_SELF"
  ) {
    const directSlot = ctx.slots.get(node.slotId);
    if (directSlot?.expression) return emitHbsSkelValue(node, ctx);
    for (const child of node.children) {
      const c = emitHbsPureNode(child, ctx, parentArchetypeRef);
      if (c) return c;
    }
    if (node.rmType === "PARTY_PROXY" && node.rmAttribute === "subject") {
      return `(rmObj _type="PARTY_SELF")`;
    }
    if (node.rmType === "PARTY_SELF") return `(rmObj _type="PARTY_SELF")`;
    return null;
  }

  const pairs: Array<[string, string]> = [];
  pairs.push(["_type", hbsStr(node.rmType)]);
  const locatableName = rmLocatableName(node);
  if (locatableName && shouldEmitHbsSkelName(node)) {
    pairs.push(["name", `(rmObj _type="DV_TEXT" value=${hbsStr(locatableName)})`]);
  }
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  if (nodeId) pairs.push(["archetype_node_id", hbsStr(nodeId)]);
  if (node.rmType === "ACTIVITY") {
    pairs.push(["action_archetype_id", hbsStr(node.fixedFields?.action_archetype_id ?? "/.*/")]);
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
      .map((c) => emitHbsPureNode(c, ctx, childRef))
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

  const hashParts = pairs.map(([k, v]) => `${hbsHashKey(k)}=${v}`);
  return guardHbsExpr(node, `(rmObj ${hashParts.join(" ")})`, ctx);
}

function escapeXmlStatic(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emitHbsLoopedNode(
  node: SkeletonNode,
  ctx: HbsSkelCtx,
  isXml: boolean,
  isRoot: boolean,
  parentArchetypeRef?: string,
  tagOverride?: string,
): string {
  const tag = tagOverride ?? (isRoot ? "composition" : (node.rmAttribute ?? node.rmType.toLowerCase()));
  const loop = ctx.loops.find((l) => l.attachSlotId === node.slotId);
  if (loop) {
    const colExpr = loop.collection
      ? emitHbsAstExpr(parseExpression(loop.collection), ctx)
      : emitHbsPathExpr(loop.path ?? "", ctx);
    const parentBindings: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx.loopBindings)) {
      parentBindings[k] = v === "this" ? ".." : `../${v}`;
    }
    const innerCtx: HbsSkelCtx = {
      ...ctx,
      loops: ctx.loops.filter((l) => l !== loop),
      sourceExpr: "this",
      loopBindings: { ...parentBindings, [loop.varName]: "this" },
      varBindings: {
        ...ctx.varBindings,
        [loopIndexBinderName(loop.varName)]: "@index",
        [loopLengthBinderName(loop.varName)]: "0",
      },
    };
    const innerHasLoop = nodeHasLoop(node, innerCtx.loops);
    if (innerHasLoop) {
      const body = emitHbsLoopedNode(node, innerCtx, isXml, false, parentArchetypeRef, tag);
      return isXml
        ? `{{#each ${colExpr}}}${body}{{/each}}`
        : `{{#each ${colExpr}}}{{#if @index}},{{/if}}${body}{{/each}}`;
    }
    const pure = emitHbsPureNode(node, innerCtx, parentArchetypeRef);
    if (!pure) return "";
    return isXml
      ? `{{#each ${colExpr}}}{{rmToXmlFrag ${hbsStr(tag)} ${pure}}}{{/each}}`
      : `{{#each ${colExpr}}}{{#if (nonEmpty ${pure})}}{{#if @index}},{{/if}}{{toJson ${pure}}}{{/if}}{{/each}}`;
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
    if (locatableName && shouldEmitHbsSkelName(node) && !grouped.has("name")) {
      parts.push(`<name xsi:type="DV_TEXT"><value>${escapeXmlStatic(locatableName)}</value></name>`);
    }
    if (node.rmType === "ACTIVITY") {
      parts.push(`<action_archetype_id>${escapeXmlStatic(node.fixedFields?.action_archetype_id ?? "/.*/")}</action_archetype_id>`);
    }
    for (const [attr, children] of grouped) {
      for (const child of children) {
        if (nodeHasLoop(child, ctx.loops)) {
          parts.push(emitHbsLoopedNode(child, ctx, true, false, childRef, attr));
        } else {
          const pure = emitHbsPureNode(child, ctx, childRef);
          if (pure) parts.push(`{{rmToXmlFrag ${hbsStr(attr)} ${pure}}}`);
        }
      }
    }
    parts.push(`</${tag}>`);
    return parts.join("");
  }

  const fields: string[] = [`"_type": ${hbsStr(node.rmType)}`];
  if (locatableName && shouldEmitHbsSkelName(node) && !grouped.has("name")) {
    fields.push(`"name": {"_type": "DV_TEXT", "value": ${hbsStr(locatableName)}}`);
  }
  if (nodeId) fields.push(`"archetype_node_id": ${hbsStr(nodeId)}`);
  if (node.rmType === "ACTIVITY") {
    fields.push(`"action_archetype_id": ${hbsStr(node.fixedFields?.action_archetype_id ?? "/.*/")}`);
  }
  for (const [attr, children] of grouped) {
    const listAttr = isListAttribute(node.rmType, attr);
    const hasChildLoop = children.some((c) => nodeHasLoop(c, ctx.loops));
    if (hasChildLoop) {
      const rendered = children.map((c) => {
        if (nodeHasLoop(c, ctx.loops)) {
          return emitHbsLoopedNode(c, ctx, false, false, childRef, attr);
        }
        const pure = emitHbsPureNode(c, ctx, childRef);
        return pure ? `{{toJson ${pure}}}` : "";
      }).filter(Boolean);
      if (!rendered.length) continue;
      fields.push(listAttr ? `${hbsStr(attr)}: [${rendered.join(",")}]` : `${hbsStr(attr)}: ${rendered[0]!}`);
    } else if (listAttr) {
      const pureItems = children
        .map((c) => emitHbsPureNode(c, ctx, childRef))
        .filter((x): x is string => Boolean(x));
      if (!pureItems.length) continue;
      fields.push(`${hbsStr(attr)}: {{toJson (list ${pureItems.join(" ")})}}`);
    } else {
      const pure = emitHbsPureNode(children[0]!, ctx, childRef);
      if (!pure) continue;
      fields.push(`${hbsStr(attr)}: {{toJson ${pure}}}`);
    }
  }
  return `{ ${fields.join(", ")} }`;
}

/** Generate a VMS-Hbs Handlebars template for an openEHR template (canonical JSON or XML). */
export function emitHandlebarsOpenEhrProduct(
  model: MappingModel,
  skeleton: SkeletonNode[],
  isXml: boolean,
): string {
  const ctx: HbsSkelCtx = {
    slots: new Map(model.slots.map((s) => [s.slotId, s])),
    loops: model.loops ?? [],
    includes: model.includes,
    sourceExpr: "@root._data",
    loopBindings: {},
    varBindings: {},
  };
  const header = [
    `{{!-- Generated by intEHRgrator — Handlebars Conversion Script (openEHR ${isXml ? "XML" : "JSON"}) --}}`,
    `{{!-- Target: ${model.templateId} --}}`,
  ];
  const root = skeleton[0];
  if (!root) {
    header.push(
      isXml
        ? `{{rmToXml "composition" (rmObj _type="COMPOSITION")}}`
        : `{{toJson (rmObj _type="COMPOSITION")}}`,
    );
    return header.join("\n");
  }
  if (nodeHasLoop(root, ctx.loops)) {
    header.push(emitHbsLoopedNode(root, ctx, isXml, true));
    return header.join("\n");
  }
  const pure = emitHbsPureNode(root, ctx);
  if (!pure) {
    header.push(
      isXml
        ? `{{rmToXml "composition" (rmObj _type="COMPOSITION")}}`
        : `{{toJson (rmObj _type="COMPOSITION")}}`,
    );
    return header.join("\n");
  }
  header.push(isXml ? `{{rmToXml "composition" ${pure}}}` : `{{toJson ${pure}}}`);
  return header.join("\n");
}
