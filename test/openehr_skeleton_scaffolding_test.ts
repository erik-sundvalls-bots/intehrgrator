import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parseTemplateInput } from "ehrtslib/parser/mod.ts";
import { buildWebTemplate } from "ehrtslib/serialization/simplified/mod.ts";
import type { SkeletonNode } from "@intehrgrator/types/mod.ts";
import {
  generateSkeleton,
  generateSkeletonFromWebTemplate,
} from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";
import { loadGitHubClinicalModel } from "@intehrgrator/core/clinical_model/github_template.ts";
import { mockGithubFetch } from "./github_mock.ts";
import { buildDemoToolbox } from "@intehrgrator/blockly/toolbox_demo.ts";
import { WorkbenchController } from "@intehrgrator/workbench/controller.ts";
import type { HostAdapter } from "@intehrgrator/host/mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";

const fixture = await Deno.readTextFile(
  join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
);

interface BlockTypeTree {
  blockType: string;
  rmType: string;
  nodeId: string;
  children: BlockTypeTree[];
}

function blockTypeTree(nodes: SkeletonNode[]): BlockTypeTree[] {
  return nodes.map((node) => ({
    blockType: node.blockType,
    rmType: node.rmType,
    nodeId: node.archetypeNodeId ?? "",
    children: blockTypeTree(node.children),
  }));
}

function rmTypeWalk(nodes: SkeletonNode[]): string[] {
  return nodes.flatMap((node) => [node.rmType, ...rmTypeWalk(node.children)]);
}

function stubHost(): HostAdapter {
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
  };
}

Deno.test("Web Template target scaffolds openEHR blocks, not target_structure", () => {
  const parsed = parseTemplateInput(fixture);
  const wt = buildWebTemplate(parsed.operationalTemplate!);
  const loaded = getTargetFormatHandler("openehr-template").load(
    "bp.wt.json",
    JSON.stringify(wt),
  );
  assertEquals(loaded.format, "openehr-template");
  assertEquals(loaded.webTemplateJson, JSON.stringify(wt));
  assertEquals(loaded.skeleton[0]?.blockType, "composition");
  assertEquals(loaded.skeleton[0]?.rmType, "COMPOSITION");
  assertEquals(
    loaded.skeleton.some((n) => n.blockType === "target_structure"),
    false,
  );
  const types = rmTypeWalk(loaded.skeleton);
  assert(types.includes("OBSERVATION"));
  assert(types.includes("ELEMENT"));
});

Deno.test("OPT, Web Template, and GitHub OPT share composition/observation/element types", async () => {
  const fromOpt = generateSkeleton(fixture);
  const parsed = parseTemplateInput(fixture);
  const wtJson = JSON.stringify(buildWebTemplate(parsed.operationalTemplate!));
  const fromWt = generateSkeletonFromWebTemplate(wtJson);
  const github = await loadGitHubClinicalModel(
    "https://github.com/org/repo/blob/main/templates/blood_pressure.opt",
    { fetch: mockGithubFetch({ "templates/blood_pressure.opt": fixture }) },
  );

  assertEquals(fromOpt.skeleton[0]?.blockType, "composition");
  assertEquals(fromWt.skeleton[0]?.blockType, "composition");
  assertEquals(github.skeleton[0]?.blockType, "composition");

  const optTypes = new Set(rmTypeWalk(fromOpt.skeleton));
  const wtTypes = new Set(rmTypeWalk(fromWt.skeleton));
  const ghTypes = new Set(rmTypeWalk(github.skeleton));
  for (const required of ["COMPOSITION", "OBSERVATION", "ELEMENT", "DV_QUANTITY"]) {
    assert(optTypes.has(required), `OPT missing ${required}`);
    assert(wtTypes.has(required), `Web Template missing ${required}`);
    assert(ghTypes.has(required), `GitHub OPT missing ${required}`);
  }

  assertEquals(blockTypeTree(fromOpt.skeleton), blockTypeTree(github.skeleton));
});

Deno.test("JSON Schema toolbox includes generic JSON blocks and a schema flyout", () => {
  const target = getTargetFormatHandler("json-schema").load(
    "summary.json",
    JSON.stringify({
      $id: "patient-summary",
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    }),
  );
  const toolbox = buildDemoToolbox("en", {
    targetFormat: "json-schema",
    skeleton: target.skeleton,
  }) as { contents: Array<{ name?: string; contents?: Array<{ type?: string }> }> };
  const names = toolbox.contents.map((c) => c.name);
  assert(names.includes("JSON"));
  assert(names.includes("XML"));
  assert(names.includes("Target schema"));
  const jsonCat = toolbox.contents.find((c) => c.name === "JSON");
  const jsonTypes = jsonCat?.contents?.map((b) => b.type) ?? [];
  assert(jsonTypes.includes("json_object"));
  assert(jsonTypes.includes("json_value"));
});

Deno.test("GitHub .t.json-style fileset is stored on the project bundle", async () => {
  const controller = new WorkbenchController(stubHost(), {
    githubFetch: mockGithubFetch({ "templates/blood_pressure.opt": fixture }),
  });
  await controller.openTemplateFromUrl(
    "https://github.com/org/repo/blob/main/templates/blood_pressure.opt",
  );
  const fileset = controller.getState().target?.fileset;
  assert(fileset, "expected fileset on loaded GitHub target");
  assertEquals(fileset.files.some((f) => f.path.endsWith(".opt")), true);
  assert(fileset.rootPath.includes("blood_pressure.opt"));
});
