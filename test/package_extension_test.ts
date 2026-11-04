import { assertEquals } from "@std/assert";
import { VSIX_RELEASE_PATH } from "../scripts/package-extension.ts";

Deno.test("VS Code VSIX release asset path matches desktop release folder", () => {
  assertEquals(VSIX_RELEASE_PATH.replaceAll("\\", "/"), "dist/release/intEHRgrator.vsix");
});

Deno.test("VSIX ignore keeps desktop binaries out of the extension package", async () => {
  const text = await Deno.readTextFile(new URL("../.vscodeignore", import.meta.url));
  // vsce includes a path when any ! pattern matches, so !dist/** would pull dist/release back in.
  assertEquals(text.includes("!dist/**"), false);
  assertEquals(text.includes("!dist/release"), false);
  assertEquals(text.includes("!dist/wasm/**"), true);
});
