/**
 * Blockly text / math / list blocks → Mapping Expression (issue #393).
 *
 * Shared by every block walker (live Blockly `blockToExpression`, the
 * workspace-JSON walkers in `canvas_xml_runtime.ts` and `go_template.ts`) so a
 * block gives the same expression whichever path serializes it. Semantics live
 * in `codegen/helpers/blockly_ops.ts`.
 */

/** Read one field value and one serialized input of the block being walked. */
export interface BlockReader {
  field(name: string): string | undefined;
  /** Mapping Expression of the block plugged into `name`, or null when empty. */
  input(name: string): string | null;
}

const lit = (value: string) => JSON.stringify(value);

function position(r: BlockReader, whereField: string, atInput: string, fallback: string): string {
  const where = r.field(whereField) || fallback;
  if (where === "RANDOM") {
    throw new Error(
      "RANDOM positions are not supported: generated code must give the same output for the same input",
    );
  }
  const at = where === "FROM_START" || where === "FROM_END" ? r.input(atInput) ?? "1" : "1";
  return `${lit(where)}, ${at}`;
}

/** Expression for a math_arithmetic block (POWER included). */
export function mathArithmeticExpression(op: string | undefined, a: string | null, b: string | null): string {
  const left = a ?? "0";
  const right = b ?? "0";
  if (op === "POWER") return `power(${left}, ${right})`;
  const sym = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/" }[op ?? "ADD"];
  if (!sym) throw new Error(`Unsupported math_arithmetic operator ${op}`);
  return `(${left} ${sym} ${right})`;
}

/** Expression for a math_round block (ROUND / ROUNDUP / ROUNDDOWN). */
export function mathRoundExpression(op: string | undefined, num: string | null): string {
  const x = num ?? "0";
  if (op === "ROUNDUP") return `round_up(${x})`;
  if (op === "ROUNDDOWN") return `round_down(${x})`;
  return `round(${x})`;
}

/**
 * Expression for one of the #393 blocks, or `undefined` when `type` is not one
 * of them. Throws for modes generated code cannot reproduce (RANDOM).
 */
export function blocklyOpBlockExpression(type: string, r: BlockReader): string | undefined {
  const text = (name: string) => r.input(name) ?? '""';
  const list = (name: string) => r.input(name) ?? "list()";
  const num = (name: string) => r.input(name) ?? "0";
  switch (type) {
    case "text_length":
      return `text_length(${text("VALUE")})`;
    case "text_isEmpty":
      return `text_isEmpty(${text("VALUE")})`;
    case "text_indexOf":
      return `text_indexOf(${text("VALUE")}, ${text("FIND")}, ${lit(r.field("END") || "FIRST")})`;
    case "text_charAt":
      return `text_charAt(${text("VALUE")}, ${position(r, "WHERE", "AT", "FROM_START")})`;
    case "text_getSubstring":
      return `text_getSubstring(${text("STRING")}, ${position(r, "WHERE1", "AT1", "FROM_START")}, ${
        position(r, "WHERE2", "AT2", "FROM_START")
      })`;
    case "math_single":
      return `math_single(${lit(r.field("OP") || "ROOT")}, ${num("NUM")})`;
    case "math_number_property": {
      const prop = r.field("PROPERTY") || "EVEN";
      const divisor = prop === "DIVISIBLE_BY" ? `, ${r.input("DIVISOR") ?? "0"}` : "";
      return `math_number_property(${lit(prop)}, ${num("NUMBER_TO_CHECK")}${divisor})`;
    }
    case "math_on_list": {
      const op = r.field("OP") || "SUM";
      if (op === "RANDOM") {
        throw new Error(
          "math_on_list RANDOM is not supported: generated code must give the same output for the same input",
        );
      }
      return `math_on_list(${lit(op)}, ${list("LIST")})`;
    }
    case "lists_isEmpty":
      return `lists_isEmpty(${list("VALUE")})`;
    case "lists_indexOf":
      return `lists_indexOf(${list("VALUE")}, ${r.input("FIND") ?? "null"}, ${lit(r.field("END") || "FIRST")})`;
    case "lists_getSublist":
      return `lists_getSublist(${list("LIST")}, ${position(r, "WHERE1", "AT1", "FROM_START")}, ${
        position(r, "WHERE2", "AT2", "FROM_START")
      })`;
    case "lists_reverse":
      return `lists_reverse(${list("LIST")})`;
    case "lists_sort":
      return `lists_sort(${list("LIST")}, ${lit(r.field("TYPE") || "NUMERIC")}, ${
        String(r.field("DIRECTION") ?? "1") === "-1" ? "-1" : "1"
      })`;
    case "lists_split": {
      const mode = r.field("MODE") || "SPLIT";
      const input = mode === "JOIN" ? list("INPUT") : text("INPUT");
      return `lists_split(${lit(mode)}, ${input}, ${text("DELIM")})`;
    }
  }
  return undefined;
}

/**
 * Stock math blocks plus the #393 blocks, for walkers that lack them:
 * math_arithmetic (POWER too), math_round (up / down too), math_modulo,
 * math_constrain. `undefined` when `type` is none of these.
 */
export function stockMathOrOpExpression(type: string, r: BlockReader): string | undefined {
  switch (type) {
    case "math_arithmetic":
      return mathArithmeticExpression(r.field("OP") || "ADD", r.input("A"), r.input("B"));
    case "math_round":
      return mathRoundExpression(r.field("OP") || "ROUND", r.input("NUM"));
    case "math_modulo":
      return `modulo(${r.input("DIVIDEND") ?? "0"}, ${r.input("DIVISOR") ?? "1"})`;
    case "math_constrain":
      return `constrain(${r.input("VALUE") ?? "0"}, ${r.input("LOW") ?? "0"}, ${r.input("HIGH") ?? "0"})`;
  }
  return blocklyOpBlockExpression(type, r);
}

interface JsonBlockNode {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: JsonBlockNode; shadow?: JsonBlockNode }>;
}

/** `BlockReader` over saved workspace JSON. */
export function jsonBlockReader<B extends JsonBlockNode>(
  block: B,
  serialize: (child: B) => string | null,
): BlockReader {
  return {
    field: (name) => {
      const v = block.fields?.[name];
      return v === undefined || v === null ? undefined : String(v);
    },
    input: (name) => {
      const slot = block.inputs?.[name];
      const child = (slot?.block ?? slot?.shadow) as B | undefined;
      return child ? serialize(child) : null;
    },
  };
}
