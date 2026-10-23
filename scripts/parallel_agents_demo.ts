/**
 * Three scripted MCP agents work on one desktop session in parallel, each in
 * its own leased subtree (S-15): the "parallel agents" tutorial demo and a
 * smoke test for leases.
 *
 *   deno run -A scripts/parallel_agents_demo.ts --url http://127.0.0.1:<port> [--bin <intEHRgrator binary>] [--load] [--hold 30] [--step 1.5]
 *
 * Each agent is its own stdio MCP process (the release binary with `--mcp`,
 * or `deno run src/agent/mcp_stdio.ts`), started with INTEHR_AGENT_URL like
 * an IDE would. With --load the first agent loads the blood pressure fixture.
 * --hold keeps the leases for that many seconds before release (screenshots);
 * --step is the pause between tool calls, so you can watch the canvas.
 */
import { join } from "@std/path";

function parseFlags(argv: string[]): Record<string, string | boolean | undefined> {
  const out: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]!] = m[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) out[m[1]!] = argv[++i];
    else out[m[1]!] = true;
  }
  return out;
}

const flags = parseFlags(Deno.args);
const str = (k: string) => (typeof flags[k] === "string" ? flags[k] as string : undefined);
const args = { url: str("url"), bin: str("bin"), hold: str("hold"), step: str("step"), token: str("token"), load: flags.load === true };
const url = args.url ?? Deno.env.get("INTEHR_AGENT_URL");
if (!url) {
  console.error("--url http://127.0.0.1:<port> (the desktop Agent API, see AI → Desktop → Local MCP server…)");
  Deno.exit(1);
}
const root = new URL("../", import.meta.url).pathname;
const holdSec = Number(args.hold ?? 0);
const stepMs = Number(args.step ?? 1.5) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal MCP stdio client: one JSON-RPC message per line, like IDE clients. */
class McpAgent {
  private child: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private pending = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>();
  private nextId = 1;

