import { emitImperativeStack } from "./function_statements.ts";
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
import { attributesFor, baseRmTypeName, isAbstractType, isSubtypeOf, resolveGenericSlotType } from "../rm_meta.ts";
import {
  propsLackClinicalContent,
  rmArchetypeNodeId,
  rmLocatableName,
} from "../openehr/rm_archetype_node_id.ts";
import { compileAuthoringPath, looksLikeOpenEhrLocator } from "../openehr/locator.ts";
import { namedLoopBinding } from "../named_loop_path.ts";
import { codedChoicesForNode, isListAttribute } from "./typescript.ts";
import { usesOpenEhrProduct } from "./product.ts";
import { codedTextParts } from "../openehr/coded_text.ts";
import { canvasHandlebarsExpression } from "../output/canvas_handlebars.ts";
import {
  functionIdentMap,
  jsFunctionIdent,
  valueFunctions,
} from "./user_functions.ts";
import { JAVA_CODED_TEXT_BLOB, JAVA_HANDLEBARS_BLOB, JAVA_RUNTIME_BLOB } from "./helpers/locations.ts";
import { emitShellFields, type ShellCodegen } from "./shell_emit.ts";

const GENERIC_RM = new Set(["HISTORY", "POINT_EVENT", "INTERVAL_EVENT", "EVENT"]);

/**
 * Archie classes that cannot be constructed. Archetypes often leave the slot
 * at the abstract parent (`EVENT` = any event); the concrete sibling is what
 * `new` can call.
 */
const CONCRETE_RM: Record<string, string> = {
  EVENT: "POINT_EVENT",
  ITEM_STRUCTURE: "ITEM_TREE",
};

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
  ContentItem: "com.nedap.archie.rm.composition",
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
  ItemStructure: "com.nedap.archie.rm.datastructures",
  DvText: "com.nedap.archie.rm.datavalues",
  TermMapping: "com.nedap.archie.rm.datavalues",
  DvCodedText: "com.nedap.archie.rm.datavalues",
  DvBoolean: "com.nedap.archie.rm.datavalues",
  DvIdentifier: "com.nedap.archie.rm.datavalues",
  DvURI: "com.nedap.archie.rm.datavalues",
  DvEHRURI: "com.nedap.archie.rm.datavalues",
  DvParagraph: "com.nedap.archie.rm.datavalues",
  DvState: "com.nedap.archie.rm.datavalues",
  DvQuantity: "com.nedap.archie.rm.datavalues.quantity",
  DvInterval: "com.nedap.archie.rm.datavalues.quantity",
  ReferenceRange: "com.nedap.archie.rm.datavalues.quantity",
  DvCount: "com.nedap.archie.rm.datavalues.quantity",
  DvOrdinal: "com.nedap.archie.rm.datavalues.quantity",
  DvProportion: "com.nedap.archie.rm.datavalues.quantity",
  DvScale: "com.nedap.archie.rm.datavalues.quantity",
  DvDateTime: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvDate: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvTime: "com.nedap.archie.rm.datavalues.quantity.datetime",
  DvDuration: "com.nedap.archie.rm.datavalues.quantity.datetime",
  CodePhrase: "com.nedap.archie.rm.datatypes",
  TerminologyId: "com.nedap.archie.rm.support.identification",
  DvMultimedia: "com.nedap.archie.rm.datavalues.encapsulated",
  DvParsable: "com.nedap.archie.rm.datavalues.encapsulated",
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
  | "handlebars"
  | "coded";

