import type {
  ImportSuggestionsReport,
  MappingLoop,
  MappingModel,
  MappingFunction,
  MappingSlotHatch,
  MappingSlotReview,
  MappingUnsupportedBlock,
  TargetSignatureNode,
  OpenEhrInstanceShape,
  InstanceEncoding,
  OpenEhrJsonDeserializeMode,
  OutputMode,
  OutputValidation,
  ProjectBundle,
  ProjectSettings,
  SchemaIssue,
  SchemaTreeNode,
  SkeletonNode,
  SourceFormatId,
  TargetFormatId,
  TestResult,
} from "../types/mod.ts";
import {
  APP_VERSION,
  AUTOSAVE_STORAGE_KEY,
  BUNDLE_VERSION,
  bundleFilename,
  exportBundle,
  formatSaveTime,
  importBundle,
} from "../core/persistence/mod.ts";
import {
  DEFAULT_SETTINGS,
  isConversionScriptLanguage,
  MAPPING_PREVIEW_SCRIPT_PLACEHOLDER,
  unimplementedTestRunMessage,
} from "../types/mod.ts";
import { collectValueSlots, collectAllSlotIds, findSkeletonTrail, nearestRepeatingContainer, applyOptionalRmToSkeleton } from "../core/skeleton/generate_skeleton.ts";
import {
  applyExpressionEdit,
  countUnmappedMandatory,
  createEmptyModel,
  promoteIndexedSourcePath,
  relativePathFromLoop,
  upsertLoop,
  validateModel,
} from "../core/mapping_model/mod.ts";
import { generate, getExportTargetAdapter } from "../core/codegen/mod.ts";
import { migrateForEachSourceState } from "../blockly/migrate_for_each_source.ts";
import {
  instanceShapeForEncoding,
  preferredInstanceEncoding,
} from "../core/output/instance_encoding.ts";
import { ensureXQueryRuntime } from "../core/codegen/run_xquery.ts";
import { runTest } from "../core/test_runner/mod.ts";
import {
  canonicalSyncPath,
  detectSourceFormat,
  ExampleInstanceManager,
  findNodeBySyncPath,
  getSourceFormatHandler,
  type InstanceValidationIssue,
  validateInstanceAgainstSchema,
} from "../core/source/mod.ts";
import { buildSourceQueryExpression } from "../core/expression/mod.ts";
import { returnTypeForDv } from "../core/rm_mandatory.ts";
import {
  type AiArtifactDelivery,
  type AiPromptDelivery,
  type AiPromptArtifact,
  buildPrompt,
  importSuggestions,
  parseSuggestionsPayload,
  extractSuggestionsJson,
  validateSuggestionEnvelope,
  withSlotReview,
} from "../core/ai/mod.ts";
import type { HostAdapter, PickedTextFile } from "../host/mod.ts";
import { constraintWarningsInspect, productStackInspect, sourceTreeOutline } from "../agent/inspect.ts";
import { getValidAttachments } from "../core/rm_attachment_catalog.ts";
import {
  detectTargetFormat,
  getTargetFormatHandler,
  reloadTargetLanguage,
  stripBom,
  type TargetDefinition,
} from "../core/target/mod.ts";
import {
  isGitHubClinicalModelUrl,
  loadGitHubClinicalModel,
  type GitHubClinicalModelLoadResult,
} from "../core/clinical_model/github_template.ts";
import { loadGitHubExampleDirectory } from "../core/source/github_examples.ts";
import {
  BUNDLED_EXAMPLE_SETS_PATH,
  parseExampleSetCatalog,
  type ExampleSet,
  type ExampleSetCatalog,
} from "../core/example_sets/mod.ts";
import {
  BUNDLED_FUNCTION_LIBRARY_PATH,
  functionBundleFilename,
  parseFunctionBundle,
  parseFunctionLibraryCatalog,
  serializeFunctionBundle,
  type FunctionBundle,
  type FunctionClashPolicy,
  type FunctionLibraryCatalog,
  type MergeFunctionResult,
} from "../core/function_library/mod.ts";
import {
  initBlocklyGenerators,
  mergeFunctionBundleIntoState,
} from "../blockly/mod.ts";
import { mapBlockFromDefaultsJson } from "../core/defaults/mod.ts";
import {
  buildRefreshMergePrompt,
  diffSourceRefresh,
  diffTargetRefresh,
  formatRefreshReport,
  mappedSourcePathsFromExpressions,
  type RefreshDiffReport,
} from "../core/target/refresh_diff.ts";
import {
  cloneSheets,
  normalizeSheets,
  sheetsFromCatalogJson,
  type SheetDocument,
} from "../core/sheets/mod.ts";
import { isTemplateJson } from "ehrtslib/parser/mod.ts";
import {
  snapshotUrlHistory,
  restoreUrlHistory,
  rememberUrl,
  type UrlHistoryKind,
} from "../host/url_history.ts";
import { seedHandlebarsProductOnCanvas } from "../core/output/canvas_handlebars_seed.ts";
import type { TaskProgress, TaskStepState } from "./task_progress.ts";

export type { TaskProgress, TaskProgressStep, TaskStepState } from "./task_progress.ts";

export type WorkbenchListener = () => void;

export const AUTOSAVE_DEBOUNCE_MS = 10_000;
export const POST_LOAD_OUTPUT_MS = 400;

export interface WorkbenchControllerOptions {
  urlStorage?: Storage;
  autosaveDebounceMs?: number;
  githubFetch?: typeof fetch;
}

export class WorkbenchController {
  private listeners = new Set<WorkbenchListener>();
  private readonly urlStorage: Storage | undefined;
  private readonly autosaveDebounceMs: number;
  private readonly githubFetch: typeof fetch | undefined;
  private projectId: string = crypto.randomUUID();
  private templateFilename = "";
  private templateContent = "";
  private templateId = "";
  private skeleton: SkeletonNode[] = [];
  private schemaTree: SchemaTreeNode | null = null;
  private schemaFilename = "";
  private schemaContent = "";
  private schemaFormat: SourceFormatId = "json";
  private schemaError: string | null = null;
  /** Origin URI when schema was loaded from URL (session). */
  private schemaOriginUrl: string | null = null;
  /** Origin URI when target was loaded from URL (session). */
  private targetOriginUrl: string | null = null;
  /** Example id → origin URI when loaded from URL (session). */
  private exampleOriginUrls = new Map<string, string>();
  private target: TargetDefinition | null = null;
  private model: MappingModel = createEmptyModel("");
  private settings: ProjectSettings = { ...DEFAULT_SETTINGS };
  private examples = new ExampleInstanceManager();
  private specText = "";
  private handlebarsTemplate = "";
  private sheets: SheetDocument[] = [];
  private generatedCode = "";
  private testResult: TestResult | null = null;
  private exampleTestResults = new Map<string, TestResult>();
  private outputValidations = new Map<string, OutputValidation>();
  private listeningSlotId: string | null = null;
  private listeningSourceBlockId: string | null = null;
  private treeHighlight: { syncPath: string | null; origin: "schema" | "instance" | null } = {
    syncPath: null,
    origin: null,
  };
  private blocklyState: unknown = null;
  private blocklyReloadToken = 0;
  private pendingDefaultsMap: unknown | null = null;
  private lastRefreshReport: RefreshDiffReport | null = null;
  private getBlocklyState: (() => unknown) | null = null;
  private debounceTimer: number | null = null;
  private postLoadTimer: number | null = null;
  private autosaveTimer: number | null = null;
  private dirty = false;
  private lastAutosaveAt: string | null = null;
  private statusMessage = "Ready";
  private taskProgress: TaskProgress | null = null;
  private taskDepth = 0;

  constructor(
    private host: HostAdapter,
    options: WorkbenchControllerOptions = {},
  ) {
    this.urlStorage = options.urlStorage;
    this.autosaveDebounceMs = options.autosaveDebounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.githubFetch = options.githubFetch;
  }

  setBlocklyStateGetter(fn: () => unknown): void {
    this.getBlocklyState = fn;
  }

  /**
   * Store a Blockly workspace snapshot and regenerate export previews.
   * Does not notify listeners — the web app calls this while already
   * rendering (after applying Mapping Model expressions onto the canvas).
   */
  syncCanvasSnapshot(blocklyState: unknown): void {
    this.blocklyState = blocklyState;
    this.refreshDerived();
  }

  /** Take a queued default context map (unique block JSON) for the canvas to hydrate. */
  consumePendingDefaultsMap(): unknown | null {
    const value = this.pendingDefaultsMap;
    this.pendingDefaultsMap = null;
    return value;
  }

  /** Queue a default context map to hydrate before the next Template Skeleton. */
  queuePendingDefaultsMap(mapBlock: unknown | null): void {
    this.pendingDefaultsMap = mapBlock;
  }

  getSheets(): SheetDocument[] {
    return cloneSheets(this.sheets);
  }

