# Loops

Use a loop when one target container should be filled once per source row: a series of blood-pressure measurements, a list of medications, a repeating CLUSTER.

Back to the [tutorial index](../TUTORIAL.md). Assumes [Basic mapping](basic-mapping.md).

## Let click-to-map wrap the container

Click a value slot that sits under a repeating container, then click a node in the repeating part of the source tree. intEHRgrator wraps that container with a **for each** block (`for_each_list`) and stores a **relative** source path inside the loop. Do not copy the repeating block once per row on the canvas. Test Run expands the rows.

You can also drag the loop out of the **Loops & Logic** toolbox drawer. `for each` is the first block in that drawer. Plug a source query into **in** to walk source nodes, or plug a list, map keys, or sheet rows to walk a computed collection.

The Example Set **Dummy vitals series (JSON Schema with repeating measurements → openEHR) — mapped** is a worked instance of this.

## Index and length

Inside the loop, the **index** and **length** blocks (in the same drawer) are reporters, not workspace variables.

- The index is **0-based**. The first row is index `0`. The last row is index = length − 1.
- The length is fixed when the loop starts. It does not change mid-iteration.
- Nested loops can refer to an outer item by name, the same way **this item** does.

These are for tests such as “separator before every row except the first”. They are not a second copy of the source path.

## Read an outer item by name

Each **for each** names its item (`dag`, `substans`). Inside that loop, at any depth, a source path can read that item: `dag.StartTid`. A path with no name (`Innholdstoff_Navn`, `Substanser`) still means the innermost item. Do not pin an outer row with `$.KurDagar[1]`.

## Include when

**Include when** (same drawer) wraps a target container or slot stack. The structure is emitted only when the boolean condition is true. Plug in a source query, a comparison, or and/or. Leave **else** empty to omit the structure; plug a stack into **else** to emit something else. On an openEHR template the wrapped node must be optional, unless **else** emits that same node. Use it when an iteration would otherwise keep a container that has only a time, such as a pulse event with no pulse.
