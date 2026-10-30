import type {
  MappingLoop,
  MappingModel,
  OpenEhrInstanceShape,
  OpenEhrJsonDeserializeMode,
  OutputMode,
  OutputValidation,
  OutputValidationMessage,
  SourceFormatId,
  TestResult,
} from "../../types/mod.ts";
import {
  isConversionScriptLanguage,
  unimplementedTestRunMessage,
} from "../../types/mod.ts";
import { getSourceFormatHandler } from "../source/format_handler.ts";
import { collectJsonNodes, evaluate, type SourceContext } from "../source/query_runtime.ts";
import { parseExpression, type ExprAst } from "../expression/mod.ts";
import { expressionUsesRelativeSourcePath } from "../mapping_model/loops.ts";
import {
  applyOptionalRmToSkeleton,
  collectAllSlotIds,
  collectValueSlots,
  findSkeletonTrail,
} from "../skeleton/generate_skeleton.ts";
import { generateTypeScript, generate } from "../codegen/mod.ts";
import {
  runGeneratedTypeScript,
  serializedConversionOutput,
} from "../codegen/run_typescript.ts";
import {
  isXQueryRuntimeLoaded,
  runGeneratedXQuery,
  xqueryRuntimeUnavailableMessage,
} from "../codegen/run_xquery.ts";
import {
  getTargetFormatHandler,
  type TargetDefinition,
} from "../target/mod.ts";
import { renderHandlebars } from "../output/handlebars_dialect.ts";
import { canvasHandlebarsExpression } from "../output/canvas_handlebars.ts";
import { renderXmlCanvasFromBlockly } from "../output/canvas_xml_runtime.ts";
import { executeGoTemplate, isGoTemplateWasmLoaded } from "../output/go_template_runtime.ts";
import { generateGoTemplate } from "../codegen/go_template.ts";
import { DEFAULTS_MAP_NAME, namedMapsFromBlocklyState } from "../defaults/mod.ts";
import { sheetsToBag } from "../sheets/mod.ts";
import { validateConvertedOutput } from "../output/template_validation.ts";
import { compactSlotId } from "../ai/slot_tree.ts";
import {
  formatTestRunPayload,
  instanceShapeForEncoding,
  preferredInstanceEncoding,
  serializeInstance,
} from "../output/instance_encoding.ts";

export interface RunTestOptions {
  target?: TargetDefinition | null;
  /** Session Output mode. TypeScript executes Generated Export. */
  outputMode?: OutputMode;
  /** Generated Conversion Script text (TypeScript Output mode). */
  generatedCode?: string;
  handlebarsTemplate?: string;
  /** Blockly workspace JSON used to materialize the Defaults Map. */
  blocklyState?: unknown;
  /** Convert-time Defaults Map overlay (wins over Blockly named `defaults`). */
  defaults?: Record<string, unknown>;
  /** Convert-time named Sheets (ADR 0005). */
  sheets?: import("../sheets/types.ts").SheetDocument[];
  /** ehrtslib JSON deserializer preset for openEHR template validation. */
  openEhrJsonDeserializeMode?: OpenEhrJsonDeserializeMode;
  /** openEHR JSON vs XML instance shape for XQuery generate-and-run. */
  instanceShape?: OpenEhrInstanceShape;
}

