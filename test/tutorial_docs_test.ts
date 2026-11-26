/**
 * Keeps the user tutorials (docs/TUTORIAL.md, docs/tutorial/*.md) honest
 * without a browser:
 * - every relative link, anchor and image resolves;
 * - every screenshot in docs/assets/tutorial/ is used by some doc;
 * - every **bold** UI label a tutorial tells the reader to click still exists
 *   in the English UI sources, the Example Set catalog or the Function library.
 *
 * Bold text that is prose emphasis (not a UI label) goes in PROSE_EMPHASIS.
 * The screenshots themselves are retaken with scripts/tutorial_screenshots.ts
 * (and the hint / AI / parallel-agents scripts) against a running build.
 */
import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, normalize, relative } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const docsDir = join(root, "docs");
const tutorialDir = join(docsDir, "tutorial");
const assetsDir = join(docsDir, "assets", "tutorial");

/** Emphasis in prose: not something the reader finds on screen. */
const PROSE_EMPHASIS = new Set<string>([
  // TUTORIAL.md
  "Verify mapping", // the future feature, named as such
  // basic-mapping.md
  "Web (recommended):",
  "Web (latest / bleeding-edge):",
  "Pinned web versions:",
  "VS Code extension:",
  "Extensions: Install from VSIX…", // VS Code's own command
  "intEHRgrator: Create File Project", // VS Code extension commands (extension/)
  "intEHRgrator: Open File Project",
  "intEHRgrator: Open Integration Workbench",
  "Headless:",
  "active tab",
  "listening mode",
  "active example tree",
  "families",
  "Mapped, decision tables",
  "on your computer",
  // ai-in-the-web-app.md
  "✓ Mapped …",
  "input vs output",
  "Raise budget … and continue",
  // desktop-and-local-ai.md / parallel-agents.md
  "node by node",
  "openEHR assistant",
  "DeepWiki",
  "MCP Bo · cursor",
  "Cy",
  // functions.md
  "insert at last",
  "equivalent",
  "no form/route fields",
  // sheets-and-decision-tables.md
  "mapped, decision tables",
  "and connects its reader block to the target slot",
  "source starts blank",
  // treemap.md
  "container tile",
  "leaf tile",
  "done/total",
  "filter chips",
  "✦ AI drafts",
  // value-set-hints.md
  "Hints 💡 count",
  "💡 badge",
  "term pick",
  "one row Map",
  "inputs → source",
  "match value",
  "don't care",
]);

async function tutorialFiles(): Promise<string[]> {
  const files = [join(docsDir, "TUTORIAL.md")];
  for await (const entry of Deno.readDir(tutorialDir)) {
    if (entry.isFile && entry.name.endsWith(".md")) files.push(join(tutorialDir, entry.name));
  }
  return files.sort();
}

function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) slugs.add(githubSlug(m[1]));
  }
  return slugs;
}

function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

async function uiCorpus(): Promise<string> {
  const parts: string[] = [
    await Deno.readTextFile(join(root, "web", "index.html")),
    await Deno.readTextFile(join(root, "web", "main.ts")),
    await Deno.readTextFile(join(root, "examples", "example-sets.json")),
    await Deno.readTextFile(join(root, "function-library", "catalog.json")),
  ];
  for await (const entry of walk(join(root, "src"), { exts: [".ts"], skip: [/[\\/]desktop[\\/]www[\\/]/] })) {
    parts.push(await Deno.readTextFile(entry.path));
  }
  return parts.join("\n")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&rarr;", "→");
}

Deno.test("tutorial links, anchors and images resolve", async () => {
  const problems: string[] = [];
  for (const file of await tutorialFiles()) {
    const text = stripCode(await Deno.readTextFile(file));
    const targets = [
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ];
    for (const target of targets) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [path, anchor] = target.split("#");
      const resolved = path ? normalize(join(dirname(file), path)) : file;
      const label = `${relative(root, file)} → ${target}`;
      let content: string;
      try {
        const stat = await Deno.stat(resolved);
        if (!stat.isFile) {
          if (anchor) problems.push(`${label}: anchor on a directory`);
          continue;
        }
        content = resolved.endsWith(".md") ? await Deno.readTextFile(resolved) : "";
      } catch {
        problems.push(`${label}: missing file`);
        continue;
      }
      if (anchor && resolved.endsWith(".md") && !headingSlugs(content).has(anchor)) {
        problems.push(`${label}: no heading #${anchor}`);
      }
    }
  }
  assertEquals(problems, []);
});

Deno.test("every tutorial screenshot is used by a doc", async () => {
  const used = new Set<string>();
  for await (const entry of walk(docsDir, { exts: [".md"] })) {
    const text = await Deno.readTextFile(entry.path);
    for (const m of text.matchAll(/assets\/tutorial\/([\w.-]+\.(?:png|jpg|gif|webp))/g)) used.add(m[1]);
  }
  const unused: string[] = [];
  for await (const entry of Deno.readDir(assetsDir)) {
    if (entry.isFile && !used.has(entry.name)) unused.push(entry.name);
  }
  assertEquals(unused.sort(), []);
});

Deno.test("bold UI labels in the tutorials exist in the UI or a bundled catalog", async () => {
  const corpus = await uiCorpus();
  const missing: string[] = [];
  for (const file of await tutorialFiles()) {
    const text = stripCode(await Deno.readTextFile(file));
    for (const m of text.matchAll(/\*\*([^*]+)\*\*/g)) {
      const term = m[1].trim();
      if (PROSE_EMPHASIS.has(term)) continue;
      // Menu paths ("Settings → Animations", "AI ▾ → Languages…"): check each step.
      const steps = term.split(/\s+(?:▾\s+)?→\s+/).map((s) => s.replace(/^`|`$/g, "").trim());
      for (const step of steps) {
        if (!corpus.includes(step)) missing.push(`${relative(root, file)}: **${term}** (${step})`);
      }
    }
  }
  assertEquals(missing, [], "Fix the tutorial, or add prose emphasis to PROSE_EMPHASIS");
});

Deno.test("the tutorial index lists every lecture", async () => {
  const index = await Deno.readTextFile(join(docsDir, "TUTORIAL.md"));
  for (const file of await tutorialFiles()) {
    if (file.endsWith("TUTORIAL.md")) continue;
    const name = relative(docsDir, file).replaceAll("\\", "/");
    assert(index.includes(`(${name})`), `docs/TUTORIAL.md does not link ${name}`);
  }
});
