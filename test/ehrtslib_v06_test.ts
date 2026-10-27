/** Behaviour intehrgrator relies on from ehrtslib v0.6. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { collectValueSlots, generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { validateConvertedOutput } from "@intehrgrator/core/output/template_validation.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";

const BP = join(import.meta.dirname!, "fixtures", "blood_pressure.opt");

const BROKEN_ADL = `archetype (adl_version=2.0.6; rm_release=1.1.0)
    openEHR-EHR-OBSERVATION.broken.v1.0.0
language
    original_language = <[ISO_639-1::en]>
definition
    OBSERVATION[id1] matches {
        data matches {{{ ]]]
    }
terminology
    term_definitions = <>
`;

Deno.test("validation paths use the RM shape /content[0]/… (ehrtslib #184)", async () => {
  const opt = await Deno.readTextFile(BP);
  const { skeleton } = generateSkeleton(opt);
  const target = { format: "openehr-template" as const, filename: "blood_pressure.opt", targetId: "bp", content: opt, skeleton };
  const systolic = collectValueSlots(skeleton).find((s) => s.slotId.endsWith("at0004/value/value/value"))!;
  const output = getTargetFormatHandler("openehr-template").render({ definition: target, slotValues: { [systolic.slotId]: 120 } });
  const bad = JSON.parse(JSON.stringify(output).replace('"mm[Hg]"', '"furlong"'));
  const units = validateConvertedOutput(bad, target, { deserializeMode: "hybrid" }).messages
    .find((m) => m.message.includes("furlong"));
  assert(units, "unit error");
  assertStringIncludes(units.path, "/content[0]/data/events[0]/data/items[0]/value");
  assertEquals(units.path.includes("/["), false);
  assert(units.line, "line found from the path");
});

Deno.test("a target whose ADL has a fatal cADL error fails to load with the parser's message (ehrtslib #113)", async () => {
  const controller = new WorkbenchController({
    pickTextFile: () => Promise.resolve({ name: "broken.adls", text: BROKEN_ADL }),
  } as unknown as HostAdapter);
  await controller.openTemplate();
  const status = controller.getState().statusMessage;
  assertStringIncludes(status, "Target load failed:");
  assertStringIncludes(status, "fatal cADL error");
  assert(!controller.getState().templateId, "no target loaded");
});
