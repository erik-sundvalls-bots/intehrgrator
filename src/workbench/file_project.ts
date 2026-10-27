import type { ConversionScriptLanguage, ProjectBundle } from "../types/mod.ts";
import { isConversionScriptLanguage } from "../types/mod.ts";
import { createFsHostAdapter } from "../host/fs_adapter.ts";
import { generate } from "../core/codegen/mod.ts";
import { runTest } from "../core/test_runner/mod.ts";
import { detectSourceFormat } from "../core/source/mod.ts";
import {
  instanceShapeForEncoding,
  preferredInstanceEncoding,
} from "../core/output/instance_encoding.ts";
import { validateModel } from "../core/mapping_model/mod.ts";
import { WorkbenchController } from "./controller.ts";
import {
  adoptBlocklyState,
  scaffoldBlocklyFromSkeleton,
} from "./blockly_sync.ts";

/** Paths are relative to the folder containing intehrgrator.json. */
export interface FileProjectManifest {
  version: 1;
  mapping: string;
  target: string;
  source: { examples: string; schema?: string };
  output: {
    directory: string;
    script: { language: ConversionScriptLanguage; path: string };
  };
  previewDefaults?: Record<string, unknown>;
}

export interface FileProjectFiles {
  readText(path: string): Promise<string>;
  /** JSON/XML paths relative to source.examples, including subdirectories. */
  listExamples(directory: string): Promise<string[]>;
}

export interface FileProject {
  manifest: FileProjectManifest;
  bundle: ProjectBundle;
}

export interface ProjectArtifact {
  path: string;
  content: string;
}

export function projectPath(value: unknown): string {
  if (
    typeof value !== "string" || !value || /[\\:\0]/.test(value) ||
    value.startsWith("/")
  ) {
    throw new Error(`Expected a relative project path: ${String(value)}`);
  }
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.includes("..")) {
    throw new Error(`Path leaves the project: ${value}`);
  }
  return parts.join("/");
}

export function parseFileProject(text: string): FileProjectManifest {
  const raw = JSON.parse(text);
  if (raw?.version !== 1) {
    throw new Error("Unsupported file project version (expected 1)");
  }
  if (!isConversionScriptLanguage(raw.output?.script?.language ?? "")) {
    throw new Error(
      "Choose an output.script.language supported by intEHRgrator",
    );
  }
  const mapping = projectPath(raw.mapping);
  const manifest: FileProjectManifest = {
    version: 1,
    mapping,
    target: projectPath(raw.target),
    source: {
      examples: projectPath(raw.source?.examples),
      ...(raw.source?.schema ? { schema: projectPath(raw.source.schema) } : {}),
    },
    output: {
      directory: projectPath(raw.output.directory),
      script: {
        language: raw.output.script.language,
        path: projectPath(raw.output.script.path),
      },
    },
    ...(raw.previewDefaults ? { previewDefaults: raw.previewDefaults } : {}),
  };
  const inputs = [
    "intehrgrator.json",
    mapping,
    manifest.target,
    manifest.source.schema,
  ]
    .filter((path): path is string => Boolean(path));
  const output = manifest.output.directory.toLowerCase();
  if (
    new Set(inputs.map((path) => path.toLowerCase())).size !== inputs.length ||
    inputs.some((path) =>
      path.toLowerCase() === output ||
      path.toLowerCase().startsWith(output + "/")
    ) ||
    inputs.some((path) =>
      path.toLowerCase() === manifest.output.script.path.toLowerCase()
    ) ||
    output === manifest.source.examples.toLowerCase() ||
    output.startsWith(manifest.source.examples.toLowerCase() + "/") ||
    manifest.source.examples.toLowerCase().startsWith(output + "/")
  ) {
    throw new Error(
      "Project inputs and generated output must use separate paths",
    );
  }
  if (!manifest.output.script.path.toLowerCase().startsWith(output + "/")) {
    throw new Error("The generated script must be inside output.directory");
  }
  const script = manifest.output.script.path.toLowerCase();
  if (
    script === `${output}/status.json` || script === `${output}/examples` ||
    script.startsWith(`${output}/examples/`)
  ) {
    throw new Error(
      "The generated script cannot use a reserved result/status path",
    );
  }
  return manifest;
}

