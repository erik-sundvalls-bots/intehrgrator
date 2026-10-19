/**
 * **Stored prompts** for the AI chat: read-only built-ins plus user prompts in
 * browser localStorage (never in the Project Bundle).
 */

export const STORED_PROMPTS_STORAGE_KEY = "intehrgrator.ai.storedPrompts";
export const STORED_PROMPTS_FORMAT = "intehrgrator-stored-prompts";

export interface StoredPrompt {
  id: string;
  name: string;
  text: string;
  /** Built-ins are read-only and cannot be removed. */
  builtIn?: boolean;
  /**
   * Built-ins whose text is resolved at use time from the workbench:
   * `project` = full project prompt (the Copy prompt text).
   */
  dynamic?: "project";
}

export const FOR_EACH_PROMPT_TEXT =
  'Help me create a loop over the following source node {source_node} with a suitable "for each" block surrounding the following target node: {target_node}';

export const BUILT_IN_PROMPTS: readonly StoredPrompt[] = [
  {
    id: "builtin:map-project",
    name: "Map the whole project",
    text: "Map as many target slots as possible using the full project context attached below.",
    builtIn: true,
    dynamic: "project",
  },
  {
    id: "builtin:for-each",
    name: "Loop with a for each block",
    text: FOR_EACH_PROMPT_TEXT,
    builtIn: true,
  },
];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sanitize(raw: unknown): { name: string; text: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const text = typeof row.text === "string" ? row.text : "";
  if (!name || !text.trim()) return null;
  return { name, text };
}

export function loadUserPrompts(storage: StorageLike): StoredPrompt[] {
  try {
    const raw = storage.getItem(STORED_PROMPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredPrompt[] = [];
    for (const row of parsed) {
      const clean = sanitize(row);
      if (!clean) continue;
      const id = typeof row.id === "string" && row.id && !row.id.startsWith("builtin:")
        ? row.id
        : newPromptId(out);
      out.push({ id, ...clean });
    }
    return out;
  } catch {
    return [];
  }
}

function saveUserPrompts(storage: StorageLike, prompts: StoredPrompt[]): void {
  storage.setItem(
    STORED_PROMPTS_STORAGE_KEY,
    JSON.stringify(prompts.map(({ id, name, text }) => ({ id, name, text }))),
  );
}

function newPromptId(existing: StoredPrompt[]): string {
  let n = existing.length + 1;
  const ids = new Set(existing.map((p) => p.id));
  while (ids.has(`user:${n}`)) n++;
  return `user:${n}`;
}

/** Built-ins first, then user prompts. */
export function listStoredPrompts(storage: StorageLike): StoredPrompt[] {
  return [...BUILT_IN_PROMPTS, ...loadUserPrompts(storage)];
}

/** Add prompts; an existing user prompt with the same name is replaced. */
export function addUserPrompts(
  storage: StorageLike,
  prompts: Array<{ name: string; text: string }>,
): StoredPrompt[] {
  const current = loadUserPrompts(storage);
  const added: StoredPrompt[] = [];
  for (const raw of prompts) {
    const clean = sanitize(raw);
    if (!clean) continue;
    const existing = current.find((p) => p.name === clean.name);
    if (existing) {
      existing.text = clean.text;
      added.push(existing);
    } else {
      const prompt = { id: newPromptId(current), ...clean };
      current.push(prompt);
      added.push(prompt);
    }
  }
  saveUserPrompts(storage, current);
  return added;
}

/** Remove a user prompt. Built-ins are never removed. */
export function removeUserPrompt(storage: StorageLike, id: string): boolean {
  if (id.startsWith("builtin:")) return false;
  const current = loadUserPrompts(storage);
  const next = current.filter((p) => p.id !== id);
  if (next.length === current.length) return false;
  saveUserPrompts(storage, next);
  return true;
}

function baseName(filename: string): string {
  const leaf = filename.split(/[\\/]/).pop() ?? filename;
  const noQuery = leaf.split(/[?#]/)[0] || leaf;
  return decodeURIComponent(noQuery).replace(/\.[^.]+$/, "") || "Prompt";
}

/**
 * Parse a prompt file: `.json` holds a list of `{name, text}` (or
 * `{format, prompts: [...]}` as written by export); anything else is one
 * prompt named after the file.
 */
export function parsePromptFile(filename: string, content: string): Array<{ name: string; text: string }> {
  const trimmed = content.trim();
  const looksJson = /\.json(?:$|[?#])/i.test(filename) || /^[[{]/.test(trimmed);
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      if (/\.json(?:$|[?#])/i.test(filename)) {
        throw new Error(`Invalid prompts JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === "object" && Array.isArray((parsed as { prompts?: unknown }).prompts))
        ? (parsed as { prompts: unknown[] }).prompts
        : [parsed];
      const prompts = list.map(sanitize).filter((p): p is { name: string; text: string } => Boolean(p));
      if (!prompts.length) throw new Error("No prompts found; expected a list of {name, text}.");
      return prompts;
    }
  }
  if (!trimmed) throw new Error("Prompt file is empty.");
  return [{ name: baseName(filename), text: trimmed }];
}

export function exportUserPrompts(storage: StorageLike): string {
  return JSON.stringify(
    {
      format: STORED_PROMPTS_FORMAT,
      version: 1,
      prompts: loadUserPrompts(storage).map(({ name, text }) => ({ name, text })),
    },
    null,
    2,
  );
}
