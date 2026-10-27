import * as Blockly from "blockly/core";
import type { SchemaTreeNode } from "../src/types/mod.ts";
import { createHostAdapter } from "../src/host/create_host.ts";
import { WorkbenchController } from "../src/workbench/controller.ts";
import { setIdLanguageChangeGuard, setIdLanguageChoices } from "../src/blockly/field_id_language.ts";
import { ID_LANGUAGE_FIELD, PRIMARY_ID_LANGUAGE } from "../src/core/target/id_language.ts";
import { mappedSourcePathsFromExpressions } from "../src/core/target/refresh_diff.ts";
import { TASK_PROGRESS_OVERLAY_ID, taskProgressInnerHtml } from "../src/workbench/task_progress.ts";
import { ensureGoTemplateWasm } from "../src/core/output/go_template_runtime.ts";
import {
  renderSchemaTree,
  renderInstanceTree,
  applyTreeHighlights,
  parseSourceDragPayload,
  getActiveSourceDrag,
} from "../src/workbench/tree_views.ts";
import {
  findSkeletonNodeIn,
  findParentSkeletonNode,
  getActiveTargetDrag,
  parseTargetDragPayload,
  renderTargetSchemaTree,
  targetSchemaTreeFromSkeleton,
} from "../src/workbench/target_schema_tree.ts";
import type { TreeHighlightState } from "../src/workbench/tree_views.ts";
import type { BlockSvg } from "blockly/core";
import { canonicalSyncPath } from "../src/core/source/schema_loader.ts";
import { getSourceFormatHandler } from "../src/core/source/mod.ts";
import {
  insertHandlebarsPathAtSelection,
  isHandlebarsInsertTarget,
} from "../src/workbench/handlebars_click_to_map.ts";
import {
  createReadonlyEditor,
  detectEditorLanguage,
  languageForExportTarget,
  setEditorDoc,
} from "../src/workbench/codemirror_setup.ts";
import {
  createMappingSpecEditor,
  mappingSpecDocumentText,
  setMappingSpecFromBlockly,
  scrollMappingSpecToBlock,
  specAnchorForBlocks,
  blocklyJsonDocument,
  blocklyJsonDocumentForRoot,
  deleteMarkedSpecBlocks,
  pruneCheckedBlockIds,
  specRowBlockIdsEligibleForBulkMark,
  type SpecChrome,
} from "../src/workbench/mapping_spec/mod.ts";
import {
  initBlocklyGenerators,
  loadSkeletonIntoWorkspace,
  placeSkeletonSubtreeOnWorkspace,
  lockWorkspaceRootsExpanded,
  applyModelExpressions,
  applyModelLoops,
  attachOptionalRmChild,
  attachOptionalSchemaChild,
  highlightListeningSlot,
  slotIdFromBlock,
  listeningTargetFromBlock,
  owningValueSlotId,
  blockConstraintMessages,
  createModestTheme,
  buildDemoToolbox,
  setOptionalRmMutatorChangeHandler,
  setSchemaFieldsMutatorChangeHandler,
  findSkeletonNode,
  skeletonToolboxSignature,
  registerSchemaBlocksFromSkeleton,
  openBlockMutator,
  composeOptionalRmExtras,
  workspaceToModelJson,
  migrateForEachSourceState,
  placeSourceQueryBlock,
  sourceReturnTypeFromSchemaType,
  applyEventRmType,
  applyItemStructureRmType,
  isEventFamilyType,
  isItemStructureFamilyType,
  workspacePositionFromClient,
  registerCompactThrasosRenderer,
  openWorkspaceSnapshotWindow,
  relabelWorkspaceFromSkeleton,
  ensureDefaultsBlock,
  findDefaultsBlock,
  ensureConversionStartOnScaffold,
  enforceConversionStartUniqueness,
  CONVERSION_START_TYPE,
  hydrateDefaultsMapArgument,
  serializeDefaultsMapArgument,
  applyDefaultContextMap,
  setDefaultsMapPickHandler,
  setDefaultsMapInfoHandler,
  setDefaultsMapHardcodeHandler,
  setDefaultContextMapApplyHandler,
  appendContextMapEntry,
  scaffoldTargetFieldAtClientPoint,
  defaultContextMapAtClientPoint,
  contextMapValueInputAtClientPoint,
  hardcodeDefaultsMapKey,
  listDefaultsMapEntries,
  setSheetFocusHandler,
  setDecisionTableFocusHandler,
  setDecisionTableInfoHandler,
  setWorkspaceSheetsProvider,
  installDecisionTableSync,
  registerGridFlyoutButtons,
  setGridCreateHandler,
  installExtractToFunctionOnWorkspace,
  installFunctionLibraryMenus,
} from "../src/blockly/mod.ts";
import { installCollapseChildrenMenu } from "../src/blockly/collapse_children_menu.ts";
import { installAiReviewMarkers, refreshAiReviewMarkers } from "../src/blockly/ai_review.ts";
import { APP_VERSION } from "../src/core/persistence/mod.ts";
import {
  blockOwnClientRect,
  blockOwnWorkspaceSize,
  isSourceDropSlotBlock,
  isUsableSourceDropPoint,
  pointInRect,
} from "../src/blockly/source_drop.ts";
import { registerServiceWorker } from "./pwa.ts";
import { mountMappingSpecChrome, installSpecLayoutMenu } from "../src/ui/mapping_spec_chrome.ts";
import { attachWorkspaceMinimap } from "../src/blockly/minimap.ts";
import { installBlocklyFloatingOverlays } from "../src/blockly/floating_overlays.ts";
import { installToolboxSearchInputFix } from "../src/blockly/toolbox_search.ts";
import { installAnchoredMenu } from "../src/ui/anchored_menu.ts";
import { runWithoutBlocklyEvents, withBlocklyUndoGroup, replaceCanvasUndoable, CANVAS_SWAP_EVENT_TYPE, setAfterCanvasSwapRun } from "../src/blockly/blockly_events.ts";
import { refreshWorkspaceConstraints } from "../src/blockly/block_constraints.ts";
import {
  DOCUMENT_SWAP_EVENT_TYPE,
  fireDocumentSwap,
  workspaceCanRedo,
  workspaceCanUndo,
  type DocumentSnapshot,
} from "../src/workbench/document_undo.ts";
import { SHEET_CHANGE_EVENT_TYPE } from "../src/workbench/sheet_undo.ts";
import { mountFunctionLibraryDialog } from "../src/ui/function_library_dialog.ts";
import { mountSheetsPanel } from "../src/ui/sheets_panel.ts";
import { sheetsChrome } from "../src/ui/sheets_i18n.ts";
import {
  optionalRmInputName,
  presentAttributeNames,
  rmAttributeInputName,
  rmTypeOfBlock,
} from "../src/blockly/blocks/rm_blocks.ts";
import { schemaOptionalInputName } from "../src/blockly/blocks/schema_mutator.ts";
import { slotRmTypeForAttr } from "../src/blockly/rm_type_emoji.ts";
import {
  changeLocaleAndReload,
  detectLocale,
  isStashedProjectBundle,
  loadBlocklyLocale,
  markLocaleReloadAutosave,
  msg,
  stashLocaleReloadProject,
  SUPPORTED_LOCALES,
  takeLoadOnceBlocks,
  takeLoadOnceProject,
  takeLocaleReloadAutosave,
  type IntehrLocale,
} from "../src/blockly/i18n/locale.ts";
import { AUTOSAVE_STORAGE_KEY } from "../src/core/persistence/mod.ts";
import type { ProjectBundle } from "../src/types/mod.ts";
import {
  applyChrome,
  chrome,
  formatMessage,
  localizeStatus,
  localizeTaskProgress,
} from "../src/ui/chrome_i18n.ts";
import { wireEditorActionToolbar } from "../src/ui/editor_action_toolbar.ts";
import { createPaneFind, installTreePaneFind, type PaneFind } from "../src/ui/pane_find.ts";
import { canvasFindAdapter, type CanvasWorkspaceLike } from "../src/blockly/canvas_find.ts";
import { BUILD_ID, BUILD_TIMESTAMP } from "./build_info.ts";
import { initSplitPanes } from "../src/ui/split_pane.ts";
import "../src/ui/shoelace.ts";
import {
  OUTPUT_SLIDE_STORAGE,
  SOURCE_SLIDE_STORAGE,
  isOutputTabId,
  readStoredFlag,
  readStoredOutputTab,
  writeStoredFlag,
  writeStoredOutputTab,
  type OutputTabId,
} from "../src/ui/slide_away.ts";
import { installInfoTips, openInfoTipAt } from "../src/ui/info_tip.ts";
import { installUrlLoadUi } from "../src/ui/url_load.ts";
import { type HistoryPanelHandle, type HistoryPanelRow, installHistoryPanel } from "../src/ui/history_panel.ts";
import {
  type AiAuthorMark,
  changedSlots,
  installAiAuthorMarkers,
  readAiAuthor,
  slotFingerprints,
  writeAiAuthor,
} from "../src/blockly/ai_author.ts";
import { leaseColor, leaseTargetBlock, renderLeaseMarkers } from "../src/blockly/lease_markers.ts";
import type { SlotLease } from "../src/agent/leases.ts";
import type { HumanWinsNotice } from "../src/agent/types.ts";
import { changedTargetIds } from "../src/agent/lease_guard.ts";
import {
  formatCountdown,
  type LeaseHit,
  leaseHits,
  leaseKey,
  pruneAcknowledged,
  remainingByHit,
} from "../src/web/lease_warning.ts";
import { slotExpressionBlocks } from "../src/blockly/mapping_ir.ts";
import {
  commitsSettled,
  commitUiChange,
  installAgentBridge,
  isAgentBridgeSynced,
  isDesktopEnvironment,
  type UiCommitOrigin,
} from "../src/web/agent_bridge.ts";
import { openAgentObserver, updateAgentObserverActivity } from "../src/web/agent_observer.ts";
import { isSemanticBlocklyEvent, summarizeBlocklyEvent } from "../src/workbench/semantic_events.ts";
import { installImportAiDialog } from "../src/ui/import_ai.ts";
import {
  type AiChatPanelHandle,
  type AiChatTurnRequest,
  type AiChatTurnResult,
  installAiChatPanel,
} from "../src/ui/ai_chat_panel.ts";
import type { ContextChip, ContextChipKind } from "../src/core/ai/chat_context.ts";
import { LocalAgentClient } from "../src/agent/client.ts";
import { aiChatActor, USER_ACTOR } from "../src/agent/actor.ts";
import { WorkbenchService } from "../src/workbench/service.ts";
import { listSlotsInspect } from "../src/agent/inspect.ts";
import { looksLikeSuggestionsPayload } from "../src/core/ai/mod.ts";
import {
  hasAiCredentials,
  isToolsUnsupportedError,
  loadAiCredentials,
  saveAiCredentials,
} from "../src/core/ai/credentials.ts";
import { AI_PROVIDER_PRESETS, applyAiProviderPreset, findAiProviderPreset } from "../src/core/ai/providers.ts";
import { fetchModelList, ModelListError, modelAfterProviderChange } from "../src/core/ai/models.ts";
import {
  type AiProviderConfig,
  type AiProviderConfigs,
  clearAllProviderConfigs,
  loadProviderConfigs,
  providerOptionLabel,
  forgetProviderKey,
  upsertProviderConfig,
} from "../src/core/ai/provider_configs.ts";
import {
  mappingNoticeFor,
  runMappingAgentOnClient,
  runSuggestionsChatTurn,
  SUGGESTIONS_FALLBACK_INSTRUCTION,
} from "../src/core/ai/mapping_agent.ts";
import { pinnedDocUrl } from "../src/core/ai/pinned_links.ts";
import { DEFAULT_GITHUB_TEMPLATE_URL } from "../src/core/clinical_model/github_template.ts";
import { DEFAULT_GITHUB_EXAMPLES_URL } from "../src/core/source/github_examples.ts";
import {
  EHRTSLIB_EXAMPLE_SETS_CATALOG_URL,
  type ExampleSet,
  type ExampleSetCatalog,
} from "../src/core/example_sets/mod.ts";
import { formatSaveTime } from "../src/core/persistence/mod.ts";
import { collectValueSlots } from "../src/core/skeleton/generate_skeleton.ts";
import { createIndexedDbDefaultsCatalog, factoryDefaultsMapBlockState, mapBlockFromDefaultsJson, classAttributeScaffoldTarget } from "../src/core/defaults/mod.ts";
import {
  createBetterFormBridge,
  type BetterFormBridge,
} from "../src/core/output/better_form_bridge.ts";
import {
  isTestMode,
  type IntehrgratorTestApi,
  type WorkbenchTestSnapshot,
} from "../src/ui_test/test_api.ts";
import { maybeShowRecommendedVersionPopup } from "../src/ui/recommended_version_popup.ts";
import { createLanguageWidget, type LanguageWidget } from "../src/ui/language_widget.ts";
import { isKnownLanguage, parseLanguageList } from "../src/core/languages.ts";

const host = createHostAdapter();
const controller = new WorkbenchController(host, { urlStorage: localStorage });
const testMode = isTestMode();
let workbenchReadyResolve!: () => void;
const workbenchReady = new Promise<void>((resolve) => {
  workbenchReadyResolve = resolve;
});

applyChrome(document, detectLocale());

function uiChrome() {
  return chrome(detectLocale());
}

const schemaTreeEl = document.getElementById("schema-tree")!;
const targetSchemaTreeEl = document.getElementById("target-schema-tree")!;
const sourcePaneEl = document.getElementById("source-pane")!;
const outputPaneEl = document.getElementById("output-pane")!;
const mainPanesEl = document.querySelector("main.panes") as HTMLElement;
const exampleTabsEl = document.getElementById("example-tabs")!;
const exampleValidationEl = document.getElementById("example-validation")!;
const testOutputTabsEl = document.getElementById("test-output-tabs")!;
const testOutputValidationEl = document.getElementById("test-output-validation")!;
const exampleTreeEl = document.getElementById("example-tree")!;
// #218: find-in-pane for the three trees (the canvas one is added in bootBlockly).
const paneFinds: Record<string, PaneFind> = {
  "source-schema": installTreePaneFind(
    schemaTreeEl,
    "source-schema",
    "searchSchemaTreeTitle",
    detectLocale,
  ),
  "source-example": installTreePaneFind(
    exampleTreeEl,
    "source-example",
    "searchExampleTreeTitle",
    detectLocale,
  ),
  "target-schema": installTreePaneFind(
    targetSchemaTreeEl,
    "target-schema",
    "searchTargetSchemaTreeTitle",
    detectLocale,
  ),
};
const blocklyMount = document.getElementById("blockly-mount")!;
const statusMain = document.getElementById("status-main")!;
const statusSave = document.getElementById("status-save")!;
const statusBuild = document.getElementById("status-build")!;
const taskProgressOverlay = document.getElementById(TASK_PROGRESS_OVERLAY_ID)!;
const exportTargetSelect = document.getElementById("export-target") as HTMLSelectElement;
const instanceShapeSelect = document.getElementById("openehr-instance-shape") as HTMLSelectElement;
const instanceShapeWrap = document.getElementById("openehr-instance-shape-wrap") as HTMLLabelElement;
const mappingJsonTab = document.getElementById("tab-mapping-json") as HTMLButtonElement;
const sheetsTab = document.getElementById("tab-sheets") as HTMLButtonElement;
const uploadSpecBtn = document.getElementById("btn-upload-spec") as HTMLButtonElement;
const mappingJsonHost = document.getElementById("spec-editor")!;
const specEditorWrap = document.getElementById("spec-editor-wrap")!;
const sheetsHost = document.getElementById("sheets-host")!;
const specBulkBar = document.getElementById("mapping-spec-bulk-bar")!;
const sheetsActions = document.getElementById("sheets-actions");
const specMarkWarnedBtn = document.getElementById("btn-spec-mark-warned") as HTMLButtonElement;
const specDeleteMarkedBtn = document.getElementById("btn-spec-delete-marked") as HTMLButtonElement;

const dialogSaveAs = document.getElementById("dialog-save-as") as HTMLDialogElement;
const saveAsNameInput = document.getElementById("save-as-name") as HTMLInputElement;
const dialogLoadProject = document.getElementById("dialog-load-project") as HTMLDialogElement;
const loadProjectList = document.getElementById("load-project-list")!;
const dialogDefaultsMap = document.getElementById("dialog-defaults-map") as HTMLDialogElement;
const defaultsMapList = document.getElementById("defaults-map-list")!;
const dialogDefaultsSaveAs = document.getElementById("dialog-defaults-save-as") as HTMLDialogElement;
const defaultsSaveAsNameInput = document.getElementById("defaults-save-as-name") as HTMLInputElement;
const defaultsMapUrlInput = document.getElementById("defaults-map-url-input") as HTMLInputElement;
const dialogHardcodeDefaults = document.getElementById("dialog-hardcode-defaults") as HTMLDialogElement;
const hardcodeDefaultsList = document.getElementById("hardcode-defaults-list")!;
const defaultsCatalog = createIndexedDbDefaultsCatalog();

const copyAllToClipboard = (text: string) => host.copyToClipboard(text);

const specEditor = createMappingSpecEditor(mappingJsonHost, {
  onFieldEdit: (blockId, field, value) => {
    const block = workspace?.getBlockById(blockId);
    if (!block) return;
    block.setFieldValue(value, field);
    // Workspace change listener runs syncFromBlockly → Spec refresh.
  },
  onSelect: (blockId) => applyBlockSelection(blockId, "spec"),
  onCheckToggle: (blockId, checked) => toggleSpecBlockCheck(blockId, checked),
  copyAll: copyAllToClipboard,
});
let sheetsPanel: ReturnType<typeof mountSheetsPanel> | null = null;
let specChromeUi: ReturnType<typeof mountMappingSpecChrome> | null = null;
let functionLibraryUi: ReturnType<typeof mountFunctionLibraryDialog> | null = null;
let specCheckedBlockIds = new Set<string>();

function refreshMappingSpecView(blocklyState?: unknown): void {
  if (workspace) {
    specCheckedBlockIds = pruneCheckedBlockIds(workspace, specCheckedBlockIds);
  }
  const state = blocklyState ?? Blockly.serialization.workspaces.save(workspace);
  const layout = specChromeUi?.getLayout() ?? "list";
  const rootId = layout === "tabs" ? specChromeUi?.getActiveRootId() ?? null : null;
  setMappingSpecFromBlockly(specEditor, state, specChrome(), { rootId });
  updateSpecBulkButtons();
}

function toggleSpecBlockCheck(blockId: string, checked: boolean): void {
  if (checked) specCheckedBlockIds.add(blockId);
  else specCheckedBlockIds.delete(blockId);
  refreshMappingSpecView();
}

function markAllWarnedOptionalUnmapped(): void {
  if (!workspace) return;
  refreshWorkspaceConstraints(workspace);
  const warnings = collectConstraintWarnings();
  const state = Blockly.serialization.workspaces.save(workspace);
  const layout = specChromeUi?.getLayout() ?? "list";
  const rootId = layout === "tabs" ? specChromeUi?.getActiveRootId() ?? null : null;
  const doc = rootId
    ? blocklyJsonDocumentForRoot(state, rootId)
    : blocklyJsonDocument(state);
  specCheckedBlockIds = new Set(
    specRowBlockIdsEligibleForBulkMark(workspace, doc, warnings),
  );
  refreshMappingSpecView();
}

function deleteMarkedSpecBlocksFromCanvas(): void {
  if (!workspace) return;
  const deleted = deleteMarkedSpecBlocks(workspace, specCheckedBlockIds);
  if (!deleted.length) return;
  specCheckedBlockIds = new Set();
  if (selectedBlockId && deleted.includes(selectedBlockId)) {
    selectedBlockId = null;
    specSelectionAnchorId = null;
  }
  refreshWorkspaceConstraints(workspace);
  persistBlocklyCanvas({ summary: "Delete marked mapping spec nodes" });
  refreshMappingSpecView();
}

function updateSpecBulkButtons(): void {
  specDeleteMarkedBtn.disabled = specCheckedBlockIds.size === 0;
}

function wireMappingSpecLayoutMenu(): void {
  const chevron = document.getElementById("tab-mapping-json-menu");
  const main = document.getElementById("tab-mapping-json");
  const menu = document.getElementById("menu-mapping-spec-layout");
  if (
    !(chevron instanceof HTMLButtonElement) ||
    !(main instanceof HTMLButtonElement) ||
    !menu
  ) {
    return;
  }
  installSpecLayoutMenu({
    chevron,
    main,
    menu,
    onLayout: (layout) => specChromeUi?.setLayout(layout),
  });
}
const exportEditor = createReadonlyEditor(
  document.getElementById("export-editor")!,
  "",
  "typescript",
  { copyAll: copyAllToClipboard },
);
const testOutputEditor = createReadonlyEditor(
  document.getElementById("test-output")!,
  "",
  "json",
  { copyAll: copyAllToClipboard },
);

const exportDownloadBtn = wireEditorActionToolbar({
  toolbar: document.getElementById("export-editor-toolbar")!,
  view: exportEditor,
  copyText: copyAllToClipboard,
  onDownload: () => controller.exportTypeScript(),
  locale: detectLocale,
  i18n: {
    searchTitle: "searchScriptTitle",
    searchAria: "searchScriptAria",
    copyTitle: "copyScriptTitle",
    copyAria: "copyScriptAria",
    downloadTitle: "downloadScriptTitle",
    downloadAria: "downloadScriptAria",
  },
}).downloadButton;

const testDownloadBtn = wireEditorActionToolbar({
  toolbar: document.getElementById("test-output-toolbar")!,
  view: testOutputEditor,
  copyText: copyAllToClipboard,
  onDownload: () => controller.exportTestOutput(),
  locale: detectLocale,
  i18n: {
    searchTitle: "searchTestTitle",
    searchAria: "searchTestAria",
    copyTitle: "copyTestTitle",
    copyAria: "copyTestAria",
    downloadTitle: "downloadTestTitle",
    downloadAria: "downloadTestAria",
  },
}).downloadButton;

wireEditorActionToolbar({
  toolbar: document.getElementById("spec-editor-toolbar")!,
  view: specEditor,
  copyText: copyAllToClipboard,
  onDownload: () => controller.exportBlocklyDefinition(),
  locale: detectLocale,
  i18n: {
    searchTitle: "searchSpecTitle",
    searchAria: "searchSpecAria",
    copyTitle: "copySpecTitle",
    copyAria: "copySpecAria",
    downloadTitle: "downloadSpecTitle",
    downloadAria: "downloadSpecAria",
  },
});

/** Set in boot() after locale + inject. */
let workspace!: Blockly.WorkspaceSvg;
let blocklyLocale = detectLocale();
let selectedBlockId: string | null = null;
let applyingSelection = false;
let blocklySkeletonKey = "";
let blocklyLabelLanguage = "";
let blocklySlotSignature = "";
let followActiveAgent = localStorage.getItem("intehr-follow-agent") === "1";
let lastSemanticEventSummary = "Edit mapping canvas";
let toolboxKey = "";
let ephemeralTreeHighlight: TreeHighlightState | null = null;
let lastActiveExampleId: string | null = null;
let suppressBlocklyModelSync = false;
let applyingDocumentUndo = false;
/** Desktop: fingerprint of the document last committed to / synced from the Agent API. */
let committedDocSignature = "";
/** Desktop: the document as last committed / synced, for the lease warning (what your edit changed, Cancel). */
let committedSnapshot: DocumentSnapshot | null = null;

