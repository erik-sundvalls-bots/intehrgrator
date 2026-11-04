/**
 * Output names do not follow the UI / 💬 language: a node the user has not
 * renamed gets the template's name constraint, else the term in the template's
 * primary language (lang.1; OPT 1.4 top-level `<language>`). Regression: the
 * Karda unmapped sets had 76 validation messages with an English UI, 24 with a
 * Swedish one.
 */
import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";
import {
  outputLocatableName,
  rmLocatableName,
} from "@intehrgrator/core/openehr/rm_archetype_node_id.ts";
import type { TestResult } from "@intehrgrator/types/mod.ts";

const catalogPath = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "examples",
  "example-sets.json",
);

async function validationMessages(
  setId: string,
  uiLanguage: string,
): Promise<{ lang: string; paths: string[] }> {
  const service = new WorkbenchService();
  const controller = (service as unknown as {
    controller: {
      setUiLanguage(code: string): void;
      getState(): { modelLanguage: string | null };
    };
  }).controller;
  controller.setUiLanguage(uiLanguage);
  await callAgentTool(service, "register_agent", {
    agentId: `names-${uiLanguage}`,
    displayName: "names",
  });
  await callAgentTool(service, "load_example_set", {
    catalogPath,
    setId,
    includeMapping: true,
  });
  const tree = await callAgentTool(service, "get_source_tree", {}) as {
    examples: Array<{ id: string }>;
  };
  const paths: string[] = [];
  for (const ex of tree.examples) {
    await callAgentTool(service, "set_active_example", { id: ex.id });
    const result = (await callAgentTool(service, "run_test", {
      outputMode: "typescript",
    }) as {
      testResult: TestResult;
    }).testResult;
    for (const m of result.outputValidation?.messages ?? []) {
      paths.push(`${m.path} ${m.message}`);
    }
  }
  return { lang: controller.getState().modelLanguage ?? "", paths };
}

Deno.test("rmLocatableName: name constraint, then primary-language term, then label", () => {
  assertEquals(
    rmLocatableName({
      nameConstraint: "Vårdenhet",
      primaryName: "Vårdgivare",
      label: "Care unit",
    }),
    "Vårdenhet",
  );
  assertEquals(
    rmLocatableName({
      primaryName: "Läkemedelsordination",
      label: "Medication order",
    }),
    "Läkemedelsordination",
  );
  assertEquals(
    rmLocatableName({ label: "Medication order" }),
    "Medication order",
  );
  // A block the user renamed keeps its name.
  const node = {
    primaryName: "Läkemedelsordination",
    label: "Medication order",
  };
  assertEquals(
    outputLocatableName("Medication order", node),
    "Läkemedelsordination",
  );
  assertEquals(outputLocatableName("My order", node), "My order");
});

for (
  const setId of [
    "karda-ordinationsdata-to-openehr-flat-unmapped",
    "karda-administreringsdata-to-openehr-flat-unmapped",
  ]
) {
  Deno.test(`${setId}: the same validation result with an English or a Swedish UI, no name errors`, async () => {
    const en = await validationMessages(setId, "en");
    const sv = await validationMessages(setId, "sv");
    assertEquals(en.lang, "en", "the English UI shows English labels");
    assertEquals(sv.lang, "sv");
    assertEquals(en.paths, sv.paths);
    assertEquals(en.paths.filter((p) => p.includes("/name/value")), []);
    // Unmapped RM-mandatory attributes (setting, description, …) are expected in an
    // unmapped set since strict RM validation (ehrtslib #217/#219); cap the rest.
    const other = en.paths.filter((p) =>
      !/required by RM specification|Required attribute missing/.test(p)
    );
    assert(other.length <= 24, `${other.length} messages:\n${other.join("\n")}`);
  });
}
