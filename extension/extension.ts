import * as vscode from "vscode";
import { registerFileProjects } from "./file_project.ts";
import { assertHttpUrl, filenameFromUrl, toFetchableUrl } from "../src/host/fetch_url.ts";
import { acceptToExtensions, acceptToVscodeFilters } from "../src/host/file_picker.ts";

const SAVES_KEY = "intehrgrator.saves";

interface HostRequest {
  type: "intehrgrator:host-request";
  id: string;
  command: string;
  payload?: Record<string, unknown>;
}

interface StoredRecord {
  storageKey: string;
  kind: "autosave" | "manual";
  displayName: string;
  savedAt: string;
  bundle: unknown;
}

export function activate(context: vscode.ExtensionContext): void {
  registerFileProjects(context, webviewHtml, (webview, message) => handleHostRequest(context, webview, message as HostRequest));
}

export function deactivate(): void {
  // no-op
}

async function handleHostRequest(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  request: HostRequest,
): Promise<void> {
  if (request?.type !== "intehrgrator:host-request") return;
  try {
    const result = await dispatchHostCommand(context, request.command, request.payload ?? {});
    await webview.postMessage({
      type: "intehrgrator:host-response",
      id: request.id,
      result,
    });
  } catch (error) {
    await webview.postMessage({
      type: "intehrgrator:host-response",
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function dispatchHostCommand(
  context: vscode.ExtensionContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  switch (command) {
    case "pickTextFile": {
      const uri = await pickFile(context, payload);
      if (!uri) return null;
      return {
        name: uri.path.split("/").pop() ?? "input",
        text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
      };
    }
    case "pickTextFilesFromDirectory": {
      const files = await pickDirectoryTextFiles(context, payload);
      return files.length ? files : null;
    }
    case "pickBinaryFile": {
      const uri = await pickFile(context, payload);
      if (!uri) return null;
      return {
        name: uri.path.split("/").pop() ?? "input",
        bytes: [...await vscode.workspace.fs.readFile(uri)],
      };
    }
    case "downloadText":
      await writeDownload(
        String(payload.filename ?? "output.txt"),
        new TextEncoder().encode(String(payload.content ?? "")),
      );
      return null;
    case "downloadBytes":
      await writeDownload(
        String(payload.filename ?? "output.bin"),
        Uint8Array.from(payload.bytes as number[] ?? []),
      );
      return null;
    case "copyToClipboard":
      await vscode.env.clipboard.writeText(String(payload.text ?? ""));
      return null;
    case "readClipboard":
      return await vscode.env.clipboard.readText();
    case "saveAutosave":
      await putRecord(context, {
        storageKey: "__autosave__",
        kind: "autosave",
        displayName: "Autosave",
        savedAt: new Date().toISOString(),
        bundle: payload.bundle,
      });
      return null;
    case "saveManualSave": {
      const record: StoredRecord = {
        storageKey: `manual:${crypto.randomUUID()}`,
        kind: "manual",
        displayName: String(payload.displayName ?? "Saved project"),
        savedAt: new Date().toISOString(),
        bundle: payload.bundle,
      };
      await putRecord(context, record);
      return null;
    }
    case "loadStoredProjectRecord":
      return records(context).find((record) => record.storageKey === payload.storageKey) ?? null;
    case "listLoadableProjects":
      return records(context)
        .sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === "autosave" ? -1 : 1;
          return right.savedAt.localeCompare(left.savedAt);
        })
        .slice(0, 6)
        .map(({ storageKey, kind, displayName, savedAt }) => ({
          storageKey,
          kind,
          displayName,
          savedAt,
        }));
    case "fetchTextUrl": {
      const fetchable = toFetchableUrl(String(payload.url ?? ""));
      assertHttpUrl(fetchable);
      const response = await fetch(fetchable);
      if (!response.ok) {
        throw new Error(`Could not load ${fetchable} (${response.status} ${response.statusText})`);
      }
      return { name: filenameFromUrl(fetchable), text: await response.text() };
    }
    default:
      throw new Error(`Unsupported host command: ${command}`);
  }
}

async function pickFile(
  context: vscode.ExtensionContext,
  payload: Record<string, unknown>,
): Promise<vscode.Uri | null> {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const lastDir = lastPickerDirs(context)[kind];
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: lastDir ? vscode.Uri.parse(lastDir) : defaultSaveUri(""),
    filters: acceptToVscodeFilters(
      typeof payload.accept === "string" ? payload.accept : undefined,
    ),
  });
  const uri = picked?.[0] ?? null;
  if (uri && kind) await rememberPickerDir(context, kind, uri);
  return uri;
}

