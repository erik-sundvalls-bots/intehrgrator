import { assertEquals, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { configureLanguagePlugins, generateWithLanguagePlugin } from "../src/desktop/language_plugins.ts";
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
