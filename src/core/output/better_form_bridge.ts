/**
 * Optional Better Form Renderer bridge (kintegrate form-viewer absorption).
 *
 * Licensed Better renderer assets are installed locally via
 * `deno task setup:better-forms` into `.local/better-form-renderer` and copied
 * into `dist/vendor/better` at build time. They are never committed.
 * The web bundle learns availability from the build (`betterRendererBundled`),
 * not from a runtime fetch: a missing renderer file is a 404 in the console.
 *
 * This module is the seam for Push/Pull/Sync Mode against a form viewer window
 * without coupling Mapping Model / Test Run to proprietary APIs.
 */

export interface BetterFormBridge {
  readonly available: boolean;
  readonly rendererUrl: string | null;
  openViewer(): Window | null;
  pushComposition(composition: unknown): boolean;
  requestComposition(): boolean;
}

export interface BetterFormBridgeOptions {
  /** App-relative path resolved by the Host. */
  resolveAppUrl: (path: string) => string;
  /** Prefer an existing viewer window when Sync Mode is on. */
  targetWindow?: Window | null;
  /** Relative path of the optional form viewer shell. */
  viewerPath?: string;
}

const PUSH_TYPE = "intehrgrator:better-form-push";
const PULL_TYPE = "intehrgrator:better-form-pull-request";

export function createBetterFormBridge(
  options: BetterFormBridgeOptions,
  available = false,
): BetterFormBridge {
  const viewerPath = options.viewerPath ?? "better-form-viewer.html";
  const rendererUrl = available ? options.resolveAppUrl(viewerPath) : null;
  let viewer: Window | null = options.targetWindow ?? null;

  return {
    available,
    rendererUrl,
    openViewer() {
      if (!rendererUrl || typeof globalThis.open !== "function") return null;
      viewer = globalThis.open(rendererUrl, "intehrgrator-better-form");
      return viewer;
    },
    pushComposition(composition: unknown) {
      const target = viewer ?? options.targetWindow ?? null;
      if (!target) return false;
      target.postMessage({ type: PUSH_TYPE, composition }, "*");
      return true;
    },
    requestComposition() {
      const target = viewer ?? options.targetWindow ?? null;
      if (!target) return false;
      target.postMessage({ type: PULL_TYPE }, "*");
      return true;
    },
  };
}

/** Message types shared with an optional Better form viewer shell. */
export const BetterFormMessage = {
  PUSH: PUSH_TYPE,
  PULL_REQUEST: PULL_TYPE,
  COMPOSITION: "intehrgrator:better-form-composition",
  READY: "intehrgrator:better-form-ready",
} as const;
