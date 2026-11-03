/**
 * VMS-Hbs / VMS-Mustache checkers (ADR 0009).
 * Soft gate for editors; convert uses the same whitelist via knownHelpersOnly.
 */
import Handlebars from "handlebars";

export interface TemplateDiagnostic {
  message: string;
  /** 0-based character offset when known. */
  from?: number;
  to?: number;
  severity?: "warning" | "error";
}

export interface TemplateCheckResult {
  ok: boolean;
  diagnostics: TemplateDiagnostic[];
}

/** Closed Kintegrate helper set for VMS-Hbs (ADR 0009). */
export const VMS_HBS_HELPERS = [
  "if",
  "unless",
  "each",
  "with", // listed only so we can reject it explicitly with a clear message
  "lookup",
  "log",
  "eq",
  "ne",
  "lt",
  "gt",
  "lte",
  "gte",
  "inc",
  "dec",
  "and",
  "or",
  "toLowerCase",
  "toUpperCase",
  "slot",
] as const;

/** Helpers allowed in VMS-Hbs (knownHelpersOnly). */
export const VMS_HBS_ALLOWED_HELPERS: Readonly<Record<string, boolean>> = {
  if: true,
  unless: true,
  each: true,
  eq: true,
  ne: true,
  lt: true,
  gt: true,
  lte: true,
  gte: true,
  inc: true,
  dec: true,
  and: true,
  or: true,
  toLowerCase: true,
  toUpperCase: true,
  slot: true,
};

const FORBIDDEN_BLOCK_HELPERS = new Set(["with", "log"]);
const FORBIDDEN_INLINE_HELPERS = new Set(["lookup", "log", "with"]);

type Loc = { start?: { line: number; column: number }; end?: { line: number; column: number } };

function locOffsets(
  source: string,
  loc: Loc | undefined,
): { from?: number; to?: number } {
  if (!loc?.start) return {};
  const from = offsetOf(source, loc.start.line, loc.start.column);
  const to = loc.end ? offsetOf(source, loc.end.line, loc.end.column) : from;
  return { from, to };
}

function offsetOf(source: string, line: number, column: number): number {
  let pos = 0;
  for (let i = 1; i < line; i++) {
    const next = source.indexOf("\n", pos);
    if (next < 0) return source.length;
    pos = next + 1;
  }
  return Math.min(source.length, pos + column);
}

function helperName(node: { path?: { original?: string; parts?: string[] } }): string {
  const original = node.path?.original;
  if (original) return original;
  const parts = node.path?.parts;
  return parts?.length ? String(parts[0]) : "";
}

