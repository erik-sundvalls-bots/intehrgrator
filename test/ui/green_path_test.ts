/**
 * UI green-path: major Mapping Editor process steps and several block categories.
 * Keep this covering load → Click-to-Map → Optional RM Insertion / Defaults → Test Run → Generated Export
 * (docs/TESTING.md). Prefer `deno task test:ui`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { chromium } from "npm:playwright@1.51.0";
import type { IntehrgratorTestApi } from "../../src/ui_test/test_api.ts";
import {
  baseUrl,
  clickBlocklyBlock,
  clickExamplePath,
  diastolicSuffix,
  findElementBlockId,
  findSlotIdEndingWith,
  findSystolicSlotId,
  getSnapshot,
  loadBpFixtures,
  runTestAndWait,
  waitForMappedSlot,
  waitForTestApi,
} from "./helpers.ts";

Deno.test({
  name: "UI green-path: load, Click-to-Map source queries, Optional RM Insertion, Test Run, Generated Export",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      const loadBtn = page.locator("#btn-open-template");
      await loadBtn.waitFor({ timeout: 10_000 });
      assertEquals((await loadBtn.innerText()).trim(), "Load target & default context map");
      await loadBtn.click();
      await page.locator("#dialog-joint-load").waitFor({ state: "visible", timeout: 5_000 });
      await page.locator("#joint-load-cancel").click();
      await loadBpFixtures(page);

      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi?: { getSnapshot: () => { blocklyBlocks: Array<{ type: string }> } };
        }).intehrgratorTestApi;
        return api?.getSnapshot().blocklyBlocks.some((block) => block.type === "composition") === true;
      }, undefined, { timeout: 20_000 });

      const loaded = await getSnapshot(page);
      assertEquals(loaded.exampleCount, 1);
      assert(
        loaded.blocklyBlocks.some((block) => block.type === "composition"),
        "expected RM COMPOSITION instance root after loading the target",
      );
      assert(
        loaded.blocklyBlocks.some((block) => block.type === "default_context_map"),
        `expected unique default context map on the canvas, got: ${
          loaded.blocklyBlocks.map((block) => block.type).join(", ")
        }`,
      );
      const composition = loaded.blocklyBlocks.find((block) => block.type === "composition");
      assertEquals(composition?.fields.INSTANCE_ENCODING, "canonical-json");

      // Loops & Logic drawer: flyout must open (for_each_list is the lead block).
      const logicCategory = page.locator(".blocklyToolboxCategoryLogic");
      await logicCategory.waitFor({ timeout: 10_000 });
      await logicCategory.click();
      await page.locator(".blocklyFlyout").first().waitFor({ state: "visible", timeout: 8_000 });
      await logicCategory.click();

      const systolicId = await findSystolicSlotId(page);
      await clickBlocklyBlock(page, await findElementBlockId(page, systolicId));
      assertEquals((await getSnapshot(page)).listeningSlotId, systolicId);
      await clickExamplePath(page, "$.systolic");
      await waitForMappedSlot(page, systolicId, "systolic");

      const diastolicId = await findSlotIdEndingWith(page, diastolicSuffix);
      await clickBlocklyBlock(page, await findElementBlockId(page, diastolicId));
      await clickExamplePath(page, "$.diastolic");
      await waitForMappedSlot(page, diastolicId, "diastolic");

      const afterMap = await getSnapshot(page);
      assert(
        afterMap.blocklyBlocks.some((block) => block.type === "source_query_number"),
        `expected source_query_number after Click-to-Map, got: ${
          afterMap.blocklyBlocks.map((block) => block.type).join(", ")
        }`,
      );

      const compositionId = afterMap.blocklyBlocks.find((block) => block.type === "composition")
        ?.id;
      assert(compositionId, "COMPOSITION id");
      await page.evaluate((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        api.scrollBlockIntoView(id);
        api.openMutator(id);
        api.setOptionalRmExtras(id, ["feeder_audit"]);
      }, compositionId);
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getSnapshot: () => { blocklyBlocks: Array<{ type: string }> } };
        }).intehrgratorTestApi;
        return api.getSnapshot().blocklyBlocks.some((block) => block.type === "feeder_audit");
      }, undefined, { timeout: 5_000 });

      await page.evaluate((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        api.setBlockField(id, "INSTANCE_ENCODING", "canonical-xml");
      }, compositionId);
      const encoded = await getSnapshot(page);
      assertEquals(
        encoded.blocklyBlocks.find((block) => block.id === compositionId)?.fields.INSTANCE_ENCODING,
        "canonical-xml",
      );
      await page.evaluate((id) => {
        const api = (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi;
        api.setBlockField(id, "INSTANCE_ENCODING", "canonical-json");
      }, compositionId);

      await runTestAndWait(page);
      const tested = await getSnapshot(page);
      const output = tested.testResult?.output as Record<string, unknown> | undefined;
      assertEquals(tested.testResult?.ok, true, (tested.testResult?.warnings ?? []).join("; "));
      assert(
        output && !("slots" in output),
        `openEHR Test Run must not include a slots sidecar: ${JSON.stringify(output)}`,
      );
      const asText = JSON.stringify(output);
      assertStringIncludes(asText, "120");
      assertStringIncludes(asText, "80");

      await page.selectOption("#export-target", "typescript");
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getSnapshot: () => { generatedCode: string } };
        }).intehrgratorTestApi;
        return api.getSnapshot().generatedCode.includes("$.systolic");
      }, undefined, { timeout: 10_000 });
      const ts = (await getSnapshot(page)).generatedCode;
      assertStringIncludes(ts, "xpathNumber");
      assertStringIncludes(ts, "$.diastolic");
      assertStringIncludes(ts, "new COMPOSITION({");

      await page.selectOption("#export-target", "xquery");
      await page.waitForFunction(() => {
        const api = (globalThis as unknown as {
          intehrgratorTestApi: { getSnapshot: () => { generatedCode: string } };
        }).intehrgratorTestApi;
        const code = api.getSnapshot().generatedCode;
        return code.includes("xquery") || code.includes("declare variable");
      }, undefined, { timeout: 10_000 });
      const xq = (await getSnapshot(page)).generatedCode;
      assertStringIncludes(xq, "declare variable $source");
      assertStringIncludes(xq, "systolic");
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name:
    "UI green-path: file project opens, visually removes an identifier, saves results, and keeps text undo local",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { join } = await import("@std/path");
    const { loadFileProject, generateProjectArtifacts } = await import(
      "../../src/workbench/file_project.ts"
    );
    const root = join(import.meta.dirname!, "../../examples/file-project");
    const manifest = await Deno.readTextFile(join(root, "intehrgrator.json"));
    let mapping = await Deno.readTextFile(
      join(root, "mapping/main.mapping.json"),
    );
    const files = {
      readText: (path: string) =>
        path === "mapping/main.mapping.json"
          ? Promise.resolve(mapping)
          : Deno.readTextFile(join(root, path)),
      listExamples: () => Promise.resolve(["person-01.json"]),
    };
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    const commands: string[] = [];
    let version = 1;
    let savedResult: unknown;
    const post = (data: unknown) =>
      page.evaluate((message) => {
        globalThis.dispatchEvent(
          new MessageEvent("message", { data: message }),
        );
      }, data);
    try {
      await page.exposeFunction(
        "fileProjectHost",
        async (
          message: {
            type: string;
            mapping?: string;
            command?: string;
            id?: string;
            payload?: { url?: string };
          },
        ) => {
          if (message.type === "intehrgrator:project-ready") {
            await post({
              type: "intehrgrator:project-load",
              bundle: (await loadFileProject(manifest, files)).bundle,
              version,
              generation: 1,
              reason: "initial",
            });
          } else if (message.type === "intehrgrator:project-edit") {
            mapping = message.mapping!;
            await post({
              type: "intehrgrator:project-ack",
              version: ++version,
              generation: 1,
            });
          } else if (message.type === "intehrgrator:project-command") {
            commands.push(message.command!);
            if (message.command === "save") {
              const artifacts = generateProjectArtifacts(
                await loadFileProject(manifest, files),
              );
              savedResult = JSON.parse(
                artifacts.find((a) =>
                  a.path === "output/examples/person-01.json"
                )!.content,
              );
            }
          } else if (message.type === "intehrgrator:host-request") {
            let result: unknown = null;
            if (message.command === "fetchTextUrl" && message.payload?.url) {
              result = {
                name: "catalog.json",
                text: await (await fetch(message.payload.url)).text(),
              };
            }
            await post({
              type: "intehrgrator:host-response",
              id: message.id,
              result,
            });
          }
        },
      );
      await page.addInitScript(() => {
        Object.assign(globalThis, {
          acquireVsCodeApi: () => ({
            postMessage: (message: unknown) => {
              void (globalThis as unknown as {
                fileProjectHost: (message: unknown) => Promise<void>;
              }).fileProjectHost(message);
            },
          }),
        });
      });
      await page.goto(`${baseUrl}/?testMode=1`, { waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.waitForFunction(() =>
        document.getElementById("btn-save-project")?.textContent ===
          "Save mapping"
      );
      const snapshot = await getSnapshot(page);
      const identifier = snapshot.blocklyBlocks.find((block) =>
        block.fields?.EXPRESSION === "$.id"
      );
      assert(
        identifier,
        "identifier query must be visible in the loaded mapping",
      );
      await page.evaluate((id) => {
        (globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi.scrollBlockIntoView(id);
      }, identifier.id);
      const rect = await page.evaluate(
        (id) =>
          (globalThis as unknown as {
            intehrgratorTestApi: IntehrgratorTestApi;
          }).intehrgratorTestApi.getBlockClientRect(id),
        identifier.id,
      );
      assert(rect);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + 5);
      assertEquals((await getSnapshot(page)).selectedBlockId, identifier.id);
      await page.keyboard.press("Delete");
      await page.waitForFunction(() =>
        !(globalThis as unknown as { intehrgratorTestApi: IntehrgratorTestApi })
          .intehrgratorTestApi.getSnapshot().blocklyBlocks.some((block) =>
            block.fields?.EXPRESSION === "$.id"
          )
      );
      await page.locator("#btn-menu-file").click();
      await page.locator("#btn-save-project").click();
      for (let i = 0; i < 50 && savedResult === undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assertEquals(savedResult, { name: "Example Person" });
      // A new webview context must reconstruct all inputs from the saved project.
      await page.reload({ waitUntil: "networkidle" });
      await waitForTestApi(page);
      await page.waitForFunction(() => document.getElementById("btn-save-project")?.textContent === "Save mapping");
      await page.waitForSelector('#schema-tree .tree-row[data-path="$.displayName"]');
      const restored = await getSnapshot(page);
      assertEquals(restored.exampleCount, 1);
      assertEquals(restored.activeExampleFilename, "person-01.json");
      assertEquals(restored.templateId, "Person");
      assertEquals(restored.blocklyBlocks.some(block => block.fields?.EXPRESSION === "$.id"), false);
      const nameQuery = (await getSnapshot(page)).blocklyBlocks.find((block) =>
        block.fields?.EXPRESSION === "$.displayName"
      );
      assert(nameQuery);
      const field = await page.evaluate(
        (id) =>
          (globalThis as unknown as {
            intehrgratorTestApi: IntehrgratorTestApi;
          }).intehrgratorTestApi.getFieldClientRect(id, "EXPRESSION"),
        nameQuery.id,
      );
      assert(field);
      await page.mouse.dblclick(
        field.x + field.width / 2,
        field.y + field.height / 2,
      );
      const input = page.locator("input.blocklyHtmlInput");
      await input.waitFor({ state: "visible" });
      await input.press("End");
      await input.type("x");
      await input.press("Control+z");
      assertEquals(
        commands.includes("undo"),
        false,
        "Ctrl+Z in a text field must not undo the mapping document",
      );
      await input.press("Escape");
    } catch (error) {
      await page.screenshot({ path: ".local/file-project-ui.png", fullPage: true });
      throw error;
    } finally {
      await browser.close();
    }
  },
});
