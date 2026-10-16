/**
 * Java conversion-script generation (Archie RM constructors).
 *
 * Walks the Template Skeleton + Mapping Model expressions into nested
 * `rm(new Composition(), …)` / `new DvQuantity(…)` trees. Mapping preview
 * Test Run still evaluates Mapping Model slots through the Target instance
 * format handler (ADR 0001 / ADR 0003). Java Output mode does **not** execute
 * this script in the web app; run it on a JVM with Archie on the classpath.
 */

import type { MappingFunction, MappingLoop, MappingModel, MappingSlot, SkeletonNode } from "../../types/mod.ts";
import { parseExpression, type ExprAst, isQuantifyCall } from "../expression/mod.ts";
import { isAutoFixedValueSlot, LOCATABLE_TYPES } from "../rm_mandatory.ts";
import {
  propsLackClinicalContent,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";
import { isListAttribute } from "./typescript.ts";
import { usesOpenEhrProduct } from "./product.ts";
import { canvasHandlebarsExpression } from "../output/canvas_handlebars.ts";
import {
  functionIdentMap,
  jsFunctionIdent,
  valueFunctions,
} from "./user_functions.ts";

const GENERIC_RM = new Set(["HISTORY", "POINT_EVENT", "INTERVAL_EVENT", "EVENT"]);

/** Matches the desktop app identifier in deno.json (`se.regionstockholm.intehrgrator`). */
const JAVA_GENERATED_PACKAGE = "se.regionstockholm.intehrgrator.generated";

const JAVA_CLASS_OVERRIDES: Record<string, string> = {
  DV_URI: "DvURI",
  DV_EHR_URI: "DvEHRURI",
  UID_BASED_ID: "UIDBasedId",
  HIER_OBJECT_ID: "HierObjectId",
  OBJECT_VERSION_ID: "ObjectVersionId",
  ARCHETYPE_ID: "ArchetypeId",
  TEMPLATE_ID: "TemplateId",
  TERMINOLOGY_ID: "TerminologyId",
  DV_PARSABLE: "DvParsable",
  DV_MULTIMEDIA: "DvMultimedia",
  ISM_TRANSITION: "IsmTransition",
};

const JAVA_PACKAGES: Record<string, string> = {
  Composition: "com.nedap.archie.rm.composition",
  EventContext: "com.nedap.archie.rm.composition",
  Section: "com.nedap.archie.rm.composition",
  Observation: "com.nedap.archie.rm.composition",
  Evaluation: "com.nedap.archie.rm.composition",
  Instruction: "com.nedap.archie.rm.composition",
  Action: "com.nedap.archie.rm.composition",
  AdminEntry: "com.nedap.archie.rm.composition",
  Activity: "com.nedap.archie.rm.composition",
  IsmTransition: "com.nedap.archie.rm.composition",
  InstructionDetails: "com.nedap.archie.rm.composition",
  ItemTree: "com.nedap.archie.rm.datastructures",
  ItemList: "com.nedap.archie.rm.datastructures",
  ItemTable: "com.nedap.archie.rm.datastructures",
  ItemSingle: "com.nedap.archie.rm.datastructures",
  Cluster: "com.nedap.archie.rm.datastructures",
  Element: "com.nedap.archie.rm.datastructures",
  History: "com.nedap.archie.rm.datastructures",
  PointEvent: "com.nedap.archie.rm.datastructures",
  IntervalEvent: "com.nedap.archie.rm.datastructures",
  Event: "com.nedap.archie.rm.datastructures",
  Item: "com.nedap.archie.rm.datastructures",
  DvText: "com.nedap.archie.rm.datavalues",
  DvCodedText: "com.nedap.archie.rm.datavalues",
  DvBoolean: "com.nedap.archie.rm.datavalues",
  DvIdentifier: "com.nedap.archie.rm.datavalues",
  DvURI: "com.nedap.archie.rm.datavalues",
  DvEHRURI: "com.nedap.archie.rm.datavalues",
  DvParagraph: "com.nedap.archie.rm.datavalues",
  DvState: "com.nedap.archie.rm.datavalues",
  DvQuantity: "com.nedap.archie.rm.datavalues.quantity",
  DvCount: "com.nedap.archie.rm.datavalues.quantity",
  DvOrdinal: "com.nedap.archie.rm.datavalues.quantity",
  DvProportion: "com.nedap.archie.rm.datavalues.quantity",
  DvScale: "com.nedap.archie.rm.datavalues.quantity",
  DvDateTime: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvDate: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvTime: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvDuration: "com.nedap.archie.rm.datavalues.quantity.datetime",
  CodePhrase: "com.nedap.archie.rm.datatypes",
  PartySelf: "com.nedap.archie.rm.generic",
  PartyIdentified: "com.nedap.archie.rm.generic",
  PartyRelated: "com.nedap.archie.rm.generic",
  PartyProxy: "com.nedap.archie.rm.generic",
  Participation: "com.nedap.archie.rm.generic",
  Archetyped: "com.nedap.archie.rm.archetyped",
  FeederAudit: "com.nedap.archie.rm.archetyped",
  FeederAuditDetails: "com.nedap.archie.rm.archetyped",
  Link: "com.nedap.archie.rm.archetyped",
};

const JAVA_RESERVED = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "default", "do", "double", "else", "enum",
  "extends", "final", "finally", "float", "for", "goto", "if", "implements",
  "import", "instanceof", "int", "interface", "long", "native", "new", "package",
  "private", "protected", "public", "return", "short", "static", "strictfp",
  "super", "switch", "synchronized", "this", "throw", "throws", "transient",
  "try", "void", "volatile", "while", "true", "false", "null", "var", "record",
  "yield", "sealed", "permits", "non-sealed",
]);

export type JavaHelper =
  | "string"
  | "number"
  | "boolean"
  | "nodes"
  | "node"
  | "sheets"
  | "logic"
  | "rm"
  | "flatten"
  | "handlebars";

export interface JavaEmitContext {
  sourceVar: string;
  loopVar?: string;
  types: Set<string>;
  helpers: Set<JavaHelper>;
  idents: Map<string, number>;
  mappingFunctions?: MappingFunction[];
  fnParams?: Set<string>;
  fnIdents?: Map<string, string>;
}

export function createJavaEmitContext(
  sourceVar = "sourceRoot",
  mappingFunctions?: MappingFunction[],
): JavaEmitContext {
  return { sourceVar, types: new Set(), helpers: new Set(), idents: new Map(), mappingFunctions };
}

export function javaClassName(rmType: string): string {
  if (JAVA_CLASS_OVERRIDES[rmType]) return JAVA_CLASS_OVERRIDES[rmType]!;
  return rmType.split("_").filter(Boolean).map((part) =>
    part.charAt(0) + part.slice(1).toLowerCase()
  ).join("");
}

export function javaSetterName(attr: string): string {
  const camel = attr.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return "set" + camel.charAt(0).toUpperCase() + camel.slice(1);
}

function javaIdent(raw: string, fallback = "item"): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  const base = /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
  if (!base || JAVA_RESERVED.has(base)) return fallback;
  return base;
}

function freshIdent(ctx: JavaEmitContext, rmType: string): string {
  const cls = javaClassName(rmType);
  const camel = cls.charAt(0).toLowerCase() + cls.slice(1);
  const n = (ctx.idents.get(camel) ?? 0) + 1;
  ctx.idents.set(camel, n);
  const ident = n === 1 ? camel : `${camel}${n}`;
  return JAVA_RESERVED.has(ident) ? `_${ident}` : ident;
}

