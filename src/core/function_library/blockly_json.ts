/** Walk Blockly workspace / block JSON without loading a live workspace. */

export interface BlocklyBlockJson {
  type?: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  extraState?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }>;
  next?: { block?: BlocklyBlockJson };
}

export interface BlocklyWorkspaceJson {
  blocks?: { languageVersion?: number; blocks?: BlocklyBlockJson[] };
  variables?: Array<{ name?: string; id?: string; type?: string }>;
}

const GRID_NAME_TYPES = new Set([
  "decision_table",
  "sheet_lookup",
  "sheet_get_cell",
  "sheet_get_xy",
  "sheet_get_row",
  "sheet_get_column",
  "sheet_get_header",
  "sheet_get_data",
]);

export function asWorkspaceJson(state: unknown): BlocklyWorkspaceJson {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return state as BlocklyWorkspaceJson;
}

export function topBlocks(state: unknown): BlocklyBlockJson[] {
  const blocks = asWorkspaceJson(state).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

export function walkBlock(
  block: BlocklyBlockJson | undefined,
  visit: (block: BlocklyBlockJson) => void,
): void {
  if (!block) return;
  visit(block);
  for (const input of Object.values(block.inputs ?? {})) {
    walkBlock(input?.block, visit);
    walkBlock(input?.shadow, visit);
  }
  walkBlock(block.next?.block, visit);
}

export function walkWorkspace(
  state: unknown,
  visit: (block: BlocklyBlockJson) => void,
): void {
  for (const block of topBlocks(state)) walkBlock(block, visit);
}

/** Blockly Functions drawer definitions (not `procedures_ifreturn`, which lives inside a body). */
export const PROCEDURE_DEF_TYPES = ["procedures_defreturn", "procedures_defnoreturn"] as const;
export type ProcedureDefType = (typeof PROCEDURE_DEF_TYPES)[number];

export function isProcedureDefType(type: string | undefined): type is ProcedureDefType {
  return (PROCEDURE_DEF_TYPES as readonly string[]).includes(type ?? "");
}

export function procedureHasReturn(type: string | undefined): boolean {
  return type === "procedures_defreturn";
}

export function procedureDefName(block: BlocklyBlockJson): string | undefined {
  if (!isProcedureDefType(block.type)) return undefined;
  const name = block.fields?.NAME;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export function procedureParamNames(block: BlocklyBlockJson): string[] {
  const extra = block.extraState;
  const params = extra?.params;
  if (!Array.isArray(params)) return [];
  const names: string[] = [];
  for (const param of params) {
    if (typeof param === "string" && param.trim()) names.push(param.trim());
    else if (param && typeof param === "object") {
      const name = (param as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return names;
}

export function referencedGridNames(state: unknown): string[] {
  const names = new Set<string>();
  walkWorkspace(state, (block) => {
    if (!block.type || !GRID_NAME_TYPES.has(block.type)) return;
    const name = block.fields?.NAME;
    if (typeof name === "string" && name.trim()) names.add(name.trim());
  });
  return [...names];
}

export function findProcedureDef(
  state: unknown,
  name: string,
): BlocklyBlockJson | undefined {
  return topBlocks(state).find((block) => procedureDefName(block) === name);
}

export function listProcedureDefNames(state: unknown): string[] {
  const names: string[] = [];
  for (const block of topBlocks(state)) {
    const name = procedureDefName(block);
    if (name) names.push(name);
  }
  return names;
}

export function uniqueIdentifier(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function renameProcedureInState(
  state: BlocklyWorkspaceJson,
  from: string,
  to: string,
): void {
  walkWorkspace(state, (block) => {
    if (!block.type?.startsWith("procedures_")) return;
    if (block.fields?.NAME === from) block.fields.NAME = to;
    if (block.extraState && block.extraState.name === from) block.extraState.name = to;
  });
}

export function renameGridInState(
  state: BlocklyWorkspaceJson,
  from: string,
  to: string,
): void {
  walkWorkspace(state, (block) => {
    if (!block.type || !GRID_NAME_TYPES.has(block.type)) return;
    if (block.fields?.NAME === from) block.fields.NAME = to;
  });
}

export function stripBlockIds(block: BlocklyBlockJson): BlocklyBlockJson {
  const copy = structuredClone(block);
  walkBlock(copy, (node) => {
    delete node.id;
  });
  return copy;
}

export function offsetTopBlocks(state: BlocklyWorkspaceJson, dx: number, dy: number): void {
  for (const block of state.blocks?.blocks ?? []) {
    if (typeof block.x === "number") block.x += dx;
    else block.x = dx;
    if (typeof block.y === "number") block.y += dy;
    else block.y = dy;
  }
}

export function collectReferencedIds(state: unknown): Set<string> {
  const ids = new Set<string>();
  walkWorkspace(state, (block) => {
    if (block.id) ids.add(block.id);
    const varId = block.fields?.VAR;
    if (typeof varId === "string" && varId) ids.add(varId);
    const params = block.extraState?.params;
    if (Array.isArray(params)) {
      for (const param of params) {
        if (param && typeof param === "object") {
          const id = (param as { id?: unknown }).id;
          if (typeof id === "string" && id) ids.add(id);
        }
      }
    }
  });
  return ids;
}

export function usedVariables(
  workspace: BlocklyWorkspaceJson,
  fragment: BlocklyBlockJson[],
): NonNullable<BlocklyWorkspaceJson["variables"]> {
  const ids = collectReferencedIds({ blocks: { blocks: fragment } });
  return (workspace.variables ?? []).filter((variable) =>
    typeof variable.id === "string" && ids.has(variable.id)
  );
}

export function remapWorkspaceIds(state: BlocklyWorkspaceJson): void {
  const map = new Map<string, string>();
  const remap = (id: string | undefined): string | undefined => {
    if (!id) return id;
    let next = map.get(id);
    if (!next) {
      next = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
      map.set(id, next);
    }
    return next;
  };
  for (const variable of state.variables ?? []) {
    if (variable.id) variable.id = remap(variable.id);
  }
  walkWorkspace(state, (block) => {
    if (block.id) block.id = remap(block.id);
    if (typeof block.fields?.VAR === "string") {
      block.fields.VAR = remap(block.fields.VAR);
    }
    const params = block.extraState?.params;
    if (Array.isArray(params)) {
      for (const param of params) {
        if (param && typeof param === "object" && typeof (param as { id?: unknown }).id === "string") {
          (param as { id: string }).id = remap((param as { id: string }).id)!;
        }
      }
    }
  });
}

export function renameVariableNameInState(
  state: BlocklyWorkspaceJson,
  from: string,
  to: string,
): void {
  for (const variable of state.variables ?? []) {
    if (variable.name === from) variable.name = to;
  }
}
