import type { ProjectBundle } from "../types/mod.ts";
import type {
  LoadableProjectEntry,
  StoredProjectRecord,
} from "../core/persistence/mod.ts";
import type { FilePickerKind } from "./file_picker.ts";

export interface PickedTextFile {
  name: string;
  text: string;
}

export interface PickedBinaryFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Host Abstraction shared by the web app and VS Code/Cursor webview.
 * No DOM File, IndexedDB, or editor API types cross this seam.
 */
export interface HostAdapter {
  pickTextFile(accept?: string, kind?: FilePickerKind): Promise<PickedTextFile | null>;
  /** Recursively pick JSON/XML instance files from a local folder. */
  pickTextFilesFromDirectory(
    accept?: string,
    kind?: FilePickerKind,
  ): Promise<PickedTextFile[] | null>;
  pickBinaryFile(accept?: string, kind?: FilePickerKind): Promise<PickedBinaryFile | null>;
  downloadText(filename: string, content: string, mime?: string): void | Promise<void>;
  downloadBytes(filename: string, bytes: Uint8Array, mime?: string): void | Promise<void>;
  copyToClipboard(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  saveAutosave(bundle: ProjectBundle): Promise<void>;
  saveManualSave(bundle: ProjectBundle, displayName: string): Promise<void>;
  loadStoredProjectRecord(storageKey: string): Promise<StoredProjectRecord | null>;
  listLoadableProjects(): Promise<LoadableProjectEntry[]>;
  /** Resolve an app-relative documentation URL in the current host. */
  resolveAppUrl(path: string): string;
  /** Fetch a remote text file (schema, example, or target). GitHub blob URLs are rewritten to raw. */
  fetchTextUrl(url: string): Promise<PickedTextFile>;
  /**
   * Desktop-only: ask the local server to run a conversion-script plugin.
   * Absent on GitHub Pages.
   */
  generateConversionScript?(
    language: string,
    request: {
      model: unknown;
      options: unknown;
    },
  ): Promise<{ code: string; extension: string; mime: string }>;
}

export { createHostAdapter } from "./create_host.ts";
export { WebHostAdapter } from "./web_adapter.ts";
export { FsHostAdapter, createFsHostAdapter } from "./fs_adapter.ts";
export { VsCodeWebviewHostAdapter } from "./vscode_webview_adapter.ts";
export {
  assertHttpUrl,
  filenameFromUrl,
  toFetchableUrl,
} from "./fetch_url.ts";
export {
  forgetUrl,
  listUrlHistory,
  rememberUrl,
  replaceUrlHistory,
  restoreUrlHistory,
  snapshotUrlHistory,
  type UrlHistoryKind,
  type UrlHistorySnapshot,
} from "./url_history.ts";
export {
  acceptToExtensions,
  filePickerId,
  type FilePickerKind,
} from "./file_picker.ts";
