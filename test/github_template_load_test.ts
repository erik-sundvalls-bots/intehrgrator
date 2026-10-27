import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  DEFAULT_GITHUB_TEMPLATE_URL,
  isGitHubClinicalModelUrl,
  loadGitHubClinicalModel,
} from "@intehrgrator/core/clinical_model/github_template.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import { reloadTargetLanguage } from "@intehrgrator/core/target/format_handler.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";
import { mockGithubFetch } from "./github_mock.ts";

function stubHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    pickTextFile: async () => null,
    pickTextFilesFromDirectory: async () => null,
    pickBinaryFile: async () => null,
    downloadText: () => {},
    downloadBytes: () => {},
    copyToClipboard: async () => {},
    readClipboard: async () => "",
    saveAutosave: async () => {},
    saveManualSave: async () => {},
    loadStoredProjectRecord: async () => null as StoredProjectRecord | null,
    listLoadableProjects: async () => [] as LoadableProjectEntry[],
    resolveAppUrl: (path) => path,
    fetchTextUrl: () => Promise.reject(new Error("fetchTextUrl not stubbed")),
    ...overrides,
  };
}

Deno.test("isGitHubClinicalModelUrl accepts blob and raw .t.json / .opt links", () => {
  assertEquals(isGitHubClinicalModelUrl(DEFAULT_GITHUB_TEMPLATE_URL), true);
  assertEquals(
    isGitHubClinicalModelUrl(
      "https://raw.githubusercontent.com/org/repo/main/local/templates/bp.opt",
    ),
    true,
  );
  assertEquals(isGitHubClinicalModelUrl("https://example.test/bp.opt"), false);
  assertEquals(
    isGitHubClinicalModelUrl("https://github.com/org/repo/blob/main/README.md"),
    false,
  );
});

Deno.test("loadGitHubClinicalModel fetches an OPT from GitHub and builds a skeleton", async () => {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const url = "https://github.com/org/repo/blob/main/templates/blood_pressure.opt";
  const loaded = await loadGitHubClinicalModel(url, {
    fetch: mockGithubFetch({ "templates/blood_pressure.opt": opt }),
  });
  assertEquals(loaded.fetched, 1);
  assertEquals(loaded.filename, "blood_pressure.opt");
  assert(loaded.templateId.includes("blood_pressure"));
  assert(loaded.skeleton.length > 0);
  assertStringIncludes(loaded.optXml, "template");
  assertEquals(loaded.fileset.files.some((f) => f.path.endsWith("blood_pressure.opt")), true);
  const wt = JSON.parse(loaded.webTemplateJson) as { templateId?: string; tree?: unknown };
  assert(wt.tree, "web template JSON should include a tree for schema load");
});

Deno.test("controller openTemplateFromUrl uses GitHub clinical-model closure for .opt blob URLs", async () => {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const url = "https://github.com/org/repo/blob/main/templates/blood_pressure.opt";
  const controller = new WorkbenchController(stubHost(), {
    githubFetch: mockGithubFetch({ "templates/blood_pressure.opt": opt }),
  });
  await controller.openTemplateFromUrl(url);
  const state = controller.getState();
  assert(state.templateId.includes("blood_pressure"));
  assert(state.skeleton.length > 0);
  assertStringIncludes(state.statusMessage, "GitHub template");
});

const SHARED_ARCHETYPE_ID = "openEHR-EHR-CLUSTER.symptom_sign.v1";
const QUESTION_NODE_ID = "at0005.1";

