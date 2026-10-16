/** Injected at bundle time via esbuild `define` in scripts/build.ts */
declare const __BUILD_ID__: string | undefined;
declare const __BUILD_TIMESTAMP__: string | undefined;

export const BUILD_ID =
  typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

export const BUILD_TIMESTAMP =
  typeof __BUILD_TIMESTAMP__ !== "undefined" ? __BUILD_TIMESTAMP__ : "not built";
