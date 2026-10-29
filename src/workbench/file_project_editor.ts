import type { ProjectBundle } from "../types/mod.ts";
import type { WorkbenchController } from "./controller.ts";
import {
  type FileProjectMetadata,
  projectJson,
  projectMapping,
  projectMetadata,
  rebaseProjectMapping,
} from "./file_project.ts";

export type ProjectHostMessage =
  | {
    type: "intehrgrator:project-load";
    bundle: ProjectBundle;
    version: number;
    manifestVersion?: number;
    generation: number;
    reason?: "initial" | "inputs" | "document";
  }
  | {
    type: "intehrgrator:project-ack";
    version: number;
    manifestVersion?: number;
    generation: number;
  }
  | { type: "intehrgrator:project-error"; error: string };

export type ProjectEditorMessage =
  | { type: "intehrgrator:project-ready" }
  | {
    type: "intehrgrator:project-conflict";
    mapping: string;
    metadata: FileProjectMetadata;
  }
  | {
    type: "intehrgrator:project-edit";
    mapping: string;
    metadata: FileProjectMetadata;
    version: number;
    manifestVersion: number;
    generation: number;
  }
  | {
    type: "intehrgrator:project-command";
    command: "save" | "undo" | "redo" | "configure";
  };

export interface ProjectEditorConnection {
  postProjectMessage(message: ProjectEditorMessage): void;
  onProjectMessage(listener: (message: ProjectHostMessage) => void): () => void;
}

interface ProjectEditorSnapshot {
  mapping: string;
  metadata: FileProjectMetadata;
}

function sameSnapshot(
  a: ProjectEditorSnapshot | undefined,
  b: ProjectEditorSnapshot | undefined,
): boolean {
  return a === b ||
    (a !== undefined && b !== undefined && projectJson(a) === projectJson(b));
}

/** Synchronize the canvas with the extension's TextDocument, including external edits and undo. */
export function connectFileProjectEditor(
  controller: WorkbenchController,
  connection: ProjectEditorConnection,
): () => void {
  let version = 0;
  let manifestVersion = 0;
  let generation = 0;
  let ready = false;
  let restoring = false;
  let inFlight = false;
  const commands: Array<"save" | "undo" | "redo"> = [];
  let baseline: ProjectEditorSnapshot | undefined;
  let pending: ProjectEditorSnapshot | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controlsInstalled = false;
  const snapshot = (bundle: ProjectBundle): ProjectEditorSnapshot => ({
    mapping: projectMapping(bundle),
    metadata: projectMetadata(bundle),
  });
  const flush = () => {
    if (!ready || inFlight) return;
    if (!pending || sameSnapshot(pending, baseline)) {
      for (const command of commands.splice(0)) {
        connection.postProjectMessage({
          type: "intehrgrator:project-command",
          command,
        });
      }
      return;
    }
    baseline = pending;
    inFlight = true;
    connection.postProjectMessage({
      type: "intehrgrator:project-edit",
      ...baseline,
      version,
      manifestVersion,
      generation,
    });
  };
  const unsubscribeMessages = connection.onProjectMessage((message) => {
    if (message.type === "intehrgrator:project-error") {
      controller.setStatusMessage(`File project: ${message.error}`);
    } else if (message.type === "intehrgrator:project-load") {
      clearTimeout(timer);
      const hostMapping = snapshot(message.bundle);
      const localMapping = ready
        ? snapshot(controller.exportDocumentSnapshot())
        : pending;
      const unsent = ready && localMapping !== undefined &&
        (inFlight || !sameSnapshot(localMapping, baseline)) &&
        !sameSnapshot(localMapping, hostMapping);
      const preserve = unsent && (sameSnapshot(hostMapping, baseline) ||
        (message.reason === "inputs" && message.version === version &&
          (message.manifestVersion ?? 0) === manifestVersion));
      if (unsent && localMapping && !preserve) {
        commands.length = 0;
        connection.postProjectMessage({
          type: "intehrgrator:project-conflict",
          ...localMapping,
        });
      }
      restoring = true;
      ready = false;
      try {
        controller.restoreDocumentSnapshot(
          preserve && localMapping
            ? rebaseProjectMapping(
              message.bundle,
              localMapping.mapping,
              localMapping.metadata,
            )
            : message.bundle,
        );
        pending = snapshot(controller.exportDocumentSnapshot());
        baseline = preserve ? hostMapping : pending;
        version = message.version;
        manifestVersion = message.manifestVersion ?? 0;
        generation = message.generation;
        inFlight = false;
        ready = true;
        if (!controlsInstalled && typeof document !== "undefined") {
          controlsInstalled = true;
          for (
            const id of [
              "btn-load-schema",
              "btn-load-schema-menu",
              "btn-add-example",
              "btn-add-example-menu",
              "btn-open-template",
              "btn-open-template-menu",
              "btn-example-sets",
            ]
          ) {
            const button = document.getElementById(id);
            if (button instanceof HTMLButtonElement) {
              button.disabled = true;
              button.title =
                "Source and target files are configured in intehrgrator.json";
            }
          }
          for (
            const id of [
              "btn-new-project",
              "btn-load-project",
              "btn-import-project",
            ]
          ) {
            const element = document.getElementById(id);
            if (element) element.hidden = true;
          }
          const save = document.getElementById("btn-save-project");
          if (save) {
            save.textContent = "Save mapping";
            save.addEventListener("click", (event) => {
              event.stopImmediatePropagation();
              commands.push("save");
              flush();
            }, true);
            const configure = document.createElement("button");
            configure.type = "button";
            configure.className = "split-btn-menu-item";
            configure.textContent = "Edit file project configuration";
            configure.addEventListener(
              "click",
              () =>
                connection.postProjectMessage({
                  type: "intehrgrator:project-command",
                  command: "configure",
                }),
            );
            save.after(configure);
          }
        }
        controller.setStatusMessage(
          "File project loaded — Ctrl+S updates code and example results",
        );
      } finally {
        restoring = false;
      }
      flush();
    } else if (message.generation === generation) {
      version = message.version;
      manifestVersion = message.manifestVersion ?? manifestVersion;
      inFlight = false;
      flush();
    }
  });
  const unsubscribeController = controller.subscribe(() => {
    if (!ready || restoring) return;
    pending = snapshot(controller.exportDocumentSnapshot());
    clearTimeout(timer);
    timer = setTimeout(flush, 100);
  });
  const onKey = (event: KeyboardEvent) => {
    if (!ready || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const command = key === "s"
      ? "save"
      : key === "z"
      ? (event.shiftKey ? "redo" : "undo")
      : key === "y"
      ? "redo"
      : null;
    if (!command) return;
    if (
      command !== "save" && typeof Element !== "undefined" &&
      event.composedPath().some((target) =>
        target instanceof Element &&
        target.matches(
          "input, textarea, [contenteditable]:not([contenteditable='false']), .cm-content",
        )
      )
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    commands.push(command);
    flush();
  };
  globalThis.addEventListener("keydown", onKey, true);
  connection.postProjectMessage({ type: "intehrgrator:project-ready" });
  return () => {
    clearTimeout(timer);
    unsubscribeMessages();
    unsubscribeController();
    globalThis.removeEventListener("keydown", onKey, true);
  };
}
