/**
 * Lazy-load conversion-script language plugins in a Deno worker sandbox.
 *
 * A manifest URL is registered at startup (`--language-plugin` or
 * `INTEHR_LANGUAGE_PLUGINS`). The module is imported the first time something
 * generates that language. Remote modules get `net` to their hosts only.
 * Local `file:` modules get `read` of their directory only.
 */
import { dirname, fromFileUrl, resolve, toFileUrl } from "@std/path";
import {
  registerDesktopPluginLanguage,
  type DesktopPluginListing,
  type ExternalScriptResult,
} from "../core/codegen/language_plugin.ts";

export interface LanguagePluginManifest {
  id: string;
  label: string;
  extension: string;
  mime?: string;
  /** Module URL or path relative to the manifest. Must export `plugin`. */
  module: string;
  runnable?: boolean;
  /** Extra network hosts the module may contact (for example `jsr.io`). */
  netHosts?: string[];
}

interface LoadedPlugin extends DesktopPluginListing {
  manifestUrl: string;
  moduleUrl: string;
  worker: Worker;
  nextId: number;
  pending: Map<number, { resolve: (code: string) => void; reject: (err: Error) => void }>;
}

const configured: string[] = [];
const loaded = new Map<string, LoadedPlugin>();
const loading = new Map<string, Promise<LoadedPlugin>>();

/**
 * Turn a `--language-plugin` value into a manifest URL. `http:`, `https:` and
 * `file:` URLs pass through; anything else is a local path, resolved against
 * the working directory, so `examples/language-plugins/echo/manifest.json`
 * works from the repository root.
 */
export function normalizeManifestUrl(value: string, cwd = Deno.cwd()): string {
  const trimmed = value.trim();
  if (/^(https?|file):/i.test(trimmed)) return trimmed;
  return toFileUrl(resolve(cwd, trimmed)).href;
}

export function configureLanguagePlugins(manifestUrls: readonly string[]): void {
  configured.length = 0;
  for (const url of manifestUrls) {
    if (!url.trim()) continue;
    const normalized = normalizeManifestUrl(url);
    if (!configured.includes(normalized)) configured.push(normalized);
  }
}

export function configuredLanguagePluginUrls(): readonly string[] {
  return configured;
}

export async function listLanguagePlugins(): Promise<DesktopPluginListing[]> {
  const listings: DesktopPluginListing[] = [];
  for (const url of configured) {
    try {
      const manifest = await readManifest(url);
      const listing: DesktopPluginListing = {
        id: manifest.id,
        label: manifest.label,
        extension: manifest.extension,
        mime: manifest.mime || "text/plain",
        runnable: Boolean(manifest.runnable),
      };
      registerDesktopPluginLanguage(listing);
      listings.push(listing);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      listings.push({
        id: `plugin-error-${listings.length + 1}`,
        label: `Plugin failed (${url}): ${message}`,
        extension: "txt",
        mime: "text/plain",
        runnable: false,
      });
    }
  }
  return listings;
}

export async function generateWithLanguagePlugin(
  language: string,
  model: unknown,
  options: unknown,
): Promise<ExternalScriptResult> {
  const plugin = await pluginById(language);
  const code = await requestGenerate(plugin, model, options);
  return {
    code,
    extension: plugin.extension,
    mime: plugin.mime,
    label: plugin.label,
  };
}

async function pluginById(language: string): Promise<LoadedPlugin> {
  const existing = loaded.get(language);
  if (existing) return existing;
  for (const url of configured) {
    const plugin = await ensureLanguagePlugin(url);
    if (plugin.id === language) return plugin;
  }
  throw new Error(`No conversion script plugin is configured for "${language}"`);
}

async function ensureLanguagePlugin(manifestUrl: string): Promise<LoadedPlugin> {
  const pending = loading.get(manifestUrl);
  if (pending) return pending;
  const job = loadLanguagePlugin(manifestUrl);
  loading.set(manifestUrl, job);
  try {
    const plugin = await job;
    loaded.set(plugin.id, plugin);
    registerDesktopPluginLanguage(plugin);
    return plugin;
  } finally {
    loading.delete(manifestUrl);
  }
}

async function loadLanguagePlugin(manifestUrl: string): Promise<LoadedPlugin> {
  const manifest = await readManifest(manifestUrl);
  const moduleUrl = new URL(manifest.module, manifestUrl).href;
  assertModuleAllowed(manifestUrl, moduleUrl);
  const worker = new Worker(new URL("./language_plugin_worker.ts", import.meta.url).href, {
    type: "module",
    deno: { permissions: workerPermissions(manifestUrl, moduleUrl, manifest.netHosts ?? []) },
  });
  const plugin = await waitForReady(worker, manifestUrl, moduleUrl, manifest);
  wireWorker(plugin);
  return plugin;
}

