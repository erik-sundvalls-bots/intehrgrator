import * as vscode from "vscode";
import { lstat, realpath } from "node:fs/promises";
import { join as joinFsPath } from "node:path";
import { assertInsideProject } from "../src/workbench/file_project_paths.ts";
import {
  loadFileProject,
  parseFileProject,
  projectFilePath,
  projectJson,
  projectMapping,
  projectMetadata,
  projectPath,
  projectTargetPaths,
  updateFileProject,
  updateProjectManifest,
  writeProjectArtifacts,
} from "../src/workbench/file_project.ts";
import type {
  FileProjectManifest,
  FileProjectMetadata,
} from "../src/workbench/file_project.ts";
import type { ProjectEditorMessage } from "../src/workbench/file_project_editor.ts";

const EDITOR = "intehrgrator.fileProject";
const RECENT_PROJECTS = "intehrgrator.fileProjectUris";
type WebviewHtml = (
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
) => Promise<string>;

export function registerFileProjects(
  context: vscode.ExtensionContext,
  html: WebviewHtml,
  legacyRequest: (webview: vscode.Webview, message: unknown) => Promise<void>,
): void {
  const knownProjects = new Map<string, vscode.Uri>();
  const recentProjects = () =>
    context.workspaceState.get<string[]>(RECENT_PROJECTS, []);
  const discoverProjects = () =>
    vscode.workspace.findFiles(
      "**/intehrgrator.json",
      "**/{node_modules,.git,dist,.local}/**",
    );
  const rememberProject = async (uri: vscode.Uri) => {
    const path = uri.toString();
    await context.workspaceState.update(
      RECENT_PROJECTS,
      [path, ...recentProjects().filter((entry) => entry !== path)].slice(
        0,
        20,
      ),
    );
  };
  const queue = new Map<string, Promise<void>>();
  const enqueue = (uri: vscode.Uri, operation: () => Promise<void>) => {
    const key = uri.toString();
    const next = (queue.get(key) ?? Promise.resolve()).then(operation).catch(
      (error) => {
        void vscode.window.showErrorMessage(
          `intEHRgrator: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );
    queue.set(key, next);
    return next;
  };
  const locate = async (mapping: vscode.Uri) => {
    const known = knownProjects.get(mapping.toString());
    if (known) return known;
    const candidates = new Set([
      ...recentProjects(),
      ...(await discoverProjects()).map((uri) => uri.toString()),
    ]);
    for (const path of candidates) {
      const uri = vscode.Uri.parse(path);
      try {
        const manifest = parseFileProject(await read(uri));
        if (resolve(uri, manifest.mapping).toString() === mapping.toString()) {
          return uri;
        }
      } catch {
        // A removed or unrelated invalid project must not prevent restoration of this mapping.
      }
    }
    throw new Error(
      "No intehrgrator.json references this mapping. Use intEHRgrator: Open File Project.",
    );
  };
  const openWorkbench = async () => {
    for (const path of recentProjects()) {
      const uri = vscode.Uri.parse(path);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (
          error instanceof vscode.FileSystemError &&
          error.code === "FileNotFound"
        ) continue;
        throw error;
      }
      await vscode.commands.executeCommand("intehrgrator.openFileProject", uri);
      return;
    }
    const projects = await discoverProjects();
    if (projects.length) {
      const selected = projects.length === 1
        ? projects[0]
        : (await vscode.window.showQuickPick(
          projects.map((uri) => ({
            label: vscode.workspace.asRelativePath(uri),
            uri,
          })),
          { placeHolder: "Open an intEHRgrator file project" },
        ))?.uri;
      if (selected) {
        await vscode.commands.executeCommand(
          "intehrgrator.openFileProject",
          selected,
        );
      }
      return;
    }
    const selected = await vscode.window.showQuickPick([
      {
        label: "Create a file project",
        command: "intehrgrator.createFileProject",
      },
      {
        label: "Open an existing file project",
        command: "intehrgrator.openFileProject",
      },
    ], { placeHolder: "Choose an intEHRgrator project" });
    if (selected) await vscode.commands.executeCommand(selected.command);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "intehrgrator.openWorkbench",
      openWorkbench,
    ),
  );
  // Upgrade an old standalone panel to the file-backed editor when VS Code revives it.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("intehrgrator.workbench", {
      async deserializeWebviewPanel(panel) {
        try {
          await openWorkbench();
        } finally {
          panel.dispose();
        }
      },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "intehrgrator.openFileProject",
      async (selected?: vscode.Uri) => {
        const uri = selected ?? (await vscode.window.showOpenDialog({
          canSelectMany: false,
          title: "Open intehrgrator.json",
          filters: { "intEHRgrator project": ["json"] },
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        }))?.[0];
        if (!uri) return;
        const manifest = parseFileProject(await read(uri));
        const mapping = resolve(uri, manifest.mapping);
        knownProjects.set(mapping.toString(), uri);
        await vscode.commands.executeCommand(
          "vscode.openWith",
          mapping,
          EDITOR,
        );
        await rememberProject(uri);
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "intehrgrator.createFileProject",
      async () => {
        const destination = await vscode.window.showSaveDialog({
          title: "Create a file project in a new folder",
          defaultUri: vscode.workspace.workspaceFolders?.[0]
            ? vscode.Uri.joinPath(
              vscode.workspace.workspaceFolders[0].uri,
              "mapping-project",
              "intehrgrator.json",
            )
            : undefined,
          filters: { "intEHRgrator project": ["json"] },
        });
        if (!destination) return;
        if (!destination.path.endsWith("/intehrgrator.json")) {
          throw new Error("Name the project configuration intehrgrator.json");
        }
        const root = resolve(destination, ".");
        const template = vscode.Uri.joinPath(
          context.extensionUri,
          "dist",
          "examples",
          "file-project",
        );
        const files = await listFiles(template);
        for (const name of files) {
          try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, name));
          } catch (error) {
            if (
              error instanceof vscode.FileSystemError &&
              error.code === "FileNotFound"
            ) {
              continue;
            }
            throw error;
          }
          throw new Error(`A project file already exists: ${name}`);
        }
        for (const name of files) {
          const uri = vscode.Uri.joinPath(root, name);
          await assertWritable(destination, name);
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(uri, ".."),
          );
          await vscode.workspace.fs.writeFile(
            uri,
            await vscode.workspace.fs.readFile(
              vscode.Uri.joinPath(template, name),
            ),
          );
        }
        const manifestUri = vscode.Uri.joinPath(root, "intehrgrator.json");
        const project = await load(manifestUri);
        await write(
          manifestUri,
          updateProjectManifest(
            await read(manifestUri),
            projectMetadata(project.bundle),
            {},
          ),
        );
        await outputFiles(manifestUri).writeText(
          project.manifest.mapping,
          projectMapping(project.bundle),
        );
        await writeProjectArtifacts(project, outputFiles(manifestUri));
        await vscode.commands.executeCommand(
          "intehrgrator.openFileProject",
          manifestUri,
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(EDITOR, {
      async resolveCustomTextEditor(document, panel) {
        const manifestUri = await locate(document.uri);
        knownProjects.set(document.uri.toString(), manifestUri);
        await rememberProject(manifestUri);
        const root = vscode.Uri.joinPath(manifestUri, "..");
        let manifestDocument = await vscode.workspace.openTextDocument(
          manifestUri,
        );
        const openManifest = async () => {
          if (manifestDocument.isClosed) {
            manifestDocument = await vscode.workspace.openTextDocument(
              manifestUri,
            );
          }
          return manifestDocument;
        };
        const disposables: vscode.Disposable[] = [];
        let generation = 0;
        let applying = false;
        let disposed = false;
        let ready = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let edits = Promise.resolve();
        let savingProject = false;
        let metadata: FileProjectMetadata = {};
        let currentManifest = parseFileProject(manifestDocument.getText());
        const input = (uri: vscode.Uri) => {
          try {
            if (!manifestDocument.isClosed) {
              currentManifest = parseFileProject(manifestDocument.getText());
            }
          } catch { /* Keep watching while JSON is being edited. */ }
          return isProjectInput(manifestUri, uri, currentManifest);
        };
        const hasDirtyInputs = () =>
          vscode.workspace.textDocuments.some((doc) =>
            doc.isDirty && input(doc.uri)
          );
        panel.webview.options = {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
          ],
        };
        const report = async (error: unknown) => {
          await panel.webview.postMessage({
            type: "intehrgrator:project-error",
            error: error instanceof Error ? error.message : String(error),
          });
        };
        const postDirty = () =>
          panel.webview.postMessage({
            type: "intehrgrator:project-dirty",
            dirty: document.isDirty ||
              (!manifestDocument.isClosed && manifestDocument.isDirty),
          });
        const reload = async (
          reason: "initial" | "inputs" | "document" = "document",
        ) => {
          const current = ++generation;
          try {
            await openManifest();
            const version = document.version;
            const manifestVersion = manifestDocument.version;
            const project = await load(manifestUri, document);
            if (disposed || current !== generation) return;
            if (
              document.version !== version ||
              manifestDocument.version !== manifestVersion
            ) {
              await reload(reason);
              return;
            }
            metadata = projectMetadata(project.bundle);
            await panel.webview.postMessage({
              type: "intehrgrator:project-load",
              bundle: project.bundle,
              version,
              manifestVersion,
              generation: current,
              reason,
            });
            await postDirty();
          } catch (error) {
            await report(error);
          }
        };
        const regenerate = () =>
          enqueue(manifestUri, async () => {
            await openManifest();
            if (disposed || savingProject || hasDirtyInputs()) return;
            await updateFileProject(await read(manifestUri), {
              ...outputFiles(manifestUri),
              listExamples: async (path) =>
                (await listFiles(resolve(manifestUri, path))).filter((name) =>
                  /\.(json|xml)$/i.test(name)
                ),
            });
          });
        const saveProject = async () => {
          await openManifest();
          savingProject = true;
          try {
            if (!await manifestDocument.save() || !await document.save()) {
              throw new Error("The file project could not be saved");
            }
          } finally {
            savingProject = false;
          }
          await regenerate();
        };
        disposables.push(
          panel.webview.onDidReceiveMessage(
            (
              message: ProjectEditorMessage | {
                type: "intehrgrator:host-request";
              },
            ) => {
              if (message?.type === "intehrgrator:host-request") {
                const command = (message as { command?: unknown }).command;
                if (
                  command === "saveAutosave" || command === "saveManualSave"
                ) {
                  // File projects are saved through VS Code documents, never copied into workspaceState.
                  void panel.webview.postMessage({
                    type: "intehrgrator:host-response",
                    id: (message as { id?: unknown }).id,
                    ...(command === "saveAutosave" ? { result: null } : {
                      error: "Use Save (Ctrl+S) to save a file project",
                    }),
                  });
                  return;
                }
                void legacyRequest(panel.webview, message);
              } else if (message?.type === "intehrgrator:project-ready") {
                ready = true;
                // Opening never rewrites committed artifacts; Save and project:run do (#305 review).
                void reload("initial");
              } else if (message?.type === "intehrgrator:project-conflict") {
                let conflictMapping: unknown;
                try {
                  conflictMapping = JSON.parse(message.mapping);
                } catch (error) {
                  void report(error);
                  return;
                }
                void vscode.workspace.openTextDocument({
                  language: "json",
                  content: projectJson({
                    mapping: conflictMapping,
                    languageSettings: message.metadata,
                  }),
                }).then((backup) => vscode.window.showTextDocument(backup));
                void vscode.window.showWarningMessage(
                  "intEHRgrator: external changes conflicted with pending edits. Your mapping and file-language settings are preserved in a separate unsaved JSON editor.",
                );
              } else if (message?.type === "intehrgrator:project-edit") {
                edits = edits.then(async () => {
                  await openManifest();
                  if (
                    message.version !== document.version ||
                    message.manifestVersion !== manifestDocument.version ||
                    message.generation !== generation
                  ) {
                    await reload(
                      message.version === document.version &&
                        message.manifestVersion === manifestDocument.version
                        ? "inputs"
                        : "document",
                    );
                    return;
                  }
                  // Do not accept arbitrary output paths or filesystem commands from the webview.
                  JSON.parse(message.mapping);
                  const manifestText = updateProjectManifest(
                    manifestDocument.getText(),
                    message.metadata,
                    metadata,
                  );
                  const edit = new vscode.WorkspaceEdit();
                  edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    message.mapping,
                  );
                  if (manifestText !== manifestDocument.getText()) {
                    edit.replace(
                      manifestUri,
                      new vscode.Range(0, 0, manifestDocument.lineCount, 0),
                      manifestText,
                    );
                  }
                  applying = true;
                  try {
                    if (!await vscode.workspace.applyEdit(edit)) {
                      throw new Error("Could not apply mapping edit");
                    }
                  } finally {
                    applying = false;
                  }
                  metadata = message.metadata;
                  await panel.webview.postMessage({
                    type: "intehrgrator:project-ack",
                    version: document.version,
                    manifestVersion: manifestDocument.version,
                    generation: message.generation,
                  });
                  await postDirty();
                }).catch(report);
              } else if (message?.type === "intehrgrator:project-command") {
                edits = edits.then(async () => {
                  if (message.command === "save") await saveProject();
                  else if (message.command === "configure") {
                    await vscode.window.showTextDocument(
                      await vscode.workspace.openTextDocument(manifestUri),
                    );
                  } else if (
                    message.command === "undo" || message.command === "redo"
                  ) await vscode.commands.executeCommand(message.command);
                }).catch(report);
              }
            },
          ),
        );
        disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
          const changed = event.document.uri.toString();
          if (
            changed === document.uri.toString() ||
            changed === manifestUri.toString()
          ) void postDirty();
          if (
            input(event.document.uri) &&
            !applying && ready
          ) {
            const path = event.document.uri.toString();
            void reload(
              path === document.uri.toString() ||
                path === manifestUri.toString()
                ? "document"
                : "inputs",
            );
            if (!hasDirtyInputs()) void regenerate();
          }
        }));
        disposables.push(vscode.workspace.onWillSaveTextDocument((event) => {
          const path = event.document.uri.toString();
          if (
            savingProject ||
            (path !== document.uri.toString() &&
              path !== manifestUri.toString())
          ) return;
          event.waitUntil((async () => {
            await edits;
            if (savingProject) return [];
            savingProject = true;
            try {
              await openManifest();
              const other = path === document.uri.toString()
                ? manifestDocument
                : document;
              if (other.isDirty && !await other.save()) {
                throw new Error("Could not save the related project document");
              }
              return [];
            } finally {
              savingProject = false;
            }
          })());
        }));
        disposables.push(vscode.workspace.onDidSaveTextDocument((saved) => {
          const path = saved.uri.toString();
          if (
            path === document.uri.toString() || path === manifestUri.toString()
          ) void postDirty();
          if (!savingProject && input(saved.uri)) {
            void regenerate();
          }
        }));
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(root, "**/*"),
        );
        const changed = (uri: vscode.Uri) => {
          if (
            !ready || uri.toString() === document.uri.toString()
          ) return;
          void (async () => {
            try {
              await openManifest();
              if (!input(uri)) return;
              clearTimeout(timer);
              timer = setTimeout(() => {
                void reload(
                  uri.toString() === manifestUri.toString()
                    ? "document"
                    : "inputs",
                );
                if (!hasDirtyInputs()) void regenerate();
              }, 200);
            } catch (error) {
              await report(error);
            }
          })();
        };
        disposables.push(
          watcher,
          watcher.onDidChange(changed),
          watcher.onDidCreate(changed),
          watcher.onDidDelete(changed),
        );
        panel.onDidDispose(() => {
          disposed = true;
          clearTimeout(timer);
          for (const disposable of disposables) disposable.dispose();
        });
        panel.webview.html = await html(context, panel.webview);
      },
    }, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
}

function resolve(manifest: vscode.Uri, path: string): vscode.Uri {
  return vscode.Uri.joinPath(
    manifest,
    "..",
    ...(path === "." ? [] : projectPath(path).split("/")),
  );
}

async function read(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

function readInput(uri: vscode.Uri): Promise<string> {
  const document = vscode.workspace.textDocuments.find((doc) =>
    doc.uri.toString() === uri.toString()
  );
  return document ? Promise.resolve(document.getText()) : read(uri);
}

function isProjectInput(
  manifestUri: vscode.Uri,
  uri: vscode.Uri,
  manifest: FileProjectManifest,
): boolean {
  const path = uri.toString();
  const paths = [
    manifest.mapping,
    ...projectTargetPaths(manifest.target),
    ...(manifest.source.schema
      ? [projectFilePath(manifest.source.schema)]
      : []),
  ];
  const examples = resolve(manifestUri, manifest.source.examples).toString();
  return path === manifestUri.toString() ||
    paths.some((p) => resolve(manifestUri, p).toString() === path) ||
    path === examples || path.startsWith(examples + "/");
}

async function write(uri: vscode.Uri, text: string): Promise<void> {
  let previous: string | undefined;
  try {
    previous = await read(uri);
  } catch (error) {
    if (
      !(error instanceof vscode.FileSystemError) ||
      error.code !== "FileNotFound"
    ) throw error;
  }
  if (previous === text) return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

async function listFiles(root: vscode.Uri, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for (
    const [name, type] of await vscode.workspace.fs.readDirectory(
      vscode.Uri.joinPath(root, prefix),
    )
  ) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (type === vscode.FileType.Directory) {
      paths.push(...await listFiles(root, path));
    } else if (type === vscode.FileType.File) paths.push(path);
  }
  return paths.sort();
}

async function load(uri: vscode.Uri, document?: vscode.TextDocument) {
  const manifestText = await readInput(uri);
  if (document) {
    const manifest = parseFileProject(manifestText);
    if (resolve(uri, manifest.mapping).toString() !== document.uri.toString()) {
      throw new Error(
        "The mapping path changed. Reopen intehrgrator.json with Open File Project.",
      );
    }
  }
  const project = await loadFileProject(manifestText, {
    readText: (path) =>
      document && resolve(uri, path).toString() === document.uri.toString()
        ? Promise.resolve(document.getText())
        : readInput(resolve(uri, path)),
    listExamples: async (path) =>
      (await listFiles(resolve(uri, path))).filter((name) =>
        /\.(json|xml)$/i.test(name)
      ),
  });
  project.bundle.projectId = uri.toString();
  return project;
}

/** Generated files must resolve inside the project folder, also through symlinks. */
async function assertWritable(manifest: vscode.Uri, path: string): Promise<void> {
  const root = vscode.Uri.joinPath(manifest, "..");
  if (root.scheme === "file") {
    await assertInsideProject(root.fsPath, projectPath(path), {
      join: joinFsPath,
      realPath: async (p) => {
        try {
          return await realpath(p);
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") return null;
          throw error;
        }
      },
      isSymlink: async (p) => {
        try {
          return (await lstat(p)).isSymbolicLink();
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") return false;
          throw error;
        }
      },
    });
    return;
  }
  // Virtual/remote file systems: refuse any symlink between the root and the file.
  let current = root;
  for (const part of projectPath(path).split("/")) {
    current = vscode.Uri.joinPath(current, part);
    try {
      const stat = await vscode.workspace.fs.stat(current);
      if (stat.type & vscode.FileType.SymbolicLink) {
        throw new Error(`Refusing to write through a symlink: ${path}`);
      }
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      ) return;
      throw error;
    }
  }
}

function outputFiles(uri: vscode.Uri) {
  return {
    readText: (path: string) => read(resolve(uri, path)),
    writeText: async (path: string, text: string) => {
      await assertWritable(uri, path);
      await write(resolve(uri, path), text);
    },
    remove: async (path: string) => {
      await assertWritable(uri, path);
      try {
        await vscode.workspace.fs.delete(resolve(uri, path));
      } catch (error) {
        if (
          !(error instanceof vscode.FileSystemError) ||
          error.code !== "FileNotFound"
        ) throw error;
      }
    },
  };
}
