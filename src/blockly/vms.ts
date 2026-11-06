/**
 * Verifiable Mapping Subset (#35 / #37).
 * These types are not in the toolbox and are not first-class IR.
 */

export const VMS_REMOVED_BLOCK_TYPES = [
  "controls_whileUntil",
  "controls_repeat_ext",
  "controls_for",
  "controls_forEach",
  "controls_flow_statements",
  "controls_if",
  // `include_when` is the VMS guarded emit. Do not put it here.
  "math_random_int",
  "math_random_float",
  "text_print",
  "lists_setIndex",
  "lists_repeat",
  "sheet_set_cell",
  "sheet_set_xy",
  "sheet_set_row",
  "sheet_set_column",
  "sheet_set_header",
  "sheet_insert_row",
  "sheet_delete_row",
  "sheet_insert_column",
  "sheet_delete_column",
] as const;

export const VMS_ESCAPE_BLOCK_TYPES = [
  "text_code",
  "text_handlebars",
  "json_object",
  "xml_element",
  "xml_document",
] as const;

const REMOVED = new Set<string>(VMS_REMOVED_BLOCK_TYPES);
const ESCAPE = new Set<string>(VMS_ESCAPE_BLOCK_TYPES);

export function isVmsRemovedBlockType(type: string): boolean {
  return REMOVED.has(type);
}

export function isVmsEscapeBlockType(type: string): boolean {
  return ESCAPE.has(type);
}

/** Expression/value blocks the VMS profile implements fully (Mapping Expression + codegen). */
export const VMS_EXPRESSION_BLOCK_TYPES = [
  "source_query",
  "source_query_number",
  "source_query_boolean",
  "source_query_node",
  "text",
  "text_trim",
  "text_join",
  "math_number",
  "math_arithmetic",
  "math_round",
  "math_modulo",
  "math_constrain",
  "logic_compare",
  "logic_operation",
  "logic_negate",
  "logic_boolean",
  "logic_ternary",
  "logic_list_restriction",
  "logic_current_item",
  "logic_loop_index",
  "logic_loop_length",
  "lists_set_operation",
  "variables_get",
  "maps_get",
  "maps_entries",
  "lists_length",
  "logic_null",
  "maps_create_with",
  "maps_create_empty",
  "sheet_get_cell",
  "sheet_get_xy",
  "sheet_get_row",
  "sheet_get_column",
  "sheet_get_header",
  "sheet_get_data",
  "sheet_lookup",
  "decision_table",
  "lists_getIndex",
  "lists_create_with",
  "procedures_callreturn",
] as const;

/** Blocks handled by dedicated canvas emitters instead of `blockToExpression`. */
export const VMS_CANVAS_EMIT_BLOCK_TYPES = [
  "term_pick",
  "code_phrase",
] as const;

export function isVmsExpressionBlockType(type: string): boolean {
  return (VMS_EXPRESSION_BLOCK_TYPES as readonly string[]).includes(type);
}
