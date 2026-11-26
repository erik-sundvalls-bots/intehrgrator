# Optional RM fields

An openEHR template does not list every structure the Reference Model allows. Feeder audit is a typical example: the template is silent, the RM still permits it, and you add it on the block that should carry it.

Back to the [tutorial index](../TUTORIAL.md). Assumes a Template Skeleton from [Basic mapping](basic-mapping.md).

## Add a structure

On a container block, open the cogwheel ⚙ to the right of the block title. The picker lists only RM types that are valid at that point. Choosing one expands the parent block and inserts the child. Empty optional slots are not shown until you add them.

Yellow constraint triangles still mark mandatory fields you have not mapped. Optional structure you added is yours to fill with click-to-map, a literal, or a [default context](default-context.md) lookup.

Dragging a leaf or subtree from the **Target schema** tab onto empty canvas is a different gesture: it adds optional structure from the target schema (or recreates scaffold you deleted). Use the cogwheel when the thing you want is RM structure the template never mentioned.

## Optional data-value attributes

The cogwheel on a data-value shell (text, coded text, quantity, count, proportion, ordinal, scale, duration, date, date-time, time, multimedia, interval) offers its optional RM attributes too: `mappings`, `hyperlink`, `normal_range`, `other_reference_ranges`, and so on.

## Optional RM in the trees

When the source or the target is an openEHR template, its tree in **Source** or **Target schema** shows the mandatory RM attributes the template left out in muted italic. Optional RM attributes are behind a small encircled plus at the end of the row; click it to show them. Opening one tree does not open the other. From the source tree you click-to-map such a path; from the Target schema tab you drag it onto the canvas.

## Deprecated attributes

An RM attribute that its own specification marks as deprecated, such as `hyperlink` on text and coded text, is struck through: on the block, in the cogwheel list, and in the source tree. It still works and says that it is deprecated; prefer not to start new mappings with it.
