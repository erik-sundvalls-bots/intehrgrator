import { serveDir } from "@std/http/file-server";
import { join } from "@std/path";
import { isLoopbackBind } from "./cli.ts";

export function workbenchHandler(webRoot: string): (req: Request) => Promise<Response> {
  return async (req) => {
    const html = await tryIndexHtml(webRoot, req);
    if (html) return html;
    const dat = await tryDatAsset(webRoot, req);
    if (dat) return dat;
    return await serveDir(req, {
      fsRoot: webRoot,
      quiet: true,
      showDirListing: false,
    });
  };
}

async function tryIndexHtml(webRoot: string, req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "" || rel === "index.html") {
    try {
      const html = await Deno.readTextFile(join(webRoot, "index.html"));
      const script = desktopBootstrapScript(url.hostname);
      const injected = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (match) => `${match}${script}`)
        : `${script}${html}`;
      return new Response(injected, { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch {
      return null;
    }
  }
  return null;
}

/** Loopback pages may see the token so the MCP panel can show IDE settings. */
function desktopBootstrapScript(hostname: string): string {
  const token = Deno.env.get("INTEHR_AGENT_TOKEN")?.trim();
  if (token && isLoopbackBind(hostname)) {
    return `<script>window.__INTEHR_DESKTOP__=true;window.__INTEHR_AGENT_TOKEN__=${JSON.stringify(token)};</script>`;
  }
  return "<script>window.__INTEHR_DESKTOP__=true;</script>";
}

/** JS is staged as `*.js.dat` so `deno desktop --include` will not execute it. */
async function tryDatAsset(webRoot: string, req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return null;
  try {
    const bytes = await Deno.readFile(join(webRoot, `${rel}.dat`));
    return new Response(bytes, { headers: { "content-type": contentTypeFor(rel) } });
  } catch {
    return null;
  }
}

function contentTypeFor(rel: string): string {
  if (rel.endsWith(".js") || rel.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (rel.endsWith(".css")) return "text/css; charset=utf-8";
  if (rel.endsWith(".json")) return "application/json; charset=utf-8";
  if (rel.endsWith(".html")) return "text/html; charset=utf-8";
  if (rel.endsWith(".png")) return "image/png";
  if (rel.endsWith(".svg")) return "image/svg+xml";
  if (rel.endsWith(".gif")) return "image/gif";
  if (rel.endsWith(".cur")) return "image/x-icon";
  if (rel.endsWith(".mp3")) return "audio/mpeg";
  if (rel.endsWith(".ogg")) return "audio/ogg";
  if (rel.endsWith(".wav")) return "audio/wav";
  if (rel.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

export function errorPageHandler(message: string): (req: Request) => Promise<Response> {
  const body =
    `<!doctype html><html><head><meta charset="utf-8"><title>intEHRgrator</title></head>` +
    `<body><h1>intEHRgrator could not start</h1><pre>${escapeHtml(message)}</pre></body></html>`;
  return () =>
    Promise.resolve(
      new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
