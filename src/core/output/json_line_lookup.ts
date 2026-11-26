/**
 * JSON source line lookup for validation and deserialization messages.
 * Uses ehrtslib's JSON Pointer source index with regex fallbacks for partial JSON.
 */

import {
  buildJsonSourceIndex,
  rmPathToJsonPointer,
} from "ehrtslib/serialization/common/json_source_index.ts";

/** Map an RM/instance path (`/content[0]/data/...`) to a line in pretty-printed JSON. */
export function lineNumberForRmPath(json: string, rmPath: string): number | undefined {
  try {
    const index = buildJsonSourceIndex(json);
    const pointer = rmPathToJsonPointer(rmPath);
    const exact = index.get(pointer);
    if (exact) return exact.sourceLine;
    const parts = pointer.split("/").filter(Boolean);
    for (let len = parts.length - 1; len >= 1; len--) {
      const anc = index.get(`/${parts.slice(0, len).join("/")}`);
      if (anc) return anc.sourceLine;
    }
  } catch {
    // Fall back to regex lookup when JSON text is malformed
  }
  const segments = rmPath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\[\d+\]/g, ""));
  const leaf = segments.at(-1);
  if (!leaf) return undefined;
  return lineNumberForJsonKey(json, leaf);
}

/** Last occurrence of a JSON object key (handles repeated RM attribute names). */
function lineNumberForJsonKey(json: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"${escaped}"\\s*:`, "g");
  let lastIndex = -1;
  for (const match of json.matchAll(pattern)) {
    lastIndex = match.index ?? -1;
  }
  if (lastIndex < 0) return undefined;
  return json.slice(0, lastIndex + 1).split("\n").length;
}

/** Infer a JSON line from nested ehrtslib deserialization error text. */
export function lineNumberForDeserializeError(
  json: string,
  message: string,
): number | undefined {
  const properties = [...message.matchAll(/property '([^']+)' of ([A-Z0-9_]+)/g)];
  const last = properties.at(-1)?.[1];
  if (last) {
    return lineNumberForJsonKey(json, last);
  }
  const typeMatch = message.match(/Type not found in registry: ([A-Z0-9_]+)/);
  if (typeMatch) {
    return lineNumberForJsonKey(json, "_type") ??
      lineNumberInJsonAfter(json, `"_type": "${typeMatch[1]}"`);
  }
  return undefined;
}

function lineNumberInJsonAfter(json: string, needle: string): number | undefined {
  const index = json.indexOf(needle);
  if (index < 0) return undefined;
  return json.slice(0, index + 1).split("\n").length;
}
