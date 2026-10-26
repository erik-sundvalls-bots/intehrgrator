/**
 * Version-pinned public links (#277 §8): the app's docs on GitHub Pages under
 * the release directory (`v0.10`, `v0.10.2`). Same version ⇒ same content, so
 * an AI or IDE agent fetches them at most once and can cache them.
 */
import { APP_VERSION } from "../persistence/mod.ts";

export const PAGES_BASE = "https://regionstockholm.github.io/intehrgrator/";

/** Pages directory of a version: `0.10.0` → `v0.10`, `0.10.2` → `v0.10.2`. */
export function versionDir(version: string = APP_VERSION): string {
  const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(/[.+-]/);
  return patch === "0" ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
}

/** `docs/AGENT_WORKFLOW.md` → `https://…/intehrgrator/v0.10/docs/AGENT_WORKFLOW.md`. */
export function pinnedDocUrl(path: string, version: string = APP_VERSION): string {
  return `${PAGES_BASE}${versionDir(version)}/${path.replace(/^\.?\//, "")}`;
}
