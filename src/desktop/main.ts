/**
 * intEHRgrator desktop workbench.
 *
 * `deno desktop` already creates a hidden native window and reveals it after
 * the local HTTP server answers. Do not construct `Deno.BrowserWindow` at
 * startup — adopting that window before `Deno.serve()` leaves it hidden
 * forever on Windows (MainWindowHandle stays 0). Official pattern:
 * https://docs.deno.com/runtime/desktop/
 *
 * `--headless` is the exception: adopt the startup window after serve and hide
 * it so the Agent API keeps running without a workbench UI.
 */
import { resolveWebRoot } from "./web_root.ts";
import { errorPageHandler, workbenchHandler } from "./serve.ts";
import { HttpAgentClient, runMcpStdio } from "../agent/mcp_stdio.ts";
import { composeWorkbenchHandler, getSharedWorkbenchService } from "../agent/http.ts";
import {
  bindRequiresTokenMessage,
  parseDesktopArgs,
  USAGE,
  type DesktopCliOptions,
} from "./cli.ts";

async function openBrowser(url: string): Promise<void> {
  const cmd = Deno.build.os === "windows"
    ? new Deno.Command("cmd", { args: ["/c", "start", "", url] })
    : Deno.build.os === "darwin"
    ? new Deno.Command("open", { args: [url] })
    : new Deno.Command("xdg-open", { args: [url] });
  const child = cmd.spawn();
  await child.status;
}

export function shouldOpenUi(opts: DesktopCliOptions): boolean {
  return !opts.headless && !opts.mcp;
}

type BrowserWindowHandle = {
  hide?: () => void;
  isVisible?: () => boolean;
  onload?: (() => void) | null;
};

type DenoDesktop = typeof Deno & {
  BrowserWindow?: new (options: Record<string, unknown>) => BrowserWindowHandle;
};

/**
 * Adopt the Deno desktop startup window and hide it (`--headless`, `--mcp`).
 * With `watch`, also hide it within 250 ms whenever it shows (no flash).
 */
export function hideDesktopWindow(watch = false): void {
  const Ctor = (Deno as DenoDesktop).BrowserWindow;
  if (!Ctor) return;
  try {
    const win = new Ctor({ url: "about:blank", noActivate: true, visible: false });
    win.hide?.();
    // The runtime shows the window again when it navigates it (to the app,
    // or after ~15 s without a server): hide it again after every load.
    win.onload = () => win.hide?.();
    if (watch && win.isVisible) {
      const timer = setInterval(() => {
        if (win.isVisible?.()) win.hide?.();
      }, 250);
      Deno.unrefTimer(timer);
    }
  } catch {
    try {
      const win = new Ctor({ url: "about:blank", noActivate: true });
      win.hide?.();
    } catch {
      // `deno run` has no native window.
    }
  }
}

export function workbenchOrErrorHandler(
  metaDirname: string | undefined,
  metaUrl: string,
  enableAgentApi = Deno.env.get("INTEHR_AGENT_API") !== "0",
  token?: string,
): (req: Request) => Promise<Response> {
  let staticHandler: (req: Request) => Promise<Response>;
  try {
    staticHandler = workbenchHandler(resolveWebRoot(metaDirname ?? ".", metaUrl));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    staticHandler = errorPageHandler(message);
  }
  return composeWorkbenchHandler(staticHandler, enableAgentApi, { token });
}

function envMap(): Record<string, string | undefined> {
  return {
    PORT: Deno.env.get("PORT"),
    INTEHR_BIND: Deno.env.get("INTEHR_BIND"),
    INTEHR_AGENT_TOKEN: Deno.env.get("INTEHR_AGENT_TOKEN"),
  };
}

if (import.meta.main) {
  let opts: DesktopCliOptions;
  try {
    opts = parseDesktopArgs(Deno.args, envMap());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    Deno.exit(0);
  }
  const tokenErr = bindRequiresTokenMessage(opts);
  if (tokenErr) {
    console.error(tokenErr);
    Deno.exit(1);
  }
  if (opts.token) Deno.env.set("INTEHR_AGENT_TOKEN", opts.token);

  if (opts.mcp) {
    // An IDE starts this as its MCP server: no window. The compiled app
    // showed an empty "Could not connect" window per MCP process (the runtime
    // navigates the startup window after ~15 s without a server).
    hideDesktopWindow(true);
    const base = Deno.env.get("INTEHR_AGENT_URL")?.trim();
    if (!base) {
      console.error(
        "intEHRgrator --mcp requires INTEHR_AGENT_URL pointing at a running workbench",
      );
      Deno.exit(1);
    }
    await runMcpStdio(new HttpAgentClient(base.replace(/\/$/, ""), opts.token));
    // stdin closed (the IDE stopped the server): exit even though the desktop
    // runtime would keep the process alive.
    Deno.exit(0);
  } else {
    if (opts.load) {
      const bytes = await Deno.readFile(opts.load);
      getSharedWorkbenchService().loadBundleFile(bytes);
    }

    const handler = workbenchOrErrorHandler(
      import.meta.dirname,
      import.meta.url,
      Deno.env.get("INTEHR_AGENT_API") !== "0",
      opts.token,
    );
    const desktopAddr = Deno.env.get("DENO_SERVE_ADDRESS");
    if (desktopAddr) {
      // Bind the port the webview already plans to open. Passing hostname/port
      // here can desync the server from the hidden startup window.
      Deno.serve(handler);
      if (opts.headless) hideDesktopWindow();
    } else {
      Deno.serve({
        hostname: opts.bind,
        port: opts.port,
        onListen({ hostname, port }) {
          const url = `http://${hostname}:${port}/`;
          console.log(`intEHRgrator ${url}${opts.headless ? " (headless)" : ""}`);
          if (shouldOpenUi(opts)) void openBrowser(url);
        },
      }, handler);
    }
  }
}
