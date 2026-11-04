import type { ProjectBundle } from "@intehrgrator/types/mod.ts";
import type { FilePickerKind, HostAdapter, PickedBinaryFile, PickedTextFile } from "./mod.ts";
import type { LoadableProjectEntry, StoredProjectRecord } from "@intehrgrator/core/persistence/mod.ts";
import { assertHttpUrl, filenameFromUrl, toFetchableUrl } from "./fetch_url.ts";
import { acceptToExtensions, acceptToPickerTypes, filePickerId } from "./file_picker.ts";
import {
  listLoadableProjects,
  loadStoredProjectRecord,
  saveAutosave,
  saveManualSave,
} from "./web_storage.ts";

export class WebHostAdapter implements HostAdapter {
  async pickTextFile(accept?: string, kind?: FilePickerKind): Promise<PickedTextFile | null> {
    const file = await this.pickDomFile(accept, kind);
    return file ? { name: file.name, text: await file.text() } : null;
  }

  async pickTextFilesFromDirectory(
    accept = ".json,.xml",
    kind?: FilePickerKind,
  ): Promise<PickedTextFile[] | null> {
    const fromFsAccess = await this.pickDirectoryWithFileSystemAccess(accept, kind);
    if (fromFsAccess !== undefined) return fromFsAccess;
    return await this.pickDirectoryWithInputElement(accept);
  }

  async pickBinaryFile(accept?: string, kind?: FilePickerKind): Promise<PickedBinaryFile | null> {
    const file = await this.pickDomFile(accept, kind);
    return file
      ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
      : null;
  }

  private async pickDomFile(accept?: string, kind?: FilePickerKind): Promise<File | null> {
    const fromFsAccess = await this.pickWithFileSystemAccess(accept, kind);
    if (fromFsAccess !== undefined) return fromFsAccess;
    return await this.pickWithInputElement(accept);
  }

