/**
 * Serve a single static HTML (or a directory root) for throwaway prototypes.
 * Usage: deno run -A scripts/serve-file.ts web/prototype-….html
 */
import { serveDir } from "@std/http/file-server";
import { dirname, fromFileUrl, join, basename } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const rel = Deno.args[0];
if (!rel) {
  console.error("Usage: deno run -A scripts/serve-file.ts <path-under-repo>");
  Deno.exit(1);
}

const target = join(root, rel);
const st = await Deno.stat(target);
const port = Number(Deno.env.get("PORT") ?? 5188);
const fsRoot = st.isDirectory ? target : dirname(target);
const fileName = st.isDirectory ? "" : basename(target);

console.log(`Serving http://localhost:${port}/${fileName}`);
console.log(`  root: ${fsRoot}`);

Deno.serve({ port }, (req) =>
  serveDir(req, { fsRoot, showDirListing: true, enableCors: true, quiet: true }),
);