/** The same loader is used by the extension and the Deno/CI runner. */
export async function loadFileProject(
  manifestText: string,
  files: FileProjectFiles,
): Promise<FileProject> {
  const manifest = parseFileProject(manifestText);
  const controller = new WorkbenchController(createFsHostAdapter());
  if (controller.getState().settings.autoplay) controller.toggleAutoplay();
  try {
    controller.loadTemplateContent(
      manifest.target,
      await files.readText(manifest.target),
    );
    if (manifest.source.schema) {
      controller.loadSchemaContent(
        manifest.source.schema,
        await files.readText(manifest.source.schema),
      );
      if (controller.getState().schemaError) {
        throw new Error(controller.getState().schemaError!);
      }
    }
    const examples: ProjectBundle["examples"] = [];
    for (
      const path of (await files.listExamples(manifest.source.examples)).sort()
    ) {
      const name = projectPath(path);
      const content = await files.readText(
        `${manifest.source.examples}/${name}`,
      );
      examples.push({
        id: name,
        filename: name,
        content,
        format: detectSourceFormat(name, content),
      });
    }
    applyProjectMapping(controller, await files.readText(manifest.mapping));
    const bundle = controller.exportDocumentSnapshot();
    bundle.examples = examples;
    bundle.activeExampleId = examples[0]?.id ?? null;
    // Session ids, timestamps and history do not belong in the mapping file.
    bundle.projectId = manifest.mapping;
    return { manifest, bundle };
  } finally {
    controller.newProject();
  }
}

function applyProjectMapping(
  controller: WorkbenchController,
  text: string,
): void {
  const state = controller.getState();
  const document = JSON.parse(text);
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Mapping must be a Blockly workspace JSON object");
  }
  if (document.blocklyState !== undefined && document.version !== 1) {
    throw new Error("Unsupported mapping document version");
  }
  const mapping = document.blocklyState ?? document;
  const { blocklyState, extract } = Object.keys(mapping).length
    ? adoptBlocklyState(mapping, state.skeleton, {
      targetFormat: state.target?.format,
    })
    : scaffoldBlocklyFromSkeleton(state.skeleton, state.model, {
      targetFormat: state.target?.format,
    });
  controller.syncFromBlockly(
    blocklyState,
    extract.slots,
    extract.loops,
    extract.optionalRm,
    {
      notify: false,
      targetSignature: extract.targetSignature,
      unsupported: extract.unsupported,
      sheetNames: extract.sheetNames,
      instanceEncodings: extract.instanceEncodings,
      functions: extract.functions,
    },
  );
  controller.replaceSheets(document.sheets ?? []);
}

/** Preserve pending canvas edits when source/target files refresh. */
export function rebaseProjectMapping(
  bundle: ProjectBundle,
  text: string,
): ProjectBundle {
  const controller = new WorkbenchController(createFsHostAdapter());
  if (controller.getState().settings.autoplay) controller.toggleAutoplay();
  try {
    controller.restoreDocumentSnapshot(bundle);
    applyProjectMapping(controller, text);
    return controller.exportDocumentSnapshot();
  } finally {
    controller.newProject();
  }
}

export function projectMapping(bundle: ProjectBundle): string {
  return projectJson({
    version: 1,
    blocklyState: bundle.mapping.blocklyState,
    sheets: bundle.mapping.sheets ?? [],
  });
}

/** Stable JSON key order, preserving array order and every clinical value. */
export function projectJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [key, entry[key]]),
      );
    }
    return entry;
  }, 2) + "\n";
}

