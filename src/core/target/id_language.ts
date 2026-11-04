/**
 * Id language of a target file (#289): which language the Web Template ids,
 * and so the Simplified FLAT paths, are taken from.
 *
 * - `"primary"` (default): the template's primary language, lang.1. For OPT 1.4
 *   that is the top-level `<language>` chosen at export, which ehrtslib
 *   exposes as `original_language`; so it only differs from another choice
 *   for multilingual OPTs and ADL2 `.t.json` input.
 * - An ISO code: ids from that language's terms.
 *
 * Mapping slot ids are archetype paths (at-codes), so they never depend on
 * this choice; only the FLAT output paths do.
 */
import { parseTemplateInput } from "ehrtslib/parser/mod.ts";
import { buildWebTemplate } from "ehrtslib/serialization/simplified/web_template_builder.ts";
import { operationalFromFileset } from "../clinical_model/github_template.ts";
import { availableOptLanguages } from "../skeleton/template_terms.ts";
import { normalizeLangCode, targetOriginalLanguage } from "../languages.ts";
import type { TargetDefinition } from "./format_handler.ts";

export const PRIMARY_ID_LANGUAGE = "primary";

/** Blockly field on the COMPOSITION root block that holds the choice. */
export const ID_LANGUAGE_FIELD = "ID_LANGUAGE";

// deno-lint-ignore no-explicit-any
type AmObject = any;

let cached: { key: string | NonNullable<TargetDefinition["fileset"]>; opt: AmObject } | null = null;

/** The OPERATIONAL_TEMPLATE behind a target, when ids can be rebuilt (not for Web Template JSON input). */
function operationalOf(target: TargetDefinition): AmObject | undefined {
  const fileset = target.fileset?.files.some((f) => /\.t\.json$/i.test(f.path))
    ? target.fileset
    : undefined;
  if (!fileset && !target.content.trimStart().startsWith("<")) return undefined;
  // A local dependency can change without changing the root path or file count.
  const key = fileset ?? target.content;
  if (cached?.key === key) return cached.opt;
  try {
    const opt = fileset
      ? operationalFromFileset(fileset)
      : parseTemplateInput(target.content).operationalTemplate;
    if (!(opt as AmObject)?.definition) return undefined;
    cached = { key, opt };
    return opt;
  } catch {
    return undefined;
  }
}

/** `"primary"` for blank or the primary code itself, else the normalized code. */
export function normalizeIdLanguage(
  value: string | undefined,
  primary?: string,
): string {
  const code = normalizeLangCode(value ?? "");
  if (
    !code || code === PRIMARY_ID_LANGUAGE ||
    (primary && code === normalizeLangCode(primary))
  ) {
    return PRIMARY_ID_LANGUAGE;
  }
  return code;
}

/**
 * Languages the id-language dropdown offers: lang.1 (primary) first, then the
 * file's other languages. Only the primary one when ids cannot be rebuilt.
 */
export function idLanguageChoices(target: TargetDefinition | null): string[] {
  if (!target || target.format !== "openehr-template") return [];
  const primary = targetOriginalLanguage(target) ?? target.languages?.[0] ??
    target.language;
  const opt = operationalOf(target);
  const all = opt ? availableOptLanguages(opt) : [];
  const list = [primary, ...all].filter((l): l is string => Boolean(l)).map(
    normalizeLangCode,
  );
  return [...new Set(list)];
}

function copyIds(into: AmObject, from: AmObject): void {
  if (!into || !from || typeof into !== "object") return;
  if (typeof from.id === "string") into.id = from.id;
  const a = Array.isArray(into.children) ? into.children : [];
  const b = Array.isArray(from.children) ? from.children : [];
  if (a.length !== b.length) return;
  a.forEach((child: AmObject, i: number) => copyIds(child, b[i]));
}

/**
 * The target's Web Template JSON with ids in `idLanguage`; labels and every
 * other field stay as they are. Undefined when ids cannot be rebuilt.
 */
export function webTemplateWithIdLanguage(
  target: TargetDefinition,
  idLanguage: string,
): string | undefined {
  if (!target.webTemplateJson) return undefined;
  const opt = operationalOf(target);
  if (!opt) return undefined;
  const choices = idLanguageChoices(target);
  const primary = choices[0];
  const want = normalizeIdLanguage(idLanguage, primary);
  const others = choices.filter((l) => l !== want);
  try {
    const ids = want === PRIMARY_ID_LANGUAGE
      ? buildWebTemplate(opt, { languages: choices, idLanguage: "original" })
      : buildWebTemplate(opt, {
        languages: [want, ...others],
        idLanguage: "primary",
      });
    const base = JSON.parse(target.webTemplateJson);
    copyIds(base.tree, (ids as AmObject).tree);
    return JSON.stringify(base);
  } catch {
    return undefined;
  }
}

/** The id language chosen on the first COMPOSITION root of a Blockly JSON state. */
export function idLanguageFromBlocklyState(state: unknown): string | undefined {
  const top =
    (state as { blocks?: { blocks?: unknown[] } } | null)?.blocks?.blocks ?? [];
  const stack: unknown[] = [...top];
  while (stack.length) {
    const block = stack.shift() as {
      type?: string;
      fields?: Record<string, unknown>;
      next?: { block?: unknown };
    } | undefined;
    if (!block) continue;
    if (block.type === "composition") {
      const value = block.fields?.[ID_LANGUAGE_FIELD];
      return typeof value === "string" && value ? value : undefined;
    }
    if (block.next?.block) stack.push(block.next.block);
    for (
      const input of Object.values(
        (block as { inputs?: Record<string, { block?: unknown }> }).inputs ??
          {},
      )
    ) {
      if (input?.block) stack.push(input.block);
    }
  }
  return undefined;
}
