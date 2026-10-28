/**
 * MCP stdio framing: IDE clients send one JSON-RPC message per line (MCP
 * spec); older callers used Content-Length frames. Before this fix only the
 * header framing was read, so Cursor / Claude Desktop / the MCP SDK never got
 * an initialize reply.
 */
import { assertEquals } from "@std/assert";
import { encodeMessage, handleMcpRequest, LocalAgentClient, takeMessages } from "@intehrgrator/agent/mcp_stdio.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("takeMessages reads newline-delimited JSON and keeps a partial line", () => {
  const { messages, rest } = takeMessages(enc('{"a":1}\n\n{"b":2}\r\n{"c":'));
  assertEquals(messages, [{ body: '{"a":1}', framing: "line" }, { body: '{"b":2}', framing: "line" }]);
  assertEquals(new TextDecoder().decode(rest), '{"c":');
});

Deno.test("takeMessages reads Content-Length frames, also mixed with lines", () => {
  const body = '{"x":"å"}';
  const frame = `Content-Length: ${enc(body).length}\r\n\r\n${body}`;
  const { messages, rest } = takeMessages(enc(`${frame}{"y":1}\n${frame.slice(0, 20)}`));
  assertEquals(messages, [{ body, framing: "content-length" }, { body: '{"y":1}', framing: "line" }]);
  assertEquals(new TextDecoder().decode(rest), frame.slice(0, 20));
});

Deno.test("encodeMessage answers in the caller's framing", () => {
  assertEquals(new TextDecoder().decode(encodeMessage({ a: 1 }, "line")), '{"a":1}\n');
  assertEquals(new TextDecoder().decode(encodeMessage({ a: 1 }, "content-length")), 'Content-Length: 7\r\n\r\n{"a":1}');
});

Deno.test("a failing tool is a tool result with isError, not a JSON-RPC error", async () => {
  const client = new LocalAgentClient(new WorkbenchService());
  const res = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "map_slot", arguments: { slotId: "nope", path: "/x" } },
  }, client) as { isError?: boolean; content: Array<{ text: string }> };
  assertEquals(res.isError, true);
  assertEquals(res.content[0]!.text.length > 0, true);
});