/** The document as it is now is what the session has: no pending local change. */
function markCommitted(signature = documentCommitSignature()): void {
  committedDocSignature = signature;
  if (isDesktopEnvironment()) committedSnapshot = controller.exportDocumentSnapshot();
}
/** True while a bundle written by an agent is being applied (not a local change). */
let applyingAgentBundle = false;
/** Summary for the next commit of a controller-originated change. */
let pendingCommitSummary: string | null = null;
let pendingCommitKind: "undo" | "redo" | "revert" | null = null;
/**
 * Who made the change behind a Blockly undo group (ADR 0014): Undo rewinds
 * from the top whoever made the change, and the status line names them.
 * Ungrouped canvas events are the person's own edits.
 */
const undoGroupAuthors = new Map<string, string>();
/** Set once the start-up project is in place; earlier changes are not history. */
let historyReady = false;
let historyPanel: HistoryPanelHandle | null = null;
/** Desktop: author of the next pulled change when you started it from the history panel. */
let nextPullAuthor: string | null = null;
/** Slot fingerprints at the last commit / sync, to see which slots a change touched. */
let committedSlots = new Map<string, string>();
/** Slot id → AI author mark, until a person changes that slot. */
const aiAuthorMarks = new Map<string, AiAuthorMark>();

const aiAuthorTitle = (by: string) => formatMessage(uiChrome().aiAuthorTitle, { author: by });

/**
 * AI author marker (ADR 0014): slots an AI write (or a pulled MCP change)
 * changed get the mark on their expression block; slots a person changed
 * lose it. Undo, redo and revert only move existing marks with the blocks.
 */
function updateAiAuthorMarks(
  author: { by: string; origin: AiAuthorMark["origin"]; slots?: Set<string> } | "human" | "keep",
): void {
  const next = slotFingerprints(controller.getState().model.slots);
  const changed = changedSlots(committedSlots, next);
  committedSlots = next;
  if (!workspace) return;
  const blocks = slotExpressionBlocks(workspace);
  const at = new Date().toISOString();
  for (const slotId of changed) {
    if (author === "human") aiAuthorMarks.delete(slotId);
    else if (author !== "keep") {
      if (!author.slots) aiAuthorMarks.set(slotId, { by: author.by, origin: author.origin, at });
    }
    else {
      // Undo, redo, revert: the mark follows the blocks that came back.
      const block = blocks.get(slotId);
      const mark = block ? readAiAuthor(block) : undefined;
      if (mark) aiAuthorMarks.set(slotId, mark);
      else aiAuthorMarks.delete(slotId);
    }
  }
  // The chat's tool calls name their slots: mark those, not side effects of a re-render.
  if (typeof author === "object" && author.slots) {
    for (const slotId of author.slots) {
      if (aiAuthorMarks.get(slotId)?.by !== author.by) aiAuthorMarks.set(slotId, { by: author.by, origin: author.origin, at });
    }
  }
  applyAiAuthorMarks(blocks);
}

/** Put the marks on the canvas again (a re-render rebuilds blocks from the model). */
function applyAiAuthorMarks(blocks = workspace ? slotExpressionBlocks(workspace) : new Map()): void {
  let touched = false;
  const marked = new Set<unknown>();
  for (const [slotId, block] of blocks) {
    const want = aiAuthorMarks.get(slotId);
    if (want) marked.add(block);
    const have = readAiAuthor(block);
    if (want?.by === have?.by && want?.at === have?.at) continue;
    writeAiAuthor(block, want, aiAuthorTitle);
    touched = true;
  }
  // A mark left on a block that no longer holds its slot's expression goes too.
  for (const block of workspace?.getAllBlocks(false) ?? []) {
    if (marked.has(block) || !block.data || !readAiAuthor(block)) continue;
    writeAiAuthor(block, undefined, aiAuthorTitle);
    touched = true;
  }
  if (!touched) return;
  // Keep the marks in the saved Blockly JSON (save and export carry them)
  // without making the mark itself a change in the history.
  persistBlocklyCanvas({ notify: false });
  markCommitted();
  chatServiceInstance?.acceptLiveState();
}

/** After a project load: take the marks saved in its blocks. */
function adoptAiAuthorMarks(): void {
  aiAuthorMarks.clear();
  if (!workspace) return;
  for (const [slotId, block] of slotExpressionBlocks(workspace)) {
    const mark = readAiAuthor(block);
    if (mark) aiAuthorMarks.set(slotId, mark);
  }
}

/** Slots the chat service recorded for one AI turn (its tool calls' targets). */
function turnSlots(origin: UiCommitOrigin): Set<string> | undefined {
  const turnId = origin.turnId;
  // A pasted answer is applied without the service: mark what changed.
  if (!turnId || !chatServiceInstance || origin.provider === "copy-paste") return undefined;
  const entries = chatServiceInstance.listHistory().filter((e) => e.actor.turnId === turnId);
  return new Set(entries.flatMap((e) => e.affectedSlotIds ?? []));
}

/** Start the one history once the start-up project is loaded (web app: in the browser). */
function startHistory(): void {
  markCommitted();
  committedSlots = slotFingerprints(controller.getState().model.slots);
  adoptAiAuthorMarks();
  if (!isDesktopEnvironment()) chatService();
  historyReady = true;
}

async function loadHistoryRows(): Promise<HistoryPanelRow[]> {
  if (!isDesktopEnvironment()) return chatService().listHistory();
  const res = await fetch("/api/v1/history");
  const json = await res.json() as { entries?: HistoryPanelRow[] } | HistoryPanelRow[];
  return Array.isArray(json) ? json : json.entries ?? [];
}

async function postAgentApi<T>(path: string, body: unknown): Promise<T> {
  await commitPendingUiChange();
  await commitsSettled();
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(String((json as { error?: string }).error ?? res.status));
  return json as T;
}

/** History panel: Undo to here (take back every later change, whoever made it). */
async function historyUndoTo(row: HistoryPanelRow): Promise<void> {
  type Undone = { author?: string };
  let result: Undone | null;
  if (isDesktopEnvironment()) {
    nextPullAuthor = USER_ACTOR.displayName;
    result = await postAgentApi<Undone>("/undo", { toSeq: row.seq });
  } else {
    await commitPendingUiChange();
    const group = `history:${crypto.randomUUID()}`;
    undoGroupAuthors.set(group, USER_ACTOR.displayName);
    absorbTrailingRender();
    result = await withUndoableDocumentReplace(() => chatService().undoTo(row.seq, { actor: USER_ACTOR }), group);
    absorbTrailingRender();
    markCommitted();
    updateAiAuthorMarks("keep");
    render();
  }
  if (result?.author) controller.setStatusMessage(formatMessage(uiChrome().undoneBy, { author: result.author }));
}

/** History panel: Revert one change as a new change at the end; report skipped slots. */
async function historyRevert(row: HistoryPanelRow): Promise<void> {
  type Reverted = {
    ok: boolean;
    revertedSeq: number;
    author: string;
    reverted: string[];
    sheetsReverted: boolean;
    skipped: Array<{ slotId: string; label?: string }>;
    notReverted: string[];
  };
  let result: Reverted;
  if (isDesktopEnvironment()) {
    nextPullAuthor = USER_ACTOR.displayName;
    result = await postAgentApi<Reverted>("/revert", { seq: row.seq });
  } else {
    await commitPendingUiChange();
    const group = `history:${crypto.randomUUID()}`;
    undoGroupAuthors.set(group, USER_ACTOR.displayName);
    absorbTrailingRender();
    result = await withUndoableDocumentReplace(() => chatService().revert(row.seq, { actor: USER_ACTOR }), group);
    absorbTrailingRender();
    markCommitted();
    updateAiAuthorMarks("keep");
    render();
  }
  const m = uiChrome();
  const count = result.reverted.length + (result.sheetsReverted ? 1 : 0);
  const parts = [
    count
      ? formatMessage(m.historyRevertDone, { seq: result.revertedSeq, author: result.author, count })
      : formatMessage(m.historyRevertNothing, { seq: result.revertedSeq }),
  ];
  const skipped = result.skipped.filter((s) => s.slotId !== "sheets" || count);
  if (count && skipped.length) {
    const names = skipped.map((s) => s.slotId === "sheets" ? "Sheets" : describeSlotForNotes(s.slotId) ?? s.label ?? s.slotId);
    parts.push(formatMessage(m.historyRevertSkipped, { slots: names.join(", ") }));
  }
  if (result.notReverted.length) parts.push(formatMessage(m.historyRevertNotReverted, { parts: result.notReverted.join(", ") }));
  controller.setStatusMessage(parts.join(" "));
}

function undoAuthor(redo: boolean): string | null {
  const stack = redo ? workspace.getRedoStack() : workspace.getUndoStack();
  const top = stack.at(-1);
  if (!top) return null;
  return (top.group && undoGroupAuthors.get(top.group)) || USER_ACTOR.displayName;
}

/** Wrap Blockly's undo (button, Ctrl+Z, Ctrl+Shift+Z) to name the author in the status line. */
function installUndoAuthorStatus(ws: Blockly.WorkspaceSvg): void {
  const blocklyUndo = ws.undo.bind(ws);
  ws.undo = (redo: boolean) => {
    const author = undoAuthor(redo);
    if (!author) return blocklyUndo(redo);
    const message = formatMessage(redo ? uiChrome().redoneBy : uiChrome().undoneBy, { author });
    // Set before undoing: a document swap restores (and commits) synchronously.
    pendingCommitSummary = message;
    pendingCommitKind = redo ? "redo" : "undo";
    blocklyUndo(redo);
    controller.setStatusMessage(message);
  };
}
/** Set for the duration of an AI chat turn: commit origin, Blockly undo group, ✓ notices. */
let activeAiCommit: { origin: UiCommitOrigin; notices: string[] } | null = null;
/**
 * > 0 while the AI itself writes (a mutating tool, an applied suggestions
 * answer). Only those changes are attributed to the AI; a person editing the
 * canvas during a turn stays the person.
 */
let aiWriteDepth = 0;

/** The AI turn whose write is running right now, if any. */
function aiWriteInProgress(): { origin: UiCommitOrigin; notices: string[] } | null {
  return aiWriteDepth > 0 ? activeAiCommit : null;
}

/** Run a synchronous AI write (it renders, and so commits, before returning). */
function asAiWriteSync<T>(fn: () => T): T {
  aiWriteDepth++;
  try {
    return fn();
  } finally {
    aiWriteDepth--;
    absorbTrailingRender();
  }
}

/**
 * Web app: Blockly fires the change events of a re-render in the next task,
 * after the service recorded the write. Those only normalize the canvas, so
 * they belong to the recorded change, not to a new entry by you.
 */
let absorbingRender = false;
function absorbTrailingRender(): void {
  if (isDesktopEnvironment()) return;
  absorbingRender = true;
  globalThis.setTimeout(() => {
    absorbingRender = false;
  }, 0);
}

/**
 * Run an AI tool call. The chat tools write synchronously and only wait on
 * microtasks, so no person's event can land while the depth is raised.
 */
async function asAiWrite<T>(fn: () => Promise<T>): Promise<T> {
  aiWriteDepth++;
  try {
    return await fn();
  } finally {
    aiWriteDepth--;
    absorbTrailingRender();
  }
}
let documentReplaceDepth = 0;

function flashSheetsChrome(): void {
  const tab = sheetsTab;
  if (!(tab instanceof HTMLElement)) return;
  tab.classList.remove("sheets-flash");
  void tab.offsetWidth;
  tab.classList.add("sheets-flash");
  globalThis.setTimeout(() => tab.classList.remove("sheets-flash"), 4000);
}

function showTextView(view: "mapping-json" | "sheets"): void {
  const showSheets = view === "sheets";
  mappingJsonHost.hidden = showSheets;
  if (specEditorWrap) specEditorWrap.hidden = showSheets;
  sheetsHost.hidden = !showSheets;
  specBulkBar.hidden = showSheets;
  if (sheetsActions) sheetsActions.hidden = !showSheets;
  mappingJsonTab.classList.toggle("active", view === "mapping-json");
  sheetsTab?.classList.toggle("active", showSheets);
  if (uploadSpecBtn) uploadSpecBtn.hidden = showSheets;
  if (showSheets) sheetsPanel?.refresh();
}

mappingJsonTab.addEventListener("click", () => showTextView("mapping-json"));
sheetsTab?.addEventListener("click", () => showTextView("sheets"));
specMarkWarnedBtn.addEventListener("click", () => markAllWarnedOptionalUnmapped());
specDeleteMarkedBtn.addEventListener("click", () => deleteMarkedSpecBlocksFromCanvas());
uploadSpecBtn?.addEventListener("click", () =>
  void withUndoableDocumentReplace(() => controller.importBlocklyDefinition())
);
exportTargetSelect.addEventListener("change", () => {
  const target = exportTargetSelect.value as
    | "preview"
    | "typescript"
    | "java"
    | "handlebars"
    | "xquery"
    | "go-template";
  controller.setExportTarget(target);
});
instanceShapeSelect?.addEventListener("change", () => {
  controller.setOpenEhrInstanceShape(
    instanceShapeSelect.value as import("@intehrgrator/types/mod.ts").OpenEhrInstanceShape,
  );
});

function setupUiLanguageMenu(locale: IntehrLocale): void {
  const labelEl = document.getElementById("ui-language-label");
  const select = document.getElementById("ui-language-dropdown") as HTMLSelectElement | null;
  if (!select) return;
  if (labelEl) labelEl.textContent = msg(locale).UI_LANGUAGE_LABEL;
  select.replaceChildren();
  for (const { code, name } of SUPPORTED_LOCALES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    if (code === locale) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    const next = select.value as IntehrLocale;
    const bundle = controller.exportDocumentSnapshot();
    if (stashLocaleReloadProject(bundle)) {
      changeLocaleAndReload(next);
      return;
    }
    void host.saveAutosave(bundle).finally(() => {
      markLocaleReloadAutosave();
      changeLocaleAndReload(next, Blockly.serialization.workspaces.save(workspace));
    });
  });
}

let targetLangWidget: LanguageWidget | null = null;
let sourceLangWidget: LanguageWidget | null = null;

/** 💬 widgets on the target and source panes (#279). */
function setupLanguageWidgets(): void {
  const targetRoot = document.getElementById("target-lang-widget");
  if (targetRoot) {
    targetLangWidget = createLanguageWidget(targetRoot, {
      nameOf: displayLanguageName,
      isKnown: isKnownLanguage,
      onPick: (code) => code ? controller.setModelLanguage(code) : controller.clearTargetDisplayLanguage(),
      texts: () => ({
        aria: uiChrome().langWidgetTargetAria,
        title: uiChrome().langWidgetTitle,
        follow: uiChrome().langWidgetFollow,
        chosen: uiChrome().langWidgetChosen,
        unknown: uiChrome().langWidgetUnknown,
      }),
    });
  }
  const sourceRoot = document.getElementById("source-lang-widget");
  if (sourceRoot) {
    sourceLangWidget = createLanguageWidget(sourceRoot, {
      nameOf: displayLanguageName,
      isKnown: isKnownLanguage,
      onPick: (code) => controller.setSourceDisplayLanguage(code),
      texts: () => ({
        aria: uiChrome().langWidgetSourceAria,
        title: uiChrome().langWidgetTitle,
        follow: uiChrome().langWidgetFollow,
        chosen: uiChrome().langWidgetChosen,
        unknown: uiChrome().langWidgetUnknown,
      }),
    });
  }
}

let idLanguageChoicesKey = "";

/** Id-language dropdowns on COMPOSITION roots follow the target's languages (#289). */
function syncIdLanguageFields(s: ReturnType<WorkbenchController["getState"]>): void {
  const key = s.targetIdLanguages.join(",");
  if (key === idLanguageChoicesKey) return;
  idLanguageChoicesKey = key;
  setIdLanguageChoices(s.targetIdLanguages);
  const ws = Blockly.getMainWorkspace?.();
  for (const block of ws?.getBlocksByType("composition", false) ?? []) {
    const field = block.getField(ID_LANGUAGE_FIELD) as unknown as
      | { doValueUpdate_(v: string): void; getValue(): string; forceRerender(): void }
      | null;
    if (!field) continue;
    field.doValueUpdate_(field.getValue());
    field.forceRerender();
  }
}

/**
 * Changing the id language keeps every mapping (slot ids are archetype paths)
 * but changes the target's Simplified FLAT paths, so ask once mappings exist.
 */
function confirmIdLanguageChange(from: string, to: string): boolean {
  const s = controller.getState();
  // Template defaults (context map, fixed codes) are not mappings; source-bound slots are.
  if (!mappedSourcePathsFromExpressions(s.model.slots.map((slot) => slot.expression ?? "")).length) return true;
  const code = (v: string) => v === PRIMARY_ID_LANGUAGE ? (s.targetIdLanguages[0] ?? "lang.1") : v;
  return globalThis.confirm(formatMessage(msg(detectLocale()).ID_LANGUAGE_CONFIRM, { from: code(from), to: code(to) }));
}
setIdLanguageChangeGuard(confirmIdLanguageChange);

function syncLanguageWidgets(s: ReturnType<WorkbenchController["getState"]>): void {
  syncIdLanguageFields(s);
  targetLangWidget?.update({
    languages: s.modelLanguages.length > 1 ? s.targetLanguages : [],
    current: s.modelLanguage,
    chosen: s.targetDisplayChosen,
  });
  sourceLangWidget?.update({
    languages: s.sourceSchemaLanguages,
    current: s.sourceDisplayLanguage,
    chosen: Boolean(s.settings.display?.sourceLabelLang),
  });
}

let targetHoverCache: { key: string; byLang: Array<[string, Map<string, string>]> } | null = null;

/** Hover text on target tree rows: the label in the target's other languages (#279). */
function targetAltLabels(s: ReturnType<WorkbenchController["getState"]>): ((slotId: string) => string | undefined) | undefined {
  if (s.modelLanguages.length < 2) return undefined;
  const key = `${s.templateId}|${s.modelLanguage}|${s.targetLanguages.join(",")}`;
  if (targetHoverCache?.key !== key) {
    const others = s.targetLanguages.filter((l) => l !== s.modelLanguage);
    targetHoverCache = { key, byLang: others.map((l) => [l, controller.getTargetLabels(l)]) };
  }
  const byLang = targetHoverCache.byLang;
  return (slotId) => {
    const parts = byLang.map(([l, m]) => (m.get(slotId) ? `${l}: ${m.get(slotId)}` : "")).filter(Boolean);
    return parts.length ? parts.join("\n") : undefined;
  };
}

/** AI menu → Languages…: `source.lang.N` and which target labels go to the AI (#279). */
function openAiLanguagesDialog(): void {
  const dialog = document.getElementById("dialog-ai-languages") as HTMLDialogElement | null;
  const input = document.getElementById("ai-source-languages") as HTMLInputElement | null;
  const hint = document.getElementById("ai-source-languages-hint");
  const preview = document.getElementById("ai-languages-preview");
  if (!dialog || !input) return;
  const current = controller.getLanguageSettings();
  input.value = current.sourceLanguages?.join(", ") ?? "";
  input.placeholder = current.detectedSourceLanguages.join(", ") || "sv, en";
  dialog.querySelectorAll<HTMLInputElement>("input[name=ai-context-languages]").forEach((r) => {
    r.checked = r.value === current.aiContextLanguages;
  });
  const refresh = () => {
    const t = uiChrome();
    const typed = parseLanguageList(input.value);
    const unknown = typed.filter((c) => !isKnownLanguage(c));
    const detected = current.detectedSourceLanguages;
    if (hint) {
      hint.textContent = unknown.length
        ? t.aiSourceLanguagesInvalid.replace("{codes}", unknown.join(", "))
        : detected.length
        ? t.aiSourceLanguagesDetected.replace("{langs}", detected.join(", "))
        : t.aiSourceLanguagesNone;
      hint.classList.toggle("is-error", unknown.length > 0);
    }
    const mode = (dialog.querySelector<HTMLInputElement>("input[name=ai-context-languages]:checked")?.value ??
      "matched") as "matched" | "lang1" | "all";
    const { target: order, ai } = controller.previewLanguages(typed.filter(isKnownLanguage), mode);
    if (preview) {
      preview.textContent = order.length
        ? t.aiLanguagesPreview.replace("{order}", order.join(", ")).replace("{ai}", ai.join(", "))
        : "";
    }
  };
  input.oninput = refresh;
  dialog.querySelectorAll<HTMLInputElement>("input[name=ai-context-languages]").forEach((r) => (r.onchange = refresh));
  refresh();
  const cancel = document.getElementById("ai-languages-cancel");
  if (cancel) cancel.onclick = () => dialog.close("cancel");
  dialog.returnValue = "cancel";
  dialog.onclose = () => {
    if (dialog.returnValue !== "confirm") return;
    const mode = (dialog.querySelector<HTMLInputElement>("input[name=ai-context-languages]:checked")?.value ??
      "matched") as "matched" | "lang1" | "all";
    controller.setLanguageSettings({
      sourceLanguages: parseLanguageList(input.value).filter(isKnownLanguage),
      aiContextLanguages: mode,
    });
  };
  dialog.showModal();
  input.focus();
}