function emitChangeCaseJava(text: string, mode: ExprAst | undefined): string {
  const value = `asString(${text})`;
  const which = mode?.kind === "literal" ? String(mode.value) : "LOWERCASE";
  if (which === "UPPERCASE") return `${value}.toUpperCase()`;
  if (which === "TITLECASE") {
    return `java.util.Arrays.stream(${value}.trim().split("\\\\s+")).map(w -> w.isEmpty() ? w : Character.toUpperCase(w.charAt(0)) + w.substring(1).toLowerCase()).collect(java.util.stream.Collectors.joining(" "))`;
  }
  return `${value}.toLowerCase()`;
}

export function emitJavaExpression(ast: ExprAst, ctx: JavaEmitContext): string {
  switch (ast.kind) {
    case "literal":
      if (typeof ast.value === "string") return JSON.stringify(ast.value);
      if (typeof ast.value === "boolean") return ast.value ? "true" : "false";
      return String(ast.value);
    case "binary":
      return `(${asDoubleExpr(emitJavaExpression(ast.left, ctx))} ${ast.op} ${
        asDoubleExpr(emitJavaExpression(ast.right, ctx))
      })`;
    case "call": {
      if (isQuantifyCall(ast.name)) return emitQuantifierJava(ast, ctx);
      const args = ast.args.map((a) => emitJavaExpression(a, ctx));
      switch (ast.name) {
        case "trim":
          return `asString(${args[0]}).trim()`;
        case "change_case":
          return emitChangeCaseJava(args[0] ?? '""', ast.args[1]);
        case "concat":
          return args.map((a) => `asString(${a})`).join(" + ");
        case "round":
          return `Math.round(${asDoubleExpr(args[0] ?? "0")})`;
        case "modulo":
          return `(${asDoubleExpr(args[0] ?? "0")} % ${asDoubleExpr(args[1] ?? "1")})`;
        case "constrain":
          return `(Math.min(${asDoubleExpr(args[2] ?? "0")}, Math.max(${
            asDoubleExpr(args[1] ?? "0")
          }, ${asDoubleExpr(args[0] ?? "0")})))`;
        case "if":
          return `(asBoolean(${args[0]}) ? ${args[1]} : ${args[2]})`;
        case "switch":
          return emitSwitchJava(args);
        case "var": {
          const name = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          if (name && ctx.fnParams?.has(name)) return jsFunctionIdent(name);
          ctx.helpers.add("logic");
          return `vars.get(${args[0]})`;
        }
        case "call": {
          const fname = ast.args[0]?.kind === "literal" ? String(ast.args[0].value) : "";
          const ident = ensureJavaFnIdents(ctx).get(fname) ?? `fn_${jsFunctionIdent(fname)}`;
          return `${ident}(${args.slice(1).join(", ")})`;
        }
        case "eq":
          return `java.util.Objects.equals(${args[0]}, ${args[1]})`;
        case "ne":
          return `(!java.util.Objects.equals(${args[0]}, ${args[1]}))`;
        case "lt":
          return `(${asDoubleExpr(args[0] ?? "0")} < ${asDoubleExpr(args[1] ?? "0")})`;
        case "le":
          return `(${asDoubleExpr(args[0] ?? "0")} <= ${asDoubleExpr(args[1] ?? "0")})`;
        case "gt":
          return `(${asDoubleExpr(args[0] ?? "0")} > ${asDoubleExpr(args[1] ?? "0")})`;
        case "ge":
          return `(${asDoubleExpr(args[0] ?? "0")} >= ${asDoubleExpr(args[1] ?? "0")})`;
        case "and":
          return `(asBoolean(${args[0]}) && asBoolean(${args[1]}))`;
        case "or":
          return `(asBoolean(${args[0]}) || asBoolean(${args[1]}))`;
        case "not":
          return `(!asBoolean(${args[0]}))`;
        case "list":
          return `java.util.List.of(${args.join(", ")})`;
        case "lists_getIndex":
          ctx.helpers.add("logic");
          return `listGet(asList(${args[0]}), ${args[2] ?? args[1] ?? "0"})`;
        case "intersection":
          ctx.helpers.add("logic");
          return `setIntersection(asList(${args[0]}), asList(${args[1]}))`;
        case "union":
          ctx.helpers.add("logic");
          return `setUnion(asList(${args[0]}), asList(${args[1]}))`;
        case "difference":
          ctx.helpers.add("logic");
          return `setDifference(asList(${args[0]}), asList(${args[1]}))`;
        case "maps_get":
          return emitMapsGet(ast, args);
        case "sheet_get_cell":
        case "sheet_get_xy":
        case "sheet_get_row":
        case "sheet_get_column":
        case "sheet_get_header":
        case "sheet_get_data":
        case "sheet_lookup":
        case "decision_table":
          ctx.helpers.add("sheets");
          return emitSheetCall(ast.name, args);
        case "xpathNumber":
          ctx.helpers.add("number");
          return emitXpathCall("xpathNumber", ast.args[0], args[0] ?? '""', ctx);
        case "xpathBoolean":
          ctx.helpers.add("boolean");
          return emitXpathCall("xpathBoolean", ast.args[0], args[0] ?? '""', ctx);
        case "xpathNode":
          ctx.helpers.add("node");
          return emitXpathCall("xpathNode", ast.args[0], args[0] ?? '""', ctx);
        case "handlebars":
          ctx.helpers.add("handlebars");
          return `handlebars(${args[0] ?? '""'}, ${args[1] ?? "mapOf()"})`;
        case "map":
          ctx.helpers.add("logic");
          return `mapOf(${args.join(", ")})`;
        case "xpath":
        case "xpathString":
          ctx.helpers.add("string");
          return emitXpathCall("xpathString", ast.args[0], args[0] ?? '""', ctx);
        default:
          ctx.helpers.add("string");
          return emitXpathCall("xpathString", ast.args[0], args[0] ?? '""', ctx);
      }
    }
  }
}

function ensureJavaFnIdents(ctx: JavaEmitContext): Map<string, string> {
  if (!ctx.fnIdents) {
    ctx.fnIdents = functionIdentMap(valueFunctions(ctx.mappingFunctions), (name) =>
      `fn_${jsFunctionIdent(name)}`
    );
  }
  return ctx.fnIdents;
}

function emitJavaUserFunctions(ctx: JavaEmitContext): string {
  const fns = valueFunctions(ctx.mappingFunctions);
  if (!fns.length) return "";
  const idents = ensureJavaFnIdents(ctx);
  const lines: string[] = [];
  for (const fn of fns) {
    const ident = idents.get(fn.name) ?? `fn_${jsFunctionIdent(fn.name)}`;
    const params = fn.params.map((p) => `Object ${jsFunctionIdent(p)}`).join(", ");
    const inner: JavaEmitContext = {
      ...ctx,
      fnParams: new Set(fn.params),
      fnIdents: idents,
    };
    const body = emitJavaExpressionSource(fn.body!, inner) ?? "null";
    lines.push(`  private Object ${ident}(${params}) {`);
    lines.push(`    return ${body};`);
    lines.push("  }");
    lines.push("");
  }
  return lines.join("\n");
}

function wrapJavaFromCtx(
  parts: Omit<JavaModuleParts, "extraMethods">,
  ctx: JavaEmitContext,
): string {
  return wrapJavaModule({ ...parts, extraMethods: emitJavaUserFunctions(ctx) });
}

function emitMapsGet(ast: Extract<ExprAst, { kind: "call" }>, args: string[]): string {
  const mapArg = ast.args[0];
  const key = args[1] ?? '""';
  if (mapArg?.kind === "literal" && mapArg.value === "defaults") {
    return `defaults.get(${key})`;
  }
  return `(("defaults".equals(${args[0]}) ? defaults : java.util.Map.of()).get(${key}))`;
}

function emitSheetCall(name: string, args: string[]): string {
  return `${javaMethodName(name)}(${args.join(", ")})`;
}

