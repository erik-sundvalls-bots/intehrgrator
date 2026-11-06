/**
 * Evaluate a DATA_VALUE shell fragment (mappings, ranges, octet payloads)
 * into a plain object Mapping preview can merge onto the slot value.
 */
import type { RmShellFragment } from "../types/mod.ts";

/** Base64 text, or an existing byte list, as the `Array<Octet>` ehrtslib expects. */
export function octetBytes(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((item) => Number(item));
  const text = String(raw ?? "");
  if (!text) return [];
  try {
    return [...atob(text)].map((ch) => ch.charCodeAt(0));
  } catch {
    return [...text].map((ch) => ch.charCodeAt(0));
  }
}

/** Inline decoder for a generated TypeScript expression. One evaluation of `expr`. */
export function octetBytesCall(expr: string): string {
  return `((raw) => {
  if (Array.isArray(raw)) return raw.map((item) => Number(item));
  const text = String(raw ?? "");
  if (!text) return [];
  try {
    return [...atob(text)].map((ch) => ch.charCodeAt(0));
  } catch {
    return [...text].map((ch) => ch.charCodeAt(0));
  }
})(${expr})`;
}

export function evaluateShellFragment(
  fragment: RmShellFragment,
  evalExpr: (expression: string) => unknown,
): unknown {
  switch (fragment.kind) {
    case "expr":
      return evalExpr(fragment.expression);
    case "octets": {
      const bytes = octetBytes(evalExpr(fragment.expression));
      return bytes.length ? bytes : undefined;
    }
    case "list": {
      const items = fragment.items
        .map((item) => evaluateShellFragment(item, evalExpr))
        .filter((item) => item !== undefined && item !== null && item !== "");
      return items.length ? items : undefined;
    }
    case "object": {
      const out: Record<string, unknown> = { _type: fragment.rmType };
      let any = false;
      for (const [key, child] of Object.entries(fragment.fields)) {
        const value = evaluateShellFragment(child, evalExpr);
        if (value === undefined || value === null || value === "") continue;
        out[key] = value;
        any = true;
      }
      if (fragment.rmType === "CODE_PHRASE") {
        const term = out.terminology_id;
        if (typeof term === "string" || typeof term === "number") {
          out.terminology_id = { _type: "TERMINOLOGY_ID", value: String(term) };
        }
      }
      return any ? out : undefined;
    }
  }
}
