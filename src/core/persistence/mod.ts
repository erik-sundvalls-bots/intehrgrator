import { compressSync, decompressSync, strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import type { ProjectBundle } from "../../types/mod.ts";

export const APP_VERSION = "0.11.0";
export const BUNDLE_VERSION = 1;
export const AUTOSAVE_STORAGE_KEY = "__autosave__";
export const MANUAL_SAVE_KEY_PREFIX = "manual:";
export const MAX_MANUAL_SAVES = 5;

export interface StoredProjectRecord {
  storageKey: string;
  kind: "autosave" | "manual";
  displayName: string;
  savedAt: string;
  bundle: ProjectBundle;
}

export interface LoadableProjectEntry {
  storageKey: string;
  kind: "autosave" | "manual";
  displayName: string;
  savedAt: string;
}

export function exportBundle(bundle: ProjectBundle): Uint8Array {
  const json = JSON.stringify(bundle, null, 2);
  const zipped = zipSync({ "project.json": strToU8(json) });
  return zipped;
}

export function importBundle(bytes: Uint8Array): ProjectBundle {
  const files = unzipSync(bytes);
  const projectBytes = files["project.json"];
  if (!projectBytes) throw new Error("Invalid .intehrgrator bundle: missing project.json");
  const bundle = JSON.parse(strFromU8(projectBytes)) as ProjectBundle;
  validateBundle(bundle);
  return bundle;
}

export function validateBundle(bundle: ProjectBundle): void {
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${bundle.version}`);
  }
  if (!bundle.mapping?.model) {
    throw new Error("Bundle missing mapping model");
  }
}

export function formatSaveTime(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function bundleFilename(projectId: string): string {
  return `${projectId}.intehrgrator`;
}

export function encodeBundleBase64(bundle: ProjectBundle): string {
  const zipped = exportBundle(bundle);
  let binary = "";
  for (const b of zipped) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBundleBase64(encoded: string): ProjectBundle {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return importBundle(bytes);
}

export function compressProjectJson(bundle: ProjectBundle): Uint8Array {
  return compressSync(strToU8(JSON.stringify(bundle)));
}

export function decompressProjectJson(bytes: Uint8Array): ProjectBundle {
  return JSON.parse(strFromU8(decompressSync(bytes))) as ProjectBundle;
}
