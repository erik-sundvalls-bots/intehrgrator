/**
 * Retake the screenshots of docs/tutorial/parallel-agents.md.
 *
 * Starts the desktop server headless (as the app does, without a window),
 * opens its page in Chromium, runs scripts/parallel_agents_demo.ts (three
 * stdio MCP agents, Ada, Bo and Cy, each in a leased subtree) and takes the
 * pictures while the leases are held. No AI provider or key is used.
 *
 *   deno run -A scripts/tutorial_parallel_agents_screenshots.ts [--bin <intEHRgrator binary>]
 *
 * With --bin the agents run the compiled app with --mcp (as an IDE would);
 * without it they run src/agent/mcp_stdio.ts.
 */
import { chromium, type Locator, type Page } from "npm:playwright@1.51.0";
import { waitForTestApi } from "../test/ui/helpers.ts";

const root = new URL("../", import.meta.url).pathname;
const out = `${root}docs/assets/tutorial/`;
const port = 18_500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const binIdx = Deno.args.indexOf("--bin");
const bin = binIdx >= 0 ? Deno.args[binIdx + 1] : undefined;

async function waitFor(check: () => Promise<boolean>, what: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out: ${what}`);
}

async function clipAround(page: Page, target: Locator, file: string, pad = { x: 30, top: 40, bottom: 30 }, max?: { w: number; h: number }) {
  const box = (await target.boundingBox())!;
  const x = Math.max(0, box.x - pad.x);
  const y = Math.max(0, box.y - pad.top);
  await page.screenshot({
    path: `${out}${file}`,
    clip: {
      x,
      y,
      width: Math.min(max?.w ?? 1e9, box.width + 2 * pad.x),
      height: Math.min(max?.h ?? 1e9, box.height + pad.top + pad.bottom),
    },
  });
}

const server = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "--no-check", "src/desktop/main.ts", "--headless", "--port", String(port)],
  cwd: root,
  env: { INTEHR_AGENT_TOKEN: "" },
  stdout: "null",
  stderr: "null",
}).spawn();
let demo: Deno.ChildProcess | undefined;
const browser = await chromium.launch({ headless: true });
try {
  await waitFor(async () => (await fetch(`${base}/api/v1/health`)).ok, "desktop server");
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("dialog", (d) => void d.accept());
  await page.goto(`${base}/?testMode=1`, { waitUntil: "networkidle" });
  await waitForTestApi(page);
  // Give the Mapping Editors most of the height.
  await page.evaluate(() => localStorage.setItem("intehr-follow-agent", "0"));

  // 1. Local MCP server panel (what you copy into the IDE).
  await page.click("#btn-copy-ai");
  await page.click('[data-ai-action="local-mcp"]');
  const dialog = page.locator("#dialog-local-mcp");
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await clipAround(page, dialog, "parallel-agents-local-mcp.png", { x: 10, top: 10, bottom: 10 });
  await page.keyboard.press("Escape");

  // 2. Three agents start, lease their subtrees and work.
  demo = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "scripts/parallel_agents_demo.ts",
      "--url",
      base,
      "--load",
      "--hold",
      "120",
      "--step",
      "1",
      ...(bin ? ["--bin", bin] : []),
    ],
    cwd: root,
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  let log = "";
  void (async () => {
    for await (const chunk of demo!.stdout.pipeThrough(new TextDecoderStream())) {
      log += chunk;
      await Deno.stdout.write(new TextEncoder().encode(chunk));
    }
  })();
  await waitFor(async () => log.includes("Holding the leases"), "demo agents", 120_000);
  const chip = page.locator("#lease-chip");
  await chip.waitFor({ state: "visible" });
  await page.waitForSelector(".lease-marker", { timeout: 15_000 });
  await page.waitForTimeout(800);

  // 3. The lease chip in the Mapping Editors header.
  const header = page.locator(".mapping-pane > .pane-header");
  const headerBox = (await header.count()) ? header : chip;
  await clipAround(page, headerBox, "parallel-agents-chip.png", { x: 6, top: 6, bottom: 6 });

  // 4. Show each agent's subtree: the chip scrolls to the next lease.
  const tags = async (agent: string) => page.locator(`.lease-marker[data-slot-id] .lease-marker-tag`, { hasText: agent });
  const shots: Array<[string, string]> = [["Bo", "parallel-agents-lease-bo.png"], ["Ada", "parallel-agents-lease-ada.png"]];
  for (const [agent, file] of shots) {
    for (let i = 0; i < 4; i++) {
      const tag = (await tags(agent)).first();
      const box = await tag.boundingBox().catch(() => null);
      const canvas = (await page.locator("#blockly-mount").boundingBox())!;
      if (box && box.y > canvas.y && box.y < canvas.y + canvas.height - 80) break;
      await chip.click();
      await page.waitForTimeout(500);
    }
    const marker = page.locator(".lease-marker", { has: page.locator(".lease-marker-tag", { hasText: agent }) }).first();
    await clipAround(page, marker, file, { x: 24, top: 24, bottom: 16 }, { w: 900, h: 520 });
  }

  // 5. Whole window with all three leases.
  await page.screenshot({ path: `${out}parallel-agents-overview.png` });

  // 6. History: who did what, including the agents.
  await page.click("#btn-history");
  const panel = page.locator(".history-panel");
  await panel.waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await clipAround(page, panel, "parallel-agents-history.png", { x: 6, top: 6, bottom: 6 }, { w: 700, h: 760 });
  await page.click("#btn-history");

  // 7. You change something inside Bo's lease: the warning with the countdown.
  const slotInBo = await page.evaluate(() => {
    const api = (globalThis as unknown as { intehrgratorTestApi: { findSlotIdBySuffix(s: string): string | null } })
      .intehrgratorTestApi;
    return api.findSlotIdBySuffix("items/at1006/value/value/value") ??
      api.findSlotIdBySuffix("items/at0004/value/value/value");
  });
  if (slotInBo) {
    await page.evaluate((id) =>
      (globalThis as unknown as { intehrgratorTestApi: { mapNodeToSlot(a: string, b: string, c: string): void } })
        .intehrgratorTestApi.mapNodeToSlot(id, "$.systolic", "json"), slotInBo);
    const warning = page.locator("#dialog-lease-warning");
    await warning.waitFor({ state: "visible" });
    await page.waitForTimeout(2300);
    await clipAround(page, warning, "parallel-agents-lease-warning.png", { x: 24, top: 24, bottom: 24 }, { w: 900, h: 520 });
    await page.click("#lease-warning-cancel");
  }
  console.log(`\nScreenshots written to ${out}`);
} finally {
  try {
    demo?.kill();
  } catch { /* done */ }
  await browser.close();
  server.kill();
  await server.status;
}
