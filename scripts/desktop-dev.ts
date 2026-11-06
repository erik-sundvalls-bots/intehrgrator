/**
 * Dev loop for the native workbench window.
 *
 * `deno desktop` replaces Deno.args with its runtime path, so flags after
 * `deno task desktop --` are stored in the environment instead. The include
 * list matches compile:desktop (see scripts/desktop_bundle.ts).
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { forwardDesktopArgsToEnv } from "../src/desktop/cli.ts";
import { desktopDevArgs } from "./desktop_bundle.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");

if (import.meta.main) {
  const build = await new Deno.Command("deno", {
    args: ["task", "build"],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!build.success) Deno.exit(build.code);

  let env: Record<string, string>;
  try {
    env = forwardDesktopArgsToEnv(Deno.args, Deno.env.toObject());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }

  const child = new Deno.Command("deno", {
    args: desktopDevArgs(),
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  Deno.exit(status.code);
}
