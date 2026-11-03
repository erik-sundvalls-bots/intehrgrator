/**
 * Best-effort Handlebars → Blockly path inventory.
 *
 * Free-form Kintegrate templates are not a full IR for Blockly: narrative text,
 * `#if` helpers, and `@index`/`@first` have no faithful block encoding today.
 * This converter extracts source paths (`{{path}}`, `{{#with}}`, `{{#each}}`)
 * into `source_query` / `for_each_list` blocks so they can be reviewed in the
 * Mapping Spec and reused for Click-to-Map style authoring.
 */

export interface HandlebarsPathRef {
  path: string;
  kind: "value" | "with" | "each";
}

export interface HandlebarsToBlocklyOptions {
  /** Vertical spacing between top-level blocks. */
  yStep?: number;
}

/** Extract Handlebars path references from a template (comments stripped). */
export function extractHandlebarsPaths(template: string): HandlebarsPathRef[] {
  const withoutComments = template.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
  const found: HandlebarsPathRef[] = [];
  const seen = new Set<string>();

  const push = (kind: HandlebarsPathRef["kind"], raw: string) => {
    const path = normalizeHandlebarsPath(raw);
    if (!path || path === "." || path.startsWith("@")) return;
    const key = `${kind}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, path });
  };

  for (const match of withoutComments.matchAll(/\{\{~?#(with|each)\s+([^}]+)\}\}/g)) {
    push(match[1] === "each" ? "each" : "with", match[2]!.trim());
  }
  for (const match of withoutComments.matchAll(/\{\{~?(?!#|\/|else|!--)([^}]+)\}\}/g)) {
    const body = match[1]!.trim();
    if (body.startsWith("#") || body.startsWith("/") || body.startsWith("else")) continue;
    // Skip helper calls like (gte x 70) / and ...
    if (body.startsWith("(") || /^(eq|ne|lt|gt|lte|gte|inc|dec|and|or|toLowerCase|toUpperCase|slot|json)\b/
      .test(body)) {
      continue;
    }
    push("value", body);
  }
  return found;
}

/**
 * Build a Blockly workspace JSON with one block per extracted path.
 * Not a round-trip of the narrative template — a path inventory for Spec/Blockly.
 */
export function handlebarsTemplateToBlocklyState(
  template: string,
  options: HandlebarsToBlocklyOptions = {},
): Record<string, unknown> {
  const yStep = options.yStep ?? 48;
  const refs = extractHandlebarsPaths(template);
  const blocks = refs.map((ref, index) => {
    if (ref.kind === "each") {
      return {
        type: "for_each_list",
        id: `hbs_each_${index}`,
        x: 20,
        y: 20 + index * yStep,
        fields: {
          VAR: "item",
        },
        inputs: {
          LIST: {
            block: {
              type: "source_query_node",
              id: `hbs_each_${index}_src`,
              fields: { EXPRESSION: toFontoxpathHint(ref.path) },
            },
          },
        },
      };
    }
    return {
      type: "source_query",
      id: `hbs_path_${index}`,
      x: 20,
      y: 20 + index * yStep,
      fields: {
        EXPRESSION: toFontoxpathHint(ref.path),
        RETURN_TYPE: "string",
      },
    };
  });
  return {
    blocks: {
      languageVersion: 0,
      blocks,
    },
  };
}

/** Normalize Handlebars path tokens toward a JSON/fontoxpath-friendly hint. */
export function normalizeHandlebarsPath(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

/**
 * Convert a Handlebars-ish path into a `$…` JSON path hint for source_query.
 * Bracketed FLAT keys and numeric segments are preserved.
 */
export function toFontoxpathHint(handlebarsPath: string): string {
  const path = normalizeHandlebarsPath(handlebarsPath);
  if (!path || path === ".") return "$";
  if (path.startsWith("$")) return path;

  const segments: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      continue;
    }
    if (path[i] === "[") {
      const close = path.indexOf("]", i + 1);
      if (close < 0) break;
      const inner = path.slice(i + 1, close);
      segments.push(inner);
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < path.length && path[end] !== "." && path[end] !== "[") end++;
    segments.push(path.slice(i, end));
    i = end;
  }

  let out = "$";
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      // Handlebars examples mix 0-based and [0]; fontoxpath JSON arrays are 1-based.
      out += `[${Number(segment) + 1}]`;
    } else if (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(segment)) {
      out += `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}