/** Soft-check a Handlebars template against VMS-Hbs. */
export function checkVmsHbs(source: string): TemplateCheckResult {
  const diagnostics: TemplateDiagnostic[] = [];
  let ast: unknown;
  try {
    ast = Handlebars.parse(source);
  } catch (err) {
    diagnostics.push({
      message: `Handlebars parse error: ${err instanceof Error ? err.message : String(err)}`,
      severity: "warning",
    });
    return { ok: false, diagnostics };
  }

  const Visitor = Handlebars.Visitor;
  class Checker extends Visitor {
    override MustacheStatement(node: {
      escaped?: boolean;
      params?: unknown[];
      path?: { original?: string; parts?: string[] };
      loc?: Loc;
    }) {
      if (node.escaped === false) {
        diagnostics.push({
          message: "VMS-Hbs forbids unescaped mustaches ({{{…}}} / {{&}})",
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      }
      const name = helperName(node);
      const hasParams = (node.params?.length ?? 0) > 0;
      if (hasParams || FORBIDDEN_INLINE_HELPERS.has(name)) {
        if (!VMS_HBS_ALLOWED_HELPERS[name] || FORBIDDEN_INLINE_HELPERS.has(name)) {
          diagnostics.push({
            message: `VMS-Hbs forbids helper "${name}" (unverified / not in declarative export)`,
            ...locOffsets(source, node.loc),
            severity: "warning",
          });
        }
      }
      super.MustacheStatement(node);
    }

    override BlockStatement(node: {
      params?: unknown[];
      path?: { original?: string; parts?: string[] };
      loc?: Loc;
    }) {
      const name = helperName(node);
      if (FORBIDDEN_BLOCK_HELPERS.has(name)) {
        diagnostics.push({
          message: `VMS-Hbs forbids block helper "{{#${name}}}" (unverified / not in declarative export)`,
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      } else if (
        (name === "if" || name === "unless" || name === "each") ||
        (node.params?.length ?? 0) > 0
      ) {
        // Named block helper or helper-like section with params.
        if (name === "if" || name === "unless" || name === "each") {
          // allowed
        } else if (!VMS_HBS_ALLOWED_HELPERS[name]) {
          // Mustache-style {{#path}} with no helper name — OK when params empty.
          if ((node.params?.length ?? 0) > 0) {
            diagnostics.push({
              message: `VMS-Hbs forbids helper "{{#${name}}}" (unverified / not in declarative export)`,
              ...locOffsets(source, node.loc),
              severity: "warning",
            });
          }
        }
      }
      super.BlockStatement(node);
    }

    override SubExpression(node: {
      params?: unknown[];
      path?: { original?: string; parts?: string[] };
      loc?: Loc;
    }) {
      const name = helperName(node);
      if (!VMS_HBS_ALLOWED_HELPERS[name] || FORBIDDEN_INLINE_HELPERS.has(name)) {
        diagnostics.push({
          message: `VMS-Hbs forbids helper "${name}" (unverified / not in declarative export)`,
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      }
      super.SubExpression(node);
    }

    override PartialStatement(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Hbs forbids partials (unverified / not in declarative export)",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.PartialStatement(node);
    }

    override PartialBlockStatement(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Hbs forbids partial blocks (unverified / not in declarative export)",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.PartialBlockStatement(node);
    }

    override Decorator(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Hbs forbids decorators (unverified / not in declarative export)",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.Decorator?.(node);
    }

    override DecoratorBlock(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Hbs forbids decorator blocks (unverified / not in declarative export)",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.DecoratorBlock?.(node);
    }
  }

  new Checker().accept(ast);
  return { ok: diagnostics.length === 0, diagnostics };
}

export function isVmsHbs(source: string): boolean {
  return checkVmsHbs(source).ok;
}

/**
 * Stricter profile for decision-table snippet cells (ADR 0009).
 * Interpolation + sections/inverted + comments only — no helpers.
 */
export function checkVmsMustache(source: string): TemplateCheckResult {
  const diagnostics: TemplateDiagnostic[] = [];
  let ast: unknown;
  try {
    ast = Handlebars.parse(source);
  } catch (err) {
    diagnostics.push({
      message: `Mustache parse error: ${err instanceof Error ? err.message : String(err)}`,
      severity: "warning",
    });
    return { ok: false, diagnostics };
  }

  const Visitor = Handlebars.Visitor;
  class Checker extends Visitor {
    override MustacheStatement(node: {
      escaped?: boolean;
      params?: unknown[];
      loc?: Loc;
    }) {
      if (node.escaped === false) {
        diagnostics.push({
          message: "VMS-Mustache forbids unescaped mustaches",
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      }
      if ((node.params?.length ?? 0) > 0) {
        diagnostics.push({
          message: "VMS-Mustache forbids helpers (use decision-table rows for branching)",
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      }
      super.MustacheStatement(node);
    }

    override BlockStatement(node: {
      params?: unknown[];
      path?: { original?: string; parts?: string[] };
      loc?: Loc;
    }) {
      if ((node.params?.length ?? 0) > 0) {
        diagnostics.push({
          message:
            `VMS-Mustache forbids helpers like "{{#${helperName(node)}}}" (interpolation + sections only)`,
          ...locOffsets(source, node.loc),
          severity: "warning",
        });
      }
      super.BlockStatement(node);
    }

    override SubExpression(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Mustache forbids subexpressions / helpers",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.SubExpression(node);
    }

    override PartialStatement(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Mustache forbids partials",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.PartialStatement(node);
    }

    override PartialBlockStatement(node: { loc?: Loc }) {
      diagnostics.push({
        message: "VMS-Mustache forbids partial blocks",
        ...locOffsets(source, node.loc),
        severity: "warning",
      });
      super.PartialBlockStatement(node);
    }
  }

  new Checker().accept(ast);
  return { ok: diagnostics.length === 0, diagnostics };
}

export function isVmsMustache(source: string): boolean {
  return checkVmsMustache(source).ok;
}
