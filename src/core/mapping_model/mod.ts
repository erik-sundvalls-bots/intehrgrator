import type { MappingModel, MappingSlot, OptionalRmInsertion, SkeletonNode } from "../../types/mod.ts";
import { MODEL_VERSION } from "../../types/mod.ts";
import { slotReturnType, collectValueSlots, findSkeletonTrail } from "../skeleton/generate_skeleton.ts";
import { validateExpressionSource } from "../expression/mod.ts";
import { parseCardinality } from "../cardinality.ts";

export interface BlockWorkspaceSlot {
  slotId: string;
  rmType: string;
  expression: string;
  label?: string;
  mandatory?: boolean;
}

export interface BlockWorkspaceState {
  templateId: string;
  slots: BlockWorkspaceSlot[];
  optionalRm: OptionalRmInsertion[];
}

export function createEmptyModel(templateId: string): MappingModel {
  return {
    modelVersion: MODEL_VERSION,
    templateId,
    slots: [],
    optionalRm: [],
    loops: [],
  };
}

export function modelFromWorkspace(state: BlockWorkspaceState): MappingModel {
  return {
    modelVersion: MODEL_VERSION,
    templateId: state.templateId,
    slots: state.slots.map((s) => ({
      slotId: s.slotId,
      rmType: s.rmType,
      expression: s.expression,
      returnType: slotReturnType({ rmType: s.rmType } as SkeletonNode),
      label: s.label,
      mandatory: s.mandatory,
    })),
    optionalRm: [...state.optionalRm],
  };
}

export function workspaceFromModel(model: MappingModel): BlockWorkspaceState {
  return {
    templateId: model.templateId,
    slots: model.slots.map((s) => ({
      slotId: s.slotId,
      rmType: s.rmType,
      expression: s.expression,
      label: s.label,
      mandatory: s.mandatory,
    })),
    optionalRm: [...model.optionalRm],
  };
}

export interface ValidationIssue {
  slotId?: string;
  message: string;
  severity: "error" | "warning";
}

export function validateModel(
  model: MappingModel,
  skeleton: SkeletonNode[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const valueSlots = collectValueSlots(skeleton);
  const mapped = new Map(model.slots.map((s) => [s.slotId, s]));

  for (const slot of valueSlots) {
    if (!slot.mandatory) continue;
    const mappedSlot = mapped.get(slot.slotId);
    if (!mappedSlot?.expression?.trim()) {
      issues.push({
        slotId: slot.slotId,
        message: `Mandatory slot unmapped: ${slot.label}`,
        severity: "warning",
      });
    }
  }

  for (const s of model.slots) {
    const err = validateExpressionSource(s.expression);
    if (err) {
      issues.push({ slotId: s.slotId, message: err, severity: "error" });
    }
  }

  for (const inc of model.includes ?? []) {
    if (!inc.when.trim()) {
      issues.push({
        slotId: inc.slotId,
        message: "Include when needs a boolean condition",
        severity: "error",
      });
      continue;
    }
    const err = validateExpressionSource(inc.when);
    if (err) issues.push({ slotId: inc.slotId, message: err, severity: "error" });
    if (/\bhandlebars\s*\(/.test(inc.when)) {
      issues.push({
        slotId: inc.slotId,
        message: "Include when condition uses an escape block",
        severity: "warning",
      });
    }
    const node = findSkeletonTrail(skeleton, inc.slotId).at(-1);
    const min = node ? occurrenceMin(node) : 0;
    if (node && min > 0 && !inc.elseEmits) {
      issues.push({
        slotId: inc.slotId,
        message:
          `Include when wraps a required target node (${node.label}); template minimum is ${min}. An else branch must emit the same node.`,
        severity: "warning",
      });
    }
  }

  return issues;
}

function occurrenceMin(node: SkeletonNode): number {
  const raw = node.multiplicity || node.slotCardinality || node.effectiveCardinality;
  const parsed = parseCardinality(raw);
  if (parsed) return parsed.min;
  return node.mandatory ? 1 : 0;
}

export {
  upsertLoop,
  promoteIndexedSourcePath,
  relativePathFromLoop,
  isRelativeAuthoringPath,
  expressionUsesRelativeSourcePath,
} from "./loops.ts";

export function applyExpressionEdit(
  model: MappingModel,
  slotId: string,
  expression: string,
  meta?: Pick<MappingSlot, "rmType" | "returnType" | "label" | "mandatory">,
): MappingModel {
  const err = validateExpressionSource(expression);
  if (err) throw new Error(err);

  const slots = [...model.slots];
  const idx = slots.findIndex((s) => s.slotId === slotId);
  const entry: MappingSlot = {
    slotId,
    rmType: meta?.rmType ?? slots[idx]?.rmType ?? "DV_TEXT",
    expression,
    returnType: meta?.returnType ?? slots[idx]?.returnType ?? "string",
    label: meta?.label ?? slots[idx]?.label,
    mandatory: meta?.mandatory ?? slots[idx]?.mandatory,
  };

  if (idx >= 0) slots[idx] = entry;
  else slots.push(entry);

  return { ...model, slots };
}

export function countUnmappedMandatory(
  model: MappingModel,
  skeleton: SkeletonNode[],
): number {
  return validateModel(model, skeleton).filter(
    (i) => i.severity === "warning" && i.slotId,
  ).length;
}
