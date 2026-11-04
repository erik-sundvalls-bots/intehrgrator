/**
 * Optional javac of generated ConversionScript against Archie jars from Maven Central.
 *
 * Install / skip: docs/JAVA_EXPORT.md — set SKIP_ARCHIE_COMPILE=1 to disable.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import * as enMsg from "blockly/msg/en";
import { Blockly } from "@intehrgrator/blockly/blockly_core.ts";
import { initBlocklyGenerators, workspaceToModelJson } from "@intehrgrator/blockly/mod.ts";
import { ensureRmBlockType } from "@intehrgrator/blockly/blocks/rm_blocks.ts";
import { registerSchemaBlocksFromSkeleton } from "@intehrgrator/blockly/schema_blocks.ts";
import { createEmptyModel, applyExpressionEdit, upsertLoop } from "@intehrgrator/core/mapping_model/mod.ts";
import { generate } from "@intehrgrator/core/codegen/mod.ts";
import { parseExampleSetCatalog } from "@intehrgrator/core/example_sets/mod.ts";
import { applyOptionalRmToSkeleton, generateSkeleton, collectValueSlots } from "@intehrgrator/core/skeleton/generate_skeleton.ts";
import { detectTargetFormat, getTargetFormatHandler } from "@intehrgrator/core/target/mod.ts";

const ARCHIE_VERSION = "3.20.0";
const MAVEN = "https://repo1.maven.org/maven2";

const JARS: Array<{ path: string; file: string }> = [
  { path: `com/nedap/healthcare/archie/openehr-rm/${ARCHIE_VERSION}`, file: `openehr-rm-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/tools/${ARCHIE_VERSION}`, file: `tools-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/aom/${ARCHIE_VERSION}`, file: `aom-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/archie-utils/${ARCHIE_VERSION}`, file: `archie-utils-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/referencemodels/${ARCHIE_VERSION}`, file: `referencemodels-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/i18n/${ARCHIE_VERSION}`, file: `i18n-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/base/${ARCHIE_VERSION}`, file: `base-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/grammars/${ARCHIE_VERSION}`, file: `grammars-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/bmm/${ARCHIE_VERSION}`, file: `bmm-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/path-queries/${ARCHIE_VERSION}`, file: `path-queries-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/utils/${ARCHIE_VERSION}`, file: `utils-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/openehr-terminology/${ARCHIE_VERSION}`, file: `openehr-terminology-${ARCHIE_VERSION}.jar` },
  { path: `com/nedap/healthcare/archie/odin/${ARCHIE_VERSION}`, file: `odin-${ARCHIE_VERSION}.jar` },
  { path: "com/fasterxml/jackson/core/jackson-databind/2.22.2", file: "jackson-databind-2.22.2.jar" },
  { path: "com/fasterxml/jackson/core/jackson-core/2.22.2", file: "jackson-core-2.22.2.jar" },
  { path: "com/fasterxml/jackson/core/jackson-annotations/2.22", file: "jackson-annotations-2.22.jar" },
  { path: "com/fasterxml/jackson/datatype/jackson-datatype-jsr310/2.22.2", file: "jackson-datatype-jsr310-2.22.2.jar" },
  { path: "org/slf4j/slf4j-api/1.7.36", file: "slf4j-api-1.7.36.jar" },
  { path: "com/google/guava/guava/33.7.1-jre", file: "guava-33.7.1-jre.jar" },
  { path: "org/threeten/threeten-extra/1.10.0", file: "threeten-extra-1.10.0.jar" },
  { path: "javax/xml/bind/jaxb-api/2.3.1", file: "jaxb-api-2.3.1.jar" },
  { path: "com/github/zafarkhaja/java-semver/0.10.2", file: "java-semver-0.10.2.jar" },
  { path: "com/google/code/findbugs/jsr305/3.0.2", file: "jsr305-3.0.2.jar" },
  { path: "org/antlr/antlr4-runtime/4.13.2", file: "antlr4-runtime-4.13.2.jar" },
];

/** True when javac rejected `--release N` (GitHub's default JDK is often older than 21). */
function javacReleaseUnsupported(output: string): boolean {
  return /release version \d+ not supported/i.test(output);
}

async function javaAvailable(): Promise<boolean> {
  try {
    const out = await new Deno.Command("java", { args: ["-version"], stdout: "piped", stderr: "piped" }).output();
    return out.success || out.code === 0;
  } catch {
    return false;
  }
}

