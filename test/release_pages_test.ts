import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  assembleMainPagesSite,
  assembleReleasePagesSite,
  flattenWgetNest,
  generateRecommendedRedirectHtml,
  normalizeManifest,
  pagesRepoPathDepth,
  pickRecommendedVersion,
  RECOMMENDED_ALIAS_DIR,
  versionHasIndex,
  VERSIONS_MANIFEST,
  writeRecommendedRedirect,
} from "../scripts/pages_site.ts";
import {
  readVersionFromDenoJson,
  releaseTagForVersion,
} from "../scripts/release_version.ts";

Deno.test("releaseTagForVersion matches existing tag scheme", () => {
  assertEquals(releaseTagForVersion("0.5.0"), "v0.5");
  assertEquals(releaseTagForVersion("0.2.1"), "v0.2.1");
  assertEquals(releaseTagForVersion("1.0.0"), "v1.0");
  assertEquals(releaseTagForVersion("0.6.1"), "v0.6.1");
});

Deno.test("readVersionFromDenoJson", () => {
  assertEquals(readVersionFromDenoJson(`{"version":"0.6.0"}`), "0.6.0");
});

Deno.test("normalizeManifest deduplicates and sorts versions", () => {
  assertEquals(
    normalizeManifest({ versions: ["v0.4", "v0.5", "v0.5", "bad", 3] }),
    { versions: ["v0.5", "v0.4"] },
  );
});

Deno.test("normalizeManifest keeps only numeric v* release tags", () => {
  assertEquals(
    normalizeManifest({
      versions: ["v0.6.5", "validation-prep-alpha.1", "v0.6.1"],
    }),
    { versions: ["v0.6.5", "v0.6.1"] },
  );
});

Deno.test("normalizeManifest keeps recommended when it is a published version", () => {
  assertEquals(
    normalizeManifest({ versions: ["v0.7", "v0.6"], recommended: "v0.6" }),
    { versions: ["v0.7", "v0.6"], recommended: "v0.6" },
  );
});

Deno.test("normalizeManifest drops recommended when it is not a published version", () => {
  assertEquals(
    normalizeManifest({ versions: ["v0.7", "v0.6"], recommended: "v0.5" }),
    { versions: ["v0.7", "v0.6"] },
  );
});

Deno.test("normalizeManifest ignores a non-string recommended field", () => {
  assertEquals(
    normalizeManifest({ versions: ["v0.7"], recommended: 3 }),
    { versions: ["v0.7"] },
  );
});

Deno.test("pickRecommendedVersion prefers a still-published override", () => {
  assertEquals(
    pickRecommendedVersion(["v0.7", "v0.6", "v0.5"], { override: "v0.6", previous: "v0.5" }),
    "v0.6",
  );
});

Deno.test("pickRecommendedVersion falls back to previous when override is stale", () => {
  assertEquals(
    pickRecommendedVersion(["v0.7", "v0.6"], { override: "v0.5", previous: "v0.6" }),
    "v0.6",
  );
});

Deno.test("pickRecommendedVersion defaults to the newest version when nothing else applies", () => {
  assertEquals(pickRecommendedVersion(["v0.7", "v0.6"]), "v0.7");
  assertEquals(
    pickRecommendedVersion(["v0.7", "v0.6"], { override: "v0.5", previous: "v0.4" }),
    "v0.7",
  );
});

Deno.test("pickRecommendedVersion returns undefined with no versions", () => {
  assertEquals(pickRecommendedVersion([]), undefined);
});

Deno.test("pagesRepoPathDepth counts project path segments", () => {
  assertEquals(pagesRepoPathDepth("https://regionstockholm.github.io/intehrgrator"), 1);
  assertEquals(pagesRepoPathDepth("https://regionstockholm.github.io/intehrgrator/"), 1);
  assertEquals(pagesRepoPathDepth("https://example.github.io/"), 0);
});

Deno.test("flattenWgetNest lifts nested files to dest root", async () => {
  const dest = await Deno.makeTempDir();
  await Deno.mkdir(join(dest, "v0.6", "wasm"), { recursive: true });
  await Deno.writeTextFile(join(dest, "v0.6", "index.html"), "<html>ok</html>");
  await Deno.writeTextFile(join(dest, "v0.6", "wasm", "a.js"), "1");
  await flattenWgetNest(dest, "v0.6");
  assertEquals(await Deno.readTextFile(join(dest, "index.html")), "<html>ok</html>");
  assertEquals(await Deno.readTextFile(join(dest, "wasm", "a.js")), "1");
  let nestedGone = false;
  try {
    await Deno.stat(join(dest, "v0.6"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) nestedGone = true;
    else throw error;
  }
  assertEquals(nestedGone, true);
});

Deno.test("versionHasIndex detects index.html under a tag", async () => {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "v0.6"), { recursive: true });
  assertEquals(await versionHasIndex(root, "v0.6"), false);
  await Deno.writeTextFile(join(root, "v0.6", "index.html"), "<html/>");
  assertEquals(await versionHasIndex(root, "v0.6"), true);
});

