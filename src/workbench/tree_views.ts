import type { SchemaTreeNode, SourceFormatId } from "../types/mod.ts";
import { canonicalSyncPath, isSourceFormatId } from "../core/source/mod.ts";
import { optionalSourceRmGaps } from "../core/source/rm_tree_disclosure.ts";

/** Custom MIME for Source Pane to value-slot drag-and-drop mapping. */
export const SOURCE_DRAG_MIME = "application/x-intehrgrator-source";

export interface SourceDragPayload {
  path: string;
  format: SourceFormatId;
  origin: "schema" | "instance";
  /** JSON Schema / instance type name (`string`, `integer`, `boolean`, â€¦). */
  schemaType?: string;
}

export function parseSourceDragPayload(dt: DataTransfer | null): SourceDragPayload | null {
  const fromTransfer = parseSourceDragPayloadFromTransfer(dt);
  if (fromTransfer) return fromTransfer;
  return activeSourceDrag;
}

let activeSourceDrag: SourceDragPayload | null = null;

export function getActiveSourceDrag(): SourceDragPayload | null {
  return activeSourceDrag;
}

function parseSourceDragPayloadFromTransfer(dt: DataTransfer | null): SourceDragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(SOURCE_DRAG_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SourceDragPayload>;
    if (parsed.path && typeof parsed.format === "string" && isSourceFormatId(parsed.format)) {
      return {
        path: parsed.path,
        format: parsed.format,
        origin: parsed.origin === "schema" || parsed.origin === "instance"
          ? parsed.origin
          : "instance",
        schemaType: typeof parsed.schemaType === "string" ? parsed.schemaType : undefined,
      };
    }
  } catch {
    // plain path fallback (Playwright text-only drops)
  }
  if (raw.startsWith("$") || raw.startsWith("/")) {
    return { path: raw, format: "json", origin: "instance" };
  }
  return null;
}

export interface TreeHighlightState {
  /** Canonical sync path shared across schema and instance trees. */
  syncPath: string | null;
  /** Which tree initiated the highlight (`schema` | `instance`). */
  origin: "schema" | "instance" | null;
}

export interface SchemaTreeRenderOptions {
  onHighlight?: (syncPath: string | null, origin: "schema" | "instance") => void;
  /** Instance-tree path â†’ validation message, for JSON Schema / structural mismatches. */
  invalidByPath?: Record<string, string>;
  /**
   * Accessible name for the optional-RM plus on an openEHR source row (#86).
   * The button itself shows only an encircled plus or minus.
   */
  rmOptionalToggleLabel?: (action: "show" | "hide", nodeName: string) => string;
}

export function applyTreeHighlights(
  schemaPane: HTMLElement,
  instancePane: HTMLElement,
  state: TreeHighlightState,
): void {
  for (const [pane, paneOrigin] of [
    [schemaPane, "schema"],
    [instancePane, "instance"],
  ] as const) {
    for (const row of pane.querySelectorAll<HTMLElement>(".tree-row")) {
      row.classList.remove("highlighted", "synced");
      if (!state.syncPath) continue;
      if (row.dataset.syncPath === state.syncPath) {
        row.classList.add(state.origin === paneOrigin ? "highlighted" : "synced");
      }
    }
  }
}

export type SourceTreeSelectHandler = (path: string, event?: MouseEvent) => void;

const rmExpandedByContainer = new WeakMap<HTMLElement, { key: string; paths: Set<string> }>();

export function renderSchemaTree(
  container: HTMLElement,
  node: SchemaTreeNode,
  onSelect: SourceTreeSelectHandler,
  options: SchemaTreeRenderOptions = {},
  format: SourceFormatId = "json",
): void {
  container.classList.add("schema-tree");
  container.classList.remove("instance-tree");
  const expanded = expandedPaths(container, `${format}\0${node.path}\0${node.name}\0${node.type}`);
  const rerender = () => renderSchemaTree(container, node, onSelect, options, format);
  container.innerHTML = "";
  container.appendChild(buildSchemaNode(node, onSelect, options, 0, format, expanded, rerender));
}

function expandedPaths(container: HTMLElement, key: string): Set<string> {
  const current = rmExpandedByContainer.get(container);
  if (current && current.key === key) return current.paths;
  const paths = new Set<string>();
  rmExpandedByContainer.set(container, { key, paths });
  return paths;
}

export function renderInstanceTree(
  container: HTMLElement,
  node: SchemaTreeNode,
  onSelect: SourceTreeSelectHandler,
  options: SchemaTreeRenderOptions = {},
  format: SourceFormatId = "json",
): void {
  container.classList.add("instance-tree");
  container.classList.remove("schema-tree");
  container.innerHTML = "";
  container.appendChild(buildInstanceNode(node, onSelect, options, 0, format));
}

