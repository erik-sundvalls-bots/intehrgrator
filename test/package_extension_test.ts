import { assertEquals } from "@std/assert";
import { VSIX_RELEASE_PATH } from "../scripts/package-extension.ts";

Deno.test("VS Code VSIX release asset path matches desktop release folder", () => {
  assertEquals(VSIX_RELEASE_PATH, "dist/release/intEHRgrator.vsix");
});