export interface JavaEmitContext {
  sourceVar: string;
  loopVar?: string;
  /** Loop item name → Java ident. Inner names shadow. */
  loopBindings?: Readonly<Record<string, string>>;
  types: Set<string>;
  helpers: Set<JavaHelper>;
  idents: Map<string, number>;
  mappingFunctions?: MappingFunction[];
  fnParams?: Set<string>;
  fnLocals?: boolean;
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

/** LOCATABLE (BMM ancestry). ISM_TRANSITION and EVENT_CONTEXT are not. */
function emitsArchetypeNodeId(rmType: string): boolean {
  try {
    return rmType === "LOCATABLE" || isSubtypeOf(rmType, "LOCATABLE");
  } catch {
    return LOCATABLE_TYPES.has(rmType);
  }
}

function splitTypeArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "<") depth++;
    else if (c === ">") depth--;
    else if (c === "," && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = args.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Archie type name for a BMM type (`EVENT<T>` → `Event<ItemStructure>`). */
function javaRmType(owner: string, typeName: string): string {
  const trimmed = typeName.trim();
  const genericAt = trimmed.indexOf("<");
  if (genericAt > 0 && trimmed.endsWith(">")) {
    const raw = trimmed.slice(0, genericAt);
    const args = splitTypeArgs(trimmed.slice(genericAt + 1, -1));
    return `${javaClassName(raw)}<${args.map((arg) => javaRmType(raw, arg)).join(", ")}>`;
  }
  if (trimmed === "T") return javaClassName(resolveGenericSlotType(owner, trimmed));
  return javaClassName(trimmed);
}

/**
 * Element type of a BMM `List<…>` attribute.
 * Missing attributes (OBSERVATION.events is not on the class) stay unwrapped.
 */
function javaListElementType(parentRm: string, attr: string): string | null {
  try {
    const meta = attributesFor(parentRm).find((item) => item.name === attr);
    if (!meta?.typeName.startsWith("List<") || !meta.typeName.endsWith(">")) return null;
    return javaRmType(parentRm, meta.typeName.slice("List<".length, -1));
  } catch {
    return null;
  }
}

/**
 * Java lists are invariant. `List<PointEvent<ItemStructure>>` is not a
 * `List<Event<ItemStructure>>`, and `new PointEvent<>()` does not infer its
 * parameter unless the stream map has a type witness.
 * Nested streams are already witnessed, so only this list's own depth changes.
 */
/** Import Archie classes named in a type witness (`Event<ItemStructure>`). */
function concreteRmType(rmType: string): string {
  const substitute = CONCRETE_RM[rmType];
  if (!substitute) return rmType;
  try {
    return isAbstractType(rmType) ? substitute : rmType;
  } catch {
    return substitute;
  }
}

/**
 * A CLUSTER in an ITEM_STRUCTURE socket is the template shape for
 * other_context and protocol. Archie types that attribute as ItemStructure,
 * so the assignment goes through Object.
 */
function adaptAssignedValue(
  parentRm: string,
  attr: string,
  childRm: string,
  code: string,
  ctx: JavaEmitContext,
): string {
  try {
    const meta = attributesFor(parentRm).find((item) => item.name === attr);
    if (!meta || meta.typeName.startsWith("List<")) return code;
    const targetRm = resolveGenericSlotType(parentRm, baseRmTypeName(meta.typeName));
    if (childRm === targetRm || isSubtypeOf(childRm, targetRm)) return code;
    const javaType = javaRmType(parentRm, meta.typeName);
    const raw = javaType.replace(/<.*/, "");
    if (!JAVA_PACKAGES[raw]) return code;
    noteImportedJavaType(ctx, javaType);
    return `((${javaType}) (Object) (${code}))`;
  } catch {
    return code;
  }
}

function noteImportedJavaType(ctx: JavaEmitContext, javaType: string): void {
  for (const name of javaType.match(/[A-Z][A-Za-z0-9]*/g) ?? []) {
    if (!JAVA_PACKAGES[name]) continue;
    const overridden = Object.entries(JAVA_CLASS_OVERRIDES).find(([, cls]) => cls === name)?.[0];
    const rm = overridden ?? name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
    ctx.types.add(rm);
  }
}

function widenJavaList(code: string, element: string): string {
  const trimmed = code.trimStart();
  const depth = trimmed.startsWith("flatten(") ? 1 : 0;
  return `new java.util.ArrayList<${element}>(${witnessListExpr(code, element, depth)})`;
}

function witnessListExpr(code: string, element: string, depth: number): string {
  const stream = ".stream().map(";
  const listOf = "java.util.List.of(";
  let out = "";
  let i = 0;
  let d = 0;
  let inString = false;
  while (i < code.length) {
    const c = code[i]!;
    if (inString) {
      out += c;
      if (c === "\\") {
        const next = code[i + 1];
        if (next !== undefined) {
          out += next;
          i += 2;
          continue;
        }
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (d === depth && code.startsWith(stream, i)) {
      out += `.stream().<${element}>map(`;
      i += stream.length;
      d++;
      continue;
    }
    if (d === depth && code.startsWith(listOf, i)) {
      out += `java.util.List.<${element}>of(`;
      i += listOf.length;
      d++;
      continue;
    }
    if (c === "(") d++;
    else if (c === ")") d--;
    out += c;
    i++;
  }
  return out;
}

function javaChoicesLiteral(choices: Array<[string, string, string]>): string {
  const rows = choices.map(([code, rubric, term]) =>
    `{${JSON.stringify(code)}, ${JSON.stringify(rubric)}, ${JSON.stringify(term)}}`
  );
  return `new String[][]{${rows.join(", ")}}`;
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
          if (ctx.fnLocals) return `__fnVars.get(${args[0]})`;
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
          return `sameItem(${args[0]}, ${args[1]})`;
        case "ne":
          return `(!sameItem(${args[0]}, ${args[1]}))`;
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
          return `listGetIndex(${args[0]}, asString(${args[1] ?? '"FIRST"'}), ${args[2] ?? "1"})`;
        case "intersection":
          ctx.helpers.add("logic");
          return `setIntersection(asList(${args[0]}), asList(${args[1]}))`;
        case "union":
          ctx.helpers.add("logic");
          return `setUnion(asList(${args[0]}), asList(${args[1]}))`;
        case "difference":
          ctx.helpers.add("logic");
          return `setDifference(asList(${args[0]}), asList(${args[1]}))`;
        case "maps_entries":
          return `mapEntries(${args[0]})`;
        case "lists_length":
          return `asList(${args[0]}).size()`;
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
    const params = fn.params.map((p, i) => `Object ${fn.stack?.length ? `arg${i}` : jsFunctionIdent(p)}`).join(", ");
    const inner: JavaEmitContext = {
      ...ctx,
      fnParams: new Set(fn.params),
      fnLocals: Boolean(fn.stack?.length),
      fnIdents: idents,
    };
    const body = emitJavaExpressionSource(fn.body!, inner) ?? "null";
    lines.push(`  private Object ${ident}(${params}) {`);
    if (fn.stack?.length) {
      lines.push(`    java.util.Map<String, Object> __fnVars = new java.util.LinkedHashMap<>();`);
      fn.params.forEach((p, i) => lines.push(`    __fnVars.put(${JSON.stringify(p)}, arg${i});`));
      lines.push(emitImperativeStack(fn.stack, source => emitJavaExpressionSource(source, inner) ?? "null", true));
    }
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
  if (mapArg?.kind !== "literal") return `mapValueGet(${args[0]}, ${key})`;
  return `(("defaults".equals(${args[0]}) ? defaults : java.util.Map.of()).get(${key}))`;
}

function emitSheetCall(name: string, args: string[]): string {
  const sheet = args[0]?.startsWith('"') ? args[0] : `asString(${args[0]})`;
  return `ig.${javaMethodName(name)}(${[sheet, ...args.slice(1)].join(", ")})`;
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
  const named = path ? namedLoopBinding(path, ctx.loopBindings) : null;
  if (named) {
    const restCode = JSON.stringify(named.rest === "." ? "." : named.rest);
    return `ig.${fn}(${restCode}, ${named.ident})`;
  }
  let code = pathCode;
  if (path && looksLikeOpenEhrLocator(path) && (path.startsWith("/") || path.startsWith("//"))) {
    code = JSON.stringify(compileAuthoringPath(path, "xml"));
  }
  const relative = Boolean(path) && !path.startsWith("$") && !path.startsWith("/");
  if (relative && ctx.loopVar) return `ig.${fn}(${code}, ${ctx.loopVar})`;
  return `ig.${fn}(${code})`;
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
  const innerCtx: JavaEmitContext = {
    ...ctx,
    loopVar: ident,
    loopBindings: { ...ctx.loopBindings, [varName]: ident },
  };
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
  if (/^(?:ig\.)?(xpathNumber|toDouble|Math\.round)\(/.test(expr) || /^-?\d+(\.\d+)?$/.test(expr.trim())) {
    return expr;
  }
  return `toDouble(${expr})`;
}

function asStringExpr(expr: string): string {
  if (/^(?:ig\.)?(xpathString|asString)\(/.test(expr) || /^"/.test(expr.trim())) return expr;
  return `asString(${expr})`;
}

function asBooleanExpr(expr: string): string {
  if (/^(?:ig\.)?(xpathBoolean|asBoolean)\(/.test(expr) || /^(true|false)$/.test(expr.trim())) {
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
  const constructType = concreteRmType(rmType);
  ctx.types.add(constructType);
  const compact = compactConstruct(constructType, props, ctx);
  if (compact) return compact;
  const cls = javaClassName(constructType);
  const diamond = GENERIC_RM.has(constructType) || GENERIC_RM.has(rmType) ? "<>" : "";
  if (!props.length) return `new ${cls}${diamond}()`;
  const ident = freshIdent(ctx, rmType);
  const inner = indent + 1;
  const setters = props.map(([attr, value]) =>
    `${"  ".repeat(inner)}${ident}.${javaSetterName(attr)}(${value});`
  );
  const close = "  ".repeat(indent);
  return `rm(new ${cls}${diamond}(), ${ident} -> {\n${setters.join("\n")}\n${close}})`;
}

function hasExtraConstructKeys(map: Map<string, string>, allowed: string[]): boolean {
  for (const key of map.keys()) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

/** Archie `TermMapping.setMatch` takes a char, not a String. */
function javaCharExpr(code: string): string {
  const trimmed = code.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const text = JSON.parse(trimmed) as string;
      if (text.length === 1) {
        const ch = text === "\\" ? "\\\\" : text === "'" ? "\\'" : text;
        return `'${ch}'`;
      }
    } catch {
      /* dynamic string */
    }
  }
  return `${asStringExpr(code)}.charAt(0)`;
}

function javaApplyExtras(
  base: string,
  extras: Array<[string, string]>,
  ctx: JavaEmitContext,
  rmType: string,
  indent: number,
): string {
  if (!extras.length) return base;
  ctx.helpers.add("rm");
  const ident = freshIdent(ctx, rmType);
  const pad = "  ".repeat(indent + 1);
  const close = "  ".repeat(indent);
  const setters = extras.map(([attr, value]) => `${pad}${ident}.${javaSetterName(attr)}(${value});`);
  return `rm(${base}, ${ident} -> {\n${setters.join("\n")}\n${close}})`;
}

function javaShellGen(ctx: JavaEmitContext, indent: number): ShellCodegen {
  return {
    expr: (expression) => emitJavaExpressionSource(expression, ctx) ?? "null",
    object: (rmType, fields) => javaShellObject(rmType, fields, ctx, indent),
    list: (items, attribute) => attribute === "data" || attribute === "integrity_check"
      ? `new byte[] { ${items.join(", ")} }`
      : `java.util.List.of(${items.join(", ")})`,
    octets: (code) => `java.util.Base64.getDecoder().decode(${asStringExpr(code)})`,
  };
}

function javaShellObject(
  rmType: string,
  fields: Array<[string, string]>,
  ctx: JavaEmitContext,
  indent: number,
): string {
  if (rmType === "TERM_MAPPING") {
    const rewritten = fields.map(([key, value]) =>
      key === "match" ? [key, javaCharExpr(value)] as [string, string] : [key, value]
    );
    return formatRmConstruct(rmType, rewritten, indent, ctx);
  }
  if (rmType === "CODE_PHRASE") {
    ctx.types.add("CODE_PHRASE");
    ctx.types.add("TERMINOLOGY_ID");
    const term = fields.find(([key]) => key === "terminology_id")?.[1];
    const code = fields.find(([key]) => key === "code_string")?.[1] ?? '""';
    if (term) return `new CodePhrase(new TerminologyId(${asStringExpr(term)}), ${asStringExpr(code)})`;
    return `new CodePhrase(${asStringExpr(code)})`;
  }
  const value = fields.find(([key]) => key === "value")?.[1];
  const rest = fields.filter(([key]) => key !== "value");
  if (
    value &&
    (rmType === "DV_TEXT" || rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
      rmType === "DV_DATE" || rmType === "DV_DATE_TIME" || rmType === "DV_TIME" ||
      rmType === "DV_DURATION" || rmType === "DV_PARSABLE")
  ) {
    ctx.types.add(rmType);
    return javaApplyExtras(`new ${javaClassName(rmType)}(${asStringExpr(value)})`, rest, ctx, rmType, indent);
  }
  if (rmType === "DV_QUANTITY") {
    const magnitude = fields.find(([key]) => key === "magnitude")?.[1];
    const units = fields.find(([key]) => key === "units")?.[1] ?? "null";
    const restQ = fields.filter(([key]) => key !== "magnitude" && key !== "units");
    if (magnitude) {
      ctx.types.add("DV_QUANTITY");
      return javaApplyExtras(
        `new DvQuantity(${units}, ${asDoubleExpr(magnitude)}, null)`,
        restQ,
        ctx,
        rmType,
        indent,
      );
    }
  }
  return formatRmConstruct(rmType, fields, indent, ctx);
}

function attachJavaShell(
  base: string,
  slot: MappingSlot | undefined,
  ctx: JavaEmitContext,
  rmType: string,
  indent: number,
): string {
  return javaApplyExtras(
    base,
    emitShellFields(slot?.shellFragments, javaShellGen(ctx, indent)),
    ctx,
    rmType,
    indent,
  );
}

function compactConstruct(
  rmType: string,
  props: Array<[string, string]>,
  ctx: JavaEmitContext,
): string | null {
  const map = new Map(props);
  if (hasExtraConstructKeys(map, ["value", "magnitude", "units", "precision", "code_string", "terminology_id", "defining_code"])) {
    return null;
  }
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
    const term = map.get("terminology_id");
    const phrase = term ? `asString(${term}) + "::" + ${asStringExpr(code)}` : asStringExpr(code);
    return `new DvCodedText(${asStringExpr(value)}, ${phrase})`;
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
    loopBindings: { ...ctx.loopBindings, [loop.varName]: ident },
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
  return `ig.xpathNodes(${JSON.stringify(loop.path)}).stream().map(${mapped}).toList()`;
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
  if (nodeId && emitsArchetypeNodeId(node.rmType)) {
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
    const emitted = children
      .map((child) => ({
        rmType: child.rmType,
        code: emitSkeletonNode(
          child,
          slots,
          loops,
          ctx,
          listAttr ? indent + 2 : indent + 1,
          childArchetypeRef,
        ),
      }))
      .filter((item): item is { rmType: string; code: string } =>
        Boolean(item.code) && !isBlankGeneratedExpr(item.code!)
      );
    if (!emitted.length) continue;
    const codes = emitted.map((item) => item.code);
    const streamed = codes.some((c) => c.includes(".stream().map("));
    const asList = listAttr || streamed;
    let value: string;
    if (asList) {
      if (codes.length === 1 && streamed) {
        value = codes[0]!;
      } else if (streamed) {
        ctx.helpers.add("flatten");
        const inner = codes.map((c) => indentBlock(c, indent + 2)).join(",\n");
        value = `flatten(\n${inner}\n${"  ".repeat(indent + 1)})`;
      } else {
        const inner = codes.map((c) => indentBlock(c, indent + 2)).join(",\n");
        value = `java.util.List.of(\n${inner}\n${"  ".repeat(indent + 1)})`;
      }
      const element = javaListElementType(node.rmType, attr);
      if (element) {
        noteImportedJavaType(ctx, element);
        value = widenJavaList(value, element);
      }
    } else {
      value = adaptAssignedValue(node.rmType, attr, emitted[0]!.rmType, codes[0]!, ctx);
    }
    props.push([attr, value]);
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
    const coded = codedTextParts(slot?.expression);
    if (coded) {
      const part = (ast: ExprAst | undefined, lit: string) => ast ? asStringExpr(emitJavaExpression(ast, ctx)) : JSON.stringify(lit);
      const t = coded.terminology ?? { kind: "literal", value: term };
      const c = coded.code ?? { kind: "literal", value: code ?? "" };
      const phrase = t.kind === "literal" && c.kind === "literal"
        ? JSON.stringify(`${t.value}::${c.value}`)
        : `${part(t, "")} + "::" + ${part(c, "")}`;
      return attachJavaShell(`new DvCodedText(${part(coded.value, rubric)}, ${phrase})`, slot, ctx, rmType, indent);
    }
    if (code) {
      return attachJavaShell(
        `new DvCodedText(${JSON.stringify(rubric)}, ${JSON.stringify(`${term}::${code}`)})`,
        slot,
        ctx,
        rmType,
        indent,
      );
    }
    if (expr) {
      const choices = codedChoicesForNode(node);
      ctx.helpers.add("coded");
      return attachJavaShell(`codedText(${expr}, ${javaChoicesLiteral(choices)})`, slot, ctx, rmType, indent);
    }
    return null;
  }

  if (rmType === "DV_QUANTITY") {
    // No magnitude: omit, even when a reference range was added on the shell.
    if (!expr) return null;
    const props: Array<[string, string]> = [["magnitude", asDoubleExpr(expr)]];
    if (fields.units) props.push(["units", JSON.stringify(fields.units)]);
    return attachJavaShell(formatRmConstruct("DV_QUANTITY", props, indent, ctx), slot, ctx, rmType, indent);
  }

  if (rmType === "DV_COUNT") {
    if (!expr) return null;
    return attachJavaShell(
      formatRmConstruct(rmType, [["magnitude", `(long) ${asDoubleExpr(expr)}`]], indent, ctx),
      slot,
      ctx,
      rmType,
      indent,
    );
  }

  if (rmType === "DV_ORDINAL" || rmType === "DV_PROPORTION") {
    if (!expr) return null;
    return attachJavaShell(
      formatRmConstruct(rmType, [["magnitude", asDoubleExpr(expr)]], indent, ctx),
      slot,
      ctx,
      rmType,
      indent,
    );
  }

  if (rmType === "DV_BOOLEAN") {
    if (!expr) return null;
    return attachJavaShell(
      formatRmConstruct("DV_BOOLEAN", [["value", asBooleanExpr(expr)]], indent, ctx),
      slot,
      ctx,
      rmType,
      indent,
    );
  }

  if (
    rmType === "DV_DATE_TIME" || rmType === "DV_DATE" || rmType === "DV_TIME" ||
    rmType === "DV_DURATION"
  ) {
    const value = expr
      ? asStringExpr(expr)
      : fields.value
      ? JSON.stringify(fields.value)
      : null;
    if (!value) return null;
    ctx.types.add(rmType);
    return attachJavaShell(`new ${javaClassName(rmType)}(${value})`, slot, ctx, rmType, indent);
  }

  if (
    rmType === "DV_URI" || rmType === "DV_EHR_URI" ||
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
      return attachJavaShell(`new DvText(${value})`, slot, ctx, rmType, indent);
    }
    if (rmType === "DV_IDENTIFIER") {
      return attachJavaShell(formatRmConstruct(rmType, [["id", value]], indent, ctx), slot, ctx, rmType, indent);
    }
    ctx.types.add(rmType);
    return attachJavaShell(`new ${javaClassName(rmType)}(${value})`, slot, ctx, rmType, indent);
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
  const scriptBody = `${parts.body}\n${parts.extraMethods ?? ""}`;
  const staticNames = javaStaticHelperNames(scriptBody);
  const instanceHelpers = usesXpath || parts.helpers.has("sheets");
  const dialect = parts.archie ? "Java / Archie" : "Java";
  const lines: string[] = [
    `// Generated by intEHRgrator — Conversion Script (${dialect})`,
    `// Template: ${parts.templateId || "(none)"}`,
    `// Helpers: ${JAVA_RUNTIME_BLOB}`,
    ...(parts.helpers.has("handlebars")
      ? [`// VMS-Hbs render via com.github.jknack.handlebars: ${JAVA_HANDLEBARS_BLOB}`]
      : []),
    ...(parts.helpers.has("coded")
      ? [`// Coded text value-set lookup (Archie): ${JAVA_CODED_TEXT_BLOB}`]
      : []),
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
    "import se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime.Sheet;",
    ...(instanceHelpers
      ? ["import se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime;"]
      : []),
    ...staticNames.map((name) =>
      `import static se.regionstockholm.intehrgrator.runtime.IntehrgratorRuntime.${name};`
    ),
    ...(parts.helpers.has("handlebars")
      ? ["import static se.regionstockholm.intehrgrator.runtime.HandlebarsSupport.handlebars;"]
      : []),
    ...(parts.helpers.has("coded")
      ? ["import static se.regionstockholm.intehrgrator.runtime.CodedTextSupport.codedText;"]
      : []),
    "",
    "public class ConversionScript {",
    ...(instanceHelpers
      ? ["  private final IntehrgratorRuntime ig = new IntehrgratorRuntime();"]
      : []),
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
    "    this.defaults = defaults != null ? defaults : new LinkedHashMap<>();",
    "    this.sheets = sheets != null ? sheets : new LinkedHashMap<>();",
    ...(instanceHelpers ? ["    ig.bind(source, this.sheets);"] : []),
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
  }

  lines.push("}", "");
  return lines.join("\n");
}

function javaStaticHelperNames(body: string): string[] {
  const names = [
    "asString",
    "toDouble",
    "asBoolean",
    "asList",
    "listGet",
    "mapEntries",
    "mapValueGet",
    "appendList",
    "listGetIndex",
    "mapOf",
    "sameItem",
    "setIntersection",
    "setUnion",
    "setDifference",
    "flatten",
    "rm",
  ];
  return names.filter((name) => body.includes(`${name}(`));
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

function indentLines(src: string[], n: number): string[] {
  const pad = "  ".repeat(n);
  return src.map((line) => (line.length ? pad + line : line));
}
