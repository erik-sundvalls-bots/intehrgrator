/** Behaviour intehrgrator relies on from ehrtslib v0.7. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { collectValueSlots, generateSkeleton } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { validateConvertedOutput } from "@intehrgrator/core/output/template_validation.ts";

const VITALS = join(import.meta.dirname!, "fixtures", "simple-diagnose-and-vitals.opt");

Deno.test("unpatched v0.7 validator: /min units, no EVENT.offset and no omitted protocol/state are not errors (ehrtslib #198, #199, #200)", async () => {
  const opt = await Deno.readTextFile(VITALS);
  const { skeleton } = generateSkeleton(opt);
  const target = { format: "openehr-template" as const, filename: "v.opt", targetId: "v", content: opt, skeleton };
  const quantities = collectValueSlots(skeleton).filter((s) => s.fixedFields?.units);
  assert(quantities.some((s) => s.fixedFields?.units === "/min"));
  const output = getTargetFormatHandler("openehr-template").render({
    definition: target,
    slotValues: Object.fromEntries(quantities.map((s) => [s.slotId, 60])),
  });
  const text = JSON.stringify(output);
  assert(text.includes('"units":"/min"'));
  assertEquals(text.includes('"offset"'), false);
  const messages = validateConvertedOutput(output, target, { deserializeMode: "hybrid" }).messages
    .map((m) => `${m.path}: ${m.message}`);
  const unexpected = messages.filter((m) => /unit|ucum|offset|protocol|\/state/i.test(m));
  assertEquals(unexpected, []);
});
