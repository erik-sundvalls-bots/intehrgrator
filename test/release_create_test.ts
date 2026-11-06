import { assertEquals, assertThrows } from "@std/assert";
import {
  actionsBotIdentity,
  assertBranchRef,
  assertCreateRunsInActions,
  assertReleaseCreateAllowed,
  interpretPagesIndexStatus,
  interpretRemoteTagList,
  planReleaseCreate,
  publishedVersionsFromManifest,
  recommendedVersionFileText,
  ReleaseCreateRefused,
  releasePushArgs,
  requestFromInputs,
} from "../scripts/release_create.ts";
import {
  releaseCommitFiles,
  releaseCommitMessage,
  rewriteVersionFile,
  VERSION_COMMIT_PATHS,
  VERSION_FILES,
} from "../scripts/release_version.ts";

Deno.test("release create plans the tag releaseTagForVersion already uses", () => {
  const patch = planReleaseCreate({ version: "0.8.9", updateRecommended: false, dryRun: false });
  assertEquals(patch.tag, "v0.8.9");
  assertEquals(patch.ref, "main");
  assertEquals(patch.commitMessage, "chore: release 0.8.9");
  assertEquals(
    patch.tagMessage,
    "intEHRgrator desktop 0.8.9\n\nChangelog: https://github.com/regionstockholm/intehrgrator/blob/v0.8.9/CHANGELOG.md",
  );
  assertEquals(patch.updateRecommended, false);

  const minor = planReleaseCreate({ version: "0.9.0", updateRecommended: true, dryRun: true });
  assertEquals(minor.tag, "v0.9");
  assertEquals(planReleaseCreate({ version: "0.9", updateRecommended: false, dryRun: false }).tag, "v0.9");
  assertEquals(minor.dryRun, true);
  assertEquals(minor.updateRecommended, true);
  assertEquals(
    minor.tagMessage,
    "intEHRgrator desktop 0.9.0\n\nChangelog: https://github.com/regionstockholm/intehrgrator/blob/v0.9/CHANGELOG.md",
  );
});

Deno.test("release create commit message is the prefix pages.yml leaves to release.yml", async () => {
  const pages = await Deno.readTextFile(".github/workflows/pages.yml");
  assertEquals(
    pages.includes("!startsWith(github.event.head_commit.message, 'chore: release')"),
    true,
  );
  assertEquals(releaseCommitMessage("0.15.0"), "chore: release 0.15.0");
});

Deno.test("release create refuses a missing, padded, or non-semver version", () => {
  assertThrows(() => planReleaseCreate({ version: "", updateRecommended: false, dryRun: false }), ReleaseCreateRefused);
  const padded = assertThrows(
    () => planReleaseCreate({ version: " 0.8.9", updateRecommended: false, dryRun: false }),
    ReleaseCreateRefused,
  );
  assertEquals(padded.message, "version must not contain whitespace");
  const bad = assertThrows(
    () => planReleaseCreate({ version: "v0.8.9", updateRecommended: false, dryRun: false }),
    ReleaseCreateRefused,
  );
  assertEquals(bad.message, "Invalid semver version: v0.8.9");
});

Deno.test("release create accepts a branch ref and refuses a revision", () => {
  assertEquals(assertBranchRef(undefined), "main");
  assertEquals(assertBranchRef("  "), "main");
  assertEquals(planReleaseCreate({
    version: "0.8.9",
    ref: "release/0.8",
    updateRecommended: false,
    dryRun: false,
  }).ref, "release/0.8");
  assertThrows(() => assertBranchRef("refs/heads/main"), ReleaseCreateRefused);
  assertThrows(() => assertBranchRef("-main"), ReleaseCreateRefused);
  assertThrows(() => assertBranchRef("main;touch"), ReleaseCreateRefused);
});

Deno.test("Actions inputs default recommended and dry-run off, and CLI flags override them", () => {
  assertEquals(
    requestFromInputs([], {
      RELEASE_VERSION: "0.8.9",
      RELEASE_REF: "main",
      RELEASE_UPDATE_RECOMMENDED: "false",
      RELEASE_DRY_RUN: "false",
    }),
    { version: "0.8.9", ref: "main", updateRecommended: false, dryRun: false },
  );
  assertEquals(
    requestFromInputs(["--version", "0.9.1", "--ref", "release/0.9", "--update-recommended", "--dry-run"], {
      RELEASE_VERSION: "0.8.9",
      RELEASE_UPDATE_RECOMMENDED: "false",
      RELEASE_DRY_RUN: "false",
    }),
    { version: "0.9.1", ref: "release/0.9", updateRecommended: true, dryRun: true },
  );
  assertThrows(() => requestFromInputs(["--bogus"], {}), ReleaseCreateRefused);
});