/** Incomplete mappings still produce reviewable output; failures replace stale results. */
export function generateProjectArtifacts(
  project: FileProject,
): ProjectArtifact[] {
  const { manifest, bundle } = project;
  const { model, blocklyState, sheets } = bundle.mapping;
  const artifacts: ProjectArtifact[] = [];
  const diagnostics: Record<string, unknown> = {
    mappingIssues: validateModel(model, bundle.target?.skeleton ?? []),
    examples: {},
  };
  try {
    artifacts.push({
      path: manifest.output.script.path,
      content: generate(model, manifest.output.script.language, {
        blocklyState,
        skeleton: bundle.target?.skeleton,
        webTemplateJson: bundle.target?.webTemplateJson,
        instanceShape: instanceShapeForEncoding(
          preferredInstanceEncoding(model),
        ),
      }).replace(/\r\n/g, "\n"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.scriptError = message;
    artifacts.push({
      path: manifest.output.script.path,
      content: `// Generation failed: ${message}\n`,
    });
  }
  const examples: Record<string, unknown> = {};
  for (const example of bundle.examples) {
    const result = runTest(model, example.content, example.format, {
      target: bundle.target,
      blocklyState,
      sheets,
      defaults: manifest.previewDefaults,
      outputMode: "preview",
    });
    const output = result.output;
    const extension = typeof output === "string"
      ? (/^\s*</.test(output) ? "xml" : "txt")
      : "json";
    const name = example.filename.replace(/\.(json|xml)$/i, "");
    // A fixed JSON envelope on failure prevents an old successful file masquerading as current.
    artifacts.push({
      path: `${manifest.output.directory}/examples/${name}.${extension}`,
      content: output === undefined
        ? projectJson({ error: result.error ?? "No output", status: "failed" })
        : typeof output === "string"
        ? output.replace(/\r\n/g, "\n") + (output.endsWith("\n") ? "" : "\n")
        : projectJson(output),
    });
    examples[example.filename] = {
      ok: result.ok,
      warnings: result.warnings,
      ...(result.error ? { error: result.error } : {}),
      ...(result.outputValidation
        ? { validation: result.outputValidation }
        : {}),
    };
  }
  diagnostics.examples = examples;
  diagnostics.artifacts = artifacts.map((artifact) => artifact.path).sort();
  artifacts.push({
    path: `${manifest.output.directory}/status.json`,
    content: projectJson(diagnostics),
  });
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const path = projectPath(artifact.path).toLowerCase();
    if (seen.has(path)) {
      throw new Error(`Generated output path collision: ${artifact.path}`);
    }
    seen.add(path);
  }
  return artifacts;
}

export interface ProjectOutputFiles {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

async function previousArtifacts(
  files: ProjectOutputFiles,
  statusPath: string,
): Promise<string[]> {
  try {
    const status = JSON.parse(await files.readText(statusPath));
    return Array.isArray(status.artifacts)
      ? status.artifacts.filter((path: unknown): path is string =>
        typeof path === "string"
      )
      : [];
  } catch {
    return [];
  }
}

function isOwnedResult(path: string, directory: string): boolean {
  try {
    return path.startsWith(`${directory}/examples/`) &&
      projectPath(path) === path;
  } catch {
    return false;
  }
}

export async function updateFileProject(
  manifestText: string,
  files: FileProjectFiles & ProjectOutputFiles,
): Promise<ProjectArtifact[]> {
  const manifest = parseFileProject(manifestText);
  try {
    return await writeProjectArtifacts(
      await loadFileProject(manifestText, files),
      files,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusPath = `${manifest.output.directory}/status.json`;
    const previous = await previousArtifacts(files, statusPath);
    await files.writeText(
      statusPath,
      projectJson({ status: "failed", error: message, artifacts: previous }),
    );
    for (const path of previous) {
      if (
        isOwnedResult(path, manifest.output.directory)
      ) {
        await files.remove(path);
      }
    }
    await files.writeText(
      manifest.output.script.path,
      `// Generation failed: ${message.replaceAll("\n", "\n// ")}\n`,
    );
    throw error;
  }
}

/** Only remove obsolete result files recorded by the previous run, inside the output folder. */
export async function writeProjectArtifacts(
  project: FileProject,
  files: ProjectOutputFiles,
): Promise<ProjectArtifact[]> {
  const artifacts = generateProjectArtifacts(project);
  const statusPath = `${project.manifest.output.directory}/status.json`;
  const previous = await previousArtifacts(files, statusPath);
  const owned = [
    ...new Set([...previous, ...artifacts.map((artifact) => artifact.path)]),
  ].sort();
  await files.writeText(
    statusPath,
    projectJson({ status: "updating", artifacts: owned }),
  );
  const current = new Set(artifacts.map((artifact) => artifact.path));
  for (const path of previous) {
    if (
      isOwnedResult(path, project.manifest.output.directory) &&
      !current.has(path)
    ) await files.remove(path);
  }
  for (const artifact of artifacts) {
    await files.writeText(artifact.path, artifact.content);
  }
  return artifacts;
}
