import * as vscode from "vscode";
import {
  loadFileProject,
  parseFileProject,
  projectMapping,
  projectPath,
  updateFileProject,
  writeProjectArtifacts,
} from "../src/workbench/file_project.ts";
import type { ProjectEditorMessage } from "../src/workbench/file_project_editor.ts";

const EDITOR = "intehrgrator.fileProject";
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
    for (
      const uri of await vscode.workspace.findFiles(
        "**/intehrgrator.json",
        "**/{node_modules,.git,dist}/**",
      )
    ) {
      const manifest = parseFileProject(await read(uri));
      if (resolve(uri, manifest.mapping).toString() === mapping.toString()) {
        return uri;
      }
    }
    throw new Error(
      "No intehrgrator.json references this mapping. Use intEHRgrator: Open File Project.",
    );
  };
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
          resolve(manifestUri, project.manifest.mapping),
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
        const root = vscode.Uri.joinPath(manifestUri, "..");
        const disposables: vscode.Disposable[] = [];
        let generation = 0;
        let applying = false;
        let disposed = false;
        let ready = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let edits = Promise.resolve();
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
        const reload = async (
          reason: "initial" | "inputs" | "document" = "document",
        ) => {
          const current = ++generation;
          try {
            const version = document.version;
            const project = await load(manifestUri, document);
            if (disposed || current !== generation) return;
            if (document.version !== version) {
              await reload(reason);
              return;
            }
            await panel.webview.postMessage({
              type: "intehrgrator:project-load",
              bundle: project.bundle,
              version,
              generation: current,
              reason,
            });
          } catch (error) {
            await report(error);
          }
        };
        const regenerate = () =>
          enqueue(manifestUri, async () => {
            await updateFileProject(await read(manifestUri), {
              ...outputFiles(manifestUri),
              listExamples: async (path) =>
                (await listFiles(resolve(manifestUri, path))).filter((name) =>
                  /\.(json|xml)$/i.test(name)
                ),
            });
          });
        disposables.push(
          panel.webview.onDidReceiveMessage(
            (
              message: ProjectEditorMessage | {
                type: "intehrgrator:host-request";
              },
            ) => {
              if (message?.type === "intehrgrator:host-request") {
                void legacyRequest(panel.webview, message);
              } else if (message?.type === "intehrgrator:project-ready") {
                ready = true;
                void reload("initial");
                if (!document.isDirty) void regenerate();
              } else if (message?.type === "intehrgrator:project-conflict") {
                void vscode.workspace.openTextDocument({
                  language: "json",
                  content: message.mapping,
                }).then((backup) => vscode.window.showTextDocument(backup));
                void vscode.window.showWarningMessage(
                  "intEHRgrator: an external mapping edit conflicted with pending canvas changes. Your canvas version is preserved in a separate unsaved JSON editor.",
                );
              } else if (message?.type === "intehrgrator:project-edit") {
                edits = edits.then(async () => {
                  if (
                    message.version !== document.version ||
                    message.generation !== generation
                  ) {
                    await reload(
                      message.version === document.version
                        ? "inputs"
                        : "document",
                    );
                    return;
                  }
                  // Do not accept arbitrary output paths or filesystem commands from the webview.
                  JSON.parse(message.mapping);
                  const edit = new vscode.WorkspaceEdit();
                  edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    message.mapping,
                  );
                  applying = true;
                  try {
                    if (!await vscode.workspace.applyEdit(edit)) {
                      throw new Error("Could not apply mapping edit");
                    }
                  } finally {
                    applying = false;
                  }
                  await panel.webview.postMessage({
                    type: "intehrgrator:project-ack",
                    version: document.version,
                    generation: message.generation,
                  });
                }).catch(report);
              } else if (message?.type === "intehrgrator:project-command") {
                edits = edits.then(async () => {
                  if (message.command === "save") await document.save();
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
          if (
            event.document.uri.toString() === document.uri.toString() &&
            !applying && ready
          ) {
            void reload();
            if (!document.isDirty) void regenerate();
          }
        }));
        disposables.push(vscode.workspace.onDidSaveTextDocument((saved) => {
          if (saved.uri.toString() === document.uri.toString()) {
            void regenerate();
          }
        }));
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(root, "**/*"),
        );
        const changed = (uri: vscode.Uri) => {
          if (!ready || uri.toString() === document.uri.toString()) return;
          void (async () => {
            try {
              const manifest = parseFileProject(await read(manifestUri));
              const paths = [
                manifestUri,
                resolve(manifestUri, manifest.target),
                ...(manifest.source.schema
                  ? [resolve(manifestUri, manifest.source.schema)]
                  : []),
              ];
              const examples = resolve(manifestUri, manifest.source.examples)
                .toString();
              if (
                !paths.some((path) => path.toString() === uri.toString()) &&
                uri.toString() !== examples &&
                !uri.toString().startsWith(examples + "/")
              ) return;
              clearTimeout(timer);
              timer = setTimeout(() => {
                void reload("inputs");
                if (!document.isDirty) void regenerate();
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
  if (document) {
    const manifest = parseFileProject(await read(uri));
    if (resolve(uri, manifest.mapping).toString() !== document.uri.toString()) {
      throw new Error(
        "The mapping path changed. Reopen intehrgrator.json with Open File Project.",
      );
    }
  }
  return await loadFileProject(await read(uri), {
    readText: (path) =>
      document && resolve(uri, path).toString() === document.uri.toString()
        ? Promise.resolve(document.getText())
        : read(resolve(uri, path)),
    listExamples: async (path) =>
      (await listFiles(resolve(uri, path))).filter((name) =>
        /\.(json|xml)$/i.test(name)
      ),
  });
}

function outputFiles(uri: vscode.Uri) {
  return {
    readText: (path: string) => read(resolve(uri, path)),
    writeText: (path: string, text: string) => write(resolve(uri, path), text),
    remove: async (path: string) => {
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
