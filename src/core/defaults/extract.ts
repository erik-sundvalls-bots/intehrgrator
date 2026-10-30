import { DEFAULTS_MAP_NAME } from "./factory.ts";
import { TERM_PICK_NONE } from "../openehr_term_catalog.ts";
import {
  contextMapFromDefaultsJson,
  DEFAULT_CONTEXT_MAP_TYPE,
  DEFAULTS_BLOCK_TYPE,
  entriesFromContextMapBlock,
  LEGACY_DEFAULTS_BLOCK_TYPE,
  mapsCreateWithToContextMap,
} from "./context_map.ts";
export { DEFAULTS_MAP_NAME };
export {
  DEFAULT_CONTEXT_MAP_TYPE,
  DEFAULTS_BLOCK_TYPE,
  LEGACY_DEFAULTS_BLOCK_TYPE,
};

export const MAPS_CREATE_WITH = "maps_create_with";
export const MAPS_GET = "maps_get";

export type NamedMaps = Record<string, Record<string, unknown>>;

interface BlocklyBlockJson {
  type?: string;
  fields?: Record<string, unknown>;
  extraState?: { itemCount?: number; targets?: string[][] };
  inputs?: Record<string, { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }>;
  next?: { block?: BlocklyBlockJson };
}

interface BlocklyWorkspaceJson {
  blocks?: { blocks?: BlocklyBlockJson[] };
}

/**
 * Materialize named Maps from Blockly workspace JSON.
 * Literal text/number/boolean values are used as-is; term_pick contributes
 * its selected code; other value blocks become null.
 */
export function namedMapsFromBlocklyState(state: unknown): NamedMaps {
  const maps: NamedMaps = {};
  const blocks = topBlocks(state);
  for (const block of blocks) {
    if (block.type === DEFAULT_CONTEXT_MAP_TYPE) {
      maps[DEFAULTS_MAP_NAME] = mapFromContextMap(block);
    } else if (block.type === LEGACY_DEFAULTS_BLOCK_TYPE) {
      const converted = mapsCreateWithToContextMap(
        block.inputs?.MAP?.block ?? block.inputs?.MAP?.shadow,
      );
      maps[DEFAULTS_MAP_NAME] = converted
        ? mapFromContextMap(converted as BlocklyBlockJson)
        : mapFromCreateWith(block.inputs?.MAP?.block ?? block.inputs?.MAP?.shadow);
    }
    if (block.type === MAPS_CREATE_WITH) {
      const name = String(block.fields?.NAME ?? "").trim();
      if (name && name !== DEFAULTS_MAP_NAME) {
        maps[name] = mapFromCreateWith(block);
      }
    }
  }
  return maps;
}

export function mapsGetExpression(mapName: string, key: string): string {
  return `maps_get(${JSON.stringify(mapName)}, ${JSON.stringify(key)})`;
}

/**
 * Accept a unique default context map, a legacy `maps_create_with` / Defaults
 * block (converted on ingest), or a workspace that wraps one.
 */
export function mapBlockFromDefaultsJson(parsed: unknown): unknown | null {
  return contextMapFromDefaultsJson(parsed);
}

function topBlocks(state: unknown): BlocklyBlockJson[] {
  if (!state || typeof state !== "object") return [];
  const blocks = (state as BlocklyWorkspaceJson).blocks?.blocks;
  return Array.isArray(blocks) ? blocks : [];
}

function mapFromContextMap(block: BlocklyBlockJson | Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rec = block as BlocklyBlockJson;
  const json = rec.type === DEFAULT_CONTEXT_MAP_TYPE
    ? rec
    : (mapsCreateWithToContextMap(rec) as BlocklyBlockJson | null);
  if (!json) return out;
  const entries = entriesFromContextMapBlock(json);
  for (const entry of entries) {
    if (!entry.runtimeKey) continue;
    out[entry.runtimeKey] = literalFromInput(json.inputs?.[`VAL${entry.index}`]) ?? "";
  }
  return out;
}

function mapFromCreateWith(block: BlocklyBlockJson | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!block || block.type !== MAPS_CREATE_WITH) return out;
  const fieldKeys = Object.keys(block.fields ?? {}).filter((name) => /^KEY\d+$/.test(name));
  const valKeys = Object.keys(block.inputs ?? {}).filter((name) => /^VAL\d+$/.test(name));
  const fromNames = (names: string[]) =>
    names.length ? Math.max(...names.map((name) => Number(name.slice(3)))) + 1 : 0;
  const count = Math.max(
    Number(block.extraState?.itemCount ?? 0),
    fromNames(fieldKeys),
    fromNames(valKeys),
  );
  for (let i = 0; i < count; i++) {
    const key = keyFromPair(block, i);
    if (typeof key !== "string" || !key) continue;
    out[key] = literalFromInput(block.inputs?.[`VAL${i}`]) ?? "";
  }
  return out;
}

