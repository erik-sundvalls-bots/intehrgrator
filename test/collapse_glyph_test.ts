/**
 * Scaffolded get-defaults lookups start collapsed, and the corner glyph
 * matches the block context-menu glyph. Toggling keeps the lookup connected.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { registerMapBlocks } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import { registerRmBlocks } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { createMapsGetBlock } from "@intehrgrator/blockly/blocks/map_blocks.ts";
import {
  blockOffersCollapse,
  collapseGlyph,
  collapseMenuText,
  COLLAPSE_GLYPH_COLLAPSED,
  COLLAPSE_GLYPH_EXPANDED,
  syncCollapseGlyph,
} from "@intehrgrator/blockly/collapse_glyph.ts";
import { loadSkeletonIntoWorkspace } from "@intehrgrator/blockly/skeleton_loader.ts";
import { generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { createEmptyModel } from "@intehrgrator/core/mapping_model/mod.ts";

const opt = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);

function keyText(block: Blockly.Block): string {
  return String(block.getInputTargetBlock("KEY")?.getFieldValue("TEXT") ?? "");
}

Deno.test("every scaffolded get-defaults lookup starts collapsed and toggles without losing its key", () => {
  registerRmBlocks();
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  const { skeleton } = generateSkeleton(opt);
  loadSkeletonIntoWorkspace(workspace, skeleton, createEmptyModel("t"), null, "en");
  const lookups = workspace.getAllBlocks(false).filter((block) =>
    block.type === "maps_get" && block.getFieldValue("NAME") === "defaults"
  );
  assert(lookups.length > 1, "blood pressure scaffold should place several defaults lookups");
  for (const lookup of lookups) assert(lookup.isCollapsed(), keyText(lookup) || lookup.id);

  const lookup = lookups.find((block) => keyText(block) === "composer") ?? lookups[0];
  const parentId = lookup.getParent()?.id ?? "";
  const key = keyText(lookup);
  assert(parentId, "defaults lookup should stay connected to its slot");
  lookup.setCollapsed(false);
  assertFalse(lookup.isCollapsed());
  assertEquals(lookup.getParent()?.id, parentId);
  assertEquals(keyText(lookup), key);
  assertEquals(lookup.getFieldValue("NAME"), "defaults");
  lookup.setCollapsed(true);
  assert(lookup.isCollapsed());
  assertEquals(lookup.getParent()?.id, parentId);
  assertEquals(keyText(lookup), key);

  const saved = Blockly.serialization.blocks.save(lookup) as { collapsed?: boolean };
  assertEquals(saved?.collapsed, true);
  lookup.setCollapsed(false);
  const expanded = Blockly.serialization.blocks.save(lookup) as { collapsed?: boolean };
  assertEquals(expanded?.collapsed, undefined);
  assertEquals(lookup.getParent()?.id, parentId);
  assertEquals(keyText(lookup), key);
  workspace.dispose();
});

Deno.test("a get lookup for another map is not forced collapsed", () => {
  registerMapBlocks();
  const workspace = new Blockly.Workspace();
  const other = createMapsGetBlock(workspace, "units", "kg");
  assertFalse(other.isCollapsed());
  const defaults = createMapsGetBlock(workspace, "defaults", "language");
  assert(defaults.isCollapsed());
  workspace.dispose();
});

Deno.test("collapse menu text uses the same glyph as the block corner", () => {
  assertEquals(collapseGlyph(false), COLLAPSE_GLYPH_EXPANDED);
  assertEquals(collapseGlyph(true), COLLAPSE_GLYPH_COLLAPSED);
  assertEquals(collapseMenuText(false, "Collapse Block"), `${COLLAPSE_GLYPH_EXPANDED} Collapse Block`);
  assertEquals(collapseMenuText(true, "Expand Block"), `${COLLAPSE_GLYPH_COLLAPSED} Expand Block`);
  assertEquals(
    collapseMenuText(true, `${COLLAPSE_GLYPH_COLLAPSED} Expand Block`),
    `${COLLAPSE_GLYPH_COLLAPSED} Expand Block`,
  );
  assertFalse(blockOffersCollapse({ isInFlyout: true, workspace: { options: { collapse: true } }, isMovable: () => true }));
  assertFalse(blockOffersCollapse({
    collapseLocked: true,
    workspace: { options: { collapse: true } },
    isMovable: () => true,
  }));
  assert(blockOffersCollapse({
    workspace: { options: { collapse: true } },
    isMovable: () => true,
  }));
});

Deno.test("the corner glyph toggles with click and keyboard and changes with state", async () => {
  const { JSDOM } = await import("npm:jsdom@25");
  const dom = new JSDOM("<!doctype html><body></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "g");
    let collapsed = false;
    const block = {
      isInFlyout: false,
      isMovable: () => true,
      isCollapsed: () => collapsed,
      setCollapsed: (next: boolean) => {
        collapsed = next;
        syncCollapseGlyph(block as unknown as Parameters<typeof syncCollapseGlyph>[0]);
      },
      workspace: { options: { collapse: true } },
      getSvgRoot: () => root,
      getHeightWidth: () => ({ width: 80, height: 24 }),
      getField: () => null,
    };
    syncCollapseGlyph(block as unknown as Parameters<typeof syncCollapseGlyph>[0]);
    const glyph = root.querySelector(".block-collapse-glyph");
    assert(glyph, "collapsible block should grow a corner glyph");
    assertEquals(glyph.getAttribute("aria-label"), "Collapse Block");
    assertEquals(glyph.getAttribute("tabindex"), "0");
    assertEquals(glyph.querySelector("text")?.textContent, COLLAPSE_GLYPH_EXPANDED);
    glyph.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert(collapsed);
    assertEquals(glyph.getAttribute("aria-label"), "Expand Block");
    assertEquals(glyph.querySelector("text")?.textContent, COLLAPSE_GLYPH_COLLAPSED);
    glyph.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assertFalse(collapsed);
    assertEquals(glyph.querySelector("text")?.textContent, COLLAPSE_GLYPH_EXPANDED);
  } finally {
    if (previous) globalThis.document = previous;
    else delete (globalThis as { document?: Document }).document;
  }
});
