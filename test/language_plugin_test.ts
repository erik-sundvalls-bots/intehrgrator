import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import {
  configureLanguagePlugins,
  configuredLanguagePluginUrls,
  generateWithLanguagePlugin,
  normalizeManifestUrl,
} from "../src/desktop/language_plugins.ts";
import { envMap } from "../src/desktop/main.ts";
import { parseDesktopArgs } from "../src/desktop/cli.ts";
import { clearDesktopPluginLanguages } from "@intehrgrator/core/codegen/language_plugin.ts";

Deno.test("desktop language plugin loads in a read-only worker and generates", async () => {
  clearDesktopPluginLanguages();
  const manifest = new URL("../examples/language-plugins/echo/manifest.json", import.meta.url);
  configureLanguagePlugins([manifest.href]);
  const generated = await generateWithLanguagePlugin("echo", { templateId: "vitals" }, {});
  assertEquals(generated.extension, "txt");
  assertStringIncludes(generated.code, "template: vitals");

  const dir = await Deno.makeTempDir({ prefix: "intehr-plugin-" });
  const hostile = `${dir}/plugin.ts`;
  await Deno.writeTextFile(
    hostile,
    `export const plugin = {
      id: "hostile",
      label: "Hostile",
      extension: "txt",
      generate() {
        return Deno.readTextFileSync("/etc/passwd");
      },
    };\n`,
  );
  await Deno.writeTextFile(
    `${dir}/manifest.json`,
    JSON.stringify({
      id: "hostile",
      label: "Hostile",
      extension: "txt",
      module: "./plugin.ts",
    }),
  );
  configureLanguagePlugins([toFileUrl(join(dir, "manifest.json")).href]);
  let message = "";
  try {
    await generateWithLanguagePlugin("hostile", { templateId: "x" }, {});
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assertStringIncludes(message, "/etc/passwd");
  clearDesktopPluginLanguages();
});

Deno.test("--language-plugin accepts a path relative to the working directory", async () => {
  clearDesktopPluginLanguages();
  const root = new URL("..", import.meta.url);
  assertEquals(
    normalizeManifestUrl("examples/language-plugins/echo/manifest.json", fromFileUrl(root)),
    new URL("examples/language-plugins/echo/manifest.json", root).href,
  );
  assertEquals(normalizeManifestUrl("https://example.com/m.json"), "https://example.com/m.json");
  assertEquals(normalizeManifestUrl("file:///tmp/m.json"), "file:///tmp/m.json");

  const cwd = Deno.cwd();
  Deno.chdir(fromFileUrl(root));
  try {
    configureLanguagePlugins(["examples/language-plugins/echo/manifest.json"]);
    assertEquals(configuredLanguagePluginUrls()[0]!.startsWith("file:///"), true);
    const generated = await generateWithLanguagePlugin("echo", { templateId: "relative" }, {});
    assertStringIncludes(generated.code, "template: relative");
  } finally {
    Deno.chdir(cwd);
  }
});

Deno.test("desktop main reads INTEHR_LANGUAGE_PLUGINS from the environment", () => {
  const before = Deno.env.get("INTEHR_LANGUAGE_PLUGINS");
  Deno.env.set("INTEHR_LANGUAGE_PLUGINS", "https://a.example/m.json, https://b.example/m.json");
  try {
    assertEquals(parseDesktopArgs([], envMap()).languagePlugins, [
      "https://a.example/m.json",
      "https://b.example/m.json",
    ]);
  } finally {
    if (before === undefined) Deno.env.delete("INTEHR_LANGUAGE_PLUGINS");
    else Deno.env.set("INTEHR_LANGUAGE_PLUGINS", before);
  }
});
