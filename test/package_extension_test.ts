import { assertEquals } from "@std/assert";
import { VSIX_RELEASE_PATH } from "../scripts/package-extension.ts";

Deno.test("VS Code VSIX release asset path matches desktop release folder", () => {
  assertEquals(VSIX_RELEASE_PATH.replaceAll("\\", "/"), "dist/release/intEHRgrator.vsix");
});

Deno.test("VSIX ignore keeps desktop binaries out of the extension package", async () => {
  const text = await Deno.readTextFile(new URL("../.vscodeignore", import.meta.url));
  const includeDist = text.indexOf("!dist/**");
  const excludeRelease = text.indexOf("dist/release/**");
  assertEquals(includeDist >= 0 && excludeRelease > includeDist, true);
});