Deno.test("release create refuses an existing tag, a Pages listing, or a live index", () => {
  const exists = assertThrows(
    () =>
      assertReleaseCreateAllowed({
        tag: "v0.8",
        remoteTagList: "abc\trefs/tags/v0.8\n",
        publishedVersions: [],
        pagesIndexStatus: 404,
      }),
    ReleaseCreateRefused,
  );
  assertEquals(exists.message, "Refusing to create v0.8: tag v0.8 already exists on origin");

  const listed = assertThrows(
    () =>
      assertReleaseCreateAllowed({
        tag: "v0.14",
        remoteTagList: "",
        publishedVersions: ["v0.14", "v0.13"],
        pagesIndexStatus: 404,
      }),
    ReleaseCreateRefused,
  );
  assertEquals(listed.message.includes("versions.json already lists v0.14"), true);

  const served = assertThrows(
    () =>
      assertReleaseCreateAllowed({
        tag: "v0.14",
        remoteTagList: "",
        publishedVersions: [],
        pagesIndexStatus: 200,
      }),
    ReleaseCreateRefused,
  );
  assertEquals(served.message.includes("already serves /v0.14/index.html"), true);
});

Deno.test("release create allows a tag that is absent on origin and on Pages", () => {
  assertReleaseCreateAllowed({
    tag: "v0.99.99",
    remoteTagList: "\n",
    publishedVersions: ["v0.14"],
    pagesIndexStatus: 404,
  });
  assertEquals(interpretRemoteTagList("abc\trefs/tags/v0.8^{}\n", "v0.8"), "exists");
  assertEquals(interpretPagesIndexStatus(404), "absent");
  assertEquals(interpretPagesIndexStatus(200), "published");
});

Deno.test("release create fails closed when the tag list or Pages status is not a clear answer", () => {
  const weird = assertThrows(
    () =>
      assertReleaseCreateAllowed({
        tag: "v0.8",
        remoteTagList: "abc\trefs/tags/v0.8.1\n",
        publishedVersions: [],
        pagesIndexStatus: 404,
      }),
    ReleaseCreateRefused,
  );
  assertEquals(weird.message.includes("could not verify origin tags"), true);

  const http = assertThrows(
    () =>
      assertReleaseCreateAllowed({
        tag: "v0.99",
        remoteTagList: "",
        publishedVersions: [],
        pagesIndexStatus: 500,
      }),
    ReleaseCreateRefused,
  );
  assertEquals(http.message.includes("unexpected HTTP 500"), true);

  assertThrows(() => publishedVersionsFromManifest({ recommended: "v0.14" }), ReleaseCreateRefused);
  assertThrows(() => publishedVersionsFromManifest(null), ReleaseCreateRefused);
});

Deno.test("versions.json keeps published tags and drops entries that are not tags", () => {
  const versions = publishedVersionsFromManifest({ versions: ["v0.14", "nope", "v0.14"] });
  assertEquals(versions.includes("v0.14"), true);
  assertEquals(versions.includes("nope"), false);
  assertEquals(versions.filter((tag) => tag === "v0.14").length, 1);
  assertEquals(publishedVersionsFromManifest({ versions: [] }), []);
});

Deno.test("release push is atomic and does not force", () => {
  assertEquals(releasePushArgs("main", "v0.8.9", true), [
    "push",
    "--atomic",
    "origin",
    "HEAD:refs/heads/main",
    "refs/tags/v0.8.9",
  ]);
  assertEquals(releasePushArgs("release/0.9", "v0.9", false), [
    "push",
    "--atomic",
    "origin",
    "refs/tags/v0.9",
  ]);
  assertEquals(releasePushArgs("main", "v0.8.9", true).includes("--force"), false);
  assertThrows(() => releasePushArgs("main", "0.8.9", true), ReleaseCreateRefused);
});

Deno.test("RECOMMENDED_VERSION stores the tag", () => {
  assertEquals(recommendedVersionFileText("v0.8.9"), "v0.8.9\n");
  assertThrows(() => recommendedVersionFileText("0.8.9"), ReleaseCreateRefused);
});

