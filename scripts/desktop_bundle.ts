/**
 * Files compiled into the desktop binary.
 * `deno task desktop` and `compile:desktop` share this list so the webview
 * assets and the language-plugin worker cannot drift apart.
 */

export const DESKTOP_ENTRY = "src/desktop/main.ts";

/** Passed as an argument array so a task shell does not expand the glob. */
export const DESKTOP_ASSET_ARGS = [
  "--include",
  "src/desktop/www",
  "--include",
  "src/desktop/language_plugin_worker.ts",
  "--exclude",
  "**/*.js",
] as const;

export function desktopCompileArgs(target: string, output: string): string[] {
  return [
    "desktop",
    "-A",
    "--no-check",
    "--config",
    "deno.json",
    "--backend",
    "webview",
    "--target",
    target,
    "--output",
    output,
    ...DESKTOP_ASSET_ARGS,
    DESKTOP_ENTRY,
  ];
}

/** Dev window. `--hmr` stays here; a release compile does not reload. */
export function desktopDevArgs(): string[] {
  return [
    "desktop",
    "-A",
    "--no-check",
    "--config",
    "deno.json",
    "--backend",
    "webview",
    ...DESKTOP_ASSET_ARGS,
    "--hmr",
    DESKTOP_ENTRY,
  ];
}
