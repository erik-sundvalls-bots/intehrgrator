import { assertEquals } from "@std/assert";
import * as enMsg from "blockly/msg/en";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import "blockly/blocks";
import { registerDecisionTableBlocks } from "@intehrgrator/blockly/blocks/decision_table_blocks.ts";
import { setDecisionTableFocusHandler } from "@intehrgrator/blockly/blocks/decision_table_blocks.ts";
import { registerSheetBlocks, setSheetFocusHandler } from "@intehrgrator/blockly/blocks/sheet_blocks.ts";
import {
  clearGridNames,
  retargetGridNames,
  sheetsFromDecisionTableBlockEdit,
} from "@intehrgrator/blockly/decision_table_sync.ts";
import { gridNameOptions, gridNamePlaceholder } from "@intehrgrator/blockly/field_grid_name.ts";
import {
  ADD_DECISION_TABLE_CALLBACK,
  ADD_SHEET_CALLBACK,
  registerGridFlyoutButtons,
  setGridCreateHandler,
} from "@intehrgrator/blockly/grid_flyout.ts";
import { initBlocklyGenerators } from "@intehrgrator/blockly/mod.ts";
import { setWorkspaceSheetsProvider } from "@intehrgrator/blockly/sheets_bridge.ts";
import { migrateForEachSourceState } from "@intehrgrator/blockly/migrate_for_each_source.ts";
import {
  buildGrammaticalJoinBundle,
  JOIN_SWEDISH_SPEC,
} from "@intehrgrator/blockly/grammatical_join.ts";
import { emptyDecisionTable, emptySheet } from "@intehrgrator/core/sheets/mod.ts";

let ready = false;
function ensure(): void {
  if (ready) return;
  const anyMod = enMsg as { default?: Record<string, string> } & Record<string, string>;
  const table = anyMod.default && typeof anyMod.default === "object" ? anyMod.default : anyMod;
  Blockly.setLocale(table);
  initBlocklyGenerators();
  registerDecisionTableBlocks();
  registerSheetBlocks();
  ready = true;
}

Deno.test("grid name menus list only the matching kind", () => {
  setWorkspaceSheetsProvider(() => [emptySheet("icd"), emptyDecisionTable("BMI")]);
  try {
    assertEquals(gridNameOptions("sheet"), [["icd", "icd"]]);
    assertEquals(gridNameOptions("decision-table"), [["BMI", "BMI"]]);
  } finally {
    setWorkspaceSheetsProvider(null);
  }
  assertEquals(gridNameOptions("sheet"), [[gridNamePlaceholder("sheet"), ""]]);
  assertEquals(gridNameOptions("decision-table"), [[gridNamePlaceholder("decision-table"), ""]]);
});

Deno.test("a new block preselects the only grid and otherwise asks the user to select", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  try {
    setWorkspaceSheetsProvider(() => [emptySheet("icd"), emptySheet("atc"), emptyDecisionTable("BMI")]);
    const lookup = workspace.newBlock("sheet_lookup");
    assertEquals(lookup.getFieldValue("NAME"), "");
    const lookupLabel = lookup.getField("NAME") as { getText?: () => string };
    assertEquals(lookupLabel.getText?.(), "-- select sheet --");
    assertEquals(gridNameOptions("sheet")[0], ["-- select sheet --", ""]);

    setWorkspaceSheetsProvider(() => [emptySheet("icd")]);
    const only = workspace.newBlock("sheet_lookup");
    assertEquals(only.getFieldValue("NAME"), "icd");
    assertEquals((only.getField("NAME") as { getText?: () => string }).getText?.(), "icd");

    setWorkspaceSheetsProvider(() => [emptyDecisionTable("BMI"), emptyDecisionTable("Age")]);
    const table = workspace.newBlock("decision_table");
    assertEquals(table.getFieldValue("NAME"), "");
    assertEquals((table.getField("NAME") as { getText?: () => string }).getText?.(), "-- select table --");

    setWorkspaceSheetsProvider(() => []);
    const blank = workspace.newBlock("decision_table");
    assertEquals(blank.getFieldValue("NAME"), "");
    assertEquals((blank.getField("NAME") as { getText?: () => string }).getText?.(), "-- select table --");
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});

Deno.test("loading a blank grid name does not snap to the only sheet", () => {
  ensure();
  setWorkspaceSheetsProvider(() => [emptySheet("icd")]);
  const workspace = new Blockly.Workspace();
  try {
    const saved = migrateForEachSourceState({
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "sheet_lookup", id: "l1", fields: { NAME: "" } }],
      },
    });
    Blockly.serialization.workspaces.load(saved, workspace);
    const lookup = workspace.getAllBlocks(false).find((block) => block.type === "sheet_lookup");
    assertEquals(lookup?.getFieldValue("NAME"), "");
    assertEquals((lookup?.getField("NAME") as { getText?: () => string } | null)?.getText?.(), "-- select sheet --");
  } finally {
    setWorkspaceSheetsProvider(null);
    workspace.dispose();
  }
});

