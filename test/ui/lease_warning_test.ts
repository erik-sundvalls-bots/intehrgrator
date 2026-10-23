/**
 * Lease warning (S-15, ADR 0014): before the person's change to something an
 * MCP agent leases is saved, a dialog asks, with a live countdown to the end
 * of the lease. Cancel takes the change back; Edit anyway saves it, stops
 * asking about that lease, and the agent's next write there is refused (the
 * person wins); when the lease ends the dialog closes and the change is saved.
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { chromium, type Page } from "npm:playwright@1.51.0";
import { diastolicSuffix, findSlotIdEndingWith, findSystolicSlotId, waitForTestApi } from "./helpers.ts";
import { patchEhrtslibValidator } from "../../scripts/patch-ehrtslib-validator.ts";

const root = new URL("../../", import.meta.url).pathname;
const port = 19_000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

async function api(agent: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Agent-Id": agent.toLowerCase(),
      "X-Agent-Name": agent,
      "X-Agent-Client": "test-client",
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
}

async function ok(agent: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await api(agent, path, body);
  if (res.status >= 300) throw new Error(`${path}: ${JSON.stringify(res.json)}`);
  return res.json;
}

async function historyLength(): Promise<number> {
  const json = await (await fetch(`${base}/api/v1/history`)).json() as { entries?: unknown[] };
  return (json.entries ?? (json as unknown as unknown[])).length;
}

function expr(page: Page, slotId: string): Promise<string> {
  return page.evaluate((id) => {
    const api = (globalThis as unknown as {
      intehrgratorTestApi: { getSnapshot(): { model: { slots: Array<{ slotId: string; expression?: string }> } } };
    }).intehrgratorTestApi;
    return api.getSnapshot().model.slots.find((s) => s.slotId === id)?.expression ?? "";
  }, slotId);
}

function mapInUi(page: Page, slotId: string, path: string): Promise<void> {
  return page.evaluate(([id, p]) =>
    (globalThis as unknown as { intehrgratorTestApi: { mapNodeToSlot(a: string, b: string, c: string): void } })
      .intehrgratorTestApi.mapNodeToSlot(id, p, "json"), [slotId, path]);
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${what}`);
}

Deno.test({
  name: "UI (desktop): editing inside an agent's lease asks first, with a countdown; Cancel, Edit anyway, lease end",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
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
      await ok("Bo", "/register-agent", { agentId: "bo", displayName: "Bo" });
      await ok("Bo", "/load-target", { path: `${fx}/blood_pressure.opt` });
      await ok("Bo", "/load-source-schema", { path: `${fx}/dummy-json-vitals/source.schema.json` });

      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
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
      const reading = sys.slice(0, sys.indexOf("/items/at0004"));
      await ok("Bo", "/lease-slot", { slotId: reading, subtree: true, ttlSec: 300 });
      const dialog = page.locator("#dialog-lease-warning");
      await waitFor(async () => await page.locator("#lease-chip").isVisible(), "lease chip");

      // 1. Your change inside Bo's lease is held and asked about, with a countdown.
      const entries = await historyLength();
      await mapInUi(page, sys, "$.systolic");
      await dialog.waitFor({ state: "visible" });
      assertStringIncludes(await dialog.innerText(), "Bo");
      const countdown = page.locator("#lease-warning-list .lease-countdown").first();
      assertMatch(await countdown.innerText(), /lease ends in [45]:\d\d/);
      const first = await countdown.innerText();
      await page.waitForTimeout(1300);
      assert((await countdown.innerText()) !== first, "the countdown runs");
      assertEquals(await historyLength(), entries, "nothing saved while the warning is open");

      // 2. Cancel takes it back.
      await page.click("#lease-warning-cancel");
      await dialog.waitFor({ state: "hidden" });
      await waitFor(async () => !(await expr(page, sys)).includes("systolic"), "Cancel took the change back");
      assertStringIncludes(await page.locator("#status-main").innerText(), "taken back");
      await page.waitForTimeout(1600);
      assertEquals(await historyLength(), entries, "a cancelled change is not saved");

      // 3. Edit anyway saves it; no second question inside the same lease.
      await mapInUi(page, sys, "$.systolic");
      await dialog.waitFor({ state: "visible" });
      await page.click("#lease-warning-edit");
      await dialog.waitFor({ state: "hidden" });
      await waitFor(async () => (await historyLength()) > entries, "Edit anyway saved the change");
      assertStringIncludes(await page.locator("#status-main").innerText(), "your change stays");
      const afterEdit = await historyLength();
      await mapInUi(page, dia, "$.diastolic");
      await waitFor(async () => (await historyLength()) > afterEdit, "second edit in the same lease saved");
      assert(!(await dialog.isVisible()), "asked once per lease");

      // 4. The person wins: Bo's next write to that slot is refused and the status line says so.
      const refused = await api("Bo", "/map-slot", { slotId: sys, path: "$.diastolic", format: "json" });
      assertEquals(refused.status, 409);
      assertEquals(refused.json.humanWins, true);
      await waitFor(
        async () => (await page.locator("#status-main").innerText()).includes("was not applied"),
        "status line names the refused agent change",
      );
      assert((await expr(page, sys)).includes("systolic"), "your mapping stays");

      // 5. When the lease ends while the warning is open, it closes and your change is saved.
      await ok("Bo", "/release-slot", { all: true });
      const setting = await findSlotIdEndingWith(page, "context/EVENT_CONTEXT/setting/value");
      await ok("Cy", "/register-agent", { agentId: "cy", displayName: "Cy" });
      await ok("Cy", "/lease-slot", { slotId: setting, ttlSec: 4 });
      await waitFor(async () => (await page.locator("#lease-chip").innerText()).includes("Cy"), "Cy's lease shown");
      const beforeEnd = await historyLength();
      await mapInUi(page, setting, "$.unit");
      await dialog.waitFor({ state: "visible" });
      await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      await waitFor(async () => (await historyLength()) > beforeEnd, "saved when the lease ended");
      assertStringIncludes(await page.locator("#status-main").innerText(), "lease ended");
    } finally {
      await browser.close();
      server.kill();
      await server.status;
    }
  },
});
