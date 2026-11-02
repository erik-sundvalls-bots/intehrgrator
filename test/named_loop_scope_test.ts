/**
 * A source path names a loop item in lexical scope (`course.code`, `day.start`)
 * from inside a nested loop. Preview, TypeScript and the XQuery text agree.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createEmptyModel, upsertLoop, applyExpressionEdit } from "@intehrgrator/core/mapping_model/mod.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { emitTsExpression, createTsEmitContext } from "@intehrgrator/core/codegen/typescript.ts";
import { emitXQueryExpr } from "@intehrgrator/core/codegen/xquery.ts";
import { emitGoExpr, createGoEmitContext } from "@intehrgrator/core/codegen/go_template.ts";
import { parseExpression } from "@intehrgrator/core/expression/mod.ts";
import { namedLoopRead } from "@intehrgrator/core/named_loop_path.ts";
import { runTest } from "@intehrgrator/core/test_runner/mod.ts";
import type { SkeletonNode, TargetDefinition } from "@intehrgrator/types/mod.ts";
import { WorkbenchService } from "@intehrgrator/workbench/service.ts";
import { callAgentTool } from "@intehrgrator/agent/tools.ts";

const SOURCE = {
  courses: [
    {
      code: "C1",
      days: [
        { start: "d1", doses: [{ name: "a" }, { name: "b" }] },
        { start: "d2", doses: [{ name: "c" }] },
      ],
    },
    {
      code: "C2",
      days: [
        { start: "d3", doses: [{ name: "d" }] },
      ],
    },
  ],
};

function container(
  slotId: string,
  rmType: string,
  children: SkeletonNode[],
  rmAttribute?: string,
  repeating = false,
): SkeletonNode {
  return {
    slotId,
    blockType: rmType.toLowerCase(),
    rmType,
    label: "",
    kind: "container",
    mandatory: false,
    children,
    ...(rmAttribute ? { rmAttribute } : {}),
    ...(repeating ? { multiplicity: "0..*" } : {}),
  };
}

function textValue(slotId: string): SkeletonNode {
  return {
    slotId,
    blockType: "dv_text",
    rmType: "DV_TEXT",
    label: "",
    kind: "value",
    rmAttribute: "value",
    mandatory: false,
    children: [],
  };
}

function element(slotId: string): SkeletonNode {
  return container(slotId, "ELEMENT", [textValue(`${slotId}/value`)], "items");
}

function threeLevelSkeleton(): SkeletonNode[] {
  const dose = container("/c/d/s", "CLUSTER", [
    element("/c/d/s/name"),
    element("/c/d/s/start"),
    element("/c/d/s/code"),
  ], "items", true);
  const day = container("/c/d", "CLUSTER", [dose], "items", true);
  const course = container("/c", "CLUSTER", [day], "content", true);
  return [container("/", "COMPOSITION", [course])];
}

function threeLevelModel() {
  const skeleton = threeLevelSkeleton();
  let model = createEmptyModel("named-loop-scope");
  model.targetFormat = "openehr-template";
  model = upsertLoop(model, { attachSlotId: "/c", varName: "course", path: "$.courses", kind: "source" });
  model = upsertLoop(model, { attachSlotId: "/c/d", varName: "day", path: "days", kind: "source" });
  model = upsertLoop(model, { attachSlotId: "/c/d/s", varName: "dose", path: "doses", kind: "source" });
  const text = { rmType: "DV_TEXT", returnType: "string" };
  model = applyExpressionEdit(model, "/c/d/s/name/value", 'xpathString("name")', text);
  model = applyExpressionEdit(model, "/c/d/s/start/value", 'xpathString("day.start")', text);
  model = applyExpressionEdit(model, "/c/d/s/code/value", 'xpathString("course.code")', text);
  const target: TargetDefinition = {
    format: "openehr-template",
    filename: "named-loop-scope.opt",
    targetId: model.templateId,
    content: "<template/>",
    skeleton,
  };
  return { model, target, skeleton };
}

function texts(output: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.value === "string" && ["a", "b", "c", "d", "d1", "d2", "d3", "C1", "C2"].includes(rec.value)) {
      found.push(rec.value);
    }
    Object.values(rec).forEach(walk);
  };
  walk(JSON.parse(JSON.stringify(output)));
  return found;
}

const EXPECTED = ["a", "d1", "C1", "b", "d1", "C1", "c", "d2", "C1", "d", "d3", "C2"];

Deno.test("namedLoopRead keeps unqualified paths on the inner item", () => {
  assertEquals(namedLoopRead("name", ["course", "day", "dose"]), null);
  assertEquals(namedLoopRead("day.start", ["course", "day", "dose"]), { name: "day", rest: "start" });
  assertEquals(namedLoopRead("$.courses[1].code", ["course"]), null);
  assertEquals(namedLoopRead("course", ["course"]), { name: "course", rest: "." });
});

Deno.test("named loop paths compile to the outer binding in TypeScript, XQuery and Go", () => {
  const ast = parseExpression('xpathString("course.code")');
  const ts = emitTsExpression(ast, {
    ...createTsEmitContext(),
    loopVar: "dose",
    loopBindings: { course: "course", day: "day", dose: "dose" },
  });
  assertEquals(ts, 'xpathString("code", course)');
  const xq = emitXQueryExpr(ast, {
    sourceVar: "$dose",
    bind: { course: "course", day: "day", dose: "dose" },
  });
  assertStringIncludes(xq, "$course?code");
  const go = emitGoExpr(ast, {
    ...createGoEmitContext(),
    loopVar: "dose",
    loopBindings: { course: "$course", day: "$day", dose: "$dose" },
  });
  assertStringIncludes(go, "index $course");
  assertStringIncludes(go, '"code"');
});

Deno.test("three nested loops read the outer items by name", () => {
  const { model, target, skeleton } = threeLevelModel();
  const preview = runTest(model, JSON.stringify(SOURCE), "json", { target });
  assertEquals(preview.warnings ?? [], [], preview.error);
  assertEquals(texts(preview.output), EXPECTED);

  const typescript = runTest(model, JSON.stringify(SOURCE), "json", {
    target,
    outputMode: "typescript",
  });
  assertEquals(typescript.warnings ?? [], [], typescript.error);
  assertEquals(texts(typescript.output), EXPECTED);

  const xq = generate(model, "xquery", { skeleton });
  assertStringIncludes(xq, "$course?code");
  assertStringIncludes(xq, "$day?start");
  assert(!xq.includes("$.courses[1]"), xq);
});

Deno.test("Karda ordination reads the treatment-day start from the day item", async () => {
  const service = new WorkbenchService();
  await callAgentTool(service, "load_example_set", {
    setId: "karda-ordinationsdata-to-openehr-flat",
  });
  const counts: number[] = [];
  for (const outputMode of ["preview", "typescript"] as const) {
    const run = await callAgentTool(service, "run_test", { outputMode }) as {
      testResult: { output: unknown; error?: string };
    };
    const text = typeof run.testResult.output === "string"
      ? run.testResult.output
      : JSON.stringify(run.testResult.output);
    assert(!text.includes("$.KurDagar[1]"), outputMode);
    const hits = text.split("2026-04-27T13:00:00").length - 1;
    assert(hits >= 1, `${outputMode} missed the day's StartTid: ${text.slice(0, 400)}`);
    counts.push(hits);
  }
  assertEquals(counts[1], counts[0]);
});
