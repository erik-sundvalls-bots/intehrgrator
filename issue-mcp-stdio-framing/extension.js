var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// extension/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));

// src/host/fetch_url.ts
function toFetchableUrl(input, baseHref) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("URL is required");
  let href;
  try {
    href = baseHref ? new URL(trimmed, baseHref).href : new URL(trimmed).href;
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }
  const parsed = new URL(href);
  if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw")) {
      const [owner, repo, , ref, ...rest] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`;
    }
  }
  return href;
}
function assertHttpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be loaded");
  }
}
function filenameFromUrl(url) {
  const parsed = new URL(url);
  const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "download";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// src/host/file_picker.ts
function acceptToExtensions(accept) {
  if (!accept) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const part of accept.split(",")) {
    const token = part.trim().toLowerCase();
    if (!token.startsWith(".")) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
function acceptToVscodeFilters(accept) {
  const extensions = acceptToExtensions(accept).map((ext) => ext.slice(1));
  if (!extensions.length) return void 0;
  return { "Supported files": extensions };
}

// extension/extension.ts
var VIEW_TYPE = "intehrgrator.workbench";
var SAVES_KEY = "intehrgrator.saves";
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("intehrgrator.openWorkbench", async () => {
      const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        "intEHRgrator",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
        }
      );
      panel.webview.html = await webviewHtml(context, panel.webview);
      panel.webview.onDidReceiveMessage(
        (message) => void handleHostRequest(context, panel.webview, message),
        void 0,
        context.subscriptions
      );
    })
  );
}
function deactivate() {
}
async function handleHostRequest(context, webview, request) {
  if (request?.type !== "intehrgrator:host-request") return;
  try {
    const result = await dispatchHostCommand(context, request.command, request.payload ?? {});
    await webview.postMessage({
      type: "intehrgrator:host-response",
      id: request.id,
      result
    });
  } catch (error) {
    await webview.postMessage({
      type: "intehrgrator:host-response",
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
async function dispatchHostCommand(context, command, payload) {
  switch (command) {
    case "pickTextFile": {
      const uri = await pickFile(context, payload);
      if (!uri) return null;
      return {
        name: uri.path.split("/").pop() ?? "input",
        text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
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
        bytes: [...await vscode.workspace.fs.readFile(uri)]
      };
    }
    case "downloadText":
      await writeDownload(
        String(payload.filename ?? "output.txt"),
        new TextEncoder().encode(String(payload.content ?? ""))
      );
      return null;
    case "downloadBytes":
      await writeDownload(
        String(payload.filename ?? "output.bin"),
        Uint8Array.from(payload.bytes ?? [])
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
        savedAt: (/* @__PURE__ */ new Date()).toISOString(),
        bundle: payload.bundle
      });
      return null;
    case "saveManualSave": {
      const record = {
        storageKey: `manual:${crypto.randomUUID()}`,
        kind: "manual",
        displayName: String(payload.displayName ?? "Saved project"),
        savedAt: (/* @__PURE__ */ new Date()).toISOString(),
        bundle: payload.bundle
      };
      await putRecord(context, record);
      return null;
    }
    case "loadStoredProjectRecord":
      return records(context).find((record) => record.storageKey === payload.storageKey) ?? null;
    case "listLoadableProjects":
      return records(context).sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "autosave" ? -1 : 1;
        return right.savedAt.localeCompare(left.savedAt);
      }).slice(0, 6).map(({ storageKey, kind, displayName, savedAt }) => ({
        storageKey,
        kind,
        displayName,
        savedAt
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
async function pickFile(context, payload) {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const lastDir = lastPickerDirs(context)[kind];
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: lastDir ? vscode.Uri.parse(lastDir) : defaultSaveUri(""),
    filters: acceptToVscodeFilters(
      typeof payload.accept === "string" ? payload.accept : void 0
    )
  });
  const uri = picked?.[0] ?? null;
  if (uri && kind) await rememberPickerDir(context, kind, uri);
  return uri;
}
async function pickDirectoryTextFiles(context, payload) {
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const accept = typeof payload.accept === "string" ? payload.accept : ".json,.xml";
  const extensions = acceptToExtensions(accept).map((ext) => ext.slice(1));
  const lastDir = lastPickerDirs(context)[`${kind}-dir`];
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: lastDir ? vscode.Uri.parse(lastDir) : defaultSaveUri("")
  });
  const uri = picked?.[0] ?? null;
  if (!uri) return [];
  if (kind) await rememberPickerDir(context, `${kind}-dir`, uri);
  const out = [];
  await collectTextFilesFromDirectory(uri, extensions, out);
  return out;
}
async function collectTextFilesFromDirectory(dir, extensions, out) {
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
      text: new TextDecoder().decode(await vscode.workspace.fs.readFile(child))
    });
  }
}
var LAST_DIR_KEY = "intehrgrator.lastPickerDir";
function lastPickerDirs(context) {
  return context.workspaceState.get(LAST_DIR_KEY, {});
}
async function rememberPickerDir(context, kind, fileUri) {
  const dir = fileUri.with({ path: fileUri.path.replace(/\/[^/]+$/, "") || "/" });
  const dirs = { ...lastPickerDirs(context), [kind]: dir.toString() };
  await context.workspaceState.update(LAST_DIR_KEY, dirs);
}
async function writeDownload(filename, bytes) {
  const target = await vscode.window.showSaveDialog({ defaultUri: defaultSaveUri(filename) });
  if (target) await vscode.workspace.fs.writeFile(target, bytes);
}
function defaultSaveUri(filename) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder ? vscode.Uri.joinPath(folder, filename) : void 0;
}
function records(context) {
  return context.workspaceState.get(SAVES_KEY, []);
}
async function putRecord(context, record) {
  const next = records(context).filter((item) => item.storageKey !== record.storageKey);
  next.push(record);
  const autosaves = next.filter((item) => item.kind === "autosave");
  const manual = next.filter((item) => item.kind === "manual").sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, 5);
  await context.workspaceState.update(SAVES_KEY, [...autosaves, ...manual]);
}
async function webviewHtml(context, webview) {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  const htmlBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, "index.html"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "styles.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "bundle.js"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
    `img-src ${webview.cspSource} data:`,
    `script-src ${webview.cspSource}`
  ].join("; ");
  return new TextDecoder().decode(htmlBytes).replace("</head>", `<meta http-equiv="Content-Security-Policy" content="${csp}"></head>`).replace('href="styles.css"', `href="${styleUri}"`).replace('src="./bundle.js"', `src="${scriptUri}"`);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
