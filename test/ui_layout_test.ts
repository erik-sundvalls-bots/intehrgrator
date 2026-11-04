import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  productTreeShiftToClearContextMap,
  yJustBelowDefaults,
} from "@intehrgrator/blockly/defaults_canvas.ts";
import { startYAboveRoot } from "@intehrgrator/blockly/conversion_start_canvas.ts";
import {
  mappingPaneLeadsOnNarrow,
  NARROW_MAIN_PANES_MAX_WIDTH_PX,
  visualAxisFromFlexDirection,
} from "@intehrgrator/ui/split_pane.ts";
import {
  COLLAPSED_HOVER_OUTLINE,
  SLOT_OVERLAY_DELTA_FILL,
  SLOT_OVERLAY_RM_FILL,
} from "@intehrgrator/blockly/block_colours.ts";

Deno.test("scaffold top sits a small gap under Defaults, not a Defaults-height jump", () => {
  assertEquals(yJustBelowDefaults(160), 20 + 160 + 16);
  assertEquals(yJustBelowDefaults(4000) > 20 + 160, true);
  // Must not subtract the (possibly huge) skeleton height.
  assertEquals(yJustBelowDefaults(4000) < 20 + 4000 + 50, true);
});

Deno.test("a context map that covers the product tree pushes the tree below it", () => {
  const shift = productTreeShiftToClearContextMap(
    { x: 20, y: 20, width: 280, height: 400 },
    { x: 20, y: 196, width: 640, height: 900 },
  );
  assertEquals(shift, { dx: 0, dy: 240 });
});

Deno.test("a product tree already clear of the context map stays put", () => {
  const shift = productTreeShiftToClearContextMap(
    { x: 20, y: 20, width: 280, height: 160 },
    { x: 20, y: 196, width: 640, height: 900 },
  );
  assertEquals(shift, { dx: 0, dy: 0 });
});

Deno.test("an unmeasured context map does not move the product tree", () => {
  assertEquals(
    productTreeShiftToClearContextMap(
      { x: 20, y: 20, width: 0, height: 0 },
      { x: 20, y: 196, width: 640, height: 900 },
    ),
    { dx: 0, dy: 0 },
  );
});

Deno.test("a product tree that only clips the context map's right edge moves right", () => {
  const shift = productTreeShiftToClearContextMap(
    { x: 20, y: 20, width: 200, height: 100 },
    { x: 180, y: 20, width: 400, height: 120 },
  );
  assertEquals(shift, { dx: 56, dy: 0 });
});

Deno.test("Conversion start parks above the root using start height, not root height", () => {
  const rootY = 500;
  const startHeight = 40;
  assertEquals(startYAboveRoot(rootY, startHeight), 500 - 40 - 12);
  // A tall composition must not shove start thousands of pixels upward.
  assertEquals(startYAboveRoot(rootY, startHeight) > 0, true);
});

Deno.test("stacked CSS column wins over a declared row split", () => {
  assertEquals(visualAxisFromFlexDirection("column", "row"), "column");
  assertEquals(visualAxisFromFlexDirection("row", "column"), "row");
  assertEquals(visualAxisFromFlexDirection("", "row"), "row");
});

Deno.test("narrow viewports treat Mapping Editors as the lead pane", () => {
  assertEquals(mappingPaneLeadsOnNarrow(NARROW_MAIN_PANES_MAX_WIDTH_PX), true);
  assertEquals(mappingPaneLeadsOnNarrow(375), true);
  assertEquals(mappingPaneLeadsOnNarrow(1280), false);
});

Deno.test("sheet tabs use the pane width and still scroll when names overflow", async () => {
  const css = await Deno.readTextFile(join(import.meta.dirname!, "..", "web", "styles.css"));
  const tabsRule = css.slice(css.indexOf(".sheets-tabs {"), css.indexOf(".sheets-tab {"));
  assert(tabsRule.includes("flex: 1 1 auto"), tabsRule);
  assert(tabsRule.includes("overflow-x: auto"), tabsRule);
  assert(tabsRule.includes("min-width: 0"), tabsRule);
  assert(!tabsRule.includes("420px"), tabsRule);
});

Deno.test("example and test-output tabs scroll sideways instead of wrapping", async () => {
  const css = await Deno.readTextFile(join(import.meta.dirname!, "..", "web", "styles.css"));
  const tabsRule = css.slice(css.indexOf(".example-tabs {"), css.indexOf(".example-tab {"));
  assert(tabsRule.includes("flex-wrap: nowrap"), tabsRule);
  assert(tabsRule.includes("overflow-x: auto"), tabsRule);
});

Deno.test("template overlay fills contrast against RM container teal", () => {
  const rmTeal = "#003B49";
  assertEquals(contrastRatio(SLOT_OVERLAY_DELTA_FILL, rmTeal) > 7, true);
  assertEquals(contrastRatio(SLOT_OVERLAY_RM_FILL, rmTeal) > 7, true);
  assertEquals(SLOT_OVERLAY_DELTA_FILL, COLLAPSED_HOVER_OUTLINE);
});

function contrastRatio(a: string, b: string): number {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}
