/**
 * DATA_VALUE shell mouths → {@link RmShellFragment} for Mapping preview.
 * The primary attribute stays the slot expression; everything else plugged
 * into the shell (cogwheel fields and nested blocks) is recorded here.
 */
import type { Block } from "blockly/core";
import { attributesFor, primaryMappingAttribute } from "../core/rm_meta.ts";
import type { RmShellFragment } from "../types/mod.ts";
import { blockToExpression } from "./expression_serialize.ts";
import {
  dvAttributeNameFromInput,
  isRmValueObjectBlock,
} from "./blocks/rm_blocks.ts";

export function shellFragmentsFromValueBlock(
  shell: Block,
): Record<string, RmShellFragment> | undefined {
  const rmType = String(shell.getFieldValue("RM_TYPE") || "");
  const primary = primaryMappingAttribute(rmType)?.name ?? "";
  const fields: Record<string, RmShellFragment> = {};
  for (const input of shell.inputList) {
    const attr = dvAttributeNameFromInput(input.name);
    if (!attr || attr === primary) continue;
    const typeName = attributesFor(rmType).find((item) => item.name === attr)?.typeName ?? "";
    const frag = fragmentFromInput(shell, input.name, typeName);
    if (frag) fields[attr] = frag;
  }
  return Object.keys(fields).length ? fields : undefined;
}

function fragmentFromInput(
  block: Block,
  inputName: string,
  typeName: string,
): RmShellFragment | null {
  const child = block.getInputTargetBlock(inputName);
  if (!child || child.isShadow()) return null;
  if (typeName === "Array<Octet>" || typeName.startsWith("Array<Octet")) {
    if (child.type === "lists_create_with") return fragmentFromBlock(child);
    const expression = blockToExpression(child);
    return expression ? { kind: "octets", expression } : null;
  }
  if (typeName.startsWith("List<")) {
    if (child.type === "lists_create_with") return fragmentFromBlock(child);
    const one = fragmentFromBlock(child);
    return one ? { kind: "list", items: [one] } : null;
  }
  return fragmentFromBlock(child);
}

function fragmentFromBlock(block: Block | null): RmShellFragment | null {
  if (!block || block.isShadow()) return null;
  if (block.type === "lists_create_with") {
    const items: RmShellFragment[] = [];
    const count = Number((block as Block & { itemCount_?: number }).itemCount_ ?? 0);
    for (let i = 0; i < count; i++) {
      const child = fragmentFromBlock(block.getInputTargetBlock(`ADD${i}`));
      if (child) items.push(child);
    }
    return items.length ? { kind: "list", items } : null;
  }
  if (isRmValueObjectBlock(block)) {
    const rmType = String(block.getFieldValue("RM_TYPE") || block.type).toUpperCase();
    const fields: Record<string, RmShellFragment> = {};
    for (const input of block.inputList) {
      const attr = dvAttributeNameFromInput(input.name);
      if (!attr) continue;
      const typeName = attributesFor(rmType).find((item) => item.name === attr)?.typeName ?? "";
      const child = fragmentFromInput(block, input.name, typeName);
      if (child) fields[attr] = child;
    }
    return Object.keys(fields).length ? { kind: "object", rmType, fields } : null;
  }
  const expression = blockToExpression(block);
  return expression ? { kind: "expr", expression } : null;
}
