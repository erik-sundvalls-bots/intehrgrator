/**
 * #246 part 5: Auto-run is on by default, shared by all test files, and a
 * user's Pause is not undone (or forced) by a loaded Project Bundle.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";

function stubHost(): HostAdapter {
  return new Proxy({}, {
    get: () => () => Promise.resolve(null),
  }) as unknown as HostAdapter;
}

const fixture = (...p: string[]) => Deno.readTextFile(join(import.meta.dirname!, "fixtures", ...p));

Deno.test("Auto-run is on by default and marks every test file after an edit", async () => {
  const controller = new WorkbenchController(stubHost());
  assertEquals(controller.getState().settings.autoplay, true);
  controller.loadTemplateContent("blood_pressure.opt", await fixture("blood_pressure.opt"));
  controller.addExampleContent("a.json", await fixture("legacy-simulated-json", "instances", "bp-inst.json"));
  controller.addExampleContent("b.json", await fixture("legacy-simulated-json", "instances", "bp-inst.json"));
  controller.setExportTarget("preview");
  const state = controller.getState();
  for (const ex of state.examples) {
    assert(state.outputValidations[ex.id]?.applicable, `${ex.filename} has a mark`);
  }
});

Deno.test("Pause survives a project load; old bundles cannot force a hidden validation preset", () => {
  const controller = new WorkbenchController(stubHost());
  controller.toggleAutoplay();
  assertEquals(controller.getState().settings.autoplay, false);
  const bundle = controller.exportDocumentSnapshot();
  bundle.settings = { ...bundle.settings, autoplay: true, openEhrJsonDeserializeMode: "canonical-strict" };
  controller.restoreDocumentSnapshot(bundle);
  assertEquals(controller.getState().settings.autoplay, false);
  assertEquals(controller.getState().settings.openEhrJsonDeserializeMode, "hybrid");
});
