import type {
  ConversionScriptLanguage,
  FileLanguageSettings,
  ProjectBundle,
} from "../types/mod.ts";
import { isConversionScriptLanguage } from "../types/mod.ts";
import { createFsHostAdapter } from "../host/fs_adapter.ts";
import { generate } from "../core/codegen/mod.ts";
import { runTest } from "../core/test_runner/mod.ts";
import { detectSourceFormat } from "../core/source/mod.ts";
import {
  idLanguageChoices,
  normalizeIdLanguage,
  PRIMARY_ID_LANGUAGE,
} from "../core/target/id_language.ts";
import { targetOriginalLanguage } from "../core/languages.ts";
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

export interface FileProjectFile {
  path: string;
  languageSettings?: FileLanguageSettings;
}

export type FileProjectReference = string | FileProjectFile;

export interface FileProjectTarget extends FileProjectFile {
  /** Complete local closure, including path itself. */
  files?: string[];
}

export interface FileProjectMetadata {
  target?: FileLanguageSettings;
  sourceSchema?: FileLanguageSettings;
  /** Source languages and label language when there is no Source Schema (`source.languageSettings`). */
  source?: FileLanguageSettings;
}

/** Paths are relative to the folder containing intehrgrator.json. */
export interface FileProjectManifest {
  version: 1;
  mapping: string;
  target: string | FileProjectTarget;
  source: {
    examples: string;
    schema?: FileProjectReference;
    /** Used only without a Source Schema; with a schema the settings live on `source.schema`. */
    languageSettings?: FileLanguageSettings;
  };
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
  targetWarnings?: string[];
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

/** Paths the runner writes: no `.git`, `.vscode` or other dot-folders/files. */
function writablePath(value: unknown): string {
  const path = projectPath(value);
  if (path.split("/").some((part) => part.startsWith("."))) {
    throw new Error(`Generated and mapping files cannot be in a dot-folder: ${path}`);
  }
  return path;
}

export function projectFilePath(file: FileProjectReference): string {
  return typeof file === "string" ? file : file.path;
}

export function projectTargetPaths(
  target: FileProjectManifest["target"],
): string[] {
  return typeof target === "string" ? [target] : target.files ?? [target.path];
}

function languageSettings(value: unknown): FileLanguageSettings | undefined {
  if (value === undefined) return undefined;
  if (
    !value || typeof value !== "object" || !("languages" in value) ||
    !Array.isArray(value.languages) ||
    value.languages.some((l) => typeof l !== "string" || !l)
  ) {
    throw new Error(
      "languageSettings.languages must be an array of language codes",
    );
  }
  const optional = (name: "idLanguage" | "labelLanguage") => {
    if (!(name in value)) return {};
    const entry: unknown = Reflect.get(value, name);
    if (typeof entry !== "string" || !entry) {
      throw new Error(`Invalid languageSettings.${name}`);
    }
    return { [name]: entry };
  };
  return {
    languages: [...value.languages],
    ...optional("idLanguage"),
    ...optional("labelLanguage"),
  };
}

function parseReference(value: unknown): FileProjectReference {
  if (typeof value === "string") return projectPath(value);
  if (!value || typeof value !== "object" || !("path" in value)) {
    throw new Error(
      "Expected a project file path or { path, languageSettings }",
    );
  }
  const settings = languageSettings(
    "languageSettings" in value ? value.languageSettings : undefined,
  );
  return {
    path: projectPath(value.path),
    ...(settings ? { languageSettings: settings } : {}),
  };
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
  const mapping = writablePath(raw.mapping);
  const target = parseReference(raw.target);
  if (typeof target !== "string" && raw.target.files !== undefined) {
    if (!Array.isArray(raw.target.files)) {
      throw new Error("target.files must list the complete target fileset");
    }
    const paths = raw.target.files.map(projectPath);
    if (
      !paths.includes(target.path) ||
      new Set(paths.map((p: string) => p.toLowerCase())).size !== paths.length
    ) {
      throw new Error(
        "target.files must include its root path and contain no duplicate paths",
      );
    }
    (target as FileProjectTarget).files = paths;
  }
  const manifest: FileProjectManifest = {
    version: 1,
    mapping,
    target,
    source: {
      examples: projectPath(raw.source?.examples),
      ...(raw.source?.schema
        ? { schema: parseReference(raw.source.schema) }
        : {}),
      ...(raw.source?.languageSettings !== undefined
        ? { languageSettings: languageSettings(raw.source.languageSettings) }
        : {}),
    },
    output: {
      directory: writablePath(raw.output.directory),
      script: {
        language: raw.output.script.language,
        path: writablePath(raw.output.script.path),
      },
    },
    ...(raw.previewDefaults ? { previewDefaults: raw.previewDefaults } : {}),
  };
  const inputs = [
    "intehrgrator.json",
    mapping,
    ...projectTargetPaths(manifest.target),
    manifest.source.schema
      ? projectFilePath(manifest.source.schema)
      : undefined,
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
    let targetWarnings: string[] = [];
    if (typeof manifest.target === "object" && manifest.target.files) {
      const targetFiles = [];
      for (const path of manifest.target.files) {
        targetFiles.push({ path, content: await files.readText(path) });
      }
      targetWarnings = controller.loadTargetFileset({
        rootPath: manifest.target.path,
        files: targetFiles,
      });
    } else {
      controller.loadTemplateContent(
        projectFilePath(manifest.target),
        await files.readText(projectFilePath(manifest.target)),
      );
    }
    if (manifest.source.schema) {
      controller.loadSchemaContent(
        projectFilePath(manifest.source.schema),
        await files.readText(projectFilePath(manifest.source.schema)),
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
    const metadata: FileProjectMetadata = {
      target: typeof manifest.target === "string"
        ? undefined
        : manifest.target.languageSettings,
      sourceSchema: typeof manifest.source.schema === "object"
        ? manifest.source.schema.languageSettings
        : undefined,
      source: manifest.source.schema
        ? undefined
        : manifest.source.languageSettings,
    };
    restoreProjectMetadata(controller, metadata);
    applyProjectMapping(
      controller,
      await files.readText(manifest.mapping),
      metadata.target?.idLanguage,
    );
    const bundle = controller.exportDocumentSnapshot();
    bundle.examples = examples;
    bundle.activeExampleId = examples[0]?.id ?? null;
    // Session ids, timestamps and history do not belong in the mapping file.
    bundle.projectId = manifest.mapping;
    return {
      manifest,
      bundle,
      ...(targetWarnings.length ? { targetWarnings } : {}),
    };
  } finally {
    controller.newProject();
  }
}

function applyProjectMapping(
  controller: WorkbenchController,
  text: string,
  idLanguage?: string,
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
  const hasMapping = Object.keys(mapping).length > 0;
  const target = state.target;
  const primary = target ? targetOriginalLanguage(target) : undefined;
  const wantedIdLanguage = idLanguage === undefined
    ? undefined
    : normalizeIdLanguage(idLanguage, primary);
  if (
    wantedIdLanguage && wantedIdLanguage !== PRIMARY_ID_LANGUAGE &&
    !idLanguageChoices(target).includes(wantedIdLanguage)
  ) {
    throw new Error(`Target does not support id language: ${idLanguage}`);
  }
  if (hasMapping) alignIdLanguage(mapping, wantedIdLanguage, primary, true);
  const { blocklyState, extract } = hasMapping
    ? adoptBlocklyState(mapping, state.skeleton, {
      targetFormat: state.target?.format,
    })
    : scaffoldBlocklyFromSkeleton(state.skeleton, state.model, {
      targetFormat: state.target?.format,
    });
  if (!hasMapping) {
    alignIdLanguage(blocklyState, wantedIdLanguage, primary, false);
  }
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

function alignIdLanguage(
  value: unknown,
  wanted: string | undefined,
  primary: string | undefined,
  check: boolean,
): void {
  if (!wanted || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) alignIdLanguage(entry, wanted, primary, check);
    return;
  }
  const block = value as { type?: string; fields?: Record<string, unknown> };
  if (block.type === "composition") {
    const current = block.fields?.ID_LANGUAGE;
    if (
      check && typeof current === "string" &&
      normalizeIdLanguage(current, primary) !== wanted
    ) {
      throw new Error(
        "Target id language conflicts with the mapping's ID_LANGUAGE; update both choices together",
      );
    }
    block.fields = { ...block.fields, ID_LANGUAGE: wanted };
  }
  for (const child of Object.values(value)) {
    alignIdLanguage(child, wanted, primary, check);
  }
}

function restoreProjectMetadata(
  controller: WorkbenchController,
  metadata: FileProjectMetadata,
): void {
  const snapshot = controller.exportDocumentSnapshot();
  if (snapshot.target && metadata.target) {
    snapshot.target.languageSettings = metadata.target;
  }
  if (snapshot.sourceSchema && metadata.sourceSchema) {
    snapshot.sourceSchema.languageSettings = metadata.sourceSchema;
  }
  snapshot.settings.display = {
    ...(metadata.target?.labelLanguage
      ? { targetLabelLang: metadata.target.labelLanguage }
      : {}),
    ...((metadata.sourceSchema ?? metadata.source)?.labelLanguage
      ? {
        sourceLabelLang: (metadata.sourceSchema ?? metadata.source)!
          .labelLanguage,
      }
      : {}),
  };
  delete snapshot.settings.sourceLanguages;
  // Without a Source Schema, the user's source.lang.N order is kept in source.languageSettings.
  if (!snapshot.sourceSchema && metadata.source?.languages.length) {
    snapshot.settings.sourceLanguages = [...metadata.source.languages];
  }
  controller.restoreDocumentSnapshot(snapshot);
}

export function projectMetadata(bundle: ProjectBundle): FileProjectMetadata {
  return {
    ...(bundle.target?.languageSettings
      ? { target: bundle.target.languageSettings }
      : {}),
    ...(bundle.sourceSchema?.languageSettings
      ? { sourceSchema: bundle.sourceSchema.languageSettings }
      : {}),
    ...(!bundle.sourceSchema ? exampleSourceSettings(bundle) : {}),
  };
}

/** Only explicit choices are stored; detected source languages stay automatic. */
function exampleSourceSettings(
  bundle: ProjectBundle,
): Pick<FileProjectMetadata, "source"> {
  const languages = bundle.settings.sourceLanguages ?? [];
  const label = bundle.settings.display?.sourceLabelLang;
  if (!languages.length && !label) return {};
  return {
    source: { languages: [...languages], ...(label ? { labelLanguage: label } : {}) },
  };
}

/** Update only metadata that changed in the editor; preserve unrelated manifest entries. */
export function updateProjectManifest(
  text: string,
  metadata: FileProjectMetadata,
  previous: FileProjectMetadata,
): string {
  parseFileProject(text);
  const raw = JSON.parse(text);
  let changed = false;
  const update = (
    reference: unknown,
    next: FileLanguageSettings | undefined,
    before: FileLanguageSettings | undefined,
  ) => {
    if (projectJson(next) === projectJson(before)) return reference;
    changed = true;
    const file = parseReference(reference);
    const entry = typeof file === "string"
      ? { path: file }
      : { ...reference as FileProjectFile };
    if (next) entry.languageSettings = languageSettings(next);
    else delete entry.languageSettings;
    return entry;
  };
  raw.target = update(raw.target, metadata.target, previous.target);
  if (raw.source.schema) {
    raw.source.schema = update(
      raw.source.schema,
      metadata.sourceSchema,
      previous.sourceSchema,
    );
  } else if (projectJson(metadata.source) !== projectJson(previous.source)) {
    changed = true;
    if (metadata.source) {
      raw.source.languageSettings = languageSettings(metadata.source);
    } else delete raw.source.languageSettings;
  }
  return changed ? projectJson(raw) : text;
}

/** Preserve pending canvas edits when source/target files refresh. */
export function rebaseProjectMapping(
  bundle: ProjectBundle,
  text: string,
  metadata: FileProjectMetadata = projectMetadata(bundle),
): ProjectBundle {
  const controller = new WorkbenchController(createFsHostAdapter());
  if (controller.getState().settings.autoplay) controller.toggleAutoplay();
  try {
    controller.restoreDocumentSnapshot(bundle);
    restoreProjectMetadata(controller, metadata);
    applyProjectMapping(controller, text, metadata.target?.idLanguage);
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
    execution: "mapping-preview",
    ...(project.targetWarnings?.length
      ? { targetWarnings: project.targetWarnings }
      : {}),
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
