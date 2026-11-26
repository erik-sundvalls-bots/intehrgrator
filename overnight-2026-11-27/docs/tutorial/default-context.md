# Default context

Many targets need values that are not in the source file. They are either fixed (a language code, a facility id) or supplied later by the system that runs the conversion. The **default context map** holds those values. It also scaffolds the same lookup into every matching slot, so you change the map once instead of every block.

Back to the [tutorial index](../TUTORIAL.md). Assumes [Basic mapping](basic-mapping.md).

## Load a map with the target

A blank project has **no** factory rows: the canvas shows an empty **Default context map** block (*no entries*). Click **Load target & default context map** and, under **Default context map**, pick **openEHR factory** for an openEHR target. **Keep the map already on the canvas** keeps the one you have; **Browse map file…** loads a saved map.

Each **entry** has:

- a **runtime key** (`language`, `facility`, …) read at convert time with `maps_get("defaults", …)`
- **scaffold targets** (chips such as `*.language`) that light **Default point**s when you click **Load & scaffold** or **Apply**

**New (empty)** loads the target into the **Target schema** tab only. Pull PARTY or terminology pieces onto value sockets and chip paths, **Save as**, then Apply.

The ▾ menu items **Refresh from file…** and **Refresh from URL…** update a target or source without wiping canvas mappings.

When you click **Load & scaffold**, scaffolding fills **Default point**s with map lookups. Editing a value shows up in Test Run immediately. New chips wait until you Apply.

The scaffolded **get defaults** lookups start collapsed, so a large template is not buried in identical lookup blocks. A collapsible block has a small light rounded button just left of its cogwheel: click it to expand or collapse the block. The block's context menu has the same Expand / Collapse.

<img src="../assets/tutorial/default-context.png" width="520" alt="Load target and default context map dialog: Target (file, URL or a minimal JSON, XML or text example), Default context map with the openEHR factory option, Template scaffolding Full or Sparse, and Load and scaffold" />

*The joint load dialog is where you pick both the target and a default context map.*

## Where the map lives

The unique default context map sits on the canvas. It is not in the **Lists & maps** toolbox drawer. Generic maps and terminology lookups in that drawer are a different thing; see [Sheets and decision tables](sheets-and-decision-tables.md).

Generated conversion scripts accept a **defaults** map at convert time — the same structure you authored here. See [Tests and export](tests-and-export.md).
