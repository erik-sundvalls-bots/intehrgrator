/**
 * Turn an import specifier or a URL in a generated script into a page a
 * person can open. Used by the CodeMirror viewer (click the import).
 */
import {
  EHRTSLIB_BLOB_PREFIX,
  HELPERS_GITHUB_REF,
  HELPERS_GITHUB_REPO,
  JAVA_CODED_TEXT_BLOB,
  JAVA_HANDLEBARS_BLOB,
  JAVA_RUNTIME_BLOB,
} from "./helpers/locations.ts";

const PACKAGE_BLOBS: Record<string, string> = {
  fontoxpath: "https://github.com/FontoXML/fontoxpath",
  handlebars: "https://github.com/handlebars-lang/handlebars.js",
  slimdom: "https://github.com/bwrrp/slimdom.js",
};

export function resolveImportHref(specifier: string): string | undefined {
  const spec = specifier.trim();
  if (!spec) return undefined;
  if (spec.startsWith("https://github.com/") || spec.startsWith("http://github.com/")) {
    return spec;
  }
  const raw = spec.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
  );
  if (raw) {
    return `https://github.com/${raw[1]}/${raw[2]}/blob/${raw[3]}/${raw[4]}`;
  }
  const cdn = spec.match(
    /^https?:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@/]+)@([^/]+)\/(.+)$/,
  );
  if (cdn) {
    return `https://github.com/${cdn[1]}/${cdn[2]}/blob/${cdn[3]}/${cdn[4]}`;
  }
  if (spec.startsWith("https://") || spec.startsWith("http://")) return spec;
  if (spec.startsWith("ehrtslib/")) {
    return `${EHRTSLIB_BLOB_PREFIX}${spec.slice("ehrtslib/".length)}`;
  }
  if (spec in PACKAGE_BLOBS) return PACKAGE_BLOBS[spec];
  if (spec.startsWith("se.regionstockholm.intehrgrator.runtime.HandlebarsSupport")) {
    return JAVA_HANDLEBARS_BLOB;
  }
  if (spec.startsWith("se.regionstockholm.intehrgrator.runtime.CodedTextSupport")) {
    return JAVA_CODED_TEXT_BLOB;
  }
  if (spec.startsWith("se.regionstockholm.intehrgrator.runtime.")) {
    return JAVA_RUNTIME_BLOB;
  }
  if (spec.startsWith("com.nedap.archie.")) {
    return "https://github.com/openEHR/archie";
  }
  if (spec.startsWith("com.fasterxml.jackson.")) {
    return "https://github.com/FasterXML/jackson-databind";
  }
  if (spec.startsWith("com.github.jknack.handlebars")) {
    return "https://github.com/jknack/handlebars.java";
  }
  if (spec.startsWith(`${HELPERS_GITHUB_REPO}/`) || spec.includes(HELPERS_GITHUB_REF)) {
    return undefined;
  }
  return undefined;
}

export interface ImportLinkSpan {
  from: number;
  to: number;
  href: string;
}

/** Spans inside `source` that should look like links in the script editor. */
export function importLinkSpans(source: string): ImportLinkSpan[] {
  const spans: ImportLinkSpan[] = [];
  const seen = new Set<string>();
  const push = (from: number, to: number, href: string | undefined) => {
    if (!href) return;
    const key = `${from}:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push({ from, to, href });
  };

  const quoted = /(?:from|at)\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(quoted)) {
    const spec = match[1] ?? "";
    const start = match.index! + match[0].lastIndexOf(spec);
    push(start, start + spec.length, resolveImportHref(spec));
  }

  const javaImport = /^import\s+(?:static\s+)?([\w.]+)(?:\.\w+)?\s*;/gm;
  for (const match of source.matchAll(javaImport)) {
    const spec = match[1] ?? "";
    const start = match.index! + match[0].indexOf(spec);
    push(start, start + spec.length, resolveImportHref(spec));
  }

  const url = /https?:\/\/[^\s"'<>)]+/g;
  for (const match of source.matchAll(url)) {
    const spec = match[0];
    push(match.index!, match.index! + spec.length, resolveImportHref(spec));
  }
  return spans;
}