  /** Replace project Sheets. Caller records Blockly undo when the change is user-authored. */
  replaceSheets(sheets: SheetDocument[], options: { silent?: boolean } = {}): void {
    this.sheets = normalizeSheets(sheets);
    if (options.silent) {
      this.notifyChange();
      return;
    }
    this.refreshDerived();
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  markDirty(): void {
    this.dirty = true;
    this.scheduleAutosave();
    this.notifyChange();
  }

  subscribe(fn: WorkbenchListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyChange(): void {
    for (const fn of this.listeners) fn();
  }

  getState() {
    return {
      projectId: this.projectId,
      templateFilename: this.templateFilename,
      templateId: this.templateId,
      skeleton: this.skeleton,
      target: this.target,
      schemaTree: this.schemaTree,
      schemaFilename: this.schemaFilename,
      schemaFormat: this.schemaFormat,
      schemaError: this.schemaError,
      exampleTree: this.buildExampleTree(),
      model: this.model,
      settings: this.settings,
      examples: this.examples.list(),
      activeExample: this.examples.getActive(),
      exampleValidations: this.buildExampleValidations(),
      activeExampleValidation: this.buildActiveExampleValidation(),
      specText: formatBlocklyState(this.getBlocklyState?.() ?? this.blocklyState),
      blocklyState: this.blocklyState,
      blocklyReloadToken: this.blocklyReloadToken,
      handlebarsTemplate: this.handlebarsTemplate,
      sheets: cloneSheets(this.sheets),
      generatedCode: this.generatedCode,
      testResult: this.testResult,
      outputValidations: Object.fromEntries(this.outputValidations),
      /** Conversion Test Run errors per example id (marks every test-file tab). */
      exampleTestErrors: Object.fromEntries(
        [...this.exampleTestResults]
          .filter(([, result]) => Boolean(result.error))
          .map(([id, result]) => [id, result.error as string]),
      ),
      listeningSlotId: this.listeningSlotId,
      listeningSourceBlockId: this.listeningSourceBlockId,
      treeHighlight: this.treeHighlight,
      statusMessage: this.statusMessage,
      taskProgress: this.taskProgress,
      saveStatus: this.getSaveStatus(),
      validationIssues: validateModel(this.model, this.skeleton),
      unmappedMandatory: countUnmappedMandatory(this.model, this.skeleton),
      urlHistory: this.captureUrlHistory(),
      modelLanguage: this.target?.language ?? this.settings.modelLanguage ?? null,
      modelLanguages: this.target?.languages ?? [],
      lastRefreshReport: this.lastRefreshReport,
    };
  }

  async openTemplate(): Promise<void> {
    const file = await this.host.pickTextFile(
      ".opt,.opt2,.json,.xsd,.xml,.adl,.adls,.hbs,.handlebars,.txt,.md,.html,.csv",
      "target",
    );
    if (!file) return;
    try {
      this.loadTargetContent(file.name, file.text);
    } catch (err) {
      this.statusMessage = `Target load failed: ${err instanceof Error ? err.message : String(err)}`;
      this.notifyChange();
    }
  }

  async openTemplateFromUrl(url: string): Promise<void> {
    const github = isGitHubClinicalModelUrl(url);
    const title = github ? "Load GitHub clinical model" : "Load target";
    const steps = github
      ? [
        { id: "parse-url", label: "Parse GitHub URL" },
        { id: "index-tree", label: "List repository files" },
        { id: "fetch", label: "Fetch clinical model files" },
        { id: "parse", label: "Parse templates and archetypes" },
        { id: "resolve", label: "Resolve operational template" },
        { id: "scaffold", label: "Scaffold Template Skeleton" },
        { id: "generate", label: "Generate conversion script" },
      ]
      : [{ id: "load", label: "Load and scaffold target" }];
    try {
      await this.withTask(title, steps, async () => {
        if (github) {
          const loaded = await this.loadGitHubModel(url);
          await this.runTaskStep("scaffold", () => {
            this.applyGitHubTarget(loaded);
          });
          this.setTaskStep("generate", "finished");
        } else {
          await this.runTaskStep("load", async () => {
            const file = await this.host.fetchTextUrl(url);
            this.loadTargetContent(file.name, file.text);
          });
        }
        this.targetOriginUrl = url;
        this.rememberLoadUrl("target", url);
      });
    } catch (err) {
      this.statusMessage = `Target load failed: ${err instanceof Error ? err.message : String(err)}`;
      this.notifyChange();
      throw err;
    }
  }

  /** Load a target file (OPT, schema, or free-form). Used by the Workbench Test API. */
  loadTemplateContent(filename: string, content: string): void {
    this.loadTargetContent(filename, content);
  }

  /** Load an openEHR Template, JSON Schema, XML Schema, or free-form target. */
  loadTargetContent(
    filename: string,
    content: string,
    format: TargetFormatId = detectTargetFormat(filename, stripBom(content)),
    mode: "replace" | "browse" | "refresh" = "replace",
  ): RefreshDiffReport | null {
    content = stripBom(content);
    if (isTemplateJson(content)) {
      throw new Error(
        "Better .t.json templates need a GitHub blob/raw URL so dependent archetypes can be fetched. Use ▾ → From GitHub template…",
      );
    }
    const preferredLanguage = this.settings.modelLanguage;
    const target = getTargetFormatHandler(format).load(filename, content, {
      language: preferredLanguage,
    });
    return this.applyLoadedTarget(target, mode);
  }

  refreshTargetContent(filename: string, content: string): RefreshDiffReport {
    const report = this.loadTargetContent(
      filename,
      content,
      detectTargetFormat(filename, stripBom(content)),
      "refresh",
    );
    return report ?? {
      kind: "target",
      previousFilename: filename,
      nextFilename: filename,
      warnings: [],
    };
  }

  loadTargetForBrowse(filename: string, content: string): void {
    this.loadTargetContent(
      filename,
      content,
      detectTargetFormat(filename, stripBom(content)),
      "browse",
    );
  }

  /**
   * Switch ontology / documentation language on a multilingual target.
   * Regenerates skeleton labels without clearing Blockly mappings.
   */
  setModelLanguage(language: string): void {
    if (!this.target) return;
    const available = this.target.languages ?? [];
    if (available.length && !available.includes(language)) return;
    if (this.target.language === language) return;
    const previous = this.getBlocklyState?.() ?? this.blocklyState;
    const reloaded = reloadTargetLanguage(this.target, language);
    this.target = reloaded;
    this.skeleton = applyOptionalRmToSkeleton(reloaded.skeleton, this.model.optionalRm);
    this.settings = { ...this.settings, modelLanguage: language };
    this.syncSlotLabelsFromSkeleton();
    if (previous) this.blocklyState = previous;
    this.refreshDerived();
    this.statusMessage = `Model language: ${language}`;
    this.markDirty();
  }

  private applyLoadedTarget(
    target: TargetDefinition,
    mode: "replace" | "browse" | "refresh" = "replace",
  ): RefreshDiffReport | null {
    const previousSkeleton = this.skeleton;
    const previousFilename = this.templateFilename;
    const previousContent = this.templateContent;
    this.target = target;
    this.templateContent = target.content;
    this.templateFilename = target.filename;
    this.templateId = target.targetId;
    this.targetOriginUrl = null;
    if (target.language) {
      this.settings = { ...this.settings, modelLanguage: target.language };
    }
    if (mode === "refresh") {
      this.skeleton = applyOptionalRmToSkeleton(target.skeleton, this.model.optionalRm);
      this.model = { ...this.model, templateId: this.templateId, targetFormat: target.format };
      this.syncSlotLabelsFromSkeleton();
      this.blocklyState = this.getBlocklyState?.() ?? this.blocklyState;
      this.blocklyReloadToken += 1;
      const mappedSlotIds = this.model.slots
        .filter((slot) => slot.expression?.trim())
        .map((slot) => slot.slotId);
      const report = diffTargetRefresh({
        previousSkeleton,
        nextSkeleton: this.skeleton,
        mappedSlotIds,
        previousFilename,
        nextFilename: target.filename,
        previousContent,
        nextContent: target.content,
      });
      this.lastRefreshReport = report;
      this.refreshDerived();
      this.statusMessage = formatRefreshReport(report);
      this.markDirty();
      return report;
    }
    if (mode === "browse") {
      this.skeleton = target.skeleton;
      if (!this.model.templateId) this.model = createEmptyModel(this.templateId);
      this.model.targetFormat = target.format;
      this.blocklyState = this.getBlocklyState?.() ?? this.blocklyState;
      this.blocklyReloadToken += 1;
      this.refreshDerived();
      this.statusMessage = `Loaded ${target.format} target ${this.templateId} into Target schema (no product scaffold yet)`;
      this.markDirty();
      return null;
    }
    this.skeleton = target.skeleton;
    this.model = createEmptyModel(this.templateId);
    this.model.targetFormat = target.format;
    if (target.format === "free-form" && target.content.trim()) {
      this.blocklyState = seedHandlebarsProductOnCanvas(null, target.content);
    } else {
      this.blocklyState = null;
    }
    this.handlebarsTemplate = "";
    this.blocklyReloadToken += 1;
    this.refreshDerived();
    this.statusMessage = `Loaded ${target.format} target ${this.templateId}`;
    this.markDirty();
    return null;
  }

  private syncSlotLabelsFromSkeleton(): void {
    const byId = new Map(
      collectValueSlots(this.skeleton).map((slot) => [slot.slotId, slot]),
    );
    this.model = {
      ...this.model,
      slots: this.model.slots.map((slot) => {
        const next = byId.get(slot.slotId);
        return next?.label ? { ...slot, label: next.label } : slot;
      }),
    };
  }

  async loadSchema(): Promise<void> {
    try {
      const file = await this.host.pickTextFile(
        ".json,.xml,.xsd,application/json,application/xml",
        "schema",
      );
      if (!file) return;
      this.loadSchemaContent(file.name, file.text);
    } catch (err) {
      this.setSchemaError(
        `Schema load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async loadSchemaFromUrl(url: string): Promise<void> {
    try {
      if (isGitHubClinicalModelUrl(url)) {
        const loaded = await this.loadGitHubModel(url);
        this.applyGitHubSchema(loaded);
        this.schemaOriginUrl = url;
        this.rememberLoadUrl("schema", url);
        if (this.schemaError) throw new Error(this.schemaError);
        return;
      }
      const file = await this.host.fetchTextUrl(url);
      this.loadSchemaContent(file.name, file.text);
      this.schemaOriginUrl = url;
      this.rememberLoadUrl("schema", url);
    } catch (err) {
      this.setSchemaError(
        `Schema load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    if (this.schemaError) throw new Error(this.schemaError);
  }

  /** Load Source Schema from in-memory content — used by Workbench Test API and hosts. */
  loadSchemaContent(filename: string, content: string, refresh = false): RefreshDiffReport | null {
    return this.tryApplySchemaFile(filename, content, refresh);
  }

  refreshSchemaContent(filename: string, content: string): RefreshDiffReport {
    return this.tryApplySchemaFile(filename, content, true) ?? {
      kind: "source",
      previousFilename: filename,
      nextFilename: filename,
      warnings: [],
    };
  }

  async loadSchemaFromDrop(file: PickedTextFile): Promise<void> {
    if (!/\.(json|xml|xsd)$/i.test(file.name)) {
      this.setSchemaError("Schema drop: JSON, XML, or XSD files only");
      return;
    }
    this.tryApplySchemaFile(file.name, file.text);
  }

  /** Visible schema-pane error when a drop had no usable File (or the wrong type). */
  reportSchemaDropRejected(message: string): void {
    this.setSchemaError(message);
  }

  async addExample(): Promise<void> {
    const file = await this.host.pickTextFile(".json,.xml", "example");
    if (!file) return;
    this.addExampleContent(file.name, file.text);
  }

  async addExampleFromUrl(url: string): Promise<void> {
    try {
      const file = await this.host.fetchTextUrl(url);
      const id = this.applyExampleFile(file.name, file.text);
      this.exampleOriginUrls.set(id, url);
      this.rememberLoadUrl("example", url);
      this.statusMessage = this.exampleLoadStatus(file.name);
      this.markDirty();
      if (this.settings.autoplay) this.scheduleTestRun();
    } catch (err) {
      this.statusMessage = `Example load failed: ${err instanceof Error ? err.message : String(err)}`;
      this.notifyChange();
      throw err;
    }
  }

  /** Fetch and parse a Function library catalog. Relative URIs resolve against the catalog URL. */
  async loadFunctionLibraryCatalog(url?: string): Promise<FunctionLibraryCatalog> {
    const catalogUrl = url?.trim() || this.host.resolveAppUrl(BUNDLED_FUNCTION_LIBRARY_PATH);
    try {
      const file = await this.host.fetchTextUrl(catalogUrl);
      const catalog = parseFunctionLibraryCatalog(file.text, catalogUrl);
      this.statusMessage = `Loaded Function library (${catalog.functions.length})`;
      this.notifyChange();
      return catalog;
    } catch (err) {
      this.statusMessage = `Function library catalog failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this.notifyChange();
      throw err;
    }
  }

  async loadFunctionLibraryEntry(
    catalog: FunctionLibraryCatalog,
    id: string,
  ): Promise<FunctionBundle> {
    const entry = catalog.functions.find((row) => row.id === id);
    if (!entry) {
      throw new Error(
        `Unknown Function library id "${id}". Known: ${catalog.functions.map((row) => row.id).join(", ")}`,
      );
    }
    const file = await this.host.fetchTextUrl(entry.file);
    return parseFunctionBundle(file.text);
  }

  /**
   * Merge a Function bundle onto the canvas Blockly JSON without replacing unrelated blocks.
   * Increments the reload token so the web app reloads the workspace snapshot.
   */
  applyFunctionBundle(
    bundle: FunctionBundle,
    clash: FunctionClashPolicy = "rename",
  ): MergeFunctionResult {
    initBlocklyGenerators();
    const current = this.getBlocklyState?.() ?? this.blocklyState;
    const merged = mergeFunctionBundleIntoState(current, this.sheets, bundle, clash);
    this.sheets = normalizeSheets(merged.sheets);
    this.blocklyState = merged.blocklyState;
    this.blocklyReloadToken += 1;
    const renamed = merged.renamedFrom ? ` (renamed from ${merged.renamedFrom})` : "";
    this.statusMessage = `Loaded Function ${merged.name}${renamed}`;
    this.markDirty();
    this.notifyChange();
    return merged;
  }

  downloadFunctionBundle(bundle: FunctionBundle): void {
    void this.host.downloadText(
      functionBundleFilename(bundle.name),
      serializeFunctionBundle(bundle),
      "application/json",
    );
  }

  async importFunctionBundleFile(): Promise<FunctionBundle | null> {
    const file = await this.host.pickTextFile(".json,.intehr-function.json", "function");
    if (!file) return null;
    return parseFunctionBundle(file.text);
  }

  /** Fetch and parse an example-set catalog. Relative URIs resolve against the catalog URL. */
  async loadExampleSetCatalog(url?: string): Promise<ExampleSetCatalog> {
    const catalogUrl = url?.trim() || this.host.resolveAppUrl(BUNDLED_EXAMPLE_SETS_PATH);
    try {
      const file = await this.host.fetchTextUrl(catalogUrl);
      const catalog = parseExampleSetCatalog(file.text, catalogUrl);
      this.statusMessage = `Loaded example-set catalog (${catalog.sets.length} set${
        catalog.sets.length === 1 ? "" : "s"
      })`;
      this.notifyChange();
      return catalog;
    } catch (err) {
      this.statusMessage = `Example-set catalog failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this.notifyChange();
      throw err;
    }
  }

  /** Replace the workspace with a catalog example set (source, target, optional mapping). */
  async loadExampleSet(set: ExampleSet): Promise<void> {
    const steps: Array<{ id: string; label: string }> = [];
    if (set.target) steps.push({ id: "target", label: "Load target" });
    if (set.source.schema) steps.push({ id: "schema", label: "Load source schema" });
    set.source.instances.forEach((_, i) => {
      steps.push({ id: `example-${i}`, label: `Load example ${i + 1}` });
    });
    if (set.mapping) steps.push({ id: "mapping", label: "Load mapping" });
    if (set.sheets) steps.push({ id: "sheets", label: "Load sheets" });
    if (set.defaults) steps.push({ id: "defaults", label: "Load defaults map" });
    steps.push({ id: "generate", label: "Generate conversion script" });
    try {
      await this.withTask(`Load example set "${set.title}"`, steps, async () => {
        this.resetWorkspaceState();
        if (set.target) {
          await this.runTaskStep("target", () => this.openTemplateFromUrl(set.target!));
        }
        if (set.source.schema) {
          await this.runTaskStep("schema", () => this.loadSchemaFromUrl(set.source.schema!));
        }
        for (const [i, instanceUrl] of set.source.instances.entries()) {
          await this.runTaskStep(`example-${i}`, () => this.addExampleFromUrl(instanceUrl));
        }
        if (set.mapping) {
          await this.runTaskStep("mapping", async () => {
            const file = await this.host.fetchTextUrl(set.mapping!);
            this.loadBlocklyDefinition(file.name, file.text);
          });
        }
        if (set.sheets) {
          await this.runTaskStep("sheets", async () => {
            const file = await this.host.fetchTextUrl(set.sheets!);
            let parsed: unknown;
            try {
              parsed = JSON.parse(file.text);
            } catch (err) {
              throw new Error(
                `Sheets JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            this.replaceSheets(sheetsFromCatalogJson(parsed), { silent: true });
          });
        }
        if (set.defaults) {
          await this.runTaskStep("defaults", async () => {
            const file = await this.host.fetchTextUrl(set.defaults!);
            let parsed: unknown;
            try {
              parsed = JSON.parse(file.text);
            } catch (err) {
              throw new Error(
                `Defaults JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            const mapBlock = mapBlockFromDefaultsJson(parsed);
            if (!mapBlock) {
              throw new Error("Defaults JSON must be a default context map, maps_create_with block, or workspace");
            }
            this.pendingDefaultsMap = mapBlock;
          });
        }
        await this.runTaskStep("generate", () => {
          this.refreshDerived();
        });
      });
      this.statusMessage = `Loaded example set "${set.title}"`;
      this.schedulePostLoadOutput();
      this.notifyChange();
    } catch (err) {
      this.statusMessage = `Example set "${set.title}" failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this.notifyChange();
      throw err;
    }
  }

  async addExamplesFromLocalDirectory(): Promise<void> {
    const files = await this.host.pickTextFilesFromDirectory(".json,.xml", "example");
    if (!files?.length) return;
    for (const file of files) {
      this.applyExampleFile(file.name, file.text);
    }
    this.statusMessage = this.examplesLoadStatus(files.length);
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  async addExamplesFromGitHubDirectory(url: string): Promise<void> {
    try {
      const loaded = await loadGitHubExampleDirectory(url, { fetch: this.githubFetch });
      if (!loaded.files.length) {
        throw new Error("No JSON or XML example files found in that folder.");
      }
      for (const file of loaded.files) {
        this.applyExampleFile(file.name, file.text);
      }
      this.rememberLoadUrl("example", url);
      const warnNote = loaded.warnings.length ? ` (${loaded.warnings.length} warnings)` : "";
      this.statusMessage = `${this.examplesLoadStatus(loaded.files.length)}${warnNote}`;
      this.markDirty();
      if (this.settings.autoplay) this.scheduleTestRun();
    } catch (err) {
      this.statusMessage = `Example folder load failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this.notifyChange();
      throw err;
    }
  }

  /** Add an Example Instance from in-memory content — used by Workbench Test API and hosts. */
  addExampleContent(filename: string, content: string): void {
    this.applyExampleFile(filename, content);
    this.statusMessage = this.exampleLoadStatus(filename);
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  async addExamplesFromDrop(files: PickedTextFile[]): Promise<void> {
    const supported = files.filter((file) => /\.(json|xml)$/i.test(file.name));
    if (!supported.length) {
      this.statusMessage = "Example drop: JSON or XML files only";
      this.notifyChange();
      return;
    }
    for (const file of supported) {
      this.applyExampleFile(file.name, file.text);
    }
    this.statusMessage = supported.length === 1
      ? this.exampleLoadStatus(supported[0].name)
      : this.examplesLoadStatus(supported.length);
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  setActiveExample(id: string): void {
    this.examples.setActive(id);
    this.clearTreeHighlight();
    this.testResult = this.exampleTestResults.get(id) ?? null;
    this.markDirty();
    if (!this.testResult && this.settings.autoplay) this.scheduleTestRun();
  }

  removeExample(id: string): void {
    this.examples.removeExample(id);
    this.exampleTestResults.delete(id);
    this.outputValidations.delete(id);
    if (!this.examples.hasExamples()) {
      this.testResult = null;
    } else {
      const active = this.examples.getActive();
      this.testResult = active ? this.exampleTestResults.get(active.id) ?? null : null;
    }
    this.markDirty();
  }

  armSlot(slotId: string): void {
    this.listeningSlotId = slotId;
    this.listeningSourceBlockId = null;
    this.statusMessage = `Listening for source path → ${slotId}`;
    this.notifyChange();
  }

  armSourceQueryBlock(blockId: string): void {
    this.listeningSourceBlockId = blockId;
    this.listeningSlotId = null;
    this.statusMessage = "Listening for source path → source query";
    this.notifyChange();
  }

  clearListening(): void {
    this.listeningSlotId = null;
    this.listeningSourceBlockId = null;
    this.notifyChange();
  }

  setTreeHighlight(
    syncPath: string,
    origin: "schema" | "instance",
  ): void {
    this.treeHighlight = { syncPath, origin };
  }

  clearTreeHighlight(): void {
    this.treeHighlight = { syncPath: null, origin: null };
  }

  bindFromNode(path: string, format: SourceFormatId): void {
    if (!this.listeningSlotId) return;
    this.mapNodeToSlot(this.listeningSlotId, path, format);
  }

  /**
   * Bind a source tree path to a Target value slot (Click-to-Map after Listening Mode,
   * or drag-and-drop which skips Listening Mode).
   */
  mapNodeToSlot(
    slotId: string,
    path: string,
    format: SourceFormatId,
    review?: MappingSlotReview,
  ): void {
    const slot = collectValueSlots(this.skeleton).find((s) => s.slotId === slotId);
    if (!slot) return;
    let xpath = getSourceFormatHandler(format).pathToExpression(path);
    const repeating = nearestRepeatingContainer(findSkeletonTrail(this.skeleton, slotId));
    if (repeating) {
      const promoted = promoteIndexedSourcePath(xpath);
      if (promoted) {
        xpath = relativePathFromLoop(promoted.mappedPath, promoted.loopPath);
        this.model = upsertLoop(this.model, {
          attachSlotId: repeating.slotId,
          varName: promoted.varName,
          path: promoted.loopPath,
        });
      }
    }
    const expr = buildSourceQueryExpression(xpath, returnTypeForTarget(slot.rmType));
    this.model = applyExpressionEdit(this.model, slot.slotId, expr, {
      rmType: slot.rmType,
      returnType: returnTypeForTarget(slot.rmType),
      label: slot.label,
      mandatory: slot.mandatory,
    });
    if (review) this.model = withSlotReview(this.model, slot.slotId, review);
    this.listeningSlotId = null;
    this.listeningSourceBlockId = null;
    this.refreshDerived();
    this.statusMessage = `Mapped ${slot.label}`;
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  /**
   * JSON Schema / inferred type for a source path, when a Source Schema is loaded.
   * Used to pick a typed `source_query*` block on canvas drop.
   */
  lookupSourceSchemaType(path: string): string | null {
    if (!this.schemaTree) return null;
    const node = findNodeBySyncPath(this.schemaTree, canonicalSyncPath(path));
    return node?.type ?? null;
  }

  setStatusMessage(message: string): void {
    this.statusMessage = message;
    this.notifyChange();
  }

  private async yieldUi(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private async withTask<T>(
    title: string,
    steps: Array<{ id: string; label: string }>,
    run: () => Promise<T>,
  ): Promise<T> {
    const nested = this.taskDepth > 0;
    this.taskDepth += 1;
    if (!nested && steps.length) {
      this.taskProgress = {
        title,
        steps: steps.map((step) => ({ ...step, state: "waiting" as const })),
      };
      this.statusMessage = title;
      this.notifyChange();
      await this.yieldUi();
    }
    try {
      return await run();
    } catch (err) {
      if (!nested && this.taskProgress) {
        const running = this.taskProgress.steps.find((s) => s.state === "running") ??
          this.taskProgress.steps.find((s) => s.state === "waiting");
        if (running) {
          this.setTaskStep(
            running.id,
            "failed",
            err instanceof Error ? err.message : String(err),
          );
          this.notifyChange();
        }
      }
      throw err;
    } finally {
      this.taskDepth -= 1;
      if (!nested) {
        this.taskProgress = null;
        this.notifyChange();
      }
    }
  }

  private setTaskStep(id: string, state: TaskStepState, detail?: string): void {
    if (!this.taskProgress) return;
    const idx = this.taskProgress.steps.findIndex((s) => s.id === id);
    if (idx < 0) {
      if (state === "running" && detail) this.noteTaskDetail(detail);
      return;
    }
    this.taskProgress = {
      ...this.taskProgress,
      steps: this.taskProgress.steps.map((step, i) => {
        if (step.id === id) {
          return { ...step, state, ...(detail !== undefined ? { detail } : {}) };
        }
        if (
          state === "running" &&
          i < idx &&
          step.state !== "finished" &&
          step.state !== "failed"
        ) {
          return { ...step, state: "finished" as const };
        }
        if (state === "running" && i > idx && step.state === "running") {
          return { ...step, state: "waiting" as const };
        }
        return step;
      }),
    };
    const step = this.taskProgress.steps[idx];
    if (step && state === "running") {
      this.statusMessage = `${this.taskProgress.title}: ${step.label}`;
    }
  }

  private noteTaskDetail(detail: string): void {
    if (!this.taskProgress) return;
    const running = this.taskProgress.steps.find((s) => s.state === "running");
    if (!running) return;
    this.setTaskStep(running.id, "running", detail);
  }

  private async runTaskStep<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    this.setTaskStep(id, "running");
    this.notifyChange();
    await this.yieldUi();
    try {
      const result = await fn();
      this.setTaskStep(id, "finished");
      this.notifyChange();
      await this.yieldUi();
      return result;
    } catch (err) {
      this.setTaskStep(id, "failed", err instanceof Error ? err.message : String(err));
      this.notifyChange();
      throw err;
    }
  }

  /** Patch a Mapping Model slot expression (AI import / derived-index edits). */
  applySlotExpression(slotId: string, expression: string): void {
    const slot = collectValueSlots(this.skeleton).find((s) => s.slotId === slotId);
    this.model = applyExpressionEdit(this.model, slotId, expression, slot
      ? {
        rmType: slot.rmType,
        returnType: returnTypeForTarget(slot.rmType),
        label: slot.label,
        mandatory: slot.mandatory,
      }
      : undefined);
    this.refreshDerived();
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  /** Replace the derived Mapping Model from the canonical Blockly workspace JSON. */
  syncFromBlockly(
    blocklyState: unknown,
    slots: Array<{
      slotId: string;
      rmType: string;
      expression: string;
      hatch?: MappingSlotHatch;
      review?: MappingSlotReview;
    }>,
    loops: MappingLoop[] = [],
    optionalRm?: MappingModel["optionalRm"],
    options?: {
      notify?: boolean;
      targetSignature?: TargetSignatureNode[];
      unsupported?: MappingUnsupportedBlock[];
      sheetNames?: string[];
      instanceEncodings?: InstanceEncoding[];
      functions?: MappingFunction[];
    },
  ): void {
    if (!this.templateId) {
      this.blocklyState = blocklyState;
      if (options?.functions) {
        this.model = { ...this.model, functions: [...options.functions] };
      }
      this.dirty = true;
      this.scheduleAutosave();
      if (options?.notify !== false) this.notifyChange();
      if (this.settings.autoplay) this.scheduleTestRun();
      return;
    }
    let next = createEmptyModel(this.templateId);
    next.targetFormat = this.target?.format;
    next.optionalRm = optionalRm ? [...optionalRm] : [...this.model.optionalRm];
    // Canvas is source of truth: empty `loops` means the loops were undone, not "keep previous".
    next.loops = [...loops];
    next.targetSignature = options?.targetSignature ? [...options.targetSignature] : [];
    next.unsupported = options?.unsupported ? [...options.unsupported] : [];
    next.sheetNames = options?.sheetNames ? [...options.sheetNames] : [];
    next.instanceEncodings = options?.instanceEncodings ? [...options.instanceEncodings] : [];
    next.functions = options?.functions ? [...options.functions] : [];
    const skeleton = applyOptionalRmToSkeleton(
      this.target?.skeleton ?? this.skeleton,
      next.optionalRm,
    );
    const targetSlots = new Map(collectValueSlots(skeleton).map((slot) => [slot.slotId, slot]));
    for (const item of slots) {
      const targetSlot = targetSlots.get(item.slotId);
      next = applyExpressionEdit(next, item.slotId, item.expression, {
        rmType: targetSlot?.rmType ?? item.rmType,
        returnType: targetSlot ? returnTypeForTarget(targetSlot.rmType) : "string",
        label: targetSlot?.label,
        mandatory: targetSlot?.mandatory,
      });
      if (item.hatch) {
        next = {
          ...next,
          slots: next.slots.map((slot) =>
            slot.slotId === item.slotId ? { ...slot, hatch: item.hatch } : slot
          ),
        };
      }
      if (item.review) next = withSlotReview(next, item.slotId, item.review);
    }
    this.blocklyState = blocklyState;
    this.model = next;
    this.skeleton = skeleton;
    this.refreshDerived();
    this.dirty = true;
    this.scheduleAutosave();
    if (options?.notify !== false) this.notifyChange();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  /** Snapshot the current project (including live Blockly JSON) for undoable loads. */
  exportDocumentSnapshot(): ProjectBundle {
    return structuredClone(this.toBundle());
  }

  /** Restore a document snapshot without treating it as a user load (undo/redo). */
  restoreDocumentSnapshot(bundle: ProjectBundle): void {
    this.resetWorkspaceState();
    this.loadBundle(structuredClone(bundle));
    this.dirty = true;
    this.statusMessage = "Restored previous mapping";
    this.notifyChange();
  }

  /**
   * Put the project back after a UI-language reload.
   * Unlike a saved-project open, this keeps Output mode and Instance shape.
   */
  restoreAfterLocaleChange(bundle: ProjectBundle): void {
    this.resetWorkspaceState();
    this.loadBundle(structuredClone(bundle), { preserveRuntimeSettings: true });
    this.blocklyReloadToken += 1;
    this.dirty = true;
    this.statusMessage = "Project loaded";
    this.notifyChange();
  }

  /**
   * Auto-run is one switch for all test files: on by default, paused only by
   * the user (slow computers). Not taken from loaded Project Bundles.
   */
  toggleAutoplay(): void {
    this.settings.autoplay = !this.settings.autoplay;
    if (this.settings.autoplay) this.scheduleTestRun();
    this.markDirty();
  }

  runTestNow(): void {
    const active = this.examples.getActive();
    if (!active) {
      this.testResult = { ok: false, error: "No active example", warnings: [] };
      this.notifyChange();
      return;
    }
    this.testResult = this.executeTestForExample(active);
    this.storeExampleTestResult(active.id, this.testResult);
    this.notifyChange();
  }

  /** Run Conversion Test for every example (active first), updating per-tab validation marks. */
  runAllTests(): void {
    const examples = this.examples.list();
    if (!examples.length) {
      this.runTestNow();
      return;
    }
    const active = this.examples.getActive();
    const ordered = active
      ? [active, ...examples.filter((ex) => ex.id !== active.id)]
      : examples;
    for (const ex of ordered) {
      const result = this.executeTestForExample(ex);
      this.storeExampleTestResult(ex.id, result);
      if (ex.id === active?.id || (!active && ex === ordered[0])) {
        this.testResult = result;
      }
    }
    this.notifyChange();
  }

  exportTypeScript(): void {
    const mode = this.settings.exportTarget;
    if (!isConversionScriptLanguage(mode)) return;
    const adapter = getExportTargetAdapter(mode);
    const code = generate(this.model, mode, {
      handlebarsTemplate: this.handlebarsTemplate,
      blocklyState: this.getBlocklyState?.() ?? this.blocklyState,
      skeleton: this.skeleton,
      instanceShape: this.model.instanceEncodings?.length
        ? instanceShapeForEncoding(preferredInstanceEncoding(this.model))
        : this.settings.openEhrInstanceShape,
      webTemplateJson: this.target?.webTemplateJson,
    });
    void this.host.downloadText(
      `conversion-${safeFilename(this.templateId)}.${adapter.extension}`,
      code,
      adapter.mime,
    );
  }

  exportTestOutput(): void {
    const output = this.testResult?.output ?? this.testResult?.error;
    if (output === undefined) return;
    const active = this.examples.getActive();
    const base = (active?.filename ?? "test-run").replace(/\.[^.]+$/, "");
    const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    const ext = typeof output === "string"
      ? (output.trimStart().startsWith("<") ? "xml" : "txt")
      : "json";
    void this.host.downloadText(
      `${safeFilename(base)}-converted.${ext}`,
      text,
      ext === "json" ? "application/json" : "text/plain",
    );
  }

  exportMappingSpec(): void {
    this.exportBlocklyDefinition();
  }

  /** Full Blockly workspace JSON (canonical mapping definition, includes x/y). */
  exportBlocklyDefinition(): void {
    const state = this.getBlocklyState?.() ?? this.blocklyState;
    const text = formatBlocklyState(state) || "{}";
    const base = safeFilename(this.templateId || this.projectId || "mapping");
    void this.host.downloadText(`${base}.blockly.json`, text, "application/json");
  }

  /** Load a previously downloaded Blockly workspace JSON onto the canvas. */
  async importBlocklyDefinition(): Promise<void> {
    const file = await this.host.pickTextFile(".json,.blockly.json", "mapping");
    if (!file) return;
    this.loadBlocklyDefinition(file.name, file.text);
  }

  loadBlocklyDefinition(filename: string, content: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      this.statusMessage =
        `Blockly JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
      this.notifyChange();
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      this.statusMessage = "Blockly JSON must be an object";
      this.notifyChange();
      return;
    }
    this.blocklyState = migrateForEachSourceState(parsed);
    this.blocklyReloadToken += 1;
    this.statusMessage = `Loaded Blockly mapping ${filename}`;
    this.markDirty();
    this.notifyChange();
  }

  async saveProjectAs(displayName: string): Promise<void> {
    const name = displayName.trim();
    if (!name) throw new Error("Project name is required");
    const bundle = this.toBundle();
    await this.host.saveManualSave(bundle, name);
    this.dirty = false;
    this.statusMessage = `Saved as "${name}"`;
    this.notifyChange();
  }

  newProject(): void {
    this.resetWorkspaceState();
    this.statusMessage = "New project";
    this.notifyChange();
  }

  hasWorkspaceContent(): boolean {
    return Boolean(
      this.templateId ||
        this.schemaTree ||
        this.examples.hasExamples() ||
        this.model.slots.some((slot) => slot.expression) ||
        this.model.optionalRm.length ||
        this.sheets.length,
    );
  }

  async listLoadableProjects() {
    return await this.host.listLoadableProjects();
  }

  async loadStoredProject(storageKey: string): Promise<void> {
    const record = await this.host.loadStoredProjectRecord(storageKey);
    if (!record) {
      this.statusMessage = "Project not found";
      this.notifyChange();
      return;
    }
    this.resetWorkspaceState();
    this.loadBundle(record.bundle);
    this.dirty = false;
    this.lastAutosaveAt = record.storageKey === AUTOSAVE_STORAGE_KEY ? record.savedAt : null;
    this.statusMessage = "Project loaded";
    this.notifyChange();
  }

  exportProject(): void {
    const bundle = this.toBundle();
    const bytes = exportBundle(bundle);
    this.host.downloadBytes(bundleFilename(this.projectId), bytes, "application/zip");
  }

  async importProject(): Promise<void> {
    const file = await this.host.pickBinaryFile(".intehrgrator,.zip", "project");
    if (!file) return;
    const bundle = importBundle(file.bytes);
    this.resetWorkspaceState();
    this.loadBundle(bundle);
    this.markDirty();
    this.statusMessage = "Project imported";
    this.notifyChange();
  }

  buildRefreshMergePrompt(): string {
    if (!this.lastRefreshReport) {
      return "No target or source refresh to merge yet.";
    }
    return buildRefreshMergePrompt(this.lastRefreshReport);
  }

  async copyAiPrompt(
    delivery: AiArtifactDelivery = "inline",
    scope: "full" | "slot" = "full",
    slotId?: string,
  ): Promise<void> {
    const prompt = this.buildAiPromptText(delivery, scope, slotId);
    await this.host.copyToClipboard(prompt);
    this.statusMessage = `AI prompt copied (${delivery})`;
    this.notifyChange();
  }

  buildAiPromptText(
    delivery: AiPromptDelivery = "inline",
    scope: "full" | "slot" = "full",
    slotId?: string,
  ): string {
    const resolvedSlotId = scope === "slot"
      ? (slotId ?? this.listeningSlotId ?? undefined)
      : slotId;
    return buildPrompt({
      scope,
      slotId: resolvedSlotId,
      targetId: this.templateId,
      targetFormat: this.target?.format ?? this.model.targetFormat ?? "openehr-template",
      targetFilename: this.templateFilename,
      sourceFormat: this.schemaTree ? this.schemaFormat : undefined,
      activeExampleFilename: this.examples.getActive()?.filename,
      skeleton: this.skeleton,
      model: this.model,
      formatDocUrl: this.host.resolveAppUrl("docs/AI_SUGGESTION_FORMAT.md"),
      delivery,
      artifacts: this.collectAiArtifacts(),
      ...(delivery === "api"
        ? {
          sourceOutline: sourceTreeOutline(this.schemaTree ?? this.buildExampleTree()),
          exampleManifest: this.examples.list().map((ex) => ({
            id: ex.id,
            filename: ex.filename,
            format: ex.format,
            chars: ex.content.length,
            ...(ex.id === this.examples.getActive()?.id ? { active: true } : {}),
          })),
        }
        : {}),
      sheets: this.sheets,
      productStack: productStackInspect(this.getBlocklyState?.() ?? this.blocklyState),
      optionalRm: this.collectOptionalRmCatalog(),
      constraintWarnings: constraintWarningsInspect({
        skeleton: this.skeleton,
        model: this.model,
        sheets: this.sheets,
        blocklyState: this.getBlocklyState?.() ?? this.blocklyState,
      }),
    });
  }

  async readClipboardText(): Promise<string> {
    try {
      return await this.host.readClipboard();
    } catch {
      return "";
    }
  }

  importAiSuggestions(text: string): ImportSuggestionsReport {
    const empty: ImportSuggestionsReport = {
      applied: 0,
      skipped: 0,
      errors: [],
      loopsAccepted: 0,
      schemaIssues: [],
    };
    if (!this.templateId) {
      const report = { ...empty, errors: ["Load a target template first"] };
      this.statusMessage = `Import failed: ${report.errors[0]}`;
      this.notifyChange();
      return report;
    }
    let schemaIssues: SchemaIssue[] = [];
    try {
      schemaIssues = validateSuggestionEnvelope(extractSuggestionsJson(text));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      schemaIssues = [{ path: "$", message }];
    }
    try {
      const payload = parseSuggestionsPayload(text, {
        fallbackTarget: {
          targetId: this.templateId,
          format: this.target?.format ?? this.model.targetFormat ?? "openehr-template",
        },
      });
      const valueSlots = collectValueSlots(this.skeleton);
      const known = new Set(collectAllSlotIds(this.skeleton));
      const slotMeta = new Map(
        valueSlots.map((s) => [s.slotId, {
          rmType: s.rmType,
          returnType: returnTypeForTarget(s.rmType),
          label: s.label,
          mandatory: s.mandatory,
        }]),
      );
      const { model, report } = importSuggestions(this.model, payload, known, slotMeta);
      report.schemaIssues = schemaIssues;
      this.model = model;
      this.refreshDerived();
      const schemaNote = schemaIssues.length ? `, ${schemaIssues.length} schema` : "";
      this.statusMessage =
        `Import: ${report.applied} applied, ${report.loopsAccepted} loops, ${report.skipped} skipped, ${report.errors.length} errors${schemaNote}`;
      this.markDirty();
      return report;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.statusMessage = `Import failed: ${message}`;
      this.notifyChange();
      return { ...empty, errors: [message], schemaIssues };
    }
  }

  private collectAiArtifacts(): AiPromptArtifact[] {
    const artifacts: AiPromptArtifact[] = [];
    if (this.target && this.templateContent) {
      artifacts.push({
        role: "target",
        filename: this.templateFilename || this.target.filename,
        format: this.target.format,
        content: this.templateContent,
        originUrl: this.targetOriginUrl ?? this.target.fileset?.sourceUrl,
      });
      const fileset = this.target.fileset;
      if (fileset?.files?.length) {
        for (const file of fileset.files) {
          const base = file.path.split("/").pop() || file.path;
          if (base === this.templateFilename) continue;
          artifacts.push({
            role: "target-fileset",
            filename: file.path,
            format: "openehr-template",
            content: file.content,
            originUrl: fileset.sourceUrl,
          });
        }
      }
    }
    if (this.schemaTree && this.schemaContent) {
      artifacts.push({
        role: "source-schema",
        filename: this.schemaFilename,
        format: this.schemaFormat,
        content: this.schemaContent,
        originUrl: this.schemaOriginUrl ?? undefined,
      });
    }
    for (const ex of this.examples.list()) {
      artifacts.push({
        role: "example",
        filename: ex.filename,
        format: ex.format,
        content: ex.content,
        originUrl: this.exampleOriginUrls.get(ex.id),
      });
    }
    return artifacts;
  }

  setExportTarget(target: OutputMode): void {
    this.settings.exportTarget = target;
    this.examples.clearCache();
    this.outputValidations.clear();
    this.exampleTestResults.clear();
    this.refreshDerived();
    if (target === "xquery") {
      void ensureXQueryRuntime()
        .then(() => {
          if (this.settings.exportTarget !== "xquery") return;
          if (this.examples.hasExamples()) this.runAllTests();
          else this.runTestNow();
        })
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          this.testResult = {
            ok: false,
            output:
              `// XQuery runtime failed to load: ${detail}\n` +
              `// See docs/agents/xquery-engine.md for the BaseX server-side path.\n`,
            error: detail,
            warnings: [],
          };
          this.notifyChange();
        });
      return;
    }
    if (this.examples.hasExamples()) {
      // Every test-file tab gets a fresh mark, not only the active one.
      this.runAllTests();
    } else if (isConversionScriptLanguage(target) && target !== "typescript") {
      this.runTestNow();
    } else {
      this.notifyChange();
    }
  }

  setOpenEhrInstanceShape(shape: OpenEhrInstanceShape): void {
    if (this.settings.openEhrInstanceShape === shape) return;
    this.settings.openEhrInstanceShape = shape;
    this.refreshDerived();
    if (this.examples.hasExamples()) this.runAllTests();
    else this.notifyChange();
  }

  setOpenEhrJsonDeserializeMode(mode: OpenEhrJsonDeserializeMode): void {
    if (this.settings.openEhrJsonDeserializeMode === mode) return;
    this.settings.openEhrJsonDeserializeMode = mode;
    if (this.examples.hasExamples()) {
      this.runAllTests();
    } else {
      this.notifyChange();
    }
  }

  setHandlebarsTemplate(template: string): void {
    this.handlebarsTemplate = "";
    this.blocklyState = seedHandlebarsProductOnCanvas(
      this.getBlocklyState?.() ?? this.blocklyState,
      template,
    );
    this.blocklyReloadToken += 1;
    this.refreshDerived();
    this.markDirty();
    if (this.settings.autoplay) this.scheduleTestRun();
  }

  getOptionalAttachments(parentSlotId: string) {
    const node = findSkeletonNode(this.skeleton, parentSlotId);
    if (!node) return [];
    const present = new Set(
      node.children
        .map((c) => c.rmAttribute)
        .filter((a): a is string => Boolean(a)),
    );
    for (const extra of this.model.optionalRm) {
      if (extra.attachmentSlotId === parentSlotId) {
        present.add(extra.attributeName);
      }
    }
    return getValidAttachments(node.rmType, {
      presentAttributes: present,
      templateConstrained: present,
      prohibitedAttributes: new Set(
        (node.attributeConstraints ?? [])
          .filter((row) => row.prohibited)
          .map((row) => row.name),
      ),
    });
  }

  collectOptionalRmCatalog(): Array<{
    parentSlotId: string;
    attachments: Array<{ rmType: string; attributeName: string; label?: string }>;
  }> {
    return collectAllSlotIds(this.skeleton).map((parentSlotId) => ({
      parentSlotId,
      attachments: this.getOptionalAttachments(parentSlotId).slice(0, 12).map((row) => ({
        rmType: row.rmType,
        attributeName: row.attributeName,
        ...(row.label ? { label: row.label } : {}),
      })),
    })).filter((row) => row.attachments.length).slice(0, 24);
  }

  /** Attachments for a Blockly block — skeleton slot when present, otherwise RM type. */
  getOptionalAttachmentsFor(
    rmType: string,
    slotId: string,
    presentFromBlock: string[] = [],
  ) {
    if (slotId && findSkeletonNode(this.skeleton, slotId)) {
      return this.getOptionalAttachments(slotId);
    }
    return getValidAttachments(rmType, {
      presentAttributes: new Set(presentFromBlock),
      templateConstrained: new Set(),
    });
  }

  addOptionalRm(parentSlotId: string, rmType: string, attributeName: string): void {
    this.model = {
      ...this.model,
      optionalRm: [
        ...this.model.optionalRm,
        { attachmentSlotId: parentSlotId, rmType, attributeName },
      ],
    };
    this.skeleton = applyOptionalRmToSkeleton(this.target?.skeleton ?? [], this.model.optionalRm);
    this.refreshDerived();
    this.markDirty();
  }

  removeOptionalRm(parentSlotId: string, attributeName: string): void {
    this.model = {
      ...this.model,
      optionalRm: this.model.optionalRm.filter((row) =>
        !(row.attachmentSlotId === parentSlotId && row.attributeName === attributeName)
      ),
    };
    this.skeleton = applyOptionalRmToSkeleton(this.target?.skeleton ?? [], this.model.optionalRm);
    this.refreshDerived();
    this.markDirty();
  }

  getSaveStatus(): { dirty: boolean; label: string } {
    if (this.dirty) return { dirty: true, label: "unsaved changes" };
    if (this.lastAutosaveAt) {
      return { dirty: false, label: `autosaved at ${formatSaveTime(this.lastAutosaveAt)}` };
    }
    return { dirty: false, label: "" };
  }

  private buildExampleTree(): SchemaTreeNode | null {
    const active = this.examples.getActive();
    if (!active) return null;
    const rootName = active.filename.replace(/\.[^.]+$/, "");
    return getSourceFormatHandler(active.format).loadInstance(active.content, rootName);
  }

  private buildExampleValidations(): Record<string, InstanceValidationIssue[]> {
    if (!this.schemaTree) return {};
    const out: Record<string, InstanceValidationIssue[]> = {};
    for (const example of this.examples.list()) {
      out[example.id] = validateInstanceAgainstSchema(
        example.content,
        example.format,
        this.schemaTree,
        this.schemaContent,
      );
    }
    return out;
  }

  private buildActiveExampleValidation(): InstanceValidationIssue[] {
    const active = this.examples.getActive();
    if (!active || !this.schemaTree) return [];
    return validateInstanceAgainstSchema(
      active.content,
      active.format,
      this.schemaTree,
      this.schemaContent,
    );
  }

  private exampleLoadStatus(filename: string): string {
    const issues = this.buildActiveExampleValidation();
    if (!issues.length) return `Added example ${filename}`;
    const n = issues.length;
    return `Added example ${filename} with ${n} schema mismatch${n === 1 ? "" : "es"}`;
  }

  private examplesLoadStatus(count: number): string {
    const mismatchCount = Object.values(this.buildExampleValidations())
      .reduce((sum, issues) => sum + issues.length, 0);
    if (!mismatchCount) return `Added ${count} examples`;
    return `Added ${count} examples with ${mismatchCount} schema mismatch${
      mismatchCount === 1 ? "" : "es"
    }`;
  }

  private tryApplySchemaFile(
    filename: string,
    content: string,
    refresh = false,
  ): RefreshDiffReport | null {
    try {
      return this.applySchemaFile(filename, content, refresh);
    } catch (err) {
      this.schemaTree = null;
      const detail = err instanceof Error ? err.message : String(err);
      this.setSchemaError(`Could not load ${filename}: ${detail}`);
      return null;
    }
  }

  private setSchemaError(message: string): void {
    this.schemaError = message;
    this.statusMessage = message;
    console.error(message);
    this.notifyChange();
  }

  private applySchemaFile(
    filename: string,
    content: string,
    refresh = false,
  ): RefreshDiffReport | null {
    const previousTree = this.schemaTree;
    const previousFilename = this.schemaFilename;
    const previousContent = this.schemaContent;
    this.schemaError = null;
    this.schemaFilename = filename;
    this.schemaContent = content;
    this.schemaOriginUrl = null;
    const format = detectSourceFormat(filename, content);
    this.schemaFormat = format;
    this.schemaTree = getSourceFormatHandler(format).loadSchema(
      content,
      filename.replace(/\.[^.]+$/, ""),
    );
    if (refresh) {
      const mappedPaths = mappedSourcePathsFromExpressions(
        this.model.slots.map((slot) => slot.expression ?? ""),
      );
      const report = diffSourceRefresh({
        previousTree,
        nextTree: this.schemaTree,
        mappedPaths,
        previousFilename,
        nextFilename: filename,
        previousContent,
        nextContent: content,
      });
      this.lastRefreshReport = report;
      this.statusMessage = formatRefreshReport(report);
      this.markDirty();
      return report;
    }
    this.statusMessage = `Loaded schema ${filename}`;
    this.markDirty();
    return null;
  }

  private applyExampleFile(filename: string, content: string): string {
    const enableAutoplay = !this.examples.hasExamples();
    const format = detectSourceFormat(filename, content);
    const id = crypto.randomUUID();
    this.examples.addExample({ id, filename, format, content });
    if (enableAutoplay) {
      this.settings.autoplay = true;
    }
    return id;
  }

  private refreshDerived(): void {
    // Spec view is widgets over the pretty Blockly JSON document.
    this.specText = formatBlocklyState(this.getBlocklyState?.() ?? this.blocklyState);
    const mode = this.settings.exportTarget;
    if (!isConversionScriptLanguage(mode)) {
      this.generatedCode = MAPPING_PREVIEW_SCRIPT_PLACEHOLDER;
      return;
    }
    this.generatedCode = mode === "go-template" || this.model.templateId || this.blocklyState
      ? generate(this.model, mode, {
        handlebarsTemplate: this.handlebarsTemplate,
        blocklyState: this.getBlocklyState?.() ?? this.blocklyState,
        skeleton: this.skeleton,
        instanceShape: this.model.instanceEncodings?.length
          ? instanceShapeForEncoding(preferredInstanceEncoding(this.model))
          : this.settings.openEhrInstanceShape,
        webTemplateJson: this.target?.webTemplateJson,
      })
      : "";
  }

  private schedulePostLoadOutput(): void {
    if (this.postLoadTimer !== null) clearTimeout(this.postLoadTimer);
    this.postLoadTimer = setTimeout(() => {
      this.postLoadTimer = null;
      this.refreshDerived();
      if (this.examples.hasExamples()) this.runAllTests();
      else this.notifyChange();
    }, POST_LOAD_OUTPUT_MS) as unknown as number;
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.performAutosave();
    }, this.autosaveDebounceMs) as unknown as number;
  }

  /** Flush a pending autosave immediately — used by tests and page-unload hooks. */
  async flushAutosave(): Promise<void> {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    await this.performAutosave();
  }

  private async performAutosave(): Promise<void> {
    if (!this.dirty) return;
    try {
      const bundle = this.toBundle();
      await this.host.saveAutosave(bundle);
      this.clearDirtyAfterSave();
      this.notifyChange();
    } catch (err) {
      this.statusMessage = `Autosave failed: ${err instanceof Error ? err.message : String(err)}`;
      this.notifyChange();
    }
  }

  private clearDirtyAfterSave(): void {
    this.dirty = false;
    this.lastAutosaveAt = new Date().toISOString();
  }

  private resetWorkspaceState(): void {
    this.projectId = crypto.randomUUID();
    this.templateFilename = "";
    this.templateContent = "";
    this.templateId = "";
    this.skeleton = [];
    this.schemaTree = null;
    this.schemaFilename = "";
    this.schemaContent = "";
    this.schemaFormat = "json";
    this.schemaError = null;
    this.schemaOriginUrl = null;
    this.targetOriginUrl = null;
    this.exampleOriginUrls = new Map();
    this.target = null;
    this.model = createEmptyModel("");
    this.settings = { ...DEFAULT_SETTINGS, autoplay: this.settings.autoplay };
    this.examples = new ExampleInstanceManager();
    this.specText = "";
    this.handlebarsTemplate = "";
    this.sheets = [];
    this.generatedCode = "";
    this.testResult = null;
    this.outputValidations.clear();
    this.exampleTestResults.clear();
    this.listeningSlotId = null;
    this.listeningSourceBlockId = null;
    this.treeHighlight = { syncPath: null, origin: null };
    this.blocklyState = null;
    this.blocklyReloadToken += 1;
    this.pendingDefaultsMap = null;
    this.dirty = false;
    this.lastAutosaveAt = null;
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (this.postLoadTimer !== null) {
      clearTimeout(this.postLoadTimer);
      this.postLoadTimer = null;
    }
  }

  private scheduleTestRun(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    // Auto-run needs a test file; without one there is nothing to mark.
    if (!this.examples.hasExamples()) {
      this.debounceTimer = null;
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.examples.hasExamples()) return;
      this.runAllTests();
    }, 500) as unknown as number;
  }

  private executeTestForExample(
    example: { content: string; format: SourceFormatId },
  ): TestResult {
    const mode = this.settings.exportTarget;
    if (isConversionScriptLanguage(mode) && mode !== "typescript" && mode !== "handlebars" && mode !== "go-template" && mode !== "xquery") {
      const message = unimplementedTestRunMessage(mode);
      return {
        ok: false,
        output: message,
        error: message.trim(),
        warnings: [],
      };
    }
    return runTest(this.model, example.content, example.format, {
      target: this.target,
      outputMode: mode,
      generatedCode: mode === "typescript" || mode === "xquery" || mode === "go-template"
        ? this.generatedCode
        : undefined,
      handlebarsTemplate: this.handlebarsTemplate,
      blocklyState: this.getBlocklyState?.() ?? this.blocklyState,
      sheets: cloneSheets(this.sheets),
      openEhrJsonDeserializeMode: this.settings.openEhrJsonDeserializeMode,
      instanceShape: this.model.instanceEncodings?.length
        ? instanceShapeForEncoding(preferredInstanceEncoding(this.model))
        : this.settings.openEhrInstanceShape,
    });
  }

  private storeExampleTestResult(id: string, result: TestResult): void {
    this.exampleTestResults.set(id, result);
    if (result.output !== undefined) {
      this.examples.setCachedResult(id, result.output);
    }
    if (result.outputValidation) {
      this.outputValidations.set(id, result.outputValidation);
    }
  }

  private toBundle(): ProjectBundle {
    const now = new Date().toISOString();
    return {
      version: BUNDLE_VERSION,
      projectId: this.projectId,
      appVersion: APP_VERSION,
      createdAt: now,
      updatedAt: now,
      target: this.target
        ? {
          format: this.target.format,
          filename: this.target.filename,
          targetId: this.target.targetId,
          content: this.target.content,
          skeleton: this.target.skeleton,
          fileset: this.target.fileset,
          webTemplateJson: this.target.webTemplateJson,
          language: this.target.language,
          languages: this.target.languages,
        }
        : null,
      sourceSchema: this.schemaTree
        ? {
          filename: this.schemaFilename,
          format: this.schemaFormat,
          content: this.schemaContent,
          tree: [this.schemaTree],
        }
        : null,
      examples: this.examples.list(),
      activeExampleId: this.examples.getActive()?.id ?? null,
      mapping: {
        blocklyState: this.getBlocklyState?.() ?? this.blocklyState,
        model: this.model,
        handlebarsTemplate: this.handlebarsTemplate,
        sheets: cloneSheets(this.sheets),
      },
      settings: { ...this.settings },
      urlHistory: this.captureUrlHistory(),
    };
  }

  private loadBundle(
    bundle: ProjectBundle,
    options?: { preserveRuntimeSettings?: boolean },
  ): void {
    this.projectId = bundle.projectId;
    const autoplay = this.settings.autoplay;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...bundle.settings,
      // Auto-run is a user/session preference, not part of the project.
      autoplay,
      // #246: no "Validate as" picker — older bundles that stored another preset
      // normalize to the current default (canonical-strict).
      openEhrJsonDeserializeMode: DEFAULT_SETTINGS.openEhrJsonDeserializeMode,
      ...(options?.preserveRuntimeSettings
        ? {}
        : {
          exportTarget: "preview" as const,
          openEhrInstanceShape: DEFAULT_SETTINGS.openEhrInstanceShape,
        }),
    };
    this.model = { ...bundle.mapping.model };
    this.blocklyState = migrateForEachSourceState(bundle.mapping.blocklyState);
    this.handlebarsTemplate = "";
    this.sheets = normalizeSheets(bundle.mapping.sheets ?? []);
    this.templateFilename = "";
    this.templateContent = "";
    this.templateId = "";
    this.skeleton = [];
    this.target = null;
    this.schemaTree = null;
    this.schemaFilename = "";
    this.schemaContent = "";
    this.schemaFormat = "json";
    this.schemaError = null;
    const storedTarget = bundle.target;
    if (storedTarget) {
      this.target = storedTarget;
      this.templateFilename = storedTarget.filename;
      this.templateContent = storedTarget.content;
      this.templateId = storedTarget.targetId;
      this.skeleton = applyOptionalRmToSkeleton(storedTarget.skeleton, this.model.optionalRm);
      this.model.targetFormat = storedTarget.format;
      const preferred = this.settings.modelLanguage;
      if (
        preferred &&
        preferred !== storedTarget.language &&
        storedTarget.content &&
        storedTarget.format !== "free-form"
      ) {
        try {
          const reloaded = reloadTargetLanguage(storedTarget, preferred);
          this.target = reloaded;
          this.skeleton = applyOptionalRmToSkeleton(reloaded.skeleton, this.model.optionalRm);
          this.syncSlotLabelsFromSkeleton();
        } catch {
          // Keep persisted skeleton when regenerate fails.
        }
      }
    }
    if (bundle.sourceSchema?.tree?.[0]) {
      this.schemaTree = bundle.sourceSchema.tree[0];
      this.schemaFilename = bundle.sourceSchema.filename;
      this.schemaContent = bundle.sourceSchema.content;
      this.schemaFormat = bundle.sourceSchema.format ??
        detectSourceFormat(bundle.sourceSchema.filename, bundle.sourceSchema.content);
    }
    for (const ex of bundle.examples) this.examples.addExample(ex);
    if (bundle.activeExampleId) this.examples.setActive(bundle.activeExampleId);
    if (this.urlStorage) restoreUrlHistory(bundle.urlHistory, this.urlStorage);
    this.outputValidations.clear();
    this.exampleTestResults.clear();
    this.refreshDerived();
    this.schedulePostLoadOutput();
  }

  private captureUrlHistory() {
    return this.urlStorage
      ? snapshotUrlHistory(this.urlStorage)
      : { schema: [] as string[], example: [] as string[], target: [] as string[] };
  }

  private rememberLoadUrl(kind: UrlHistoryKind, url: string): void {
    if (this.urlStorage) rememberUrl(kind, url, this.urlStorage);
  }

  private async loadGitHubModel(url: string): Promise<GitHubClinicalModelLoadResult> {
    return await loadGitHubClinicalModel(url, {
      fetch: this.githubFetch,
      language: this.settings.modelLanguage,
      onProgress: (event) => {
        if (event.phase === "complete") return;
        this.setTaskStep(event.phase, "running", event.message);
        this.notifyChange();
      },
    });
  }

  private applyGitHubTarget(loaded: GitHubClinicalModelLoadResult): void {
    this.target = {
      format: "openehr-template",
      filename: loaded.filename,
      targetId: loaded.templateId,
      content: loaded.optXml,
      skeleton: loaded.skeleton,
      fileset: loaded.fileset,
      webTemplateJson: loaded.webTemplateJson,
      language: loaded.language,
      languages: loaded.languages,
    };
    this.templateFilename = loaded.filename;
    this.templateContent = loaded.optXml;
    this.templateId = loaded.templateId;
    this.skeleton = loaded.skeleton;
    this.model = createEmptyModel(this.templateId);
    this.model.targetFormat = "openehr-template";
    if (loaded.language) {
      this.settings = { ...this.settings, modelLanguage: loaded.language };
    }
    this.blocklyState = null;
    this.blocklyReloadToken += 1;
    this.refreshDerived();
    const extra = loaded.warnings.length ? ` (${loaded.warnings.length} warnings)` : "";
    this.statusMessage =
      `Loaded GitHub template ${loaded.templateId} (${loaded.fetched} files)${extra}`;
    this.markDirty();
  }

  private applyGitHubSchema(loaded: GitHubClinicalModelLoadResult): void {
    const schemaName = loaded.filename.replace(/\.opt$/i, ".wt.json");
    this.applySchemaFile(schemaName, loaded.webTemplateJson);
    const extra = loaded.warnings.length ? ` (${loaded.warnings.length} warnings)` : "";
    this.statusMessage =
      `Loaded GitHub schema ${loaded.templateId} (${loaded.fetched} files)${extra}`;
  }
}

function findSkeletonNode(nodes: SkeletonNode[], slotId: string): SkeletonNode | null {
  for (const n of nodes) {
    if (n.slotId === slotId) return n;
    const child = findSkeletonNode(n.children, slotId);
    if (child) return child;
  }
  return null;
}

function collectAllSlotIds(nodes: SkeletonNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.slotId);
    out.push(...collectAllSlotIds(n.children));
  }
  return out;
}

function returnTypeForTarget(type: string): string {
  if (type.startsWith("DV_") || type === "CODE_PHRASE") return returnTypeForDv(type);
  if (["number", "integer", "decimal", "float", "double"].includes(type.toLowerCase())) {
    return "number";
  }
  if (type.toLowerCase() === "boolean") return "boolean";
  return "string";
}

function formatBlocklyState(state: unknown): string {
  return state == null ? "" : JSON.stringify(state, null, 2);
}

function safeFilename(value: string): string {
  return (value || "mapping").replace(/[^A-Za-z0-9._-]+/g, "-");
}
