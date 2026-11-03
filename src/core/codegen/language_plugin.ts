/**
 * Conversion script language seam.
 *
 * Built-in languages (TypeScript, Java, Handlebars, XQuery, Go Template)
 * implement {@link ConversionScriptLanguagePlugin} through the export-target
 * adapters in `mod.ts`. A desktop app can lazy-load another language from a
 * manifest URL; that module runs in a Deno worker sandbox
 * (`src/desktop/language_plugins.ts`). The browser only learns the id, label,
 * and file extension, then asks the desktop to generate.
 */
import type { ExportGenerationOptions } from "./mod.ts";
import type { MappingModel } from "../../types/mod.ts";

export interface ConversionScriptLanguagePlugin {
  /** Stable id used as Output mode (`exportTarget`). Not `preview`. */
  readonly id: string;
  readonly label: string;
  readonly extension: string;
  readonly mime: string;
  /** True when Conversion Test Run can execute the script inside the workbench. */
  readonly runnable: boolean;
  generate(
    model: MappingModel,
    options?: ExportGenerationOptions,
  ): string | Promise<string>;
}

export interface DesktopPluginListing {
  id: string;
  label: string;
  extension: string;
  mime: string;
  runnable: boolean;
}

const desktopPlugins = new Map<string, DesktopPluginListing>();

export function registerDesktopPluginLanguage(plugin: DesktopPluginListing): void {
  desktopPlugins.set(plugin.id, plugin);
}

export function clearDesktopPluginLanguages(): void {
  desktopPlugins.clear();
}

export function isDesktopPluginLanguage(id: string): boolean {
  return desktopPlugins.has(id);
}

export function desktopPluginLanguage(id: string): DesktopPluginListing | undefined {
  return desktopPlugins.get(id);
}

export function listDesktopPluginLanguages(): DesktopPluginListing[] {
  return [...desktopPlugins.values()];
}

export interface ExternalScriptResult {
  code: string;
  extension: string;
  mime: string;
  label: string;
}

export type ExternalLanguageGenerator = (
  language: string,
  model: unknown,
  options: unknown,
) => Promise<ExternalScriptResult>;

let externalGenerate: ExternalLanguageGenerator | null = null;

/** Desktop process registers this. The web bundle leaves it unset until plugins load. */
export function setExternalLanguageGenerator(fn: ExternalLanguageGenerator | null): void {
  externalGenerate = fn;
}

export function externalLanguageGenerator(): ExternalLanguageGenerator | null {
  return externalGenerate;
}