function keyFromPair(block: BlocklyBlockJson, index: number): unknown {
  const fromField = block.fields?.[`KEY${index}`];
  if (typeof fromField === "string" && fromField) return fromField;
  if (typeof fromField === "number" || typeof fromField === "boolean") {
    return String(fromField);
  }
  return "";
}

function literalFromInput(
  input: { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson } | undefined,
): unknown {
  const block = input?.block ?? input?.shadow;
  if (!block) return "";
  if (block.type === "text") return String(block.fields?.TEXT ?? "");
  if (block.type === "math_number") return Number(block.fields?.NUM ?? 0);
  if (block.type === "logic_boolean") return block.fields?.BOOL === "TRUE";
  if (block.type === "term_pick") {
    const code = String(block.fields?.CODE ?? "");
    return !code || code === TERM_PICK_NONE ? "" : code;
  }
  if (block.type === "party_self") {
    // Canonical openEHR JSON (`_type`), so a Conversion Script can assign it as is (#310).
    return { _type: "PARTY_SELF" };
  }
  if (block.type === "party_identified" || block.type === "party_related" || block.type === "party_proxy") {
    return partyLiteral(block);
  }
  if (block.type === "dv_identifier") {
    return identifierLiteralFromBlock(block);
  }
  if (block.type === "lists_create_with") {
    return listFromCreateWith(block);
  }
  return null;
}

function partyLiteral(block: BlocklyBlockJson): Record<string, unknown> {
  const rmType = String(
    block.fields?.RM_TYPE ??
      block.type?.replace(/^party_/, "PARTY_").toUpperCase() ??
      "PARTY_IDENTIFIED",
  );
  const out: Record<string, unknown> = { _type: rmType };
  const name = literalFromInput(block.inputs?.ATTR_name);
  if (name != null && name !== "") out.name = name;
  const identifiersRaw = block.inputs?.ATTR_identifiers?.block ??
    block.inputs?.ATTR_identifiers?.shadow;
  const identifiers = listFromCreateWith(identifiersRaw);
  if (identifiers.length) {
    out.identifiers = identifiers
      .map(identifierFromUnknown)
      .filter((row): row is Record<string, unknown> => row != null);
  }
  // PARTY_PROXY is abstract: a named one is PARTY_IDENTIFIED, an empty one the record's subject.
  if (rmType === "PARTY_PROXY") out._type = out.name != null || out.identifiers ? "PARTY_IDENTIFIED" : "PARTY_SELF";
  return out;
}

function listFromCreateWith(block: BlocklyBlockJson | undefined): unknown[] {
  if (!block) return [];
  if (block.type !== "lists_create_with") {
    const one = literalFromInput({ block });
    return one == null || one === "" ? [] : [one];
  }
  const addKeys = Object.keys(block.inputs ?? {}).filter((name) => /^ADD\d+$/.test(name));
  const count = Math.max(
    Number(block.extraState?.itemCount ?? 0),
    addKeys.length ? Math.max(...addKeys.map((name) => Number(name.slice(3)))) + 1 : 0,
  );
  const items: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const value = literalFromInput(block.inputs?.[`ADD${i}`]);
    if (value == null || value === "") continue;
    items.push(value);
  }
  return items;
}

function identifierLiteralFromBlock(block: BlocklyBlockJson): Record<string, unknown> | null {
  const id = literalFromInput(block.inputs?.FLD_id ?? block.inputs?.ATTR_id);
  if (id == null || id === "") return null;
  const row: Record<string, unknown> = { _type: "DV_IDENTIFIER", id: String(id) };
  const type = literalFromInput(block.inputs?.OPTFLD_type ?? block.inputs?.FLD_type);
  const issuer = literalFromInput(block.inputs?.OPTFLD_issuer ?? block.inputs?.FLD_issuer);
  const assigner = literalFromInput(block.inputs?.OPTFLD_assigner ?? block.inputs?.FLD_assigner);
  if (type != null && type !== "") row.type = String(type);
  if (issuer != null && issuer !== "") row.issuer = String(issuer);
  if (assigner != null && assigner !== "") row.assigner = String(assigner);
  return row;
}

function identifierFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const id = rec.id ?? rec.value;
    if (id == null || id === "") return null;
    const row: Record<string, unknown> = { _type: "DV_IDENTIFIER", id: String(id) };
    if (rec.type != null && rec.type !== "") row.type = String(rec.type);
    if (rec.issuer != null && rec.issuer !== "") row.issuer = String(rec.issuer);
    if (rec.assigner != null && rec.assigner !== "") row.assigner = String(rec.assigner);
    return row;
  }
  return { _type: "DV_IDENTIFIER", id: String(value) };
}