export function runTest(
  model: MappingModel,
  exampleContent: string,
  format: SourceFormatId,
  options: RunTestOptions = {},
): TestResult {
  const warnings: string[] = [];
  const mode = options.outputMode ?? "preview";
  if (
    isConversionScriptLanguage(mode) &&
    mode !== "typescript" &&
    mode !== "handlebars" &&
    mode !== "go-template" &&
    mode !== "xquery"
  ) {
    const message = unimplementedTestRunMessage(mode);
    return {
      ok: false,
      output: message,
      error: message.trim(),
      warnings,
    };
  }
  try {
    const handler = getSourceFormatHandler(format);
    const ctx = handler.createContext(exampleContent);
    const fromContext = ctx.namedMaps ?? {};
    const fromBlockly = namedMapsFromBlocklyState(options.blocklyState);
    ctx.namedMaps = { ...fromContext, ...fromBlockly };
    ctx.namedMaps[DEFAULTS_MAP_NAME] = {
      ...(fromContext[DEFAULTS_MAP_NAME] ?? {}),
      ...(fromBlockly[DEFAULTS_MAP_NAME] ?? {}),
      ...(options.defaults ?? {}),
    };
    const defaults = ctx.namedMaps[DEFAULTS_MAP_NAME] ?? {};
    ctx.sheets = { ...ctx.sheets, ...sheetsToBag(options.sheets ?? []) };
    ctx.functions = model.functions ?? [];
    const target = options.target
      ? {
        ...options.target,
        skeleton: applyOptionalRmToSkeleton(
          options.target.skeleton,
          model.optionalRm ?? [],
        ),
      }
      : options.target;

    if (mode === "typescript") {
      const code = options.generatedCode ?? generate(model, "typescript", {
        handlebarsTemplate: options.handlebarsTemplate,
        blocklyState: options.blocklyState,
        skeleton: target?.skeleton,
        webTemplateJson: target?.webTemplateJson,
      });
      const raw = runGeneratedTypeScript(code, {
        format,
        data: ctx.data,
      }, defaults, undefined, ctx.sheets);
      const output = serializedConversionOutput(raw);
      const outputValidation = annotateUnmatchedCodedValues(
        validateConvertedOutput(output, target, {
          deserializeMode: options.openEhrJsonDeserializeMode,
        }),
        model,
        target?.skeleton,
        (expression, returnType) => handler.evaluate(expression, ctx, returnType),
      );
      return {
        ok: warnings.length === 0,
        output,
        warnings,
        outputValidation,
      };
    }

    if (mode === "xquery") {
      if (!isXQueryRuntimeLoaded()) {
        const message = xqueryRuntimeUnavailableMessage();
        return { ok: false, output: message, error: message.trim(), warnings };
      }
      const code = options.generatedCode?.trim()
        ? options.generatedCode
        : generate(model, "xquery", {
          blocklyState: options.blocklyState,
          skeleton: target?.skeleton,
          instanceShape: model.instanceEncodings?.length
            ? instanceShapeForEncoding(preferredInstanceEncoding(model))
            : options.instanceShape,
          webTemplateJson: target?.webTemplateJson,
        });
      const raw = runGeneratedXQuery(code, {
        source: ctx.data,
        defaults,
        sheets: ctx.sheets,
      });
      const output = typeof raw === "string" ? raw : serializedConversionOutput(raw);
      const outputValidation = validateConvertedOutput(output, target, {
        deserializeMode: options.openEhrJsonDeserializeMode,
      });
      return {
        ok: warnings.length === 0,
        output,
        warnings,
        outputValidation,
      };
    }

    if (mode === "handlebars") {
      const xmlCanvas = renderXmlCanvasFromBlockly(options.blocklyState, ctx);
      if (xmlCanvas != null) {
        const outputValidation = validateConvertedOutput(xmlCanvas, target, {
          deserializeMode: options.openEhrJsonDeserializeMode,
        });
        return {
          ok: warnings.length === 0,
          output: xmlCanvas,
          warnings,
          outputValidation,
        };
      }
      const canvasOutput = tryRunCanvasConversionScript(model, options, ctx, defaults);
      if (canvasOutput) {
        const outputValidation = validateConvertedOutput(canvasOutput, target, {
          deserializeMode: options.openEhrJsonDeserializeMode,
        });
        return {
          ok: warnings.length === 0,
          output: canvasOutput,
          warnings,
          outputValidation,
        };
      }
      const template = options.handlebarsTemplate ?? target?.content ?? "";
      if (!template.trim()) {
        return {
          ok: false,
          output: "// No Handlebars mapping on the canvas.\n",
          error: "No Handlebars mapping on the canvas.",
          warnings,
        };
      }
      const slotValues = evaluateSlotValues(model, handler, ctx, warnings, target?.skeleton ?? []);
      const output = renderHandlebars(template, ctx.data, { slots: slotValues });
      const outputValidation = validateConvertedOutput(output, target, {
        deserializeMode: options.openEhrJsonDeserializeMode,
      });
      return {
        ok: warnings.length === 0,
        output,
        warnings,
        outputValidation,
      };
    }

    if (mode === "go-template") {
      const code = options.generatedCode?.trim()
        ? options.generatedCode
        : generateGoTemplate(model, { blocklyState: options.blocklyState });
      if (!code.trim() || code.split("\n").every((line) => line.startsWith("{{- /*") || !line.trim())) {
        return {
          ok: false,
          output: "// No Go template code generated. Add XML blocks to the Blockly canvas.\n",
          error: "No Go template code generated.",
          warnings,
        };
      }
      if (!isGoTemplateWasmLoaded()) {
        return {
          ok: false,
          output: `// Go template WASM runtime is not loaded.\n// Generated script:\n${code}`,
          error: "Go template WASM runtime is not loaded.",
          warnings,
        };
      }
      const envelope = {
        Parameters: defaults,
        Data: ctx.data,
      };
      try {
        const output = executeGoTemplate(code, envelope, { sheets: options.sheets ?? [] });
        return { ok: true, output, warnings };
      } catch (e) {
        const output = `// Go template execution error: ${e instanceof Error ? e.message : String(e)}\n` +
          `// Generated script:\n${code}`;
        return { ok: false, output, error: e instanceof Error ? e.message : String(e), warnings };
      }
    }

    const slotValues = evaluateSlotValues(
      model,
      handler,
      ctx,
      warnings,
      target?.skeleton ?? [],
    );

    let output: unknown;
    if (target?.format === "free-form") {
      const canvasOutput = tryRunCanvasConversionScript(model, options, ctx, defaults);
      if (canvasOutput) {
        output = canvasOutput;
      } else {
        const template = options.handlebarsTemplate ?? target?.content ?? "";
        output = renderHandlebars(template, ctx.data, { slots: slotValues });
      }
    } else if (target) {
      // TakeCare / XSD canvases evaluate nested Code text the same way as
      // Handlebars Output mode. JSON Schema and openEHR stay on slot-fill.
      // Free-form Handlebars (no XML root) stays above.
      const xmlCanvas = target.format === "xml-schema"
        ? renderXmlCanvasFromBlockly(options.blocklyState, ctx)
        : null;
      output = xmlCanvas != null
        ? xmlCanvas
        : getTargetFormatHandler(target.format).render({
          definition: target,
          slotValues,
        });
    } else {
      output = {
        templateId: model.templateId,
        slots: slotValues,
      };
    }

    output = applyInstanceEncodingToPreview(output, model, target, warnings);
    const outputValidation = annotateUnmatchedCodedValues(
      validateConvertedOutput(output, target, {
        deserializeMode: options.openEhrJsonDeserializeMode,
      }),
      model,
      target?.skeleton,
      (expression, returnType) => handler.evaluate(expression, ctx, returnType),
    );
    return {
      ok: warnings.length === 0,
      output,
      warnings,
      outputValidation,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      warnings,
    };
  }
}