function assertModuleAllowed(manifestUrl: string, moduleUrl: string): void {
  const manifest = new URL(manifestUrl);
  const module = new URL(moduleUrl);
  if (manifest.protocol === "file:") {
    if (module.protocol !== "file:") {
      throw new Error("A file: manifest may only load a file: module");
    }
    const root = dirname(fromFileUrl(manifest));
    const modulePath = fromFileUrl(module);
    if (!modulePath.startsWith(root)) {
      throw new Error("Plugin module must stay inside the manifest directory");
    }
    return;
  }
  if (module.protocol !== "https:" && module.protocol !== "http:") {
    throw new Error("A remote manifest may only load an http(s) module");
  }
}

function workerPermissions(
  manifestUrl: string,
  moduleUrl: string,
  netHosts: string[],
): { read?: string[]; net?: string[] } {
  const module = new URL(moduleUrl);
  if (module.protocol === "file:") {
    const perms: { read: string[]; net?: string[] } = { read: [dirname(fromFileUrl(module))] };
    if (netHosts.length) perms.net = netHosts;
    return perms;
  }
  const hosts = new Set<string>([module.hostname, new URL(manifestUrl).hostname, ...netHosts]);
  return { net: [...hosts] };
}

async function readManifest(manifestUrl: string): Promise<LanguagePluginManifest> {
  const url = new URL(manifestUrl);
  let text: string;
  if (url.protocol === "file:") {
    text = await Deno.readTextFile(url);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Plugin manifest ${manifestUrl} returned ${res.status}`);
    text = await res.text();
  }
  if (text.length > 64_000) throw new Error("Plugin manifest is larger than 64 KB");
  const parsed = JSON.parse(text) as LanguagePluginManifest;
  if (!parsed || typeof parsed.module !== "string" || typeof parsed.id !== "string") {
    throw new Error("Plugin manifest needs id, label, extension, and module");
  }
  if (!parsed.label || !parsed.extension) {
    throw new Error("Plugin manifest needs label and extension");
  }
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(parsed.id) || parsed.id === "preview") {
    throw new Error(`Plugin id "${parsed.id}" must be a short lowercase slug`);
  }
  return parsed;
}

function waitForReady(
  worker: Worker,
  manifestUrl: string,
  moduleUrl: string,
  manifest: LanguagePluginManifest,
): Promise<LoadedPlugin> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Plugin ${manifest.id} did not load within 15s`));
    }, 15_000);
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; message?: string; id?: string; label?: string; extension?: string; mime?: string; runnable?: boolean };
      if (msg.type === "error") {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(msg.message || "Plugin failed to load"));
        return;
      }
      if (msg.type !== "ready") return;
      clearTimeout(timer);
      if (msg.id !== manifest.id) {
        worker.terminate();
        reject(new Error(`Plugin module id "${msg.id}" does not match manifest id "${manifest.id}"`));
        return;
      }
      resolve({
        id: msg.id,
        label: msg.label || manifest.label,
        extension: msg.extension || manifest.extension,
        mime: msg.mime || manifest.mime || "text/plain",
        runnable: Boolean(msg.runnable),
        manifestUrl,
        moduleUrl,
        worker,
        nextId: 1,
        pending: new Map(),
      });
    };
    worker.onerror = (ev) => {
      clearTimeout(timer);
      reject(new Error(ev.message || "Plugin worker error"));
    };
    worker.postMessage({ type: "load", moduleUrl });
  });
}

function wireWorker(plugin: LoadedPlugin): void {
  plugin.worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as { type?: string; requestId?: number; code?: string; message?: string };
    if (msg.requestId == null) return;
    const pending = plugin.pending.get(msg.requestId);
    if (!pending) return;
    plugin.pending.delete(msg.requestId);
    if (msg.type === "script") pending.resolve(msg.code ?? "");
    else pending.reject(new Error(msg.message || "Plugin generate failed"));
  };
}

function requestGenerate(plugin: LoadedPlugin, model: unknown, options: unknown): Promise<string> {
  const requestId = plugin.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      plugin.pending.delete(requestId);
      reject(new Error(`Plugin ${plugin.id} generate timed out`));
    }, 15_000);
    plugin.pending.set(requestId, {
      resolve: (code) => {
        clearTimeout(timer);
        resolve(code);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    plugin.worker.postMessage({ type: "generate", requestId, model, options });
  });
}
