/**
 * ehrtslib is loaded from the jsDelivr URL pinned in deno.json (`ehrtslib/`).
 * Terminology XML is fetched from that same prefix; the web build inlines it.
 */
// Imported (not read from disk) so a compiled desktop binary carries it: the
// binary has no deno.json next to this file, and reading it crashed the app at start.
import denoConfig from "../../deno.json" with { type: "json" };

export function ehrtslibCdnPrefix(): string {
  const prefix = (denoConfig as { imports?: Record<string, string> }).imports?.["ehrtslib/"];
  if (typeof prefix !== "string" || !prefix.startsWith("https://")) {
    throw new Error(
      `deno.json imports["ehrtslib/"] must be the jsDelivr release prefix, got ${String(prefix)}`,
    );
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export async function fetchEhrtslibText(relativePath: string): Promise<string> {
  const url = new URL(relativePath, ehrtslibCdnPrefix());
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url.href} failed (${res.status})`);
  }
  return await res.text();
}

export async function fetchEhrtslibTerminologyXml(): Promise<{ en: string; ext: string }> {
  const [en, ext] = await Promise.all([
    fetchEhrtslibText("terminology_data/openehr_terminology_en.xml"),
    fetchEhrtslibText("terminology_data/openehr_external_terminologies.xml"),
  ]);
  return { en, ext };
}
