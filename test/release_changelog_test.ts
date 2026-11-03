import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  changelogReleaseUrl,
  promoteUnreleasedChangelog,
  releaseTagForVersion,
  unreleasedCompareUrl,
} from "../scripts/release_version.ts";

const SAMPLE = `# Changelog

## [Unreleased]

- **One** note
- **Two** note

## [0.13.0] - 2026-11-03

Already released.

[Unreleased]: https://github.com/regionstockholm/intehrgrator/compare/v0.13...main
[0.13.0]: https://github.com/regionstockholm/intehrgrator/releases/tag/v0.13
`;

Deno.test("empty Unreleased section is left unchanged", () => {
  const text = SAMPLE.replace("- **One** note\n- **Two** note\n", "");
  const next = promoteUnreleasedChangelog(text, "0.14.0", "2026-11-04");
  assertEquals(next.changed, false);
  assertEquals(next.text, text);
});

Deno.test("Unreleased notes become a new version heading and compare link", () => {
  const next = promoteUnreleasedChangelog(SAMPLE, "0.14.0", "2026-11-04");
  assertEquals(next.changed, true);
  assertStringIncludes(next.text, "## [Unreleased]\n\n## [0.14.0] - 2026-11-04");
  assertStringIncludes(next.text, "- **One** note");
  assertEquals(next.text.includes("## [0.14.0] - 2026-11-04\n\n## [0.14.0]"), false);
  const heading = next.text.indexOf("## [0.14.0]");
  const previous = next.text.indexOf("## [0.13.0]");
  assertEquals(heading < previous, true);
  assertEquals(next.text.split("## [0.14.0]").length, 2);
  assertStringIncludes(next.text, `[Unreleased]: ${unreleasedCompareUrl("v0.14")}`);
  assertStringIncludes(next.text, `[0.14.0]: ${changelogReleaseUrl("v0.14")}`);
  assertEquals(releaseTagForVersion("0.14.0"), "v0.14");
});

Deno.test("notes join an existing version heading instead of duplicating it", () => {
  const next = promoteUnreleasedChangelog(SAMPLE, "0.13.0", "2026-11-04");
  assertEquals(next.changed, true);
  assertEquals(next.text.split("## [0.13.0]").length, 2);
  const heading = next.text.indexOf("## [0.13.0] - 2026-11-03");
  const note = next.text.indexOf("- **One** note");
  const already = next.text.indexOf("Already released.");
  assertEquals(heading < note && note < already, true);
  assertEquals(next.text.includes("## [Unreleased]\n\n- **One**"), false);
});