function javaMethodName(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function emitXpathCall(
  fn: string,
  pathAst: ExprAst | undefined,
  pathCode: string,
  ctx: JavaEmitContext,
): string {
  const path = pathAst?.kind === "literal" ? String(pathAst.value).trim() : "";
  let code = pathCode;
  if (path && looksLikeOpenEhrLocator(path) && (path.startsWith("/") || path.startsWith("//"))) {
    code = JSON.stringify(compileAuthoringPath(path, "xml"));
  }
  const relative = Boolean(path) && !path.startsWith("$") && !path.startsWith("/");
  if (relative && ctx.loopVar) return `${fn}(${code}, ${ctx.loopVar})`;
  return `${fn}(${code})`;
}

function emitQuantifierJava(
  ast: Extract<ExprAst, { kind: "call" }>,
  ctx: JavaEmitContext,
): string {
  ctx.helpers.add("logic");
  const card = ast.name === "at_least" || ast.name === "at_most" || ast.name === "exactly";
  const listCode = emitJavaExpression(ast.args[0]!, ctx);
  const nCode = card ? emitJavaExpression(ast.args[1]!, ctx) : "0";
  const varAst = card ? ast.args[2] : ast.args[1];
  const predAst = card ? ast.args[3] : ast.args[2];
  const varName = varAst?.kind === "literal" ? String(varAst.value) : "item";
  const ident = javaIdent(varName, "_item");
  const innerCtx: JavaEmitContext = { ...ctx, loopVar: ident };
  const predCode = predAst ? emitJavaExpression(predAst, innerCtx) : "true";
  const bind = `(vars.put(${JSON.stringify(varName)}, ${ident}), ${predCode})`;
  const arr = `asList(${listCode}).stream()`;
  switch (ast.name) {
    case "all_of":
      return `${arr}.allMatch(${ident} -> ${bind})`;
    case "any_of":
      return `${arr}.anyMatch(${ident} -> ${bind})`;
    case "none_of":
      return `${arr}.noneMatch(${ident} -> ${bind})`;
    case "at_least":
      return `${arr}.filter(${ident} -> ${bind}).count() >= ${nCode}`;
    case "at_most":
      return `${arr}.filter(${ident} -> ${bind}).count() <= ${nCode}`;
    case "exactly":
      return `${arr}.filter(${ident} -> ${bind}).count() == ${nCode}`;
    default:
      return "false";
  }
}

function emitSwitchJava(args: string[]): string {
  if (args.length < 2) return "null";
  const discriminant = args[0];
  const defaultV = args[args.length - 1];
  const pairs = args.slice(1, -1);
  let expr = defaultV ?? "null";
  for (let i = pairs.length - 2; i >= 0; i -= 2) {
    expr = `(java.util.Objects.equals(${discriminant}, ${pairs[i]}) ? ${pairs[i + 1]} : ${expr})`;
  }
  return expr;
}

export function emitJavaExpressionSource(
  expression: string,
  ctx: JavaEmitContext,
): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  try {
    return emitJavaExpression(parseExpression(trimmed), ctx);
  } catch {
    ctx.helpers.add("string");
    return emitXpathCall(
      "xpathString",
      { kind: "literal", value: trimmed },
      JSON.stringify(trimmed),
      ctx,
    );
  }
}

