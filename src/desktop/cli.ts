/**
 * Desktop / headless process flags. Parsed by the desktop entry and unit tests.
 */

export const DEFAULT_BIND = "127.0.0.1";

export interface DesktopCliOptions {
  help: boolean;
  headless: boolean;
  /** Stdio MCP proxy to INTEHR_AGENT_URL. Does not open a workbench. */
  mcp: boolean;
  port: number;
  bind: string;
  load?: string;
  token?: string;
  /** Manifest URLs for extra conversion-script languages. */
  languagePlugins: string[];
}

export const USAGE = `intEHRgrator — local Integration Workbench

Serves the workbench on 127.0.0.1 by default. \`deno desktop\` opens a native
window; \`deno run\` opens the default browser unless --headless is set.

\`deno task desktop\` forwards these flags. The same options can be set
with INTEHR_HELP, INTEHR_HEADLESS, INTEHR_MCP, PORT, INTEHR_BIND,
INTEHR_LOAD, INTEHR_AGENT_TOKEN, and INTEHR_LANGUAGE_PLUGINS.

Options:
  --help, -h          Show this help (or INTEHR_HELP=1)
  --headless          Do not open a browser or show a native window; keep
                      the Agent API HTTP server running (or INTEHR_HEADLESS=1)
  --port <n>          Listen port (default: PORT env, or 0 = ephemeral).
                      Ignored when Deno desktop sets DENO_SERVE_ADDRESS
  --bind <addr>       Listen address (default: INTEHR_BIND, or 127.0.0.1).
                      Non-loopback requires --token or INTEHR_AGENT_TOKEN
  --load <file>       Load a Project Bundle zip (.intehrgrator) or JSON at
                      start (or INTEHR_LOAD)
  --token <secret>    Agent API shared secret (or INTEHR_AGENT_TOKEN)
  --mcp               Speak MCP on stdin/stdout and proxy tools to
                      INTEHR_AGENT_URL. Does not open a workbench window.
                      An IDE launches the downloaded app this way.
                      (or INTEHR_MCP=1)
  --language-plugin <url>
                      Manifest URL for an extra conversion-script language.
                      Repeat the flag, or set INTEHR_LANGUAGE_PLUGINS to a
                      comma-separated list. The module loads lazily in a Deno
                      worker (net or read only). See docs/CONVERSION_SCRIPT_PLUGINS.md.
`;

export function isLoopbackBind(bind: string): boolean {
  const host = bind.trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" ||
    host === "0:0:0:0:0:0:0:1";
}

function envFlag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function takeValue(args: string[], i: number, flag: string): { value: string; next: number } {
  const cur = args[i]!;
  if (cur.startsWith(`${flag}=`)) return { value: cur.slice(flag.length + 1), next: i };
  const next = args[i + 1];
  if (!next || next.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return { value: next, next: i + 1 };
}

export function parseDesktopArgs(
  args: string[],
  env: Record<string, string | undefined> = {},
): DesktopCliOptions {
  const out: DesktopCliOptions = {
    help: envFlag(env.INTEHR_HELP),
    headless: envFlag(env.INTEHR_HEADLESS),
    mcp: envFlag(env.INTEHR_MCP),
    port: Number(env.PORT ?? 0),
    bind: env.INTEHR_BIND?.trim() || DEFAULT_BIND,
    load: env.INTEHR_LOAD?.trim() || undefined,
    token: env.INTEHR_AGENT_TOKEN?.trim() || undefined,
    languagePlugins: (env.INTEHR_LANGUAGE_PLUGINS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
  if (!Number.isFinite(out.port) || out.port < 0) out.port = 0;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a === "--headless") {
      out.headless = true;
      continue;
    }
    if (a === "--mcp") {
      out.mcp = true;
      continue;
    }
    if (a === "--port" || a.startsWith("--port=")) {
      const { value, next } = takeValue(args, i, "--port");
      i = next;
      out.port = Number(value);
      if (!Number.isFinite(out.port) || out.port < 0) {
        throw new Error(`Invalid --port: ${value}`);
      }
      continue;
    }
    if (a === "--bind" || a.startsWith("--bind=")) {
      const { value, next } = takeValue(args, i, "--bind");
      i = next;
      out.bind = value.trim() || DEFAULT_BIND;
      continue;
    }
    if (a === "--load" || a.startsWith("--load=")) {
      const { value, next } = takeValue(args, i, "--load");
      i = next;
      out.load = value;
      continue;
    }
    if (a === "--token" || a.startsWith("--token=")) {
      const { value, next } = takeValue(args, i, "--token");
      i = next;
      out.token = value;
      continue;
    }
    if (a === "--language-plugin" || a.startsWith("--language-plugin=")) {
      const { value, next } = takeValue(args, i, "--language-plugin");
      i = next;
      if (!out.languagePlugins.includes(value)) out.languagePlugins.push(value);
      continue;
    }
  }
  return out;
}

/**
 * `deno desktop` replaces the process arguments, so `deno task desktop`
 * turns the flags after `--` into the environment variables
 * {@link parseDesktopArgs} already reads. The returned map is a full
 * environment: start from `env` and overlay the flags.
 */
export function forwardDesktopArgsToEnv(
  args: string[],
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const opts = parseDesktopArgs(args, env);
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) next[key] = value;
  }
  if (opts.help) next.INTEHR_HELP = "1";
  if (opts.headless) next.INTEHR_HEADLESS = "1";
  if (opts.mcp) next.INTEHR_MCP = "1";
  next.PORT = String(opts.port);
  next.INTEHR_BIND = opts.bind;
  if (opts.load) next.INTEHR_LOAD = opts.load;
  if (opts.token) next.INTEHR_AGENT_TOKEN = opts.token;
  if (opts.languagePlugins.length) {
    next.INTEHR_LANGUAGE_PLUGINS = opts.languagePlugins.join(",");
  }
  return next;
}

/** Error message when a non-loopback bind has no token; undefined when OK. */
export function bindRequiresTokenMessage(opts: DesktopCliOptions): string | undefined {
  if (!isLoopbackBind(opts.bind) && !opts.token) {
    return "Non-loopback --bind requires --token or INTEHR_AGENT_TOKEN";
  }
  return undefined;
}