function displayLanguageName(code: string): string {
  try {
    const display = new Intl.DisplayNames([blocklyLocale, "en"], { type: "language" });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

async function projectForLocaleReload(): Promise<ProjectBundle | null> {
  const stashed = takeLoadOnceProject();
  if (isStashedProjectBundle(stashed)) return stashed as ProjectBundle;
  if (!takeLocaleReloadAutosave()) return null;
  const record = await host.loadStoredProjectRecord(AUTOSAVE_STORAGE_KEY);
  return record?.bundle ?? null;
}

async function bootBlockly(): Promise<void> {
  const locale = detectLocale();
  blocklyLocale = locale;
  controller.setUiLanguage(locale);
  await loadBlocklyLocale(locale);
  initBlocklyGenerators();
  setupUiLanguageMenu(locale);
  setupLanguageWidgets();

  workspace = Blockly.inject(blocklyMount, {
    theme: createModestTheme(),
    toolbox: buildDemoToolbox(locale),
    collapse: true,
    grid: { spacing: 20, length: 2, colour: "#E8EAED" },
    zoom: {
      controls: true,
      wheel: true,
      startScale: 1,
      maxScale: 1.8,
      minScale: 0.6,
      scaleSpeed: 1.2,
      pinch: true,
    },
    move: { scrollbars: true, drag: true, wheel: true },
    trashcan: false,
    renderer: registerCompactThrasosRenderer(),
  });
  installExtractToFunctionOnWorkspace(workspace);
  installUndoAuthorStatus(workspace);
  installAiAuthorMarkers(workspace, aiAuthorTitle);
  installCollapseChildrenMenu(workspace, {
    expandChildren: () => uiChrome().expandChildren,
    collapseChildren: () => uiChrome().collapseChildren,
  });
  installAiReviewMarkers(workspace, {
    labels: {
      markReviewed: () => uiChrome().aiMarkReviewed,
      comment: () => uiChrome().aiReviewComment,
      confidence: () => uiChrome().aiReviewConfidence,
    },
    onChange: () => persistBlocklyCanvas({ summary: "Mark AI suggestion reviewed" }),
  });
  installFunctionLibraryMenus(workspace, {
    save: (name) => functionLibraryUi?.saveNamed(name),
    contribute: (name) => functionLibraryUi?.contributeNamed(name),
  });
  installBlocklyFloatingOverlays();

  const localeProject = await projectForLocaleReload();
  const loadOnce = localeProject ? null : takeLoadOnceBlocks();
  if (loadOnce) {
    Blockly.serialization.workspaces.load(
      migrateForEachSourceState(loadOnce) as Record<string, unknown>,
      workspace,
    );
    lockWorkspaceRootsExpanded(workspace);
  }
  runWithoutBlocklyEvents(() => {
    ensureDefaultsBlock(workspace, blocklyLocale, undefined, { factory: false });
    ensureConversionStartOnScaffold(workspace);
  });

  specChromeUi = mountMappingSpecChrome(mappingJsonHost, {
    getBlocklyState: () => Blockly.serialization.workspaces.save(workspace),
    onLayoutChange: () => refreshMappingSpecView(),
  });
  wireMappingSpecLayoutMenu();

  setDefaultsMapPickHandler(() => {
    void openDefaultsMapDialog();
  });
  setDefaultsMapInfoHandler((anchor) => {
    const tip = document.getElementById("defaults-map-block-info");
    if (!(tip instanceof HTMLElement)) return;
    openInfoTipAt(tip, anchor ?? tip.querySelector(".info-tip-btn") ?? tip);
  });
  setDefaultsMapHardcodeHandler(() => {
    openHardcodeDefaultsDialog();
  });
  setDefaultContextMapApplyHandler(() => {
    applyDefaultContextMapFromCanvas();
  });
  setSheetFocusHandler((name, opts) => {
    if (!name.trim()) return;
    showTextView("sheets");
    sheetsPanel?.showSheet(name, "sheet", {
      highlight: opts?.highlight ?? true,
      create: false,
    });
    if (opts?.highlight ?? true) flashSheetsChrome();
  });
  setDecisionTableFocusHandler((name, opts) => {
    if (!name.trim()) return;
    showTextView("sheets");
    sheetsPanel?.showSheet(name, "decision-table", {
      highlight: opts?.highlight ?? true,
      create: false,
    });
    if (opts?.highlight ?? true) flashSheetsChrome();
  });
  setGridCreateHandler((kind) => {
    const name = sheetsPanel?.promptNewGrid(kind);
    if (!name) return;
    showTextView("sheets");
  });
  registerGridFlyoutButtons(workspace);
  setDecisionTableInfoHandler((anchor) => {
    const tip = document.getElementById("decision-table-block-info");
    if (!(tip instanceof HTMLElement)) return;
    openInfoTipAt(tip, anchor ?? tip.querySelector(".info-tip-btn") ?? tip);
  });
  setWorkspaceSheetsProvider(() => controller.getSheets());
  sheetsPanel = mountSheetsPanel(sheetsHost, {
    getSheets: () => controller.getSheets(),
    replaceSheets: (sheets, opts) => controller.replaceSheets(sheets, opts),
    markDirty: () => controller.markDirty(),
  }, {
    getWorkspace: () => workspace,
    getLocale: () => blocklyLocale,
    actionsHost: sheetsActions,
  });
  installDecisionTableSync(
    workspace,
    () => controller.getSheets(),
    (sheets) => controller.replaceSheets(sheets),
  );
  if (sheetsTab) sheetsTab.textContent = sheetsChrome(blocklyLocale).tab;

  attachWorkspaceMinimap(workspace, blocklyMount);
  installToolboxSearchInputFix(blocklyMount, () => workspace);
  installCanvasPaneFind();

  setAfterCanvasSwapRun(() => {
    persistBlocklyCanvas();
  });

  setOptionalRmMutatorChangeHandler((change) => {
    withBlocklyUndoGroup(() => {
      const slotId = change.parent.getFieldValue("SLOT_ID") || "";
      const rmType = rmTypeOfBlock(change.parent);
      for (const name of change.removed) {
        if (slotId) controller.removeOptionalRm(slotId, name);
      }
      for (const name of change.added) {
        const present = presentAttributeNames(change.parent).filter((attr) => attr !== name);
        const options = controller.getOptionalAttachmentsFor(rmType, slotId, present);
        const picked = options.find((option) => option.attributeName === name) ?? {
          attributeName: name,
          rmType: slotRmTypeForAttr(rmType, name) || name,
          label: name,
          cardinality: { min: 0, max: 1 },
        };
        if (slotId) controller.addOptionalRm(slotId, picked.rmType, name);
        const input = change.parent.getInput(optionalRmInputName(name)) ??
          change.parent.getInput(rmAttributeInputName(name));
        if (!input?.connection?.targetBlock()) {
          attachOptionalRmChild(workspace, change.parent, picked);
        }
      }
    });
  });

  setSchemaFieldsMutatorChangeHandler((change) => {
    withBlocklyUndoGroup(() => {
      const slotId = change.parent.getFieldValue("SLOT_ID") || "";
      for (const name of change.removed) {
        if (slotId) controller.removeOptionalRm(slotId, name);
      }
      for (const name of change.added) {
        const parentNode = slotId ? findSkeletonNode(slotId) : undefined;
        const childNode = parentNode?.children.find(
          (child) => (child.rmAttribute ?? child.label) === name,
        );
        const rmType = childNode?.rmType ?? name;
        if (slotId) controller.addOptionalRm(slotId, rmType, name);
        const input = change.parent.getInput(schemaOptionalInputName(name));
        if (!input?.connection?.targetBlock()) {
          attachOptionalSchemaChild(workspace, change.parent, name);
        }
      }
    });
  });

  workspace.configureContextMenu = (options) => {
    const selected = Blockly.getSelected?.() as { firePlusClick?: () => void } | null;
    if (selected?.firePlusClick) {
      options.push({
        text: uiChrome().optionalAttributes,
        enabled: true,
        callback: () => openBlockMutator(selected as Blockly.Block),
      });
    }
    options.push({
      text: uiChrome().openViewerMenu,
      enabled: workspace.getTopBlocks(false).length > 0,
      callback: () => openCanvasSnapshot(),
    });
  };

  initSplitPanes(document, () => Blockly.svgResize(workspace));
  controller.setBlocklyStateGetter(() => Blockly.serialization.workspaces.save(workspace));
  initBlocklyCanvasDrop();
  initOutputTabs();
  initSlideAway();
  // Subscribe before the locale-reload notify. Restoring with no listener
  // leaves the boot defaults block on the canvas, and the next save replaces
  // the stashed project with that one block.
  controller.subscribe(render);
  controller.subscribe(() => aiChat?.refresh());
  if (localeProject) {
    controller.restoreAfterLocaleChange(localeProject);
  }

  workspace.addChangeListener((event) => {
    refreshUndoButtons();
    if (
      event.type === Blockly.Events.BLOCK_CREATE &&
      "blockId" in event &&
      typeof event.blockId === "string"
    ) {
      const created = workspace.getBlockById(event.blockId);
      if (created?.type === CONVERSION_START_TYPE) {
        enforceConversionStartUniqueness(workspace);
      }
    }
    if (event.type === DOCUMENT_SWAP_EVENT_TYPE) return;
    if (event.type === SHEET_CHANGE_EVENT_TYPE) {
      refreshUndoButtons();
      return;
    }
    if (event.type === CANVAS_SWAP_EVENT_TYPE) {
      refreshUndoButtons();
      refreshWorkspaceConstraints(workspace);
      return;
    }
    if (event.type === Blockly.Events.CLICK) {
      const blockId = "blockId" in event && typeof event.blockId === "string"
        ? event.blockId
        : null;
      applyBlockSelection(blockId, "blockly");
      return;
    }
    if (
      event.type === Blockly.Events.BLOCK_CHANGE &&
      "name" in event &&
      event.name === "RM_TYPE" &&
      "blockId" in event &&
      typeof event.blockId === "string"
    ) {
      const block = workspace.getBlockById(event.blockId);
      const next = String((event as { newValue?: unknown }).newValue ?? "");
      if (block && (isEventFamilyType(next) || next === "EVENT")) {
        withBlocklyUndoGroup(() => applyEventRmType(block, next));
      } else if (block && (isItemStructureFamilyType(next) || next === "ITEM_STRUCTURE")) {
        withBlocklyUndoGroup(() => applyItemStructureRmType(block, next));
      }
    }
    if (event.type !== Blockly.Events.FINISHED_LOADING && !event.isUiEvent) {
      refreshWorkspaceConstraints(workspace);
    }
    if (event.type === Blockly.Events.FINISHED_LOADING || event.isUiEvent) return;
    if (suppressBlocklyModelSync || applyingDocumentUndo) return;
    if (!isSemanticBlocklyEvent(event)) return;
    lastSemanticEventSummary = summarizeBlocklyEvent(event);
    persistBlocklyCanvas({ summary: lastSemanticEventSummary });
  });

  installAgentBridge({
    controller,
    flushLocal: () => commitPendingUiChange(),
    applyRemote: applyAgentBundle,
    onBaseline: () => {
      markCommitted();
    },
    onLeases: (leases, humanWins) => {
      showLeases(leases);
      showHumanWins(humanWins);
    },
    onActivity: (activity) => {
      if (activity?.displayName) lastAgentAuthor = activity.displayName;
      if (!activity) return;
      updateAgentObserverActivity(activity);
      pulseAgentActivity(activity);
    },
  });

  installLeaseChip();
  installLeaseWarning();
  const followCheckbox = document.getElementById("chk-follow-agent") as HTMLInputElement | null;
  if (followCheckbox) {
    followCheckbox.checked = followActiveAgent;
    followCheckbox.addEventListener("change", () => {
      followActiveAgent = followCheckbox.checked;
      localStorage.setItem("intehr-follow-agent", followActiveAgent ? "1" : "0");
    });
  }
}

function activeTreeHighlight(s: ReturnType<WorkbenchController["getState"]>): TreeHighlightState {
  return ephemeralTreeHighlight ?? s.treeHighlight;
}

function handleTreeHighlight(
  syncPath: string | null,
  origin: "schema" | "instance",
  persist = false,
): void {
  if (syncPath === null) {
    if (ephemeralTreeHighlight?.origin !== origin) return;
    ephemeralTreeHighlight = null;
  } else if (persist) {
    ephemeralTreeHighlight = null;
    controller.setTreeHighlight(syncPath, origin);
  } else {
    ephemeralTreeHighlight = { syncPath, origin };
  }
  applyTreeHighlights(
    schemaTreeEl,
    exampleTreeEl,
    activeTreeHighlight(controller.getState()),
  );
}

function treeHighlightOptions() {
  return {
    onHighlight: (syncPath: string | null, origin: "schema" | "instance") => {
      handleTreeHighlight(syncPath, origin, false);
    },
  };
}

function handleSourceSelection(
  path: string,
  format: string,
  event?: { shiftKey?: boolean },
): void {
  const selected = selectedBlockId
    ? workspace.getBlockById(selectedBlockId)
    : (Blockly.getSelected?.() as ReturnType<typeof workspace.getBlockById>);
  if (selected && isHandlebarsInsertTarget(selected)) {
    const xpath = getSourceFormatHandler(format).pathToExpression(path);
    if (insertHandlebarsPathAtSelection(selected, xpath, Boolean(event?.shiftKey))) {
      persistBlocklyCanvas({ summary: "Insert Handlebars path" });
      return;
    }
  }
  const state = controller.getState();
  if (state.listeningSourceBlockId) {
    fillListeningSourceQuery(state.listeningSourceBlockId, path, format);
    return;
  }
  controller.bindFromNode(path, format);
}

function syncHandlebarsClickHint(): void {
  const hint = document.getElementById("handlebars-click-hint");
  if (!hint) return;
  const selected = selectedBlockId ? workspace.getBlockById(selectedBlockId) : null;
  hint.hidden = !isHandlebarsInsertTarget(selected);
}

function persistBlocklyCanvas(options?: { notify?: boolean; summary?: string }): void {
  const signatureBefore = blocklySlotSignature;
  const derived = workspaceToModelJson(workspace);
  controller.syncFromBlockly(
    Blockly.serialization.workspaces.save(workspace),
    derived.slots,
    derived.loops,
    derived.optionalRm,
    {
      notify: false,
      targetSignature: derived.targetSignature,
      unsupported: derived.unsupported,
      sheetNames: derived.sheetNames,
      instanceEncodings: derived.instanceEncodings,
      functions: derived.functions,
    },
  );
  const s = controller.getState();
  const signatureAfter = slotSignatureFrom(s.model.slots, s.model.loops ?? []);
  blocklySlotSignature = signatureAfter;
  refreshUndoButtons();
  if (signatureBefore !== signatureAfter) void commitPendingUiChange(options?.summary ?? "Edit mapping");
  if (options?.notify !== false) controller.notifyChange();
}

/**
 * Cheap fingerprint of what the shared history tracks (mapping model, sheets,
 * loaded files), without Blockly layout, so moving a block is not a commit.
 */
function documentCommitSignature(): string {
  const s = controller.getState();
  const payload = JSON.stringify([
    s.templateId,
    s.templateFilename,
    s.schemaFilename,
    s.examples.map((e) => e.id),
    s.model,
    s.sheets,
    s.handlebarsTemplate ?? "",
  ]);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${payload.length}:${(hash >>> 0).toString(16)}`;
}

/**
 * Desktop: commit the current document to the shared Agent API history when
 * it changed since the last commit or sync (ADR 0014). Runs after every
 * render, so controller-originated changes (Click-to-Map, AI chat tools,
 * Import Suggestions) are committed too, not only Blockly edits. During an AI
 * chat turn the commit carries the `ai-chat` origin and the turn id; the
 * session folds a turn's commits into one history entry.
 */
function commitPendingUiChange(
  summary?: string,
  options: { ai?: { origin: UiCommitOrigin; notices: string[] }; force?: boolean } = {},
): Promise<void> {
  const desktop = isDesktopEnvironment();
  if ((desktop && !isAgentBridgeSynced()) || applyingAgentBundle || !workspace || !historyReady) {
    return Promise.resolve();
  }
  const signature = documentCommitSignature();
  if (signature === committedDocSignature && !options.force) return Promise.resolve();
  // A lease warning is open: your change waits for Edit anyway / Cancel / the lease to end.
  if (leaseHold) return Promise.resolve();
  const absorbing = absorbingRender && !options.ai && !options.force && aiWriteDepth === 0;
  const ai = options.ai ?? aiWriteInProgress();
  if (desktop && !absorbing && !ai && committedSnapshot && currentLeases.length) {
    const hits = leaseWarningHits(committedSnapshot);
    if (hits.length) {
      openLeaseWarning(hits, committedSnapshot, summary);
      return Promise.resolve();
    }
  }
  markCommitted(signature);
  if (absorbing) {
    updateAiAuthorMarks("keep");
    chatServiceInstance?.acceptLiveState();
    return Promise.resolve();
  }
  const origin = ai?.origin;
  const text = ai
    ? `AI chat: ${ai.notices.slice(-6).join("; ") || "edit"}`
    : summary ?? pendingCommitSummary ?? controller.getState().statusMessage ?? "Edit mapping";
  const kind = ai ? undefined : pendingCommitKind ?? undefined;
  pendingCommitSummary = null;
  pendingCommitKind = null;
  const marks = () =>
    updateAiAuthorMarks(
      ai ? { by: aiChatActor(ai.origin).displayName, origin: "ai-chat", slots: turnSlots(ai.origin) } : kind ? "keep" : "human",
    );
  if (!desktop) {
    // Web app: the browser's own service keeps the one history (ADR 0014).
    const service = chatService();
    const actor = ai ? aiChatActor(ai.origin) : USER_ACTOR;
    if (!service.recordLiveChange(text.slice(0, 400), kind ?? "expression", actor) && ai?.origin.turnId) {
      service.history.updateTailSummary(ai.origin.turnId, text.slice(0, 400));
    }
    marks();
    historyPanel?.refresh();
    return Promise.resolve();
  }
  marks();
  queueMicrotask(() => historyPanel?.refresh());
  return commitUiChange(controller.exportDocumentSnapshot(), text.slice(0, 400), { origin, kind }).then((result) => {
    const hit = result?.overwritten[0];
    if (!hit) return;
    controller.setStatusMessage(
      formatMessage(uiChrome().agentChangeOverwritten, { agent: hit.actor, summary: hit.summary }),
    );
  });
}

/**
 * Desktop: apply a bundle an agent wrote as one undo step (ADR 0014), after
 * local changes were committed. Skipped when a local edit is still pending.
 */
/** Display name of the agent behind the latest pulled change (from `/api/v1/activity`). */
let lastAgentAuthor: string | null = null;

async function applyAgentBundle(bundle: DocumentSnapshot, initial: boolean): Promise<boolean> {
  if (!initial && documentCommitSignature() !== committedDocSignature) return false;
  applyingAgentBundle = true;
  try {
    if (initial) {
      controller.restoreDocumentSnapshot(bundle);
    } else {
      const group = `agent:${crypto.randomUUID()}`;
      const author = nextPullAuthor ?? lastAgentAuthor ?? uiChrome().anAgent;
      undoGroupAuthors.set(group, author);
      await withUndoableDocumentReplace(() => controller.restoreDocumentSnapshot(bundle), group);
      // A change you started from the history panel moves marks; an agent's change marks its slots.
      updateAiAuthorMarks(nextPullAuthor ? "keep" : { by: author, origin: "mcp" });
      nextPullAuthor = null;
      historyPanel?.refresh();
    }
  } finally {
    applyingAgentBundle = false;
  }
  markCommitted();
  if (initial) {
    committedSlots = slotFingerprints(controller.getState().model.slots);
    adoptAiAuthorMarks();
  }
  return true;
}

function slotSignatureFrom(
  slots: Array<{ slotId: string; expression: string }>,
  loops: Array<{ attachSlotId: string; varName: string; path: string }>,
): string {
  return [
    ...slots.map((slot) => `${slot.slotId}=${slot.expression}`),
    ...loops.map((loop) => `loop:${loop.attachSlotId}=${loop.varName}@${loop.path}`),
  ].join("|");
}

function refreshUndoButtons(): void {
  const undoBtn = document.getElementById("btn-undo") as HTMLButtonElement | null;
  const redoBtn = document.getElementById("btn-redo") as HTMLButtonElement | null;
  if (!workspace || !undoBtn || !redoBtn) return;
  undoBtn.disabled = !workspaceCanUndo(workspace);
  redoBtn.disabled = !workspaceCanRedo(workspace);
  const messages = uiChrome();
  const hint = messages.undoHistoryHint;
  undoBtn.title = undoBtn.disabled ? hint : `${hint} ${messages.undoLastEdit}`;
  redoBtn.title = redoBtn.disabled ? hint : `${hint} ${messages.redoLastEdit}`;
}

let currentLeases: SlotLease[] = [];
let leaseChipIndex = 0;

function leaseTexts() {
  const m = uiChrome();
  return {
    label: (l: SlotLease) => (l.subtree ? `${l.displayName} · ${m.leaseSubtree}` : l.displayName),
    title: (l: SlotLease) =>
      formatMessage(m.leaseTitle, {
        agent: l.displayName,
        time: new Date(l.expiresAt).toLocaleTimeString(),
        what: l.subtree ? m.leaseWhatSubtree : m.leaseWhatSlot,
      }),
  };
}

/** Lease markers on the canvas and the per-agent chip in the Mapping Editors header (S-15). */
function showLeases(leases: SlotLease[]): void {
  currentLeases = leases;
  if (workspace) renderLeaseMarkers(workspace, leases, leaseTexts());
  const chip = document.getElementById("lease-chip");
  if (!chip) return;
  chip.hidden = !leases.length;
  if (!leases.length) {
    chip.replaceChildren();
    return;
  }
  const byAgent = new Map<string, { name: string; color: string; n: number }>();
  for (const l of leases) {
    const row = byAgent.get(l.agentId) ?? { name: l.displayName, color: leaseColor(l), n: 0 };
    row.n++;
    byAgent.set(l.agentId, row);
  }
  const parts: Node[] = [document.createTextNode(`🔒 `)];
  for (const row of byAgent.values()) {
    const dot = document.createElement("span");
    dot.className = "lease-dot";
    dot.style.background = row.color;
    parts.push(dot, document.createTextNode(` ${row.name} ${row.n} `));
  }
  chip.replaceChildren(...parts);
  chip.title = `${uiChrome().leasesChipTitle}\n${leases.map((l) => `${l.displayName}: ${l.slotId.split("//").pop()}${l.subtree ? "/…" : ""}`).join("\n")}`;
}

/**
 * Lease warning (S-15, ADR 0014): before your change to something an MCP
 * agent leases reaches the shared project, ask. The change stays on screen
 * but is held. "Edit anyway" commits it and stops asking about that lease
 * until it ends; "Cancel" takes it back; when the lease ends meanwhile the
 * change is committed without asking. Asked when a change is committed (end
 * of a drag or field edit), never per keystroke.
 */
const acknowledgedLeases = new Set<string>();
let leaseHold: {
  hits: LeaseHit[];
  before: DocumentSnapshot;
  summary?: string;
  timer: number;
} | null = null;

function leaseWarningHits(before: DocumentSnapshot): LeaseHit[] {
  const now = Date.now();
  pruneAcknowledged(acknowledgedLeases, currentLeases, now);
  const changed = changedTargetIds(before, controller.exportDocumentSnapshot());
  return leaseHits(changed, currentLeases, acknowledgedLeases, now);
}

function leaseHitSlots(hit: LeaseHit): string {
  const names = hit.slotIds.map((id) => describeSlotForNotes(id) ?? id.split("/").filter(Boolean).slice(-4).join("/"));
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` (+${names.length - 3})` : "");
}

function leaseAgents(hits: LeaseHit[]): string {
  return [...new Set(hits.map((h) => h.lease.displayName))].join(", ");
}

function openLeaseWarning(hits: LeaseHit[], before: DocumentSnapshot, summary?: string): void {
  const dialog = document.getElementById("dialog-lease-warning") as HTMLDialogElement | null;
  const list = document.getElementById("lease-warning-list");
  const intro = document.getElementById("lease-warning-intro");
  if (!dialog || !list || !intro) return;
  const m = uiChrome();
  intro.textContent = formatMessage(m.leaseWarningIntro, { agent: leaseAgents(hits) });
  list.replaceChildren(...hits.map((hit) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "lease-dot";
    dot.style.background = leaseColor(hit.lease);
    const what = document.createElement("span");
    what.textContent = ` ${hit.lease.displayName}${hit.lease.subtree ? ` · ${m.leaseSubtree}` : ""}: ${leaseHitSlots(hit)} `;
    const left = document.createElement("span");
    left.className = "lease-countdown";
    li.append(dot, what, left);
    return li;
  }));
  const tick = () => {
    if (!leaseHold) return;
    const left = remainingByHit(leaseHold.hits, currentLeases, Date.now());
    list.querySelectorAll<HTMLElement>(".lease-countdown").forEach((el, i) => {
      el.textContent = left[i] > 0
        ? formatMessage(uiChrome().leaseWarningEndsIn, { time: formatCountdown(left[i]) })
        : uiChrome().leaseWarningEnded;
    });
    if (left.every((ms) => ms <= 0)) closeLeaseWarning("ended");
  };
  leaseHold = { hits, before, summary, timer: globalThis.setInterval(tick, 250) };
  tick();
  if (leaseHold && !dialog.open) dialog.showModal();
}

function closeLeaseWarning(choice: "edit" | "cancel" | "ended"): void {
  const hold = leaseHold;
  if (!hold) return;
  globalThis.clearInterval(hold.timer);
  leaseHold = null;
  const dialog = document.getElementById("dialog-lease-warning") as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  const m = uiChrome();
  const agent = leaseAgents(hold.hits);
  const slots = hold.hits.map(leaseHitSlots).join("; ");
  if (choice === "cancel") {
    const group = `lease-cancel:${crypto.randomUUID()}`;
    undoGroupAuthors.set(group, USER_ACTOR.displayName);
    void withUndoableDocumentReplace(() => controller.restoreDocumentSnapshot(hold.before), group).then(() => {
      markCommitted();
      controller.setStatusMessage(formatMessage(m.leaseWarningCancelled, { agent, slots }));
    });
    return;
  }
  if (choice === "edit") for (const hit of hold.hits) acknowledgedLeases.add(leaseKey(hit.lease));
  void commitPendingUiChange(hold.summary).then(() => {
    controller.setStatusMessage(
      formatMessage(choice === "edit" ? m.leaseWarningEdited : m.leaseWarningExpired, { agent, slots }),
    );
  });
}

function installLeaseWarning(): void {
  const dialog = document.getElementById("dialog-lease-warning") as HTMLDialogElement | null;
  document.getElementById("lease-warning-edit")?.addEventListener("click", () => closeLeaseWarning("edit"));
  document.getElementById("lease-warning-cancel")?.addEventListener("click", () => closeLeaseWarning("cancel"));
  // Escape is Cancel.
  dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLeaseWarning("cancel");
  });
}

/** Agent writes refused because you changed those slots during their lease: say so once each. */
let humanWinsSeen = -1;
function showHumanWins(notices: HumanWinsNotice[]): void {
  const newest = notices.at(-1)?.seq ?? 0;
  if (humanWinsSeen < 0) {
    humanWinsSeen = newest;
    return;
  }
  const fresh = notices.filter((n) => n.seq > humanWinsSeen);
  humanWinsSeen = Math.max(humanWinsSeen, newest);
  const last = fresh.at(-1);
  if (!last) return;
  const slots = last.slotIds.map((id) => describeSlotForNotes(id) ?? id).join(", ");
  controller.setStatusMessage(formatMessage(uiChrome().leaseHumanWins, { agent: last.agent, slots }));
}

function installLeaseChip(): void {
  const chip = document.getElementById("lease-chip");
  chip?.addEventListener("click", () => {
    if (!workspace || !currentLeases.length) return;
    const lease = currentLeases[leaseChipIndex++ % currentLeases.length]!;
    const block = leaseTargetBlock(workspace.getAllBlocks(false), lease.slotId) as Blockly.BlockSvg | undefined;
    if (!block) return;
    const scale = workspace.getScale();
    const view = workspace.getMetrics();
    if (block.height * scale < view.viewHeight * 0.8 && block.width * scale < view.viewWidth * 0.8) {
      workspace.centerOnBlock(block.id, true);
    } else {
      // A big subtree: show its top-left corner with the name tag.
      const xy = block.getRelativeToSurfaceXY();
      workspace.scroll(-(xy.x * scale - 40), -(xy.y * scale - 40));
    }
  });
  // Pulled bundles rebuild blocks: draw the markers again on the new blocks.
  workspace?.addChangeListener((event) => {
    if (event.type === Blockly.Events.FINISHED_LOADING && currentLeases.length) {
      queueMicrotask(() => renderLeaseMarkers(workspace, currentLeases, leaseTexts()));
    }
  });
}

function pulseAgentActivity(activity: {
  affectedSlotIds: string[];
  displayName: string;
  color: string;
}): void {
  for (const block of workspace.getAllBlocks(false)) {
    const slotId = slotIdFromBlock(block);
    if (slotId && activity.affectedSlotIds.includes(slotId)) {
      block.getSvgRoot()?.style.setProperty("outline", `2px solid ${activity.color}`);
      globalThis.setTimeout(() => block.getSvgRoot()?.style.removeProperty("outline"), 2500);
      if (followActiveAgent) {
        workspace.centerOnBlock(block.id);
      }
    }
  }
  statusMain.textContent = `${activity.displayName}: ${
    localizeStatus(detectLocale(), controller.getState().statusMessage)
  }`;
}

function restoreDocumentFromUndo(snapshot: DocumentSnapshot): void {
  applyingDocumentUndo = true;
  try {
    controller.restoreDocumentSnapshot(snapshot);
  } finally {
    applyingDocumentUndo = false;
    refreshUndoButtons();
  }
}

function withUndoableDocumentReplace<T>(fn: () => T | Promise<T>, group?: string): Promise<T> {
  const run = (): T | Promise<T> => fn();
  if (applyingDocumentUndo || !workspace) {
    try {
      return Promise.resolve(run() as T);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const nested = documentReplaceDepth > 0;
  documentReplaceDepth++;
  const before = nested ? null : controller.exportDocumentSnapshot();
  const finish = () => {
    documentReplaceDepth--;
    if (!nested && before) {
      fireDocumentSwap(
        workspace,
        before,
        controller.exportDocumentSnapshot(),
        restoreDocumentFromUndo,
        group,
      );
      refreshUndoButtons();
    }
  };
  try {
    const result = run();
    if (isThenable(result)) {
      return Promise.resolve(result).then(
        (value) => {
          finish();
          return value as T;
        },
        (err) => {
          finish();
          throw err;
        },
      );
    }
    finish();
    return Promise.resolve(result);
  } catch (err) {
    finish();
    return Promise.reject(err);
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function collectConstraintWarnings(): Record<string, string> {
  const warnings: Record<string, string> = {};
  if (!workspace) return warnings;
  for (const block of workspace.getAllBlocks(false)) {
    const messages = blockConstraintMessages(block);
    if (messages.length) warnings[block.id] = messages.join("\n");
  }
  return warnings;
}

/** Spec row that stands for the selected block (itself or its nearest ancestor with a row). */
let specSelectionAnchorId: string | null = null;

function specChrome(): SpecChrome {
  return {
    warnings: collectConstraintWarnings(),
    selectedBlockId: specSelectionAnchorId ?? selectedBlockId,
    checkedBlockIds: specCheckedBlockIds,
  };
}

/** #218: Search overlay + docked find panel inside the Mapping canvas. */
function installCanvasPaneFind(): void {
  const toolboxWidth = () =>
    blocklyMount.querySelector<HTMLElement>(".blocklyToolboxDiv")?.offsetWidth ?? 0;
  let find: PaneFind | null = null;
  find = createPaneFind({
    host: blocklyMount,
    id: "mapping-canvas",
    titleKey: "searchMappingCanvasTitle",
    locale: detectLocale,
    panelLeft: toolboxWidth,
    adapter: canvasFindAdapter({
      workspace: () => workspace as unknown as CanvasWorkspaceLike,
      selectBlock: (blockId) => {
        const block = workspace.getBlockById(blockId);
        if (!block) return;
        const common = (Blockly as unknown as {
          common?: { setSelected?: (b: unknown) => void };
        }).common;
        common?.setSelected?.(block);
        applyBlockSelection(blockId, "blockly");
      },
      visibleRect: () => {
        const svg = (workspace as Blockly.WorkspaceSvg).getParentSvg?.();
        if (!svg) return null;
        const box = svg.getBoundingClientRect();
        const left = box.left + toolboxWidth();
        const top = box.top + (find?.isOpen() ? find.panel.offsetHeight : 0);
        return new DOMRect(left, top, Math.max(0, box.right - left), Math.max(0, box.bottom - top));
      },
    }),
  });
  paneFinds["mapping-canvas"] = find;
}

function panToBlock(block: BlockSvg): void {
  const ws = workspace as Blockly.WorkspaceSvg;
  if (typeof block.getRelativeToSurfaceXY !== "function" || typeof ws.scroll !== "function") {
    if (typeof ws.centerOnBlock === "function" && block.id) {
      // blockOnly=true → block.height/width (excludes `next` when those fields are correct)
      ws.centerOnBlock(block.id, true);
    }
    return;
  }
  const xy = block.getRelativeToSurfaceXY();
  const metrics = typeof ws.getMetrics === "function" ? ws.getMetrics() : null;
  if (!metrics) return;
  const scale = ws.scale ?? 1;
  // Prefer the rendered path size — block.height / getHeightWidth() can still
  // reflect the full statement stack for some ELEMENT trees.
  const pathBox = blockOwnPathClientRect(block);
  const hw = pathBox && pathBox.height > 0
    ? { width: pathBox.width / scale, height: pathBox.height / scale }
    : blockOwnWorkspaceSize(block);
  ws.scroll(
    -(xy.x + hw.width / 2) * scale + metrics.viewWidth / 2,
    -(xy.y + hw.height / 2) * scale + metrics.viewHeight / 2,
  );
}

function blockAndAncestorIds(block: Blockly.Block): string[] {
  const ids: string[] = [];
  for (let b: Blockly.Block | null = block; b; b = b.getParent()) ids.push(b.id);
  return ids;
}

function applyBlockSelection(blockId: string | null, origin: "blockly" | "spec"): void {
  if (applyingSelection) return;
  applyingSelection = true;
  try {
    selectedBlockId = blockId;
    specSelectionAnchorId = null;
    const block = blockId ? workspace.getBlockById(blockId) : null;
    syncHandlebarsClickHint();
    if (origin === "spec" && block) {
      // #246: go through Blockly's selection state, not BlockSvg.select() —
      // the latter only paints the outline, so the previous selection was
      // never cleared and a later canvas click left two blocks outlined.
      const common = (Blockly as unknown as {
        common?: { setSelected?: (b: unknown) => void };
      }).common;
      if (typeof common?.setSelected === "function") {
        common.setSelected(block);
      } else if (typeof (block as BlockSvg).select === "function") {
        (block as BlockSvg).select();
      }
      panToBlock(block as BlockSvg);
    }
    let specAnchorId: string | null = null;
    if (origin === "blockly" && block) {
      // #246: resolve the block (or its nearest ancestor) to a Spec row and,
      // in tabbed layout, show the tab of the canvas root that owns it.
      const anchor = specAnchorForBlocks(
        Blockly.serialization.workspaces.save(workspace),
        blockAndAncestorIds(block),
      );
      specAnchorId = anchor?.blockId ?? null;
      specSelectionAnchorId = specAnchorId;
      if (anchor?.rootId) specChromeUi?.setActiveRootId(anchor.rootId);
    }
    refreshMappingSpecView();
    if (specAnchorId) scrollMappingSpecToBlock(specEditor, specAnchorId);
    if (block) {
      const target = listeningTargetFromBlock(block);
      if (target?.kind === "slot") controller.armSlot(target.slotId);
      else if (target?.kind === "source_block") {
        controller.armSourceQueryBlock(target.blockId);
      } else if (
        controller.getState().listeningSlotId ||
        controller.getState().listeningSourceBlockId
      ) {
        controller.clearListening();
      }
    } else if (
      controller.getState().listeningSlotId ||
      controller.getState().listeningSourceBlockId
    ) {
      controller.clearListening();
    }
  } finally {
    applyingSelection = false;
  }
}

function fillListeningSourceQuery(blockId: string, path: string, format: string): void {
  const block = workspace.getBlockById(blockId);
  if (!block) {
    controller.clearListening();
    return;
  }
  const xpath = getSourceFormatHandler(format).pathToExpression(path);
  block.setFieldValue(xpath, "EXPRESSION");
  persistBlocklyCanvas();
  controller.clearListening();
  controller.setStatusMessage(`Mapped source query ${xpath}`);
}

function applyPendingDefaultsMap(): boolean {
  const pending = controller.consumePendingDefaultsMap();
  if (!pending) return false;
  runWithoutBlocklyEvents(() => {
    hydrateDefaultsMapArgument(workspace, pending, blocklyLocale, targetFormatOf(controller.getState()));
  });
  persistBlocklyCanvas();
  return true;
}

function applyDefaultContextMapFromCanvas(): void {
  const s = controller.getState();
  if (!s.skeleton.length) {
    controller.setStatusMessage("Load a target into Target schema first, then Apply default context map.");
    return;
  }
  const hasProduct = workspace.getTopBlocks(false).some((block) =>
    block.type !== "default_context_map" &&
    block.type !== "conversion_start" &&
    block.type !== "maps_create_with"
  );
  if (!hasProduct) {
    loadSkeletonIntoWorkspace(
      workspace,
      s.skeleton,
      s.model,
      null,
      blocklyLocale,
      targetFormatOf(s),
      { factory: false },
    );
  } else {
    applyDefaultContextMap(workspace, s.skeleton, (parent, insertion) =>
      attachOptionalRmChild(workspace, parent, insertion)
    );
  }
  persistBlocklyCanvas({ summary: "Apply default context map" });
  controller.setStatusMessage("Applied default context map");
  render();
}

/** Target refresh is a scaffold act: join new Default points, keep source-over-defaults. */
function applyDefaultContextMapAfterRefresh(): void {
  const s = controller.getState();
  if (!s.skeleton.length) return;
  const hasProduct = workspace.getTopBlocks(false).some((block) =>
    block.type !== "default_context_map" &&
    block.type !== "conversion_start" &&
    block.type !== "maps_create_with"
  );
  if (!hasProduct) return;
  applyDefaultContextMap(workspace, s.skeleton, (parent, insertion) =>
    attachOptionalRmChild(workspace, parent, insertion)
  );
  persistBlocklyCanvas({ summary: "Refresh target — apply default context map" });
}

function syncToolbox(s: ReturnType<WorkbenchController["getState"]>): void {
  const sig = s.skeleton.length ? skeletonToolboxSignature(s.skeleton) : "";
  const key = `${s.target?.format ?? ""}|${s.templateId}|${sig}|${s.modelLanguage ?? ""}`;
  if (key === toolboxKey) return;
  toolboxKey = key;
  if (s.skeleton.length) registerSchemaBlocksFromSkeleton(s.skeleton);
  workspace.updateToolbox(buildDemoToolbox(blocklyLocale, {
    targetFormat: s.target?.format,
    skeleton: s.skeleton,
  }));
}

function targetFormatOf(s: ReturnType<WorkbenchController["getState"]>) {
  return s.target?.format ?? s.model.targetFormat;
}

function syncBlocklyWorkspace(s: ReturnType<WorkbenchController["getState"]>): void {
  if (!workspace) return;
  syncToolbox(s);
  if (!s.templateId && !s.blocklyState) {
    blocklySkeletonKey = "";
    blocklyLabelLanguage = "";
    blocklySlotSignature = "";
    runWithoutBlocklyEvents(() => {
      ensureDefaultsBlock(workspace, blocklyLocale, targetFormatOf(s), { factory: false });
      ensureConversionStartOnScaffold(workspace);
    });
    applyPendingDefaultsMap();
    return;
  }
  if (!s.templateId || !s.skeleton.length) {
    if (!(s.blocklyState && typeof s.blocklyState === "object" && s.blocklyReloadToken)) {
      blocklySkeletonKey = "";
      blocklyLabelLanguage = "";
      blocklySlotSignature = "";
      runWithoutBlocklyEvents(() => {
        ensureDefaultsBlock(workspace, blocklyLocale, targetFormatOf(s), { factory: false });
        ensureConversionStartOnScaffold(workspace);
      });
      applyPendingDefaultsMap();
      return;
    }
  }

  const skeletonKey = `${s.projectId}|${s.templateId}|${s.skeleton.length}|${s.blocklyReloadToken}`;
  const slotSignature = slotSignatureFrom(s.model.slots, s.model.loops ?? []);
  const labelLanguage = s.modelLanguage ?? "";

  if (skeletonKey !== blocklySkeletonKey) {
    if (s.blocklyState && typeof s.blocklyState === "object") {
      const savedState = s.blocklyState;
      runWithoutBlocklyEvents(() => {
        if (s.skeleton.length) registerSchemaBlocksFromSkeleton(s.skeleton);
        workspace.clear();
        Blockly.serialization.workspaces.load(
          migrateForEachSourceState(savedState) as Record<string, unknown>,
          workspace,
        );
        if (!findDefaultsBlock(workspace)) {
          ensureDefaultsBlock(workspace, blocklyLocale, targetFormatOf(s), { factory: false });
        }
        ensureConversionStartOnScaffold(workspace);
        applyModelLoops(workspace, s.model);
        refreshWorkspaceConstraints(workspace);
        relabelWorkspaceFromSkeleton(workspace, s.skeleton);
      });
      lockWorkspaceRootsExpanded(workspace);
      refreshAiReviewMarkers(workspace);
      blocklySkeletonKey = skeletonKey;
      blocklyLabelLanguage = labelLanguage;
      blocklySlotSignature = slotSignature;
      const derived = workspaceToModelJson(workspace);
      if (s.blocklyReloadToken > 0) {
        controller.syncFromBlockly(
          Blockly.serialization.workspaces.save(workspace),
          derived.slots,
          derived.loops,
          derived.optionalRm,
          {
            targetSignature: derived.targetSignature,
            unsupported: derived.unsupported,
            sheetNames: derived.sheetNames,
      instanceEncodings: derived.instanceEncodings,
      functions: derived.functions,
          },
        );
      }
      applyPendingDefaultsMap();
      return;
    } else {
      const hadPending = applyPendingDefaultsMap();
      loadSkeletonIntoWorkspace(
        workspace,
        s.skeleton,
        s.model,
        s.listeningSlotId,
        blocklyLocale,
        targetFormatOf(s),
        { factory: !hadPending },
      );
      const derived = workspaceToModelJson(workspace);
      if (s.blocklyReloadToken > 0) {
        controller.syncFromBlockly(
          Blockly.serialization.workspaces.save(workspace),
          derived.slots,
          derived.loops,
          derived.optionalRm,
          {
            targetSignature: derived.targetSignature,
            unsupported: derived.unsupported,
            sheetNames: derived.sheetNames,
      instanceEncodings: derived.instanceEncodings,
      functions: derived.functions,
          },
        );
      }
    }
    blocklySkeletonKey = skeletonKey;
    blocklyLabelLanguage = labelLanguage;
    blocklySlotSignature = slotSignature;
    applyPendingDefaultsMap();
    return;
  }

  if (labelLanguage !== blocklyLabelLanguage) {
    runWithoutBlocklyEvents(() => {
      relabelWorkspaceFromSkeleton(workspace, s.skeleton);
    });
    blocklyLabelLanguage = labelLanguage;
    toolboxKey = "";
    syncToolbox(s);
  }

  if (slotSignature !== blocklySlotSignature) {
    const derived = workspaceToModelJson(workspace);
    const canvasSig = slotSignatureFrom(derived.slots, derived.loops);
    if (canvasSig !== slotSignature) {
      replaceCanvasUndoable(workspace, () => {
        applyModelExpressions(workspace, s.model);
      }, aiWriteInProgress()?.origin.turnId);
      refreshAiReviewMarkers(workspace);
    }
    blocklySlotSignature = slotSignature;
    controller.syncCanvasSnapshot(Blockly.serialization.workspaces.save(workspace));
    refreshUndoButtons();
  }

  highlightListeningSlot(workspace, s.listeningSlotId, s.listeningSourceBlockId);
  applyPendingDefaultsMap();
}

function bind(id: string, handler: () => void | Promise<void>): void {
  document.getElementById(id)?.addEventListener("click", () => void handler());
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

installInfoTips();
installUrlLoadUi({
  dialog: requireEl<HTMLDialogElement>("dialog-load-url"),
  title: requireEl("load-url-title"),
  hint: requireEl("load-url-hint"),
  input: requireEl<HTMLInputElement>("load-url-input"),
  error: requireEl("load-url-error"),
  history: requireEl("load-url-history"),
  historyHeading: requireEl("load-url-history-heading"),
  cancel: requireEl<HTMLButtonElement>("load-url-cancel"),
  storage: localStorage,
  kinds: {
    schema: {
      main: requireEl<HTMLButtonElement>("btn-load-schema"),
      chevron: requireEl<HTMLButtonElement>("btn-load-schema-menu"),
      menu: requireEl("menu-load-schema"),
      fromFile: () => controller.loadSchema(),
      fromUrl: (url) => controller.loadSchemaFromUrl(url),
      refresh: {
        fromFile: () => void refreshSchemaFromFile(),
        fromUrl: (url) => refreshSchemaFromUrl(url),
      },
      title: uiChrome().loadSchemaFromUrl,
      hint: uiChrome().loadSchemaUrlHint,
      placeholder: "https://raw.githubusercontent.com/…/schema.json",
      historyHeading: uiChrome().recentSchemaUrls,
      github: {
        label: uiChrome().fromGithubTemplate,
        title: uiChrome().githubTemplateTitle,
        hint: uiChrome().githubTemplateHint,
        placeholder: DEFAULT_GITHUB_TEMPLATE_URL,
      },
    },
    example: {
      main: requireEl<HTMLButtonElement>("btn-add-example"),
      chevron: requireEl<HTMLButtonElement>("btn-add-example-menu"),
      menu: requireEl("menu-add-example"),
      fromFile: () => controller.addExample(),
      fromUrl: (url) => controller.addExampleFromUrl(url),
      fromGitHubDirectory: (url) => controller.addExamplesFromGitHubDirectory(url),
      title: uiChrome().addExampleFromUrl,
      hint: uiChrome().addExampleUrlHint,
      placeholder: "https://raw.githubusercontent.com/…/example.json",
      historyHeading: uiChrome().recentExampleUrls,
      bulkLocal: {
        label: uiChrome().fromLocalFolder,
        fromDirectory: () => controller.addExamplesFromLocalDirectory(),
      },
      bulkGitHubDir: {
        label: uiChrome().fromGithubFolder,
        title: uiChrome().githubFolderTitle,
        hint: uiChrome().githubFolderHint,
        placeholder: DEFAULT_GITHUB_EXAMPLES_URL,
      },
    },
    target: {
      main: requireEl<HTMLButtonElement>("btn-open-template"),
      chevron: requireEl<HTMLButtonElement>("btn-open-template-menu"),
      menu: requireEl("menu-open-template"),
      fromFile: () => openJointLoadDialog(),
      fromUrl: (url) => withUndoableDocumentReplace(() => controller.openTemplateFromUrl(url)),
      title: uiChrome().loadTargetFromUrl,
      hint: uiChrome().loadTargetUrlHint,
      placeholder: "https://github.com/Ehrlibs/openEHR-model-examples/blob/main/local/…",
      historyHeading: uiChrome().recentTargetUrls,
      refresh: {
        fromFile: () => void refreshTargetFromFile(),
        fromUrl: (url) => refreshTargetFromUrl(url),
      },
      github: {
        label: uiChrome().fromGithubTemplate,
        title: uiChrome().githubTemplateOpenTitle,
        hint: uiChrome().githubTemplateHint,
        placeholder: DEFAULT_GITHUB_TEMPLATE_URL,
      },
    },
  },
});

bind("btn-undo", () => {
  workspace.undo(false);
  refreshUndoButtons();
});
bind("btn-redo", () => {
  workspace.undo(true);
  refreshUndoButtons();
});
bind("btn-open-canvas", () => openCanvasSnapshot());

function openCanvasSnapshot(): void {
  const state = controller.getState();
  const filenameBase = (state.templateId || "mapping-canvas").replace(/[^A-Za-z0-9._-]+/g, "-");
  const title = state.templateId
    ? `intEHRgrator — ${state.templateId}`
    : "intEHRgrator — Mapping canvas";
  const popup = openAgentObserver(workspace, { title, filenameBase })
    ?? openWorkspaceSnapshotWindow(workspace, {
      title,
      filenameBase,
      onBlocked: (svgXml, base) => {
        if (svgXml) void host.downloadText(`${base}.svg`, svgXml, "image/svg+xml");
        statusMain.textContent = localizeStatus(
          detectLocale(),
          svgXml
            ? "Popup blocked — downloaded SVG instead."
            : "Popup blocked and the canvas is empty.",
        );
      },
    });
  if (popup) {
    statusMain.textContent = localizeStatus(detectLocale(), "Opened agent observer / canvas snapshot.");
  }
}
bind("btn-run-test", () => {
  // Run every test file so all tabs get a fresh warning / ok mark (#246).
  controller.runAllTests();
  const result = controller.getState().testResult;
  if (result?.ok && result.output !== undefined) {
    betterFormBridge?.pushComposition(result.output);
  }
});
/** Machine preference: users on slow computers pause auto-run once and it stays paused. */
const AUTO_RUN_PAUSED_KEY = "intehrgrator.autoRunPaused";
try {
  if (globalThis.localStorage?.getItem(AUTO_RUN_PAUSED_KEY) === "1" && controller.getState().settings.autoplay) {
    controller.toggleAutoplay();
  }
} catch {
  // Storage unavailable (private mode / sandbox): keep the default (on).
}
bind("btn-autoplay", () => {
  controller.toggleAutoplay();
  try {
    globalThis.localStorage?.setItem(
      AUTO_RUN_PAUSED_KEY,
      controller.getState().settings.autoplay ? "0" : "1",
    );
  } catch {
    // ignore
  }
});
bind("btn-better-form", () => {
  const opened = betterFormBridge?.openViewer() ?? null;
  if (!opened) {
    statusMain.textContent = localizeStatus(detectLocale(), chrome("en").betterPopupBlocked);
    return;
  }
  const result = controller.getState().testResult;
  if (result?.output !== undefined) betterFormBridge?.pushComposition(result.output);
});
bind("btn-new-project", () => void handleNewProject());
bind("btn-load-project", () => void openLoadProjectDialog());
bind("btn-save-project", () => openSaveAsDialog());
bind("btn-export-project", () => controller.exportProject());
bind("btn-import-project", () => void withUndoableDocumentReplace(() => controller.importProject()));
const importAiDialog = installImportAiDialog({
  dialog: requireEl<HTMLDialogElement>("dialog-import-ai"),
  textarea: requireEl<HTMLTextAreaElement>("import-ai-text"),
  report: requireEl("import-ai-report"),
  cancel: requireEl<HTMLButtonElement>("import-ai-cancel"),
  clipboard: requireEl<HTMLButtonElement>("import-ai-clipboard"),
  copyErrors: requireEl<HTMLButtonElement>("import-ai-copy-errors"),
  openButton: requireEl<HTMLButtonElement>("btn-import-ai"),
  formatDocUrl: pinnedDocUrl("docs/AI_SUGGESTION_FORMAT.md"),
  readClipboard: () => controller.readClipboardText(),
  copyToClipboard: (text) => host.copyToClipboard(text),
  // A pasted AI answer is an AI change too (ADR 0014), with its own undo step.
  importText: (text) => {
    let report!: ReturnType<typeof controller.importAiSuggestions>;
    void withAiCommit({ provider: "copy-paste" }, () => {
      report = asAiWriteSync(() =>
        chatService().importSuggestions(text, undefined, { actor: aiChatActor({ provider: "copy-paste" }) })
      );
    });
    return report;
  },
  notes: requireEl("import-ai-notes"),
  describeSlot: (slotId) => describeSlotForNotes(slotId),
  onAnswer: (question, index, option) => aiChat?.answerQuestion(question, index, option),
});
let aiChat: AiChatPanelHandle | null = null;

/** "Device details › Name" for a slot id in AI Notes (falls back to the id tail). */
function describeSlotForNotes(slotId: string): string | undefined {
  const state = controller.getState();
  const norm = (id: string) => id.replace(/\/{2,}/g, "/");
  const row = listSlotsInspect(state.skeleton, state.model).find((r) => r.slotId === slotId || norm(r.slotId) === norm(slotId));
  const label = row?.pathLabel ? row.pathLabel.split(" › ").slice(-2).join(" › ") : row?.label;
  return label || undefined;
}

aiChat = installAiChatPanel({
  panel: requireEl("ai-chat-panel"),
  stack: requireEl("output-stack"),
  tabs: requireEl("output-tabs"),
  storage: localStorage,
  projectId: () => controller.getState().projectId,
  hasCredentials: () => hasAiCredentials(localStorage),
  openCredentials: () => openAiCredentialsDialog(),
  buildProjectContext: (delivery) => controller.buildAiPromptText(delivery ?? lastAiDelivery()),
  getDelivery: () => lastAiDelivery(),
  setDelivery: (delivery) => localStorage.setItem("intehrgrator.aiDelivery", delivery),
  getAttachOriginalTarget: () => controller.getAiAttachOriginalTarget(),
  setAttachOriginalTarget: (on) => controller.setAiAttachOriginalTarget(on),
  copyToClipboard: (text) => host.copyToClipboard(text),
  pickTextFile: () => host.pickTextFile(".md,.txt,.json,text/markdown,text/plain,application/json"),
  fetchText: async (url) => (await host.fetchTextUrl(url)).text,
  downloadText: (filename, text) => void host.downloadText(filename, text, "application/json"),
  openImportDialog: (text) => void importAiDialog.open(text),
  runTurn: (request) => runAiChatTurn(request),
  model: () => loadAiCredentials(localStorage)?.model ?? "",
  setStatus: (message) => controller.setStatusMessage(message),
  formatError: (err) => formatCallAiError(err),
  describeSlot: (slotId) => describeSlotForNotes(slotId),
  onLayout: () => {
    if (workspace) Blockly.svgResize(workspace);
  },
});
installAddToAiChatMenus();
installCopyAiMenu();
installLocalMcpDialog();
installExampleSetsMenu();
installFunctionLibraryUi();
installFileMenu();
installHelpMenu();

const HELP_TUTORIAL_URL =
  "https://github.com/regionstockholm/intehrgrator/blob/main/docs/TUTORIAL.md";
const HELP_ISSUES_URL =
  "https://github.com/regionstockholm/intehrgrator/issues/new/choose";
const HELP_README_URL =
  "https://github.com/regionstockholm/intehrgrator/blob/main/README.md";

function installRecommendedVersionPopup(): void {
  const dialog = document.getElementById("dialog-recommended-version") as HTMLDialogElement | null;
  const message = document.getElementById("recommended-version-message");
  const recommendedLink = document.getElementById("recommended-version-link") as HTMLAnchorElement | null;
  const bleedingEdgeLink = document.getElementById(
    "recommended-version-bleeding-edge-link",
  ) as HTMLAnchorElement | null;
  const tutorialLink = document.getElementById("recommended-version-tutorial-link") as HTMLAnchorElement | null;
  const readmeLink = document.getElementById("recommended-version-readme-link") as HTMLAnchorElement | null;
  const dismissButton = document.getElementById("recommended-version-dismiss") as HTMLButtonElement | null;
  const dontShowAgainCheckbox = document.getElementById(
    "recommended-version-dont-show-again",
  ) as HTMLInputElement | null;
  if (
    !dialog || !message || !recommendedLink || !bleedingEdgeLink || !tutorialLink || !readmeLink ||
    !dismissButton
  ) {
    return;
  }
  void maybeShowRecommendedVersionPopup(
    { dialog, message, recommendedLink, bleedingEdgeLink, tutorialLink, readmeLink, dismissButton, dontShowAgainCheckbox },
    { tutorialUrl: HELP_TUTORIAL_URL, readmeUrl: HELP_README_URL },
  );
}

function installFileMenu(): void {
  const trigger = document.getElementById("btn-menu-file");
  const menu = document.getElementById("menu-file");
  if (!(trigger instanceof HTMLButtonElement) || !menu) return;
  const handle = installAnchoredMenu({
    menu,
    trigger,
    roots: [trigger],
    referenceEls: [trigger],
  });
  menu.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => handle.close());
  });
}

function installHelpMenu(): void {
  const main = document.getElementById("btn-help");
  const menu = document.getElementById("menu-help");
  if (!(main instanceof HTMLButtonElement) || !menu) {
    return;
  }

  const handle = installAnchoredMenu({
    menu,
    trigger: main,
    roots: [main],
    referenceEls: [main],
    minWidth: main,
  });

  menu.querySelectorAll<HTMLAnchorElement>("a.split-btn-menu-link").forEach((link) => {
    link.addEventListener("click", () => handle.close());
  });
}

function lastAiDelivery(): "inline" | "attach" | "uri" {
  const raw = localStorage.getItem("intehrgrator.aiDelivery");
  if (raw === "attach" || raw === "uri" || raw === "inline") return raw;
  return "inline";
}

function installCopyAiMenu(): void {
  const main = document.getElementById("btn-copy-ai");
  const menu = document.getElementById("menu-copy-ai");
  if (!(main instanceof HTMLButtonElement) || !menu) return;

  const handle = installAnchoredMenu({
    menu,
    trigger: main,
    roots: [main],
    referenceEls: [main],
    minWidth: main,
  });

  const desktopSection = document.getElementById("ai-menu-desktop");
  if (desktopSection && isDesktopEnvironment()) desktopSection.hidden = false;

  menu.querySelectorAll<HTMLButtonElement>("[data-ai-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.aiAction;
      handle.close();
      if (action === "credentials") {
        openAiCredentialsDialog();
      } else if (action === "local-mcp") {
        openLocalMcpDialog();
      } else if (action === "languages") {
        openAiLanguagesDialog();
      }
    });
  });

  // #277: raw target file in copy & paste prompts only on request (saved per project).
  const attachTarget = document.getElementById("menu-ai-attach-target");
  if (attachTarget instanceof HTMLInputElement) {
    attachTarget.addEventListener("change", () => controller.setAiAttachOriginalTarget(attachTarget.checked));
    document.getElementById("btn-copy-ai")?.addEventListener("click", () => {
      attachTarget.checked = controller.getAiAttachOriginalTarget();
    });
  }

  menu.querySelectorAll<HTMLButtonElement>("[data-ai-delivery]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delivery = btn.dataset.aiDelivery;
      if (delivery !== "inline" && delivery !== "attach" && delivery !== "uri") return;
      localStorage.setItem("intehrgrator.aiDelivery", delivery);
      handle.close();
      void controller.copyAiPrompt(delivery);
    });
  });

  updateCopyAiButtonLabel();
}

function installFunctionLibraryUi(): void {
  const dialog = document.getElementById("dialog-functions");
  const clashDialog = document.getElementById("dialog-function-clash");
  const contributeDialog = document.getElementById("dialog-function-contribute");
  const button = document.getElementById("btn-functions");
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(clashDialog instanceof HTMLDialogElement) ||
    !(contributeDialog instanceof HTMLDialogElement) ||
    !(button instanceof HTMLButtonElement)
  ) {
    return;
  }
  functionLibraryUi = mountFunctionLibraryDialog({
    dialog,
    clashDialog,
    contributeDialog,
    getWorkspace: () => workspace,
    controller,
    persistCanvas: () => persistBlocklyCanvas(),
  });
  button.addEventListener("click", () => functionLibraryUi?.open());
}

function installExampleSetsMenu(): void {
  const main = document.getElementById("btn-example-sets");
  const menu = document.getElementById("menu-example-sets");
  if (!(main instanceof HTMLButtonElement) || !menu) {
    return;
  }

  let catalog: ExampleSetCatalog | null = null;
  let catalogUrl: string | null = null;
  let loading = false;
  let handle: ReturnType<typeof installAnchoredMenu> | null = null;

  const appendItem = (
    label: string,
    onClick: () => void,
    className = "split-btn-menu-item",
    disabled = false,
  ) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.role = "menuitem";
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) {
      btn.addEventListener("click", () => {
        handle?.close();
        onClick();
      });
    }
    menu.append(btn);
    return btn;
  };

  const confirmReplace = (): boolean => {
    if (!controller.hasWorkspaceContent()) return true;
    return confirm(uiChrome().confirmLoadExampleSet);
  };

  const loadSet = (set: ExampleSet) => {
    if (!confirmReplace()) return;
    void (async () => {
      try {
        await withUndoableDocumentReplace(() => controller.loadExampleSet(set));
      } catch {
        // Status bar already has the error.
      }
    })();
  };

  const renderMenu = () => {
    menu.replaceChildren();
    if (loading) {
      appendItem(uiChrome().loadingCatalog, () => {}, "split-btn-menu-item", true);
      return;
    }
    if (catalog?.sets.length) {
      const heading = document.createElement("div");
      heading.className = "split-btn-menu-heading";
      heading.textContent = uiChrome().exampleSetsHeading;
      menu.append(heading);
      for (const set of catalog.sets) {
        const item = appendItem(set.title, () => loadSet(set));
        item.dataset.exampleSetId = set.id;
        if (set.description) item.title = set.description;
      }
    } else {
      appendItem(uiChrome().noExampleSets, () => {}, "split-btn-menu-item", true);
    }
    const catalogHeading = document.createElement("div");
    catalogHeading.className = "split-btn-menu-heading";
    catalogHeading.textContent = uiChrome().catalog;
    menu.append(catalogHeading);
    appendItem(uiChrome().bundledCatalog, () => {
      void fetchCatalog();
    });
    appendItem(uiChrome().ehrtslibCatalog, () => {
      void fetchCatalog(EHRTSLIB_EXAMPLE_SETS_CATALOG_URL);
    });
    appendItem(uiChrome().loadCatalogFromUrl, () => {
      const next = prompt(
        uiChrome().catalogUrlPrompt,
        catalogUrl ?? EHRTSLIB_EXAMPLE_SETS_CATALOG_URL,
      );
      if (!next?.trim()) return;
      void fetchCatalog(next.trim());
    });
    handle?.refresh();
  };

  const fetchCatalog = async (url?: string) => {
    loading = true;
    renderMenu();
    try {
      catalog = await controller.loadExampleSetCatalog(url);
      catalogUrl = catalog.catalogUrl;
    } catch {
      // Keep the previous catalog, if any; status bar already has the error.
    } finally {
      loading = false;
      if (handle?.isOpen()) renderMenu();
    }
  };

  handle = installAnchoredMenu({
    menu,
    trigger: main,
    roots: [main],
    referenceEls: [main],
    minWidth: main,
    onBeforeOpen: () => {
      renderMenu();
      if (!catalog && !loading) void fetchCatalog();
    },
  });

}

let betterFormBridge: BetterFormBridge | null = null;
{
  // The viewer shell is part of the app. Licensed renderer bytes are not:
  // the viewer asks the user to upload them into this browser.
  betterFormBridge = createBetterFormBridge(
    { resolveAppUrl: (path) => host.resolveAppUrl(path) },
    true,
  );
}

initFileDropTargets();

interface SlTabGroupElement extends HTMLElement {
  show: (name: string) => void;
}

function outputTabGroup(): SlTabGroupElement | null {
  return document.getElementById("output-tabs") as SlTabGroupElement | null;
}

function showOutputTab(tab: OutputTabId): void {
  const group = outputTabGroup();
  group?.show(tab);
  writeStoredOutputTab(tab);
}

function initOutputTabs(): void {
  const group = outputTabGroup();
  if (!group) return;
  const initial = readStoredOutputTab();
  const apply = () => {
    try {
      group.show(initial);
    } catch {
      // Custom element not upgraded yet.
    }
  };
  if (customElements.get("sl-tab-group")) apply();
  else void customElements.whenDefined("sl-tab-group").then(apply);
  group.addEventListener("sl-tab-show", (event) => {
    const name = (event as CustomEvent<{ name?: string }>).detail?.name;
    if (isOutputTabId(name)) writeStoredOutputTab(name);
    if (name === "script") exportEditor.requestMeasure();
    if (name === "test") testOutputEditor.requestMeasure();
  });
}

function resizeAfterSlide(): void {
  requestAnimationFrame(() => {
    if (typeof Blockly.svgResize === "function" && workspace) {
      Blockly.svgResize(workspace);
    }
  });
}

function setSourceSlidAway(slid: boolean): void {
  sourcePaneEl.classList.toggle("pane--slid-away", slid);
  mainPanesEl.classList.toggle("source-slid-away", slid);
  const rail = document.getElementById("rail-source");
  if (rail) (rail as HTMLElement).hidden = !slid;
  writeStoredFlag(SOURCE_SLIDE_STORAGE, slid);
  resizeAfterSlide();
}

function setOutputSlidAway(slid: boolean): void {
  outputPaneEl.classList.toggle("pane--slid-away", slid);
  mainPanesEl.classList.toggle("output-slid-away", slid);
  const rail = document.getElementById("rail-output");
  if (rail) rail.hidden = !slid;
  writeStoredFlag(OUTPUT_SLIDE_STORAGE, slid);
  resizeAfterSlide();
}

function initSlideAway(): void {
  document.getElementById("btn-slide-source")?.addEventListener("click", () => {
    setSourceSlidAway(true);
  });
  document.getElementById("rail-source")?.addEventListener("click", () => {
    setSourceSlidAway(false);
  });
  document.getElementById("btn-slide-output")?.addEventListener("click", () => {
    setOutputSlidAway(true);
  });
  document.getElementById("rail-output")?.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest("[data-output-tab]");
    const tab = btn?.getAttribute("data-output-tab");
    setOutputSlidAway(false);
    if (isOutputTabId(tab)) showOutputTab(tab);
  });
  setSourceSlidAway(readStoredFlag(SOURCE_SLIDE_STORAGE));
  setOutputSlidAway(readStoredFlag(OUTPUT_SLIDE_STORAGE));
}

/** Drop Source paths or Target schema nodes onto Blockly. */
function initBlocklyCanvasDrop(): void {
  let lastSourceAt = 0;
  let lastAppliedPath = "";
  let lastTargetAt = 0;
  let lastTargetSlot = "";
  let lastOverX = 0;
  let lastOverY = 0;
  const applyPayloadAtPoint = (
    payload: { path: string; format: string; schemaType?: string },
    clientX: number,
    clientY: number,
  ): boolean => {
    // Prefer the mount's box over elementFromPoint: Blockly SVG / widget
    // layers can sit outside the hit target, and synthetic Playwright drops
    // have no real pointer.
    const mountRect = blocklyMount.getBoundingClientRect();
    const inMount = clientX >= mountRect.left && clientX <= mountRect.right &&
      clientY >= mountRect.top && clientY <= mountRect.bottom;
    if (!inMount) return false;
    const now = Date.now();
    if (payload.path === lastAppliedPath && now - lastSourceAt < 250) return true;
    lastAppliedPath = payload.path;
    lastSourceAt = now;
    try {
      const slotId = findSlotIdAtPoint(clientX, clientY);
      if (slotId) {
        controller.mapNodeToSlot(slotId, payload.path, payload.format);
        return true;
      }
      placeSourceBlockFromDrop(payload, clientX, clientY);
      return true;
    } catch (err) {
      statusMain.textContent = err instanceof Error ? err.message : String(err);
      return false;
    }
  };

  const applyTargetAtPoint = (
    payload: { slotId: string },
    clientX: number,
    clientY: number,
  ): boolean => {
    const mountRect = blocklyMount.getBoundingClientRect();
    const inMount = clientX >= mountRect.left && clientX <= mountRect.right &&
      clientY >= mountRect.top && clientY <= mountRect.bottom;
    if (!inMount) return false;
    const now = Date.now();
    if (payload.slotId === lastTargetSlot && now - lastTargetAt < 250) return true;
    lastTargetSlot = payload.slotId;
    lastTargetAt = now;
    const skeleton = controller.getState().skeleton;
    const node = findSkeletonNodeIn(skeleton, payload.slotId) ??
      findSkeletonNode(payload.slotId);
    if (!node) {
      controller.setStatusMessage("That Target schema node is not in the loaded target.");
      return true;
    }
    const parent = findParentSkeletonNode(skeleton, payload.slotId);
    const leaf = !node.children.length || node.kind === "value";
    const chipPath = node.rmAttribute
      ? classAttributeScaffoldTarget(parent?.rmType || node.rmType, node.rmAttribute)
      : "";
    const chipField = scaffoldTargetFieldAtClientPoint(workspace, clientX, clientY);
    if (leaf && chipField && chipPath) {
      chipField.addTarget(chipPath);
      persistBlocklyCanvas({ summary: "Add scaffold target chip" });
      controller.setStatusMessage(`Scaffold target ${chipPath} (click the chip to toggle *.)`);
      return true;
    }
    const valueHit = contextMapValueInputAtClientPoint(workspace, clientX, clientY);
    if (valueHit) {
      const placed = placeSkeletonSubtreeOnWorkspace(workspace, node, {
        x: 40,
        y: 40,
        skeleton,
        targetFormat: controller.getState().target?.format,
      });
      const input = valueHit.block.getInput(`VAL${valueHit.index}`);
      if (placed?.outputConnection && input?.connection) {
        const existing = input.connection.targetBlock();
        if (existing && !existing.isShadow()) existing.dispose(false);
        input.connection.connect(placed.outputConnection);
      }
      persistBlocklyCanvas({ summary: "Drop Target schema onto default context map value" });
      controller.setStatusMessage(`Nested ${node.label || node.rmType} on the default context map`);
      return true;
    }
    const mapHit = defaultContextMapAtClientPoint(workspace, clientX, clientY);
    if (mapHit && leaf && chipPath) {
      const runtimeKey = chipPath.split(".").filter(Boolean).at(-1) ?? node.rmAttribute ?? "";
      const index = appendContextMapEntry(mapHit, runtimeKey, [chipPath]);
      persistBlocklyCanvas({ summary: "Add default context map entry from Target schema" });
      controller.setStatusMessage(`Added entry ${runtimeKey} (${chipPath}) at row ${index + 1}`);
      return true;
    }
    if (findSlotIdAtPoint(clientX, clientY)) {
      controller.setStatusMessage(
        "Drop a leaf onto scaffold-target chips, a subtree onto a value socket, or onto empty canvas.",
      );
      return true;
    }
    const { x, y } = workspacePositionFromClient(workspace, clientX, clientY);
    const placed = placeSkeletonSubtreeOnWorkspace(workspace, node, {
      x,
      y,
      skeleton,
      targetFormat: controller.getState().target?.format,
    });
    if (!placed) return false;
    persistBlocklyCanvas({ summary: "Pull Target schema subtree onto canvas" });
    controller.setStatusMessage(`Added ${node.label || node.rmType} from Target schema`);
    return true;
  };

  const rememberOver = (event: DragEvent) => {
    lastOverX = event.clientX;
    lastOverY = event.clientY;
  };
  const onDragOver = (event: DragEvent) => {
    if (
      !parseSourceDragPayload(event.dataTransfer) && !getActiveSourceDrag() &&
      !parseTargetDragPayload(event.dataTransfer) && !getActiveTargetDrag()
    ) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    rememberOver(event);
  };
  const onDrop = (event: DragEvent) => {
    const target = parseTargetDragPayload(event.dataTransfer);
    if (target) {
      event.preventDefault();
      applyTargetAtPoint(target, event.clientX, event.clientY);
      return;
    }
    const payload = parseSourceDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    applyPayloadAtPoint(payload, event.clientX, event.clientY);
  };
  // Blockly's SVG does not reliably receive HTML5 drop. dragend still has
  // client coordinates, so finish the gesture from the pointer position.
  document.addEventListener("dragover", (event) => {
    if (!getActiveSourceDrag() && !getActiveTargetDrag()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    rememberOver(event);
  }, true);
  document.addEventListener("dragend", (event) => {
    const target = getActiveTargetDrag();
    const payload = getActiveSourceDrag();
    if (!target && !payload) return;
    const mountRect = blocklyMount.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (!isUsableSourceDropPoint(x, y, mountRect)) {
      x = lastOverX;
      y = lastOverY;
    }
    if (target) applyTargetAtPoint(target, x, y);
    else if (payload) applyPayloadAtPoint(payload, x, y);
  }, true);

  const opts = { capture: true };
  blocklyMount.addEventListener("dragenter", onDragOver, opts);
  blocklyMount.addEventListener("dragover", onDragOver, opts);
  blocklyMount.addEventListener("drop", onDrop, opts);
}

function placeSourceBlockFromDrop(
  payload: { path: string; format: string; schemaType?: string },
  clientX: number,
  clientY: number,
): void {
  const xpath = getSourceFormatHandler(payload.format).pathToExpression(payload.path);
  const schemaType = controller.lookupSourceSchemaType(payload.path) ?? payload.schemaType;
  const returnType = sourceReturnTypeFromSchemaType(schemaType);
  const { x, y } = workspacePositionFromClient(workspace, clientX, clientY);
  placeSourceQueryBlock(workspace, xpath, returnType, x, y);
  controller.setStatusMessage(`Added source ${xpath}`);
}

function blockOwnPathClientRect(block: BlockSvg): DOMRect | null {
  // getSvgRoot() may be an outer stack group; the block's own chrome lives on
  // the `g.blocklyDraggable[data-id=…]` that carries this block's path.
  const byId = block.id
    ? document.querySelector(
      `g.blocklyDraggable[data-id="${CSS.escape(block.id)}"]`,
    ) as SVGGElement | null
    : null;
  const root = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
  const host = byId ?? root;
  if (!host) return null;
  const path = (
    host.querySelector(":scope > path.blocklyPath") ??
    host.querySelector("path.blocklyPath")
  ) as SVGPathElement | null;
  const box = path?.getBoundingClientRect?.();
  if (box && box.width > 0 && box.height > 0) return box;
  return null;
}

function findSlotIdAtPoint(clientX: number, clientY: number): string | null {
  let best: { slotId: string; area: number } | null = null;
  const scale = (workspace as Blockly.WorkspaceSvg).scale ?? 1;
  for (const block of workspace.getAllBlocks(false)) {
    if (!isSourceDropSlotBlock(block)) continue;
    const svg = block as BlockSvg;
    const root = typeof svg.getSvgRoot === "function" ? svg.getSvgRoot() : null;
    if (!root) continue;
    const pathBox = blockOwnPathClientRect(svg);
    const rect = pathBox
      ? {
        left: pathBox.left,
        top: pathBox.top,
        right: pathBox.right,
        bottom: pathBox.bottom,
        width: pathBox.width,
        height: pathBox.height,
      }
      : blockOwnClientRect(root.getBoundingClientRect(), blockOwnWorkspaceSize(svg), scale);
    if (!pointInRect(clientX, clientY, rect)) continue;
    let slotId = slotIdFromBlock(block);
    if (!slotId) slotId = owningValueSlotId(block);
    if (!slotId) continue;
    const area = rect.width * rect.height;
    if (!best || area < best.area) best = { slotId, area };
  }
  return best?.slotId ?? null;
}

function initFileDropTargets(): void {
  initFileDrop(schemaTreeEl, {
    accept: (file) => /\.(json|xml|xsd)$/i.test(file.name),
    multiple: false,
    onDrop: (files) => void (async () => {
      const loaded = await readDroppedTextFiles(files);
      if (loaded[0]) await controller.loadSchemaFromDrop(loaded[0]);
    })(),
    onReject: (names) => {
      controller.reportSchemaDropRejected(
        names.length
          ? `Unsupported schema file (${names.join(", ")}). Use JSON, XML, or XSD.`
          : "No file found in the drop.",
      );
    },
  });
  initFileDrop(exampleTreeEl, {
    accept: (file) => /\.(json|xml)$/i.test(file.name),
    multiple: true,
    onDrop: (files) => void (async () => {
      await controller.addExamplesFromDrop(await readDroppedTextFiles(files));
    })(),
  });
}

async function readDroppedTextFiles(files: File[]) {
  return await Promise.all(files.map(async (file) => ({
    name: file.name,
    text: await file.text(),
  })));
}

function initFileDrop(
  el: HTMLElement,
  options: {
    accept: (file: File) => boolean;
    multiple: boolean;
    onDrop: (files: File[]) => void;
    onReject?: (filenames: string[]) => void;
  },
): void {
  el.classList.add("tree-pane--drop-target");
  el.addEventListener("dragenter", (event) => {
    event.preventDefault();
  });
  el.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    el.classList.add("tree-pane--dragover");
  });
  el.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
    el.classList.remove("tree-pane--dragover");
  });
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    el.classList.remove("tree-pane--dragover");
    const dropped = [...event.dataTransfer?.files ?? []];
    const files = dropped.filter(options.accept);
    if (!files.length) {
      options.onReject?.(dropped.map((file) => file.name).filter(Boolean));
      return;
    }
    options.onDrop(options.multiple ? files : files.slice(0, 1));
  });
}

document.getElementById("save-as-cancel")?.addEventListener("click", () => dialogSaveAs.close());
dialogSaveAs.addEventListener("close", () => {
  if (dialogSaveAs.returnValue !== "confirm") return;
  void (async () => {
    try {
      await controller.saveProjectAs(saveAsNameInput.value);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});

document.getElementById("load-project-cancel")?.addEventListener("click", () => dialogLoadProject.close());

function resetBlocklyView(): void {
  blocklySkeletonKey = "";
  blocklySlotSignature = "";
  runWithoutBlocklyEvents(() => {
    workspace.clear();
  });
}

async function openDefaultsMapDialog(): Promise<void> {
  defaultsMapList.innerHTML = "";
  if (defaultsMapUrlInput) defaultsMapUrlInput.value = "";
  let entries: Array<{ id: string; displayName: string; savedAt: string }> = [];
  try {
    entries = await defaultsCatalog.list();
  } catch (err) {
    const empty = document.createElement("p");
    empty.className = "load-project-empty";
    empty.textContent = formatMessage(uiChrome().defaultsUnavailable, {
      detail: err instanceof Error ? err.message : String(err),
    });
    defaultsMapList.appendChild(empty);
  }
  if (!entries.length && defaultsMapList.childElementCount === 0) {
    const empty = document.createElement("p");
    empty.className = "load-project-empty";
    empty.textContent = uiChrome().noSavedMaps;
    defaultsMapList.appendChild(empty);
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "load-project-item";
    const kind = document.createElement("span");
    kind.className = "load-project-item-kind";
    kind.textContent = uiChrome().savedMap;
    const name = document.createElement("strong");
    name.textContent = entry.displayName;
    const when = document.createElement("span");
    when.textContent = formatSaveTime(entry.savedAt);
    button.append(kind, name, when);
    button.addEventListener("click", () => {
      dialogDefaultsMap.close();
      void (async () => {
        const mapBlock = await defaultsCatalog.load(entry.id);
        if (!mapBlock) return;
        hydrateDefaultsMapArgument(workspace, mapBlock, blocklyLocale, targetFormatOf(controller.getState()));
        persistBlocklyCanvas();
      })();
    });
    defaultsMapList.appendChild(button);
  }
  dialogDefaultsMap.showModal();
}

function openHardcodeDefaultsDialog(): void {
  if (!dialogHardcodeDefaults || !hardcodeDefaultsList || !workspace) return;
  hardcodeDefaultsList.innerHTML = "";
  const entries = listDefaultsMapEntries(workspace);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "load-project-empty";
    empty.textContent = uiChrome().noHardcodeEntries;
    hardcodeDefaultsList.appendChild(empty);
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "load-project-item";
    const kind = document.createElement("span");
    kind.className = "load-project-item-kind";
    kind.textContent = entry.key;
    const summary = document.createElement("strong");
    summary.textContent = entry.summary;
    button.append(kind, summary);
    button.addEventListener("click", () => {
      dialogHardcodeDefaults.close();
      const replaced = hardcodeDefaultsMapKey(workspace, entry.key);
      persistBlocklyCanvas();
      controller.setStatusMessage(
        replaced > 0
          ? `Hardcoded “${entry.key}” into ${replaced} lookup${replaced === 1 ? "" : "s"}`
          : `No maps_get("defaults", "${entry.key}") lookups found on the canvas`,
      );
      render();
    });
    hardcodeDefaultsList.appendChild(button);
  }
  dialogHardcodeDefaults.showModal();
}

function applyDefaultsMapJson(text: string): void {
  const parsed = JSON.parse(text) as unknown;
  const mapBlock = mapBlockFromDefaultsJson(parsed);
  if (!mapBlock) throw new Error("JSON must be a default context map, maps_create_with block, or workspace");
  hydrateDefaultsMapArgument(workspace, mapBlock, blocklyLocale, targetFormatOf(controller.getState()));
  persistBlocklyCanvas();
}

document.getElementById("defaults-map-cancel")?.addEventListener("click", () => dialogDefaultsMap.close());
document.getElementById("hardcode-defaults-cancel")?.addEventListener("click", () =>
  dialogHardcodeDefaults?.close()
);
document.getElementById("defaults-map-browse")?.addEventListener("click", () => {
  void (async () => {
    const file = await host.pickTextFile(".json", "defaults");
    if (!file) return;
    dialogDefaultsMap.close();
    try {
      applyDefaultsMapJson(file.text);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});
document.getElementById("defaults-map-url-load")?.addEventListener("click", () => {
  void (async () => {
    const url = defaultsMapUrlInput?.value.trim() ?? "";
    if (!url) return;
    try {
      const file = await host.fetchTextUrl(url);
      applyDefaultsMapJson(file.text);
      dialogDefaultsMap.close();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});
document.getElementById("defaults-map-download")?.addEventListener("click", () => {
  try {
    const mapBlock = serializeDefaultsMapArgument(workspace);
    if (!mapBlock) throw new Error("No default context mapping to download");
    void host.downloadText(
      "defaults.map.json",
      JSON.stringify(mapBlock, null, 2),
      "application/json",
    );
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
});
document.getElementById("defaults-map-save-as")?.addEventListener("click", () => {
  defaultsSaveAsNameInput.value = "Defaults";
  dialogDefaultsSaveAs.returnValue = "cancel";
  dialogDefaultsSaveAs.showModal();
  defaultsSaveAsNameInput.focus();
  defaultsSaveAsNameInput.select();
});
document.getElementById("defaults-save-as-cancel")?.addEventListener("click", () =>
  dialogDefaultsSaveAs.close()
);
dialogDefaultsSaveAs.addEventListener("close", () => {
  if (dialogDefaultsSaveAs.returnValue !== "confirm") return;
  void (async () => {
    try {
      const mapBlock = serializeDefaultsMapArgument(workspace);
      if (!mapBlock) throw new Error("No default context mapping to save");
      await defaultsCatalog.save(defaultsSaveAsNameInput.value, mapBlock);
      dialogDefaultsMap.close();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});

let jointPendingTarget: { name: string; text: string } | null = null;
let jointPendingMapFile: unknown | null = null;

function emptyContextMapJson(): Record<string, unknown> {
  return { type: "default_context_map", extraState: { itemCount: 0, targets: [] }, fields: {} };
}

function jointHasTarget(): boolean {
  return Boolean(jointPendingTarget || controller.getState().templateId);
}

function syncJointConfirmButton(): void {
  const confirm = document.getElementById("joint-load-confirm") as HTMLButtonElement | null;
  if (!confirm) return;
  confirm.disabled = !jointHasTarget();
  confirm.textContent = selectedJointMapChoice() === "new"
    ? uiChrome().loadIntoSchema
    : uiChrome().loadAndScaffold;
}

async function openJointLoadDialog(): Promise<void> {
  const dialog = document.getElementById("dialog-joint-load") as HTMLDialogElement | null;
  const summary = document.getElementById("joint-target-summary");
  const catalogEl = document.getElementById("joint-map-catalog");
  const useCurrent = document.getElementById("joint-target-current") as HTMLButtonElement | null;
  const urlInput = document.getElementById("joint-target-url") as HTMLInputElement | null;
  if (!dialog || !summary || !catalogEl) return;
  jointPendingTarget = null;
  jointPendingMapFile = null;
  if (urlInput) urlInput.value = "";
  const fileOption = document.getElementById("joint-map-file-option");
  if (fileOption) fileOption.hidden = true;
  const state = controller.getState();
  summary.textContent = state.templateId
    ? formatMessage(uiChrome().loadedColon, { name: state.templateFilename || state.templateId })
    : uiChrome().noTargetYet;
  if (useCurrent) useCurrent.hidden = !state.templateId;
  catalogEl.replaceChildren();
  try {
    const entries = await defaultsCatalog.list();
    for (const entry of entries) {
      const label = document.createElement("label");
      label.className = "joint-load-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "joint-map";
      input.value = `catalog:${entry.id}`;
      label.append(input, document.createTextNode(
        ` ${formatMessage(uiChrome().savedColon, { name: entry.displayName })}`,
      ));
      catalogEl.append(label);
    }
  } catch {
    // catalog optional
  }
  const factoryRadio = dialog.querySelector<HTMLInputElement>('input[name="joint-map"][value="factory"]');
  if (factoryRadio) factoryRadio.checked = true;
  syncJointConfirmButton();
  dialog.showModal();
}

function selectedJointMapChoice(): string {
  const dialog = document.getElementById("dialog-joint-load");
  const checked = dialog?.querySelector<HTMLInputElement>('input[name="joint-map"]:checked');
  return checked?.value ?? "factory";
}

async function confirmJointLoad(): Promise<void> {
  const dialog = document.getElementById("dialog-joint-load") as HTMLDialogElement | null;
  if (!jointHasTarget()) {
    controller.setStatusMessage("Pick a target file or URL first.");
    return;
  }
  const choice = selectedJointMapChoice();
  const isNew = choice === "new";
  let mapBlock: unknown | null = null;
  if (choice === "factory") {
    mapBlock = factoryDefaultsMapBlockState(blocklyLocale);
  } else if (choice === "current") {
    mapBlock = serializeDefaultsMapArgument(workspace);
  } else if (choice === "new") {
    mapBlock = emptyContextMapJson();
  } else if (choice === "file") {
    mapBlock = jointPendingMapFile;
  } else if (choice.startsWith("catalog:")) {
    mapBlock = await defaultsCatalog.load(choice.slice("catalog:".length));
  }
  if (jointPendingTarget) {
    controller.queuePendingDefaultsMap(mapBlock);
    if (isNew) {
      await withUndoableDocumentReplace(() => {
        controller.loadTargetForBrowse(jointPendingTarget!.name, jointPendingTarget!.text);
      });
    } else {
      await withUndoableDocumentReplace(() => {
        controller.loadTargetContent(jointPendingTarget!.name, jointPendingTarget!.text);
      });
    }
  } else if (controller.getState().templateId) {
    controller.queuePendingDefaultsMap(mapBlock);
    if (isNew) {
      hydrateDefaultsMapArgument(
        workspace,
        mapBlock,
        blocklyLocale,
        targetFormatOf(controller.getState()),
      );
      persistBlocklyCanvas({ summary: "New default context map" });
      controller.setStatusMessage("Empty default context map ready — pull from Target schema, then Apply.");
    } else if (mapBlock) {
      hydrateDefaultsMapArgument(
        workspace,
        mapBlock,
        blocklyLocale,
        targetFormatOf(controller.getState()),
      );
      applyDefaultContextMapFromCanvas();
    }
  } else {
    controller.setStatusMessage("Pick a target file or URL first.");
    return;
  }
  dialog?.close();
  render();
}

document.getElementById("joint-target-file")?.addEventListener("click", () => {
  void (async () => {
    const file = await host.pickTextFile(
      ".opt,.opt2,.json,.xsd,.xml,.adl,.adls,.hbs,.handlebars,.txt,.md,.html,.csv",
      "target",
    );
    if (!file) return;
    jointPendingTarget = { name: file.name, text: file.text };
    const summary = document.getElementById("joint-target-summary");
    if (summary) summary.textContent = formatMessage(uiChrome().selectedFile, { name: file.name });
    syncJointConfirmButton();
  })();
});
document.getElementById("joint-target-current")?.addEventListener("click", () => {
  jointPendingTarget = null;
  const state = controller.getState();
  const summary = document.getElementById("joint-target-summary");
  if (summary) {
    summary.textContent = formatMessage(uiChrome().usingLoaded, {
      name: state.templateFilename || state.templateId,
    });
  }
  syncJointConfirmButton();
});
document.getElementById("joint-target-url-load")?.addEventListener("click", () => {
  void (async () => {
    const urlInput = document.getElementById("joint-target-url") as HTMLInputElement | null;
    const url = urlInput?.value.trim() ?? "";
    if (!url) {
      alert(uiChrome().pasteTargetUrl);
      return;
    }
    try {
      const file = await host.fetchTextUrl(url);
      jointPendingTarget = { name: file.name, text: file.text };
      const summary = document.getElementById("joint-target-summary");
      if (summary) summary.textContent = formatMessage(uiChrome().fetchedFile, { name: file.name });
      syncJointConfirmButton();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});
document.getElementById("joint-map-browse")?.addEventListener("click", () => {
  void (async () => {
    const file = await host.pickTextFile(".json", "defaults");
    if (!file) return;
    try {
      jointPendingMapFile = mapBlockFromDefaultsJson(JSON.parse(file.text));
      const dialog = document.getElementById("dialog-joint-load");
      const fileOption = document.getElementById("joint-map-file-option");
      const fileRadio = dialog?.querySelector<HTMLInputElement>('input[name="joint-map"][value="file"]');
      const fileLabel = document.getElementById("joint-map-file-label");
      if (fileOption) fileOption.hidden = !jointPendingMapFile;
      if (fileLabel) fileLabel.textContent = formatMessage(uiChrome().browsedFileLabel, { name: file.name });
      if (jointPendingMapFile && fileRadio) fileRadio.checked = true;
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  })();
});
document.getElementById("joint-load-cancel")?.addEventListener("click", () => {
  (document.getElementById("dialog-joint-load") as HTMLDialogElement | null)?.close();
});
document.getElementById("dialog-joint-load")?.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.name === "joint-map") {
    syncJointConfirmButton();
  }
});
document.getElementById("dialog-joint-load")?.querySelector("form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void confirmJointLoad();
});

function showRefreshReport(): void {
  const dialog = document.getElementById("dialog-refresh-report") as HTMLDialogElement | null;
  const body = document.getElementById("refresh-report-body");
  const report = controller.getState().lastRefreshReport;
  if (!dialog || !body || !report) return;
  const messages = uiChrome();
  const kind = localizeStatus(detectLocale(), report.kind);
  const warningLine = report.warnings.length
    ? formatMessage(messages.refreshWarningCount, { n: report.warnings.length })
    : messages.noMappingConflicts;
  body.textContent = [
    formatMessage(messages.refreshReportLine, {
      kind,
      previous: report.previousFilename,
      next: report.nextFilename,
    }),
    warningLine,
    ...report.warnings.map((warning) => `• ${warning.message}`),
  ].join("\n");
  dialog.showModal();
}

async function refreshTargetFromFile(): Promise<void> {
  const file = await host.pickTextFile(
    ".opt,.opt2,.json,.xsd,.xml,.adl,.adls,.hbs,.handlebars,.txt,.md,.html,.csv",
    "target",
  );
  if (!file) return;
  controller.refreshTargetContent(file.name, file.text);
  applyDefaultContextMapAfterRefresh();
  showRefreshReport();
}

async function refreshTargetFromUrl(url: string): Promise<void> {
  const file = await host.fetchTextUrl(url);
  controller.refreshTargetContent(file.name, file.text);
  applyDefaultContextMapAfterRefresh();
  showRefreshReport();
}

async function refreshSchemaFromFile(): Promise<void> {
  const file = await host.pickTextFile(".json,.xml,.xsd,application/json,application/xml", "schema");
  if (!file) return;
  controller.refreshSchemaContent(file.name, file.text);
  showRefreshReport();
}

async function refreshSchemaFromUrl(url: string): Promise<void> {
  const file = await host.fetchTextUrl(url);
  controller.refreshSchemaContent(file.name, file.text);
  showRefreshReport();
}

document.getElementById("refresh-copy-prompt")?.addEventListener("click", () => {
  void host.copyToClipboard(controller.buildRefreshMergePrompt()).then(() => {
    controller.setStatusMessage("Refresh merge prompt copied");
  });
});
document.getElementById("refresh-call-ai")?.addEventListener("click", () => {
  (document.getElementById("dialog-refresh-report") as HTMLDialogElement | null)?.close();
  aiChat?.prefill(controller.buildRefreshMergePrompt());
});

interface LocalMcpStatusBody {
  enabled: boolean;
  agentUrl: string;
  token: string;
  mcpJson: unknown;
}

function localMcpAuthHeaders(): Record<string, string> {
  const token = (globalThis as unknown as { __INTEHR_AGENT_TOKEN__?: string }).__INTEHR_AGENT_TOKEN__;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let localMcpEnabled = true;
let localMcpConfigText = "";

function applyLocalMcpStatus(body: LocalMcpStatusBody): void {
  const messages = uiChrome();
  localMcpEnabled = body.enabled;
  localMcpConfigText = JSON.stringify(body.mcpJson, null, 2);
  const statusEl = document.getElementById("local-mcp-status");
  const urlEl = document.getElementById("local-mcp-url");
  const tokenEl = document.getElementById("local-mcp-token");
  const configEl = document.getElementById("local-mcp-config");
  const toggle = document.getElementById("local-mcp-toggle");
  if (statusEl) statusEl.textContent = body.enabled ? messages.localMcpRunning : messages.localMcpStopped;
  if (urlEl) urlEl.textContent = body.agentUrl;
  if (tokenEl) tokenEl.textContent = body.token || messages.localMcpNoToken;
  if (configEl) configEl.textContent = localMcpConfigText;
  if (toggle instanceof HTMLButtonElement) {
    toggle.disabled = false;
    toggle.textContent = body.enabled ? messages.localMcpStop : messages.localMcpStart;
  }
}

async function refreshLocalMcpDialog(): Promise<void> {
  const statusEl = document.getElementById("local-mcp-status");
  const toggle = document.getElementById("local-mcp-toggle");
  try {
    const res = await fetch("/api/v1/local-mcp", { headers: localMcpAuthHeaders() });
    if (!res.ok) throw new Error(String(res.status));
    applyLocalMcpStatus(await res.json() as LocalMcpStatusBody);
  } catch {
    if (statusEl) statusEl.textContent = uiChrome().localMcpUnavailable;
    if (toggle instanceof HTMLButtonElement) toggle.disabled = true;
  }
}

function openLocalMcpDialog(): void {
  const dialog = document.getElementById("dialog-local-mcp");
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) dialog.showModal();
  void refreshLocalMcpDialog();
}

function installLocalMcpDialog(): void {
  document.getElementById("local-mcp-toggle")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/local-mcp", {
          method: "POST",
          headers: { ...localMcpAuthHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ enabled: !localMcpEnabled }),
        });
        if (!res.ok) throw new Error(String(res.status));
        applyLocalMcpStatus(await res.json() as LocalMcpStatusBody);
      } catch {
        const statusEl = document.getElementById("local-mcp-status");
        if (statusEl) statusEl.textContent = uiChrome().localMcpUnavailable;
      }
    })();
  });
  document.getElementById("local-mcp-copy")?.addEventListener("click", () => {
    if (!localMcpConfigText) return;
    void host.copyToClipboard(localMcpConfigText).then(() => {
      controller.setStatusMessage(uiChrome().localMcpCopied);
    });
  });
}

function updateCopyAiButtonLabel(): void {
  const main = document.getElementById("btn-copy-ai") as HTMLButtonElement | null;
  if (!main) return;
  const messages = uiChrome();
  main.textContent = messages.menuAi;
  main.title = hasAiCredentials(localStorage) ? messages.callAiTitle : messages.copyPromptTitle;
  aiChat?.refresh();
}

async function desktopAiProxyUrl(): Promise<string | undefined> {
  try {
    const res = await fetch("/api/v1/health");
    if (!res.ok) return undefined;
    const body = await res.json() as { ok?: boolean };
    return body.ok ? "/api/v1/ai-chat-completions" : undefined;
  } catch {
    return undefined;
  }
}

function formatCallAiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return `${message} ${uiChrome().corsCallAiHint}`;
  }
  return message;
}

function showAiProviderHelp(providerId: string): void {
  const help = document.getElementById("ai-provider-help");
  const keyLink = document.getElementById("ai-key-docs") as HTMLAnchorElement | null;
  const docsLink = document.getElementById("ai-provider-docs") as HTMLAnchorElement | null;
  const preset = findAiProviderPreset(providerId);
  if (help) {
    help.textContent = preset?.help ??
      "Paste any OpenAI-compatible chat completions URL, Bearer API key, and model id.";
  }
  if (keyLink) {
    keyLink.href = preset?.keyUrl ?? "https://platform.openai.com/api-keys";
    keyLink.textContent = preset
      ? `Get ${/^[aeiou]/i.test(preset.label) ? "an" : "a"} ${preset.label} key`
      : "Get an API key";
  }
  if (docsLink) {
    docsLink.href = preset?.docsUrl ?? "https://platform.openai.com/docs/api-reference/chat";
  }
}

// ── AI credentials dialog: per-provider configs + Connect & fetch models ────
/** This dialog session's per-provider values; written to storage only on Save. */
let aiCredDrafts: AiProviderConfigs = {};
let aiCredProvider = "";
const MODEL_OTHER = "__other__";

function aiCredEls() {
  return {
    select: document.getElementById("ai-provider") as HTMLSelectElement | null,
    endpoint: document.getElementById("ai-endpoint") as HTMLInputElement | null,
    apiKey: document.getElementById("ai-api-key") as HTMLInputElement | null,
    model: document.getElementById("ai-model") as HTMLInputElement | null,
    picker: document.getElementById("ai-model-picker") as HTMLSelectElement | null,
    fetchBtn: document.getElementById("ai-fetch-models") as HTMLButtonElement | null,
    status: document.getElementById("ai-models-status"),
  };
}

function aiCredFormConfig(prev?: AiProviderConfig): AiProviderConfig {
  const { endpoint, apiKey, model } = aiCredEls();
  return {
    ...prev,
    endpoint: endpoint?.value.trim() ?? "",
    apiKey: apiKey?.value ?? "",
    model: model?.value.trim() ?? "",
  };
}

function refreshProviderLabels(): void {
  const { select } = aiCredEls();
  if (!select) return;
  for (const option of Array.from(select.options)) {
    if (!option.value) continue;
    const base = option.dataset.baseLabel ?? option.textContent ?? option.value;
    option.dataset.baseLabel = base;
    option.textContent = providerOptionLabel(base, aiCredDrafts[option.value]);
  }
}

function setModelsStatus(kind: "none" | "loading" | "ok" | "error", text = ""): void {
  const { status } = aiCredEls();
  if (!status) return;
  status.hidden = kind === "none";
  status.textContent = text;
  status.className = `ai-models-status ai-models-status--${kind}`;
}

function showSavedTestStatus(config: AiProviderConfig | undefined): void {
  if (!config?.testedAt) return setModelsStatus("none");
  const when = new Date(config.testedAt).toLocaleString();
  setModelsStatus(config.testOk ? "ok" : "error", `${config.testMessage ?? ""} (${when})`.trim());
}

/** Dropdown with a "Select model" placeholder; disabled until a provider is chosen and models fetched. */
function renderModelPicker(models: readonly string[] | undefined): void {
  const { select, picker, model, fetchBtn } = aiCredEls();
  if (!picker) return;
  const messages = uiChrome();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = models?.length
    ? messages.aiModelPickerPlaceholder.replace("{count}", String(models.length))
    : messages.aiSelectModel;
  picker.replaceChildren(placeholder);
  for (const id of models ?? []) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    picker.append(option);
  }
  if (models?.length) {
    const other = document.createElement("option");
    other.value = MODEL_OTHER;
    other.textContent = messages.aiModelOther;
    picker.append(other);
  }
  const chosen = Boolean(select?.value);
  picker.disabled = !chosen || !models?.length;
  if (fetchBtn) fetchBtn.disabled = !chosen;
  picker.value = models?.includes(model?.value.trim() ?? "") ? model!.value.trim() : "";
}

function applyAiProviderToForm(id: string): void {
  const { endpoint, apiKey, model } = aiCredEls();
  if (aiCredProvider) aiCredDrafts[aiCredProvider] = aiCredFormConfig(aiCredDrafts[aiCredProvider]);
  const previousModel = model?.value ?? "";
  aiCredProvider = id;
  showAiProviderHelp(id || "custom");
  const saved = id ? aiCredDrafts[id] : undefined;
  if (saved) {
    if (endpoint) endpoint.value = saved.endpoint;
    if (apiKey) apiKey.value = saved.apiKey;
    if (model) model.value = saved.model;
    renderModelPicker(saved.models);
    showSavedTestStatus(saved);
    return;
  }
  if (id && id !== "custom") {
    const applied = applyAiProviderPreset(id);
    if (endpoint) endpoint.value = applied.endpoint;
    // Never carry one vendor's key over to another.
    if (apiKey) apiKey.value = applied.apiKey;
  }
  if (model) model.value = modelAfterProviderChange(previousModel, id, undefined);
  renderModelPicker(undefined);
  setModelsStatus("none");
}

function modelListErrorText(err: unknown, viaDesktop: boolean): string {
  const messages = uiChrome();
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ModelListError) {
    if (err.kind === "network") return `${message}. ${viaDesktop ? messages.aiModelsDesktopHint : messages.aiModelsCorsHint}`;
    if (err.kind === "auth") return `${message}. ${messages.aiModelsAuthHint}`;
    if (err.kind === "http" && (err.status === 404 || err.status === 405)) return `${message}. ${messages.aiModelsNotListedHint}`;
  }
  return message;
}

async function fetchModelsForDialog(): Promise<void> {
  const { select, endpoint, apiKey, model, fetchBtn } = aiCredEls();
  const id = select?.value ?? "";
  if (!id || !fetchBtn) return;
  const messages = uiChrome();
  fetchBtn.disabled = true;
  fetchBtn.setAttribute("aria-busy", "true");
  fetchBtn.textContent = messages.aiFetchingModels;
  setModelsStatus("loading", messages.aiFetchingModels);
  const chatProxy = await desktopAiProxyUrl();
  const proxyUrl = chatProxy?.replace(/ai-chat-completions$/, "ai-models");
  const testedAt = new Date().toISOString();
  try {
    const models = await fetchModelList(endpoint?.value ?? "", apiKey?.value ?? "", {
      proxyUrl,
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(30_000) : undefined,
    });
    const text = messages.aiModelsFound.replace("{count}", String(models.length));
    aiCredDrafts[id] = { ...aiCredFormConfig(aiCredDrafts[id]), testOk: true, testedAt, testMessage: text, models };
    renderModelPicker(models);
    if (model && !model.value.trim() && models.length === 1) model.value = models[0]!;
    setModelsStatus("ok", text);
  } catch (err) {
    const text = modelListErrorText(err, Boolean(proxyUrl));
    aiCredDrafts[id] = { ...aiCredFormConfig(aiCredDrafts[id]), testOk: false, testedAt, testMessage: text };
    renderModelPicker(aiCredDrafts[id]?.models);
    setModelsStatus("error", text);
  } finally {
    fetchBtn.textContent = messages.aiFetchModels;
    fetchBtn.removeAttribute("aria-busy");
    fetchBtn.disabled = !select?.value;
    refreshProviderLabels();
  }
}

function fillProviderSelect(): void {
  const select = document.getElementById("ai-provider") as HTMLSelectElement | null;
  if (!select || select.dataset.filled === "1") return;
  for (const preset of AI_PROVIDER_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    select.append(option);
  }
  select.dataset.filled = "1";
  select.addEventListener("change", () => applyAiProviderToForm(select.value));
  const { picker, model, fetchBtn } = aiCredEls();
  picker?.addEventListener("change", () => {
    if (!model) return;
    if (picker.value === MODEL_OTHER) {
      picker.value = "";
      model.focus();
      model.select();
    } else if (picker.value) {
      model.value = picker.value;
    }
  });
  model?.addEventListener("input", () => {
    if (!picker) return;
    const v = model.value.trim();
    picker.value = Array.from(picker.options).some((o) => o.value === v && v !== MODEL_OTHER) ? v : "";
  });
  fetchBtn?.addEventListener("click", () => void fetchModelsForDialog());
}

function openAiCredentialsDialog(): void {
  const dialog = document.getElementById("dialog-ai-credentials") as HTMLDialogElement | null;
  if (!dialog) return;
  fillProviderSelect();
  aiCredDrafts = loadProviderConfigs(localStorage);
  const creds = loadAiCredentials(localStorage);
  const { select, endpoint, apiKey, model } = aiCredEls();
  const providerId = creds ? (creds.providerId && findAiProviderPreset(creds.providerId) ? creds.providerId : "custom") : "";
  if (select) select.value = providerId;
  aiCredProvider = providerId;
  showAiProviderHelp(providerId || "custom");
  if (endpoint) endpoint.value = creds?.endpoint ?? "";
  if (apiKey) apiKey.value = creds?.apiKey ?? "";
  if (model) model.value = creds?.model ?? "";
  renderModelPicker(aiCredDrafts[providerId]?.models);
  showSavedTestStatus(aiCredDrafts[providerId]);
  refreshProviderLabels();
  dialog.showModal();
}

/** Active Example excerpt for the suggestions fallback (no get_example tool there). */
const FALLBACK_EXAMPLE_CHARS = 6_000;

/**
 * Provider rejected function tools: ask once for suggestions JSON (same chat
 * history) and apply it directly, one Undo step like a tool turn. The import
 * approval modal is only for pasted answers (#252).
 */
async function runSuggestionsFallbackTurn(
  request: AiChatTurnRequest,
  creds: NonNullable<ReturnType<typeof loadAiCredentials>>,
  proxyUrl: string | undefined,
): Promise<AiChatTurnResult> {
  const active = controller.getState().activeExample;
  const excerpt = active
    ? `\n\n## Active Example excerpt (\`${active.filename}\`, first ${FALLBACK_EXAMPLE_CHARS} characters)\n\n\`\`\`\n${active.content.slice(0, FALLBACK_EXAMPLE_CHARS)}\n\`\`\``
    : "";
  const result = await runSuggestionsChatTurn({
    credentials: creds,
    prompt: `${request.prompt}\n\n${SUGGESTIONS_FALLBACK_INSTRUCTION}${excerpt}`,
    history: request.history,
    systemPrefix: controller.buildAiSystemPrefix("copy"),
    proxyUrl,
    signal: request.signal,
    onEvent: request.onEvent,
  });
  const notes: string[] = [uiChrome().aiChatToolsFallback];
  const mappings: string[] = [];
  if (result.truncated) {
    notes.push(uiChrome().aiChatTruncated);
  } else if (looksLikeSuggestionsPayload(result.text)) {
    const report = asAiWriteSync(() =>
      chatService().importSuggestions(result.text, undefined, {
        actor: aiChatActor({ provider: creds.providerId, model: creds.model, turnId: activeAiCommit?.origin.turnId }),
      })
    );
    const notice = mappingNoticeFor("import_suggestions", {}, { report });
    if (notice) {
      mappings.push(notice);
      request.onEvent({ type: "mapping", text: notice });
    }
    persistBlocklyCanvas({ summary: "AI chat" });
    render();
  }
  return {
    text: result.text,
    messages: result.messages,
    toolCalls: [],
    mappings,
    usage: result.usage,
    note: notes.join(" "),
  };
}

/**
 * Run `fn` as one AI change (ADR 0014): its canvas swaps share one Blockly undo
 * group and its desktop commits carry the `ai-chat` origin and one turn id.
 */
async function withAiCommit<T>(origin: Omit<UiCommitOrigin, "origin" | "turnId">, fn: () => T | Promise<T>): Promise<T> {
  const outer = activeAiCommit;
  const turn = { origin: { origin: "ai-chat" as const, ...origin, turnId: crypto.randomUUID() }, notices: [] as string[] };
  activeAiCommit = turn;
  undoGroupAuthors.set(turn.origin.turnId, aiChatActor(origin).displayName);
  try {
    return await fn();
  } finally {
    // The ✓ notices arrive after each write; the last commit carries them all
    // (the session folds it into the turn's entry).
    if (turn.notices.length) await commitPendingUiChange(undefined, { ai: turn, force: true });
    activeAiCommit = outer;
  }
}

function runAiChatTurn(request: AiChatTurnRequest): Promise<AiChatTurnResult> {
  const creds = loadAiCredentials(localStorage);
  if (!creds) return Promise.reject(new Error(uiChrome().saveAiOrCopy));
  return withAiCommit({ provider: creds.providerId, model: creds.model }, () =>
    runAiChatTurnInner({
      ...request,
      onEvent: (event) => {
        if (event.type === "mapping") activeAiCommit?.notices.push(event.text);
        request.onEvent?.(event);
      },
    }));
}

let chatServiceInstance: WorkbenchService | null = null;
let chatClientInstance: LocalAgentClient | null = null;

/** The chat's WorkbenchService on the live controller (ADR 0014: one write path). */
function chatService(): WorkbenchService {
  chatServiceInstance ??= new WorkbenchService({ controller });
  return chatServiceInstance;
}

function chatClient(): LocalAgentClient {
  chatClientInstance ??= new LocalAgentClient(chatService());
  return chatClientInstance;
}

async function runAiChatTurnInner(request: AiChatTurnRequest): Promise<AiChatTurnResult> {
  const creds = loadAiCredentials(localStorage);
  if (!creds) throw new Error(uiChrome().saveAiOrCopy);
  controller.setStatusMessage("Calling AI…");
  const proxyUrl = await desktopAiProxyUrl();
  try {
    // With credentials Send always streams the tool loop; Stop aborts `request.signal`.
    // The chat writes through the same tools and service as MCP (ADR 0014).
    const client = chatClient();
    client.setActor(aiChatActor({ provider: creds.providerId, model: creds.model, turnId: activeAiCommit?.origin.turnId }));
    const result = await runMappingAgentOnClient(client, {
      asAiWrite,
      credentials: creds,
      prompt: request.prompt,
      history: request.history,
      systemPrefix: controller.buildAiSystemPrefix("api"),
      proxyUrl,
      signal: request.signal,
      onEvent: request.onEvent,
      tokenBudget: request.tokenBudget,
      onAfterMutation: () => {
        persistBlocklyCanvas({ summary: "AI chat" });
        render();
      },
    });
    persistBlocklyCanvas({ summary: "AI chat" });
    render();
    const applied = result.imported?.applied ?? 0;
    const mapped = result.toolNames.filter((name) => name === "map_slot").length;
    const errors = result.imported?.errors.length ?? 0;
    const summary =
      `AI chat: ${mapped} map_slot · ${applied} suggestions · ${result.toolNames.length} tools · ${errors} errors`;
    controller.setStatusMessage(result.stopped ? `${summary} (stopped)` : summary);
    const errorText = errors ? `\n\n${result.imported?.errors.slice(0, 8).join("\n")}` : "";
    return {
      text: `${result.text || (result.stopped ? "" : summary)}${errorText}`,
      messages: result.messages,
      toolCalls: result.toolNames,
      suggestionNotes: result.suggestionNotes,
      mappings: result.mappingNotices,
      ...(result.stopped ? { stopped: true } : {}),
      usage: result.usage,
      ...(result.budgetReached ? { budgetReached: true } : {}),
      note: result.truncated
        ? uiChrome().aiChatTruncated
        : result.stepLimitReached
        ? formatMessage(uiChrome().aiChatStepLimit, { steps: result.steps })
        : undefined,
    };
  } catch (err) {
    if (!isToolsUnsupportedError(err)) {
      controller.setStatusMessage(`AI chat failed: ${formatCallAiError(err)}`);
      throw err;
    }
    controller.setStatusMessage("Provider rejected mapping tools; asking for suggestions JSON…");
    return await runSuggestionsFallbackTurn(request, creds, proxyUrl);
  } finally {
    chatClient().setActor(null);
  }
}

function findTreeNode(node: SchemaTreeNode | null | undefined, path: string): SchemaTreeNode | null {
  if (!node) return null;
  if (node.path === path) return node;
  for (const child of node.children) {
    const hit = findTreeNode(child, path);
    if (hit) return hit;
  }
  return null;
}

function findExampleValue(node: SchemaTreeNode | null | undefined, syncPath: string): string | undefined {
  if (!node) return undefined;
  if (node.value !== undefined && canonicalSyncPath(node.path) === syncPath) {
    return typeof node.value === "string" ? node.value : JSON.stringify(node.value);
  }
  for (const child of node.children) {
    const hit = findExampleValue(child, syncPath);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function chipForTreeRow(kind: ContextChipKind, row: HTMLElement): ContextChip | null {
  const s = controller.getState();
  const path = row.dataset.path ?? "";
  if (!path) return null;
  if (kind === "target") {
    const slotId = row.dataset.slotId ?? path;
    const node = s.skeleton.find((entry) => entry.slotId === slotId);
    return {
      kind,
      label: node?.label || row.textContent?.trim().split(/\s{2,}/)[0] || slotId,
      filename: s.templateFilename || undefined,
      slotId,
      path,
      rmType: node?.rmType,
    };
  }
  const tree = kind === "source-schema" ? s.schemaTree : s.exampleTree;
  const node = findTreeNode(tree, path);
  const type = node ? [node.type, node.multiplicity ? `[${node.multiplicity}]` : ""].join(" ").trim() : undefined;
  const value = kind === "source-example" && node?.value !== undefined
    ? (typeof node.value === "string" ? node.value : JSON.stringify(node.value))
    : findExampleValue(s.exampleTree, canonicalSyncPath(path));
  return {
    kind,
    label: node?.name || path,
    filename: (kind === "source-schema" ? s.schemaFilename : s.activeExample?.filename) || undefined,
    path,
    type: type || undefined,
    exampleValue: value,
  };
}

function blockFieldValue(block: Blockly.Block, name: string): string {
  try {
    return String(block.getFieldValue(name) ?? "");
  } catch {
    return "";
  }
}

function chipForBlock(block: Blockly.Block): ContextChip {
  let boundSlot = "";
  for (let at: Blockly.Block | null = block; at && !boundSlot; at = at.getParent()) {
    boundSlot = blockFieldValue(at, "ELEMENT_SLOT_ID") || blockFieldValue(at, "SLOT_ID");
  }
  let boundSourcePath = blockFieldValue(block, "EXPRESSION");
  if (!boundSourcePath) {
    for (const child of block.getDescendants(true)) {
      boundSourcePath = blockFieldValue(child, "EXPRESSION");
      if (boundSourcePath) break;
    }
  }
  const text = block.toString(40).trim();
  return {
    kind: "block",
    label: text || block.type,
    type: block.type,
    blockId: block.id,
    boundSlot: boundSlot || undefined,
    boundSourcePath: boundSourcePath || undefined,
  };
}

const ADD_TO_AI_CHAT_MENU_ID = "intehrgrator_add_to_ai_chat";

function installAddToAiChatMenus(): void {
  const registry = Blockly.ContextMenuRegistry?.registry;
  if (registry && !registry.getItem(ADD_TO_AI_CHAT_MENU_ID)) {
    registry.register({
      id: ADD_TO_AI_CHAT_MENU_ID,
      scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      weight: 9,
      displayText: () => uiChrome().addToAiChat,
      preconditionFn: () => "enabled",
      callback: (scope: { block?: Blockly.BlockSvg }) => {
        if (scope.block) aiChat?.addChip(chipForBlock(scope.block));
      },
    } as Blockly.ContextMenuRegistry.RegistryItem);
  }

  const menu = document.createElement("div");
  menu.id = "tree-ai-chat-menu";
  menu.className = "split-btn-menu tree-context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const item = document.createElement("button");
  item.type = "button";
  item.id = "tree-add-to-ai-chat";
  item.className = "split-btn-menu-item";
  item.setAttribute("role", "menuitem");
  menu.append(item);
  document.body.append(menu);
  let pending: ContextChip | null = null;
  const hide = () => {
    menu.hidden = true;
    pending = null;
  };
  item.addEventListener("click", () => {
    const chip = pending;
    hide();
    if (chip) aiChat?.addChip(chip);
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!menu.hidden && !menu.contains(ev.target as Node)) hide();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
  for (const [treeEl, kind] of [
    [schemaTreeEl, "source-schema"],
    [exampleTreeEl, "source-example"],
    [targetSchemaTreeEl, "target"],
  ] as const) {
    treeEl.addEventListener("contextmenu", (ev) => {
      const row = (ev.target as Element | null)?.closest?.(".tree-row");
      if (!(row instanceof HTMLElement)) return;
      const chip = chipForTreeRow(kind, row);
      if (!chip) return;
      ev.preventDefault();
      pending = chip;
      item.textContent = uiChrome().addToAiChat;
      menu.hidden = false;
      menu.style.left = `${Math.min(ev.clientX, globalThis.innerWidth - 200)}px`;
      menu.style.top = `${Math.min(ev.clientY, globalThis.innerHeight - 40)}px`;
    });
  }
}

document.getElementById("ai-credentials-cancel")?.addEventListener("click", () => {
  (document.getElementById("dialog-ai-credentials") as HTMLDialogElement | null)?.close();
});
document.getElementById("ai-credentials-clear")?.addEventListener("click", () => {
  const { select, apiKey } = aiCredEls();
  const id = select?.value || "custom";
  const label = findAiProviderPreset(id)?.label ?? uiChrome().customEndpoint;
  if (!confirm(uiChrome().aiForgetKeyConfirm.replace("{provider}", label))) return;
  // Credential storage only; chat history and stored prompts never hold the key.
  const forgotten = forgetProviderKey(localStorage, id, apiKey?.value ? [apiKey.value] : []);
  for (const [pid, draft] of Object.entries(aiCredDrafts)) {
    if (pid === id || forgotten.includes(draft.apiKey.trim())) {
      aiCredDrafts[pid] = { endpoint: draft.endpoint, apiKey: "", model: draft.model, ...(draft.models ? { models: draft.models } : {}) };
    }
  }
  if (apiKey) apiKey.value = "";
  setModelsStatus("none");
  refreshProviderLabels();
  updateCopyAiButtonLabel();
  controller.setStatusMessage(uiChrome().aiKeyForgotten.replace("{provider}", label));
});
document.getElementById("ai-credentials-clear-all")?.addEventListener("click", () => {
  if (!confirm(uiChrome().aiClearAllProvidersConfirm)) return;
  clearAllProviderConfigs(localStorage);
  aiCredDrafts = {};
  updateCopyAiButtonLabel();
  (document.getElementById("dialog-ai-credentials") as HTMLDialogElement | null)?.close();
  controller.setStatusMessage("AI credentials cleared");
});
document.getElementById("dialog-ai-credentials")?.querySelector("form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const endpoint = (document.getElementById("ai-endpoint") as HTMLInputElement | null)?.value ?? "";
  const apiKey = (document.getElementById("ai-api-key") as HTMLInputElement | null)?.value ?? "";
  const model = (document.getElementById("ai-model") as HTMLInputElement | null)?.value ?? "";
  // The provider selected on Save becomes the active one.
  const providerId = (document.getElementById("ai-provider") as HTMLSelectElement | null)?.value || "custom";
  try {
    saveAiCredentials(localStorage, {
      endpoint,
      apiKey,
      model,
      providerId,
    });
    upsertProviderConfig(localStorage, providerId, aiCredFormConfig(aiCredDrafts[providerId]));
    updateCopyAiButtonLabel();
    (document.getElementById("dialog-ai-credentials") as HTMLDialogElement | null)?.close();
    controller.setStatusMessage("AI credentials saved in this browser");
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
});

function handleNewProject(): void {
  const message = controller.hasWorkspaceContent()
    ? uiChrome().confirmNewProject
    : uiChrome().confirmNewEmpty;
  if (!confirm(message)) return;
  void withUndoableDocumentReplace(() => {
    controller.newProject();
    resetBlocklyView();
    ephemeralTreeHighlight = null;
    lastActiveExampleId = null;
  });
}

function openSaveAsDialog(): void {
  saveAsNameInput.value = controller.getState().templateId || "";
  dialogSaveAs.returnValue = "cancel";
  dialogSaveAs.showModal();
  saveAsNameInput.focus();
  saveAsNameInput.select();
}

async function openLoadProjectDialog(): Promise<void> {
  const entries = await controller.listLoadableProjects();
  loadProjectList.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "load-project-empty";
    empty.textContent = uiChrome().noSavedProjects;
    loadProjectList.appendChild(empty);
  } else {
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "load-project-item";
      const kind = document.createElement("span");
      kind.className = "load-project-item-kind";
      kind.textContent = entry.kind === "autosave" ? uiChrome().lastAutosave : uiChrome().savedProject;
      const name = document.createElement("strong");
      name.textContent = entry.displayName;
      const when = document.createElement("span");
      when.textContent = formatSaveTime(entry.savedAt);
      button.append(kind, name, when);
      button.addEventListener("click", () => {
        dialogLoadProject.close();
        void (async () => {
          if (
            controller.hasWorkspaceContent() &&
            !confirm(uiChrome().confirmLoadProject)
          ) {
            return;
          }
          await withUndoableDocumentReplace(() => controller.loadStoredProject(entry.storageKey));
          resetBlocklyView();
          ephemeralTreeHighlight = null;
        })();
      });
      loadProjectList.appendChild(button);
    }
  }
  dialogLoadProject.showModal();
}

function render(): void {
  const s = controller.getState();
  const activeExampleId = s.activeExample?.id ?? null;
  if (activeExampleId !== lastActiveExampleId) {
    ephemeralTreeHighlight = null;
    lastActiveExampleId = activeExampleId;
  }

  const messages = uiChrome();
  const locale = detectLocale();
  statusMain.textContent = [
    s.target ? formatMessage(messages.statusTarget, { id: s.target.targetId }) : messages.statusNoTarget,
    formatMessage(messages.statusScript, {
      name: s.settings.exportTarget === "preview"
        ? messages.mappingPreview
        : s.settings.exportTarget.toUpperCase(),
    }),
    s.activeExample
      ? formatMessage(messages.statusExample, { name: s.activeExample.filename })
      : messages.statusNoExample,
    formatMessage(messages.statusUnmapped, { n: s.unmappedMandatory }),
    localizeStatus(locale, s.statusMessage),
  ].join(" · ");

  const saveStatus = s.saveStatus;
  statusSave.textContent = localizeStatus(detectLocale(), saveStatus.label);
  statusSave.className = "status-save" + (
    saveStatus.dirty ? " unsaved" : saveStatus.label ? " saved" : ""
  );

  statusBuild.textContent = `v${APP_VERSION} · ${BUILD_ID} · ${BUILD_TIMESTAMP}`;

  if (s.taskProgress) {
    taskProgressOverlay.innerHTML = taskProgressInnerHtml(
      localizeTaskProgress(detectLocale(), s.taskProgress),
    );
    taskProgressOverlay.hidden = false;
  } else {
    taskProgressOverlay.innerHTML = "";
    taskProgressOverlay.hidden = true;
  }

  syncLanguageWidgets(s);

  if (s.schemaTree) {
    renderSchemaTree(
      schemaTreeEl,
      s.schemaTree,
      (path, event) => {
        handleTreeHighlight(canonicalSyncPath(path), "schema", true);
        handleSourceSelection(path, s.schemaFormat, event);
      },
      treeHighlightOptions(),
      s.schemaFormat,
    );
  } else if (s.schemaError) {
    schemaTreeEl.replaceChildren();
    const err = document.createElement("div");
    err.className = "tree-pane-error";
    err.textContent = s.schemaError;
    schemaTreeEl.append(err);
  } else {
    schemaTreeEl.textContent = uiChrome().loadSchemaEmpty;
  }

  renderTargetSchemaTree(
    targetSchemaTreeEl,
    s.skeleton.length ? targetSchemaTreeFromSkeleton(s.skeleton, targetAltLabels(s)) : [],
    undefined,
    uiChrome().loadTargetEmpty,
  );

  renderExampleTabs(s);
  renderTestOutputTabs(s);
  renderTestOutputValidation(s);
  renderExampleValidation(s);

  if (s.exampleTree && s.activeExample) {
    const format = s.activeExample.format;
    renderInstanceTree(
      exampleTreeEl,
      s.exampleTree,
      (path, event) => {
        handleTreeHighlight(canonicalSyncPath(path), "instance", true);
        handleSourceSelection(path, format, event);
      },
      {
        ...treeHighlightOptions(),
        invalidByPath: Object.fromEntries(
          s.activeExampleValidation.map((issue) => [issue.path, issue.message]),
        ),
      },
      format,
    );
    applyTreeHighlights(schemaTreeEl, exampleTreeEl, activeTreeHighlight(s));
  } else {
    exampleTreeEl.textContent = s.examples.length
      ? uiChrome().selectExampleTab
      : uiChrome().addExamplesEmpty;
  }
  // Constraint warning-text events must not persist/re-render during this
  // pass — that used to stack a second canvas-swap on Click-to-Map.
  suppressBlocklyModelSync = true;
  try {
    syncBlocklyWorkspace(s);
    refreshWorkspaceConstraints(workspace);
    highlightListeningSlot(workspace, controller.getState().listeningSlotId, controller.getState().listeningSourceBlockId);
  } finally {
    suppressBlocklyModelSync = false;
  }
  void commitPendingUiChange();
  if (historyReady && !applyingAgentBundle) applyAiAuthorMarks();
  // Blockly apply may have refreshed generatedCode without a re-render.
  const afterCanvas = controller.getState();

  specChromeUi?.refresh();
  sheetsPanel?.refresh();
  const generated = afterCanvas.generatedCode || "// Generated Export";
  setEditorDoc(exportEditor, generated, languageForExportTarget(s.settings.exportTarget, generated));
  const testOutput = afterCanvas.testResult?.output;
  const testOutputText = testOutput !== undefined
    ? formatTestOutput(testOutput)
    : "// Test Run output";
  setEditorDoc(testOutputEditor, testOutputText, detectEditorLanguage(testOutputText));

  exportTargetSelect.value = s.settings.exportTarget;
  if (instanceShapeSelect) {
    instanceShapeSelect.value = s.settings.openEhrInstanceShape ?? "json";
  }
  if (instanceShapeWrap) {
    instanceShapeWrap.hidden = s.target?.format !== "openehr-template";
  }
  const exportBtn = exportDownloadBtn;
  if (exportBtn) exportBtn.disabled = s.settings.exportTarget === "preview";
  const testDownload = testDownloadBtn;
  if (testDownload) {
    testDownload.disabled = afterCanvas.testResult?.output === undefined &&
      !afterCanvas.testResult?.error;
  }
  const autoplayBtn = document.getElementById("btn-autoplay") as HTMLButtonElement;
  autoplayBtn.disabled = false;
  autoplayBtn.textContent = s.settings.autoplay ? uiChrome().pause : uiChrome().autoplay;
  autoplayBtn.title = s.settings.autoplay ? uiChrome().pauseAutoRunTitle : uiChrome().resumeAutoRunTitle;
  autoplayBtn.setAttribute("aria-pressed", s.settings.autoplay ? "false" : "true");
  refreshUndoButtons();
}

function formatTestOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function renderExampleTabs(s: ReturnType<WorkbenchController["getState"]>): void {
  exampleTabsEl.innerHTML = "";
  for (const ex of s.examples) {
    const hasIssues = (s.exampleValidations[ex.id]?.length ?? 0) > 0;
    const tab = document.createElement("div");
    tab.className = "example-tab example-tab--with-close" +
      (s.activeExample?.id === ex.id ? " active" : "") +
      (hasIssues ? " example-tab--error" : "");
    tab.setAttribute("role", "tab");

    const label = document.createElement("button");
    label.type = "button";
    label.className = "example-tab-label";
    label.textContent = ex.filename;
    label.addEventListener("click", () => controller.setActiveExample(ex.id));

    tab.append(label);
    if (hasIssues) {
      const warn = document.createElement("span");
      warn.className = "example-tab-warn";
      warn.textContent = "⚠";
      warn.title = "Instance does not match schema";
      tab.append(warn);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "example-tab-close";
    close.setAttribute("aria-label", `Close ${ex.filename}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      controller.removeExample(ex.id);
    });

    tab.append(close);
    exampleTabsEl.appendChild(tab);
  }
}

function renderTestOutputTabs(s: ReturnType<WorkbenchController["getState"]>): void {
  testOutputTabsEl.innerHTML = "";
  for (const ex of s.examples) {
    const validation = s.outputValidations[ex.id];
    const hasIssues = Boolean(
      validation?.applicable && !validation.valid && validation.messages.length,
    );
    const testError = s.exampleTestErrors[ex.id];
    const testFailed = Boolean(testError);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "example-tab" + (s.activeExample?.id === ex.id ? " active" : "") +
      (hasIssues || testFailed ? " example-tab--error" : "");
    if (validation?.applicable && validation.valid) {
      const mark = document.createElement("span");
      mark.className = "output-tab-mark";
      mark.textContent = "✅";
      mark.title = "Passes openEHR template validation";
      tab.append(mark);
    } else if (hasIssues || testFailed) {
      const warn = document.createElement("span");
      warn.className = "example-tab-warn";
      warn.textContent = "⚠";
      warn.title = hasIssues
        ? "Conversion output does not match target template"
        : `Conversion Test Run failed: ${testError}`;
      tab.append(warn);
    }
    tab.append(ex.filename);
    tab.addEventListener("click", () => controller.setActiveExample(ex.id));
    testOutputTabsEl.appendChild(tab);
  }
}

function formatValidationListItem(
  path: string,
  message: string,
  line?: number,
): string {
  const where = line ? `line ${line}: ${path}` : path;
  return `${where}: ${message}`;
}

function renderTestOutputValidation(s: ReturnType<WorkbenchController["getState"]>): void {
  const items: string[] = [];
  const result = s.testResult;
  const validation = s.activeExample
    ? s.outputValidations[s.activeExample.id]
    : undefined;

  if (validation?.applicable && !validation.valid) {
    for (const msg of validation.messages) {
      items.push(formatValidationListItem(msg.path, msg.message, msg.line));
    }
  } else if (result?.error) {
    const line = validation?.messages[0]?.line;
    items.push(formatValidationListItem("/", result.error, line));
  }
  for (const warning of result?.warnings ?? []) items.push(warning);
  if (!items.length) {
    testOutputValidationEl.hidden = true;
    testOutputValidationEl.replaceChildren();
    return;
  }
  testOutputValidationEl.hidden = false;
  testOutputValidationEl.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = result?.error ? uiChrome().conversionFailed : uiChrome().templateValidation;
  const list = document.createElement("ul");
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  }
  testOutputValidationEl.append(title, list);
}

function renderExampleValidation(s: ReturnType<WorkbenchController["getState"]>): void {
  const issues = s.activeExampleValidation;
  if (!issues.length) {
    exampleValidationEl.hidden = true;
    exampleValidationEl.replaceChildren();
    return;
  }
  exampleValidationEl.hidden = false;
  exampleValidationEl.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = uiChrome().schemaMismatch;
  const list = document.createElement("ul");
  for (const issue of issues) {
    const item = document.createElement("li");
    item.textContent = `${issue.path}: ${issue.message}`;
    list.appendChild(item);
  }
  exampleValidationEl.append(title, list);
}

/** Blockly path width in workspace units (excludes nested child stacks). */
function ownOutlineWidth(block: BlockSvg): number {
  const byId = block.id
    ? document.querySelector(
      `g.blocklyDraggable[data-id="${CSS.escape(block.id)}"]`,
    ) as SVGGElement | null
    : null;
  const root = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
  const host = byId ?? root;
  const path = (
    host?.querySelector?.(":scope > path.blocklyPath") ??
    host?.querySelector?.("path.blocklyPath")
  ) as SVGPathElement | null;
  try {
    const box = path?.getBBox?.();
    if (box && box.width > 0) return box.width;
  } catch {
    // path not in the live tree yet
  }
  return Number(block.width ?? 0);
}

function statementInputMetricsOf(
  block: Blockly.Block | null | undefined,
  inputName: string,
): {
  offsetX: number;
  offsetY: number;
  blockWidth: number;
  ownWidth: number;
  align: number;
  scale: number;
} | null {
  const input = block?.getInput(inputName);
  const conn = input?.connection as
    | { offsetInBlock?: { x: number; y: number }; x?: number; y?: number }
    | null
    | undefined;
  if (!block || !input || !conn) return null;
  const offset = conn.offsetInBlock ?? { x: Number(conn.x ?? 0), y: Number(conn.y ?? 0) };
  const svg = block as BlockSvg;
  const hw = typeof svg.getHeightWidth === "function"
    ? svg.getHeightWidth()
    : { width: Number((block as { width?: number }).width ?? 0) };
  const ownWidth = ownOutlineWidth(svg) || Number(svg.width ?? hw.width ?? 0);
  const scale = Number((block.workspace as Blockly.WorkspaceSvg | undefined)?.scale ?? 1);
  return {
    offsetX: Number(offset.x),
    offsetY: Number(offset.y),
    blockWidth: Number(hw.width ?? 0),
    ownWidth,
    align: Number(input.align ?? 0),
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

function installWorkbenchTestApi(): void {
  const api: IntehrgratorTestApi = {
    ready: () => workbenchReady,
    loadTemplate(filename, content) {
      controller.loadTemplateContent(filename, content);
    },
    loadSchema(filename, content) {
      controller.loadSchemaContent(filename, content);
    },
    addExample(filename, content) {
      controller.addExampleContent(filename, content);
    },
    refreshTarget(filename, content) {
      controller.refreshTargetContent(filename, content);
      applyDefaultContextMapAfterRefresh();
    },
    refreshSchema(filename, content) {
      controller.refreshSchemaContent(filename, content);
    },
    armSlot(slotId) {
      controller.armSlot(slotId);
    },
    bindFromNode(path, format) {
      controller.bindFromNode(path, format);
    },
    mapNodeToSlot(slotId, path, format) {
      controller.mapNodeToSlot(slotId, path, format);
    },
    runTest() {
      controller.runTestNow();
    },
    setAutoplay(on) {
      const s = controller.getState();
      if (s.settings.autoplay !== on) controller.toggleAutoplay();
    },
    getSnapshot(): WorkbenchTestSnapshot {
      const s = controller.getState();
      const blocklyBlocks = workspace.getAllBlocks(false).map((block) => {
        const fields: Record<string, string> = {};
        for (const input of block.inputList) {
          for (const field of input.fieldRow) {
            const name = field.name;
            if (!name) continue;
            try {
              fields[name] = String(block.getFieldValue(name) ?? "");
            } catch {
              // skip non-serializable fields
            }
          }
        }
        const check = block.outputConnection?.getCheck?.() ?? null;
        const prev = block.previousConnection?.getCheck?.() ?? null;
        return {
          id: block.id,
          type: block.type,
          slotId: slotIdFromBlock(block),
          fields,
          outputCheck: check,
          hasNext: Boolean(block.nextConnection),
          previousCheck: prev,
        };
      });
      return {
        templateId: s.templateId,
        listeningSlotId: s.listeningSlotId,
        listeningSourceBlockId: s.listeningSourceBlockId,
        selectedBlockId,
        exampleCount: s.examples.length,
        activeExampleFilename: s.activeExample?.filename ?? null,
        model: s.model,
        testResult: s.testResult,
        generatedCode: s.generatedCode,
        statusMessage: s.statusMessage,
        taskProgress: s.taskProgress,
        schemaError: s.schemaError,
        exampleIssueCount: s.activeExampleValidation.length,
        autoplay: s.settings.autoplay,
        unmappedMandatory: s.unmappedMandatory,
        blocklyBlocks,
        lastRefreshReport: s.lastRefreshReport
          ? {
            kind: s.lastRefreshReport.kind,
            previousFilename: s.lastRefreshReport.previousFilename,
            nextFilename: s.lastRefreshReport.nextFilename,
            warnings: s.lastRefreshReport.warnings.map((warning) => ({
              kind: warning.kind,
              path: warning.path,
              message: warning.message,
            })),
          }
          : null,
      };
    },
    findSlotIdBySuffix(suffix) {
      const slots = collectValueSlots(controller.getState().skeleton);
      return slots.find((slot) => slot.slotId.endsWith(suffix))?.slotId ?? null;
    },
    getMappingSpecDocument() {
      return mappingSpecDocumentText(specEditor);
    },
    getBlocklyStateJson() {
      return JSON.stringify(Blockly.serialization.workspaces.save(workspace));
    },
    loadBlocklyJson(filename, content) {
      controller.loadBlocklyDefinition(filename, content);
    },
    getBlockClientRect(blockId) {
      const block = workspace.getBlockById(blockId) as BlockSvg | null;
      if (!block) return null;
      const pathBox = blockOwnPathClientRect(block);
      if (pathBox) {
        return { x: pathBox.left, y: pathBox.top, width: pathBox.width, height: pathBox.height };
      }
      const root = typeof block.getSvgRoot === "function" ? block.getSvgRoot() : null;
      if (!root) return null;
      const full = root.getBoundingClientRect();
      const scale = (workspace as Blockly.WorkspaceSvg).scale ?? 1;
      const rect = blockOwnClientRect(full, blockOwnWorkspaceSize(block), scale);
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    },
    getFieldClientRect(blockId, fieldName) {
      const block = workspace.getBlockById(blockId);
      const field = block?.getField(fieldName) as { getSvgRoot?: () => SVGElement | null } | null;
      const root = field?.getSvgRoot?.();
      if (!root) return null;
      const box = root.getBoundingClientRect();
      if (!box.width && !box.height) return null;
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },
    clickBlock(blockId) {
      applyBlockSelection(blockId, "blockly");
    },
    scrollBlockIntoView(blockId) {
      const block = workspace.getBlockById(blockId) as BlockSvg | null;
      if (block) panToBlock(block);
    },
    listBlockInputs(blockId) {
      const block = workspace.getBlockById(blockId);
      return block ? block.inputList.map((input) => input.name) : [];
    },
    listBlockFields(blockId) {
      const block = workspace.getBlockById(blockId);
      if (!block) return [];
      return block.inputList.map((input) => ({
        input: input.name,
        fields: input.fieldRow.map((field) => String(field.name ?? "")),
      }));
    },
    getStatementInputMetrics(blockId, inputName) {
      const block = workspace.getBlockById(blockId);
      return statementInputMetricsOf(block, inputName);
    },
    getMutatorStackMetrics(blockId) {
      const block = workspace.getBlockById(blockId) as BlockSvg | null;
      if (!block) return null;
      const MutatorIconType = Blockly.icons?.MutatorIcon?.TYPE;
      const icon = MutatorIconType ? block.getIcon?.(MutatorIconType) : null;
      const mini = icon && typeof (icon as { getWorkspace?: () => Blockly.Workspace | null }).getWorkspace === "function"
        ? (icon as { getWorkspace: () => Blockly.Workspace | null }).getWorkspace()
        : null;
      if (!mini) return null;
      const container = (mini.getTopBlocks?.(false) ?? []).find((candidate) => candidate.getInput("STACK")) ??
        null;
      return statementInputMetricsOf(container, "STACK");
    },
    newBlock(type) {
      const block = workspace.newBlock(type) as BlockSvg;
      block.initSvg?.();
      block.render?.();
      return block.id;
    },
    canConnectStatement(parentId, inputName, childId) {
      const parent = workspace.getBlockById(parentId);
      const child = workspace.getBlockById(childId);
      const a = parent?.getInput(inputName)?.connection;
      const b = child?.previousConnection;
      if (!a || !b) return false;
      return Boolean(workspace.connectionChecker?.canConnect(a, b, false));
    },
    connectStatement(parentId, inputName, childId) {
      const parent = workspace.getBlockById(parentId);
      const child = workspace.getBlockById(childId);
      const a = parent?.getInput(inputName)?.connection;
      const b = child?.previousConnection;
      if (!a || !b) return false;
      try {
        a.connect(b);
        return a.isConnected();
      } catch {
        return false;
      }
    },
    connectValue(parentId, inputName, childId) {
      const parent = workspace.getBlockById(parentId);
      const child = workspace.getBlockById(childId);
      const a = parent?.getInput(inputName)?.connection;
      const b = child?.outputConnection;
      if (!a || !b) return false;
      try {
        a.connect(b);
        return a.isConnected();
      } catch {
        return false;
      }
    },
    openMutator(blockId) {
      const block = workspace.getBlockById(blockId);
      if (block) openBlockMutator(block);
    },
    setOptionalRmExtras(blockId, names) {
      const block = workspace.getBlockById(blockId);
      if (block) composeOptionalRmExtras(block, names);
    },
    setBlockField(blockId, field, value) {
      const block = workspace.getBlockById(blockId);
      if (!block?.getField(field)) return false;
      block.setFieldValue(value, field);
      return true;
    },
    undo() {
      workspace.undo(false);
      refreshUndoButtons();
    },
    redo() {
      workspace.undo(true);
      refreshUndoButtons();
    },
    undoCount() {
      return workspace.getUndoStack?.()?.length ?? 0;
    },
    redoCount() {
      return workspace.getRedoStack?.()?.length ?? 0;
    },
    undoEventTypes() {
      return (workspace.getUndoStack?.() ?? []).map((event) => String(event.type ?? ""));
    },
  };
  // Some test helpers look for `globalThis.intehrgratorTestApi` rather than
  // `globalThis.window.intehrgratorTestApi`. Expose via both seams.
  (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi }).intehrgratorTestApi = api;
  globalThis.window.intehrgratorTestApi = api;
}

async function main(): Promise<void> {
  // NOTE: `testMode` is intentionally *not* used for gating here.
  // The web app bundle is tree-shaken by esbuild in a way that can cause
  // the `?testMode=1` branch to be dropped, which breaks Playwright tests.
  // Installing this lightweight seam unconditionally keeps the E2E harness stable.
  installWorkbenchTestApi();
  registerServiceWorker();
  installRecommendedVersionPopup();
  const wasmReady = ensureGoTemplateWasm().catch((err) => {
    console.warn("Go template WASM not loaded:", err);
  });
  await bootBlockly();
  await wasmReady;
  render();
  startHistory();
  historyPanel = installHistoryPanel({
    panel: requireEl("history-panel"),
    load: loadHistoryRows,
    undoTo: historyUndoTo,
    revert: historyRevert,
  });
  const historyButton = document.getElementById("btn-history");
  historyButton?.addEventListener("click", () => {
    historyPanel?.toggle();
    historyButton.setAttribute("aria-expanded", String(historyPanel?.isOpen() ?? false));
  });
  workbenchReadyResolve();
}

void main();