function asDoubleExpr(expr: string): string {
  if (/^(xpathNumber|toDouble|Math\.round)\(/.test(expr) || /^-?\d+(\.\d+)?$/.test(expr.trim())) {
    return expr;
  }
  return `toDouble(${expr})`;
}

function asStringExpr(expr: string): string {
  if (/^(xpathString|asString)\(/.test(expr) || /^"/.test(expr.trim())) return expr;
  return `asString(${expr})`;
}

function asBooleanExpr(expr: string): string {
  if (/^(xpathBoolean|asBoolean)\(/.test(expr) || /^(true|false)$/.test(expr.trim())) {
    return expr;
  }
  return `asBoolean(${expr})`;
}

function isBlankGeneratedExpr(code: string): boolean {
  const trimmed = code.trim();
  return !trimmed || trimmed === "null" || trimmed === '""';
}

function indentBlock(code: string, indent: number): string {
  if (indent <= 0) return code;
  const pad = "  ".repeat(indent);
  return code.split("\n").map((line) => (line.length ? pad + line : line)).join("\n");
}

function formatRmConstruct(
  rmType: string,
  props: Array<[string, string]>,
  indent: number,
  ctx: JavaEmitContext,
): string {
  ctx.helpers.add("rm");
  if (rmType === "PARTY_PROXY") {
    ctx.types.add("PARTY_SELF");
    return "new PartySelf()";
  }
  ctx.types.add(rmType);
  const compact = compactConstruct(rmType, props, ctx);
  if (compact) return compact;
  const cls = javaClassName(rmType);
  const diamond = GENERIC_RM.has(rmType) ? "<>" : "";
  if (!props.length) return `new ${cls}${diamond}()`;
  const ident = freshIdent(ctx, rmType);
  const inner = indent + 1;
  const setters = props.map(([attr, value]) =>
    `${"  ".repeat(inner)}${ident}.${javaSetterName(attr)}(${value});`
  );
  const close = "  ".repeat(indent);
  return `rm(new ${cls}${diamond}(), ${ident} -> {\n${setters.join("\n")}\n${close}})`;
}

function compactConstruct(
  rmType: string,
  props: Array<[string, string]>,
  ctx: JavaEmitContext,
): string | null {
  const map = new Map(props);
  if (rmType === "DV_TEXT" && map.size === 1 && map.has("value")) {
    ctx.types.add("DV_TEXT");
    return `new DvText(${map.get("value")})`;
  }
  if (rmType === "DV_QUANTITY" && (map.has("magnitude") || map.has("units"))) {
    ctx.types.add("DV_QUANTITY");
    const units = map.get("units") ?? "null";
    const mag = map.has("magnitude") ? asDoubleExpr(map.get("magnitude")!) : "null";
    return `new DvQuantity(${units}, ${mag}, null)`;
  }
  if (rmType === "DV_BOOLEAN" && map.size === 1 && map.has("value")) {
    ctx.types.add("DV_BOOLEAN");
    return `new DvBoolean(${asBooleanExpr(map.get("value")!)})`;
  }
  if (rmType === "DV_DATE_TIME" && map.size === 1 && map.has("value")) {
    ctx.types.add("DV_DATE_TIME");
    return `new DvDateTime(${asStringExpr(map.get("value")!)})`;
  }
  if (rmType === "CODE_PHRASE" && map.has("code_string")) {
    ctx.types.add("CODE_PHRASE");
    const term = map.get("terminology_id");
    const code = map.get("code_string")!;
    if (term && /^"/.test(term)) {
      const termLit = term.slice(1, -1);
      return `new CodePhrase(${JSON.stringify(termLit + "::")} + ${asStringExpr(code)})`;
    }
    if (term) return `new CodePhrase(asString(${term}) + "::" + ${asStringExpr(code)})`;
    return `new CodePhrase(${asStringExpr(code)})`;
  }
  if (rmType === "DV_CODED_TEXT" && map.has("value") && (map.has("defining_code") || map.has("code_string"))) {
    ctx.types.add("DV_CODED_TEXT");
    const value = map.get("value")!;
    const code = map.get("defining_code") ?? map.get("code_string")!;
    return `new DvCodedText(${asStringExpr(value)}, ${asStringExpr(code)})`;
  }
  if (rmType === "PARTY_SELF") {
    ctx.types.add("PARTY_SELF");
    return "new PartySelf()";
  }
  return null;
}

export function generateJava(
  model: MappingModel,
  options?: { skeleton?: SkeletonNode[]; blocklyState?: unknown },
): string {
  if (!usesOpenEhrProduct(model, options)) {
    const canvas = canvasHandlebarsExpression(options?.blocklyState);
    if (canvas) return generateJavaFromExpression(model, canvas);
    return generateJavaGeneric(model);
  }
  if (options?.skeleton?.length) {
    return generateJavaFromSkeleton(model, options.skeleton);
  }
  return generateJavaFromSlots(model);
}

function generateJavaFromExpression(model: MappingModel, expression: string): string {
  const ctx = createJavaEmitContext("sourceRoot", model.functions);
  const javaExpr = emitJavaExpressionSource(expression, ctx) ?? '""';
  return wrapJavaFromCtx({
    templateId: model.templateId,
    body: `return ${javaExpr};`,
    types: ctx.types,
    helpers: ctx.helpers,
    source: "blockly",
    archie: false,
  }, ctx);
}

function generateJavaGeneric(model: MappingModel): string {
  const ctx = createJavaEmitContext("sourceRoot", model.functions);
  const lines: string[] = [
    "Map<String, Object> values = new LinkedHashMap<>();",
  ];
  for (const slot of model.slots) {
    const expr = emitJavaExpressionSource(slot.expression, ctx);
    if (!expr) continue;
    lines.push(`// ${slot.label ?? slot.slotId}`);
    lines.push(`values.put(${JSON.stringify(slot.slotId)}, ${expr});`);
  }
  lines.push("return values;");
  return wrapJavaFromCtx({
    templateId: model.templateId,
    body: lines.join("\n"),
    types: ctx.types,
    helpers: ctx.helpers,
    source: "slots",
    archie: false,
  }, ctx);
}

export function generateJavaFromSkeleton(
  model: MappingModel,
  skeleton: SkeletonNode[],
): string {
  const ctx = createJavaEmitContext("sourceRoot", model.functions);
  const slotMap = new Map(model.slots.map((s) => [s.slotId, s]));
  const loops = model.loops ?? [];
  const roots = skeleton
    .map((node) => emitSkeletonNode(node, slotMap, loops, ctx, 0))
    .filter((code): code is string => Boolean(code));

  let body: string;
  if (roots.length === 1 && skeleton[0]?.rmType === "COMPOSITION") {
    ctx.types.add("COMPOSITION");
    body = [
      `Composition result = ${roots[0]};`,
      "validate(result);",
      "return result;",
    ].join("\n");
  } else if (roots.length === 1) {
    ctx.types.add("COMPOSITION");
    body = [
      "Composition result = rm(new Composition(), composition -> {",
      "  composition.setContent(java.util.List.of(",
      indentBlock(roots[0], 2),
      "  ));",
      "});",
      "validate(result);",
      "return result;",
    ].join("\n");
  } else if (roots.length > 1) {
    ctx.types.add("COMPOSITION");
    body = [
      "Composition result = rm(new Composition(), composition -> {",
      "  composition.setContent(java.util.List.of(",
      roots.map((r) => indentBlock(r, 2)).join(",\n"),
      "  ));",
      "});",
      "validate(result);",
      "return result;",
    ].join("\n");
  } else {
    ctx.types.add("COMPOSITION");
    body = [
      "Composition result = new Composition();",
      "validate(result);",
      "return result;",
    ].join("\n");
  }

  return wrapJavaFromCtx({
    templateId: model.templateId,
    body,
    types: ctx.types,
    helpers: ctx.helpers,
    source: "skeleton",
    archie: true,
  }, ctx);
}

export function generateJavaFromSlots(model: MappingModel): string {
  const ctx = createJavaEmitContext("sourceRoot", model.functions);
  ctx.types.add("COMPOSITION");
  const lines: string[] = [
    "java.util.Map<String, Object> values = new java.util.LinkedHashMap<>();",
  ];
  for (const slot of model.slots) {
    const expr = emitJavaExpressionSource(slot.expression, ctx);
    if (!expr) continue;
    lines.push(`// ${slot.label ?? slot.slotId}`);
    lines.push(`values.put(${JSON.stringify(slot.slotId)}, ${expr});`);
  }
  lines.push("Composition result = new Composition();");
  lines.push("validate(result);");
  lines.push("return result;");
  return wrapJavaFromCtx({
    templateId: model.templateId,
    body: lines.join("\n"),
    types: ctx.types,
    helpers: ctx.helpers,
    source: "slots",
    archie: true,
  }, ctx);
}

function emitSkeletonNode(
  node: SkeletonNode,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: JavaEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): string | null {
  if (node.kind === "value") {
    return emitSkeletonValue(node, slots.get(node.slotId), ctx, indent);
  }
  if (isAutoFixedValueSlot(node)) return null;

  const loop = loops.find((item) => item.attachSlotId === node.slotId);
  if (loop) {
    return emitSkeletonLoop(node, loop, slots, loops, ctx, indent, parentArchetypeRef);
  }

  const props = skeletonContainerProps(node, slots, loops, ctx, indent, parentArchetypeRef);
  if (node.rmType !== "COMPOSITION" && propsLackClinicalContent(props)) {
    return null;
  }
  return formatRmConstruct(node.rmType, props, indent, ctx);
}

function emitSkeletonLoop(
  node: SkeletonNode,
  loop: MappingLoop,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: JavaEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): string {
  ctx.helpers.add("nodes");
  const ident = javaIdent(loop.varName, "item");
  const innerCtx: JavaEmitContext = {
    ...ctx,
    sourceVar: ident,
    loopVar: ident,
    types: ctx.types,
    helpers: ctx.helpers,
    idents: ctx.idents,
  };
  const nestedLoops = loops.filter((item) => item !== loop);
  const props = skeletonContainerProps(
    node,
    slots,
    nestedLoops,
    innerCtx,
    indent + 1,
    parentArchetypeRef,
  );
  const constructed = formatRmConstruct(node.rmType, props, indent + 1, innerCtx);
  const mapped = `${ident} -> ${constructed}`;
  if (loop.kind === "list" && loop.collection) {
    ctx.helpers.add("logic");
    const coll = emitJavaExpressionSource(loop.collection, ctx) ?? "java.util.List.of()";
    return `asList(${coll}).stream().map(${mapped}).toList()`;
  }
  return `xpathNodes(${JSON.stringify(loop.path)}).stream().map(${mapped}).toList()`;
}

function skeletonContainerProps(
  node: SkeletonNode,
  slots: Map<string, MappingSlot>,
  loops: MappingLoop[],
  ctx: JavaEmitContext,
  indent: number,
  parentArchetypeRef?: string,
): Array<[string, string]> {
  const props: Array<[string, string]> = [];
  const locatableName = rmLocatableName(node);
  if (locatableName && shouldEmitSkeletonName(node)) {
    ctx.types.add("DV_TEXT");
    props.push([
      "name",
      `new DvText(${JSON.stringify(locatableName)})`,
    ]);
  }
  const nodeId = rmArchetypeNodeId(node, parentArchetypeRef);
  if (nodeId) {
    props.push(["archetype_node_id", JSON.stringify(nodeId)]);
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
      .map((child) =>
        emitSkeletonNode(
          child,
          slots,
          loops,
          ctx,
          listAttr ? indent + 2 : indent + 1,
          childArchetypeRef,
        )
      )
      .filter((code): code is string => Boolean(code) && !isBlankGeneratedExpr(code));
    if (!codes.length) continue;
    const streamed = codes.some((c) => c.includes(".stream().map("));
    const asList = listAttr || streamed;
    if (asList) {
      if (codes.length === 1 && streamed) {
        props.push([attr, codes[0]!]);
      } else if (streamed) {
        ctx.helpers.add("flatten");
        const inner = codes.map((c) => indentBlock(c, indent + 2)).join(",\n");
        props.push([
          attr,
          `flatten(\n${inner}\n${"  ".repeat(indent + 1)})`,
        ]);
      } else {
        const inner = codes.map((c) => indentBlock(c, indent + 2)).join(",\n");
        props.push([
          attr,
          `java.util.List.of(\n${inner}\n${"  ".repeat(indent + 1)})`,
        ]);
      }
    } else {
      props.push([attr, codes[0]!]);
    }
  }
  return props;
}

function emitSkeletonValue(
  node: SkeletonNode,
  slot: MappingSlot | undefined,
  ctx: JavaEmitContext,
  indent: number,
): string | null {
  const expr = slot?.expression
    ? emitJavaExpressionSource(slot.expression, ctx)
    : null;
  const fields = node.fixedFields ?? {};
  const rmType = node.rmType;

  if (rmType === "CODE_PHRASE") {
    const term = fields.terminology_id;
    const code = fields.code_string ?? fields.defining_code;
    ctx.types.add("CODE_PHRASE");
    if (term && expr) {
      return `new CodePhrase(${JSON.stringify(term + "::")} + ${asStringExpr(expr)})`;
    }
    if (term && code) return `new CodePhrase(${JSON.stringify(`${term}::${code}`)})`;
    if (expr) return `new CodePhrase(${asStringExpr(expr)})`;
    return null;
  }

  if (rmType === "DV_CODED_TEXT") {
    const term = fields.terminology_id ?? "openehr";
    const code = fields.defining_code ?? fields.code_string;
    const rubric = fields.value ??
      (node.label && node.label !== rmType ? node.label : "");
    ctx.types.add("DV_CODED_TEXT");
    if (code) {
      return `new DvCodedText(${JSON.stringify(rubric)}, ${
        JSON.stringify(`${term}::${code}`)
      })`;
    }
    if (expr) return `new DvCodedText(${asStringExpr(expr)}, new CodePhrase())`;
    return null;
  }

  if (rmType === "DV_QUANTITY") {
    const props: Array<[string, string]> = [];
    if (expr) props.push(["magnitude", asDoubleExpr(expr)]);
    if (fields.units) props.push(["units", JSON.stringify(fields.units)]);
    if (!props.length) return null;
    return formatRmConstruct("DV_QUANTITY", props, indent, ctx);
  }

  if (rmType === "DV_COUNT" || rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    return formatRmConstruct(rmType, [["magnitude", asDoubleExpr(expr)]], indent, ctx);
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    return formatRmConstruct("DV_BOOLEAN", [["value", asBooleanExpr(expr)]], indent, ctx);
  }

  if (
    rmType === "DV_DATE_TIME" || rmType === "DV_DATE" || rmType === "DV_TIME" ||
    rmType === "DV_DURATION" || rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
    rmType === "DV_TEXT" || rmType === "DV_IDENTIFIER"
  ) {
    const value = expr
      ? asStringExpr(expr)
      : fields.value
      ? JSON.stringify(fields.value)
      : null;
    if (!value) return null;
    if (rmType === "DV_TEXT") {
      ctx.types.add("DV_TEXT");
      return `new DvText(${value})`;
    }
    return formatRmConstruct(rmType, [["value", value]], indent, ctx);
  }

  if (rmType === "PARTY_IDENTIFIED") {
    if (!expr) return null;
    ctx.types.add("PARTY_IDENTIFIED");
    ctx.helpers.add("rm");
    const ident = freshIdent(ctx, rmType);
    return `rm(new PartyIdentified(), ${ident} -> ${ident}.setName(${asStringExpr(expr)}))`;
  }

  if (rmType === "PARTY_SELF") {
    ctx.types.add("PARTY_SELF");
    return "new PartySelf()";
  }

  if (expr) {
    if (rmType && rmType !== "string" && rmType !== "number" && rmType !== "boolean") {
      return formatRmConstruct(rmType, [["value", expr]], indent, ctx);
    }
    return expr;
  }
  return null;
}

function shouldEmitSkeletonName(node: SkeletonNode): boolean {
  if (node.rmType === "COMPOSITION") return true;
  if (node.rmType === "EVENT_CONTEXT" || node.rmType.startsWith("PARTY_")) return false;
  return LOCATABLE_TYPES.has(node.rmType);
}

interface JavaModuleParts {
  templateId: string;
  body: string;
  types: Set<string>;
  helpers: Set<JavaHelper>;
  source: "skeleton" | "slots" | "blockly";
  /** When false, omit Archie RM / OPT validator imports (non-openEHR product). */
  archie: boolean;
  extraMethods?: string;
}

function wrapJavaModule(parts: JavaModuleParts): string {
  const usesXpath = [...parts.helpers].some((h) =>
    h === "string" || h === "number" || h === "boolean" || h === "nodes" || h === "node"
  );
  const classImports = parts.archie
    ? [...parts.types]
      .map(javaClassName)
      .filter((name, i, all) => all.indexOf(name) === i)
      .sort()
      .map((name) => {
        const pkg = JAVA_PACKAGES[name];
        return pkg ? `import ${pkg}.${name};` : null;
      })
      .filter((line): line is string => Boolean(line))
    : [];
  const usesRm = parts.archie;
  const dialect = parts.archie ? "Java / Archie" : "Java";
  const lines: string[] = [
    `// Generated by intEHRgrator — Conversion Script (${dialect})`,
    `// Template: ${parts.templateId || "(none)"}`,
    parts.source === "skeleton"
      ? "// Source: Template Skeleton + Mapping Model expressions"
      : parts.source === "blockly"
      ? "// Source: Blockly canvas product (text_handlebars / Mapping Expressions)"
      : "// Source: Mapping Model slots (no canvas / skeleton available)",
    "// Mapping preview Test Run evaluates Mapping Model slots through the Target",
    "// instance format handler (ADR 0001). Java Output mode does not execute this",
    parts.archie
      ? "// script in the web app; compile and run it on a JVM with Archie."
      : "// script in the web app; compile and run it on a JVM.",
    ...(parts.archie
      ? [
        "// Built-in verification: pass an ADL2 OperationalTemplate to the constructor",
        "// (or ConversionScript.fromAdl2Opt) to convert-then-validate via RMObjectValidator.",
      ]
      : []),
    "",
    `package ${JAVA_GENERATED_PACKAGE};`,
    "",
    ...(parts.archie
      ? [
        "import com.nedap.archie.adlparser.ADLParser;",
        "import com.nedap.archie.aom.Archetype;",
        "import com.nedap.archie.aom.OperationalTemplate;",
        "import com.nedap.archie.rminfo.ArchieRMInfoLookup;",
        "import com.nedap.archie.rmobjectvalidator.RMObjectValidationMessage;",
        "import com.nedap.archie.rmobjectvalidator.RMObjectValidator;",
        "import com.nedap.archie.rmobjectvalidator.ValidationConfiguration;",
        ...classImports,
        "",
        "import java.io.InputStream;",
      ]
      : []),
    "import java.util.ArrayList;",
    "import java.util.LinkedHashMap;",
    "import java.util.List;",
    "import java.util.Map;",
    ...(usesRm ? ["import java.util.function.Consumer;"] : []),
    "",
    "public class ConversionScript {",
    "  private Object sourceRoot;",
    "  private Map<String, Object> defaults = Map.of();",
    "  private Map<String, Sheet> sheets = Map.of();",
    ...(parts.archie
      ? [
        "  private final OperationalTemplate operationalTemplate;",
        "  private final Map<String, Object> vars = new LinkedHashMap<>();",
        "",
        "  public ConversionScript() {",
        "    this(null);",
        "  }",
        "",
        "  public ConversionScript(OperationalTemplate operationalTemplate) {",
        "    this.operationalTemplate = operationalTemplate;",
        "  }",
        "",
        "  /** Parse an ADL2 Operational Template and enable convert-then-validate. */",
        "  public static ConversionScript fromAdl2Opt(String adl2Opt) throws Exception {",
        "    return fromAdl2Opt(new java.io.ByteArrayInputStream(adl2Opt.getBytes(java.nio.charset.StandardCharsets.UTF_8)));",
        "  }",
        "",
        "  public static ConversionScript fromAdl2Opt(InputStream adl2Opt) throws Exception {",
        "    Archetype parsed = new ADLParser().parse(adl2Opt);",
        "    if (!(parsed instanceof OperationalTemplate opt)) {",
        "      throw new IllegalArgumentException(\"Expected an ADL2 OperationalTemplate\");",
        "    }",
        "    return new ConversionScript(opt);",
        "  }",
        "",
        "  public Composition convert(Object source, Map<String, Object> defaults) {",
        "    return convert(source, defaults, Map.of());",
        "  }",
        "",
        "  public Composition convert(Object source, Map<String, Object> defaults, Map<String, Sheet> sheets) {",
      ]
      : [
        "  private final Map<String, Object> vars = new LinkedHashMap<>();",
        "",
        "  public Object convert(Object source, Map<String, Object> defaults) {",
        "    return convert(source, defaults, Map.of());",
        "  }",
        "",
        "  public Object convert(Object source, Map<String, Object> defaults, Map<String, Sheet> sheets) {",
      ]),
    "    this.sourceRoot = source;",
    "    this.defaults = defaults != null ? defaults : new LinkedHashMap<>();",
    "    this.sheets = sheets != null ? sheets : new LinkedHashMap<>();",
  ];

  for (const line of parts.body.split("\n")) {
    lines.push(line.length ? `    ${line}` : "");
  }
  lines.push("  }", "");

  if (parts.extraMethods) {
    lines.push(parts.extraMethods);
  }

  if (parts.archie) {
    lines.push(...indentLines(validationHook(), 1));
    lines.push("");
    lines.push(...indentLines(rmHelper(), 1));
    lines.push("");
  }
  lines.push(...indentLines(coerceHelpers(), 1));

  if (parts.helpers.has("handlebars")) {
    lines.push("");
    lines.push(...indentLines(handlebarsHelper(), 1));
  }

  if (usesXpath) {
    lines.push("");
    lines.push(...indentLines(xpathHelpers(), 1));
  }
  if (parts.helpers.has("logic") || parts.helpers.has("flatten")) {
    lines.push("");
    lines.push(...indentLines(logicHelpers(parts.helpers), 1));
  }
  if (parts.helpers.has("sheets")) {
    lines.push("");
    lines.push(...indentLines(sheetHelpers(), 1));
  } else {
    lines.push("");
    lines.push(...indentLines(sheetTypeOnly(), 1));
  }

  lines.push("}", "");
  return lines.join("\n");
}

function validationHook(): string[] {
  return [
    "public void validate(Composition composition) {",
    "  if (operationalTemplate == null) return;",
    "  RMObjectValidator validator = new RMObjectValidator(",
    "      ArchieRMInfoLookup.getInstance(),",
    "      archetypeId -> operationalTemplate,",
    "      new ValidationConfiguration.Builder().build());",
    "  List<RMObjectValidationMessage> messages = validator.validate(operationalTemplate, composition);",
    "  if (!messages.isEmpty()) {",
    "    throw new IllegalStateException(\"Archie OPT validation failed: \" + messages);",
    "  }",
    "}",
  ];
}

function rmHelper(): string[] {
  return [
    "private static <T> T rm(T object, Consumer<T> init) {",
    "  init.accept(object);",
    "  return object;",
    "}",
  ];
}

function coerceHelpers(): string[] {
  return [
    "private static String asString(Object value) { return value == null ? \"\" : String.valueOf(value); }",
    "private static double toDouble(Object value) {",
    "  if (value instanceof Number n) return n.doubleValue();",
    "  if (value == null) return 0d;",
    "  try { return Double.parseDouble(String.valueOf(value)); } catch (NumberFormatException e) { return 0d; }",
    "}",
    "private static boolean asBoolean(Object value) {",
    "  if (value instanceof Boolean b) return b;",
    "  if (value == null) return false;",
    "  return Boolean.parseBoolean(String.valueOf(value));",
    "}",
  ];
}

function handlebarsHelper(): string[] {
  return [
    "/** VMS-Hbs render via com.github.jknack.handlebars (Handlebars.java). */",
    "private String handlebars(String template, Object context) {",
    "  try {",
    "    com.github.jknack.handlebars.Handlebars engine = new com.github.jknack.handlebars.Handlebars();",
    "    engine.registerHelper(\"eq\", (ctx, options) -> java.util.Objects.equals(ctx, options.param(0)));",
    "    engine.registerHelper(\"ne\", (ctx, options) -> !java.util.Objects.equals(ctx, options.param(0)));",
    "    engine.registerHelper(\"lt\", (ctx, options) -> compareNumbers(ctx, options.param(0)) < 0);",
    "    engine.registerHelper(\"gt\", (ctx, options) -> compareNumbers(ctx, options.param(0)) > 0);",
    "    engine.registerHelper(\"lte\", (ctx, options) -> compareNumbers(ctx, options.param(0)) <= 0);",
    "    engine.registerHelper(\"gte\", (ctx, options) -> compareNumbers(ctx, options.param(0)) >= 0);",
    "    engine.registerHelper(\"and\", (ctx, options) -> {",
    "      if (!asBoolean(ctx)) return false;",
    "      for (Object arg : options.params) if (!asBoolean(arg)) return false;",
    "      return true;",
    "    });",
    "    engine.registerHelper(\"or\", (ctx, options) -> {",
    "      if (asBoolean(ctx)) return true;",
    "      for (Object arg : options.params) if (asBoolean(arg)) return true;",
    "      return false;",
    "    });",
    "    engine.registerHelper(\"toLowerCase\", (ctx, options) -> ctx == null ? ctx : String.valueOf(ctx).toLowerCase());",
    "    engine.registerHelper(\"toUpperCase\", (ctx, options) -> ctx == null ? ctx : String.valueOf(ctx).toUpperCase());",
    "    engine.registerHelper(\"slot\", (ctx, options) -> \"\");",
    "    engine.registerHelperMissing((ctx, options) -> {",
    "      throw new IllegalStateException(\"VMS-Hbs forbids helper: \" + options.helperName);",
    "    });",
    "    return engine.compileInline(template).apply(context != null ? context : java.util.Map.of());",
    "  } catch (Exception e) {",
    "    throw new IllegalStateException(\"VMS-Hbs render failed: \" + e.getMessage(), e);",
    "  }",
    "}",
    "private static int compareNumbers(Object left, Object right) {",
    "  return Double.compare(toDouble(left), toDouble(right));",
    "}",
  ];
}

function xpathHelpers(): string[] {
  const lines = [
    "private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();",
    "",
    "private String xpathString(String path) { return xpathString(path, sourceRoot); }",
    "private double xpathNumber(String path) { return xpathNumber(path, sourceRoot); }",
    "private boolean xpathBoolean(String path) { return xpathBoolean(path, sourceRoot); }",
    "private Object xpathNode(String path) { return xpathNode(path, sourceRoot); }",
    "private List<Object> xpathNodes(String path) { return xpathNodes(path, sourceRoot); }",
    "",
    "private String xpathString(String path, Object node) {",
    '  if (path.trim().startsWith("/")) return xmlString(path, node);',
    "  com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);",
    '  return found == null || found.isNull() || found.isMissingNode() ? "" : found.asText();',
    "}",
    "",
    "private double xpathNumber(String path, Object node) {",
    '  if (path.trim().startsWith("/")) {',
    "    try { return Double.parseDouble(xmlString(path, node)); } catch (NumberFormatException e) { return 0d; }",
    "  }",
    "  com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);",
    "  if (found == null || found.isNull() || found.isMissingNode()) return 0d;",
    "  if (found.isNumber()) return found.asDouble();",
    "  try { return Double.parseDouble(found.asText()); } catch (NumberFormatException e) { return 0d; }",
    "}",
    "",
    "private boolean xpathBoolean(String path, Object node) {",
    '  if (path.trim().startsWith("/")) return Boolean.parseBoolean(xmlString(path, node));',
    "  com.fasterxml.jackson.databind.JsonNode found = jsonAt(path, node);",
    "  return found != null && found.asBoolean(false);",
    "}",
    "",
    "private Object xpathNode(String path, Object node) {",
    '  String trimmed = path.trim();',
    '  if (trimmed.startsWith("/")) return xmlNode(path, node);',
    '  if (trimmed.isEmpty() || trimmed.equals("$") || trimmed.equals(".")) return node;',
    "  return jsonAt(path, node);",
    "}",
    "",
    "private List<Object> xpathNodes(String path, Object node) {",
    "  Object found = xpathNode(path, node);",
    "  if (found instanceof List<?> list) return new ArrayList<>(list);",
    "  if (found instanceof com.fasterxml.jackson.databind.JsonNode jn && jn.isArray()) {",
    "    List<Object> out = new ArrayList<>();",
    "    jn.forEach(out::add);",
    "    return out;",
    "  }",
    "  if (found == null) return List.of();",
    "  return List.of(found);",
    "}",
    "",
    "private com.fasterxml.jackson.databind.JsonNode jsonAt(String path, Object node) {",
    "  com.fasterxml.jackson.databind.JsonNode tree = toJsonNode(node);",
    "  String query = jsonQuery(path);",
    '  if (query.equals("$") || query.equals("$source")) return tree;',
    "  com.fasterxml.jackson.databind.JsonNode cur = tree;",
    '  String body = query.startsWith("$") ? query.substring(1) : query;',
    '  if (body.startsWith(".")) body = body.substring(1);',
    "  for (String seg : body.split(\"\\\\.\")) {",
    '    if (seg.isEmpty() || seg.equals("source")) continue;',
    "    if (cur == null || cur.isMissingNode()) return cur;",
    '    if (seg.chars().allMatch(Character::isDigit)) cur = cur.get(Integer.parseInt(seg));',
    "    else cur = cur.get(seg);",
    "  }",
    "  return cur;",
    "}",
    "",
    "private com.fasterxml.jackson.databind.JsonNode toJsonNode(Object node) {",
    "  if (node instanceof com.fasterxml.jackson.databind.JsonNode j) return j;",
    "  if (node == null) return JSON.nullNode();",
    "  if (node instanceof String s) {",
    "    String t = s.trim();",
    '    if (t.startsWith("{") || t.startsWith("[")) {',
    "      try { return JSON.readTree(t); } catch (Exception e) { return JSON.getNodeFactory().textNode(s); }",
    "    }",
    "    return JSON.getNodeFactory().textNode(s);",
    "  }",
    "  return JSON.valueToTree(node);",
    "}",
    "",
    "private static String jsonQuery(String path) {",
    "  String trimmed = path.trim();",
    '  if (trimmed.isEmpty() || trimmed.startsWith("/")) return trimmed;',
    '  String asJson = trimmed.startsWith("$") ? trimmed : "$." + trimmed.replaceFirst("^\\\\.", "");',
    "  String body = asJson.substring(1);",
    '  if (body.startsWith(".")) body = body.substring(1);',
    '  if (body.isEmpty() || body.equals(".")) return "$";',
    "  StringBuilder q = new StringBuilder();",
    "  int i = 0;",
    "  while (i < body.length()) {",
    '    if (body.charAt(i) == \'.\') { i++; continue; }',
    '    if (body.charAt(i) == \'[\') {',
    '      int close = body.indexOf(\']\', i + 1);',
    "      if (close < 0) break;",
    "      if (q.length() > 0) q.append('.');",
    "      q.append(body, i + 1, close);",
    "      i = close + 1;",
    "      continue;",
    "    }",
    "    int end = i;",
    '    while (end < body.length() && body.charAt(end) != \'.\' && body.charAt(end) != \'[\') end++;',
    "    if (q.length() > 0) q.append('.');",
    "    q.append(body, i, end);",
    "    i = end;",
    "  }",
    '  return q.length() == 0 ? "$" : q.toString();',
    "}",
    "",
    "private String xmlString(String path, Object node) {",
    "  org.w3c.dom.Node xml = xmlNode(path, node);",
    '  return xml == null ? "" : xml.getTextContent() == null ? "" : xml.getTextContent();',
    "}",
    "",
    "private org.w3c.dom.Node xmlNode(String path, Object node) {",
    "  try {",
    "    org.w3c.dom.Document doc;",
    "    if (node instanceof org.w3c.dom.Document d) doc = d;",
    "    else if (node instanceof org.w3c.dom.Node n) {",
    "      javax.xml.xpath.XPath xp = javax.xml.xpath.XPathFactory.newInstance().newXPath();",
    "      return (org.w3c.dom.Node) xp.evaluate(path, n, javax.xml.xpath.XPathConstants.NODE);",
    "    } else {",
    "      String xml = String.valueOf(node);",
    "      javax.xml.parsers.DocumentBuilder b = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder();",
    "      doc = b.parse(new org.xml.sax.InputSource(new java.io.StringReader(xml)));",
    "    }",
    "    javax.xml.xpath.XPath xp = javax.xml.xpath.XPathFactory.newInstance().newXPath();",
    "    return (org.w3c.dom.Node) xp.evaluate(path, doc, javax.xml.xpath.XPathConstants.NODE);",
    "  } catch (Exception e) {",
    "    return null;",
    "  }",
    "}",
  ];
  return lines;
}

function logicHelpers(helpers: Set<JavaHelper>): string[] {
  const lines: string[] = [
    "private static List<Object> asList(Object value) {",
    "  if (value instanceof List<?> list) return new ArrayList<>(list);",
    "  if (value == null) return new ArrayList<>();",
    "  return new ArrayList<>(List.of(value));",
    "}",
    "private static Object listGet(List<Object> list, Object index) {",
    "  int i = (int) toDouble(index);",
    "  if (i < 0 || i >= list.size()) return null;",
    "  return list.get(i);",
    "}",
    "private static Map<String, Object> mapOf(Object... kv) {",
    "  Map<String, Object> m = new LinkedHashMap<>();",
    "  for (int i = 0; i + 1 < kv.length; i += 2) m.put(asString(kv[i]), kv[i + 1]);",
    "  return m;",
    "}",
    "private static boolean sameItem(Object a, Object b) { return java.util.Objects.equals(a, b); }",
    "private static List<Object> setIntersection(List<Object> a, List<Object> b) {",
    "  List<Object> out = new ArrayList<>();",
    "  for (Object item : a) if (b.stream().anyMatch(other -> sameItem(item, other))) out.add(item);",
    "  return out;",
    "}",
    "private static List<Object> setUnion(List<Object> a, List<Object> b) {",
    "  List<Object> out = new ArrayList<>(a);",
    "  for (Object item : b) if (out.stream().noneMatch(other -> sameItem(item, other))) out.add(item);",
    "  return out;",
    "}",
    "private static List<Object> setDifference(List<Object> universe, List<Object> excluded) {",
    "  List<Object> out = new ArrayList<>();",
    "  for (Object item : universe) if (excluded.stream().noneMatch(other -> sameItem(item, other))) out.add(item);",
    "  return out;",
    "}",
  ];
  if (helpers.has("flatten")) {
    lines.push(
      "@SafeVarargs",
      "private static <T> List<T> flatten(Object... parts) {",
      "  List<T> out = new ArrayList<>();",
      "  for (Object part : parts) {",
      "    if (part instanceof List<?> list) {",
      "      for (Object item : list) if (item != null) out.add((T) item);",
      "    } else if (part != null) {",
      "      out.add((T) part);",
      "    }",
      "  }",
      "  return out;",
      "}",
    );
  }
  return lines;
}

function sheetTypeOnly(): string[] {
  return [
    "public static final class Sheet {",
    "  public final String name;",
    "  public final List<String> headers;",
    "  public final List<List<Object>> values;",
    "  public final List<String> rowNames;",
    "  public final String hitPolicy;",
    "  public final String collectJoin;",
    "  public Sheet(String name, List<String> headers, List<List<Object>> values) {",
    "    this(name, headers, values, List.of(), \"FIRST\", \"; \");",
    "  }",
    "  public Sheet(String name, List<String> headers, List<List<Object>> values, List<String> rowNames, String hitPolicy, String collectJoin) {",
    "    this.name = name;",
    "    this.headers = headers != null ? headers : List.of();",
    "    this.values = values != null ? values : List.of();",
    "    this.rowNames = rowNames != null ? rowNames : List.of();",
    "    this.hitPolicy = hitPolicy;",
    "    this.collectJoin = collectJoin;",
    "  }",
    "}",
  ];
}

function sheetHelpers(): string[] {
  return [
    ...sheetTypeOnly(),
    "private Sheet sheetOf(String name) { return sheets.get(name); }",
    "private Object sheetGetCell(String name, String a1) {",
    "  Sheet s = sheetOf(name); if (s == null) return null;",
    "  java.util.regex.Matcher m = java.util.regex.Pattern.compile(\"^([A-Za-z]+)(\\\\d+)$\").matcher(a1.trim());",
    "  if (!m.matches()) return null;",
    "  int x = 0; for (char ch : m.group(1).toUpperCase().toCharArray()) x = x * 26 + (ch - 64);",
    "  int y = Integer.parseInt(m.group(2)) - 1;",
    "  if (y < 0 || y >= s.values.size()) return null;",
    "  List<Object> row = s.values.get(y);",
    "  return row != null && x - 1 < row.size() ? row.get(x - 1) : null;",
    "}",
    "private Object sheetGetXy(String name, Object xObj, Object yObj) {",
    "  Sheet s = sheetOf(name); if (s == null) return null;",
    "  int x = (int) toDouble(xObj); int y = (int) toDouble(yObj);",
    "  if (y < 0 || y >= s.values.size()) return null;",
    "  List<Object> row = s.values.get(y);",
    "  return row != null && x >= 0 && x < row.size() ? row.get(x) : null;",
    "}",
    "private List<Object> sheetGetRow(String name, Object yObj) {",
    "  Sheet s = sheetOf(name); if (s == null) return List.of();",
    "  int y = (int) toDouble(yObj);",
    "  if (y < 0 || y >= s.values.size()) return List.of();",
    "  return new ArrayList<>(s.values.get(y));",
    "}",
    "private List<Object> sheetGetColumn(String name, Object xObj) {",
    "  Sheet s = sheetOf(name); if (s == null) return List.of();",
    "  int x = (int) toDouble(xObj);",
    "  List<Object> out = new ArrayList<>();",
    "  for (List<Object> row : s.values) out.add(row != null && x >= 0 && x < row.size() ? row.get(x) : null);",
    "  return out;",
    "}",
    "private String sheetGetHeader(String name, Object xObj) {",
    "  Sheet s = sheetOf(name); if (s == null) return \"\";",
    "  int x = (int) toDouble(xObj);",
    "  return x >= 0 && x < s.headers.size() ? s.headers.get(x) : \"\";",
    "}",
    "private List<List<Object>> sheetGetData(String name) {",
    "  Sheet s = sheetOf(name); if (s == null) return List.of();",
    "  List<List<Object>> out = new ArrayList<>();",
    "  for (List<Object> row : s.values) out.add(new ArrayList<>(row));",
    "  return out;",
    "}",
    "private Object sheetLookup(String name, Object matchCol, Object matchValue, Object returnCol) {",
    "  Sheet s = sheetOf(name); if (s == null) return null;",
    "  int mi = columnIndex(s, matchCol);",
    "  int y = -1;",
    "  for (int i = 0; i < s.values.size(); i++) {",
    "    List<Object> row = s.values.get(i);",
    "    Object cell = row != null && mi >= 0 && mi < row.size() ? row.get(mi) : null;",
    "    if (asString(cell).equals(asString(matchValue))) { y = i; break; }",
    "  }",
    "  if (y < 0) return null;",
    "  if (returnCol == null || asString(returnCol).isEmpty()) {",
    "    Map<String, Object> rec = new LinkedHashMap<>();",
    "    List<Object> row = s.values.get(y);",
    "    for (int x = 0; x < s.headers.size(); x++) rec.put(s.headers.get(x).isEmpty() ? String.valueOf(x) : s.headers.get(x), x < row.size() ? row.get(x) : null);",
    "    return rec;",
    "  }",
    "  int ri = columnIndex(s, returnCol);",
    "  List<Object> row = s.values.get(y);",
    "  return ri >= 0 && ri < row.size() ? row.get(ri) : null;",
    "}",
    "private Object sheetLookup(String name, Object matchCol, Object matchValue) {",
    "  return sheetLookup(name, matchCol, matchValue, null);",
    "}",
    "private Object decisionTable(String name, Map<String, Object> inputs, String outputCol) {",
    "  Sheet s = sheetOf(name); if (s == null) return null;",
    "  int width = s.headers.size();",
    "  int oi = outputCol != null && !outputCol.equals(\"*\") ? s.headers.indexOf(outputCol) : width - 1;",
    "  if (oi < 0) oi = Math.max(0, width - 1);",
    "  List<Integer> matches = new ArrayList<>();",
    "  for (int y = 0; y < s.values.size(); y++) {",
    "    boolean ok = true;",
    "    for (int x = 0; x < width - 1; x++) {",
    "      Object cell = y < s.values.size() && x < s.values.get(y).size() ? s.values.get(y).get(x) : null;",
    "      if (dontCare(cell)) continue;",
    "      if (!asString(cell).equals(asString(inputs.get(s.headers.get(x))))) { ok = false; break; }",
    "    }",
    "    if (ok) matches.add(y);",
    "  }",
    "  if (matches.isEmpty()) return null;",
    '  if ("COLLECT".equals(s.hitPolicy)) {',
    "    String join = s.collectJoin != null ? s.collectJoin : \"; \";",
    "    List<String> parts = new ArrayList<>();",
    "    for (int y : matches) {",
    "      Object cell = oi < s.values.get(y).size() ? s.values.get(y).get(oi) : null;",
    "      parts.add(cell == null ? \"\" : String.valueOf(cell));",
    "    }",
    "    return String.join(join, parts);",
    "  }",
    "  int y = matches.get(0);",
    "  return oi < s.values.get(y).size() ? s.values.get(y).get(oi) : null;",
    "}",
    "private Object decisionTable(String name, Map<String, Object> inputs) {",
    "  return decisionTable(name, inputs, null);",
    "}",
    "private static boolean dontCare(Object cell) {",
    "  if (cell == null) return true;",
    "  String t = String.valueOf(cell).trim();",
    '  return t.isEmpty() || t.equals("—") || t.equals("–") || t.equals("-") || t.equals("*");',
    "}",
    "private static int columnIndex(Sheet s, Object ref) {",
    "  if (ref instanceof Number n) return n.intValue();",
    "  String t = asString(ref);",
    "  int hi = s.headers.indexOf(t); if (hi >= 0) return hi;",
    "  if (t.chars().allMatch(Character::isLetter)) {",
    "    int n = 0; for (char ch : t.toUpperCase().toCharArray()) n = n * 26 + (ch - 64);",
    "    return n - 1;",
    "  }",
    "  try { return Integer.parseInt(t); } catch (NumberFormatException e) { return -1; }",
    "}",
  ];
}

function indentLines(src: string[], n: number): string[] {
  const pad = "  ".repeat(n);
  return src.map((line) => (line.length ? pad + line : line));
}
