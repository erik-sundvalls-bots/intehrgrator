/**
 * Containment for files a file project writes or removes (#305 review).
 * `projectPath()` is lexical; this follows symlinks so a symlinked output folder
 * or file cannot send generated files outside the project root.
 */
export interface RealPathFs {
  /** Canonical path with symlinks resolved, or null when nothing exists at `path`. */
  realPath(path: string): Promise<string | null>;
  /** True when `path` itself is a symlink (including a dangling one). */
  isSymlink(path: string): Promise<boolean>;
  join(...parts: string[]): string;
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function inside(root: string, path: string): boolean {
  const r = normalize(root);
  const p = normalize(path);
  const windows = /^[a-z]:/i.test(r);
  const [a, b] = windows ? [r.toLowerCase(), p.toLowerCase()] : [r, p];
  return b === a || b.startsWith(a + "/");
}

/** Throws unless `relative` (already a validated project path) resolves inside `root`. */
export async function assertInsideProject(
  root: string,
  relative: string,
  fs: RealPathFs,
): Promise<void> {
  const realRoot = await fs.realPath(root);
  if (realRoot === null) throw new Error(`Project folder not found: ${root}`);
  const parts = relative.split("/").filter(Boolean);
  for (let depth = parts.length; depth > 0; depth--) {
    const candidate = fs.join(root, ...parts.slice(0, depth));
    const real = await fs.realPath(candidate);
    if (real === null) {
      // A dangling symlink would let the write create a file wherever it points.
      if (await fs.isSymlink(candidate)) {
        throw new Error(`Refusing to write through a broken symlink: ${relative}`);
      }
      continue;
    }
    if (!inside(realRoot, real)) {
      throw new Error(`Refusing to write outside the project folder: ${relative}`);
    }
    return;
  }
}