async function javacReleaseSupported(release: string): Promise<boolean> {
  try {
    const out = await new Deno.Command("javac", {
      args: ["--release", release, "-version"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = `${new TextDecoder().decode(out.stderr)}\n${new TextDecoder().decode(out.stdout)}`;
    if (javacReleaseUnsupported(text)) return false;
    return out.success || out.code === 0;
  } catch {
    return false;
  }
}

async function fetchJars(dir: string): Promise<string[] | null> {
  const paths: string[] = [];
  for (const jar of JARS) {
    const dest = join(dir, jar.file);
    const url = `${MAVEN}/${jar.path}/${jar.file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`skip Archie compile: HTTP ${res.status} for ${url}`);
        return null;
      }
      await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
      paths.push(dest);
    } catch (err) {
      console.warn(`skip Archie compile: failed to fetch ${url}: ${err}`);
      return null;
    }
  }
  return paths;
}

Deno.test("optional Archie javac skip detects unsupported --release", () => {
  assertEquals(
    javacReleaseUnsupported(
      "error: release version 21 not supported\nUsage: javac <options> <source files>",
    ),
    true,
  );
  assertEquals(javacReleaseUnsupported("javac 21.0.2"), false);
});

Deno.test({
  name: "generated Java compiles against Archie when Maven Central jars are reachable (optional)",
  ignore: Deno.env.get("SKIP_ARCHIE_COMPILE") === "1",
  async fn() {
    if (!(await javaAvailable())) {
      console.warn("skip: java not on PATH");
      return;
    }
    if (!(await javacReleaseSupported("21"))) {
      console.warn("skip: javac does not support --release 21");
      return;
    }

    const opt = await Deno.readTextFile(
      join(import.meta.dirname!, "fixtures", "blood_pressure.opt"),
    );
    const { templateId, skeleton } = generateSkeleton(opt);
    const systolic = collectValueSlots(skeleton).find((slot) =>
      slot.slotId.endsWith("items/at0004/value/value/value")
    );
    if (!systolic) throw new Error("expected systolic slot");
    let model = createEmptyModel(templateId);
    model.targetFormat = "openehr-template";
    model = applyExpressionEdit(model, systolic.slotId, 'xpathNumber("$.systolic")', {
      rmType: systolic.rmType,
      returnType: "number",
      label: systolic.label,
    });
    model = upsertLoop(model, {
      attachSlotId: "unused-loop-for-helper-coverage",
      varName: "items",
      path: "$.items",
      kind: "source",
    });
    const java = generate(model, "java", { skeleton });
    assertStringIncludes(java, "new Composition()");
    assertStringIncludes(java, "new DvQuantity(");
    assertStringIncludes(java, "RMObjectValidator");

    const dir = await Deno.makeTempDir({ prefix: "intehrgrator-archie-" });
    const libDir = join(dir, "lib");
    await Deno.mkdir(libDir, { recursive: true });
    const jars = await fetchJars(libDir);
    if (!jars) return;

    const srcDir = join(dir, "src", "se", "regionstockholm", "intehrgrator", "generated");
    const runtimeDir = join(dir, "src", "se", "regionstockholm", "intehrgrator", "runtime");
    await Deno.mkdir(srcDir, { recursive: true });
    await Deno.mkdir(runtimeDir, { recursive: true });
    const srcPath = join(srcDir, "ConversionScript.java");
    await Deno.writeTextFile(srcPath, java);
    const helperRoot = join(import.meta.dirname!, "..", "src", "core", "codegen", "helpers", "java");
    await Deno.copyFile(
      join(helperRoot, "IntehrgratorRuntime.java"),
      join(runtimeDir, "IntehrgratorRuntime.java"),
    );
    const classes = join(dir, "classes");
    await Deno.mkdir(classes, { recursive: true });
    const classpath = jars.join(":");
    await Deno.copyFile(
      join(helperRoot, "CodedTextSupport.java"),
      join(runtimeDir, "CodedTextSupport.java"),
    );
    await compileJavaFiles(classpath, classes, javaSources(java, srcPath, runtimeDir), "synthetic blood pressure");

    const repoRoot = join(import.meta.dirname!, "..");
    const catalogPath = join(repoRoot, "examples", "example-sets.json");
    const catalog = parseExampleSetCatalog(
      await Deno.readTextFile(catalogPath),
      "https://app.test/examples/example-sets.json",
    );
    const compiled: string[] = [];
    for (const set of catalog.sets) {
      if (!set.mapping || !set.target) continue;
      const targetPath = catalogAssetPath(repoRoot, catalogPath, set.target);
      const targetText = await Deno.readTextFile(targetPath);
      const filename = targetPath.split("/").pop() ?? "target";
      const format = detectTargetFormat(filename, targetText);
      if (format !== "openehr-template") continue;
      const target = getTargetFormatHandler(format).load(filename, targetText);
      const mapping = JSON.parse(
        await Deno.readTextFile(catalogAssetPath(repoRoot, catalogPath, set.mapping)),
      );
      ensureBlockly();
      registerSkeletonBlocks(target.skeleton);
      registerBlockTypesInState(mapping);
      const workspace = new Blockly.Workspace();
      try {
        try {
          Blockly.serialization.workspaces.load(mapping, workspace);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(`${set.id}: ${detail}`);
        }
        const extract = workspaceToModelJson(workspace);
        const model = {
          ...createEmptyModel(target.templateId || set.id),
          targetFormat: "openehr-template" as const,
          slots: extract.slots,
          loops: extract.loops,
          optionalRm: extract.optionalRm,
          functions: extract.functions,
          includes: extract.includes,
        };
        const skeleton = applyOptionalRmToSkeleton(target.skeleton, extract.optionalRm);
        const source = generate(model, "java", { skeleton, blocklyState: mapping });
        assertStringIncludes(source, "public class ConversionScript");
        await Deno.writeTextFile(srcPath, source);
        await compileJavaFiles(
          classpath,
          classes,
          javaSources(source, srcPath, runtimeDir),
          set.id,
        );
        compiled.push(set.id);
      } finally {
        workspace.dispose();
      }
    }
    assertEquals(compiled.includes("Simple-vitals"), true);
    assertEquals(compiled.includes("Simple-vitals-series"), true);
    assertEquals(compiled.includes("obx-mhv1-mapped-json-to-openehr"), true);
    assertEquals(compiled.includes("karda-ordinationsdata-to-openehr-flat"), true);
  },
});

function registerSkeletonBlocks(skeleton: Parameters<typeof registerSchemaBlocksFromSkeleton>[0]): void {
  registerSchemaBlocksFromSkeleton(skeleton);
  const walk = (node: (typeof skeleton)[number]) => {
    try {
      ensureRmBlockType(node.blockType, node.rmType);
    } catch {
      // Expression and schema blocks are registered elsewhere.
    }
    for (const child of node.children) walk(child);
  };
  for (const root of skeleton) walk(root);
}

function registerBlockTypesInState(state: unknown): void {
  const types = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const rec = value as Record<string, unknown>;
    if (typeof rec.type === "string") types.add(rec.type);
    for (const child of Object.values(rec)) walk(child);
  };
  walk(state);
  for (const type of types) {
    if (Blockly.Blocks[type]) continue;
    try {
      ensureRmBlockType(type, type.toUpperCase());
    } catch {
      // Leave unknown blocks to fail the load with the set id.
    }
  }
}

function catalogAssetPath(repoRoot: string, catalogPath: string, ref: string): string {
  if (/^https?:/i.test(ref)) {
    return join(repoRoot, new URL(ref).pathname.replace(/^\//, ""));
  }
  return normalize(join(dirname(catalogPath), ref));
}

let blocklyReady = false;
function ensureBlockly(): void {
  if (blocklyReady) return;
  const anyMod = enMsg as { default?: Record<string, string> } & Record<string, string>;
  const table = anyMod.default && typeof anyMod.default === "object" ? anyMod.default : anyMod;
  Blockly.setLocale(table);
  initBlocklyGenerators();
  blocklyReady = true;
}

function javaSources(source: string, srcPath: string, runtimeDir: string): string[] {
  const files = [srcPath, join(runtimeDir, "IntehrgratorRuntime.java")];
  if (source.includes("CodedTextSupport")) files.push(join(runtimeDir, "CodedTextSupport.java"));
  if (source.includes("HandlebarsSupport")) files.push(join(runtimeDir, "HandlebarsSupport.java"));
  return files;
}

async function compileJavaFiles(
  classpath: string,
  classes: string,
  files: string[],
  label: string,
): Promise<void> {
  const result = await new Deno.Command("javac", {
    args: ["--release", "21", "-cp", classpath, "-d", classes, ...files],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(result.stderr);
  const stdout = new TextDecoder().decode(result.stdout);
  assertEquals(result.success, true, `javac failed for ${label}:\n${stderr}\n${stdout}`);
}
