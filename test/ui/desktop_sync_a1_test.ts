/**
 * Desktop UI ⇄ Agent API sync (ADR 0014, PR A1). Starts the desktop server
 * headless and drives its page with Playwright plus the HTTP Agent API.
 *
 * Regression for the data loss found on 2026-10-21: a mapping made in the UI
 * through the controller (Click-to-Map / drag-and-drop / AI tools / Import
 * Suggestions) was never committed to the session, the next MCP change synced
 * over it, and canvas Undo then restored a stale canvas that also dropped the
 * MCP change. Also checks the history origins: human, mcp with client, and
 * ai-chat (one entry and one undo step per turn).
 */
import { assert, assertEquals } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { diastolicSuffix, findSlotIdEndingWith, findSystolicSlotId, waitForTestApi } from "./helpers.ts";
import { patchEhrtslibValidator } from "../../scripts/patch-ehrtslib-validator.ts";

const root = new URL("../../", import.meta.url).pathname;
const port = 18_000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

interface Entry {
  seq: number;
  summary: string;
  kind: string;
  actor: { kind: string; id: string; displayName: string; origin?: string; client?: string; model?: string; turnId?: string };
}

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Agent-Id": "probe",
      "X-Agent-Name": "Probe",
      "X-Agent-Client": "test-client",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function history(): Promise<Entry[]> {
  const res = await fetch(`${base}/api/v1/history`);
  const json = await res.json() as { entries?: Entry[] };
  return json.entries ?? (json as unknown as Entry[]);
}

