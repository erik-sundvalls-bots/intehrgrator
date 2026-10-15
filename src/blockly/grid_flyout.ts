/**
 * Flyout buttons that create a project grid. They do not place a canvas block.
 */

export const ADD_SHEET_CALLBACK = "INTEHR_ADD_SHEET";
export const ADD_DECISION_TABLE_CALLBACK = "INTEHR_ADD_DECISION_TABLE";

export type GridKind = "sheet" | "decision-table";
export type GridCreateHandler = (kind: GridKind) => void;

let gridCreateHandler: GridCreateHandler | null = null;

/** Workbench prompts for a name and adds the same empty grid as the tab button. */
export function setGridCreateHandler(handler: GridCreateHandler | null): void {
  gridCreateHandler = handler;
}

export function registerGridFlyoutButtons(workspace: {
  registerButtonCallback: (key: string, func: () => void) => void;
}): void {
  workspace.registerButtonCallback(ADD_SHEET_CALLBACK, () => {
    gridCreateHandler?.("sheet");
  });
  workspace.registerButtonCallback(ADD_DECISION_TABLE_CALLBACK, () => {
    gridCreateHandler?.("decision-table");
  });
}
