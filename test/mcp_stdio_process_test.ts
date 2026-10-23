/**
 * `mcp_stdio.ts` as a process, spoken to the way IDE MCP clients (Cursor,
 * Claude Desktop, the MCP SDK's StdioClientTransport) do: one JSON-RPC
 * message per line on stdin, one reply per line on stdout.
 */
import { assert, assertEquals } from "@std/assert";

const root = new URL("../", import.meta.url).pathname;

Deno.test({
  name: "MCP stdio process answers newline-delimited initialize, tools/list and tools/call",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const env = { ...Deno.env.toObject() };
    delete env.INTEHR_AGENT_URL;
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-check", `${root}src/agent/mcp_stdio.ts`],
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const writer = child.stdin.getWriter();
    const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    const send = (msg: unknown) => writer.write(new TextEncoder().encode(`${JSON.stringify(msg)}\n`));
    const next = async () => {
      const timer = setTimeout(() => child.kill(), 30_000);
      while (!pending.includes("\n")) {
        const { value, done } = await lines.read();
        if (done) break;
        pending += value;
      }
      clearTimeout(timer);
      const nl = pending.indexOf("\n");
      const line = nl < 0 ? pending : pending.slice(0, nl);
      pending = nl < 0 ? "" : pending.slice(nl + 1);
      return JSON.parse(line || "null");
    };
    try {
      await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "line-client", version: "1" } },
      });
      assertEquals((await next()).result.serverInfo.name, "intehrgrator");
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      const listed = await next();
      assertEquals(listed.id, 2);
      assert(listed.result.tools.some((t: { name: string }) => t.name === "lease_slot"));
      await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "map_slot", arguments: { slotId: "nope", path: "/x" } } });
      const bad = await next();
      assertEquals(bad.id, 3);
      assertEquals(bad.result.isError, true);
    } finally {
      await writer.close().catch(() => {});
      await lines.cancel().catch(() => {});
      await child.status;
    }
  },
});
