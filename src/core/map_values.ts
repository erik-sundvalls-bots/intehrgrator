/** Generic Map-value operations shared by preview and downloadable TypeScript. */
export function mapValueGet(value: unknown, key: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = String(key ?? "");
  return Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name] ?? null
    : null;
}

export function mapEntries(value: unknown): unknown[][] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}