function expr(page: Page, slotId: string): Promise<string> {
  return page.evaluate((id) => {
    const api = (globalThis as unknown as {
      intehrgratorTestApi: { getSnapshot(): { model: { slots: Array<{ slotId: string; expression?: string }> } } };
    }).intehrgratorTestApi;
    return api.getSnapshot().model.slots.find((s) => s.slotId === id)?.expression ?? "";
  }, slotId);
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${what}`);
}

const undoCount = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { intehrgratorTestApi: { undoCount(): number } }).intehrgratorTestApi.undoCount()
  );

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
const toolCall = (id: string, args: Record<string, unknown>) => ({
  choices: [{
    index: 0,
    delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "map_slot", arguments: JSON.stringify(args) } }] },
  }],
});
const finish = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });

Deno.test({
  name: "UI (desktop): UI edits are committed before MCP syncs, MCP sync is one undo step, origins are recorded",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // The server imports the patched ehrtslib validator (`deno task vendor`);
    // the CI UI job only downloads dist/, so write the override when missing.
    try {
      await Deno.stat(`${root}vendor/ehrtslib-overrides/validation/template_validator.ts`);
    } catch {
      await patchEhrtslibValidator(root);
    }
    const server = new Deno.Command("deno", {
      args: ["run", "-A", "--no-check", "src/desktop/main.ts", "--headless", "--port", String(port)],
      cwd: root,
      env: { ...Deno.env.toObject(), INTEHR_AGENT_TOKEN: "" },
      stdout: "null",
      stderr: "piped",
    }).spawn();
    // Keep the server's stderr for a failed start.
    let serverLog = "";
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of server.stderr) serverLog = (serverLog + decoder.decode(chunk)).slice(-4000);
    })().catch(() => {});
    const browser = await chromium.launch({ headless: true });
    try {
      await waitFor(async () => {
        try {
          return (await fetch(`${base}/api/v1/health`)).ok;
        } catch {
          return false;
        }
      }, "desktop server", 60_000).catch((err) => {
        throw new Error(`${(err as Error).message}\n${serverLog}`);
      });
      const fx = `${root}test/fixtures`;
      await api("POST", "/register-agent", { agentId: "probe", displayName: "Probe" });
      await api("POST", "/load-target", { path: `${fx}/blood_pressure.opt` });
      await api("POST", "/load-source-schema", { path: `${fx}/dummy-json-vitals/source.schema.json` });
      await api("POST", "/add-example", { path: `${fx}/dummy-json-vitals/instance-1.json` });
      const loaded = (await history()).length;

      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.on("dialog", (d) => void d.accept());
      await page.goto(`${base}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await waitFor(
        () =>
          page.evaluate(() =>
            (globalThis as unknown as { intehrgratorTestApi: { findSlotIdBySuffix(s: string): string | null } })
              .intehrgratorTestApi.findSlotIdBySuffix("items/at0004/value/value/value") !== null
          ),
        "UI synced the agent's project",
        20_000,
      );
      const sys = await findSystolicSlotId(page);
      const dia = await findSlotIdEndingWith(page, diastolicSuffix);

      // 1. A controller-originated UI change is committed as the person.
      await page.evaluate((id) =>
        (globalThis as unknown as { intehrgratorTestApi: { mapNodeToSlot(a: string, b: string, c: string): void } })
          .intehrgratorTestApi.mapNodeToSlot(id, "$.systolic", "json"), sys);
      await waitFor(async () => (await history()).length > loaded, "UI commit in history");
      const human = (await history()).at(-1)!;
      assertEquals(human.actor.origin, "human");
      assertEquals(human.actor.displayName, "You");

      // 2. An MCP change lands on top of it; nothing is lost.
      const before = await undoCount(page);
      await api("POST", "/map-slot", { slotId: dia, path: "$.diastolic", format: "json" });
      await waitFor(async () => (await expr(page, dia)).includes("diastolic"), "MCP change synced");
      assert((await expr(page, sys)).includes("systolic"), "UI mapping survives the MCP sync");
      const mcp = (await history()).find((e) => e.kind === "map_slot")!;
      assertEquals(mcp.actor.origin, "mcp");
      assertEquals(mcp.actor.client, "test-client");
      assertEquals(await undoCount(page), before + 1, "the MCP sync is one undo step");

      // 3. Undo takes back the MCP change only, and the session records it.
      const count = (await history()).length;
      await page.click("#btn-undo");
      await waitFor(async () => !(await expr(page, dia)).includes("diastolic"), "undo of the MCP change");
      assert((await expr(page, sys)).includes("systolic"), "undo keeps the earlier UI mapping");
      await waitFor(async () => (await history()).length > count, "undo committed");
      assertEquals((await history()).at(-1)!.actor.origin, "human");

      // 4. An AI chat turn with two map_slot calls: one ai-chat entry, one undo step.
      await page.evaluate(() => {
        localStorage.setItem("intehrgrator.ai.chatCollapsed", "0");
        localStorage.setItem(
          "intehrgrator.ai.credentials",
          JSON.stringify({
            endpoint: "https://ai-a1.test/v1/chat/completions",
            apiKey: "test-key",
            model: "stub-model",
            providerId: "custom",
          }),
        );
      });
      let step = 0;
      await page.route("**/api/v1/ai-chat-completions", async (route) => {
        step++;
        const body = step === 1
          ? sse([toolCall("t1", { slotId: dia, path: "$.diastolic" }), finish("tool_calls")])
          : step === 2
          ? sse([toolCall("t2", { slotId: sys, path: "$.diastolic" }), finish("tool_calls")])
          : sse([{ choices: [{ index: 0, delta: { content: "Done." } }] }, finish("stop")]);
        await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
      });
      if (await page.locator("#ai-chat-toggle").getAttribute("aria-expanded") !== "true") {
        await page.click("#ai-chat-toggle");
      }
      await page.locator("#ai-chat-input").click();
      await page.keyboard.type("Map diastolic");
      const undoBeforeTurn = await undoCount(page);
      const countBeforeTurn = (await history()).length;
      await page.click("#ai-chat-send");
      await page.locator("#ai-chat-revert").waitFor({ state: "visible", timeout: 20_000 });
      await waitFor(async () => {
        const last = (await history()).at(-1)!;
        return last.actor.origin === "ai-chat" && last.summary.split(";").length >= 2;
      }, "AI turn committed");
      const entries = await history();
      assertEquals(entries.length, countBeforeTurn + 1, "one history entry per AI turn");
      const ai = entries.at(-1)!;
      assertEquals(ai.actor.model, "stub-model");
      assertEquals(ai.actor.displayName, "AI chat (stub-model)");
      assert(ai.actor.turnId, "turn id recorded");
      assertEquals(await undoCount(page) - undoBeforeTurn, 2, "two canvas swaps, grouped");
      // A2 (ADR 0014): the chat writes through callAgentTool on a service around
      // the live controller; the canvas is not reloaded and the committed bundle
      // is what the canvas shows.
      const live = JSON.parse(await page.evaluate(() =>
        (globalThis as unknown as { intehrgratorTestApi: { getBlocklyStateJson(): string } }).intehrgratorTestApi
          .getBlocklyStateJson()
      )) as unknown;
      const backend = await api("GET", "/bundle") as { bundle: { mapping: { blocklyState: unknown } } };
      assertEquals(backend.bundle.mapping.blocklyState, live, "the service's bundle is the live canvas");
      assertEquals(
        (await page.evaluate(() =>
          (globalThis as unknown as { intehrgratorTestApi: { undoEventTypes(): string[] } }).intehrgratorTestApi
            .undoEventTypes()
        )).slice(-2).every((t) => t === "intehr_canvas_swap"),
        true,
        "chat writes are canvas swaps, not reloads",
      );
      assert(JSON.stringify(live).includes("$.diastolic"), "live canvas shows the AI mapping");
      await page.click("#btn-undo");
      await waitFor(async () => (await expr(page, sys)).includes("systolic"), "one Undo reverts the whole turn");
      assert(!(await expr(page, dia)).includes("diastolic"), "both AI mappings undone by one Undo");
    } finally {
      await browser.close();
      try {
        server.kill("SIGTERM");
      } catch {
        // already gone
      }
      await server.status;
    }
  },
});