async function pickDirectoryTextFiles(
  context: vscode.ExtensionContext,
  payload: Record<string, unknown>,
): Promise<Array<{ name: string; text: string }>> {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const accept = typeof payload.accept === "string" ? payload.accept : ".json,.xml";
  const extensions = acceptToExtensions(accept).map((ext) => ext.slice(1));
  const lastDir = lastPickerDirs(context)[`${kind}-dir`];
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: lastDir ? vscode.Uri.parse(lastDir) : defaultSaveUri(""),
  });
  const uri = picked?.[0] ?? null;
  if (!uri) return [];
  if (kind) await rememberPickerDir(context, `${kind}-dir`, uri);

  const out: Array<{ name: string; text: string }> = [];
  await collectTextFilesFromDirectory(uri, extensions, out);
  return out;
}

async function collectTextFilesFromDirectory(
  dir: vscode.Uri,
  extensions: string[],
  out: Array<{ name: string; text: string }>,
): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(dir);
  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(dir, name);
    if (type === vscode.FileType.Directory) {
      await collectTextFilesFromDirectory(child, extensions, out);
      continue;
    }
    if (type !== vscode.FileType.File) continue;
    const lower = name.toLowerCase();
    if (extensions.length && !extensions.some((ext) => lower.endsWith(`.${ext}`))) continue;
    out.push({
      name,
      text: new TextDecoder().decode(await vscode.workspace.fs.readFile(child)),
    });
  }
}

const LAST_DIR_KEY = "intehrgrator.lastPickerDir";

function lastPickerDirs(context: vscode.ExtensionContext): Record<string, string> {
  return context.workspaceState.get<Record<string, string>>(LAST_DIR_KEY, {});
}

async function rememberPickerDir(
  context: vscode.ExtensionContext,
  kind: string,
  fileUri: vscode.Uri,
): Promise<void> {
  const dir = fileUri.with({ path: fileUri.path.replace(/\/[^/]+$/, "") || "/" });
  const dirs = { ...lastPickerDirs(context), [kind]: dir.toString() };
  await context.workspaceState.update(LAST_DIR_KEY, dirs);
}

async function writeDownload(filename: string, bytes: Uint8Array): Promise<void> {
  const target = await vscode.window.showSaveDialog({ defaultUri: defaultSaveUri(filename) });
  if (target) await vscode.workspace.fs.writeFile(target, bytes);
}

function defaultSaveUri(filename: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder ? vscode.Uri.joinPath(folder, filename) : undefined;
}

function records(context: vscode.ExtensionContext): StoredRecord[] {
  return context.workspaceState.get<StoredRecord[]>(SAVES_KEY, []);
}

async function putRecord(
  context: vscode.ExtensionContext,
  record: StoredRecord,
): Promise<void> {
  const next = records(context).filter((item) => item.storageKey !== record.storageKey);
  next.push(record);
  const autosaves = next.filter((item) => item.kind === "autosave");
  const manual = next
    .filter((item) => item.kind === "manual")
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, 5);
  await context.workspaceState.update(SAVES_KEY, [...autosaves, ...manual]);
}

async function webviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): Promise<string> {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const htmlBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, "index.html"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
    `img-src ${webview.cspSource} data:`,
    `script-src ${webview.cspSource} 'unsafe-eval'`,
    `connect-src ${webview.cspSource} https:`,
  ].join("; ");
  return new TextDecoder().decode(htmlBytes)
    .replace(/(href|src)="(?!https?:|#|data:)([^"\s]+)"/g, (_match, attribute, path) =>
      `${attribute}="${webview.asWebviewUri(vscode.Uri.joinPath(dist, path))}"`)
    .replace("</head>", `<meta http-equiv="Content-Security-Policy" content="${csp}"></head>`)
    ;
}
