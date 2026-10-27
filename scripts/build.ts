import * as esbuild from "npm:esbuild@0.25.0";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@0.11.0";
import { copy, ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { fetchEhrtslibTerminologyXml } from "../src/core/ehrtslib_cdn.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const outDir = join(root, "dist");
const configPath = join(root, "deno.json");
const vscodeExternal: esbuild.Plugin = {
  name: "vscode-external",
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", external: true }));
  },
};

async function resolveBuildId(): Promise<string> {
  try {
    const { success, stdout } = await new Deno.Command("git", {
      args: ["rev-parse", "--short=7", "HEAD"],
      cwd: root,
      stdout: "piped",
      stderr: "null",
    }).output();
    if (success) {
      const hash = new TextDecoder().decode(stdout).trim();
      if (hash) return hash;
    }
  } catch {
    // git unavailable
  }
  return crypto.randomUUID().slice(0, 8);
}

const buildId = await resolveBuildId();
const buildTimestamp = new Date().toISOString();

await ensureDir(outDir);

const xmlEmbedPlugin: esbuild.Plugin = {
  name: "openehr-term-xml-embed",
  setup(build) {
    build.onResolve({ filter: /openehr_term_xml_embed\.ts$/ }, () => ({
      path: join(root, "src/core/openehr_term_xml_embed.ts"),
      namespace: "openehr-term-xml",
    }));
    build.onLoad({ filter: /.*/, namespace: "openehr-term-xml" }, async () => {
      const { en, ext } = await fetchEhrtslibTerminologyXml();
      return {
        contents:
          `export function openEhrTerminologyXml() {\n` +
          `  return {\n` +
          `    en: ${JSON.stringify(en)},\n` +
          `    ext: ${JSON.stringify(ext)},\n` +
          `  };\n` +
          `}\n`,
        loader: "js",
      };
    });
  },
};

await esbuild.build({
  absWorkingDir: root,
  plugins: [xmlEmbedPlugin, ...denoPlugins({ configPath })],
  entryPoints: ["web/main.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    "__BUILD_ID__": JSON.stringify(buildId),
    "__BUILD_TIMESTAMP__": JSON.stringify(buildTimestamp),
  },
});

await esbuild.build({
  absWorkingDir: root,
  plugins: [...denoPlugins({ configPath })],
  entryPoints: ["web/better_form_viewer.ts"],
  bundle: true,
  outfile: "dist/better_form_viewer.js",
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
});

await esbuild.build({
  absWorkingDir: root,
  plugins: [xmlEmbedPlugin, vscodeExternal, ...denoPlugins({ configPath })],
  entryPoints: ["extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  // The mapping workbench never uses jsdom's synchronous XMLHttpRequest worker.
  // Its relative require.resolve cannot survive bundling into extension.js.
  define: { "require.resolve": "undefined" },
  format: "cjs",
  target: "node18",
  platform: "node",
  sourcemap: true,
  external: ["vscode"],
});

await copy(join(root, "web", "index.html"), join(outDir, "index.html"), { overwrite: true });
await copy(join(root, "web", "styles.css"), join(outDir, "styles.css"), { overwrite: true });
const shoelaceThemeDir = join(outDir, "vendor", "shoelace", "themes");
await ensureDir(shoelaceThemeDir);
await copy(
  join(root, "node_modules", "@shoelace-style", "shoelace", "dist", "themes", "light.css"),
  join(shoelaceThemeDir, "light.css"),
  { overwrite: true },
);
await copy(join(root, "web", "manifest.webmanifest"), join(outDir, "manifest.webmanifest"), {
  overwrite: true,
});
await copy(join(root, "web", "sw.js"), join(outDir, "sw.js"), { overwrite: true });
{
  const swPath = join(outDir, "sw.js");
  const sw = await Deno.readTextFile(swPath);
  // Stamp with git hash + build time so dirty rebuilds on the same HEAD still
  // rotate the cache (otherwise cache-first shell assets can stick forever).
  const cacheStamp = `${buildId}-${buildTimestamp}`;
  await Deno.writeTextFile(
    swPath,
    sw.replace(
      'const CACHE_NAME = CACHE_PREFIX + (self.registration?.scope ?? "app");',
      `const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(cacheStamp)};`,
    ),
  );
}
await copy(join(root, "web", "icons"), join(outDir, "icons"), { overwrite: true });
const jssCssDir = join(outDir, "vendor", "jspreadsheet");
await ensureDir(jssCssDir);
await copy(
  join(root, "node_modules", "jspreadsheet-ce", "dist", "jspreadsheet.css"),
  join(jssCssDir, "jspreadsheet.css"),
  { overwrite: true },
);
await copy(
  join(root, "node_modules", "jsuites", "dist", "jsuites.css"),
  join(jssCssDir, "jsuites.css"),
  { overwrite: true },
);
await copy(join(root, "web", "wasm"), join(outDir, "wasm"), { overwrite: true });
await copy(
  join(root, "web", "better-form-viewer.html"),
  join(outDir, "better-form-viewer.html"),
  { overwrite: true },
);
await copy(join(root, "docs"), join(outDir, "docs"), { overwrite: true, recursive: true });
await copy(join(root, "examples"), join(outDir, "examples"), { overwrite: true, recursive: true });
await copy(join(root, "function-library"), join(outDir, "function-library"), {
  overwrite: true,
  recursive: true,
});
await copy(join(root, "test", "fixtures"), join(outDir, "test", "fixtures"), {
  overwrite: true,
  recursive: true,
});
esbuild.stop();
console.log(`Built dist/ (${buildId} @ ${buildTimestamp})`);
