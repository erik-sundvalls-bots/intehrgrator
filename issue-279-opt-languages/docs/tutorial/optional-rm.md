# Optional RM fields

An openEHR template does not list every structure the Reference Model allows. Feeder audit is a typical example: the template is silent, the RM still permits it, and you add it on the block that should carry it.

Back to the [tutorial index](../TUTORIAL.md). Assumes a Template Skeleton from [Basic mapping](basic-mapping.md).

## Add a structure

On a container block, open the cogwheel (or right-click and choose **Add RM structure…**). The picker lists only RM types that are valid at that point. Choosing one expands the parent block and inserts the child. Empty optional slots are not shown until you add them.

Yellow constraint triangles still mark mandatory fields you have not mapped. Optional structure you added is yours to fill with click-to-map, a literal, or a [default context](default-context.md) lookup.

Dragging a leaf or subtree from the **Target schema** tab onto empty canvas is a different gesture: it adds optional structure from the target schema (or recreates scaffold you deleted). Use the cogwheel when the thing you want is RM structure the template never mentioned.