/** ChemoForm-style root: CLUSTER slots whose archetypeRef is a Better template id. */
function chemoFormStyleRoot(): string {
  return JSON.stringify({
    "@type": "TEMPLATE",
    "templateId": "ChemoForm-MBA.v8",
    "archetypeId": {
      "@type": "ARCHETYPE_HRID",
      "value": "openEHR-EHR-COMPOSITION.chemo_form.v1",
    },
    "definition": {
      "@type": "C_COMPLEX_OBJECT",
      "rmTypeName": "COMPOSITION",
      "nodeId": "at0000",
      "attributes": [{
        "@type": "C_ATTRIBUTE",
        "rmAttributeName": "content",
        "children": [
          templateSlot("at0039.1", "ChemoQ-fatigue"),
          templateSlot("at0039.2", "ChemoQ-weight"),
        ],
      }],
    },
  });
}

function templateSlot(nodeId: string, templateId: string): Record<string, unknown> {
  return {
    "@type": "C_ARCHETYPE_ROOT",
    "rmTypeName": "CLUSTER",
    "occurrences": "0..1",
    "nodeId": nodeId,
    "archetypeRef": templateId,
    "referenceType": "templateId",
  };
}

/**
 * Two embedded templates share one archetype id (as the ChemoQ symptom
 * templates do) but carry different question text.
 */
function symptomTemplate(
  templateId: string,
  labels: { enConcept: string; enQuestion: string; svConcept: string; svQuestion: string },
): string {
  return JSON.stringify({
    "@type": "TEMPLATE",
    "templateId": templateId,
    "archetypeId": {
      "@type": "ARCHETYPE_HRID",
      "value": SHARED_ARCHETYPE_ID,
    },
    "definition": {
      "@type": "C_COMPLEX_OBJECT",
      "rmTypeName": "CLUSTER",
      "nodeId": "at0000.1",
      "attributes": [{
        "@type": "C_ATTRIBUTE",
        "rmAttributeName": "items",
        "children": [{
          "@type": "C_COMPLEX_OBJECT",
          "rmTypeName": "ELEMENT",
          "nodeId": QUESTION_NODE_ID,
        }],
      }],
    },
    "terminology": {
      "@type": "ARCHETYPE_TERMINOLOGY",
      "termDefinitions": {
        "en": {
          "at0000.1": { "text": labels.enConcept, "code": "at0000.1" },
          [QUESTION_NODE_ID]: { "text": labels.enQuestion, "code": QUESTION_NODE_ID },
        },
        "sv": {
          "at0000.1": { "text": labels.svConcept, "code": "at0000.1" },
          [QUESTION_NODE_ID]: { "text": labels.svQuestion, "code": QUESTION_NODE_ID },
        },
      },
    },
  });
}