Deno.test("renaming a grid rewrites block names and deleting clears them", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  try {
    const table = workspace.newBlock("decision_table");
    table.setFieldValue("BMI", "NAME");
    const lookup = workspace.newBlock("sheet_lookup");
    lookup.setFieldValue("icd", "NAME");
    retargetGridNames(workspace, "BMI", "BodyMass");
    assertEquals(table.getFieldValue("NAME"), "BodyMass");
    assertEquals(lookup.getFieldValue("NAME"), "icd");
    clearGridNames(workspace, "icd");
    assertEquals(lookup.getFieldValue("NAME"), "");
    assertEquals(table.getFieldValue("NAME"), "BodyMass");
    const label = lookup.getField("NAME") as { getText?: () => string } | null;
    assertEquals(label?.getText?.(), "-- select sheet --");
  } finally {
    workspace.dispose();
  }
});

Deno.test("a name dropdown does not rename the grid document", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  try {
    const table = workspace.newBlock("decision_table");
    table.setFieldValue("BMI", "NAME");
    const sheets = [emptyDecisionTable("BMI")];
    const next = sheetsFromDecisionTableBlockEdit(workspace, sheets, {
      type: "change",
      name: "NAME",
      blockId: table.id,
      oldValue: "BMI",
      newValue: "Other",
    });
    assertEquals(next, null);
    assertEquals(sheets[0]!.name, "BMI");
  } finally {
    workspace.dispose();
  }
});

Deno.test("loading a workspace drops sheet and decision-table declaration chips", () => {
  const loaded = migrateForEachSourceState({
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: "decision_table_decl", id: "d1", fields: { NAME: "BMI" } },
        { type: "decision_table", id: "e1", fields: { NAME: "BMI", OUTPUT: "out" } },
        { type: "sheet", id: "s1", fields: { NAME: "icd" } },
        { type: "sheet_lookup", id: "l1", fields: { NAME: "icd" } },
      ],
    },
  });
  const types = loaded.blocks?.blocks?.map((block) => block.type);
  assertEquals(types, ["decision_table", "sheet_lookup"]);
});

Deno.test("selecting an eval or accessor focuses that grid and ignores a blank name", () => {
  ensure();
  const workspace = new Blockly.Workspace();
  const hits: string[] = [];
  setDecisionTableFocusHandler((name) => hits.push(`dt:${name}`));
  setSheetFocusHandler((name) => hits.push(`sheet:${name}`));
  try {
    const table = workspace.newBlock("decision_table");
    table.setFieldValue("BMI", "NAME");
    const lookup = workspace.newBlock("sheet_lookup");
    lookup.setFieldValue("icd", "NAME");
    const onTable = (table as unknown as { onchange?: (this: typeof table, event: unknown) => void }).onchange;
    const onLookup = (lookup as unknown as { onchange?: (this: typeof lookup, event: unknown) => void }).onchange;
    onTable?.call(table, { type: "selected", newElementId: table.id });
    onLookup?.call(lookup, { type: "selected", newElementId: lookup.id });
    lookup.setFieldValue("", "NAME");
    onLookup?.call(lookup, { type: "selected", newElementId: lookup.id });
    assertEquals(hits, ["dt:BMI", "sheet:icd"]);
  } finally {
    setDecisionTableFocusHandler(null);
    setSheetFocusHandler(null);
    workspace.dispose();
  }
});

Deno.test("flyout add buttons ask the workbench to create a grid and do not need a block", () => {
  const kinds: string[] = [];
  setGridCreateHandler((kind) => kinds.push(kind));
  const callbacks = new Map<string, () => void>();
  registerGridFlyoutButtons({
    registerButtonCallback(key, func) {
      callbacks.set(key, func);
    },
  });
  callbacks.get(ADD_DECISION_TABLE_CALLBACK)?.();
  callbacks.get(ADD_SHEET_CALLBACK)?.();
  assertEquals(kinds, ["decision-table", "sheet"]);
  setGridCreateHandler(null);
});

Deno.test("a function bundle includes a decision table because the eval block names it", () => {
  ensure();
  const bundle = buildGrammaticalJoinBundle(JOIN_SWEDISH_SPEC);
  const state = JSON.stringify(bundle.blocklyState);
  assertEquals(state.includes("decision_table_decl"), false);
  assertEquals(state.includes('"type":"decision_table"') || state.includes('"type": "decision_table"'), true);
  assertEquals(bundle.sheets.map((sheet) => sheet.name), [JOIN_SWEDISH_SPEC.tableName]);
  assertEquals(bundle.decisionTables, [JOIN_SWEDISH_SPEC.tableName]);
});
