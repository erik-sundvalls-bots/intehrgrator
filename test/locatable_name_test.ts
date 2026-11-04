import { assertEquals } from "@std/assert";
// An older Karda canvas showed the Swedish term "Identifierare" on the Organisationsnummer block (F-M12).
import { outputLocatableName } from "../src/core/openehr/rm_archetype_node_id.ts";

const node = { label: "Identifier", primaryName: "Identifierare", nameConstraint: "Organisationsnummer" };

Deno.test("outputLocatableName: a block showing the label or the primary term uses the name constraint", () => {
  assertEquals(outputLocatableName("Identifier", node), "Organisationsnummer");
  assertEquals(outputLocatableName("Identifierare", node), "Organisationsnummer");
});

Deno.test("outputLocatableName: a renamed block keeps its name", () => {
  assertEquals(outputLocatableName("HSA-id", node), "HSA-id");
  assertEquals(outputLocatableName("HSA-id", undefined), "HSA-id");
});
