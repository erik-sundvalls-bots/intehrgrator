/**
 * Strip RANDOM dropdown options from stock Blockly blocks that #35 kept.
 *
 * `math_random_int` / `math_random_float` were already removed from the
 * toolbox (#35, c4ac7d9) and listed in VMS_REMOVED_BLOCK_TYPES. The kept
 * blocks (`text_charAt`, `text_getSubstring`, `lists_getIndex`,
 * `lists_getSublist`, `math_on_list`) still shipped Blockly's RANDOM
 * modes ("letter at random", "random item of a list", …). Those modes
 * break determinism and must not be offered for new mappings.
 *
 * An old workspace that still has WHERE/OP = RANDOM keeps the option
 * visible so the value is not silently rewritten, and the workspace
 * linter plus codegen report a clear error.
 */
import type { Block } from "blockly/core";
import { Blockly } from "./blockly_core.ts";

const RANDOM_DROPDOWN_FIELDS: Record<string, readonly string[]> = {
  text_charAt: ["WHERE"],
  text_getSubstring: ["WHERE1", "WHERE2"],
  lists_getIndex: ["WHERE"],
  lists_getSublist: ["WHERE1", "WHERE2"],
  math_on_list: ["OP"],
};

type MenuOption = [string, string] | unknown;
type MenuGenerator = MenuOption[] | ((this: unknown) => MenuOption[]);

interface DropdownField {
  getValue(): string;
  getOptions?: (useCache?: boolean) => MenuOption[];
  menuGenerator_?: MenuGenerator;
  doClassValidation_?: (newValue?: string) => string | null | undefined;
}

function withoutRandomUnlessCurrent(options: MenuOption[], current: string): MenuOption[] {
  return options.filter((opt) => {
    if (!Array.isArray(opt) || opt.length < 2) return true;
    return String(opt[1]) !== "RANDOM" || current === "RANDOM";
  });
}

function patchDropdown(block: Block, fieldName: string): void {
  const field = block.getField(fieldName) as unknown as DropdownField | null;
  if (!field || field.menuGenerator_ === undefined) return;
  if ((field as { __igNoRandom?: boolean }).__igNoRandom) return;
  const original = field.menuGenerator_;
  const generate = function (this: unknown): MenuOption[] {
    const raw = typeof original === "function" ? original.call(this) : original;
    const list = Array.isArray(raw) ? raw : [];
    return withoutRandomUnlessCurrent(list, field.getValue());
  };
  field.menuGenerator_ = generate;
  const origValidate = field.doClassValidation_?.bind(field);
  if (origValidate) {
    field.doClassValidation_ = (newValue?: string) => {
      if (newValue === "RANDOM") return "RANDOM";
      return origValidate(newValue);
    };
  }
  (field as { __igNoRandom?: boolean }).__igNoRandom = true;
}

/** Patch stock Blockly block inits so new blocks have no RANDOM dropdown option. */
export function stripRandomDropdowns(): void {
  for (const [type, fields] of Object.entries(RANDOM_DROPDOWN_FIELDS)) {
    const def = Blockly.Blocks[type] as { init?: (this: Block) => void } | undefined;
    if (!def?.init) continue;
    if ((def as { __igNoRandom?: boolean }).__igNoRandom) continue;
    const original = def.init;
    def.init = function (this: Block) {
      original.call(this);
      for (const name of fields) patchDropdown(this, name);
    };
    (def as { __igNoRandom?: boolean }).__igNoRandom = true;
  }
}

export function isRandomDropdownValue(value: unknown): boolean {
  return String(value ?? "") === "RANDOM";
}

/** Field names that stock Blockly uses for a RANDOM position or operator. */
export function randomDropdownFieldNames(blockType: string): readonly string[] {
  return RANDOM_DROPDOWN_FIELDS[blockType] ?? [];
}

export const RANDOM_BLOCK_TYPES = [
  "math_random_int",
  "math_random_float",
  "colour_random",
] as const;
