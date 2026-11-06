/** Lower ordinary Function statements; reject unsupported blocks rather than losing work. */
import type { Block } from "blockly/core";
import type { MappingStatement } from "../types/mod.ts";
import { blockToExpression } from "./expression_serialize.ts";

function variable(block: Block): string {
  return block.getField("VAR")?.getText() ||
    String(block.getFieldValue("VAR") || "item");
}

export function functionStatements(first: Block | null): MappingStatement[] {
  const statements: MappingStatement[] = [];
  for (let block = first; block; block = block.getNextBlock()) {
    if (!block.isEnabled()) continue;
    const expr = (input: string, fallback = "null") => {
      const child = block!.getInputTargetBlock(input);
      if (!child) return fallback;
      const value = blockToExpression(child);
      if (value === null) {
        throw new Error(`Unsupported Function expression: ${child.type}`);
      }
      return value;
    };
    const name = variable(block);
    switch (block.type) {
      case "variables_set":
        statements.push({ kind: "set", name, value: expr("VALUE") });
        break;
      case "text_append":
        statements.push({
          kind: "set",
          name,
          value: `concat(var(${JSON.stringify(name)}), ${expr("TEXT", '""')})`,
        });
        break;
      case "math_change":
        statements.push({
          kind: "set",
          name,
          value: `(var(${JSON.stringify(name)}) + ${expr("DELTA", "0")})`,
        });
        break;
      case "lists_setIndex": {
        const target = block.getInputTargetBlock("LIST");
        if (
          block.getFieldValue("MODE") !== "INSERT" ||
          block.getFieldValue("WHERE") !== "LAST" ||
          target?.type !== "variables_get"
        ) {
          throw new Error(
            "Portable Function list mutation currently requires insert at LAST of a variable",
          );
        }
        statements.push({
          kind: "append",
          name: variable(target),
          value: expr("TO"),
        });
        break;
      }
      case "controls_forEach":
      case "for_each_list":
        statements.push({
          kind: "forEach",
          name,
          list: expr("LIST", "list()"),
          body: functionStatements(block.getInputTargetBlock("DO")),
        });
        break;
      case "controls_if": {
        let branches = functionStatements(block.getInputTargetBlock("ELSE"));
        let count = 0;
        while (block.getInput(`IF${count}`)) count++;
        for (let i = count - 1; i >= 0; i--) {
          branches = [{
            kind: "if",
            condition: expr(`IF${i}`, "false"),
            then: functionStatements(block.getInputTargetBlock(`DO${i}`)),
            else: branches,
          }];
        }
        statements.push(...branches);
        break;
      }
      case "procedures_ifreturn":
        statements.push({
          kind: "return",
          condition: expr("CONDITION", "false"),
          value: expr("VALUE"),
        });
        break;
      default:
        throw new Error(
          `Unsupported portable Function statement: ${block.type}`,
        );
    }
  }
  return statements;
}
