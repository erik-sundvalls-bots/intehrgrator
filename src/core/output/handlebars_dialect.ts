import Handlebars from "handlebars";
import { registerKintegrateHandlebarsHelpers } from "../codegen/helpers/handlebars.ts";
import { VMS_HBS_ALLOWED_HELPERS } from "./vms_hbs.ts";

export interface HandlebarsRenderOptions {
  strict?: boolean;
  slots?: Readonly<Record<string, unknown>>;
  /** When true (default), reject helpers outside VMS-Hbs (ADR 0009). */
  knownHelpersOnly?: boolean;
}

/** Kintegrate-compatible Handlebars runtime, isolated from global registrations. */
export function createKintegrateHandlebars(): typeof Handlebars {
  const engine = Handlebars.create();
  registerKintegrateHandlebarsHelpers(engine);
  return engine;
}

export function renderHandlebars(
  templateSource: string,
  source: unknown,
  options: HandlebarsRenderOptions = {},
): string {
  const engine = createKintegrateHandlebars();
  const root = isRecord(source)
    ? { ...source, _slots: options.slots ?? {} }
    : { value: source, _slots: options.slots ?? {} };
  const knownHelpersOnly = options.knownHelpersOnly ?? true;
  const template = engine.compile(templateSource, {
    strict: options.strict ?? false,
    noEscape: true,
    data: true,
    preventIndent: false,
    knownHelpers: VMS_HBS_ALLOWED_HELPERS,
    knownHelpersOnly,
  });
  return template(root, {
    allowProtoMethodsByDefault: false,
    allowProtoPropertiesByDefault: false,
  });
}

export function precompileHandlebars(templateSource: string): string {
  return String(createKintegrateHandlebars().precompile(templateSource, {
    noEscape: true,
    data: true,
  }));
}

/** Convert the Source Pane's JSON authoring path to Kintegrate Handlebars syntax. */
export function buildHandlebarsPath(sourcePath: string): string {
  return parseSourcePath(sourcePath)
    .map((segment) => {
      if (typeof segment === "number") {
        // Source Pane XPath-style array positions are one-based; Handlebars is zero-based.
        return `[${Math.max(0, segment - 1)}]`;
      }
      return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(segment)
        ? segment
        : `[${segment.replace(/\\/g, "\\\\").replace(/]/g, "\\]")}]`;
    })
    .join(".");
}

/** Generate a nested #with/#each snippet for a selected Source Pane path. */
export function buildHandlebarsTree(sourcePath: string): string {
  const segments = parseSourcePath(sourcePath);
  if (!segments.length) return "{{.}}";
  const lines: string[] = [];
  const closes: string[] = [];
  let indent = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const next = segments[i + 1];
    if (typeof segment === "number") continue;
    const path = buildHandlebarsPathSegment(segment);
    if (typeof next === "number") {
      lines.push(`${indent}{{#each ${path}}}`);
      closes.unshift(`${indent}{{/each}}`);
      indent += "  ";
      i++;
    } else if (i < segments.length - 1) {
      lines.push(`${indent}{{#with ${path}}}`);
      closes.unshift(`${indent}{{/with}}`);
      indent += "  ";
    } else {
      lines.push(`${indent}{{${path}}}`);
    }
  }
  return [...lines, ...closes].join("\n");
}

function parseSourcePath(sourcePath: string): Array<string | number> {
  const source = sourcePath.trim().replace(/^\$/, "");
  const out: Array<string | number> = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "." || source[i] === "/") {
      i++;
      continue;
    }
    if (source[i] === "[") {
      const close = source.indexOf("]", i + 1);
      if (close < 0) break;
      const token = source.slice(i + 1, close);
      if (/^\d+$/.test(token)) out.push(Number(token));
      else if (token.startsWith('"') && token.endsWith('"')) out.push(JSON.parse(token));
      else out.push(token.replace(/^['"]|['"]$/g, ""));
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < source.length && !".[/".includes(source[end]!)) end++;
    out.push(source.slice(i, end));
    i = end;
  }
  return out;
}

function buildHandlebarsPathSegment(segment: string): string {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(segment)
    ? segment
    : `[${segment.replace(/\\/g, "\\\\").replace(/]/g, "\\]")}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
