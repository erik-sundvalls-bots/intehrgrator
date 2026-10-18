/**
 * Workbench Test API — programmatic seam for UI / E2E tests (kintegrate formTestApi pattern).
 *
 * Exposed on `window.intehrgratorTestApi` when the web app is opened with `?testMode=1`.
 * Setup helpers load fixtures without file pickers; Click-to-Map and Run Test still go through
 * real DOM / Blockly so the harness proves the Mapping Editor UI path.
 */

import type { MappingModel, SourceFormatId, TestResult } from "../types/mod.ts";
import type { TaskProgress } from "../workbench/task_progress.ts";

export interface BlocklyBlockSummary {
  id: string;
  type: string;
  slotId: string | null;
  fields: Record<string, string>;
  outputCheck: string | string[] | null;
  hasNext: boolean;
  previousCheck: string | string[] | null;
}

export interface WorkbenchTestSnapshot {
  templateId: string;
  listeningSlotId: string | null;
  listeningSourceBlockId: string | null;
  selectedBlockId: string | null;
  exampleCount: number;
  activeExampleFilename: string | null;
  model: MappingModel;
  testResult: TestResult | null;
  /** Current Generated conversion script(s) preview. */
  generatedCode: string;
  statusMessage: string;
  taskProgress: TaskProgress | null;
  schemaError: string | null;
  exampleIssueCount: number;
  autoplay: boolean;
  unmappedMandatory: number;
  blocklyBlocks: BlocklyBlockSummary[];
  lastRefreshReport: {
    kind: "target" | "source";
    previousFilename: string;
    nextFilename: string;
    warnings: Array<{ kind: string; path: string; message: string }>;
  } | null;
}

export interface IntehrgratorTestApi {
  /** Wait until Blockly inject + first render completed. */
  ready(): Promise<void>;
  loadTemplate(filename: string, content: string): void;
  loadSchema(filename: string, content: string): void;
  addExample(filename: string, content: string): void;
  /** Non-destructive refresh — keeps canvas mappings and records lastRefreshReport. */
  refreshTarget(filename: string, content: string): void;
  refreshSchema(filename: string, content: string): void;
  armSlot(slotId: string): void;
  /** Programmatic bind (same path as Click-to-Map after Listening Mode). */
  bindFromNode(path: string, format: SourceFormatId): void;
  /** Programmatic bind to a slot (same path as drag-and-drop; skips Listening Mode). */
  mapNodeToSlot(slotId: string, path: string, format: SourceFormatId): void;
  runTest(): void;
  setAutoplay(on: boolean): void;
  getSnapshot(): WorkbenchTestSnapshot;
  /**
   * Find a Target value slot whose slotId ends with `suffix` (stable for OPT fixtures
   * where absolute slotIds are long archetype paths).
   */
  findSlotIdBySuffix(suffix: string): string | null;
  /** Compact Mapping Spec projection currently shown in CodeMirror. */
  getMappingSpecDocument(): string;
  /** Raw Blockly workspace JSON (what project save / Mapping Spec download writes). */
  getBlocklyStateJson(): string;
  /** Load a Blockly workspace JSON file (same path as Mapping Spec Upload). */
  loadBlocklyJson(filename: string, content: string): void;
  /** Client rect of a Blockly block SVG, for real UI clicks / drops. */
  getBlockClientRect(blockId: string): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  /** Client rect of a named Blockly field (header cogwheel, type glyph). */
  getFieldClientRect(
    blockId: string,
    fieldName: string,
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  /** Select a Blockly block (same path as a canvas click). */
  clickBlock(blockId: string): void;
  /** Pan the Blockly canvas so this block is in view. */
  scrollBlockIntoView(blockId: string): void;
  /** Input names currently on a Blockly block (empty when the id is unknown). */
  listBlockInputs(blockId: string): string[];
  /** Field names per input, for header chrome assertions. */
  listBlockFields(blockId: string): Array<{ input: string; fields: string[] }>;
  /** Open the native mutator bubble (cogwheel) on a block. */
  openMutator(blockId: string): void;
  /**
   * Statement mouths: captions hug the C (RIGHT). `ownWidth` is the block
   * outline without nested children (issue #105). offsetX sits on the C after
   * the caption, which may be far left of ownWidth on a wide block.
   */
  getStatementInputMetrics(
    blockId: string,
    inputName: string,
  ): {
    offsetX: number;
    offsetY: number;
    blockWidth: number;
    ownWidth: number;
    align: number;
    scale: number;
  } | null;
  /**
   * After `openMutator`, metrics for the mini-workspace STACK mouth
   * (optional fields / optional RM / schema / XML / map).
   */
  getMutatorStackMetrics(
    blockId: string,
  ): {
    offsetX: number;
    offsetY: number;
    blockWidth: number;
    ownWidth: number;
    align: number;
    scale: number;
  } | null;
  /** Create a canvas block (rendered). Returns the new block id. */
  newBlock(type: string): string | null;
  /** True when `child` previous can snap to `parent`'s named statement input. */
  canConnectStatement(parentId: string, inputName: string, childId: string): boolean;
  /** Connect `child` previous onto `parent`'s named statement input. */
  connectStatement(parentId: string, inputName: string, childId: string): boolean;
  /** Connect `child` output onto `parent`'s named value input. */
  connectValue(parentId: string, inputName: string, childId: string): boolean;
  /** Set optional RM extras on a container via the mutator compose path. */
  setOptionalRmExtras(blockId: string, names: string[]): void;
  /** Set a Blockly field on a canvas block (Instance encoding, etc.). */
  setBlockField(blockId: string, field: string, value: string): boolean;
  undo(): void;
  redo(): void;
  undoCount(): number;
  redoCount(): number;
  undoEventTypes(): string[];
}

declare global {
  interface Window {
    intehrgratorTestApi?: IntehrgratorTestApi;
  }
}

export function isTestMode(search = globalThis.location?.search ?? ""): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("testMode") === "1";
}
