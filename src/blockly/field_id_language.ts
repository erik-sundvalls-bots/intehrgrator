/**
 * Id-language dropdown on the COMPOSITION root block (#289): which language
 * the target's Web Template ids (Simplified FLAT paths) come from. Options are
 * the target file's languages as ISO codes, lang.1 (primary) first and default.
 *
 * The value lives on the canvas, so Blockly undo/redo and project save cover it.
 */
import { Blockly } from "./blockly_core.ts";
import { FieldDropdownHug } from "./field_dropdown_hug.ts";
import { codesetLanguageName } from "../core/languages.ts";
import { PRIMARY_ID_LANGUAGE } from "../core/target/id_language.ts";

let choices: string[] = [];
let guard: ((from: string, to: string) => boolean) | null = null;

/** The current target's languages, lang.1 (primary) first. */
export function setIdLanguageChoices(languages: readonly string[]): void {
  choices = [...languages];
}

/** Asked before a user pick changes the value; false keeps the old one. */
export function setIdLanguageChangeGuard(
  fn: ((from: string, to: string) => boolean) | null,
): void {
  guard = fn;
}

function optionLabel(value: string): string {
  const code = value === PRIMARY_ID_LANGUAGE ? choices[0] : value;
  if (!code) return "lang.1";
  const name = codesetLanguageName(code);
  const text = name ? `${code} – ${name}` : code;
  return value === PRIMARY_ID_LANGUAGE ? `${text} · lang.1` : text;
}

export function idLanguageMenu(current?: string): Array<[string, string]> {
  const values = [PRIMARY_ID_LANGUAGE, ...choices.slice(1)];
  if (current && !values.includes(current)) values.push(current);
  return values.map((v) => [optionLabel(v), v]);
}

// deno-lint-ignore no-explicit-any
const Base = FieldDropdownHug as any;

export class FieldIdLanguage extends Base {
  constructor() {
    super(function (this: { getValue?: () => string }) {
      return idLanguageMenu(this?.getValue?.());
    });
  }

  /** Stored values stay even before the target's languages are known (load, headless). */
  doClassValidation_(newValue: unknown): string | null {
    return typeof newValue === "string" && newValue ? newValue : null;
  }

  doValueUpdate_(newValue: string): void {
    super.doValueUpdate_(newValue);
    this.selectedOption = [optionLabel(newValue), newValue];
  }

  onItemSelected_(menu: unknown, menuItem: { getValue(): string }): void {
    const from = String(this.getValue?.() ?? PRIMARY_ID_LANGUAGE);
    const to = menuItem.getValue();
    if (to !== from && guard && !guard(from, to)) return;
    super.onItemSelected_(menu, menuItem);
  }
}

export function idLanguageLabel(): string {
  return String(Blockly.Msg["INTEHR_ID_LANGUAGE"] ?? "Ids");
}

export function idLanguageTooltip(): string {
  return String(Blockly.Msg["INTEHR_ID_LANGUAGE_TOOLTIP"] ?? "");
}
