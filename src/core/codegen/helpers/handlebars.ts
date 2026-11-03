/**
 * Kintegrate Handlebars helpers (VMS-Hbs).
 *
 * Generated `.hbs` files do not paste these functions. Mapping preview,
 * Handlebars output, the Go Template host callback, the XQuery
 * `intehrgrator:handlebars` function, and generated TypeScript (`igHandlebars`)
 * all register this same set. Java registers the same names in
 * `HandlebarsSupport.java`.
 *
 * `inc` / `dec` match Kintegrate Integration Builder: `(v) => v + 1` and
 * `(v) => v - 1`. `{{inc @index}}` is the 1-based row number inside `#each`.
 * `+` follows JavaScript (a string concatenates); `-` is numeric.
 *
 * This module has no package imports so generated TypeScript can load it from
 * the raw GitHub URL.
 */

export interface KintegrateHandlebarsOptions {
  data?: { root?: { _slots?: Record<string, unknown> } };
}

/** `(v) => v + 1` — JavaScript `+`, so a string concatenates. */
export function hbsInc(value: unknown): unknown {
  return (value as number) + 1;
}

/** `(v) => v - 1` — JavaScript numeric `-`. */
export function hbsDec(value: unknown): unknown {
  return (value as number) - 1;
}

export const kintegrateHandlebarsHelpers = {
  eq: (left: unknown, right: unknown) => left === right,
  ne: (left: unknown, right: unknown) => left !== right,
  lt: (left: unknown, right: unknown) => Number(left) < Number(right),
  gt: (left: unknown, right: unknown) => Number(left) > Number(right),
  lte: (left: unknown, right: unknown) => Number(left) <= Number(right),
  gte: (left: unknown, right: unknown) => Number(left) >= Number(right),
  and: (...args: unknown[]) => args.slice(0, -1).every(Boolean),
  or: (...args: unknown[]) => args.slice(0, -1).some(Boolean),
  inc: hbsInc,
  dec: hbsDec,
  toLowerCase: (value: unknown) => value == null ? value : String(value).toLowerCase(),
  toUpperCase: (value: unknown) => value == null ? value : String(value).toUpperCase(),
  slot(this: unknown, slotId: unknown, options: KintegrateHandlebarsOptions) {
    return options.data?.root?._slots?.[String(slotId)];
  },
};

export function registerKintegrateHandlebarsHelpers(
  engine: { registerHelper: (helpers: typeof kintegrateHandlebarsHelpers) => void },
): void {
  engine.registerHelper(kintegrateHandlebarsHelpers);
}