  /**
   * Chromium File System Access API remembers the last folder per `id`.
   * Returns undefined when the API is unavailable so the input fallback can run.
   */
  private async pickWithFileSystemAccess(
    accept?: string,
    kind?: FilePickerKind,
  ): Promise<File | null | undefined> {
    const showOpenFilePicker = (
      globalThis as typeof globalThis & {
        showOpenFilePicker?: (options: {
          multiple?: boolean;
          id?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle[]>;
      }
    ).showOpenFilePicker;
    if (typeof showOpenFilePicker !== "function") return undefined;

    try {
      const [handle] = await showOpenFilePicker({
        multiple: false,
        id: filePickerId(kind),
        types: acceptToPickerTypes(accept),
      });
      return handle ? await handle.getFile() : null;
    } catch (err) {
      if (isAbortError(err)) return null;
      // Windows IFileDialog can reject unusual MIME groupings; fall back to <input>.
      return undefined;
    }
  }

  private async pickDirectoryWithFileSystemAccess(
    accept: string,
    kind?: FilePickerKind,
  ): Promise<PickedTextFile[] | null | undefined> {
    const showDirectoryPicker = (
      globalThis as typeof globalThis & {
        showDirectoryPicker?: (options?: {
          id?: string;
          mode?: "read";
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (typeof showDirectoryPicker !== "function") return undefined;

    const extensions = acceptToExtensions(accept);
    const matchesAccept = (name: string) =>
      !extensions.length || extensions.some((ext) => name.toLowerCase().endsWith(ext));

    try {
      const dir = await showDirectoryPicker({
        id: kind ? `${filePickerId(kind)}-dir` : undefined,
        mode: "read",
      });
      return await collectDirectoryTextFiles(dir, matchesAccept);
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
  }

  private async pickDirectoryWithInputElement(accept: string): Promise<PickedTextFile[] | null> {
    const extensions = acceptToExtensions(accept);
    const matchesAccept = (name: string) =>
      !extensions.length || extensions.some((ext) => name.toLowerCase().endsWith(ext));

    return await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.webkitdirectory = true;
      input.style.position = "fixed";
      input.style.left = "-9999px";

      let settled = false;
      const finish = async (files: FileList | null) => {
        if (settled) return;
        settled = true;
        input.remove();
        if (!files?.length) {
          resolve(null);
          return;
        }
        const out: PickedTextFile[] = [];
        for (const file of files) {
          const name = file.webkitRelativePath || file.name;
          if (!matchesAccept(name)) continue;
          out.push({ name: name.split("/").pop() ?? name, text: await file.text() });
        }
        resolve(out.length ? out : null);
      };

      input.addEventListener("change", () => void finish(input.files));
      input.addEventListener("cancel", () => void finish(null));

      document.body.appendChild(input);
      input.click();

      globalThis.addEventListener("focus", function onWindowFocus() {
        setTimeout(() => {
          globalThis.removeEventListener("focus", onWindowFocus);
          if (!settled && !input.files?.length) void finish(null);
        }, 400);
      }, { once: true });
    });
  }

  private async pickWithInputElement(accept?: string): Promise<File | null> {
    return await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      if (accept) input.accept = accept;

      let settled = false;
      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file);
      };

      input.addEventListener("change", () => finish(input.files?.[0] ?? null));
      input.addEventListener("cancel", () => finish(null));

      document.body.appendChild(input);
      input.click();

      // Browsers without `cancel` on <input type="file"> — resolve when dialog closes with no selection.
      globalThis.addEventListener("focus", function onWindowFocus() {
        setTimeout(() => {
          globalThis.removeEventListener("focus", onWindowFocus);
          if (!settled && !input.files?.length) finish(null);
        }, 400);
      }, { once: true });
    });
  }

  async generateConversionScript(
    language: string,
    request: { model: unknown; options: unknown },
  ): Promise<{ code: string; extension: string; mime: string }> {
    const token = (globalThis as unknown as { __INTEHR_AGENT_TOKEN__?: string }).__INTEHR_AGENT_TOKEN__;
    const res = await fetch("/api/v1/language-plugins/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ language, model: request.model, options: request.options }),
    });
    const body = await res.json().catch(() => ({})) as {
      code?: string;
      extension?: string;
      mime?: string;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error || `Plugin generate failed (${res.status})`);
    return {
      code: body.code ?? "",
      extension: body.extension ?? "txt",
      mime: body.mime ?? "text/plain",
    };
  }

  downloadText(filename: string, content: string, mime = "text/plain"): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadBytes(filename: string, bytes: Uint8Array, mime = "application/octet-stream"): void {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async readClipboard(): Promise<string> {
    return await navigator.clipboard.readText();
  }

  async saveAutosave(bundle: ProjectBundle): Promise<void> {
    await saveAutosave(bundle);
  }

  async saveManualSave(bundle: ProjectBundle, displayName: string): Promise<void> {
    await saveManualSave(bundle, displayName);
  }

  async loadStoredProjectRecord(storageKey: string): Promise<StoredProjectRecord | null> {
    return await loadStoredProjectRecord(storageKey);
  }

  async listLoadableProjects(): Promise<LoadableProjectEntry[]> {
    return await listLoadableProjects();
  }

  resolveAppUrl(path: string): string {
    return new URL(path, location.href).href;
  }

  async fetchTextUrl(url: string): Promise<PickedTextFile> {
    const fetchable = toFetchableUrl(url, location.href);
    assertHttpUrl(fetchable);
    const response = await fetch(fetchable, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${fetchable} (${response.status} ${response.statusText})`);
    }
    return { name: filenameFromUrl(fetchable), text: await response.text() };
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function collectDirectoryTextFiles(
  dir: FileSystemDirectoryHandle,
  matchesAccept: (name: string) => boolean,
  prefix = "",
): Promise<PickedTextFile[]> {
  const out: PickedTextFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      if (!matchesAccept(name)) continue;
      const file = await handle.getFile();
      out.push({ name, text: await file.text() });
    } else if (handle.kind === "directory") {
      out.push(...await collectDirectoryTextFiles(handle, matchesAccept, path));
    }
  }
  return out;
}
