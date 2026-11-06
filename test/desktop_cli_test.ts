import { assertEquals, assertThrows } from "@std/assert";
import {
  bindRequiresTokenMessage,
  DEFAULT_BIND,
  forwardDesktopArgsToEnv,
  isLoopbackBind,
  parseDesktopArgs,
  USAGE,
} from "../src/desktop/cli.ts";
import { shouldOpenUi } from "../src/desktop/main.ts";
import { DESKTOP_ASSET_ARGS, desktopCompileArgs, desktopDevArgs } from "../scripts/desktop_bundle.ts";

Deno.test("parseDesktopArgs defaults to loopback ephemeral port", () => {
  const opts = parseDesktopArgs([]);
  assertEquals(opts.help, false);
  assertEquals(opts.headless, false);
  assertEquals(opts.mcp, false);
  assertEquals(opts.port, 0);
  assertEquals(opts.bind, DEFAULT_BIND);
  assertEquals(opts.load, undefined);
  assertEquals(opts.token, undefined);
});

Deno.test("parseDesktopArgs reads flags and env", () => {
  const opts = parseDesktopArgs(
    ["--headless", "--port", "8765", "--bind", "0.0.0.0", "--load", "x.intehrgrator", "--token", "s3cret"],
    { PORT: "1", INTEHR_BIND: "127.0.0.1", INTEHR_AGENT_TOKEN: "env-token" },
  );
  assertEquals(opts.headless, true);
  assertEquals(opts.port, 8765);
  assertEquals(opts.bind, "0.0.0.0");
  assertEquals(opts.load, "x.intehrgrator");
  assertEquals(opts.token, "s3cret");
});

Deno.test("parseDesktopArgs help and equals form", () => {
  const opts = parseDesktopArgs(["-h", "--port=9", "--bind=::1", "--load=p.intehrgrator"]);
  assertEquals(opts.help, true);
  assertEquals(opts.port, 9);
  assertEquals(opts.bind, "::1");
  assertEquals(opts.load, "p.intehrgrator");
  assertEquals(USAGE.includes("--headless"), true);
});

Deno.test("parseDesktopArgs token from env when flag omitted", () => {
  const opts = parseDesktopArgs(["--headless"], { INTEHR_AGENT_TOKEN: "env" });
  assertEquals(opts.token, "env");
});

Deno.test("isLoopbackBind and bindRequiresTokenMessage", () => {
  assertEquals(isLoopbackBind("127.0.0.1"), true);
  assertEquals(isLoopbackBind("localhost"), true);
  assertEquals(isLoopbackBind("::1"), true);
  assertEquals(isLoopbackBind("0.0.0.0"), false);
  assertEquals(bindRequiresTokenMessage(parseDesktopArgs(["--bind", "0.0.0.0"])), 
    "Non-loopback --bind requires --token or INTEHR_AGENT_TOKEN");
  assertEquals(
    bindRequiresTokenMessage(parseDesktopArgs(["--bind", "0.0.0.0", "--token", "x"])),
    undefined,
  );
});

Deno.test("shouldOpenUi is false for headless and mcp proxy", () => {
  assertEquals(shouldOpenUi(parseDesktopArgs([])), true);
  assertEquals(shouldOpenUi(parseDesktopArgs(["--headless"])), false);
  assertEquals(shouldOpenUi(parseDesktopArgs(["--mcp"])), false);
});

Deno.test("parseDesktopArgs accepts --mcp", () => {
  const opts = parseDesktopArgs(["--mcp"]);
  assertEquals(opts.mcp, true);
  assertEquals(opts.headless, false);
  assertEquals(USAGE.includes("--mcp"), true);
});

Deno.test("parseDesktopArgs rejects missing flag values", () => {
  assertThrows(() => parseDesktopArgs(["--port"]), Error, "requires a value");
  assertThrows(() => parseDesktopArgs(["--bind"]), Error, "requires a value");
});

Deno.test("parseDesktopArgs reads headless, mcp, load, and help from the environment", () => {
  const opts = parseDesktopArgs(["--runtime", "/tmp/intEHRgrator.so"], {
    INTEHR_HELP: "1",
    INTEHR_HEADLESS: "true",
    INTEHR_MCP: "yes",
    INTEHR_LOAD: " project.intehrgrator ",
    PORT: "4400",
  });
  assertEquals(opts.help, true);
  assertEquals(opts.headless, true);
  assertEquals(opts.mcp, true);
  assertEquals(opts.load, "project.intehrgrator");
  assertEquals(opts.port, 4400);
});

Deno.test("flags override the desktop environment and language plugins are deduped", () => {
  const opts = parseDesktopArgs(
    ["--port", "9", "--language-plugin", "https://b.example/m.json", "--language-plugin", "https://a.example/m.json"],
    { PORT: "1", INTEHR_LANGUAGE_PLUGINS: "https://a.example/m.json" },
  );
  assertEquals(opts.port, 9);
  assertEquals(opts.languagePlugins, [
    "https://a.example/m.json",
    "https://b.example/m.json",
  ]);
});

Deno.test("forwardDesktopArgsToEnv keeps the process environment and overlays flags", () => {
  const env = forwardDesktopArgsToEnv(
    ["--headless", "--load", "bundle.intehrgrator", "--language-plugin", "echo.json", "--port", "8765"],
    { PATH: "/usr/bin", INTEHR_LANGUAGE_PLUGINS: "echo.json", PORT: "1" },
  );
  assertEquals(env.PATH, "/usr/bin");
  assertEquals(env.INTEHR_HEADLESS, "1");
  assertEquals(env.INTEHR_LOAD, "bundle.intehrgrator");
  assertEquals(env.INTEHR_LANGUAGE_PLUGINS, "echo.json");
  assertEquals(env.PORT, "8765");
  assertEquals("INTEHR_MCP" in env, false);
  assertEquals(parseDesktopArgs(["--runtime", "intEHRgrator.so"], env).headless, true);
  assertEquals(parseDesktopArgs(["--runtime", "intEHRgrator.so"], env).load, "bundle.intehrgrator");
});

Deno.test("dev and release desktop commands share the workbench include list", () => {
  const dev = desktopDevArgs();
  const release = desktopCompileArgs("x86_64-unknown-linux-gnu", "dist/release/app");
  const assetList = [...DESKTOP_ASSET_ARGS];
  assertEquals(dev.join("\0").includes(assetList.join("\0")), true);
  assertEquals(release.join("\0").includes(assetList.join("\0")), true);
  assertEquals(dev.includes("--hmr"), true);
  assertEquals(release.includes("--hmr"), false);
  assertEquals(dev.includes("--headless"), false);
  assertEquals(dev.includes("src/desktop/www"), true);
  assertEquals(dev.includes("**/*.js"), true);
  assertEquals(release.at(-1), "src/desktop/main.ts");
});