function buildSchemaNode(
  node: SchemaTreeNode,
  onSelect: SourceTreeSelectHandler,
  options: SchemaTreeRenderOptions,
  depth: number,
  format: SourceFormatId,
  expanded: Set<string>,
  rerender: () => void,
): HTMLElement {
  const syncPath = canonicalSyncPath(node.path);
  const row = createTreeRow(node.path, syncPath, depth);
  if (node.rmOrigin === "rm-mandatory") row.classList.add("tree-row-rm-mandatory");
  if (node.rmOrigin === "rm-optional") row.classList.add("tree-row-rm-optional");

  const label = document.createElement("span");
  label.className = "tree-label tree-label-schema";
  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = formatSchemaMeta(node);
  label.append(document.createTextNode(node.name), meta);
  attachTreeInteractions(label, node, syncPath, "schema", format, onSelect, options);
  row.appendChild(label);

  const optionalGaps = optionalSourceRmGaps(node);
  if (optionalGaps.length > 0) {
    row.appendChild(optionalRmToggle(node, expanded, options, rerender));
  }

  const wrap = document.createElement("div");
  wrap.appendChild(row);
  for (const child of node.children) {
    wrap.appendChild(buildSchemaNode(child, onSelect, options, depth + 1, format, expanded, rerender));
  }
  if (expanded.has(node.path)) {
    for (const child of optionalGaps) {
      wrap.appendChild(buildSchemaNode(child, onSelect, options, depth + 1, format, expanded, rerender));
    }
  }
  return wrap;
}

function optionalRmToggle(
  node: SchemaTreeNode,
  expanded: Set<string>,
  options: SchemaTreeRenderOptions,
  rerender: () => void,
): HTMLButtonElement {
  const open = expanded.has(node.path);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-rm-toggle";
  button.setAttribute("aria-expanded", open ? "true" : "false");
  const label = rmToggleLabel(options, open ? "hide" : "show", node.name);
  button.setAttribute("aria-label", label);
  button.title = label;
  const glyph = document.createElement("span");
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = open ? "\u2212" : "+";
  button.appendChild(glyph);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (expanded.has(node.path)) expanded.delete(node.path);
    else expanded.add(node.path);
    rerender();
  });
  return button;
}

function rmToggleLabel(
  options: SchemaTreeRenderOptions,
  action: "show" | "hide",
  nodeName: string,
): string {
  if (options.rmOptionalToggleLabel) return options.rmOptionalToggleLabel(action, nodeName);
  return action === "show"
    ? `Show optional reference-model attributes for ${nodeName}`
    : `Hide optional reference-model attributes for ${nodeName}`;
}

function buildInstanceNode(
  node: SchemaTreeNode,
  onSelect: SourceTreeSelectHandler,
  options: SchemaTreeRenderOptions,
  depth: number,
  format: SourceFormatId,
): HTMLElement {
  const syncPath = canonicalSyncPath(node.path);
  const row = createTreeRow(node.path, syncPath, depth);
  const invalidMessage = options.invalidByPath?.[node.path];
  if (invalidMessage) {
    row.classList.add("tree-row--invalid");
    row.title = invalidMessage;
  }

  const label = document.createElement("span");
  label.className = "tree-label tree-label-instance";
  label.textContent = node.value !== undefined
    ? `${node.name}  ${formatValue(node.value)}`
    : node.name;
  attachTreeInteractions(label, node, syncPath, "instance", format, onSelect, options);
  row.appendChild(label);

  const wrap = document.createElement("div");
  wrap.appendChild(row);
  for (const child of node.children) {
    wrap.appendChild(buildInstanceNode(child, onSelect, options, depth + 1, format));
  }
  return wrap;
}

function createTreeRow(path: string, syncPath: string, depth: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${depth * 12}px`;
  row.dataset.path = path;
  row.dataset.syncPath = syncPath;
  return row;
}

function attachTreeInteractions(
  label: HTMLSpanElement,
  node: SchemaTreeNode,
  syncPath: string,
  origin: "schema" | "instance",
  format: SourceFormatId,
  onSelect: SourceTreeSelectHandler,
  options: SchemaTreeRenderOptions,
): void {
  label.draggable = true;
  label.addEventListener("click", (event) => {
    options.onHighlight?.(syncPath, origin);
    onSelect(node.path, event);
  });
  label.addEventListener("mouseenter", () => options.onHighlight?.(syncPath, origin));
  label.addEventListener("mouseleave", () => options.onHighlight?.(null, origin));
  label.addEventListener("dragstart", (e) => {
    const payload: SourceDragPayload = {
      path: node.path,
      format,
      origin,
      schemaType: node.type,
    };
    activeSourceDrag = payload;
    const json = JSON.stringify(payload);
    e.dataTransfer?.setData(SOURCE_DRAG_MIME, json);
    e.dataTransfer?.setData("text/plain", json);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  });
  label.addEventListener("dragend", () => {
    queueMicrotask(() => {
      activeSourceDrag = null;
    });
  });
}

function formatSchemaMeta(node: SchemaTreeNode): string {
  const parts = [node.type];
  if (node.multiplicity) parts.push(`[${node.multiplicity}]`);
  return `  ${parts.join(" ")}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