Deno.test("release commit files are the version files plus changelog and the pin when requested", () => {
  assertEquals(
    releaseCommitFiles({ versionBump: true, changelogChanged: true, updateRecommended: true }),
    [
      "deno.json",
      "package.json",
      "scripts/desktop.compile.json",
      "src/core/persistence/mod.ts",
      "CHANGELOG.md",
      "RECOMMENDED_VERSION",
    ],
  );
  assertEquals(releaseCommitFiles({ versionBump: true, changelogChanged: false }), [
    "deno.json",
    "package.json",
    "scripts/desktop.compile.json",
    "src/core/persistence/mod.ts",
  ]);
  assertEquals(releaseCommitFiles({ versionBump: false, changelogChanged: false }), []);
  assertEquals(VERSION_COMMIT_PATHS.length, VERSION_FILES.length);
  for (let i = 0; i < VERSION_COMMIT_PATHS.length; i++) {
    assertEquals(VERSION_FILES[i].replaceAll("\\", "/").endsWith(VERSION_COMMIT_PATHS[i]), true);
  }
});

Deno.test("version file rewrite updates the json version and APP_VERSION", () => {
  assertEquals(
    rewriteVersionFile("deno.json", '{\n  "version": "0.1.0"\n}\n', "0.2.0"),
    '{\n  "version": "0.2.0"\n}\n',
  );
  assertEquals(
    rewriteVersionFile("src/core/persistence/mod.ts", 'export const APP_VERSION = "0.1.0";\n', "0.2.0"),
    'export const APP_VERSION = "0.2.0";\n',
  );
  assertThrows(() => rewriteVersionFile("deno.json", "{}", "0.2.0"));
});

Deno.test("this script pushes only on Actions; a local run stays a dry run", () => {
  assertCreateRunsInActions(true, undefined);
  assertCreateRunsInActions(false, "true");
  const refused = assertThrows(() => assertCreateRunsInActions(false, undefined), ReleaseCreateRefused);
  assertEquals(refused.message.includes("deno task release"), true);
});

Deno.test("Actions commits as the GitHub Actions bot; a local run does not replace git identity", () => {
  assertEquals(actionsBotIdentity({}), undefined);
  assertEquals(actionsBotIdentity({ GITHUB_ACTIONS: "true" }), {
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  });
  assertEquals(
    actionsBotIdentity({ GITHUB_ACTIONS: "true", GIT_AUTHOR_NAME: "Maintainer" })?.GIT_AUTHOR_NAME,
    "Maintainer",
  );
});

Deno.test("deno task release keeps git checks and drops the gh prerequisite", async () => {
  const release = await Deno.readTextFile("scripts/release.ts");
  const helpers = await Deno.readTextFile("scripts/release_version.ts");
  assertEquals(release.includes("assertGhAuth"), false);
  assertEquals(helpers.includes("assertGhAuth"), false);
  assertEquals(helpers.includes('"gh"'), false);
  assertEquals(helpers.includes("'gh'"), false);
  assertEquals(release.includes("assertCleanGitTree"), true);
  assertEquals(release.includes("assertReleasePrerequisites"), true);
  assertEquals(release.includes("releaseCommitMessage"), true);
  assertEquals(helpers.includes("git is required for deno task release"), true);
  assertEquals(release.includes("await assertCleanGitTree()"), true);
});

Deno.test("Release create workflow tags only, and release.yml dispatch stays recovery", async () => {
  const create = await Deno.readTextFile(".github/workflows/release-create.yml");
  const publish = await Deno.readTextFile(".github/workflows/release.yml");
  assertEquals(create.includes("workflow_dispatch"), true);
  assertEquals(create.includes("scripts/release_create.ts"), true);
  assertEquals(create.includes("RELEASE_VERSION: ${{ inputs.version }}"), true);
  assertEquals(create.includes("update_recommended:"), true);
  assertEquals(create.includes("dry_run:"), true);
  assertEquals(create.includes("group: release-create"), true);
  assertEquals(create.includes("group: release-create-${{ inputs.version }}"), false);
  assertEquals(create.includes("cancel-in-progress: false"), true);
  assertEquals(create.includes("environment: release"), true);
  assertEquals(create.includes("contents: read"), true);
  assertEquals(create.includes("RELEASE_PAT"), true);
  assertEquals(create.includes("case(inputs.dry_run, github.token, secrets.RELEASE_PAT)"), true);
  assertEquals(create.includes("deploy-pages"), false);
  assertEquals(create.includes("compile:desktop"), false);
  assertEquals(publish.includes("workflow_dispatch"), true);
  assertEquals(
    publish.includes("Recovery only: existing tag whose Pages publish did not finish."),
    true,
  );
  assertEquals(publish.includes("Recovery dispatch requires an existing tag"), true);
  assertEquals(publish.includes('git ls-remote --tags origin "refs/tags/${RECOVERY_TAG}"'), true);
  assertEquals(publish.includes("deploy-pages"), true);
});