export function previewGeneratedCode(model: MappingModel): string {
  return generateTypeScript(model);
}

function applyInstanceEncodingToPreview(
  output: unknown,
  model: MappingModel,
  target: RunTestOptions["target"],
  warnings: string[],
): unknown {
  if (!target || target.format !== "openehr-template") return output;
  const encoding = preferredInstanceEncoding(model);
  if (encoding === "canonical-json") return output;
  try {
    const payload = serializeInstance(output, encoding, {
      prettyPrint: true,
      webTemplateJson: target.webTemplateJson,
    });
    return formatTestRunPayload(payload, encoding, false);
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e));
    return output;
  }
}

function tryRunCanvasConversionScript(
  model: MappingModel,
  options: RunTestOptions,
  ctx: SourceContext,
  defaults: Record<string, unknown>,
): unknown | null {
  if (!options.blocklyState) return null;
  const canvasExpr = canvasHandlebarsExpression(options.blocklyState);
  if (canvasExpr) {
    try {
      return serializedConversionOutput(evaluate(canvasExpr, ctx, "string"));
    } catch {
      // Fall through to generated TypeScript.
    }
  }
  const code = options.generatedCode?.trim()
    ? options.generatedCode
    : generate(model, "typescript", {
      blocklyState: options.blocklyState,
      skeleton: options.target?.skeleton,
      webTemplateJson: options.target?.webTemplateJson,
    });
  if (!code.trim() || !/\bhandlebars\s*\(/.test(code)) return null;
  try {
    const raw = runGeneratedTypeScript(
      code,
      { format: ctx.format, data: ctx.data },
      defaults,
      undefined,
      ctx.sheets,
    );
    return serializedConversionOutput(raw);
  } catch {
    return null;
  }
}

function evaluateSlotValues(
  model: MappingModel,
  handler: ReturnType<typeof getSourceFormatHandler>,
  ctx: SourceContext,
  warnings: string[],
  skeleton: TargetDefinition["skeleton"],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const handled = new Set<string>();
  if (skeleton.length && model.loops?.length && ctx.kind === "json") {
    for (const loop of model.loops) {
      evaluateLoopSlots(model, loop, handler, ctx, skeleton, values, handled, warnings);
    }
  }
  for (const slot of model.slots) {
    if (handled.has(slot.slotId)) continue;
    try {
      values[slot.slotId] = handler.evaluate(slot.expression, ctx, slot.returnType);
    } catch (e) {
      warnings.push(
        `${slot.slotId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return values;
}

function evaluateLoopSlots(
  model: MappingModel,
  loop: MappingLoop,
  handler: ReturnType<typeof getSourceFormatHandler>,
  ctx: SourceContext,
  skeleton: TargetDefinition["skeleton"],
  values: Record<string, unknown>,
  handled: Set<string>,
  warnings: string[],
): void {
  const trail = findSkeletonTrail(skeleton, loop.attachSlotId);
  const container = trail.at(-1);
  if (!container) return;
  const ids = new Set(collectAllSlotIds([container]));
  const nodes = collectJsonNodes(loop.path, ctx.json);
  for (const slot of model.slots) {
    if (!ids.has(slot.slotId) || !expressionUsesRelativeSourcePath(slot.expression)) {
      continue;
    }
    handled.add(slot.slotId);
    try {
      values[slot.slotId] = nodes.map((node) =>
        handler.evaluate(slot.expression, {
          ...ctx,
          json: node,
          data: node,
          vars: { ...(ctx.vars ?? {}), [loop.varName]: node },
          namedMaps: ctx.namedMaps,
        }, slot.returnType)
      );
    } catch (e) {
      warnings.push(
        `${slot.slotId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/**
 * A coded slot whose mapping produced no code, while a source string is not in
 * the template value set. The same message in preview and TypeScript (#320).
 */
function annotateUnmatchedCodedValues(
  validation: OutputValidation,
  model: MappingModel,
  skeleton: TargetDefinition["skeleton"] | undefined,
  evaluateExpr: (expression: string, returnType: string) => unknown,
): OutputValidation {
  if (!validation.applicable || !skeleton?.length) return validation;
  const extra = unmatchedCodedValueMessages(model, skeleton, evaluateExpr);
  if (!extra.length) return validation;
  const seen = new Set(validation.messages.map((message) => message.message));
  const messages = [...validation.messages];
  for (const message of extra) {
    if (seen.has(message.message)) continue;
    seen.add(message.message);
    messages.push(message);
  }
  return { ...validation, valid: false, messages };
}

function unmatchedCodedValueMessages(
  model: MappingModel,
  skeleton: NonNullable<TargetDefinition["skeleton"]>,
  evaluateExpr: (expression: string, returnType: string) => unknown,
): OutputValidationMessage[] {
  const nodes = new Map(collectValueSlots(skeleton).map((node) => [node.slotId, node]));
  const messages: OutputValidationMessage[] = [];
  for (const slot of model.slots) {
    const choices = nodes.get(slot.slotId)?.allowedValues;
    if (!choices?.length || !slot.expression?.includes("xpathString")) continue;
    let value: unknown;
    try {
      value = evaluateExpr(slot.expression, slot.returnType);
    } catch {
      continue;
    }
    if (codedCode(value)) continue;
    const sample = choices.slice(0, 8).map((choice) => choice.label ? `${choice.code} ${choice.label}` : choice.code)
      .join(", ");
    const more = choices.length > 8 ? ", …" : "";
    for (const text of sourceStrings(slot.expression, evaluateExpr)) {
      const key = text.toLowerCase();
      const known = choices.some((choice) =>
        choice.code.toLowerCase() === key || choice.label.trim().toLowerCase() === key
      );
      if (known) continue;
      messages.push({
        path: compactSlotId(slot.slotId),
        message: `value '${text}' is not in the value set: ${sample}${more}`,
        severity: "error",
      });
    }
  }
  return messages;
}

function codedCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.code_string === "string" && record.code_string.trim()) return record.code_string.trim();
  const nested = record.defining_code;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const code = (nested as Record<string, unknown>).code_string;
    if (typeof code === "string") return code.trim();
  }
  return "";
}

function sourceStrings(
  expression: string,
  evaluateExpr: (expression: string, returnType: string) => unknown,
): string[] {
  let ast: ExprAst;
  try {
    ast = parseExpression(expression);
  } catch {
    return [];
  }
  const found: string[] = [];
  const walk = (node: ExprAst) => {
    if (node.kind === "call") {
      if ((node.name === "xpathString" || node.name === "xpath") && node.args[0]?.kind === "literal") {
        const path = node.args[0].value;
        if (typeof path === "string") {
          try {
            const value = evaluateExpr(`xpathString(${JSON.stringify(path)})`, "string");
            if (typeof value === "string" && value.trim()) found.push(value.trim());
          } catch {
            // The path is not a string on this example.
          }
        }
      }
      for (const arg of node.args) walk(arg);
    } else if (node.kind === "binary") {
      walk(node.left);
      walk(node.right);
    }
  };
  walk(ast);
  return [...new Set(found)];
}