  constructor(readonly name: string, client: string) {
    const cmd = args.bin
      ? { command: args.bin, args: ["--mcp"] }
      : { command: Deno.execPath(), args: ["run", "-A", "--no-check", join(root, "src/agent/mcp_stdio.ts")] };
    this.child = new Deno.Command(cmd.command, {
      args: cmd.args,
      env: {
        INTEHR_AGENT_URL: url!,
        ...(args.token ? { INTEHR_AGENT_TOKEN: args.token } : {}),
        APPIMAGE_EXTRACT_AND_RUN: "1",
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    this.writer = this.child.stdin.getWriter();
    void this.read();
    this.clientName = client;
  }

  private clientName: string;

  private async read(): Promise<void> {
    let buf = "";
    for await (const chunk of this.child.stdout.pipeThrough(new TextDecoderStream())) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // The compiled desktop's native launcher prints "Runtime loaded…" lines
        // on stdout before the app starts; MCP clients skip non-JSON lines too.
        if (!line.startsWith("{")) continue;
        const msg = JSON.parse(line);
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
    }
  }

  private request(method: string, params: unknown): Promise<{ result?: unknown; error?: { message: string } }> {
    const id = this.nextId++;
    const done = new Promise<{ result?: unknown; error?: { message: string } }>((r) => this.pending.set(id, r));
    void this.writer.write(new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
    return done;
  }

  async init(): Promise<void> {
    const r = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: this.clientName, version: "demo" },
    });
    if (r.error) throw new Error(r.error.message);
    await this.writer.write(new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`));
  }

  /** Call a tool; returns { ok, data } (ok false for an isError result, e.g. a foreign lease). */
  async call(name: string, toolArgs: Record<string, unknown> = {}): Promise<{ ok: boolean; data: unknown; text: string }> {
    const r = await this.request("tools/call", { name, arguments: toolArgs });
    if (r.error) return { ok: false, data: null, text: r.error.message };
    const res = r.result as { content: Array<{ text: string }>; isError?: boolean };
    const text = res.content[0]?.text ?? "";
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch { /* plain text */ }
    return { ok: !res.isError, data, text };
  }

  log(msg: string): void {
    console.log(`[${new Date().toLocaleTimeString()}] ${this.name.padEnd(4)} ${msg}`);
  }

  async close(): Promise<void> {
    await this.writer.close().catch(() => {});
    await this.child.status;
  }
}

const tpl = "ehrbase_blood_pressure_simple.de.v0//";
const device = `${tpl}context/EVENT_CONTEXT/other_context/at0001/items/at0006/items/at0000`;
const reading = `${tpl}content/at0000/data/at0001/events/at0002/data/at0003`;
const state = `${tpl}content/at0000/data/at0001/events/at0002/state`;

const text = (t: string) => ({ type: "text", fields: { TEXT: t } });
const suggestions = (rows: Array<[string, unknown]>, note: string) =>
  JSON.stringify({
    format: "intehrgrator-suggestions",
    version: "2",
    suggestions: rows.map(([slotId, block]) => ({ slotId, block, note, confidence: 80 })),
  });

const ada = new McpAgent("Ada", "claude-code");
const bo = new McpAgent("Bo", "cursor");
const cy = new McpAgent("Cy", "cursor");
const agents = [ada, bo, cy];
await Promise.all(agents.map((a) => a.init()));

if (args.load) {
  const fx = join(root, "test/fixtures");
  await ada.call("load_target", { path: join(fx, "blood_pressure.opt") });
  await ada.call("load_source_schema", { path: join(fx, "dummy-json-vitals/source.schema.json") });
  await ada.call("add_example", { path: join(fx, "dummy-json-vitals/instance-1.json") });
  ada.log("loaded the blood pressure template, source schema and an example");
}

for (const a of agents) {
  const reg = await a.call("register_agent", { displayName: a.name });
  a.log(`registered (${(reg.data as { color?: string }).color ?? ""})`);
}

let failures = 0;
const expectOk = (a: McpAgent, what: string, r: { ok: boolean; text: string }) => {
  if (!r.ok) {
    failures++;
    a.log(`FAILED ${what}: ${r.text.slice(0, 200)}`);
  } else a.log(what);
};

const ttl = Math.max(120, holdSec + 60);
const lease = (a: McpAgent, slotId: string, label: string) =>
  a.call("lease_slot", { slotId, subtree: true, ttlSec: ttl }).then((r) => {
    const covers = (r.data as { lease?: { covers?: number } }).lease?.covers;
    expectOk(a, `leased subtree ${label} (${covers} slots)`, r);
  });

// 1. Everyone claims their part of the template before writing.
await Promise.all([
  lease(ada, device, "Device details"),
  lease(bo, reading, "blood pressure reading"),
  lease(cy, state, "state (position, tilt)"),
]);
await sleep(stepMs);

// 2. They work in parallel.
await Promise.all([
  (async () => {
    for (
      const [slot, value] of [
        ["items/at0001", "Omron M3"],
        ["items/at0004/items/at0003", "Omron Healthcare"],
        ["items/at0004/items/at0005", "HEM-7155-E"],
      ] as const
    ) {
      const r = await ada.call("import_suggestions", {
        text: suggestions([[`${device}/${slot}/value/DV_TEXT/value`, text(value)]], "Device from the clinic inventory"),
      });
      const report = (r.data as { report?: { applied: number } }).report;
      expectOk(ada, `set device ${slot.split("/").pop()} = "${value}" (applied ${report?.applied ?? 0})`, r);
      await sleep(stepMs);
    }
  })(),
  (async () => {
    expectOk(bo, "mapped Systolic ← $.systolic", await bo.call("map_slot", { slotId: `${reading}/items/at0004/value/value/value`, path: "$.systolic", confidence: 95 }));
    await sleep(stepMs);
    expectOk(bo, "mapped Diastolic ← $.diastolic", await bo.call("map_slot", { slotId: `${reading}/items/at0005/value/value/value`, path: "$.diastolic", confidence: 95 }));
    await sleep(stepMs);
  })(),
  (async () => {
    await sleep(stepMs / 2);
    // Cy tries a slot in Bo's subtree: refused with the holder; Cy moves on.
    const r = await cy.call("map_slot", { slotId: `${reading}/items/at0033/value/DV_TEXT/value`, path: "$.unit" });
    if (r.ok) {
      failures++;
      cy.log("FAILED: wrote into Bo's leased subtree");
    } else cy.log(`blocked as expected: ${r.text.split(".")[0]}`);
    await sleep(stepMs);
    const tilt = await cy.call("import_suggestions", {
      text: suggestions([[`${state}/at0007/items/at1005/value/value/value`, { type: "math_number", fields: { NUM: 0 } }]], "Seated, no tilt"),
    });
    expectOk(cy, "set Tilt = 0", tilt);
    await sleep(stepMs);
    // Cy's Undo would take back Bo's newest change: refused while Bo holds the lease.
    const undo = await cy.call("undo", {});
    if (undo.ok) cy.log(`undo went through: ${undo.text.slice(0, 120)}`);
    else cy.log(`undo refused while another agent leases what it would change: ${undo.text.split(".")[0]}`);
  })(),
]);

const leases = await ada.call("list_leases");
console.log(`\nActive leases: ${(leases.data as { leases: unknown[] }).leases.length}`);
if (holdSec > 0) {
  console.log(`Holding the leases for ${holdSec} s (take screenshots now)…`);
  await sleep(holdSec * 1000);
}

// 3. Done: everyone releases.
for (const a of agents) {
  const r = await a.call("release_slot", { all: true });
  a.log(`released ${(r.data as { released?: number }).released ?? 0} lease(s)`);
}
await Promise.all(agents.map((a) => a.close()));
if (failures) {
  console.error(`${failures} unexpected result(s)`);
  Deno.exit(1);
}
console.log("OK");
