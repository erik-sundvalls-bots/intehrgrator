/** Host-neutral statement control flow. Expressions still use each normal host emitter. */
import type { MappingStatement } from "../../types/mod.ts";
import { loopIndexBinderName, loopLengthBinderName } from "../loop_binders.ts";

export function emitImperativeStack(
  stack: MappingStatement[],
  expression: (source: string) => string,
  java = false,
): string {
  let next = 0;
  const read = (name: string) =>
    java
      ? `__fnVars.get(${JSON.stringify(name)})`
      : `__fnVars[${JSON.stringify(name)}]`;
  const set = (name: string, value: string) =>
    java
      ? `__fnVars.put(${JSON.stringify(name)}, ${value});`
      : `${read(name)} = ${value};`;
  const truth = (value: string) => java ? `asBoolean(${value})` : value;
  const emit = (statements: MappingStatement[]): string =>
    statements.map((s) => {
      switch (s.kind) {
        case "set":
          return set(s.name, expression(s.value));
        case "append":
          return set(
            s.name,
            java
              ? `appendList(${read(s.name)}, ${expression(s.value)})`
              : `[...asList(${read(s.name)}), ${expression(s.value)}]`,
          );
        case "return":
          return `if (${truth(expression(s.condition))}) { return ${
            expression(s.value)
          }; }`;
        case "if":
          return `if (${truth(expression(s.condition))}) {\n${
            emit(s.then)
          }\n} else {\n${emit(s.else)}\n}`;
        case "forEach": {
          const id = next++;
          const list = `__list${id}`, index = `__index${id}`;
          return `${
            java ? "java.util.List<Object>" : "const"
          } ${list} = asList(${expression(s.list)});\n` +
            `for (${java ? "int" : "let"} ${index} = 0; ${index} < ${list}.${
              java ? "size()" : "length"
            }; ${index}++) {\n` +
            set(s.name, java ? `${list}.get(${index})` : `${list}[${index}]`) +
            "\n" +
            set(loopIndexBinderName(s.name), index) + "\n" +
            set(
              loopLengthBinderName(s.name),
              `${list}.${java ? "size()" : "length"}`,
            ) + "\n" +
            emit(s.body) + "\n}";
        }
      }
    }).join("\n");
  return emit(stack);
}

/** XQuery threads locals and an early-return flag through immutable state maps. */
export function emitXQueryStack(
  stack: MappingStatement[],
  initial: string,
  expression: (source: string, state: string) => string,
): string {
  let next = 0;
  const put = (state: string, name: string, value: string) =>
    `map:put(${state}, 'vars', map:put(${state}?vars, ${
      JSON.stringify(name)
    }, ${value}))`;
  const array = (value: string) =>
    `(let $items := ${value} return if ($items instance of array(*)) then $items else array { $items })`;
  const emit = (statements: MappingStatement[], start: string): string => {
    let current = start;
    const lets: string[] = [];
    for (const s of statements) {
      const state = `$state${next++}`;
      const e = (source: string) => expression(source, current);
      let value: string;
      switch (s.kind) {
        case "set":
          value = put(current, s.name, e(s.value));
          break;
        case "append":
          value = put(
            current,
            s.name,
            `array:append(${
              array(`${current}?vars(${JSON.stringify(s.name)})`)
            }, ${e(s.value)})`,
          );
          break;
        case "return":
          value = `(if (${
            e(s.condition)
          }) then map:put(map:put(${current}, 'returned', true()), 'value', ${
            e(s.value)
          }) else ${current})`;
          break;
        case "if":
          value = `(if (${e(s.condition)}) then ${emit(s.then, current)} else ${
            emit(s.else, current)
          })`;
          break;
        case "forEach": {
          const id = next++;
          const items = `$items${id}`, acc = `$acc${id}`, index = `$index${id}`;
          const bound = put(
            put(
              put(acc, s.name, `${items}(${index})`),
              loopIndexBinderName(s.name),
              `${index} - 1`,
            ),
            loopLengthBinderName(s.name),
            `array:size(${items})`,
          );
          // fontoxpath currently loses the initial accumulator on an empty fold-left.
          // An explicit empty branch is portable to BaseX/Saxon too.
          const local = `$bound${id}`;
          value = `(let ${items} := ${
            array(e(s.list))
          } return if (array:size(${items}) = 0) then ${current} else fold-left(1 to array:size(${items}), ${current}, function(${acc}, ${index}) { if (${acc}?returned) then ${acc} else (let ${local} := ${bound} return ${
            emit(s.body, local)
          }) }))`;
          break;
        }
      }
      lets.push(
        `let ${state} := if (${current}?returned) then ${current} else ${value}`,
      );
      current = state;
    }
    return lets.length ? `( ${lets.join("\n")} return ${current} )` : current;
  };
  return emit(stack, initial);
}