Deno.test("assembleMainPagesSite copies root dist and writes manifest", async () => {
  const dir = await Deno.makeTempDir();
  const rootDist = join(dir, "root-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(rootDist, { recursive: true });
  await Deno.writeTextFile(join(rootDist, "index.html"), "<html>main</html>");

  const manifest = await assembleMainPagesSite({
    baseUrl: "https://example.invalid/intehrgrator",
    rootDist,
    outDir,
  });

  assertEquals(manifest.versions, []);
  assertEquals(manifest.recommended, undefined);
  assertEquals(await Deno.readTextFile(join(outDir, "index.html")), "<html>main</html>");
  assertEquals(
    JSON.parse(await Deno.readTextFile(join(outDir, VERSIONS_MANIFEST))).versions,
    [],
  );
});

Deno.test("assembleMainPagesSite drops listed versions that fail to mirror", async () => {
  const dir = await Deno.makeTempDir();
  const rootDist = join(dir, "root-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(rootDist, { recursive: true });
  await Deno.writeTextFile(join(rootDist, "index.html"), "<html>main</html>");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/versions.json")) {
      return Promise.resolve(
        new Response(JSON.stringify({ versions: ["v0.6"] }), { status: 200 }),
      );
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    const manifest = await assembleMainPagesSite({
      baseUrl: "https://example.invalid/intehrgrator",
      rootDist,
      outDir,
    });
    assertEquals(manifest.versions, []);
    assertEquals(
      JSON.parse(await Deno.readTextFile(join(outDir, VERSIONS_MANIFEST))).versions,
      [],
    );
    assertEquals(await versionHasIndex(outDir, "v0.6"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("assembleReleasePagesSite rejects duplicate version tags", async () => {
  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.6</html>");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/versions.json")) {
      return Promise.resolve(
        new Response(JSON.stringify({ versions: ["v0.6"] }), { status: 200 }),
      );
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        assembleReleasePagesSite({
          baseUrl: "https://example.invalid/intehrgrator",
          versionTag: "v0.6",
          versionDist,
          outDir,
        }),
      Error,
      "already exists",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("assembleReleasePagesSite adds new version and drops broken listed ones", async () => {
  const nestedRoot = await Deno.makeTempDir();
  const projectDir = join(nestedRoot, "intehrgrator");
  await Deno.mkdir(projectDir, { recursive: true });
  await Deno.writeTextFile(join(projectDir, "index.html"), "<html>live</html>");
  await Deno.writeTextFile(
    join(projectDir, "versions.json"),
    JSON.stringify({ versions: ["v0.6"] }, null, 2),
  );

  const live = Deno.serve({ port: 0, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const filePath = join(nestedRoot, rel);
    try {
      const data = await Deno.readFile(filePath);
      return new Response(data, { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });

  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.6.1</html>");
  await Deno.writeTextFile(join(versionDist, "bundle.js"), "ok");

  const liveBase = `http://127.0.0.1:${live.addr.port}/intehrgrator`;
  try {
    const manifest = await assembleReleasePagesSite({
      baseUrl: liveBase,
      versionTag: "v0.6.1",
      versionDist,
      outDir,
    });
    assertEquals(manifest.versions, ["v0.6.1"]);
    assertEquals(manifest.recommended, "v0.6.1");
    assertEquals(await Deno.readTextFile(join(outDir, "v0.6.1", "index.html")), "<html>v0.6.1</html>");
    assertEquals(await versionHasIndex(outDir, "v0.6"), false);
    // Release dist is also the new bleeding-edge root (pages.yml skips chore: release).
    assertEquals(await Deno.readTextFile(join(outDir, "index.html")), "<html>v0.6.1</html>");
    assertEquals(await Deno.readTextFile(join(outDir, "bundle.js")), "ok");
  } finally {
    await live.shutdown();
  }
});

async function serveLiveSite(
  files: Record<string, string>,
): Promise<{ baseUrl: string; shutdown: () => Promise<void> }> {
  const nestedRoot = await Deno.makeTempDir();
  const projectDir = join(nestedRoot, "intehrgrator");
  for (const [rel, contents] of Object.entries(files)) {
    const filePath = join(projectDir, rel);
    await ensureDir(dirname(filePath));
    await Deno.writeTextFile(filePath, contents);
  }
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    try {
      const data = await Deno.readFile(join(nestedRoot, rel));
      return new Response(data, { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
  return {
    baseUrl: `http://127.0.0.1:${server.addr.port}/intehrgrator`,
    shutdown: () => server.shutdown(),
  };
}

Deno.test("assembleReleasePagesSite publishes versionDist as the bleeding-edge root", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>stale-root</html>",
    "versions.json": JSON.stringify({ versions: ["v0.6"], recommended: "v0.6" }),
    "v0.6/index.html": "<html>v0.6</html>",
    "v0.6/pages-files.txt": "index.html\n",
  });

  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.8-root</html>");
  await Deno.writeTextFile(join(versionDist, "bundle.js"), "new-bundle");

  try {
    await assembleReleasePagesSite({
      baseUrl: live.baseUrl,
      versionTag: "v0.8",
      versionDist,
      outDir,
    });
    assertEquals(await Deno.readTextFile(join(outDir, "index.html")), "<html>v0.8-root</html>");
    assertEquals(await Deno.readTextFile(join(outDir, "bundle.js")), "new-bundle");
    assertEquals(await Deno.readTextFile(join(outDir, "v0.8", "index.html")), "<html>v0.8-root</html>");
    assertEquals(await Deno.readTextFile(join(outDir, "v0.6", "index.html")), "<html>v0.6</html>");
  } finally {
    await live.shutdown();
  }
});

Deno.test("assembleReleasePagesSite keeps a still-published recommended tag over the newest", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>live</html>",
    "versions.json": JSON.stringify({ versions: ["v0.6"], recommended: "v0.6" }),
    "v0.6/index.html": "<html>v0.6</html>",
    "v0.6/pages-files.txt": "index.html\n",
  });

  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.7</html>");

  try {
    const manifest = await assembleReleasePagesSite({
      baseUrl: live.baseUrl,
      versionTag: "v0.7",
      versionDist,
      outDir,
    });
    assertEquals(manifest.versions, ["v0.7", "v0.6"]);
    // v0.6 remains the pinned recommendation even though v0.7 just shipped.
    assertEquals(manifest.recommended, "v0.6");
  } finally {
    await live.shutdown();
  }
});

Deno.test("assembleMainPagesSite mirrors unlinked catalogs listed in pages-files.txt", async () => {
  const catalog = '{"version":1,"sets":[]}';
  const library = '{"version":1,"functions":[]}';
  const live = await serveLiveSite({
    "index.html": "<html>root</html>",
    "versions.json": JSON.stringify({ versions: ["v0.8.7"], recommended: "v0.8.7" }),
    "v0.8.7/index.html": "<html>frozen</html>",
    "v0.8.7/examples/example-sets.json": catalog,
    "v0.8.7/function-library/catalog.json": library,
    "v0.8.7/pages-files.txt": [
      "examples/example-sets.json",
      "function-library/catalog.json",
      "index.html",
    ].join("\n") + "\n",
  });

  const dir = await Deno.makeTempDir();
  const rootDist = join(dir, "root-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(rootDist, { recursive: true });
  await Deno.writeTextFile(join(rootDist, "index.html"), "<html>main</html>");

  try {
    const manifest = await assembleMainPagesSite({
      baseUrl: live.baseUrl,
      rootDist,
      outDir,
    });
    assertEquals(manifest.versions, ["v0.8.7"]);
    assertEquals(
      await Deno.readTextFile(join(outDir, "v0.8.7", "examples", "example-sets.json")),
      catalog,
    );
    assertEquals(
      await Deno.readTextFile(join(outDir, "v0.8.7", "function-library", "catalog.json")),
      library,
    );
    assertEquals(await Deno.readTextFile(join(outDir, "v0.8.7", "index.html")), "<html>frozen</html>");
  } finally {
    await live.shutdown();
  }
});

Deno.test("assembleReleasePagesSite records unlinked catalog files in pages-files.txt", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>live</html>",
    "versions.json": JSON.stringify({ versions: [] }),
  });
  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(join(versionDist, "examples"), { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.8.7</html>");
  await Deno.writeTextFile(join(versionDist, "examples", "example-sets.json"), "{\"sets\":[]}");
  try {
    await assembleReleasePagesSite({
      baseUrl: live.baseUrl,
      versionTag: "v0.8.7",
      versionDist,
      outDir,
    });
    const list = await Deno.readTextFile(join(outDir, "v0.8.7", "pages-files.txt"));
    assertEquals(list.includes("examples/example-sets.json"), true);
    assertEquals(list.includes("index.html"), true);
    assertEquals(list.includes("pages-files.txt"), false);
    assertEquals(
      await Deno.readTextFile(join(outDir, "v0.8.7", "examples", "example-sets.json")),
      "{\"sets\":[]}",
    );
  } finally {
    await live.shutdown();
  }
});

Deno.test("assembleReleasePagesSite honors a recommendedOverride even over the previous pin", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>live</html>",
    "versions.json": JSON.stringify({ versions: ["v0.6"], recommended: "v0.6" }),
    "v0.6/index.html": "<html>v0.6</html>",
    "v0.6/pages-files.txt": "index.html\n",
  });

  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.7</html>");

  try {
    const manifest = await assembleReleasePagesSite({
      baseUrl: live.baseUrl,
      versionTag: "v0.7",
      versionDist,
      outDir,
      recommendedOverride: "v0.7",
    });
    assertEquals(manifest.recommended, "v0.7");
  } finally {
    await live.shutdown();
  }
});

Deno.test("generateRecommendedRedirectHtml generates meta and script redirect to target tag", () => {
  const html = generateRecommendedRedirectHtml("v0.8.7");
  assertEquals(html.includes('<meta http-equiv="refresh" content="0; url=../v0.8.7/">'), true);
  assertEquals(html.includes('<link rel="canonical" href="../v0.8.7/">'), true);
  assertEquals(
    html.includes('window.location.replace("../v0.8.7/" + window.location.search + window.location.hash);'),
    true,
  );
  assertEquals(html.includes('<a href="../v0.8.7/">v0.8.7</a>'), true);
});

Deno.test("generateRecommendedRedirectHtml falls back to root when no tag is given", () => {
  const html = generateRecommendedRedirectHtml(undefined);
  assertEquals(html.includes('<meta http-equiv="refresh" content="0; url=../">'), true);
  assertEquals(html.includes('<link rel="canonical" href="../">'), true);
  assertEquals(
    html.includes('window.location.replace("../" + window.location.search + window.location.hash);'),
    true,
  );
  assertEquals(html.includes('<a href="../">latest</a>'), true);
});

Deno.test("writeRecommendedRedirect writes index.html under recommended/ directory", async () => {
  const dir = await Deno.makeTempDir();
  await writeRecommendedRedirect(dir, "v0.8.7");
  const content = await Deno.readTextFile(join(dir, RECOMMENDED_ALIAS_DIR, "index.html"));
  assertEquals(content.includes('<meta http-equiv="refresh" content="0; url=../v0.8.7/">'), true);
});

Deno.test("assembleMainPagesSite writes recommended redirect pointing to recommended version", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>root</html>",
    "versions.json": JSON.stringify({ versions: ["v0.8.7"], recommended: "v0.8.7" }),
    "v0.8.7/index.html": "<html>v0.8.7</html>",
    "v0.8.7/pages-files.txt": "index.html\n",
  });

  const dir = await Deno.makeTempDir();
  const rootDist = join(dir, "root-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(rootDist, { recursive: true });
  await Deno.writeTextFile(join(rootDist, "index.html"), "<html>main</html>");

  try {
    const manifest = await assembleMainPagesSite({
      baseUrl: live.baseUrl,
      rootDist,
      outDir,
    });
    assertEquals(manifest.recommended, "v0.8.7");
    const redirectHtml = await Deno.readTextFile(join(outDir, "recommended", "index.html"));
    assertEquals(redirectHtml.includes('<meta http-equiv="refresh" content="0; url=../v0.8.7/">'), true);
  } finally {
    await live.shutdown();
  }
});

Deno.test("assembleReleasePagesSite writes recommended redirect pointing to recommended version", async () => {
  const live = await serveLiveSite({
    "index.html": "<html>live</html>",
    "versions.json": JSON.stringify({ versions: ["v0.8.7"], recommended: "v0.8.7" }),
    "v0.8.7/index.html": "<html>v0.8.7</html>",
    "v0.8.7/pages-files.txt": "index.html\n",
  });

  const dir = await Deno.makeTempDir();
  const versionDist = join(dir, "version-dist");
  const outDir = join(dir, "out");
  await Deno.mkdir(versionDist, { recursive: true });
  await Deno.writeTextFile(join(versionDist, "index.html"), "<html>v0.9</html>");

  try {
    const manifest = await assembleReleasePagesSite({
      baseUrl: live.baseUrl,
      versionTag: "v0.9",
      versionDist,
      outDir,
    });
    assertEquals(manifest.recommended, "v0.8.7");
    const redirectHtml = await Deno.readTextFile(join(outDir, "recommended", "index.html"));
    assertEquals(redirectHtml.includes('<meta http-equiv="refresh" content="0; url=../v0.8.7/">'), true);
  } finally {
    await live.shutdown();
  }
});

Deno.test("generateRecommendedRedirectHtml rejects invalid version tags", () => {
  assertThrows(() => generateRecommendedRedirectHtml("invalid/path"));
  assertThrows(() => generateRecommendedRedirectHtml("<script>alert(1)</script>"));
  assertThrows(() => generateRecommendedRedirectHtml("1.0.0"));
});