function nodesWithArchetypeId(nodes: SkeletonNode[], id: string): SkeletonNode[] {
  const found: SkeletonNode[] = [];
  const walk = (list: SkeletonNode[]) => {
    for (const node of list) {
      if (node.archetypeNodeId === id) found.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

Deno.test("GitHub .t.json load scaffolds embedded templates referenced by template id", async () => {
  const url =
    "https://github.com/org/repo/blob/chemotherapy-symptoms/local/ChemoForm-MBA.v8.t.json";
  const root = chemoFormStyleRoot();
  const fatigue = symptomTemplate("ChemoQ-fatigue", {
    enConcept: "Fatigue",
    enQuestion: "Do you experience fatigue that affects your daily life?",
    svConcept: "Trötthet",
    svQuestion: "Upplever du trötthet som påverkar ditt dagliga liv?",
  });
  const weight = symptomTemplate("ChemoQ-weight", {
    enConcept: "Weight",
    enQuestion: "Have your weight changed in recent weeks?",
    svConcept: "Vikt",
    svQuestion: "Har din vikt förändrats de senaste veckorna?",
  });
  const files = {
    "local/ChemoForm-MBA.v8.t.json": root,
    "local/ChemoQ-fatigue.t.json": fatigue,
    "local/ChemoQ-weight.t.json": weight,
  };
  const rootOnly = await loadGitHubClinicalModel(url, {
    fetch: mockGithubFetch({ "local/ChemoForm-MBA.v8.t.json": root }),
  });
  assertEquals(
    nodesWithArchetypeId(rootOnly.skeleton, QUESTION_NODE_ID).length,
    0,
    "root file alone has no embedded question",
  );

  const loaded = await loadGitHubClinicalModel(url, {
    fetch: mockGithubFetch(files),
  });
  assertEquals(loaded.templateId, "ChemoForm-MBA.v8");
  assert(loaded.fetched >= 3, `expected nested template fetch, got ${loaded.fetched}`);
  const fatigueCluster = clusterByNodeId(loaded.skeleton, "at0039.1");
  const weightCluster = clusterByNodeId(loaded.skeleton, "at0039.2");
  assertEquals(fatigueCluster?.label, "Fatigue");
  assertEquals(questionLabel(fatigueCluster), "Do you experience fatigue that affects your daily life?");
  assertEquals(weightCluster?.label, "Weight");
  assertEquals(questionLabel(weightCluster), "Have your weight changed in recent weeks?");
  assert(
    loaded.warnings.every((warning) => !/ChemoQ-/.test(warning)),
    `nested template stayed unresolved: ${loaded.warnings.join("; ")}`,
  );

  const swedish = reloadTargetLanguage({
    format: "openehr-template",
    filename: loaded.filename,
    targetId: loaded.templateId,
    content: loaded.optXml,
    skeleton: loaded.skeleton,
    fileset: loaded.fileset,
    webTemplateJson: loaded.webTemplateJson,
    language: loaded.language,
    languages: loaded.languages,
  }, "sv");
  assertEquals(clusterByNodeId(swedish.skeleton, "at0039.1")?.label, "Trötthet");
  assertEquals(
    questionLabel(clusterByNodeId(swedish.skeleton, "at0039.1")),
    "Upplever du trötthet som påverkar ditt dagliga liv?",
  );
  assertEquals(clusterByNodeId(swedish.skeleton, "at0039.2")?.label, "Vikt");
});

function clusterByNodeId(nodes: SkeletonNode[], id: string): SkeletonNode | undefined {
  return nodesWithArchetypeId(nodes, id).find((node) => node.rmType === "CLUSTER");
}

function questionLabel(cluster: SkeletonNode | undefined): string | undefined {
  return cluster?.children.find((node) =>
    node.rmType === "ELEMENT" && node.archetypeNodeId === QUESTION_NODE_ID
  )?.label;
}

Deno.test("controller loadSchemaFromUrl uses GitHub clinical-model closure for schema", async () => {
  const opt = await Deno.readTextFile(
    join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
  );
  const url = "https://github.com/org/repo/blob/main/templates/blood_pressure.opt";
  const controller = new WorkbenchController(stubHost(), {
    githubFetch: mockGithubFetch({ "templates/blood_pressure.opt": opt }),
  });
  await controller.loadSchemaFromUrl(url);
  const state = controller.getState();
  assertEquals(state.schemaError, null);
  assert(state.schemaTree);
  assertEquals(state.schemaFormat, "openehr-web-template");
});

Deno.test("GitHub OPT in sv: labels in Swedish, Web Template ids from the original language (#289)", async () => {
  const opt = await Deno.readTextFile(join(import.meta.dirname!, "fixtures", "simple-diagnose-and-vitals.opt"));
  const url = "https://github.com/org/repo/blob/main/templates/sdv.opt";
  const loaded = await loadGitHubClinicalModel(url, {
    fetch: mockGithubFetch({ "templates/sdv.opt": opt }),
    language: "sv",
  });
  assertEquals(loaded.language, "sv");
  type Node = { id: string; name?: string; children?: Node[] };
  const find = (n: Node): Node | undefined => n.id === "systolic" ? n : n.children?.map(find).find(Boolean);
  const systolic = find((JSON.parse(loaded.webTemplateJson) as { tree: Node }).tree);
  assert(systolic, "id from the English original");
  assertEquals(systolic.name, "Systoliskt");
});
